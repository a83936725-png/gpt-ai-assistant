// 品牌數據 (js/modules/admin.js, #/admin): the brand's dashboard. Where there is no member service (a static copy, like
// the web preview) it shows clearly marked sample numbers; with the server it asks for the admin key, keeps it for this
// visit (or this device when asked), says when the key is wrong, and shows members, sign-ups and app opens per day as
// column charts (hover / keyboard readout, a table of every day), sign-up kinds, group-buys and what moms do, with a
// 7 / 30 day switch, deltas against the period before, and a CSV export. Small phone, dark and accessibility checked.
// Usage: BASE=http://localhost:8731/ (static copy)  API_BASE=http://localhost:8790/mom-app/ (server with MOM_ADMIN_KEY)
//        ADMIN_KEY=<the key>  AXE_PATH=<axe.min.js>   node tests/admin.playwright.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');

const BASE = process.env.BASE || 'http://localhost:8731/';
const API_BASE = process.env.API_BASE || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });

(async () => {
  const b = await chromium.launch();
  const mk = async (base, { width = 390, height = 844, scheme = 'light' } = {}) => {
    const c = await b.newContext({ viewport: { width, height }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', colorScheme: scheme, acceptDownloads: true });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(`${base}#/admin`);
    await p.waitForFunction(() => window.App && App.admin && document.querySelector('.ad') && !document.querySelector('.ad [role=status]'), null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(400);
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: `${SHOT}${name}.png`, fullPage: true }); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const page = (p) => S(p, () => {
    const q = (s) => [...document.querySelectorAll(s)];
    return {
      banner: (document.querySelector('.ad-sample') || {}).innerText || '',
      hero: (document.querySelector('.ad-hv') || {}).innerText || '',
      tiles: q('.ad-tile').map((t) => t.innerText.replace(/\s+/g, ' ').trim()),
      charts: q('.ad-svg').map((s) => s.querySelectorAll('.ad-bar').length),
      titles: q('.ad-ct').map((x) => x.innerText),
      tipHidden: q('.ad-tip').every((t) => t.hidden && getComputedStyle(t).display === 'none'),
      out: !!document.querySelector('.ad-out'), key: !!document.querySelector('.ad-key'),
    };
  });

  /* ---------- 1. a static copy (the web preview): sample numbers, clearly marked ---------- */
  const P = await mk(BASE);
  let d = await page(P);
  ok('#/admin opens without setting up the app (not linked for moms)', await S(P, () => document.body.dataset.screen) === 'admin');
  ok('no member service here: the page says these are sample numbers, not real ones', /範例數字（不是真實數據）/.test(d.banner) && /MOM_ADMIN_KEY/.test(d.banner), d.banner);
  ok('one big number leads: 會員總數', d.hero === '1,284', d.hero);
  ok('six tiles: 新註冊, App 開啟, 成功邀請, 團購成團, 同意行銷訊息, 刪除帳號', d.tiles.length === 6 && /^新註冊/.test(d.tiles[0]) && /^刪除帳號/.test(d.tiles[5]) && /會員的 55%/.test(d.tiles[4]), d.tiles.join(' | '));
  ok('deltas say what they compare with (比前 30 天) with an arrow, not colour alone', /[▲▼＝] .*比前 30 天/.test(d.tiles[0]), d.tiles[0]);
  ok('two column charts with a bar per day (30 days)', d.charts.join() === '30,30' && d.titles.slice(0, 2).join() === '每日新註冊,每日 App 開啟', `${d.charts} ${d.titles}`);
  ok('the readout is hidden until a day is pointed at', d.tipHidden);
  ok('sample mode has no 登出 and no key box', !d.out && !d.key);
  // the readout: pointer and keyboard
  await P.locator('.ad-svg').first().scrollIntoViewIfNeeded(); await P.evaluate(() => window.scrollBy(0, 120)); await P.waitForTimeout(200);
  const box = await P.locator('.ad-svg').first().boundingBox();
  await P.mouse.move(box.x + box.width * 0.97, box.y + box.height * 0.5); await P.waitForTimeout(200);
  let tip = await S(P, () => { const t = document.querySelector('.ad-tip'); return { hidden: t.hidden, text: t.innerText.replace(/\s+/g, ' '), on: document.querySelectorAll('.ad-svg')[0].querySelectorAll('.ad-bar.on').length }; });
  ok('pointing at the last day shows its number and 「今天，還沒結束」, and lifts that bar', !tip.hidden && /\d+ 人/.test(tip.text) && /今天，還沒結束/.test(tip.text) && tip.on === 1, JSON.stringify(tip));
  await P.mouse.move(box.x + box.width / 2, box.y - 80); await P.waitForTimeout(200);
  ok('…and goes away when the pointer leaves', await S(P, () => document.querySelector('.ad-tip').hidden));
  await P.focus('.ad-svg'); await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(150);
  tip = await S(P, () => ({ hidden: document.querySelector('.ad-tip').hidden, text: document.querySelector('.ad-tip').innerText.replace(/\s+/g, ' ') }));
  ok('arrow keys read the days too (← from today goes to yesterday)', !tip.hidden && /\d+ 人/.test(tip.text) && !/今天/.test(tip.text), JSON.stringify(tip));
  const aria = await S(P, () => document.querySelector('.ad-svg').getAttribute('aria-label'));
  ok('the chart has a summary for screen readers (total and the highest day)', /每日新註冊，近 30 天共 [\d,]+ 人，最多 \d+\/\d+ 的 [\d,]+ 人/.test(aria), aria);
  const tbl = await S(P, () => { const t = document.querySelector('.ad-table'); t.open = true; return { rows: t.querySelectorAll('tbody tr').length, first: t.querySelector('tbody tr').innerText.replace(/\s+/g, ' ') }; });
  ok('every value is also in a table (newest first)', tbl.rows === 30, JSON.stringify(tbl));
  const lbl = await S(P, () => [...document.querySelectorAll('.ad-svg')[0].querySelectorAll('.ad-val')].map((x) => x.textContent));
  ok('only a few numbers on the chart (the highest day and today)', lbl.length >= 1 && lbl.length <= 2, lbl.join());
  // 7 days
  await P.click('.ad-bar-row .seg button:has-text("近 7 天")'); await P.waitForTimeout(300);
  d = await page(P);
  ok('近 7 天: the charts have 7 bars and the tiles compare with the 7 days before', d.charts.join() === '7,7' && /比前 7 天/.test(d.tiles[0]), `${d.charts} ${d.tiles[0]}`);
  const barW = await S(P, () => Math.round(document.querySelector('.ad-bar').getBBox().width));
  ok('bars stay thin (at most 24 units) even with few days', barW <= 24, barW);
  const seg = await S(P, () => [...document.querySelectorAll('.ad-bar-row .seg button')].map((x) => Math.round(x.getBoundingClientRect().height)));
  ok('the 7 / 30 day switch stays on one line', seg.every((x) => x <= 44), seg.join());
  // CSV
  const [dl] = await Promise.all([P.waitForEvent('download'), P.click('.ad-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const lines = csv.replace(/^﻿/, '').trim().split(/\r\n/);
  ok('匯出 CSV: one row per day with a header Excel reads (BOM)', csv.charCodeAt(0) === 0xfeff && /^日期,新註冊,Email 註冊/.test(lines[0]) && lines.length === 8 && /^\d{4}-\d{2}-\d{2},\d+/.test(lines[7]) && /^yijia-stats-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), `${dl.suggestedFilename()} ${lines.length} ${lines[0].slice(0, 60)}`);
  await shot(P, 'admin-sample');
  await axe(P, 'brand dashboard (sample)');
  const gb = await S(P, () => [...document.querySelectorAll('.ad-gb')].map((x) => x.innerText.replace(/\s+/g, ' ')));
  ok('group-buys: started, joined, full and the fill rate per campaign', gb.length === 2 && /開團 46 參加 121 成團 31/.test(gb[0]) && /成團率 67%/.test(gb[0]) && /已結束/.test(gb[1]), gb.join(' | '));
  ok('sw.js caches the dashboard files', await S(P, async () => { const t = await (await fetch('sw.js')).text(); return t.includes("'js/modules/admin.js'") && t.includes("'css/admin.css'"); }));
  // the numbers helpers
  const u = await S(P, () => {
    const A = App.admin;
    const s = A.sums([{ day: 'a', signup: 1 }, { day: 'b', signup: 2 }, { day: 'c', signup: 3 }, { day: 'd', signup: 6 }], 2);
    return { cur: s.cur('signup'), prev: s.prev('signup'), short: A.sums([{ signup: 1 }], 2).prev('signup'), d1: A.delta(9, 3), d2: A.delta(3, 0), d3: A.delta(0, 0), d4: A.delta(2, 4), d5: A.delta(5, null) };
  });
  ok('sums and deltas: the range and the period before; no % against 0; nothing when there is no period before', u.cur === 9 && u.prev === 3 && u.short === null && u.d1.text === '200%' && u.d1.dir === 'up' && u.d2.text === '前期 0' && u.d3.text === '持平' && u.d4.dir === 'down' && u.d5 === null, JSON.stringify(u));

  /* ---------- 2. small phone, dark ---------- */
  const Q = await mk(BASE, { width: 320, height: 568, scheme: 'dark' });
  const fit = await S(Q, () => ({ over: document.documentElement.scrollWidth - innerWidth, hero: getComputedStyle(document.querySelector('.ad-hv')).fontSize }));
  ok('320 px: nothing wider than the screen', fit.over <= 0, JSON.stringify(fit));
  await shot(Q, 'admin-small-dark');
  await axe(Q, 'brand dashboard (small, dark)');

  /* ---------- 3. with the member service: the admin key ---------- */
  if (API_BASE && ADMIN_KEY) {
    // a sign-up today, so the numbers have something real in them
    const cfg = (await axios.get(`${API_BASE}api/config`)).data;
    const net = `10.77.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
    const reg = await axios.post(`${API_BASE}api/auth/register`, { consent: cfg.policy, account: `admin-test-${Date.now()}@example.com`, password: 'baby-sleeps-9', nickname: '測試' }, { headers: { 'X-Forwarded-For': net }, validateStatus: () => true });
    ok('(setup) a member signs up', reg.status === 201 || reg.status === 400, `${reg.status} ${JSON.stringify(reg.data).slice(0, 80)}`);
    const R = await mk(API_BASE);
    d = await page(R);
    ok('with the member service: it asks for the admin key (no numbers before)', d.key && !d.hero && !d.banner, JSON.stringify(d));
    await shot(R, 'admin-key');
    await axe(R, 'admin key form');
    await R.fill('.ad-key', 'too-short'); await R.click('text=查看數據'); await R.waitForTimeout(300);
    ok('a key shorter than 24 characters is not even sent', /至少 24 個字元/.test(await S(R, () => (document.querySelector('.toast-wrap') || {}).innerText || '')));
    await R.fill('.ad-key', 'wrong-key-wrong-key-wrong-key-1'); await R.click('text=查看數據'); await R.waitForTimeout(1200);
    ok('a wrong key: 「金鑰不對」 and the key is not kept', /金鑰不對/.test(await S(R, () => (document.querySelector('.ad-err') || {}).innerText || '')) && await S(R, () => !sessionStorage.getItem('yijia-admin-key') && !localStorage.getItem('yijia-admin-key')));
    await R.fill('.ad-key', ADMIN_KEY); await R.click('text=查看數據'); await R.waitForTimeout(1500);
    d = await page(R);
    const real = await S(R, () => ({ members: Number((document.querySelector('.ad-hv') || {}).innerText.replace(/,/g, '')), today: (() => { const t = document.querySelector('.ad-table'); return t ? Number(t.querySelector('tbody tr td').textContent.replace(/,/g, '')) : -1; })() }));
    ok('the right key: real numbers (no sample banner), today\'s sign-up included', !d.banner && real.members >= 1 && real.today >= 1 && d.charts.join() === '30,30', JSON.stringify({ ...real, charts: d.charts }));
    ok('the key is kept for this visit only (not on the device) unless asked', await S(R, () => !!sessionStorage.getItem('yijia-admin-key') && !localStorage.getItem('yijia-admin-key')));
    await shot(R, 'admin-real');
    await axe(R, 'brand dashboard (real)');
    await R.reload(); await R.waitForTimeout(1800);
    ok('reloading in the same visit goes straight to the numbers', !!(await R.$('.ad-hv')));
    await R.click('.ad-out'); await R.waitForTimeout(400);
    ok('登出 forgets the key', !!(await R.$('.ad-key')) && await S(R, () => !sessionStorage.getItem('yijia-admin-key')));
    await R.fill('.ad-key', ADMIN_KEY); await R.click('.ad-login .check-row'); await R.click('text=查看數據'); await R.waitForTimeout(1500);
    ok('「記住這台裝置」 keeps the key on this device', await S(R, () => localStorage.getItem('yijia-admin-key')) === ADMIN_KEY);
    await R.click('.ad-out'); await R.waitForTimeout(300);
    ok('…and 登出 removes it from the device too', await S(R, () => !localStorage.getItem('yijia-admin-key')));
  }

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  const pass = results.filter((r) => r.pass).length;
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ← ${r.info}`}`));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
