/* TOEIC 900 SW v3 */
const SW_VERSION = 'toeic900-v3-3';
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.webmanifest',
  './data/vocab.js',
  './data/listen.js',
  './data/dictation.js',
  './audio/manifest.json',
  './icon192.png',
  './icon180.png',
  './icon.svg',
  './icon512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SW_VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SW_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Audio: cache-on-play (network first, then cache)
  if (url.pathname.includes('/audio/')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SW_VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // App shell / data: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SW_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
