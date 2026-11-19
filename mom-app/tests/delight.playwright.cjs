// 質感與互動測試：慶祝動畫（里程碑、疫苗、10 次胎動、寶寶出生、蓋章、今日小任務、連續打卡）、一鍵記錄的小動畫、
// 首頁會動的寶寶與水果、滿月／百日／收涎／度晬；而且動畫不擋手指、會自己清掉、不讓畫面變寬，手機設定「減少動態效果」時完全不動。
// Usage: cd mom-app && python3 -m http.server 8080   then   node tests/delight.playwright.cjs   [BASE=...]
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const results = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (opts = {}) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'zh-TW', ...opts });
    await ctx.addInitScript(() => { window.__noShareMoments = true; });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.dismiss().catch(() => {}));
    await p.goto(BASE); await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.screens && App.screens.goods);
    await p.evaluate(() => { App.isNight = () => false; App.demo.seed(); App.store.update((s) => { s.settings.a2hsDismissed = '1'; }); });
    return { p, ctx };
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, id, ms = 700) => { await S(p, (x) => { location.hash = `#/${x}?${Math.random()}`; }, id); await p.waitForTimeout(ms); };
  const parts = (p) => S(p, () => document.querySelectorAll('.fx-layer .fx-p').length);
  const toastText = (p) => S(p, () => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));

  const { p } = await open();

  /* ---------- celebrations: real moments only ---------- */
  await go(p, 'milestones');
  await p.click('.ms-item input[type=checkbox]'); await p.waitForTimeout(200);
  const ms = { n: await parts(p), toast: await toastText(p), over: await S(p, () => document.documentElement.scrollWidth - innerWidth) };
  ok('ticking a milestone: confetti (⭐🎉💜) + 「又長大一點了」, and the page does not get wider', ms.n >= 20 && /又長大一點了/.test(ms.toast) && ms.over <= 1, JSON.stringify(ms));
  // taps go straight through the confetti
  const through = await S(p, () => {
    const pt = document.querySelector('.fx-layer .fx-p'); const r = pt.getBoundingClientRect();
    const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { layerEvents: getComputedStyle(document.querySelector('.fx-layer')).pointerEvents, hitsParticle: !!(under && under.closest('.fx-layer')) };
  });
  ok('the confetti never takes a tap (whatever is underneath still gets it)', through.layerEvents === 'none' && !through.hitsParticle, JSON.stringify(through));
  await p.waitForTimeout(2200);
  ok('…and it clears itself within about 2 seconds', (await parts(p)) === 0);

  await go(p, 'vaccines');
  await p.click('.vac-item:not(.vac-done) >> nth=0'); await p.waitForTimeout(400);
  await p.click('.sheet button:has-text("標記為已完成")'); await p.waitForTimeout(200);
  ok('marking a vaccine done: a little 💉✨ celebration', (await parts(p)) > 0);
  await p.waitForTimeout(2200);

  /* ---------- one-tap logging: a puff from the button, today's count pops ---------- */
  await go(p, 'home', 900);
  const before = await S(p, () => (document.querySelector('.quick-tile[data-type="diaper"] .qt-badge') || {}).textContent || '0');
  await p.tap('.quick-tile[data-type="diaper"] .qt-plus'); await p.waitForTimeout(120);
  const qa = await S(p, () => ({ n: document.querySelectorAll('.fx-layer .fx-p').length, pop: !!document.querySelector('.quick-tile[data-type="diaper"] .qt-badge.pop'), badge: (document.querySelector('.quick-tile[data-type="diaper"] .qt-badge') || {}).textContent }));
  ok('＋尿布: a few 🧷 float up from the button and today\'s count pops', qa.n >= 3 && qa.n <= 8 && qa.pop && Number(qa.badge) === Number(before) + 1, JSON.stringify(qa));
  await p.waitForTimeout(1500);
  await S(p, () => App.store.update((s) => { s.logs = s.logs.filter((l) => l.type !== 'bottle'); })); await go(p, 'home', 900);
  await p.tap('.quick-tile[data-type="bottle"] .qt-plus'); await p.waitForTimeout(200);
  ok('when ＋ opens a form instead (no earlier bottle to copy), there is no puff', (await parts(p)) === 0 && await S(p, () => document.body.classList.contains('has-sheet')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  /* ---------- a living home ---------- */
  await S(p, () => App.timers.start('sleep')); await go(p, 'home', 600);
  const sleepy = await S(p, () => ({ fx: !!document.querySelector('.hero-main .hero-fx.sleep'), label: document.querySelector('.hero-main').getAttribute('aria-label') }));
  ok('baby asleep: z z z float beside the avatar (and screen readers hear 睡覺中)', sleepy.fx && /睡覺中/.test(sleepy.label), JSON.stringify(sleepy));
  await S(p, () => { App.timers.cancel('sleep'); App.timers.start('breast'); }); await go(p, 'home', 600);
  ok('feeding: little hearts instead', await S(p, () => !!document.querySelector('.hero-main .hero-fx.feed') && !document.querySelector('.hero-fx.sleep')));
  await S(p, () => App.timers.cancel('breast')); await go(p, 'home', 600);
  ok('nothing running: no decoration', await S(p, () => !document.querySelector('.hero-fx')));

  /* ---------- screens settle in on arrival, but not on every update ---------- */
  await go(p, 'log', 50);
  const entering = await S(p, () => document.getElementById('view').classList.contains('view-enter'));
  await p.waitForTimeout(900);
  await S(p, () => App.store.update((s) => { s.profile.member = s.profile.member; }));
  const updating = await S(p, () => document.getElementById('view').classList.contains('view-enter'));
  ok('arriving on a screen: cards settle in; an update of the same screen does not replay it (no flicker)', entering && !updating);

  /* ---------- daily tasks and streaks ---------- */
  await S(p, () => App.store.update((s) => { const k = Core.dateKey(); s.daily.log[k] = { water: 7 }; s.chicken.log[k] = 1; delete s.folic.log[k]; s.profile.stage = 'baby'; }));
  await go(p, 'home', 800);
  await p.click('.daily-item:has-text("喝水") .daily-main'); await p.waitForTimeout(400);
  const allDone = { toast: await toastText(p), n: await parts(p), cheered: await S(p, () => !!App.store.state.daily.log[Core.dateKey()].cheered) };
  ok('the last daily task done (8th glass of water): 「今日小任務全部完成」 with confetti', /全部完成/.test(allDone.toast) && allDone.n > 0 && allDone.cheered, JSON.stringify(allDone));
  await p.waitForFunction(() => ![...document.querySelectorAll('.toast')].some((t) => /全部完成/.test(t.textContent)), null, { timeout: 8000 });
  await p.click('.daily-item:has-text("喝水") .daily-minus'); await p.waitForTimeout(300);
  await p.click('.daily-item:has-text("喝水") .daily-main'); await p.waitForTimeout(400);
  ok('…only once a day (undo and redo does not celebrate again)', !/全部完成/.test(await toastText(p)));
  await S(p, () => App.store.update((s) => { s.chicken.log = {}; for (let i = 1; i <= 6; i += 1) s.chicken.log[Core.dateKey(Core.addDays(new Date(), -i))] = 1; }));
  await S(p, () => App.chicken.checkIn(1)); await p.waitForTimeout(200);
  ok('7 days of 滴雞精時光 in a row: a streak cheer', /連續 7 天/.test(await toastText(p)) && (await parts(p)) > 0);
  await p.waitForTimeout(2500);

  /* ---------- pregnancy: the fruit of the week ---------- */
  await S(p, () => { const s = App.store.defaults(); s.onboarded = true; s.profile.stage = 'preg'; s.settings.a2hsDismissed = '1'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -(28 * 7 + 3))); s.profile.edd = Core.eddFromLmp(s.profile.lmp); App.store.replace(s); });
  await go(p, 'home', 800);
  await p.click('.pg-hero-emoji'); await p.waitForTimeout(300);
  const fruit = { toast: await toastText(p), hash: await S(p, () => location.hash) };
  ok('tap the fruit of the week: it wiggles and says something about this week, without leaving 首頁', /第 28 週/.test(fruit.toast) && /home/.test(fruit.hash), JSON.stringify(fruit));
  await S(p, () => { App.store.update((s) => { s.active.kick = { start: new Date().toISOString(), count: 9 }; }); });
  await go(p, 'kick', 700);
  await p.click('.pg-kick-btn'); await p.waitForTimeout(200);
  ok('the 10th kick: 「數到 10 次了」 with 👣💜 confetti', /數到 10 次/.test(await toastText(p)) && (await parts(p)) >= 20);
  await p.waitForTimeout(2200);

  /* ---------- baby born: the big one ---------- */
  await go(p, 'journey', 700);
  await S(p, () => App.journey.openBirthSheet()); await p.waitForTimeout(500);
  await p.fill('.sheet input[type=text] >> nth=0', '小星星').catch(() => {});
  await p.click('.sheet button:has-text("寶寶出生了，儲存")'); await p.waitForTimeout(500);
  ok('寶寶出生了: the biggest celebration (🎉👶💖🍼)', (await parts(p)) >= 30 && /歡迎/.test(await toastText(p)));

  /* ---------- 滿月・百日・收涎・度晬: a line under the baby, celebrated once, never a pop-up ---------- */
  {
    const ctx2 = await browser.newContext({ ...devices['iPhone SE'], locale: 'zh-TW' });
    const q = await ctx2.newPage(); q.on('pageerror', (e) => errors.push(e.message));
    await q.goto(BASE); await q.waitForFunction(() => window.App && App.store && !App.store.loading && App.share);
    const ageTo = (days) => S(q, (d) => App.store.update((s) => { s.babies[0].birthday = Core.dateKey(Core.addDays(new Date(), -d)); }), days);
    await S(q, () => { App.isNight = () => false; App.demo.seed(); App.store.update((s) => { s.settings.a2hsDismissed = '1'; s.onboardedAt = new Date(Date.now() - 20 * 864e5).toISOString(); }); });
    await ageTo(29); await go(q, 'home', 1000);
    const line = () => S(q, () => { const el = document.querySelector('.moment-line'); if (!el) return null; const r = el.getBoundingClientRect(); return { text: el.textContent, bottom: Math.round(r.bottom), vh: innerHeight, n: document.querySelectorAll('.fx-layer .fx-p').length, popup: document.body.classList.contains('has-sheet') }; });
    const m30 = await line();
    ok('滿月 week: a line right under the baby, on screen on a small phone, with a little celebration and no pop-up', m30 && /滿月/.test(m30.text) && m30.bottom < m30.vh && m30.n > 0 && !m30.popup, JSON.stringify(m30));
    await q.waitForTimeout(2200); await go(q, 'home', 1000);
    ok('…the celebration happens once (coming back to 首頁 is quiet)', (await line()).n === 0);
    await q.click('.moment-line'); await q.waitForTimeout(500);
    const sh = await S(q, () => (document.querySelector('.sheet') || {}).textContent || '');
    ok('tapping it: the custom in a line (剃胎毛、滿月油飯) and the share card one tap away', /剃胎毛/.test(sh) && /做成分享卡/.test(sh), sh.slice(0, 80));
    await q.click('.sheet button:has-text("做成分享卡")'); await q.waitForTimeout(700);
    ok('…which opens the share card for 滿月', await S(q, () => /LINE/.test((document.querySelector('.sheet') || {}).textContent || '')));
    await q.keyboard.press('Escape'); await q.waitForTimeout(400);
    const seen = [];
    for (const [d, re] of [[99, /百日/], [125, /收涎/], [366, /度晬/], [75, null], [200, null]]) {
      await ageTo(d); await go(q, 'home', 500);
      const l = await line(); seen.push(`${d}:${l ? l.text.slice(0, 12) : '-'}`);
      if (re ? !(l && re.test(l.text)) : l) { seen.push('✗'); }
    }
    ok('百日 (day 100), 收涎 (4 months), 度晬 (1 year) each get their week; other days show nothing', !seen.includes('✗'), seen.join(' '));
    await ctx2.close();
  }

  /* ---------- reduced motion: the same app, perfectly still ---------- */
  {
    const { p: q } = await open({ reducedMotion: 'reduce' });
    await go(q, 'milestones');
    await q.click('.ms-item input[type=checkbox]'); await q.waitForTimeout(200);
    const still = { n: await parts(q), toast: await toastText(q) };
    await S(q, () => { const s = App.store.defaults(); s.onboarded = true; s.profile.stage = 'preg'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -(20 * 7))); s.profile.edd = Core.eddFromLmp(s.profile.lmp); App.store.replace(s); });
    await go(q, 'home', 500);
    const anim = await S(q, () => ({ fruit: getComputedStyle(document.querySelector('.pg-fruit')).animationName, view: getComputedStyle(document.querySelector('#view > *')).animationName }));
    ok('「減少動態效果」 on: no confetti and nothing moves, but the message still shows', still.n === 0 && /又長大一點了/.test(still.toast) && anim.fruit === 'none' && anim.view === 'none', JSON.stringify({ still, anim }));
  }

  ok('no page errors anywhere', !errors.length, errors.slice(0, 4).join(' | '));
  console.log('\n=== 質感與互動 ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
