import { useEffect, useRef, useState } from 'react'
import type { BackendChoice } from '../detect/protocol'
import { LivePipeline, type LiveStats } from './pipeline'

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: false,
}

export default function CameraTab() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pipelineRef = useRef<LivePipeline | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [stats, setStats] = useState<LiveStats | null>(null)
  const [size, setSize] = useState<640 | 416>(640)
  const [backend, setBackend] = useState<BackendChoice>('auto')

  // Camera and frame loop.
  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera is not available. Open the app on localhost or over HTTPS.')
      return
    }
    let cancelled = false
    let stream: MediaStream | undefined
    const pipeline = new LivePipeline(video, canvas)
    pipelineRef.current = pipeline
    pipeline.start()
    const poll = window.setInterval(() => setStats({ ...pipeline.stats }), 250)

    navigator.mediaDevices
      .getUserMedia(CAMERA_CONSTRAINTS)
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        // Firefox on Android does not start a muted live stream from the autoplay
        // attribute alone, so set muted on the element and call play() explicitly.
        video.muted = true
        video.srcObject = s
        return video.play()
      })
      .catch((e: unknown) => setCameraError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      window.clearInterval(poll)
      pipeline.stop()
      pipelineRef.current = null
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Model: loads at start and again when the user picks another size or backend.
  useEffect(() => {
    pipelineRef.current?.loadModel(size, backend)
  }, [size, backend])

  const model = stats?.model ?? null
  const shield = stats?.shutter !== false ? 'Shutter closed' : 'Shield on'

  return (
    <section>
      {/* The raw camera element is kept off-screen; only the censored canvas is shown. */}
      <video
        ref={videoRef}
        className="video-source"
        autoPlay
        playsInline
        muted
        data-testid="camera-video"
      />
      <canvas ref={canvasRef} className="view" data-testid="camera-canvas" />
      <div className="status-grid" data-testid="status">
        <span className={stats?.shutter === false ? 'pill on' : 'pill'} data-testid="shield">
          {shield}
        </span>
        <span data-testid="plates">Plates covered: {stats?.plates ?? 0}</span>
        <span data-testid="fps">{stats?.fps ?? 0} fps</span>
        <span data-testid="infer">
          {stats?.inferMs != null ? `${stats.inferMs.toFixed(0)} ms per inference` : '- ms per inference'}
        </span>
        <span data-testid="backend">
          {stats?.loading
            ? 'Loading model'
            : model
              ? `Backend: ${model.backend}, ${model.size} px`
              : 'No model'}
        </span>
        {model?.interimMask && <span data-testid="interim">interim mask threshold</span>}
      </div>
      <div className="controls">
        <label>
          Backend{' '}
          <select value={backend} onChange={(e) => setBackend(e.target.value as BackendChoice)}>
            <option value="auto">Auto (WebGPU, then WebAssembly)</option>
            <option value="webgpu">WebGPU only</option>
            <option value="wasm">WebAssembly only</option>
          </select>
        </label>
        <label>
          Input{' '}
          <select value={size} onChange={(e) => setSize(Number(e.target.value) as 640 | 416)}>
            <option value={640}>640</option>
            <option value={416}>416</option>
          </select>
        </label>
      </div>
      {(cameraError || stats?.error) && <p role="alert">{cameraError ?? stats?.error}</p>}
    </section>
  )
}
