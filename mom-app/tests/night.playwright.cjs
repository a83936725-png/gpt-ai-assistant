// 夜奶陪伴 (js/modules/night.js): at 3 a.m. starting a feed opens a very dark, warm screen with a big timer, 左／右,
// 餵完了, the time and gentle words; the real number of other moms awake (from the member server, never made up; no
// number at all where there is no server); a wave to a mom on the island (or an invitation to join); the screen kept on
// while it is open. It does not open in the daytime or when she turned it off; the night timer banner offers it.
// Finishing saves the feed (with 復原). Escape / ✕ close it. Small phone and accessibility.
// Usage: BASE=http://localhost:8731/ AXE_PATH=<axe.min.js> node tests/night.playwright.cjs
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8731/';
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const NIGHT = '2026-11-23T03:12:00+08:00';
const DAY = '2026-11-23T14:12:00+08:00';

(async () => {
  const b = await chromium.launch();
  const mk = async ({ at = NIGHT, width = 390, height = 844, stats = null } = {}) => {
    const c = await b.newContext({ viewport: { width, height }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
    await c.clock.install({ time: new Date(at) });
    await c.addInitScript(() => {
      window.__noShareMoments = true; window.open = () => null;
      window.__locks = { asked: 0, released: 0 };
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: { request: async () => { window.__locks.asked += 1; const l = new EventTarget(); l.release = async () => { window.__locks.released += 1; }; return l; } },
      });
    });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    if (stats) {
      // a stand-in member server: only what the night screen asks for
      await p.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname.replace(/^.*\/api\//, '');
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (path === 'config') return json({ providers: { password: true }, policy: '2026-01-01', verify: {}, push: null, social: true });
        if (path === 'stats') return json(stats);
        return json({ ok: true });
      });
    }
    await p.goto(BASE);
    await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.night);
    await p.click('text=先看看範例資料'); await p.waitForTimeout(900);
    await p.evaluate(() => { App.store.update((s) => { s.settings.a2hsDismissed = '1'; }); });
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
  const night = (p) => S(p, () => { const r = document.querySelector('.nt'); return r ? { text: r.innerText.replace(/\s+/g, ' ').trim(), on: [...r.querySelectorAll('.nt-side')].map((x) => `${x.innerText}:${x.getAttribute('aria-pressed')}`).join(','), awake: (r.querySelector('.nt-awake') || {}).hidden === false ? r.querySelector('.nt-awake').innerText : '' } : null; });

  /* ---------- 1. 3 a.m., with the member server: 24 moms online (her included) ---------- */
  const P = await mk({ stats: { online: 24, registered: 900, todaySignups: 3, storage: 'memory' } });
  ok('03:12 counts as 深夜', await S(P, () => App.night.isNow()));
  await S(P, () => App.timers.start('breast', { side: 'L' })); await P.waitForTimeout(1200);
  let n = await night(P);
  ok('starting a feed at night opens 夜奶陪伴 by itself', !!n && /凌晨 03:12/.test(n.text) && /親餵中・左邊/.test(n.text), JSON.stringify(n));
  ok('a big timer, 左 (on) / 右, and 餵完了', /左:true,右:false/.test(n.on) && /餵完了/.test(n.text) && await S(P, () => /^\d\d:\d\d$/.test(document.querySelector('.nt-clock').textContent)), n.on);
  ok('the real number of other moms awake (24 online, her included → 23)', n.awake === '現在還有 23 位媽媽也醒著', n.awake);
  ok('gentle words, nothing medical', WORDS_OK(n.text), n.text);
  ok('no stray "null" / "undefined" text', !/\b(null|undefined)\b/.test(n.text), n.text);
  ok('the screen is kept on while it is open', await S(P, () => window.__locks.asked) === 1);
  await shot(P, 'night-feed');
  await axe(P, 'night companion');
  await P.clock.runFor(65000); await P.waitForTimeout(300);
  ok('the timer runs (over a minute now)', await S(P, () => document.querySelector('.nt-clock').textContent >= '01:00'), await S(P, () => document.querySelector('.nt-clock').textContent));
  await P.click('.nt-side:has-text("右")'); await P.waitForTimeout(400);
  n = await night(P);
  ok('右: the side switches (and the timer keeps going)', /左:false,右:true/.test(n.on) && await S(P, () => Object.values(App.store.state.active).some((a) => a && a.side === 'R')), n.on);
  // waving: not on the island yet → an invitation; on it → a wave to someone there
  ok('not on 島上的媽媽: an invitation to join, to wave to awake moms', /加入島上的媽媽，和醒著的媽媽互相揮手/.test(n.text));
  await S(P, () => { window.__waved = null; App.social.isReady = () => true; App.social.soc = () => ({ on: true, key: 'k' }); App.social.poll = async () => {}; App.social.people = () => [{ nid: 'n-afang', name: '阿芳' }]; App.social.react = async (nid, kind) => { window.__waved = `${nid}:${kind}`; }; App.night.open(); });
  await P.waitForTimeout(400);
  await P.click('.nt-wave'); await P.waitForTimeout(400);
  ok('on the island: 👋 waves to a mom who is there', await S(P, () => window.__waved) === 'n-afang:wave');
  // finishing
  const before = await S(P, () => App.store.state.logs.filter((l) => l.type === 'breast').length);
  await P.click('.nt-done'); await P.waitForTimeout(500);
  const after = await S(P, () => ({ n: App.store.state.logs.filter((l) => l.type === 'breast').length, running: Object.keys(App.store.state.active || {}).some((k) => k.startsWith('feed')), open: !!document.querySelector('.nt'), toast: (document.querySelector('.toast-wrap') || {}).innerText || '' }));
  ok('餵完了: the feed is saved (with 復原), the timer stops, the screen closes', after.n === before + 1 && !after.running && !after.open && /復原/.test(after.toast), JSON.stringify(after));
  ok('…and the screen is no longer kept on', await S(P, () => window.__locks.released) >= 1);

  /* ---------- 2. opening it by hand; the banner; Escape; the setting ---------- */
  await S(P, () => App.timers.start('breast', { side: 'L' })); await P.waitForTimeout(800);
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  ok('Escape closes it (the feed keeps running)', !(await P.$('.nt')) && await S(P, () => Object.keys(App.store.state.active || {}).some((k) => k.startsWith('feed'))));
  await S(P, () => { App.navigate('home'); App.refresh(); }); await P.waitForTimeout(800);
  ok('at night the running-feed banner offers 「🌙 夜奶陪伴」', !!(await P.$('.nt-open-btn')));
  await P.click('.nt-open-btn'); await P.waitForTimeout(500);
  ok('…which opens it again', !!(await P.$('.nt')));
  await P.click('.nt-x'); await P.waitForTimeout(400);
  ok('✕ closes it', !(await P.$('.nt')));
  await S(P, () => App.timers.cancel('breast'));
  await S(P, () => App.night.open()); await P.waitForTimeout(500);
  n = await night(P);
  ok('opened with no feed running: the last feed, 左邊開始／右邊開始 and 記一筆瓶餵', /上一餐/.test(n.text) && /左邊開始/.test(n.text) && /右邊開始/.test(n.text) && /記一筆瓶餵/.test(n.text) && !/\bnull\b/.test(n.text), n.text);
  await P.click('.nt-side:has-text("右邊開始")'); await P.waitForTimeout(500);
  ok('右邊開始 starts the feed on the right, right there', /右:true/.test((await night(P)).on));
  await P.click('.nt-auto'); await P.waitForTimeout(200);
  ok('「深夜開始餵奶時自動打開」 can be turned off', await S(P, () => App.store.state.settings.nightCompanion === false));
  await S(P, () => { App.timers.stopWithUndo('breast'); App.night.close(); }); await P.waitForTimeout(400);
  await S(P, () => App.timers.start('breast', { side: 'L' })); await P.waitForTimeout(800);
  ok('turned off: a night feed no longer opens it', !(await P.$('.nt')));
  await S(P, () => { App.timers.cancel('breast'); App.store.update((s) => { s.settings.nightCompanion = true; }); });

  /* ---------- 3. daytime; no member server; a small phone ---------- */
  const D = await mk({ at: DAY });
  ok('14:12 is not 深夜', !(await S(D, () => App.night.isNow())));
  await S(D, () => App.timers.start('breast', { side: 'L' })); await D.waitForTimeout(900);
  ok('a daytime feed does not open it', !(await D.$('.nt')));
  await S(D, () => { App.navigate('home'); App.refresh(); }); await D.waitForTimeout(700);
  ok('…and the banner has no 夜奶陪伴 button in the daytime', !(await D.$('.nt-open-btn')));
  const W = await mk({ width: 320, height: 568 }); // the static copy: no member server
  await S(W, () => App.timers.start('breast', { side: 'L' })); await W.waitForTimeout(1500);
  n = await night(W);
  ok('no member server: no number of moms at all (never a made-up one)', !!n && !n.awake && !/位媽媽也醒著/.test(n.text), JSON.stringify(n));
  ok('…and no stray "null" where the wave button would be', !/\b(null|undefined)\b/.test(n.text), n.text);
  ok('320 px: everything fits, the big buttons too', await S(W, () => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.nt-side, .nt-done')].every((x) => x.getBoundingClientRect().right <= innerWidth && x.getBoundingClientRect().height >= 56)));
  await shot(W, 'night-small');
  await axe(W, 'night companion, small phone');
  ok('sw.js caches it', await S(W, async () => { const t = await (await fetch('sw.js')).text(); return t.includes("'js/modules/night.js'") && t.includes("'css/night.css'"); }));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  const pass = results.filter((x) => x.pass).length;
  results.forEach((x) => console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${x.pass ? '' : `  ← ${x.info}`}`));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

function WORDS_OK(text) { return /(慢慢來|休息一下|喝口水|擁抱|深呼吸|很努力)/.test(text) && !/(治療|改善|療效|預防)/.test(text); }
