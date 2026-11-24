/* Offline cache for 易家做媽媽 (network-first for HTML so updates show up, cache-first for assets). */
const CACHE = 'yijia-mom-v39';
const ASSETS = [
  './', 'index.html', 'config.js', 'manifest.webmanifest',
  'css/base.css', 'css/modules.css', 'css/island.css', 'css/health.css', 'css/pregnancy.css', 'css/journey.css', 'css/monitor.css', 'css/outing.css', 'css/search.css', 'css/extras.css', 'css/share.css', 'css/account.css', 'css/goods.css', 'css/diary.css', 'css/social.css', 'css/groupbuy.css', 'css/monthly.css', 'css/admin.css', 'css/family.css', 'css/recap.css', 'css/night.css', 'css/components.css', 'css/qban.css', 'css/motion.css',
  'js/core.js', 'js/vendor/qrcode.js', 'js/store.js', 'js/media.js', 'js/ui.js', 'js/app.js',
  'js/data/log-types.js', 'js/data/island-data.js', 'js/data/health-data.js', 'js/data/pregnancy-data.js', 'js/data/journey-data.js', 'js/data/outing-data.js', 'js/data/faq-data.js', 'js/data/extras-data.js', 'js/data/goods-data.js', 'js/data/sources-data.js',
  'js/modules/home.js', 'js/modules/babylog.js', 'js/modules/milk.js', 'js/modules/avatar.js', 'js/modules/qban.js', 'js/modules/island.js', 'js/modules/diary.js',
  'js/modules/health.js', 'js/modules/pregnancy.js', 'js/modules/journey.js', 'js/modules/outing.js', 'js/modules/monitor.js', 'js/modules/search.js', 'js/modules/extras.js', 'js/modules/goods.js', 'js/modules/share.js', 'js/modules/privacy.js', 'js/modules/account.js', 'js/modules/gift.js', 'js/modules/starter.js', 'js/modules/groupbuy.js', 'js/modules/social.js', 'js/modules/wall.js', 'js/modules/circle.js', 'js/modules/weekly.js', 'js/modules/monthly.js', 'js/modules/admin.js', 'js/modules/push.js', 'js/modules/family.js', 'js/modules/recap.js', 'js/modules/handoff.js', 'js/modules/night.js', 'js/modules/brand.js', 'js/modules/me.js', 'js/modules/sources.js',
  'assets/logo.svg', 'assets/logo-full.svg', 'assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png',
  // 縮圖 (0.9.4, more for 首頁 in 0.9.5): the app's own drawings, 3–9 KB each
  ...['a2hs', 'backup', 'benefits', 'brand', 'circle', 'confinement', 'contraction', 'cycle', 'family', 'fertility', 'gift', 'goods', 'groupbuy', 'growth', 'handoff', 'hospitalbag', 'invite', 'island', 'journey', 'kick', 'milestones', 'milk', 'moments', 'monitor', 'monthly', 'next', 'night', 'outing', 'postpartum', 'pregnancy', 'pregweight', 'prenatal', 'prepcheck', 'prevention', 'push', 'recap', 'records', 'search', 'stage-baby', 'stage-preg', 'stage-prep', 'starter', 'stats', 'wall', 'wave', 'weekly'].map((n) => `assets/thumbs/${n}.webp`),
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
// 手機通知 from the member server: {title, body, url ('#/…'), tag}
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (er) { d = { body: e.data ? e.data.text() : '' }; }
  const url = typeof d.url === 'string' && d.url.startsWith('#/') ? d.url : '#/home';
  e.waitUntil(self.registration.showNotification(d.title || '易家做媽媽', {
    body: d.body || '', icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', tag: d.tag || undefined, renotify: !!d.tag, data: { url },
  }));
});
// a tapped notification opens its page: in the app that is already open, or a new window
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || '#/home';
  const target = new URL(`./${hash}`, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(self.registration.scope)) || list[0];
    if (w) { w.postMessage({ type: 'open', url: hash }); return w.focus(); }
    return self.clients.openWindow(target);
  }));
});
