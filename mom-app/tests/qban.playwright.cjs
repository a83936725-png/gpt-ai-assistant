// Q 版小東西 (js/modules/qban.js, css/qban.css): 小滴 the brand drop on empty pages, the welcome screen, late at night,
// in search with no answer, at big moments and on 新手任務 done; the Q版 baby on 首頁 (awake, asleep, feeding, a party
// hat in the week of 滿月, a hop after a one-tap record), its outfit and accessory in 編輯寶寶, in the baby lists and
// the 健康 header; Q版 drawings on share cards (成長卡, 家族週報) and the 貼紙 in the 分享工作室, which never use a photo.
// Light and dark, less motion, a small phone, accessibility checked.
// Usage: cd mom-app && python3 -m http.server 8080   then   BASE=http://localhost:8080/ node tests/qban.playwright.cjs
//        AXE_PATH=<axe.min.js> for the accessibility checks
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8080/';
const AXE = process.env.AXE_PATH || '';
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });

(async () => {
  const b = await chromium.launch();
  const mk = async ({ scheme = 'light', motion = 'no-preference', width = 390, time = null } = {}) => {
    const c = await b.newContext({ viewport: { width, height: 844 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', colorScheme: scheme, reducedMotion: motion });
    if (time) await c.clock.install({ time: new Date(time) });
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
  // a set-up mom with a baby (days old), the Q版 baby unless avatar says otherwise
  const setup = (p, { days = 50, avatar = '👶', q = null, photo = null, two = false, starter = { demo: true }, stage = 'baby' } = {}) => S(p, (o) => {
    const s = App.store.defaults(); s.onboarded = true; s.profile.stage = o.stage; s.profile.momName = '小美';
    const bday = Core.dateKey(Core.addDays(new Date(), -o.days));
    s.babies = [{ id: 'b1', name: '小湯圓', sex: 'girl', birthday: bday, avatar: o.avatar, ...(o.q ? { q: o.q } : {}), ...(o.photo ? { photo: o.photo } : {}) }];
    if (o.two) s.babies.push({ id: 'b2', name: '小餅乾', sex: 'boy', birthday: bday, avatar: '🐻' });
    s.activeBabyId = 'b1'; s.starter = o.starter;
    App.store.replace(s); App.navigate('home');
  }, { days, avatar, q, photo, two, starter, stage });
  const go = async (p, screen, ms = 800) => { await S(p, (x) => App.navigate(x), screen); await p.waitForTimeout(ms); };
  const RED = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#ff0000"/></svg>');

  /* ---------- 小滴 herself ---------- */
  const P = await mk();
  const moods = await S(P, () => App.mascot.MOODS.map((m) => {
    const sv = App.mascot.svg({ mood: m, size: 64 });
    const doc = new DOMParser().parseFromString(sv, 'image/svg+xml');
    return { m, ok: !doc.querySelector('parsererror'), len: sv.length, text: doc.documentElement.textContent.trim(), sv };
  }));
  ok('小滴: 7 moods, each a valid drawing (no words inside), all different', moods.length === 7 && moods.every((x) => x.ok && !x.text) && new Set(moods.map((x) => x.sv.replace(/md\w{5,}/g, ''))).size === 7, JSON.stringify(moods.map((x) => [x.m, x.ok, x.text])));
  ok('…decorative to screen readers (aria-hidden)', await S(P, () => App.mascot.el({ mood: 'wave' }).getAttribute('aria-hidden') === 'true' && /aria-hidden="true"/.test(App.mascot.svg())));
  ok('…the image for a card uses plain colours (no page styles in a picture)', await S(P, () => !decodeURIComponent(App.mascot.dataUrl({ mood: 'wave' })).includes('var(')));

  /* ---------- 歡迎: she waves next to the app name ---------- */
  const wel = await S(P, () => { const m = document.querySelector('.ob-brand .md'); const t = document.querySelector('.ob-title'); return { mood: m && m.dataset.mood, sameRow: m && Math.abs(m.getBoundingClientRect().bottom - t.closest('.ob-brand').getBoundingClientRect().bottom) < 20 && m.getBoundingClientRect().left > t.getBoundingClientRect().right }; });
  ok('歡迎: 小滴 waves to the right of 易家做媽媽', wel.mood === 'wave' && wel.sameRow, JSON.stringify(wel));
  const waveAnim = await S(P, () => getComputedStyle(document.querySelector('.ob-brand .md-arm-r')).animationName);
  ok('…her arm really waves (and she bobs)', waveAnim === 'mdWave' && await S(P, () => getComputedStyle(document.querySelector('.ob-brand .md svg')).animationName === 'mdBob'), waveAnim);
  await axe(P, '歡迎 with 小滴');

  /* ---------- the demo baby is the Q版 baby ---------- */
  await P.click('text=先看看範例資料'); await P.waitForTimeout(1500); await go(P, 'home', 900);
  const demo = await S(P, () => { const b = App.store.baby(); const el = document.querySelector('.hero-avatar'); return { q: b.q, avatar: b.avatar, cls: el.className, svg: !!el.querySelector('svg') }; });
  ok('範例資料: the demo baby is the Q版 baby (粉紅 with a 蝴蝶結) on 首頁', demo.avatar === '👶' && demo.q.wear === 'pink' && demo.q.acc === 'bow' && /qb/.test(demo.cls) && demo.svg, JSON.stringify(demo));

  /* ---------- 首頁 baby card: awake, asleep, feeding, a hop ---------- */
  await setup(P, { days: 50 }); await P.waitForTimeout(800);
  const awake = await S(P, () => { const el = document.querySelector('.hero-avatar'); return { cls: el.className, eyes: !!el.querySelector('.qb-eyes'), blink: getComputedStyle(el.querySelector('.qb-eyes')).animationName, emoji: !!document.querySelector('.hero-avatar.emoji') }; });
  ok('首頁: a default 👶 baby is drawn as the Q版 baby, eyes open and blinking', /qb-awake/.test(awake.cls) && awake.eyes && awake.blink === 'mdBlink' && !awake.emoji, JSON.stringify(awake));
  await S(P, () => App.timers.start('sleep')); await go(P, 'home', 700);
  const asleep = await S(P, () => { const el = document.querySelector('.hero-avatar'); return { cls: el.className, eyes: !!el.querySelector('.qb-eyes'), bubble: !!el.querySelector('.qb-bubble'), zzz: !!document.querySelector('.hero-fx.sleep'), breathe: getComputedStyle(el.querySelector('svg')).animationName }; });
  ok('sleep timer running: eyes closed, a little bubble, breathing (with the z z z)', /qb-sleep/.test(asleep.cls) && !asleep.eyes && asleep.bubble && asleep.zzz && asleep.breathe === 'qbBreathe', JSON.stringify(asleep));
  // this page runs on the real clock: in the middle of the night 親餵 opens 夜奶陪伴 by itself (0.9.1) and covers 首頁,
  // which is what this file looks at; the 0.9.1 battery ran at 03:00 and stopped here. 夜奶陪伴 has its own tests.
  await S(P, () => { App.store.update((s) => { s.settings.nightCompanion = false; }); App.timers.cancel('sleep'); App.timers.start('breast'); }); await go(P, 'home', 700);
  ok('親餵 timer running: happy eyes (with the hearts)', await S(P, () => /qb-feed/.test(document.querySelector('.hero-avatar').className) && !!document.querySelector('.hero-fx.feed')));
  await S(P, () => App.timers.cancel('breast')); await go(P, 'home', 700);
  await P.click('.quick-tile[data-type="diaper"] .qt-plus'); await P.waitForTimeout(150);
  ok('＋尿布 on 首頁: the Q版 baby does a little hop', await S(P, () => !!document.querySelector('.hero-avatar.qb.qb-yay') && getComputedStyle(document.querySelector('.hero-avatar.qb-yay svg')).animationName === 'qbYay'));
  await P.waitForTimeout(1200);
  ok('…and settles again', await S(P, () => !document.querySelector('.qb-yay')));

  /* ---------- 滿月 week: a party hat ---------- */
  await setup(P, { days: 30, q: { wear: 'blue', acc: 'bow' } }); await P.waitForTimeout(800);
  const party = await S(P, () => { const el = document.querySelector('.hero-avatar'); return { party: el.dataset.party, hat: el.innerHTML.includes('#ffcf5a'), bow: el.innerHTML.includes('#ff8fb3') }; });
  ok('出生第 31 天 (滿月 week): the baby wears a party hat instead of the bow', party.party === '滿月' && party.hat && !party.bow, JSON.stringify(party));
  const pdays = await S(P, () => [29, 35, 36, 99, 105, 106, 200].map((d) => App.qbaby.partyDay({ birthday: Core.dateKey(Core.addDays(new Date(), -d)) })));
  ok('…百日 week too, and only those weeks (day 30–36, 100–106, 度晬)', JSON.stringify(pdays) === JSON.stringify(['滿月', '滿月', null, '百日', '百日', null, null]), JSON.stringify(pdays));

  /* ---------- 編輯寶寶: outfit and accessory ---------- */
  await setup(P, { days: 50 }); await P.waitForTimeout(800);
  await P.click('.hero-main'); await P.waitForTimeout(700);
  const ed = await S(P, () => ({ pressed: document.querySelector('.av-btn[data-av="👶"]').getAttribute('aria-pressed'), label: document.querySelector('.av-btn[data-av="👶"]').getAttribute('aria-label'), opts: !document.querySelector('.qb-opts').hidden, wears: document.querySelectorAll('.qb-wear').length, accs: [...document.querySelectorAll('.qb-acc')].map((x) => x.textContent).join('・'), checked: document.querySelector('.qb-wear[aria-checked="true"]').dataset.wear }));
  ok('編輯寶寶: the Q版 tile is chosen, with 衣服 (5 colours) and 配件 (不用・蝴蝶結・小帽子・奶嘴・呆毛)', ed.pressed === 'true' && ed.label === 'Q 版寶寶' && ed.opts && ed.wears === 5 && ed.accs === '不用・蝴蝶結・小帽子・奶嘴・呆毛' && ed.checked === 'yellow', JSON.stringify(ed));
  await P.click('.qb-wear[data-wear="mint"]'); await P.click('.qb-acc[data-acc="hat"]'); await P.waitForTimeout(250);
  const pv = await S(P, () => ({ mint: document.querySelector('.avatar-preview').innerHTML.includes('#9ddcbf'), tile: document.querySelector('.av-btn[data-av="👶"]').innerHTML.includes('#9ddcbf'), checked: [document.querySelector('.qb-wear[aria-checked="true"]').dataset.wear, document.querySelector('.qb-acc[aria-checked="true"]').dataset.acc] }));
  ok('…薄荷 + 小帽子: the preview and the tile change right away', pv.mint && pv.tile && pv.checked.join() === 'mint,hat', JSON.stringify(pv));
  await axe(P, '編輯寶寶 with Q版 choices');
  await P.click('.sheet .btn-primary:has-text("儲存")'); await P.waitForTimeout(900);
  const saved = await S(P, () => ({ q: App.store.baby().q, hero: document.querySelector('.hero-avatar').innerHTML.includes('#9ddcbf') }));
  ok('…儲存: kept with the baby, and 首頁 shows it', saved.q.wear === 'mint' && saved.q.acc === 'hat' && saved.hero, JSON.stringify(saved));
  await P.click('.hero-main'); await P.waitForTimeout(700);
  await P.click('.av-btn[data-av="🐻"]'); await P.waitForTimeout(200);
  ok('picking 🐻: the Q版 choices fold away', await S(P, () => document.querySelector('.qb-opts').hidden && document.querySelector('.av-btn[data-av="🐻"]').getAttribute('aria-pressed') === 'true'));
  await P.click('.sheet .btn-primary:has-text("儲存")'); await P.waitForTimeout(900);
  ok('…儲存: 首頁 shows the 🐻 (the emoji she picked)', await S(P, () => { const el = document.querySelector('.hero-avatar'); return /emoji/.test(el.className) && el.textContent === '🐻' && !el.querySelector('svg'); }));
  await setup(P, { days: 50, photo: RED }); await P.waitForTimeout(800);
  ok('a baby photo is still the photo', await S(P, () => document.querySelector('.hero-avatar').tagName === 'IMG'));

  /* ---------- lists and 健康 ---------- */
  await setup(P, { days: 50, two: true }); await P.waitForTimeout(800);
  await P.click('.hero-switch'); await P.waitForTimeout(600);
  const sw = await S(P, () => [...document.querySelectorAll('.sheet .list-item .li-icon')].map((x) => (x.classList.contains('qb') ? 'Q' : x.textContent)));
  ok('切換寶寶: the Q版 baby and the 🐻 in the list', sw.join() === 'Q,🐻', JSON.stringify(sw));
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  await go(P, 'me', 900);
  ok('我的: the baby list shows the Q版 baby too', await S(P, () => [...document.querySelectorAll('#view .li-icon')].some((x) => x.classList.contains('qb'))));
  await go(P, 'health', 900);
  ok('健康: the header shows the Q版 baby', await S(P, () => !!document.querySelector('.health-avatar.qb svg')));

  /* ---------- empty pages, search, the cheer, 新手任務 done ---------- */
  await setup(P, { days: 50 }); await go(P, 'log', 900);
  const em = await S(P, () => { const e = document.querySelector('#view .empty'); const m = e && e.querySelector('.md'); return { mood: m && m.dataset.mood, badge: m && m.querySelector('.md-badge').textContent, text: e && e.querySelector('p').textContent }; });
  ok('紀錄 with nothing today: a sleepy 小滴 holding up 🌙, and the words', em.mood === 'sleepy' && em.badge === '🌙' && /今天還沒有紀錄/.test(em.text), JSON.stringify(em));
  await axe(P, '紀錄 empty page with 小滴');
  await go(P, 'milk', 900);
  ok('母乳庫存 empty: its own drawing (0.9.4: features with a drawing show it instead of 小滴 with an emoji)', await S(P, () => { const e = document.querySelector('#view .empty.has-pic'); const i = e && e.querySelector('img.pic'); return !!i && /thumbs\/milk\.webp$/.test(i.src) && i.alt === '' && !e.querySelector('.md'); }));
  await go(P, 'search', 800);
  await P.fill('#view input', 'ㄅㄆㄇ亂打xyz'); await P.waitForTimeout(900);
  ok('搜尋 with no answer: 小滴 thinking', await S(P, () => !!document.querySelector('.sr-empty .md-think')));
  await go(P, 'home', 800);
  await S(P, () => App.ui.celebrate({ big: true })); await P.waitForTimeout(700);
  const pop = await S(P, () => { const x = document.querySelector('.md-pop'); return x && { show: x.classList.contains('show'), say: x.querySelector('.md-pop-say').textContent, pe: getComputedStyle(x).pointerEvents, hidden: x.getAttribute('aria-hidden'), r: Math.round(innerWidth - x.getBoundingClientRect().right) }; });
  ok('a big moment: 小滴 hops up by the right edge and cheers; never takes a tap', pop && pop.show && pop.say.length > 0 && pop.pe === 'none' && pop.hidden === 'true' && pop.r >= 8 && pop.r <= 40, JSON.stringify(pop));
  await P.waitForTimeout(3400);
  ok('…and goes away by itself', await S(P, () => !document.querySelector('.md-pop')));
  await S(P, () => App.ui.celebrate({})); await P.waitForTimeout(300);
  ok('a small moment: confetti only, no 小滴', await S(P, () => !document.querySelector('.md-pop')));
  await setup(P, { days: 50, starter: {} });
  await S(P, () => App.store.update((s) => { s.starter = { finished: Core.dateKey() }; })); await P.waitForTimeout(900);
  ok('新手任務 done (the day she finishes): 小滴 cheers on the card', await S(P, () => !!document.querySelector('.st-done .md-cheer')));
  await P.context().close();

  /* ---------- late at night ---------- */
  const N = await mk({ time: '2026-11-21T23:30:00+08:00' });
  await setup(N, { days: 50 }); await N.waitForTimeout(800);
  ok('首頁 at 23:30: a sleepy 小滴 in a nightcap after 夜深 greeting', await S(N, () => !!document.querySelector('.greet-hi .md-sleepy') && !document.querySelector('.greet-hi .beat')));
  await N.context().close();
  const Dn = await mk({ time: '2026-11-21T10:30:00+08:00' });
  await setup(Dn, { days: 50 }); await Dn.waitForTimeout(800);
  ok('…at 10:30: just 「早安，name」 (no 小滴, and no 💜 after the name since 0.9.2)', await S(Dn, () => !document.querySelector('.greet-hi .md') && !document.querySelector('.greet-hi .beat') && !/💜/.test(document.querySelector('.greet-hi').textContent)));
  await Dn.context().close();

  /* ---------- share cards ---------- */
  const Z = await mk();
  await setup(Z, { days: 50, q: { wear: 'lilac', acc: 'tuft' } }); await Z.waitForTimeout(800);
  const art = await S(Z, () => { const c = App.share.cards().find((x) => x.kind === 'baby-age'); return { art: (c.spec.art || '').slice(0, 26), lilac: decodeURIComponent(c.spec.art || '').includes('#c9aaea') }; });
  ok('成長卡: the Q版 baby is the picture in the circle (a drawing, in its own colours)', art.art === 'data:image/svg+xml;charset' && art.lilac, JSON.stringify(art));
  const wk = await S(Z, () => { const sp = App.weekly.spec(App.weekly.build('baby', App.weekly.reportWeek(), App.store.baby()), {}); return !!(sp.hero && sp.hero.art && sp.hero.art.startsWith('data:image/svg+xml')); });
  ok('家族週報: the Q版 baby there too', wk);
  // pixels: a sticker is in the top-right corner only
  const px = await S(Z, async () => {
    const spec = App.share.cards().find((x) => x.kind === 'baby-age').spec;
    const data = async (sticker) => { const blob = await App.share.render({ ...spec, theme: 'peach' }, { format: 'story', sticker }); const bm = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0); return (rx, ry, rw, rh) => x.getImageData(rx, ry, rw, rh).data; };
    const none = await data('none'); const mas = await data('mascot');
    const diff = (r) => { const a = none(...r); const z = mas(...r); let d = 0; for (let i = 0; i < a.length; i += 1) d += Math.abs(a[i] - z[i]); return Math.round(d / (a.length / 4)); };
    return { corner: diff([780, 40, 280, 320]), title: diff([120, 560, 840, 700]), footer: diff([40, 1540, 1000, 360]), header: diff([40, 40, 640, 220]) };
  });
  ok('貼紙 小滴: drawn on the top-right corner; the title, numbers, header and QR are untouched', px.corner > 20 && px.title === 0 && px.footer === 0 && px.header === 0, JSON.stringify(px));
  // her Q 版角色 in 照片大頭 style: the sticker is the drawn one, never her face
  await S(Z, (red) => App.store.update((s) => { s.profile.avatar = { ...App.avatar.DEFAULT, mode: 'photo', face: red }; }), RED);
  const face = await S(Z, async () => {
    const spec = App.share.cards().find((x) => x.kind === 'baby-age').spec;
    const blob = await App.share.render({ ...spec, theme: 'mint' }, { format: 'post', sticker: 'me' });
    const bm = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
    const d = x.getImageData(700, 0, 380, 420).data; let red = 0; let skin = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] > 235 && d[i + 1] < 40 && d[i + 2] < 40) red += 1; if (Math.abs(d[i] - 0xf6) < 6 && Math.abs(d[i + 1] - 0xd2) < 6 && Math.abs(d[i + 2] - 0xb8) < 6) skin += 1; }
    return { red, skin };
  });
  ok('貼紙 我的 Q 版 while she uses 照片大頭: the drawn face on the card, never the photo', face.red === 0 && face.skin > 200, JSON.stringify(face));
  await S(Z, () => App.store.update((s) => { s.profile.avatar = { ...App.avatar.DEFAULT, style: 'bun' }; }));
  // the studio
  await S(Z, () => App.share.open({ kind: 'baby-age', sheetTitle: '分享寶寶成長卡' })); await Z.waitForTimeout(1600);
  const st = await S(Z, () => ({ names: [...document.querySelectorAll('.sh-stk .sh-stk-name')].map((x) => x.textContent).join('・'), on: document.querySelector('.sh-stk[aria-checked="true"]').dataset.sticker, data: document.querySelector('.sh-preview').dataset.sticker, note: document.querySelector('.sh-sec-head .tiny') && [...document.querySelectorAll('.sh-sec-head .tiny')].map((x) => x.textContent).join() }));
  ok('分享工作室: 貼紙 不加・小滴・我的 Q 版・寶寶 Q 版, 小滴 by default, said to be drawings', st.names === '不加・小滴・我的 Q 版・寶寶 Q 版' && st.on === 'mascot' && st.data === 'mascot' && /不會用到照片/.test(st.note), JSON.stringify(st));
  await axe(Z, '分享工作室 with 貼紙');
  await Z.click('.sh-stk[data-sticker="none"]'); await Z.waitForTimeout(900);
  ok('…不加: the card is drawn again without one', await S(Z, () => document.querySelector('.sh-preview').dataset.sticker === 'none' && document.querySelector('.sh-stk[data-sticker="none"]').getAttribute('aria-checked') === 'true'));
  await Z.keyboard.press('Escape'); await Z.waitForTimeout(400);
  await S(Z, () => App.share.open({ kind: 'baby-age' })); await Z.waitForTimeout(1200);
  ok('…remembered next time', await S(Z, () => document.querySelector('.sh-stk[aria-checked="true"]').dataset.sticker === 'none'));
  await Z.keyboard.press('Escape'); await Z.waitForTimeout(400);
  await S(Z, () => { App.store.update((s) => { delete s.profile.avatar; s.profile.stage = 'preg'; s.babies = []; s.activeBabyId = null; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -120)); }); });
  await S(Z, () => App.share.open({ kind: 'preg-week' })); await Z.waitForTimeout(1200);
  ok('pregnant, no 角色 yet: only 不加・小滴 are offered', await S(Z, () => [...document.querySelectorAll('.sh-stk-name')].map((x) => x.textContent).join('・') === '不加・小滴'));
  await Z.context().close();

  /* ---------- dark, less motion, a small phone ---------- */
  const D = await mk({ scheme: 'dark' });
  await setup(D, { days: 50 }); await go(D, 'log', 900);
  const dk = await S(D, () => { const m = document.querySelector('#view .empty .md'); const cs = getComputedStyle(m); return { a: cs.getPropertyValue('--md-a').trim(), line: cs.getPropertyValue('--md-line').trim() }; });
  ok('dark: 小滴 is a lighter purple with a light rim (she still stands out)', dk.a === '#dcb9f3' && dk.line === '#e3c9f5', JSON.stringify(dk));
  await go(D, 'home', 800);
  ok('dark: the Q版 baby keeps its soft light circle', await S(D, () => /radial-gradient/.test(getComputedStyle(document.querySelector('.hero-avatar.qb')).backgroundImage)));
  await axe(D, '首頁 with the Q版 baby (dark)');
  await D.context().close();
  const R = await mk({ motion: 'reduce' });
  await setup(R, { days: 50 }); await R.waitForTimeout(800);
  const rm = await S(R, () => ({ blink: getComputedStyle(document.querySelector('.qb-eyes')).animationName }));
  await go(R, 'log', 900);
  rm.bob = await S(R, () => getComputedStyle(document.querySelector('.empty .md svg')).animationName);
  ok('減少動態效果: nothing bobs or blinks', rm.blink === 'none' && rm.bob === 'none', JSON.stringify(rm));
  await S(R, () => App.ui.celebrate({ big: true })); await R.waitForTimeout(200);
  ok('…a big moment still shows 小滴 (just without the hop)', await S(R, () => { const x = document.querySelector('.md-pop'); return !!x && getComputedStyle(x).transitionDuration === '0s'; }));
  await R.context().close();
  const W = await mk({ width: 320 });
  ok('320 px 歡迎: 小滴 fits beside the name, nothing scrolls sideways', await S(W, () => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.ob-brand .md').getBoundingClientRect().right <= innerWidth - 8));
  await setup(W, { days: 50 }); await W.waitForTimeout(800);
  await W.click('.hero-main'); await W.waitForTimeout(700);
  ok('320 px 編輯寶寶: the five colours and five accessories fit (no sideways scroll)', await S(W, () => { const o = document.querySelector('.qb-opts'); return o.scrollWidth <= o.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; }));
  await W.context().close();

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
