// 補助福利：金額與時機、首頁「現在可以申請的福利」（依寶寶天數、期限倒數、季節）、打勾後不再提醒、✕、現金福利摘要、
// 搜尋、資料來源（新聞另外標示）。Dates are fixed (Taipei) so the seasonal items are predictable.
// Usage: cd mom-app && python3 -m http.server 8080   then   BASE=http://localhost:8080/ node tests/benefits.playwright.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
(async () => {
  const b = await chromium.launch();
  const mk = async (when) => {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei' });
    const p = await c.newPage();
    await p.clock.setFixedTime(new Date(when));
    await p.addInitScript(() => { window.__noShareMoments = true; });
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE); await p.waitForTimeout(700);
    await p.click('text=先看看範例資料'); await p.waitForTimeout(600);
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const text = (p, sel) => S(p, (s) => (document.querySelector(s) || {}).innerText || '', sel);
  const go = async (p, id) => { await S(p, (x) => App.navigate(x, { n: Math.random() }), id); await p.waitForTimeout(700); };
  const baby = (p, days) => S(p, (d) => App.store.update((s) => { s.babies[0].birthday = Core.dateKey(Core.addDays(new Date(), -d)); s.settings.a2hsDismissed = '1'; s.profile.stage = 'baby'; }), days);
  const ids = (p) => S(p, () => App.extras.nowItems().map((x) => x.b.id));

  /* ---- a 10-day-old baby in November ---- */
  const P = await mk('2026-11-20T10:00:00+08:00');
  await baby(P, 10);
  await go(P, 'home');
  const card = await text(P, '.bn-home');
  ok('首頁 (10 days old): 出生登記 first with 還剩 50 天, then 育兒津貼 (same deadline), at most 3 rows', /^💰 現在可以申請的福利/.test(card) && (await S(P, () => document.querySelectorAll('.bn-row').length)) === 3
    && (await text(P, '.bn-row')).startsWith('出生登記') && /出生登記\s*還剩 50 天/.test(card) && /未滿 2 歲育兒津貼\s*還剩 50 天・每月 5,000–7,000 元/.test(card), card);
  ok('…and a way to the whole list', /看全部福利（25 項）/.test(card));
  await P.click('.bn-row >> nth=0'); await P.waitForTimeout(400);
  ok('a row opens the item: when (with days left), what to bring, official site, progress', /⏰ 出生後 60 天內（還剩 50 天）/.test(await text(P, '.sheet')) && await P.isVisible('.sheet a:has-text("開啟官方網站")'));
  await P.click('.sheet .seg button:has-text("完成")'); await P.click('.sheet-footer .btn-primary'); await P.waitForTimeout(600);
  const titles = await S(P, () => [...document.querySelectorAll('.bn-row b')].map((x) => x.textContent));
  ok('marked 完成: no longer suggested on 首頁', !(await ids(P)).includes('register') && !titles.includes('出生登記') && titles.length === 3, titles.join(','));
  await P.click('.bn-home-x'); await P.waitForTimeout(500);
  ok('✕: hidden for two weeks (and says where the list is)', !(await P.isVisible('.bn-home')) && /兩週內不提醒/.test(await text(P, '.toast-wrap')));

  /* ---- 75 days old: past the 60-day registration ---- */
  await S(P, () => App.store.update((s) => { delete s.benefitsHomeOff; s.benefits = {}; }));
  await baby(P, 75);
  const at75 = await ids(P);
  ok('75 days old: 出生登記 no longer suggested (its 60 days are over); 生育給付 and 育兒津貼 are', !at75.includes('register') && at75.includes('birth-pay') && at75.includes('allowance-02'), at75.join(','));
  ok('…things that need no application (screenings, check-ups) are never suggested', !at75.some((id) => ['nbs-free', 'hearing', 'child-check', 'dev-screen', 'fluoride', 'pp-care'].includes(id)));
  ok('…the tax deduction waits for May', !at75.includes('tax-preschool'));

  /* ---- pregnancy: November vs July ---- */
  await S(P, () => App.store.update((s) => { s.profile.stage = 'preg'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -150)); s.profile.edd = ''; }));
  await go(P, 'home');
  const preg = await text(P, '.bn-home');
  ok('懷孕中 (November): 產檢假, 陪產檢及陪產假, 孕婦公費流感疫苗', /產檢假\s*7 天/.test(preg) && /陪產檢及陪產假/.test(preg) && /孕婦公費流感疫苗\s*公費/.test(preg), preg);
  const J = await mk('2026-07-15T10:00:00+08:00');
  await S(J, () => App.store.update((s) => { s.profile.stage = 'preg'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -150)); s.profile.edd = ''; s.settings.a2hsDismissed = '1'; }));
  ok('懷孕中 (July): no flu vaccine yet (it starts in October)', !(await ids(J)).includes('flu-preg'), (await ids(J)).join(','));
  await S(J, () => App.store.update((s) => { s.profile.stage = 'prep'; }));
  await go(J, 'home');
  ok('備孕: no benefits card on 首頁', !(await J.isVisible('.bn-home')));
  await J.context().close();
  const M = await mk('2027-05-10T10:00:00+08:00');
  await baby(M, 300);
  ok('May: the tax deduction (幼兒學前特別扣除額) is suggested', (await ids(M)).includes('tax-preschool'));
  await M.context().close();

  /* ---- the list ---- */
  await baby(P, 20);
  await go(P, 'benefits');
  const cash = await text(P, '.bn-cash');
  ok('清單: 常見的現金福利 at the top (10 萬, 育兒津貼, 8 成, 扣除額)', /每胎 10 萬/.test(cash) && /每月 5,000–7,000 元/.test(cash) && /投保薪資 8 成/.test(cash) && /15 萬／22.5 萬/.test(cash) && /只能擇一/.test(cash), cash);
  await P.click('.seg button:has-text("育兒")'); await P.waitForTimeout(400);
  const list = await text(P, '.list');
  ok('育兒 list: amounts as pills, when to apply', await S(P, () => document.querySelectorAll('.bn-pill').length >= 6) && /⏰ 子女滿 3 歲前/.test(list) && /每天 60 分鐘/.test(list), list.slice(0, 200));
  ok('…public services marked 免申請', /免申請/.test(list));
  ok('…25 items in all, with sources at the bottom (news marked as news)', /完成 \d+\/25/.test(await text(P, '#view')) && /商業周刊|中央通訊社/.test(await text(P, '.src-foot')));
  await go(P, 'sources');
  ok('資料來源: a separate 「新聞與整理」 group', /新聞與整理/.test(await text(P, '#view')));
  const found = await S(P, () => ['育兒津貼', '生育補助', '育嬰假', '報稅', '哺乳時間'].map((q) => (App.search.query(q).groups.tool[0] || { d: { tool: {} } }).d.tool.id));
  ok('search 育兒津貼／生育補助／育嬰假／報稅／哺乳時間 → 補助福利清單', found.every((x) => x === 'benefits'), found.join(','));

  const links = await S(P, () => App.EXTRAS.BENEFITS.filter((b) => b.url).map((b) => [b.id, b.url]));
  const notGov = links.filter(([, u]) => !/^https:\/\/([a-z0-9-]+\.)*gov\.tw(\/|$)/i.test(u));
  ok('every 「開啟官方網站」 goes to a government site (news is only ever an extra source)', links.length >= 24 && !notGov.length, notGov.map((x) => x.join(' ')).join(', '));

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
