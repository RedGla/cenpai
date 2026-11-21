/**
 * Censor styles for a plate's mask, ported from cenpai/censor.py (FR03): an opaque solid mask
 * is the default and safest; blur and pixelate are optional and can leave a plate partly
 * readable.
 */
import type { Box } from '../track/tracker'

export type CensorMode = 'solid' | 'blur' | 'pixelate'
export const CENSOR_MODES: readonly CensorMode[] = ['solid', 'blur', 'pixelate']

/** Blocks along the box's short side (cenpai/censor.py PIXEL_BLOCKS). */
export const PIXEL_BLOCKS = 6
/** Blur sigma as a share of the box's longest side (cenpai/censor.py BLUR_SIGMA_FRAC). */
export const BLUR_SIGMA_FRAC = 0.5

export function parseCensorMode(v: string | null | undefined): CensorMode {
  return v === 'blur' || v === 'pixelate' ? v : 'solid'
}

/** Gaussian sigma for a w x h box, as in cenpai/censor.py. */
export function blurSigma(w: number, h: number): number {
  return Math.max(BLUR_SIGMA_FRAC * Math.max(w, h), 1)
}

/** Size of the low-resolution grid a w x h box is pixelated to, as in cenpai/censor.py. */
export function pixelGrid(w: number, h: number): { cols: number; rows: number } {
  const block = Math.max(Math.floor(Math.min(w, h) / PIXEL_BLOCKS), 1)
  return { cols: Math.max(Math.floor(w / block), 1), rows: Math.max(Math.floor(h / block), 1) }
}

/** Feature check: canvas filters exist in Chrome and Firefox; fall back where they do not. */
export function supportsCanvasFilter(ctx: CanvasRenderingContext2D): boolean {
  return typeof ctx.filter === 'string'
}

/**
 * Paint one censored box. `src` is the uncensored frame (same size as the canvas); `scratch`
 * is a reusable canvas for the low-resolution copy. The box is always filled black first, so
 * any part of a blur that fades to transparent (near the frame edge) shows black, never the plate.
 */
export function paintCensor(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  r: Box,
  mode: CensorMode,
  scratch: HTMLCanvasElement,
  frameW: number,
  frameH: number,
) {
  const w = r.x2 - r.x1
  const h = r.y2 - r.y1
  if (w <= 0 || h <= 0) return
  ctx.fillStyle = '#000'
  ctx.fillRect(r.x1, r.y1, w, h)
  if (mode === 'solid') return

  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x1, r.y1, w, h)
  ctx.clip()
  if (mode === 'blur' && supportsCanvasFilter(ctx)) {
    // Draw the box's surroundings through a Gaussian blur, clipped to the box.
    const sigma = blurSigma(w, h)
    const m = Math.ceil(3 * sigma)
    const sx = Math.max(0, r.x1 - m)
    const sy = Math.max(0, r.y1 - m)
    const sw = Math.min(frameW, r.x2 + m) - sx
    const sh = Math.min(frameH, r.y2 + m) - sy
    ctx.filter = `blur(${sigma.toFixed(1)}px)`
    ctx.drawImage(src, sx, sy, sw, sh, sx, sy, sw, sh)
  } else {
    // Pixelate (or blur without canvas filters): shrink the box, then stretch it back.
    const g = mode === 'pixelate' ? pixelGrid(w, h) : { cols: 2, rows: 2 }
    scratch.width = g.cols
    scratch.height = g.rows
    const sc = scratch.getContext('2d')!
    sc.imageSmoothingEnabled = true
    sc.imageSmoothingQuality = 'high'
    sc.drawImage(src, r.x1, r.y1, w, h, 0, 0, g.cols, g.rows)
    ctx.imageSmoothingEnabled = mode !== 'pixelate'
    ctx.drawImage(scratch, 0, 0, g.cols, g.rows, r.x1, r.y1, w, h)
  }
  ctx.restore()
}
