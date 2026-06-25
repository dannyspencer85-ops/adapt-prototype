// Adapt service worker — v54
//
// Responsibilities:
//   1. Evict stale caches on activate so PWA clients pick up the latest index.html.
//   2. Claim all clients immediately so no manual reload is needed.
//   3. Receive and display Web Push notifications.
//   4. Handle notification clicks — focus existing window or open new one,
//      then post a NAVIGATE message so the app routes to the right screen.

const CACHE_VERSION = 'adapt-v54';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// No fetch handler — all requests go straight to the network.

// Page can force immediate activation.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Push notifications ────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'Adapt', body: event.data.text() };
  }

  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'adapt-notification',
    renotify: data.renotify || false,
    requireInteraction: data.requireInteraction || false,
    silent: false,
    data: {
      url: data.url || '/',
      notificationType: data.notificationType || 'general',
    },
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Adapt', options)
  );
});

// ── Notification click ────────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';
  const origin = self.location.origin;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If the app is already open, focus it and post a NAVIGATE message.
        for (const client of clientList) {
          if (client.url.startsWith(origin) && 'focus' in client) {
            client.focus();
            client.postMessage({ type: 'NAVIGATE', url: targetUrl });
            return;
          }
        }
        // Otherwise open a new window.
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
