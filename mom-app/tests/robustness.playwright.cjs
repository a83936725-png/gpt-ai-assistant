// 強韌度測試：手機觸控模擬、時區與日期邊界、舊資料升級、惡意資料（XSS）、低階手機效能、長時間使用記憶體。
// Usage: cd mom-app && python3 -m http.server 8080   then   node tests/robustness.playwright.cjs   [BASE=...]
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const results = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => {
    p.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text()) && !/\/api\//.test((m.location() || {}).url || '')) errors.push(`[${tag}] ${m.text()}`); });
    p.on('dialog', (d) => { errors.push(`[${tag}] DIALOG ${d.message()}`); d.dismiss().catch(() => {}); });
  };
  const open = async (opts, tag) => {
    const ctx = await browser.newContext({ locale: 'zh-TW', ...opts });
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.__noShareMoments = true; });
    watch(p, tag);
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const demo = async (p) => { await p.goto(BASE); await p.waitForTimeout(300); await p.tap('text=先看看範例資料').catch(() => p.click('text=先看看範例資料')); await p.waitForTimeout(500); await S(p, () => { App.isNight = () => false; App.applyTheme(); }); };
  const screens = (p) => S(p, () => Object.keys(App.screens).filter((x) => !['onboarding', 'login'].includes(x)));

  /* ---------- 1. real-phone emulation with touch ---------- */
  for (const name of ['iPhone 13', 'Pixel 7']) {
    const d = devices[name];
    const p = await open({ ...d, defaultBrowserType: undefined }, name);
    await demo(p);
    const n0 = await S(p, () => App.store.state.logs.length);
    await p.tap('.quick-tile:has-text("尿布") .qt-plus'); await p.waitForTimeout(250);
    await p.tap('.quick-tile:has-text("瓶餵") .qt-main'); await p.waitForTimeout(350);
    await p.tap('.preset-chips .chip:has-text("120")'); await p.tap('.sheet-footer .btn-primary'); await p.waitForTimeout(350);
    ok(`${name}: tap to log (one-tap diaper + bottle form)`, (await S(p, () => App.store.state.logs.length)) === n0 + 2);
    await p.tap('.tabbar a:has-text("好孕島")'); await p.waitForTimeout(800);
    await p.tap('.isl-label >> nth=2'); await p.waitForTimeout(600);
    ok(`${name}: tap an island spot opens it`, await p.isVisible('.sheet'));
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    const overflow = await S(p, () => document.documentElement.scrollWidth - innerWidth);
    ok(`${name}: no sideways scrolling`, overflow <= 1, `${overflow}px`);
    await p.context().close();
  }

  /* ---------- 2. dates: midnight with a running timer, New Year, leap day ---------- */
  {
    const p = await open({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei' }, 'clock');
    await p.clock.install({ time: new Date('2026-12-31T23:50:00+08:00') });
    await p.goto(BASE); await p.waitForTimeout(300);
    await p.click('text=先看看範例資料'); await p.clock.runFor(800);
    await S(p, () => { App.isNight = () => false; App.applyTheme(); });
    await p.click('.quick-tile:has-text("睡眠") .qt-plus'); await p.clock.runFor(300);
    await p.clock.fastForward('20:00'); // → 2027-01-01 00:10
    await p.clock.runFor(1200);
    const clockTxt = await S(p, () => document.querySelector('.active-timer [data-clock]')?.textContent);
    ok('sleep timer keeps counting across midnight + New Year', /^(20|19):\d\d$/.test(clockTxt || ''), clockTxt);
    await p.click('.active-timer button:has-text("醒來了")'); await p.clock.runFor(400);
    const split = await S(p, () => { const d = App.health.dailyStats(App.store.baby(), 2).days; return d.map((x) => [Core.dateKey(x.date), Math.round(x.sleepMs / 60000)]); });
    ok('that sleep is split 10 min (Dec 31) + 10 min (Jan 1)', split.length === 2 && split[0][0] === '2026-12-31' && split[1][0] === '2027-01-01' && split[1][1] >= 10, JSON.stringify(split));
    await p.goto(`${BASE}#/log`); await p.clock.runFor(300);
    await p.click('.log-top .seg button:has-text("月曆")'); await p.clock.runFor(300);
    ok('calendar shows January 2027 after New Year', /2027 年 1 月/.test(await S(p, () => document.querySelector('.datenav-mid')?.textContent || '')));
    await p.click('.datenav .icon-btn >> nth=0'); await p.clock.runFor(300);
    ok('calendar goes back to December 2026', /2026 年 12 月/.test(await S(p, () => document.querySelector('.datenav-mid')?.textContent || '')));
    const leap = await S(p, () => ['2025-02-28', '2025-03-01', '2028-02-29'].map((d) => Core.babyAge('2024-02-29', Core.parseKey(d)).text));
    ok('leap-day birthday: 12 months on 2/28, then 12 months 1 day, 4 years on the next 2/29', leap[0] === '12 個月' && leap[1] === '12 個月 1 天' && leap[2] === '4 歲', JSON.stringify(leap));
    await p.context().close();
  }

  /* ---------- 3. moms abroad: other time zones ---------- */
  for (const tz of ['America/Los_Angeles', 'Europe/London']) {
    const p = await open({ viewport: { width: 390, height: 844 }, timezoneId: tz }, tz);
    await demo(p);
    await p.click('.quick-tile:has-text("尿布") .qt-plus'); await p.waitForTimeout(250);
    const today = await S(p, () => ({ key: Core.dateKey(), last: Core.dateKey(new Date(App.store.lastLog('diaper').start)), inToday: App.store.logsOn(new Date()).some((l) => l.id === App.store.lastLog('diaper').id) }));
    ok(`${tz}: a log made now shows under today`, today.key === today.last && today.inToday, JSON.stringify(today));
    for (const id of ['home', 'log', 'stats', 'prevention', 'journey']) { await p.goto(`${BASE}#/${id}`); await p.waitForTimeout(150); }
    ok(`${tz}: screens render without errors`, !errors.some((e) => e.startsWith(`[${tz}]`)));
    await p.context().close();
  }

  /* ---------- 4. upgrade from the first version's saved data ---------- */
  {
    const p = await open({ viewport: { width: 390, height: 844 } }, 'upgrade');
    await p.goto(BASE); await p.waitForTimeout(200);
    await S(p, () => {
      const now = Date.now();
      const v1 = {
        version: 1, onboarded: true,
        profile: { momName: '老用戶', stage: 'baby', member: '媽媽', cycleLength: 28, periodLength: 5 },
        babies: [{ id: 'b1', name: '大寶', sex: 'boy', birthday: Core.dateKey(Core.addDays(new Date(), -120)), avatar: '👶' }],
        activeBabyId: 'b1',
        logs: [{ id: 'l1', babyId: 'b1', type: 'bottle', start: new Date(now - 3600e3).toISOString(), data: { kind: 'formula', ml: 150 }, note: '' }],
        growth: [], vaccines: {}, checkups: {}, milestones: {}, milk: [], periods: [],
        preg: { kicks: [], contractions: [], weights: [], prenatal: {} },
        island: { stamps: {}, quiz: {} }, chicken: { log: {}, goal: 1 }, folic: { log: {} },
        reminders: [{ id: 'feed', label: '餵奶提醒', type: 'feed', enabled: true, minutes: 180 }, { id: 'chicken', label: '滴雞精飲用提醒', type: 'chicken', enabled: false, time: '09:00' }],
        settings: { theme: 'auto' },
      };
      localStorage.setItem('yijia-mom-app-v1', JSON.stringify(v1));
    });
    await p.reload(); await p.waitForTimeout(500);
    const st = await S(p, () => ({ logs: App.store.state.logs.length, reminders: App.store.state.reminders.map((r) => r.id).join(','), daily: !!App.store.state.daily, share: !!(App.store.state.share && App.store.state.share.code), feedOn: App.store.state.reminders.find((r) => r.id === 'feed').enabled }));
    ok('old data keeps records and settings', st.logs === 1 && st.feedOn === true, JSON.stringify(st));
    ok('old data gains new features (reminders, daily tasks, invite code)', st.reminders === 'feed,appt,chicken' && st.daily && st.share, JSON.stringify(st));
    for (const id of await screens(p)) { await p.goto(`${BASE}#/${id}`); await p.waitForTimeout(id === 'island' ? 400 : 120); }
    ok('every screen works on upgraded data', !errors.some((e) => e.startsWith('[upgrade]')), errors.filter((e) => e.startsWith('[upgrade]')).slice(0, 3).join(' | '));
    await p.context().close();
  }

  /* ---------- 5. malicious data: from a shared backup, an invite link, or typed in ---------- */
  {
    const p = await open({ viewport: { width: 390, height: 844 } }, 'xss');
    const X = '<img src=x onerror="window.__xss=1"><svg onload="window.__xss=1">"\'><script>window.__xss=1</script>';
    await p.goto(`${BASE}?ref=EVIL01&from=${encodeURIComponent(X)}#/home`); await p.waitForTimeout(500);
    ok('invite link with code in the inviter name: shown as text only', !(await S(p, () => window.__xss)) && await p.isVisible('.ob-invited'));
    await p.click('text=先看看範例資料'); await p.waitForTimeout(500);
    await S(p, (x) => App.store.update((s) => {
      const b = s.babies[0]; b.name = x; s.profile.momName = x; s.profile.member = x;
      s.logs.slice(-6).forEach((l) => { l.note = x; l.by = x; });
      s.logs.push({ id: 'v1', babyId: b.id, type: 'visit', start: new Date().toISOString(), data: { clinic: x, reason: x, diagnosis: x, meds: x }, note: x });
      s.logs.push({ id: 'f1', babyId: b.id, type: 'food', start: new Date().toISOString(), data: { item: x, amount: x }, note: x });
      s.milk[0].note = x;
      s.growth.push({ id: 'g9', babyId: b.id, date: Core.dateKey(), weight: 6.5 });
      s.outing = { plans: [{ id: 'p1', title: x, date: Core.dateKey(), place: x, url: 'javascript:window.__xss=1', notes: x }], bag: { custom: [{ id: 'c1', label: x }] } };
      s.preg.journal = [{ id: 'j1', at: new Date().toISOString(), symptoms: [], note: x }];
      s.postpartum = { start: b.birthday, method: 'vaginal', log: [{ id: 'p1', at: new Date().toISOString(), lochia: { amount: 'm', color: 'red' }, pain: 2, temp: 36.8, mood: 3, symptoms: [], note: x }] };
      s.benefits = { 'pre-check': { status: 'applied', note: x } };
      s.searchHistory = [x];
    }), X);
    for (const id of await screens(p)) {
      await p.goto(`${BASE}#/${id}`); await p.waitForTimeout(id === 'island' ? 400 : 150);
    }
    await p.goto(`${BASE}#/log`); await p.waitForTimeout(200); await p.click('.tl-item >> nth=0'); await p.waitForTimeout(300); await p.keyboard.press('Escape');
    await p.goto(`${BASE}#/home`); await p.waitForTimeout(200); await p.click('.hero-share'); await p.waitForTimeout(1500); await p.keyboard.press('Escape');
    await p.goto(`${BASE}#/outing`); await p.waitForTimeout(200);
    const jsLinks = await S(p, () => [...document.querySelectorAll('a[href]')].filter((a) => /^\s*javascript:/i.test(a.getAttribute('href'))).length);
    ok('stored malicious text never runs on any screen, sheet or share card', !(await S(p, () => window.__xss)) && !errors.some((e) => e.startsWith('[xss] DIALOG')));
    ok('a javascript: link from a backup is never rendered as a link', jsLinks === 0, `${jsLinks} links`);
    await p.goto(`${BASE}#/search`); await p.waitForTimeout(300);
    await p.fill('input[type=search], .sr-input, #view input', X); await p.waitForTimeout(600);
    ok('typed malicious text in search is harmless', !(await S(p, () => window.__xss)));
    await p.context().close();
  }

  /* ---------- 6. low-end phone: 4× slower CPU on slow 3G ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 760 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.__noShareMoments = true; });
    watch(p, 'slow');
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('text=先看看範例資料', { timeout: 30000 });
    const firstLoad = Date.now() - t0;
    await p.click('text=先看看範例資料'); await p.waitForSelector('.quick-tile', { timeout: 15000 });
    await p.waitForTimeout(1500); // let the service worker cache everything
    const t1 = Date.now();
    await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('.quick-tile', { timeout: 30000 });
    const repeatLoad = Date.now() - t1;
    const tap = await S(p, () => new Promise((r) => { const t = performance.now(); App.babylog.quickLog('diaper'); requestAnimationFrame(() => r(Math.round(performance.now() - t))); }));
    const t2 = Date.now(); await p.goto(`${BASE}#/stats`); await p.waitForSelector('.stat-tiles, .week-card, .card', { timeout: 15000 }); const statsMs = Date.now() - t2;
    ok(`low-end phone: first load on slow 3G ${(firstLoad / 1000).toFixed(1)} s (< 12 s)`, firstLoad < 12000);
    ok(`low-end phone: reopening ${(repeatLoad / 1000).toFixed(1)} s (offline cache, < 4 s)`, repeatLoad < 4000);
    ok(`low-end phone: one-tap log updates in ${tap} ms (< 400 ms)`, tap < 400);
    ok(`low-end phone: charts open in ${statsMs} ms (< 2.5 s)`, statsMs < 2500);
    await ctx.close();
  }

  /* ---------- 7. long use: memory stays flat ---------- */
  {
    const p = await open({ viewport: { width: 390, height: 844 } }, 'memory');
    await demo(p);
    const cdp = await p.context().newCDPSession(p);
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return S(p, () => performance.memory.usedJSHeapSize); };
    const ids = (await screens(p)).filter((x) => x !== 'monitor');
    const loop = async (n) => { for (let i = 0; i < n; i += 1) { await p.evaluate((id) => { location.hash = `#/${id}`; }, ids[i % ids.length]); await p.waitForTimeout(25); } }; // eslint-disable-line no-await-in-loop
    await loop(ids.length * 2);
    const h0 = await heap();
    await loop(300);
    const h1 = await heap();
    const growMb = (h1 - h0) / 1048576;
    ok(`300 screen switches: memory grows ${growMb.toFixed(1)} MB (< 8 MB)`, growMb < 8);
    await p.context().close();
  }

  /* ---------- 8. skipped the optional fields in onboarding ---------- */
  {
    const p = await open({ viewport: { width: 390, height: 844 } }, 'nodate');
    const bad = /TypeError|undefined|NaN|Invalid Date|\[object Object\]/;
    const sweep = async () => {
      const found = [];
      for (const id of await screens(p)) {
        await S(p, (x) => { location.hash = `#/${x}`; }, id); await p.waitForTimeout(150);
        const txt = await S(p, () => document.getElementById('view').innerText);
        const line = txt.split('\n').find((l) => bad.test(l));
        if (line) found.push(`${id}: ${line.slice(0, 60)}`);
      }
      return found;
    };
    for (const [choice, label] of [['懷孕中', 'pregnant'], ['備孕中', 'trying'], ['育兒中', 'baby']]) {
      await p.goto(BASE); await S(p, () => { localStorage.clear(); }); await p.goto(BASE); await p.waitForTimeout(300);
      await p.click('text=開始使用'); await p.click(`.ob-choice:has-text("${choice}")`).catch(() => {}); await p.waitForTimeout(200);
      const stage = await S(p, () => !!document.querySelector('.ob-q') && document.querySelector('.ob-q').textContent);
      await p.click('text=完成，開始使用'); await p.waitForTimeout(400);
      const before = errors.filter((e) => e.startsWith('[nodate]')).length;
      const found = await sweep();
      const errs = errors.filter((e) => e.startsWith('[nodate]')).slice(before);
      ok(`${label}, every optional field left blank: every screen works`, stage === '基本資料' && !found.length && !errs.length, [stage, ...found, ...errs].slice(0, 3).join(' | '));
    }
    // pregnant without a date → the roadmap asks for the date instead of breaking
    await p.goto(BASE); await S(p, () => { localStorage.clear(); }); await p.goto(BASE); await p.waitForTimeout(300);
    await p.click('text=開始使用'); await p.click('.ob-choice:has-text("懷孕中")'); await p.click('text=完成，開始使用'); await p.waitForTimeout(300);
    await S(p, () => { location.hash = '#/journey'; }); await p.waitForTimeout(300);
    ok('pregnant without a date: roadmap asks for the due date', await p.isVisible('text=還沒設定預產期'));
    await p.click('button:has-text("設定預產期")'); await p.waitForTimeout(300);
    const edd = await S(p, () => Core.dateKey(Core.addDays(new Date(), 100)));
    await p.fill('.sheet input[type=date] >> nth=1', edd); await p.click('.sheet-footer .btn-primary'); await p.waitForTimeout(400);
    const head = await S(p, () => document.querySelector('.jr-hero .big-num').textContent);
    ok('after setting the due date the roadmap shows the week', /懷孕 2[45] 週/.test(head), head);
    await p.context().close();
  }

  ok('no page errors anywhere', !errors.length, errors.slice(0, 4).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.stack); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
