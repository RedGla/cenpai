import { DetectorClient, type ReadyInfo } from '../detect/client'
import type { BackendChoice } from '../detect/protocol'
import {
  activeTracks,
  countPlates,
  emptyTracker,
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
  private callbackId = 0
  private stopped = false
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
  }

  constructor(
    private video: FrameVideo,
    private canvas: HTMLCanvasElement,
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
    if (!client || !model || client.busy) throw new Error('detector is not ready')
    client.busy = true
    try {
      const bmp = await createImageBitmap(this.video)
      return { model, ...(await client.bench(bmp, runs)) }
    } finally {
      client.busy = false
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
      const shutter = !this.haveResult || now - this.lastResultAt > SHUTTER_TIMEOUT_MS
      this.s.shutter = shutter
      if (shutter) {
        this.drawShutter(ctx, w, h)
        this.s.plates = 0
      } else {
        ctx.drawImage(video, 0, 0, w, h)
        ctx.fillStyle = '#000'
        for (const t of activeTracks(this.tracker, now)) {
          const r = maskRect(t, now, w, h)
          ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1)
        }
        this.s.plates = countPlates(this.tracker, now)
      }
      this.dispatchDetection(now)
    }
    this.countFps()
    this.callbackId = video.requestVideoFrameCallback!(this.onFrame)
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
    if (!client || !model || client.busy) return
    const gen = this.generation
    client.busy = true
    createImageBitmap(this.video)
      .then((bmp) => client.detect(bmp))
      .then((r) => {
        if (gen !== this.generation) return
        this.tracker = updateTracker(this.tracker, r.detections, captureTime, model.meta.conf)
        this.haveResult = true
        this.lastResultAt = performance.now()
        this.s.inferMs = this.s.inferMs === null ? r.inferMs : 0.8 * this.s.inferMs + 0.2 * r.inferMs
      })
      .catch((e: unknown) => {
        if (gen === this.generation) this.s.error = e instanceof Error ? e.message : String(e)
      })
      .finally(() => {
        client.busy = false
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
