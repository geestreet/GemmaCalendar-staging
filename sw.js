// Gemma Schedule — Service Worker
const VERSION = '1.2';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// ─── WEB PUSH (background notifications from Cloudflare Worker) ─────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: "Gemma's Schedule", body: e.data.text() }; }

  e.waitUntil(
    self.registration.showNotification(data.title || "⏰ Gemma's Schedule", {
      body: data.body || '',
      icon: data.icon || './icon-192.png',
      badge: data.badge || './icon-192.png',
      tag: data.tag || 'gemma-notif',
      renotify: true,
      requireInteraction: false,
      vibrate: [200, 100, 200],
    })
  );
});

// ─── LEGACY: postMessage from page (when app is open) ───────────────────────
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag } = e.data;
    e.waitUntil(
      self.registration.showNotification(title, {
        body,
        tag,
        renotify: true,
        icon: './icon-192.png',
        badge: './icon-192.png',
        vibrate: [200, 100, 200],
        requireInteraction: false,
      })
    );
  }
});

// Tap notification → open the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('GemmaCalendar') && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});
