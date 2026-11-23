import { useEffect, useRef, useState } from 'react'

/**
 * A drawn, looping demo of the camera screen. It never shows real camera pixels, and the
 * drawn plate is masked from the moment the car appears, the same rule the app follows.
 */
type Phase = 'boot' | 'watch' | 'enter' | 'lock' | 'exit'

const STEPS: { phase: Phase; ms: number }[] = [
  { phase: 'watch', ms: 1400 },
  { phase: 'enter', ms: 1100 },
  { phase: 'lock', ms: 3600 },
  { phase: 'exit', ms: 1300 },
]

const LABEL: Record<Phase, string> = {
  boot: 'Starting, view blurred',
  watch: 'Watching for plates',
  enter: 'Covering 1 plate',
  lock: 'Covering 1 plate',
  exit: 'Watching for plates',
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export default function HeroScene() {
  const [phase, setPhase] = useState<Phase>(() => (reducedMotion() ? 'lock' : 'boot'))
  const frameRef = useRef<HTMLSpanElement>(null)

  // Phase loop: a short blurred start once, then the car passes again and again.
  useEffect(() => {
    if (reducedMotion()) return
    let i = -1
    let timer = 0
    const next = () => {
      i = (i + 1) % STEPS.length
      setPhase(STEPS[i].phase)
      timer = window.setTimeout(next, STEPS[i].ms)
    }
    timer = window.setTimeout(next, 1500)
    return () => window.clearTimeout(timer)
  }, [])

  // Frame counter, written straight to the DOM so React does not re-render 20 times a second.
  useEffect(() => {
    if (reducedMotion()) return
    let n = 418
    const id = window.setInterval(() => {
      n += 1
      if (frameRef.current) frameRef.current.textContent = String(n).padStart(5, '0')
    }, 50)
    return () => window.clearInterval(id)
  }, [])

  const covering = phase === 'enter' || phase === 'lock'
  const tone = phase === 'boot' ? 'warn' : 'ok'

  return (
    <div className="scene" data-phase={phase} aria-hidden="true">
      <div className="scene-view">
        <svg className="scene-road" viewBox="0 0 800 500" preserveAspectRatio="none">
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#15171a" />
              <stop offset="1" stopColor="#0c0d0e" />
            </linearGradient>
            <linearGradient id="asphalt" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#121315" />
              <stop offset="1" stopColor="#1b1d20" />
            </linearGradient>
          </defs>
          <rect width="800" height="500" fill="url(#sky)" />
          <path d="M330 210 L470 210 L800 500 L0 500 Z" fill="url(#asphalt)" />
          <path d="M330 210 L0 500" stroke="#23252a" strokeWidth="1.5" />
          <path d="M470 210 L800 500" stroke="#23252a" strokeWidth="1.5" />
          <g className="lane">
            <path
              d="M400 214 L400 500"
              stroke="#383b3f"
              strokeWidth="3"
              strokeDasharray="18 26"
            />
          </g>
          <rect x="0" y="0" width="800" height="210" fill="url(#sky)" />
          <path d="M0 210 H800" stroke="#23252a" />
          <g className="skyline" fill="#111214" stroke="#1d1f23">
            <rect x="40" y="120" width="70" height="90" />
            <rect x="120" y="90" width="50" height="120" />
            <rect x="600" y="110" width="60" height="100" />
            <rect x="670" y="80" width="80" height="130" />
          </g>
        </svg>

        <div className="car">
          <svg viewBox="0 0 220 150">
            <path
              d="M38 62 Q46 22 80 18 H140 Q174 22 182 62 L198 70 Q208 74 208 88 V122 Q208 132 198 132 H22 Q12 132 12 122 V88 Q12 74 22 70 Z"
              fill="#2a2d32"
              stroke="#3d4045"
            />
            <path d="M54 60 Q60 30 84 28 H136 Q160 30 166 60 Z" fill="#17191c" />
            <rect x="18" y="80" width="44" height="12" rx="3" fill="#3a1d1f" />
            <rect x="158" y="80" width="44" height="12" rx="3" fill="#3a1d1f" />
            <rect className="tail" x="18" y="80" width="44" height="12" rx="3" />
            <rect className="tail" x="158" y="80" width="44" height="12" rx="3" />
            <rect x="22" y="132" width="34" height="14" rx="3" fill="#0b0c0d" />
            <rect x="164" y="132" width="34" height="14" rx="3" fill="#0b0c0d" />
            {/* The plate is drawn only as its mask: there is never anything to read. */}
            <rect className="mask" x="78" y="98" width="64" height="22" rx="2" />
            <g className="brackets" fill="none" strokeWidth="2">
              <path d="M70 100 V90 H80" />
              <path d="M140 90 H150 V100" />
              <path d="M150 118 V128 H140" />
              <path d="M80 128 H70 V118" />
            </g>
          </svg>
        </div>
        <div className="scan" />
      </div>

      <div className="scene-top">
        <span className={`scene-pill tone-${tone}`}>
          <span className="dot" />
          <span key={LABEL[phase]} className="scene-label">
            {LABEL[phase]}
          </span>
        </span>
        <span className="scene-chip">Works offline</span>
      </div>

      <div className="scene-meta">
        <span>
          FRAME <span ref={frameRef}>00418</span>
        </span>
        <span>WEBGPU · 640 PX</span>
        <span className={covering ? 'meta-on' : ''}>
          {covering ? 'MASKED 1' : 'MASKED 0'}
        </span>
      </div>

      <div className="scene-dock">
        <span className="scene-round" />
        <span className="scene-record">
          <span />
        </span>
        <span className="scene-round" />
      </div>
    </div>
  )
}
