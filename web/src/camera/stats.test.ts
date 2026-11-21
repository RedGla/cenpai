import { describe, expect, it } from 'vitest'
import { median, percentile } from './stats'

describe('median', () => {
  it('handles odd, even and unsorted input', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
  it('is NaN for no data', () => {
    expect(median([])).toBeNaN()
  })
})

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const v = Array.from({ length: 50 }, (_, i) => i + 1)
    expect(percentile(v, 95)).toBe(48) // ceil(0.95 * 50) = 48th value
    expect(percentile(v, 100)).toBe(50)
    expect(percentile(v, 50)).toBe(25)
  })
  it('does not modify its input', () => {
    const v = [3, 1, 2]
    percentile(v, 95)
    expect(v).toEqual([3, 1, 2])
  })
})
