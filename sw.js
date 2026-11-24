const CACHE_NAME = 'tvip-masaken-v5';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './3%20small.png',
  './js/config.js',
  './js/i18n.js',
  './js/supabase-client.js',
  './js/webrtc-cast.js',
  './js/widgets.js',
  './js/portal.js',
  './js/mobile-portal.js',
  './js/lobby.js',
  './js/staff.js',
  './js/main.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache dynamic Supabase or live weather/prayer API calls in SW
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('aladhan.com')
  ) {
    return;
  }

  // Same-origin app files: Network-First so updates land immediately, offline falls back to cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // External static CDN libraries/fonts: Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});

