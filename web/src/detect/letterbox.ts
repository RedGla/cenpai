import type { LetterboxParams } from './types'

/** Python's round(): halves go to the even neighbour. Matches cenpai/detector.py. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d < 0.5) return f
  if (d > 0.5) return f + 1
  return f % 2 === 0 ? f : f + 1
}

/** Geometry of letterbox() in cenpai/detector.py: fit inside size x size, centred. */
export function letterboxParams(w: number, h: number, size: number): LetterboxParams {
  const scale = Math.min(size / h, size / w)
  const newW = Math.max(1, roundHalfEven(w * scale))
  const newH = Math.max(1, roundHalfEven(h * scale))
  return {
    scale,
    padX: Math.floor((size - newW) / 2),
    padY: Math.floor((size - newH) / 2),
    newW,
    newH,
  }
}

export const PAD_VALUE = 114

/**
 * Turn RGBA pixels of the letterboxed canvas into the model input: (1,3,S,S) float32 RGB in [0,1].
 * The caller draws the resized frame at (padX, padY) on a canvas pre-filled with PAD_VALUE.
 */
export function rgbaToTensor(rgba: Uint8ClampedArray, size: number, out?: Float32Array): Float32Array {
  const plane = size * size
  const data = out ?? new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    const j = i * 4
    data[i] = rgba[j] / 255
    data[plane + i] = rgba[j + 1] / 255
    data[2 * plane + i] = rgba[j + 2] / 255
  }
  return data
}
