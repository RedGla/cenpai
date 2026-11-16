import { DetectorClient, type ReadyInfo } from '../detect/client'
import type { BackendChoice } from '../detect/protocol'
import {
  activeTracks,
  countPlates,
  emptyTracker,
  keepTimeFor,
  maskRect,
  updateTracker,
  type TrackerState,
} from '../track/tracker'

/** The shutter closes when no detection result has arrived for this long. */
export const SHUTTER_TIMEOUT_MS = 300
/** Width in pixels of the tiny copy used to blur the shutter frame. */
const SHUTTER_TINY_W = 40

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
  }

  constructor(
    private video: FrameVideo,
    private canvas: HTMLCanvasElement,
    private debug = false,
  ) {}

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
    this.client?.terminate()
    this.client = null
  }

  setError(message: string | null) {
    this.s.error = message
  }

  /** (Re)load the model. The shutter stays closed until the first result from the new model. */
  async loadModel(size: 640 | 416, backend: BackendChoice) {
    const gen = ++this.generation
    this.client?.terminate()
    this.client = new DetectorClient()
    const client = this.client
    this.tracker = emptyTracker()
    this.haveResult = false
    this.resultInterval = 0
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
      }
      const now = performance.now()
      const shutter = !this.haveResult || now - this.lastResultAt > this.shutterTimeout()
      this.s.shutter = shutter
      if (shutter) {
        this.drawShutter(ctx, w, h)
        this.s.plates = 0
      } else {
        ctx.drawImage(video, 0, 0, w, h)
        ctx.fillStyle = '#000'
        const keep = this.keepTime()
        for (const t of activeTracks(this.tracker, now, keep)) {
          const r = maskRect(t, now, w, h, keep)
          ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1)
        }
        this.s.plates = countPlates(this.tracker, now, keep)
        if (this.debug) this.drawDebug(ctx, now)
      }
      this.dispatchDetection(now)
    }
    this.countFps()
    this.callbackId = video.requestVideoFrameCallback!(this.onFrame)
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
  private drawShutter(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const tw = SHUTTER_TINY_W
    const th = Math.max(1, Math.round((tw * h) / w))
    if (this.tiny.width !== tw || this.tiny.height !== th) {
      this.tiny.width = tw
      this.tiny.height = th
    }
    this.tiny.getContext('2d')!.drawImage(this.video, 0, 0, tw, th)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.tiny, 0, 0, w, h)
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.fillRect(0, 0, w, h)
  }

  /** One inference at a time: frames that arrive while the detector is busy are skipped. */
  private dispatchDetection(captureTime: number) {
    const client = this.client
    const model = this.s.model
    if (!client || !model || client.busy || this.paused) return
    const gen = this.generation
    client.busy = true
    this.inflight = createImageBitmap(this.video)
      .then((bmp) => client.detect(bmp))
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
        )
        this.s.debug =
          `canvas ${this.canvas.width}x${this.canvas.height}, ` +
          `detector frame ${r.frameW}x${r.frameH}, ${r.detections.length} raw boxes, ` +
          `keep ${this.keepTime().toFixed(0)} ms, shutter after ${this.shutterTimeout().toFixed(0)} ms`
        this.haveResult = true
        this.lastResultAt = arrived
        this.s.inferMs = this.s.inferMs === null ? r.inferMs : 0.8 * this.s.inferMs + 0.2 * r.inferMs
      })
      .catch((e: unknown) => {
        if (gen === this.generation) this.s.error = e instanceof Error ? e.message : String(e)
      })
      .finally(() => {
        client.busy = false
        this.inflight = null
      })
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
