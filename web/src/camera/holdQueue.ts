/**
 * Detect-before-release (phase 2, step 10). Camera frames are held until the detector has
 * produced a result for that frame or a later one, so a plate is never shown before the
 * detector has had a chance to find it.
 *
 * Pure logic: the caller owns the frames (pooled canvases) and gets them back to recycle.
 */

export interface Held<T> {
  seq: number
  /** Capture time (ms). Masks for this frame are computed at this time. */
  t: number
  item: T
}

export interface Release<T> {
  /** Frame to draw this tick, or null to keep showing the previous one. */
  show: Held<T> | null
  /** Draw `show` blurred: it left the queue without a detection (queue overflow). */
  blurred: boolean
  /** Frames dropped this tick; the caller recycles them (and `show`, after drawing it). */
  recycle: Held<T>[]
}

/**
 * Release frames blurred once the oldest held frame is this old (ms) without a detection.
 * Time-based rather than the brief's 6 frames: a 30 fps webcam reaches 6 frames at 200 ms,
 * which is about one detection on the laptop, so a frame cap kept the shutter closed.
 * At 20 fps 300 ms is the same 6 frames as before.
 */
export const MAX_HOLD_MS = 300
/** Hard cap on held frames (memory guard), whatever their age. */
export const MAX_HELD = 15
/** Released frames waiting to be shown are capped here; older ones are skipped to cut delay. */
export const MAX_RELEASABLE = 2

export class HoldQueue<T> {
  private queue: Held<T>[] = []
  private nextSeq = 0
  /** Newest frame the detector has a result for (-1 = none yet). */
  private detected = -1

  constructor(
    private maxHeld = MAX_HELD,
    private maxReleasable = MAX_RELEASABLE,
    private maxHoldMs = MAX_HOLD_MS,
  ) {}

  get length(): number {
    return this.queue.length
  }

  get detectedSeq(): number {
    return this.detected
  }

  push(item: T, t: number): Held<T> {
    const h = { seq: this.nextSeq++, t, item }
    this.queue.push(h)
    return h
  }

  /** A detection result exists for frame `seq`; it and every earlier frame may be released. */
  markDetected(seq: number) {
    if (seq > this.detected) this.detected = seq
  }

  /** Forget detections (new model): held frames wait for the new detector. */
  resetDetections() {
    this.detected = -1
  }

  /** Called once per display tick; `now` (ms) enables the age limit. */
  take(now?: number): Release<T> {
    const recycle: Held<T>[] = []
    // Releasable frames: detection exists for them or a later frame. Skip all but the newest
    // few so the delay does not build up.
    let releasable = 0
    while (releasable < this.queue.length && this.queue[releasable].seq <= this.detected) releasable++
    while (releasable > this.maxReleasable) {
      recycle.push(this.queue.shift()!)
      releasable--
    }
    if (releasable > 0) {
      return { show: this.queue.shift()!, blurred: false, recycle }
    }
    // Nothing detected yet for the oldest frame. If it has waited too long (or too many are
    // held), let it go, blurred, so the view never freezes for long.
    const tooOld = (h: Held<T>) => now !== undefined && now - h.t > this.maxHoldMs
    if (this.queue.length > this.maxHeld || (this.queue.length > 0 && tooOld(this.queue[0]))) {
      while (this.queue.length > this.maxHeld + 1) recycle.push(this.queue.shift()!)
      while (this.queue.length > 1 && tooOld(this.queue[1])) recycle.push(this.queue.shift()!)
      return { show: this.queue.shift()!, blurred: true, recycle }
    }
    return { show: null, blurred: false, recycle }
  }

  /** Empty the queue (stop); returns every held frame for recycling. */
  drain(): Held<T>[] {
    const all = this.queue
    this.queue = []
    return all
  }
}
