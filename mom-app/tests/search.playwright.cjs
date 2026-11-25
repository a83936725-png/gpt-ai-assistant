// 問答搜尋：常見問答＋全 App 內容搜尋。實際輸入、點擊、開 sheet、看紀錄，並截圖。
// Usage:  cd mom-app && python3 -m http.server 8080      (another terminal)
//         node tests/search.playwright.cjs               [BASE=... SHOT_DIR=...]
// If index.html does not include search.js yet, the test injects faq-data.js / search.js / search.css itself.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOT = (process.env.SHOT_DIR || path.join(os.tmpdir(), 'mom-search')) + path.sep;
fs.mkdirSync(SHOT, { recursive: true });

const results = [];
const errors = [];
const shots = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
  p.on('response', (r) => { if (r.status() >= 400 && /search|faq-data/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  const S = (f, a) => p.evaluate(f, a);
  const wait = (ms = 250) => p.waitForTimeout(ms);
  let n = 0;
  const shot = async (name, { full = false } = {}) => {
    n += 1;
    const file = `search-${String(n).padStart(2, '0')}-${name}.png`;
    await wait(260);
    await p.screenshot({ path: SHOT + file, fullPage: full });
    shots.push(file);
  };
  const closeSheets = async () => { for (let i = 0; i < 5 && await p.isVisible('.sheet'); i += 1) { await p.keyboard.press('Escape'); await wait(280); } };
  const ensureSearch = async () => {
    if (await S(() => !!(window.App && App.screens && App.screens.search))) return false;
    await p.addScriptTag({ url: `${BASE}js/data/faq-data.js` });
    await p.addScriptTag({ url: `${BASE}js/modules/search.js` });
    await p.addStyleTag({ url: `${BASE}css/search.css` });
    return true;
  };
  const goSearch = async () => {
    await S(() => { if (location.hash.startsWith('#/search')) App.refresh(); else location.hash = '#/search'; });
    await wait(300);
  };
  const type = async (q, { submit = false } = {}) => {
    await p.fill('#sr-input', q);
    await wait(320);
    if (submit) { await p.press('#sr-input', 'Enter'); await wait(200); }
  };
  const state = () => S(() => ({
    groups: [...document.querySelectorAll('.sr-group[data-group]')].map((g) => g.dataset.group),
    faqs: [...document.querySelectorAll('.sr-group[data-group="faq"] [data-faq]')].map((b) => b.dataset.faq),
    urgent: !!document.querySelector('.sr-urgent'),
    crisis: !!document.querySelector('.sr-crisis'),
    empty: !!document.querySelector('.sr-empty'),
    marks: document.querySelectorAll('#view mark.sr-hl').length,
    status: (document.querySelector('.sr-status') || {}).textContent || '',
  }));

  /* ---------- boot ---------- */
  await p.goto(BASE); await wait(400);
  const injected = await ensureSearch();
  ok(injected ? '（index.html 尚未載入 search.js，已注入）' : 'index.html 已載入 search.js', true);
  await S(() => { App.isNight = () => false; App.applyTheme(); App.demo.seed(); });
  await wait(400);
  ok('FAQ 數量 ≥ 50', await S(() => App.FAQ.length >= 50), String(await S(() => App.FAQ.length)));

  // app-bar 🔎 button (added by the shell) or direct navigation
  if (await p.isVisible('#appbar button[aria-label="問答搜尋"]')) {
    await p.click('#appbar button[aria-label="問答搜尋"]'); await wait(350);
    ok('首頁 app bar 的 🔎 進入搜尋', await S(() => location.hash.startsWith('#/search')));
  } else await goSearch();

  /* ---------- 1. 搜尋首頁 ---------- */
  ok('標題「問答搜尋」', (await p.textContent('.appbar-title')).includes('問答搜尋'));
  ok('搜尋框自動聚焦', await S(() => document.activeElement && document.activeElement.id === 'sr-input'));
  ok('搜尋框有 label', await S(() => !!document.querySelector('label[for="sr-input"]')));
  ok('育兒階段建議 chips（脹氣、發燒）', await p.isVisible('.sr-suggest .chip:has-text("脹氣")') && await p.isVisible('.sr-suggest .chip:has-text("發燒")'));
  ok('本階段常見問答列表', (await p.locator('.sr-results [data-faq]').count()) >= 6);
  await shot('home');

  /* ---------- 2. 查詢與分組 ---------- */
  await type('脹氣', { submit: true });
  let st = await state();
  ok('脹氣 → 第一筆是脹氣問答', ['baby-gas', 'baby-gas-doctor'].includes(st.faqs[0]), st.faqs.join(','));
  ok('脹氣 → 有高亮', st.marks > 0);
  ok('脹氣 → 顯示筆數', /找到 \d+ 筆/.test(st.status), st.status);
  ok('清除按鈕出現', await p.isVisible('.sr-clear'));
  await shot('gas');

  await type('嬰兒純脹氣要看醫生嗎');
  st = await state();
  ok('口語長句「嬰兒純脹氣要看醫生嗎」→ 脹氣就醫', st.faqs[0] === 'baby-gas-doctor', st.faqs.join(','));

  await type('屁很臭', { submit: true });
  st = await state();
  ok('屁很臭 → 放屁很臭問答', st.faqs[0] === 'baby-fart-smell', st.faqs.join(','));
  await type('嬰兒屁超臭');
  ok('嬰兒屁超臭 → 同一題', (await state()).faqs[0] === 'baby-fart-smell');

  await type('發燒', { submit: true });
  st = await state();
  ok('發燒 → 緊急提醒卡（119）', st.urgent && await p.isVisible('.sr-urgent a[href="tel:119"]'));
  ok('發燒 → 寶寶發燒問答在前', st.faqs.slice(0, 2).includes('baby-fever'), st.faqs.join(','));
  ok('發燒 → 也找到路線圖', st.groups.includes('journey'), st.groups.join(','));
  await shot('fever');

  await type('背巾', { submit: true });
  st = await state();
  ok('背巾 → 背巾安全／材質', ['babywearing-newborn', 'babywearing-fabric'].includes(st.faqs[0]), st.faqs.join(','));
  await type('媽媽餵背巾材質要選哪一種');
  ok('「…背巾材質要選哪一種」→ 背巾材質', (await state()).faqs[0] === 'babywearing-fabric');
  await type('4d環抱式嬰兒背帶新生兒可以用嗎');
  ok('「環抱式嬰兒背帶新生兒可以用嗎」→ 新生兒背巾安全', (await state()).faqs[0] === 'babywearing-newborn');

  await type('腸病毒', { submit: true });
  st = await state();
  ok('腸病毒 → 疫苗＋症狀兩題', st.faqs.includes('ev71-vaccine') && st.faqs.includes('enterovirus'), st.faqs.join(','));
  await type('腸病毒疫苗費用');
  ok('腸病毒疫苗費用 → 腸病毒疫苗', (await state()).faqs[0] === 'ev71-vaccine');

  await type('孕吐', { submit: true });
  ok('孕吐 → 孕吐問答', (await state()).faqs[0] === 'preg-nausea');

  await type('破水', { submit: true });
  st = await state();
  ok('破水 → 緊急提醒卡', st.urgent);
  ok('破水 → 破水問答', st.faqs.slice(0, 2).includes('preg-water-break'), st.faqs.join(','));
  ok('破水 → 路線圖分組', st.groups.includes('journey'));
  await shot('water-break', { full: true });

  await type('惡露', { submit: true });
  st = await state();
  ok('惡露 → 惡露問答', st.faqs[0] === 'pp-lochia', st.faqs.join(','));
  ok('惡露 → 問答／好孕島／路線圖／工具 四組', ['faq', 'island', 'journey', 'tool'].every((g) => st.groups.includes(g)), st.groups.join(','));
  await shot('lochia', { full: true });

  await type('葉酸', { submit: true });
  st = await state();
  ok('葉酸 → 葉酸問答＋好孕島', st.faqs[0] === 'prep-folic' && st.groups.includes('island'), `${st.faqs.join(',')} / ${st.groups.join(',')}`);

  await type('发烧');
  ok('簡體「发烧」也找得到', (await state()).faqs.includes('baby-fever'));
  await type('５－１－１');
  ok('全形「５－１－１」→ 產兆', (await state()).faqs[0] === 'preg-labor-signs');

  await type('zxqv ㄅㄆㄇ');
  st = await state();
  ok('亂打 → 空狀態＋換個說法建議', st.empty && await p.isVisible('.sr-empty-chips .chip'));
  ok('空狀態不顯示緊急卡', !st.urgent);
  ok('空狀態提供專線', await p.isVisible('.sr-empty a[href="tel:0800870870"]'));
  await shot('empty');

  await type('想結束生命');
  st = await state();
  ok('危機字詞 → 心理支持專線卡（1925）', st.crisis && await p.isVisible('.sr-crisis a[href="tel:1925"]'));

  await type('<img src=x onerror="window.__xss=1">');
  ok('使用者輸入不會變成 HTML', await S(() => !document.querySelector('#view img[src="x"]') && !window.__xss));

  /* ---------- 3. 問答 sheet ---------- */
  await type('脹氣');
  await p.click('.sr-group[data-group="faq"] [data-faq] >> nth=0'); await wait(400);
  const fid = await S(() => document.querySelector('.sr-sheet') && document.querySelector('.sr-sheet').dataset.faq);
  ok('點問答 → 開啟答案 sheet', !!fid, fid);
  ok('答案 2–5 句', await S(() => { const k = document.querySelectorAll('.sr-sheet .sr-ans li').length; return k >= 2 && k <= 5; }));
  ok('sheet 有免責聲明「不能取代醫師診斷」', (await p.textContent('.sr-sheet')).includes('不能取代醫師診斷'));
  ok('答案內關鍵字高亮', (await p.locator('.sr-sheet mark.sr-hl').count()) > 0);
  ok('有分享按鈕（App.share 存在時）', !(await S(() => !!App.share)) || await p.isVisible('.sr-sheet .sh-btn'));
  ok('還沒回饋時，答案裡沒有「null」字樣', !/(^|\n)\s*null\s*(\n|$)/.test(await S(() => document.querySelector('.sr-sheet').innerText)));
  await p.click('.sr-sheet .sr-fb-btn:has-text("有幫助")'); await wait(200);
  ok('👍 存到 faqFeedback', await S((id) => (App.store.state.faqFeedback || {})[id]?.up === 1, fid));
  ok('👍 aria-pressed', await p.getAttribute('.sr-sheet .sr-fb-btn:has-text("有幫助")', 'aria-pressed') === 'true');
  await p.click('.sr-sheet .sr-fb-btn:has-text("沒幫助")'); await wait(200);
  ok('改投 👎 會移轉計數', await S((id) => { const r = App.store.state.faqFeedback[id]; return r.up === 0 && r.down === 1; }, fid));
  await shot('faq-sheet');
  await p.evaluate(() => document.querySelector('.sr-sheet .sheet-body').scrollTo(0, 9999)); await shot('faq-sheet-bottom');
  await closeSheets();

  await type('發燒');
  await p.click('.sr-group[data-group="faq"] [data-faq="baby-fever"]'); await wait(400);
  ok('警訊題 → 紅色就醫橫幅＋119', await p.isVisible('.sr-sheet .sr-banner-urgent') && await p.isVisible('.sr-sheet .sr-banner a[href="tel:119"]'));
  await shot('faq-urgent');
  await p.click('.sr-sheet .sr-see .list-item:has-text("怎麼量體溫")'); await wait(600);
  ok('延伸閱讀 → 換成另一題', await S(() => document.querySelector('.sr-sheet')?.dataset.faq === 'baby-temp'));
  await closeSheets();

  /* ---------- 4. 好孕島、路線圖、工具結果 ---------- */
  await type('惡露');
  const spotId = await p.getAttribute('.sr-group[data-group="island"] [data-spot] >> nth=0', 'data-spot');
  const spotName = await S((id) => App.ISLAND.SPOTS.find((x) => x.id === id).name, spotId);
  await p.click('.sr-group[data-group="island"] [data-spot] >> nth=0'); await wait(500);
  ok('好孕島結果 → 開啟島上地點 sheet', (await p.textContent('.sheet-header h2')).includes(spotName), spotName);
  await shot('island-spot');
  await closeSheets();
  ok('島上 sheet 關閉後搜尋字還在', (await p.inputValue('#sr-input')) === '惡露');

  await p.click('.sr-group[data-group="journey"] .list-item >> nth=0'); await wait(400);
  ok('路線圖結果 → 前往路線圖', await S(() => /^#\/(journey|postpartum)/.test(location.hash)), await S(() => location.hash));
  await p.goBack(); await wait(400);
  ok('返回後保留搜尋字與結果', (await p.inputValue('#sr-input')) === '惡露' && (await state()).faqs[0] === 'pp-lochia');

  await type('母乳');
  ok('母乳 → 工具「母乳庫存」', await p.isVisible('.sr-group[data-group="tool"] [data-tool="milk"]'));
  await p.click('.sr-group[data-group="tool"] [data-tool="milk"]'); await wait(400);
  ok('工具結果 → 前往工具畫面', await S(() => location.hash.startsWith('#/milk')));
  await p.goBack(); await wait(400);

  /* ---------- 5. 搜尋紀錄 ---------- */
  const hist = await S(() => App.store.state.searchHistory);
  ok('搜尋紀錄最多 8 筆、最新在前', Array.isArray(hist) && hist.length === 8 && hist[0] === '母乳', JSON.stringify(hist));
  await p.click('.sr-clear'); await wait(300);
  ok('清除按鈕清空並回到首頁', (await p.inputValue('#sr-input')) === '' && await p.isVisible('.sr-history'));
  await shot('history');
  await p.click('.sr-history .chip >> nth=1'); await wait(300);
  ok('點紀錄 chip 重新搜尋', (await p.inputValue('#sr-input')) === hist[1]);
  await p.click('.sr-clear'); await wait(200);
  await p.click('.sr-clear-hist'); await wait(300);
  ok('清除紀錄', (await S(() => App.store.state.searchHistory.length)) === 0 && !(await p.isVisible('.sr-history')));

  /* ---------- 6. 觸控大小、320px、深色 ---------- */
  await type('發燒');
  const small = await S(() => [...document.querySelectorAll('.sr-chip, .sr-item, .sr-clear, .sr-clear-hist, .sr-more, .sr-call, .sr-input')]
    .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.className));
  ok('觸控目標 ≥ 44px', !small.length, small.slice(0, 4).join(' | '));
  await p.setViewportSize({ width: 320, height: 640 });
  await wait(200);
  ok('320px 沒有水平捲動', await S(() => document.documentElement.scrollWidth <= 320), String(await S(() => document.documentElement.scrollWidth)));
  await shot('320px');
  await p.click('.sr-clear'); await wait(200);
  ok('320px 首頁沒有水平捲動', await S(() => document.documentElement.scrollWidth <= 320));
  await p.setViewportSize({ width: 390, height: 844 });
  await S(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await type('脹氣');
  await shot('dark');
  await p.click('.sr-group[data-group="faq"] [data-faq] >> nth=0'); await wait(400);
  await shot('dark-sheet');
  await closeSheets();
  await S(() => document.documentElement.removeAttribute('data-theme'));

  /* ---------- 7. 階段、深層連結、工具註冊 ---------- */
  await S(() => App.store.update((s) => { s.profile.stage = 'preg'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -150)); }));
  await goSearch();
  await p.click('.sr-clear').catch(() => {});
  await type('');
  ok('懷孕階段建議 chips 換成孕期（孕吐）', await p.isVisible('.sr-suggest .chip:has-text("孕吐")'));
  await type('發燒');
  ok('懷孕階段搜「發燒」→ 孕期感冒發燒在前', (await state()).faqs[0] === 'preg-cold', (await state()).faqs.join(','));
  await type('');
  await S(() => App.store.update((s) => { s.profile.stage = 'baby'; }));

  await p.goto(`${BASE}#/search?${encodeURIComponent(JSON.stringify({ faq: 'baby-gas' }))}`); await wait(300);
  await ensureSearch();
  await goSearch(); await wait(400);
  ok('深層連結 params.faq → 直接開答案', await S(() => document.querySelector('.sr-sheet')?.dataset.faq === 'baby-gas'));
  await closeSheets();
  await S(() => { location.hash = `#/search?${encodeURIComponent(JSON.stringify({ q: '孕吐' }))}`; }); await wait(400);
  ok('深層連結 params.q → 預填關鍵字', (await p.inputValue('#sr-input')) === '孕吐' && (await state()).faqs[0] === 'preg-nausea');
  await S(() => App.navigate('home')); await wait(300);
  await S(() => App.search.open('葉酸')); await wait(400);
  ok('App.search.open(q)', (await p.inputValue('#sr-input')) === '葉酸');
  await S(() => App.navigate('health')); await wait(300);
  ok('健康頁有「問答搜尋」工具', await p.isVisible('.tool-card:has-text("問答搜尋")'));

  ok('整段流程沒有任何錯誤', !errors.length, errors.slice(0, 5).join(' | '));
  console.log('\n=== 問答搜尋 ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `\n      ${r.info}` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed・${shots.length} screenshots in ${SHOT}`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); console.log(errors.join('\n')); process.exit(1); });
