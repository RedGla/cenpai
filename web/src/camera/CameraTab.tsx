import { useEffect, useRef, useState } from 'react'
import type { BackendChoice, ModelSize } from '../detect/protocol'
import { parseCensorMode, type CensorMode } from './censorStyle'
import { LivePipeline, type LiveStats } from './pipeline'
import { CanvasRecorder } from './record'
import { median, percentile } from './stats'
import { shareFile, timestampName } from './share'
import { useAppEnv } from './appEnv'
import { cameraErrorText, protectionStatus } from './protection'

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

/** Optional start-up choice from the address, e.g. ?size=416&backend=wasm. */
export function initialOptions(search = window.location.search): {
  size: ModelSize
  backend: BackendChoice
} {
  const q = new URLSearchParams(search)
  const s = q.get('size')
  const size: ModelSize = s === '416' ? 416 : s === '640' ? 640 : 'auto'
  const b = q.get('backend')
  const backend: BackendChoice = b === 'webgpu' || b === 'wasm' ? b : 'auto'
  return { size, backend }
}

const INTRO_KEY = 'cenpai.intro.seen'

function introSeen(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return false
  }
}

export default function CameraTab() {
  // First run: explain the app before the browser asks for the camera.
  const [started, setStarted] = useState(introSeen)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const env = useAppEnv()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pipelineRef = useRef<LivePipeline | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [stats, setStats] = useState<LiveStats | null>(null)
  const [size, setSize] = useState<ModelSize>(() => initialOptions().size)
  const [backend, setBackend] = useState<BackendChoice>(() => initialOptions().backend)
  const [censorMode, setCensorMode] = useState<CensorMode>(() =>
    parseCensorMode(new URLSearchParams(window.location.search).get('style')),
  )
  const censorModeRef = useRef(censorMode)
  useEffect(() => {
    censorModeRef.current = censorMode
    if (pipelineRef.current) pipelineRef.current.censorMode = censorMode
  }, [censorMode])
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
    const id = window.setInterval(
      () => setSeconds(Math.floor((performance.now() - t0) / 1000)),
      250,
    )
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
      setNotice('Wait until the view is no longer blurred, then take the photo.')
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
      if (outcome === 'unsupported')
        setNotice('Sharing is not available here. Use Save instead.')
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
        replaceSaved({
          kind: 'video',
          url: URL.createObjectURL(r.blob),
          name,
          blob: r.blob,
        })
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
    if (!started || !video || !canvas) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('The camera is not available here. Open the app over HTTPS.')
      return
    }
    let cancelled = false
    let stream: MediaStream | undefined
    const debug = new URLSearchParams(window.location.search).get('debug') === '1'
    const hold = new URLSearchParams(window.location.search).get('hold') !== '0'
    const pipeline = new LivePipeline(video, canvas, debug, hold)
    pipeline.censorMode = censorModeRef.current
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
      .catch((e: unknown) => setCameraError(cameraErrorText(e)))
    return () => {
      cancelled = true
      window.clearInterval(poll)
      pipeline.stop()
      pipelineRef.current = null
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [started])

  // Model: loads at start and again when the user picks another size or backend.
  useEffect(() => {
    pipelineRef.current?.loadModel(size, backend)
  }, [size, backend, started])

  const start = () => {
    try {
      window.localStorage.setItem(INTRO_KEY, '1')
    } catch {
      // Private mode: the note shows again next time, which is fine.
    }
    setStarted(true)
  }

  const model = stats?.model ?? null
  const debug = new URLSearchParams(window.location.search).get('debug') === '1'
  const protection = protectionStatus(stats, cameraError)
  const failure = cameraError ?? stats?.error ?? null
  const minutes = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <section className="camera">
      {/* The raw camera element is kept off-screen; only the censored canvas is shown. */}
      <video
        ref={videoRef}
        className="video-source"
        autoPlay
        playsInline
        muted
        data-testid="camera-video"
      />
      <div className="stage">
        <canvas ref={canvasRef} className="view" data-testid="camera-canvas" />
      </div>

      <header className="topbar" data-testid="status">
        <div
          className={`protection tone-${protection.tone}`}
          role="status"
          aria-live="polite"
          data-testid="protection"
        >
          <span className="dot" aria-hidden="true" />
          <span className="protection-label" data-testid="shield">
            {protection.label}
          </span>
          {protection.notes.map((n) => (
            <span key={n} className="note">
              {n}
            </span>
          ))}
        </div>
        <div className="env">
          {recording && <span className="chip chip-rec">REC {minutes}</span>}
          <span className="chip" data-testid="env">
            {env.online ? (env.installed ? 'Installed' : 'In browser') : 'Offline'}
            {env.offlineReady ? ', works offline' : ''}
          </span>
        </div>
        {debug && (stats?.debug || stats?.stability || !!stats?.trackRows.length) && (
          <div className="debug-overlay" data-testid="debug-panel">
            {stats?.debug && <span data-testid="debug">{stats.debug}</span>}
            {stats?.stability && (
              <span data-testid="stability">
                {stats.stability}{' '}
                <button onClick={() => pipelineRef.current?.resetStability()}>
                  Reset counters
                </button>
              </span>
            )}
            {stats?.trackRows.map((row) => (
              <span key={row} data-testid="track-row">
                {row}
              </span>
            ))}
          </div>
        )}
      </header>

      {failure && (
        <p className="banner" role="alert">
          {failure}
        </p>
      )}

      <div className="tray">
        {notice && (
          <p className="toast" role="status">
            {notice}
          </p>
        )}
        {saved && (
          <div className="saved" data-testid="saved">
            {/* Saved files come from the censored canvas, never from the camera. */}
            {saved.kind === 'video' ? (
              <video src={saved.url} muted playsInline preload="metadata" />
            ) : (
              <img src={saved.url} alt="Censored photo" />
            )}
            <a className="btn" href={saved.url} download={saved.name}>
              Save
            </a>
            <button className="btn" onClick={share}>
              Share
            </button>
            <button
              className="btn icon-btn"
              aria-label="Close"
              onClick={() => replaceSaved(null)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <nav className="dock" aria-label="Camera controls">
        {/* Each side has room for one more button (Phase 6: mask style toggle, report). */}
        <div className="dock-side">
          <button
            className="round"
            onClick={takePhoto}
            disabled={!model || recording}
            aria-label="Take photo"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>
        </div>
        <button
          className={recording ? 'record recording' : 'record'}
          onClick={toggleRecording}
          disabled={!model && !recording}
          aria-label={recording ? `Stop recording (${seconds} s)` : 'Record video'}
          data-testid="record"
        >
          <span className="record-core" aria-hidden="true" />
        </button>
        <div className="dock-side">
          <button
            className="round"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            aria-expanded={settingsOpen}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="10" cy="17" r="2" />
            </svg>
          </button>
        </div>
      </nav>

      <div
        className="scrim"
        hidden={!settingsOpen}
        onClick={() => setSettingsOpen(false)}
      />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        hidden={!settingsOpen}
        data-testid="settings"
      >
        <div className="sheet-head">
          <h2>Settings</h2>
          <button className="btn" onClick={() => setSettingsOpen(false)}>
            Done
          </button>
        </div>

        <div className="group">
          <label className="row">
            <span>Censor style</span>
            <select
              value={censorMode}
              onChange={(e) => setCensorMode(parseCensorMode(e.target.value))}
            >
              <option value="solid">Solid (safest)</option>
              <option value="blur">Blur</option>
              <option value="pixelate">Pixelate</option>
            </select>
          </label>
          {/* Phase 6: the sound switch goes in this group. */}
          <div className="row">
            <span>Sound</span>
            <span className="muted">Off. Recordings have no sound.</span>
          </div>
        </div>

        <div className="group">
          <label className="row">
            <span>Backend</span>
            <select
              value={backend}
              onChange={(e) => setBackend(e.target.value as BackendChoice)}
            >
              <option value="auto">Auto (WebGPU, then WebAssembly)</option>
              <option value="webgpu">WebGPU only</option>
              <option value="wasm">WebAssembly only</option>
            </select>
          </label>
          <label className="row">
            <span>Input size</span>
            <select
              value={size}
              onChange={(e) =>
                setSize(
                  e.target.value === 'auto'
                    ? 'auto'
                    : (Number(e.target.value) as 640 | 416),
                )
              }
            >
              <option value="auto">Auto (640 on WebGPU, 416 on WebAssembly)</option>
              <option value={640}>640</option>
              <option value={416}>416</option>
            </select>
          </label>
        </div>

        <div className="group diag">
          <div className="row">
            <span data-testid="fps">{stats?.fps ?? 0} fps</span>
            <span data-testid="infer">
              {stats?.inferMs != null
                ? `${stats.inferMs.toFixed(0)} ms per inference`
                : '- ms per inference'}
            </span>
          </div>
          <p className="muted" data-testid="backend">
            {stats?.loading
              ? 'Loading model'
              : model
                ? `Backend: ${model.backend}, ${model.size} px, ` +
                  `isolated: ${model.isolated ? 'yes' : 'no'}, ` +
                  `threads: ${model.threads}` +
                  (model.skipped.length ? ` (skipped ${model.skipped.join('; ')})` : '')
                : 'No model'}
          </p>
          <p className="muted">
            <span data-testid="plates">Plates covered: {stats?.plates ?? 0}</span>
            {model?.interimMask && (
              <span data-testid="interim">, interim mask threshold</span>
            )}
            {stats && stats.held > 0 && (
              <span data-testid="hold">
                , holding {stats.held} frames ({stats.holdMs.toFixed(0)} ms behind)
              </span>
            )}
          </p>
          <button
            className="btn"
            onClick={runBenchmark}
            disabled={!model || recording || benchRunning}
            data-testid="bench-run"
          >
            {benchRunning ? 'Benchmarking' : 'Benchmark'}
          </button>
          {bench && (
            <p className="muted" data-testid="bench">
              Benchmark, {bench.runs} inferences, backend {bench.backend}, input{' '}
              {bench.size} px: median {bench.inferMedian.toFixed(1)} ms, 95th percentile{' '}
              {bench.inferP95.toFixed(1)} ms (whole frame incl. resize and decode: median{' '}
              {bench.totalMedian.toFixed(1)} ms)
            </p>
          )}
        </div>

        <div className="group">
          {env.install && (
            <button className="btn" onClick={() => void env.install?.()}>
              Install on this phone
            </button>
          )}
          <p className="muted">
            Nothing leaves the phone. The camera, the plate detector and your recordings
            stay on this device.
          </p>
        </div>
      </div>

      {!started && (
        <div
          className="intro"
          role="dialog"
          aria-modal="true"
          aria-labelledby="intro-title"
        >
          <div className="intro-card">
            <h1 id="intro-title">CenpAI</h1>
            <p>
              Covers license plates in the camera view, live, before anything is shown.
            </p>
            <p className="muted">
              Nothing leaves the phone. The camera, the plate detector and your recordings
              stay on this device, and the app works offline once loaded.
            </p>
            <button className="primary" onClick={start} data-testid="start">
              Start camera
            </button>
            <p className="caption">The browser will ask for camera access next.</p>
          </div>
        </div>
      )}
    </section>
  )
}
