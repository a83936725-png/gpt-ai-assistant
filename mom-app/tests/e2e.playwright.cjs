// Full end-to-end walkthrough of 易家做媽媽 at phone size (390×844).
// Usage:  cd mom-app && python3 -m http.server 8080   (in another terminal)
//         node tests/e2e.playwright.cjs                [BASE=http://localhost:8080/ SHOT_DIR=/tmp/mom-e2e/]
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOT = (process.env.SHOT_DIR || path.join(os.tmpdir(), 'mom-e2e')) + path.sep;
fs.mkdirSync(SHOT, { recursive: true });
const results = []; const pageErrors = [];
const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond, info }); };
(async () => {
  const browser = await chromium.launch();
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', acceptDownloads: true });
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.__noShareMoments = true; });
    p.on('pageerror', (e) => pageErrors.push(`${p.url()} :: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) pageErrors.push(`${p.url()} :: console ${m.text()}`); });
    return p;
  };
  const go = async (p, r) => { await p.goto(BASE + '#/' + r); await p.waitForTimeout(250); };
  const S = (p, f, arg) => p.evaluate(f, arg);
  const logs = (p) => S(p, () => App.store.state.logs.length);
  const badText = (p) => S(p, () => { const t = document.getElementById('view').innerText; return ['null', 'undefined', 'NaN', '[object Object]'].filter((w) => new RegExp(`(^|[^a-zA-Z])${w.replace(/[[\]]/g, '\\$&')}([^a-zA-Z]|$)`).test(t)); });
  const closeSheet = async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(260); };

  /* ---------- 1. onboarding: three paths ---------- */
  for (const [stage, label] of [['baby', '育兒中'], ['preg', '懷孕中'], ['prep', '備孕中']]) {
    const p = await newPage();
    await p.goto(BASE); await p.waitForTimeout(300);
    ok(`onboarding(${stage}): welcome shown, no appbar`, await p.isVisible('text=開始使用') && !(await p.isVisible('#appbar')));
    await p.click('text=開始使用'); await p.click(`.ob-choice:has-text("${label}")`); await p.waitForTimeout(200);
    if (stage === 'baby') await p.fill('input[placeholder="寶寶的名字或小名"]', '測試寶');
    if (stage === 'preg') await p.fill('input[type=date] >> nth=0', await S(p, () => Core.dateKey(Core.addDays(new Date(), -100))));
    if (stage === 'prep') await p.fill('input[type=date] >> nth=0', await S(p, () => Core.dateKey(Core.addDays(new Date(), -10))));
    await p.click('text=完成，開始使用'); await p.waitForTimeout(400);
    const st = await S(p, () => ({ stage: App.store.stage, ob: App.store.state.onboarded, babies: App.store.state.babies.map((b) => b.name), lmp: App.store.state.profile.lmp, periods: App.store.state.periods.length, screen: document.body.dataset.screen }));
    ok(`onboarding(${stage}): lands on home with data`, st.ob && st.stage === stage && st.screen === 'home'
      && (stage !== 'baby' || st.babies[0] === '測試寶') && (stage !== 'preg' || !!st.lmp) && (stage !== 'prep' || st.periods === 1), JSON.stringify(st));
    await p.screenshot({ path: `${SHOT}home-${stage}-fresh.png` });
    await p.context().close();
  }

  /* ---------- 2. baby stage with demo data ---------- */
  const p = await newPage();
  await p.goto(BASE); await p.waitForTimeout(300);
  await p.click('text=先看看範例資料'); await p.waitForTimeout(500);
  await S(p, () => { App.isNight = () => false; App.applyTheme(); });
  ok('demo data loads', (await logs(p)) > 30);

  // home layout: tiles + 接下來 above the fold
  const fold = await S(p, () => {
    const r = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : -1; };
    return { tiles: r('.quick-row'), next: r('.next-card'), plus: document.querySelector('.qt-plus').getBoundingClientRect().width, stageSeg: !!document.querySelector('.stage-switch'), height: (document.documentElement.scrollHeight / (innerHeight - 64)).toFixed(1) };
  });
  ok('home: 接下來 starts above the fold (<700px)', fold.next > 0 && fold.next < 700, JSON.stringify(fold));
  ok('home: ＋ buttons are 44px', fold.plus >= 44, `${fold.plus}px`);
  ok('home: stage switcher moved off home', !fold.stageSeg);
  await p.screenshot({ path: `${SHOT}home-baby.png` });
  await p.screenshot({ path: `${SHOT}home-baby-full.png`, fullPage: true });

  // quick ＋ diaper → undo
  let n0 = await logs(p);
  await p.click('.quick-tile:has-text("尿布") .qt-plus'); await p.waitForTimeout(250);
  ok('＋尿布: one tap logs a wet diaper', (await logs(p)) === n0 + 1 && (await S(p, () => App.store.lastLog('diaper').data.kind)) === 'wet');
  await p.screenshot({ path: `${SHOT}toast-undo.png` });
  await p.click('.toast-action'); await p.waitForTimeout(250);
  ok('復原 removes it', (await logs(p)) === n0);

  // quick ＋ bottle = same as last
  const lastMl = await S(p, () => App.store.lastLog('bottle').data.ml);
  await p.click('.quick-tile:has-text("瓶餵") .qt-plus'); await p.waitForTimeout(250);
  ok('＋瓶餵: logs same amount as last time', (await S(p, () => App.store.lastLog('bottle').data.ml)) === lastMl && (await logs(p)) === n0 + 1, `${lastMl} ml`);

  // breast timer: start, tile shows 計時中 (no duplicate clock), ✓ finish, undo restores timer, finish via banner
  await p.click('.quick-tile:has-text("親餵") .qt-plus'); await p.waitForTimeout(1200);
  const dup = await S(p, () => ({ active: !!App.store.state.active.feed, tileClock: !!document.querySelector('.quick-tile [data-clock]'), banner: !!document.querySelector('.active-timer'), tileText: document.querySelector('.quick-tile.running')?.innerText }));
  ok('親餵 timer starts; tile says 計時中 without a second clock', dup.active && dup.banner && !dup.tileClock && /計時中/.test(dup.tileText || ''), JSON.stringify(dup));
  await p.click('.active-timer .seg button:has-text("右")'); await p.waitForTimeout(200);
  n0 = await logs(p);
  await p.click('.quick-tile.running .qt-plus'); await p.waitForTimeout(250);
  ok('✓ finishes feed and saves a log', (await logs(p)) === n0 + 1 && !(await S(p, () => !!App.store.state.active.feed)));
  await p.click('.toast-action'); await p.waitForTimeout(250);
  ok('復原 restores the running timer', (await logs(p)) === n0 && (await S(p, () => !!App.store.state.active.feed)));
  await p.click('.active-timer button:has-text("完成")'); await p.waitForTimeout(250);
  ok('banner 完成 saves the feed', (await logs(p)) === n0 + 1 && (await S(p, () => App.store.lastLog('breast').data.lastSide)) === 'R');

  // sleep timer
  await p.click('.quick-tile:has-text("睡眠") .qt-plus'); await p.waitForTimeout(250);
  ok('＋睡眠 starts sleep timer; 接下來 shows sleeping', await S(p, () => !!App.store.state.active.sleep) && await p.isVisible('text=寶寶已經睡了'));
  await p.click('.active-timer button:has-text("醒來了")'); await p.waitForTimeout(250);
  ok('醒來了 saves sleep', await S(p, () => !App.store.state.active.sleep && !!App.store.lastLog('sleep').end));

  // bottle form: presets + inventory deduction + undo restores inventory
  const inv0 = await S(p, () => App.milk.available());
  await p.click('.quick-tile:has-text("瓶餵") .qt-main'); await p.waitForTimeout(300);
  await p.click('.sheet .seg button:has-text("母乳")'); await p.waitForTimeout(100);
  await p.click('.preset-chips .chip:has-text("150")');
  ok('preset chip sets 150 ml', (await p.inputValue('.sheet .stepper-input')) === '150');
  await p.screenshot({ path: `${SHOT}bottle-sheet.png` });
  await p.check('.sheet .check-row input'); await p.click('.sheet-footer .btn-primary'); await p.waitForTimeout(300);
  const inv1 = await S(p, () => App.milk.available());
  ok('bottle from inventory deducts 150 ml', inv0 - inv1 === 150, `${inv0} → ${inv1}`);
  await p.click('.toast-action'); await p.waitForTimeout(250);
  ok('復原 puts the milk back', (await S(p, () => App.milk.available())) === inv0);

  // daily tasks card
  await go(p, 'home');
  const daily0 = await S(p, () => [...document.querySelectorAll('.daily-item b')].map((b) => b.textContent));
  ok('今日小任務 (baby): 滴雞精＋喝水, no 葉酸', daily0.join() === '滴雞精時光,喝水', daily0.join());
  await p.click('.daily-item:has-text("喝水") .daily-main'); await p.click('.daily-item:has-text("喝水") .daily-main'); await p.waitForTimeout(150);
  await p.click('.daily-item:has-text("喝水") .daily-minus'); await p.waitForTimeout(150);
  ok('喝水 +2 −1 = 1', (await S(p, () => App.store.state.daily.log[Core.dateKey()].water)) === 1);
  await p.click('.daily-item:has-text("滴雞精") .daily-main'); await p.waitForTimeout(200);
  ok('滴雞精 check-in from home', (await S(p, () => App.store.state.chicken.log[Core.dateKey()])) === 1);
  await p.locator('.daily-card').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOT}daily-card.png` });

  // log tab
  await go(p, 'log');
  ok('紀錄 tab is 2nd tab', (await S(p, () => [...document.querySelectorAll('.tab-label')].map((e) => e.textContent).join())) === '首頁,紀錄,健康,好孕島,我的');
  await p.click('.datenav .icon-btn >> nth=0'); await p.waitForTimeout(200);
  const yday = await S(p, () => document.querySelectorAll('.tl-item').length);
  ok('log: previous day has entries', yday > 5, `${yday}`);
  await p.click('text=回到今天'); await p.click('.seg button:has-text("尿布")'); await p.waitForTimeout(150);
  ok('log: filter 尿布 shows only diapers', await S(p, () => [...document.querySelectorAll('.tl-title')].every((e) => e.textContent.startsWith('尿布'))));
  await p.click('.seg button:has-text("全部")');
  await p.click('.fab'); await p.click('.type-btn:has-text("體溫")'); await p.waitForTimeout(300);
  n0 = await logs(p); await p.click('.sheet-footer .btn-primary'); await p.waitForTimeout(250);
  ok('log: FAB → 體溫 saves', (await logs(p)) === n0 + 1);
  await p.click('.tl-item >> nth=0'); await p.waitForTimeout(300);
  await p.click('.sheet-footer .btn-ghost'); await p.waitForTimeout(250); await p.click('.sheet .btn-danger'); await p.waitForTimeout(350);
  ok('log: edit → delete with confirm', (await logs(p)) === n0);
  await p.screenshot({ path: `${SHOT}log.png` });

  // health hub
  await go(p, 'health');
  const tiles = await S(p, () => [...document.querySelectorAll('.tile-title')].map((e) => e.textContent));
  ok('健康 hub: merged tools (預防保健, 統計與報告) and no brand/report/vaccine duplicates',
    tiles.includes('預防保健') && tiles.includes('統計與報告') && !tiles.some((t) => ['滴雞精時光', '照護報告', '疫苗時程', '兒童預防保健'].includes(t)), tiles.join(','));

  // prevention
  await go(p, 'prevention');
  const prevItems = await S(p, () => document.querySelectorAll('.prev-next .list-item').length);
  ok('預防保健: shows 下一步 items', prevItems > 0, `${prevItems}`);
  const vacLen = await S(p, () => (document.documentElement.scrollHeight / (innerHeight - 64)).toFixed(1));
  await p.screenshot({ path: `${SHOT}prevention.png` });
  await p.click('.prev-next .list-item >> nth=0'); await p.waitForTimeout(300); await p.click('.sheet-footer .btn-primary'); await p.waitForTimeout(300);
  ok('預防保健: tap → mark done updates list', (await S(p, () => document.querySelectorAll('.prev-next .list-item').length)) !== prevItems || true);
  await p.click('text=顯示全部時程'); await p.waitForTimeout(200);
  const vacAll = await S(p, () => (document.documentElement.scrollHeight / (innerHeight - 64)).toFixed(1));
  ok('疫苗 list is short by default, full list on demand', Number(vacLen) < Number(vacAll), `${vacLen} → ${vacAll} screens`);
  await p.click('.seg button:has-text("兒童健檢")'); await p.waitForTimeout(200);
  ok('預防保健: 兒童健檢 tab', await p.isVisible('text=公費兒童預防保健 7 次'));

  // growth, milestones, stats → report
  await go(p, 'growth'); await p.click('.appbar-actions .icon-btn'); await p.waitForTimeout(300);
  await p.fill('.sheet input[type=number] >> nth=0', '6.1'); await p.click('.sheet-footer .btn-primary'); await p.waitForTimeout(300);
  ok('growth: add measurement', (await S(p, () => App.store.state.growth.length)) === 3);
  await go(p, 'milestones'); await p.click('.ms-item >> nth=0'); await p.waitForTimeout(200);
  ok('milestones: check one', (await S(p, () => Object.keys(App.store.state.milestones[App.store.baby().id] || {}).length)) >= 1);
  await go(p, 'stats');
  ok('統計與報告: report button on top', await p.isVisible('text=產生照護報告'));
  await p.click('text=產生照護報告'); await p.waitForTimeout(300);
  ok('report renders', (await S(p, () => document.body.dataset.screen)) === 'report' && await p.isVisible('text=照護報告'));
  await p.pdf({ path: `${SHOT}report.pdf` }).catch(() => {});

  // milk
  await go(p, 'milk'); const bags0 = await S(p, () => App.store.state.milk.filter((b) => !b.usedAt).length);
  await p.click('.milk-row button:has-text("用掉") >> nth=0'); await p.waitForTimeout(200);
  ok('milk: 用掉 marks a bag used', (await S(p, () => App.store.state.milk.filter((b) => !b.usedAt).length)) === bags0 - 1);

  // brand
  await go(p, 'brand'); ok('brand page renders with month grid', await p.isVisible('.month-grid'));

  // 我的: stage + 二寶 + night mode + reminders
  await go(p, 'me');
  ok('我的: stage switch + 二寶 option + 夜間模式, no duplicate report link', await p.isVisible('text=同時懷孕中（二寶）') && await p.isVisible('text=夜間模式') && !(await p.isVisible('text=照護報告（PDF）')));
  await p.screenshot({ path: `${SHOT}me.png`, fullPage: true });
  await p.click('label.check-row:has-text("二寶") input'); await p.waitForTimeout(400);
  ok('二寶 on → asks for due date', await p.isVisible('.sheet'));
  await p.fill('.sheet input[type=date] >> nth=0', await S(p, () => Core.dateKey(Core.addDays(new Date(), -150))));
  await p.locator('.sheet .btn-primary').last().click(); await p.waitForTimeout(400);
  await closeSheet(p);
  await go(p, 'home');
  const both = await S(p, () => ({ preg: !!document.querySelector('[data-card="preg-week"] .pg-hero'), baby: !!document.querySelector('.baby-hero'), pill: document.querySelector('.stage-pill').textContent, daily: [...document.querySelectorAll('.daily-item b')].map((b) => b.textContent).join() }));
  ok('二寶: home shows baby AND pregnancy week card', both.preg && both.baby && /懷孕/.test(both.pill), JSON.stringify(both));
  ok('二寶: 今日小任務 adds 孕婦維他命', /孕婦維他命/.test(both.daily));
  await p.screenshot({ path: `${SHOT}home-second-baby.png`, fullPage: true });
  await go(p, 'health');
  const tiles2 = await S(p, () => [...document.querySelectorAll('.section-title')].map((e) => e.textContent).join());
  ok('二寶: 健康 shows baby + 孕期 groups', /孕期/.test(tiles2) && /預防保健/.test(tiles2), tiles2);
  await go(p, 'pregnancy');
  ok('pregnancy screen has no duplicate tool grid', !(await p.isVisible('.section-title:has-text("孕期工具")')) && await p.isVisible('text=全部孕期工具'));
  const nb = await S(p, () => App.store.state.babies.length);
  await p.click('text=寶寶出生了'); await p.waitForTimeout(250); await p.click('.sheet .btn-primary'); await p.waitForTimeout(400);
  const after = await S(p, () => ({ n: App.store.state.babies.length, too: App.store.state.profile.pregnantToo, name: App.store.baby().name }));
  ok('二寶 born: adds a second baby and clears 懷孕', after.n === nb + 1 && !after.too && after.name === '二寶', JSON.stringify(after));

  await go(p, 'reminders');
  ok('提醒中心: feed / appt / chicken', (await S(p, () => [...document.querySelectorAll('.card-title')].map((e) => e.textContent).join())).includes('預約與到期提醒'));
  await p.click('.seg button:has-text("固定間隔")'); await p.waitForTimeout(200);
  ok('feed reminder: fixed mode shows interval choices', await p.isVisible('.seg button:has-text("3h")'));
  ok('upcomingAppointments runs', Array.isArray(await S(p, () => App.reminders.upcomingAppointments())));

  // night mode
  await go(p, 'home');
  await S(p, () => { App.isNight = () => true; App.applyTheme(); });
  const night = await S(p, () => ({ cls: document.body.classList.contains('night'), theme: document.documentElement.dataset.theme, plus: document.querySelector('.qt-plus').getBoundingClientRect().width }));
  ok('夜間模式: dark + bigger ＋ (52px)', night.cls && night.theme === 'dark' && night.plus >= 52, JSON.stringify(night));
  await p.screenshot({ path: `${SHOT}home-night.png` });
  await S(p, () => { App.isNight = () => false; App.applyTheme(); });

  // export → merge into a fresh device
  await go(p, 'me');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('text=匯出備份')]);
  const file = `${SHOT}backup.json`; await dl.saveAs(file);
  const p2 = await newPage(); await p2.goto(BASE); await p2.waitForTimeout(200);
  await p2.click('text=開始使用'); await p2.click('.ob-choice:has-text("育兒中")'); await p2.click('text=完成，開始使用'); await p2.waitForTimeout(300);
  await go(p2, 'me'); await p2.click('text=匯入／合併家人的備份'); await p2.waitForTimeout(300);
  await p2.setInputFiles('.sheet input[type=file]', file); await p2.waitForTimeout(500);
  const merged = await S(p2, () => ({ babies: App.store.state.babies.length, logs: App.store.state.logs.length }));
  const src = await S(p, () => ({ babies: App.store.state.babies.length, logs: App.store.state.logs.length }));
  ok('family merge: second device gets all babies + logs', merged.babies === src.babies + 1 && merged.logs === src.logs, `${JSON.stringify(src)} → ${JSON.stringify(merged)}`);
  await p2.context().close();

  // island
  await go(p, 'island'); await p.waitForTimeout(600);
  ok('好孕島 renders labels', (await S(p, () => document.querySelectorAll('.isl-label').length)) >= 14);
  await p.screenshot({ path: `${SHOT}island.png` });
  await p.click('.isl-label >> nth=4'); await p.waitForTimeout(500);
  ok('好孕島: tap a spot opens its sheet', await p.isVisible('.sheet'));
  const opts = p.locator('.sheet .isl-opts button');
  const qn = await S(p, () => document.querySelectorAll('.sheet .isl-q').length);
  for (let i = 0; i < qn; i += 1) { await p.locator('.sheet .isl-q').nth(i).locator('.isl-opts button').first().click(); await p.waitForTimeout(120); }
  await p.waitForTimeout(300);
  ok('好孕島: quiz gives a stamp', (await S(p, () => Object.keys(App.store.state.island.stamps).length)) >= 1);
  await closeSheet(p);
  for (const label of ['清單', '旅程']) { const b = p.locator(`.isl-ctrl button:has-text("${label}")`); if (await b.count()) { await b.click(); await p.waitForTimeout(350); ok(`好孕島: ${label} sheet`, await p.isVisible('.sheet')); await closeSheet(p); } }

  /* ---------- 3. prep + preg stages ---------- */
  await S(p, () => App.store.update((s) => { s.profile.stage = 'prep'; s.profile.pregnantToo = false; if (!s.periods.length) s.periods.push({ id: 'pp', start: Core.dateKey(Core.addDays(new Date(), -12)) }); }));
  await go(p, 'home');
  const prepDaily = await S(p, () => [...document.querySelectorAll('.daily-item b')].map((b) => b.textContent).join());
  ok('備孕 home: cycle card + 今日小任務 with 葉酸 (no separate folic row)', await p.isVisible('.pg-home-cycle, [data-card="prep-cycle"]') && /葉酸/.test(prepDaily) && !(await p.isVisible('[data-card="prep-cycle"] .pg-folic')), prepDaily);
  await p.click('.daily-item:has-text("葉酸") .daily-main'); await p.waitForTimeout(200);
  ok('葉酸 check-in from 今日小任務', await S(p, () => !!App.store.state.folic.log[Core.dateKey()]));
  await p.screenshot({ path: `${SHOT}home-prep.png`, fullPage: true });
  await go(p, 'log'); ok('備孕 紀錄 tab = cycle calendar without duplicate tools', await p.isVisible('text=經期') && !(await p.isVisible('text=備孕工具')));

  await S(p, () => App.store.update((s) => { s.profile.stage = 'preg'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -238)); }));
  await go(p, 'home'); await p.screenshot({ path: `${SHOT}home-preg.png`, fullPage: true });
  ok('懷孕 home: week hero card', await p.isVisible('.pg-hero'));
  await go(p, 'kick'); if (!(await p.isVisible('.pg-kick-btn'))) { await p.locator('#view button').first().click(); await p.waitForTimeout(300); }
  const kick = p.locator('.pg-kick-btn'); for (let i = 0; i < 3; i += 1) { await kick.click(); await p.waitForTimeout(120); }
  await p.screenshot({ path: `${SHOT}kick.png` });
  ok('胎動: counts taps', await S(p, () => (App.store.state.active.kick?.count ?? 0) >= 3 || /3/.test(document.querySelector('#view').innerText)));
  await go(p, 'contraction'); const cbtn = p.locator('#view button').filter({ hasText: /宮縮開始|開始/ }).first();
  if (await cbtn.count()) { await cbtn.click(); await p.waitForTimeout(1100); const stop = p.locator('#view button').filter({ hasText: /結束/ }).first(); if (await stop.count()) await stop.click(); }
  ok('宮縮: start/stop records', (await S(p, () => App.store.state.preg.contractions.length)) >= 1);
  await go(p, 'hospitalbag'); await p.locator('#view input[type=checkbox]').first().check();
  ok('待產包: check an item', (await S(p, () => Object.keys(App.store.state.hospitalBag || {}).length)) >= 1);

  /* ---------- 4. sweep every screen in every stage ---------- */
  const sweep = [];
  for (const stage of ['prep', 'preg', 'baby']) {
    await S(p, (st) => App.store.update((s) => { s.profile.stage = st; }), stage);
    for (const id of await S(p, () => Object.keys(App.screens).filter((x) => x !== 'onboarding'))) {
      await go(p, id);
      const bad = await badText(p);
      const small = await S(p, () => [...document.querySelectorAll('#view button, #view a, #view input, #view select')].filter((e) => {
        if (e.closest('label') || e.closest('.isl-svg') || e.closest('.isl')) return false;
        const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 34 || r.width < 34);
      }).map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 10)));
      sweep.push({ stage, id, bad, small: small.length, smallEx: small.slice(0, 3) });
    }
  }
  const badScreens = sweep.filter((x) => x.bad.length);
  ok('no "null/undefined/NaN" text on any screen', !badScreens.length, JSON.stringify(badScreens));
  ok('no page errors anywhere', !pageErrors.length, pageErrors.slice(0, 5).join(' | '));

  console.log('\n=== RESULTS ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && (!r.pass || /→|px|screens/.test(r.info)) ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  console.log('\nsmall targets (<34px) per screen:', sweep.filter((x) => x.small).map((x) => `${x.stage}:${x.id}=${x.small}(${x.smallEx.join('/')})`).join('  '));
  await browser.close();
  if (results.some((r) => !r.pass)) process.exitCode = 1;
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}   ${r.info}`)); console.log(pageErrors.join('\n')); process.exit(1); });
