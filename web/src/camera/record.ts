/** Preferred recording formats: MP4 first, WebM second. */
export const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  return MIME_CANDIDATES.find((t) => isSupported(t)) ?? null
}

export const extensionFor = (mime: string) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm')

export interface Recording {
  blob: Blob
  mimeType: string
  extension: string
}

/**
 * Records the censored canvas. Video only: the stream comes from canvas.captureStream, which
 * has no audio track, because live audio is not censored yet.
 */
export class CanvasRecorder {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null
  mimeType = ''

  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
  }

  /** Throws with a readable message when this browser cannot record. */
  start(canvas: HTMLCanvasElement) {
    if (!CanvasRecorder.supported()) throw new Error('This browser cannot record video from a canvas.')
    const mime = pickMimeType((t) => MediaRecorder.isTypeSupported(t))
    if (!mime) throw new Error('This browser has no supported video format (MP4 or WebM).')
    this.mimeType = mime
    this.chunks = []
    this.stream = canvas.captureStream(30)
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 })
    this.recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) this.chunks.push(ev.data)
    }
    this.recorder.start()
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording'
  }

  stop(): Promise<Recording> {
    const rec = this.recorder
    if (!rec) return Promise.reject(new Error('not recording'))
    return new Promise((resolve, reject) => {
      rec.onerror = () => reject(new Error('recording failed'))
      rec.onstop = () => {
        const mimeType = this.mimeType
        const blob = new Blob(this.chunks, { type: mimeType.split(';')[0] })
        this.release()
        if (blob.size === 0) reject(new Error('the recording is empty'))
        else resolve({ blob, mimeType, extension: extensionFor(mimeType) })
      }
      if (rec.state !== 'inactive') rec.stop()
    })
  }

  /** Stop without keeping anything (used when leaving the tab). */
  cancel() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null
      this.recorder.stop()
    }
    this.release()
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.recorder = null
    this.chunks = []
  }
}
