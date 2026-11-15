// 會員與即時人數（需要後端）：註冊、登入、邀請碼計數、在線／註冊人數、錯誤訊息、離線隱藏。
// Usage: (repo root) APP_PORT=8790 node api/index.js      then   node mom-app/tests/account.playwright.cjs
//        BASE=http://localhost:8790/mom-app/  STATIC_BASE=<optional static-only host to check the offline state>
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8790/mom-app/';
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });
(async () => {
  const b = await chromium.launch();
  const mk = async () => {
    const c = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage();
    await p.addInitScript(() => { window.__noShareMoments = true; });
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const stats = (p) => S(p, async () => (await fetch('api/stats')).json());
  const uniq = Date.now().toString(36);
  const before = await (async () => { const p = await mk(); await p.goto(BASE); await p.waitForTimeout(300); const s = await stats(p); await p.context().close(); return s; })();

  const A = await mk();
  await A.goto(BASE); await A.waitForTimeout(1500);
  const pill = await S(A, () => document.querySelector('.live-pill:not([hidden])')?.innerText.replace(/\n/g, '') || '');
  ok('welcome shows real online/registered counts', /現在 \d+ 位在線上/.test(pill) && /已有 [\d,]+ 位媽咪註冊/.test(pill) && !/null|undefined/.test(pill), pill);
  await A.click('text=已有帳號？登入／註冊'); await A.waitForTimeout(800);
  ok('login page reachable before setup', (await S(A, () => document.body.dataset.screen)) === 'login');
  await A.click('.login-form .seg button:has-text("註冊")'); await A.waitForTimeout(250);
  await A.fill('input[aria-label="Email 或手機"]', `amy-${uniq}@example.com`); await A.fill('input[aria-label="密碼"]', 'short');
  await A.click('.login-form button[type=submit]'); await A.waitForTimeout(500);
  ok('weak password rejected with message', /至少 8 個字/.test(await S(A, () => document.querySelector('.login-err:not([hidden])')?.textContent || '')));
  await A.fill('input[aria-label="密碼"]', 'password-001'); await A.fill('input[aria-label="暱稱"]', 'Amy');
  await A.click('.login-form button[type=submit]'); await A.waitForTimeout(900);
  const ua = await S(A, () => ({ u: App.store.state.auth && App.store.state.auth.user, code: App.store.state.share.code }));
  ok('register logs in and adopts the server invite code', ua.u && ua.u.nickname === 'Amy' && ua.u.code === ua.code, JSON.stringify(ua));
  await A.click('text=先看看範例資料'); await A.waitForTimeout(500);
  ok('loading demo data keeps the login', await S(A, () => !!(App.store.state.auth && App.store.state.auth.token)));

  const link = await S(A, () => App.share.link({ channel: 'line', campaign: 'invite' }));
  const Bp = await mk();
  await Bp.goto(link); await Bp.waitForTimeout(1500);
  ok('invite link: welcome says who invited you', await Bp.isVisible('text=邀請你一起使用'));
  await Bp.click('text=已有帳號？登入／註冊'); await Bp.waitForTimeout(700);
  await Bp.click('.login-form .seg button:has-text("註冊")'); await Bp.waitForTimeout(250);
  ok('invite code prefilled on register', (await Bp.inputValue('input[aria-label="邀請碼"]')) === ua.code);
  const phone = `09${String(Date.now()).slice(-8)}`;
  await Bp.fill('input[aria-label="Email 或手機"]', phone); await Bp.fill('input[aria-label="密碼"]', 'password-002');
  await Bp.click('.login-form button[type=submit]'); await Bp.waitForTimeout(900);
  ok('phone registration works (account masked)', /^09\d{2}\*\*\*\d{3}$/.test(await S(Bp, () => App.store.state.auth.user.accountHint)));

  const after = await stats(A);
  ok('registered count went up by 2', after.registered === before.registered + 2, `${before.registered} → ${after.registered}`);
  ok('online count includes both open apps', after.online >= 2, `online ${after.online}`);
  await A.goto(`${BASE}#/me`); await A.waitForTimeout(1200);
  ok('inviter sees the successful referral', /已成功邀請 1 位/.test(await S(A, () => document.querySelector('.acct-card')?.innerText || '')));
  await A.click('.acct-card button:has-text("登出")'); await A.waitForTimeout(300);
  ok('logout keeps local records', !(await S(A, () => !!App.store.state.auth)) && (await S(A, () => App.store.state.logs.length)) > 10);
  await A.goto(`${BASE}#/login`); await A.waitForTimeout(800);
  await A.fill('input[aria-label="Email 或手機"]', `amy-${uniq}@example.com`); await A.fill('input[aria-label="密碼"]', 'wrong-pass-1');
  await A.click('.login-form button[type=submit]'); await A.waitForTimeout(600);
  ok('wrong password message', /帳號或密碼不正確/.test(await S(A, () => document.querySelector('.login-err:not([hidden])')?.textContent || '')));
  await A.fill('input[aria-label="密碼"]', 'password-001'); await A.click('.login-form button[type=submit]'); await A.waitForTimeout(800);
  ok('login again', (await S(A, () => App.store.state.auth && App.store.state.auth.user.nickname)) === 'Amy');
  const cfg = await S(A, async () => (await fetch('api/config')).json());
  ok('LINE button only when the server has LINE configured', (await A.isVisible('.login-line')) === !!cfg.providers.line);
  if (process.env.STATIC_BASE) {
    const C = await mk(); await C.goto(`${process.env.STATIC_BASE}#/login`); await C.waitForTimeout(1500);
    ok('static host (no API): counts hidden, login explains', !(await C.isVisible('.live-pill')) && await C.isVisible('text=目前無法連到會員服務'));
  }
  ok('no page errors', !errs.filter((e) => !/Failed to load resource/.test(e) || /api\//.test(e)).length, errs.slice(0, 3).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); process.exit(1); });
