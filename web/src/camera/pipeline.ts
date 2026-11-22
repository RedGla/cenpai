import { DetectorClient, type ReadyInfo } from '../detect/client'
import type { BackendChoice, ModelSize } from '../detect/protocol'
import { paintCensor, type CensorMode } from './censorStyle'
import { HoldQueue, MAX_HELD } from './holdQueue'
import {
  activeTracks,
  countPlates,
  emptyTracker,
  keepConfFor,
  keepTimeFor,
  maskRect,
  updateTracker,
  type TrackerState,
} from '../track/tracker'
import { StabilityMonitor, formatRow, formatSummary, type DrawnMask } from '../track/stability'

/** The shutter closes when no detection result has arrived for this long. */
export const SHUTTER_TIMEOUT_MS = 300
/** Width in pixels of the tiny copy used to blur the shutter frame. */
const SHUTTER_TINY_W = 40
/** Spare frame canvases kept for reuse (held frames plus a few in flight). */
const POOL_MAX = MAX_HELD + 4

export interface LiveStats {
  fps: number
  /** True while the whole frame is blurred. */
  shutter: boolean
  plates: number
  inferMs: number | null
  loading: boolean
  model: ReadyInfo | null
  error: string | null
  /** Diagnostics for ?debug=1: canvas size and the frame size the detector saw. */
  debug: string
  /** Frames held waiting for a detection (step 10). */
  held: number
  /** How old the frame on screen was when it was drawn (ms). */
  holdMs: number
  /** ?debug=1 only: mask stability counters since the last reset (numbers only). */
  stability: string
  /** ?debug=1 only: one line per track. */
  trackRows: string[]
}

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number
  cancelVideoFrameCallback?: (id: number) => void
}

/**
 * Draws every camera frame to the canvas and keeps plates covered.
 * The mask and the shutter are painted inside the same frame callback that paints the video,
 * so the canvas (and anything recorded from it) never shows a frame the app has not censored.
 */
export class LivePipeline {
  private client: DetectorClient | null = null
  private generation = 0
  private tracker: TrackerState = emptyTracker()
  private haveResult = false
  private lastResultAt = 0
  /** Smoothed time between detection results (ms); stretches the timeouts on slow backends. */
  private resultInterval = 0
  private callbackId = 0
  private stopped = false
  /** Live detection is paused (benchmark running). */
  private paused = false
  /** The live detection in flight, if any. */
  private inflight: Promise<void> | null = null
  private frames = 0
  private windowStart = performance.now()
  private tiny = document.createElement('canvas')
  private s: LiveStats = {
    fps: 0,
    shutter: true,
    plates: 0,
    inferMs: null,
    loading: true,
    model: null,
    error: null,
    debug: '',
    held: 0,
    holdMs: 0,
    stability: '',
    trackRows: [],
  }
  private monitor = new StabilityMonitor(performance.now())
  /** ?debug=1: times the canvas was resized (a resize clears it). */
  private resizes = 0
  private queue = new HoldQueue<HTMLCanvasElement>()
  private pool: HTMLCanvasElement[] = []
  /** Held frame the detector is copying right now; it must not be reused until done. */
  private snapshotting: HTMLCanvasElement | null = null
  private recycleAfterSnapshot = false

  constructor(
    private video: FrameVideo,
    private canvas: HTMLCanvasElement,
    private debug = false,
    /** Step 10: hold frames until detected. Off with ?hold=0. */
    private hold = true,
  ) {}

  /** How each plate is covered: solid (default, safest), blur or pixelate. */
  censorMode: CensorMode = 'solid'
  private censorScratch = document.createElement('canvas')

  get stats(): LiveStats {
    return this.s
  }

  get model(): ReadyInfo | null {
    return this.s.model
  }

  start() {
    if (!this.video.requestVideoFrameCallback) {
      this.s.error = 'This browser cannot read camera frames one by one (requestVideoFrameCallback).'
      return
    }
    this.callbackId = this.video.requestVideoFrameCallback(this.onFrame)
  }

  stop() {
    this.stopped = true
    this.video.cancelVideoFrameCallback?.(this.callbackId)
    // Free the held frames' memory.
    for (const f of this.queue.drain()) f.item.width = 0
    for (const c of this.pool) c.width = 0
    this.pool = []
    this.client?.terminate()
    this.client = null
  }

  setError(message: string | null) {
    this.s.error = message
  }

  /** (Re)load the model. The shutter stays closed until the first result from the new model. */
  async loadModel(size: ModelSize, backend: BackendChoice) {
    const gen = ++this.generation
    this.client?.terminate()
    this.client = new DetectorClient()
    const client = this.client
    this.tracker = emptyTracker()
    this.haveResult = false
    this.resultInterval = 0
    this.queue.resetDetections()
    this.s.loading = true
    this.s.model = null
    this.s.inferMs = null
    this.s.error = null
    try {
      const info = await client.init(size, backend)
      if (gen !== this.generation) return
      this.s.model = info
    } catch (e) {
      if (gen !== this.generation) return
      this.s.error = e instanceof Error ? e.message : String(e)
    } finally {
      if (gen === this.generation) this.s.loading = false
    }
  }

  /** Runs `runs` inferences on the current frame; live detection pauses meanwhile. */
  async benchmark(runs: number) {
    const client = this.client
    const model = this.s.model
    if (!client || !model || this.paused) throw new Error('detector is not ready')
    // Live detection runs back to back, so the detector is rarely idle: stop sending live
    // frames, let the one in flight finish, then hold the detector for the benchmark.
    this.paused = true
    try {
      await this.inflight
      const bmp = await createImageBitmap(this.video)
      return { model, ...(await client.bench(bmp, runs)) }
    } finally {
      this.paused = false
    }
  }

  private onFrame = () => {
    if (this.stopped) return
    const { video, canvas } = this
    const ctx = canvas.getContext('2d')
    if (ctx && video.videoWidth > 0) {
      const w = video.videoWidth
      const h = video.videoHeight
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        this.resizes += 1
      }
      const now = performance.now()
      if (this.hold) {
        // Step 10: hold this frame until a detection exists for it or a later frame.
        const frame = this.takeCanvas(w, h)
        frame.getContext('2d')!.drawImage(video, 0, 0, w, h)
        const held = this.queue.push(frame, now)
        this.dispatchDetection(now, frame, held.seq)
        const r = this.queue.take(now)
        for (const f of r.recycle) this.recycleCanvas(f.item)
        if (r.show) {
          this.drawFrame(ctx, r.show.item, r.show.t, w, h, r.blurred)
          this.s.holdMs = now - r.show.t
          this.recycleCanvas(r.show.item)
        }
        this.s.held = this.queue.length
      } else {
        this.drawFrame(ctx, video, now, w, h, false)
        this.dispatchDetection(now, video, null)
      }
    }
    this.countFps()
    this.callbackId = video.requestVideoFrameCallback!(this.onFrame)
  }

  /**
   * Paint one frame with its masks, or blurred. `t` is the frame's capture time: masks are
   * placed for that moment, which for a held frame can be just before the detection.
   */
  private drawFrame(
    ctx: CanvasRenderingContext2D,
    src: CanvasImageSource,
    t: number,
    w: number,
    h: number,
    forceBlur: boolean,
  ) {
    const wall = performance.now()
    const shutter = forceBlur || !this.haveResult || wall - this.lastResultAt > this.shutterTimeout()
    this.s.shutter = shutter
    if (shutter) {
      this.drawShutter(ctx, src, w, h)
      this.s.plates = 0
      if (this.debug) {
        this.monitor.shutterFrame(t)
        this.s.stability = formatSummary(this.monitor.summary())
      }
      return
    }
    ctx.drawImage(src, 0, 0, w, h)
    const keep = this.keepTime()
    const drawn: DrawnMask[] = []
    for (const tr of activeTracks(this.tracker, t, keep)) {
      const r = maskRect(tr, t, w, h, keep)
      paintCensor(ctx, src, r, this.censorMode, this.censorScratch, w, h)
      drawn.push({ track: tr, rect: r })
    }
    this.s.plates = countPlates(this.tracker, t, keep)
    if (this.debug) {
      this.drawDebug(ctx, t)
      const rows = this.monitor.frame(t, this.tracker.tracks, drawn, keep)
      this.s.trackRows = rows.map(formatRow)
      this.s.stability = formatSummary(this.monitor.summary()) + `, canvas resizes ${this.resizes}`
    }
  }

  /** ?debug=1: start the stability counters over (for a timed test scene). */
  resetStability() {
    this.monitor.reset(performance.now())
    this.resizes = 0
  }

  /** A pooled full-size canvas for holding one frame. */
  private takeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = this.pool.pop() ?? document.createElement('canvas')
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    return c
  }

  /** Back to the pool, unless the detector is still taking its snapshot of it. */
  private recycleCanvas(c: HTMLCanvasElement) {
    if (c === this.snapshotting) {
      this.recycleAfterSnapshot = true
      return
    }
    if (this.pool.length < POOL_MAX) this.pool.push(c)
  }

  /** Keep time for unseen boxes: 400 ms, longer when the detector is slower than that. */
  private keepTime(): number {
    return keepTimeFor(this.resultInterval)
  }

  /** Shutter closes after 300 ms without a result, or 1.5 result intervals on a slow backend. */
  private shutterTimeout(): number {
    return Math.max(SHUTTER_TIMEOUT_MS, 1.5 * this.resultInterval)
  }

  /** Debug only: outline each tracked box with its score (drawn on top of the masks). */
  private drawDebug(ctx: CanvasRenderingContext2D, now: number) {
    ctx.lineWidth = 4
    ctx.font = 'bold 28px sans-serif'
    for (const t of activeTracks(this.tracker, now, this.keepTime())) {
      ctx.strokeStyle = t.confirmed ? '#0f0' : '#ff0'
      ctx.strokeRect(t.box.x1, t.box.y1, t.box.x2 - t.box.x1, t.box.y2 - t.box.y1)
      ctx.fillStyle = ctx.strokeStyle
      ctx.fillText(t.score.toFixed(2), t.box.x1, Math.max(28, t.box.y1 - 6))
    }
  }

  /** Whole-frame blur: shrink the frame to a few dozen pixels and stretch it back. */
  private drawShutter(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number) {
    const tw = SHUTTER_TINY_W
    const th = Math.max(1, Math.round((tw * h) / w))
    if (this.tiny.width !== tw || this.tiny.height !== th) {
      this.tiny.width = tw
      this.tiny.height = th
    }
    this.tiny.getContext('2d')!.drawImage(src, 0, 0, tw, th)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.tiny, 0, 0, w, h)
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.fillRect(0, 0, w, h)
  }

  /**
   * One inference at a time: frames that arrive while the detector is busy are skipped.
   * `seq` is the held frame's number; its result releases that frame and all earlier ones.
   */
  private dispatchDetection(
    captureTime: number,
    src: HTMLCanvasElement | HTMLVideoElement,
    seq: number | null,
  ) {
    const client = this.client
    const model = this.s.model
    if (!client || !model || client.busy || this.paused) return
    const gen = this.generation
    client.busy = true
    const held = src instanceof HTMLCanvasElement ? src : null
    this.snapshotting = held
    this.inflight = createImageBitmap(src)
      .then((bmp) => {
        this.releaseSnapshot(held)
        return client.detect(bmp)
      })
      .then((r) => {
        if (gen !== this.generation) return
        const arrived = performance.now()
        if (this.haveResult) {
          const gap = arrived - this.lastResultAt
          this.resultInterval = this.resultInterval ? 0.8 * this.resultInterval + 0.2 * gap : gap
        }
        this.tracker = updateTracker(
          this.tracker,
          r.detections,
          captureTime,
          model.meta.conf,
          this.keepTime(),
          { startConf: model.maskConf, keepConf: keepConfFor(model.maskConf) },
        )
        if (this.debug) {
          this.s.debug =
            `canvas ${this.canvas.width}x${this.canvas.height}, ` +
            `detector frame ${r.frameW}x${r.frameH}, ${r.detections.length} raw boxes, ` +
            `keep ${this.keepTime().toFixed(0)} ms, shutter after ${this.shutterTimeout().toFixed(0)} ms`
        }
        this.haveResult = true
        this.lastResultAt = arrived
        if (seq !== null) this.queue.markDetected(seq)
        this.s.inferMs = this.s.inferMs === null ? r.inferMs : 0.8 * this.s.inferMs + 0.2 * r.inferMs
      })
      .catch((e: unknown) => {
        this.releaseSnapshot(held)
        if (gen === this.generation) this.s.error = e instanceof Error ? e.message : String(e)
      })
      .finally(() => {
        client.busy = false
        this.inflight = null
      })
  }

  private releaseSnapshot(held: HTMLCanvasElement | null) {
    if (!held || this.snapshotting !== held) return
    this.snapshotting = null
    if (this.recycleAfterSnapshot) {
      this.recycleAfterSnapshot = false
      if (this.pool.length < POOL_MAX) this.pool.push(held)
    }
  }

  private countFps() {
    this.frames += 1
    const t = performance.now()
    if (t - this.windowStart >= 1000) {
      this.s.fps = Math.round((this.frames * 1000) / (t - this.windowStart))
      this.frames = 0
      this.windowStart = t
    }
  }
}
