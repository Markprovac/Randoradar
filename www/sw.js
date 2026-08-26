const CACHE = 'rando-radar-v1.10.26-capacitor1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=1.10.26',
  './app.js?v=1.10.26',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet-rotate/leaflet-rotate.umd.min.js',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(APP_SHELL.map(async url => {
      const req = new Request(url, { cache: 'reload' });
      const resp = await fetch(req);
      if (resp.ok) await cache.put(req, resp.clone());
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(new Request(req, { cache: 'no-store' }));
    if (fresh && fresh.ok) await cache.put(req, fresh.clone());
    return fresh;
  } catch (_) {
    return (await cache.match(req)) || (await cache.match('./index.html'));
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) await cache.put(req, resp.clone());
    return resp;
  } catch (_) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  const isCore = req.mode === 'navigate' || /\.(?:html|js|css)$/.test(url.pathname);
  if (isCore) {
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(resp => {
    if (resp && resp.ok) {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return resp;
  })));
});
