import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from 'react'
import { useAppEnv } from '../camera/appEnv'
import HeroScene from './HeroScene'

interface Props {
  onOpenCamera: () => void
}

const STEPS = [
  {
    title: 'Point the camera',
    body: 'A plate detector runs on the phone itself, on its graphics chip when the browser allows, and checks the live view.',
  },
  {
    title: 'Covered before it is shown',
    body: 'A frame reaches the screen only after its plates are masked. If the detector falls behind, the whole view blurs instead of showing raw video.',
  },
  {
    title: 'Record, snap, share',
    body: 'Videos and photos are made from the censored view, so what you save is what you saw.',
  },
]

const FACTS = [
  {
    title: 'No uploads',
    body: 'The camera feed, the detector and your files stay on this device.',
    icon: 'M12 3v12m0 0l-4-4m4 4l4-4M5 21h14',
  },
  {
    title: 'No account, no tracking',
    body: 'Nothing to sign up for, and no analytics.',
    icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0M4 4l16 16',
  },
  {
    title: 'Works offline',
    body: 'After the first visit the app and its models live on the phone. Airplane mode is fine.',
    icon: 'M2 8.5a15 15 0 0120 0M5.5 12a10 10 0 0113 0M9 15.5a5 5 0 016 0M12 19h.01',
  },
  {
    title: 'Fails closed',
    body: 'While the detector loads or stalls, the whole view stays blurred. Raw video is never the fallback.',
    icon: 'M6 10V8a6 6 0 1112 0v2M5 10h14v11H5zM12 14v3',
  },
]

const FAQ = [
  {
    q: 'Does any video leave my phone?',
    a: 'No. Detection and masking run in the browser on the phone. The app makes no network calls once its files and models are loaded.',
  },
  {
    q: 'Do recordings have sound?',
    a: 'Not yet. Recordings are video only, so speech is never captured.',
  },
  {
    q: 'Which phones and browsers work?',
    a: 'It is made for Chrome on Android phones. Firefox works too. The browser picks the fastest engine it has, WebGPU first.',
  },
  {
    q: 'Can it miss a plate?',
    a: 'Yes. Very small or distant plates can be missed. Check a recording before you share it.',
  },
  {
    q: 'Is it free?',
    a: 'Yes. CenpAI is open source under the AGPL-3.0 licence.',
  },
]

const STACK = [
  'WebGPU',
  'WebAssembly',
  'ONNX Runtime',
  'YOLO detector',
  'Installable app',
]

/** Adds `in` to every [data-reveal] element as it scrolls into view. */
function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const targets = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((t) => t.classList.add('in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    )
    targets.forEach((t) => io.observe(t))
    return () => io.disconnect()
  }, [root])
}

/** Moves the card spotlight with the pointer. */
function spotlight(e: PointerEvent<HTMLElement>) {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.spot')
  if (!card) return
  const r = card.getBoundingClientRect()
  card.style.setProperty('--mx', `${e.clientX - r.left}px`)
  card.style.setProperty('--my', `${e.clientY - r.top}px`)
}

function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  )
}

/** Start page: what the app does and what it keeps private, before the camera turns on. */
export default function Landing({ onOpenCamera }: Props) {
  const env = useAppEnv()
  const rootRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState<number | null>(0)
  useReveal(rootRef)

  // Always start at the top: the browser may restore an old scroll position.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    // Jump, do not glide: the page uses smooth scrolling for its section links.
    el.style.scrollBehavior = 'auto'
    el.scrollTop = 0
    el.style.scrollBehavior = ''
  }, [])

  const envText = env.online ? (env.installed ? 'Installed' : 'In browser') : 'Offline'
  const jump = (id: string) =>
    rootRef.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div
      className="landing"
      data-testid="landing"
      ref={rootRef}
      onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
      onPointerMove={spotlight}
    >
      <div className="glow" aria-hidden="true" />

      <nav className={scrolled ? 'lnav scrolled' : 'lnav'}>
        <div className="lnav-inner">
          <span className="wordmark">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <rect x="1.5" y="1.5" width="17" height="17" rx="5" />
              <rect className="glyph-mask" x="5" y="8" width="10" height="4" rx="1" />
            </svg>
            CenpAI
          </span>
          <div className="lnav-links">
            <button onClick={() => jump('how')}>How it works</button>
            <button onClick={() => jump('privacy')}>Privacy</button>
            <button onClick={() => jump('faq')}>FAQ</button>
          </div>
          <button className="pill-white" onClick={onOpenCamera}>
            Open app
          </button>
        </div>
      </nav>

      <header className="hero">
        <div className="lwrap">
          <span className="eyebrow rise" style={{ '--d': 0 } as CSSProperties}>
            <span className="eyebrow-tag">{envText}</span>
            Runs entirely on your phone
            {env.offlineReady ? ', ready offline' : ''}
          </span>
          <h1 className="rise" style={{ '--d': 1 } as CSSProperties}>
            License plates, covered <br className="wide-br" />
            before anyone sees them.
          </h1>
          <p className="lead rise" style={{ '--d': 2 } as CSSProperties}>
            CenpAI masks plates in your camera view, live. Every frame you see, record or
            share is censored on the device first.
          </p>
          <div className="hero-actions rise" style={{ '--d': 3 } as CSSProperties}>
            <button className="cta" onClick={onOpenCamera} data-testid="open-camera">
              Open camera
            </button>
            {env.install ? (
              <button className="ghost" onClick={() => void env.install?.()}>
                Install app
              </button>
            ) : (
              <button className="textlink" onClick={() => jump('how')}>
                How it works <Arrow />
              </button>
            )}
          </div>
        </div>

        <div className="showcase">
          <div className="showcase-tilt">
            <div className="frame">
              <HeroScene />
            </div>
          </div>
          <div className="floor" aria-hidden="true" />
        </div>
      </header>

      <section className="stack" data-reveal>
        <div className="lwrap">
          <p className="stack-label">
            Built on open web tech, nothing to install from a store
          </p>
          <ul>
            {STACK.map((s, i) => (
              <li key={s} style={{ '--i': i } as CSSProperties}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how" className="lsec">
        <div className="lwrap split">
          <div data-reveal>
            <span className="kicker">How it works</span>
            <h2>Detect first. Show second.</h2>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.title} style={{ '--i': i } as CSSProperties}>
                  <span className="step-num">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="pipe spot" data-reveal aria-hidden="true">
            {['Camera', 'Detector on the phone', 'Mask', 'Screen and file'].map(
              (n, i) => (
                <div className="pipe-node" key={n} style={{ '--i': i } as CSSProperties}>
                  <span className="pipe-id">{String(i + 1).padStart(2, '0')}</span>
                  {n}
                  {i === 1 && <span className="pipe-tag">on device</span>}
                  {i === 2 && <span className="pipe-tag">before display</span>}
                </div>
              ),
            )}
            <span className="pipe-line">
              <span className="pulse" />
            </span>
          </div>
        </div>
      </section>

      <section id="privacy" className="lsec">
        <div className="lwrap">
          <div data-reveal>
            <span className="kicker">Privacy</span>
            <h2>Nothing leaves the phone.</h2>
            <p className="sublead">
              The safest upload is the one that never happens. There is no server that
              receives your video: it is censored and saved on the phone.
            </p>
          </div>
          <ul className="facts">
            {FACTS.map((f, i) => (
              <li
                key={f.title}
                className="spot"
                data-reveal
                style={{ '--i': i } as CSSProperties}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={f.icon} />
                </svg>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="faq" className="lsec">
        <div className="lwrap split narrow-left">
          <div data-reveal>
            <span className="kicker">FAQ</span>
            <h2>Good to know.</h2>
          </div>
          <div className="faq" data-reveal>
            {FAQ.map((f, i) => {
              const isOpen = open === i
              return (
                <div key={f.q} className={isOpen ? 'faq-item open' : 'faq-item'}>
                  <button
                    className="faq-q"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : i)}
                  >
                    {f.q}
                    <span className="plus" aria-hidden="true" />
                  </button>
                  <div className="faq-a">
                    <p>{f.a}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="final" data-reveal>
        <div className="lwrap">
          <h2>Point. Covered. Share.</h2>
          <p className="sublead">Open the camera and try it on the street outside.</p>
          <button className="ghost big" onClick={onOpenCamera}>
            Open camera <Arrow />
          </button>
        </div>
        <div className="floor" aria-hidden="true" />
      </section>

      <footer className="lfoot">
        <div className="lwrap">
          <span className="wordmark small">CenpAI</span>
          <span className="mono">Censoring on the device · AGPL-3.0</span>
          <a href="https://github.com/RedGla/cenpai" target="_blank" rel="noreferrer">
            Source code <Arrow />
          </a>
        </div>
      </footer>
    </div>
  )
}
