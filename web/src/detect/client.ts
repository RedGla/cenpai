import type { BackendChoice, BackendUsed, FromWorker, ToWorker } from './protocol'
import type { Detection, ModelMeta } from './types'

export interface ReadyInfo {
  backend: BackendUsed
  meta: ModelMeta
  size: number
  warmupMs: number
  /** Threshold used for masking: mask_conf from MODEL.json, else the 0.25 interim value. */
  maskConf: number
  interimMask: boolean
}

export interface DetectResult {
  detections: Detection[]
  inferMs: number
  totalMs: number
  frameW: number
  frameH: number
}

export const INTERIM_MASK_CONF = 0.25

/** Main-thread handle to the detector worker. One request at a time; callers check `busy`. */
export class DetectorClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (m: FromWorker) => void; reject: (e: Error) => void }
  >()
  private initWaiter: { resolve: (r: ReadyInfo) => void; reject: (e: Error) => void } | null = null
  busy = false

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data)
    this.worker.onerror = (ev) => this.failAll(new Error(ev.message || 'detector worker crashed'))
  }

  private failAll(err: Error) {
    this.initWaiter?.reject(err)
    this.initWaiter = null
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.busy = false
  }

  private onMessage(m: FromWorker) {
    if (m.type === 'ready') {
      this.initWaiter?.resolve({
        backend: m.backend,
        meta: m.meta,
        size: m.size,
        warmupMs: m.warmupMs,
        maskConf: m.meta.mask_conf ?? INTERIM_MASK_CONF,
        interimMask: m.meta.mask_conf === undefined,
      })
      this.initWaiter = null
    } else if (m.type === 'init-error') {
      this.initWaiter?.reject(new Error(m.message))
      this.initWaiter = null
    } else {
      const p = this.pending.get(m.id)
      this.pending.delete(m.id)
      if (m.type === 'run-error') p?.reject(new Error(m.message))
      else p?.resolve(m)
    }
  }

  init(size: 640 | 416, backend: BackendChoice): Promise<ReadyInfo> {
    return new Promise((resolve, reject) => {
      this.initWaiter = { resolve, reject }
      this.worker.postMessage({
        type: 'init',
        size,
        backend,
        maskConf: INTERIM_MASK_CONF,
      } satisfies ToWorker)
    })
  }

  private request(build: (id: number) => ToWorker, bitmap: ImageBitmap): Promise<FromWorker> {
    const id = this.nextId++
    this.busy = true
    return new Promise<FromWorker>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage(build(id), [bitmap])
    }).finally(() => {
      this.busy = false
    })
  }

  /** The worker takes ownership of the bitmap and closes it. */
  async detect(bitmap: ImageBitmap): Promise<DetectResult> {
    const m = await this.request((id) => ({ type: 'detect', id, bitmap }), bitmap)
    if (m.type !== 'result') throw new Error('unexpected worker reply')
    return {
      detections: m.detections,
      inferMs: m.inferMs,
      totalMs: m.totalMs,
      frameW: m.frameW,
      frameH: m.frameH,
    }
  }

  async bench(bitmap: ImageBitmap, runs: number): Promise<{ inferMs: number[]; totalMs: number[] }> {
    const m = await this.request((id) => ({ type: 'bench', id, bitmap, runs }), bitmap)
    if (m.type !== 'bench-result') throw new Error('unexpected worker reply')
    return { inferMs: m.inferMs, totalMs: m.totalMs }
  }

  terminate() {
    this.worker.terminate()
    this.failAll(new Error('detector stopped'))
  }
}
