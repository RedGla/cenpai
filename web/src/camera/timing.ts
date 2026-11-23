/**
 * Shutter and hold limits that follow the measured detector speed.
 *
 * Fixed limits suit one device only: on the S23+ a detection comes back well inside 300 ms,
 * but on a laptop in Firefox it arrives 290-305 ms after capture, right on a 300 ms limit,
 * so frames alternated between released (clear) and released blurred, and the view flickered.
 * Both limits stay fail-closed: a stalled detector still blurs the view.
 */

/** Floor for both limits (the values used before they adapted). */
export const MIN_LIMIT_MS = 300
/** Never hold a frame longer than this: past it, a blurred view beats a stale one. */
export const MAX_HOLD_LIMIT_MS = 900

/** Exponential moving average; the first sample seeds it. */
export function ema(prev: number, sample: number, weight = 0.2): number {
  return prev ? (1 - weight) * prev + weight * sample : sample
}

/**
 * How long a held frame may wait for a detection before it is released blurred.
 * The detector takes one frame at a time, so a frame captured while it is busy waits for the
 * current result and then for a later frame's result: up to one result interval plus one
 * capture-to-result latency, plus a display tick and jitter. The limit is 1.5 times that,
 * between 300 and 900 ms.
 */
export function holdLimitFor(latencyMs: number, intervalMs = 0): number {
  return Math.min(
    MAX_HOLD_LIMIT_MS,
    Math.max(MIN_LIMIT_MS, 1.5 * (latencyMs + intervalMs)),
  )
}

/**
 * How many released frames may queue for display before older ones are skipped. One
 * detection releases about one result interval of frames at once; showing them one per frame
 * tick keeps motion smooth, where a cap of 2 dropped the rest and the view stuttered (about
 * 5 frames a second with a 300 ms detector). The age limit still bounds the delay.
 */
export function releasableFor(
  intervalMs: number,
  frameMs: number,
  maxHeld: number,
): number {
  if (!(frameMs > 0)) return 2
  return Math.min(maxHeld, Math.max(2, Math.ceil(intervalMs / frameMs) + 1))
}

/**
 * How long without any result before the whole view blurs: the smoothed interval between
 * results plus four times its smoothed spread, and at least 1.5 intervals and 300 ms.
 */
export function shutterTimeoutFor(intervalMs: number, spreadMs: number): number {
  return Math.max(MIN_LIMIT_MS, 1.5 * intervalMs, intervalMs + 4 * spreadMs)
}
