// 即時團購 (js/modules/groupbuy.js): on 正在開團, under each group-buy, the public teams other moms have open (the closest
// to full first, 差 1 人 in red, a live countdown, 跟團 right there) and, under the hero, what just happened (a new line every
// few seconds). The list is asked for again every 15 seconds and only those parts change. 開一團 asks whether to show the
// team there (the brand's default); its leader can switch that on its page. 好孕島 says 差1人 on a group-buy with a team one
// short. Tried here with the sample group-buys (範例資料, no member service); sizes and accessibility checked.
// Usage: cd mom-app && python3 -m http.server 8080   then   BASE=http://localhost:8080/ node tests/groupbuy-live.playwright.cjs
//        AXE_PATH=<axe.min.js> for the accessibility checks (a static host: no member service)
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8080/';
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const NOW = '2026-11-22T14:19:03+08:00';

(async () => {
  const b = await chromium.launch();
  const ctxs = [];
  const mk = async ({ width = 390, height = 844, scheme = 'light' } = {}) => {
    const c = await b.newContext({ viewport: { width, height }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', colorScheme: scheme });
    ctxs.push(c);
    await c.clock.install({ time: new Date(NOW) });
    await c.addInitScript(() => { window.__noShareMoments = true; window.__noNightAuto = true; window.open = () => null; });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE);
    await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.groupbuy);
    await p.click('text=先看看範例資料'); await p.waitForTimeout(900);
    await p.evaluate(() => {
      App.isNight = () => false; App.applyTheme();
      App.store.update((s) => { s.settings.a2hsDismissed = '1'; s.island = { ...(s.island || {}), coachDone: true }; });
    });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, screen, params, ms = 1400) => { await S(p, ([x, prm]) => App.navigate(x, prm || null), [screen, params]); await p.waitForTimeout(ms); };
  const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: `${SHOT}${name}.png` }); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const rows = (p, c) => S(p, (x) => [...document.querySelectorAll(`.gb-open[data-c="${x}"] .gb-open-row`)].map((r) => ({
    text: r.querySelector('.gb-open-main').innerText.replace(/\s+/g, ''), need1: !!r.querySelector('.gb-need1'), join: !!r.querySelector('.gb-open-join'), label: r.querySelector('.gb-open-main').getAttribute('aria-label'),
  })), c);
  const flat = (p, sel) => S(p, (x) => (document.querySelector(x) || {}).innerText || '', sel).then((t) => t.replace(/\s+/g, ''));

  /* ---------- 正在開團: what just happened, and the teams other moms have open ---------- */
  const P = await mk();
  await go(P, 'groupbuy');
  const feed1 = await flat(P, '.gb-feed');
  ok('under the hero, what just happened: 即時 + the newest line (who, which group-buy, how long ago)', /^即時有人跟了阿芳的團（4／5）・月子禮盒（範例）・2分前$/.test(feed1), feed1);
  await P.clock.runFor(4100);
  const feed2 = await flat(P, '.gb-feed');
  ok('…a new line every 4 seconds', feed2 !== feed1 && /^即時欣欣的團成團了🎉・滴雞精10入（範例）・9分前$/.test(feed2), feed2);
  let gift = await rows(P, 'sample-gift');
  ok('月子禮盒 → 正在揪的團: 阿芳 4/5 first (差 1 人, in red), then 小雅 2/5, each with 跟團',
    gift.length === 2 && /^阿芳的團差1人4／5人・剩01:3\d:\d\d$/.test(gift[0].text) && gift[0].need1 && /^小雅的團還差3人2／5人・剩06:0\d:\d\d$/.test(gift[1].text) && gift.every((r) => r.join), JSON.stringify(gift));
  ok('…a screen reader hears the team, how many, how many to go and the time left', /^阿芳的團，已 4／5 人，還差 1 人，還剩 1 小時 3\d 分$/.test(gift[0].label), gift[0].label);
  const drip = await rows(P, 'sample-drip'); const set = await rows(P, 'sample-set');
  ok('滴雞精: Yuki and 佩佩 (both 還差 2 人, the one ending sooner first); 常備組: 婷婷 2/4', drip.length === 2 && /^Yuki的團還差2人1／3人・剩05:/.test(drip[0].text) && /^佩佩的團還差2人1／3人・剩29:/.test(drip[1].text) && set.length === 1 && /^婷婷的團還差2人2／4人/.test(set[0].text), `${JSON.stringify(drip)} | ${JSON.stringify(set)}`);
  const head = await flat(P, '.gb-open[data-c="sample-gift"] .gb-open-head');
  ok('…its heading: 正在揪的團・2 團・人數即時更新（範例）', head === '正在揪的團2團・人數即時更新（範例）', head);
  ok('…the list sits above 我要開一團 (join a team first, or start one)', await S(P, () => { const card = document.querySelector('.gb-deal[data-c="sample-gift"]'); const list = card.querySelector('.gb-open'); const btn = card.querySelector('.gb-start'); return !!(list.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await P.evaluate(() => document.querySelector('.gb-open[data-c="sample-gift"]').scrollIntoView({ block: 'center' })); await P.waitForTimeout(200);
  await shot(P, 'page-open-teams');
  await axe(P, '正在開團 with 正在揪的團 and the live line');

  /* ---------- the list keeps itself up to date ---------- */
  await S(P, () => { const box = App.store.state.groupbuy.sample; const t = Object.values(box.live).find((x) => x.leader === '小雅'); t.count = 4; App.store.save(); });
  await P.clock.runFor(15500);
  gift = await rows(P, 'sample-gift');
  ok('15 seconds later, without a tap: 小雅\'s team shows 4/5 and 差 1 人 too (the page keeps its place)', gift.length === 2 && gift.every((r) => r.need1) && /小雅的團差1人4／5人/.test(gift.map((r) => r.text).join()), JSON.stringify(gift));

  /* ---------- 跟團 from the list ---------- */
  await P.click('.gb-open[data-c="sample-gift"] .gb-open-row >> nth=0 >> .gb-open-join'); await P.waitForTimeout(1600);
  const team = await flat(P, '#view');
  ok('跟團 on 阿芳\'s team (one short): it fills at once — 成團了（範例）, the sample code, on that team\'s page', /阿芳的團/.test(team) && /已5／5人/.test(team) && /🎉成團了！（範例）/.test(team) && /SAMPLE-0000/.test(team), team.slice(0, 200));
  await shot(P, 'joined');
  await go(P, 'groupbuy');
  const feed3 = await flat(P, '.gb-feed');
  gift = await rows(P, 'sample-gift');
  ok('back on 正在開團: the newest line says 阿芳的團成團了; 月子禮盒 now shows her team and no more 跟團 buttons',
    /^即時阿芳的團成團了🎉・月子禮盒（範例）・(剛剛|\d+秒前|0分前|1分前)$/.test(feed3) && gift.every((r) => !r.join) && /你的團成團了/.test(await flat(P, '.gb-deal[data-c="sample-gift"] .gb-mine')), `${feed3} | ${JSON.stringify(gift)}`);

  /* ---------- 開一團: shown in 正在開團 or not ---------- */
  await P.click('.gb-deal[data-c="sample-set"] .gb-start'); await P.waitForTimeout(700);
  const pubTxt = await flat(P, '.sheet .gb-pub');
  ok('開一團 asks 公開這一團 (ticked by default) and says what others see', (await S(P, () => document.querySelector('.sheet .gb-pub-check').checked)) && /公開這一團：其他媽媽在「正在開團」看得到，可以直接跟團（只顯示團名、人數和剩下的時間；之後也能改）/.test(pubTxt), pubTxt);
  await axe(P, '開一團 with 公開這一團');
  await P.click('.gb-start-go'); await P.waitForTimeout(1500);
  ok('her team page: 公開在「正在開團」 is on', await S(P, () => { const i = document.querySelector('.gb-pub-row input'); return !!i && i.checked; }));
  await shot(P, 'team-public');
  await axe(P, 'her team page with the switch');
  await P.click('.gb-pub-row input'); await P.waitForTimeout(700);
  ok('…switch it off: 已取消公開 (only friends with the link)', /已取消公開：只有拿到連結的朋友看得到/.test(await flat(P, '.toast-wrap')) && !(await S(P, () => document.querySelector('.gb-pub-row input').checked)));
  await go(P, 'home', null, 300); await go(P, 'groupbuy', { c: 'sample-set' }); // the page again (the switch is remembered)
  await S(P, () => App.navigate('groupbuy', { team: App.groupbuy.live().mine['sample-set'].id })); await P.waitForTimeout(1300);
  ok('…the choice is kept', !(await S(P, () => document.querySelector('.gb-pub-row input').checked)));
  await go(P, 'groupbuy');
  await P.click('.gb-deal[data-c="sample-drip"] .gb-start'); await P.waitForTimeout(700);
  await P.click('.sheet .gb-pub-check'); await P.click('.gb-start-go'); await P.waitForTimeout(1500);
  ok('start with 公開 unticked: the switch starts off', !(await S(P, () => document.querySelector('.gb-pub-row input').checked)));

  /* ---------- 好孕島 ---------- */
  const Q = await mk();
  await go(Q, 'island', null, 1800);
  const isl = await S(Q, () => [...document.querySelectorAll('.isl .gbr-tile')].filter((t) => !t.hidden).map((t) => [t.dataset.c, t.querySelector('.gbr-rib').textContent, t.querySelector('.gbr-rib').classList.contains('hot'), (t.querySelector('.gbr-badge') || {}).textContent || '']));
  ok('好孕島: one tile, 月子禮盒, says 差1人 (red, no discount badge); the others wait in the 🛒 tab', JSON.stringify(isl) === JSON.stringify([['sample-gift', '差1人', true, '']]) && await S(Q, () => (document.querySelector('.isl .gbr-tab-n') || {}).textContent) === '3', JSON.stringify(isl));

  /* ---------- a small phone, dark ---------- */
  const small = await mk({ width: 320, height: 640, scheme: 'dark' });
  await go(small, 'groupbuy');
  const fit = await S(small, () => { const r = document.querySelector('.gb-open-row'); const j = r.querySelector('.gb-open-join').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, right: Math.round(j.right), w: Math.round(j.width), h: Math.round(j.height) }; });
  ok('320 px: a team row and its 跟團 fit (no sideways scroll, a 44px-tall button)', fit.sw <= 320 && fit.right <= 320 && fit.h >= 40, JSON.stringify(fit));
  await small.evaluate(() => document.querySelector('.gb-open').scrollIntoView({ block: 'center' })); await small.waitForTimeout(200);
  await shot(small, 'small-dark');
  await axe(small, '正在開團 at 320 px, dark');

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  for (const c of ctxs) await c.close().catch(() => {});
  await b.close();
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
