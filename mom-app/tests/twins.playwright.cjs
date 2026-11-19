// 雙胞胎／多寶測試：計時跟著寶寶走（兩個一起睡、一起餵）、切換寶寶、紀錄與統計分開、刪除寶寶、舊資料的計時。
// Usage: cd mom-app && python3 -m http.server 8080   then   node tests/twins.playwright.cjs   [BASE=...]
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const results = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ locale: 'zh-TW', viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript(() => {
    window.__noShareMoments = true;
    document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast-wrap{display:none!important}'; document.head.append(st); });
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  const S = (f, a) => p.evaluate(f, a);
  const boot = async () => { await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.screens && App.screens.goods); await S(() => { App.isNight = () => false; }); };
  const home = async () => { await S(() => { location.hash = `#/home?${Math.random()}`; }); await p.waitForTimeout(300); };
  const pick = async (name) => { await p.tap('.hero-switch'); await p.waitForTimeout(350); await p.tap(`.sheet .list-item:has-text("${name}")`); await p.waitForTimeout(400); };
  const banner = () => S(() => [...document.querySelectorAll('.active-timer .bold')].map((e) => e.textContent));
  const tile = (label) => S((l) => { const t = [...document.querySelectorAll('.quick-tile')].find((x) => x.querySelector('.qt-label') && x.querySelector('.qt-label').textContent === l); return t ? t.innerText : ''; }, label);
  const plus = (label) => p.tap(`.quick-tile:has(.qt-label:text-is("${label}")) .qt-plus`);
  const waitTap = () => p.waitForTimeout(800); // quick taps on the same tile are guarded for 0.7 s

  await p.goto(BASE); await boot();
  await S(() => {
    App.demo.seed();
    App.store.update((s) => {
      s.babies[0].name = '大寶';
      s.babies.push({ ...s.babies[0], id: 'twin2', name: '小寶', sex: 'boy', avatar: '👦' });
      s.activeBabyId = s.babies[0].id;
    });
  });
  const A = await S(() => App.store.state.babies[0].id); const B = 'twin2';
  await home();

  /* ---------- switching ---------- */
  ok('with two babies 首頁 offers 切換', await p.isVisible('.hero-switch'));
  await pick('小寶');
  ok('切換 → 小寶: the home card now shows 小寶', /小寶/.test(await S(() => document.querySelector('.hero-name').textContent)));

  /* ---------- both asleep at once ---------- */
  await pick('大寶');
  await plus('睡眠'); await waitTap();
  await pick('小寶');
  ok('大寶 asleep, switched to 小寶: 大寶\'s timer still shows (with the name), 小寶\'s 睡眠 tile is not running', (await banner()).some((t) => /大寶・睡覺中/.test(t)) && !/計時中/.test(await tile('睡眠')), JSON.stringify(await banner()));
  await plus('睡眠'); await waitTap();
  const both = await banner();
  ok('then 小寶 falls asleep too: two sleep timers, one per twin, each with its name', both.filter((t) => /睡覺中/.test(t)).length === 2 && both.some((t) => /小寶・睡覺中/.test(t)) && both.some((t) => /大寶・睡覺中/.test(t)), JSON.stringify(both));
  const startA = await S((a) => Object.values(App.store.state.active).find((t) => t && t.babyId === a && !t.segments).start, A);
  // 大寶 wakes up while 小寶 is selected: press 大寶's 醒來了
  await p.tap('.active-timer:has-text("大寶・睡覺中") button:has-text("醒來了")'); await p.waitForTimeout(400);
  const s1 = await S(([a, b]) => { const L = App.store.state.logs.filter((l) => l.type === 'sleep').sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt))[0]; return { owner: L.babyId === a ? '大寶' : L.babyId === b ? '小寶' : L.babyId, start: L.start, stillB: !!App.timers.get('sleep', b) }; }, [A, B]);
  ok('大寶 wakes (button pressed while 小寶 is selected): the sleep is recorded under 大寶 with 大寶\'s start time, 小寶 keeps sleeping', s1.owner === '大寶' && s1.start === startA && s1.stillB, JSON.stringify(s1));
  // timers survive closing the app
  await p.reload(); await boot(); await home();
  ok('closing and reopening the app keeps 小寶\'s running timer', (await banner()).some((t) => /小寶・睡覺中/.test(t)));
  await p.tap('.active-timer:has-text("小寶・睡覺中") button:has-text("醒來了")'); await p.waitForTimeout(400);
  ok('小寶 wakes: recorded under 小寶', await S((b) => { const L = App.store.state.logs.filter((l) => l.type === 'sleep').sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt))[0]; return L.babyId === b; }, B));

  /* ---------- feeding both (tandem) ---------- */
  await pick('大寶'); await plus('親餵'); await waitTap();
  await pick('小寶'); await plus('親餵'); await waitTap();
  const feeds = await S(() => App.timers.running().filter((r) => r.base === 'feed').map((r) => r.t.babyId));
  ok('tandem feeding: 大寶 and 小寶 each have their own 親餵 timer', feeds.length === 2 && new Set(feeds).size === 2, JSON.stringify(feeds));
  const sideA0 = await S((a) => App.timers.get('breast', a).side, A);
  await p.tap('.active-timer:has-text("小寶・親餵中") .at-seg button:has-text("右")').catch(() => p.tap('.active-timer:has-text("小寶・親餵中") .at-seg button:has-text("左")'));
  await p.waitForTimeout(300);
  const sides = await S(([a, b]) => ({ a: App.timers.get('breast', a).side, b: App.timers.get('breast', b).side, segB: App.timers.get('breast', b).segments.length }), [A, B]);
  ok('switching 小寶 to the other side does not touch 大寶\'s side', sides.a === sideA0 && sides.segB === 2, JSON.stringify(sides));
  await p.tap('.active-timer:has-text("大寶・親餵中") button:has-text("完成")'); await p.waitForTimeout(400);
  const f1 = await S(([a]) => { const L = App.store.state.logs.filter((l) => l.type === 'breast').sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt))[0]; return L.babyId === a; }, [A]);
  ok('finishing 大寶\'s feed (while 小寶 is selected) records it under 大寶', f1);

  /* ---------- records and stats stay separate ---------- */
  await S((b) => { App.store.addLog({ type: 'diaper', babyId: b, data: { kind: 'wet' }, note: '小寶的尿布' }); }, B);
  await S(() => { location.hash = '#/log?x=1'; }); await p.waitForTimeout(400);
  const logB = await S(() => document.getElementById('view').innerText);
  await pick('大寶').catch(() => {});
  await S(() => { App.store.update((s) => { s.activeBabyId = s.babies[0].id; }); location.hash = '#/log?x=2'; }); await p.waitForTimeout(400);
  const logA = await S(() => document.getElementById('view').innerText);
  ok('育兒日記 shows only the selected baby\'s records', /小寶的尿布/.test(logB) === false ? false : !/小寶的尿布/.test(logA), `${/小寶的尿布/.test(logB)} / ${/小寶的尿布/.test(logA)}`);

  /* ---------- deleting a baby takes their running timer with them ---------- */
  await S(() => App.store.update((s) => { s.activeBabyId = 'twin2'; }));
  await S(() => App.me.editBaby(App.store.baby())); await p.waitForTimeout(400);
  await p.tap('.sheet button[aria-label="刪除寶寶"]'); await p.waitForTimeout(300);
  await p.tap('.sheet button:has-text("刪除")'); await p.waitForTimeout(400);
  const after = await S(() => ({ babies: App.store.state.babies.length, orphan: App.timers.running().filter((r) => r.t.babyId === 'twin2').length }));
  ok('deleting 小寶 also removes 小寶\'s running feed timer (no orphan timer left on screen)', after.babies === 1 && after.orphan === 0, JSON.stringify(after));

  /* ---------- one baby: storage exactly as before; older saved timers ---------- */
  await S(() => { Object.keys(App.store.state.active).forEach((k) => { if (/^(feed|sleep|pump)/.test(k)) App.timers.cancel(k === 'feed' ? 'breast' : k.split('@')[0]); }); App.timers.start('sleep'); });
  ok('one baby: the timer is saved in the same place as before (active.sleep)', await S(() => !!App.store.state.active.sleep && Object.keys(App.store.state.active).every((k) => !k.includes('@'))));
  await S(() => {
    const st = JSON.parse(JSON.stringify(App.store.state));
    st.active = { sleep: { start: new Date(Date.now() - 30 * 60000).toISOString() } }; // saved by an older version: no baby on it
    localStorage.setItem(App.store.KEY, JSON.stringify(st));
  });
  await p.reload(); await boot();
  const legacy = await S(() => { const a = App.store.state.active.sleep; const e = App.timers.stop('sleep'); return { babyId: a && a.babyId, current: App.store.baby().id, recorded: !!e && e.babyId === App.store.baby().id }; });
  ok('a running timer saved by an older version still finishes, under the selected baby', legacy.babyId === legacy.current && legacy.recorded, JSON.stringify(legacy));

  ok('no page errors anywhere', !errors.length, errors.slice(0, 4).join(' | '));
  console.log('\n=== 雙胞胎・多寶 ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
