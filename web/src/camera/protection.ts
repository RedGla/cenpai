import type { LiveStats } from './pipeline'

export type ProtectionTone = 'ok' | 'warn' | 'alert'

export interface Protection {
  /** One short line, readable at a glance. */
  label: string
  tone: ProtectionTone
  /** Smaller notes shown next to the label. */
  notes: string[]
}

/**
 * Inference slower than this is reported as "slowed down". It is a display cut-off only:
 * the pipeline already stretches its own timeouts on slow backends.
 */
export const SLOW_INFER_MS = 250

/** Turns the live pipeline numbers into the protection status shown on screen. */
export function protectionStatus(
  stats: LiveStats | null,
  cameraError: string | null = null,
): Protection {
  if (cameraError || stats?.error) {
    return { label: 'Not protecting', tone: 'alert', notes: [] }
  }
  if (!stats || stats.loading || !stats.model) {
    return { label: 'Starting, view blurred', tone: 'warn', notes: [] }
  }
  const notes: string[] = []
  if (stats.inferMs != null && stats.inferMs > SLOW_INFER_MS) notes.push('Slowed down')
  if (stats.model.interimMask) notes.push('Interim threshold')
  if (stats.shutter) {
    return { label: 'Detector catching up, view blurred', tone: 'warn', notes }
  }
  if (stats.held > 0) notes.push(`Holding ${stats.holdMs.toFixed(0)} ms`)
  const label =
    stats.plates === 0
      ? 'Watching for plates'
      : stats.plates === 1
        ? 'Covering 1 plate'
        : `Covering ${stats.plates} plates`
  return { label, tone: notes.includes('Slowed down') ? 'warn' : 'ok', notes }
}

/** Plain wording for camera start-up failures. */
export function cameraErrorText(e: unknown): string {
  const name = e instanceof Error || e instanceof DOMException ? e.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow the camera for this site in the browser settings, then reload.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No suitable camera was found on this device.'
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy. Close other apps that use it, then reload.'
    default:
      return `The camera could not start: ${e instanceof Error ? e.message : String(e)}`
  }
}
