// 白天黑夜跟著太陽 (Core.sunTimes / Core.dayPhase, App.applyTheme): the screen turns dark at the real sunset of the
// season and light at sunrise (北部 by default, a place picker in 我的), the bigger night buttons wait for 深夜
// (22:00 until just before sunrise), the 首頁 greeting and the next sunrise / sunset follow the sun, 小滴 gets sleepy
// late at night, 好孕島 has its night and a warm 清晨／黃昏 light, a phone not on Taiwan time uses the fixed clock.
// Usage: cd mom-app && python3 -m http.server 8080   then   BASE=http://localhost:8080/ node tests/daynight.playwright.cjs
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
  const pages = [];
  // a page whose clock starts at `time` (Taiwan time unless the zone says otherwise) and keeps running
  const mk = async ({ time, zone = 'Asia/Taipei', width = 390, scheme = 'light', place = null, nightMode = true, theme = 'auto', stage = 'baby' } = {}) => {
    const c = await b.newContext({ viewport: { width, height: 844 }, locale: 'zh-TW', timezoneId: zone, colorScheme: scheme });
    await c.clock.install({ time: new Date(time) });
    await c.addInitScript(() => { window.__noShareMoments = true; window.open = () => null; });
    const p = await c.newPage();
    pages.push(c);
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE);
    await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.screens && App.screens.home);
    await p.evaluate((o) => {
      const s = App.store.defaults(); s.onboarded = true; s.onboardedAt = '2026-01-01'; s.profile.stage = o.stage; s.profile.momName = '小美';
      s.settings.a2hsDismissed = '1'; s.settings.sunPlace = o.place; s.settings.nightMode = o.nightMode; s.settings.theme = o.theme;
      s.babies = [{ id: 'b1', name: '小湯圓', sex: 'girl', birthday: Core.dateKey(Core.addDays(new Date(), -60)), avatar: '👶' }];
      s.activeBabyId = 'b1'; s.starter = { demo: true };
      App.store.replace(s); App.applyTheme(); App.navigate('home');
    }, { place, nightMode, theme, stage });
    await p.waitForTimeout(500);
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, screen, ms = 700) => { await S(p, (x) => App.navigate(x, { n: Math.random().toString(36).slice(2, 7) }), screen); await p.waitForTimeout(ms); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  // what the screen shows right now
  const look = (p) => S(p, () => {
    const plus = document.querySelector('.qt-plus');
    return {
      night: document.body.classList.contains('night'),
      late: document.body.classList.contains('late'),
      phase: document.body.dataset.phase,
      theme: document.documentElement.getAttribute('data-theme'),
      greet: (document.querySelector('.greet-hi') || {}).textContent || '',
      // the next sunrise or sunset as the app works it out (首頁 no longer shows it under the date: 0.9.2 moved it to 我的)
      sun: (() => { if (!App.sun || App.sunPlace() === 'clock') return ''; const now = new Date(); const s = App.sun(now); const t = Core.fmtTime; return now < s.sunrise ? `🌅 日出 ${t(s.sunrise)}` : now < s.sunset ? `🌇 日落 ${t(s.sunset)}` : `🌅 明早日出 ${t(App.sun(Core.addDays(now, 1)).sunrise)}`; })(),
      homeSun: !!document.querySelector('.greet-sun'),
      sleepy: !!document.querySelector('.greet-hi .md[data-mood="sleepy"]'),
      plus: plus ? Math.round(plus.getBoundingClientRect().height) : 0, // the ＋ under a tile: 44px, 52px late at night
    };
  });
  const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: `${SHOT}${name}.png` }); };

  /* ---------- summer: 18:30 is still light, dark after the 18:47 sunset ---------- */
  let p = await mk({ time: '2026-06-21T18:30:00+08:00' });
  let v = await look(p);
  ok('夏至 18:30 (北部日落 18:47): still light, 黃昏, greeting 傍晚好', !v.night && v.phase === 'dusk' && !v.theme && v.greet.startsWith('傍晚好'), JSON.stringify(v));
  ok('…the sun sets at 18:4x (首頁 does not print it under the date any more)', /^🌇 日落 18:4\d$/.test(v.sun) && !v.homeSun, JSON.stringify(v));
  await shot(p, 'summer-1830');
  // the theme follows by itself: run the clock past sunset, the minute check turns the screen dark
  await p.clock.runFor(20 * 60 * 1000);
  v = await look(p);
  ok('…20 minutes later (18:50) the screen turned dark by itself, without a tap', v.night && v.theme === 'dark' && !v.late, JSON.stringify(v));
  await go(p, 'home');
  v = await look(p);
  ok('…just after sunset it is still 傍晚好 (the sky glows until about 25 minutes after), usual 44px buttons', v.greet.startsWith('傍晚好') && v.plus === 44, JSON.stringify(v));
  ok('…and the next sunrise is tomorrow morning: 🌅 明早日出 05:0x', /^🌅 明早日出 05:0\d$/.test(v.sun), v.sun);
  await p.clock.runFor(30 * 60 * 1000);
  v = await look(p);
  ok('…19:20, still on 首頁 without a tap: the greeting turned to 晚安 by itself; dark, usual-size buttons', v.greet.startsWith('晚安') && v.night && !v.late && v.phase === 'evening' && v.plus === 44, JSON.stringify(v));
  await shot(p, 'summer-1920');
  await axe(p, '首頁 in the evening (dark)');

  // back from a locked phone: the light is right at once (the minute check has not run yet)
  const wake = await mk({ time: '2026-12-21T16:00:00+08:00' });
  await wake.clock.pauseAt(new Date('2026-12-21T16:00:30+08:00'));
  await wake.clock.setFixedTime(new Date('2026-12-21T17:40:00+08:00'));
  const before = await look(wake);
  await S(wake, () => document.dispatchEvent(new Event('visibilitychange')));
  v = await look(wake);
  ok('back on the screen at 17:40 after 16:00: dark at once (not up to a minute later), greeting 晚安', !before.night && v.night && v.theme === 'dark' && v.greet.startsWith('晚安'), JSON.stringify({ before: before.night, ...v }));

  /* ---------- winter: dark at 17:09 in 北部, the south still light at 17:15 ---------- */
  p = await mk({ time: '2026-12-21T17:15:00+08:00' });
  v = await look(p);
  ok('冬至 17:15 北部 (日落 17:09): already dark, still 傍晚好', v.night && v.theme === 'dark' && !v.late && v.phase === 'dusk' && v.greet.startsWith('傍晚好'), JSON.stringify(v));
  const south = await mk({ time: '2026-12-21T17:15:00+08:00', place: 'south' });
  v = await look(south);
  ok('…the same minute in 南部 (高雄, the sun sets about 10 minutes later): still light', !v.night && /^🌇 日落 17:(1[6-9]|2\d)$/.test(v.sun), JSON.stringify(v));
  const times = await S(p, () => Object.keys(Core.SUN_PLACES).filter((k) => k !== 'clock').map((k) => [k, Core.fmtTime(Core.sunTimes(new Date(), k).sunset)]));
  ok('…every place has its own sunset (金門 the latest in winter, 花蓮 before 臺中)', new Set(times.map((x) => x[1])).size >= 5
    && times.find((x) => x[0] === 'kinmen')[1] === times.map((x) => x[1]).sort().pop() && times.find((x) => x[0] === 'east')[1] < times.find((x) => x[0] === 'central')[1], JSON.stringify(times));

  /* ---------- 深夜 and before dawn ---------- */
  p = await mk({ time: '2026-11-21T23:30:00+08:00' });
  v = await look(p);
  ok('23:30: dark, 深夜 → the bigger buttons (＋ 52px), 夜深了，辛苦了, sleepy 小滴', v.night && v.late && v.phase === 'late' && v.plus === 52 && v.greet.startsWith('夜深了，辛苦了') && v.sleepy, JSON.stringify(v));
  await shot(p, 'late-2330');
  await axe(p, '首頁 late at night');
  p = await mk({ time: '2026-12-21T05:30:00+08:00' });
  v = await look(p);
  ok('冬至 05:30 (日出 06:34): still 深夜 — 天還沒亮，辛苦了, big buttons, sunrise shown', v.late && v.plus === 52 && v.greet.startsWith('天還沒亮，辛苦了') && /^🌅 日出 06:3\d$/.test(v.sun), JSON.stringify(v));
  p = await mk({ time: '2026-12-21T06:20:00+08:00' });
  v = await look(p);
  ok('冬至 06:20: still dark but no longer 深夜 (清晨, usual buttons), 天快亮了', v.night && !v.late && v.phase === 'dawn' && v.plus === 44 && v.greet.startsWith('天快亮了') && !v.sleepy, JSON.stringify(v));
  const summerMorning = await mk({ time: '2026-06-21T06:20:00+08:00' });
  v = await look(summerMorning);
  ok('…the same 06:20 in summer is broad daylight: 早安, light screen', !v.night && v.phase === 'day' && v.greet.startsWith('早安'), JSON.stringify(v));
  p = await mk({ time: '2026-12-21T21:00:00+08:00' });
  v = await look(p);
  ok('21:00: dark evening, 小滴 not sleepy yet (💜), 晚安', v.night && !v.late && !v.sleepy && v.greet.startsWith('晚安'), JSON.stringify(v));
  p = await mk({ time: '2026-12-21T13:00:00+08:00' });
  v = await look(p);
  ok('13:00: 午安, light, sunset coming at 17:0x', !v.night && v.greet.startsWith('午安') && /^🌇 日落 17:0\d$/.test(v.sun), JSON.stringify(v));

  /* ---------- 夜間模式 off, and 淺色 chosen by hand ---------- */
  p = await mk({ time: '2026-12-21T23:30:00+08:00', nightMode: false });
  v = await look(p);
  ok('夜間模式 off: never dark, no bigger buttons, even at 23:30', !v.night && !v.late && !v.theme && v.plus === 44, JSON.stringify(v));
  p = await mk({ time: '2026-12-21T19:00:00+08:00', theme: 'light' });
  v = await look(p);
  ok('外觀「淺色」chosen by hand: stays light after sunset', v.night && v.theme === 'light', JSON.stringify(v));

  /* ---------- 我的 → 白天黑夜跟著 ---------- */
  p = await mk({ time: '2026-12-21T17:15:00+08:00' });
  await go(p, 'me');
  let me = await S(p, () => {
    const sel = document.querySelector('select.sun-place'); const row = sel && sel.closest('.list-item');
    const night = [...document.querySelectorAll('.list-item')].find((x) => /夜間模式/.test(x.textContent));
    return { val: sel && sel.value, opts: sel ? [...sel.options].map((o) => o.textContent) : [], sub: row && row.querySelector('.li-sub').textContent, night: night && night.querySelector('.li-sub').textContent, label: sel && sel.getAttribute('aria-label'), w: sel && Math.round(sel.getBoundingClientRect().width), rowW: row && Math.round(row.getBoundingClientRect().right) };
  });
  ok('我的: 「白天黑夜跟著」 picker, 北部 by default, 7 places + 固定時鐘', me.val === 'north' && me.opts.length === 8 && me.opts[0] === '北部（臺北）' && me.opts[7] === '固定時鐘' && !!me.label, JSON.stringify(me));
  ok('…it says today\'s sunrise and sunset there; 夜間模式 says it follows the sun', /今天日出 06:\d\d・日落 17:\d\d/.test(me.sub) && /日落後自動變暗/.test(me.night) && !/22:00/.test(me.night), JSON.stringify(me));
  ok('…the picker fits in the row on a phone', me.w > 80 && me.rowW <= 390, JSON.stringify(me));
  await p.selectOption('select.sun-place', 'south'); await p.waitForTimeout(300);
  me = await S(p, () => ({ saved: App.store.state.settings.sunPlace, sub: document.querySelector('select.sun-place').closest('.list-item').querySelector('.li-sub').textContent, night: document.body.classList.contains('night') }));
  ok('…choose 南部: saved, the times change, and at 17:15 the screen turns light again at once', me.saved === 'south' && /日落 17:(1[6-9]|2\d)/.test(me.sub) && !me.night, JSON.stringify(me));
  await p.$eval('select.sun-place', (e) => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
  await shot(p, 'me-sunplace');
  await axe(p, '我的 with the place picker');
  await p.selectOption('select.sun-place', 'clock'); await p.waitForTimeout(300);
  me = await S(p, () => ({ sub: document.querySelector('select.sun-place').closest('.list-item').querySelector('.li-sub').textContent, night: [...document.querySelectorAll('.list-item')].find((x) => /夜間模式/.test(x.textContent)).querySelector('.li-sub').textContent }));
  ok('…choose 固定時鐘: 6 點天亮・18 點天黑, whatever the season', /固定 6 點天亮・18 點天黑/.test(me.sub) && /18 點後自動變暗/.test(me.night), JSON.stringify(me));
  await go(p, 'home');
  v = await look(p);
  ok('…with the fixed clock, 首頁 has no sunrise / sunset line and 17:15 is light', !v.sun && !v.night, JSON.stringify(v));
  ok('…the choice is kept after reopening the app', await (async () => { await p.reload(); await p.waitForFunction(() => window.App && App.store && !App.store.loading); return S(p, () => App.store.state.settings.sunPlace === 'clock' && App.sunPlace() === 'clock'); })());

  /* ---------- a phone that is not on Taiwan time ---------- */
  p = await mk({ time: '2026-12-21T19:00:00-08:00', zone: 'America/Los_Angeles' });
  v = await look(p);
  const abroad = await S(p, () => ({ place: App.sunPlace(), tw: App.inTaiwanTime() }));
  ok('phone in another time zone (no place chosen): the fixed clock — 19:00 there is dark, no Taiwan sunset shown', abroad.place === 'clock' && !abroad.tw && v.night && !v.sun, JSON.stringify({ ...abroad, ...v }));
  await go(p, 'me');
  ok('…and 我的 says why', /手機不在台灣時區/.test(await S(p, () => document.querySelector('select.sun-place').closest('.list-item').textContent)));

  /* ---------- 好孕島: night, and the warm 黃昏 / 清晨 light ---------- */
  const isl = async (time) => {
    const q = await mk({ time, stage: 'preg' });
    await S(q, () => { App.store.update((s) => { s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -150)); s.profile.edd = Core.eddFromLmp(s.profile.lmp); }); });
    await go(q, 'island', 1200);
    return { q, st: await S(q, () => { const r = document.querySelector('.isl'); const btn = [...document.querySelectorAll('.isl-cbtn')].map((x) => x.textContent.trim()); return { night: r.classList.contains('night'), dusk: r.classList.contains('dusk'), dawn: r.classList.contains('dawn'), btn, sea: getComputedStyle(document.querySelector('.isl-sea')).fill }; }) };
  };
  let r = await isl('2026-06-21T18:30:00+08:00');
  ok('好孕島 at 夏至 18:30: day, the sea takes the 黃昏 sky\'s colours, the button says 黃昏', !r.st.night && r.st.dusk && r.st.btn.includes('黃昏') && /isl-sea-dusk"/.test(r.st.sea), JSON.stringify(r.st));
  if (SHOT) await r.q.screenshot({ path: `${SHOT}island-dusk.png` });
  await r.q.click('.isl-cbtn:has-text("黃昏")'); await r.q.waitForTimeout(300);
  const after = await S(r.q, () => { const x = document.querySelector('.isl'); return { night: x.classList.contains('night'), dusk: x.classList.contains('dusk'), btn: [...document.querySelectorAll('.isl-cbtn')].map((y) => y.textContent.trim()), sea: getComputedStyle(document.querySelector('.isl-sea')).fill }; });
  ok('…tap it: night, the sunset colours go, the button says 夜晚', after.night && !after.dusk && after.btn.includes('夜晚') && !/url/.test(after.sea), JSON.stringify(after));
  await go(r.q, 'home', 300); await go(r.q, 'island', 900);
  ok('…the choice stays when coming back to the island', await S(r.q, () => { const x = document.querySelector('.isl'); return x.classList.contains('night') && !x.classList.contains('dusk'); }));
  r = await isl('2026-12-21T19:30:00+08:00');
  ok('好孕島 at 冬至 19:30: night, the plain night sea, stars out', r.st.night && !r.st.dusk && !r.st.dawn && r.st.btn.includes('夜晚') && !/url/.test(r.st.sea), JSON.stringify(r.st));
  r = await isl('2026-12-21T06:40:00+08:00');
  ok('好孕島 at 冬至 06:40 (just after sunrise): day with the 清晨 sea', !r.st.night && r.st.dawn && r.st.btn.includes('清晨') && /isl-sea-dawn"/.test(r.st.sea), JSON.stringify(r.st));
  if (SHOT) await r.q.screenshot({ path: `${SHOT}island-dawn.png` });
  r = await isl('2026-12-21T12:00:00+08:00');
  ok('好孕島 at noon: day, the plain sea', !r.st.night && !r.st.dusk && !r.st.dawn && r.st.btn.includes('白天') && !/url/.test(r.st.sea), JSON.stringify(r.st));

  /* ---------- a small phone ---------- */
  p = await mk({ time: '2026-12-21T13:00:00+08:00', width: 320 });
  const small = await S(p, () => {
    const g = document.querySelector('.greet'); const sn = document.querySelector('.greet-sun'); const d = document.querySelector('.greet-date');
    return { gw: Math.round(g.getBoundingClientRect().right), sw: document.documentElement.scrollWidth, snRight: sn && Math.round(sn.getBoundingClientRect().right), oneLine: sn && sn.getClientRects().length === 1, dateH: d && Math.round(d.getBoundingClientRect().height) };
  });
  ok('320px phone: the greeting row fits, and the date stays on one line (the sunset note moved to 我的 in 0.9.2)', small.gw <= 320 && small.sw <= 320 && !small.snRight && small.dateH > 0 && small.dateH < 26, JSON.stringify(small));
  await shot(p, 'small-320');

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  for (const c of pages) await c.close().catch(() => {});
  await b.close();
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
