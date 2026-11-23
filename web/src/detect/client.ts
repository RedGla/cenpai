import { modelIdFrom } from './modelFolder'
import { startPlan, threadCount, type Attempt } from './plan'
import type { BackendChoice, BackendUsed, FromWorker, ModelSize, ToWorker } from './protocol'
import type { Detection, ModelMeta } from './types'

export interface ReadyInfo {
  backend: BackendUsed
  meta: ModelMeta
  size: number
  warmupMs: number
  /** crossOriginIsolated in the worker; WebAssembly threads need it. */
  isolated: boolean
  /** WebAssembly threads in use (1 = single-threaded). */
  threads: number
  /** Starts that were tried first and failed, e.g. "wasm 416 x4: timed out". */
  skipped: string[]
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

type Waiter<T> = { resolve: (v: T) => void; reject: (e: Error) => void }

/**
 * Main-thread handle to the detector worker. One request at a time; callers check `busy`.
 * Each start attempt gets a fresh worker, so an attempt that hangs (threaded WebAssembly in some
 * browsers) is simply terminated and the next one tried.
 */
export class DetectorClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Waiter<FromWorker>>()
  private initWaiter: Waiter<Extract<FromWorker, { type: 'ready' }>> | null = null
  private stopped = false
  busy = false

  private spawn(): Worker {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data)
    w.onerror = (ev) => this.failAll(new Error(ev.message || 'detector worker crashed'))
    return w
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
      this.initWaiter?.resolve(m)
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

  private tryStart(a: Attempt): Promise<Extract<FromWorker, { type: 'ready' }>> {
    this.worker?.terminate()
    this.worker = this.spawn()
    const worker = this.worker
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.initWaiter = null
        reject(new Error('timed out'))
      }, a.timeoutMs)
      this.initWaiter = {
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      }
      worker.postMessage({
        type: 'init',
        size: a.size,
        backend: a.backend,
        threads: a.threads,
        maskConf: INTERIM_MASK_CONF,
        model: modelIdFrom(globalThis.location?.search ?? ''),
      } satisfies ToWorker)
    })
  }

  async init(size: ModelSize, backend: BackendChoice): Promise<ReadyInfo> {
    const threads = threadCount(globalThis.crossOriginIsolated === true, navigator.hardwareConcurrency)
    const skipped: string[] = []
    for (const a of startPlan(backend, size, threads)) {
      if (this.stopped) break
      try {
        const m = await this.tryStart(a)
        return {
          backend: m.backend,
          meta: m.meta,
          size: m.size,
          warmupMs: m.warmupMs,
          isolated: m.isolated,
          threads: m.threads,
          skipped,
          maskConf: m.meta.mask_conf ?? INTERIM_MASK_CONF,
          interimMask: m.meta.mask_conf === undefined,
        }
      } catch (e) {
        this.worker?.terminate()
        this.worker = null
        skipped.push(`${a.backend} ${a.size} x${a.threads}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    throw new Error(skipped.length ? skipped.join('; ') : 'detector stopped')
  }

  private request(build: (id: number) => ToWorker, bitmap: ImageBitmap): Promise<FromWorker> {
    const worker = this.worker
    if (!worker) {
      bitmap.close()
      return Promise.reject(new Error('detector not started'))
    }
    const id = this.nextId++
    this.busy = true
    return new Promise<FromWorker>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage(build(id), [bitmap])
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
    this.stopped = true
    this.worker?.terminate()
    this.worker = null
    this.failAll(new Error('detector stopped'))
  }
}
