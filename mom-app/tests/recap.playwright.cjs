// 成長回顧 (js/modules/recap.js): 滿月／百日／第一年／到今天 from the records on the phone. The numbers (feeds, the
// nights she was up, diapers, sleep, growth, firsts, foods, pumping, 月照) are checked on a made-up baby; the story
// plays slide by slide (tap, keys, auto-advance, hold to pause, swipe down, ✕, Escape), skips what has no data, and
// ends with a thank-you, 分享 and 存圖片. The share card is 1080×1920 with counts only — no 體溫、用藥、看診 — and the
// name only when she shares names. 滿月／百日／週歲 offer the recap in their sheet. Small phone, reduced motion, a11y.
// Usage: BASE=http://localhost:8731/ AXE_PATH=<axe.min.js> node tests/recap.playwright.cjs
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8731/';
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const NOW = '2026-11-22T14:19:03+08:00';
const pngSize = (buf) => (buf.slice(1, 4).toString() === 'PNG' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null);

(async () => {
  const b = await chromium.launch();
  const mk = async ({ width = 390, height = 844, reduced = false, share = false } = {}) => {
    const c = await b.newContext({ viewport: { width, height }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', acceptDownloads: true, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await c.clock.install({ time: new Date(NOW) });
    await c.addInitScript((sh) => {
      window.__noShareMoments = true; window.open = () => null;
      if (sh) {
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
        Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared = { name: d.files[0].name, size: d.files[0].size, text: d.text }; } });
      }
    }, share);
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE);
    await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.recap);
    await p.click('text=先看看範例資料'); await p.waitForTimeout(900);
    await p.evaluate(() => { App.isNight = () => false; App.applyTheme(); App.store.update((s) => { s.settings.a2hsDismissed = '1'; }); });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: `${SHOT}${name}.png` }); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const slide = (p) => S(p, () => { const r = document.querySelector('.rc'); return r ? { id: r.dataset.slide, text: r.innerText.replace(/\s+/g, ' ').trim(), bars: [...r.querySelectorAll('.rc-bars span')].map((x) => x.className || '-').join(',') } : null; });

  /* ---------- 1. the numbers, on a made-up baby (born 100 days ago: day 101) ---------- */
  const P = await mk();
  const u = await S(P, () => {
    const C = window.Core;
    const bd = C.dateKey(C.addDays(new Date(), -100));
    const at = (day, hh, mm = 0) => { const d = C.addDays(C.parseKey(bd), day); d.setHours(hh, mm, 0, 0); return d.toISOString(); };
    App.store.update((s) => {
      s.babies.push({ id: 'rb', name: '豆豆', sex: 'boy', birthday: bd, birthWeight: 3.4, birthLength: 50, avatar: '👶' });
      const L = (type, day, hh, data = {}, mins = 0) => s.logs.push({ id: `r-${type}-${day}-${hh}-${Math.random()}`, babyId: 'rb', type, start: at(day, hh), end: mins ? new Date(new Date(at(day, hh)).getTime() + mins * 60000).toISOString() : null, data, note: '', by: '媽媽' });
      for (let d = 0; d < 40; d += 1) {
        L('breast', d, 2, { leftMin: 10, rightMin: 5 }, 15); // 40 at 2am
        L('bottle', d, 10, { kind: 'breastmilk', ml: 100 }); // 40 × 100 ml
        L('diaper', d, 11, { kind: d % 2 ? 'wet' : 'mixed' });
        L('sleep', d, 13, {}, 120); // 2 h a day
      }
      L('sleep', 20, 21, {}, 400); // the longest: 6 h 40 m
      L('pump', 5, 8, { left: 60, right: 40, ml: 100 }); L('pump', 6, 8, { ml: 1500 });
      L('food', 90, 12, { item: '米糊' }); L('food', 92, 12, { item: '南瓜泥' }); L('food', 95, 12, { item: '米糊' });
      L('temp', 30, 9, { c: 38.4 }); L('med', 30, 9, { name: '退燒藥', dose: '2.5 ml' }); L('visit', 31, 9, { clinic: '安安小兒科', reason: '發燒' });
      L('breast', 120, 2, { leftMin: 5 }, 5); // after the period (in the future): never counted
      s.growth.push({ id: 'g1', babyId: 'rb', date: C.dateKey(C.addDays(C.parseKey(bd), 60)), weight: 5.85, length: 59 });
      s.milestones.rb = { m2a: C.dateKey(C.addDays(C.parseKey(bd), 50)), m2c: C.dateKey(C.addDays(C.parseKey(bd), 70)) };
      s.activeBabyId = 'rb';
    });
    const b = App.store.state.babies.find((x) => x.id === 'rb');
    const r = App.recap.build(b, 'd100');
    const m1 = App.recap.build(b, 'm1');
    const av = App.recap.available(b).map((x) => x.kind);
    const sl = App.recap.slides(b, r).map((x) => x.id);
    return {
      r: { ...r, nightHours: undefined }, m1: { feeds: m1.feeds, night: m1.night, to: m1.to }, av, sl, txt: App.recap.text(b, r), tiles: App.recap.tiles(r).map((t) => `${t.l}:${t.v}${t.u}`),
    };
  });
  const r = u.r;
  ok('feeds: 親餵 40 + 瓶餵 40 = 80, 4,000 ml, breastfeeding minutes added up', r.feeds === 80 && r.breast === 40 && r.bottle === 40 && r.ml === 4000 && r.breastMin === 600, JSON.stringify(r).slice(0, 200));
  ok('the nights she was up: 40 feeds between midnight and 5, mostly at 2', r.night === 40 && r.nightHour === 2, `${r.night} ${r.nightHour}`);
  ok('diapers: 40, wet 40 (mixed counts as both), with poo 20', r.diapers === 40 && r.wet === 40 && r.dirty === 20, `${r.diapers} ${r.wet} ${r.dirty}`);
  ok('sleep: 86 h 40 m in all, the longest 6 h 40 m', Math.round(r.sleepMs / 60000) === 40 * 120 + 400 && Math.round(r.longest.ms / 60000) === 400, `${r.sleepMs} ${JSON.stringify(r.longest)}`);
  ok('pumping: 2 times, 1,600 ml', r.pumps === 2 && r.pumpMl === 1600, `${r.pumps} ${r.pumpMl}`);
  ok('foods: two kinds, the first one first (米糊)', r.foods.length === 2 && r.foods[0].item === '米糊', JSON.stringify(r.foods));
  ok('growth: birth size to the latest measurement', r.growth.w0 === 3.4 && r.growth.w1 === 5.85 && r.growth.l1 === 59, JSON.stringify(r.growth));
  ok('firsts from 發展里程碑, in order', r.firsts.length === 2 && r.firsts[0].label === '趴著時能短暫抬頭', JSON.stringify(r.firsts));
  ok('records after the period are not counted', r.records === 40 * 4 + 1 + 2 + 3 + 3, r.records);
  ok('滿月回顧 counts only the first 30 days', u.m1.feeds === 60 && u.m1.night === 30, JSON.stringify(u.m1));
  ok('100 days old: 到今天, 滿月, 百日 (第一年 not yet)', u.av.join() === 'now,m1,d100', u.av.join());
  ok('the story: intro, feeds, nights, diapers, sleep, growth, firsts, foods, pumping, the days, thank-you', u.sl.join() === 'intro,feeds,night,diapers,sleep,grow,firsts,foods,pump,you,end', u.sl.join());
  ok('the text has the counts and a thank-you, and nothing medical (體溫、用藥、看診)', /喝奶 80 次（半夜 40 次）/.test(u.txt) && /從 3\.4 kg 長到 5\.85 kg/.test(u.txt) && /謝謝你，辛苦了/.test(u.txt) && !/38\.4|退燒|安安|發燒|看診|體溫/.test(u.txt), u.txt);
  ok('the card tiles: counts only', u.tiles.join() === '喝奶:80次,半夜餵奶:40次,尿布:40片,睡眠:87小時,長大了:+2.45kg,擠的母乳:1.6公升', u.tiles.join());

  /* ---------- 2. the screen and the story ---------- */
  await S(P, () => App.navigate('recap', { baby: 'rb' })); await P.waitForTimeout(800);
  const tiles = await S(P, () => [...document.querySelectorAll('.rc-tile')].map((x) => `${x.dataset.kind}:${x.classList.contains('locked') ? 'locked' : 'open'}:${x.innerText.replace(/\s+/g, ' ')}`));
  ok('the screen lists 到今天, 滿月, 百日 (open) and 第一年 (locked, with the days to go)', tiles.length === 4 && /^now:open/.test(tiles[0]) && /^m1:open/.test(tiles[1]) && /^d100:open/.test(tiles[2]) && /^y1:locked.*還有 264 天/.test(tiles[3]), tiles.join(' | '));
  await shot(P, 'recap-screen');
  await axe(P, 'recap screen');
  await P.click('.rc-tile[data-kind="y1"]'); await P.waitForTimeout(300);
  ok('a locked one only says how long to wait', !(await P.$('.rc')) && /還有 264 天/.test(await S(P, () => (document.querySelector('.toast-wrap') || {}).innerText || '')));
  await P.click('.rc-tile[data-kind="d100"]'); await P.waitForTimeout(700);
  let s = await slide(P);
  ok('the story opens full screen on the intro: 豆豆的 100 天 with the dates', s && s.id === 'intro' && /豆豆的 100 天/.test(s.text) && /百日回顧/.test(s.text), JSON.stringify(s));
  ok('…with a bar per slide', s.bars.split(',').length === 11, s.bars);
  await axe(P, 'recap story');
  await P.click('.rc-next'); await P.waitForTimeout(1500);
  s = await slide(P);
  ok('tap right: the next slide, its number counts up to 80', s.id === 'feeds' && /80/.test(s.text) && /親餵 40 次・瓶餵 40 次・共 4 公升/.test(s.text), s.text);
  await P.keyboard.press('ArrowRight'); await P.waitForTimeout(1400);
  s = await slide(P);
  ok('→ key: the nights (40, mostly 2 a.m., a thank-you)', s.id === 'night' && /40/.test(s.text) && /凌晨 2 點/.test(s.text) && /辛苦了/.test(s.text), s.text);
  await shot(P, 'recap-night');
  await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(400);
  ok('← key: back', (await slide(P)).id === 'feeds');
  // it moves on by itself, and holding pauses it
  await P.clock.runFor(5400); await P.waitForTimeout(300);
  ok('it moves on by itself after about 5 seconds', (await slide(P)).id === 'night');
  const box = await P.locator('.rc').boundingBox();
  await P.mouse.move(box.width / 2, box.height / 2); await P.mouse.down();
  await P.clock.runFor(8000); await P.waitForTimeout(200);
  ok('holding a finger on it pauses', (await slide(P)).id === 'night' && /paused/.test((await slide(P)).bars));
  await P.mouse.up(); await P.waitForTimeout(200);
  for (let i = 0; i < 12; i += 1) { if ((await slide(P)).id === 'end') break; await P.click('.rc-next'); await P.waitForTimeout(250); } // eslint-disable-line no-await-in-loop
  s = await slide(P);
  ok('the end: 謝謝你，辛苦了, with 分享、存圖片、再看一次', s.id === 'end' && /謝謝你，辛苦了/.test(s.text) && /分享回顧卡/.test(s.text) && /存圖片/.test(s.text) && /再看一次/.test(s.text), s.text);
  await shot(P, 'recap-end');
  const [dl] = await Promise.all([P.waitForEvent('download'), P.click('.rc-save')]);
  const dim = pngSize(fs.readFileSync(await dl.path()));
  ok('存圖片: a 1080×1920 card', dl.suggestedFilename() === 'yijia-recap-d100.png' && dim && dim.w === 1080 && dim.h === 1920, `${dl.suggestedFilename()} ${JSON.stringify(dim)}`);
  await P.click('.rc-again'); await P.waitForTimeout(400);
  ok('再看一次 starts over', (await slide(P)).id === 'intro');
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  ok('Escape closes it', !(await P.$('.rc')));
  await P.click('.rc-tile[data-kind="now"]'); await P.waitForTimeout(500);
  await P.click('.rc-x'); await P.waitForTimeout(400);
  ok('✕ closes it', !(await P.$('.rc')));
  await P.click('.rc-tile[data-kind="m1"]'); await P.waitForTimeout(500);
  await P.mouse.move(195, 300); await P.mouse.down(); await P.mouse.move(195, 500, { steps: 6 }); await P.mouse.up(); await P.waitForTimeout(400);
  ok('swiping down closes it', !(await P.$('.rc')));
  // the share card: counts only, the name only when names are shared
  const card = await S(P, async () => {
    const b = App.store.state.babies.find((x) => x.id === 'rb');
    App.store.update((st) => { st.share = st.share || {}; st.share.privacy = { ...(st.share.privacy || {}), showName: false }; });
    const txt = App.recap.text(b, App.recap.build(b, 'd100'));
    App.store.update((st) => { st.share.privacy.showName = true; });
    return txt;
  });
  ok('with names hidden, the card says 寶寶 (the story inside the app still says the name)', /^【寶寶的 100 天】/.test(card) && !/豆豆/.test(card), card.split('\n')[0]);

  /* ---------- 3. little data; the demo baby with 月照 ---------- */
  const few = await S(P, () => {
    const C = window.Core;
    App.store.update((st) => { st.babies.push({ id: 'nb', name: '新新', sex: 'girl', birthday: C.dateKey(C.addDays(new Date(), -3)), avatar: '👶' }); });
    const b = App.store.state.babies.find((x) => x.id === 'nb');
    return { av: App.recap.available(b).map((x) => x.kind), sl: App.recap.slides(b, App.recap.build(b, 'now')).map((x) => x.id) };
  });
  ok('a baby with almost no records: a gentle note instead of zeros', few.av.join() === 'now' && few.sl.join() === 'intro,few,end', JSON.stringify(few));
  const demo = await S(P, () => { const b = App.store.state.babies.find((x) => x.id === 'demo-baby'); return App.recap.slides(b, App.recap.build(b, 'now')).map((x) => x.id); });
  ok('the sample baby: 月照 are in the story', demo.includes('photos'), demo.join());
  await S(P, () => { App.store.update((st) => { st.activeBabyId = 'demo-baby'; }); App.recap.open(App.store.state.babies.find((x) => x.id === 'demo-baby'), 'now'); });
  await P.waitForTimeout(500);
  for (let i = 0; i < 12; i += 1) { if ((await slide(P)).id === 'photos') break; await P.click('.rc-next'); await P.waitForTimeout(200); } // eslint-disable-line no-await-in-loop
  const imgs = await P.waitForFunction(() => { const x = [...document.querySelectorAll('.rc-ph')]; return x.length === 3 && x.every((i) => i.complete && i.naturalWidth > 0); }, null, { timeout: 6000 }).then(() => true, () => false);
  ok('…with their pictures', imgs);
  await shot(P, 'recap-photos');
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);

  /* ---------- 4. 滿月／百日／週歲: the sheet offers the recap ---------- */
  await S(P, () => { const C = window.Core; App.store.update((st) => { st.babies.find((x) => x.id === 'rb').birthday = C.dateKey(C.addDays(new Date(), -100)); st.activeBabyId = 'rb'; }); App.navigate('home'); });
  await P.waitForTimeout(1000);
  const ml = await S(P, () => (document.querySelector('.moment-line') || {}).innerText || '');
  ok('百日: the line under the baby mentions 回顧', /百日快樂/.test(ml) && /回顧・習俗・分享卡/.test(ml.replace(/\s+/g, '')), ml);
  await P.click('.moment-line'); await P.waitForTimeout(500);
  const btn = await S(P, () => (document.querySelector('.sheet .sh-recap') || {}).innerText || '');
  ok('…and its sheet has 「🎬 看豆豆的百日回顧」', /看豆豆的百日回顧/.test(btn), btn);
  await P.click('.sheet .sh-recap'); await P.waitForTimeout(800);
  ok('…which plays it', (await slide(P) || {}).id === 'intro' && /豆豆的 100 天/.test((await slide(P)).text));
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  ok('成長回顧 is a tool (成長發育)', await S(P, () => { const t = (App.tools || []).find((x) => x.id === 'recap'); return !!t && t.group === '成長發育' && t.screen === 'recap'; }));
  ok('sw.js caches the recap files', await S(P, async () => { const t = await (await fetch('sw.js')).text(); return t.includes("'js/modules/recap.js'") && t.includes("'css/recap.css'"); }));

  /* ---------- 5. sharing where files can be shared; reduced motion; a small phone ---------- */
  const Q = await mk({ share: true, reduced: true, width: 320, height: 568 });
  await S(Q, () => App.recap.open(App.store.baby(), 'now')); await Q.waitForTimeout(400);
  const n0 = await S(Q, () => { document.querySelector('.rc-next').click(); return new Promise((r) => setTimeout(() => r(document.querySelector('.rc-num') && document.querySelector('.rc-num').textContent), 60)); });
  ok('reduced motion: the number shows at once (no counting)', /^\d[\d,]*$/.test(n0) && n0 !== '0', n0);
  const fits = await S(Q, () => { const c = document.querySelector('.rc-card').getBoundingClientRect(); return c.left >= 0 && c.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; });
  ok('320 px: the slide fits', fits);
  for (let i = 0; i < 14; i += 1) { if ((await slide(Q)).id === 'end') break; await Q.click('.rc-next'); await Q.waitForTimeout(150); } // eslint-disable-line no-await-in-loop
  await shot(Q, 'recap-end-small');
  await S(Q, () => { // count every call; the first one stays "open" a moment, like a real share sheet
    window.__calls = 0; window.__dl = 0;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function c() { if (this.hasAttribute('download')) { window.__dl += 1; return undefined; } return click.call(this); };
    const real = navigator.share;
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__calls += 1; await real(d); await new Promise((r) => setTimeout(r, 600)); } });
  });
  await Q.click('.rc-share');
  const busyNow = await S(Q, () => ({ text: document.querySelector('.rc-share').textContent, busy: document.querySelector('.rc-share').getAttribute('aria-busy'), save: document.querySelector('.rc-save').getAttribute('aria-busy') }));
  await Q.click('.rc-share', { force: true }); await Q.click('.rc-save', { force: true }); // a second tap, and 存圖片, while it is made
  // making the card can take a few seconds on a busy machine: wait for the share itself, not a fixed time
  await Q.waitForFunction(() => !!window.__shared, null, { timeout: 8000 }).catch(() => {});
  await Q.waitForFunction(() => !document.querySelector('.rc-share[aria-busy]'), null, { timeout: 8000 }).catch(() => {});
  const sh = await S(Q, () => window.__shared || null);
  ok('分享回顧卡 hands the phone the picture and the text', sh && sh.name === 'yijia-recap-now.png' && sh.size > 30000 && /喝奶 \d+ 次/.test(sh.text), JSON.stringify(sh).slice(0, 200));
  const after = await S(Q, () => ({ calls: window.__calls, dl: window.__dl, text: document.querySelector('.rc-share').textContent }));
  ok('…the button says 「做圖中…」 meanwhile; tapping again (or 存圖片) shares once and downloads nothing',
    busyNow.text === '做圖中…' && busyNow.busy === 'true' && busyNow.save === 'true' && after.calls === 1 && after.dl === 0 && after.text === '📤 分享回顧卡', JSON.stringify({ busyNow, after }));
  await axe(Q, 'recap end, small phone');

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  const pass = results.filter((x) => x.pass).length;
  results.forEach((x) => console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${x.pass ? '' : `  ← ${x.info}`}`));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
