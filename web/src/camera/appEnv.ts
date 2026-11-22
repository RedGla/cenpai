import { useEffect, useState } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface AppEnv {
  online: boolean
  /** Running as an installed app (home screen), not in a browser tab. */
  installed: boolean
  /** A service worker controls the page, so the app and models load without a network. */
  offlineReady: boolean
  /** Set when the browser offers installation; call it from a tap. */
  install: (() => Promise<void>) | null
}

function isInstalled(): boolean {
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return (
    standalone ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches)
  )
}

/** Online, installed and offline-ready state for the status bar, plus the install prompt. */
export function useAppEnv(): AppEnv {
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  const [installed, setInstalled] = useState(isInstalled)
  const [offlineReady, setOfflineReady] = useState(
    () => !!navigator.serviceWorker?.controller,
  )
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    const offer = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
    }
    const done = () => {
      setPrompt(null)
      setInstalled(true)
    }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    window.addEventListener('beforeinstallprompt', offer)
    window.addEventListener('appinstalled', done)
    const sw = navigator.serviceWorker
    const ready = () => setOfflineReady(!!sw?.controller)
    sw?.addEventListener('controllerchange', ready)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.removeEventListener('beforeinstallprompt', offer)
      window.removeEventListener('appinstalled', done)
      sw?.removeEventListener('controllerchange', ready)
    }
  }, [])

  const install = prompt
    ? async () => {
        await prompt.prompt()
        await prompt.userChoice.catch(() => undefined)
        setPrompt(null)
      }
    : null

  return { online, installed, offlineReady, install }
}
