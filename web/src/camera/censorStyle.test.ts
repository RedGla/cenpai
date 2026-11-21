import { describe, expect, it } from 'vitest'
import { blurSigma, parseCensorMode, pixelGrid } from './censorStyle'

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
