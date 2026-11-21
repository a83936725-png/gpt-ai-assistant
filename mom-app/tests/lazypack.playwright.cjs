// 懶人包整合（0.8.4）: what the 易家懶人包 had that the App did not, checked on official sites first.
//   補助福利: 租金補貼育兒加碼 (this year's last day, counted down; for 租屋族 only, so after the others on 首頁),
//   產前遺傳診斷 7,000 元 (免申請), 唐氏症篩檢 and 孕婦搭車 (部分縣市: in the list, never suggested), and richer
//   details on 試管、產檢假、陪產假、產假、生育給付、育嬰留停、塗氟 — every one with a government link and sources.
//   清單: 待產包 (when to pack, 剖腹產再加, when to go to hospital), 月子中心清單 (new), 外出包 回診／打疫苗.
// Dates are fixed (Taipei). Usage: cd mom-app && python3 -m http.server 8080   then
//   BASE=http://localhost:8080/ node tests/lazypack.playwright.cjs        (AXE_PATH=<axe.min.js> for accessibility)
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8080/';
const AXE = process.env.AXE_PATH || '';
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });

(async () => {
  const b = await chromium.launch();
  const mk = async (when, { width = 390 } = {}) => {
    const c = await b.newContext({ viewport: { width, height: 844 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
    const p = await c.newPage();
    await p.clock.setFixedTime(new Date(when));
    await p.addInitScript(() => { window.__noShareMoments = true; window.open = () => null; });
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE); await p.waitForTimeout(700);
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const text = (p, sel) => S(p, (s) => (document.querySelector(s) || {}).innerText || '', sel);
  const go = async (p, id, ms = 800) => { await S(p, (x) => App.navigate(x, { n: Math.random() }), id); await p.waitForTimeout(ms); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const setup = (p, { stage = 'baby', days = 10, weeks = 30 } = {}) => S(p, (o) => {
    const s = App.store.defaults(); s.onboarded = true; s.profile.stage = o.stage; s.starter = { demo: true }; s.settings.a2hsDismissed = '1';
    if (o.stage === 'baby') { s.babies = [{ id: 'b1', name: '小湯圓', sex: 'girl', birthday: Core.dateKey(Core.addDays(new Date(), -o.days)), avatar: '👶' }]; s.activeBabyId = 'b1'; }
    if (o.stage === 'preg') s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -o.weeks * 7));
    App.store.replace(s); App.navigate('home');
  }, { stage, days, weeks });
  const B = (p, id) => S(p, (x) => App.EXTRAS.BENEFITS.find((bb) => bb.id === x) || null, id);

  /* ---------- 補助福利: the new items and the details ---------- */
  const P = await mk('2026-11-21T10:00:00+08:00');
  await setup(P, { days: 10 });
  const all = await S(P, () => App.EXTRAS.BENEFITS.map((x) => x.id));
  ok('福利清單: 29 items (4 new: 產前遺傳診斷・唐氏症篩檢・孕婦搭車・租金補貼)', all.length === 29 && ['prenatal-dx', 'down-screen', 'ride', 'rent'].every((x) => all.includes(x)), all.join(','));
  const rent = await B(P, 'rent');
  ok('租金補貼育兒加碼: 新生兒加碼 100%, 每多 1 名再加 50%, 新婚加碼, 受理到 115/12/31, 內政部 link', rent.amount === '新生兒加碼 100%' && /每多 1 名未成年子女再加 50%/.test(rent.desc) && /新婚 2 年內加碼 50%/.test(rent.desc) && rent.ends === '2026-12-31' && /^https:\/\/www\.moi\.gov\.tw\//.test(rent.url), JSON.stringify(rent).slice(0, 200));
  const dx = await B(P, 'prenatal-dx');
  ok('產前遺傳診斷: 每案最高 7,000 元 (115/7/1 起，原 5,000), 低收入戶另 3,500, 免申請', dx.amount === '每案最高 7,000 元' && /115 年 7 月 1 日起最高由 5,000 元提高到 7,000 元/.test(dx.desc) && /3,500 元/.test(dx.desc) && dx.auto === true, dx.desc);
  const ds = await B(P, 'down-screen'); const ride = await B(P, 'ride');
  ok('唐氏症篩檢 and 孕婦搭車 are marked 部分縣市 (local) with examples (臺中、臺北／新北)', ds.local && /臺中市/.test(ds.desc) && /2,200 元/.test(ds.desc) && ride.local && /最多 36 趟（最多 9,000 元）/.test(ride.desc), `${ds.desc} | ${ride.desc}`);
  const det = await S(P, () => Object.fromEntries(['ivf', 'leave-check', 'leave-partner', 'maternity', 'birth-pay', 'parental', 'fluoride'].map((id) => [id, App.EXTRAS.BENEFITS.find((x) => x.id === id).desc + (App.EXTRAS.BENEFITS.find((x) => x.id === id).amount || '')])));
  ok('details: 試管 第 1 次最高 15 萬・115/9/1 起第 2、3 次提高; 產檢假 半日或小時; 陪產假 半日或小時', /第 1 次最高 15 萬元/.test(det.ivf) && /115 年 9 月 1 日起/.test(det.ivf) && /「半日」或「小時」/.test(det['leave-check']) && /第 6、7 日的薪資由政府補助雇主/.test(det['leave-check']) && /半日或小時/.test(det['leave-partner']), JSON.stringify(det).slice(0, 300));
  ok('…產假 未滿 6 個月減半; 生育給付 280 日、時效 5 年; 育嬰留停 父母各 6 個月; 塗氟 弱勢兒童每 3 個月', /未滿 6 個月減半發給/.test(det.maternity) && /280 日/.test(det['birth-pay']) && /請領時效 5 年/.test(det['birth-pay']) && /各領最長 6 個月（合計 12 個月）/.test(det.parental) && /每 3 個月/.test(det.fluoride));
  const links = await S(P, () => {
    const M = App.SOURCE_MAP; const SRC = App.SOURCES;
    return ['prenatal-dx', 'down-screen', 'ride', 'rent', 'ivf', 'leave-check', 'maternity', 'birth-pay', 'parental'].map((id) => {
      const bb = App.EXTRAS.BENEFITS.find((x) => x.id === id);
      const srcs = (M[`benefit:${id}`] || []).map((x) => SRC[x.s]);
      return { id, url: bb.url, n: srcs.length, allGov: srcs.every((x) => x && x.kind === 'gov' && /^https:\/\/([a-z0-9-]+\.)*gov\.(tw|taipei)\//.test(x.url)) };
    });
  });
  ok('every new or updated item: an official link and 1+ government sources (no news needed)', links.every((x) => /^https:\/\/([a-z0-9-]+\.)*gov\.tw\//.test(x.url) && x.n >= 1 && x.allGov), JSON.stringify(links.filter((x) => !(x.n >= 1 && x.allGov))));

  // 首頁: rent counted down, but after the things every family does (it is for 租屋族)
  const now = await S(P, () => App.extras.nowItems().map((x) => [x.b.id, x.left]));
  const ri = now.findIndex((x) => x[0] === 'rent');
  ok('首頁 (10 days old, 11/21): 租金補貼 is there with 40 days left, after the items for every family', ri === now.length - 1 && now[ri][1] === 40 && now[0][0] === 'register', JSON.stringify(now));
  await go(P, 'home', 900);
  const home = await text(P, '.bn-home');
  ok('…the card still starts with 出生登記 and shows 3 rows', /^💰 現在可以申請的福利/.test(home) && (await S(P, () => document.querySelectorAll('.bn-home .bn-row').length)) === 3 && /出生登記/.test(home.split('\n').slice(0, 3).join(' ')), home.slice(0, 120));
  await go(P, 'benefits', 900);
  await P.click('.seg button:has-text("生產")'); await P.waitForTimeout(500);
  const row = await S(P, () => [...document.querySelectorAll('.bn-item')].map((x) => x.innerText.replace(/\n/g, ' ')).find((t) => /租金補貼/.test(t)) || '');
  ok('清單 (生產): 「租金補貼育兒加碼（租屋族）」 with 「⏰ 115 年 12 月 31 日前（今年度）（還剩 40 天）」', /租金補貼育兒加碼（租屋族）/.test(row) && /⏰ 115 年 12 月 31 日前（今年度）（還剩 40 天）/.test(row), row);
  await P.locator('.bn-item', { hasText: '租金補貼' }).click(); await P.waitForTimeout(600);
  const sheet = await text(P, '.sheet');
  ok('…its sheet: amount, the countdown, 「開啟官方網站」', /新生兒加碼 100%/.test(sheet) && /還剩 40 天/.test(sheet) && await P.isVisible('.sheet a:has-text("開啟官方網站")'));
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  await axe(P, '補助福利清單 (生產)');
  await P.click('.seg button:has-text("懷孕")'); await P.waitForTimeout(500);
  const pregList = await text(P, '#view .list');
  ok('清單 (懷孕): 產前遺傳診斷 7,000 免申請; 唐氏症篩檢、孕婦搭車 (部分縣市)', /產前遺傳診斷補助（羊膜穿刺等）\s*每案最高 7,000 元/.test(pregList) && /唐氏症篩檢（部分縣市補助）/.test(pregList) && /孕婦搭車補助（部分縣市）/.test(pregList), pregList.slice(0, 300));
  await P.locator('.bn-item', { hasText: '孕婦搭車' }).click(); await P.waitForTimeout(600);
  ok('…a 部分縣市 item says so in its sheet (📍 以戶籍地的公告為準)', /📍 只有部分縣市有/.test(await text(P, '.sheet')));
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  const srcFoot = await text(P, '.src-foot');
  ok('資料來源 at the bottom include 內政部、勞動部法令查詢、臺中市衛生局、新北市社會局', /內政部/.test(srcFoot) && /勞動法令/.test(srcFoot) && /臺中市政府衛生局/.test(srcFoot) && /新北市政府社會局/.test(srcFoot), srcFoot.slice(0, 200));
  await P.context().close();

  // pregnant: the county-only and 免申請 items are never suggested
  const Q = await mk('2026-11-21T10:00:00+08:00');
  await setup(Q, { stage: 'preg', weeks: 30 });
  const pregNow = await S(Q, () => App.extras.nowItems().map((x) => x.b.id));
  ok('懷孕中 首頁: no 唐氏症篩檢／孕婦搭車 (部分縣市) and no 產前遺傳診斷 (免申請)', !pregNow.some((x) => ['down-screen', 'ride', 'prenatal-dx'].includes(x)) && pregNow.includes('leave-check'), pregNow.join(','));
  await Q.context().close();
  // next year: this year's round is over
  const N = await mk('2027-01-05T10:00:00+08:00');
  await setup(N, { days: 20 });
  ok('2027/1/5: 租金補貼 no longer suggested (今年度已截止)', !(await S(N, () => App.extras.nowItems().map((x) => x.b.id))).includes('rent'));
  await go(N, 'benefits', 900);
  await N.click('.seg button:has-text("生產")'); await N.waitForTimeout(500);
  ok('…the list says 今年度已截止，請看最新公告', /今年度已截止，請看最新公告/.test(await S(N, () => [...document.querySelectorAll('.bn-item')].map((x) => x.innerText).find((t) => /租金補貼/.test(t)) || '')));
  await N.context().close();

  /* ---------- 搜尋 ---------- */
  const F = await mk('2026-11-21T10:00:00+08:00');
  await setup(F, { stage: 'preg', weeks: 30 });
  await go(F, 'search', 700);
  const found = [];
  for (const q of ['租金補貼', '羊膜穿刺', '月子中心']) { // eslint-disable-line no-restricted-syntax
    await F.fill('#view input', q); await F.waitForTimeout(800); // eslint-disable-line no-await-in-loop
    found.push(await text(F, '#view')); // eslint-disable-line no-await-in-loop
  }
  ok('搜尋 租金補貼／羊膜穿刺 → 補助福利清單; 月子中心 → 月子中心清單', /補助福利清單/.test(found[0]) && /補助福利清單/.test(found[1]) && /月子中心清單/.test(found[2]), found.map((x) => x.slice(0, 120)).join(' || '));

  /* ---------- 待產包 and 月子中心清單 ---------- */
  await go(F, 'hospitalbag', 900);
  const bag = await text(F, '#view');
  ok('待產包: 「什麼時候準備」 32–34 週、34–36 週、最後一週', /🗓️ 什麼時候準備/.test(bag) && /32–34 週/.test(bag) && /34–36 週/.test(bag) && /最後一週/.test(bag));
  ok('…amounts as hints (安睡褲 3–5 包、哺乳內衣 2–3 件、紗布巾 2–3 條) and a 「剖腹產再加」 group (束腹帶)', /3–5 包/.test(bag) && /哺乳內衣 2–3 件/.test(bag) && /紗布巾 2–3 條/.test(bag) && /剖腹產再加/.test(bag) && /束腹帶/.test(bag));
  ok('…「這些情況直接去醫院」: 破水 (不論有沒有宮縮)、5-1-1, with a button to 宮縮計時', /🚨 這些情況直接去醫院/.test(bag) && /破水（不論有沒有宮縮）/.test(bag) && /5-1-1/.test(bag) && await F.isVisible('.pg-go-now button:has-text("宮縮計時")'));
  await axe(F, '待產包');
  await F.click('.pg-cf-link'); await F.waitForTimeout(800);
  ok('…「要住月子中心？」 opens 月子中心清單', (await S(F, () => location.hash)) === '#/confinement');
  const cf = await S(F, () => ({ groups: [...document.querySelectorAll('#view .section-title')].map((x) => x.innerText.replace(/\n/g, ' ')), items: document.querySelectorAll('#view .pg-check').length, text: document.getElementById('view').innerText }));
  ok('月子中心清單: 入住前問清楚（10 題）+ 出月中前一週確認, 20 items', cf.items === 20 && /入住前問清楚（10 題）/.test(cf.groups.join('|')) && /出月中前一週確認/.test(cf.groups.join('|')), JSON.stringify(cf.groups));
  ok('…no products, a 「住的時候也要留意自己」 card (發燒、惡露突然變多、情緒持續低落)', !/滴雞精|寶寶粥|官網/.test(cf.text) && /住的時候也要留意自己/.test(cf.text) && /惡露突然變多/.test(cf.text) && /情緒持續低落/.test(cf.text));
  await F.locator('#view .pg-check').nth(2).click(); await F.waitForTimeout(300);
  ok('…ticking one is kept (confinementCheck)', await S(F, () => Object.keys(App.store.state.confinementCheck || {}).includes('cf_baby')));
  await axe(F, '月子中心清單');
  const tool = await S(F, () => { const t = (App.tools || []).find((x) => x.id === 'confinement'); return t && { stages: t.stages, group: t.group }; });
  ok('月子中心清單 is a tool while pregnant and after birth', tool && tool.stages.includes('preg') && tool.stages.includes('baby'), JSON.stringify(tool));
  await F.context().close();

  /* ---------- 外出包: 回診／打疫苗 ---------- */
  const O = await mk('2026-11-21T10:00:00+08:00');
  await setup(O, { days: 120 });
  await go(O, 'outing', 900);
  ok('外出包: a 「回診／打疫苗」 option, off by default', await S(O, () => { const x = document.querySelector('.ot-visit'); return !!x && x.getAttribute('aria-pressed') === 'false'; }));
  const before = await S(O, () => [...document.querySelectorAll('#view')].map((x) => x.innerText).join(''));
  await O.click('.ot-visit'); await O.waitForTimeout(700);
  const after = await S(O, () => document.getElementById('view').innerText);
  ok('…on: 預約單／掛號號碼、疫苗與用藥紀錄、想問醫師的問題 are added to 證件與健康', !/預約單／掛號號碼/.test(before) && /預約單／掛號號碼/.test(after) && /疫苗與用藥紀錄/.test(after) && /想問醫師的問題/.test(after) && (await S(O, () => document.querySelector('.ot-visit').getAttribute('aria-pressed'))) === 'true');
  ok('…kept in the bag settings and named in the summary line', await S(O, () => App.store.state.outing.bag.visit === true) && /回診／打疫苗/.test(after));
  await axe(O, '外出包 with 回診');
  await O.context().close();

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
