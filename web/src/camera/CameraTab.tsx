import { useEffect, useRef, useState } from 'react'

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: false,
}

export default function CameraTab() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | undefined
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is not available. Open the app on localhost or over HTTPS.')
      return
    }
    navigator.mediaDevices
      .getUserMedia(CAMERA_CONSTRAINTS)
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        const video = videoRef.current
        if (!video) return
        // Firefox on Android does not start a muted live stream from the autoplay
        // attribute alone, so set muted on the element and call play() explicitly.
        video.muted = true
        video.srcObject = s
        video
          .play()
          .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <section>
      <video ref={videoRef} autoPlay playsInline muted data-testid="camera-video" />
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
