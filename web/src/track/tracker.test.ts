import { describe, expect, it } from 'vitest'
import {
  TRACK_TTL_MS,
  activeTracks,
  countPlates,
  emptyTracker,
  iou,
  keepTimeFor,
  maskRect,
  predictBox,
  updateTracker,
} from './tracker'

const det = (x1: number, y1: number, x2: number, y2: number, score = 0.9) => ({
  x1,
  y1,
  x2,
  y2,
  score,
})

describe('iou', () => {
  it('is 1 for equal boxes, 0 for disjoint, and the right ratio for partial overlap', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 }
    expect(iou(a, a)).toBe(1)
    expect(iou(a, { x1: 20, y1: 20, x2: 30, y2: 30 })).toBe(0)
    expect(iou(a, { x1: 5, y1: 0, x2: 15, y2: 10 })).toBeCloseTo(50 / 150)
  })
})

describe('matching', () => {
  it('keeps the same id for an overlapping detection and starts a new id otherwise', () => {
    let s = updateTracker(emptyTracker(), [det(100, 100, 200, 140)], 0, 0.8)
    s = updateTracker(s, [det(104, 100, 204, 140), det(500, 500, 560, 520)], 33, 0.8)
    expect(s.tracks.map((t) => t.id).sort()).toEqual([1, 2])
    const t1 = s.tracks.find((t) => t.id === 1)!
    expect(t1.box.x1).toBe(104)
    expect(t1.missed).toBe(0)
  })

  it('pairs each detection with one track, best overlap first', () => {
    let s = updateTracker(emptyTracker(), [det(0, 0, 100, 40), det(60, 0, 160, 40)], 0, 0.8)
    s = updateTracker(s, [det(58, 0, 158, 40)], 33, 0.8)
    const matched = s.tracks.filter((t) => t.missed === 0)
    expect(matched).toHaveLength(1)
    expect(matched[0].id).toBe(2)
  })
})

describe('motion', () => {
  it('estimates velocity and moves the predicted box along it', () => {
    let s = updateTracker(emptyTracker(), [det(100, 100, 200, 140)], 0, 0.8)
    s = updateTracker(s, [det(110, 100, 210, 140)], 100, 0.8)
    const t = s.tracks[0]
    expect(t.vx).toBeCloseTo(0.05) // blended: half of the 0.1 px/ms measurement
    const p = predictBox(t, 200)
    expect(p.x1).toBeCloseTo(110 + 0.05 * 100)
    expect(p.y1).toBe(100)
  })

  it('does not extrapolate past the keep time', () => {
    let s = updateTracker(emptyTracker(), [det(100, 100, 200, 140)], 0, 0.8)
    s = updateTracker(s, [det(120, 100, 220, 140)], 100, 0.8)
    const t = s.tracks[0]
    expect(predictBox(t, 100 + 5000).x1).toBeCloseTo(predictBox(t, 100 + TRACK_TTL_MS).x1)
  })
})

describe('keep time', () => {
  it('keeps an unseen box for 400 ms and then drops it', () => {
    let s = updateTracker(emptyTracker(), [det(100, 100, 200, 140)], 0, 0.8)
    s = updateTracker(s, [], 300, 0.8)
    expect(s.tracks).toHaveLength(1)
    expect(s.tracks[0].missed).toBe(1)
    expect(activeTracks(s, 400)).toHaveLength(1)
    expect(activeTracks(s, 401)).toHaveLength(0)
    expect(updateTracker(s, [], 401, 0.8).tracks).toHaveLength(0)
  })
})

describe('padding', () => {
  const frame = { w: 1280, h: 720 }

  it('uses 10% of the longer side', () => {
    const s = updateTracker(emptyTracker(), [det(500, 300, 600, 340)], 0, 0.8)
    const r = maskRect(s.tracks[0], 0, frame.w, frame.h)
    expect(r).toEqual({ x1: 490, y1: 290, x2: 610, y2: 350 })
  })

  it('never uses less than 4 px', () => {
    const s = updateTracker(emptyTracker(), [det(500, 300, 520, 310)], 0, 0.8)
    const r = maskRect(s.tracks[0], 0, frame.w, frame.h)
    expect(r).toEqual({ x1: 496, y1: 296, x2: 524, y2: 314 })
  })

  it('grows each frame after the detected frame, while the detector has not seen it', () => {
    let s = updateTracker(emptyTracker(), [det(500, 300, 600, 340)], 0, 0.8)
    const onFrame = maskRect(s.tracks[0], 0, frame.w, frame.h)
    expect(onFrame.x2 - onFrame.x1).toBe(120)
    const later = maskRect(s.tracks[0], 100, frame.w, frame.h)
    expect(later.x2 - later.x1).toBeGreaterThan(120)
    s = updateTracker(s, [], 33, 0.8)
    const w1 = maskRect(s.tracks[0], 66, frame.w, frame.h)
    const w2 = maskRect(s.tracks[0], 133, frame.w, frame.h)
    const w3 = maskRect(s.tracks[0], 300, frame.w, frame.h)
    expect(w1.x2 - w1.x1).toBeGreaterThan(120)
    expect(w2.x2 - w2.x1).toBeGreaterThan(w1.x2 - w1.x1)
    expect(w3.x2 - w3.x1).toBeGreaterThan(w2.x2 - w2.x1)
  })

  it('stays inside the frame', () => {
    const s = updateTracker(emptyTracker(), [det(0, 0, 50, 20)], 0, 0.8)
    const r = maskRect(s.tracks[0], 0, frame.w, frame.h)
    expect(r.x1).toBe(0)
    expect(r.y1).toBe(0)
  })
})

describe('counting', () => {
  it('counts only plates that reached conf, but keeps masking the others', () => {
    const s = updateTracker(
      emptyTracker(),
      [det(100, 100, 200, 140, 0.9), det(400, 100, 500, 140, 0.4)],
      0,
      0.8,
    )
    expect(countPlates(s, 0)).toBe(1)
    expect(activeTracks(s, 0)).toHaveLength(2)
  })

  it('a low-score track becomes counted once a later detection reaches conf', () => {
    let s = updateTracker(emptyTracker(), [det(100, 100, 200, 140, 0.4)], 0, 0.8)
    s = updateTracker(s, [det(102, 100, 202, 140, 0.85)], 33, 0.8)
    expect(countPlates(s, 33)).toBe(1)
  })

  it('stops counting after the keep time', () => {
    const s = updateTracker(emptyTracker(), [det(100, 100, 200, 140, 0.9)], 0, 0.8)
    expect(countPlates(s, 500)).toBe(0)
  })
})

describe('slow detectors', () => {
  it('keeps at least 400 ms, and 2.5 result intervals when results are slow', () => {
    expect(keepTimeFor(30)).toBe(TRACK_TTL_MS)
    expect(keepTimeFor(400)).toBe(1000)
  })

  it('a longer keep time keeps the box through a missed result', () => {
    const s = updateTracker(emptyTracker(), [det(100, 100, 200, 140)], 0, 0.8)
    expect(activeTracks(s, 800)).toHaveLength(0)
    expect(activeTracks(s, 800, keepTimeFor(400))).toHaveLength(1)
    expect(updateTracker(s, [], 800, 0.8, keepTimeFor(400)).tracks).toHaveLength(1)
  })
})

describe('mask follows motion safely', () => {
  it('covers both the last box and the predicted box', () => {
    let s = updateTracker(emptyTracker(), [det(100, 100, 200, 140)], 0, 0.8)
    s = updateTracker(s, [det(140, 100, 240, 140)], 100, 0.8)
    const t = s.tracks[0]
    const r = maskRect(t, 300, 1280, 720)
    expect(r.x1).toBeLessThanOrEqual(140 - 10)
    expect(r.x2).toBeGreaterThanOrEqual(Math.ceil(predictBox(t, 300).x2) + 10)
  })
})

describe('held frames before the detection', () => {
  it('masks a frame captured shortly before the detection that released it', () => {
    let s = updateTracker(emptyTracker(), [det(500, 300, 600, 340)], 0, 0.8)
    s = updateTracker(s, [det(520, 300, 620, 340)], 100, 0.8) // moving right
    const t = s.tracks[0]
    // A frame from 66 ms before the latest detection: the plate was further left.
    const r = maskRect(t, 34, 1280, 720)
    expect(r.x1).toBeLessThanOrEqual(Math.floor(predictBox(t, 34).x1))
    expect(r.x2).toBeGreaterThanOrEqual(620)
    expect(activeTracks(s, 34)).toHaveLength(1)
  })

  it('pads a frame before the detection more than the detected frame itself', () => {
    const s = updateTracker(emptyTracker(), [det(500, 300, 600, 340)], 100, 0.8)
    const on = maskRect(s.tracks[0], 100, 1280, 720)
    const before = maskRect(s.tracks[0], 34, 1280, 720)
    expect(before.x2 - before.x1).toBeGreaterThan(on.x2 - on.x1)
  })
})
