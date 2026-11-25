// 組件 (css/components.css, ui.steps): the sliding pill of 分段 controls, checkboxes with a ✓ that pops in, the focus
// ring of inputs, 步驟條 in 設定, the 上傳區 of 產檢日記, 錨點導航 on 我的; with less motion nothing moves, and in
// high-contrast (forced colours) checkboxes are the phone's own. Light and dark, accessibility checked.
// Usage: cd mom-app && python3 -m http.server 8080   then   BASE=http://localhost:8080/ node tests/components.playwright.cjs
//        AXE_PATH=<axe.min.js> for the accessibility checks
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8080/';
const AXE = process.env.AXE_PATH || '';
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });

(async () => {
  const b = await chromium.launch();
  const mk = async ({ scheme = 'light', motion = 'no-preference', forced = 'none', width = 390 } = {}) => {
    const c = await b.newContext({
      viewport: { width, height: 844 }, locale: 'zh-TW', colorScheme: scheme, reducedMotion: motion === 'reduce' ? 'reduce' : 'no-preference', forcedColors: forced,
    });
    await c.addInitScript(() => { window.__noShareMoments = true; window.__noNightAuto = true; window.open = () => null; });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE); await p.waitForTimeout(800);
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
  // where the pill of a 分段 control is drawn, and where its chosen button is
  const pill = (p, sel) => S(p, (s) => {
    const seg = document.querySelector(s); const a = seg.querySelector('button.active');
    const segR = seg.getBoundingClientRect(); const aR = a.getBoundingClientRect(); const cs = getComputedStyle(seg, '::before');
    const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
    return { left: Math.round(segR.left + 3 + m.m41), width: Math.round(parseFloat(cs.width)), btnLeft: Math.round(aR.left), btnWidth: Math.round(aR.width), opacity: cs.opacity, transition: cs.transitionDuration };
  }, sel);

  /* ---------- 設定: 步驟條, 分段 with a sliding pill, the focus ring, a checkbox ---------- */
  const P = await mk();
  // 0.9.2: the first screen asks the first question itself (it used to be a slogan and four emoji lines, then this)
  ok('設定 step 1: the first screen asks 你現在是？ with the three stages, no emoji', await S(P, () => /你現在是？/.test(document.querySelector('.onboard').innerText) && [...document.querySelectorAll('.ob-choice b')].map((b) => b.textContent).join() === '備孕中,懷孕中,育兒中' && !/[\u{1F300}-\u{1FAFF}]/u.test(document.querySelector('.onboard').innerText)));
  await P.click('.ob-choice:has-text("育兒")'); await P.waitForTimeout(500);
  const st = await S(P, () => ({ li: [...document.querySelectorAll('.onboard .steps li')].map((li) => li.className).join(','), cur: document.querySelector('.onboard .steps li.now').getAttribute('aria-current'), label: document.querySelector('.onboard .steps').getAttribute('aria-label') }));
  ok('…step 2: the first is done ✓, this one is the current step (aria-current, 「第 2 步，共 3 步」)', st.li === 'done,now,' && st.cur === 'step' && st.label === '第 2 步，共 3 步', JSON.stringify(st));
  const g1 = await pill(P, '.onboard .seg');
  ok('分段 (女孩／男孩): the pill sits exactly under the chosen option', g1.opacity === '1' && Math.abs(g1.left - g1.btnLeft) <= 1 && Math.abs(g1.width - g1.btnWidth) <= 1, JSON.stringify(g1));
  await P.click('.onboard .seg button:has-text("男孩")'); await P.waitForTimeout(500);
  const g2 = await pill(P, '.onboard .seg');
  ok('…tap 男孩: it slides over (and the value is 男孩)', Math.abs(g2.left - g2.btnLeft) <= 1 && g2.left > g1.left && (await S(P, () => document.querySelector('.onboard .seg').dataset.value)) === 'boy' && parseFloat(g2.transition) > 0, JSON.stringify(g2));
  await P.focus('.onboard input[placeholder="3.20"]'); await P.waitForTimeout(300);
  const fr = await S(P, () => { const i = document.querySelector('.onboard input[placeholder="3.20"]'); const l = i.closest('.field').querySelector('.field-label'); return { shadow: getComputedStyle(i).boxShadow, border: getComputedStyle(i).borderColor, label: getComputedStyle(l).color, primary: getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim() }; });
  ok('輸入框 in focus: a soft ring, and its label turns the brand colour', fr.shadow !== 'none' && fr.label === fr.border, JSON.stringify(fr));
  const cb = await S(P, () => { const c = document.querySelector('.ob-hepb input'); return { checked: c.checked, bg: getComputedStyle(c).backgroundColor, mark: getComputedStyle(c, '::before').transform }; });
  await P.click('.ob-hepb span'); await P.waitForTimeout(400);
  const cb2 = await S(P, () => { const c = document.querySelector('.ob-hepb input'); return { checked: c.checked, bg: getComputedStyle(c).backgroundColor, mark: getComputedStyle(c, '::before').transform }; });
  ok('核取方塊: filled with a ✓; tapping its words unticks it (box emptied, ✓ gone)', cb.checked && !cb2.checked && cb.bg !== cb2.bg && cb2.mark !== cb.mark, `${JSON.stringify(cb)} → ${JSON.stringify(cb2)}`);
  await axe(P, '設定 step 2 (steps, 分段, focus, checkbox)');
  await P.click('.ob-hepb span'); await P.waitForTimeout(200);
  await P.fill('.onboard input[placeholder="寶寶的名字或小名"]', '小湯圓');
  await P.click('text=完成，開始使用'); await P.waitForTimeout(1500);

  /* ---------- 我的: 錨點導航 ---------- */
  await S(P, () => App.navigate('me')); await P.waitForTimeout(900);
  ok('我的: jump chips 寶寶・家人共享・設定・資料與備份 at the top', (await S(P, () => [...document.querySelectorAll('.jump-chip')].map((x) => x.textContent).join('・'))) === '寶寶・家人共享・設定・資料與備份');
  await P.click('.jump-chip:has-text("設定")'); await P.waitForTimeout(1200);
  const jump = await S(P, () => ({ top: Math.round(document.getElementById('me-settings').getBoundingClientRect().top), on: document.querySelector('.jump-chip.on').textContent, y: Math.round(scrollY) }));
  ok('…「設定」 scrolls its section to the top (under the bar) and marks the chip', jump.y > 300 && jump.top >= 0 && jump.top < 140 && jump.on === '設定', JSON.stringify(jump));
  await axe(P, '我的 with jump chips');

  /* ---------- 產檢日記: 上傳區 ---------- */
  await S(P, () => { App.store.update((s) => { s.profile.stage = 'preg'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -150)); }); App.navigate('diary'); }); await P.waitForTimeout(900);
  await P.locator('#view button').filter({ hasText: /寫一頁|新增/ }).first().click(); await P.waitForTimeout(700);
  const drop = await S(P, () => { const d = document.querySelector('.dy-drop'); const i = document.querySelector('.sheet input'); return { text: d && d.innerText.replace(/\n/g, ' '), x: d && Math.round(d.getBoundingClientRect().left), w: d && Math.round(d.getBoundingClientRect().width), ix: Math.round(i.getBoundingClientRect().left), iw: Math.round(i.getBoundingClientRect().width) }; });
  ok('上傳區 with no photos yet: a wide 「📷 加入超音波或產檢照片・最多 6 張」, lined up with the fields', /加入超音波或產檢照片/.test(drop.text) && /最多 6 張/.test(drop.text) && drop.x === drop.ix && drop.w === drop.iw, JSON.stringify(drop));
  await axe(P, '產檢日記 with the upload area');
  await P.context().close();

  /* ---------- dark, less motion, high contrast, a small phone ---------- */
  const D = await mk({ scheme: 'dark' });
  await S(D, () => { const s = App.store.defaults(); s.onboarded = true; s.profile.stage = 'preg'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -200)); s.starter = { demo: true }; App.store.replace(s); App.navigate('hospitalbag'); });
  await D.waitForTimeout(800);
  await D.click('.pg-check >> nth=0'); await D.waitForTimeout(400);
  const dk = await S(D, () => { const c = document.querySelector('.pg-check input'); return { checked: c.checked, mark: getComputedStyle(c, '::before').backgroundColor, bg: getComputedStyle(c).backgroundColor }; });
  ok('dark: a ticked box is light purple with a dark ✓ (readable)', dk.checked && dk.mark === 'rgb(29, 22, 33)', JSON.stringify(dk));
  await axe(D, '待產包 checklist (dark)');
  await D.context().close();
  const R = await mk({ motion: 'reduce' });
  await R.click('.ob-choice:has-text("育兒")'); await R.waitForTimeout(400);
  const rm = await pill(R, '.onboard .seg');
  ok('減少動態效果: the pill is there but does not slide (no transition)', rm.opacity === '1' && parseFloat(rm.transition) === 0, JSON.stringify(rm));
  await R.context().close();
  const F = await mk({ forced: 'active' });
  await F.click('.ob-choice:has-text("育兒")'); await F.waitForTimeout(400);
  const fc = await S(F, () => { const c = document.querySelector('.ob-hepb input'); return { appearance: getComputedStyle(c).appearance, mark: getComputedStyle(c, '::before').content }; });
  ok('high contrast (forced colours): checkboxes are the phone\'s own (no drawn ✓)', /^(auto|checkbox)$/.test(fc.appearance) && fc.mark === 'none', JSON.stringify(fc));
  await F.context().close();
  const W = await mk({ width: 320 });
  await S(W, () => { const s = App.store.defaults(); s.onboarded = true; s.profile.stage = 'baby'; s.babies = [{ id: 'b', name: '小湯圓', birthday: Core.dateKey(Core.addDays(new Date(), -20)) }]; s.activeBabyId = 'b'; s.starter = { demo: true }; App.store.replace(s); App.navigate('me'); });
  await W.waitForTimeout(800);
  ok('320 px: the jump chips scroll inside their row, the page does not scroll sideways', await S(W, () => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.jump-chips').scrollWidth > document.querySelector('.jump-chips').clientWidth));
  await W.context().close();

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
