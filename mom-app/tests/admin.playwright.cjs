// 品牌數據 (js/modules/admin.js, #/admin): the brand's dashboard. Where there is no member service (a static copy, like
// the web preview) it shows clearly marked sample numbers; with the server it asks for the admin key, keeps it for this
// visit (or this device when asked), says when the key is wrong, and shows members, sign-ups and app opens per day as
// column charts (hover / keyboard readout, a table of every day), sign-up kinds, group-buys and what moms do, with a
// 7 / 30 day switch, deltas against the period before, and a CSV export. Small phone, dark and accessibility checked.
// 0.9.3: the phones in use (day / week / month), the stage new users choose, what gets recorded, 滴雞精時光 and the brand
// page's links, shares by channel, the 同週好孕圈 by due month and baby age, feature use — and, with the server, the
// app really sending those counts (only numbers: no id, nothing from 範例資料, kept on the phone until they arrive).
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
      tiles: q('.ad-tiles:not(.ad-use) .ad-tile').map((t) => t.innerText.replace(/\s+/g, ' ').trim()),
      use: q('.ad-use .ad-tile').map((t) => t.innerText.replace(/\s+/g, ' ').trim()),
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
  ok('four column charts with a bar per day (30 days): phones in use, sign-ups, app opens, 滴雞精時光', d.charts.join() === '30,30,30,30' && d.titles.slice(0, 3).join() === '每天在用的手機,每日新註冊,每日 App 開啟' && d.titles.includes('滴雞精時光打卡'), `${d.charts} ${d.titles}`);
  ok('phones in use: today, this week (since Monday), this month (since the 1st), new phones', d.use.length === 4 && /^今天在用的手機 [\d,]+ 今天打開過 App/.test(d.use[0]) && /^本週在用 [\d,]+ 星期一到今天/.test(d.use[1]) && /^本月在用 [\d,]+ 1 號到今天/.test(d.use[2]) && /^新手機 [\d,]+ [▲▼＝]/.test(d.use[3]), d.use.join(' | '));
  const useN = d.use.map((x) => Number((x.match(/ ([\d,]+) /) || [0, '0'])[1].replace(/,/g, '')));
  ok('…and they add up the right way: a day ≤ the week ≤ the month', useN[0] > 0 && useN[0] <= useN[1] && useN[1] <= useN[2], useN.join());
  const secs = ['新使用者選的階段', '記錄了什麼', '從品牌頁到官網', '分享', '同週好孕圈的媽媽', '功能使用'];
  ok('new sections: stage, records, brand page → shop, shares, 同週好孕圈, feature use', secs.every((t) => d.titles.includes(t)), d.titles.join());
  const bars = await S(P, () => [...document.querySelectorAll('.ad-hbars')].map((g) => ({
    w: [...g.querySelectorAll('.ad-htrack')].map((x) => Math.round(x.getBoundingClientRect().width)),
    rows: [...g.querySelectorAll('.ad-hrow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
  })));
  ok('every bar group measures its bars against one track (same width in every row)', bars.length >= 7 && bars.every((g) => g.w.length && g.w.every((x) => x === g.w[0] && x > 40)), JSON.stringify(bars.map((g) => g.w)));
  const card = (t) => S(P, (t0) => { const c = [...document.querySelectorAll('.ad-card')].find((x) => [...x.querySelectorAll('.ad-ct')].some((y) => y.innerText === t0)); return c ? c.innerText.replace(/\s+/g, ' ') : ''; }, t);
  const stage = await card('新使用者選的階段');
  ok('the stage new users choose: 備孕中 / 懷孕中 / 育兒中 with their share, and how many looked at 範例資料 first', /備孕中 [\d,]+ \d+%/.test(stage) && /懷孕中 [\d,]+ \d+%/.test(stage) && /育兒中 [\d,]+ \d+%/.test(stage) && /先看範例資料：[\d,]+ 次/.test(stage), stage);
  const logs = await card('記錄了什麼');
  ok('what gets recorded, biggest first (尿布 … 其他), and 範例資料 is not counted', /^記錄了什麼 近 30 天・筆（範例資料不算） 尿布 [\d,]+ \d+% 親餵/.test(logs) && /其他 [\d,]+ \d+%$/.test(logs), logs);
  const funnel = await S(P, () => { const g = [...document.querySelectorAll('.ad-card')].find((x) => /從品牌頁到官網/.test(x.innerText)).querySelectorAll('.ad-hbars')[0]; return [...g.querySelectorAll('.ad-hrow')].map((r) => ({ n: Number(r.querySelector('.ad-hv2').firstChild.textContent.replace(/,/g, '')), s: (r.querySelector('.ad-hv2 small') || {}).textContent || '' })); });
  ok('brand page → shop / LINE: the % is of the brand page views (not of the group)', funnel.length === 3 && funnel[0].s === '' && funnel[1].s.trim() === `${Math.round((funnel[1].n / funnel[0].n) * 100)}%` && funnel[2].s.trim() === `${Math.round((funnel[2].n / funnel[0].n) * 100)}%`, JSON.stringify(funnel));
  const shares = await card('分享');
  ok('shares by channel (LINE, IG, Facebook, Threads, 存圖片, 複製連結, 其他) and what they brought', ['LINE', 'IG', 'Facebook', 'Threads', '存圖片', '複製連結', '其他'].every((t) => new RegExp(`${t} [\\d,]+ \\d+%`).test(shares)) && /分享帶來：成功邀請 [\d,]+ 位・領邀請禮 [\d,]+ 位/.test(shares), shares);
  const circ = await card('同週好孕圈的媽媽');
  const months = (circ.match(/\d{4} 年 \d{1,2} 月/g) || []).map((x) => { const [y, m] = x.match(/\d+/g).map(Number); return y * 12 + m; });
  ok('同週好孕圈: how many (備孕 / 懷孕 / 育兒), due months in order, babies by age', /現在 [\d,]+ 位（自己選擇加入、近 14 天打開過）・備孕 \d+・懷孕 \d+・育兒 \d+/.test(circ) && months.length >= 6 && months.every((x, i) => !i || x === months[i - 1] + 1) && /0–3 個月 \d+/.test(circ) && /3 歲以上 \d+/.test(circ), circ.slice(0, 200));
  const uses = await card('功能使用');
  ok('feature use: 夜奶陪伴, 成長回顧, 寶寶月照, 好孕島蓋章, 問答搜尋, 家族週報', ['夜奶陪伴', '成長回顧', '寶寶月照（放照片）', '好孕島蓋章', '問答搜尋', '家族週報傳出'].every((t) => uses.includes(t)), uses);
  const iu = await S(P, () => {
    const day = (s) => new Date(`${s}T12:00:00+08:00`).getTime();
    const rows = [['2026-10-31', 9, 9, 9], ['2026-11-01', 4, 0, 6], ['2026-11-02', 5, 3, 1], ['2026-11-03', 6, 2, 1], ['2026-11-04', 7, 1, 0]].map(([d0, a, w, m]) => ({ day: d0, active_d: a, active_w: w, active_m: m }));
    return App.admin.inUse(rows, day('2026-11-04'));
  });
  ok('in use: today is today\'s number; the week adds Monday → today; the month adds the 1st → today', iu.day === 7 && iu.week === 6 && iu.month === 8, JSON.stringify(iu));
  ok('the readout is hidden until a day is pointed at', d.tipHidden);
  ok('sample mode has no 登出 and no key box', !d.out && !d.key);
  // the readout: pointer and keyboard
  await P.locator('.ad-c-signup .ad-svg').scrollIntoViewIfNeeded(); await P.evaluate(() => window.scrollBy(0, 120)); await P.waitForTimeout(200);
  const box = await P.locator('.ad-c-signup .ad-svg').boundingBox();
  await P.mouse.move(box.x + box.width * 0.97, box.y + box.height * 0.5); await P.waitForTimeout(200);
  let tip = await S(P, () => { const t = document.querySelector('.ad-c-signup .ad-tip'); return { hidden: t.hidden, text: t.innerText.replace(/\s+/g, ' '), on: document.querySelector('.ad-c-signup .ad-svg').querySelectorAll('.ad-bar.on').length }; });
  ok('pointing at the last day shows its number and 「今天，還沒結束」, and lifts that bar', !tip.hidden && /\d+ 人/.test(tip.text) && /今天，還沒結束/.test(tip.text) && tip.on === 1, JSON.stringify(tip));
  await P.mouse.move(box.x + box.width / 2, box.y - 80); await P.waitForTimeout(200);
  ok('…and goes away when the pointer leaves', await S(P, () => document.querySelector('.ad-c-signup .ad-tip').hidden));
  await P.focus('.ad-c-signup .ad-svg'); await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(150);
  tip = await S(P, () => ({ hidden: document.querySelector('.ad-c-signup .ad-tip').hidden, text: document.querySelector('.ad-c-signup .ad-tip').innerText.replace(/\s+/g, ' ') }));
  ok('arrow keys read the days too (← from today goes to yesterday)', !tip.hidden && /\d+ 人/.test(tip.text) && !/今天/.test(tip.text), JSON.stringify(tip));
  const aria = await S(P, () => document.querySelector('.ad-c-signup .ad-svg').getAttribute('aria-label'));
  ok('the chart has a summary for screen readers (total and the highest day)', /每日新註冊，近 30 天共 [\d,]+ 人，最多 \d+\/\d+ 的 [\d,]+ 人/.test(aria), aria);
  const tbl = await S(P, () => { const t = document.querySelector('.ad-c-signup .ad-table'); t.open = true; return { rows: t.querySelectorAll('tbody tr').length, first: t.querySelector('tbody tr').innerText.replace(/\s+/g, ' ') }; });
  ok('every value is also in a table (newest first)', tbl.rows === 30, JSON.stringify(tbl));
  const lbl = await S(P, () => [...document.querySelector('.ad-c-signup .ad-svg').querySelectorAll('.ad-val')].map((x) => x.textContent));
  ok('only a few numbers on the chart (the highest day and today)', lbl.length >= 1 && lbl.length <= 2, lbl.join());
  // 7 days
  await P.click('.ad-bar-row .seg button:has-text("近 7 天")'); await P.waitForTimeout(300);
  d = await page(P);
  ok('近 7 天: the charts have 7 bars and the tiles compare with the 7 days before', d.charts.join() === '7,7,7,7' && /比前 7 天/.test(d.tiles[0]), `${d.charts} ${d.tiles[0]}`);
  const barW = await S(P, () => Math.round(document.querySelector('.ad-bar').getBBox().width));
  ok('bars stay thin (at most 24 units) even with few days', barW <= 24, barW);
  const seg = await S(P, () => [...document.querySelectorAll('.ad-bar-row .seg button')].map((x) => Math.round(x.getBoundingClientRect().height)));
  ok('the 7 / 30 day switch stays on one line', seg.every((x) => x <= 44), seg.join());
  // CSV
  const [dl] = await Promise.all([P.waitForEvent('download'), P.click('.ad-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const lines = csv.replace(/^﻿/, '').trim().split(/\r\n/);
  ok('匯出 CSV: one row per day with a header Excel reads (BOM)', csv.charCodeAt(0) === 0xfeff && /^日期,新註冊,Email 註冊/.test(lines[0]) && lines.length === 8 && /^\d{4}-\d{2}-\d{2},\d+/.test(lines[7]) && /^yijia-stats-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), `${dl.suggestedFilename()} ${lines.length} ${lines[0].slice(0, 60)}`);
  ok('…with the new columns too (phones in use, stages, records, shares, brand page)', ['當天使用的手機', '本週第一次使用的手機', '設定：育兒中', '記錄：尿布', '滴雞精時光打卡', '看品牌頁的手機', '分享：LINE', '問答搜尋'].every((t) => lines[0].split(',').includes(t)) && lines[0].split(',').length === lines[7].split(',').length, lines[0].slice(0, 400));
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

  const quietHere = await S(P, async () => { App.store.addLog({ type: 'diaper', data: { kind: 'wet' } }); if (App.chicken) App.chicken.checkIn(1); await new Promise((r) => setTimeout(r, 200)); return localStorage.getItem('yijia-mom-metrics'); });
  ok('a copy without the member service keeps no tally (nothing to send it to)', quietHere === null, quietHere);
  const meLink = await S(P, async () => { App.store.update((s) => { s.onboarded = true; }); App.navigate('me'); await new Promise((r) => setTimeout(r, 900)); const b2 = document.querySelector('.me-admin'); return b2 ? b2.innerText : ''; });
  ok('the web preview links the dashboard from 我的 (品牌數據後台（預覽）)', /品牌數據後台（預覽）/.test(meLink), meLink);

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
    ok('…and 我的 does not link the dashboard for moms', await S(R, async () => { location.hash = '#/me'; await new Promise((r) => setTimeout(r, 900)); const has = !!document.querySelector('.me-admin'); location.hash = '#/admin'; await new Promise((r) => setTimeout(r, 900)); return !has; }));
    await shot(R, 'admin-key');
    await axe(R, 'admin key form');
    await R.fill('.ad-key', 'too-short'); await R.click('text=查看數據'); await R.waitForTimeout(300);
    ok('a key shorter than 24 characters is not even sent', /至少 24 個字元/.test(await S(R, () => (document.querySelector('.toast-wrap') || {}).innerText || '')));
    await R.fill('.ad-key', 'wrong-key-wrong-key-wrong-key-1'); await R.click('text=查看數據'); await R.waitForTimeout(1200);
    ok('a wrong key: 「金鑰不對」 and the key is not kept', /金鑰不對/.test(await S(R, () => (document.querySelector('.ad-err') || {}).innerText || '')) && await S(R, () => !sessionStorage.getItem('yijia-admin-key') && !localStorage.getItem('yijia-admin-key')));
    await R.fill('.ad-key', ADMIN_KEY); await R.click('text=查看數據'); await R.waitForTimeout(1500);
    d = await page(R);
    const real = await S(R, () => ({ members: Number((document.querySelector('.ad-hv') || {}).innerText.replace(/,/g, '')), today: (() => { const t = document.querySelector('.ad-c-signup .ad-table'); return t ? Number(t.querySelector('tbody tr td').textContent.replace(/,/g, '')) : -1; })() }));
    ok('the right key: real numbers (no sample banner), today\'s sign-up included', !d.banner && real.members >= 1 && real.today >= 1 && d.charts.join() === '30,30,30,30', JSON.stringify({ ...real, charts: d.charts }));
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

    /* ---------- 4. the app sends its counts (only numbers) and they show up here ---------- */
    // what each phone delivered is read off its own requests (other suites may use the same server); the server's
    // numbers are then checked to have gone up by at least that much
    let ask = 20; // a different number of days each time skips the dashboard's 30-second cache
    const todayRow = async () => {
      ask += 1;
      const st = (await axios.get(`${API_BASE}api/admin/stats?days=${ask}`, { headers: { 'X-Admin-Key': ADMIN_KEY } })).data;
      const tk = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
      return st.rows.find((r) => r.day === tk) || {};
    };
    const flush = (p) => S(p, async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise((r) => setTimeout(r, 1200)); });
    const net2 = `10.78.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`; // its own network: no other run's limits
    const fresh = async () => {
      const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
      await c.addInitScript(() => { window.__noNightAuto = true; window.__noShareMoments = true; });
      const p = await c.newPage();
      p.on('pageerror', (e) => errs.push(e.message));
      await p.route('**/api/**', (r) => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': net2 } }));
      p.got = []; p.bodies = [];
      p.on('request', (rq) => { if (rq.method() === 'POST' && /\/api\/count$/.test(rq.url())) p.bodies.push(rq.postData() || ''); });
      p.on('requestfinished', async (rq) => {
        if (rq.method() !== 'POST' || !/\/api\/count$/.test(rq.url())) return;
        const r = await rq.response(); if (r && r.status() === 200) p.got.push(JSON.parse(rq.postData() || '{}').n || {});
      });
      await p.goto(API_BASE); await p.waitForSelector('text=你現在是？', { timeout: 15000 });
      return p;
    };
    const sum = (list) => list.reduce((a, n) => { Object.entries(n).forEach(([k, v]) => { a[k] = (a[k] || 0) + v; }); return a; }, {});
    const since = (p, from) => sum(p.got.slice(from));
    const before = await todayRow();

    const M = await fresh();
    await M.click('.ob-choice:has-text("育兒中")'); await M.click('text=完成，開始使用'); await M.waitForTimeout(600);
    await S(M, async () => {
      App.store.addLog({ type: 'diaper', data: { kind: 'wet' } }); App.store.addLog({ type: 'breast', data: {} }); App.store.addLog({ type: 'temp', data: {} });
      App.chicken.checkIn(1);
      App.navigate('brand'); await new Promise((r) => setTimeout(r, 400)); App.navigate('home'); await new Promise((r) => setTimeout(r, 200)); App.navigate('brand');
    });
    const tally = await S(M, () => JSON.parse(localStorage.getItem('yijia-mom-metrics') || '{}'));
    ok('the phone keeps a tally of counts — names and numbers, no id, no account, no record content', tally.n && tally.n.log_diaper === 1 && tally.n.ob_baby === 1 && tally.n.brand_view === 1 && Object.keys(tally).every((k) => ['n', 'o', 'd', 'w', 'm', 'first'].includes(k)) && !/wet|token|@|小乖/.test(JSON.stringify(tally)), JSON.stringify(tally));
    await flush(M);
    let g = since(M, 0);
    ok('sent: a new phone, in use today / this week / this month, chose 育兒中, its records by kind, a check-in, the brand page once', g.first_open === 1 && g.active_d === 1 && g.active_w === 1 && g.active_m === 1 && g.ob_baby === 1 && g.log_diaper === 1 && g.log_breast === 1 && g.log_other === 1 && g.checkin === 1 && g.brand_view === 1 && !g.ob_demo, JSON.stringify(g));
    ok('…and nothing else rides along: only known names with whole numbers', M.bodies.every((x) => { const n = (JSON.parse(x).n) || {}; return Object.keys(JSON.parse(x)).join() === 'n' && Object.entries(n).every(([k, v]) => /^[a-z_]+$/.test(k) && Number.isInteger(v) && v >= 1); }), M.bodies.join(' '));
    ok('…and the tally on the phone is empty once it has arrived', await S(M, () => Object.keys((JSON.parse(localStorage.getItem('yijia-mom-metrics')) || {}).n || {}).length === 0));
    const after1 = await todayRow();
    const K1 = ['first_open', 'active_d', 'ob_baby', 'log_diaper', 'checkin', 'brand_view'];
    ok('the server added them to today\'s numbers', K1.every((k) => (Number(after1[k]) || 0) - (Number(before[k]) || 0) >= g[k]), JSON.stringify(Object.fromEntries(K1.map((k) => [k, [before[k] || 0, after1[k] || 0, g[k]]]))));
    // the same phone again today: in use and the brand page count once a day; a record every time; the shop link once a day
    let from = M.got.length;
    await S(M, async () => {
      App.store.addLog({ type: 'diaper', data: { kind: 'dirty' } });
      window.BRAND.shopUrl = 'https://shop.example/';
      App.navigate('home'); await new Promise((r) => setTimeout(r, 200)); App.navigate('brand'); await new Promise((r) => setTimeout(r, 300));
      const a = [...document.querySelectorAll('a[target=_blank]')].find((x) => x.href.startsWith('https://shop.example'));
      for (let k = 0; k < 2; k += 1) { a.addEventListener('click', (e) => e.preventDefault(), { once: true }); a.click(); }
    });
    await flush(M);
    g = since(M, from);
    ok('the same phone again today: one more record and 點官網 once (tapped twice), but not one more phone in use or brand-page view', g.log_diaper === 1 && g.brand_shop === 1 && !g.active_d && !g.first_open && !g.brand_view, JSON.stringify(g));
    // offline: the tally waits on the phone and goes out once the server answers again
    from = M.got.length;
    await M.route('**/api/count', (r) => r.abort());
    await S(M, () => { App.store.addLog({ type: 'diaper', data: { kind: 'wet' } }); });
    await flush(M);
    const waiting = await S(M, () => ((JSON.parse(localStorage.getItem('yijia-mom-metrics')) || {}).n || {}).log_diaper || 0);
    await M.unroute('**/api/count');
    await flush(M);
    g = since(M, from);
    ok('no connection: the count waits on the phone, then arrives once (not lost, not twice)', waiting === 1 && g.log_diaper === 1, `${waiting} ${JSON.stringify(g)}`);
    // a search counts once she stops typing; the words never leave the phone
    from = M.got.length; const b0 = M.bodies.length;
    await S(M, async () => { App.navigate('search'); await new Promise((r) => setTimeout(r, 500)); const i = document.querySelector('#sr-input'); i.value = '脹氣'; i.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 400)); i.value = '脹氣 按摩'; i.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 1800)); });
    await flush(M);
    g = since(M, from);
    ok('a search counts once she stops typing — and only the count is sent, not the words', g.search === 1 && M.bodies.slice(b0).every((x) => !/脹氣|按摩|\\u8139/.test(x)), `${JSON.stringify(g)} ${M.bodies.slice(b0).join(' ')}`);
    await M.context().close();

    // 範例資料: choosing it counts; what is done inside it does not
    const D = await fresh();
    await D.click('text=先看看範例資料'); await D.waitForTimeout(800);
    await S(D, async () => { App.store.addLog({ type: 'diaper', data: { kind: 'wet' } }); App.chicken.checkIn(1); App.navigate('brand'); await new Promise((r) => setTimeout(r, 300)); });
    await flush(D);
    g = since(D, 0);
    ok('範例資料: choosing it counts (先看範例), its records, check-ins, brand page and "in use" do not', g.ob_demo === 1 && g.first_open === 1 && !g.log_diaper && !g.checkin && !g.brand_view && !g.active_d, JSON.stringify(g));
    await D.context().close();

    // the landing page's 試玩 (App.sandbox) sends nothing
    const L = await fresh();
    await L.waitForTimeout(1200); // its first open has gone out (it did not know yet)
    await S(L, async () => { App.sandbox = true; App.store.addLog({ type: 'diaper', data: { kind: 'wet' } }); App.count('checkin'); App.count.active(); await new Promise((r) => setTimeout(r, 100)); });
    from = L.got.length;
    await flush(L);
    g = since(L, from);
    ok('the landing page\'s 試玩 sends nothing', !Object.keys(g).length && await S(L, () => !((JSON.parse(localStorage.getItem('yijia-mom-metrics')) || {}).n || {}).log_diaper), JSON.stringify(g));
    await L.context().close();

    // the dashboard shows them
    const R2 = await mk(API_BASE);
    await R2.fill('.ad-key', ADMIN_KEY); await R2.click('text=查看數據'); await R2.waitForTimeout(1500);
    const shown = await S(R2, () => ({ use: [...document.querySelectorAll('.ad-use .ad-tile')].map((t) => t.innerText.replace(/\s+/g, ' ')), stage: ([...document.querySelectorAll('.ad-card')].find((x) => /新使用者選的階段/.test(x.innerText)) || {}).innerText || '' }));
    ok('the dashboard shows them: phones in use today ≥ 1, 育兒中 ≥ 1', /今天在用的手機 [1-9]/.test(shown.use[0] || '') && /育兒中\s+[1-9]/.test(shown.stage), JSON.stringify(shown).slice(0, 300));
    await shot(R2, 'admin-real-counts');
    await R2.click('.ad-out');
  }

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  const pass = results.filter((r) => r.pass).length;
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ← ${r.info}`}`));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
