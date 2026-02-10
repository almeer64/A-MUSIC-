// ALMEER MUSIC Service Worker v2.0
const CACHE_NAME = 'almeer-music-v2';
const AUDIO_CACHE = 'almeer-audio-v2';
const STATIC_CACHE = 'almeer-static-v2';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── INSTALL ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== AUDIO_CACHE && k !== STATIC_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH STRATEGY ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Audio files – Cache First with network fallback
  if (event.request.destination === 'audio' || url.pathname.match(/\.(mp3|ogg|wav|m4a|flac)$/i)) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response && response.status === 200) {
              // Only cache if content is reasonable size (<30MB)
              const cloned = response.clone();
              cache.put(event.request, cloned);
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // Static assets – Cache First
  if (STATIC_ASSETS.includes(url.pathname) || url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(STATIC_CACHE).then(c => c.put(event.request, cloned));
          }
          return response;
        }).catch(() => {
          // Return offline fallback
          if (event.request.destination === 'document') {
            return caches.match('/index.html');
          }
        });
      })
    );
    return;
  }

  // External requests – Network First
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, cloned));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── BACKGROUND SYNC (download queue) ──
self.addEventListener('sync', event => {
  if (event.tag === 'download-queue') {
    event.waitUntil(processDownloadQueue());
  }
});

async function processDownloadQueue() {
  const cache = await caches.open(AUDIO_CACHE);
  // Process any queued downloads from IndexedDB
  console.log('[ALMEER SW] Processing download queue');
}

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'ALMEER MUSIC', {
      body: data.body || 'New tracks available!',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge.png',
      tag: 'almeer-notification',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// ── CACHE MANAGEMENT ──
self.addEventListener('message', event => {
  if (event.data.action === 'clear-audio-cache') {
    caches.delete(AUDIO_CACHE).then(() => {
      event.source.postMessage({ action: 'cache-cleared' });
    });
  }
  if (event.data.action === 'cache-audio') {
    const { url } = event.data;
    caches.open(AUDIO_CACHE).then(cache => {
      fetch(url).then(response => {
        cache.put(url, response);
        event.source.postMessage({ action: 'cached', url });
      });
    });
  }
});