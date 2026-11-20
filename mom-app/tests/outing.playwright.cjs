// 外出好幫手（outing）: packing list from the demo baby's own records, checklist + progress, sharing,
// weekend plans (add / edit / delete / filter / add-from-link), outbound links, home card logic, tool tile,
// dark mode, 320px width and touch-target sizes.
// Usage:  cd mom-app && python3 -m http.server 8080      (another terminal)
//         node tests/outing.playwright.cjs                [BASE=http://localhost:8080/ SHOT_DIR=/tmp/...]
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOT = (process.env.SHOT_DIR || os.tmpdir()) + path.sep;
fs.mkdirSync(SHOT, { recursive: true });
const results = [];
const errors = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: typeof info === 'string' ? info : JSON.stringify(info) });

(async () => {
  const browser = await chromium.launch();
  const newPage = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', ...opts });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
    return p;
  };
  const wait = (p, ms = 250) => p.waitForTimeout(ms);
  // load the app; fall back to injecting the module if index.html does not include it yet
  const load = async (p, hash = '') => {
    await p.goto(BASE + hash);
    await p.waitForFunction(() => window.App && App.store && App.screens);
    const has = await p.evaluate(() => !!App.screens.outing);
    if (!has) {
      await p.addScriptTag({ url: '/js/data/outing-data.js' });
      await p.addScriptTag({ url: '/js/modules/outing.js' });
      await p.addStyleTag({ url: '/css/outing.css' });
    }
    await p.evaluate(() => { App.isNight = () => false; App.applyTheme(); });
    return !has;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, tab) => {
    await S(p, (t) => { location.hash = `#/outing${t ? `?${encodeURIComponent(JSON.stringify({ tab: t }))}` : ''}`; }, tab);
    await wait(p, 200);
    await S(p, () => App.refresh());
    await wait(p, 120);
  };
  const shot = async (p, name, full = false) => { await wait(p, 300); await p.screenshot({ path: `${SHOT}outing-${name}.png`, fullPage: full }); };
  const confirmYes = async (p) => { await p.click('.sheet-footer .btn-primary, .sheet-footer .btn-danger'); await wait(p, 300); };
  const closeSheets = async (p) => { while (await p.isVisible('.sheet')) { await p.keyboard.press('Escape'); await wait(p, 260); } };
  const qty = (p, id) => S(p, (i) => { const x = App.outing.packList().items.find((it) => it.id === i); return x ? x.qty : null; }, id);
  const badText = (p) => S(p, () => ['undefined', 'NaN', 'null', '[object Object]'].filter((w) => document.getElementById('view').innerText.includes(w)));

  /* ================= 1. load + seed demo ================= */
  const p = await newPage();
  const injected = await load(p);
  ok('module available (injected fallback used?)', await S(p, () => !!App.screens.outing && !!App.outing), injected ? 'injected' : 'from index.html');
  await S(p, () => App.demo.seed());
  await wait(p, 400);
  await go(p, 'bag');
  ok('screen title', (await p.textContent('.appbar-title')) === '外出好幫手');
  ok('health tab active', await p.isVisible('.tab.active[href="#/health"]'));
  ok('state.outing created lazily', await S(p, () => Array.isArray(App.store.state.outing.plans) && typeof App.store.state.outing.bag === 'object'));

  /* ================= 2. packing list uses the demo records ================= */
  const basis = await S(p, () => {
    const A = App.outing.analyze();
    const pf = App.predict.feed();
    // independent check: average of the latest 10 bottle feeds (14 days), rounded to 10 ml
    const mls = App.store.babyLogs().filter((l) => l.type === 'bottle' && Date.now() - new Date(l.start) < 14 * Core.DAY)
      .sort((a, b) => new Date(b.start) - new Date(a.start)).map((l) => Number(l.data.ml)).filter((v) => v > 0).slice(0, 10);
    const expectMl = Math.round(mls.reduce((a, b) => a + b, 0) / mls.length / 10) * 10;
    return { diaperGapH: A.diaperGap / Core.HOUR, feedGapH: A.feedGap / Core.HOUR, predGapH: pf.gap / Core.HOUR, mlOwn: A.mlOwn, expectMl, mixKnown: A.mixKnown, formulaN: A.formulaN, breastN: A.breastN, bottleN: A.bottleN };
  });
  ok('analysis found diaper interval + feed gap + bottle ml in demo logs', basis.diaperGapH > 1 && basis.feedGapH > 1 && basis.mlOwn === basis.expectMl, basis);
  ok('每次奶量 tile = average of recent bottles', (await p.textContent('[data-sum="ml"] .ot-sum-val')).includes(String(basis.expectMl)));
  ok('feed gap equals App.predict.feed() gap', Math.abs(basis.feedGapH - basis.predGapH) < 1e-9, basis);
  ok('summary tiles say 依紀錄 (records)', (await p.$$eval('.ot-sum-item [data-src="rec"]', (els) => els.length)) === 3);
  ok('item lines show 依你最近的紀錄估算', await p.isVisible('[data-item="diapers"] .ot-src:has-text("依你最近的紀錄估算")'));
  await shot(p, 'bag');

  const counts = {};
  for (const hrs of [1, 2, 4, 8]) {
    await p.click(`.ot-hour[data-hours="${hrs}"]`); await wait(p, 120);
    const diapers = await qty(p, 'diapers');
    const shown = await p.textContent('[data-sum="diapers"] .ot-sum-val');
    const feeds = await S(p, () => App.outing.packList().feeds);
    counts[hrs] = { diapers, feeds, shown };
    ok(`${hrs}h: diapers = ceil(h / own avg interval) + 1`, diapers === Math.ceil(hrs / basis.diaperGapH) + 1 && shown === `${diapers} 片`, counts[hrs]);
    ok(`${hrs}h: feeds = ceil(h / predicted feed gap)`, feeds === Math.ceil(hrs / basis.predGapH), { feeds, gap: basis.predGapH });
  }
  ok('numbers grow with hours', counts[8].diapers > counts[4].diapers && counts[4].diapers > counts[1].diapers && counts[8].feeds > counts[1].feeds, counts);
  await p.click('.ot-hour[data-hours="4"]'); await wait(p, 120);
  ok('hour radio keeps focus after re-render', await S(p, () => document.activeElement && document.activeElement.dataset.hours === '4'));

  const items4 = await S(p, () => App.outing.packList().items.map((i) => i.id));
  // the feeding items follow the demo baby's own mix of 親餵 / 母乳瓶餵 / 配方奶 (split across the predicted feeds)
  for (const hrs of [4, 8]) {
    await p.click(`.ot-hour[data-hours="${hrs}"]`); await wait(p, 120);
    const mix = await S(p, () => { const L = App.outing.packList(); return { m: L.method, f: L.formulaFeeds, b: L.bmFeeds, br: L.breastFeeds, feeds: L.feeds, ids: L.items.map((i) => i.id) }; });
    const has = (x) => mix.ids.includes(x);
    ok(`${hrs}h: feeding items match own mix`, mix.br + mix.f + mix.b === mix.feeds && has('formula') === mix.f > 0 && has('thermos') === mix.f > 0
      && has('breastmilk') === mix.b > 0 && has('cooler') === mix.b > 0 && has('cover') === (mix.m !== 'bottle') && has('bottles') === (mix.f + mix.b > 0), mix);
  }
  const mix8 = await S(p, () => { const L = App.outing.packList(); return { m: L.method, f: L.formulaFeeds, b: L.bmFeeds }; });
  ok('demo is mixed feeding (formula + breast milk + nursing) on 8h', mix8.m !== 'bottle' && mix8.f > 0 && mix8.b > 0, mix8);
  await p.click('.ot-hour[data-hours="4"]'); await wait(p, 120);
  ok('demo pumps → pump item on 4h outing', items4.includes('pump'));
  ok('documents always present', items4.includes('nhi') && items4.includes('handbook'));
  ok('75-day-old: no solids yet, extra clothes set', !items4.includes('meals') && (await qty(p, 'clothes')) === 3);
  ok('breast-milk line mentions inventory', /庫存有 \d+ ml/.test(await p.textContent('[data-item="breastmilk"] .li-sub')));
  ok('driving → car seat + stroller', items4.includes('carseat') && items4.includes('stroller'));
  await p.click('.ot-transport button:has-text("大眾運輸")'); await wait(p, 150);
  let ids = await S(p, () => App.outing.packList().items.map((i) => i.id));
  ok('public transport → carrier, no car seat', ids.includes('carrier') && !ids.includes('carseat'));
  await p.click('.ot-transport button:has-text("開車")'); await wait(p, 150);

  // weather
  const feedsBefore = await S(p, () => App.outing.packList().feeds);
  await p.click('[data-wx="hot"]'); await wait(p, 150);
  ids = await S(p, () => App.outing.packList().items.map((i) => i.id));
  ok('hot → hat + shade (<6m) + one extra feed', ids.includes('hat') && ids.includes('shade') && (await S(p, () => App.outing.packList().feeds)) === feedsBefore + 1);
  await p.click('[data-wx="cold"]'); await wait(p, 150);
  const wx = await S(p, () => App.store.state.outing.bag.weather);
  ok('cold switches hot off', wx.cold && !wx.hot, wx);
  await p.click('[data-wx="rain"]'); await wait(p, 150);
  ids = await S(p, () => App.outing.packList().items.map((i) => i.id));
  ok('cold + rain items', ids.includes('coat') && ids.includes('raincover'));
  await p.click('[data-wx="cold"]'); await p.click('[data-wx="rain"]'); await wait(p, 150);

  // overnight
  await p.click('.ot-hour[data-hours="night"]'); await wait(p, 150);
  ok('overnight shows nights control', await p.isVisible('.ot-nights'));
  await p.click('[data-nights="plus"]'); await wait(p, 150);
  const night = await S(p, () => { const L = App.outing.packList(); return { h: L.hours, ids: L.items.map((i) => i.id), d: L.diapers }; });
  ok('2 nights = 48h with overnight items', night.h === 48 && night.ids.includes('pajamas') && night.ids.includes('brush') && night.d === Math.ceil(48 / basis.diaperGapH) + 1, night);
  await p.click('.ot-hour[data-hours="4"]'); await wait(p, 150);

  // age fallback: a second baby with no logs
  const fb = await S(p, () => {
    const keep = App.store.state.activeBabyId;
    App.store.addBaby({ name: '測試寶', birthday: Core.dateKey(Core.addDays(new Date(), -250)) });
    const L = App.outing.packList({ hours: 4, transport: 'car', weather: {}, custom: [] });
    const out = { src: L.summary.map((s) => s.src), ids: L.items.map((i) => i.id), diapers: L.diapers, basis: App.outing.basisText(L) };
    App.store.update((s) => { s.babies = s.babies.filter((b) => b.name !== '測試寶'); s.activeBabyId = keep; });
    return out;
  });
  ok('no records → 依月齡建議 fallback', fb.src.every((s) => s === 'age') && /還沒有足夠的紀錄/.test(fb.basis), fb);
  ok('8-month-old → 副食品 items', fb.ids.includes('meals') && fb.ids.includes('spoon'), fb.ids.join(','));

  // meds in the last 14 days → med line (and never in share text)
  await S(p, () => App.store.addLog({ type: 'med', data: { name: '測試藥水', dose: '2 ml' } }));
  await go(p, 'bag');
  ok('recent med log → med item', await p.isVisible('[data-item="meds"]:has-text("測試藥水")'));
  ok('share text hides medicine names', await S(p, () => { const t = App.outing.bagShareText(App.outing.packList()); return !t.includes('測試藥水') && t.includes('寶寶的常用藥'); }));

  /* ================= 3. checklist + progress ================= */
  const total = await S(p, () => App.outing.packList().items.length);
  const boxes = p.locator('.ot-item input[type=checkbox]');
  for (let i = 0; i < 3; i += 1) { await boxes.nth(i).check(); await wait(p, 100); }
  ok('progress shows 3/N', (await p.textContent('[data-progress]')) === `3/${total}`, await p.textContent('[data-progress]'));
  ok('checkbox keeps focus after re-render', await S(p, () => document.activeElement && document.activeElement.type === 'checkbox' && document.activeElement.checked));
  ok('checked state stored', (await S(p, () => Object.keys(App.store.state.outing.bag.checked).length)) === 3);
  // custom item
  await p.fill('.ot-custom input', '寶寶的小毯子'); await p.click('.ot-custom button'); await wait(p, 200);
  ok('custom item added', await p.isVisible('.ot-item:has-text("寶寶的小毯子")'));
  await p.click('.ot-item:has-text("寶寶的小毯子") .ot-icon'); await wait(p, 200);
  ok('custom item removed', !(await p.isVisible('.ot-item:has-text("寶寶的小毯子")')));

  // share: App.share sheet if present, else direct LINE link
  const hasShare = await S(p, () => !!(App.share && App.share.open));
  await S(p, () => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  let lineUrl;
  if (hasShare) {
    await p.click('.ot-bag-share'); await wait(p, 400);
    ok('share sheet opens with LINE channel', await p.isVisible('.sheet .sh-line'));
    await shot(p, 'share-sheet');
    await p.click('.sheet .sh-line'); await wait(p, 300);
    lineUrl = await S(p, () => window.__opened.find((u) => u.startsWith('https://line.me/R/share?text=')));
    await closeSheets(p);
  } else {
    lineUrl = await p.getAttribute('.ot-bag-share', 'href');
  }
  const lineText = lineUrl ? decodeURIComponent(lineUrl.replace('https://line.me/R/share?text=', '')) : '';
  ok('LINE share URL built with the checklist', /^https:\/\/line\.me\/R\/share\?text=/.test(lineUrl || '') && lineText.includes('外出包清單') && lineText.includes('☑') && lineText.includes('☐ ') && /尿布 \d+ 片/.test(lineText), lineText.slice(0, 80));
  // direct-LINE fallback when App.share is missing
  const fallbackHref = await S(p, () => {
    const keep = App.share; App.share = undefined; App.refresh();
    const a = document.querySelector('a.ot-bag-share');
    const out = a ? { href: a.getAttribute('href'), target: a.target, rel: a.rel } : null;
    App.share = keep; App.refresh();
    return out;
  });
  ok('fallback: direct LINE link (new tab, noopener)', fallbackHref && fallbackHref.href.startsWith('https://line.me/R/share?text=') && fallbackHref.target === '_blank' && /noopener/.test(fallbackHref.rel), fallbackHref);

  // finish check → confirm → all checked
  await p.click('.ot-finish'); await wait(p, 300);
  ok('finish asks about unchecked items', await p.isVisible('.sheet:has-text("項沒勾")'));
  await confirmYes(p);
  const after = await S(p, () => ({ n: Object.keys(App.store.state.outing.bag.checked).length, doneAt: App.store.state.outing.bag.doneAt }));
  ok('出門前檢查完畢 → all checked + doneAt', after.n === total && !!after.doneAt, after);
  ok('progress N/N + done line', (await p.textContent('[data-progress]')) === `${total}/${total}` && await p.isVisible('.ot-done-at'));
  await shot(p, 'bag-done', true);
  await p.click('.ot-reset'); await wait(p, 300); await confirmYes(p);
  ok('reset clears checks', (await S(p, () => Object.keys(App.store.state.outing.bag.checked).length)) === 0 && (await p.textContent('[data-progress]')) === `0/${total}`);
  ok('no undefined/NaN text (bag)', (await badText(p)).length === 0, await badText(p));

  /* ================= 4. weekend plans ================= */
  await p.click('.ot-tabs button:has-text("週末計畫")'); await wait(p, 200);
  ok('plans tab via seg (hash updated)', await S(p, () => location.hash.includes('plans')));
  ok('empty state explains how to add', await p.isVisible('.empty:has-text("複製連結")'));
  ok('appbar + button on plans tab', await p.isVisible('.appbar-actions [aria-label="新增計畫"]'));
  await shot(p, 'plans-empty');

  const dates = await S(p, () => ({
    tomorrow: Core.dateKey(Core.addDays(new Date(), 1)),
    in10: Core.dateKey(Core.addDays(new Date(), 10)),
    in2: Core.dateKey(Core.addDays(new Date(), 2)),
    sat: App.outing.weekendRange()[0],
    yesterday: Core.dateKey(Core.addDays(new Date(), -1)),
  }));
  // add from a pasted share text (test data only; example.com is a reserved test domain)
  await p.fill('.ot-paste input', '週末親子手作課（測試）\nhttps://example.com/event/123');
  await p.click('.ot-paste-go'); await wait(p, 350);
  ok('paste → sheet with url + title prefilled', (await p.inputValue('.sheet input[name="url"]')) === 'https://example.com/event/123' && (await p.inputValue('.sheet input[name="title"]')) === '週末親子手作課（測試）');
  await p.fill('.sheet input[name="date"]', dates.tomorrow);
  await p.fill('.sheet input[name="time"]', '10:30');
  await p.fill('.sheet input[name="place"]', '測試親子館');
  await p.click('.sheet .ot-seg-indoor button:has-text("室內")');
  await p.click('.sheet .ot-seg-fee button:has-text("免費")');
  await p.selectOption('.sheet select[name="ageMin"]', '0');
  await p.selectOption('.sheet select[name="ageMax"]', '24');
  await shot(p, 'plan-sheet');
  await p.click('.sheet .ot-save'); await wait(p, 400);
  ok('plan 1 saved', (await S(p, () => App.store.state.outing.plans.length)) === 1);

  const addPlan = async (fields) => {
    await p.click('.ot-add'); await wait(p, 350);
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'indoor') await p.click(`.sheet .ot-seg-indoor button:has-text("${v}")`);
      else if (k === 'fee') await p.click(`.sheet .ot-seg-fee button:has-text("${v}")`);
      else if (k === 'needSignup') await p.check('.sheet input[name="needSignup"]');
      else if (k === 'ageMin' || k === 'ageMax') await p.selectOption(`.sheet select[name="${k}"]`, v);
      else await p.fill(`.sheet [name="${k}"]`, v);
    }
    await p.click('.sheet .ot-save'); await wait(p, 400);
  };
  await addPlan({ title: '公園野餐（測試）', date: dates.in10, indoor: '戶外', fee: '付費', needSignup: true, signupBy: dates.in2 });
  await addPlan({ title: '週末說故事（測試）', date: dates.sat, indoor: '室內', ageMin: '36' });
  await addPlan({ title: '上週的活動（測試）', date: dates.yesterday });
  // invalid link rejected
  await p.click('.ot-add'); await wait(p, 350);
  ok('報名截止日 hidden until 需要事先報名 is checked', !(await p.isVisible('.sheet input[name="signupBy"]')));
  await p.fill('.sheet input[name="title"]', '壞連結');
  await p.fill('.sheet input[name="url"]', 'javascript:alert(1)');
  await p.click('.sheet .ot-save'); await wait(p, 300);
  ok('javascript: URL rejected', (await p.isVisible('.sheet')) && (await S(p, () => App.store.state.outing.plans.length)) === 4);
  await closeSheets(p);
  ok('cleanUrl only keeps http(s)', await S(p, () => App.outing.cleanUrl('javascript:alert(1)') === '' && App.outing.cleanUrl('hhz.tw') === 'https://hhz.tw/' && App.outing.cleanUrl('看這個 https://example.com/a?b=1 好玩') === 'https://example.com/a?b=1'));

  const visibleTitles = () => p.$$eval('.ot-plan:not(.past) .ot-plan-title', (els) => els.map((e) => e.textContent));
  let titles = await visibleTitles();
  const byDate = await S(p, () => App.store.state.outing.plans.filter((x) => x.date >= Core.dateKey()).sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99'))).map((x) => x.title));
  ok('3 upcoming plans sorted by date, past one separate', titles.length === 3 && JSON.stringify(titles) === JSON.stringify(byDate) && titles[2] === '公園野餐（測試）' && await p.isVisible('.ot-plan.past:has-text("上週的活動")'), titles);
  ok('signup deadline tag (2 days left)', await p.isVisible('.ot-plan:has-text("公園野餐") .tag:has-text("報名剩 2 天")'));
  ok('age tag warns when baby too young', await p.isVisible('.ot-plan:has-text("週末說故事") .tag.warn:has-text("3 歲以上")'));
  const open = await p.$eval('.ot-plan:has-text("週末親子手作課") .ot-open', (a) => ({ href: a.href, target: a.target, rel: a.rel, text: a.textContent }));
  ok('查看活動詳情 opens link in new tab (noopener)', open.href === 'https://example.com/event/123' && open.target === '_blank' && /noopener/.test(open.rel), open);
  ok('place links to Google Maps search', /^https:\/\/www\.google\.com\/maps\/search\//.test(await p.getAttribute('.ot-plan:has-text("週末親子手作課") .ot-place', 'href')));
  await shot(p, 'plans');
  await shot(p, 'plans-full', true);

  // filters
  const filterCount = async (id) => {
    await p.click(`[data-filter="${id}"]`); await wait(p, 150);
    const t = await visibleTitles();
    await p.click(`[data-filter="${id}"]`); await wait(p, 150);
    return t;
  };
  let t = await filterCount('indoor');
  ok('filter 室內', t.length === 2 && t.every((x) => /手作課|說故事/.test(x)), t);
  t = await filterCount('free');
  ok('filter 免費', t.length === 1 && t[0].includes('手作課'), t);
  t = await filterCount('nosignup');
  ok('filter 不需報名', t.length === 2 && !t.some((x) => x.includes('野餐')), t);
  t = await filterCount('age');
  ok('filter 適合寶寶月齡 (75-day-old excludes 3 歲以上)', t.length === 2 && !t.some((x) => x.includes('說故事')), t);
  const expectWeekend = await S(p, () => App.outing.upcoming().filter((x) => App.outing.isThisWeekend(x)).map((x) => x.title));
  t = await filterCount('weekend');
  ok('filter 本週末', JSON.stringify(t.slice().sort()) === JSON.stringify(expectWeekend.slice().sort()) && t.some((x) => x.includes('說故事')), { t, expectWeekend });
  await p.click('[data-filter="indoor"]'); await p.click('[data-filter="free"]'); await wait(p, 150);
  ok('filters combine (AND)', (await visibleTitles()).length === 1);
  await p.click('[data-filter="indoor"]'); await p.click('[data-filter="free"]'); await wait(p, 150);
  ok('filter chip keeps focus', await S(p, () => document.activeElement && document.activeElement.dataset.filter === 'free'));

  // edit
  await p.click('.ot-plan:has-text("公園野餐") .ot-edit'); await wait(p, 350);
  await p.fill('.sheet input[name="title"]', '河濱野餐（測試）');
  await p.click('.sheet .ot-save'); await wait(p, 400);
  ok('edit updates the card', await p.isVisible('.ot-plan .ot-plan-title:has-text("河濱野餐（測試）")') && (await S(p, () => App.store.state.outing.plans.length)) === 4);
  // share a plan
  await S(p, () => { window.__opened = []; });
  if (hasShare) {
    await p.click('.ot-plan:has-text("河濱野餐") .ot-plan-share'); await wait(p, 400);
    await p.click('.sheet .sh-line'); await wait(p, 300);
    lineUrl = await S(p, () => window.__opened.find((u) => u.startsWith('https://line.me/R/share?text=')));
    await closeSheets(p);
  } else lineUrl = await p.getAttribute('.ot-plan:has-text("河濱野餐") .ot-plan-share', 'href');
  ok('plan share → LINE URL with title + date', !!lineUrl && decodeURIComponent(lineUrl).includes('河濱野餐（測試）') && decodeURIComponent(lineUrl).includes('📅'));
  // delete + undo + delete
  await p.click('.ot-plan:has-text("河濱野餐") .ot-del'); await wait(p, 300); await confirmYes(p);
  ok('delete removes plan', (await S(p, () => App.store.state.outing.plans.length)) === 3);
  await p.click('.toast-action'); await wait(p, 300);
  ok('復原 restores plan', (await S(p, () => App.store.state.outing.plans.length)) === 4);
  await p.click('.ot-plan:has-text("河濱野餐") .ot-del'); await wait(p, 300); await confirmYes(p);
  ok('delete again', (await S(p, () => App.store.state.outing.plans.length)) === 3);
  ok('no undefined/NaN text (plans)', (await badText(p)).length === 0, await badText(p));

  /* ================= 5. outbound links ================= */
  await p.click('.ot-tabs button:has-text("找活動與設施")'); await wait(p, 200);
  const links = await p.$$eval('.ot-link', (as) => as.map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })));
  ok('HHZ.TW link', links.some((l) => l.href === 'https://hhz.tw'));
  ['哺乳室', '親子館', '兒科診所'].forEach((q) => ok(`Google Maps search: ${q}`, links.some((l) => l.href === `https://www.google.com/maps/search/${encodeURIComponent(q)}`)));
  ok('all links new tab + noopener', links.length >= 4 && links.every((l) => l.target === '_blank' && /noopener/.test(l.rel)), links.length);
  ok('external-site note shown', await p.isVisible('.ot-ext-note:has-text("外部網站")'));
  await shot(p, 'find');

  /* ================= 6. home card + tool tile ================= */
  const logic = await S(p, () => {
    const keep = JSON.parse(JSON.stringify(App.store.state.outing.plans));
    App.store.update((s) => { s.outing.plans = [{ id: 't1', title: 'x', date: '2026-11-19' }]; });
    const r = {
      wedWithPlanTomorrow: App.outing.shouldShowHome(new Date(2026, 10, 18, 10)),
      monPlanIn10Days: App.outing.shouldShowHome(new Date(2026, 10, 9, 10)),
      fri: App.outing.shouldShowHome(new Date(2026, 10, 20, 10)),
      sat: App.outing.shouldShowHome(new Date(2026, 10, 21, 10)),
      sun: App.outing.shouldShowHome(new Date(2026, 10, 22, 10)),
    };
    App.store.update((s) => { s.outing.plans = []; });
    r.tueNoPlans = App.outing.shouldShowHome(new Date(2026, 10, 17, 10));
    App.store.update((s) => { s.outing.plans = keep; });
    return r;
  });
  ok('home logic: plan within 3 days shows card', logic.wedWithPlanTomorrow && !logic.monPlanIn10Days, logic);
  ok('home logic: Fri/Sat/Sun always, weekday without plans hidden', logic.fri && logic.sat && logic.sun && !logic.tueNoPlans, logic);
  await S(p, () => App.navigate('home')); await wait(p, 400);
  const nextTitle = await S(p, () => App.outing.upcoming()[0].title);
  ok('home card shows the next plan', await p.isVisible(`[data-card="outing"] .ot-home-plan:has-text("${nextTitle}")`), nextTitle);
  await p.locator('[data-card="outing"]').scrollIntoViewIfNeeded();
  await shot(p, 'home');
  await p.click('[data-card="outing"] button:has-text("準備外出包")'); await wait(p, 400);
  ok('準備外出包 → outing bag tab', await S(p, () => location.hash.startsWith('#/outing') && document.querySelector('.ot-screen').dataset.section === 'bag'));
  await S(p, () => App.navigate('health')); await wait(p, 300);
  ok('tool tile in 工具 group', await p.isVisible('.tile:has-text("外出好幫手")'));
  await p.click('.tile:has-text("外出好幫手")'); await wait(p, 300);
  ok('tile opens outing', await S(p, () => location.hash.startsWith('#/outing')));

  // weekday with no plans → card empty; weekday with a plan tomorrow → card (fixed clock)
  const p2 = await newPage();
  await p2.clock.setFixedTime(new Date(2026, 10, 17, 10, 0)); // Tuesday
  await load(p2);
  await S(p2, () => App.demo.seed()); await wait(p2, 400);
  await S(p2, () => App.refresh()); await wait(p2, 200);
  ok('Tuesday, no plans → no home card', !(await p2.isVisible('[data-card="outing"]')));
  await S(p2, () => App.store.update((s) => { App.outing.ensure(s); s.outing.plans.push({ id: 'w', title: '明天的活動（測試）', date: '2026-11-18', time: '' }); }));
  await wait(p2, 200);
  ok('Tuesday + plan tomorrow → home card', await p2.isVisible('[data-card="outing"]:has-text("明天的活動")'));
  await p2.clock.setFixedTime(new Date(2026, 10, 20, 10, 0)); // Friday
  await S(p2, () => App.store.update((s) => { s.outing.plans = []; }));
  await wait(p2, 200);
  ok('Friday without plans → home card with 找活動', await p2.isVisible('[data-card="outing"] button:has-text("找活動")'));
  // 坐月子 (a baby under 30 days): no 「週末想帶寶寶出門嗎？」, but her own plans still show
  await S(p2, () => App.store.update((s) => { s.babies[0].birthday = Core.dateKey(Core.addDays(new Date(), -10)); }));
  await wait(p2, 200);
  ok('坐月子 (10 days old), Friday without plans → no outing card', !(await p2.isVisible('[data-card="outing"]')));
  await S(p2, () => App.store.update((s) => { s.outing.plans.push({ id: 'n', title: '回診（測試）', date: '2026-11-23', time: '' }); }));
  await wait(p2, 200);
  ok('…her own plan (in 3 days) still shows', await p2.isVisible('[data-card="outing"]:has-text("回診")'));
  await p2.context().close();

  /* ================= 7. dark mode, 320px, touch targets ================= */
  await go(p, 'bag');
  await S(p, () => { App.store.update((s) => { s.settings.theme = 'dark'; }); App.applyTheme(); });
  await shot(p, 'dark');
  await go(p, 'plans');
  await shot(p, 'plans-dark');
  await S(p, () => { App.store.update((s) => { s.settings.theme = 'auto'; }); App.applyTheme(); });
  await p.setViewportSize({ width: 320, height: 700 });
  for (const tab of ['bag', 'plans', 'find']) {
    await go(p, tab);
    const sw = await S(p, () => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
    ok(`320px: no horizontal scroll (${tab})`, sw.sw <= sw.w, sw);
    const small = await S(p, () => {
      const bad = [];
      document.querySelectorAll('.ot-screen button, .ot-screen a, .ot-screen select, .ot-screen .ot-item-main, .ot-screen input:not([type=checkbox])').forEach((e) => {
        const r = e.getBoundingClientRect();
        if (r.width && r.height < 43.5) bad.push(`${e.tagName}.${e.className}:${Math.round(r.height)} ${e.textContent.trim().slice(0, 10)}`);
      });
      return bad;
    });
    ok(`touch targets ≥ 44px (${tab})`, small.length === 0, small.slice(0, 6));
  }
  await go(p, 'bag');
  await shot(p, '320-bag');
  await go(p, 'plans');
  await shot(p, '320-plans');

  ok('no page errors', errors.length === 0, errors.slice(0, 5));
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `  — ${r.info}` : ''}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOT}outing-*.png`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
