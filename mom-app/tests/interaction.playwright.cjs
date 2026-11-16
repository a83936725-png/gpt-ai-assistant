// Interaction quality: the phone's back button with sheets open, Escape, focus (keyboard / screen readers),
// accidental double-taps, offline use of the newest pages, upgrading from the previous offline cache,
// and 常見好物 in 二寶 mode (育兒＋懷孕).
// Usage:  cd mom-app && python3 -m http.server 8080      (another terminal)
//         node tests/interaction.playwright.cjs           [BASE=http://localhost:8080/]
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080/';
const results = [];
const errors = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: typeof info === 'string' ? info : JSON.stringify(info) });

(async () => {
  const browser = await chromium.launch();
  const newPage = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', ...opts });
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.__noShareMoments = true; window.open = () => null; });
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text()) && !/\/api\//.test((m.location() || {}).url || '') && !/ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(`console: ${m.text()}`); });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const wait = (p, ms = 350) => p.waitForTimeout(ms);
  const hash = (p) => S(p, () => location.hash);
  const open = (p) => S(p, () => document.querySelectorAll('.sheet-backdrop.open').length);
  const back = async (p) => { await S(p, () => history.back()); await wait(p, 450); };
  const nav = async (p, h) => { await S(p, (x) => { location.hash = x; }, h); await wait(p); };
  const start = async (p) => {
    await p.goto(BASE); await p.waitForFunction(() => window.App && App.screens && App.screens.goods);
    await S(p, () => App.demo.seed()); await wait(p, 500);
    await S(p, () => { App.isNight = () => false; App.applyTheme(); });
  };

  /* ================= 1. back button & sheets ================= */
  const p = await newPage();
  await start(p);
  await nav(p, '#/home'); await nav(p, '#/goods');
  await p.click('#view .gd-item >> nth=0'); await wait(p);
  await back(p);
  ok('back closes the open sheet and stays on the screen', (await open(p)) === 0 && (await hash(p)) === '#/goods');
  ok('…and the screen is live again (no stuck has-sheet)', !(await S(p, () => document.body.classList.contains('has-sheet'))));
  await back(p);
  ok('the next back leaves the screen', (await hash(p)) === '#/home');

  await nav(p, '#/goods'); await p.click('#view .gd-item >> nth=0'); await wait(p);
  await p.click('.sheet .icon-btn[aria-label="關閉"]'); await wait(p);
  await back(p);
  ok('after closing with ✕, ONE back press leaves the screen (no dead press)', (await hash(p)) === '#/home');

  await nav(p, '#/goods'); await p.click('#view .gd-item >> nth=0'); await wait(p);
  await p.click('.sheet button:has-text("分享給朋友")'); await wait(p, 600);
  ok('nested sheets open (item → share)', (await open(p)) === 2);
  await back(p);
  ok('back closes only the top sheet', (await open(p)) === 1 && (await hash(p)) === '#/goods');
  await back(p);
  ok('back again closes the item sheet', (await open(p)) === 0 && (await hash(p)) === '#/goods');
  await back(p);
  ok('…then leaves the screen', (await hash(p)) === '#/home');

  await nav(p, '#/goods'); await p.click('#view .gd-item >> nth=0'); await wait(p);
  await p.click('.sheet button:has-text("分享給朋友")'); await wait(p, 600);
  await p.keyboard.press('Escape'); await wait(p);
  ok('Escape closes only the top sheet', (await open(p)) === 1);
  await p.keyboard.press('Escape'); await wait(p);
  await back(p);
  ok('after two Escapes, one back leaves the screen', (await open(p)) === 0 && (await hash(p)) === '#/home');

  await nav(p, '#/goods'); await S(p, () => App.navigate('goods', { item: 'bag' })); await wait(p, 600);
  await p.click('.sheet button:has-text("前往")'); await wait(p, 500);
  ok('a button inside a sheet that changes screen leaves no sheet behind', (await hash(p)) === '#/hospitalbag' && (await open(p)) === 0);
  await back(p);
  ok('back from there returns to 常見好物 (sheet stays closed)', (await hash(p)) === '#/goods' && (await open(p)) === 0);

  await nav(p, '#/goods'); await p.click('#view .gd-item >> nth=0'); await wait(p);
  await S(p, () => App.navigate('me')); await wait(p, 500);
  ok('navigating while a sheet is open closes it', (await hash(p)) === '#/me' && (await open(p)) === 0 && !(await S(p, () => document.body.classList.contains('has-sheet'))));

  // confirm dialog over a sheet (delete a custom item), then one back
  await S(p, () => App.store.update((s) => { s.goods.custom.push({ id: 'c-x', name: 'X', cat: 'out' }); s.goods.st['c-x'] = { s: 'buy' }; }));
  await nav(p, '#/home'); await S(p, () => App.navigate('goods', { tab: 'mine' })); await wait(p, 500);
  await p.click('[data-item="c-x"]'); await wait(p); await p.click('.sheet button:has-text("刪除")'); await wait(p);
  ok('confirm opens on top of the item sheet', (await open(p)) === 2);
  await p.keyboard.press('Escape'); await wait(p);
  ok('Escape on the confirm cancels it and keeps the item sheet', (await open(p)) === 1 && (await S(p, () => App.store.state.goods.custom.length)) === 1);
  await p.click('.sheet button:has-text("刪除")'); await wait(p); await p.click('.sheet-footer .btn-danger'); await wait(p, 500);
  ok('confirm → delete closes both sheets', (await open(p)) === 0 && (await S(p, () => App.store.state.goods.custom.length)) === 0);
  await back(p);
  ok('…and one back leaves the screen', (await hash(p)) === '#/home');

  // a form saved on a screen, then the same screen opened again (tab tap / same link) must not jump anywhere
  await nav(p, '#/log'); await p.click('.tab[href="#/home"]'); await wait(p);
  await S(p, () => App.babylog.openAdd('diaper')); await wait(p);
  await p.click('.sheet .btn-primary >> nth=0'); await wait(p);
  await p.click('.tab[href="#/home"]'); await wait(p, 500);
  ok('after saving a form, tapping the current tab stays on it', (await hash(p)) === '#/home');
  await p.goto(`${await S(p, () => location.href.split('#')[0])}#/home`); await wait(p, 500);
  ok('…and opening the same address again stays too', (await hash(p)) === '#/home');
  await back(p);
  ok('…then one back goes to the previous screen', (await hash(p)) === '#/log');

  // other modules' sheets behave the same (log form, island spot)
  await nav(p, '#/log'); await S(p, () => App.babylog.openAdd('diaper')); await wait(p);
  ok('log form sheet opens', (await open(p)) === 1);
  await back(p);
  ok('back closes the log form, stays on 紀錄', (await open(p)) === 0 && (await hash(p)) === '#/log');
  await nav(p, '#/home');
  await S(p, () => App.navigate('island', { spot: 'market' })); await wait(p, 900);
  const islandSheet = await open(p);
  if (islandSheet) { await back(p); ok('island spot: back closes the spot sheet, stays on the island', (await open(p)) === 0 && (await hash(p)).startsWith('#/island')); }
  else ok('island spot opens a sheet from a link', false, 'no sheet');

  /* ================= 2. focus ================= */
  await S(p, () => App.navigate('goods', { tab: 'now' })); await wait(p);
  const rowId = await S(p, () => document.querySelectorAll('#view .gd-item')[2].dataset.item);
  await p.focus('#view .gd-item >> nth=2'); await p.keyboard.press('Enter'); await wait(p);
  ok('opening a sheet moves focus into it', await S(p, () => !!document.activeElement.closest('.sheet')));
  let inside = true;
  for (let i = 0; i < 30; i += 1) { await p.keyboard.press('Tab'); if (!(await S(p, () => !!document.activeElement.closest('.sheet')))) inside = false; }
  for (let i = 0; i < 6; i += 1) { await p.keyboard.press('Shift+Tab'); if (!(await S(p, () => !!document.activeElement.closest('.sheet')))) inside = false; }
  ok('Tab / Shift+Tab stay inside the sheet', inside);
  await p.keyboard.press('Escape'); await wait(p);
  ok('closing returns focus to the row that opened it', (await S(p, () => document.activeElement.dataset.item)) === rowId, rowId);
  await p.keyboard.press('Enter'); await wait(p);
  ok('Enter on the row reopens it (keyboard-only works end to end)', (await open(p)) === 1);
  await p.keyboard.press('Escape'); await wait(p);
  const dialog = await S(p, () => { const x = document.querySelector('.sheet'); return x ? null : 'none'; });
  ok('sheets are labelled dialogs (role, aria-modal, name)', await (async () => {
    await p.click('#view .gd-item >> nth=0'); await wait(p);
    const a = await S(p, () => { const d = document.querySelector('.sheet'); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && !!d.getAttribute('aria-label'); });
    await p.keyboard.press('Escape'); await wait(p); return a && dialog === 'none';
  })());

  /* ================= 3. accidental double-taps ================= */
  await nav(p, '#/home');
  const logs = () => S(p, () => App.store.state.logs.length);
  let n0 = await logs();
  await p.dblclick('.quick-tile:has-text("尿布") .qt-plus'); await wait(p, 500);
  ok('double-tap on ＋尿布 logs once', (await logs()) === n0 + 1, (await logs()) - n0);
  await wait(p, 800);
  n0 = await logs();
  await p.click('.quick-tile:has-text("尿布") .qt-plus'); await wait(p, 300);
  ok('a separate tap later still logs', (await logs()) === n0 + 1);
  await wait(p, 800);
  n0 = await logs();
  await p.click('.quick-tile:has-text("瓶餵") .qt-plus'); await wait(p, 250);
  await p.click('.quick-tile:has-text("尿布") .qt-plus'); await wait(p, 300);
  ok('two different tiles tapped quickly (0.3 s apart) both log', (await logs()) === n0 + 2, (await logs()) - n0);
  await wait(p, 800);
  await p.dblclick('.quick-tile:has-text("睡眠") .qt-plus'); await wait(p, 500);
  ok('double-tap on ＋睡眠 starts the timer (does not start + stop it)', await S(p, () => !!App.store.state.active.sleep));
  await wait(p, 800);
  n0 = await logs();
  await p.click('.quick-tile.running .qt-plus'); await wait(p, 300);
  ok('tapping ✓ later still finishes the sleep', (await logs()) === n0 + 1 && !(await S(p, () => !!App.store.state.active.sleep)));
  // double-tap on a sheet's save button
  await nav(p, '#/goods');
  await p.click('#view button:has-text("＋ 新增自己的好物")'); await wait(p);
  await p.fill('.sheet input[aria-label="名稱"]', '雙擊測試');
  const c0 = await S(p, () => App.store.state.goods.custom.length);
  await p.dblclick('.sheet button:has-text("儲存")'); await wait(p, 600);
  ok('double-tap on 儲存 saves once', (await S(p, () => App.store.state.goods.custom.length)) === c0 + 1);
  await S(p, () => App.babylog.openAdd('temp')); await wait(p);
  const t0 = await logs();
  await p.fill('.sheet input[type=number] >> nth=0', '37.2').catch(() => {});
  await p.dblclick('.sheet .btn-primary:has-text("儲存"), .sheet .btn-primary >> nth=0'); await wait(p, 600);
  ok('double-tap on a log form 儲存 saves once', (await logs()) === t0 + 1, (await logs()) - t0);
  await p.context().close();

  /* ================= 4. offline + upgrade from the previous cache ================= */
  const o = await newPage();
  await o.goto(BASE); await o.waitForFunction(() => window.App && App.screens.goods);
  // pretend the previous version's cache is still there
  await S(o, async () => { const c = await caches.open('yijia-mom-v7'); await c.put('old-file.txt', new Response('old')); });
  await S(o, async () => { await navigator.serviceWorker.ready; });
  await o.reload(); await o.waitForFunction(() => window.App && App.screens.goods);
  await o.waitForFunction(async () => { const k = await caches.keys(); if (!k.includes('yijia-mom-v8')) return false; const c = await caches.open('yijia-mom-v8'); return !!(await c.match('js/modules/goods.js')) && !!(await c.match('css/goods.css')) && !!(await c.match('js/data/goods-data.js')); }, null, { timeout: 15000 }).catch(() => {});
  const keys = await S(o, () => caches.keys());
  ok('update removes the old offline cache and keeps the new one', keys.includes('yijia-mom-v8') && !keys.includes('yijia-mom-v7'), keys);
  const cached = await S(o, async () => { const c = await caches.open('yijia-mom-v8'); return { goods: !!(await c.match('js/modules/goods.js')), css: !!(await c.match('css/goods.css')), data: !!(await c.match('js/data/goods-data.js')) }; });
  ok('常見好物 files are in the offline cache', cached.goods && cached.css && cached.data, cached);
  await S(o, () => App.demo.seed()); await wait(o, 400);
  await o.context().setOffline(true);
  await o.reload(); await wait(o, 1200);
  await nav(o, '#/goods');
  ok('offline: 常見好物 opens', await o.isVisible('#view .gd-item') && (await o.textContent('.appbar-title')) === '常見好物');
  await o.click('#view .gd-item >> nth=0'); await wait(o);
  ok('offline: item details open', (await open(o)) === 1);
  await o.keyboard.press('Escape'); await wait(o);
  await nav(o, `#/wishlist?${encodeURIComponent(JSON.stringify({ w: 'crib,carseat' }))}`);
  ok('offline: a saved wishlist link opens', (await o.$$('.gd-wish-item')).length === 2);
  await o.context().setOffline(false);
  await o.context().close();

  /* ================= 5. 二寶 mode (育兒 ＋ 懷孕) ================= */
  const m = await newPage();
  await start(m);
  await S(m, () => App.store.update((s) => {
    s.profile.stage = 'baby'; s.profile.pregnantToo = true;
    s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -30 * 7)); s.profile.edd = Core.eddFromLmp(s.profile.lmp);
    s.babies[0].birthday = Core.dateKey(Core.addDays(new Date(), -400));
  }));
  await nav(m, '#/goods');
  const cats = await m.$$eval('#view .gd-group[data-cat]', (els) => els.map((e) => e.dataset.cat));
  ok('二寶 mode: 孕期 + newborn items come back, toddler 副食品 stays', cats[0] === 'preg' && cats.includes('wear') && cats.includes('feed') && cats.includes('solid') && cats.includes('safe'), cats);
  await nav(m, '#/home');
  ok('二寶 mode: home card follows the pregnancy (30 weeks)', await m.isVisible('.gd-home'));
  await m.context().close();

  ok('no page errors', !errors.length, errors.slice(0, 5).join(' | '));
  await browser.close();
  let pass = 0;
  results.forEach((r) => { if (r.pass) pass += 1; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${!r.pass && r.info ? `\n      ${r.info}` : ''}`); });
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
