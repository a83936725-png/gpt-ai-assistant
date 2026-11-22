// 限時團購 on 好孕島 (js/modules/groupbuy.js): a column of small tiles down the left side of the island map — one per
// group-buy open now (限時, the discount), her team (揪團中, how many so far), 成團了 — each with a countdown that ticks
// every second (red in the last hour); a tap opens 「正在開團」 at that group-buy, with a big countdown per group-buy,
// 開一團, the team's own countdown, and 成團. Only as many tiles as fit; ‹ tucks them for the day; a phone on its side
// shows none. With 範例資料 and no member service (the web preview), three sample group-buys can be tried; they never
// reach 首頁. Sizes, dark, less motion and accessibility checked.
// Usage: cd mom-app && python3 -m http.server 8080   then   BASE=http://localhost:8080/ node tests/groupbuy-rail.playwright.cjs
//        AXE_PATH=<axe.min.js> for the accessibility checks (a static host: no member service)
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8080/';
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const NOW = '2026-11-22T14:19:03+08:00'; // Sunday afternoon in Taiwan

(async () => {
  const b = await chromium.launch();
  const ctxs = [];
  const mk = async ({ width = 390, height = 844, time = NOW, scheme = 'light', motion = 'no-preference', sample = true, apiDown = false, apiStatus = 0 } = {}) => {
    const c = await b.newContext({ viewport: { width, height }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', colorScheme: scheme, reducedMotion: motion });
    ctxs.push(c);
    await c.clock.install({ time: new Date(time) });
    await c.addInitScript(() => { window.__noShareMoments = true; window.open = () => null; });
    // a real member service that can't be reached right now (offline): the API calls fail without an answer
    if (apiDown) await c.addInitScript(() => { const f = window.fetch.bind(window); window.fetch = (u, o) => (/\/api\//.test(String(u)) ? Promise.reject(new TypeError('Failed to fetch')) : f(u, o)); });
    // a host that answers the API address with a plain page (403: a static host; 503: a real service having trouble)
    if (apiStatus) await c.route('**/api/**', (route) => route.fulfill({ status: apiStatus, contentType: 'text/html', body: '<html><body>no</body></html>' }));
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE);
    await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.groupbuy);
    if (sample) {
      await p.click('text=先看看範例資料'); await p.waitForTimeout(900);
    } else {
      await p.evaluate(() => {
        const s = App.store.defaults(); s.onboarded = true; s.onboardedAt = '2026-01-01'; s.profile.stage = 'baby'; s.profile.momName = '小美';
        s.babies = [{ id: 'b1', name: '小湯圓', sex: 'girl', birthday: Core.dateKey(Core.addDays(new Date(), -60)), avatar: '👶' }]; s.activeBabyId = 'b1';
        App.store.replace(s);
      });
    }
    await p.evaluate(() => {
      App.isNight = () => false; App.applyTheme();
      App.store.update((s) => { s.settings.a2hsDismissed = '1'; s.island = { ...(s.island || {}), coachDone: true }; });
    });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, screen, params, ms = 1300) => { await S(p, ([x, prm]) => App.navigate(x, prm || null), [screen, params]); await p.waitForTimeout(ms); };
  const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: `${SHOT}${name}.png` }); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const tiles = (p) => S(p, () => [...document.querySelectorAll('.isl .gb-rail .gbr-tile')].filter((t) => !t.hidden).map((t) => ({
    kind: t.dataset.kind, c: t.dataset.c, rib: (t.querySelector('.gbr-rib') || {}).textContent, badge: (t.querySelector('.gbr-badge') || {}).textContent || '',
    chip: t.querySelector('.gbr-chip').textContent, soon: t.querySelector('.gbr-chip').classList.contains('soon'), label: t.getAttribute('aria-label'),
  })));
  const flat = (p, sel) => S(p, (x) => (document.querySelector(x) || {}).innerText || '', sel).then((t) => t.replace(/\s+/g, ''));

  /* ---------- 首頁 stays as it was ---------- */
  const P = await mk();
  ok('首頁 (範例資料, no member service): no tiles and no sample group-buy card', await S(P, () => !document.querySelector('.gb-rail') && !document.querySelector('[data-card="groupbuy"]')));

  /* ---------- 好孕島: the column ---------- */
  await go(P, 'island', null, 1600);
  await P.waitForFunction(() => (document.querySelector('.gbr-tile[data-c="sample-gift"] .gbr-rib') || {}).textContent === '差1人', null, { timeout: 5000 }).catch(() => {});
  await P.clock.pauseAt(new Date('2026-11-22T14:19:10+08:00')); await P.clock.runFor(1000); // 14:19:11, held still
  let t = await tiles(P);
  ok('好孕島: three tiles down the left side, the group-buy ending soonest first', t.length === 3 && t.map((x) => x.c).join() === 'sample-gift,sample-drip,sample-set' && t.every((x) => x.kind === 'new'), JSON.stringify(t));
  ok('…限時 with the discount; 差1人 (red) when another mom\'s team needs just one more', t.map((x) => `${x.rib}${x.badge}`).join() === '差1人,限時-18%,限時-15%', JSON.stringify(t));
  ok('…each with a countdown: 07:40:49 (today 22:00), 53:40:49 (past 24 hours, like a game timer), 剩 6 天', t.map((x) => x.chip).join() === '07:40:49,53:40:49,剩 6 天', JSON.stringify(t));
  ok('…a screen reader hears what, the price, how long is left, and that a team is one short', /^限時團購：月子禮盒（範例），團購價 NT\$3,280，還剩 7 小時 40 分，有一團只差 1 人$/.test(t[0].label), t[0].label);
  const place = await S(P, () => { const r = document.querySelector('.isl .gb-rail').getBoundingClientRect(); const hud = document.querySelector('.isl-hud').getBoundingClientRect(); const heart = document.querySelector('.isl-heart-badge'); const hb = heart && heart.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom), hudBottom: Math.round(hud.bottom), heartTop: hb ? Math.round(hb.top) : null }; });
  ok('…on the left edge, below the island card and above the 💜 chip', place.left <= 12 && place.top > place.hudBottom && (place.heartTop === null || place.bottom < place.heartTop), JSON.stringify(place));
  await P.clock.runFor(3000);
  t = await tiles(P);
  ok('…the countdowns tick every second (3 seconds later: 07:40:46)', t[0].chip === '07:40:46' && t[1].chip === '53:40:46', JSON.stringify(t.map((x) => x.chip)));
  await P.clock.resume();
  await shot(P, 'island');
  await axe(P, '好孕島 with the tiles');
  const drag = await S(P, () => getComputedStyle(document.querySelector('.isl .gb-rail')).pointerEvents);
  ok('…the gaps between tiles let the map be dragged (only the tiles take taps)', drag === 'none');

  /* ---------- a tap: 正在開團 at that group-buy ---------- */
  await P.click('.gbr-tile[data-c="sample-drip"]'); await P.waitForTimeout(1500);
  const page = await S(P, () => {
    const f = document.querySelector('.gb-deal.focus'); const r = f && f.getBoundingClientRect();
    return {
      screen: document.body.dataset.screen, focus: f && f.dataset.c, inView: !!r && r.top >= 0 && r.top < innerHeight, cards: [...document.querySelectorAll('.gb-deal')].map((x) => x.dataset.c),
      hero: (document.querySelector('.gb-hero') || {}).innerText || '', note: !!document.querySelector('.gb-sample-note'),
    };
  });
  ok('tap the 滴雞精 tile → 「正在開團」, scrolled to that group-buy, which glows', page.screen === 'groupbuy' && page.focus === 'sample-drip' && page.inView && /正在開團/.test(page.hero), JSON.stringify(page));
  ok('…all three, ending soonest first, and a note that these are samples', page.cards.join() === 'sample-gift,sample-drip,sample-set' && page.note, JSON.stringify(page));
  const deal = (c) => flat(P, `.gb-deal[data-c="${c}"]`);
  const meta = (c) => S(P, (x) => document.querySelector(`.gb-deal[data-c="${x}"] .gb-meta`).textContent, c);
  const gift = await deal('sample-gift'); const drip = await deal('sample-drip');
  ok('…月子禮盒: price, 省 NT$600, a big countdown 07時40分 (no 天 under a day), 活動到 11/22 22:00',
    /團購價NT\$3,280原價NT\$3,880省NT\$600/.test(gift) && /距離團購結束07時40分\d\d秒/.test(gift) && (await meta('sample-gift')) === '5 人成團・開團後 24 小時內湊齊・活動到 11/22 22:00', gift);
  ok('…滴雞精: 2 天 05 時 40 分, 活動到 11/24 20:00; 常備組: 活動到 11/28 (the whole day)', /距離團購結束2天05時40分\d\d秒/.test(drip)
    && (await meta('sample-drip')).endsWith('活動到 11/24 20:00') && (await meta('sample-set')).endsWith('活動到 11/28'), `${drip} | ${await meta('sample-set')}`);
  ok('…正在開團 totals (labelled 範例數字 in the samples)', /4團開過・13位媽媽參加・2團已成團（範例數字）/.test(gift), gift);
  await P.evaluate(() => window.scrollTo(0, 0)); await P.waitForTimeout(200);
  await shot(P, 'page');
  await axe(P, '正在開團 page');

  /* ---------- 開一團 ---------- */
  await P.click('.gb-deal[data-c="sample-gift"] .gb-start'); await P.waitForTimeout(700);
  const sheet = await flat(P, '.sheet');
  ok('開一團: what she starts (price), three steps, the team name (her name), and that it stays on this phone',
    /開一團/.test(sheet) && /月子禮盒（範例）/.test(sheet) && /🛒開團現在/.test(sheet) && /💬邀朋友活動結束前湊5人/.test(sheet) && /🎉成團每人拿折扣碼/.test(sheet)
    && (await P.inputValue('.sheet input[aria-label="團名"]')) === '小美' && /這是範例團購：開團只存在這支手機，不會送出/.test(sheet), sheet);
  ok('…the team can\'t outlast the group-buy: it says so', /這個團購活動到11\/2222:00，這一團最晚也到那時/.test(sheet), sheet);
  await shot(P, 'open-sheet');
  await axe(P, '開一團 sheet');
  await P.click('.gb-start-go'); await P.waitForTimeout(1500);
  const team = await flat(P, '#view');
  const toast = await flat(P, '.toast-wrap');
  ok('開團 → her team: 已 1／5 人, its own big countdown (07時40分, to the group-buy\'s end), 模擬朋友跟團',
    /小美的團/.test(team) && /已1／5人/.test(team) && /這一團還剩07時40分\d\d秒/.test(team) && await P.isVisible('.gb-sim'), team);
  ok('…「開團成功（範例）」, and no share sheet for a sample team', /開團成功（範例）/.test(toast) && !(await P.isVisible('.sheet')), toast);
  await P.click('.gb-line'); await P.waitForTimeout(400);
  ok('…邀請朋友 on a sample team says it can\'t be sent yet', /這是範例團購，正式上線後才能邀請朋友/.test(await flat(P, '.toast-wrap')) && !(await P.isVisible('.sheet')));
  await shot(P, 'team');
  await axe(P, 'her team page');

  /* ---------- back on the island: 揪團中 ---------- */
  await go(P, 'island', null, 1500);
  t = await tiles(P);
  ok('好孕島: her team first — 揪團中, 1/5, its countdown', t[0] && t[0].kind === 'mine' && t[0].rib === '揪團中' && t[0].badge === '1/5' && /^07:40:\d\d$/.test(t[0].chip) && t.length === 3, JSON.stringify(t));
  ok('…and the screen reader hears how many so far', /^我的團：月子禮盒（範例），已 1／5 人，還剩 7 小時 4\d 分$/.test(t[0].label), t[0].label);
  await P.clock.fastForward('07:11:00'); await P.waitForTimeout(1300); // 21:30
  t = await tiles(P);
  ok('21:30: the last half hour of her team — the countdown turns red', t[0].kind === 'mine' && /^00:29:\d\d$/.test(t[0].chip) && t[0].soon, JSON.stringify(t[0]));
  await shot(P, 'island-mine');

  /* ---------- 成團 ---------- */
  await P.click('.gbr-tile.k-mine'); await P.waitForTimeout(1300);
  for (let i = 0; i < 6 && await P.isVisible('.gb-sim'); i += 1) { await P.click('.gb-sim'); await P.waitForTimeout(700); }
  const done = await flat(P, '.gb-actions');
  ok('模擬朋友跟團 four times → 成團了（範例）, the sample code and its note', /🎉成團了！（範例）/.test(done) && /SAMPLE-0000/.test(done) && /範例折扣碼，不能真的使用/.test(done), done);
  await go(P, 'island', null, 1500);
  t = await tiles(P);
  ok('…the island no longer points at that group-buy (code seen); the other two stay', t.map((x) => x.c).join() === 'sample-drip,sample-set', JSON.stringify(t));

  /* ---------- ‹ tucks it away for the day ---------- */
  await P.click('.gbr-tuck'); await P.waitForTimeout(400);
  const tucked = await S(P, () => { const r = document.querySelector('.isl .gb-rail'); const tab = r.querySelector('.gbr-tab'); return { tucked: r.classList.contains('tucked'), tab: tab && getComputedStyle(tab).display !== 'none', n: (r.querySelector('.gbr-tab-n') || {}).textContent, tiles: [...r.querySelectorAll('.gbr-tile')].some((x) => x.offsetParent) }; });
  ok('‹: only the 🛒 tab with the count stays, and a note when it comes back', tucked.tucked && tucked.tab && tucked.n === '2' && !tucked.tiles && /明天再出現/.test(await flat(P, '.toast-wrap')), JSON.stringify(tucked));
  await shot(P, 'island-tucked');
  await P.click('.gbr-tab'); await P.waitForTimeout(1200);
  ok('…the tab opens 正在開團', (await S(P, () => document.body.dataset.screen)) === 'groupbuy');
  await go(P, 'island', null, 1300);
  ok('…the same day it stays tucked', await S(P, () => document.querySelector('.isl .gb-rail').classList.contains('tucked')));
  await P.clock.fastForward('24:00:00'); await go(P, 'home', null, 300); await go(P, 'island', null, 1500);
  ok('…the next day the tiles are back', !(await S(P, () => document.querySelector('.isl .gb-rail').classList.contains('tucked'))) && (await tiles(P)).length >= 2);

  /* ---------- sizes ---------- */
  const small = await mk({ width: 375, height: 667 });
  await go(small, 'island', null, 1600);
  const sm = await S(small, () => { const r = document.querySelector('.isl .gb-rail'); const vis = [...r.querySelectorAll('.gbr-tile')].filter((x) => !x.hidden); const last = vis[vis.length - 1].getBoundingClientRect(); const heart = document.querySelector('.isl-heart-badge'); return { n: vis.length, peek: r.classList.contains('peek'), lastBottom: Math.round(last.bottom + 14), heartTop: heart ? Math.round(heart.getBoundingClientRect().top) : 9999 }; });
  ok('375×667: two tiles fit above the 💜 chip (the third waits on 正在開團)', sm.n === 2 && !sm.peek && sm.lastBottom < sm.heartTop, JSON.stringify(sm));
  await shot(small, 'island-667');
  const land = await mk({ width: 844, height: 390 });
  await go(land, 'island', null, 1600);
  ok('a phone on its side: no room, so no tiles and no tab over the map', await S(land, () => { const r = document.querySelector('.isl .gb-rail'); return !r.offsetParent && r.classList.contains('none'); }));

  /* ---------- dark, less motion ---------- */
  const dark = await mk({ scheme: 'dark', motion: 'reduce' });
  await S(dark, () => { App.isNight = () => true; App.applyTheme(); });
  await go(dark, 'island', null, 1600);
  const dm = await S(dark, () => ({ anim: getComputedStyle(document.querySelector('.gbr-pic')).animationName, chip: getComputedStyle(document.querySelector('.gbr-chip')).backgroundColor }));
  ok('dark + less motion: the tiles stay still, the chips stay dark with white digits', dm.anim === 'none' && dm.chip === 'rgb(58, 24, 70)', JSON.stringify(dm));
  await shot(dark, 'island-dark');
  await axe(dark, '好孕島 tiles at night (dark)');
  await go(dark, 'groupbuy', null, 1300);
  await axe(dark, '正在開團 (dark)');

  /* ---------- the web preview: the samples right away; never while a real service is only unreachable ---------- */
  const real = await mk({ sample: false });
  await go(real, 'island', null, 1800);
  ok('the web preview (a site with no member service, config groupbuyPreview on): the samples show without loading 範例資料', (await tiles(real)).length === 3);
  await go(real, 'groupbuy', null, 1300);
  ok('…正在開團 lists them, marked as samples', (await S(real, () => document.querySelectorAll('.gb-deal .tag').length)) === 3 && /這些是範例團購/.test(await flat(real, '#view')));
  await go(real, 'home', null, 600);
  ok('…and 首頁 stays as it was (no tiles, no sample group-buy card)', await S(real, () => !document.querySelector('[data-card="groupbuy"]') && !document.querySelector('#view .gb-rail')));
  await S(real, () => { window.BRAND.groupbuyPreview = false; });
  await go(real, 'island', null, 1800);
  ok('the brand turns the preview off: a real setup with no member service shows no tiles', await S(real, () => { const r = document.querySelector('.isl .gb-rail'); return !r || r.hidden; }));
  await go(real, 'groupbuy', null, 1300);
  ok('…and 正在開團 says there is none', /目前沒有進行中的團購/.test(await flat(real, '#view')));
  const down = await mk({ sample: false, apiDown: true });
  await go(down, 'island', null, 1800);
  ok('a real member service only unreachable for a moment (offline): no samples, even with the preview on', await S(down, () => { const r = document.querySelector('.isl .gb-rail'); return (!r || r.hidden) && window.BRAND.groupbuyPreview === true; }));
  const h403 = await mk({ sample: false, apiStatus: 403 });
  await go(h403, 'island', null, 1800);
  ok('…a static host that answers 403 (not 404) is still a site with no member service: the samples show', (await tiles(h403)).length === 3);
  const h503 = await mk({ sample: false, apiStatus: 503 });
  await go(h503, 'island', null, 1800);
  ok('…a real service answering 503 (having trouble): no samples', await S(h503, () => { const r = document.querySelector('.isl .gb-rail'); return !r || r.hidden; }));

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  for (const c of ctxs) await c.close().catch(() => {});
  await b.close();
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
