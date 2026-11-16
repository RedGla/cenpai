/// <reference lib="webworker" />
// Detector worker: loads the model, checks its SHA-256 against MODEL.json, and runs one
// inference at a time. Frames arrive as ImageBitmaps and are always closed after use.
import * as ort from 'onnxruntime-web/webgpu'
import { PAD_VALUE, letterboxParams, rgbaToTensor } from './letterbox'
import { postprocess } from './postprocess'
import type { BackendUsed, FromWorker, ToWorker } from './protocol'
import type { Detection, ModelMeta } from './types'

const base = import.meta.env.BASE_URL
const ortBase = `${base}ort/`
ort.env.wasm.wasmPaths = {
  mjs: `${ortBase}ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${ortBase}ort-wasm-simd-threaded.asyncify.wasm`,
}
ort.env.logLevel = 'error'

const send = (msg: FromWorker) => self.postMessage(msg)

let session: ort.InferenceSession | null = null
let meta: ModelMeta | null = null
let size = 640
let maskConf = 0.25
let inputName = 'images'
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

async function createSession(bytes: Uint8Array, backend: BackendUsed): Promise<ort.InferenceSession> {
  if (backend === 'webgpu' && !('gpu' in navigator)) throw new Error('WebGPU is not available')
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

async function init(msg: Extract<ToWorker, { type: 'init' }>) {
  try {
    session = null
    const dir = `${base}models/plate-${msg.size}/`
    const loaded = await loadModel(dir)
    if (loaded.meta.imgsz !== msg.size) throw new Error('MODEL.json imgsz does not match the folder')
    meta = loaded.meta
    size = meta.imgsz
    maskConf = meta.mask_conf ?? msg.maskConf
    ctx = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })
    tensorBuf = new Float32Array(3 * size * size)
    const order: BackendUsed[] = msg.backend === 'auto' ? ['webgpu', 'wasm'] : [msg.backend]
    let lastErr = ''
    for (const backend of order) {
      try {
        const s = await createSession(loaded.bytes, backend)
        session = s
        inputName = s.inputNames[0]
        // Warm-up: compiles shaders and proves the backend really runs before we rely on it.
        const t0 = performance.now()
        tensorBuf.fill(PAD_VALUE / 255)
        await runRaw(tensorBuf)
        send({ type: 'ready', backend, meta, size, warmupMs: performance.now() - t0 })
        return
      } catch (e) {
        session = null
        lastErr = `${backend}: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    throw new Error(lastErr)
  } catch (e) {
    send({ type: 'init-error', message: e instanceof Error ? e.message : String(e) })
  }
}

/** Letterbox the frame, run the model, decode. Timings in ms. */
async function pipeline(
  bitmap: ImageBitmap,
): Promise<{ detections: Detection[]; inferMs: number; totalMs: number }> {
  const t0 = performance.now()
  const w = bitmap.width
  const h = bitmap.height
  const lb = letterboxParams(w, h, size)
  const c = ctx!
  c.fillStyle = `rgb(${PAD_VALUE},${PAD_VALUE},${PAD_VALUE})`
  c.fillRect(0, 0, size, size)
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'medium'
  c.drawImage(bitmap, lb.padX, lb.padY, lb.newW, lb.newH)
  rgbaToTensor(c.getImageData(0, 0, size, size).data, size, tensorBuf!)
  const t1 = performance.now()
  const { data, n } = await runRaw(tensorBuf!)
  const t2 = performance.now()
  const detections = postprocess(data, n, lb, w, h, maskConf, meta!.iou)
  return { detections, inferMs: t2 - t1, totalMs: performance.now() - t0 }
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
