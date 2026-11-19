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
  ok('welcome shows real online/registered counts', /現在 \d+ 位在線上/.test(pill) && (before.registered < 1 || /已有 [\d,]+ 位媽咪註冊/.test(pill)) && !/null|undefined/.test(pill), pill);
  await A.click('text=已有帳號？登入／註冊'); await A.waitForTimeout(800);
  ok('login page reachable before setup', (await S(A, () => document.body.dataset.screen)) === 'login');
  await A.click('.login-form .seg button:has-text("註冊")'); await A.waitForTimeout(250);
  await A.fill('input[aria-label="Email 或手機"]', `amy-${uniq}@example.com`); await A.fill('input[aria-label="密碼"]', 'short');
  // 個資: the policy box starts unticked and is required; marketing is a separate, optional box
  const boxes = await S(A, () => [...document.querySelectorAll('.login-form .pv-box')].map((b) => ({ req: b.classList.contains('req'), on: b.querySelector('input').checked, t: b.innerText })));
  ok('register shows an unticked, required 「我已閱讀並同意《隱私權政策與使用條款》」 and an optional marketing box', boxes.length === 2 && boxes[0].req && !boxes[0].on && /隱私權政策與使用條款/.test(boxes[0].t) && !boxes[1].req && !boxes[1].on && /優惠與活動訊息/.test(boxes[1].t), JSON.stringify(boxes));
  const sentBefore = (await stats(A)).registered;
  await A.click('.login-form button[type=submit]'); await A.waitForTimeout(500);
  ok('without the tick: a clear message, nothing is sent', /請先勾選/.test(await S(A, () => document.querySelector('.pv-miss')?.textContent || '')) && (await stats(A)).registered === sentBefore);
  await A.click('.login-form .pv-box.req .pv-link'); await A.waitForTimeout(500);
  ok('the policy opens on top of the form (個資法 items: purpose, data, where, rights) and does not tick the box', /一、蒐集的目的/.test(await S(A, () => [...document.querySelectorAll('.sheet')].pop()?.innerText || '')) && /你的權利/.test(await S(A, () => [...document.querySelectorAll('.sheet')].pop()?.innerText || '')) && !(await S(A, () => document.querySelector('.login-form .pv-box.req input').checked)));
  await A.keyboard.press('Escape'); await A.waitForTimeout(300);
  ok('…and what she typed is still there', (await A.inputValue('input[aria-label="Email 或手機"]')) === `amy-${uniq}@example.com`);
  await A.check('.login-form .pv-box.req input');
  await A.click('.login-form button[type=submit]'); await A.waitForTimeout(500);
  ok('weak password rejected with message', /至少 8 個字/.test(await S(A, () => document.querySelector('.login-err:not([hidden])')?.textContent || '')));
  await A.fill('input[aria-label="密碼"]', 'password-001'); await A.fill('input[aria-label="暱稱"]', 'Amy');
  await A.click('.login-form button[type=submit]'); await A.waitForTimeout(900);
  const ua = await S(A, () => ({ u: App.store.state.auth && App.store.state.auth.user, code: App.store.state.share.code }));
  ok('register logs in and adopts the server invite code', ua.u && ua.u.nickname === 'Amy' && ua.u.code === ua.code, JSON.stringify(ua));
  ok('the consent (current version) is kept with the account; marketing stays off unless ticked', ua.u && ua.u.consent === (await S(A, () => App.privacy.VERSION)) && ua.u.marketing === false, JSON.stringify(ua.u));
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
  await Bp.check('.login-form .pv-box.req input'); await Bp.check('.login-form .pv-box:not(.req) input');
  await Bp.click('.login-form button[type=submit]'); await Bp.waitForTimeout(900);
  ok('phone registration works (account masked)', /^09\d{2}\*\*\*\d{3}$/.test(await S(Bp, () => App.store.state.auth.user.accountHint)));
  ok('ticking marketing is kept as a yes', (await S(Bp, () => App.store.state.auth.user.marketing)) === true);

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
  // a 「登入連結」 planted by someone else (token without this browser's nonce) must be refused
  await A.click('text=登出', { timeout: 3000 }).catch(() => {});
  await A.goto(`${BASE}#/me`); await A.waitForTimeout(500);
  if (await A.isVisible('.acct-card button:has-text("登出")')) { await A.click('.acct-card button:has-text("登出") >> nth=0'); await A.waitForTimeout(300); }
  const planted = (await S(A, async () => (await (await fetch('api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: '0900000000', password: 'nope-nope' }) })).json())));
  await A.goto(`${BASE}#/login?${encodeURIComponent(JSON.stringify({ token: 'planted.token-from-attacker' }))}`); await A.waitForTimeout(900);
  ok('planted login link is refused (no nonce from this browser)', await A.isVisible('text=這個登入連結無法使用') && !(await S(A, () => !!App.store.state.auth)), JSON.stringify(planted));
  ok('login token is scrubbed from the address bar', !(await S(A, () => location.hash.includes('token'))));
  ok('LINE button only when the server has LINE configured', (await A.isVisible('.login-line')) === !!cfg.providers.line);

  /* ---- 個資: my rights in 我的 → 帳號 ---- */
  await S(Bp, () => App.demo.seed()); await Bp.waitForTimeout(500); // set up (sample data keeps the login)
  await Bp.goto(`${BASE}#/me`); await Bp.waitForTimeout(1200);
  const card = await S(Bp, () => document.querySelector('.acct-card')?.innerText || '');
  ok('帳號 card: marketing switch, 隱私權政策, 下載我的會員資料, 刪除帳號', /接收優惠與活動訊息/.test(card) && /隱私權政策/.test(card) && /下載我的會員資料/.test(card) && /刪除帳號/.test(card), card);
  await Bp.click('.acct-links button:has-text("修改暱稱")'); await Bp.waitForTimeout(400);
  await Bp.fill('.sheet input[aria-label="暱稱"]', '小芳'); await Bp.click('.sheet-footer .btn-primary'); await Bp.waitForTimeout(800);
  ok('修改暱稱 corrects it on the server (個資法 §3)', (await S(Bp, async () => (await App.account.call('GET', 'me')).user.nickname)) === '小芳');
  await Bp.click('.acct-mkt input'); await Bp.waitForTimeout(800);
  ok('turning marketing off is instant and saved on the server', (await S(Bp, async () => (await App.account.call('GET', 'me')).user.marketing)) === false);
  await S(Bp, () => { window.__dl = null; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = { name: this.download, href: this.href }; return; } orig.call(this); }; });
  await Bp.click('.acct-links button:has-text("下載我的會員資料")'); await Bp.waitForTimeout(900);
  const dl = await S(Bp, async () => { if (!window.__dl) return null; const t = await (await fetch(window.__dl.href)).text(); return { name: window.__dl.name, t }; });
  ok('下載我的會員資料: a file with what the server keeps (never the password)', dl && /我的會員資料/.test(dl.name) && dl.t.includes(phone) && /"consent"/.test(dl.t) && !/scrypt|passwordHash/.test(dl.t), dl && dl.t.slice(0, 200));
  // agreeing again after a policy change (simulated): the sheet asks before anything else
  await S(Bp, () => App.account.ensureConsent({ ...App.store.state.auth.user, consent: '2020-01-01' })); await Bp.waitForTimeout(500);
  ok('a changed policy: 「隱私權政策已更新」 asks to agree again', /隱私權政策已更新/.test(await S(Bp, () => [...document.querySelectorAll('.sheet')].pop()?.innerText || '')));
  await Bp.click('.sheet-footer .btn-primary'); await Bp.waitForTimeout(400);
  ok('…agreeing needs the tick there too', /請先勾選/.test(await S(Bp, () => document.querySelector('.sheet .pv-miss')?.textContent || '')));
  await Bp.check('.sheet .pv-box.req input'); await Bp.click('.sheet-footer .btn-primary'); await Bp.waitForTimeout(800);
  ok('…and is recorded', (await S(Bp, async () => (await App.account.call('GET', 'me')).user.consent)) === (await S(Bp, () => App.privacy.VERSION)) && !(await S(Bp, () => !!document.querySelector('.sheet-backdrop.open'))));
  // 刪除帳號: the password is asked again
  const regBefore = (await stats(Bp)).registered;
  await Bp.click('.acct-links button:has-text("刪除帳號")'); await Bp.waitForTimeout(400);
  await Bp.fill('.sheet input[aria-label="密碼"]', 'wrong-password-9'); await Bp.click('.sheet button:has-text("永久刪除帳號")'); await Bp.waitForTimeout(700);
  ok('刪除帳號: a wrong password is refused', /密碼不正確/.test(await S(Bp, () => document.querySelector('.sheet .login-err')?.textContent || '')) && await S(Bp, () => !!App.store.state.auth));
  await Bp.fill('.sheet input[aria-label="密碼"]', 'password-002'); await Bp.click('.sheet button:has-text("永久刪除帳號")'); await Bp.waitForTimeout(1200);
  ok('…the right one deletes it: logged out, records still on the phone', !(await S(Bp, () => !!App.store.state.auth)) && (await stats(Bp)).registered === regBefore - 1);
  const relog = await S(Bp, (ph) => App.account.call('POST', 'auth/login', { account: ph, password: 'password-002' }).then(() => 'ok').catch((e) => e.code), phone);
  ok('…and the account is gone from the server', relog === 'invalid', relog);
  // declining after a policy change logs out (an older account is kept; she can delete it herself)
  await A.goto(`${BASE}#/login`); await A.waitForTimeout(900);
  await A.fill('input[aria-label="Email 或手機"]', `amy-${uniq}@example.com`); await A.fill('input[aria-label="密碼"]', 'password-001');
  await A.click('.login-form button[type=submit]'); await A.waitForTimeout(1200);
  await S(A, () => App.account.ensureConsent({ ...App.store.state.auth.user, consent: '2020-01-01' })); await A.waitForTimeout(500);
  await A.click('.sheet-footer button:has-text("不同意")'); await A.waitForTimeout(800);
  ok('declining a changed policy logs out (records stay on the phone)', !(await S(A, () => !!App.store.state.auth)) && (await S(A, () => App.store.state.logs.length)) > 10);
  if (process.env.STATIC_BASE) {
    const C = await mk(); await C.goto(`${process.env.STATIC_BASE}#/login`); await C.waitForTimeout(1500);
    ok('static host (no API): counts hidden, login explains', !(await C.isVisible('.live-pill')) && await C.isVisible('text=目前無法連到會員服務'));
  }
  ok('no page errors', !errs.filter((e) => !/Failed to load resource/.test(e) || /api\//.test(e)).length, errs.slice(0, 3).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
