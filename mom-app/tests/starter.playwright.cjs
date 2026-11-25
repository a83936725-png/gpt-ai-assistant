// 新手任務 and 坐月子的精簡首頁: the five starter tasks for each stage (done automatically, +5 好孕點數 each, +15 for all),
// the 首頁 card and the list, the welcome after signing up, sample data and long-time users (no card); during the
// first 30 days the suggestions fold into one 「更多」 row (her own 團購 team never does).
// The member parts start their own member API (port 8793, codes shown on screen; nothing is sent anywhere).
// Usage: cd mom-app && python3 -m http.server 8080   then (repo root) BASE=http://localhost:8080/ node mom-app/tests/starter.playwright.cjs
//        AXE_PATH=<axe.min.js> for the accessibility checks
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8080/';
const PORT = process.env.STARTER_PORT || '8793';
const API_BASE = `http://localhost:${PORT}/mom-app/`;
const AXE = process.env.AXE_PATH || '';
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;
process.on('exit', () => { if (server) server.kill(); });

(async () => {
  try { await fetch(`${API_BASE}api/config`); console.error(`SCRIPT ERROR port ${PORT} is already in use`); process.exit(1); } catch (e) { /* free */ }
  server = spawn(process.execPath, ['api/index.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      APP_PORT: PORT,
      MOM_TRUST_PROXY: '1',
      MOM_CODE_ECHO: '1',
      NODE_ENV: 'development',
      LINE_LOGIN_CHANNEL_ID: '',
      MOM_GROUPBUYS: JSON.stringify([{
        id: 'gb-st', title: '易家滴雞精 10 入（測試）', price: 1980, listPrice: 2400, size: 3, hours: 48, ends: '2027-12-31', shopUrl: 'https://shop.example/gb', code: 'ST-1',
      }]),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let serverErr = ''; server.stderr.on('data', (d) => { serverErr += d; });
  for (let i = 0; i < 50; i += 1) { // eslint-disable-line no-await-in-loop
    try { const r = await fetch(`${API_BASE}api/config`); if (r.ok) break; } catch (e) { /* not up yet */ }
    await sleep(200); // eslint-disable-line no-await-in-loop
  }

  const b = await chromium.launch();
  const run = 20 + Math.floor(Math.random() * 200); let nets = 0;
  const mk = async ({ base = BASE, scheme = 'light', width = 390 } = {}) => {
    nets += 1;
    const c = await b.newContext({
      viewport: { width, height: 844 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', colorScheme: scheme, extraHTTPHeaders: { 'X-Forwarded-For': `10.${run}.${100 + nets}.7` },
    });
    await c.addInitScript(() => { window.__noShareMoments = true; window.__noNightAuto = true; window.open = (u) => { (window.__opened = window.__opened || []).push(String(u)); return null; }; });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(base); await p.waitForTimeout(900);
    await p.evaluate(() => { App.isNight = () => false; if (App.applyTheme) App.applyTheme(); });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const text = (p, sel) => S(p, (s) => (document.querySelector(s) || {}).innerText || '', sel);
  const pts = (p) => S(p, () => (App.store.state.share && App.store.state.share.points) || 0);
  const ids = (p) => S(p, () => App.starter.tasks().map((t) => `${t.id}${t.ok ? '✓' : ''}`).join(' '));
  const go = async (p, id, ms = 700) => { await S(p, (x) => App.navigate(x, { n: Math.random() }), id); await p.waitForTimeout(ms); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const setupPreg = async (p) => {
    await p.click('.ob-choice:has-text("懷孕")'); await p.waitForTimeout(300);
    await p.fill('.onboard input[placeholder="怎麼稱呼你？（選填）"]', '小雨');
    const d = p.locator('.onboard input[type=date]'); await d.nth(1).fill('2027-04-20'); await d.nth(1).dispatchEvent('change');
    await p.click('text=完成，開始使用'); await p.waitForTimeout(1600);
  };
  const setupBaby = async (p, days, weight = '') => {
    await p.click('.ob-choice:has-text("育兒")'); await p.waitForTimeout(300);
    await p.fill('.onboard input[placeholder="寶寶的名字或小名"]', '小湯圓');
    await p.fill('.onboard input[type=date]', await S(p, (n) => Core.dateKey(Core.addDays(new Date(), -n)), days));
    if (weight) await p.fill('.onboard input[placeholder="3.20"]', weight);
    await p.click('text=完成，開始使用'); await p.waitForTimeout(1600);
  };

  /* ---------- 懷孕中, a copy of the app without the member service ---------- */
  const P = await mk();
  await setupPreg(P);
  const card = await text(P, '.st-home');
  ok('懷孕中, just set up: 首頁「新手任務 1/5」 (the due date counts already), the next task and its button', /新手任務\s*1\/5/.test(card) && /記錄一次胎動、體重或身體狀況/.test(card) && /記體重/.test(card) && /做完再 \+15 點/.test(card), card.replace(/\n/g, ' / '));
  ok('…the five tasks: 預產期, 第一筆紀錄, 邀請家人, 好孕島, and without the member service 滴雞精打卡', (await ids(P)) === 'profile✓ record family island chicken', await ids(P));
  ok('…what was already done gives its points quietly (+5, no toast)', (await pts(P)) === 5 && !/新手任務/.test(await text(P, '.toast-wrap')), await pts(P));
  await P.click('.st-go'); await P.waitForTimeout(700);
  ok('「記體重」 opens 體重紀錄', (await S(P, () => document.body.dataset.screen)) === 'pregweight');
  await S(P, () => App.store.update((s) => { s.preg.weights.push({ id: 'w1', date: Core.dateKey(), kg: 58 }); })); await P.waitForTimeout(400);
  ok('a weight recorded: 「新手任務：記錄一次… 好孕點數 +5」', /新手任務：記錄一次胎動、體重或身體狀況　好孕點數 \+5/.test(await text(P, '.toast-wrap')) && (await pts(P)) === 10, await text(P, '.toast-wrap'));
  await go(P, 'me', 800);
  await P.click('#view button:has-text("LINE 邀請")'); await P.waitForTimeout(500);
  ok('我的 →「LINE 邀請」 counts as 邀請家人', /family✓/.test(await ids(P)) && (await pts(P)) === 15, await ids(P));
  await go(P, 'home', 900);
  await P.click('.st-all'); await P.waitForTimeout(500);
  const sheet = await text(P, '.sheet-backdrop.open .sheet');
  ok('「看全部」: all five with ✓ for the done ones, a button for each of the others, +15 for all', /新手任務 3\/5/.test(sheet) && (await S(P, () => document.querySelectorAll('.sheet-backdrop.open .st-row.ok').length)) === 3 && (await S(P, () => document.querySelectorAll('.sheet-backdrop.open .st-row-go').length)) === 2 && /全部做完再 \+15 點/.test(sheet), sheet.replace(/\n/g, ' / '));
  await axe(P, '新手任務 list (light)');
  await P.click('.sheet-backdrop.open .st-row-go:has-text("上島")'); await P.waitForTimeout(900);
  ok('…a task\'s button goes there (上島 → 好孕島)', (await S(P, () => document.body.dataset.screen)) === 'island');
  await S(P, () => App.store.update((s) => { s.island.stamps.s1 = Core.dateKey(); })); await P.waitForTimeout(300);
  await go(P, 'home', 900);
  await P.locator('.st-home').scrollIntoViewIfNeeded();
  await P.click('.st-go:has-text("打卡")'); await P.waitForTimeout(600);
  ok('the last one (打卡 right on the card): 「新手任務全部完成！」 and +5 +15', /新手任務全部完成！好孕點數 \+20/.test(await text(P, '.toast-wrap')) && (await pts(P)) === 40, `${await text(P, '.toast-wrap')} ${await pts(P)}`);
  const doneCard = await text(P, '.st-home');
  ok('…the card says 「新手任務完成了」 for the rest of the day, with the total', /新手任務完成了/.test(doneCard) && /一共 \+40/.test(doneCard), doneCard.replace(/\n/g, ' / '));
  await P.click('.st-home .st-x'); await P.waitForTimeout(400);
  ok('…✕ puts it away', !(await P.isVisible('.st-home')));
  await S(P, () => App.store.update((s) => { s.share.points += 0; })); await P.waitForTimeout(300);
  ok('…and the points are not given twice', (await pts(P)) === 40);
  await P.context().close();

  /* ---------- ✕ while in progress; sample data; someone who has used the app for months ---------- */
  const Q = await mk({ scheme: 'dark' });
  await setupPreg(Q);
  await axe(Q, '新手任務 card on 首頁 (dark)');
  await Q.click('.st-home .st-x'); await Q.waitForTimeout(400);
  ok('✕ while in progress: put away, and told that what she does still counts', !(await Q.isVisible('.st-home')) && /做到的事一樣會加好孕點數/.test(await text(Q, '.toast-wrap')));
  await S(Q, () => App.store.update((s) => { s.preg.kicks.push({ id: 'k1', start: new Date().toISOString(), end: new Date().toISOString(), count: 10 }); })); await Q.waitForTimeout(300);
  ok('…it does (+5 for 胎動)', (await pts(Q)) === 10, await pts(Q));
  await Q.context().close();
  const D = await mk();
  await D.click('text=先看看範例資料'); await D.waitForTimeout(1200);
  ok('sample data (先看看範例資料): no 新手任務', !(await D.isVisible('.st-home')) && !(await S(D, () => App.starter.active())));
  await S(D, () => { const s = App.store.defaults(); s.onboarded = true; s.onboardedAt = Core.dateKey(Core.addDays(new Date(), -60)); s.profile.stage = 'preg'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -150)); App.store.replace(s); });
  await go(D, 'home', 800);
  ok('set up 60 days ago: no 新手任務 either', !(await D.isVisible('.st-home')));
  await D.context().close();

  /* ---------- 備孕 and 育兒: their own first two tasks ---------- */
  const R = await mk();
  await S(R, () => { const s = App.store.defaults(); s.onboarded = true; s.onboardedAt = new Date().toISOString(); s.profile.stage = 'prep'; s.settings.a2hsDismissed = '1'; App.store.replace(s); });
  await go(R, 'home', 900);
  ok('備孕: 記下最近一次月經, then 孕前準備清單勾一項', /記下最近一次月經/.test(await text(R, '.st-home')) && (await ids(R)).startsWith('profile record'), await ids(R));
  await S(R, () => App.store.update((s) => { s.periods.push({ id: 'p1', start: Core.dateKey(Core.addDays(new Date(), -10)), end: Core.dateKey(Core.addDays(new Date(), -6)) }); s.prepChecklist = { folic: Core.dateKey() }; })); await R.waitForTimeout(300);
  ok('…both done (+10)', (await ids(R)).startsWith('profile✓ record✓') && (await pts(R)) === 10, await ids(R));
  await R.context().close();

  /* ---------- 坐月子: the suggestions fold into one row ---------- */
  const N = await mk({ base: API_BASE });
  await setupBaby(N, 10);
  ok('育兒 (no birth weight given): 填好寶寶的出生體重, then 第一筆餵奶、尿布或睡眠; 註冊會員 with the member service', (await ids(N)) === 'profile record family island member', await ids(N));
  const folded = await S(N, () => [...document.querySelectorAll('.home-more-cards > .home-slot')].map((e) => e.dataset.card));
  ok('a 10-day-old: 好孕島, 團購 and 好孕圈 fold into 「更多：…」 at the bottom (closed)', folded.includes('groupbuy') && folded.includes('island-progress') && /更多：好孕島、團購/.test(await text(N, '.home-more')) && await S(N, () => document.querySelector('.home-more-cards').hidden) && !(await N.isVisible('[data-card="groupbuy"]')), folded.join(','));
  ok('…today\'s essentials stay: 坐月子, 新手任務, 福利, 今日小任務, 健康追蹤', await S(N, () => ['postpartum', 'starter', 'benefits-now', 'daily', 'baby-health'].every((id) => document.querySelector(`#view > .home-slot[data-card="${id}"]`))));
  await N.click('.home-more'); await N.waitForTimeout(500);
  ok('tap 「更多」: the cards open (and 「收起推薦」)', await N.isVisible('[data-card="groupbuy"]') && /收起推薦/.test(await text(N, '.home-more')) && (await N.getAttribute('.home-more', 'aria-expanded')) === 'true');
  await axe(N, '首頁 in 坐月子, suggestions open');
  await N.click('.home-more'); await N.waitForTimeout(400);
  ok('…and close again', !(await N.isVisible('[data-card="groupbuy"]')));
  /* sign up: the welcome is the 新手任務 list */
  await go(N, 'login', 900);
  if (await N.isVisible('.login-form .seg button:has-text("註冊")')) await N.click('.login-form .seg button:has-text("註冊")');
  await N.fill('input[aria-label="Email 或手機"]', `starter-${Date.now().toString(36)}@example.com`); await N.fill('input[aria-label="密碼"]', 'tangyuan-2026');
  await N.check('.login-form .pv-box.req input');
  await N.click('.login-form button[type=submit]'); await N.waitForTimeout(1200);
  await N.fill('.login-code', ((await text(N, '.login-code-hint')).match(/(\d{6})/) || [])[1] || '');
  await N.click('.login-form button[type=submit]'); await N.waitForTimeout(2500);
  const hello = await text(N, '.sheet-backdrop.open .sheet');
  ok('signed up: 「歡迎加入」 with the list, 註冊會員 already ✓', /歡迎加入/.test(hello) && /註冊會員\s*完成・\+5 點/.test(hello), hello.replace(/\n/g, ' / '));
  ok('…and no toast lying on top of it', !(await N.isVisible('.toast.show')), await text(N, '.toast-wrap'));
  await N.keyboard.press('Escape'); await N.waitForTimeout(400);
  /* her own team is hers: never folded */
  await go(N, 'groupbuy', 1500);
  await N.click('#view button:has-text("開一團")'); await N.waitForTimeout(700);
  await N.click('.gb-start-go'); await N.waitForTimeout(1800);
  if (await N.isVisible('.sheet-backdrop.open')) { await N.keyboard.press('Escape'); await N.waitForTimeout(400); }
  await go(N, 'home', 1500);
  ok('her own 團購 team (還差 2 人) stays on 首頁, not under 「更多」', await N.isVisible('#view > .home-slot[data-card="groupbuy"]') && /還差 2 人/.test(await text(N, '#view > .home-slot[data-card="groupbuy"]')));
  /* always show everything */
  await N.click('.home-more'); await N.waitForTimeout(400);
  await N.click('.home-more-off'); await N.waitForTimeout(500);
  ok('「以後都不要收起來」: everything shows from now on', !(await N.isVisible('.home-more')) && await N.isVisible('[data-card="island-progress"]') && await S(N, () => App.store.state.settings.calmHomeOff === true));
  await N.context().close();

  /* ---------- after 30 days nothing folds; a small phone ---------- */
  const O = await mk({ width: 320 });
  await setupBaby(O, 40, '3.1');
  ok('a 40-day-old: nothing folded, and the birth weight counts', !(await O.isVisible('.home-more')) && (await ids(O)).startsWith('profile✓'), await ids(O));
  await S(O, () => App.store.update((s) => { s.babies[0].birthday = Core.dateKey(Core.addDays(new Date(), -5)); })); await go(O, 'home', 900);
  ok('320 px wide: the 新手任務 card and 「更多」 fit (no sideways scrolling)', await S(O, () => document.documentElement.scrollWidth <= innerWidth) && await O.isVisible('.st-home') && await O.isVisible('.home-more'));
  await O.context().close();

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
  server.kill();
  if (serverErr && process.exitCode) console.error(serverErr.slice(0, 500));
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
