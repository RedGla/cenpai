import { afterEach, describe, expect, it, vi } from 'vitest'
import { LivePipeline } from './pipeline'
import { attachVideoFile, detachVideoFile, videoFileMode } from './videoFile'

describe('videoFileMode', () => {
  it('is on only with ?video=1', () => {
    expect(videoFileMode('?video=1')).toBe(true)
    expect(videoFileMode('?video=0')).toBe(false)
    expect(videoFileMode('')).toBe(false)
  })
})

/** A video element stand-in whose frame callback the test fires by hand. */
function fakeVideo() {
  let cb: (() => void) | null = null
  const v = {
    videoWidth: 64,
    videoHeight: 48,
    srcObject: 'camera' as unknown,
    src: '',
    muted: false,
    loop: true,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
    requestVideoFrameCallback: vi.fn((f: () => void) => {
      cb = f
      return 1
    }),
    cancelVideoFrameCallback: vi.fn(),
  }
  return { v, fire: () => cb?.() }
}

describe('video file in the camera pipeline', () => {
  afterEach(() => vi.restoreAllMocks())

  it('plays the picked file in place of the camera and the pipeline receives its frames', () => {
    const drawn: unknown[] = []
    const ctx = {
      drawImage: (src: unknown) => drawn.push(src),
      fillRect: () => {},
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
      fillStyle: '',
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    )
    URL.createObjectURL = vi.fn(() => 'blob:clip')
    URL.revokeObjectURL = vi.fn()

    const { v, fire } = fakeVideo()
    const video = v as unknown as HTMLVideoElement
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })

    const url = attachVideoFile(video, file)
    expect(url).toBe('blob:clip')
    expect(v.src).toBe('blob:clip')
    expect(v.srcObject).toBeNull() // the camera stream is not used
    expect(v.loop).toBe(false)
    expect(v.muted).toBe(true)
    expect(v.play).toHaveBeenCalled()

    const canvas = document.createElement('canvas')
    const pipeline = new LivePipeline(video as never, canvas, false, false)
    pipeline.start()
    fire()
    fire()
    // No model is loaded, so the shutter is closed: each frame is the file's frame, blurred.
    expect(canvas.width).toBe(64)
    expect(canvas.height).toBe(48)
    expect(drawn.filter((s) => s === v).length).toBe(2)
    expect(pipeline.stats.shutter).toBe(true)
    pipeline.stop()

    detachVideoFile(video, url)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip')
  })
})
