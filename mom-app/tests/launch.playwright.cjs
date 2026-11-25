// The live site before its settings are in (0.9.7 + 0.9.8): the member server answers, but it has no database, no
// login secret and no push key yet — what customers see on https://ikigai-tw.vercel.app/mom-app/ until then.
//   · no 登入 button that can only end on 「會員服務即將開放」: the welcome link is not shown (also when the server's
//     answer comes after the screen was drawn), the 我的 card says 會員服務即將開放 (also on a page opened at #/me);
//   · 家人共用紀錄, 手機通知, 祝福牆 and 同週好孕圈 say 即將開放; no 「預覽版」「測試環境」「正式上線後」 anywhere;
//   · no 註冊會員 in the starter tasks; no live counts.
// The same screens are then checked with login switched on (everything back as before) and on a copy with no member
// server at all (the web preview keeps its own wording). The member server is stood in for (route mocks).
// Usage: BASE=http://localhost:8731/ AXE_PATH=<axe.min.js> node tests/launch.playwright.cjs
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8731/';
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const NOW = '2026-11-25T10:19:03+08:00';
const WRONG = /預覽版|測試環境|正式上線後|undefined|NaN|\[object Object\]/;

(async () => {
  const b = await chromium.launch();
  // mode: 'live' (the live site today), 'login' (login switched on), 'none' (no member server: the web preview)
  const mk = async ({ mode, delay = 0, hash = '' }) => {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', isMobile: true, hasTouch: true });
    await c.clock.install({ time: new Date(NOW) });
    await c.addInitScript(() => { window.__noShareMoments = true; window.__noNightAuto = true; window.open = () => null; });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(`${mode}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(`${mode}: ${m.text()}`); });
    const pol = { v: '2026-11-21' };
    await p.route('**/api/**', async (route) => {
      const req = route.request(); const path = new URL(req.url()).pathname.replace(/^.*\/api\//, '');
      const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
      if (mode === 'none') return route.fulfill({ status: 404, contentType: 'text/html', body: 'Cannot GET' });
      if (path === 'config') {
        if (delay) await new Promise((r) => { setTimeout(r, delay); });
        const on = mode === 'login';
        return json({ providers: { password: on, line: false }, storage: on ? 'redis' : 'memory', social: on, policy: pol.v, verify: { email: false, phone: false }, push: null, lineNotify: false });
      }
      if (path === 'stats') return mode === 'login' ? json({ online: 3, registered: 10, todaySignups: 1, storage: 'redis' }) : json({ error: 'not_available' }, 404);
      if (path === 'groupbuy') return json({ campaigns: [], mine: {} });
      if (path === 'groupbuy/live') return json({ live: {} });
      if (path === 'social/counts') return json({ counts: {} });
      if (req.method() === 'GET') return json({ error: 'not_found' }, 404);
      return json({ ok: true });
    });
    await p.goto(BASE + hash);
    await p.waitForFunction(() => window.App && App.store && !App.store.loading, null, { timeout: 20000 });
    pol.v = await p.evaluate(() => App.privacy.VERSION);
    await p.evaluate(() => { App.isNight = () => false; App.applyTheme(); });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, screen, ms = 1000) => { await S(p, (x) => App.navigate(x), screen); await p.waitForTimeout(ms); };
  const text = (p, sel = '#view') => S(p, (q) => ((document.querySelector(q) || document.body).innerText || '').replace(/\s+/g, ' '), sel);
  const visible = (p, sel) => p.isVisible(sel).catch(() => false);
  const demo = async (p) => { await p.click('text=先看看範例資料'); await p.waitForTimeout(900); await S(p, () => App.store.update((s) => { s.settings.a2hsDismissed = '1'; })); };
  const why = (p, sel) => S(p, (q) => { const e = document.querySelector(q); return e ? e.dataset.why : ''; }, sel);
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };

  /* ---------- 1. the live site before its settings are in ---------- */
  // the server's answer comes 1.2 s after the welcome screen is drawn, as on a slow phone network
  const L = await mk({ mode: 'live', delay: 1200 });
  ok('live: the welcome screen is up before the server answers', await visible(L, 'text=先看看範例資料'));
  await L.waitForTimeout(1800);
  ok('live: no 「已有帳號？登入／註冊」 once the server says login is not open (it would end on 即將開放)', !(await visible(L, '.ob-login')));
  const t = await text(L, 'body');
  ok('live: the welcome screen has no 預覽版／測試環境 wording and no live counts', !WRONG.test(t) && !/線上|位媽媽在線/.test(t), t.slice(0, 300));
  if (SHOT) await L.screenshot({ path: `${SHOT}launch-welcome.png` });
  await demo(L);
  const tasks = await S(L, () => (App.starter ? App.starter.tasks().map((x) => x.id) : []));
  ok('live: no 註冊會員 in the starter tasks', !tasks.includes('member'), tasks.join(','));
  await go(L, 'me');
  let me = await text(L, '.acct-card');
  ok('live: 我的 says 「會員服務即將開放」 instead of a 登入 button', /會員服務即將開放/.test(me) && /紀錄都存在這支手機/.test(me) && !(await visible(L, '.acct-card button')), me);
  ok('live: 我的 also says the social features are 即將開放 (0.9.7)', /即將開放，敬請期待/.test(await text(L)));
  ok('live: 我的 has nothing a customer should not see', !WRONG.test(await text(L)), (await text(L)).match(WRONG));
  await axe(L, '我的 with 會員服務即將開放');
  if (SHOT) await L.screenshot({ path: `${SHOT}launch-me.png`, fullPage: true });
  await go(L, 'family', 1400);
  const fam = await text(L);
  ok('live: 家人共用紀錄 says 即將開放, with the backup way meanwhile, and no 登入 button', (await why(L, '.fm-why')) === 'soon' && /家人共用紀錄即將開放，敬請期待/.test(fam) && /匯出／匯入備份/.test(fam) && !/登入／註冊/.test(fam) && !WRONG.test(fam), fam);
  await axe(L, '家人共用紀錄 即將開放');
  if (SHOT) await L.screenshot({ path: `${SHOT}launch-family.png` });
  await go(L, 'reminders', 1400);
  await L.waitForFunction(() => { const c = document.querySelector('.push-card'); return c && !/讀取中/.test(c.innerText); }, null, { timeout: 8000 }).catch(() => {});
  const push = await text(L, '.push-card');
  ok('live: 手機通知 says 即將開放, no 預覽版 and no 登入 button', (await why(L, '.push-why')) === 'soon' && /手機通知即將開放/.test(push) && !/登入／註冊/.test(push) && !WRONG.test(push), push);
  await go(L, 'circle', 1400);
  ok('live: 同週好孕圈 says 即將開放 (0.9.7)', /即將開放/.test(await text(L)) && !WRONG.test(await text(L)), await text(L));
  await go(L, 'login', 1400);
  ok('live: opened anyway, 登入 says 「會員服務即將開放」 and lets her go on', /會員服務即將開放/.test(await text(L)) && await visible(L, 'button:has-text("直接使用")'), await text(L));
  for (const scr of ['home', 'island', 'groupbuy', 'invite', 'privacy', 'brand', 'wall']) {
    await go(L, scr, 1200);
    const t = await text(L);
    ok(`live: ${scr} has nothing a customer should not see`, t.length > 20 && !WRONG.test(t), (t.match(WRONG) || [t.slice(0, 200)])[0]);
  }
  // a page opened straight at 我的 (a bookmark), with the server's answer late: the card is drawn again once it comes
  const L2 = await mk({ mode: 'live', delay: 1200 });
  await demo(L2);
  await L2.goto(`${BASE}#/me`); await L2.waitForTimeout(400);
  await L2.reload(); await L2.waitForFunction(() => window.App && App.store && !App.store.loading, null, { timeout: 20000 });
  await L2.waitForTimeout(2200);
  me = await text(L2, '.acct-card');
  ok('live: 我的 opened first, before the server answered, ends on 會員服務即將開放', /會員服務即將開放/.test(me) && !(await visible(L2, '.acct-card button')), me);

  /* ---------- 2. login switched on: every way in is back ---------- */
  const G = await mk({ mode: 'login' });
  await G.waitForTimeout(1500);
  ok('login on: the welcome link is there', await visible(G, '.ob-login'));
  await demo(G);
  await go(G, 'me');
  me = await text(G, '.acct-card');
  ok('login on: 我的 has 登入／註冊 with its button', /登入／註冊/.test(me) && await visible(G, '.acct-card button:has-text("登入")'), me);
  await go(G, 'family', 1400);
  ok('login on: 家人共用紀錄 asks to log in', (await why(G, '.fm-why')) === 'login' && await visible(G, 'button:has-text("登入／註冊")'));

  /* ---------- 3. no member server at all (the web preview): its own wording stays ---------- */
  const N = await mk({ mode: 'none' });
  await N.waitForTimeout(1500);
  ok('preview: the welcome link is there (as before)', await visible(N, '.ob-login'));
  await demo(N);
  await go(N, 'me');
  ok('preview: 我的 keeps 登入／註冊', /登入／註冊/.test(await text(N, '.acct-card')));
  await go(N, 'family', 1400);
  ok('preview: 家人共用紀錄 says this copy has no member service', (await why(N, '.fm-why')) === 'no-server' && /網頁預覽版/.test(await text(N)));
  await go(N, 'reminders', 1400);
  await N.waitForFunction(() => { const c = document.querySelector('.push-card'); return c && !/讀取中/.test(c.innerText); }, null, { timeout: 8000 }).catch(() => {});
  ok('preview: 手機通知 says this copy has no push', (await why(N, '.push-why')) === 'no-server');

  /* ---------- 4. links sent in LINE open in the phone's browser (LINE's openExternalBrowser) ---------- */
  const lineLink = await S(L, () => App.share.link({ channel: 'line', campaign: 'invite' }));
  const copyLink = await S(L, () => App.share.link({ channel: 'copy', campaign: 'share' }));
  ok('a link made for LINE asks LINE to open it in Safari / Chrome', /[?&]openExternalBrowser=1(&|#)/.test(lineLink) && /utm_source=line/.test(lineLink), lineLink);
  ok('…other links do not carry it', !/openExternalBrowser/.test(copyLink), copyLink);
  const F = await mk({ mode: 'live', hash: `?${lineLink.split('?')[1].split('#')[0]}#/home` });
  await F.waitForTimeout(1500);
  const fr = await S(F, () => ({ by: App.store.state.share && App.store.state.share.invitedBy, src: App.store.state.share && App.store.state.share.landing && App.store.state.share.landing.source, search: location.search }));
  ok('a friend opening it: the welcome screen, the invite remembered, the address bar tidied', await visible(F, 'text=先看看範例資料') && !!fr.by && fr.src === 'line' && !/openExternalBrowser|ref=/.test(fr.search), JSON.stringify(fr));
  const O = await mk({ mode: 'live', hash: '?openExternalBrowser=1' });
  await O.waitForTimeout(1200);
  ok('the link in the launch message (…/mom-app/?openExternalBrowser=1) opens the App', await visible(O, 'text=先看看範例資料'));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  const pass = results.filter((r) => r.pass).length;
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ← ${r.info}`}`));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
