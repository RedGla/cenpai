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
}

export interface TrackerState {
  tracks: Track[]
  nextId: number
}

/** A box is kept this long after it was last seen. */
export const TRACK_TTL_MS = 400
/** Detections and tracks match when their overlap (IoU) is at least this. */
export const MATCH_IOU = 0.2
/** Mask padding as a share of the box's longer side, with a floor in pixels. */
export const BASE_PAD_RATIO = 0.1
export const MIN_PAD_PX = 4
/** Extra padding per frame-time (1/30 s) spent unseen, as a share of the longer side. */
export const GROW_PER_FRAME = 0.02
export const FRAME_MS = 1000 / 30
/** Velocity smoothing: share of the new measurement. */
const VELOCITY_BLEND = 0.5

export const emptyTracker = (): TrackerState => ({ tracks: [], nextId: 1 })

export function iou(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
  return union > 0 ? inter / union : 0
}

/** Where the track's box is expected at time `now`, moved along its estimated velocity. */
export function predictBox(t: Track, now: number): Box {
  const dt = Math.min(Math.max(now - t.lastSeen, 0), TRACK_TTL_MS)
  const dx = t.vx * dt
  const dy = t.vy * dt
  return { x1: t.box.x1 + dx, y1: t.box.y1 + dy, x2: t.box.x2 + dx, y2: t.box.y2 + dy }
}

/**
 * Fold one detection result (captured at time `now`) into the tracker.
 * Greedy matching by overlap with each track's predicted box, best pairs first.
 * Unmatched tracks survive until they have been unseen for TRACK_TTL_MS.
 */
export function updateTracker(
  state: TrackerState,
  detections: readonly Detection[],
  now: number,
  conf: number,
): TrackerState {
  const pairs: { ti: number; di: number; o: number }[] = []
  state.tracks.forEach((t, ti) => {
    const p = predictBox(t, now)
    detections.forEach((d, di) => {
      const o = iou(p, d)
      if (o >= MATCH_IOU) pairs.push({ ti, di, o })
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
    const dt = now - t.lastSeen
    let { vx, vy } = t
    if (dt > 0) {
      const mx = (d.x1 + d.x2 - t.box.x1 - t.box.x2) / 2 / dt
      const my = (d.y1 + d.y2 - t.box.y1 - t.box.y2) / 2 / dt
      vx = (1 - VELOCITY_BLEND) * vx + VELOCITY_BLEND * mx
      vy = (1 - VELOCITY_BLEND) * vy + VELOCITY_BLEND * my
    }
    next.push({
      ...t,
      box: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 },
      vx,
      vy,
      lastSeen: now,
      score: d.score,
      confirmed: t.confirmed || d.score >= conf,
      missed: 0,
    })
  }
  state.tracks.forEach((t, ti) => {
    if (trackUsed.has(ti)) return
    if (now - t.lastSeen > TRACK_TTL_MS) return
    next.push({ ...t, missed: t.missed + 1 })
  })
  let nextId = state.nextId
  detections.forEach((d, di) => {
    if (detUsed.has(di)) return
    next.push({
      id: nextId++,
      box: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 },
      vx: 0,
      vy: 0,
      lastSeen: now,
      score: d.score,
      confirmed: d.score >= conf,
      missed: 0,
    })
  })
  return { tracks: next, nextId }
}

/** Tracks that still deserve a mask at time `now`. */
export function activeTracks(state: TrackerState, now: number): Track[] {
  return state.tracks.filter((t) => now - t.lastSeen <= TRACK_TTL_MS)
}

/** Plates counted at time `now`: active tracks that reached the counting threshold. */
export function countPlates(state: TrackerState, now: number): number {
  return activeTracks(state, now).filter((t) => t.confirmed).length
}

/**
 * The rectangle to paint for a track at time `now`, clipped to the frame.
 * Padding is 10% of the longer side (at least 4 px). While the track is unseen it grows
 * by GROW_PER_FRAME of the longer side for every 1/30 s since it was last seen.
 */
export function maskRect(t: Track, now: number, frameW: number, frameH: number): Box {
  const b = predictBox(t, now)
  const longer = Math.max(b.x2 - b.x1, b.y2 - b.y1)
  let pad = Math.max(BASE_PAD_RATIO * longer, MIN_PAD_PX)
  if (t.missed > 0) {
    const frames = Math.max(now - t.lastSeen, 0) / FRAME_MS
    pad += GROW_PER_FRAME * longer * frames
  }
  return {
    x1: Math.max(0, Math.floor(b.x1 - pad)),
    y1: Math.max(0, Math.floor(b.y1 - pad)),
    x2: Math.min(frameW, Math.ceil(b.x2 + pad)),
    y2: Math.min(frameH, Math.ceil(b.y2 + pad)),
  }
}
