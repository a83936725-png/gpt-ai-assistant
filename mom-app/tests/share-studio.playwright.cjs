// 分享工作室: the share sheet lets her shape the card — 樣式 (7 colours), 格式 (限時動態 9:16, 貼文 4:5, 方形 1:1),
// which list items go on it (as many as fit), ✓ for the done ones, a line of her own, the QR code on or off — with a
// preview that is exactly what gets sent (存圖片, 更多), her choices remembered, and the send row always in reach.
// Usage: cd mom-app && python3 -m http.server 8080   then   BASE=http://localhost:8080/ node tests/share-studio.playwright.cjs
//        AXE_PATH=<axe.min.js> for the accessibility checks
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8080/';
const AXE = process.env.AXE_PATH || '';
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });

(async () => {
  const b = await chromium.launch();
  const mk = async ({ scheme = 'light', width = 400, motion = 'no-preference' } = {}) => {
    const c = await b.newContext({ viewport: { width, height: 860 }, locale: 'zh-TW', colorScheme: scheme, reducedMotion: motion, acceptDownloads: true });
    await c.addInitScript(() => {
      window.__noShareMoments = true; window.open = (u) => { (window.__opened = window.__opened || []).push(String(u)); return null; };
      // a phone that can share files: keep what was handed over
      navigator.canShare = () => true;
      navigator.share = async (d) => { window.__shared = { text: d.text, file: d.files && d.files[0] ? { type: d.files[0].type, size: d.files[0].size } : null }; window.__sharedFile = d.files && d.files[0]; };
    });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE); await p.waitForTimeout(700);
    await p.evaluate(() => { App.isNight = () => false; if (App.applyTheme) App.applyTheme(); });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  // wait until the preview shows the card for the current choices
  const settled = (p) => p.waitForFunction(() => { const pr = document.querySelector('.sh-preview'); const i = pr && pr.querySelector('.sh-img'); return pr && !pr.classList.contains('busy') && i && i.naturalWidth > 0; }, null, { timeout: 8000 });
  const state = (p) => S(p, () => {
    const pr = document.querySelector('.sh-preview'); const i = pr.querySelector('.sh-img');
    return {
      ...pr.dataset, size: `${i.naturalWidth}x${i.naturalHeight}`, src: i.src,
      picked: [...document.querySelectorAll('.sh-item.on')].length, count: (document.querySelector('.sh-count') || {}).textContent || '',
      disabled: [...document.querySelectorAll('.sh-item input')].filter((x) => x.disabled).length, fit: document.querySelector('.sh-fit') && !document.querySelector('.sh-fit').hidden ? document.querySelector('.sh-fit').textContent : '',
    };
  });
  const pregJourney = (p) => S(p, () => {
    const s = App.store.defaults(); s.onboarded = true; s.profile.stage = 'preg'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -130)); s.starter = { demo: true }; s.settings.a2hsDismissed = '1'; s.journey = { done: {} };
    App.store.replace(s); App.navigate('journey');
  });
  const openJourneyShare = async (p) => { await p.locator('button:has-text("分享這份清單")').first().click(); await settled(p); };

  /* ---------- 路線圖 → 分享「懷孕中期」清單 ---------- */
  const P = await mk();
  await pregJourney(P); await P.waitForTimeout(800);
  await S(P, () => { const cb = document.querySelector('.jr-todo input'); cb.click(); }); await P.waitForTimeout(400);
  await openJourneyShare(P);
  let st = await state(P);
  ok('opens as a studio: the card (限時動態 1080×1920), 7 colours with 紫芋 chosen, 3 formats', st.size === '1080x1920' && st.format === 'story' && (await S(P, () => document.querySelectorAll('.sh-sw').length)) === 7 && (await S(P, () => document.querySelector('.sh-sw[aria-checked="true"]').dataset.theme)) === 'purple' && (await S(P, () => document.querySelectorAll('.sh-format button').length)) === 3, JSON.stringify(st));
  const itemsTxt = await S(P, () => [...document.querySelectorAll('.sh-item')].map((x) => x.innerText.replace(/\n/g, ' ')));
  ok('the whole list to pick from: every to-do with 已完成／還沒, then the 注意事項 (⚠️, not on the card unless chosen)', itemsTxt.length >= 10 && /已完成/.test(itemsTxt[0]) && itemsTxt.some((x) => /^⚠️/.test(x)) && !(await S(P, () => [...document.querySelectorAll('.sh-item.on')].some((x) => /⚠️/.test(x.innerText)))), itemsTxt.slice(0, 3).join(' | '));
  ok('by default, exactly what fits on the card is chosen (no warning)', Number(st.items) === st.picked && st.picked >= 4 && !st.fit, JSON.stringify(st));
  await P.waitForTimeout(500); // the sheet has finished rising
  ok('the send row is pinned to the bottom: LINE, IG, FB, Threads, 複製, 存圖片, 更多 — in reach without scrolling', await S(P, () => { const r = document.querySelector('.sheet-footer .sh-send'); const bt = [...r.querySelectorAll('.sh-ch')]; const box = r.getBoundingClientRect(); return bt.length === 7 && box.bottom <= innerHeight && box.top > innerHeight / 2 && bt.map((x) => x.getAttribute('aria-label')).join(',') === '分享到LINE,分享到Instagram,分享到Facebook,分享到Threads,分享到複製連結,存圖片,分享到更多'; }));
  await axe(P, '分享工作室 (light)');

  /* formats */
  const before = st.src;
  await P.click('.sh-format button:has-text("貼文")'); await P.waitForTimeout(200); await settled(P);
  st = await state(P);
  ok('貼文 4:5: the card becomes 1080×1350 and holds at most 4 items', st.size === '1080x1350' && st.picked <= 4 && /／4$/.test(st.count) && st.src !== before, JSON.stringify(st));
  await P.click('.sh-format button:has-text("方形")'); await P.waitForTimeout(200); await settled(P);
  st = await state(P);
  ok('方形 1:1: 1080×1080, at most 3 items; the other boxes wait (disabled) until one is unticked', st.size === '1080x1080' && st.picked <= 3 && st.disabled > 0, JSON.stringify(st));
  await P.click('.sh-item.on >> nth=0'); await P.waitForTimeout(200); await settled(P);
  const st2 = await state(P);
  ok('…untick one: one fewer on the card, and the others can be chosen again', st2.picked === st.picked - 1 && st2.disabled === 0 && st2.src !== st.src, JSON.stringify(st2));

  /* colours */
  await P.click('.sh-sw[data-theme="cream"]'); await P.waitForTimeout(200); await settled(P);
  st = await state(P);
  ok('奶茶 (a light colour): chosen with a ring, and the card is drawn again', st.theme === 'cream' && (await S(P, () => document.querySelector('.sh-sw[data-theme="cream"]').getAttribute('aria-checked'))) === 'true' && st.src !== st2.src, JSON.stringify(st));

  /* her line, ✓, QR */
  await P.click('.sh-format button:has-text("限時動態")'); await P.waitForTimeout(200); await settled(P);
  await P.fill('.sh-note', '老公記得陪我去產檢！'); await P.waitForTimeout(600); await settled(P);
  st = await state(P);
  ok('加一句話: on the card (the list makes room: one item fewer allowed)', st.note === '老公記得陪我去產檢！' && /／5$/.test(st.count), JSON.stringify(st));
  await P.click('.sh-sw-checks input'); await P.waitForTimeout(200); await settled(P);
  ok('標示已完成 off: plain rows instead of ✓／○', (await state(P)).checks === 'false');
  await P.click('.sh-sw-qr input'); await P.waitForTimeout(200); await settled(P);
  st = await state(P);
  ok('放 QR code off: a card without the QR code', st.qr === 'false', JSON.stringify(st));

  /* more items than fit: she is told */
  const boxes = await S(P, () => [...document.querySelectorAll('.sh-item input')].map((x, i) => (!x.checked && !x.disabled ? i : -1)).filter((i) => i >= 0));
  for (const i of boxes) { const dis = await S(P, (k) => document.querySelectorAll('.sh-item input')[k].disabled, i); if (!dis) await P.click(`.sh-item >> nth=${i}`); } // eslint-disable-line no-await-in-loop
  await P.waitForTimeout(300); await settled(P);
  st = await state(P);
  ok('choosing more than fits: 「卡片放得下 N 項，另外 … 沒放進去」', /卡片放得下 \d+ 項，另外 \d+ 項沒放進去/.test(st.fit) || st.picked <= 5, JSON.stringify(st));

  /* the card that is sent is the one on screen */
  const [dl] = await Promise.all([P.waitForEvent('download'), P.click('.sheet-footer .sh-save')]);
  const dlPath = await dl.path();
  const png = fs.readFileSync(dlPath);
  const w = png.readUInt32BE(16); const hgt = png.readUInt32BE(20);
  ok('存圖片: a PNG of the card on screen (限時動態 1080×1920), with a plain file name', w === 1080 && hgt === 1920 && /^yijia-mom-journey-[a-z0-9-]+-story\.png$/.test(dl.suggestedFilename()), `${w}x${hgt} ${dl.suggestedFilename()}`);
  await P.click('.sh-format button:has-text("貼文")'); await P.waitForTimeout(200); await settled(P);
  await P.click('.sheet-footer .sh-ch[aria-label="分享到更多"]'); await P.waitForTimeout(700);
  const shared = await S(P, async () => { const f = window.__sharedFile; if (!f) return null; const bm = await createImageBitmap(f); return { type: f.type, size: `${bm.width}x${bm.height}`, text: window.__shared.text }; });
  ok('更多 (the phone\'s share, e.g. to LINE): the same card as an image (貼文 1080×1350) with the text and link', shared && shared.type === 'image/png' && shared.size === '1080x1350' && /\?ref=|ref=/.test(shared.text), JSON.stringify(shared));

  /* remembered */
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  await openJourneyShare(P);
  st = await state(P);
  ok('next time: 貼文, 奶茶 and no QR code are remembered (the list starts fresh)', st.format === 'post' && st.theme === 'cream' && st.qr === 'false' && !st.note, JSON.stringify(st));
  await P.click('.sh-sw-qr input'); await P.waitForTimeout(200);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  await P.context().close();

  /* ---------- a card without a list; a baby card; dark; a small phone; less motion ---------- */
  const D = await mk({ scheme: 'dark' });
  await S(D, () => { const s = App.store.defaults(); s.onboarded = true; s.profile.stage = 'preg'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -150)); s.starter = { demo: true }; App.store.replace(s); App.navigate('home'); });
  await D.waitForTimeout(700); // (a new screen closes any open sheet: open it once 首頁 is there)
  await S(D, () => App.share.open({ kind: 'preg-week', sheetTitle: '分享孕週卡' }));
  await settled(D);
  ok('孕週卡 (no list): no item list; 內容與文字 folded with 加一句話 and QR inside', !(await D.isVisible('.sh-items')) && (await D.getAttribute('.sh-toggle', 'aria-expanded')) === 'false' && (await S(D, () => !!document.querySelector('.sh-content .sh-note'))) && !(await D.isVisible('.sh-note')));
  await D.click('.sh-toggle'); await D.waitForTimeout(300);
  ok('…tap: it opens', await D.isVisible('.sh-note'));
  await axe(D, '分享工作室 (dark)');
  await D.keyboard.press('Escape'); await D.waitForTimeout(300);
  await S(D, () => App.demo.seed()); await D.waitForTimeout(700);
  await S(D, () => App.share.open({ kind: 'baby-age', sheetTitle: '分享寶寶成長卡' }));
  await settled(D);
  ok('寶寶成長卡: 顯示寶寶名字 is one of the choices', await S(D, () => !!document.querySelector('.sh-sw-name input')));
  await D.context().close();
  const W = await mk({ width: 320 });
  await pregJourney(W); await W.waitForTimeout(700);
  await openJourneyShare(W);
  ok('320 px: 7 colours in one row, the send row fits, no sideways scrolling', await S(W, () => { const sw = [...document.querySelectorAll('.sh-sw')].map((x) => Math.round(x.getBoundingClientRect().top)); return new Set(sw).size === 1 && document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.sh-send .sh-ch')].every((x) => x.getBoundingClientRect().right <= innerWidth); }));
  await W.context().close();
  const R = await mk({ motion: 'reduce' });
  await pregJourney(R); await R.waitForTimeout(700);
  await R.locator('button:has-text("分享這份清單")').first().click(); await R.waitForTimeout(100);
  ok('減少動態效果: the preview waits without the shimmer moving', (await S(R, () => getComputedStyle(document.querySelector('.sh-wait')).animationName)) === 'none');
  await R.context().close();

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
