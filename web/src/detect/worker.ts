/// <reference lib="webworker" />
// Detector worker: loads the model, checks its SHA-256 against MODEL.json, and runs one
// inference at a time. Frames arrive as ImageBitmaps and are always closed after use.
import * as ort from 'onnxruntime-web/webgpu'
// The runtime's loader script and binary are served by the app itself (no CDN). Importing
// them with ?url from the package keeps the loader a real module file: WebAssembly threads
// start their own workers from it, and the Vite dev server will not import files in public/.
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import { PAD_VALUE, letterboxToTensor } from './letterbox'
import { modelDir } from './modelFolder'
import { postprocess } from './postprocess'
import type { BackendUsed, FromWorker, ToWorker } from './protocol'
import type { Detection, ModelMeta } from './types'

const base = import.meta.env.BASE_URL
ort.env.wasm.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl }
ort.env.logLevel = 'error'

const send = (msg: FromWorker) => self.postMessage(msg)

let session: ort.InferenceSession | null = null
let meta: ModelMeta | null = null
let size = 640
let maskConf = 0.25
let inputName = 'images'
/** Full-size copy of the frame, read back as raw pixels (no browser scaling). */
let frameCanvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let tensorBuf: Float32Array | null = null

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function loadModel(dir: string): Promise<{ meta: ModelMeta; bytes: Uint8Array }> {
  const metaRes = await fetch(`${dir}MODEL.json`)
  if (!metaRes.ok) throw new Error(`MODEL.json not found (${metaRes.status})`)
  const m = (await metaRes.json()) as ModelMeta
  const res = await fetch(`${dir}${m.file}`)
  if (!res.ok) throw new Error(`model file not found (${res.status})`)
  const buf = await res.arrayBuffer()
  if (!globalThis.crypto?.subtle) {
    throw new Error('cannot verify the model checksum here (needs HTTPS or localhost)')
  }
  const digest = hex(await crypto.subtle.digest('SHA-256', buf))
  if (digest !== m.sha256) throw new Error('model checksum mismatch; refusing to run it')
  return { meta: m, bytes: new Uint8Array(buf) }
}

/** Feature check, not a browser check: WebGPU counts only if an adapter is really there. */
async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) != null
  } catch {
    return false
  }
}

async function createSession(bytes: Uint8Array, backend: BackendUsed): Promise<ort.InferenceSession> {
  if (backend === 'webgpu' && !(await hasWebGPU())) throw new Error('WebGPU is not available')
  return ort.InferenceSession.create(bytes, {
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
  })
}

async function runRaw(input: Float32Array): Promise<{ data: Float32Array; n: number }> {
  const tensor = new ort.Tensor('float32', input, [1, 3, size, size])
  const out = await session!.run({ [inputName]: tensor })
  const first = out[session!.outputNames[0]]
  const dims = first.dims
  if (dims.length !== 3 || dims[1] !== 5) {
    throw new Error(`unexpected output shape [${dims.join(',')}]`)
  }
  const data = (await first.getData()) as Float32Array
  first.dispose()
  return { data, n: dims[2] }
}

/** One start attempt; the client runs each attempt in a fresh worker. */
async function init(msg: Extract<ToWorker, { type: 'init' }>) {
  session = null
  // Must be set before the first session: the WebAssembly runtime starts its threads then.
  ort.env.wasm.numThreads = msg.threads
  try {
    const model = await loadModel(modelDir(base, msg.model, msg.size))
    if (model.meta.imgsz !== msg.size) throw new Error('MODEL.json imgsz does not match the folder')
    meta = model.meta
    size = msg.size
    maskConf = meta.mask_conf ?? msg.maskConf
    frameCanvas = new OffscreenCanvas(1, 1)
    ctx = frameCanvas.getContext('2d', { willReadFrequently: true })
    tensorBuf = new Float32Array(3 * size * size)
    const s = await createSession(model.bytes, msg.backend)
    session = s
    inputName = s.inputNames[0]
    // Warm-up: compiles shaders and proves the backend really runs before we rely on it.
    const t0 = performance.now()
    tensorBuf.fill(PAD_VALUE / 255)
    await runRaw(tensorBuf)
    send({
      type: 'ready',
      backend: msg.backend,
      meta,
      size,
      warmupMs: performance.now() - t0,
      isolated: self.crossOriginIsolated === true,
      threads: msg.threads,
    })
  } catch (e) {
    session = null
    send({ type: 'init-error', message: e instanceof Error ? e.message : String(e) })
  }
}

/** Letterbox the frame, run the model, decode. Timings in ms. */
async function pipeline(
  bitmap: ImageBitmap,
): Promise<{
  detections: Detection[]
  inferMs: number
  totalMs: number
  frameW: number
  frameH: number
}> {
  const t0 = performance.now()
  const w = bitmap.width
  const h = bitmap.height
  if (frameCanvas!.width !== w || frameCanvas!.height !== h) {
    frameCanvas!.width = w
    frameCanvas!.height = h
  }
  const c = ctx!
  c.drawImage(bitmap, 0, 0)
  const { lb } = letterboxToTensor(c.getImageData(0, 0, w, h).data, w, h, size, tensorBuf!)
  const t1 = performance.now()
  const { data, n } = await runRaw(tensorBuf!)
  const t2 = performance.now()
  const detections = postprocess(data, n, lb, w, h, maskConf, meta!.iou)
  return { detections, inferMs: t2 - t1, totalMs: performance.now() - t0, frameW: w, frameH: h }
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data
  if (msg.type === 'init') {
    await init(msg)
    return
  }
  try {
    if (!session) throw new Error('model not loaded')
    if (msg.type === 'detect') {
      const r = await pipeline(msg.bitmap)
      send({ type: 'result', id: msg.id, ...r })
    } else {
      const inferMs: number[] = []
      const totalMs: number[] = []
      for (let i = 0; i < msg.runs; i++) {
        const r = await pipeline(msg.bitmap)
        inferMs.push(r.inferMs)
        totalMs.push(r.totalMs)
      }
      send({ type: 'bench-result', id: msg.id, inferMs, totalMs })
    }
  } catch (e) {
    send({ type: 'run-error', id: msg.id, message: e instanceof Error ? e.message : String(e) })
  } finally {
    msg.bitmap.close()
  }
}
