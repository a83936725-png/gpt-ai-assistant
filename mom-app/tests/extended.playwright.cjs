// Extended test pass: 5 screen sizes × 4 stages, dark mode, accessibility (axe), persistence,
// corrupt/blocked storage, offline, 4,000+ records, midnight sleep split, shortcuts, custom tiles, print, keyboard.
// Usage:  cd mom-app && python3 -m http.server 8080      (another terminal)
//         node tests/extended.playwright.cjs              [BASE=... SHOT_DIR=... AXE_PATH=.../axe.min.js]
// Needs Playwright + Chromium. The accessibility section runs when axe-core is installed (npm i -D axe-core) or AXE_PATH is set.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOT = (process.env.SHOT_DIR || path.join(os.tmpdir(), 'mom-ext')) + path.sep;
fs.mkdirSync(SHOT, { recursive: true });
let AXE = null;
try { AXE = fs.readFileSync(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { /* optional */ }
const results = []; const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });
const errs = [];
(async () => {
  const browser = await chromium.launch();
  const mk = async (vp = { width: 390, height: 844 }, opts = {}) => {
    const ctx = await browser.newContext({ viewport: vp, locale: 'zh-TW', ...opts });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`[${vp.width}] ${p.url()} :: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(`[${vp.width}] ${p.url()} :: ${m.text()}`); });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const demo = async (p) => { await p.goto(BASE); await p.waitForTimeout(250); await p.click('text=先看看範例資料'); await p.waitForTimeout(400); await S(p, () => { App.isNight = () => false; App.applyTheme(); }); };
  const go = async (p, r, w = 150) => { await p.goto(BASE + '#/' + r); await p.waitForTimeout(w); };

  /* ===== A. every screen × stage × 5 viewports: errors, horizontal overflow, bad text ===== */
  const VPS = [{ width: 320, height: 568 }, { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }];
  const overflow = []; const bad = []; let visits = 0;
  for (const vp of VPS) {
    const p = await mk(vp); await demo(p);
    for (const stage of ['baby', 'baby+preg', 'preg', 'prep']) {
      await S(p, (st) => App.store.update((s) => {
        s.profile.stage = st.startsWith('baby') ? 'baby' : st; s.profile.pregnantToo = st === 'baby+preg';
        if (st !== 'prep') s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -170));
        if (!s.periods.length) s.periods.push({ id: 'p0', start: Core.dateKey(Core.addDays(new Date(), -9)) });
      }), stage);
      for (const id of await S(p, () => Object.keys(App.screens).filter((x) => x !== 'onboarding'))) {
        await go(p, id, id === 'island' ? 500 : 120); visits += 1;
        const r = await S(p, () => {
          const ow = document.documentElement.scrollWidth - innerWidth;
          const t = document.getElementById('view').innerText;
          const words = ['null', 'undefined', 'NaN', 'Invalid Date'].filter((w) => new RegExp(`(^|[^a-zA-Z])${w}([^a-zA-Z]|$)`).test(t));
          // find the widest offending element for the report
          let culprit = '';
          if (ow > 1) { const el = [...document.querySelectorAll('#view *')].find((e) => e.getBoundingClientRect().right > innerWidth + 1); culprit = el ? `${el.tagName}.${el.className}`.slice(0, 50) : ''; }
          return { ow, words, culprit };
        });
        if (r.ow > 1) overflow.push(`${vp.width}:${stage}:${id}(+${r.ow}px ${r.culprit})`);
        if (r.words.length) bad.push(`${vp.width}:${stage}:${id}(${r.words})`);
      }
    }
    await S(p, () => App.store.update((s) => { s.profile.stage = 'baby'; s.profile.pregnantToo = false; }));
    await go(p, 'home', 200); await p.screenshot({ path: `${SHOT}vp-${vp.width}-home.png` });
    await go(p, 'island', 700); await p.screenshot({ path: `${SHOT}vp-${vp.width}-island.png` });
    await go(p, 'growth', 300); await p.screenshot({ path: `${SHOT}vp-${vp.width}-growth.png` });
    await p.context().close();
  }
  ok(`A. ${visits} screen visits across 5 sizes × 4 stages: no horizontal scroll`, !overflow.length, overflow.slice(0, 12).join(' | '));
  ok('A. no null/undefined/NaN/Invalid Date text', !bad.length, bad.slice(0, 12).join(' | '));

  /* ===== B. accessibility (axe) light + dark ===== */
  if (!AXE) console.log('(skipping accessibility: axe-core not found — npm i -D axe-core or set AXE_PATH)');
  if (AXE) {
  const axeScreens = ['home', 'log', 'health', 'prevention', 'vaccines', 'checkups', 'growth', 'milestones', 'stats', 'report', 'milk', 'brand', 'me', 'reminders', 'island', 'postpartum', 'journey'];
  const axeAgg = {};
  for (const theme of ['light', 'dark']) {
    const p = await mk(); await demo(p);
    await S(p, (t) => { App.store.update((s) => { s.settings.theme = t; s.settings.nightMode = false; }); App.applyTheme(); }, theme);
    const run = async (label) => {
      await S(p, () => document.querySelectorAll('.toast-wrap').forEach((t) => t.remove())); // toasts fade in/out; scanning mid-animation gives false contrast hits
      await p.addScriptTag({ content: AXE }).catch(() => {});
      const v = await S(p, async () => (await axe.run(document, { resultTypes: ['violations'], runOnly: ['wcag2a', 'wcag2aa'] })).violations
        .filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => ({ id: x.id, n: x.nodes.length, ex: x.nodes[0].target.join(' ').slice(0, 60), sum: (x.nodes[0].failureSummary || '').split('\n')[1]?.slice(0, 90) })));
      v.forEach((x) => { const k = `${theme}:${x.id}`; (axeAgg[k] = axeAgg[k] || []).push(`${label}×${x.n} [${x.ex}] ${x.sum || ''}`); });
    };
    for (const id of axeScreens) { await go(p, id, id === 'island' ? 600 : 250); await run(id); }
    for (const st of ['preg', 'prep']) { await S(p, (x) => App.store.update((s) => { s.profile.stage = x; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -170)); }), st); for (const id of (st === 'preg' ? ['home', 'log', 'health', 'journey', 'prenatal', 'kick', 'contraction', 'pregweight', 'hospitalbag'] : ['home', 'log', 'health', 'cycle', 'prepcheck'])) { await go(p, id, 250); await run(`${st}-${id}`); } }
    if (theme === 'dark') { for (const id of ['home', 'health', 'brand']) { await S(p, () => App.store.update((s) => { s.profile.stage = 'baby'; })); await go(p, id, 300); await p.screenshot({ path: `${SHOT}dark-${id}.png` }); } }
    await p.context().close();
  }
  fs.writeFileSync(`${SHOT}axe.json`, JSON.stringify(axeAgg, null, 1));
  ok('B. accessibility: no serious/critical WCAG A/AA issues (light + dark)', !Object.keys(axeAgg).length, Object.entries(axeAgg).map(([k, v]) => `${k}: ${v.length} screens e.g. ${v[0]}`).join('\n      '));
  }

  /* ===== C. persistence, timers across reload, corrupt & blocked storage ===== */
  {
    const p = await mk(); await demo(p);
    await p.click('.quick-tile:has-text("睡眠") .qt-plus'); await p.waitForTimeout(300);
    const before = await S(p, () => ({ n: App.store.state.logs.length, sleep: App.store.state.active.sleep?.start }));
    await p.reload(); await p.waitForTimeout(1300);
    const after = await S(p, () => ({ n: App.store.state.logs.length, sleep: App.store.state.active.sleep?.start, clock: document.querySelector('[data-clock]')?.textContent }));
    ok('C. data + running timer survive reload', before.n === after.n && before.sleep === after.sleep && after.clock && after.clock !== '00:00', JSON.stringify(after));
    await S(p, () => localStorage.setItem('yijia-mom-app-v1', '{broken json'));
    await p.reload(); await p.waitForTimeout(400);
    ok('C. corrupt storage → app recovers to welcome screen', await p.isVisible('text=開始使用'));
    await p.context().close();
    const q = await mk(); await q.addInitScript(() => { const thrower = () => { throw new Error('blocked'); }; Object.defineProperty(window, 'localStorage', { get: thrower }); });
    await q.goto(BASE); await q.waitForTimeout(400);
    const okBlocked = await q.isVisible('text=開始使用');
    if (okBlocked) { await q.click('text=先看看範例資料'); await q.waitForTimeout(400); }
    ok('C. storage blocked (private mode) → app still works in memory', okBlocked && (await S(q, () => App.store.state.logs.length)) > 10);
    await q.context().close();
  }

  /* ===== D. offline (service worker) ===== */
  {
    const p = await mk(); await demo(p);
    await S(p, async () => { await navigator.serviceWorker.ready; });
    await p.reload(); await p.waitForTimeout(800); // second load populates runtime cache
    await p.context().setOffline(true);
    await p.reload(); await p.waitForTimeout(800);
    const offlineOk = await S(p, () => !!document.querySelector('.baby-hero') && Object.keys(App.screens).length > 20);
    ok('D. offline reload still opens the app (service worker cache)', offlineOk);
    await go(p, 'island', 600); ok('D. offline: island + health screens work', await p.isVisible('.isl-label') && (await (async () => { await go(p, 'prevention', 300); return p.isVisible('text=下一步要做的'); })()));
    await p.context().setOffline(false); await p.context().close();
  }

  /* ===== E. heavy data: 6 months × ~24 logs/day ===== */
  {
    const p = await mk(); await demo(p);
    const size = await S(p, () => {
      const babyId = App.store.baby().id; const now = Date.now(); const logs = [];
      for (let i = 0; i < 180 * 24; i += 1) {
        const t = now - i * 60 * 60 * 1000;
        const type = ['bottle', 'diaper', 'breast', 'sleep'][i % 4];
        logs.push({ id: `h${i}`, babyId, type, start: new Date(t).toISOString(), end: type === 'sleep' || type === 'breast' ? new Date(t + 40 * 60000).toISOString() : null, data: type === 'bottle' ? { kind: 'formula', ml: 120 } : type === 'diaper' ? { kind: 'wet' } : {}, note: '', by: '媽媽' });
      }
      App.store.state.logs.push(...logs); App.store.save();
      return localStorage.getItem('yijia-mom-app-v1').length;
    });
    await p.reload(); await p.waitForTimeout(300);
    const timing = {};
    for (const id of ['home', 'log', 'stats', 'report', 'health']) {
      timing[id] = await S(p, (r) => { const t0 = performance.now(); location.hash = `#/${r}`; return new Promise((res) => setTimeout(() => res(Math.round(performance.now() - t0)), 0)); }, id);
    }
    const tap = await S(p, () => { const t0 = performance.now(); App.babylog.quickLog('diaper'); return Math.round(performance.now() - t0); });
    ok(`E. 4,320 records (${Math.round(size / 1024)} KB): screens render fast`, Object.values(timing).every((ms) => ms < 400) && tap < 400, `${JSON.stringify(timing)} quick-log ${tap}ms`);
    ok('E. storage size well under the 5 MB browser limit', size < 2.5 * 1024 * 1024, `${Math.round(size / 1024)} KB`);
    await p.context().close();
  }

  /* ===== F. sleep across midnight split into both days ===== */
  {
    const p = await mk(); await demo(p);
    const split = await S(p, () => {
      const b = App.store.baby(); const y = Core.addDays(Core.startOfDay(new Date()), -1);
      App.store.update((s) => { s.logs = s.logs.filter((l) => !(l.type === 'sleep' && (Core.dateKey(new Date(l.start)) === Core.dateKey(y) || Core.dateKey(new Date(l.start)) === Core.dateKey(Core.addDays(y, -1))))); });
      const st = new Date(y); st.setHours(23, 0, 0, 0); const en = new Date(y); en.setDate(en.getDate() + 1); en.setHours(2, 0, 0, 0);
      App.store.addLog({ type: 'sleep', start: st.toISOString(), end: en.toISOString(), babyId: b.id });
      const d = App.health.dailyStats(b, 3).days;
      return d.map((x) => Math.round(x.sleepMs / 60000));
    });
    ok('F. 23:00–02:00 sleep counted as 60 min + 120 min on the two days', split[1] >= 60 && split[2] >= 120, JSON.stringify(split));
    await p.context().close();
  }

  /* ===== G. home-screen shortcuts ===== */
  {
    const p = await mk(); await demo(p);
    await p.goto(BASE + '?action=bottle#/home'); await p.waitForTimeout(500);
    ok('G. shortcut 記瓶餵 opens the bottle form, URL cleaned', await p.isVisible('.sheet:has-text("瓶餵")') && !(await S(p, () => location.search)));
    await p.goto(BASE + '?action=breast#/home'); await p.waitForTimeout(500);
    ok('G. shortcut 開始餵奶 starts the timer', await S(p, () => !!App.store.state.active.feed));
    await p.goto(BASE + '?action=breast#/home'); await p.waitForTimeout(500);
    ok('G. shortcut again while running does not restart', await p.isVisible('text=已經在計時中'));
    await p.goto(BASE + '?action=sleep#/home'); await p.waitForTimeout(400);
    ok('G. shortcut 寶寶睡了 starts sleep timer', await S(p, () => !!App.store.state.active.sleep));
    const man = JSON.parse(await (await p.request.get(BASE + 'manifest.webmanifest')).text());
    ok('G. manifest has 4 shortcuts', (man.shortcuts || []).length === 4, man.shortcuts.map((s) => s.name).join('、'));
    await p.context().close();
  }

  /* ===== H. customizable tiles ===== */
  {
    const p = await mk(); await demo(p);
    await p.click('text=自訂快速鍵'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${SHOT}tiles-edit.png` });
    await p.click('.sheet label:has-text("擠奶")'); await p.click('.sheet label:has-text("副食品")'); await p.click('.sheet label:has-text("洗澡")');
    await p.click('.sheet-footer .btn-primary'); await p.waitForTimeout(300);
    const tiles = await S(p, () => [...document.querySelectorAll('.qt-label')].map((e) => e.textContent).join());
    ok('H. choose tiles: 擠奶 off, 副食品 + 洗澡 on', tiles === '親餵,瓶餵,尿布,睡眠,體溫,副食品,洗澡', tiles);
    const n0 = await S(p, () => App.store.state.logs.length);
    await p.click('.quick-tile:has-text("洗澡") .qt-plus'); await p.waitForTimeout(200);
    ok('H. ＋洗澡 logs in one tap with 復原', (await S(p, () => App.store.state.logs.length)) === n0 + 1 && await p.isVisible('.toast-action'));
    const fold = await S(p, () => Math.round(document.querySelector('.next-card').getBoundingClientRect().top));
    ok('H. with 7 tiles 接下來 still reachable near the fold', fold < 900, `${fold}px`);
    await p.screenshot({ path: `${SHOT}tiles-7.png` });
    await p.click('text=自訂快速鍵'); await p.click('.sheet-footer .btn-ghost'); await p.waitForTimeout(250);
    ok('H. 恢復預設 restores 6 tiles', (await S(p, () => document.querySelectorAll('.qt-label').length)) === 6);
    await p.context().close();
  }

  /* ===== I. long names / text don't break layout ===== */
  {
    const p = await mk({ width: 320, height: 568 }); await demo(p);
    await S(p, () => App.store.update((s) => { s.babies[0].name = '王小乖乖乖乖乖乖乖乖乖乖乖乖乖乖乖乖'; s.profile.momName = '非常非常長的媽媽暱稱測試'; s.logs[s.logs.length - 1].note = '這是一個非常非常長的備註，用來測試畫面會不會被撐開或是超出螢幕範圍的情況'; }));
    let worst = 0;
    for (const id of ['home', 'log', 'me', 'health']) { await go(p, id, 200); worst = Math.max(worst, await S(p, () => document.documentElement.scrollWidth - innerWidth)); }
    ok('I. very long baby/mom names on a 320px phone: no sideways scroll', worst <= 1, `${worst}px`);
    await go(p, 'home', 200); await p.screenshot({ path: `${SHOT}long-names-320.png` });
    const heroH = await S(p, () => Math.round(document.querySelector('.baby-hero').getBoundingClientRect().height));
    ok('I. long baby name stays on one line (header not stretched)', heroH <= 90, `${heroH}px`);
    await p.context().close();
  }

  /* ===== J. print / PDF ===== */
  {
    const p = await mk(); await demo(p); await go(p, 'report', 400);
    await p.emulateMedia({ media: 'print' });
    const hidden = await S(p, () => ['#appbar', '#tabbar', '.no-print'].every((sel) => [...document.querySelectorAll(sel)].every((e) => getComputedStyle(e).display === 'none')));
    const pdf = await p.pdf({ format: 'A4', path: `${SHOT}report.pdf` });
    ok('J. PDF report: nav hidden in print, file generated', hidden && pdf.length > 20000, `${Math.round(pdf.length / 1024)} KB`);
    await p.context().close();
  }

  /* ===== K. keyboard ===== */
  {
    const p = await mk(); await demo(p);
    await p.click('.quick-tile:has-text("瓶餵") .qt-main'); await p.waitForTimeout(250);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok('K. Escape closes a sheet', !(await p.isVisible('.sheet')));
    await go(p, 'home', 200);
    let reached = false;
    for (let i = 0; i < 25 && !reached; i += 1) { await p.keyboard.press('Tab'); reached = await S(p, () => document.activeElement?.classList.contains('qt-plus')); }
    ok('K. keyboard Tab reaches the quick ＋ buttons', reached);
    await p.context().close();
  }

  ok('no page errors in the whole extended run', !errs.length, errs.slice(0, 6).join('\n      '));
  console.log('\n=== EXTENDED RESULTS ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? `\n      ${r.info}` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  await browser.close();
  if (results.some((r) => !r.pass)) process.exitCode = 1;
})().catch((e) => { console.error('SCRIPT ERROR', e.stack); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); console.log(errs.slice(0, 5).join('\n')); process.exit(1); });
