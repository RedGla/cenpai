import { useEffect, useRef, useState } from 'react'
import { DetectorClient, type ReadyInfo } from '../detect/client'
import type { Detection } from '../detect/types'

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: false,
}

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number
  cancelVideoFrameCallback?: (id: number) => void
}

export default function CameraTab() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [model, setModel] = useState<ReadyInfo | null>(null)
  const [stats, setStats] = useState({ inferMs: 0, boxes: 0 })

  const detectorRef = useRef<DetectorClient | null>(null)
  const lastRef = useRef<{ detections: Detection[]; at: number } | null>(null)

  useEffect(() => {
    let alive = true
    const client = new DetectorClient()
    detectorRef.current = client
    client
      .init(640, 'auto')
      .then((info) => alive && setModel(info))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
      detectorRef.current = null
      client.terminate()
    }
  }, [])

  const readyRef = useRef(false)
  readyRef.current = model !== null

  useEffect(() => {
    let stream: MediaStream | undefined
    let cancelled = false
    let callbackId = 0
    const video = videoRef.current as FrameVideo | null
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is not available. Open the app on localhost or over HTTPS.')
      return
    }
    if (video && !video.requestVideoFrameCallback) {
      setError('This browser cannot read camera frames one by one (requestVideoFrameCallback).')
      return
    }

    let frames = 0
    let windowStart = performance.now()
    const onFrame = () => {
      if (cancelled || !video) return
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        // One inference at a time: frames that arrive while the detector is busy are skipped.
        const det = detectorRef.current
        if (det && readyRef.current && !det.busy) {
          det.busy = true
          createImageBitmap(video)
            .then((bmp) => det.detect(bmp))
            .then((r) => {
              lastRef.current = { detections: r.detections, at: performance.now() }
              setStats({ inferMs: r.inferMs, boxes: r.detections.length })
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => {
              det.busy = false
            })
        }
      }
      frames += 1
      const t = performance.now()
      if (t - windowStart >= 1000) {
        setFps(Math.round((frames * 1000) / (t - windowStart)))
        frames = 0
        windowStart = t
      }
      callbackId = video.requestVideoFrameCallback!(onFrame)
    }

    navigator.mediaDevices
      .getUserMedia(CAMERA_CONSTRAINTS)
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (!video) return
        // Firefox on Android does not start a muted live stream from the autoplay
        // attribute alone, so set muted on the element and call play() explicitly.
        video.muted = true
        video.srcObject = s
        video
          .play()
          .then(() => {
            callbackId = video.requestVideoFrameCallback!(onFrame)
          })
          .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      video?.cancelVideoFrameCallback?.(callbackId)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <section>
      {/* The raw camera element is kept off-screen; only the canvas is shown. */}
      <video
        ref={videoRef}
        className="video-source"
        autoPlay
        playsInline
        muted
        data-testid="camera-video"
      />
      <canvas ref={canvasRef} className="view" data-testid="camera-canvas" />
      <p className="status" data-testid="fps">
        {fps} fps
      </p>
      <p className="status" data-testid="model-status">
        {model
          ? `${model.backend} ${model.size}px, ${stats.inferMs.toFixed(0)} ms, ${stats.boxes} boxes`
          : 'loading model'}
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
