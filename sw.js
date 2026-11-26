const CACHE_NAME = 'tvip-masaken-v15';
const CORE_ASSETS = [
  './',
  './index.html',
  './wall.html',
  './vendor/qrcode/qrcode.min.js?v=38',
  './vendor/fontawesome/css/all.min.css?v=38',
  './vendor/fonts/cairo.css?v=36',
  './css/app.css?v=38',
  './3%20small.png',
  './js/config.js?v=40',
  './js/i18n.js?v=40',
  './js/supabase-client.js?v=40',
  './js/webrtc-cast.js?v=40',
  './js/widgets.js?v=40',
  './js/portal.js?v=40',
  './js/mobile-portal.js?v=40',
  './js/lobby.js?v=40',
  './js/staff.js?v=40',
  './js/main.js?v=40'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => { })
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

  // Never cache dynamic API, media stream, or APK installer endpoints in SW
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/masaken.apk' ||
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
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => { });
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
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => { });
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});

