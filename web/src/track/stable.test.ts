import { describe, expect, it } from 'vitest'
import {
  BASE_PAD_RATIO,
  LONG_HOLD_MS,
  MIN_PAD_PX,
  SHRINK_PER_S,
  TRACK_TTL_MS,
  activeTracks,
  emptyTracker,
  keepConfFor,
  maskRect,
  updateTracker,
  type Box,
  type TrackerState,
} from './tracker'

const W = 1280
const H = 720
const CONF = 0.8
const OPTS = { startConf: 0.1, keepConf: keepConfFor(0.1) }
const det = (b: Box, score = 0.6) => ({ ...b, score })
const area = (b: Box) => (b.x2 - b.x1) * (b.y2 - b.y1)
const update = (s: TrackerState, dets: ReturnType<typeof det>[], t: number) =>
  updateTracker(s, dets, t, CONF, TRACK_TTL_MS, OPTS)

/** Deterministic pseudo-random numbers in [-1, 1). */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return (s / 4294967296) * 2 - 1
  }
}

/** Raw box plus the base padding, clipped to the frame. */
function padded(b: Box): Box {
  const pad = Math.max(BASE_PAD_RATIO * Math.max(b.x2 - b.x1, b.y2 - b.y1), MIN_PAD_PX)
  return {
    x1: Math.max(0, Math.floor(b.x1 - pad)),
    y1: Math.max(0, Math.floor(b.y1 - pad)),
    x2: Math.min(W, Math.ceil(b.x2 + pad)),
    y2: Math.min(H, Math.ceil(b.y2 + pad)),
  }
}
const contains = (outer: Box, inner: Box) =>
  outer.x1 <= inner.x1 &&
  outer.y1 <= inner.y1 &&
  outer.x2 >= inner.x2 &&
  outer.y2 >= inner.y2

const DETECT_MS = 140
const FRAME = 1000 / 30
const PLATE = { x1: 500, y1: 300, x2: 640, y2: 350 }

describe('alternating hit and miss', () => {
  it('keeps an unbroken mask when every other detection misses the plate', () => {
    let s: TrackerState = emptyTracker()
    let nextDetect = 0
    let round = 0
    for (let t = 0; t < 5000; t += FRAME) {
      if (t >= nextDetect) {
        s = update(s, round % 2 === 0 ? [det(PLATE)] : [], t)
        round++
        nextDetect += DETECT_MS
      }
      const live = activeTracks(s, t)
      expect(live).toHaveLength(1)
      expect(contains(maskRect(live[0], t, W, H), padded(PLATE))).toBe(true)
    }
  })

  it('keeps one track through low-confidence detections that overlap it (hysteresis)', () => {
    let s = update(emptyTracker(), [det(PLATE)], 0)
    for (let i = 1; i < 10; i++) s = update(s, [det(PLATE, 0.06)], i * 300)
    expect(s.tracks.map((t) => t.id)).toEqual([1])
    expect(activeTracks(s, 9 * 300)).toHaveLength(1)
  })

  it('does not start a track from a low-confidence detection on its own', () => {
    const s = update(emptyTracker(), [det({ x1: 0, y1: 0, x2: 50, y2: 20 }, 0.06)], 0)
    expect(s.tracks).toHaveLength(0)
  })
})

/** Mean relative frame-to-frame change in drawn mask area over a jittery still plate. */
function jitterRun(seed: number): number {
  const r = rng(seed)
  let s: TrackerState = emptyTracker()
  let prev = 0
  let sum = 0
  let n = 0
  let nextDetect = 0
  let latest = PLATE
  for (let t = 0; t < 6000; t += FRAME) {
    if (t >= nextDetect) {
      const j = () => r() * 7 // about 5% of the 140 px side
      latest = {
        x1: PLATE.x1 + j(),
        y1: PLATE.y1 + j(),
        x2: PLATE.x2 + j(),
        y2: PLATE.y2 + j(),
      }
      s = update(s, [det(latest)], t)
      nextDetect += DETECT_MS
    }
    const live = activeTracks(s, t)
    expect(live).toHaveLength(1)
    const m = maskRect(live[0], t, W, H)
    expect(contains(m, padded(latest))).toBe(true)
    const a = area(m)
    if (prev > 0 && t > 1000) {
      sum += Math.abs(a - prev) / prev
      n++
    }
    prev = a
  }
  return sum / n
}

describe('jittery boxes', () => {
  it('gives a bounded frame-to-frame change in the drawn mask', () => {
    for (const seed of [1, 2, 3]) expect(jitterRun(seed)).toBeLessThan(0.04)
  })
})

describe('the drawn mask never lags or shrinks below the plate', () => {
  it('always contains the latest raw box plus padding on a moving, jittery plate', () => {
    const r = rng(7)
    let s: TrackerState = emptyTracker()
    let nextDetect = 0
    let latest: Box = PLATE
    for (let t = 0; t < 4000; t += FRAME) {
      // The plate sweeps right at 0.3 px/ms, then back, with jitter.
      const x = 200 + 0.3 * (t < 2000 ? t : 4000 - t)
      if (t >= nextDetect) {
        const j = () => r() * 6
        latest = { x1: x + j(), y1: 300 + j(), x2: x + 140 + j(), y2: 350 + j() }
        s = update(s, [det(latest)], t)
        nextDetect += DETECT_MS
      }
      const live = activeTracks(s, t)
      expect(live).toHaveLength(1)
      expect(contains(maskRect(live[0], t, W, H), padded(latest))).toBe(true)
    }
  })
})

describe('size changes', () => {
  it('grows at once and shrinks no faster than the limit', () => {
    let s = update(emptyTracker(), [det({ x1: 500, y1: 300, x2: 700, y2: 380 })], 0)
    s = update(s, [det({ x1: 560, y1: 320, x2: 640, y2: 350 })], 100)
    const t = s.tracks[0]
    expect(t.smooth.x2 - t.smooth.x1).toBeGreaterThanOrEqual(
      200 * (1 - SHRINK_PER_S * 0.1) - 1e-6,
    )
    s = update(s, [det({ x1: 400, y1: 300, x2: 800, y2: 400 })], 200)
    const g = s.tracks[0]
    expect(g.smooth.x2 - g.smooth.x1).toBeGreaterThanOrEqual(400)
  })

  it('relaxes the padding after a re-detection instead of snapping back', () => {
    let s = update(emptyTracker(), [det(PLATE)], 0)
    const before = maskRect(s.tracks[0], 300, W, H)
    s = update(s, [det(PLATE)], 300)
    const after = maskRect(s.tracks[0], 300 + FRAME, W, H)
    // Snapping back would drop the grown padding (36% of the side on each edge) at once.
    expect(after.x2 - after.x1).toBeGreaterThan(0.9 * (before.x2 - before.x1))
  })
})

describe('one mask per plate', () => {
  it('merges overlapping tracks into the older one', () => {
    let s = update(emptyTracker(), [det(PLATE)], 0)
    s = update(
      s,
      [
        det({ x1: 502, y1: 300, x2: 642, y2: 350 }),
        det({ x1: 505, y1: 302, x2: 645, y2: 352 }),
      ],
      140,
    )
    expect(s.tracks.map((t) => t.id)).toEqual([1])
    expect(s.tracks[0].hits).toBe(3)
  })

  it('merges a track whose box lies inside another one', () => {
    let s = update(emptyTracker(), [det({ x1: 400, y1: 300, x2: 800, y2: 600 })], 0)
    s = update(
      s,
      [
        det({ x1: 402, y1: 300, x2: 802, y2: 600 }),
        det({ x1: 500, y1: 350, x2: 640, y2: 420 }),
      ],
      140,
    )
    expect(s.tracks.map((t) => t.id)).toEqual([1])
  })

  it('keeps separate plates apart', () => {
    const s = update(
      emptyTracker(),
      [
        det({ x1: 100, y1: 300, x2: 240, y2: 350 }),
        det({ x1: 600, y1: 300, x2: 740, y2: 350 }),
      ],
      0,
    )
    expect(s.tracks).toHaveLength(2)
  })
})

describe('hold by evidence', () => {
  it('ends a once-seen track after the normal keep time', () => {
    const s = update(emptyTracker(), [det(PLATE)], 0)
    expect(activeTracks(s, TRACK_TTL_MS)).toHaveLength(1)
    expect(activeTracks(s, TRACK_TTL_MS + 1)).toHaveLength(0)
    expect(update(s, [], TRACK_TTL_MS + 1).tracks).toHaveLength(0)
  })

  it('holds a track seen several times longer, growing its padding, then ends it', () => {
    let s = emptyTracker()
    for (let i = 0; i < 3; i++) s = update(s, [det(PLATE)], i * DETECT_MS)
    const last = 2 * DETECT_MS
    expect(activeTracks(s, last + 800)).toHaveLength(1)
    const w1 = maskRect(s.tracks[0], last + 500, W, H)
    const w2 = maskRect(s.tracks[0], last + 900, W, H)
    expect(w2.x2 - w2.x1).toBeGreaterThan(w1.x2 - w1.x1)
    expect(activeTracks(s, last + LONG_HOLD_MS + 1)).toHaveLength(0)
    expect(update(s, [], last + LONG_HOLD_MS + 1).tracks).toHaveLength(0)
  })
})
