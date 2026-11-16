import type { Detection, ModelMeta } from './types'

export type BackendChoice = 'auto' | 'webgpu' | 'wasm'
export type BackendUsed = 'webgpu' | 'wasm'

export type ToWorker =
  | { type: 'init'; size: 640 | 416; backend: BackendChoice; maskConf: number }
  | { type: 'detect'; id: number; bitmap: ImageBitmap }
  | { type: 'bench'; id: number; bitmap: ImageBitmap; runs: number }

export type FromWorker =
  | { type: 'ready'; backend: BackendUsed; meta: ModelMeta; size: number; warmupMs: number }
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
