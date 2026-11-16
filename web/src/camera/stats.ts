/** Median of a list of numbers (mean of the two middle values for an even count). */
export function median(values: readonly number[]): number {
  if (!values.length) return NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Nearest-rank percentile, p in (0, 100]. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return NaN
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
}
