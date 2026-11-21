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

/** Source index pairs and weights for one axis, the way cv2.resize INTER_LINEAR picks them. */
function linearTaps(src: number, dst: number): { i0: Int32Array; i1: Int32Array; w: Float64Array } {
  const scale = src / dst
  const i0 = new Int32Array(dst)
  const i1 = new Int32Array(dst)
  const w = new Float64Array(dst)
  for (let d = 0; d < dst; d++) {
    let f = (d + 0.5) * scale - 0.5
    let s = Math.floor(f)
    f -= s
    if (s < 0) {
      s = 0
      f = 0
    }
    if (s >= src - 1) {
      s = src - 1
      f = 0
    }
    i0[d] = s
    i1[d] = Math.min(s + 1, src - 1)
    w[d] = f
  }
  return { i0, i1, w }
}

/**
 * Bilinear resize of RGBA pixels to packed RGB, matching cv2.resize(..., INTER_LINEAR) to
 * within one level. The browser's own canvas scaling smooths more than OpenCV does, and the
 * model was trained on OpenCV-resized images; at 416 px that difference cost about half of
 * the confidence on real plates.
 */
export function resizeLinearRGBA(
  rgba: Uint8ClampedArray | Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8Array {
  const xs = linearTaps(sw, dw)
  const ys = linearTaps(sh, dh)
  const out = new Uint8Array(dw * dh * 3)
  for (let y = 0; y < dh; y++) {
    const r0 = ys.i0[y] * sw * 4
    const r1 = ys.i1[y] * sw * 4
    const wy = ys.w[y]
    for (let x = 0; x < dw; x++) {
      const c0 = xs.i0[x] * 4
      const c1 = xs.i1[x] * 4
      const wx = xs.w[x]
      const o = (y * dw + x) * 3
      for (let c = 0; c < 3; c++) {
        const top = rgba[r0 + c0 + c] * (1 - wx) + rgba[r0 + c1 + c] * wx
        const bot = rgba[r1 + c0 + c] * (1 - wx) + rgba[r1 + c1 + c] * wx
        out[o + c] = Math.round(top * (1 - wy) + bot * wy)
      }
    }
  }
  return out
}

/**
 * letterbox() from cenpai/detector.py straight into the model input: (1,3,S,S) float32 RGB in
 * [0,1], padded with PAD_VALUE. `rgba` holds the full-size frame (sw x sh).
 */
export function letterboxToTensor(
  rgba: Uint8ClampedArray | Uint8Array,
  sw: number,
  sh: number,
  size: number,
  out?: Float32Array,
): { tensor: Float32Array; lb: LetterboxParams } {
  const lb = letterboxParams(sw, sh, size)
  const plane = size * size
  const tensor = out ?? new Float32Array(3 * plane)
  tensor.fill(PAD_VALUE / 255)
  const rgb = resizeLinearRGBA(rgba, sw, sh, lb.newW, lb.newH)
  for (let y = 0; y < lb.newH; y++) {
    const row = (y + lb.padY) * size + lb.padX
    for (let x = 0; x < lb.newW; x++) {
      const i = (y * lb.newW + x) * 3
      const t = row + x
      tensor[t] = rgb[i] / 255
      tensor[plane + t] = rgb[i + 1] / 255
      tensor[2 * plane + t] = rgb[i + 2] / 255
    }
  }
  return { tensor, lb }
}
