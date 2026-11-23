import { describe, expect, it } from 'vitest'
import { ema, holdLimitFor, releasableFor, shutterTimeoutFor } from './timing'

describe('ema', () => {
  it('seeds with the first sample, then smooths', () => {
    expect(ema(0, 200)).toBe(200)
    expect(ema(200, 300)).toBeCloseTo(220)
  })
})

describe('holdLimitFor', () => {
  it('keeps 300 ms for a fast detector', () => {
    expect(holdLimitFor(0)).toBe(300)
    expect(holdLimitFor(70, 70)).toBe(300)
    expect(holdLimitFor(100, 90)).toBe(300)
  })

  it('covers a busy detector: one interval plus one latency', () => {
    // Laptop in Firefox on 2026-11-22: about 217 ms per inference, frames 290-305 ms behind.
    expect(holdLimitFor(250, 220)).toBeCloseTo(705)
  })

  it('stops at 900 ms so a very slow detector still blurs instead of lagging', () => {
    expect(holdLimitFor(2000, 2000)).toBe(900)
  })
})

describe('releasableFor', () => {
  it('keeps the old 2 when results come every frame or so', () => {
    expect(releasableFor(50, 50, 15)).toBe(2)
    expect(releasableFor(0, 0, 15)).toBe(2)
  })

  it('lets a slow detector release a whole interval of frames', () => {
    // 380 ms between results at 20 fps: 8 frames released at once, all shown in turn.
    expect(releasableFor(380, 50, 15)).toBe(9)
  })

  it('never exceeds the held-frame cap', () => {
    expect(releasableFor(2000, 50, 15)).toBe(15)
  })
})

describe('shutterTimeoutFor', () => {
  it('keeps the old floor and 1.5 intervals', () => {
    expect(shutterTimeoutFor(0, 0)).toBe(300)
    expect(shutterTimeoutFor(400, 0)).toBe(600)
  })

  it('adds room for jittery result intervals', () => {
    expect(shutterTimeoutFor(220, 60)).toBe(460)
  })
})
