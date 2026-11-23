import type { Detection } from '../detect/types'

export interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Track {
  id: number
  /** Box in the last detection that matched this track (source pixels). */
  box: Box
  /** Centre velocity in pixels per millisecond. */
  vx: number
  vy: number
  /** Capture time (ms) of the last frame this track was matched on. */
  lastSeen: number
  score: number
  /** True once any matched detection reached the counting threshold `conf`. */
  confirmed: boolean
  /** Detection rounds in a row that did not match this track. */
  missed: number
  /** Detections matched to this track, the first one included. */
  hits: number
  /** Capture time (ms) of the track's first detection. */
  born: number
  /**
   * Smoothed box at `lastSeen`: centre filtered (One Euro style), size grows at once and
   * shrinks at most SHRINK_PER_S. Drawn together with `box`, never instead of it.
   */
  smooth: Box
  /**
   * Growth padding (share of the longer side) the mask had when the track was last
   * re-detected. It relaxes toward zero (time constant PAD_RELAX_MS) instead of snapping back.
   */
  padCarry: number
  /** Smoothed time (ms) between this track's detections; 0 until it has been seen twice. */
  gap: number
}

export interface TrackerState {
  tracks: Track[]
  nextId: number
}

/** Settings, not results. Defaults are used when a field is left out. */
export interface TrackerOptions {
  /** A new track starts only at this confidence (mask_conf). Default 0: take every box. */
  startConf?: number
  /**
   * An existing track is kept alive by an overlapping detection (IoU >= HYSTERESIS_IOU) down
   * to this confidence. Default: no lower than startConf allows (see keepConfFor).
   */
  keepConf?: number
  /** How long a track seen in EVIDENCE_HITS or more detections is held unseen. */
  longHoldMs?: number
}

/** A box is kept this long after it was last seen (a track seen only once or twice). */
export const TRACK_TTL_MS = 400
/** Setting: hold time for a track with several detections behind it. */
export const LONG_HOLD_MS = 1000
/** Setting: detections needed before a track earns the long hold. */
export const EVIDENCE_HITS = 3
/** Detections and tracks match when their overlap (IoU) is at least this. */
export const MATCH_IOU = 0.2
/** Below startConf, a detection may only keep an existing track alive at this overlap. */
export const HYSTERESIS_IOU = 0.3
/** Tracks whose boxes overlap at least this much are one plate and are merged. */
export const MERGE_IOU = 0.5
/** Also merged: the smaller box lies at least this share inside the larger one. */
export const MERGE_CONTAIN = 0.7
/** Mask padding as a share of the box's longer side, with a floor in pixels. */
export const BASE_PAD_RATIO = 0.1
export const MIN_PAD_PX = 4
/**
 * Extra padding per frame-time (1/30 s) since the frame the box was detected on, as a share of
 * the longer side. Every frame drawn after that one is unseen by the detector, and on a slow
 * backend that is 4 to 6 frames, so the mask must widen to keep up with a moving phone.
 */
export const GROW_PER_FRAME = 0.04
export const FRAME_MS = 1000 / 30
/**
 * Setting: the growth padding stops at this share of the longer side (10 frame-times of
 * growth, past the 300 ms shutter floor). Without a cap a plate held unseen for the 1 s long
 * hold grew by 1.2x its size on every side, and close plates covered the whole frame.
 */
export const MAX_GROW_SHARE = 0.4
/**
 * Setting: the mask follows the estimated motion for at most this long after the last
 * detection. Past it, a long-held track stays where it was last moved to, instead of sliding
 * across empty background.
 */
export const MAX_SHIFT_MS = TRACK_TTL_MS
/**
 * Setting: after a re-detection the grown padding relaxes back toward the base padding with
 * this time constant (exponential), so it eases down over several frames instead of snapping.
 */
export const PAD_RELAX_MS = 400
/** Setting: the smoothed box may shrink by at most this share of its size per second. */
export const SHRINK_PER_S = 0.5
/** One Euro filter settings for the smoothed centre: cutoff (Hz) at rest, and per side/s. */
export const MIN_CUTOFF_HZ = 1
export const CUTOFF_PER_SPEED = 2
/** Detection-gap smoothing: share of the new measurement. */
const GAP_BLEND = 0.3
/** Velocity smoothing: share of the new measurement. */
const VELOCITY_BLEND = 0.5
/** The keep threshold is never set below this. */
export const MIN_KEEP_CONF = 0.05

export const emptyTracker = (): TrackerState => ({ tracks: [], nextId: 1 })

/** Default keep threshold: half of mask_conf, never below 0.05. */
export function keepConfFor(maskConf: number): number {
  return Math.max(MIN_KEEP_CONF, maskConf / 2)
}

export function iou(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
  return union > 0 ? inter / union : 0
}

/** Intersection over the smaller box's area: 1 when one box lies inside the other. */
export function containment(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
  if (w <= 0 || h <= 0) return 0
  const small = Math.min((a.x2 - a.x1) * (a.y2 - a.y1), (b.x2 - b.x1) * (b.y2 - b.y1))
  return small > 0 ? (w * h) / small : 0
}

export function unionBox(...bs: Box[]): Box {
  return {
    x1: Math.min(...bs.map((b) => b.x1)),
    y1: Math.min(...bs.map((b) => b.y1)),
    x2: Math.max(...bs.map((b) => b.x2)),
    y2: Math.max(...bs.map((b) => b.y2)),
  }
}

const longerSide = (b: Box) => Math.max(b.x2 - b.x1, b.y2 - b.y1)
const shift = (b: Box, dx: number, dy: number): Box => ({
  x1: b.x1 + dx,
  y1: b.y1 + dy,
  x2: b.x2 + dx,
  y2: b.y2 + dy,
})

/** How long this track survives unseen: longer once several detections back it up. */
export function trackLife(t: Track, ttl = TRACK_TTL_MS, longHold = LONG_HOLD_MS): number {
  return t.hits >= EVIDENCE_HITS ? Math.max(ttl, longHold) : ttl
}

/** True when the track is past the normal keep time and alive only on the long hold. */
export function isHolding(t: Track, now: number, ttl = TRACK_TTL_MS): boolean {
  return now - t.lastSeen > ttl
}

/**
 * Where the track's box is expected at time `now`, moved along its estimated velocity.
 * `now` may be earlier than the last detection: a held frame released by a later detection.
 */
export function predictBox(t: Track, now: number, ttl = TRACK_TTL_MS): Box {
  const dt = Math.min(Math.max(now - t.lastSeen, -ttl), ttl)
  return shift(t.box, t.vx * dt, t.vy * dt)
}

/**
 * Growth padding share at `now`: the largest of the growth for the time unseen, the growth
 * for the track's usual gap between detections (so a steadily detected plate gets one steady
 * padding instead of a sawtooth), and the carry relaxing after a re-detection.
 */
function growShare(t: Track, now: number, life: number): number {
  const unseen = Math.min(Math.max(Math.abs(now - t.lastSeen), t.gap), life)
  const grow = (GROW_PER_FRAME * unseen) / FRAME_MS
  const since = Math.max(0, now - t.lastSeen)
  const carry = t.padCarry * Math.exp(-since / PAD_RELAX_MS)
  return Math.min(MAX_GROW_SHARE, Math.max(grow, carry))
}

/** Fold a matched detection into the smoothed box. `dt` ms since the last detection. */
function smoothInto(t: Track, d: Box, dt: number, vx: number, vy: number): Box {
  const dw = d.x2 - d.x1
  const dh = d.y2 - d.y1
  if (dt <= 0) return unionBox(t.smooth, d)
  const prev = shift(t.smooth, t.vx * dt, t.vy * dt)
  const pcx = (prev.x1 + prev.x2) / 2
  const pcy = (prev.y1 + prev.y2) / 2
  const mcx = (d.x1 + d.x2) / 2
  const mcy = (d.y1 + d.y2) / 2
  const speed = (Math.hypot(vx, vy) * 1000) / Math.max(longerSide(d), 1) // sides per second
  const cutoff = MIN_CUTOFF_HZ + CUTOFF_PER_SPEED * speed
  const tau = 1000 / (2 * Math.PI * cutoff)
  const a = 1 / (1 + tau / dt)
  const cx = pcx + a * (mcx - pcx)
  const cy = pcy + a * (mcy - pcy)
  const keep = Math.max(0, 1 - (SHRINK_PER_S * dt) / 1000)
  const pw = prev.x2 - prev.x1
  const ph = prev.y2 - prev.y1
  const w = dw >= pw ? dw : Math.max(dw, pw * keep)
  const h = dh >= ph ? dh : Math.max(dh, ph * keep)
  return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 }
}

/** Merge tracks that cover one plate, keeping the older identity (step 7). */
function mergeTracks(
  tracks: Track[],
  now: number,
  ttl: number,
  longHold: number,
): Track[] {
  const out = [...tracks].sort((a, b) => a.id - b.id)
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length;) {
      const a = out[i]
      const b = out[j]
      const pa = predictBox(a, now, trackLife(a, ttl, longHold))
      const pb = predictBox(b, now, trackLife(b, ttl, longHold))
      if (iou(pa, pb) < MERGE_IOU && containment(pa, pb) < MERGE_CONTAIN) {
        j++
        continue
      }
      const fresh = b.lastSeen > a.lastSeen ? b : a
      out[i] = {
        ...a,
        box: fresh.box,
        vx: fresh.vx,
        vy: fresh.vy,
        lastSeen: fresh.lastSeen,
        score: fresh.score,
        missed: Math.min(a.missed, b.missed),
        confirmed: a.confirmed || b.confirmed,
        hits: a.hits + b.hits,
        born: Math.min(a.born, b.born),
        smooth: unionBox(a.smooth, b.smooth),
        padCarry: Math.max(a.padCarry, b.padCarry),
        gap: Math.max(a.gap, b.gap),
      }
      out.splice(j, 1)
    }
  }
  return out
}

/**
 * Fold one detection result (captured at time `now`) into the tracker.
 * Greedy matching by overlap with each track's predicted or last box, best pairs first.
 * Unmatched tracks survive while unseen for less than their life (trackLife); tracks that
 * cover one plate are merged.
 */
export function updateTracker(
  state: TrackerState,
  detections: readonly Detection[],
  now: number,
  conf: number,
  ttl = TRACK_TTL_MS,
  opts: TrackerOptions = {},
): TrackerState {
  const startConf = opts.startConf ?? 0
  const keepConf = opts.keepConf ?? startConf
  const longHold = opts.longHoldMs ?? LONG_HOLD_MS
  const pairs: { ti: number; di: number; o: number }[] = []
  state.tracks.forEach((t, ti) => {
    const p = predictBox(t, now, trackLife(t, ttl, longHold))
    detections.forEach((d, di) => {
      if (d.score < keepConf) return
      const o = Math.max(iou(p, d), iou(t.box, d))
      if (o < MATCH_IOU) return
      // Hysteresis: a weak detection only keeps a track it clearly overlaps.
      if (d.score < startConf && o < HYSTERESIS_IOU) return
      pairs.push({ ti, di, o })
    })
  })
  pairs.sort((a, b) => b.o - a.o)
  const trackUsed = new Set<number>()
  const detUsed = new Set<number>()
  const next: Track[] = []
  for (const { ti, di } of pairs) {
    if (trackUsed.has(ti) || detUsed.has(di)) continue
    trackUsed.add(ti)
    detUsed.add(di)
    const t = state.tracks[ti]
    const d = detections[di]
    const box = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }
    const dt = now - t.lastSeen
    let { vx, vy } = t
    if (dt > 0) {
      const mx = (d.x1 + d.x2 - t.box.x1 - t.box.x2) / 2 / dt
      const my = (d.y1 + d.y2 - t.box.y1 - t.box.y2) / 2 / dt
      vx = (1 - VELOCITY_BLEND) * vx + VELOCITY_BLEND * mx
      vy = (1 - VELOCITY_BLEND) * vy + VELOCITY_BLEND * my
    }
    const life = trackLife(t, ttl, longHold)
    next.push({
      ...t,
      box,
      vx,
      vy,
      lastSeen: Math.max(now, t.lastSeen),
      score: d.score,
      confirmed: t.confirmed || d.score >= conf,
      missed: 0,
      hits: t.hits + 1,
      smooth: smoothInto(t, box, dt, vx, vy),
      padCarry: growShare(t, now, life),
      gap: dt <= 0 ? t.gap : t.gap ? (1 - GAP_BLEND) * t.gap + GAP_BLEND * dt : dt,
    })
  }
  state.tracks.forEach((t, ti) => {
    if (trackUsed.has(ti)) return
    if (now - t.lastSeen > trackLife(t, ttl, longHold)) return
    next.push({ ...t, missed: t.missed + 1 })
  })
  let nextId = state.nextId
  detections.forEach((d, di) => {
    if (detUsed.has(di) || d.score < startConf) return
    const box = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }
    next.push({
      id: nextId++,
      box,
      vx: 0,
      vy: 0,
      lastSeen: now,
      score: d.score,
      confirmed: d.score >= conf,
      missed: 0,
      hits: 1,
      born: now,
      smooth: box,
      padCarry: 0,
      gap: 0,
    })
  })
  return { tracks: mergeTracks(next, now, ttl, longHold), nextId }
}

/** Tracks that still deserve a mask at time `now`. */
export function activeTracks(
  state: TrackerState,
  now: number,
  ttl = TRACK_TTL_MS,
  longHold = LONG_HOLD_MS,
): Track[] {
  return state.tracks.filter((t) => now - t.lastSeen <= trackLife(t, ttl, longHold))
}

/** Plates counted at time `now`: active tracks that reached the counting threshold. */
export function countPlates(
  state: TrackerState,
  now: number,
  ttl = TRACK_TTL_MS,
  longHold = LONG_HOLD_MS,
): number {
  return activeTracks(state, now, ttl, longHold).filter((t) => t.confirmed).length
}

/**
 * Keep time for a detector that returns a result every `intervalMs`: at least TRACK_TTL_MS,
 * and long enough to survive one missed result (2.5 intervals) on a slow backend.
 */
export function keepTimeFor(intervalMs: number): number {
  return Math.max(TRACK_TTL_MS, 2.5 * intervalMs)
}

/**
 * The rectangle to paint for a track at time `now`, clipped to the frame.
 * It covers the last detected box, that box moved along the estimated motion, and the
 * smoothed box moved the same way, so neither a wrong motion estimate nor smoothing lag can
 * slide the mask off the plate: the mask always contains the latest raw box plus padding.
 * Padding is 10% of the longer side (at least 4 px), plus GROW_PER_FRAME of the longer side
 * for every 1/30 s since the frame the box was last detected on, up to MAX_GROW_SHARE; after a
 * re-detection the grown padding relaxes over PAD_RELAX_MS instead of snapping back. The motion
 * shift stops after MAX_SHIFT_MS.
 */
export function maskRect(
  t: Track,
  now: number,
  frameW: number,
  frameH: number,
  ttl = TRACK_TTL_MS,
  longHold = LONG_HOLD_MS,
): Box {
  const life = trackLife(t, ttl, longHold)
  const reach = Math.min(life, MAX_SHIFT_MS)
  const dt = Math.min(Math.max(now - t.lastSeen, -reach), reach)
  const b = unionBox(
    t.box,
    shift(t.box, t.vx * dt, t.vy * dt),
    shift(t.smooth, t.vx * dt, t.vy * dt),
  )
  const longer = Math.max(longerSide(t.box), longerSide(t.smooth))
  const pad =
    Math.max(BASE_PAD_RATIO * longer, MIN_PAD_PX) + growShare(t, now, life) * longer
  return {
    x1: Math.max(0, Math.floor(b.x1 - pad)),
    y1: Math.max(0, Math.floor(b.y1 - pad)),
    x2: Math.min(frameW, Math.ceil(b.x2 + pad)),
    y2: Math.min(frameH, Math.ceil(b.y2 + pad)),
  }
}
