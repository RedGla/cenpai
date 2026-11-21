// CenpAI service worker. The build fills in the file list and version (see swPlugin.ts).
// At install it downloads the whole app, the onnxruntime-web files and both plate models, so
// after one online load the installed app runs with no network. Cached responses keep the
// headers they were served with, including the cross-origin isolation headers.
/* eslint-disable no-restricted-globals */
const PRECACHE = __PRECACHE__
const CACHE = 'cenpai-' + __VERSION__

// Every precached file is same-origin and static, so a server's Vary header (vite preview
// sends Vary: Origin, and module scripts carry an Origin header) must not cause a miss.
const MATCH = { ignoreVary: true }
const scoped = (path) => new URL(path, self.registration.scope).href

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(PRECACHE.map((p) => new Request(scoped(p), { cache: 'reload' }))),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('cenpai-') && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    // Any page address (with ?debug=1 and the like) opens the cached app.
    event.respondWith(
      caches
        .open(CACHE)
        .then((c) => c.match(scoped(''), MATCH).then((hit) => hit || fetch(req))),
    )
    return
  }
  event.respondWith(
    caches.open(CACHE).then((c) => c.match(req, MATCH).then((hit) => hit || fetch(req))),
  )
})
