// 手機通知 (js/modules/push.js, 提醒設定, sw.js): what the card says on each kind of phone (no server key, not logged
// in, iPhone not on the home screen, blocked), turning it on (the subscription goes to the server with the topics),
// changing topics, the test notification, turning it off, logging out (the server is told while the token is there).
// Reminders go to the server as kinds and times only (feed / appt / chicken), and the local checker does not show them
// twice. A tapped notification opens its page; the team page offers 「有人加入、成團時通知我」.
// The browser's push service and the member server are stood in for (route mocks), so this runs on a static copy.
// Usage: BASE=http://localhost:8731/ AXE_PATH=<axe.min.js> node tests/push.playwright.cjs
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8731/';
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const NOW = '2026-11-22T14:19:03+08:00';
const KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

(async () => {
  const b = await chromium.launch();
  const mk = async ({ push = KEY, ua = null, perm = true, width = 390, height = 844, line = false } = {}) => {
    const c = await b.newContext({ viewport: { width, height }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', ...(ua ? { userAgent: ua } : {}) });
    await c.clock.install({ time: new Date(NOW) });
    await c.addInitScript((granted) => {
      window.__noShareMoments = true; window.open = () => null;
      // headless Chromium has no notification permission prompt: stand in for the person's answer
      if (window.Notification && granted) {
        Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
        Notification.requestPermission = async () => 'granted';
      }
      // a stand-in push service: one subscription per page, with an address at a real push host
      if (window.PushManager) {
        let sub = null;
        const make = (opts) => ({
          endpoint: `https://fcm.googleapis.com/fcm/send/test-${Math.random().toString(36).slice(2, 10)}`, options: opts,
          toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BTestP256dhKey_abc', auth: 'testAuth-1' } }; },
          unsubscribe: async () => { sub = null; window.__unsubscribed = (window.__unsubscribed || 0) + 1; return true; },
        });
        PushManager.prototype.subscribe = async function (opts) { sub = make(opts); window.__subscribed = (window.__subscribed || 0) + 1; return sub; };
        PushManager.prototype.getSubscription = async function () { return sub; };
      }
      window.__shown = [];
      if (window.ServiceWorkerRegistration) {
        ServiceWorkerRegistration.prototype.showNotification = async function (title, o) { window.__shown.push({ title, body: o && o.body }); };
      }
    }, perm);
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    // a stand-in member server
    const calls = []; const pol = { v: '2026-01-01' }; // the app's own policy version, read once the page is up
    await p.route('**/api/**', async (route) => {
      const req = route.request(); const path = new URL(req.url()).pathname.replace(/^.*\/api\//, '');
      let body = null; try { body = req.postDataJSON(); } catch (e) { body = null; }
      calls.push({ path, body, auth: req.headers().authorization || '' });
      const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
      if (path === 'config') return json({ providers: { password: true, line: false }, storage: 'memory', social: true, policy: pol.v, verify: { email: false, phone: false }, push, lineNotify: line });
      if (path === 'me') return json({ user: { id: 'u1', nickname: '小美', provider: 'email', code: 'ABC123', consent: pol.v, verified: true, invite: {} } });
      if (path === 'stats') return json({ online: 3, registered: 10, todaySignups: 1, storage: 'memory' });
      if (path.startsWith('push/test')) return json({ ok: true, result: 'sent' });
      if (path.startsWith('push/')) return json({ ok: true, topics: body && body.topics, jobs: body && body.jobs ? body.jobs.length : 0 });
      if (path.startsWith('groupbuy')) return json({ campaigns: [], mine: {} });
      return json({ ok: true });
    });
    await p.goto(BASE);
    await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.push);
    pol.v = await p.evaluate(() => App.privacy.VERSION);
    await p.click('text=先看看範例資料'); await p.waitForTimeout(800);
    await p.evaluate(() => { App.isNight = () => false; App.applyTheme(); App.store.update((s) => { s.settings.a2hsDismissed = '1'; }); });
    await p.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready);
    return { p, calls };
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, screen, ms = 900) => { await S(p, (x) => App.navigate(x), screen); await p.waitForTimeout(ms); };
  const card = (p) => S(p, () => { const c = document.querySelector('.push-card'); return c ? { text: c.innerText.replace(/\s+/g, ' '), why: (c.querySelector('.push-why') || {}).dataset ? c.querySelector('.push-why').dataset.why : '', on: !!c.querySelector('.push-on'), topics: [...c.querySelectorAll('.push-topic input')].map((x) => `${x.dataset.topic}:${x.checked}`) } : null; });
  const waitCard = async (p) => { await p.waitForFunction(() => { const c = document.querySelector('.push-card'); return c && !/讀取中/.test(c.innerText); }, null, { timeout: 8000 }).catch(() => {}); return card(p); };
  const toast = (p) => S(p, () => (document.querySelector('.toast-wrap') || {}).innerText || '').then((t) => t.replace(/\s+/g, ' ').trim());
  const login = (p) => S(p, () => App.store.update((s) => { s.auth = { token: 'tok-test-1', user: { id: 'u1', nickname: '小美', provider: 'email', code: 'ABC123', consent: App.privacy.VERSION, verified: true, invite: {} } }; }));
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };

  /* ---------- 1. what the card says before it can be turned on ---------- */
  const { p: P, calls } = await mk();
  await go(P, 'reminders');
  let cd = await waitCard(P);
  ok('not logged in: the card says notifications need a member account, with 登入', cd && cd.why === 'login' && /登入會員後/.test(cd.text) && /登入／註冊/.test(cd.text), JSON.stringify(cd));
  ok('the old note about 「之後的版本」 is gone; the page says how reminders work with and without it', /App 關著也會收到提醒/.test(await S(P, () => document.querySelector('.disclaimer').innerText)));
  await axe(P, 'reminders with the 手機通知 card (logged out)');
  const { p: Q } = await mk({ push: null });
  await login(Q); await go(Q, 'reminders');
  cd = await waitCard(Q);
  ok('a site without the push key (the web preview): it says so', cd && cd.why === 'no-server' && /還沒有開啟推播通知/.test(cd.text), JSON.stringify(cd));
  const { p: I } = await mk({ ua: IPHONE });
  await login(I); await go(I, 'reminders');
  cd = await waitCard(I);
  ok('iPhone in Safari (not on the home screen): how to add it first', cd && cd.why === 'ios-home' && /加入主畫面/.test(cd.text), JSON.stringify(cd));

  /* ---------- 2. turning it on, topics, test, off ---------- */
  await login(P); await go(P, 'reminders');
  cd = await waitCard(P);
  ok('logged in: 「開啟手機通知」 and what it brings', cd && cd.on && /團購進度、餵奶與預約提醒、家人共用/.test(cd.text), JSON.stringify(cd));
  await P.click('.push-on'); await P.waitForTimeout(900);
  const subCall = calls.filter((c) => c.path === 'push/subscribe').pop();
  ok('the subscription goes to the server with every topic on, as the member', subCall && /^https:\/\/fcm\.googleapis\.com\//.test(subCall.body.sub.endpoint) && subCall.body.sub.keys.auth === 'testAuth-1' && JSON.stringify(subCall.body.topics) === '{"gb":true,"remind":true,"family":true}' && subCall.auth === 'Bearer tok-test-1', JSON.stringify(subCall));
  ok('the push service was asked with the server key and visible notifications only', await S(P, async () => { const r = await navigator.serviceWorker.ready; const s = await r.pushManager.getSubscription(); return !!s && s.options.userVisibleOnly === true && s.options.applicationServerKey.length === 65; }));
  cd = await card(P);
  ok('on: three switches (團購進度、提醒、家人共用), a test button and 關閉', cd.topics.join() === 'gb:true,remind:true,family:true' && /傳一則測試通知/.test(cd.text) && /關閉/.test(cd.text), JSON.stringify(cd));
  ok('…and the card says only kinds and times go to the server', /預約的內容不會離開這支手機/.test(cd.text));
  await P.screenshot({ path: SHOT ? `${SHOT}push-on.png` : '/dev/null' }).catch(() => {});
  await axe(P, '手機通知 on');
  await P.click('.push-topic:has(input[data-topic="gb"])'); await P.waitForTimeout(700);
  const t2 = calls.filter((c) => c.path === 'push/subscribe').pop();
  ok('turning 團購進度 off tells the server (the others stay on)', t2.body.topics.gb === false && t2.body.topics.remind === true && await S(P, () => App.store.state.settings.push.topics.gb === false), JSON.stringify(t2.body.topics));
  await P.click('.push-test'); await P.waitForTimeout(500);
  ok('傳一則測試通知', calls.some((c) => c.path === 'push/test') && /已傳一則測試通知/.test(await toast(P)), await toast(P));

  /* ---------- 3. reminders: kinds and times only ---------- */
  await S(P, () => App.store.update((s) => {
    s.reminders.forEach((r) => { r.enabled = true; if (r.type === 'feed') { r.mode = 'fixed'; r.minutes = 180; } if (r.type === 'chicken') r.time = '21:00'; if (r.type === 'appt') r.time = '08:30'; });
    s.logs.push({ id: 'visit-t', babyId: s.activeBabyId, type: 'visit', start: new Date().toISOString(), end: null, data: { followUp: '2026-11-24', clinic: '安安小兒科', reason: '發燒回診' }, note: '' });
  }));
  await P.waitForTimeout(3500);
  const sch = calls.filter((c) => c.path === 'push/schedule').pop();
  const jobs = sch ? sch.body.jobs : [];
  const kinds = jobs.map((j) => j.kind);
  const lastFeed = await S(P, () => new Date(App.store.lastLog(['breast', 'bottle']).start).getTime());
  const feed = jobs.find((j) => j.kind === 'feed'); const chick = jobs.find((j) => j.kind === 'chicken');
  ok('the phone\'s reminders go to the server: 餵奶 (last feed + 3 h), 滴雞精 daily at 21:00, 預約 on the days with one', feed && feed.at === lastFeed + 3 * 3600e3 && chick && chick.daily === true && new Date(chick.at).toISOString() === '2026-11-22T13:00:00.000Z' && kinds.includes('appt'), JSON.stringify(jobs));
  ok('appointments: the day before and the day of the follow-up, at 08:30', jobs.filter((j) => j.kind === 'appt').map((j) => new Date(j.at).toISOString()).join() === '2026-11-23T00:30:00.000Z,2026-11-24T00:30:00.000Z', JSON.stringify(jobs.filter((j) => j.kind === 'appt')));
  ok('nothing about what the appointment is (clinic, reason, names) is sent', !/安安|發燒|小乖|回診/.test(JSON.stringify(sch && sch.body)), JSON.stringify(sch && sch.body));
  const n0 = calls.filter((c) => c.path === 'push/schedule').length;
  await S(P, () => App.store.update((s) => { s.settings.theme = s.settings.theme === 'auto' ? 'auto' : 'auto'; }));
  await P.waitForTimeout(3200);
  ok('an unrelated change does not send the same reminders again', calls.filter((c) => c.path === 'push/schedule').length === n0);
  // the local checker: no second system notification, a note on the open screen instead
  await S(P, () => { localStorage.removeItem('yijia-mom-notified'); App.store.update((s) => { s.logs.filter((l) => l.type === 'breast' || l.type === 'bottle').forEach((l) => { l.start = new Date(Date.now() - 5 * 3600e3 - (l.id === 'x' ? 0 : 1)).toISOString(); }); }); });
  await S(P, () => App.reminders.start()); await P.waitForTimeout(400); // the checker that runs every minute, now
  const shown = await S(P, () => window.__shown);
  ok('with 手機通知 on, the local checker does not show the reminder twice (a note in the app instead)', !shown.some((x) => x.title === '餵奶提醒') && /🔔 餵奶提醒/.test(await toast(P)), `${JSON.stringify(shown)} ${await toast(P)}`);
  // a tapped notification opens its page
  await S(P, () => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: '#/groupbuy' } })));
  await P.waitForTimeout(500);
  ok('a tapped notification opens its page in the app', await S(P, () => location.hash) === '#/groupbuy');
  await S(P, () => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: 'https://evil.example/' } })));
  await P.waitForTimeout(300);
  ok('…only pages inside the app', await S(P, () => location.hash) === '#/groupbuy');

  /* ---------- 4. off, and logging out ---------- */
  await go(P, 'reminders'); cd = await waitCard(P);
  ok('(back on 提醒設定, it is still on)', cd && cd.topics.length === 3, JSON.stringify(cd));
  await P.click('.push-off', { timeout: 5000 }).catch(() => {}); await P.waitForTimeout(700);
  ok('關閉: the server is told, the phone unsubscribes, the card offers to turn it on again', calls.some((c) => c.path === 'push/unsubscribe') && await S(P, () => window.__unsubscribed >= 1 && !App.store.state.settings.push) && (await card(P)).on);
  await P.click('.push-on', { timeout: 5000 }).catch(() => {}); await P.waitForTimeout(900);
  const before = calls.length;
  await S(P, () => { App.navigate('me'); });
  await P.waitForTimeout(700);
  await S(P, () => { const b2 = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '登出'); if (b2) b2.click(); });
  await P.waitForTimeout(700);
  const un = calls.slice(before).find((c) => c.path === 'push/unsubscribe');
  ok('logging out stops this phone\'s notifications (told to the server with the token)', un && un.auth === 'Bearer tok-test-1' && await S(P, () => !App.store.state.auth && !App.store.state.settings.push), JSON.stringify(un));

  /* ---------- 5. the team page offer, the service worker ---------- */
  const { p: G, calls: gc } = await mk();
  await login(G);
  await G.waitForTimeout(800);
  const offer = await S(G, async () => { const el = document.createElement('div'); el.className = 'test-offer'; document.body.append(el); App.push.offer(el, { text: '有人加入、成團時通知我' }); await new Promise((r) => setTimeout(r, 1500)); const btn = el.querySelector('.push-offer'); return btn ? btn.innerText : ''; });
  ok('the team page can offer 「有人加入、成團時通知我」 while notifications are off', /有人加入、成團時通知我/.test(offer), offer);
  await S(G, () => document.querySelector('.test-offer .push-offer').click()); await G.waitForTimeout(900); // (the test's own box sits under the tab bar)
  ok('…which turns them on in one tap', gc.some((c) => c.path === 'push/subscribe') && /已開啟通知/.test(await S(G, () => (document.querySelector('.push-offer') || {}).innerText || '')), `${await toast(G)} | ${gc.map((c) => c.path).join(',')} | ${await S(G, () => document.querySelectorAll('.push-offer').length)}`);
  const sw = await S(G, async () => (await fetch('sw.js')).text());
  ok('sw.js shows pushed notifications and opens their page (inside the app only)', /addEventListener\('push'/.test(sw) && /notificationclick/.test(sw) && /startsWith\('#\/'\)/.test(sw) && sw.includes("'js/modules/push.js'"));
  const { p: D } = await mk({ perm: false });
  await login(D);
  await S(D, () => { Object.defineProperty(Notification, 'permission', { get: () => 'denied', configurable: true }); });
  await go(D, 'reminders');
  cd = await waitCard(D);
  ok('notifications blocked: where to allow them', cd && cd.why === 'denied' && /設定/.test(cd.text), JSON.stringify(cd));

  // LINE members on an iPhone without the home-screen app: LINE messages still work
  const { p: L, calls: lc } = await mk({ ua: IPHONE, line: true });
  await S(L, () => App.store.update((s) => { s.auth = { token: 'tok-line', user: { id: 'u2', nickname: '阿芳', provider: 'line', code: 'LIN123', consent: App.privacy.VERSION, verified: true, invite: {} } }; }));
  await go(L, 'reminders');
  cd = await waitCard(L);
  ok('LINE members get a 「LINE 通知」 switch, even where Web Push cannot work', cd && cd.why === 'ios-home' && /LINE 通知/.test(cd.text), JSON.stringify(cd));
  await L.click('.push-line .switch-row'); await L.waitForTimeout(600);
  const lp = lc.filter((c) => c.path === 'push/line').pop();
  ok('…turning it on tells the server', lp && lp.body.on === true && await S(L, () => App.store.state.settings.lineNotify === true), JSON.stringify(lp));
  await login(L); await go(L, 'home', 300); await go(L, 'reminders');
  ok('email members do not see it', !/LINE 通知/.test(((await waitCard(L)) || {}).text || ''));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  const pass = results.filter((r) => r.pass).length;
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ← ${r.info}`}`));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
