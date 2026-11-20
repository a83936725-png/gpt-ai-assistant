// 驗證碼與忘記密碼：註冊先收驗證碼、錯的／重寄、忘記密碼（其他裝置登出）、已驗證的帳號、邀請連結註冊後的見面禮。
// Starts its own member API (port 8792) with MOM_CODE_ECHO=1, so the test can read each code; nothing is sent anywhere.
// Usage: (repo root) node mom-app/tests/verify.playwright.cjs        AXE_PATH=<axe.min.js> for the accessibility checks
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = process.env.VERIFY_PORT || '8792';
const BASE = `http://localhost:${PORT}/mom-app/`;
const AXE = process.env.AXE_PATH || '';
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;
process.on('exit', () => { if (server) server.kill(); }); // never leave the test server running

(async () => {
  // a server already on the port would be an old one with old code: refuse to test against it
  try { await fetch(`${BASE}api/config`); console.error(`SCRIPT ERROR port ${PORT} is already in use`); process.exit(1); } catch (e) { /* free */ }
  server = spawn(process.execPath, ['api/index.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env, APP_PORT: PORT, MOM_TRUST_PROXY: '1', MOM_CODE_ECHO: '1', LINE_LOGIN_CHANNEL_ID: '', NODE_ENV: 'development',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let serverErr = ''; server.stderr.on('data', (d) => { serverErr += d; });
  for (let i = 0; i < 50; i += 1) { // eslint-disable-line no-await-in-loop
    try { const r = await fetch(`${BASE}api/config`); if (r.ok) break; } catch (e) { /* not up yet */ }
    await sleep(200); // eslint-disable-line no-await-in-loop
  }
  const b = await chromium.launch();
  const run = 20 + Math.floor(Math.random() * 200); let nets = 0;
  const mk = async ({ scheme = 'light' } = {}) => {
    nets += 1;
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    await c.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${run}.${200 + nets}.4` });
    const p = await c.newPage();
    await p.addInitScript(() => { window.__noShareMoments = true; window.open = () => null; });
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const text = (p, sel) => S(p, (s) => (document.querySelector(s) || {}).innerText || '', sel);
  const devCode = async (p, sel = '.login-code-hint') => ((await text(p, sel)).match(/測試環境：(\d{6})/) || [])[1] || '';
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const uniq = Date.now().toString(36);

  /* ---- sign-up: a code first ---- */
  const A = await mk();
  await A.goto(BASE); await A.waitForTimeout(900);
  await A.click('text=先看看範例資料'); await A.waitForTimeout(500);
  await A.goto(`${BASE}#/login`); await A.waitForTimeout(900);
  await A.click('.login-form .seg button:has-text("註冊")'); await A.waitForTimeout(300);
  const email = `mia-${uniq}@example.com`;
  await A.fill('input[aria-label="Email 或手機"]', email); await A.fill('input[aria-label="密碼"]', 'short');
  await A.check('.login-form .pv-box.req input');
  await A.click('.login-form button[type=submit]'); await A.waitForTimeout(600);
  ok('a short password is caught before any code is sent', /至少 8 個字/.test(await text(A, '.login-err:not([hidden])')) && !(await A.isVisible('.login-code')));
  await A.fill('input[aria-label="密碼"]', 'password-001');
  await A.click('.login-form button[type=submit]'); await A.waitForTimeout(900);
  const hint = await text(A, '.login-code-hint');
  ok('註冊: the code step appears, says where it went (masked) and for how long', await A.isVisible('.login-code') && /已寄出 6 位數驗證碼到 m\*\*\*@example\.com，10 分鐘內有效/.test(hint) && /確認驗證碼並註冊/.test(await text(A, '.login-form button[type=submit]')), hint);
  ok('…重新寄送 waits a minute', /重新寄送（\d+）/.test(await text(A, '.login-resend')) && await S(A, () => document.querySelector('.login-resend').disabled));
  await axe(A, 'sign-up with the code step');
  const code = await devCode(A);
  await A.fill('.login-code', code === '000000' ? '111111' : '000000');
  await A.click('.login-form button[type=submit]'); await A.waitForTimeout(800);
  ok('a wrong code: a clear message, still on the form', /驗證碼不正確/.test(await text(A, '.login-err:not([hidden])')) && (await S(A, () => document.body.dataset.screen)) === 'login');
  await A.fill('.login-code', code);
  await A.click('.login-form button[type=submit]'); await A.waitForTimeout(1500);
  ok('the right code: signed up and logged in, verified', await S(A, () => !!(App.store.state.auth && App.store.state.auth.user && App.store.state.auth.user.verified)));

  /* ---- changing the address after the code was sent ---- */
  const B = await mk();
  await B.goto(`${BASE}#/login`); await B.waitForTimeout(900);
  await B.click('.login-form .seg button:has-text("註冊")'); await B.waitForTimeout(300);
  await B.fill('input[aria-label="Email 或手機"]', `0912${String(Date.now()).slice(-6)}`); await B.fill('input[aria-label="密碼"]', 'password-002');
  await B.check('.login-form .pv-box.req input');
  await B.click('.login-form button[type=submit]'); await B.waitForTimeout(900);
  ok('a phone sign-up gets a code too (masked number)', /已寄出 6 位數驗證碼到 0912\*\*\*\d{3}/.test(await text(B, '.login-code-hint')));
  await B.fill('input[aria-label="Email 或手機"]', `other-${uniq}@example.com`); await B.waitForTimeout(200);
  ok('changing the Email／手機 after sending: back to 「註冊並登入」 (a new code for the new address)', !(await B.isVisible('.login-code')) && /註冊並登入/.test(await text(B, '.login-form button[type=submit]')));

  /* ---- 忘記密碼 ---- */
  await S(A, () => App.account.logout({ quiet: true })); await A.goto(`${BASE}#/home`); await A.goto(`${BASE}#/login`); await A.waitForTimeout(900);
  ok('login page: 「忘記密碼？」', await A.isVisible('.login-forgot'));
  await A.fill('input[aria-label="Email 或手機"]', email);
  await A.click('.login-forgot'); await A.waitForTimeout(500);
  ok('…the sheet starts with her address filled in', (await A.inputValue('.sheet input[aria-label="Email 或手機"]')) === email);
  await A.click('.login-reset-go'); await A.waitForTimeout(900);
  const rHint = await text(A, '.sheet .login-code-hint');
  ok('寄驗證碼: 「如果 … 有註冊，會收到」 (never says whether it exists)', /如果 m\*\*\*@example\.com 有註冊，會收到 6 位數驗證碼/.test(rHint), rHint || await text(A, '.sheet'));
  await axe(A, '忘記密碼 sheet');
  await A.fill('.sheet .login-code', await devCode(A, '.sheet .login-code-hint'));
  await A.fill('.sheet input[aria-label="新密碼"]', 'brand-new-pass-7');
  await A.click('.login-reset-go'); await A.waitForTimeout(1500);
  ok('new password set: logged in, and told other devices were logged out', await S(A, () => !!(App.store.state.auth && App.store.state.auth.token)) && /密碼已更新，其他裝置都已登出/.test(await text(A, '.toast-wrap')));
  const logins = await S(A, async (em) => {
    const tryLogin = (pw) => fetch('api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: em, password: pw }) }).then((r) => r.status);
    return [await tryLogin('password-001'), await tryLogin('brand-new-pass-7')];
  }, email);
  ok('…the old password no longer works, the new one does', logins[0] === 401 && logins[1] === 200, logins.join(','));
  const C = await mk();
  await C.goto(`${BASE}#/login`); await C.waitForTimeout(900);
  await C.click('.login-forgot'); await C.waitForTimeout(400);
  await C.fill('.sheet input[aria-label="Email 或手機"]', `nobody-${uniq}@example.com`);
  await C.click('.login-reset-go'); await C.waitForTimeout(900);
  ok('an address that has no account gets the same answer (and no code)', /有註冊，會收到/.test(await text(C, '.sheet .login-code-hint')) && !(await devCode(C, '.sheet .login-code-hint')));

  /* ---- a verified account; a friend from an invite link ---- */
  await S(A, () => App.account.verifySheet()); await A.waitForTimeout(400);
  await A.click('.verify-go'); await A.waitForTimeout(800);
  ok('verifying an account that already is: 「已經驗證過了」', /已經驗證過了/.test(await text(A, '.toast-wrap')) && !(await A.isVisible('.sheet-backdrop.open')));
  await A.goto(`${BASE}#/me`); await A.waitForTimeout(900);
  ok('我的: no 「還沒驗證」 for a verified account', !(await A.isVisible('.acct-verify')));
  const link = await S(A, () => App.share.link({ channel: 'line', campaign: 'invite' }));
  const D = await mk({ scheme: 'dark' });
  await D.goto(link); await D.waitForTimeout(1200);
  await D.click('text=先看看範例資料'); await D.waitForTimeout(1000);
  await D.click('.gift-line-main'); await D.waitForTimeout(900);
  await D.fill('input[aria-label="Email 或手機"]', `friend-${uniq}@example.com`); await D.fill('input[aria-label="密碼"]', 'password-003');
  await D.check('.login-form .pv-box.req input');
  await D.click('.login-form button[type=submit]'); await D.waitForTimeout(900);
  await axe(D, 'code step (dark)');
  await D.fill('.login-code', await devCode(D));
  await D.click('.login-form button[type=submit]'); await D.waitForTimeout(2500);
  ok('a friend from an invite link: code, account, and her welcome gift', /見面禮 \+30/.test(await text(D, '.sheet')));

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
  server.kill();
  if (serverErr && process.exitCode) console.error(serverErr.slice(0, 500));
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
