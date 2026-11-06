const CACHE_NAME = 'gracianus-v8';

// Relative URLs resolved against sw.js scope (works both in local dev and GitHub Pages subdirectory).
const SCOPE_URL = './';
const START_URL = './index.html';

const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './pwa.js',
  './data_multilingue_final.json',
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

const STATIC_ASSETS = urlsToCache;

// Install Event — Pre-caching static assets & JSON files with relative URLs
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        urlsToCache.map(url => cache.add(url))
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
            console.log('[SW] Purgando caché obsoleta:', key);
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
        return cache.match(request, { ignoreSearch: true }).then(cachedResponse => {
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

  // Strategy 0: Manifest & install icons -> Network First (never stale).
  // Chrome hashes the icon it downloads and the WebAPK server re-downloads it;
  // a stale cached copy produces a hash mismatch and aborts WebAPK minting.
  if (url.pathname.endsWith('.webmanifest') || /\/assets\/icon-\d+\.png$/.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(request, { ignoreSearch: true })
          .then(cached => cached || Response.error()))
    );
    return;
  }

  // Strategy 1b: Navigations (incl. start_url) -> Cache First, always resolves to a valid 200 Response
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request, { ignoreSearch: true })
        .then(cached => cached || fetch(request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic' && !networkResponse.redirected) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return networkResponse;
        }))
        .catch(() => caches.match(START_URL)
          .then(r => r || caches.match(SCOPE_URL)))
        .then(response => response ? cleanRedirect(response) : Response.error())
    );
    return;
  }

  // Strategy 2: Static assets (CSS, JS, Images, Fonts) -> Cache First with Network Fallback
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then(networkResponse => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });

          return networkResponse;
        })
        .catch(() => Response.error());
    })
  );
});

// A response obtained through a redirect cannot be served to a navigation
// request (redirect mode "manual"); rebuild it as a clean, non-redirected Response.
function cleanRedirect(response) {
  if (!response.redirected) return response;
  return response.blob().then(body => new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  }));
}
