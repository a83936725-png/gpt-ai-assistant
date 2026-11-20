// 團購揪團（需要後端，並設定一個測試團購）：開團、朋友從連結跟團（還沒設定 App 也能看）、成團後的折扣碼、首頁卡、
// 我的與品牌頁入口、退出／取消、每個團購只能跟一團、靜態網站不顯示。
// Usage: (repo root)
//   MOM_TRUST_PROXY=1 APP_PORT=8790 MOM_GROUPBUYS='[{"id":"gb-test","title":"易家滴雞精 10 入（測試）","desc":"常溫保存",
//     "emoji":"🍲","price":1980,"listPrice":2400,"size":3,"hours":48,"ends":"2026-12-31","shopUrl":"https://shop.example/gb",
//     "code":"TEAM-TEST-1","codeNote":"每位會員限用一次"}]' node api/index.js
//   BASE=http://localhost:8790/mom-app/ STATIC_BASE=<optional static-only host> node mom-app/tests/groupbuy.playwright.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8790/mom-app/';
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });
(async () => {
  const b = await chromium.launch();
  const run = 20 + Math.floor(Math.random() * 200);
  let nets = 0;
  const mk = async ({ width = 390, height = 844 } = {}) => {
    nets += 1;
    const c = await b.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
    await c.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${run}.${100 + nets}.3` });
    const p = await c.newPage();
    await p.addInitScript(() => { window.__noShareMoments = true; window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const uniq = Date.now().toString(36);
  const text = (p, sel) => S(p, (s) => (document.querySelector(s) || {}).innerText || '', sel);
  const closeSheets = async (p) => { for (let i = 0; i < 3 && await S(p, () => !!document.querySelector('.sheet-backdrop.open')); i += 1) { await p.keyboard.press('Escape'); await p.waitForTimeout(350); } };
  const fillRegister = async (p, who) => {
    await p.waitForTimeout(700);
    if (!(await p.isVisible('input[aria-label="邀請碼"]'))) { await p.click('.login-form .seg button:has-text("註冊")'); await p.waitForTimeout(300); }
    await p.fill('input[aria-label="Email 或手機"]', `${who}-${uniq}@example.com`); await p.fill('input[aria-label="密碼"]', 'password-001');
    await p.check('.login-form .pv-box.req input');
    await p.click('.login-form button[type=submit]'); await p.waitForTimeout(1500);
  };
  const setUpAndRegister = async (p, who) => {
    await p.goto(BASE); await p.waitForTimeout(1000);
    await p.click('text=先看看範例資料'); await p.waitForTimeout(600);
    await p.goto(`${BASE}#/login`);
    await fillRegister(p, who);
  };

  /* ---- A: sees the group-buy on 首頁, starts a team ---- */
  const A = await mk();
  await setUpAndRegister(A, 'leader');
  await A.goto(`${BASE}#/home`); await A.waitForTimeout(1800);
  const homeNew = await text(A, '.gb-home');
  ok('首頁: a new group-buy (price, team size), can be closed', /團購：易家滴雞精 10 入（測試）/.test(homeNew) && /團購價 NT\$1,980/.test(homeNew) && /3 人成團/.test(homeNew) && await A.isVisible('.gb-home-x'), homeNew);
  await A.click('.gb-home-go'); await A.waitForTimeout(1200);
  const card = await text(A, '.gb-card');
  ok('團購 page: price, the real 原價, size, hours, last day', /團購價 NT\$1,980/.test(card) && /原價 NT\$2,400/.test(card) && /3 人成團・開團後 48 小時內湊齊・活動到 12\/31/.test(card), card);
  await A.click('.gb-start'); await A.waitForTimeout(500);
  ok('開一團: asks for the team name (her nickname filled in) and says what friends will see', /看不到你的帳號或電話/.test(await text(A, '.sheet')) && (await A.inputValue('.sheet input[aria-label="團名"]')).length > 0);
  await A.fill('.sheet input[aria-label="團名"]', '小美 0912345678');
  await A.click('.gb-start-go'); await A.waitForTimeout(1800);
  ok('…the team page, with the invite options open', (await S(A, () => document.body.dataset.screen)) === 'groupbuy' && /邀請朋友跟團/.test(await text(A, '.sheet')));
  await closeSheets(A);
  const teamA = await text(A, '.gb-team');
  ok('team page: 「小美的團」 (no phone number), 1／3, time left', /小美的團/.test(teamA) && !/0912/.test(teamA) && /已 1／3 人/.test(teamA) && /還剩 (1 天|2 天|47 小時)/.test(teamA) && /還差 2 人就成團/.test(teamA), teamA);
  await A.click('.gb-line'); await A.waitForTimeout(300);
  const lineMsg = decodeURIComponent(await S(A, () => window.__opened.pop() || ''));
  const link = (lineMsg.match(/https?:\/\/\S+groupbuy\S*/) || [''])[0];
  ok('LINE invite: who, what, price, how many still needed, and the team link (with her invite code)', /小美的團揪團中：易家滴雞精 10 入（測試）/.test(lineMsg) && /團購價 NT\$1,980（原價 NT\$2,400）・3 人成團，還差 2 人/.test(lineMsg) && /ref=/.test(link) && /team/.test(decodeURIComponent(link)), lineMsg);
  ok('the leader can cancel while alone', /取消這一團/.test(await text(A, '.gb-actions')));
  const teamId = await S(A, () => JSON.parse(decodeURIComponent(location.hash.split('?')[1] || '%7B%7D')).team);

  /* ---- B: new, opens the link: sees the team before setting up, joins after signing up ---- */
  const Bp = await mk();
  await Bp.goto(link); await Bp.waitForTimeout(2000);
  const bView = await text(Bp, '#view');
  ok('a friend who never used the app sees the team right away (no setup first)', (await S(Bp, () => document.body.dataset.screen)) === 'groupbuy' && /小美的團/.test(bView) && /已 1／3 人/.test(bView) && !/TEAM-TEST/.test(bView), bView.slice(0, 200));
  ok('…with 「登入後跟團」 and a way into the app', /登入後跟團/.test(bView) && /開始使用 App/.test(bView));
  await Bp.click('.gb-join');
  await fillRegister(Bp, 'friend1');
  ok('after signing up she is back on that team', (await S(Bp, () => document.body.dataset.screen)) === 'groupbuy' && /我要跟團（還差 2 人）/.test(await text(Bp, '.gb-actions')));
  await Bp.click('.gb-join'); await Bp.waitForTimeout(1500);
  ok('跟團: 2／3, and now she can invite too', /已 2／3 人/.test(await text(Bp, '.gb-team')) && await Bp.isVisible('.gb-line') && /退出這一團/.test(await text(Bp, '.gb-actions')));

  /* ---- A can no longer cancel; C fills the team ---- */
  await A.goto(`${BASE}#/home`); await A.goto(`${BASE}#/groupbuy?${encodeURIComponent(JSON.stringify({ team: teamId }))}`); await A.waitForTimeout(1500);
  await S(A, () => App.refresh()); await A.waitForTimeout(400);
  ok('with a friend in, the leader can’t cancel (it would drop her)', /已 2／3 人/.test(await text(A, '.gb-team')) && !/取消這一團/.test(await text(A, '.gb-actions')), `${await text(A, '.gb-team')} | ${await text(A, '.gb-actions')} | ${await S(A, () => location.hash)}`);
  const Cp = await mk();
  await setUpAndRegister(Cp, 'friend2');
  await Cp.goto(link); await Cp.waitForTimeout(1500);
  // the link carries the leader's invite code: a new member also gets her 雙向邀請禮 welcome gift (sheet) first
  ok('…the team link also counts as an invite (welcome gift)', /見面禮 \+30/.test(await text(Cp, '.sheet')));
  await closeSheets(Cp);
  await Cp.click('.gb-join', { timeout: 8000 }); await Cp.waitForTimeout(1800);
  const cAct = await text(Cp, '.gb-actions');
  ok('the last one in: 成團, her code, the note, copy and the shop link', /成團了/.test(cAct) && /TEAM-TEST-1/.test(cAct) && /每位會員限用一次/.test(cAct) && (await S(Cp, () => document.querySelector('.gb-shop')?.href)) === 'https://shop.example/gb', cAct);
  await Cp.click('.gb-copy'); await Cp.waitForTimeout(300);
  ok('複製折扣碼', /已複製折扣碼/.test(await text(Cp, '.toast-wrap')) && (await S(Cp, () => navigator.clipboard.readText())) === 'TEAM-TEST-1');
  ok('…checkout stays on the shop (no payment, no address in the app)', /退換貨與發票都在官網/.test(cAct));

  /* ---- A: 首頁 says the team is full; the code once seen stops being pointed at ---- */
  await S(A, () => App.groupbuy.load(true)); await A.goto(`${BASE}#/home`); await A.waitForTimeout(1500);
  ok('首頁 (leader): 「你的團成團了！」', /你的團成團了/.test(await text(A, '.gb-home')));
  await A.click('.gb-home-go'); await A.waitForTimeout(1500);
  ok('…her code too', /TEAM-TEST-1/.test(await text(A, '.gb-actions')));
  await A.goto(`${BASE}#/home`); await A.waitForTimeout(1200);
  ok('…after seeing it, 首頁 no longer points at it', !/你的團成團了/.test(await text(A, '#view')));
  await A.goto(`${BASE}#/me`); await A.waitForTimeout(1000);
  ok('我的: 團購揪團 with her team’s status', /團購揪團/.test(await text(A, '#view')) && /成團了/.test(await S(A, () => [...document.querySelectorAll('.list-item')].find((e) => /團購揪團/.test(e.innerText))?.innerText || '')));
  await A.goto(`${BASE}#/brand`); await A.waitForTimeout(1000);
  ok('品牌頁: a group-buy card', /團購揪團/.test(await text(A, '.gb-brand')) && /團購價 NT\$1,980/.test(await text(A, '.gb-brand')));

  /* ---- D: too late; E: starts her own, cancels; B can't be in two teams ---- */
  const D = await mk();
  await setUpAndRegister(D, 'late');
  await D.goto(link); await D.waitForTimeout(1500);
  const dAct = await text(D, '.gb-actions');
  ok('a full team: 「已經成團了」, no code for her, start her own instead', /這一團已經成團了/.test(dAct) && !/TEAM-TEST/.test(dAct) && /自己開一團/.test(dAct), dAct);
  const E = await mk();
  await setUpAndRegister(E, 'own');
  await E.goto(`${BASE}#/groupbuy`); await E.waitForTimeout(1200);
  await E.click('.gb-start'); await E.waitForTimeout(400); await E.click('.gb-start-go'); await E.waitForTimeout(1800);
  await closeSheets(E);
  const eLink = await S(E, () => location.href);
  await Bp.goto(eLink); await Bp.waitForTimeout(1500);
  ok('one team per group-buy: B sees she is already in 「小美的團」', /你已經在「小美的團」了/.test(await text(Bp, '.gb-actions')));
  E.once('dialog', (d) => d.accept());
  await E.click('.gb-leave'); await E.waitForTimeout(400);
  if (await E.isVisible('.sheet-backdrop.open')) { await E.click('.sheet-backdrop.open .btn-primary, .sheet-backdrop.open .btn-danger'); }
  await E.waitForTimeout(1200);
  ok('取消這一團 (alone): back to the list, free to start again', (await S(E, () => document.body.dataset.screen)) === 'groupbuy' && await E.isVisible('.gb-start'), await text(E, '#view'));
  await Bp.goto(`${BASE}#/home`); await Bp.waitForTimeout(300);
  await Bp.goto(eLink); await Bp.waitForTimeout(1500);
  ok('…the cancelled team’s link says so', /找不到這一團/.test(await text(Bp, '#view')), await text(Bp, '#view'));

  /* ---- 首頁 ✕, small phone, privacy text ---- */
  await D.goto(`${BASE}#/home`); await D.waitForTimeout(1500);
  await S(D, () => App.groupbuy.load(true)); await D.waitForTimeout(600);
  const dHome = await text(D, '.gb-home');
  if (/團購：/.test(dHome)) {
    await D.click('.gb-home-x'); await D.waitForTimeout(500);
    ok('✕ on the new group-buy card hides it (and says where to find it)', !(await D.isVisible('.gb-home')) && /我的 → 團購揪團/.test(await text(D, '.toast')));
  } else ok('✕ on the new group-buy card hides it (and says where to find it)', false, dHome);
  const G = await mk({ width: 320, height: 640 });
  await G.goto(link); await G.waitForTimeout(1500);
  ok('320 px: the team page fits (no sideways scroll)', await S(G, () => document.documentElement.scrollWidth <= innerWidth));
  await G.goto(`${BASE}#/privacy`); await G.waitForTimeout(800);
  ok('隱私權政策 lists group-buy data (team name, which team, kept 60 days after)', /團購揪團（你開團或跟團時）/.test(await text(G, '#view')) && /60 天/.test(await text(G, '#view')));
  await G.context().close();

  /* ---- static copy (no member service): nothing about group-buys ---- */
  if (process.env.STATIC_BASE) {
    const H = await mk();
    await H.goto(process.env.STATIC_BASE); await H.waitForTimeout(800);
    await H.click('text=先看看範例資料'); await H.waitForTimeout(1500);
    ok('static host: no group-buy card on 首頁', !(await H.isVisible('.gb-home')));
    await H.goto(`${process.env.STATIC_BASE}#/me`); await H.waitForTimeout(800);
    ok('…no 團購揪團 in 我的', !/團購揪團/.test(await text(H, '#view')));
    await H.goto(`${process.env.STATIC_BASE}#/groupbuy`); await H.waitForTimeout(1500);
    ok('…and the page itself says there is none', /目前沒有進行中的團購/.test(await text(H, '#view')));
    await H.context().close();
  }

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${String(r.info).slice(0, 300)}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
