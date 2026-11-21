import type { BackendChoice, BackendUsed, ModelSize } from './protocol'

/** One way to start the detector. Each attempt runs in a fresh worker. */
export interface Attempt {
  backend: BackendUsed
  size: 640 | 416
  /** WebAssembly threads; 1 means single-threaded. */
  threads: number
  /** Give up on this attempt after this long (ms) and try the next one. */
  timeoutMs: number
}

/** A threaded start that never finishes is abandoned after this long. */
export const THREADED_START_TIMEOUT_MS = 15_000
/** Any other start (model download, checksum, compile, warm-up) gets this long. */
export const START_TIMEOUT_MS = 60_000

/** Threads to ask for: half the cores, at most 4, and only with cross-origin isolation. */
export function threadCount(isolated: boolean, cores: number | undefined): number {
  if (!isolated) return 1
  return Math.min(4, Math.max(1, Math.ceil((cores || 2) / 2)))
}

/**
 * Starts to try, in order. 'auto' size means the 640 model on WebGPU and the 416 model on
 * WebAssembly, the faster choice for each. WebGPU runs without WebAssembly threads (the graphics
 * chip does the work). WebAssembly tries threads first, then falls back to one thread, because
 * a threaded start can hang in some browsers. The worker checks for a real WebGPU adapter at
 * run time, never the browser name.
 */
export function startPlan(backend: BackendChoice, wantSize: ModelSize, threads: number): Attempt[] {
  const sizeFor = (b: BackendUsed): 640 | 416 =>
    wantSize === 'auto' ? (b === 'webgpu' ? 640 : 416) : wantSize
  const out: Attempt[] = []
  if (backend !== 'wasm') {
    out.push({ backend: 'webgpu', size: sizeFor('webgpu'), threads: 1, timeoutMs: START_TIMEOUT_MS })
  }
  if (backend !== 'webgpu') {
    const size = sizeFor('wasm')
    if (threads > 1) {
      out.push({ backend: 'wasm', size, threads, timeoutMs: THREADED_START_TIMEOUT_MS })
    }
    out.push({ backend: 'wasm', size, threads: 1, timeoutMs: START_TIMEOUT_MS })
  }
  return out
}
