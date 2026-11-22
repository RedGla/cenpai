import { useAppEnv } from '../camera/appEnv'

interface Props {
  onOpenCamera: () => void
}

const STEPS = [
  {
    title: 'Point the camera',
    body: 'A plate detector runs on the phone itself and checks every frame.',
  },
  {
    title: 'Plates are covered first',
    body: 'A frame is shown only after its plates are masked. If the detector falls behind, the whole view blurs instead.',
  },
  {
    title: 'Record or take a photo',
    body: 'Videos and photos are made from the censored view, so they are ready to share.',
  },
]

/** Start page: what the app does and what it keeps private, before the camera turns on. */
export default function Landing({ onOpenCamera }: Props) {
  const env = useAppEnv()
  const envText = env.online ? (env.installed ? 'Installed' : 'In browser') : 'Offline'

  return (
    <div className="landing" data-testid="landing">
      <header className="landing-bar">
        <span className="wordmark">CenpAI</span>
        <span className="chip">
          {envText}
          {env.offlineReady ? ', works offline' : ''}
        </span>
      </header>

      <section className="hero">
        <h1>License plates covered before anyone sees them.</h1>
        <p className="lead">
          CenpAI masks license plates in your phone&apos;s camera view, live. Everything
          you see, record or share is already censored.
        </p>
        <div className="hero-actions">
          <button className="primary" onClick={onOpenCamera} data-testid="open-camera">
            Open camera
          </button>
          {env.install && (
            <button className="btn" onClick={() => void env.install?.()}>
              Install app
            </button>
          )}
        </div>
        <p className="caption">
          The browser asks for camera access when the camera opens.
        </p>
      </section>

      {/* A drawing, not a camera frame: the page never shows real camera pixels. */}
      <div className="mock" aria-hidden="true">
        <div className="mock-road" />
        <div className="mock-car">
          <div className="mock-window" />
          <div className="mock-plate" />
        </div>
        <span className="mock-pill">
          <span className="dot" />
          Covering 1 plate
        </span>
        <span className="mock-record" />
      </div>

      <section className="landing-section">
        <h2>How it works</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="step-num">{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p className="muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section">
        <h2>Nothing leaves the phone</h2>
        <ul className="facts">
          <li>
            <h3>No uploads</h3>
            <p className="muted">
              The camera feed, the plate detector and your files stay on this device.
            </p>
          </li>
          <li>
            <h3>No account, no tracking</h3>
            <p className="muted">There is nothing to sign up for and no analytics.</p>
          </li>
          <li>
            <h3>Works offline</h3>
            <p className="muted">
              After the first visit the app and its models are stored on the phone, so it
              also works in airplane mode.
            </p>
          </li>
        </ul>
      </section>

      <section className="landing-section">
        <h2>Good to know</h2>
        <ul className="notes">
          <li>Recordings have no sound.</li>
          <li>Made for Chrome on Android phones. Firefox works too.</li>
          <li>
            Very small or distant plates can be missed. Check a recording before you share
            it.
          </li>
        </ul>
        <button className="btn wide" onClick={onOpenCamera}>
          Open camera
        </button>
      </section>

      <footer className="landing-foot">
        <span>CenpAI</span>
        <a href="https://github.com/RedGla/cenpai" target="_blank" rel="noreferrer">
          Open source, AGPL-3.0
        </a>
      </footer>
    </div>
  )
}
