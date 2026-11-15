// 看寶寶 (baby monitor): two pages in one browser = camera + viewer, Chromium fake camera/mic, full manual pairing
// (read the 配對碼 from one page, paste it into the other, and back). Also: invalid codes, permission errors,
// sound / fullscreen / cry alert / 省電黑畫面, reconnect, stale code, cleanup on leave and on role switch, 320px + dark mode.
// Usage:  cd mom-app && python3 -m http.server 8080      (another terminal)
//         node tests/monitor.playwright.cjs               [BASE=... SHOT_DIR=...]
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOT = (process.env.SHOT_DIR || os.tmpdir()) + path.sep;
fs.mkdirSync(SHOT, { recursive: true });

const results = [];
const errors = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'zh-TW', permissions: ['camera', 'microphone'],
  });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: new URL(BASE).origin });
  const wait = (p, ms = 250) => p.waitForTimeout(ms);
  const shot = async (p, name, opts = {}) => { await wait(p, 300); await p.screenshot({ path: `${SHOT}monitor-${name}.png`, ...opts }); };

  // open the app, seed demo data, make sure the module is there (fallback: inject it), go to 看寶寶
  const open = async (name, { seed = true } = {}) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    // 404s of other modules' files are not this module's business; a missing monitor file is
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    p.on('response', (r) => { if (r.status() >= 400 && /monitor\./.test(r.url())) errors.push(`${name}: ${r.status()} ${r.url()}`); });
    await p.goto(BASE);
    await wait(p, 300);
    await p.evaluate(() => { App.isNight = () => false; App.applyTheme(); });
    if (seed) { await p.evaluate(() => App.demo.seed()); await wait(p, 200); }
    if (!(await p.evaluate(() => !!(App.screens && App.screens.monitor)))) {
      await p.addStyleTag({ url: new URL('css/monitor.css', BASE).href });
      await p.addScriptTag({ url: new URL('js/modules/monitor.js', BASE).href });
    }
    await p.evaluate(() => { location.hash = '#/monitor'; });
    await wait(p, 150);
    await p.evaluate(() => App.refresh());
    await wait(p, 150);
    return p;
  };
  const role = async (p, label) => { await p.click(`.mon-role button:has-text("${label}")`); await wait(p, 200); };
  const codeOut = async (p) => {
    await p.waitForSelector('.mon-code-out', { timeout: 15000 });
    return (await p.textContent('.mon-code-out')).trim();
  };
  const submitCode = async (p, code) => { await p.fill('.mon-code-in', code); await p.click('.mon-submit'); };
  const errText = async (p) => { await p.waitForSelector('.mon-err:not([hidden])', { timeout: 5000 }); return p.textContent('.mon-err'); };
  const chip = (p) => p.textContent('.mon-chip');
  const S = (p, fn, arg) => p.evaluate(fn, arg);
  const connected = async (p, timeout = 20000) => {
    try { await p.waitForSelector('.mon-chip.is-connected', { timeout }); return true; } catch (e) { return false; }
  };
  const videoReady = (p) => p.waitForFunction(() => {
    const v = document.querySelector('.mon-player .mon-video');
    return v && v.readyState >= 2 && v.videoWidth > 0;
  }, null, { timeout: 15000 }).then(() => true, () => false);

  /* ---------- tool tile on 健康 ---------- */
  const cam = await open('camera');
  await S(cam, () => { location.hash = '#/health'; });
  await wait(cam, 300);
  ok('健康頁有「看寶寶」工具', await cam.isVisible('.tile:has-text("看寶寶")'));
  await cam.click('.tile:has-text("看寶寶")');
  await wait(cam, 300);
  ok('點工具進到看寶寶', (await S(cam, () => document.body.dataset.screen)) === 'monitor');
  ok('標題「看寶寶」', (await cam.textContent('.appbar-title')) === '看寶寶');

  /* ---------- camera: start + 配對碼 ---------- */
  await role(cam, '這台當攝影機');
  ok('攝影機：一開始「等待配對」', (await chip(cam)).includes('等待配對'));
  await shot(cam, 'camera-start', { fullPage: true });
  await cam.click('.mon-start');
  const offer = await codeOut(cam);
  ok('攝影機產生配對碼（YJ1. 壓縮）', /^YJ1\.[A-Za-z0-9_-]+$/.test(offer), `${offer.length} 字`);
  const decoded = await S(cam, (c) => App.monitor.decodeCode(c).then((o) => ({ t: o.t, cand: /a=candidate:/.test(o.sdp), id: o.id })), offer);
  ok('配對碼可解開＝offer＋含 ICE candidate', decoded.t === 'offer' && decoded.cand);
  ok('本機預覽有畫面', await cam.waitForFunction(() => { const v = document.querySelector('.mon-player-cam .mon-video'); return v && v.readyState >= 2 && v.muted; }, null, { timeout: 8000 }).then(() => true, () => false));
  ok('預覽是靜音的（不回授）', await S(cam, () => document.querySelector('.mon-player-cam .mon-video').muted));
  await shot(cam, 'camera-code', { fullPage: true });

  /* ---------- viewer: invalid codes ---------- */
  const view = await open('viewer', { seed: false });
  await role(view, '這台用來看');
  await shot(view, 'viewer-idle', { fullPage: true });
  await submitCode(view, 'hello 寶寶');
  ok('亂打的代碼 → 友善錯誤', (await errText(view)).includes('不是看寶寶的代碼'));
  ok('錯誤時輸入框標 aria-invalid', (await view.getAttribute('.mon-code-in', 'aria-invalid')) === 'true');
  await submitCode(view, 'YJ1.abcdefghijk');
  ok('不完整的代碼 → 請重新複製', (await errText(view)).includes('不完整'));
  await submitCode(view, offer.slice(0, Math.floor(offer.length / 2)));
  ok('只貼一半 → 不完整', (await errText(view)).includes('不完整'));
  const fakeAnswer = await S(view, () => App.monitor.encodeCode({ t: 'answer', id: 'x', sdp: 'v=0\r\n' }));
  await submitCode(view, fakeAnswer);
  ok('看的那台貼到回覆碼 → 說明要貼配對碼', (await errText(view)).includes('要貼回攝影機'));
  await shot(view, 'viewer-error', { fullPage: true });

  /* ---------- viewer: 回覆碼 (whole LINE message pasted, with line breaks) ---------- */
  await submitCode(view, `【看寶寶】攝影機配對碼\n請貼上：\n${offer.slice(0, 40)}\n${offer.slice(40)}\n（只能用一次）`);
  const answer = await codeOut(view);
  ok('看的那台產生回覆碼', /^YJ[01]\./.test(answer) && answer !== offer, `${answer.length} 字`);
  ok('回覆碼是 answer、id 對得上', (await S(view, (c) => App.monitor.decodeCode(c).then((o) => o.t + o.id), answer)) === `answer${decoded.id}`);
  ok('看的那台：等待配對', (await chip(view)).includes('等待配對'));
  await shot(view, 'viewer-answer', { fullPage: true });

  /* ---------- camera: wrong code then the real 回覆碼 ---------- */
  await submitCode(cam, offer);
  ok('攝影機貼到自己的配對碼 → 說明要貼回覆碼', (await errText(cam)).includes('回覆碼'));
  await submitCode(cam, answer);
  const camUp = await connected(cam);
  const viewUp = await connected(view);
  ok('攝影機：已連線', camUp);
  ok('看的那台：已連線', viewUp);
  ok('看的那台影片有畫面（readyState≥2, videoWidth>0）', await videoReady(view),
    JSON.stringify(await S(view, () => { const v = document.querySelector('.mon-video'); return { rs: v.readyState, w: v.videoWidth, h: v.videoHeight }; })));
  ok('「即時」徽章出現', await view.isVisible('.mon-badge.is-live:has-text("即時")'));
  ok('一開始是靜音（可自動播放）', await S(view, () => document.querySelector('.mon-video').muted && !document.querySelector('.mon-video').paused));
  ok('收到聲音軌', await S(view, () => App.monitor.state.remoteStream.getAudioTracks().length === 1));
  await wait(view, 1200);
  ok('攝影機知道誰在看（data channel）', (await cam.textContent('.mon-status-text')).includes('媽媽的手機正在看'));
  ok('攝影機徽章：傳送中', await cam.isVisible('.mon-player-cam .mon-badge.is-live'));
  // remote audio can take a few seconds to start flowing: sample up to 8 s, stop as soon as there is signal
  const maxLevel = await S(view, () => new Promise((r) => { let m = 0; const t = setInterval(() => { m = Math.max(m, App.monitor.state.level); if (m > 3) { clearInterval(t); r(m); } }, 50); setTimeout(() => { clearInterval(t); r(m); }, 8000); }));
  ok('聲音條有動（WebAudio 分析遠端聲音）', maxLevel > 3, `max ${maxLevel.toFixed(1)}`);
  await shot(view, 'viewer-live');
  await shot(view, 'viewer-live-full', { fullPage: true });
  await shot(cam, 'camera-live', { fullPage: true });

  /* ---------- viewer controls ---------- */
  await view.click('.mon-ctl-sound');
  ok('開聲音 → 取消靜音、按鈕變「靜音」', (await S(view, () => !document.querySelector('.mon-video').muted)) && (await view.textContent('.mon-ctl-sound')).includes('靜音'));
  await view.click('.mon-ctl-sound');
  ok('再按 → 靜音', await S(view, () => document.querySelector('.mon-video').muted));
  await view.click('.mon-ctl-fs');
  await wait(view, 400);
  const fsOn = await S(view, () => document.fullscreenElement === document.querySelector('.mon-player'));
  ok('全螢幕（整個播放器）', fsOn);
  if (fsOn) {
    ok('全螢幕按鈕變「離開全螢幕」', (await view.textContent('.mon-ctl-fs')).includes('離開全螢幕'));
    await shot(view, 'viewer-fullscreen');
    await view.click('.mon-ctl-fs');
    await wait(view, 400);
    ok('離開全螢幕', await S(view, () => !document.fullscreenElement));
  }

  /* ---------- cry alert (level forced through the test hook) ---------- */
  await S(view, () => { window.__vib = []; navigator.vibrate = (p) => { window.__vib.push(p); return true; }; });
  ok('哭聲提醒預設開啟＋門檻線', (await view.isChecked('.mon-switch >> nth=0')) && await view.isVisible('.mon-meter-mark'));
  await S(view, () => { App.monitor.testLevel = 95; });
  await wait(view, 1500);
  ok('大聲 1.5 秒還不提醒', !(await view.isVisible('.mon-cry')));
  await view.waitForSelector('.mon-cry', { state: 'visible', timeout: 4000 }).catch(() => {});
  ok('大聲約 3 秒 → 哭聲提醒橫幅', await view.isVisible('.mon-cry:has-text("寶寶可能在哭")'));
  ok('有震動', await S(view, () => window.__vib.length > 0));
  ok('有 toast', await view.isVisible('.toast:has-text("寶寶好像在哭")'));
  await shot(view, 'viewer-cry');
  await S(view, () => { App.monitor.testLevel = null; });
  await view.click('.mon-cry-ok');
  ok('按「我知道了」收起', !(await view.isVisible('.mon-cry')));
  await view.click('.mon-toggle:has-text("哭聲提醒")');
  await S(view, () => { App.monitor.testLevel = 95; });
  await wait(view, 3800);
  ok('關掉哭聲提醒就不提醒', !(await view.isVisible('.mon-cry')));
  await S(view, () => { App.monitor.testLevel = null; });
  await view.click('.mon-toggle:has-text("哭聲提醒")');

  /* ---------- camera: 省電黑畫面 + flip ---------- */
  await cam.click('.mon-ctl-dim');
  ok('省電黑畫面蓋住整個螢幕', await cam.isVisible('.mon-dim'));
  ok('黑畫面時預覽暫停', await S(cam, () => document.querySelector('.mon-player-cam .mon-video').paused));
  await shot(cam, 'camera-dim');
  await wait(cam, 800);
  ok('黑畫面時仍在傳送（看的那台還是已連線）', (await chip(view)).includes('已連線'));
  await cam.click('.mon-dim-exit');
  ok('點一下恢復畫面', !(await cam.isVisible('.mon-dim')));
  if (await cam.isVisible('.mon-ctl-flip')) {
    await cam.click('.mon-ctl-flip');
    await wait(cam, 1500);
    ok('切換鏡頭後仍連線且有影像', (await chip(view)).includes('已連線') && await S(cam, () => App.monitor.state.localStream.getVideoTracks()[0].readyState === 'live'));
  } else ok('只有一個鏡頭時隱藏「切換鏡頭」', true);

  /* ---------- reconnect (viewer resets → camera sees 已中斷 → new codes → connected again) ---------- */
  await S(view, () => { window.__old = App.monitor.state.remoteStream.getTracks(); window.__oldPc = App.monitor.state.pc; });
  await view.click('.mon-ctl-retry');
  await view.click('.sheet .btn-primary');
  await wait(view, 600);
  ok('重新連線：看的那台回到第 1 步', await view.isVisible('.mon-code-in') && (await chip(view)).includes('等待配對'));
  ok('重新連線：舊連線與遠端軌道都關掉', await S(view, () => window.__oldPc.connectionState === 'closed' && window.__old.every((t) => t.readyState === 'ended')));
  await cam.waitForSelector('.mon-chip.is-broken', { timeout: 8000 }).catch(() => {});
  ok('攝影機：已中斷（對方離開）', (await chip(cam)).includes('已中斷') && (await cam.textContent('.mon-body')).includes('看的那支手機已經離開'));
  await shot(cam, 'camera-ended', { fullPage: true });
  await cam.click('.mon-broken .btn-primary');
  const offer2 = await codeOut(cam);
  ok('重新產生配對碼（不同的碼）', offer2 !== offer && /^YJ1\./.test(offer2));
  await submitCode(cam, answer);
  ok('舊的回覆碼 → 對不上', (await errText(cam)).includes('對不上'));
  await submitCode(view, offer2);
  const answer2 = await codeOut(view);
  await submitCode(cam, answer2);
  ok('重新配對後再次連線（兩邊）', (await connected(cam)) && (await connected(view)) && await videoReady(view));

  /* ---------- leaving the screen stops everything ---------- */
  await S(cam, () => { window.__t = App.monitor.state.localStream.getTracks(); window.__pc = App.monitor.state.pc; });
  await S(view, () => { window.__rt = App.monitor.state.remoteStream.getTracks(); window.__vpc = App.monitor.state.pc; });
  await S(cam, () => App.navigate('home'));
  await wait(cam, 600);
  ok('攝影機離開畫面 → 鏡頭/麥克風軌道全部停止', await S(cam, () => window.__t.length >= 1 && window.__t.every((t) => t.readyState === 'ended')));
  ok('攝影機離開畫面 → 連線關閉', await S(cam, () => window.__pc.connectionState === 'closed' && !App.monitor.state.pc && !App.monitor.state.localStream));
  await view.waitForSelector('.mon-chip.is-broken', { timeout: 8000 }).catch(() => {});
  ok('看的那台：攝影機已關閉', (await view.textContent('.mon-body')).includes('攝影機那台已經關閉'));
  await shot(view, 'viewer-ended', { fullPage: true });
  await S(view, () => App.navigate('health'));
  await wait(view, 500);
  ok('看的那台離開 → 連線關閉、遠端軌道停止', await S(view, () => window.__vpc.connectionState === 'closed' && window.__rt.every((t) => t.readyState === 'ended')));

  /* ---------- role switch cleans up ---------- */
  await S(cam, () => App.navigate('monitor'));
  await wait(cam, 300);
  ok('回到看寶寶會記得這台的用途（攝影機）', (await cam.getAttribute('.mon-role button.active', 'aria-checked')) === 'true' && (await cam.textContent('.mon-role button.active')).includes('攝影機'));
  await cam.click('.mon-start');
  await codeOut(cam);
  await S(cam, () => { window.__t2 = App.monitor.state.localStream.getTracks(); });
  await role(cam, '這台用來看');
  await cam.click('.sheet .btn-primary');
  await wait(cam, 400);
  ok('切換用途 → 鏡頭停止', await S(cam, () => window.__t2.every((t) => t.readyState === 'ended') && !App.monitor.state.localStream));

  /* ---------- camera errors ---------- */
  const errPage = await open('errors', { seed: false });
  await role(errPage, '這台當攝影機');
  await S(errPage, () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
  await errPage.click('.mon-start');
  await errPage.waitForSelector('.mon-alert', { timeout: 5000 }).catch(() => {});
  ok('拒絕權限 → 說明怎麼開權限＋再試一次', (await errPage.textContent('.mon-alert')).includes('沒有相機權限') && (await errPage.textContent('.mon-start')).includes('再試一次'));
  await shot(errPage, 'camera-denied', { fullPage: true });
  await S(errPage, () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('none', 'NotFoundError')); });
  await errPage.click('.mon-start');
  await wait(errPage, 400);
  ok('沒有相機 → 找不到相機', (await errPage.textContent('.mon-alert')).includes('找不到相機'));

  /* ---------- 320px + dark mode ---------- */
  await errPage.setViewportSize({ width: 320, height: 700 });
  await errPage.emulateMedia({ colorScheme: 'dark' });
  await role(errPage, '這台用來看');
  await wait(errPage, 300);
  ok('320px 不會橫向捲動（看）', await S(errPage, () => document.documentElement.scrollWidth <= 320), String(await S(errPage, () => document.documentElement.scrollWidth)));
  await shot(errPage, 'viewer-320-dark', { fullPage: true });
  await errPage.close();

  const dark = await open('dark', { seed: false });
  await dark.setViewportSize({ width: 320, height: 700 });
  await dark.emulateMedia({ colorScheme: 'dark' });
  await role(dark, '這台當攝影機');
  await dark.click('.mon-start');
  await codeOut(dark);
  ok('320px 不會橫向捲動（攝影機）', await S(dark, () => document.documentElement.scrollWidth <= 320));
  const small = await S(dark, () => [...document.querySelectorAll('#view button, #view [role=textbox], #view textarea, .appbar .mon-help-btn')]
    .filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44)
    .map((b) => `${b.className}:${Math.round(b.getBoundingClientRect().height)}`));
  ok('按鈕觸控範圍 ≥ 44px', small.length === 0, small.join(', '));
  const unlabeled = await S(dark, () => [...document.querySelectorAll('#view button, #view textarea, #view input')]
    .filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim() || b.closest('label')))
    .map((b) => b.className));
  ok('控制項都有名稱', unlabeled.length === 0, unlabeled.join(', '));
  await shot(dark, 'camera-320-dark', { fullPage: true });
  await S(dark, () => App.navigate('home'));

  ok('沒有頁面錯誤', errors.length === 0, errors.join(' | '));
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? `  (${r.info})` : ''}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOT}monitor-*.png`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); console.error(errors.join('\n')); process.exit(1); });
