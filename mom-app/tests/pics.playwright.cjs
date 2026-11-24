// 縮圖與字級 (0.9.4): the app's own drawings (assets/thumbs, one set made for this app) where words used to explain —
// 歡迎頁's three stages, every tool on 健康 in each stage (a grid of picture cards), feature intros (家人共用, 祝福牆,
// 團購, 補助, 成長回顧, 月照, 通知, 每日提醒) and empty pages — decorative (alt="") and all loading; the type scale (text
// in five sizes: 12 / 13.5 / 15 / 17 / 20, form fields 16, big numbers and headlines 24 up, badge digits 11 and under);
// share cards drawn flat (no gradient, no bubbles) with the moment's drawing; and a calmer 好孕島 (no season button,
// no drifting particles, a tip that changes only when tapped, no 稱號). 0.9.5: every 首頁 card carries its drawing,
// and the empty 接下來 / 最新紀錄 and the 分享時刻 prompt too. 0.9.6: every empty page shows a drawing (紀錄, 搜尋,
// 胎動, 宮縮, 產檢日記 had 小滴 with an emoji). Light, dark and a small phone; accessibility.
// Usage: cd mom-app && python3 -m http.server 8080   then   BASE=http://localhost:8080/ node tests/pics.playwright.cjs
//        AXE_PATH=<axe.min.js> for the accessibility checks
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8080/';
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });

(async () => {
  const b = await chromium.launch();
  const mk = async ({ scheme = 'light', width = 390, height = 844 } = {}) => {
    const c = await b.newContext({ viewport: { width, height }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', colorScheme: scheme });
    await c.addInitScript(() => { window.__noShareMoments = true; window.__noNightAuto = true; window.open = () => null; });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE); await p.waitForSelector('text=你現在是？', { timeout: 15000 });
    await p.evaluate((sc) => { App.isNight = () => sc === 'dark'; if (App.applyTheme) App.applyTheme(); }, scheme);
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, hash, ms = 900) => { await S(p, (x) => { location.hash = x; }, hash); await p.waitForTimeout(ms); };
  const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: `${SHOT}${name}.png`, fullPage: true }); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  // every drawing on the page: loaded (256 px source), decorative, and which one
  const pics = (p, sel = '#view') => S(p, async (s) => {
    const imgs = [...document.querySelectorAll(`${s} img.pic`)];
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    return imgs.map((i) => ({ name: (i.src.match(/thumbs\/([a-z-]+)\.webp$/) || [])[1], w: i.naturalWidth, alt: i.getAttribute('alt'), shown: !!i.offsetParent }));
  }, sel);
  // the text sizes in use on the page: every element with its own text
  const sizes = (p) => S(p, () => {
    const out = {};
    document.querySelectorAll('#view *, .appbar *, .tabbar *').forEach((el) => {
      if (!el.offsetParent || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
      const fs0 = parseFloat(getComputedStyle(el).fontSize);
      const k = `${Math.round(fs0 * 10) / 10}`;
      if (!out[k]) out[k] = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`;
    });
    return out;
  });
  const TEXT = [12, 13.5, 15, 16, 17, 20]; // the scale, and 16 for form fields
  const offScale = (sz) => Object.keys(sz).map(Number).filter((v) => v > 11 && v < 24 && !TEXT.includes(v));

  /* ---------- 歡迎頁: the three stages ---------- */
  const P = await mk();
  let pp = await pics(P);
  ok('歡迎頁: each stage has its drawing (備孕・懷孕・育兒), loaded and decorative', pp.map((x) => x.name).join() === 'stage-prep,stage-preg,stage-baby' && pp.every((x) => x.w === 256 && x.alt === '' && x.shown), JSON.stringify(pp));
  const ob = await S(P, () => [...document.querySelectorAll('.ob-choice')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  ok('…and a few words each instead of a sentence', ob.length === 3 && ob.every((t) => t.length <= 20) && /備孕中/.test(ob[0]) && /懷孕中/.test(ob[1]) && /育兒中/.test(ob[2]), ob.join(' | '));
  ok('…the first screen still fits a 390×844 phone without scrolling to the choices', await S(P, () => document.querySelectorAll('.ob-choice')[2].getBoundingClientRect().bottom < innerHeight));
  await shot(P, 'welcome');
  await axe(P, '歡迎頁 with the stage drawings');
  let sz = await sizes(P);
  ok('歡迎頁: text only in the scale sizes', !offScale(sz).length, JSON.stringify(sz));

  /* ---------- 健康: a picture card for every tool, in each stage ---------- */
  await P.click('text=先看看範例資料'); await P.waitForTimeout(1500);
  await go(P, '#/health', 1200);
  pp = await pics(P);
  const toolN = await S(P, () => document.querySelectorAll('.tool-card').length);
  ok('健康 (育兒): every tool is a card with its drawing — no card without one, none broken', toolN >= 15 && pp.length === toolN && pp.every((x) => x.w === 256 && x.alt === ''), `${toolN} cards, ${JSON.stringify(pp.filter((x) => x.w !== 256))}`);
  const grid = await S(P, () => [...document.querySelectorAll('.tool-grid')].map((g) => ({ n: g.children.length, wide: [...g.children].filter((c) => c.classList.contains('wide')).length, first: g.children[0].classList.contains('wide') })));
  ok('…a group with an odd number of tools starts with one wide card (no half-empty rows); even groups have none', grid.every((g) => (g.n % 2 ? g.wide === 1 && g.first : g.wide === 0)), JSON.stringify(grid));
  const wideText = await S(P, () => [...document.querySelectorAll('.tool-card')].map((c) => ({ wide: c.classList.contains('wide'), desc: !!c.querySelector('.tile-desc') })));
  ok('…only the wide cards carry the tool\'s line; the others are picture + name', wideText.every((x) => x.wide === x.desc), JSON.stringify(wideText.filter((x) => x.wide !== x.desc)));
  await P.click('.tool-card[data-tool="growth"]'); await P.waitForTimeout(900);
  ok('…a card opens its tool (成長曲線)', await S(P, () => document.body.dataset.screen) === 'growth');
  await go(P, '#/health', 1000);
  await shot(P, 'health-baby');
  await axe(P, '健康 picture cards');
  sz = await sizes(P);
  ok('健康: text only in the scale sizes', !offScale(sz).length, JSON.stringify(sz));
  for (const st of ['preg', 'prep']) {
    await S(P, (x) => { App.store.update((s) => { s.profile.stage = x; if (x === 'preg') s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -150)); }); App.refresh(); }, st);
    await go(P, '#/home', 300); await go(P, '#/health', 1200);
    pp = await pics(P);
    const n = await S(P, () => document.querySelectorAll('.tool-card').length);
    const head = await S(P, () => { const i = document.querySelector('.health-stage img.pic'); return i ? (i.src.match(/thumbs\/([a-z-]+)\.webp$/) || [])[1] : null; });
    ok(`健康 (${st === 'preg' ? '懷孕' : '備孕'}): every tool has its drawing, and the header shows the stage's drawing`, n >= 4 && pp.filter((x) => x.name !== head).length === n && pp.every((x) => x.w === 256) && head === `stage-${st}`, `${n} cards ${head} ${JSON.stringify(pp.map((x) => x.name))}`);
  }
  await S(P, () => { App.store.update((s) => { s.profile.stage = 'baby'; }); App.refresh(); });

  /* ---------- feature intros: a drawing and a few words ---------- */
  const intros = [['#/family', 'family'], ['#/wall', 'wall'], ['#/benefits', 'benefits'], ['#/recap', 'recap'], ['#/monthly', 'monthly'], ['#/reminders', 'push'], ['#/brand', 'brand']];
  for (const [hash, name] of intros) {
    await go(P, hash, 1300);
    pp = await pics(P);
    ok(`${hash.slice(2)}: opens with its drawing (${name})`, pp.some((x) => x.name === name && x.w === 256 && x.shown), JSON.stringify(pp));
  }
  await go(P, '#/wall', 1000);
  const wall = await S(P, () => { const c = document.querySelector('.pic-intro'); return { text: c.innerText.replace(/\s+/g, ''), points: [...c.querySelectorAll('.pic-points li')].map((x) => x.textContent) }; });
  ok('祝福牆: the long paragraph became one line and three short points', wall.points.join('|') === '親友不用下載 App|你按「顯示」才會上牆|最後存成一張祝福卡' && wall.text.length < 60, JSON.stringify(wall));
  await go(P, '#/groupbuy', 1400);
  const how = await S(P, () => { const c = document.querySelector('.gb-how'); return c ? { pic: !!c.querySelector('img.pic'), steps: [...c.querySelectorAll('.gb-steps li')].map((x) => x.textContent) } : null; });
  ok('團購 怎麼揪團: its drawing and four short steps', how && how.pic && how.steps.length === 4 && how.steps.every((x) => x.length <= 12), JSON.stringify(how));

  /* ---------- empty pages: always a drawing (0.9.6: 小滴 with an emoji is on no empty page any more) ---------- */
  await S(P, () => { App.store.update((s) => { s.milk = []; }); }); // the 母乳庫存 is a list of bags
  await go(P, '#/milk', 1000);
  pp = await pics(P);
  ok('母乳庫存 with nothing in it: its drawing, not 小滴 with an emoji', pp.some((x) => x.name === 'milk') && await S(P, () => !document.querySelector('#view .empty .md')), JSON.stringify(pp));
  await S(P, () => { App.store.update((s) => { s.logs = s.logs.filter((l) => new Date(l.start) < new Date(Date.now() - 864e5 * 3)); }); });
  await go(P, '#/log', 1000);
  pp = await pics(P);
  ok('紀錄 with nothing today: the 紀錄 drawing (it was 小滴 holding up 🌙)', pp.some((x) => x.name === 'records' && x.w === 256) && await S(P, () => !document.querySelector('#view .md')), JSON.stringify(pp));
  await go(P, '#/search', 900);
  await P.fill('#sr-input', 'ㄅㄆㄇ亂打xyz'); await P.waitForTimeout(900);
  pp = await pics(P);
  ok('搜尋 with no answer: the 搜尋 drawing (it was 小滴 thinking), and the ways to ask again', pp.some((x) => x.name === 'search') && await S(P, () => !document.querySelector('.sr-empty .md') && /找不到/.test(document.querySelector('.sr-empty').innerText)), JSON.stringify(pp));
  await S(P, () => { App.store.update((s) => { s.profile.stage = 'preg'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -200)); s.preg = { ...(s.preg || {}), kicks: [], contractions: [], diary: [] }; }); App.refresh(); });
  const emptyOf = async (hash) => { await go(P, hash, 1000); return (await pics(P)).map((x) => x.name); };
  const kick = await emptyOf('#/kick'); const con = await emptyOf('#/contraction'); const dia = await emptyOf('#/diary');
  ok('懷孕: 胎動, 宮縮 and 產檢日記 with nothing yet each show their drawing, and no 小滴', kick.includes('kick') && con.includes('contraction') && dia.includes('prenatal') && await S(P, () => !document.querySelector('#view .md')), JSON.stringify({ kick, con, dia }));
  await S(P, () => { App.store.update((s) => { s.profile.stage = 'baby'; }); App.refresh(); });

  /* ---------- the type scale on more screens, a small phone in the dark ---------- */
  const Q = await mk({ scheme: 'dark', width: 320, height: 640 });
  await Q.click('text=先看看範例資料'); await Q.waitForTimeout(1500);
  for (const hash of ['#/home', '#/log', '#/health', '#/me', '#/island', '#/groupbuy', '#/benefits']) {
    await go(Q, hash, 1100);
    sz = await sizes(Q);
    const off = offScale(sz);
    ok(`320 px, dark — ${hash.slice(2)}: text only in the scale sizes, nothing wider than the screen`, !off.length && await S(Q, () => document.documentElement.scrollWidth <= innerWidth), off.length ? JSON.stringify(off.map((v) => [v, sz[v]])) : '');
  }
  await go(Q, '#/health', 1000);
  await shot(Q, 'health-small-dark');
  await axe(Q, '健康 picture cards (small, dark)');
  ok('dark: the drawings are dimmed a little so they do not glare', await S(Q, () => /brightness/.test(getComputedStyle(document.querySelector('img.pic')).filter)));
  await Q.context().close();

  /* ---------- share cards: flat colour, numbers in a row, the moment's drawing ---------- */
  const card = await S(P, async () => {
    const list = App.share.cards();
    const ms = list.find((x) => x.kind === 'milestone') || list[0];
    const blob = await App.share.render({ ...ms.spec, theme: 'green' }, { format: 'story' });
    const bm = await createImageBitmap(blob); const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height;
    const x = cv.getContext('2d'); x.drawImage(bm, 0, 0);
    const px = (a, c) => [...x.getImageData(a, c, 1, 1).data].slice(0, 3).join(',');
    return { kind: ms.kind, pic: ms.spec.pic, top: px(20, 260), mid: px(20, 1000), low: px(1060, 1880), cards: list.map((y) => [y.kind, y.spec.pic || '']) };
  });
  ok('share cards: the background is one flat colour (no gradient, no bubbles)', card.top === card.mid && card.mid === card.low, JSON.stringify(card));
  ok('…the moments carry their drawing (里程碑 → milestones, 打卡 → brand, 成長卡 → stage-baby)', card.pic === 'milestones' && card.cards.some(([k, p]) => k === 'streak' && p === 'brand') && card.cards.some(([k, p]) => k === 'baby-age' && p === 'stage-baby'), JSON.stringify(card.cards));

  /* ---------- 好孕島, calmer ---------- */
  await go(P, '#/island', 1800);
  const isl = await S(P, () => ({
    btns: [...document.querySelectorAll('.isl-cbtn')].map((x) => x.textContent.trim()),
    fx: document.querySelectorAll('.isl-fx i').length,
    tip: (document.querySelector('.isl-ticker-text') || {}).textContent,
    title: (document.querySelector('.isl-hud-title') || {}).textContent,
  }));
  ok('好孕島: no season button (the season follows the calendar), no drifting petals or snow', !isl.btns.some((x) => /季/.test(x)) && isl.fx === 0 && isl.btns.length === 4, JSON.stringify(isl));
  ok('…no 稱號 on the island card: just the stamps of this island', /^🏅 這座島 \d+\/\d+ 個章$/.test(isl.title), isl.title);
  await P.waitForTimeout(7000);
  const tip2 = await S(P, () => (document.querySelector('.isl-ticker-text') || {}).textContent);
  ok('…the tip stays put (7 seconds later the same)…', tip2 === isl.tip, `${isl.tip} → ${tip2}`);
  await P.click('.isl-ticker'); await P.waitForTimeout(400);
  ok('…and changes when tapped', await S(P, () => (document.querySelector('.isl-ticker-text') || {}).textContent) !== isl.tip);
  await P.click('.isl-cbtn:has-text("旅程")'); await P.waitForTimeout(700);
  const jr = await S(P, () => (document.querySelector('.isl-jr-top') || {}).innerText || '');
  ok('…旅程 shows the passport, not a 稱號', /我的護照/.test(jr) && !/稱號|島民|島主|探險家|傳說/.test(jr), jr.replace(/\s+/g, ' '));

  /* ---------- 0.9.5 首頁: every card carries its drawing ---------- */
  // a Sunday, after ten days of use: 家族週報, 邀請朋友 and 備份 join the everyday cards
  const homeCards = (p) => S(p, () => [...document.querySelectorAll('#view .home-slot[data-card]')].filter((x) => x.dataset.card !== 'more').map((x) => {
    const i = x.querySelector('img.pic'); return [x.dataset.card, i ? (i.src.match(/thumbs\/([a-z0-9-]+)\.webp$/) || [])[1] : '', i ? i.naturalWidth : 0];
  }));
  const H = await (async () => {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
    await c.clock.install({ time: new Date('2026-11-29T10:00:00+08:00') });
    await c.addInitScript(() => { window.__noShareMoments = true; window.__noNightAuto = true; window.open = () => null; });
    const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE); await p.waitForSelector('text=你現在是？', { timeout: 15000 });
    await p.click('text=先看看範例資料'); await p.waitForTimeout(1500);
    await p.evaluate(() => {
      const ago = new Date(Date.now() - 10 * 864e5).toISOString();
      App.isNight = () => false; App.applyTheme();
      App.store.update((x) => { x.createdAt = ago; x.onboardedAt = ago; x.settings.lastBackupAt = null; });
      App.navigate('home'); App.refresh();
    });
    await p.waitForTimeout(1500);
    return p;
  })();
  let hc = await homeCards(H);
  const want = { 'benefits-now': 'benefits', daily: 'brand', 'baby-health': 'prevention', 'island-progress': 'island', weekly: 'weekly', invite: 'invite', 'keep-safe': 'backup' };
  const seen = Object.fromEntries(hc.map(([k, n]) => [k, n]));
  ok('首頁 (育兒, a Sunday after ten days): every card has its drawing — 福利, 今日小任務, 健康追蹤, 好孕島, 家族週報, 邀請, 備份', Object.entries(want).every(([k, n]) => seen[k] === n) && hc.every(([, n, w]) => n && w === 256), JSON.stringify(hc));
  const placed = await S(H, () => ({
    title: !!document.querySelector('[data-card="benefits-now"] .card-title > img.pic'),
    lead: !!document.querySelector('[data-card="invite"] .inv-home-ico') || !document.querySelector('[data-card="invite"] img.pic'),
    weekly: !!document.querySelector('[data-card="weekly"] .card > .row > img.pic'),
    island: !document.querySelector('[data-card="island-progress"] .isl-home-emoji'),
  }));
  ok('…beside the title, in place of the leading emoji (邀請 💌, 好孕島 💉), or at the start of a one-line card (家族週報)', placed.title && !placed.lead && placed.weekly && placed.island, JSON.stringify(placed));
  await shot(H, 'home-cards');
  await axe(H, '首頁 with the card drawings');
  sz = await sizes(H);
  ok('首頁: text only in the scale sizes', !offScale(sz).length, JSON.stringify(sz));
  // pregnant, after a visit to the islands: 孕產路線圖, 常見好物, and the new island
  await S(H, () => { App.store.update((x) => { x.profile.stage = 'preg'; x.profile.lmp = Core.dateKey(Core.addDays(new Date(), -150)); x.island = { ...(x.island || {}), seen: ['prep'] }; }); App.navigate('home'); App.refresh(); });
  await H.waitForTimeout(1500);
  hc = await homeCards(H);
  const pg = Object.fromEntries(hc.map(([k, n]) => [k, n]));
  ok('首頁 (懷孕): 孕產路線圖, 常見好物, a new island — each with its drawing; the week card keeps its fruit', pg.journey === 'journey' && pg.goods === 'goods' && pg['island-new'] === 'island' && pg['preg-week'] === '' && hc.filter(([k]) => k !== 'preg-week').every(([, n, w]) => n && w === 256), JSON.stringify(hc));
  await H.context().close();
  // a new mom: 接下來 and 最新紀錄 with nothing in them yet show a drawing and one line
  const N = await mk();
  await N.click('.ob-choice:has-text("育兒中")'); await N.click('text=完成，開始使用'); await N.waitForTimeout(1300);
  const empty = await S(N, () => ({
    next: (document.querySelector('.next-card img.pic') || {}).src || '', nextText: (document.querySelector('.next-card p') || {}).textContent || '',
    rec: (document.querySelector('.home-empty img.pic') || {}).src || '', recText: (document.querySelector('.home-empty') || {}).textContent || '',
  }));
  ok('a new mom: 接下來 and 最新紀錄 with nothing yet — a drawing and one line each', /thumbs\/next\.webp$/.test(empty.next) && /thumbs\/records\.webp$/.test(empty.rec) && empty.nextText.length <= 40 && /今天還沒有紀錄/.test(empty.recText), JSON.stringify(empty));
  await S(N, () => { window.__noShareMoments = false; App.share.moment('pics-test', { emoji: '🎉', msg: '寶寶滿月了！', kind: 'baby-age', force: true }); });
  await N.waitForTimeout(700);
  ok('…and the 分享時刻 prompt opens with its drawing', await S(N, () => !!document.querySelector('.sheet .sh-moment img.pic[src$="moments.webp"]')));
  await N.context().close();

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  const pass = results.filter((r) => r.pass).length;
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ← ${r.info}`}`));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
