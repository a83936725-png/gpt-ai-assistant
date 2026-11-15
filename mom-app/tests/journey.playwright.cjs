// 孕期到出生的完整操作流程：一位媽媽從懷孕 8 週 → 產檢 → 中期篩檢 → 後期胎動 → 足月宮縮 → 破水 → 生產 → 坐月子 → 產後 6 週。
// 每一步都實際點擊操作、檢查結果，並截圖（可用來做操作說明）。
// 時間快轉：把所有存下來的日期往前推 N 天（等同過了 N 天）。
// Usage:  cd mom-app && python3 -m http.server 8080      (another terminal)
//         node tests/journey.playwright.cjs               [BASE=... SHOT_DIR=...]
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOT = (process.env.SHOT_DIR || path.join(os.tmpdir(), 'mom-journey')) + path.sep;
fs.mkdirSync(SHOT, { recursive: true });

const steps = []; // {n, title, caption, file}
const results = [];
const errors = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.__noShareMoments = true; });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  const S = (f, a) => p.evaluate(f, a);
  const wait = (ms = 250) => p.waitForTimeout(ms);
  const go = async (r) => { await p.goto(`${BASE}#/${r}`); await wait(300); };
  let n = 0;
  const shot = async (title, caption, { full = false } = {}) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}.png`;
    await wait(250);
    await p.screenshot({ path: SHOT + file, fullPage: full });
    steps.push({ n, title, caption, file });
  };
  const closeSheets = async () => { while (await p.isVisible('.sheet')) { await p.keyboard.press('Escape'); await wait(260); } };
  // pretend `days` days have passed: shift every stored date/time back
  const travel = (days) => S((d) => {
    const DAY = 864e5;
    const isKey = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    const isIso = (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
    const shift = (v) => (isKey(v) ? Core.dateKey(Core.addDays(v, -d)) : isIso(v) ? new Date(new Date(v).getTime() - d * DAY).toISOString() : v);
    const walk = (o) => {
      if (Array.isArray(o)) return o.map(walk);
      if (o && typeof o === 'object') { const r = {}; Object.entries(o).forEach(([k, v]) => { r[isKey(k) ? shift(k) : k] = walk(v); }); return r; }
      return typeof o === 'string' ? shift(o) : o;
    };
    App.store.replace(walk(JSON.parse(JSON.stringify(App.store.state))));
    App.isNight = () => false; App.applyTheme();
  }, days);
  const week = () => S(() => Core.gestAge(App.store.state.profile.lmp).weeks);

  /* ---------- 1. 開始：懷孕 8 週 ---------- */
  await p.goto(BASE); await wait(300);
  await S(() => { App.isNight = () => false; App.applyTheme(); });
  await p.click('text=開始使用'); await p.click('.ob-choice:has-text("懷孕中")'); await wait(200);
  await p.fill('input[placeholder="怎麼稱呼你？（選填）"]', '小美');
  await p.fill('input[type=date] >> nth=0', await S(() => Core.dateKey(Core.addDays(new Date(), -56))));
  await shot('開始使用', '選「懷孕中」，填最後一次月經第一天，App 自動算出預產期。');
  await p.click('text=完成，開始使用'); await wait(400);
  await S(() => App.store.update((s) => { s.profile.heightCm = 160; s.profile.prePregWeight = 52; }));
  ok('第 8 週開始', (await week()) === 8);
  await shot('懷孕 8 週的首頁', '首頁：孕週與寶寶大小、孕產路線圖（這階段該做的事＋注意事項）、今日小任務。', { full: true });

  /* ---------- 2. 記錄身體狀況（一般症狀） ---------- */
  await p.click('[data-card="journey"] button:has-text("記錄身體狀況")'); await wait(300);
  await p.click('.sheet .jr-chip:has-text("噁心孕吐")'); await p.click('.sheet .jr-chip:has-text("疲倦想睡")');
  await p.click('.sheet .jr-mood[aria-label="還不錯"]');
  await p.fill('.sheet textarea', '早上孕吐，少量多餐比較好');
  await shot('記錄身體狀況', '點「記錄身體狀況」：勾選症狀、心情、血壓（選填）。⚠️ 標記的是需要就醫的警訊。');
  await p.click('.sheet-footer .btn-primary'); await wait(300);
  ok('一般症狀不會跳警示', !(await p.isVisible('.sheet')));
  await p.click('.daily-item:has-text("葉酸") .daily-main'); await wait(200);
  ok('葉酸打卡', await S(() => !!App.store.state.folic.log[Core.dateKey()]));

  /* ---------- 3. 第一次產檢 ---------- */
  await go('log');
  await p.click('.jr-quick .chip:has-text("產檢")'); await wait(300);
  await p.click('.sheet .list-item:has-text("產檢紀錄")'); await wait(400);
  await p.fill('.sheet input[aria-label="體重"]', '53.2');
  await p.fill('.sheet input[aria-label="胎心"]', '158');
  await p.fill('.sheet input[aria-label="收縮壓"]', '112');
  await p.fill('.sheet input[aria-label="舒張壓"]', '70');
  await p.fill('.sheet textarea', '看到胎心了！下次抽血要空腹');
  await shot('第 1 次產檢紀錄', '紀錄 → 產檢：記下體重、胎心、血壓、醫師交代。體重會自動放進孕期體重曲線。');
  await p.click('.sheet-footer .btn-primary'); await wait(400);
  const v1 = await S(() => ({ done: !!App.store.state.preg.prenatal.v1, w: App.store.state.preg.weights.length, notes: App.store.state.preg.visitNotes.v1 }));
  ok('產檢完成＋筆記＋體重同步', v1.done && v1.w === 1 && v1.notes.fhr === 158, JSON.stringify(v1));
  await go('journey');
  await p.click('.jr-todo:has-text("領取《孕婦健康手冊》") input'); await wait(200);
  await shot('孕產路線圖', '路線圖：目前在「懷孕初期」，勾選完成的事；紅色區塊是這階段要就醫的警訊。', { full: true });
  await go('log');
  await shot('孕期紀錄', '「紀錄」分頁：身體狀況、產檢、體重、胎動、宮縮都在同一條時間軸，產檢時直接給醫師看。');

  /* ---------- 4. 懷孕中期：血壓偏高＋水腫 → 提醒聯絡醫師 ---------- */
  await travel(14 * 7); // → 22 週
  ok('快轉到 22 週', (await week()) === 22);
  await go('home');
  await shot('懷孕 22 週', '過了 14 週：首頁自動換成「懷孕中期」該做的事（高層次超音波、妊娠糖尿病篩檢…）。', { full: true });
  await p.click('[data-card="journey"] button:has-text("記錄身體狀況")'); await wait(300);
  await p.click('.sheet .jr-chip:has-text("臉和手突然水腫")');
  await p.fill('.sheet input[aria-label="收縮壓"]', '145'); await p.fill('.sheet input[aria-label="舒張壓"]', '92');
  await p.click('.sheet-footer .btn-primary'); await wait(600);
  ok('血壓 145/92＋水腫 → 提醒盡快聯絡醫師', await p.isVisible('.sheet:has-text("請盡快聯絡醫師")'));
  await shot('警訊提醒（盡快就醫）', '記錄到血壓 ≥140/90、突然水腫：App 立刻提醒「請盡快聯絡醫師」（子癲前症警訊）。');
  await closeSheets();
  await go('pregweight'); await p.click('#view button:has-text("記錄")'); await wait(300);
  await p.fill('.sheet .stepper-input', '58.4'); await p.click('.sheet-footer .btn-primary'); await wait(300);
  ok('記錄體重', (await S(() => App.store.state.preg.weights.length)) === 2);

  /* ---------- 5. 懷孕後期：胎動、待產包 ---------- */
  await travel(10 * 7); // → 32 週
  ok('快轉到 32 週', (await week()) === 32);
  await go('kick');
  if (!(await p.isVisible('.pg-kick-btn'))) { await p.locator('#view button').first().click(); await wait(300); }
  for (let i = 0; i < 10; i += 1) { await p.click('.pg-kick-btn'); await wait(60); }
  await wait(400);
  await shot('胎動計數', '32 週：每天數胎動，數到 10 下就完成。胎動明顯減少要立即就醫。');
  const finish = p.locator('#view button').filter({ hasText: /完成|結束|儲存/ }).first();
  if (await finish.count()) { await finish.click(); await wait(300); }
  ok('胎動 10 下已存', (await S(() => App.store.state.preg.kicks.filter((k) => k.count >= 10).length)) >= 1);
  await go('hospitalbag');
  for (let i = 0; i < 6; i += 1) { await p.locator('#view input[type=checkbox]').nth(i).check(); }
  await shot('待產包', '待產包清單：證件、媽媽用品、寶寶用品一次備齊。');

  /* ---------- 6. 足月：宮縮 5-1-1、破水 ---------- */
  await travel(7 * 7); // → 39 週
  ok('快轉到 39 週', (await week()) === 39);
  await S(() => {
    const now = Date.now(); const list = [];
    for (let i = 13; i >= 0; i -= 1) { const st = now - i * 5 * 60000 - 60000; list.push({ id: `c${i}`, start: new Date(st).toISOString(), end: new Date(st + 62000).toISOString() }); }
    App.store.update((s) => { s.preg.contractions = list; });
  });
  await go('contraction');
  await shot('宮縮計時', '39 週：用宮縮計時器記錄。每 5 分鐘一次、每次約 1 分鐘、持續 1 小時（5-1-1）→ App 提醒準備去醫院。', { full: true });
  ok('5-1-1 提醒出現', /5-1-1|準備去醫院|可以準備/.test(await S(() => document.getElementById('view').innerText)));
  await go('home');
  await p.click('[data-card="journey"] button:has-text("記錄身體狀況")'); await wait(300);
  await p.click('.sheet .jr-chip:has-text("疑似破水")');
  await p.click('.sheet-footer .btn-primary'); await wait(600);
  ok('破水 → 立即就醫＋119', await p.isVisible('.sheet:has-text("請立即就醫")') && await p.isVisible('.sheet a[href="tel:119"]'));
  await shot('警訊提醒（立即就醫）', '記錄「疑似破水」：App 提醒立即前往醫院，並提供一鍵撥打 119。');
  await closeSheets();
  await go('log');
  await shot('孕期紀錄（含警訊）', '紀錄分頁會標出「需就醫／留意」的紀錄，也會在最上方提醒。', { full: true });

  /* ---------- 7. 寶寶出生：生產紀錄 ---------- */
  await go('journey');
  await p.click('.jr-hero button:has-text("寶寶出生了")'); await wait(400);
  await p.fill('.sheet input[placeholder="寶寶的名字或小名"]', '小芒果');
  await p.fill('.sheet input[placeholder="3.20"]', '3.18');
  await p.fill('.sheet input[placeholder="50"]', '50');
  await p.fill('.sheet input[placeholder="34"]', '34');
  await p.fill('.sheet input[placeholder="醫院／診所（選填）"]', '安心婦產科');
  await shot('生產紀錄', '「寶寶出生了」：填出生時間、體重、身長、頭圍、生產方式，自動算出生週數。');
  await p.click('.sheet-footer .btn-primary'); await wait(500);
  const born = await S(() => ({ stage: App.store.stage, baby: App.store.baby().name, ga: App.store.baby().birth.ga, pp: App.store.state.postpartum.start }));
  ok('出生 → 育兒＋坐月子', born.stage === 'baby' && born.baby === '小芒果' && born.ga.startsWith('39+') && !!born.pp, JSON.stringify(born));
  await shot('出生當天的首頁', '自動切換到育兒：寶寶資料、快速紀錄、坐月子卡（產後第 1 天＋新生兒觀察）。', { full: true });

  /* ---------- 8. 第一天：餵奶、尿布、媽媽恢復 ---------- */
  await p.click('.quick-tile:has-text("親餵") .qt-plus'); await wait(300);
  await p.click('.active-timer button:has-text("完成")'); await wait(300);
  await p.click('.quick-tile:has-text("尿布") .qt-plus'); await wait(250);
  ok('出生當天記錄餵奶＋尿布', (await S(() => App.store.state.logs.length)) === 2);
  await p.click('[data-card="postpartum"] button:has-text("記錄身體恢復")'); await wait(300);
  await p.click('.sheet .seg button:has-text("多")');
  await p.click('.sheet .jr-mood[aria-label="普通"]');
  await p.fill('.sheet textarea', '第一天，傷口痛但可以下床');
  await shot('產後身體恢復紀錄', '坐月子：記錄惡露量與顏色、傷口疼痛、體溫、心情。⚠️ 是要就醫的警訊。');
  await p.click('.sheet-footer .btn-primary'); await wait(300);
  ok('產後紀錄已存', (await S(() => App.store.state.postpartum.log.length)) === 1);

  /* ---------- 9. 產後第 5 天：新生兒觀察 ---------- */
  await travel(4);
  await S(() => {
    const b = App.store.baby(); const now = Date.now();
    App.store.update((s) => {
      for (let i = 0; i < 3; i += 1) s.logs.push({ id: `w${i}`, babyId: b.id, type: 'diaper', start: new Date(now - (i + 1) * 3 * 36e5).toISOString(), data: { kind: 'wet' }, by: '爸爸' });
      s.logs.push({ id: 'poo1', babyId: b.id, type: 'diaper', start: new Date(now - 2 * 36e5).toISOString(), data: { kind: 'dirty', poo: { amount: 'm', texture: 'soft', color: 'yellow' } }, by: '媽媽' });
      s.growth.push({ id: 'g5', babyId: b.id, date: Core.dateKey(), weight: 2.95 });
    });
  });
  await go('home');
  const nbText = await S(() => document.querySelector('[data-card="postpartum"]').innerText);
  ok('第 5 天：尿布數對照建議（第 5 天至少 5 片）', /第 5 天建議至少 5 片/.test(nbText), nbText.split('\n').slice(0, 4).join(' / '));
  ok('第 5 天：體重下降 -7.2%（10% 內）', /-7\.2%/.test(nbText));
  await p.locator('[data-card="postpartum"]').scrollIntoViewIfNeeded();
  await shot('新生兒觀察', '產後第 5 天：自動比對今天濕尿布數 vs 建議、體重變化、黃疸與臍帶提醒。');
  await p.click('[data-card="postpartum"] button:has-text("記錄身體恢復")'); await wait(300);
  await p.click('.sheet .jr-chip:has-text("乳房紅腫熱痛")');
  await p.fill('.sheet .stepper-input', '38.4');
  await p.click('.sheet-footer .btn-primary'); await wait(600);
  ok('發燒＋乳房紅腫 → 提醒就醫', await p.isVisible('.sheet:has-text("請盡快聯絡醫師")'));
  await shot('產後警訊', '記錄到發燒 38.4°C＋乳房紅腫熱痛（乳腺炎警訊）：提醒盡快就醫。');
  await closeSheets();

  /* ---------- 10. 預防保健：B肝疫苗、新生兒篩檢 ---------- */
  await go('prevention');
  const firstTodo = await S(() => document.querySelector('.prev-next .list-item .li-title')?.textContent.trim());
  await p.click('.prev-next .list-item >> nth=0'); await wait(300); await p.click('.sheet-footer .btn-primary'); await wait(300);
  await shot('預防保健', `預防保健：先列「下一步要做的」（例：${firstTodo}），點一下標記完成。`, { full: true });

  /* ---------- 11. 心情低落 → 專線 ---------- */
  await S(() => App.store.update((s) => {
    for (let i = 1; i <= 4; i += 1) s.postpartum.log.push({ id: `m${i}`, at: new Date(Date.now() - i * 864e5).toISOString(), lochia: { amount: 's', color: 'pink' }, pain: 2, temp: 36.7, mood: 2, symptoms: ['blues'], note: '' });
  }));
  await go('postpartum');
  ok('連續低落 → 顯示關懷與專線', await p.isVisible('text=最近好像比較辛苦') && await p.isVisible('a[href="tel:0800870870"]'));
  await shot('產後恢復與情緒關懷', '產後恢復頁：最近變化（心情、惡露顏色、疼痛）；兩週內多天低落會主動提供孕產婦關懷專線、安心專線。', { full: true });

  /* ---------- 12. 產後 6 週：坐月子結束 ---------- */
  await travel(40);
  await go('home');
  ok('產後 45 天：坐月子卡收起', !(await p.isVisible('[data-card="postpartum"]')));
  await go('journey');
  ok('路線圖全部走完', await p.isVisible('text=路線圖都走完了'));
  await shot('路線圖完成', '產後 6 週後：坐月子卡自動收起，路線圖顯示全部完成；之後回到一般育兒紀錄。', { full: true });

  ok('整段流程沒有任何錯誤', !errors.length, errors.slice(0, 5).join(' | '));
  fs.writeFileSync(SHOT + 'steps.json', JSON.stringify(steps, null, 1));
  console.log('\n=== 孕期到出生 完整流程 ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `\n      ${r.info}` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed・${steps.length} screenshots in ${SHOT}`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); console.log(errors.join('\n')); process.exit(1); });
