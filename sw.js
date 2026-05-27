// Adapt service worker — v35 passthrough / cache-bust edition.
//
// This version deliberately skips ALL caching and fetch interception.
// It exists solely to:
//   1. Evict every previous Adapt cache (v30–v34) that may contain
//      a stale or broken app shell.
//   2. Claim all open clients immediately so the clean state takes
//      effect on the current tab without a reload.
//
// After the stale-cache eviction a future deploy will re-enable
// caching once the app is confirmed stable.

const CACHE_VERSION = 'adapt-v35';

self.addEventListener('install', (event) => {
  // Nothing to pre-cache — skip straight to activation.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// No fetch handler — every request goes straight to the network.
// This guarantees the browser always loads fresh HTML/assets from
// Vercel and is never served a cached broken shell.

// Allow the page to force this SW to activate immediately.
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
