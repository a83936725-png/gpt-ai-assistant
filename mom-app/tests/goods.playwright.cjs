// 常見好物（goods）＋ 願望清單（wishlist）：stage-aware lists, item details, statuses + prices, my list,
// custom items (link validation), wishlist sharing → friend opens the link, search, deep links,
// 待產包 / 路線圖 links, home card rules, persistence, XSS, dark mode + axe, 320px width.
// Usage:  cd mom-app && python3 -m http.server 8080      (another terminal)
//         node tests/goods.playwright.cjs                 [BASE=http://localhost:8080/ SHOT_DIR=/tmp/... AXE_PATH=.../axe.min.js]
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOT = (process.env.SHOT_DIR || os.tmpdir()) + path.sep;
fs.mkdirSync(SHOT, { recursive: true });
let AXE = null;
try { AXE = fs.readFileSync(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { /* optional */ }
const results = [];
const errors = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: typeof info === 'string' ? info : JSON.stringify(info) });

(async () => {
  const browser = await chromium.launch();
  const newPage = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', ...opts });
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      window.__noShareMoments = true;
      window.__opened = [];
      window.open = (u) => { window.__opened.push(String(u)); return null; };
    });
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text()) && !/\/api\//.test((m.location() || {}).url || '')) errors.push(`console: ${m.text()}`); });
    return p;
  };
  const wait = (p, ms = 250) => p.waitForTimeout(ms);
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, id, params) => {
    await S(p, ([i, pr]) => { location.hash = `#/${i}${pr ? `?${encodeURIComponent(JSON.stringify(pr))}` : ''}`; }, [id, params || null]);
    await wait(p, 300);
  };
  const closeSheets = async (p) => { while (await p.isVisible('.sheet')) { await p.keyboard.press('Escape'); await wait(p, 260); } };
  const shot = async (p, name, full = false) => { await wait(p, 250); await p.screenshot({ path: `${SHOT}goods-${name}.png`, fullPage: full }); };
  const badText = (p) => S(p, () => ['undefined', 'NaN', 'null', '[object Object]'].filter((w) => document.body.innerText.includes(w)));
  const cats = (p) => p.$$eval('#view .gd-group[data-cat]', (els) => els.map((e) => e.dataset.cat));
  const setStage = (p, stage, extra = {}) => S(p, ([st, ex]) => App.store.update((s) => {
    s.onboarded = true; s.profile.stage = st; s.profile.pregnantToo = false;
    if (ex.lmpDaysAgo !== undefined) { s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -ex.lmpDaysAgo)); s.profile.edd = Core.eddFromLmp(s.profile.lmp); }
    if (ex.babyDays !== undefined) {
      if (!s.babies.length) s.babies.push({ id: 'b1', name: '小寶', sex: 'girl', avatar: '👶' });
      s.babies[0].birthday = Core.dateKey(Core.addDays(new Date(), -ex.babyDays)); s.activeBabyId = s.babies[0].id;
    }
  }), [stage, extra]);

  /* ================= 1. 孕期 24 週：現在需要 ================= */
  const p = await newPage();
  await p.goto(BASE);
  await p.waitForFunction(() => window.App && App.screens && App.screens.goods);
  await S(p, () => { App.isNight = () => false; App.applyTheme(); });
  await setStage(p, 'preg', { lmpDaysAgo: 170 });
  await S(p, () => App.store.update((s) => { s.profile.momName = '小美'; }));
  await go(p, 'health');
  ok('健康 tab has the 常見好物 tile (孕期)', await p.isVisible('#view .tile:has-text("常見好物")'));
  await p.click('#view .tile:has-text("常見好物")'); await wait(p, 300);
  ok('tile opens 常見好物', (await p.textContent('.appbar-title')) === '常見好物' && (await S(p, () => location.hash)) === '#/goods');
  ok('health tab stays active', await p.isVisible('.tab.active[href="#/health"]'));
  let c = await cats(p);
  ok('孕期 shows 孕期媽媽 → 睡眠 → … → 先別買 (no 備孕/副食品/居家安全)', c[0] === 'preg' && c.includes('sleep') && c.includes('out') && c.includes('mom') && c[c.length - 1] === 'skip' && !c.includes('prep') && !c.includes('solid') && !c.includes('safe'), c);
  ok('brand item sits in 產後媽媽 with a 品牌 tag', await p.isVisible('.gd-group[data-cat="mom"] [data-item="brand"] .tag:has-text("品牌")'));
  ok('先別買 group explains why', await p.isVisible('.gd-group[data-cat="skip"] [data-item="no-walker"] .li-sub:has-text("翻倒")'));
  const prog0 = await p.textContent('.gd-summary .bold.num');
  ok('必備 progress starts at 0', /^0\/\d+$/.test(prog0), prog0);
  await shot(p, 'now', true);

  // need filter
  await p.click('.gd-filter .chip:has-text("必備")'); await wait(p);
  const needs = await p.$$eval('#view .gd-item .gd-right .tag', (els) => [...new Set(els.map((e) => e.textContent))]);
  ok('必備 filter shows only 必備 items and hides 先別買', needs.length === 1 && needs[0] === '必備' && !(await cats(p)).includes('skip'), needs);
  await p.click('.gd-filter .chip:has-text("全部")'); await wait(p);

  /* ================= 2. item detail + statuses ================= */
  await p.click('[data-item="carseat"]'); await wait(p, 350);
  ok('detail sheet: title, when, tips, 安全提醒 with the law + airbag warning', (await p.textContent('.sheet h2')) === '汽車安全座椅'
    && await p.isVisible('.sheet .gd-tips li:has-text("後向")') && await p.isVisible('.sheet .gd-safety:has-text("安全氣囊")') && await p.isVisible('.sheet :text("出院回家前")'));
  ok('detail sheet: 二手 advice + neutral disclaimer', await p.isVisible('.sheet .gd-save:has-text("省錢・二手")') && await p.isVisible('.sheet :text("不推薦特定品牌")'));
  await p.click('.sheet .gd-st[data-s="buy"]'); await wait(p, 200);
  ok('status chip turns on (aria-checked)', (await p.getAttribute('.sheet .gd-st[data-s="buy"]', 'aria-checked')) === 'true' && (await p.getAttribute('.sheet .gd-st[data-s=""]', 'aria-checked')) === 'false');
  await p.fill('.sheet input[aria-label="價格"]', '3200'); await p.press('.sheet input[aria-label="價格"]', 'Tab');
  await p.fill('.sheet input[aria-label="備註"]', '週末去門市試裝'); await p.press('.sheet input[aria-label="備註"]', 'Tab');
  await shot(p, 'detail');
  await closeSheets(p);
  ok('row shows 🛒 要買 and the price', (await p.textContent('[data-item="carseat"] .gd-state')).includes('要買') && (await p.textContent('[data-item="carseat"] .gd-right')).includes('$3,200'));
  const st = await S(p, () => App.store.state.goods.st.carseat);
  ok('saved to state', st.s === 'buy' && st.price === 3200 && st.note === '週末去門市試裝', st);

  const mark = async (id, s, price) => {
    await p.click(`[data-item="${id}"]`); await wait(p, 300);
    await p.click(`.sheet .gd-st[data-s="${s}"]`); await wait(p, 120);
    if (price) { await p.fill('.sheet input[aria-label="價格"]', String(price)); await p.press('.sheet input[aria-label="價格"]', 'Tab'); }
    await closeSheets(p);
  };
  await mark('crib', 'have', 4500);
  await mark('bottle', 'want');
  await mark('diaper', 'want');
  await mark('formula', 'skip');
  ok('done rows are dimmed (已有 / 不需要)', await p.isVisible('[data-item="crib"].done') && await p.isVisible('[data-item="formula"].done') && !(await p.isVisible('[data-item="bottle"].done')));
  ok('必備 progress counts 已有', (await p.textContent('.gd-summary .bold.num')).startsWith('1/'));
  const counts = await p.$$eval('.gd-count b', (els) => els.map((e) => e.textContent));
  ok('summary counts: 要買 1・想請人送 2・已有 1', counts.join(',') === '1,2,1', counts);
  // clearing status keeps price/note, clearing everything removes the entry
  await p.click('[data-item="formula"]'); await wait(p, 300); await p.click('.sheet .gd-st[data-s=""]'); await closeSheets(p);
  ok('還沒決定 removes an empty entry', await S(p, () => !App.store.state.goods.st.formula));

  /* ================= 3. 我的清單 ================= */
  await p.click('.seg button:has-text("我的清單")'); await wait(p);
  ok('my list: budget sums prices (還要買 $3,200・已買 $4,500)', (await p.textContent('.gd-budget')).includes('$3,200') && (await p.textContent('.gd-budget')).includes('$4,500'));
  ok('my list: 想請親友送 lists 2 items + share button enabled', (await p.$$('.gd-wish .gd-item')).length === 2 && !(await p.isDisabled('.gd-wish-share')));
  ok('my list: 要自己買 + 已有 sections', await p.isVisible('#view .section-title:has-text("要自己買")') && await p.isVisible('#view .gd-group[data-cat="have"] [data-item="crib"]'));
  await shot(p, 'mine', true);

  /* ================= 4. wishlist share → friend opens it ================= */
  await p.click('.gd-wish-share'); await wait(p, 600);
  ok('share sheet opens with the wishlist title + card preview', (await p.textContent('.sheet h2')) === '分享願望清單給親友' && await p.isVisible('.sheet .sh-preview'));
  await p.click('.sheet .sh-line'); await wait(p, 200);
  const lineUrl = (await S(p, () => window.__opened)).find((u) => u.startsWith('https://line.me/R/share'));
  const lineText = lineUrl ? decodeURIComponent(new URL(lineUrl).searchParams.get('text') || '') : '';
  ok('LINE message lists the wishlist items', lineText.includes('小美的寶寶好物願望清單') && lineText.includes('奶瓶') && lineText.includes('尿布'), lineText.slice(0, 120));
  const wishLink = (lineText.match(/https?:\/\/\S+#\/wishlist\S*/) || [])[0] || '';
  ok('message carries a wishlist link with the invite code', /[?&]ref=[A-Z0-9]+/.test(wishLink) && wishLink.includes('#/wishlist?'), wishLink.slice(0, 160));
  const myCode = await S(p, () => App.store.state.share.code);
  await closeSheets(p);
  ok('sharing gives 好孕點數', (await S(p, () => App.store.state.share.points)) > 0);

  const f = await newPage();
  await f.goto(wishLink); await wait(f, 600);
  ok('friend (not signed up) sees the wishlist, not onboarding', (await f.textContent('.gd-wish-title')) === '小美的寶寶好物願望清單');
  ok('wishlist shows both items with 挑選重點', (await f.$$('.gd-wish-item')).length === 2 && await f.isVisible('[data-item="bottle"] .li-sub:has-text("挑選重點")'));
  await f.click('[data-item="bottle"] .gd-gift'); await wait(f, 150);
  const giftUrl = (await S(f, () => window.__opened)).pop() || '';
  const giftText = giftUrl ? decodeURIComponent(new URL(giftUrl).searchParams.get('text') || '') : '';
  ok('「我想送這個」 opens LINE with a ready message', giftUrl.startsWith('https://line.me/R/share') && giftText.includes('我想送你「奶瓶、奶嘴」'), giftText);
  ok('friend is attributed to the inviter (referral captured)', (await S(f, () => App.store.state.share.invitedBy)) === myCode);
  ok('CTA invites the friend to start', await f.isVisible('.gd-cta button:has-text("免費開始使用")'));
  await shot(f, 'wishlist', true);
  await f.click('.gd-cta button'); await wait(f, 300);
  ok('CTA goes to onboarding', await f.isVisible('text=開始使用'));
  await f.context().close();

  /* ================= 5. custom items ================= */
  await p.click('#view button:has-text("＋ 新增自己的好物")'); await wait(p, 350);
  await p.fill('.sheet input[aria-label="名稱"]', '安撫奶嘴');
  await p.fill('.sheet input[aria-label="商品連結"]', 'javascript:alert(1)');
  await p.click('.sheet button:has-text("儲存")'); await wait(p, 250);
  ok('javascript: link is rejected (sheet stays open)', await p.isVisible('.sheet h2:has-text("新增自己的好物")') && await S(p, () => !App.store.state.goods.custom.length));
  await p.fill('.sheet input[aria-label="商品連結"]', 'https://example.com/pacifier');
  await p.fill('.sheet input[aria-label="價格"]', '250');
  await p.click('.sheet button:has-text("儲存")'); await wait(p, 400);
  const cu = await S(p, () => App.store.state.goods.custom[0]);
  ok('custom item saved into 要買 with price', cu && cu.name === '安撫奶嘴' && (await S(p, (id) => App.store.state.goods.st[id], cu.id)).s === 'buy' && (await S(p, (id) => App.store.state.goods.st[id], cu.id)).price === 250);
  ok('custom item appears in 我的清單', await p.isVisible(`[data-item="${cu.id}"]`));
  await p.click(`[data-item="${cu.id}"]`); await wait(p, 300);
  ok('custom detail has a safe https link + 自己新增 tag', (await p.getAttribute('.sheet a:has-text("打開商品連結")', 'href')) === 'https://example.com/pacifier'
    && (await p.getAttribute('.sheet a:has-text("打開商品連結")', 'rel')).includes('noopener') && await p.isVisible('.sheet .tag:has-text("自己新增")'));
  await p.click('.sheet .gd-st[data-s="want"]'); await closeSheets(p);
  const wp = await S(p, () => App.goods.wishParams().p);
  ok('custom wish goes into the shared list by name', Array.isArray(wp.c) && wp.c[0] === '安撫奶嘴' && wp.w.split(',').sort().join() === 'bottle,diaper', wp);
  // edit
  await p.click(`[data-item="${cu.id}"]`); await wait(p, 300); await p.click('.sheet button:has-text("編輯")'); await wait(p, 500);
  await p.fill('.sheet input[aria-label="名稱"]', '安撫奶嘴（0-6M）'); await p.click('.sheet button:has-text("儲存")'); await wait(p, 400);
  ok('edit renames the custom item', (await S(p, () => App.store.state.goods.custom[0].name)) === '安撫奶嘴（0-6M）');
  // delete
  await p.click(`[data-item="${cu.id}"]`); await wait(p, 300); await p.click('.sheet button:has-text("刪除")'); await wait(p, 300);
  await p.click('.sheet-footer .btn-danger, .sheet-footer .btn-primary'); await wait(p, 400); await closeSheets(p);
  ok('delete removes the item and its status', await S(p, (id) => !App.store.state.goods.custom.length && !App.store.state.goods.st[id], cu.id));

  /* ================= 6. share an item as an article card ================= */
  await go(p, 'goods'); await p.click('.seg button:has-text("現在需要")'); await wait(p);
  await p.click('[data-item="no-walker"]'); await wait(p, 300);
  ok('先別買 detail: why + alternative, no status buttons', await p.isVisible('.sheet .gd-why:has-text("翻倒")') && await p.isVisible('.sheet .gd-save:has-text("可以改用")') && !(await p.isVisible('.sheet .gd-status')));
  await p.click('.sheet button:has-text("分享給朋友")'); await wait(p, 700);
  ok('item share sheet opens on top + card preview', (await S(p, () => [...document.querySelectorAll('.sheet h2')].pop().textContent)) === '分享這篇好物筆記' && await p.isVisible('.sheet .sh-img'));
  await closeSheets(p);

  /* ================= 7. deep link, search, 待產包, 路線圖 ================= */
  await go(p, 'goods', { item: 'pump' }); await wait(p, 300);
  ok('deep link #/goods?{item} opens that item and cleans the URL', (await p.textContent('.sheet h2')) === '擠乳器' && (await S(p, () => location.hash)) === '#/goods');
  await closeSheets(p);
  await go(p, 'search'); await p.fill('#sr-input', '汽座'); await wait(p, 400);
  ok('search 汽座 → 常見好物 group with 汽車安全座椅', await p.isVisible('.sr-group[data-group="goods"] :text("汽車安全座椅")'));
  await p.click('.sr-group[data-group="goods"] .list > * >> nth=0'); await wait(p, 600);
  ok('search result opens the item', (await p.textContent('.sheet h2')) === '汽車安全座椅');
  await closeSheets(p);
  await go(p, 'search'); await p.fill('#sr-input', '學步車'); await wait(p, 400);
  ok('search 學步車 → 先別買 result', await p.isVisible('.sr-group[data-group="goods"] :text("學步車")') && await p.isVisible('.sr-group[data-group="goods"] :text("先別買")'));
  await p.fill('#sr-input', '母乳保存'); await wait(p, 400);
  ok('search 母乳保存 still finds the 母乳庫存 tool', await p.isVisible('.sr-group[data-group="tool"] :text("母乳庫存")'));
  await go(p, 'hospitalbag');
  ok('待產包 links to 常見好物', await p.isVisible('.gd-link'));
  await p.click('.gd-link'); await wait(p, 300);
  ok('link opens 常見好物', (await S(p, () => location.hash)) === '#/goods');
  await setStage(p, 'preg', { lmpDaysAgo: 33 * 7 });
  await go(p, 'journey');
  const todo = '.jr-todo:has-text("安裝嬰兒汽車安全座椅") button:has-text("前往")';
  ok('路線圖「安裝汽座」 has a 前往 button', await p.isVisible(todo));
  await p.click(todo); await wait(p, 500);
  ok('…which opens the 汽座 item', (await p.textContent('.sheet h2')) === '汽車安全座椅');
  await closeSheets(p);

  /* ================= 8. home card rules ================= */
  await go(p, 'home');
  ok('home card at 33 weeks: 汽座、嬰兒床、待產包', await p.isVisible('.gd-home :text("汽座、嬰兒床、待產包")') && /必備 \d+\/\d+/.test(await p.textContent('.gd-home .tag')));
  await setStage(p, 'preg', { lmpDaysAgo: 10 * 7 });
  await go(p, 'home');
  ok('no home card at 10 weeks', !(await p.isVisible('.gd-home')));

  /* ================= 9. baby stage by age ================= */
  await setStage(p, 'baby', { babyDays: 20 });
  await go(p, 'goods');
  c = await cats(p);
  ok('newborn: sleep/wear/feed/care/out/mom/skip, no 副食品', ['sleep', 'wear', 'feed', 'care', 'out', 'mom', 'skip'].every((x) => c.includes(x)) && !c.includes('solid') && !c.includes('preg'), c);
  await go(p, 'home');
  ok('no home card for a 20-day-old', !(await p.isVisible('.gd-home')));
  await setStage(p, 'baby', { babyDays: 152 });
  await go(p, 'goods');
  c = await cats(p);
  ok('5 months: 副食品 + 居家安全 move to the top', c[0] === 'solid' && c[1] === 'safe' && c.includes('feed'), c);
  await go(p, 'home');
  ok('home card at 5 months: 副食品 nudge', await p.isVisible('.gd-home :text("副食品")'));
  await p.click('.gd-home button:has-text("不再顯示")'); await wait(p, 400);
  ok('不再顯示 hides the home card', !(await p.isVisible('.gd-home')) && await S(p, () => App.store.state.goods.hideHome === true));
  await setStage(p, 'baby', { babyDays: 400 });
  await go(p, 'goods');
  c = await cats(p);
  ok('13 months: no 衣物 / 餵奶 / 產後媽媽', !c.includes('wear') && !c.includes('feed') && !c.includes('mom') && c.includes('solid'), c);

  /* ================= 10. 備孕 ================= */
  await setStage(p, 'prep');
  await go(p, 'goods');
  c = await cats(p);
  ok('備孕 shows only 備孕 items', c.length === 1 && c[0] === 'prep', c);
  ok('備孕 intro mentions 葉酸', (await p.textContent('.gd-summary')).includes('葉酸'));
  await go(p, 'health');
  ok('健康 tab has the tile (備孕)', await p.isVisible('#view .tile:has-text("常見好物")'));

  /* ================= 11. 全部分類 + persistence ================= */
  await go(p, 'goods'); await p.click('.seg button:has-text("全部分類")'); await wait(p);
  ok('全部分類 shows all 11 groups', (await cats(p)).length === 11);
  await p.click('.gd-cats .chip[data-cat="out"]'); await wait(p);
  ok('category chip filters to one group', (await cats(p)).join() === 'out');
  await p.reload(); await wait(p, 500);
  const after = await S(p, () => ({ car: App.store.state.goods.st.carseat, crib: App.store.state.goods.st.crib }));
  ok('statuses survive a reload', after.car.s === 'buy' && after.car.price === 3200 && after.crib.s === 'have', after);
  ok('backup export includes 好物', await S(p, () => JSON.stringify(App.store.state).includes('"goods"')));

  /* ================= 12. XSS + malformed wishlist links ================= */
  const x = await newPage();
  await x.goto(`${BASE}#/wishlist?${encodeURIComponent(JSON.stringify({ w: 'nope,crib,no-walker,__proto__', c: ['<img src=x onerror="window.__x=1">', 42, null], n: '<b onmouseover=alert(1)>壞</b>' }))}`);
  await wait(x, 500);
  ok('wishlist: only real, non-先別買 items render', (await x.$$eval('.gd-wish-item[data-item]', (els) => els.map((e) => e.dataset.item))).join() === 'crib');
  ok('wishlist: names are shown as text, never run', !(await S(x, () => window.__x)) && (await x.textContent('.gd-wish-title')).includes('<b onmouseover') && (await x.$$('.gd-wish-list img')).length === 0);
  await x.goto(`${BASE}#/wishlist?${encodeURIComponent(JSON.stringify({ w: ['crib'], c: 'x', n: { a: 1 } }))}`); await wait(x, 400);
  ok('wrong-typed wishlist params are ignored safely', !(await x.textContent('#view')).includes('[object Object]') && await x.isVisible('.empty'));
  await x.goto(`${BASE}#/wishlist?not-json`); await wait(x, 400);
  ok('broken wishlist link shows a friendly empty state', await x.isVisible('.empty:has-text("連結不完整")'));
  await x.context().close();

  /* ================= 13. 320px + dark + text sanity ================= */
  const n = await newPage({ viewport: { width: 320, height: 640 } });
  await n.goto(BASE); await n.waitForFunction(() => window.App && App.screens.goods);
  await setStage(n, 'preg', { lmpDaysAgo: 200 });
  for (const [id, prm] of [['goods'], ['goods', { tab: 'mine' }], ['wishlist', { w: 'crib,carseat,bottle' }]]) {
    await go(n, id, prm);
    const over = await S(n, () => document.documentElement.scrollWidth - window.innerWidth);
    ok(`320px: no sideways scroll on ${id}${prm ? ` ${JSON.stringify(prm)}` : ''}`, over <= 0, over);
  }
  await go(n, 'goods', { tab: 'now' }); await n.click('[data-item="carseat"]'); await wait(n, 300);
  const sheetOver = await S(n, () => document.querySelector('.sheet').scrollWidth - document.querySelector('.sheet').clientWidth);
  ok('320px: detail sheet fits', sheetOver <= 0, sheetOver);
  await closeSheets(n);
  ok('no undefined/NaN/null text', !(await badText(n)).length, await badText(n));
  await S(n, () => { App.store.update((s) => { s.settings.theme = 'dark'; s.settings.nightMode = false; }); App.applyTheme(); });
  await go(n, 'goods'); await shot(n, 'dark-320', true);
  await n.context().close();

  /* ================= 14. accessibility (axe) ================= */
  if (!AXE) console.log('(skipping accessibility: set AXE_PATH or npm i -D axe-core)');
  else {
    const agg = [];
    for (const theme of ['light', 'dark']) {
      const a = await newPage();
      await a.goto(BASE); await a.waitForFunction(() => window.App && App.screens.goods);
      await setStage(a, 'preg', { lmpDaysAgo: 200 });
      await S(a, (t) => { App.store.update((s) => { s.settings.theme = t; s.settings.nightMode = false; s.goods = { st: { carseat: { s: 'buy', price: 3000 }, crib: { s: 'have' }, bottle: { s: 'want' } }, custom: [] }; }); App.applyTheme(); }, theme);
      const run = async (label) => {
        await S(a, () => document.querySelectorAll('.toast-wrap').forEach((t) => t.remove()));
        await a.addScriptTag({ content: AXE }).catch(() => {});
        const v = await S(a, async () => (await axe.run(document, { resultTypes: ['violations'], runOnly: ['wcag2a', 'wcag2aa'] })).violations
          .filter((y) => ['serious', 'critical'].includes(y.impact)).map((y) => `${y.id}×${y.nodes.length} [${y.nodes[0].target.join(' ').slice(0, 60)}]`));
        v.forEach((y) => agg.push(`${theme}:${label}: ${y}`));
      };
      await go(a, 'goods'); await run('now');
      await go(a, 'goods', { tab: 'mine' }); await run('mine');
      await go(a, 'goods', { item: 'carseat' }); await wait(a, 400); await run('detail');
      await closeSheets(a);
      await go(a, 'wishlist', { w: 'crib,carseat', n: '小美' }); await run('wishlist');
      await a.context().close();
    }
    ok('accessibility: no serious/critical WCAG A/AA issues (light + dark)', !agg.length, agg.join('\n      '));
  }

  ok('no page errors', !errors.length, errors.slice(0, 5).join(' | '));
  await browser.close();
  let pass = 0;
  results.forEach((r) => { if (r.pass) pass += 1; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${!r.pass && r.info ? `\n      ${r.info}` : ''}`); });
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
