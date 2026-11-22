// Q 版角色與產檢日記島測試：上傳正面照（只在手機處理、不上傳）做出長得像媽媽的 Q 版角色，出現在首頁、我的、群島地圖；
// 產檢日記：每次產檢放超音波照片＋想對寶寶說的話、自己加一頁、分享卡、PDF；照片不塞進主要存檔、備份檔會帶走、家人合併也帶得到。
// Usage: cd mom-app && python3 -m http.server 8080   then   node tests/diary.playwright.cjs   [BASE=...]
const { chromium, devices } = require('playwright');
const fs = require('fs'); const path = require('path'); const os = require('os');
const BASE = process.env.BASE || 'http://localhost:8080/';
const results = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mom-diary-'));

(async () => {
  const browser = await chromium.launch();
  const errors = []; const outside = [];
  // test pictures: a portrait (tan face, dark hair, light background) and an "ultrasound"
  const pg0 = await browser.newPage();
  const pic = async (fn) => Buffer.from((await pg0.evaluate(fn)).split(',')[1], 'base64');
  fs.writeFileSync(path.join(TMP, 'me.jpg'), await pic(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d'); x.fillStyle = '#cfe3ec'; x.fillRect(0, 0, 600, 800); x.fillStyle = '#2a1c18'; x.beginPath(); x.ellipse(300, 330, 210, 260, 0, 0, Math.PI * 2); x.fill(); x.fillRect(90, 330, 420, 420); x.fillStyle = '#e9b994'; x.beginPath(); x.ellipse(300, 380, 150, 190, 0, 0, Math.PI * 2); x.fill(); x.fillStyle = '#2a1c18'; x.beginPath(); x.ellipse(300, 230, 160, 70, 0, Math.PI, 0); x.fill(); return c.toDataURL('image/jpeg', 0.9); }));
  fs.writeFileSync(path.join(TMP, 'us.jpg'), await pic(() => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1700; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 2400, 1700); x.fillStyle = '#bbb'; x.beginPath(); x.ellipse(1200, 850, 400, 260, 0.3, 0, Math.PI * 2); x.fill(); for (let i = 0; i < 4000; i += 1) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.4})`; x.fillRect(Math.random() * 2400, Math.random() * 1700, 3, 3); } return c.toDataURL('image/jpeg', 0.95); }));
  await pg0.close();
  const usSize = fs.statSync(path.join(TMP, 'us.jpg')).size;

  const open = async (opts = {}) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'zh-TW', acceptDownloads: true, ...opts });
    await ctx.addInitScript(() => { window.__noShareMoments = true; });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept().catch(() => {}));
    p.on('request', (r) => { const u = r.url(); if (!/^(https?:\/\/(localhost|127\.0\.0\.1)|data:|blob:)/.test(u)) outside.push(u); });
    await p.goto(BASE); await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.avatar && App.diary && App.media);
    return { p, ctx };
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, id, params, ms = 800) => { await S(p, ([x, prm]) => App.navigate(x, { ...(prm || {}), n: Math.random().toString(36).slice(2, 6) }), [id, params]); await p.waitForTimeout(ms); };
  const top = (p) => S(p, () => { const all = document.querySelectorAll('.sheet'); return (all[all.length - 1] || {}).innerText || ''; });
  const esc = async (p) => { for (let i = 0; i < 3; i += 1) { if (!(await S(p, () => document.body.classList.contains('has-sheet')))) break; await p.keyboard.press('Escape'); await p.waitForTimeout(350); } };
  const asPreg = (p, weeks) => S(p, (w) => { const s = App.store.defaults(); s.onboarded = true; s.onboardedAt = '2026-01-01'; s.profile.stage = 'preg'; s.profile.momName = '小美'; s.settings.a2hsDismissed = '1'; s.island = { stamps: {}, quiz: {}, visited: {}, seen: { prep: 1, preg1: 1, preg2: 1 }, toured: '1' }; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -(w * 7))); s.profile.edd = Core.eddFromLmp(s.profile.lmp); App.store.replace(s); }, weeks);
  const ADD = '.sheet :is(.dy-drop, .dy-add-photo)'; // the 上傳區 while there are no photos, then the small ＋
  const pickFile = async (p, clickSel, file) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click(clickSel)]); await fc.setFiles(path.join(TMP, file)); };

  const { p, ctx } = await open();
  await asPreg(p, 22);

  /* ---------- 1. Q 版角色 from a photo, made on the phone ---------- */
  await go(p, 'avatar');
  ok('我的 Q 版角色: 「建立你的 Q 版角色」 with 拍一張 / 從相簿選 and a privacy line', /建立你的 Q 版角色/.test(await S(p, () => document.body.innerText)) && /不會上傳/.test(await S(p, () => document.body.innerText)));
  ok('…拍一張 opens the front camera on phones (capture="user")', await S(p, () => !!document.querySelector('input[type=file][capture="user"]')));
  await pickFile(p, 'button:has-text("從相簿選")', 'me.jpg'); await p.waitForTimeout(900);
  ok('a photo opens 「把臉放進框框裡」 with a face guide and zoom', /把臉放進框框裡/.test(await top(p)) && await S(p, () => !!document.querySelector('.sheet .av-crop-guide') && !!document.querySelector('.sheet input[type=range]')));
  await p.click('.sheet button:has-text("產生我的 Q 版角色")'); await p.waitForTimeout(800);
  const av = await S(p, () => { const a = App.store.state.profile.avatar; return a && { skin: a.skin, hair: a.hair, face: (a.face || '').length, keys: Object.keys(a) }; });
  const near = (hex, rgb, d) => { const n = parseInt(hex.slice(1), 16); return Math.hypot(((n >> 16) & 255) - rgb[0], ((n >> 8) & 255) - rgb[1], (n & 255) - rgb[2]) < d; };
  ok('the chibi takes her skin tone and hair colour from the photo', av && near(av.skin, [0xe9, 0xb9, 0x94], 45) && near(av.hair, [0x2a, 0x1c, 0x18], 40), JSON.stringify(av));
  ok('only a small face crop is kept (for the 照片大頭 style) — the original photo is not saved', av && av.face > 1000 && av.face < 30000 && (await S(p, () => JSON.stringify(App.store.state).length)) < 60000, JSON.stringify(av));
  ok('nothing was sent anywhere while making the character', !outside.length, outside.slice(0, 3).join(' '));
  await p.click('.chip:has-text("馬尾")'); await p.click('.chip:has-text("眼鏡")'); await p.waitForTimeout(300);
  ok('hairstyle and glasses can be changed (saved at once)', await S(p, () => { const a = App.store.state.profile.avatar; return a.style === 'pony' && a.glasses === true; }));
  await p.click('.chip:has-text("照片大頭")'); await p.waitForTimeout(300);
  ok('「照片大頭」 puts her own face on the chibi body', await S(p, () => App.store.state.profile.avatar.mode === 'photo' && /<image href="data:image\/jpeg/.test(document.querySelector('.av-preview').innerHTML)));
  await p.click('.chip:has-text("Q 版插畫")'); await p.waitForTimeout(200);
  ok('while pregnant the chibi has a round belly; after birth a baby in her arms', await S(p, () => { const a = App.store.state.profile.avatar; return /ry="14"/.test(App.avatar.svg(a, { pose: 'preg' })) && /#fbe3ea/.test(App.avatar.svg(a, { pose: 'baby' })) && !/#fbe3ea/.test(App.avatar.svg(a, { pose: 'preg' })); }));

  /* ---------- 2. she plays as her character ---------- */
  await go(p, 'home', null, 700);
  ok('首頁: her chibi next to the greeting (tap → the maker)', await S(p, () => !!document.querySelector('.greet .greet-av .av-head svg')));
  await go(p, 'me', null, 600);
  ok('我的: her chibi on the profile card', await S(p, () => !!document.querySelector('.me-card .av-head svg')));
  await go(p, 'island', null, 1300);
  const onMap = await S(p, () => { const im = document.querySelector('.isl-ibanner.here .isl-ib-av image'); if (!im) return null; const r = im.getBoundingClientRect(); return { w: Math.round(r.width), inView: r.top > 0 && r.bottom < innerHeight && r.left >= 0 && r.right <= innerWidth, hud: !!document.querySelector('.isl-hud .av-head') }; });
  ok('好孕群島: she stands on the island she is at (孕中期島), and her face is on the top bar', onMap && onMap.inView && onMap.w >= 30 && onMap.hud, JSON.stringify(onMap));
  await S(p, () => { const im = document.querySelector('.isl-ib-av image'); const r = im.getBoundingClientRect(); const o = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch' }; im.dispatchEvent(new PointerEvent('pointerdown', o)); im.dispatchEvent(new PointerEvent('pointerup', o)); });
  await p.waitForTimeout(500);
  ok('…tap her chibi on the map: the character maker', /#\/avatar/.test(await S(p, () => location.hash)));

  /* ---------- 3. 產檢日記島 ---------- */
  await go(p, 'island', null, 1200);
  const dIsl = await S(p, () => ({ plate: (document.querySelector('.isl-ibanner[data-island="diary"]') || {}).textContent || '', chip: !!document.querySelector('.isl-chip.special[data-island="diary"]') }));
  ok('the diary island is on the map beside 孕中期島, with its own chip in the island strip', /產檢日記島/.test(dIsl.plate) && dIsl.chip, JSON.stringify(dIsl));
  await p.tap('.isl-chip[data-island="diary"]'); await p.waitForTimeout(900);
  await p.tap('.isl-chip[data-island="diary"]'); await p.waitForTimeout(900);
  ok('…open it (tap its chip twice, or the island): 產檢日記', /#\/diary/.test(await S(p, () => location.hash)) && /給寶寶的產檢日記/.test(await S(p, () => document.body.innerText)));
  ok('an empty diary explains itself', /放一張超音波照片、寫一句想對寶寶說的話/.test(await S(p, () => document.body.innerText)));
  // a prenatal visit, with an ultrasound picture and a sentence
  await S(p, () => App.preg.openVisitSheet(App.PREG_DATA.PRENATAL[2])); await p.waitForTimeout(500);
  ok('the prenatal visit form now has 「放進產檢日記」: ultrasound photos (a wide 上傳區 while there are none) + one sentence to the baby', /放進產檢日記/.test(await top(p)) && await S(p, () => /加入超音波或產檢照片/.test((document.querySelector('.sheet .dy-drop') || {}).textContent || '') && !!document.querySelector('.sheet .dy-msg-in')));
  await pickFile(p, ADD, 'us.jpg'); await p.waitForTimeout(1200);
  ok('…with one photo in: the picture, and a small ＋ for the next one', await S(p, () => !document.querySelector('.sheet .dy-drop') && !!document.querySelector('.sheet .dy-thumb-img') && !!document.querySelector('.sheet .dy-add-photo')));
  await p.fill('.sheet .dy-msg-in', '今天第一次聽到你的心跳，好有力！');
  await p.click('.sheet-footer .btn-primary'); await p.waitForTimeout(700);
  const saved = await S(p, async () => { const n = App.store.state.preg.visitNotes[App.PREG_DATA.PRENATAL[2].key]; const b = await App.media.get(n.photos[0]); return { msg: n.msg, photos: n.photos.length, bytes: b ? b.size : 0, type: b ? b.type : '', stateLen: JSON.stringify(App.store.state).length }; });
  ok('saved: the sentence, and the photo as a compressed JPEG on the phone (not in the main save)', saved.msg === '今天第一次聽到你的心跳，好有力！' && saved.photos === 1 && saved.type === 'image/jpeg' && saved.bytes > 5000 && saved.bytes < usSize && saved.stateLen < 60000, JSON.stringify({ ...saved, original: usSize }));
  await go(p, 'diary', null, 1100);
  const pg1 = await S(p, () => ({ pages: document.querySelectorAll('.dy-page').length, week: (document.querySelector('.dy-page-week') || {}).textContent, img: [...document.querySelectorAll('.dy-page .dy-thumb-img')].some((i) => i.naturalWidth > 0), quote: (document.querySelector('.dy-page .dy-quote') || {}).textContent }));
  ok('the diary shows the page: 22 週, the ultrasound picture and 「今天第一次聽到你的心跳」', pg1.pages === 1 && /22 週/.test(pg1.week) && pg1.img && /第一次聽到你的心跳/.test(pg1.quote), JSON.stringify(pg1));
  // a page of her own
  await p.click('button:has-text("新增一頁")'); await p.waitForTimeout(500);
  await p.fill('.sheet input[type=text]', '第一次感覺到胎動');
  await pickFile(p, ADD, 'us.jpg'); await p.waitForTimeout(1000);
  await p.fill('.sheet .dy-msg-in', '你在肚子裡翻身了！');
  await p.click('.sheet-footer .btn-primary'); await p.waitForTimeout(800);
  ok('「＋ 新增一頁」: her own page (第一次感覺到胎動) joins the diary', (await S(p, () => document.querySelectorAll('.dy-page').length)) === 2 && /第一次感覺到胎動/.test(await S(p, () => document.body.innerText)));
  // share one page
  await p.click('.dy-page >> nth=0 >> button:has-text("分享這一頁")'); await p.waitForTimeout(1500);
  ok('分享這一頁: the share sheet with a card made from the ultrasound photo', /LINE/.test(await top(p)) && await S(p, () => { const all = document.querySelectorAll('.sheet'); return !!all[all.length - 1].querySelector('.sh-img'); }));
  await esc(p);
  const card = await S(p, async () => { const pg = App.diary.pages()[0]; const b = await App.share.render({ bigPhoto: await App.media.dataUrl(pg.photos[0]), kicker: '懷孕 22 週', title: `「${pg.msg}」`, theme: 'night', campaign: 'diary', path: 'island' }); return b ? b.size : 0; });
  ok('…the card is a full 1080×1920 picture with the photo, the sentence and a QR invite', card > 80000, `${card} bytes`);
  // the diary as a PDF
  await go(p, 'diary-print', null, 1200);
  const doc = await S(p, () => ({ pages: document.querySelectorAll('.dy-doc-page').length, imgs: [...document.querySelectorAll('.dy-doc-photos img')].filter((i) => i.naturalWidth > 0).length, title: (document.querySelector('.dy-doc-cover h2') || {}).textContent, av: !!document.querySelector('.dy-doc-av svg') }));
  ok('產檢日記 PDF: a cover with her chibi and every page with its photos', doc.pages === 2 && doc.imgs === 2 && /產檢日記/.test(doc.title) && doc.av, JSON.stringify(doc));
  await p.emulateMedia({ media: 'print' });
  ok('…printing shows only the diary', await S(p, () => ['.appbar', '.tabbar', '.no-print'].every((s) => [...document.querySelectorAll(s)].every((e) => getComputedStyle(e).display === 'none'))));
  await p.emulateMedia({ media: 'screen' });

  /* ---------- 4. the photos are kept safe ---------- */
  await S(p, () => { const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download && /備份/.test(this.download)) window.__bk = this.href; return orig.call(this); }; });
  await go(p, 'me', null, 600);
  await p.click('button:has-text("匯出備份")').catch(async () => { await p.click('text=匯出'); });
  await p.waitForTimeout(1500);
  const backup = await S(p, async () => { if (!window.__bk) return null; const t = await (await fetch(window.__bk)).text(); const j = JSON.parse(t); return { media: Object.keys(j.media || {}).length, diary: (j.data.preg.diary || []).length, text: t }; });
  ok('匯出備份 carries the diary photos along', backup && backup.media === 2 && backup.diary === 1, backup ? JSON.stringify({ media: backup.media, diary: backup.diary }) : 'no backup');
  if (backup) fs.writeFileSync(path.join(TMP, 'backup.json'), backup.text);
  {
    const { p: q, ctx: c2 } = await open();
    await asPreg(q, 22);
    await go(q, 'me', null, 600);
    await S(q, () => [...document.querySelectorAll('button')].find((b) => /匯入/.test(b.textContent)).click()); await q.waitForTimeout(500);
    // 「合併（家人資料）」, the default: a family member's phone gets the pages and the photos
    const [fc] = await Promise.all([q.waitForEvent('filechooser'), q.click('.sheet button:has-text("選擇備份檔")')]);
    await fc.setFiles(path.join(TMP, 'backup.json')); await q.waitForTimeout(1500);
    await go(q, 'diary', null, 1200);
    const r = await S(q, () => ({ pages: document.querySelectorAll('.dy-page').length, imgs: [...document.querySelectorAll('.dy-thumb-img')].filter((i) => i.naturalWidth > 0).length, missing: document.querySelectorAll('.dy-thumb.missing').length }));
    ok('another phone (a family member) imports the backup: both pages with their photos', r.pages === 2 && r.imgs === 2 && r.missing === 0, JSON.stringify(r));
    await c2.close();
  }
  // deleting a page deletes its photo
  await go(p, 'diary', null, 900);
  const custom = await S(p, () => App.store.state.preg.diary[0]);
  await S(p, (id) => App.diary.openEntry(id), custom.id); await p.waitForTimeout(500);
  await p.click('.sheet button[aria-label="刪除這一頁"]'); await p.waitForTimeout(400);
  await p.click('.sheet button:has-text("刪除")').catch(() => {}); await p.waitForTimeout(700);
  ok('deleting a page also deletes its photo from the phone', await S(p, async (pid) => !(await App.media.get(pid)) && !App.store.state.preg.diary.length, custom.photos[0]));

  /* ---------- 4b. no photo is left behind ---------- */
  const nKeys = () => S(p, async () => (await App.media.keys()).length);
  let k0 = await nKeys();
  await S(p, () => App.preg.openVisitSheet(App.PREG_DATA.PRENATAL[4])); await p.waitForTimeout(400);
  await pickFile(p, ADD, 'us.jpg'); await p.waitForTimeout(900);
  await esc(p);
  ok('a photo picked in the visit form, then the form closed without saving: the photo is removed again', (await nKeys()) === k0, `${k0} → ${await nKeys()}`);
  await S(p, () => App.diary.openEntry()); await p.waitForTimeout(400);
  await pickFile(p, ADD, 'us.jpg'); await p.waitForTimeout(900);
  await esc(p);
  ok('…the same for a new diary page that is cancelled', (await nKeys()) === k0);
  await S(p, () => App.diary.openEntry()); await p.waitForTimeout(400);
  await p.fill('.sheet input[type=text]', '試一下');
  await pickFile(p, ADD, 'us.jpg'); await p.waitForTimeout(900);
  await p.click('.sheet .dy-thumb-x'); await p.waitForTimeout(300);
  await p.click('.sheet-footer .btn-primary'); await p.waitForTimeout(500);
  ok('…and a photo added then removed (✕) before saving does not stay behind', (await nKeys()) === k0);
  const xSize = await S(p, async () => { App.diary.openEntry(App.store.state.preg.diary.find((d) => d.title === '試一下').id); await new Promise((r) => setTimeout(r, 400)); return document.querySelector('.sheet .dy-thumb-x') ? Math.round(document.querySelector('.sheet .dy-thumb-x').getBoundingClientRect().width) : null; });
  await esc(p);
  ok('the ✕ to remove a photo is big enough to tap (≥ 34px)', xSize === null || xSize >= 34, `${xSize}`);
  await go(p, 'me', null, 900);
  const line = await S(p, () => (document.querySelector('.storage-line') || {}).textContent || '');
  ok('我的 says how many photos are kept (diary and 寶寶月照) and how much room they take', /照片 \d+ 張（產檢日記、寶寶月照，約 [\d.]+ MB）/.test(line), line);
  await S(p, () => App.store.reset()); await p.waitForTimeout(600);
  ok('清除所有資料 also deletes every ultrasound photo from the phone', (await nKeys()) === 0);

  /* ---------- 5. before pregnancy: the diary island waits ---------- */
  await asPreg(p, 22); await S(p, () => App.store.update((s) => { s.profile.stage = 'prep'; }));
  await go(p, 'island', null, 1200);
  ok('備孕: the diary island is under clouds (🔒 懷孕後開放)', /懷孕後開放/.test(await S(p, () => (document.querySelector('.isl-ibanner[data-island="diary"]') || {}).textContent || '')) && await S(p, () => document.querySelector('.isl-chip[data-island="diary"]').classList.contains('locked')));
  await S(p, () => App.island.openIsland('diary')); await p.waitForTimeout(400);
  ok('…tapping it explains what it is', /懷孕後開放/.test(await top(p)));
  await esc(p);

  ok('no page errors anywhere', !errors.length, errors.slice(0, 4).join(' | '));
  console.log('\n=== Q 版角色與產檢日記 ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await ctx.close(); await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
