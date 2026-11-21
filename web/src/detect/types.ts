export interface Detection {
  x1: number
  y1: number
  x2: number
  y2: number
  score: number
}

export interface LetterboxParams {
  scale: number
  padX: number
  padY: number
  /** Size of the resized image inside the square canvas. */
  newW: number
  newH: number
}

/** Contents of a model folder's MODEL.json. */
export interface ModelMeta {
  file: string
  sha256: string
  imgsz: number
  conf: number
  iou: number
  /** Lower threshold used for masking. Optional; the app falls back to 0.25 when absent. */
  mask_conf?: number
  names?: string[]
  version?: string
}
