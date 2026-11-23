// Builds the list of files the service worker downloads at install, so the app, the
// onnxruntime-web files and both plate models work with no network after one online load.

/**
 * Files never precached: source maps, the service worker itself, and models other than the
 * shipped `models/plate-*` (developer-only models such as `?model=r1c` load on demand).
 */
export function shouldPrecache(path: string): boolean {
  if (path.startsWith('models/') && !path.startsWith('models/plate-')) return false
  return !path.endsWith('.map') && path !== 'sw.js' && !path.startsWith('.')
}

/**
 * Paths relative to the service worker's scope. The empty string is the app's start page.
 * `index.html` is left out: the start page is cached under the scope URL instead.
 */
export function precacheList(bundleFiles: string[], publicFiles: string[]): string[] {
  const files = new Set<string>([''])
  for (const f of [...bundleFiles, ...publicFiles]) {
    const p = f.replaceAll('\\', '/').replace(/^\/+/, '')
    if (p && p !== 'index.html' && shouldPrecache(p)) files.add(p)
  }
  return [...files].sort()
}

/** Fills the service worker template with the file list and the cache version. */
export function renderServiceWorker(
  template: string,
  files: string[],
  version: string,
): string {
  if (!template.includes('__PRECACHE__') || !template.includes('__VERSION__')) {
    throw new Error('service worker template is missing a placeholder')
  }
  return template
    .replace('__PRECACHE__', JSON.stringify(files))
    .replace('__VERSION__', JSON.stringify(version))
}
