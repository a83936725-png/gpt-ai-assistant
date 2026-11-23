// 擠奶奶量 (js/modules/babylog.js, home.js): the 擠奶 tile's ＋ opens 記奶量 (the timer is a button inside) and the tile says
// how much today; the form takes each side or just the total, a usual amount in one tap or typed, starts from the last
// session's amounts, shows the total, the last time and the day so far; saving says the amount (and 母乳庫存), with 復原.
// 紀錄 shows the day's 擠奶 line (each side), a 擠奶 filter and the last 7 days as bars. The timer path and the home-screen
// shortcut still time a session. Small phone, dark and accessibility checked.
// Usage: cd mom-app && python3 -m http.server 8080   then   BASE=http://localhost:8080/ node tests/pump.playwright.cjs
//        AXE_PATH=<axe.min.js> for the accessibility checks
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
    await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.babylog);
    await p.click('text=先看看範例資料'); await p.waitForTimeout(900);
    await p.evaluate(() => { App.isNight = () => false; App.applyTheme(); App.store.update((s) => { s.settings.a2hsDismissed = '1'; }); });
    await p.waitForTimeout(400);
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, screen, ms = 800) => { await S(p, (x) => App.navigate(x), screen); await p.waitForTimeout(ms); };
  const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: `${SHOT}${name}.png` }); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const tile = (p) => S(p, () => { const t = document.querySelector('.quick-tile[data-type="pump"]'); return { sub: t.querySelector('.qt-sub').innerText.trim(), plus: t.querySelector('.qt-plus').innerText.replace(/\s+/g, ''), label: t.querySelector('.qt-plus').getAttribute('aria-label'), badge: (t.querySelector('.qt-badge') || {}).textContent || '' }; });
  const form = (p) => S(p, () => {
    const sh = document.querySelector('.sheet'); const ins = [...sh.querySelectorAll('.pump-sides .stepper-input')].map((i) => i.value);
    return {
      timer: !!sh.querySelector('.pump-timer'), mode: (sh.querySelector('.seg button.active, .seg button[aria-pressed="true"], .seg button[aria-checked="true"]') || {}).textContent,
      sides: !sh.querySelector('.pump-sides').hidden, totalBox: !sh.querySelector('.pump-totalbox').hidden, left: ins[0], right: ins[1], total: sh.querySelector('.pump-totalbox .stepper-input').value,
      on: [...sh.querySelectorAll('.pump-chips .chip.active')].map((c) => c.getAttribute('aria-label')), line: sh.querySelector('.pump-total').innerText.replace(/\s+/g, ''),
    };
  });
  const toast = (p) => S(p, () => (document.querySelector('.toast-wrap') || {}).innerText || '').then((t) => t.replace(/\s+/g, ''));
  const saveBtn = '.sheet button:has-text("儲存")';

  /* ---------- 首頁: the 擠奶 tile ---------- */
  const P = await mk();
  let t = await tile(P);
  ok('首頁 擠奶: the tile says how much today (110 ml), its ＋ says 奶量 (記奶量)', t.sub === '今天 110 ml' && t.plus === '＋奶量' && t.label === '擠奶：記奶量', JSON.stringify(t));
  await shot(P, 'home');

  /* ---------- 記奶量 ---------- */
  await P.click('.quick-tile[data-type="pump"] .qt-plus'); await P.waitForTimeout(600);
  let f = await form(P);
  ok('＋奶量 opens the form: 開始擠奶（計時） at the top, then 左右分開 with the last session\'s 60 / 50 (their chips lit)', f.timer && f.sides && !f.totalBox && f.left === '60' && f.right === '50' && f.on.join() === '左側 60 ml,右側 50 ml', JSON.stringify(f));
  ok('…the total, the last time and the day so far: 合計 110・上次 110・今天累計 220（2 次）', f.line === '合計110ml・上次110ml・今天累計220ml（2次）', f.line);
  await P.click('.sheet [aria-label="左側 80 ml"]'); await P.click('.sheet [aria-label="右側 60 ml"]'); await P.waitForTimeout(150);
  f = await form(P);
  ok('one tap per side: 80 + 60 → 合計 140', f.left === '80' && f.right === '60' && /^合計140ml/.test(f.line) && f.on.join() === '左側 80 ml,右側 60 ml', JSON.stringify(f));
  await P.fill('.sheet .pump-sides .stepper-input >> nth=0', '85'); await P.waitForTimeout(150);
  f = await form(P);
  ok('…or type it: 85 + 60 → 合計 145 (no chip lit for 85)', /^合計145ml/.test(f.line) && f.on.join() === '右側 60 ml', JSON.stringify(f));
  await shot(P, 'form');
  await axe(P, '記奶量 form');
  await P.click('.sheet .seg button:has-text("只記總量")'); await P.waitForTimeout(150);
  f = await form(P);
  ok('只記總量: one amount, carried over (145)', !f.sides && f.totalBox && f.total === '145' && /^合計145ml/.test(f.line), JSON.stringify(f));
  await P.click('.sheet [aria-label="總量 120 ml"]'); await P.waitForTimeout(150);
  const milk0 = await S(P, () => App.milk.available());
  await P.click(saveBtn); await P.waitForTimeout(700);
  ok('save: 「已記錄擠奶・120 ml・已入庫」 with 復原', /^已記錄擠奶・120ml・已入庫復原$/.test(await toast(P)), await toast(P));
  t = await tile(P);
  const milk1 = await S(P, () => App.milk.available());
  ok('…the tile now says 今天 230 ml (2 today), and 母乳庫存 has 120 ml more', t.sub === '今天 230 ml' && t.badge === '2' && milk1 - milk0 === 120, JSON.stringify({ ...t, added: milk1 - milk0 }));
  await P.click('.toast-wrap button:has-text("復原")'); await P.waitForTimeout(500);
  t = await tile(P);
  ok('復原: the record and the 母乳庫存 bag are gone again (今天 110 ml)', t.sub === '今天 110 ml' && (await S(P, () => App.milk.available())) === milk0, JSON.stringify(t));

  await P.click('.quick-tile[data-type="pump"] .qt-plus'); await P.waitForTimeout(600);
  f = await form(P);
  ok('next time it starts from the last saved session (60 / 50 again after 復原)', f.left === '60' && f.right === '50', JSON.stringify(f));
  await P.click('.sheet [aria-label="左側 80 ml"]'); await P.click('.sheet [aria-label="右側 60 ml"]');
  await P.click(saveBtn); await P.waitForTimeout(700);
  ok('save each side: 「已記錄擠奶・140 ml（左 80／右 60）・已入庫」', /^已記錄擠奶・140ml（左80／右60）・已入庫復原$/.test(await toast(P)), await toast(P));

  /* ---------- 紀錄 ---------- */
  await go(P, 'log', 900);
  const line = (await S(P, () => (document.querySelector('.pump-day') || {}).innerText || '')).replace(/\s+/g, '');
  ok('紀錄: the day\'s 擠奶 line — 2 次・250 ml（左 140／右 110）', line === '擠奶2次・250ml（左140／右110）›', line);
  await P.click('.timeline .tl-item:has-text("擠奶") >> nth=0'); await P.waitForTimeout(600);
  f = await form(P);
  ok('edit a saved session: its own 80 / 60, no timer button', !f.timer && f.left === '80' && f.right === '60', JSON.stringify(f));
  await P.click('.sheet [aria-label="右側 100 ml"]'); await P.click(saveBtn); await P.waitForTimeout(600);
  ok('…change the right side to 100: saved (180 ml)', /180 ml（左 80／右 100）/.test(await S(P, () => App.logSummary(App.store.lastLog('pump')))));
  await P.click('.pump-day'); await P.waitForTimeout(700);
  const week = await S(P, () => {
    const w = document.querySelector('.pump-week'); const cols = [...w.querySelectorAll('.pw-col')];
    return { filter: (document.querySelector('.seg button.active, .seg button[aria-checked="true"]') || {}).textContent, n: cols.length, today: cols[6].classList.contains('on') && cols[6].querySelector('.pw-ml').textContent, text: w.innerText.replace(/\s+/g, ''), rows: document.querySelectorAll('.timeline .tl-item').length };
  });
  ok('tap the line → the 擠奶 filter: 近 7 天擠奶量, today\'s bar (290) highlighted, only 擠奶 rows', week.n === 7 && week.today === '290' && /近7天擠奶量平均\d+ml／天/.test(week.text) && week.rows === 2, JSON.stringify(week));
  await P.evaluate(() => document.querySelector('.pump-week').scrollIntoView({ block: 'center' })); await P.waitForTimeout(200);
  await shot(P, 'log-week');
  await axe(P, '紀錄 with the 擠奶 filter and the 7 days');

  /* ---------- the timer is still there ---------- */
  await go(P, 'home', 600);
  await P.click('.quick-tile[data-type="pump"] .qt-plus'); await P.waitForTimeout(600);
  await P.click('.sheet .pump-timer'); await P.waitForTimeout(600);
  t = await tile(P);
  ok('開始擠奶（計時）: the timer runs, the tile\'s ＋ says 完成', (await S(P, () => !!App.timers.get('pump'))) && t.plus === '✓完成' && /開始擠奶計時/.test(await toast(P)), JSON.stringify(t));
  await P.clock.runFor(12 * 60 * 1000);
  await P.click('.quick-tile[data-type="pump"] .qt-plus'); await P.waitForTimeout(700);
  f = await form(P);
  const dur = await S(P, () => [...document.querySelectorAll('.sheet .stepper-input')].pop().value);
  ok('…完成 after 12 minutes: 記奶量 with 時長 12 分 and the last amounts, no timer button', !f.timer && dur === '12' && f.left === '80' && f.right === '100', JSON.stringify({ ...f, dur }));
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  await S(P, () => { App.timers.cancel('pump'); App.babylog.handleAction('pump'); });
  ok('the home-screen shortcut 擠奶 still starts the timer', await S(P, () => !!App.timers.get('pump')));
  await S(P, () => App.timers.cancel('pump'));

  /* ---------- another day ---------- */
  await P.click('.quick-tile[data-type="pump"] .qt-plus'); await P.waitForTimeout(600);
  await P.fill('.sheet input[type="datetime-local"]', '2026-11-21T20:00'); await P.dispatchEvent('.sheet input[type="datetime-local"]', 'change'); await P.waitForTimeout(150);
  f = await form(P);
  ok('a session on another day counts toward that day (這天累計)', /這天累計\d+ml（\d+次）/.test(f.line), f.line);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);

  /* ---------- small phone, dark ---------- */
  const small = await mk({ width: 320, height: 640, scheme: 'dark' });
  await small.click('.quick-tile[data-type="pump"] .qt-plus'); await small.waitForTimeout(600);
  const fit = await S(small, () => { const sh = document.querySelector('.sheet'); return { sw: sh.scrollWidth <= sh.clientWidth + 1, rows: [...sh.querySelectorAll('.pump-chips')].map((r) => Math.round(r.getBoundingClientRect().height)) }; });
  ok('320 px: the form fits (no sideways scroll), each side\'s chips in one or two rows', fit.sw && fit.rows.every((hgt) => hgt <= 100), JSON.stringify(fit));
  await shot(small, 'form-320-dark');
  await axe(small, '記奶量 at 320 px, dark');
  await small.keyboard.press('Escape'); await small.waitForTimeout(300);
  await go(small, 'log', 900);
  await small.click('.pump-day'); await small.waitForTimeout(600);
  ok('320 px: the 7 days fit', await S(small, () => document.documentElement.scrollWidth <= 320 && document.querySelector('.pump-week').getBoundingClientRect().right <= 320));

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  for (const c of ctxs) await c.close().catch(() => {});
  await b.close();
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
