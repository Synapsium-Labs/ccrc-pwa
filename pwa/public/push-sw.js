// Web Push handlers, importScripts'd into the generated service worker
// (vite.config.ts workbox.importScripts). Shows the notification and deep-links
// to the session on tap.
/* global self */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'ccrc', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'ccrc';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { sessionId: data.sessionId || null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const sid = event.notification.data && event.notification.data.sessionId;
  const url = sid ? `/s/${encodeURIComponent(sid)}` : '/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of wins) {
        if ('focus' in c) {
          try {
            await c.navigate(url);
          } catch {
            /* cross-origin or unsupported — fall through to focus */
          }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});
