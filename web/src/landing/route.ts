export type View = 'landing' | 'camera'

export const SEEN_KEY = 'cenpai.intro.seen'

/**
 * Which view to open. `?about` always shows the start page. `?camera` (the installed app's
 * start address) and `?debug=1` open the camera. Otherwise the start page shows until the
 * camera has been opened once on this device.
 */
export function initialView(search: string, seen: boolean): View {
  const q = new URLSearchParams(search)
  if (q.has('about')) return 'landing'
  if (q.has('camera') || q.get('debug') === '1') return 'camera'
  return seen ? 'camera' : 'landing'
}

export function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // Private mode: the start page shows again next time, which is fine.
  }
}
