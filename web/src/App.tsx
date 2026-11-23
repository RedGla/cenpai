import { useEffect, useState } from 'react'
import CameraTab from './camera/CameraTab'
import Landing from './landing/Landing'
import { initialView, markSeen, readSeen, type View } from './landing/route'
import './landing/landing.css'

export default function App() {
  const [view, setView] = useState<View>(() =>
    initialView(window.location.search, readSeen()),
  )

  // Back and forward move between the start page and the camera.
  useEffect(() => {
    const onPop = () => setView(initialView(window.location.search, readSeen()))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = (next: View) => {
    if (next === 'camera') markSeen()
    window.history.pushState(null, '', next === 'camera' ? '?camera' : '?about')
    setView(next)
  }

  return (
    <main className="app">
      {view === 'landing' ? (
        <Landing onOpenCamera={() => go('camera')} />
      ) : (
        <CameraTab onAbout={() => go('landing')} />
      )}
    </main>
  )
}
