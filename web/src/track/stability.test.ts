import { describe, expect, it } from 'vitest'
import { StabilityMonitor } from './stability'
import type { Track } from './tracker'

const track = (id: number, x: number, lastSeen: number, missed = 0): Track => ({
  id,
  box: { x1: x, y1: 100, x2: x + 100, y2: 140 },
  vx: 0,
  vy: 0,
  lastSeen,
  score: 0.5,
  confirmed: false,
  missed,
})

describe('StabilityMonitor', () => {
  it('counts a drop when a drawn mask stops being drawn, and a re-acquisition on a new overlapping track', () => {
    const m = new StabilityMonitor(0)
    const a = track(1, 100, 0)
    m.frame(0, [a], [{ track: a, rect: a.box }])
    m.frame(33, [a], [{ track: a, rect: a.box }])
    m.frame(66, [], [])
    expect(m.summary().drops).toBe(1)
    const b = track(2, 105, 100)
    m.frame(100, [b], [{ track: b, rect: b.box }])
    expect(m.summary().reacquisitions).toBe(1)
    expect(m.summary().meanScoreBeforeDrop).toBeCloseTo(0.5)
  })

  it('does not count a re-acquisition after more than a second or on a far box', () => {
    const m = new StabilityMonitor(0)
    const a = track(1, 100, 0)
    m.frame(0, [a], [{ track: a, rect: a.box }])
    m.frame(33, [], [])
    const far = track(2, 600, 50)
    m.frame(50, [far], [{ track: far, rect: far.box }])
    const late = track(3, 100, 1200)
    m.frame(
      1200,
      [far, late],
      [
        { track: far, rect: far.box },
        { track: late, rect: late.box },
      ],
    )
    expect(m.summary().reacquisitions).toBe(0)
  })

  it('reports the mean frame-to-frame area change and frames unseen', () => {
    const m = new StabilityMonitor(0)
    const a = track(1, 100, 0)
    m.frame(0, [a], [{ track: a, rect: { x1: 0, y1: 0, x2: 10, y2: 10 } }])
    const rows = m.frame(33, [a], [{ track: a, rect: { x1: 0, y1: 0, x2: 10, y2: 12 } }])
    expect(m.summary().meanAreaChange).toBeCloseTo(0.2)
    expect(rows[0].framesUnseen).toBe(1)
    expect(rows[0].drawn).toBe(true)
  })

  it('resets to zero', () => {
    const m = new StabilityMonitor(0)
    const a = track(1, 100, 0)
    m.frame(0, [a], [{ track: a, rect: a.box }])
    m.frame(33, [], [])
    m.reset(100)
    expect(m.summary().drops).toBe(0)
    expect(m.summary().frames).toBe(0)
  })
})
