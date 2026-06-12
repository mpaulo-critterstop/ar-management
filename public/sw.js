const CACHE_NAME = 'critterstop-fp-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept navigation requests to /my-performance
  // Let everything else (API calls, other pages) pass through natively
  if (event.request.mode === 'navigate' && url.pathname.startsWith('/my-performance')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For all other requests — do NOT intercept, let browser handle natively
  // This prevents SW from breaking API calls and other Hub pages
});
