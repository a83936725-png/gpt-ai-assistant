/* 旅圖 eSIM service worker: lets the installed app open and work offline.
 * Pages, scripts and data are fetched from the network first (so an update shows up at once) and
 * fall back to the cache offline. Photos, icons and libraries are served from the cache first. */
const CACHE = 'travel-v1';
const SHELL = [
  './', 'travel-app.js', 'travel-data.js', 'travel-photos.json', 'manifest.webmanifest',
  'vendor/d3.min.js', 'vendor/topojson-client.min.js', 'vendor/Sortable.min.js', 'vendor/countries-50m.json',
  'travel-icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const LASTING = /\/(travel-photos|travel-icons|vendor)\//;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (LASTING.test(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
      return res;
    })));
    return;
  }
  event.respondWith(fetch(request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
    return res;
  }).catch(() => caches.match(request).then((hit) => hit || caches.match('./'))));
});
