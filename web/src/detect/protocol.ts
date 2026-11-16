import type { Detection, ModelMeta } from './types'

export type BackendChoice = 'auto' | 'webgpu' | 'wasm'
export type BackendUsed = 'webgpu' | 'wasm'
/** Model input size; 'auto' picks 640 on WebGPU and 416 on WebAssembly. */
export type ModelSize = 640 | 416 | 'auto'

export type ToWorker =
  | { type: 'init'; size: 640 | 416; backend: BackendUsed; threads: number; maskConf: number }
  | { type: 'detect'; id: number; bitmap: ImageBitmap }
  | { type: 'bench'; id: number; bitmap: ImageBitmap; runs: number }

export type FromWorker =
  | {
      type: 'ready'
      backend: BackendUsed
      meta: ModelMeta
      size: number
      warmupMs: number
      /** crossOriginIsolated in the worker; WebAssembly threads need it. */
      isolated: boolean
      /** WebAssembly threads in use (1 = single-threaded). */
      threads: number
    }
  | { type: 'init-error'; message: string }
  | {
      type: 'result'
      id: number
      detections: Detection[]
      inferMs: number
      totalMs: number
      /** Size of the frame the detector actually saw. */
      frameW: number
      frameH: number
    }
  | { type: 'bench-result'; id: number; inferMs: number[]; totalMs: number[] }
  | { type: 'run-error'; id: number; message: string }
