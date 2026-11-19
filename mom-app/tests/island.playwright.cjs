// 好孕群島測試：每個階段一座島，懷孕週數、寶寶年齡到了就自己開島；開島時注意事項與新手教學馬上打開、慶祝一次；
// 還沒開的島看得到倒數、可以先看小知識但不能蓋章；分享、存成圖片、下載 PDF（手冊含 QR 邀請碼）；手機直放、橫放都好按。
// Usage: cd mom-app && python3 -m http.server 8080   then   node tests/island.playwright.cjs   [BASE=...]
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const results = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (opts = {}) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'zh-TW', acceptDownloads: true, ...opts });
    await ctx.addInitScript(() => { window.__noShareMoments = true; });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.dismiss().catch(() => {}));
    await p.goto(BASE); await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.island && App.island.islands);
    return { p, ctx };
  };
  const S = (p, f, a) => p.evaluate(f, a);
  // a fresh nonce each time so going to the same screen twice really renders it again
  const go = async (p, id, params, ms = 900) => { await S(p, ([x, prm]) => App.navigate(x, { ...(prm || {}), n: Math.random().toString(36).slice(2, 7) }), [id, params]); await p.waitForTimeout(ms); };
  const sheetText = (p) => S(p, () => { const all = document.querySelectorAll('.sheet'); return (all[all.length - 1] || {}).innerText || ''; }); // the sheet on top
  const closeSheets = async (p) => { for (let i = 0; i < 3; i += 1) { if (!(await S(p, () => document.body.classList.contains('has-sheet')))) break; await p.keyboard.press('Escape'); await p.waitForTimeout(350); } };
  // life stages
  const asPrep = (p) => S(p, () => { const s = App.store.defaults(); s.onboarded = true; s.onboardedAt = '2026-01-01'; s.profile.stage = 'prep'; s.settings.a2hsDismissed = '1'; App.store.replace(s); });
  const asPreg = (p, weeks) => S(p, (w) => { const s = App.store.defaults(); s.onboarded = true; s.onboardedAt = '2026-01-01'; s.profile.stage = 'preg'; s.settings.a2hsDismissed = '1'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -(w * 7 + 2))); s.profile.edd = Core.eddFromLmp(s.profile.lmp); App.store.replace(s); }, weeks);
  const asBaby = (p, months, days = 0) => S(p, ([m, d]) => { App.demo.seed(); App.store.update((s) => { s.settings.a2hsDismissed = '1'; s.onboardedAt = '2026-01-01'; s.babies[0].birthday = Core.dateKey(Core.addDays(Core.addMonths(new Date(), -m), -d)); }); }, [months, days]);
  const openIds = (p) => S(p, () => App.island.openIslands().map((i) => i.id).join(','));

  const { p } = await open();

  /* ---------- 1. the islands open with the journey ---------- */
  await asPrep(p);
  ok('備孕: only 備孕島 is open', (await openIds(p)) === 'prep', await openIds(p));
  await asPreg(p, 20);
  ok('懷孕 20 週: 備孕島 + 孕早期島 + 孕中期島 (孕晚期島 opens at 28 週)', (await openIds(p)) === 'prep,preg1,preg2', await openIds(p));
  const preg3 = await S(p, () => { const st = App.island.statusOf(App.island.islands.find((i) => i.id === 'preg3')); return { ...st, days: Core.diffDays(new Date(), st.opensAt) }; });
  ok('…and 孕晚期島 says when: 懷孕 28 週開放, 54 days from 20 週 2 天', !preg3.open && preg3.why === '懷孕 28 週開放' && preg3.days === 54, JSON.stringify(preg3));
  await asBaby(p, 0, 10);
  ok('寶寶出生 10 天: every pregnancy island + 月子島', (await openIds(p)) === 'prep,preg1,preg2,preg3,newborn', await openIds(p));
  await asBaby(p, 13);
  ok('寶寶 13 個月: up to 1 歲島; 2 歲島 still closed', (await openIds(p)) === 'prep,preg1,preg2,preg3,newborn,infant,crawl,y1', await openIds(p));
  await asBaby(p, 5, 20);
  const crawl = await S(p, () => { const st = App.island.statusOf(App.island.islands.find((i) => i.id === 'crawl')); return { ...st, days: Core.diffDays(new Date(), st.opensAt) }; });
  ok('寶寶 5 個月 20 天: 爬爬島 counts down to the 6-month day', !crawl.open && crawl.why === '寶寶 6 個月開放' && crawl.days > 0 && crawl.days <= 11, JSON.stringify(crawl));
  // twins / an older sibling: the islands follow whoever got there first
  await S(p, () => App.store.update((s) => { s.babies.push({ id: 'older', name: '哥哥', sex: 'boy', birthday: Core.dateKey(Core.addMonths(new Date(), -30)), avatar: '👦' }); }));
  ok('an older sibling (2½ 歲) opens 2 歲島 too', (await openIds(p)).endsWith('y1,y2'), await openIds(p));

  /* ---------- 2. first visit: a small guide card, no pop-ups, nothing celebrated for the past ---------- */
  await asBaby(p, 2);
  await S(p, () => App.store.update((s) => { s.island = { stamps: {}, quiz: {}, visited: {} }; }));
  await go(p, 'island', null, 1300);
  const first = await S(p, () => ({ coach: !document.querySelector('.isl-coach').hidden, sheet: document.body.classList.contains('has-sheet'), seen: Object.keys(App.store.state.island.seen || {}).join(','), here: (document.querySelector('.isl-ibanner.here') || {}).dataset?.island }));
  ok('first visit: a small guide chip (not a pop-up), the islands already open count as seen, and the map starts on 小寶貝島', first.coach && !first.sheet && first.seen === 'prep,preg1,preg2,preg3,newborn,infant' && first.here === 'infant', JSON.stringify(first));
  const labels = await S(p, () => ({ spots: document.querySelectorAll('.isl-label').length, onScreen: [...document.querySelectorAll('.isl-label[data-isl="infant"]')].filter((l) => { const r = l.getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight && r.left >= 0 && r.right <= innerWidth; }).length }));
  ok('stops show on open islands only, and the 3 stops of 小寶貝島 are on screen', labels.spots === 20 && labels.onScreen === 3, JSON.stringify(labels));
  await p.click('.isl-coach-main'); await p.waitForTimeout(500);
  const tour = await sheetText(p);
  ok('the guide chip opens 「好孕群島怎麼玩」: 5 short steps (islands open with age, 注意事項, stamps, share / PDF)', /好孕群島怎麼玩/.test(tour) && /時間到了自己開島/.test(tour) && /下載 PDF/.test(tour) && (await S(p, () => document.querySelectorAll('.sheet .isl-tour-steps li').length)) === 5, tour.slice(0, 80));
  await p.click('.sheet button:has-text("開始逛")'); await p.waitForTimeout(400);
  ok('「開始逛」 puts the guide chip away for good', await S(p, () => document.querySelector('.isl-coach').hidden && !!App.store.state.island.toured));

  /* ---------- 3. birthday: 爬爬島 opens — a card on 首頁, its 注意事項 and 新手教學 right away, celebrated once ---------- */
  await S(p, () => App.store.update((s) => { s.babies[0].birthday = Core.dateKey(Core.addMonths(new Date(), -6)); }));
  await go(p, 'home', null, 900);
  const card = await S(p, () => { const e = document.querySelector('.isl-new-line'); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.innerText, top: Math.round(r.top), vh: innerHeight, afterHero: !!e.previousElementSibling && e.previousElementSibling.classList.contains('baby-hero') }; });
  ok('首頁: 「🎉 爬爬島開放了！注意事項・教學」 right under the baby, on the first screen', card && /爬爬島開放了/.test(card.text) && card.afterHero && card.top < card.vh / 2, JSON.stringify(card));
  await p.click('.isl-new-line'); await p.waitForTimeout(900);
  const un = { text: await sheetText(p), parts: await S(p, () => document.querySelectorAll('.fx-layer .fx-p').length) };
  ok('tap it: the island opens with a celebration', /新的小島開放了/.test(un.text) && un.parts >= 30, `parts ${un.parts}`);
  ok('…and its 注意事項 (with the 就醫警訊 first) and 新手教學 are open at once', /這個階段要注意/.test(un.text) && /就醫警訊/.test(un.text) && /誤食/.test(un.text) && /新手教學：第一口副食品/.test(un.text), un.text.slice(0, 160));
  ok('…with share / save image / PDF right there', await S(p, () => ['分享', '存成圖片', '下載 PDF'].every((t) => [...document.querySelectorAll('.sheet .isl-actions button')].some((b) => b.textContent.includes(t)))));
  await p.click('.sheet button:has-text("開始逛爬爬島")'); await p.waitForTimeout(900);
  ok('「開始逛爬爬島」 flies the map there (its stops are on screen)', await S(p, () => [...document.querySelectorAll('.isl-label[data-isl="crawl"]')].filter((l) => { const r = l.getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight; }).length === 3));
  await go(p, 'home', null, 700);
  ok('once seen, the 首頁 line goes away', await S(p, () => !document.querySelector('.isl-new-line')));
  await go(p, 'island', null, 1200);
  ok('…and coming back to the islands does not pop it up again', !(await S(p, () => document.body.classList.contains('has-sheet'))));

  /* several islands at once (e.g. switching from 備孕 to 育兒): one sheet, not seven */
  await asPrep(p); await go(p, 'island', null, 900);
  await S(p, () => { App.demo.seed(); App.store.update((s) => { s.settings.a2hsDismissed = '1'; s.island.seen = { prep: '2026-01-01' }; s.island.toured = '2026-01-01'; }); });
  await go(p, 'island', null, 1300);
  const many = await sheetText(p);
  ok('many islands at once (孕早期 → 小寶貝): one sheet for the newest that mentions the other 4', /小寶貝島/.test(many) && /另外還有 4 座島/.test(many) && (await S(p, () => document.querySelectorAll('.sheet').length)) === 1, many.slice(0, 120));
  await closeSheets(p);

  /* ---------- 4. islands still to come: a countdown and a peek, but no stamps ---------- */
  await S(p, () => App.island.openIsland('y2')); await p.waitForTimeout(500);
  const lk = { text: await sheetText(p), details: await S(p, () => [...document.querySelectorAll('.sheet .isl-note')].map((n) => ({ urgent: n.classList.contains('urgent'), detail: !!n.querySelector('p') }))) };
  ok('a closed island: 「寶寶 2 歲開放（還有 N 天）」, its stops and only a share button', /寶寶 2 歲開放（還有 \d+ 天）/.test(lk.text) && /如廁小屋/.test(lk.text) && !/存成圖片|下載 PDF/.test(lk.text) && !(await S(p, () => !!document.querySelector('.sheet .isl-guide'))), lk.text.slice(0, 120));
  ok('…its 注意事項 titles show; a 就醫警訊 shows in full even before it opens', lk.details.length >= 4 && lk.details.every((d) => d.detail === d.urgent), JSON.stringify(lk.details));
  await closeSheets(p);
  await S(p, () => App.island.openSpot('potty')); await p.waitForTimeout(500);
  const pv = await S(p, () => ({ quiz: !!document.querySelector('.sheet .isl-quiz'), checks: !!document.querySelector('.sheet .isl-checks'), cards: document.querySelectorAll('.sheet .isl-know').length, lock: (document.querySelector('.sheet .isl-lockbar') || {}).textContent || '' }));
  ok('a stop on a closed island (from search or a friend\'s link): read the 小知識, no checklist or quiz yet', !pv.quiz && !pv.checks && pv.cards === 4 && /2 歲島/.test(pv.lock), JSON.stringify(pv));
  await closeSheets(p);

  /* ---------- 5. stamps per island ---------- */
  const before = await S(p, () => Object.keys(App.store.state.island.stamps || {}).length);
  for (const id of ['vaccine', 'sleepforest', 'playland']) {
    await S(p, (x) => App.island.openSpot(x), id); await p.waitForTimeout(400);
    const qn = await S(p, () => document.querySelectorAll('.sheet .isl-q').length);
    for (let i = 0; i < qn; i += 1) { await p.locator('.sheet .isl-q').nth(i).locator('.isl-opts button').first().click(); await p.waitForTimeout(80); }
    await p.waitForTimeout(200);
    if (id === 'playland') ok('the last stamp of 小寶貝島: 「小寶貝島全部蓋章完成！」', /小寶貝島全部蓋章完成/.test(await S(p, () => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' '))));
    await closeSheets(p);
  }
  await go(p, 'island', { island: 'infant' }, 1200); await closeSheets(p);
  const done = await S(p, () => ({ n: Object.keys(App.store.state.island.stamps).length, plate: (document.querySelector('.isl-ibanner[data-island="infant"]') || {}).classList?.contains('done'), chip: document.querySelector('.isl-chip[data-island="infant"]').classList.contains('done') }));
  ok('…the name plate and the island chip show it is done', done.n === before + 3 && done.plate && done.chip, JSON.stringify(done));

  /* ---------- 6. getting around: island strip, overview ---------- */
  await p.tap('.isl-chip[data-island="prep"]'); await p.waitForTimeout(900);
  ok('tap 🌱 in the island strip: the map flies to 備孕島', await S(p, () => document.querySelector('.isl-chip.sel').dataset.island === 'prep' && [...document.querySelectorAll('.isl-label[data-isl="prep"]')].some((l) => l.getBoundingClientRect().top > 0)));
  ok('closed islands show 🔒 in the strip', await S(p, () => document.querySelector('.isl-chip[data-island="y3"]').classList.contains('locked') && /🔒/.test(document.querySelector('.isl-chip[data-island="y3"]').textContent)));
  await p.click('.isl-cbtn:has-text("全景")'); await p.waitForTimeout(900);
  const far = await S(p, () => ({ far: document.querySelector('.isl').classList.contains('far'), labels: [...document.querySelectorAll('.isl-label')].filter((l) => getComputedStyle(l).display !== 'none').length, minis: [...document.querySelectorAll('.isl-ib-mini')].filter((m) => getComputedStyle(m).display !== 'none').length }));
  ok('全景: the whole journey as 11 round badges (stop labels hidden so nothing piles up)', far.far && far.labels === 0 && far.minis === 11, JSON.stringify(far));
  await p.click('.isl-cbtn:has-text("旅程")'); await p.waitForTimeout(500);
  const jr = await sheetText(p);
  ok('旅程: every island with its stamps, locks, and 「分享我的護照」', /分享我的護照/.test(jr) && /4–6 歲島/.test(jr) && /🔒/.test(jr), jr.slice(0, 100));
  await p.click('.sheet button:has-text("分享我的護照")'); await p.waitForTimeout(700);
  ok('…which opens the share sheet (LINE, IG…)', /LINE/.test(await sheetText(p)));
  await closeSheets(p);

  /* ---------- 7. share, save as image, PDF ---------- */
  await S(p, () => App.island.openIsland('crawl')); await p.waitForTimeout(500);
  await p.click('.sheet .isl-actions button:has-text("分享")'); await p.waitForTimeout(900);
  const sh = await S(p, () => { const all = document.querySelectorAll('.sheet'); const top = all[all.length - 1]; return { text: (top || {}).innerText || '', img: !!(top && top.querySelector('.sh-img')) }; });
  ok('分享 an island: share sheet with a ready-made card', /LINE/.test(sh.text) && sh.img, sh.text.slice(0, 60));
  await closeSheets(p);
  const size = await S(p, async () => { const isl = App.island.islands.find((i) => i.id === 'crawl'); const b = await App.share.render({ emoji: isl.emoji, title: isl.name, lines: isl.notes.map((n) => n.t), linesTitle: '⚠️ 這個階段要注意', theme: 'green', campaign: 'island-crawl', path: 'island', params: { island: 'crawl' } }); return b ? b.size : 0; });
  ok('存成圖片: a 1080×1920 card is drawn (with the QR invite)', size > 50000, `${size} bytes`);
  // (headless Chromium reports every blob download as "download", so read the name the page asks for)
  await S(p, () => { const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dlName = this.download; return orig.call(this); }; });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), S(p, () => App.island.saveIslandImage(App.island.islands.find((i) => i.id === 'crawl')))]);
  const dlName = await S(p, () => window.__dlName);
  ok('…on a computer it downloads as 好孕群島-爬爬島.png (phones get the share sheet to save it)', dl && dlName === '好孕群島-爬爬島.png', `${dlName}`);
  await go(p, 'island-guide', { island: 'crawl' }, 900);
  const doc = await S(p, () => ({ h2: (document.querySelector('.isl-doc h2') || {}).textContent, secs: document.querySelectorAll('.isl-doc-sec').length, qr: !!document.querySelector('.isl-doc-qr'), code: /邀請碼/.test(document.querySelector('.isl-doc-foot').textContent), print: !!document.querySelector('button.btn-primary') && /列印／存成 PDF/.test(document.querySelector('button.btn-primary').textContent), tab: (document.querySelector('.tab.active') || {}).textContent }));
  ok('下載 PDF: 島嶼手冊 with 注意事項, 新手教學, every stop, a QR code and the invite code', doc.h2 === '🧸 爬爬島' && doc.secs === 5 && doc.qr && doc.code && doc.print, JSON.stringify(doc));
  await p.emulateMedia({ media: 'print' });
  const pr = await S(p, () => ({ bars: ['.appbar', '.tabbar', '.no-print'].map((s) => [...document.querySelectorAll(s)].filter((e) => getComputedStyle(e).display !== 'none').length).reduce((a, b) => a + b, 0) }));
  ok('…printing shows only the handout (no app bars or buttons)', pr.bars === 0, JSON.stringify(pr));
  await p.emulateMedia({ media: 'screen' });

  /* ---------- 8. small phones, phones on their side ---------- */
  {
    const { p: q, ctx } = await open({ ...devices['iPhone SE'] });
    await asBaby(q, 3); await S(q, () => App.store.update((s) => { s.island = { stamps: {}, quiz: {}, visited: {}, seen: { prep: 1, preg1: 1, preg2: 1, preg3: 1, newborn: 1, infant: 1 }, toured: '1' }; }));
    await go(q, 'island', null, 1200);
    const lay = await S(q, () => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const tab = r('.tabbar').top; const strip = r('.isl-strip'); const tick = r('.isl-ticker');
      const plate = r('.isl-ibanner.here .isl-ib-pill');
      return { strip: strip.bottom <= tick.top + 1 && strip.bottom <= tab, tick: tick.bottom <= tab, plate: plate.bottom <= strip.top && plate.top > 0, over: document.documentElement.scrollWidth - innerWidth, chips: [...document.querySelectorAll('.isl-chip')].every((c) => c.getBoundingClientRect().height >= 40) };
    });
    ok('iPhone SE: the island strip and news ticker sit above the tab bar, the island\'s name plate is visible, chips are 40px+', lay.strip && lay.tick && lay.plate && lay.over <= 1 && lay.chips, JSON.stringify(lay));
    await ctx.close();
  }
  {
    const { p: q, ctx } = await open({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await asBaby(q, 3); await S(q, () => App.store.update((s) => { s.island = { stamps: {}, quiz: {}, visited: {}, seen: { prep: 1, preg1: 1, preg2: 1, preg3: 1, newborn: 1, infant: 1 }, toured: '1' }; }));
    await go(q, 'island', null, 1200);
    const lay = await S(q, () => { const tab = document.querySelector('.tabbar').getBoundingClientRect().top; return { strip: document.querySelector('.isl-strip').getBoundingClientRect().bottom <= tab, tick: document.querySelector('.isl-ticker').getBoundingClientRect().bottom <= tab, scroll: document.documentElement.scrollHeight - innerHeight }; });
    ok('phone on its side: strip and ticker above the tab bar, no page scroll', lay.strip && lay.tick && lay.scroll <= 1, JSON.stringify(lay));
    await ctx.close();
  }

  /* ---------- 9. reduced motion, speed ---------- */
  {
    const { p: q, ctx } = await open({ reducedMotion: 'reduce' });
    await asBaby(q, 5, 29); await go(q, 'island', null, 900); await closeSheets(q);
    await S(q, () => App.store.update((s) => { s.babies[0].birthday = Core.dateKey(Core.addMonths(new Date(), -6)); }));
    const t0 = Date.now(); await go(q, 'island', null, 1200); const ms = Date.now() - t0;
    const still = await S(q, () => ({ parts: document.querySelectorAll('.fx-layer .fx-p').length, sheet: /新的小島開放了/.test([...document.querySelectorAll('.sheet')].map((x) => x.textContent).join(' ')), fog: !document.querySelector('.isl-fog.lifting') || getComputedStyle(document.querySelector('.isl-fog.lifting')).display === 'none' }));
    ok('「減少動態效果」: the island still opens with its 注意事項, without confetti or drifting clouds', still.sheet && still.parts === 0 && still.fog, JSON.stringify(still));
    const render = await S(q, () => { const t = performance.now(); App.navigate('island', { r: Math.random() }); return performance.now() - t; });
    ok('the whole archipelago (11 islands) draws quickly', render < 900, `${Math.round(render)} ms`);
    await ctx.close();
  }

  ok('no page errors anywhere', !errors.length, errors.slice(0, 4).join(' | '));
  console.log('\n=== 好孕群島 ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
