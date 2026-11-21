export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported'

/** Offer the system share sheet for a file. Must be called from a click handler. */
export async function shareFile(file: File, title: string): Promise<ShareOutcome> {
  const data = { files: [file], title }
  if (typeof navigator.share !== 'function' || !navigator.canShare?.(data)) return 'unsupported'
  try {
    await navigator.share(data)
    return 'shared'
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    throw e
  }
}

export function timestampName(prefix: string, extension: string): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${prefix}-${stamp}.${extension}`
}
