// Adapt service worker — minimal "offline-when-installed" behavior.
//
// Strategy:
//   - Network-first for navigation requests (so we always fetch fresh app shell
//     when online), with a fallback to the cached index.html if offline.
//   - Cache-first for static same-origin assets (icon, manifest) so iOS PWA
//     installs work without re-downloading every launch.
//   - Skip caching for /api/* — those are dynamic and need fresh responses.
//
// Bump CACHE_VERSION whenever we ship a deploy that needs to invalidate the
// stale shell. We also auto-purge old caches on activate.

const CACHE_VERSION = 'adapt-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // API + cross-origin: pass through, never cache.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return; // default network behavior
  }

  // Navigation (HTML) — network first, fall back to cache when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Refresh the cached shell on every successful navigation.
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((c) => c || caches.match('/')))
    );
    return;
  }

  // Static assets — cache first.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      // Only cache successful same-origin GETs.
      if (res && res.status === 200 && req.method === 'GET') {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => cached))
  );
});

// Push handler — server-side push is out of scope for the MVP, but we wire
// the listener so adding push later doesn't require a service worker rev.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Adapt';
  const opts = {
    body: data.body || 'You have a new training update.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || 'adapt-default',
    data: data.url || '/',
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((wins) => {
      for (const win of wins) {
        if (win.url === url) return win.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
