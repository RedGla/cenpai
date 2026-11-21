import { describe, expect, it } from 'vitest'
import golden from '../../tests/fixtures/golden.json'
import { letterboxParams, letterboxToTensor, resizeLinearRGBA, roundHalfEven } from './letterbox'
import { postprocess } from './postprocess'

describe('golden: TypeScript port equals cenpai/detector.py', () => {
  it('letterbox geometry matches', () => {
    for (const c of golden.letterbox) {
      const p = letterboxParams(c.w, c.h, c.size)
      expect(p.scale).toBeCloseTo(c.scale, 12)
      expect([p.padX, p.padY]).toEqual(c.pad)
      // the Python canvas is always size x size
      expect(c.canvas_shape).toEqual([c.size, c.size, 3])
    }
  })

  it('rounds halves to even like Python', () => {
    expect([0.5, 1.5, 2.5, 3.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, 4, 2, 3])
  })

  it('postprocess returns the same boxes and scores', () => {
    expect(golden.postprocess.length).toBeGreaterThan(0)
    let total = 0
    for (const c of golden.postprocess) {
      const got = postprocess(
        c.raw,
        c.n,
        { scale: c.scale, padX: c.pad[0], padY: c.pad[1] },
        c.w,
        c.h,
        c.conf,
        c.iou,
      )
      expect(got.length).toBe(c.detections.length)
      got.forEach((d, i) => {
        const [x1, y1, x2, y2, s] = c.detections[i]
        expect([d.x1, d.y1, d.x2, d.y2]).toEqual([x1, y1, x2, y2])
        expect(Math.abs(d.score - s)).toBeLessThan(0.00001)
      })
      total += got.length
    }
    expect(total).toBeGreaterThan(50)
  })

  const rgbToRgba = (rgb: number[]) => {
    const n = rgb.length / 3
    const out = new Uint8ClampedArray(n * 4)
    for (let i = 0; i < n; i++) {
      out[4 * i] = rgb[3 * i]
      out[4 * i + 1] = rgb[3 * i + 1]
      out[4 * i + 2] = rgb[3 * i + 2]
      out[4 * i + 3] = 255
    }
    return out
  }

  it('resizes like cv2.resize INTER_LINEAR (within one level)', () => {
    for (const c of golden.resize) {
      const got = resizeLinearRGBA(rgbToRgba(c.src_rgb), c.w, c.h, c.dw, c.dh)
      expect(got.length).toBe(c.dst_rgb.length)
      let worst = 0
      got.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - c.dst_rgb[i]))))
      expect(worst).toBeLessThanOrEqual(1)
    }
  })

  it('builds the same letterboxed input as Python (within one level)', () => {
    for (const c of golden.letterbox_pixels) {
      const { tensor } = letterboxToTensor(rgbToRgba(c.src_rgb), c.w, c.h, c.size)
      const plane = c.size * c.size
      let worst = 0
      for (let i = 0; i < plane; i++) {
        for (let ch = 0; ch < 3; ch++) {
          const v = Math.round(tensor[ch * plane + i] * 255)
          worst = Math.max(worst, Math.abs(v - c.canvas_rgb[3 * i + ch]))
        }
      }
      expect(worst).toBeLessThanOrEqual(1)
    }
  })
})
