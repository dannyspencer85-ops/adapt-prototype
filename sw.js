// Adapt service worker — offline-capable app shell with GitHub Pages support.
//
// Strategy:
//   - Network-first for navigation (always fetch fresh shell when online),
//     fall back to cached index.html when offline.
//   - Cache-first for static same-origin assets (icon, manifest).
//   - Skip /api/* — dynamic, never cache.
//
// Uses self.registration.scope so paths work on any hosting prefix
// (e.g. /adapt-prototype/ on GitHub Pages or / on a custom domain).
//
// Bump CACHE_VERSION on every deploy to bust stale shells.

const CACHE_VERSION = 'adapt-v33';

function appShell() {
  const s = self.registration.scope; // e.g. "https://host/adapt-prototype/"
  return [s, s + 'index.html', s + 'manifest.json', s + 'icon.svg', s + 'apple-touch-icon.png', s + 'icon-192.png', s + 'icon-512.png'];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(appShell()).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // API + cross-origin: pass through, never cache.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // Navigation — network first, cached shell as offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          const scope = self.registration.scope;
          caches.open(CACHE_VERSION)
            .then((cache) => cache.put(scope + 'index.html', copy))
            .catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(self.registration.scope + 'index.html')
            .then((c) => c || caches.match(self.registration.scope))
        )
    );
    return;
  }

  // Static assets — cache first.
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        if (res && res.status === 200 && req.method === 'GET') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached)
    )
  );
});

// Push notification handler — server side push can call this once VAPID is configured.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Adapt';
  const opts = {
    body: data.body || 'You have a new training update.',
    icon: self.registration.scope + 'icon.svg',
    badge: self.registration.scope + 'icon.svg',
    tag: data.tag || 'adapt-default',
    data: data.url || self.registration.scope,
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

// Allow the page to force this SW to activate immediately (skip the waiting
// state) when a new version is detected. Prevents stuck "waiting" SW from
// keeping the app on a stale/broken cached shell.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((wins) => {
      for (const win of wins) {
        if (win.url === url) return win.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
