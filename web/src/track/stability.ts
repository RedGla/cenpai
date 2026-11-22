/**
 * Mask stability counters for the ?debug=1 overlay (Phase 4b step 1).
 * Numbers only: no plate text, frames or crops are kept. Box coordinates are held in memory
 * for at most REACQUIRE_MS so a new track can be compared with a recently dropped one.
 */
import { TRACK_TTL_MS, iou, isHolding, type Box, type Track } from './tracker'

const inside = (inner: Box, outer: Box) =>
  outer.x1 <= inner.x1 &&
  outer.y1 <= inner.y1 &&
  outer.x2 >= inner.x2 &&
  outer.y2 >= inner.y2

/** A new track this soon after a drop, on an overlapping box, counts as a re-acquisition. */
export const REACQUIRE_MS = 1000
export const REACQUIRE_IOU = 0.3
/** Two drawn masks overlapping by at least this count as fighting over one plate. */
export const FIGHT_IOU = 0.3

export interface DrawnMask {
  track: Track
  /** The rectangle painted this frame (with padding). */
  rect: Box
}

export interface TrackRow {
  id: number
  ageMs: number
  /** Displayed frames since the frame this track was last detected on. */
  framesUnseen: number
  score: number
  drawn: boolean
  holding: boolean
}

export interface StabilitySummary {
  seconds: number
  frames: number
  /** Frames the whole view was blurred (shutter); masks are not judged on those. */
  shutterFrames: number
  drops: number
  /** Drops where no other drawn mask still covered the dropped track's last box. */
  uncoveredDrops: number
  reacquisitions: number
  /** Mean frame-to-frame change in a drawn mask's area, as a share of its previous area. */
  meanAreaChange: number
  /** Mean change in a detected box's centre between detections, as a share of its longer side. */
  meanBoxJitter: number
  /** Frames where two drawn masks overlapped by FIGHT_IOU or more. */
  fightFrames: number
  /** Mean confidence of the last detection before each drop. */
  meanScoreBeforeDrop: number | null
}

const area = (b: Box) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)

interface Seen {
  born: number
  lastSeen: number
  framesUnseen: number
  rect: Box | null
  box: Box
  score: number
}

export class StabilityMonitor {
  private start = 0
  private frames = 0
  private shutterFrames = 0
  private drops = 0
  private uncovered = 0
  private reacq = 0
  private areaSum = 0
  private areaN = 0
  private jitterSum = 0
  private jitterN = 0
  private fightFrames = 0
  private dropScoreSum = 0
  private known = new Map<number, Seen>()
  private recentDrops: { t: number; box: Box }[] = []
  private lastT = 0

  constructor(now = 0) {
    this.reset(now)
  }

  reset(now: number) {
    this.start = now
    this.lastT = now
    this.frames = 0
    this.shutterFrames = 0
    this.drops = 0
    this.uncovered = 0
    this.reacq = 0
    this.areaSum = 0
    this.areaN = 0
    this.jitterSum = 0
    this.jitterN = 0
    this.fightFrames = 0
    this.dropScoreSum = 0
    this.known.clear()
    this.recentDrops = []
  }

  /** A frame shown fully blurred: nothing about the masks can be judged. */
  shutterFrame(now: number) {
    this.lastT = now
    this.frames += 1
    this.shutterFrames += 1
  }

  /**
   * One displayed frame. `tracks` is every track the tracker holds; `drawn` the masks painted.
   * Returns the per-track rows for the overlay.
   */
  frame(
    now: number,
    tracks: readonly Track[],
    drawn: readonly DrawnMask[],
    keepMs = TRACK_TTL_MS,
  ): TrackRow[] {
    this.lastT = now
    this.frames += 1
    this.recentDrops = this.recentDrops.filter((d) => now - d.t <= REACQUIRE_MS)
    const drawnIds = new Map(drawn.map((d) => [d.track.id, d.rect]))

    // Drops: a mask drawn on the previous frame and not on this one.
    for (const [id, k] of this.known) {
      if (k.rect && !drawnIds.has(id)) {
        this.drops += 1
        if (!drawn.some((d) => inside(k.box, d.rect))) this.uncovered += 1
        this.dropScoreSum += k.score
        this.recentDrops.push({ t: now, box: k.box })
        k.rect = null
      }
      if (!tracks.some((t) => t.id === id) && !k.rect) this.known.delete(id)
    }

    const rows: TrackRow[] = []
    for (const t of tracks) {
      let k = this.known.get(t.id)
      if (!k) {
        // A new track: was it a plate whose mask just dropped?
        if (this.recentDrops.some((d) => iou(d.box, t.box) >= REACQUIRE_IOU))
          this.reacq += 1
        k = {
          born: t.lastSeen,
          lastSeen: t.lastSeen,
          framesUnseen: 0,
          rect: null,
          box: t.box,
          score: t.score,
        }
        this.known.set(t.id, k)
      } else if (t.lastSeen !== k.lastSeen) {
        const longer = Math.max(k.box.x2 - k.box.x1, k.box.y2 - k.box.y1, 1)
        const dx = (t.box.x1 + t.box.x2 - k.box.x1 - k.box.x2) / 2
        const dy = (t.box.y1 + t.box.y2 - k.box.y1 - k.box.y2) / 2
        this.jitterSum += Math.hypot(dx, dy) / longer
        this.jitterN += 1
        k.lastSeen = t.lastSeen
        k.framesUnseen = 0
        k.box = t.box
        k.score = t.score
      } else {
        k.framesUnseen += 1
      }
      const rect = drawnIds.get(t.id) ?? null
      if (rect && k.rect) {
        const prev = area(k.rect)
        if (prev > 0) {
          this.areaSum += Math.abs(area(rect) - prev) / prev
          this.areaN += 1
        }
      }
      k.rect = rect
      rows.push({
        id: t.id,
        ageMs: now - k.born,
        framesUnseen: k.framesUnseen,
        score: t.score,
        drawn: rect !== null,
        holding: rect !== null && isHolding(t, now, keepMs),
      })
    }

    let fight = false
    for (let i = 0; i < drawn.length && !fight; i++)
      for (let j = i + 1; j < drawn.length && !fight; j++)
        if (iou(drawn[i].rect, drawn[j].rect) >= FIGHT_IOU) fight = true
    if (fight) this.fightFrames += 1
    return rows
  }

  summary(): StabilitySummary {
    return {
      seconds: (this.lastT - this.start) / 1000,
      frames: this.frames,
      shutterFrames: this.shutterFrames,
      drops: this.drops,
      uncoveredDrops: this.uncovered,
      reacquisitions: this.reacq,
      meanAreaChange: this.areaN ? this.areaSum / this.areaN : 0,
      meanBoxJitter: this.jitterN ? this.jitterSum / this.jitterN : 0,
      fightFrames: this.fightFrames,
      meanScoreBeforeDrop: this.drops ? this.dropScoreSum / this.drops : null,
    }
  }
}

/** One line for the overlay. */
export function formatSummary(s: StabilitySummary): string {
  const pct = (v: number) => `${(100 * v).toFixed(1)}%`
  return (
    `${s.seconds.toFixed(0)} s, ${s.frames} frames (${s.shutterFrames} shutter) | ` +
    `drops ${s.drops} (uncovered ${s.uncoveredDrops}), re-acquired ${s.reacquisitions} | ` +
    `mask area change ${pct(s.meanAreaChange)}/frame, box jitter ${pct(s.meanBoxJitter)}/detection | ` +
    `overlap frames ${s.fightFrames} | ` +
    `conf before drop ${s.meanScoreBeforeDrop === null ? '-' : s.meanScoreBeforeDrop.toFixed(2)}`
  )
}

export function formatRow(r: TrackRow): string {
  return (
    `#${r.id} age ${(r.ageMs / 1000).toFixed(1)} s, unseen ${r.framesUnseen} fr, ` +
    `conf ${r.score.toFixed(2)}, ${r.drawn ? (r.holding ? 'drawn (holding)' : 'drawn') : 'NOT drawn'}`
  )
}
