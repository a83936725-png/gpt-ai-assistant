/* Offline cache for 易家做媽媽 (network-first for HTML so updates show up, cache-first for assets). */
const CACHE = 'yijia-mom-v8';
const ASSETS = [
  './', 'index.html', 'config.js', 'manifest.webmanifest',
  'css/base.css', 'css/modules.css', 'css/island.css', 'css/health.css', 'css/pregnancy.css', 'css/journey.css', 'css/monitor.css', 'css/outing.css', 'css/search.css', 'css/extras.css', 'css/share.css', 'css/account.css', 'css/goods.css', 'css/motion.css',
  'js/core.js', 'js/vendor/qrcode.js', 'js/store.js', 'js/ui.js', 'js/app.js',
  'js/data/log-types.js', 'js/data/island-data.js', 'js/data/health-data.js', 'js/data/pregnancy-data.js', 'js/data/journey-data.js', 'js/data/outing-data.js', 'js/data/faq-data.js', 'js/data/extras-data.js', 'js/data/goods-data.js',
  'js/modules/home.js', 'js/modules/babylog.js', 'js/modules/milk.js', 'js/modules/island.js',
  'js/modules/health.js', 'js/modules/pregnancy.js', 'js/modules/journey.js', 'js/modules/outing.js', 'js/modules/monitor.js', 'js/modules/search.js', 'js/modules/extras.js', 'js/modules/goods.js', 'js/modules/share.js', 'js/modules/account.js', 'js/modules/brand.js', 'js/modules/me.js',
  'assets/logo.svg', 'assets/logo-full.svg', 'assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin || new URL(req.url).pathname.includes('/api/')) return; // never cache the member API
  const isPage = req.mode === 'navigate';
  e.respondWith(
    (isPage
      ? fetch(req).then((res) => { caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
      : fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => caches.match(req))),
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('./'))));
});
