// 寶寶月照 (js/modules/monthly.js): a framed photo for every month (出生、滿月 … 1 歲 … 2 歲). The grid shows what is
// done, this month, what can be taken late and what is still to come; the editor picks a photo, moves and zooms it, picks
// one of four frames, a name and a line (skills from 發展里程碑 first), the size from 成長紀錄, and an invite QR only when
// she turns it on; it saves as she goes. 存圖片 and 分享 make a 1080×1350 JPEG on the phone. Twelve months make the
// 「第一年」 collage. 首頁 shows a line on the month-day (with ✕), the 滿月 sheet offers the photo too. Photos stay on the
// phone, go with the backup and are kept by prune; deleting a baby drops their 月照. Twins, an older child, no birthday,
// no baby, a small phone, dark and accessibility are checked.
// Usage: cd mom-app && python3 -m http.server 8080   then   BASE=http://localhost:8080/ node tests/monthly.playwright.cjs
//        AXE_PATH=<axe.min.js> for the accessibility checks
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8080/';
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const NOW = '2026-11-22T14:19:03+08:00';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-'));
const jpegSize = (buf) => {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
};

(async () => {
  const b = await chromium.launch();
  const mk = async ({ width = 390, height = 844, scheme = 'light', share = false, demo = true } = {}) => {
    const c = await b.newContext({ viewport: { width, height }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', colorScheme: scheme, acceptDownloads: true });
    await c.clock.install({ time: new Date(NOW) });
    await c.addInitScript((sh) => {
      window.__noShareMoments = true; window.__noNightAuto = true; window.open = () => null;
      if (sh) {
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
        Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared = { name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, text: d.text }; } });
      }
    }, share);
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE);
    await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.monthly);
    if (demo) { await p.click('text=先看看範例資料'); await p.waitForTimeout(900); }
    await p.evaluate(() => { App.isNight = () => false; App.applyTheme(); App.store.update((s) => { s.settings.a2hsDismissed = '1'; }); });
    await p.waitForTimeout(300);
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, screen, params, ms = 900) => { await S(p, ([x, q]) => App.navigate(x, q), [screen, params]); await p.waitForTimeout(ms); };
  const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: `${SHOT}${name}.png` }); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const toast = (p) => S(p, () => (document.querySelector('.toast-wrap') || {}).innerText || '').then((t) => t.replace(/\s+/g, ' ').trim());
  const slot = (p, m, id = null) => S(p, ([mm, bid]) => { const s = App.store.state.monthly || {}; const bb = bid || App.store.baby().id; return ((s.babies || {})[bb] || {})[mm] || null; }, [m, id]);
  const painted = (p, sel = '.sheet .mo-cv') => p.waitForFunction((x) => { const c = document.querySelector(x); return c && Number(c.dataset.painted || 0) > 0; }, sel, { timeout: 5000 }).then(() => true, () => false);
  const closeSheets = async (p) => { for (let i = 0; i < 3; i += 1) { if (!(await p.$('.sheet'))) break; await p.keyboard.press('Escape'); await p.waitForTimeout(350); } };
  const tiles = (p) => S(p, () => [...document.querySelectorAll('.mo-tile')].map((t) => ({ m: Number(t.dataset.m), cls: t.className, text: t.innerText.replace(/\s+/g, ' ').trim(), label: t.getAttribute('aria-label') })));
  // a wide test "photo": blue on the left, orange on the right, a white disc in the middle
  const makePhoto = async (p, name, w = 1600, hh = 1100) => {
    const data = await S(p, ([ww, h2]) => {
      const cv = document.createElement('canvas'); cv.width = ww; cv.height = h2; const x = cv.getContext('2d');
      x.fillStyle = '#1e5fd8'; x.fillRect(0, 0, ww / 2, h2); x.fillStyle = '#f08a24'; x.fillRect(ww / 2, 0, ww / 2, h2);
      x.fillStyle = '#ffffff'; x.beginPath(); x.arc(ww / 2, h2 / 2, Math.min(ww, h2) / 4, 0, 7); x.fill();
      return cv.toDataURL('image/png');
    }, [w, hh]);
    const f = path.join(TMP, name); fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64')); return f;
  };

  /* ---------- 1. the pieces: labels, dates, size, crop, due day ---------- */
  const P = await mk();
  const u = await S(P, () => {
    const M = App.monthly;
    const L = [0, 1, 2, 11, 12, 13, 24].map((m) => M.label(m).text);
    const d = M.slotDate({ birthday: '2026-01-31' }, 1);
    const big = { naturalWidth: 1600, naturalHeight: 1100 };
    const c0 = M.cover(big, 708, 708, { x: -1, y: 0, z: 1 }); const c1 = M.cover(big, 708, 708, { x: 1, y: 0, z: 1 }); const cz = M.cover(big, 708, 708, { x: 0, y: 0, z: 2 });
    const b = App.store.baby();
    const g1 = M.growthFor(b, 1); const g2 = M.growthFor(b, 2); const g0 = M.growthFor(b, 0); const g5 = M.growthFor(b, 5);
    const tool = (App.tools || []).find((t) => t.id === 'monthly');
    return { L, d, c0: Math.round(c0.dx), c1: Math.round(c1.dx), ox: Math.round(c0.ox), czoy: Math.round(cz.oy), g0, g1, g2, g5, tool: tool && { group: tool.group, stages: tool.stages, screen: tool.screen } };
  });
  ok('labels: 出生, 滿月, 2 個月, 11 個月, 1 歲, 13 個月, 2 歲', u.L.join('|') === '出生|滿月|2 個月|11 個月|1 歲|13 個月|2 歲', u.L.join('|'));
  ok('a month-day past the end of the month is clamped (1/31 → 2/28)', u.d === '2026-02-28', u.d);
  ok('the photo fills its box: x −1 shows the left edge, +1 the right edge; zoom 2 makes room to move up and down', u.c0 === 0 && u.c1 === -u.ox && u.ox > 0 && u.czoy > 0, JSON.stringify(u));
  ok('size on the card: birth size for 出生, the 成長紀錄 nearest the month-day, none when no record is near', u.g0 === '3.12 kg・49.5 cm' && u.g1 === '4.25 kg・53.6 cm' && u.g2 === '5.2 kg・57.2 cm' && u.g5 === '', `${u.g0} / ${u.g1} / ${u.g2} / ${u.g5}`);
  ok('寶寶月照 is a tool (成長發育, after birth)', u.tool && u.tool.group === '成長發育' && u.tool.stages.join() === 'baby' && u.tool.screen === 'monthly', JSON.stringify(u.tool));
  const due = await S(P, () => {
    const M = App.monthly; const b = { id: 'x', birthday: '2026-08-22' };
    const at = (k) => new Date(`${k}T10:00:00+08:00`);
    return {
      day: M.dueSlot(b, at('2026-11-22')), plus6: M.dueSlot(b, at('2026-11-28')), plus7: M.dueSlot(b, at('2026-11-29')), before: M.dueSlot(b, at('2026-11-21')),
      newborn: M.dueSlot({ id: 'y', birthday: '2026-11-20' }, at('2026-11-22')), noBirthday: M.dueSlot({ id: 'z' }),
    };
  });
  ok('首頁 line is due from the month-day for a week (not the day before, not for 出生, not without a birthday)', due.day === 3 && due.plus6 === 3 && due.plus7 === null && due.before === null && due.newborn === null && due.noBirthday === null, JSON.stringify(due));
  // the frames draw the photo where it belongs, and the placeholder without one
  const draw = await S(P, async () => {
    const red = document.createElement('canvas'); red.width = 400; red.height = 300; const rx = red.getContext('2d'); rx.fillStyle = '#ff0000'; rx.fillRect(0, 0, 400, 300);
    const img = await App.share.draw.loadImg(red.toDataURL());
    const out = {};
    for (const f of Object.keys(App.monthly.FRAMES)) { // eslint-disable-line no-restricted-syntax
      const R = App.monthly.FRAMES[f].rect;
      const sp = { m: 2, frame: f, img, crop: {}, label: App.monthly.label(2), name: '小乖', date: '2026.11.08', growth: '5.2 kg', note: '會翻身了', qr: false };
      const cv = await App.monthly.drawCard(sp, 1); // eslint-disable-line no-await-in-loop
      const px = cv.getContext('2d').getImageData(R.x + R.w / 2, R.y + R.h / 3, 1, 1).data;
      const cv0 = await App.monthly.drawCard({ ...sp, img: null }, 1); // eslint-disable-line no-await-in-loop
      const px0 = cv0.getContext('2d').getImageData(R.x + 20, R.y + R.h / 2 + 140, 1, 1).data;
      const lab = cv.getContext('2d').getImageData(0, R.y + R.h + 40, 1080, 200).data; // something is written under the photo
      let ink = 0; for (let i = 0; i < lab.length; i += 16) if (Math.abs(lab[i] - lab[0]) + Math.abs(lab[i + 1] - lab[1]) + Math.abs(lab[i + 2] - lab[2]) > 90) ink += 1;
      out[f] = { w: cv.width, h: cv.height, photo: px[0] > 220 && px[1] < 40 && px[2] < 40, empty: !(px0[0] > 220 && px0[1] < 40), ink };
    }
    const half = await App.monthly.drawCard({ m: 1, frame: 'cream', img, crop: {}, label: App.monthly.label(1), name: '', date: '', growth: '', note: '', qr: false }, 0.5);
    return { out, half: [half.width, half.height] };
  });
  Object.entries(draw.out).forEach(([f, r]) => ok(`frame ${f}: 1080×1350, the photo in its window, the placeholder without one, words under it`, r.w === 1080 && r.h === 1350 && r.photo && r.empty && r.ink > 40, JSON.stringify(r)));
  ok('the live preview is drawn at half size (540×675)', draw.half.join('×') === '540×675', draw.half.join('×'));

  /* ---------- 2. the screen (範例資料: 75 days old, 出生・滿月・2 個月 have sample pictures) ---------- */
  await go(P, 'monthly', null, 1400);
  let T = await tiles(P);
  ok('the screen shows 出生 and the 12 months of the first year (no second year yet)', T.length === 13 && T[0].m === 0 && T[12].m === 12 && !T.some((t) => t.m === 13), T.map((t) => t.m).join());
  ok('出生, 滿月, 2 個月 are done; 3 個月 is still to come with its date', T.filter((t) => /is-done/.test(t.cls)).map((t) => t.m).join() === '0,1,2' && /is-future/.test(T[3].cls) && /12\/8/.test(T[3].text), T.slice(0, 4).map((t) => `${t.m}:${t.cls}:${t.text}`).join(' | '));
  ok('each tile says what it is for a screen reader', /^2 個月，11\/8，已拍$/.test(T[2].label) && /^3 個月，12\/8，還沒到$/.test(T[3].label), `${T[2].label} / ${T[3].label}`);
  const intro = await S(P, () => ({ next: document.querySelector('.mo-next').innerText, now: document.querySelector('.mo-prog').getAttribute('aria-valuenow'), col: document.querySelector('.mo-col-btn').innerText, safe: document.querySelector('.disclaimer').innerText }));
  ok('the top card says what is next (3 個月・12/8, 16 days) and how many are done', /下一張：3 個月・12\/8（還有 16 天）/.test(intro.next) && intro.now === '3', JSON.stringify(intro));
  ok('the collage button counts the year (2／12)', /（2／12）/.test(intro.col), intro.col);
  ok('the screen says the photos stay on the phone and no QR is added unless she wants one', /照片不會上傳/.test(intro.safe) && /不會放 QR/.test(intro.safe), intro.safe);
  const thumbs = await P.waitForFunction(() => [...document.querySelectorAll('.mo-tile.is-done img.mo-img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 6000 }).then(() => true, () => false);
  ok('the sample pictures show in the done tiles (drawn on the phone, never a real baby)', thumbs);
  ok('the sample pictures were made under their fixed ids', await S(P, async () => !!(await App.media.get('demo-m0')) && !!(await App.media.get('demo-m2'))));
  await shot(P, 'monthly-grid');
  await axe(P, 'monthly screen');
  await P.click('.mo-tile[data-m="3"]'); await P.waitForTimeout(300);
  ok('a month still to come only says its date', /3 個月是 12\/8，到時候再來拍/.test(await toast(P)) && !(await P.$('.sheet')), await toast(P));

  /* ---------- 3. the editor ---------- */
  await P.click('.mo-tile[data-m="2"]'); await P.waitForTimeout(700);
  ok('the editor opens for 2 個月 with a drawn preview', /小乖 2 個月/.test(await S(P, () => document.querySelector('.sheet h2').innerText)) && await painted(P));
  let ed = await S(P, () => {
    const sh = document.querySelector('.sheet');
    return {
      frames: [...sh.querySelectorAll('.mo-frame')].map((x) => `${x.innerText.trim()}:${x.getAttribute('aria-pressed')}`), demo: !sh.querySelector('.mo-demo').hidden,
      note: sh.querySelector('.mo-note').value, name: sh.querySelector('.mo-name').value, growth: (sh.querySelector('.mo-growth') || {}).innerText || '', qr: sh.querySelector('.mo-qr input').checked,
      ideas: [...sh.querySelectorAll('.mo-ideas .chip')].map((x) => x.innerText), save: !sh.querySelector('.mo-save').disabled, pick: sh.querySelector('.mo-pick').innerText,
      safe: sh.querySelector('.mo-safe').innerText,
    };
  });
  ok('four frames; the month\'s own frame is chosen', ed.frames.join() === '奶油:false,拍立得:true,花圈:false,夜空:false', ed.frames.join());
  ok('the sample picture says to change it for her own photo', ed.demo && /換一張照片/.test(ed.pick), JSON.stringify(ed));
  ok('the name, the line, the size (5.2 kg・57.2 cm) and no QR by default', ed.name === '小乖' && ed.note === '會發出「咕咕」「啊」等聲音了' && /5\.2 kg・57\.2 cm/.test(ed.growth) && !ed.qr, JSON.stringify(ed));
  ok('line ideas start with the skill checked in 發展里程碑 that month', ed.ideas[0] === '會發出「咕咕」「啊」等聲音了' && ed.ideas.length >= 4, ed.ideas.join(' / '));
  ok('the editor says the photo stays on the phone', /只存在這支手機/.test(ed.safe), ed.safe);
  await shot(P, 'monthly-editor');
  await axe(P, 'monthly editor');

  // her own photo replaces the sample one
  const wide = await makePhoto(P, 'wide.png');
  await P.setInputFiles('.sheet input[type=file]', wide); await P.waitForTimeout(1500);
  let sl = await slot(P, 2);
  ok('a picked photo is kept in the phone\'s photo store and the month points at it', sl && sl.photo && sl.photo !== 'demo-m2' && await S(P, async (id) => !!(await App.media.get(id)), sl.photo), JSON.stringify(sl));
  ok('the replaced sample picture is removed', await S(P, async () => !(await App.media.get('demo-m2'))));
  ok('a new photo starts centred and not zoomed', sl.crop.x === 0 && sl.crop.y === 0 && sl.crop.z === 1, JSON.stringify(sl.crop));
  ok('the sample note goes away with her own photo', await S(P, () => document.querySelector('.sheet .mo-demo').hidden));
  // drag, zoom, keys
  const box = await P.locator('.sheet .mo-cv').boundingBox();
  await P.mouse.move(box.x + box.width / 2, box.y + box.height / 3); await P.mouse.down();
  await P.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 3, { steps: 4 }); await P.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 3, { steps: 4 });
  await P.mouse.up(); await P.waitForTimeout(600);
  sl = await slot(P, 2);
  ok('dragging the photo left shows more of its right side (and is saved)', sl.crop.x > 0.2 && sl.crop.y === 0, JSON.stringify(sl.crop));
  await S(P, () => { const z = document.querySelector('.sheet .mo-zoom'); z.value = '2'; z.dispatchEvent(new Event('input', { bubbles: true })); });
  await P.waitForTimeout(600);
  ok('the zoom slider zooms (and is saved)', (await slot(P, 2)).crop.z === 2);
  await P.focus('.sheet .mo-cv'); await P.keyboard.press('ArrowUp'); await P.keyboard.press('ArrowUp'); await P.waitForTimeout(600);
  ok('arrow keys move the photo too', (await slot(P, 2)).crop.y < -0.1, JSON.stringify((await slot(P, 2)).crop));
  await P.keyboard.press('-'); await P.waitForTimeout(600);
  ok('and − zooms out', Math.abs((await slot(P, 2)).crop.z - 1.9) < 0.001, (await slot(P, 2)).crop.z);
  // frame, name, line, QR
  await P.click('.sheet .mo-frame[data-frame="night"]'); await P.waitForTimeout(500);
  ok('choosing 夜空 saves the frame for this month and as the next default', (await slot(P, 2)).frame === 'night' && await S(P, () => App.store.state.monthly.frame) === 'night');
  await P.fill('.sheet .mo-name', '乖乖'); await P.waitForTimeout(500);
  ok('a nickname is kept for this card', (await slot(P, 2)).name === '乖乖');
  await P.fill('.sheet .mo-name', ''); await P.waitForTimeout(500);
  ok('an empty name leaves the name off the card', (await slot(P, 2)).name === '');
  await P.fill('.sheet .mo-name', '小乖'); await P.waitForTimeout(500);
  ok('the baby\'s own name again follows the baby (nothing extra stored)', (await slot(P, 2)).name === null);
  await P.click('.sheet .mo-ideas .chip:has-text("每天都在長大")'); await P.waitForTimeout(500);
  ok('a line idea fills the line', (await slot(P, 2)).note === '每天都在長大' && await S(P, () => document.querySelector('.sheet .mo-note').value) === '每天都在長大');
  await P.fill('.sheet .mo-note', '一二三四五六七八九十一二三四五六七八九十一二三四五六七八'); await P.waitForTimeout(500);
  ok('the line is at most 24 characters', Array.from((await slot(P, 2)).note).length === 24, (await slot(P, 2)).note);
  await P.fill('.sheet .mo-note', '會笑出聲了'); await P.waitForTimeout(400);
  await P.click('.sheet .mo-qr'); await P.waitForTimeout(500);
  ok('the invite QR is her choice (and remembered)', await S(P, () => App.store.state.monthly.qr) === true);
  await P.click('.sheet .mo-growth'); await P.waitForTimeout(500);
  ok('the size can be left off', (await slot(P, 2)).growth === false);
  // 存圖片: the full-size JPEG
  const [dl] = await Promise.all([P.waitForEvent('download'), P.click('.sheet .mo-save')]);
  const buf = fs.readFileSync(await dl.path());
  const dim = jpegSize(buf);
  ok('存圖片 gives a 1080×1350 JPEG with a plain file name', dl.suggestedFilename() === 'yijia-month-02.jpg' && dim && dim.w === 1080 && dim.h === 1350, `${dl.suggestedFilename()} ${JSON.stringify(dim)} ${buf.length}`);
  await P.waitForTimeout(300);
  ok('…and says so', /圖片已下載/.test(await toast(P)), await toast(P));
  ok('the month remembers it was saved', (await slot(P, 2)).out === '2026-11-22');
  // 分享 on a browser that cannot share files: it downloads and says how to send it
  const [dl2] = await Promise.all([P.waitForEvent('download'), P.click('.sheet .mo-share')]);
  await P.waitForTimeout(300);
  ok('分享 where files cannot be shared: the picture is downloaded with a hint', dl2.suggestedFilename() === 'yijia-month-02.jpg' && /不能直接分享圖片/.test(await toast(P)), await toast(P));
  await closeSheets(P);
  ok('closing the editor keeps everything', (await slot(P, 2)).note === '會笑出聲了' && (await slot(P, 2)).frame === 'night');
  T = await tiles(P);
  ok('…and the grid shows her photo in 2 個月', /is-done/.test(T[2].cls));

  // deleting a month's photo
  await P.click('.mo-tile[data-m="2"]'); await P.waitForTimeout(800);
  const delId = (await slot(P, 2)).photo;
  await P.click('.sheet .mo-del'); await P.waitForTimeout(400);
  ok('deleting asks first, and says the original in her album is not affected', /刪除 2 個月的月照？手機相簿裡的原照片不會受影響/.test(await S(P, () => [...document.querySelectorAll('.confirm-msg')].map((x) => x.innerText).join())));
  await P.click('.sheet .btn-danger'); await P.waitForTimeout(700);
  ok('the month is empty again and its photo is gone from the phone', !(await slot(P, 2)) && await S(P, async (id) => !(await App.media.get(id)), delId));
  ed = await S(P, () => { const sh = document.querySelector('.sheet'); return { pick: sh.querySelector('.mo-pick').innerText, save: sh.querySelector('.mo-save').disabled, del: sh.querySelector('.mo-del').hidden }; });
  ok('the editor goes back to 「選一張照片」 (save and share wait for a photo)', /選一張照片/.test(ed.pick) && ed.save && ed.del, JSON.stringify(ed));
  const chooser = await Promise.all([P.waitForEvent('filechooser', { timeout: 3000 }), P.click('.sheet .mo-cv')]).then(() => true, () => false);
  ok('tapping the empty preview opens the photo picker', chooser);
  const tall = await makePhoto(P, 'tall.png', 900, 1400);
  await P.setInputFiles('.sheet input[type=file]', tall); await P.waitForTimeout(1500);
  ok('the first photo of a month is welcomed', /已放進 2 個月的相框/.test(await toast(P)), await toast(P));
  await closeSheets(P);

  // the year collage
  await go(P, 'monthly', null, 1000);
  await P.click('.mo-col-btn'); await P.waitForTimeout(800);
  ok('the collage opens with what is in it so far', /小乖的第一年/.test(await S(P, () => document.querySelector('.sheet h2').innerText)) && /已放 2／12 張/.test(await S(P, () => document.querySelector('.mo-count').innerText)) && await painted(P, '.sheet .mo-cv-col'));
  await shot(P, 'monthly-collage');
  await axe(P, 'monthly collage');
  const [dl3] = await Promise.all([P.waitForEvent('download'), P.click('.sheet .mo-save')]);
  const d3 = jpegSize(fs.readFileSync(await dl3.path()));
  ok('the collage saves as a 1080×1350 JPEG', dl3.suggestedFilename() === 'yijia-year-1.jpg' && d3 && d3.w === 1080 && d3.h === 1350, `${dl3.suggestedFilename()} ${JSON.stringify(d3)}`);
  await closeSheets(P);

  /* ---------- 4. backups and the photo store ---------- */
  const keep = await S(P, async () => {
    const ids = Object.values(App.store.state.monthly.babies[App.store.baby().id]).map((x) => x.photo);
    const ref = App.media.referenced();
    await App.media.prune();
    const still = await Promise.all(ids.map((id) => App.media.get(id).then((x) => !!x)));
    return { ids, inRef: ids.every((id) => ref.includes(id)), still };
  });
  ok('月照 photos are counted as the app\'s photos and prune keeps them', keep.inRef && keep.still.every(Boolean), JSON.stringify(keep));
  const [bk] = await Promise.all([P.waitForEvent('download'), S(P, () => App.me.exportData())]);
  const json = JSON.parse(fs.readFileSync(await bk.path(), 'utf8'));
  const bIds = Object.values(json.data.monthly.babies['demo-baby']).map((x) => x.photo);
  ok('the backup file carries the 月照 and their photos', bIds.length === 3 && bIds.every((id) => /^data:image\/jpeg/.test(json.media[id] || '')), bIds.join());
  await go(P, 'me', null, 900);
  const line = await S(P, () => (document.querySelector('.storage-line') || {}).textContent || '');
  ok('我的 counts the photos (產檢日記 and 寶寶月照)', /照片 \d+ 張（產檢日記、寶寶月照，約 [\d.]+ MB）/.test(line), line);

  /* ---------- 5. 首頁 on the month-day ---------- */
  await S(P, () => App.store.update((s) => { s.babies[0].birthday = '2026-08-22'; s.monthly.skip = {}; }));
  await go(P, 'home', null, 1200);
  const hl = await S(P, () => { const e = document.querySelector('.mo-home'); return e && e.innerText.replace(/\s+/g, ' ').trim(); });
  ok('首頁 shows 「小乖 3 個月了・拍張月照留作紀念」 on the month-day', hl && /小乖 3 個月了/.test(hl) && /拍張月照留作紀念/.test(hl), hl);
  await shot(P, 'monthly-home');
  await P.click('.mo-home-go'); await P.waitForTimeout(1300);
  ok('…which opens that month\'s editor', /#\/monthly/.test(await S(P, () => location.hash)) && /小乖 3 個月/.test(await S(P, () => (document.querySelector('.sheet h2') || {}).innerText || '')));
  await closeSheets(P);
  await go(P, 'home', null, 1000);
  await P.click('.mo-home-x'); await P.waitForTimeout(700);
  ok('✕ skips this month (and says where to find it)', !(await P.$('.mo-home')) && /健康 → 寶寶月照/.test(await toast(P)) && await S(P, () => !!App.store.state.monthly.skip['demo-baby:3']), await toast(P));
  // 滿月: the 滿月 line on 首頁 is the custom one; its sheet offers the 滿月照
  await S(P, () => App.store.update((s) => { s.babies[0].birthday = '2026-10-22'; delete s.monthly.babies['demo-baby'][1]; }));
  await go(P, 'home', null, 1200);
  ok('on 滿月 the 滿月 line shows (not a second line)', !!(await P.$('.moment-line:not(.mo-home-go)')) && !(await P.$('.mo-home')));
  await P.click('.moment-line'); await P.waitForTimeout(600);
  const mb = await S(P, () => (document.querySelector('.sheet .sh-monthly') || {}).innerText || '');
  ok('the 滿月 sheet offers 「📸 拍滿月照」', /拍滿月照/.test(mb), mb);
  await P.click('.sheet .sh-monthly'); await P.waitForTimeout(1300);
  ok('…which opens the 滿月 editor', /小乖 滿月/.test(await S(P, () => (document.querySelector('.sheet h2') || {}).innerText || '')));
  await closeSheets(P);

  /* ---------- 6. twins, an older child, no birthday, no baby ---------- */
  await S(P, () => App.store.update((s) => { s.babies[0].birthday = '2026-09-08'; s.babies.push({ id: 'b2', name: '小寶', sex: 'boy', birthday: '2026-05-01', avatar: '👶' }); }));
  await go(P, 'monthly', { baby: 'b2' }, 1200);
  T = await tiles(P);
  const seg = await S(P, () => [...document.querySelectorAll('.seg button, .seg [role=radio]')].map((x) => x.innerText.trim()));
  ok('twins: a switch between the babies', seg.includes('小乖') && seg.includes('小寶'), seg.join());
  ok('小寶 (6 months): nothing done, 出生 to 5 個月 can be taken late, 6 個月 is this month', T.filter((t) => /is-past/.test(t.cls)).length === 6 && T.filter((t) => /is-now/.test(t.cls)).map((t) => t.m).join() === '6' && !T.some((t) => /is-done/.test(t.cls)), T.map((t) => `${t.m}:${t.cls.replace('mo-tile ', '')}`).join(' '));
  await P.click('.mo-tile[data-m="0"]'); await P.waitForTimeout(700);
  await P.setInputFiles('.sheet input[type=file]', wide); await P.waitForTimeout(1500);
  ok('小寶\'s 出生照 is kept under 小寶', !!(await slot(P, 0, 'b2')) && /已放進出生照的相框/.test(await toast(P)), await toast(P));
  const b2photo = (await slot(P, 0, 'b2')).photo;
  await closeSheets(P);
  await S(P, () => { App.navigate('monthly', { baby: 'demo-baby' }); });
  await P.waitForTimeout(900);
  ok('switching back shows 小乖\'s photos (出生 and 2 個月; 滿月 was cleared above)', (await tiles(P)).filter((t) => /is-done/.test(t.cls)).map((t) => t.m).join() === '0,2', (await tiles(P)).map((t) => `${t.m}:${t.cls}`).join(' '));
  // deleting 小寶 drops their 月照 (and prune clears the photo)
  await S(P, () => { App.store.update((s) => { s.activeBabyId = 'b2'; }); App.me.editBaby(App.store.state.babies.find((x) => x.id === 'b2')); });
  await P.waitForTimeout(600);
  await P.click('.sheet [aria-label="刪除寶寶"]'); await P.waitForTimeout(400);
  await P.click('.sheet .btn-danger'); await P.waitForTimeout(700);
  const gone = await S(P, async (id) => { await App.media.prune(); return { entry: !!App.store.state.monthly.babies.b2, photo: !!(await App.media.get(id)) }; }, b2photo);
  ok('deleting a baby removes their 月照 and the photo', !gone.entry && !gone.photo, JSON.stringify(gone));
  await closeSheets(P);
  // an older child: the second year, and a kind line
  await S(P, () => App.store.update((s) => { s.babies[0].birthday = '2024-09-01'; }));
  await go(P, 'monthly', null, 1200);
  T = await tiles(P);
  const older = await S(P, () => ({ next: document.querySelector('.mo-next').innerText, titles: [...document.querySelectorAll('.section-title span:first-child')].map((x) => x.innerText) }));
  ok('past one year: the second year (13 個月 → 2 歲) shows too', T.some((t) => t.m === 13) && T.some((t) => t.m === 24) && older.titles.includes('第二年'), older.titles.join());
  ok('past two years: a kind line instead of 「下一張」', /兩歲以前的每個月都在這裡/.test(older.next), older.next);
  await S(P, () => { App.store.update((s) => { s.babies[0].birthday = ''; }); App.refresh(); });
  await P.waitForTimeout(700);
  ok('no birthday: it asks for the birthday first', /先填寶寶的生日/.test(await S(P, () => document.getElementById('view').innerText)));
  await S(P, () => { App.store.update((s) => { s.babies = []; s.activeBabyId = null; }); App.refresh(); });
  await P.waitForTimeout(700);
  ok('no baby yet: it says what 月照 are for, with 新增寶寶', /寶寶出生後，每個月拍一張月照/.test(await S(P, () => document.getElementById('view').innerText)) && !!(await P.$('#view button:has-text("新增寶寶")')));

  /* ---------- 7. sharing where the phone can share files ---------- */
  const Q = await mk({ share: true });
  await go(Q, 'monthly', null, 1300);
  await Q.click('.mo-tile[data-m="1"]'); await painted(Q);
  await Q.click('.sheet .mo-share');
  // making the JPEG can take several seconds on a busy machine (the 0.9.1 battery missed it at a fixed 1.5 s):
  // wait for the share and the thank-you themselves, not a fixed time
  await Q.waitForFunction(() => !!window.__shared, null, { timeout: 8000 }).catch(() => {});
  await Q.waitForFunction(() => /謝謝分享/.test((document.querySelector('.toast-wrap') || {}).innerText || ''), null, { timeout: 3000 }).catch(() => {});
  const sh = await S(Q, () => window.__shared || null);
  ok('分享 hands the phone a JPEG and a short line', sh && sh.name === 'yijia-month-01.jpg' && sh.type === 'image/jpeg' && sh.size > 20000 && sh.text === '小乖滿月了 📸', JSON.stringify(sh));
  ok('…and thanks her', /謝謝分享/.test(await toast(Q)), await toast(Q));

  // a second tap while the picture is made; a share while the share sheet is open; an older phone that says no
  const waitToast = (p, src, ms = 8000) => p.waitForFunction((x) => new RegExp(x).test((document.querySelector('.toast-wrap') || {}).innerText || ''), src, { timeout: ms }).then(() => true, () => false);
  const clearToasts = (p) => S(p, () => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const tapToast = (p) => p.click('.toast-action', { timeout: 5000 }).then(() => true, () => false);
  await S(Q, () => {
    window.__calls = 0; window.__dl = 0; window.__shared = null;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function c() { if (this.hasAttribute('download')) { window.__dl += 1; return undefined; } return click.call(this); };
    let open = false; // like a real phone: another share while the sheet is open is refused
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d) => {
        if (open) throw new DOMException('An earlier share has not yet completed.', 'InvalidStateError');
        open = true; window.__calls += 1; window.__shared = { name: d.files[0].name };
        await new Promise((r) => setTimeout(r, 800)); open = false;
      },
    });
  });
  await clearToasts(Q);
  await Q.click('.sheet .mo-share');
  const during = await S(Q, () => ({ text: document.querySelector('.sheet .mo-share').textContent, busy: document.querySelector('.sheet .mo-share').getAttribute('aria-busy'), save: document.querySelector('.sheet .mo-save').getAttribute('aria-busy') }));
  await Q.click('.sheet .mo-share', { force: true }); await Q.click('.sheet .mo-save', { force: true });
  await Q.waitForFunction(() => window.__calls > 0 && !document.querySelector('.sheet .mo-share[aria-busy]'), null, { timeout: 10000 }).catch(() => {});
  const twice = await S(Q, () => ({ calls: window.__calls, dl: window.__dl, toast: (document.querySelector('.toast-wrap') || {}).innerText || '', text: document.querySelector('.sheet .mo-share').textContent }));
  ok('分享 says 「做圖中…」 while the picture is made, and 存圖片 waits too', during.text === '做圖中…' && during.busy === 'true' && during.save === 'true', JSON.stringify(during));
  ok('…tapping again meanwhile (分享 or 存圖片) shares once and downloads nothing', twice.calls === 1 && twice.dl === 0 && !/不能直接分享|已先下載/.test(twice.toast) && twice.text === '📤 分享', JSON.stringify(twice));
  const openTwice = await S(Q, async () => {
    const blob = new Blob([new Uint8Array(30000)], { type: 'image/jpeg' });
    const first = App.share.sharePicture(blob, 'a.jpg');
    const second = await App.share.sharePicture(blob, 'a.jpg');
    return { first: await first, second, dl: window.__dl };
  });
  ok('a share while the share sheet is open does nothing (it used to download and say 「不能分享」)', openTwice.first === 'shared' && openTwice.second === 'open' && openTwice.dl === 0, JSON.stringify(openTwice));
  // an older phone: the picture took longer than the phone allows after a tap, so it says no
  await S(Q, () => {
    window.__shared = null; window.__tries = 0;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d) => {
        window.__tries += 1;
        if (window.__tries === 1) throw new DOMException('Must be handling a user gesture to perform a share request.', 'NotAllowedError');
        window.__shared = { name: d.files[0].name, text: d.text || '', title: d.title || '' };
      },
    });
  });
  await clearToasts(Q);
  await Q.click('.sheet .mo-share');
  await waitToast(Q, '圖片做好了');
  const late = await S(Q, () => ({ toast: document.querySelector('.toast-wrap').innerText, action: (document.querySelector('.toast-action') || {}).textContent, dl: window.__dl, shared: window.__shared }));
  ok('an older phone that says no after a slow picture: 「圖片做好了」 with 分享 (no download, no 「不能分享」)', /圖片做好了/.test(late.toast) && late.action === '分享' && late.dl === 0 && !late.shared && !/不能直接分享/.test(late.toast), JSON.stringify(late));
  await tapToast(Q);
  await waitToast(Q, '謝謝分享', 4000);
  const late2 = await S(Q, () => ({ toast: document.querySelector('.toast-wrap').innerText, dl: window.__dl, shared: window.__shared }));
  ok('…that tap shares it, with the line and the thanks', !!late2.shared && late2.shared.name === 'yijia-month-01.jpg' && late2.shared.text === '小乖滿月了 📸' && /謝謝分享/.test(late2.toast) && late2.dl === 0, JSON.stringify(late2));
  await S(Q, () => { window.__shared = null; window.__tries = 0; });
  await clearToasts(Q);
  await Q.click('.sheet .mo-save');
  await waitToast(Q, '圖片做好了');
  const lateSave = await S(Q, () => ({ action: (document.querySelector('.toast-action') || {}).textContent, dl: window.__dl }));
  await tapToast(Q);
  await Q.waitForFunction(() => !!window.__shared, null, { timeout: 4000 }).catch(() => {});
  const saved = await S(Q, () => window.__shared);
  ok('存圖片 on that phone: 「圖片做好了」 with 儲存, which hands it to the phone', lateSave.action === '儲存' && lateSave.dl === 0 && !!saved && saved.name === 'yijia-month-01.jpg' && saved.title === '寶寶月照', JSON.stringify({ lateSave, saved }));
  await S(Q, () => { Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('not allowed', 'NotAllowedError'); } }); });
  await clearToasts(Q);
  await Q.click('.sheet .mo-share'); await waitToast(Q, '圖片做好了');
  await tapToast(Q); await waitToast(Q, '已先下載', 4000);
  const still = await S(Q, () => ({ dl: window.__dl, toast: document.querySelector('.toast-wrap').innerText }));
  ok('…and if it still says no after that tap, the picture is downloaded with a line saying so', still.dl === 1 && /已先下載/.test(still.toast), JSON.stringify(still));
  await closeSheets(Q);
  ok('sw.js caches the 月照 files', await S(Q, async () => { const t = await (await fetch('sw.js')).text(); return t.includes("'js/modules/monthly.js'") && t.includes("'css/monthly.css'"); }));

  /* ---------- 8. a small phone, dark ---------- */
  const R = await mk({ width: 320, height: 568, scheme: 'dark' });
  await S(R, () => { App.isNight = () => true; App.applyTheme(); });
  await go(R, 'monthly', null, 1300);
  const fit = await S(R, () => {
    const t = [...document.querySelectorAll('.mo-grid:not(.mo-grid-0) .mo-tile')].slice(0, 3).map((x) => Math.round(x.getBoundingClientRect().top));
    return { over: document.documentElement.scrollWidth - innerWidth, row: t, night: document.body.classList.contains('night') };
  });
  ok('320 px: three tiles a row, nothing wider than the screen', fit.over <= 0 && fit.row.length === 3 && new Set(fit.row).size === 1, JSON.stringify(fit));
  await shot(R, 'monthly-small-dark');
  await axe(R, 'monthly screen, small and dark');
  await R.click('.mo-tile[data-m="2"]'); await R.waitForTimeout(900);
  const fb = await S(R, () => { const a = document.querySelector('.sheet .mo-save').getBoundingClientRect(); const c = document.querySelector('.sheet .mo-cv').getBoundingClientRect(); return { btn: Math.round(a.bottom), cv: Math.round(c.width), h: innerHeight }; });
  ok('320 px editor: the preview fits and 存圖片／分享 stay on screen', fb.btn <= fb.h && fb.cv <= 300 && fb.cv > 200, JSON.stringify(fb));
  await axe(R, 'monthly editor, small and dark');
  await shot(R, 'monthly-editor-small-dark');

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  const pass = results.filter((r) => r.pass).length;
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ← ${r.info}`}`));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
