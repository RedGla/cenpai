import { describe, expect, it } from 'vitest'
import golden from '../../tests/fixtures/golden.json'
import { letterboxParams, roundHalfEven } from './letterbox'
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
})
