// 雙向邀請禮（需要後端）：朋友用連結加入、完成設定並註冊 → 見面禮；邀請人 → 每位朋友的邀請禮；輸入邀請碼；首頁提醒；
// 靜態網站（沒有會員服務）不顯示。
// Usage: (repo root) MOM_TRUST_PROXY=1 APP_PORT=8790 node api/index.js      then   node mom-app/tests/invite.playwright.cjs
//        BASE=http://localhost:8790/mom-app/  STATIC_BASE=<optional static-only host>
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8790/mom-app/';
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });
(async () => {
  const b = await chromium.launch();
  const run = 20 + Math.floor(Math.random() * 200); // every person on her own network (sign-ups and invites are capped per network)
  let nets = 0;
  const mk = async ({ width = 390, height = 844 } = {}) => {
    nets += 1;
    const c = await b.newContext({ viewport: { width, height } });
    await c.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${run}.${nets}.1` });
    const p = await c.newPage();
    await p.addInitScript(() => { window.__noShareMoments = true; window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const uniq = Date.now().toString(36);
  const lastSheet = (p) => S(p, () => [...document.querySelectorAll('.sheet')].pop()?.innerText || '');
  const pts = (p) => S(p, () => App.store.state.share.points || 0);
  // the welcome gift alone (新手任務 may add its own points for signing up)
  const welcomePts = (p) => S(p, () => ((App.store.state.share || {}).events || []).filter((e) => e.campaign === 'invite-welcome').reduce((n, e) => n + (e.pts || 0), 0));
  const register = async (p, who, { fromWelcome = false } = {}) => {
    if (fromWelcome) await p.click('text=已有帳號？登入／註冊');
    else await p.goto(`${BASE}#/login`);
    await p.waitForTimeout(800);
    if (!(await p.isVisible('input[aria-label="邀請碼"]'))) { await p.click('.login-form .seg button:has-text("註冊")'); await p.waitForTimeout(300); }
    await p.fill('input[aria-label="Email 或手機"]', `${who}-${uniq}@example.com`); await p.fill('input[aria-label="密碼"]', 'password-001');
    await p.check('.login-form .pv-box.req input');
    await p.click('.login-form button[type=submit]'); await p.waitForTimeout(1200);
  };
  const closeSheets = async (p) => { for (let i = 0; i < 3 && await S(p, () => !!document.querySelector('.sheet-backdrop.open')); i += 1) { await p.keyboard.press('Escape'); await p.waitForTimeout(350); } };

  /* ---- the inviter ---- */
  const A = await mk();
  await A.goto(BASE); await A.waitForTimeout(1200);
  await A.click('text=先看看範例資料'); await A.waitForTimeout(600);
  await A.goto(`${BASE}#/invite`); await A.waitForTimeout(1000);
  const guestCard = await S(A, () => document.querySelector('.gift-card')?.innerText || '');
  ok('invite page (not a member): both gifts explained, and why to log in first', /朋友 \+30 點/.test(guestCard) && /你 \+50 點/.test(guestCard) && /先登入會員再邀請/.test(guestCard), guestCard);
  await register(A, 'host');
  await A.goto(`${BASE}#/invite`); await A.waitForTimeout(1200);
  const hostCard = await S(A, () => document.querySelector('.gift-card')?.innerText || '');
  ok('invite page (member): no friends yet, the next reward is a few friends away', /還沒有朋友加入/.test(hostCard) && /再邀請 2 位朋友，就能解鎖「分享新手徽章」|再邀請 1 位朋友/.test(hostCard), hostCard);
  ok('points rules mention the gifts (outside the daily share limit)', /見面禮 \+30、邀請禮 \+50（不算在每天上限裡）/.test(await S(A, () => document.querySelector('.inv-rewards')?.parentElement.innerText || '')));
  await A.click('.inv-hero .btn-line'); await A.waitForTimeout(300);
  const lineInvite = decodeURIComponent(await S(A, () => window.__opened.pop() || ''));
  ok('LINE 邀請 tells the friend about the welcome gift', /30 點見面禮/.test(lineInvite) && /ref=/.test(lineInvite), lineInvite.slice(0, 160));
  const aBase = await pts(A); // the LINE 邀請 above earned share points
  const code = await S(A, () => App.store.state.share.code);
  const link = await S(A, () => App.share.link({ channel: 'line', campaign: 'invite' }));

  /* ---- B: opens the link, tries the app (育兒中), signs up from the line under the baby ---- */
  const Bp = await mk();
  await Bp.goto(link); await Bp.waitForTimeout(1500);
  ok('welcome: who invited her, and that both get a gift', /小美邀請你一起使用/.test(await S(Bp, () => document.querySelector('.ob-invited')?.innerText || '')) && await Bp.isVisible('.ob-gift'));
  await Bp.click('text=先看看範例資料'); await Bp.waitForTimeout(1200);
  const lineText = await S(Bp, () => document.querySelector('.gift-line')?.innerText.replace(/\s+/g, ' ') || '');
  const linePos = await S(Bp, () => { const l = document.querySelector('.gift-line'); const q = document.querySelector('.quick-row, .quick-tiles, .qt-grid'); return l ? { top: l.getBoundingClientRect().top, beforeTiles: !q || (l.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 } : null; });
  ok('首頁 (育兒中): one line right under the baby, above the quick buttons', /小美送你的見面禮/.test(lineText) && /註冊領 30 點/.test(lineText) && linePos && linePos.beforeTiles && linePos.top < 420 && !(await Bp.isVisible('.gift-home')), `${lineText} ${JSON.stringify(linePos)}`);
  await Bp.click('.gift-line-main'); await Bp.waitForTimeout(900);
  ok('…tapping it opens 註冊 with the gift explained and her code filled in', (await S(Bp, () => document.body.dataset.screen)) === 'login' && /30 點見面禮，「小美」也會收到邀請禮/.test(await S(Bp, () => document.querySelector('.login-gift')?.textContent || '')) && (await Bp.inputValue('input[aria-label="邀請碼"]')) === code);
  await register(Bp, 'friend', { fromWelcome: false });
  await Bp.waitForTimeout(1500);
  const bSheet = await lastSheet(Bp);
  ok('signed up: 見面禮 +30, the inviter got one too, a badge unlocked', /見面禮 \+30 好孕點數/.test(bSheet) && /「小美」也收到了 50 點邀請禮/.test(bSheet) && /解鎖「分享新手徽章」/.test(bSheet) && (await pts(Bp)) === 30, bSheet);
  ok('…kept as a gift, not a share', await S(Bp, () => App.store.state.share.events.some((e) => e.channel === 'bonus' && e.campaign === 'invite-welcome' && e.pts === 30)));
  await Bp.click('.gift-thanks'); await Bp.waitForTimeout(300);
  const thanks = decodeURIComponent(await S(Bp, () => window.__opened.pop() || ''));
  ok('「跟小美說聲謝謝」 opens LINE with a thank-you (no link, no code)', /^https:\/\/line\.me\/R\/share\?text=我加入「易家做媽媽」了，謝謝你的邀請/.test(thanks) && !/ref=|http.*http/.test(thanks.slice(10)), thanks);
  await closeSheets(Bp);
  await Bp.goto(`${BASE}#/home`); await Bp.waitForTimeout(800);
  ok('…and the line under the baby is gone', !(await Bp.isVisible('.gift-line')));
  const again = await S(Bp, () => App.gift.claim());
  ok('claiming again gives nothing more', again && again.already === true && (await pts(Bp)) === 30, JSON.stringify(again));
  await Bp.goto(`${BASE}#/invite`); await Bp.waitForTimeout(1000);
  ok('her invite page: 見面禮已領取 (+30), thank-you link', /見面禮已領取（\+30）・謝謝「小美」的邀請/.test(await S(Bp, () => document.querySelector('.gift-mine')?.innerText || '')));
  ok('gifts are not counted as shares (no 「bonus」 chip)', !(await S(Bp, () => [...document.querySelectorAll('.chip')].some((c) => /bonus/.test(c.textContent)))));
  const shareAfterGift = await S(Bp, () => App.share.record('line', 'test'));
  ok('a gift does not use up the daily share points', shareAfterGift === 10, String(shareAfterGift));

  /* ---- A: the friend shows up while 邀請好友 is open ---- */
  await A.goto(`${BASE}#/invite`);
  let waited = 0;
  while (waited < 30 && (await pts(A)) === aBase) { await A.waitForTimeout(1000); waited += 1; } // eslint-disable-line no-await-in-loop
  ok('inviter: +50 arrives by itself within seconds, with a toast', (await pts(A)) === aBase + 50 && /有 1 位朋友接受你的邀請！邀請禮 \+50/.test(await S(A, () => document.querySelector('.toast')?.innerText || '')), `after ${waited}s: ${aBase} → ${await pts(A)}`);
  await A.waitForTimeout(600);
  const hostAfter = await S(A, () => document.querySelector('.gift-card')?.innerText || '');
  ok('…her page: 1 friend, 邀請禮共 +50 點', /已有 1 位朋友接受你的邀請/.test(hostAfter) && /邀請禮共 \+50 點/.test(hostAfter), hostAfter);
  await S(A, () => App.account.refreshMe()); await A.waitForTimeout(500);
  await S(A, () => App.gift.sync()); await A.waitForTimeout(300);
  ok('…counted once (checking again adds nothing)', (await pts(A)) === aBase + 50);
  ok('…the friend is never named to the inviter', !/friend-/.test(hostAfter) && !(await S(A, () => JSON.stringify(App.store.state.auth.user).includes('friend-'))));

  /* ---- A on a second phone: earlier friends are not announced again ---- */
  const A2 = await mk();
  await A2.goto(BASE); await A2.waitForTimeout(900);
  await A2.click('text=先看看範例資料'); await A2.waitForTimeout(500);
  await A2.goto(`${BASE}#/login`); await A2.waitForTimeout(800);
  await A2.fill('input[aria-label="Email 或手機"]', `host-${uniq}@example.com`); await A2.fill('input[aria-label="密碼"]', 'password-001');
  await A2.click('.login-form button[type=submit]'); await A2.waitForTimeout(1500);
  ok('a second phone: no old friends announced, no points copied', (await pts(A2)) === 0 && !/朋友接受你的邀請/.test(await S(A2, () => document.querySelector('.toast')?.innerText || '')));
  await A2.context().close();

  /* ---- D: 懷孕中, sets the app up for real, not a member: the card is at the top of 首頁 ---- */
  const D = await mk();
  await D.goto(link); await D.waitForTimeout(1200);
  await D.click('text=開始使用'); await D.waitForTimeout(300);
  await D.click('.ob-choice >> nth=1'); await D.waitForTimeout(300);
  const lmp = await S(D, () => Core.dateKey(Core.addDays(new Date(), -140)));
  await D.fill('.onboard input[type=date] >> nth=0', lmp); await D.dispatchEvent('.onboard input[type=date] >> nth=0', 'change');
  await D.click('text=完成，開始使用'); await D.waitForTimeout(1500);
  const slots = await S(D, () => [...document.querySelectorAll('.home-slot')].map((s) => s.dataset.card));
  ok('首頁 (懷孕中): the gift card is among the first cards', slots.indexOf('gift') >= 0 && slots.indexOf('gift') <= 1 && /註冊會員就能領 30 點/.test(await S(D, () => document.querySelector('.gift-home')?.innerText || '')), slots.join(','));
  await D.click('.gift-home-x'); await D.waitForTimeout(500);
  ok('✕ hides it (with where to find it)', !(await D.isVisible('.gift-home')) && /邀請好友/.test(await S(D, () => document.querySelector('.toast')?.innerText || '')));
  await D.goto(`${BASE}#/invite`); await D.waitForTimeout(1000);
  const dCard = await S(D, () => document.querySelector('.gift-card')?.innerText || '');
  ok('…still offered on 邀請好友 (and no 「登入」 row meant for inviters)', /送你 30 點見面禮：註冊會員就能領/.test(dCard) && !/先登入會員再邀請/.test(dCard), dCard);
  await D.context().close();

  /* ---- E: signs up on the welcome page first, then sets up 備孕: the gift arrives when setup is done ---- */
  const E = await mk();
  await E.goto(link); await E.waitForTimeout(1200);
  await register(E, 'early', { fromWelcome: true });
  ok('signed up before setup: nothing yet (setup comes first)', (await pts(E)) === 0 && (await S(E, () => document.body.dataset.screen)) === 'onboarding');
  await E.click('text=開始使用'); await E.waitForTimeout(300);
  await E.click('.ob-choice >> nth=0'); await E.waitForTimeout(300);
  await E.click('text=完成，開始使用'); await E.waitForTimeout(2200);
  ok('…set up: the welcome gift arrives (+30; 新手任務 adds its own +5 for 註冊會員)', /見面禮 \+30/.test(await lastSheet(E)) && (await welcomePts(E)) === 30 && (await pts(E)) === 35, `${await welcomePts(E)} / ${await pts(E)}`);
  await E.context().close();

  /* ---- C: joined without a link, types the code on 邀請好友 ---- */
  const Cp = await mk();
  await Cp.goto(BASE); await Cp.waitForTimeout(900);
  await Cp.click('text=先看看範例資料'); await Cp.waitForTimeout(500);
  await register(Cp, 'typed');
  await Cp.goto(`${BASE}#/invite`); await Cp.waitForTimeout(1000);
  ok('no link: a folded 「有朋友的邀請碼嗎？」', await Cp.isVisible('.gift-code summary') && !(await Cp.isVisible('.gift-code-in')));
  await Cp.click('.gift-code summary'); await Cp.waitForTimeout(200);
  await Cp.fill('.gift-code-in', 'ZZZZZZ'); await Cp.click('.gift-code-go'); await Cp.waitForTimeout(700);
  ok('a wrong code: a clear message', /找不到這個邀請碼/.test(await S(Cp, () => document.querySelector('.gift-code-err')?.textContent || '')));
  const own = await S(Cp, () => App.store.state.share.code);
  await Cp.fill('.gift-code-in', own); await Cp.click('.gift-code-go'); await Cp.waitForTimeout(700);
  ok('her own code: 「這是你自己的邀請碼喔」', /自己的邀請碼/.test(await S(Cp, () => document.querySelector('.gift-code-err')?.textContent || '')));
  await Cp.fill('.gift-code-in', ` ${code.toLowerCase()} `); await Cp.click('.gift-code-go'); await Cp.waitForTimeout(1500);
  ok('a friend’s code (any case, spaces): 見面禮 +30', /見面禮 \+30/.test(await lastSheet(Cp)) && /謝謝你接受朋友的邀請/.test(await lastSheet(Cp)) && (await pts(Cp)) === 30);
  await closeSheets(Cp);
  await Cp.goto(`${BASE}#/home`); await Cp.goto(`${BASE}#/invite`); await Cp.waitForTimeout(800);
  ok('…the box is gone afterwards', !(await Cp.isVisible('.gift-code')));
  await Cp.context().close();
  await S(A, () => App.account.refreshMe()); await A.waitForTimeout(800);
  ok('inviter: three friends → +150 points, every reward unlocked', (await pts(A)) === aBase + 150 && /已有 3 位朋友接受你的邀請/.test(await S(A, () => document.querySelector('.gift-card')?.innerText || '')) && /全部獎勵都解鎖了/.test(await S(A, () => document.body.innerText)), String(await pts(A)));

  /* ---- F: a link whose code isn't a member's: refused once, then she can type one ---- */
  const F = await mk();
  await F.goto(`${BASE}?ref=ZZZZZZ&from=${encodeURIComponent('阿芳')}`); await F.waitForTimeout(1000);
  await F.click('text=先看看範例資料'); await F.waitForTimeout(500);
  await register(F, 'badlink');
  await F.waitForTimeout(1000);
  await F.goto(`${BASE}#/invite`); await F.waitForTimeout(1000);
  const fCard = await S(F, () => document.querySelector('.gift-card')?.innerText || '');
  ok('a link code that is not a member’s: explained, and a box to type another', /連結裡的邀請碼 ZZZZZZ 目前無法使用/.test(fCard) && await F.isVisible('.gift-code summary') && (await pts(F)) === 0, fCard);
  await F.goto(`${BASE}#/home`); await F.waitForTimeout(600);
  ok('…and no home line nagging about it', !(await F.isVisible('.gift-line')));
  await F.context().close();

  /* ---- search: 「邀請碼」「見面禮」 lead to 邀請好友 ---- */
  const found = await S(A, () => ['邀請碼', '見面禮', '好孕點數'].map((q) => (App.search.query(q).groups.tool[0] || { d: { tool: {} } }).d.tool.id));
  ok('search 「邀請碼」「見面禮」「好孕點數」 → 邀請好友 first', found.every((x) => x === 'invite'), found.join(','));

  /* ---- a small phone: the line fits ---- */
  const G = await mk({ width: 320, height: 568 });
  await G.goto(link); await G.waitForTimeout(1000);
  await G.click('text=先看看範例資料'); await G.waitForTimeout(1000);
  const fit = await S(G, () => { const l = document.querySelector('.gift-line'); const r = l && l.getBoundingClientRect(); return r ? { w: document.documentElement.scrollWidth, vw: innerWidth, h: r.height } : null; });
  ok('320 px wide: the home line fits on one row, no sideways scroll', fit && fit.w <= fit.vw && fit.h <= 64, JSON.stringify(fit));
  await G.context().close();

  /* ---- a copy of the app with no member service: nothing about gifts ---- */
  if (process.env.STATIC_BASE) {
    const H = await mk();
    await H.goto(`${process.env.STATIC_BASE}?ref=${code}&from=${encodeURIComponent('小美')}`); await H.waitForTimeout(1500);
    ok('static host: the welcome page does not promise a gift', await H.isVisible('.ob-invited') && !(await H.isVisible('.ob-gift')));
    await H.click('text=先看看範例資料'); await H.waitForTimeout(800);
    ok('…no gift line on 首頁', !(await H.isVisible('.gift-line')) && !(await H.isVisible('.gift-home')));
    await H.goto(`${process.env.STATIC_BASE}#/invite`); await H.waitForTimeout(1000);
    await H.click('.inv-hero .btn-line'); await H.waitForTimeout(300);
    ok('…no gift card on 邀請好友, and the LINE invite does not mention one', !(await H.isVisible('.gift-card')) && !/見面禮/.test(decodeURIComponent(await S(H, () => window.__opened.pop() || ''))));
    await H.context().close();
  }

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
