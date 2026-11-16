import { useEffect, useRef, useState } from 'react'
import type { BackendChoice } from '../detect/protocol'
import { LivePipeline, type LiveStats } from './pipeline'
import { CanvasRecorder } from './record'
import { median, percentile } from './stats'
import { shareFile, timestampName } from './share'

interface BenchResult {
  backend: string
  size: number
  runs: number
  inferMedian: number
  inferP95: number
  totalMedian: number
}

interface Saved {
  kind: 'video' | 'photo'
  url: string
  name: string
  blob: Blob
}

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
  const recorderRef = useRef(new CanvasRecorder())
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bench, setBench] = useState<BenchResult | null>(null)
  const [benchRunning, setBenchRunning] = useState(false)

  const runBenchmark = async () => {
    const pipeline = pipelineRef.current
    if (!pipeline) return
    setNotice(null)
    setBench(null)
    setBenchRunning(true)
    try {
      const r = await pipeline.benchmark(50)
      setBench({
        backend: r.model.backend,
        size: r.model.size,
        runs: r.inferMs.length,
        inferMedian: median(r.inferMs),
        inferP95: percentile(r.inferMs, 95),
        totalMedian: median(r.totalMs),
      })
    } catch (e) {
      setNotice(`Benchmark failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBenchRunning(false)
    }
  }

  const replaceSaved = (next: Saved | null) =>
    setSaved((old) => {
      if (old) URL.revokeObjectURL(old.url)
      return next
    })

  useEffect(() => {
    if (!recording) return
    const t0 = performance.now()
    const id = window.setInterval(() => setSeconds(Math.floor((performance.now() - t0) / 1000)), 250)
    return () => window.clearInterval(id)
  }, [recording])

  // Stop recording and free the saved file when the tab closes.
  useEffect(() => {
    const recorder = recorderRef.current
    return () => recorder.cancel()
  }, [])

  const takePhoto = () => {
    const canvas = canvasRef.current
    // The canvas only ever holds a censored frame, and a closed shutter is a blurred frame.
    // A photo of the shutter is useless, so wait until the shield is on.
    if (!canvas || pipelineRef.current?.stats.shutter !== false) {
      setNotice('Wait for the shield to turn on, then take the photo.')
      return
    }
    setNotice(null)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setNotice('Could not save the photo.')
          return
        }
        replaceSaved({
          kind: 'photo',
          url: URL.createObjectURL(blob),
          name: timestampName('cenpai', 'jpg'),
          blob,
        })
      },
      'image/jpeg',
      0.92,
    )
  }

  const share = async () => {
    if (!saved) return
    try {
      const file = new File([saved.blob], saved.name, { type: saved.blob.type })
      const outcome = await shareFile(file, 'CenpAI')
      if (outcome === 'unsupported') setNotice('Sharing is not available here. Use Save instead.')
    } catch (e) {
      setNotice(`Share failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const toggleRecording = async () => {
    const recorder = recorderRef.current
    setNotice(null)
    if (recorder.recording) {
      setRecording(false)
      try {
        const r = await recorder.stop()
        const name = timestampName('cenpai', r.extension)
        replaceSaved({ kind: 'video', url: URL.createObjectURL(r.blob), name, blob: r.blob })
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e))
      }
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      recorder.start(canvas)
      setSeconds(0)
      setRecording(true)
    } catch (e) {
      setNotice(
        `Recording failed: ${e instanceof Error ? e.message : String(e)} ` +
          'Use the phone screen recorder instead.',
      )
    }
  }

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
      <div className="controls">
        <button onClick={toggleRecording} disabled={!model && !recording}>
          {recording ? `Stop (${seconds} s)` : 'Record video'}
        </button>
        <button onClick={takePhoto} disabled={!model || recording}>
          Take photo
        </button>
        <button onClick={runBenchmark} disabled={!model || recording || benchRunning}>
          {benchRunning ? 'Benchmarking' : 'Benchmark'}
        </button>
      </div>
      {bench && (
        <p className="status" data-testid="bench">
          Benchmark, {bench.runs} inferences, backend {bench.backend}, input {bench.size} px:
          median {bench.inferMedian.toFixed(1)} ms, 95th percentile {bench.inferP95.toFixed(1)} ms
          (whole frame incl. resize and decode: median {bench.totalMedian.toFixed(1)} ms)
        </p>
      )}
      <p className="status">Video only: live audio is not censored yet.</p>
      {notice && <p role="status">{notice}</p>}
      {saved && (
        <div className="saved" data-testid="saved">
          {saved.kind === 'video' ? (
            <video src={saved.url} controls playsInline />
          ) : (
            <img src={saved.url} alt="Censored photo" />
          )}
          <div className="controls">
            <a href={saved.url} download={saved.name}>
              Save {saved.name}
            </a>
            <button onClick={share}>Share</button>
          </div>
        </div>
      )}
      {(cameraError || stats?.error) && <p role="alert">{cameraError ?? stats?.error}</p>}
    </section>
  )
}
