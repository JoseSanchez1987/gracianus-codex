const CACHE_NAME = 'gracianus-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './pwa.js',
  './data.js',
  './temas_data.js',
  './latin_data.js',
  './pe_data.js',
  './latin.json',
  './data.json',
  './CODIGO.json',
  './praedicate_evangelium.json',
  './esquemas.html',
  './formularios.html',
  './interpretaciones.html',
  './privacidad.html',
  './esquema-ordinario.html',
  './esquema-documental.html',
  './esquema-breve.html',
  './manifest.webmanifest',
  './portada.jpg',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

// Install Event — Pre-caching static assets & JSON files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url))
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate Event — Cleanup old caches & claim clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event — Robust Caching Strategy
self.addEventListener('fetch', event => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip tracking / analytics scripts
  if (url.hostname.includes('tail40fd36.ts.net')) return;

  // Strategy 1: Data files (.json) -> Stale-While-Revalidate with Cache Fallback
  // Ensures offline access is instant while keeping data fresh when online
  if (url.pathname.endsWith('.json')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(request).then(cachedResponse => {
          const fetchPromise = fetch(request)
            .then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);

          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // Strategy 2: Static assets (HTML, CSS, JS, Images, Fonts) -> Cache First with Network Fallback
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then(networkResponse => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });

          return networkResponse;
        })
        .catch(() => {
          // If offline and requesting an HTML page, fallback to index.html
          if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html') || caches.match('./');
          }
        });
    })
  );
});
