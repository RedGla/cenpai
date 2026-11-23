import { describe, expect, it } from 'vitest'
import {
  blurSigma,
  parseCensorMode,
  pixelBlock,
  pixelGrid,
  snapToBlocks,
  steadyBlurSigma,
} from './censorStyle'

describe('censor styles (same parameters as cenpai/censor.py)', () => {
  it('defaults to the solid mask for anything unknown', () => {
    expect(parseCensorMode(null)).toBe('solid')
    expect(parseCensorMode('gaussian')).toBe('solid')
    expect(parseCensorMode('blur')).toBe('blur')
    expect(parseCensorMode('pixelate')).toBe('pixelate')
  })

  it('blurs with sigma = half the longest side, at least 1', () => {
    expect(blurSigma(120, 60)).toBe(60)
    expect(blurSigma(1, 1)).toBe(1)
  })

  it('pixelates to about 6 blocks along the short side', () => {
    expect(pixelGrid(120, 60)).toEqual({ cols: 12, rows: 6 })
    expect(pixelGrid(100, 40)).toEqual({ cols: 16, rows: 6 })
    expect(pixelGrid(3, 2)).toEqual({ cols: 3, rows: 2 })
  })
})

describe('steady censor styles (phase 4b step 8)', () => {
  it('keeps the blur strength fixed within a size range and never below the per-box value', () => {
    expect(steadyBlurSigma(100, 40)).toBe(steadyBlurSigma(120, 40))
    expect(steadyBlurSigma(100, 40)).toBe(64)
    for (const w of [20, 50, 100, 130, 300])
      expect(steadyBlurSigma(w, 10)).toBeGreaterThanOrEqual(blurSigma(w, 10))
  })

  it('keeps the block size fixed within a size range', () => {
    expect(pixelBlock(140, 40)).toBe(pixelBlock(150, 47))
    expect(pixelBlock(140, 40)).toBe(8)
  })

  it('snaps the box outward to a frame-anchored block grid, so moving boxes keep their blocks', () => {
    const a = snapToBlocks({ x1: 13, y1: 5, x2: 99, y2: 41 }, 8, 1280, 720)
    expect(a).toEqual({ x1: 8, y1: 0, x2: 104, y2: 48 })
    const b = snapToBlocks({ x1: 15, y1: 6, x2: 101, y2: 42 }, 8, 1280, 720)
    expect(b.x1 % 8).toBe(0)
    expect(b.x1).toBe(a.x1)
    expect(snapToBlocks({ x1: 1270, y1: 0, x2: 1279, y2: 9 }, 8, 1280, 720).x2).toBe(1280)
  })
})
