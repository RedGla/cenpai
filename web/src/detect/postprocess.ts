import type { Detection, LetterboxParams } from './types'

/** Greedy NMS, same order and tie rule as _nms() in cenpai/detector.py. boxes are xyxy. */
export function nms(boxes: Float64Array, scores: Float64Array, iouThr: number): number[] {
  const n = scores.length
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b] - scores[a])
  const areas = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    areas[i] = (boxes[4 * i + 2] - boxes[4 * i]) * (boxes[4 * i + 3] - boxes[4 * i + 1])
  }
  const keep: number[] = []
  let rest = order
  while (rest.length) {
    const i = rest[0]
    keep.push(i)
    const next: number[] = []
    for (let k = 1; k < rest.length; k++) {
      const j = rest[k]
      const xx1 = Math.max(boxes[4 * i], boxes[4 * j])
      const yy1 = Math.max(boxes[4 * i + 1], boxes[4 * j + 1])
      const xx2 = Math.min(boxes[4 * i + 2], boxes[4 * j + 2])
      const yy2 = Math.min(boxes[4 * i + 3], boxes[4 * j + 3])
      const inter = Math.max(xx2 - xx1, 0) * Math.max(yy2 - yy1, 0)
      const iou = inter / Math.max(areas[i] + areas[j] - inter, 1e-9)
      if (iou <= iouThr) next.push(j)
    }
    rest = next
  }
  return keep
}

/**
 * raw: model output (1,5,N) flattened channel-major (cx[N], cy[N], w[N], h[N], score[N]) in
 * letterboxed pixels. Returns NMS'd detections in source-pixel coordinates, rounded outward
 * and clipped, like postprocess() in cenpai/detector.py.
 */
export function postprocess(
  raw: ArrayLike<number>,
  n: number,
  lb: Pick<LetterboxParams, 'scale' | 'padX' | 'padY'>,
  origW: number,
  origH: number,
  conf: number,
  iou: number,
): Detection[] {
  const idx: number[] = []
  for (let i = 0; i < n; i++) if (raw[4 * n + i] >= conf) idx.push(i)
  if (!idx.length) return []
  const m = idx.length
  const boxes = new Float64Array(4 * m)
  const scores = new Float64Array(m)
  for (let k = 0; k < m; k++) {
    const i = idx[k]
    const cx = raw[i]
    const cy = raw[n + i]
    const w = raw[2 * n + i]
    const h = raw[3 * n + i]
    boxes[4 * k] = cx - w / 2
    boxes[4 * k + 1] = cy - h / 2
    boxes[4 * k + 2] = cx + w / 2
    boxes[4 * k + 3] = cy + h / 2
    scores[k] = raw[4 * n + i]
  }
  const out: Detection[] = []
  for (const k of nms(boxes, scores, iou)) {
    const fx1 = (boxes[4 * k] - lb.padX) / lb.scale
    const fy1 = (boxes[4 * k + 1] - lb.padY) / lb.scale
    const fx2 = (boxes[4 * k + 2] - lb.padX) / lb.scale
    const fy2 = (boxes[4 * k + 3] - lb.padY) / lb.scale
    const x1 = Math.floor(Math.max(fx1, 0))
    const y1 = Math.floor(Math.max(fy1, 0))
    const x2 = Math.ceil(Math.min(fx2, origW))
    const y2 = Math.ceil(Math.min(fy2, origH))
    if (x2 > x1 && y2 > y1) out.push({ x1, y1, x2, y2, score: scores[k] })
  }
  return out
}
