// 易家做媽媽 試閱本 (lp/): the landing page. A magazine in front (cover, contents, a day in the life, four spreads),
// the real app behind (a live sandbox: ?sandbox=1, its own storage and sample data).
// Checks: links and layout at phone and desktop sizes; the page turns night at 03:12 and back, and nothing else
// moves by itself (the 「AI 感」 pass: no loops, no auto-turning ring or gallery, no slide-ins, no emoji as icons, none
// of the phrases that read as machine-made); the fan, ring, gallery and share cards respond to taps, keys, drags and
// swipes; the five trial tasks tick off when done for real in the app; 重新開始 clears the trial; the visitor's own
// app data is never touched; with 減少動態效果 nothing moves; accessibility (light, dark, phone); the first screen's
// pictures stay under 1 MB.
// Usage: BASE=http://localhost:8731/ AXE_PATH=<axe.min.js> node tests/landing.playwright.cjs
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8731/';
const LP = `${BASE}lp/`;
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const DAY = '2026-11-23T14:12:00+08:00';

(async () => {
  const b = await chromium.launch();
  const mk = async ({ width = 1440, height = 900, reduced = false, scheme = 'light', touch = false } = {}) => {
    const c = await b.newContext({ viewport: { width, height }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: scheme, hasTouch: touch, isMobile: touch });
    await c.clock.install({ time: new Date(DAY) });
    await c.addInitScript(() => { window.__noShareMoments = true; window.__noNightAuto = true; });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(`${width}: ${e.message}`));
    // the static copy has no member server: the app's api/config 404 is expected
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(`${width}: ${m.text()}`); });
    return { c, p };
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: `${SHOT}${name}.png` }); };
  const to = (p, sel, block = 'start') => S(p, ([s, bl]) => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector(s).scrollIntoView({ block: bl }); }, [sel, block]);
  const axe = async (p, label, exclude = []) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async (ex) => (await window.axe.run({ include: [['body']], exclude: ex.map((x) => [x]) }, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'], iframes: false })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), exclude);
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const app = (p) => p.frameLocator('#try-frame');
  const tasks = (p) => S(p, () => ({ done: [...document.querySelectorAll('#tasks li.done')].map((li) => li.dataset.task).sort().join(','), count: document.getElementById('try-count').textContent, state: document.getElementById('try-state').textContent, bar: document.getElementById('try-bar').style.width }));
  const until = async (p, f, a, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await S(p, f, a)) return true; await p.waitForTimeout(200); } return false; };
  // the ring (real 3D, one card per 30°): its label reads 「n／12　name」
  const ringN = (p) => S(p, () => Number((document.querySelector('.ring-now').textContent.match(/^(\d+)/) || [])[1]));

  /* ---------- 0. the visitor's own app, before anything (it must stay exactly like this) ---------- */
  const D = await mk();
  const P = D.p;
  const firstPics = []; // pictures fetched for the first screen (budget: 1 MB)
  P.on('response', async (r) => { if (r.request().resourceType() === 'image' && !firstPics.done) { try { firstPics.push((await r.body()).length); } catch (e) { /* gone */ } } });
  await P.goto(`${BASE}index.html`);
  await P.waitForFunction(() => window.App && App.store && !App.store.loading);
  await S(P, () => { App.store.update((s) => { s.profile.momName = '真正的我'; }); App.store.save && App.store.save(); });
  const mine = await S(P, () => localStorage.getItem('yijia-mom-app-v1'));
  firstPics.length = 0;

  /* ---------- 1. desktop: the magazine ---------- */
  await P.goto(LP, { waitUntil: 'networkidle' });
  await S(P, () => document.fonts.ready);
  await P.waitForTimeout(600);
  firstPics.done = true;
  const kb = firstPics.reduce((a, x) => a + x, 0) / 1024;
  ok(`the first screen's pictures stay under 1 MB (${Math.round(kb)} KB)`, kb > 20 && kb < 1024, kb);
  ok('title 「易家做媽媽 試閱本」 and the masthead', await P.title() === '易家做媽媽 試閱本' && /易家\s*做媽媽/.test(await S(P, () => document.querySelector('.masthead').textContent)));
  ok('every in-page link goes somewhere that exists', await S(P, () => [...document.querySelectorAll('a[href^="#"]')].every((a) => a.getAttribute('href') === '#' || document.getElementById(a.getAttribute('href').slice(1)))), await S(P, () => [...document.querySelectorAll('a[href^="#"]')].filter((a) => !document.getElementById(a.getAttribute('href').slice(1))).map((a) => a.getAttribute('href')).join(',')));
  ok('the live app is not loaded on the cover (it loads when you get near it)', await S(P, () => !document.getElementById('try-frame').getAttribute('src')));
  ok('1440 px: no sideways scrolling', await S(P, () => document.documentElement.scrollWidth <= innerWidth));
  ok('the bar stays out of the way on the cover', !(await S(P, () => document.querySelector('.mag').classList.contains('past'))));
  await shot(P, 'lp-cover');
  await axe(P, 'cover and contents (light)', ['.ring-stage .spot:not(.front)']);

  // 03:12: the page turns night, then back
  await to(P, '#day-0312', 'center'); await P.waitForTimeout(900);
  ok('03:12 on screen: the whole page turns night', await S(P, () => document.documentElement.dataset.scene === 'night'));
  ok('…and the bar names the story', await S(P, () => document.querySelector('.mag').classList.contains('past') && document.getElementById('bar-now').textContent === '一位媽媽的 24 小時'));
  await shot(P, 'lp-night');
  await axe(P, 'the night story (night colours)', ['.ring-stage .spot:not(.front)']);
  await to(P, '#day-1100', 'center'); await P.waitForTimeout(900);
  ok('…and turns back to day when the story moves on', await S(P, () => !document.documentElement.dataset.scene));

  // the 「AI 感」 pass: what was taken out stays out
  const text = await S(P, () => document.querySelector('.mag').innerText);
  ok('the template sections are gone (三步上手, 看不見的貼心 with its 9f·3a·c1 packet) and nothing links to them', !/三步上手|看不見的貼心|9f·3a·c1/.test(text) && await S(P, () => !document.getElementById('start') && !document.getElementById('care')), '');
  ok('no emoji on the page (the record cards use the app\'s line icons)', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text) && await S(P, () => document.querySelectorAll('.fc-ico svg').length === 7), (text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).join(''));
  ok('none of the phrases that read as machine-made (手機小幫手, 放進口袋, VOL. 0.9, 不是編的)', !/手機小幫手|放進口袋|VOL\.|不是編的/.test(text));
  ok('no price sticker and no tilted phones on the cover: the 03:12 screen as the cover picture, with a caption', await S(P, () => !document.querySelector('.phone-back, .phone-front, p.cover-price') && !!document.querySelector('.cover-shot img') && /封面/.test(document.querySelector('.cover-fig figcaption').textContent)));
  ok('no 「設計筆記」 button for visitors', await S(P, () => !document.getElementById('notes-btn') && [...document.querySelectorAll('.pnote')].every((x) => getComputedStyle(x).display === 'none')));

  // 七種紀錄 (arc fan): it rests open; pointing lifts a card
  await to(P, '#logs'); await P.waitForTimeout(2600);
  ok('七種紀錄: the fan rests open (no card rises by itself)', await S(P, () => !document.querySelector('.arc li.up')));
  ok('…the bar reads 七種紀錄', await S(P, () => document.getElementById('bar-now').textContent === '七種紀錄'));
  await P.hover('.arc li:nth-child(4)'); await P.waitForTimeout(700);
  ok('…pointing at a card lifts that card', await S(P, () => getComputedStyle(document.querySelector('.arc li:nth-child(4)')).getPropertyValue('--lift').trim() === '-22px'));
  await P.mouse.move(5, 5);

  // 好孕島 ring
  await to(P, '#island'); await P.waitForTimeout(900);
  let n0 = await ringN(P);
  await P.waitForTimeout(2500);
  ok('好孕島: the ring does not turn by itself', await ringN(P) === n0, `${n0} → ${await ringN(P)}`);
  ok('…each station card has its number, a fact and the source the app cites', await S(P, () => [...document.querySelectorAll('.spot')].every((x) => /^站 \d\d$/.test(x.querySelector('.sp-no').textContent) && x.querySelector('.sp-d strong') && /^出處：/.test(x.querySelector('.sp-src').textContent))));
  await P.click('.rc-btn[data-ring="1"]'); await P.waitForTimeout(900);
  let n1 = await ringN(P);
  ok('…→ brings the next station to the front', n1 === (n0 % 12) + 1, `${n0} → ${n1}`);
  await P.focus('.ring-stage'); await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(900);
  ok('…← (arrow key) the one before', await ringN(P) === n0, `${await ringN(P)} (was ${n0})`);
  n0 = await ringN(P);
  const box = await P.locator('.ring-stage').boundingBox();
  await P.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2); await P.mouse.down();
  for (let i = 1; i <= 8; i += 1) await P.mouse.move(box.x + box.width / 2 + 150 - i * 40, box.y + box.height / 2);
  await P.mouse.up(); await P.waitForTimeout(1200);
  n1 = await ringN(P);
  ok('…dragging turns it', n1 !== n0, `${n0} → ${n1}`);
  ok('…every island card is a real 3D card (rotateY + translateZ)', await S(P, () => [...document.querySelectorAll('.spot')].every((s) => /rotateY\(.+translateZ\(/.test(s.style.transform))));

  // 月照 gallery
  await to(P, '#monthly'); await P.waitForTimeout(4200);
  ok('寶寶月照: the gallery does not change by itself', await S(P, () => document.querySelector('.gal-cap b').textContent === '奶油'), await S(P, () => document.querySelector('.gal-cap b').textContent));
  await P.click('.gt:nth-child(4)'); await P.waitForTimeout(500);
  ok('…tapping 夜空 shows it large, with its caption', await S(P, () => document.querySelector('.gal-cap b').textContent === '夜空' && document.querySelectorAll('.gm')[3].classList.contains('on') && document.querySelectorAll('.gt')[3].getAttribute('aria-pressed') === 'true'));
  ok('…the large picture is really big (desktop)', await S(P, () => document.querySelector('.gal-main').getBoundingClientRect().width > 500));

  // 分享卡 fan
  await to(P, '#share'); await P.waitForTimeout(900);
  ok('分享卡: the cards rest (no wave running through them)', await S(P, () => [...document.querySelectorAll('.rainbow li')].every((li) => !li.getAnimations().some((a) => a.playState === 'running'))));
  ok('nothing on the page is animating by itself (scrolled through the spreads)', await S(P, () => document.getAnimations().filter((a) => a.playState === 'running' && !(a instanceof CSSTransition)).length === 0), await S(P, () => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.transitionProperty).join(',')));
  await P.click('.rainbow li:nth-child(4) button'); await P.waitForTimeout(500);
  ok('…tapping one picks it', await S(P, () => document.querySelector('.rainbow li:nth-child(4)').classList.contains('pick') && document.querySelector('.rainbow').classList.contains('picked') && document.querySelector('.rainbow li:nth-child(4) button').getAttribute('aria-pressed') === 'true'));
  await P.click('.rainbow li:nth-child(4) button'); await P.waitForTimeout(300);
  ok('…tapping it again lets it go', await S(P, () => !document.querySelector('.rainbow').classList.contains('picked')));

  // notes for the team: only with #notes in the address
  await S(P, () => { location.hash = 'notes'; }); await P.waitForTimeout(200);
  ok('設計筆記 (#notes): the four card patterns are named for the team', await S(P, () => [...document.querySelectorAll('.pnote')].filter((x) => getComputedStyle(x).display !== 'none').length === 4));
  await S(P, () => { history.replaceState(null, '', location.pathname); window.dispatchEvent(new HashChangeEvent('hashchange')); }); await P.waitForTimeout(100);
  ok('打開 App + its QR code', await S(P, () => document.getElementById('open-app').href === new URL('../index.html', location.href).href && document.querySelector('#qr svg path').getAttribute('d').length > 200));

  /* ---------- 2. the live app: five tasks done for real ---------- */
  await P.click('#day-0730 .go'); // 「在試玩裡打開交接卡」 from the story
  ok('a story button takes you to the live app, which starts', await until(P, () => document.getElementById('try-state').textContent === '試玩中'), (await tasks(P)).state);
  ok('…on the sample data (小美 and 小乖), not your own', await S(P, () => { const w = document.getElementById('try-frame').contentWindow; return w.App.sandbox === true && w.App.store.state.babies[0].name === '小乖'; }));
  ok('…and opens 交接卡 there: task ✓', await until(P, () => document.querySelector('#tasks li[data-task="handoff"]').classList.contains('done'), null, 8000));
  await P.click('.arc li:nth-child(4) button'); // 尿布 in the fan → the 尿布 form in the app
  await P.waitForTimeout(1200);
  ok('a fan card opens that record type in the app', await app(P).locator('.sheet:visible').filter({ hasText: '尿布' }).count() > 0);
  await app(P).locator('.sheet:visible button:has-text("儲存")').first().click(); await P.waitForTimeout(1200);
  ok('…saving it: 記一筆尿布 ✓', await S(P, () => document.querySelector('#tasks li[data-task="diaper"]').classList.contains('done')));
  await app(P).locator('.quick-tile[data-type="breast"] .qt-plus').click(); await P.waitForTimeout(1200);
  ok('親餵 + in the app starts the timer: 開始一次親餵計時 ✓', await S(P, () => document.querySelector('#tasks li[data-task="feed"]').classList.contains('done')));
  await P.click('#tasks li[data-task="recap"] .tgo'); await P.waitForTimeout(1500);
  ok('帶我去 → 成長回顧 opens in the app: ✓', await S(P, () => document.querySelector('#tasks li[data-task="recap"]').classList.contains('done')) && await app(P).locator('.rc').count() === 1);
  await P.click('#tasks li[data-task="night"] .tgo'); await P.waitForTimeout(1500);
  ok('帶我去 → 夜奶陪伴 (it closes the recap first): ✓', await S(P, () => document.querySelector('#tasks li[data-task="night"]').classList.contains('done')) && await app(P).locator('.nt').count() === 1 && await app(P).locator('.rc').count() === 0);
  const t5 = await tasks(P);
  ok('all five: 完成 5／5 and a full bar', t5.done === 'diaper,feed,handoff,night,recap' && /完成 5／5/.test(t5.count) && t5.bar === '100%', JSON.stringify(t5));
  await shot(P, 'lp-try-done');
  const sb = await S(P, () => JSON.parse(localStorage.getItem('yijia-mom-app-sandbox') || '{}'));
  const when = (v) => (typeof v === 'number' ? v : Date.parse(v)); // saved records keep their times as numbers
  ok('the trial keeps its own records (the new 尿布 is saved in the sandbox)', (sb.logs || []).some((l) => l.type === 'diaper' && when(l.createdAt || l.start) > Date.parse('2026-11-23T14:00:00+08:00')), JSON.stringify((sb.logs || []).slice(-2)));
  ok("your own app's data was not touched", await S(P, () => localStorage.getItem('yijia-mom-app-v1')) === mine && /真正的我/.test(mine));
  ok('開新分頁玩 opens the same trial', await S(P, () => /index\.html\?sandbox=1#\/home$/.test(document.getElementById('try-new').href)));

  // 重新開始
  await S(P, () => { const w = document.getElementById('try-frame').contentWindow; if (w.App.night) w.App.night.close(); });
  await P.click('#try-reset');
  ok('重新開始: the tasks start over', /完成 0／5/.test((await tasks(P)).count));
  ok('…and the trial comes back fresh', await until(P, () => document.getElementById('try-state').textContent === '試玩中'));
  ok('…without the records made in the trial', await S(P, () => { const w = document.getElementById('try-frame').contentWindow; return !w.App.store.state.logs.some((l) => l.type === 'diaper' && Date.parse(l.createdAt || l.start) > Date.parse('2026-11-23T14:00:00+08:00')) && !Object.keys(w.App.store.state.active || {}).length; }));
  await P.waitForTimeout(1500);
  ok('…and nothing ticks itself off', /完成 0／5/.test((await tasks(P)).count), (await tasks(P)).count);
  ok("your own app's data is still untouched", await S(P, () => localStorage.getItem('yijia-mom-app-v1')) === mine);
  await to(P, '#promise'); await P.waitForTimeout(500);
  await axe(P, 'the live app section and promises (light)', ['.ring-stage .spot:not(.front)']);

  /* ---------- 3. dark mode ---------- */
  const K = (await mk({ scheme: 'dark' })).p;
  await K.goto(LP, { waitUntil: 'networkidle' }); await K.waitForTimeout(500);
  ok('dark mode: dark paper, light ink', await S(K, () => getComputedStyle(document.body).backgroundColor === 'rgb(23, 19, 26)'));
  await shot(K, 'lp-dark');
  await axe(K, 'dark mode', ['.ring-stage .spot:not(.front)']);

  /* ---------- 4. phones ---------- */
  const M = (await mk({ width: 390, height: 844, touch: true })).p;
  await M.goto(LP, { waitUntil: 'networkidle' }); await M.waitForTimeout(500);
  ok('390 px: no sideways scrolling', await S(M, () => document.documentElement.scrollWidth <= innerWidth));
  ok('…the cover picture and the top line stay on screen', await S(M, () => ['.cover-shot', '.cover-top', '.masthead'].every((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })));
  ok('…no QR code on a phone (it would point at the phone it is shown on)', await S(M, () => getComputedStyle(document.querySelector('.qr')).display === 'none'));
  await shot(M, 'lp-phone-cover');
  await axe(M, 'phone', ['.ring-stage .spot:not(.front)']);
  await to(M, '#logs'); await M.waitForTimeout(2600);
  const swipe = async (sel, dx) => S(M, ([s, d]) => {
    const el = document.querySelector(s); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2;
    const ev = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: cx, clientY: y, isPrimary: true }));
    ev('pointerdown', x); for (let i = 1; i <= 6; i += 1) ev('pointermove', x + (d * i) / 6); ev('pointerup', x + d);
  }, [sel, dx]);
  const upAt = () => S(M, () => [...document.querySelectorAll('.arc li')].findIndex((li) => li.classList.contains('up')));
  await S(M, () => { document.querySelectorAll('.arc li').forEach((li) => li.classList.remove('up')); });
  await swipe('.arc-stage', -36); await M.waitForTimeout(300);
  const a1 = await upAt();
  await swipe('.arc-stage', -36); await M.waitForTimeout(300);
  const a2 = await upAt();
  await swipe('.arc-stage', 90); await M.waitForTimeout(300);
  const a3 = await upAt();
  ok('七種紀錄 on a phone: a short swipe lifts the next card, a longer one several, either way', a1 >= 0 && a2 === a1 + 1 && a3 === a2 - 3, `${a1} → ${a2} → ${a3}`);
  await to(M, '#island'); await M.waitForTimeout(900);
  const r0 = await ringN(M);
  await S(M, () => {
    const el = document.querySelector('.ring-stage'); const r = el.getBoundingClientRect(); const y = r.top + r.height / 2;
    const ev = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 9, clientX: cx, clientY: y, isPrimary: true }));
    ev('pointerdown', 300); for (let i = 1; i <= 10; i += 1) ev('pointermove', 300 - i * 22); ev('pointerup', 80);
  });
  await M.waitForTimeout(1200);
  ok('好孕島 on a phone: a finger turns the ring', await ringN(M) !== r0, `${r0} → ${await ringN(M)}`);
  await to(M, '#try'); await M.waitForTimeout(400);
  ok('試玩 on a phone: the app is full width, with the tip about scrolling outside it', await S(M, () => { const r = document.getElementById('try-frame').getBoundingClientRect(); return r.width >= innerWidth - 40 && r.right <= innerWidth && getComputedStyle(document.querySelector('.try-tip')).display !== 'none'; }));
  const W = (await mk({ width: 320, height: 568, touch: true })).p;
  await W.goto(LP, { waitUntil: 'networkidle' }); await W.waitForTimeout(400);
  ok('320 px: no sideways scrolling anywhere', await S(W, async () => { for (const id of ['top', 'day', 'logs', 'island', 'monthly', 'share', 'try', 'get']) { document.getElementById(id).scrollIntoView(); await new Promise((r) => setTimeout(r, 120)); if (document.documentElement.scrollWidth > innerWidth) return false; } return true; }));

  /* ---------- 5. 減少動態效果 ---------- */
  const R = (await mk({ reduced: true })).p;
  await R.goto(LP, { waitUntil: 'networkidle' }); await R.waitForTimeout(500);
  await to(R, '#day-0312', 'center'); await R.waitForTimeout(900);
  ok('reduced motion: the page does not change colour at 03:12', await S(R, () => !document.documentElement.dataset.scene));
  ok('…every picture is there already (nothing waits to slide in)', await S(R, () => [...document.querySelectorAll('.stop-fig, .cover-fig, .gal-main')].every((x) => getComputedStyle(x).opacity === '1')));
  for (const id of ['#logs', '#island', '#share']) { await to(R, id); await R.waitForTimeout(500); }
  ok('…no animations run', await S(R, () => document.getAnimations().filter((a) => a.playState === 'running').length === 0), await S(R, () => document.getAnimations().map((a) => a.animationName || a.constructor.name).join(',')));
  ok('…the fans rest open', await S(R, () => !document.querySelector('.fan.pre') && !document.querySelector('.arc li.up')));
  await to(R, '#island'); await R.waitForTimeout(400);
  const s0 = await ringN(R); await R.waitForTimeout(2500);
  ok('…the ring stays still (it turns only when asked)', await ringN(R) === s0);
  await R.click('.rc-btn[data-ring="1"]'); await R.waitForTimeout(200);
  ok('…and → still works', await ringN(R) === (s0 % 12) + 1);
  await to(R, '#monthly'); await R.waitForTimeout(4200);
  ok('…the gallery does not change by itself', await S(R, () => document.querySelector('.gal-cap b').textContent === '奶油'));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  const pass = results.filter((x) => x.pass).length;
  results.forEach((x) => console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${x.pass ? '' : `  ← ${x.info}`}`));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
