// 島上的媽媽 + 祝福牆 (needs the member API): several moms and a friend, each in their own browser.
// Usage: (repo root) MOM_TRUST_PROXY=1 APP_PORT=8790 node api/index.js   then   node mom-app/tests/social.playwright.cjs
//        BASE=http://localhost:8790/mom-app/  STATIC_BASE=<a static-only host, to check the offline state>  AXE_PATH=<axe.min.js>
// Each browser gets its own X-Forwarded-For so it counts as its own network (the server's per-network limits).
const { chromium, devices } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8790/mom-app/';
const STATIC_BASE = process.env.STATIC_BASE || '';
const AXE = process.env.AXE_PATH || '';
const results = []; const errors = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const S = (p, f, a) => p.evaluate(f, a);
const ip = () => `10.${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
const AV_A = {
  v: 1, mode: 'photo', face: 'data:image/jpeg;base64,/9j/AAAA', skin: '#eec2a0', hair: '#251916', style: 'pony', eyes: 'round', glasses: true, blush: true, outfit: '#8b57a8',
};
const AV_B = {
  v: 1, mode: 'draw', skin: '#f6d2b8', hair: '#6e4a32', style: 'bob', eyes: 'smile', glasses: false, blush: true, outfit: '#4fa77a',
};

(async () => {
  const b = await chromium.launch();
  const mk = async (who, { base = BASE, scheme = 'light', device = 'iPhone 13' } = {}) => {
    const ctx = await b.newContext({
      ...devices[device], locale: 'zh-TW', reducedMotion: 'reduce', colorScheme: scheme, extraHTTPHeaders: { 'X-Forwarded-For': ip() },
    });
    await ctx.addInitScript(() => { window.__noShareMoments = true; });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${who}: ${m.text()}`); });
    p.sent = [];
    p.on('request', (r) => { if (/\/api\//.test(r.url()) && r.method() === 'POST') p.sent.push({ url: r.url(), body: r.postData() || '' }); });
    await p.goto(base); await p.waitForFunction(() => window.App && App.social && App.wall);
    return p;
  };
  const preg = (p, weeks, name, av) => S(p, ([w, n, a]) => {
    const s = App.store.defaults(); s.onboarded = true; s.onboardedAt = '2026-01-01'; s.profile.stage = 'preg'; s.profile.momName = n; s.settings.a2hsDismissed = '1';
    s.island = { stamps: {}, quiz: {}, visited: {}, seen: { prep: 1, preg1: 1, preg2: 1, preg3: 1 }, toured: '1' };
    s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -(w * 7))); s.profile.edd = Core.eddFromLmp(s.profile.lmp); s.profile.avatar = a; App.store.replace(s);
  }, [weeks, name, av]);
  const baby = (p, days, name) => S(p, ([d, n]) => {
    const s = App.store.defaults(); s.onboarded = true; s.onboardedAt = '2026-01-01'; s.profile.stage = 'baby'; s.profile.momName = n; s.settings.a2hsDismissed = '1';
    s.island = { stamps: {}, quiz: {}, visited: {}, seen: { prep: 1, preg1: 1, preg2: 1, preg3: 1, newborn: 1 }, toured: '1' };
    s.babies = [{ id: 'b1', name: '小湯圓', sex: 'girl', birthday: Core.dateKey(Core.addDays(new Date(), -d)) }]; s.activeBabyId = 'b1';
    s.profile.avatar = { v: 1, mode: 'draw', skin: '#dca47e', hair: '#2b2020', style: 'bun', eyes: 'lash', outfit: '#e7809a' };
    App.store.replace(s);
  }, [days, name]);
  const go = async (p, id, params, wait = 900) => { await S(p, ([x, y]) => App.navigate(x, { ...(y || {}), n: Math.random() }), [id, params]); await p.waitForTimeout(wait); };
  const esc = async (p) => { for (let i = 0; i < 3; i += 1) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); } };
  const topSheet = (p) => S(p, () => { const s = [...document.querySelectorAll('.sheet')].pop(); return s ? s.innerText : ''; });
  const toasts = (p) => S(p, () => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE }).catch(() => {});
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations
      .filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const smallTaps = (p, sel) => S(p, (q) => [...document.querySelectorAll(q)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 40 || r.height < 40); })
    .map((e) => `${(e.getAttribute('aria-label') || e.textContent).trim().slice(0, 14)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`), sel);

  /* ================= 島上的媽媽 ================= */
  const A = await mk('A'); await preg(A, 22, '小美', AV_A);
  const B = await mk('B'); await preg(B, 20, '阿芳', AV_B);

  await go(A, 'island', null, 1800);
  const chip0 = await S(A, () => { const c = document.querySelector('.soc-chip'); return c && !c.hidden ? c.textContent : ''; });
  ok('map: a chip invites you to walk the islands with other moms (off by default)', /一起逛/.test(chip0) && !(await S(A, () => App.social.soc().on)), chip0);
  ok('nothing is sent about you before you join', !A.sent.some((r) => /social\/here/.test(r.url)));
  await A.click('.soc-chip'); await A.waitForTimeout(500);
  const joinText = await topSheet(A);
  ok('join sheet says what others see and what they never see', /不會用你的照片/.test(joinText) && /你的照片、週數、寶寶資料/.test(joinText) && /不能私訊、不能留言/.test(joinText), joinText.slice(0, 200));
  await axe(A, 'join sheet');
  await A.fill('.sheet input[aria-label="顯示名稱"]', '小美 0912345678');
  await A.click('.sheet-footer .btn-primary'); await A.waitForTimeout(1500);
  const hereReq = A.sent.find((r) => /social\/here/.test(r.url));
  ok('joining sends only the drawn chibi: never the face photo', hereReq && !/data:image|face|photo/.test(hereReq.body) && /"pose":"preg"/.test(hereReq.body), hereReq && hereReq.body.slice(0, 200));
  ok('the name loses the phone number (as others see it)', (await S(A, () => App.social.soc().name)) === '小美');
  ok('nothing from the health records is sent', A.sent.filter((r) => /social/.test(r.url)).every((r) => !/lmp|edd|weeks|kicks|visit|weight/.test(r.body)));

  // B joins from 我的
  await go(B, 'me');
  await B.click('button.list-item:has-text("島上的媽媽")'); await B.waitForTimeout(400);
  ok('我的 → 島上的媽媽 shows it is off', /目前沒有開啟/.test(await topSheet(B)));
  await B.click('.sheet button:has-text("開啟島上的媽媽")'); await B.waitForTimeout(500);
  await B.click('.sheet-footer .btn-primary'); await B.waitForTimeout(1500);
  ok('B joined anonymously (no name → 匿名媽咪)', await S(B, () => App.social.soc().on && !App.social.soc().name));

  await esc(A);
  // (moms left over from an earlier run may still be on the island for 2 minutes: find B by id, not by count)
  const nidB = await S(B, () => App.social.me().nid);
  const nidA = await S(A, () => App.social.me().nid);
  const seesB = (p) => S(p, (n) => App.social.forIsland('preg2').people.some((x) => x.nid === n), nidB);
  await S(A, () => App.social.poll('preg2')); await A.waitForTimeout(1000);
  const map = await S(A, () => ({ imgs: document.querySelectorAll('.isl-ibanner[data-island="preg2"] .isl-ib-nb image').length, chip: document.querySelector('.soc-chip').textContent }));
  ok('A sees B\'s chibi beside the island name plate', map.imgs >= 1 && await seesB(A), JSON.stringify(map));
  ok('the chip says how many moms are on this island (no "null")', /孕中期島 \d+ 位媽媽/.test(map.chip) && !/null|undefined/.test(map.chip), map.chip);
  await A.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/social-map.png` }).catch(() => {});
  // tap the neighbour on the map
  const box = await S(A, () => { const r = document.querySelector('.isl-ibanner[data-island="preg2"] .isl-ib-nb .isl-hit'); if (!r) return null; const bb = r.getBoundingClientRect(); return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }; });
  if (box) { await A.mouse.click(box.x, box.y); await A.waitForTimeout(900); }
  const res = await topSheet(A);
  ok('tapping the chibis opens 孕中期島的媽媽們 with B in it', /孕中期島的媽媽們/.test(res) && /匿名媽咪/.test(res) && /現在有 \d+ 位媽媽在孕中期島，還有你/.test(res), res.slice(0, 200));
  ok('reaction buttons are big enough to tap', !(await smallTaps(A, '.sheet .soc-act, .sheet .soc-more')).length, (await smallTaps(A, '.sheet .soc-act, .sheet .soc-more')).join(', '));
  await axe(A, 'residents sheet');
  await A.click('.sheet .soc-act[aria-label^="揮手"]'); await A.waitForTimeout(700);
  ok('wave sent: button marked, toast says so', await S(A, () => document.querySelector('.sheet .soc-act[aria-label^="揮手"]').classList.contains('sent')) && /已送出 👋 揮手/.test(await toasts(A)));
  await A.click('.sheet .soc-act[aria-label^="揮手"]'); await A.waitForTimeout(700);
  ok('waving twice does not ping B twice', /剛剛已經揮手過了/.test(await toasts(A)), await toasts(A));
  await A.click('.sheet .soc-act[aria-label^="愛心"]'); await A.waitForTimeout(700);

  await S(B, () => App.social.poll()); await B.waitForTimeout(800);
  const tB = await toasts(B);
  ok('B gets a toast: who, which island, what (with 回應)', /小美（孕中期島）/.test(tB) && /回應/.test(tB), tB);
  await go(B, 'home');
  const homeB = await S(B, () => (document.querySelector('.soc-home') || {}).textContent || '');
  ok('B\'s 首頁 shows the new reactions', /小美/.test(homeB) && /點我回應/.test(homeB), homeB);
  await B.click('.soc-home'); await B.waitForTimeout(900);
  const inbox = await topSheet(B);
  ok('…which opens with 收到的互動 first', /收到的互動/.test(inbox) && /向你揮手/.test(inbox) && /送你一顆愛心/.test(inbox), inbox.slice(0, 200));
  await B.click('.sheet .soc-in button:has-text("回 👋")'); await B.waitForTimeout(800);
  await S(A, () => App.social.poll()); await A.waitForTimeout(700);
  ok('B waves back from the inbox; A gets it', /向你揮手/.test(await toasts(A)), await toasts(A));
  await esc(B);
  ok('reading the inbox clears the 首頁 card', await S(B, () => App.social.unread() === 0));
  await go(B, 'home');
  ok('…and the card is gone', !(await S(B, () => !!document.querySelector('.soc-home'))));

  // block / unblock
  await esc(A);
  await S(A, () => App.social.openResidents('preg2')); await A.waitForTimeout(900);
  await A.click(`.sheet .soc-p[data-nid="${nidB}"] .soc-more`); await A.waitForTimeout(300);
  await A.click('.sheet button:has-text("封鎖這位媽媽")'); await A.waitForTimeout(400);
  await A.click('.sheet-footer .btn-primary, .sheet button:has-text("封鎖")').catch(() => {}); await A.waitForTimeout(900);
  await S(A, () => App.social.poll('preg2')); await A.waitForTimeout(800);
  const blockedB = await S(A, (n) => !!App.social.soc().blocked[n], nidB);
  ok('block: B disappears for A', blockedB && !(await seesB(A)), `blocked=${blockedB}`);
  await S(B, () => App.social.poll('preg2')); await B.waitForTimeout(600);
  const bSeesA = await S(B, (n) => App.social.forIsland('preg2').people.some((x) => x.nid === n), nidA);
  const hug = await S(B, (n) => App.social.call('POST', 'social/react', { key: App.social.soc().key, to: n, kind: 'hug' }), nidA);
  await S(A, () => App.social.poll('preg2')); await A.waitForTimeout(700);
  ok('…and B\'s 抱抱 never reaches A (B is not told)', !/抱抱/.test(await toasts(A)) && bSeesA && hug.ok, JSON.stringify(hug));
  await esc(A);
  await S(A, () => App.social.openSettings()); await A.waitForTimeout(400);
  ok('settings list the blocked mom', /已封鎖（1）/.test(await topSheet(A)));
  await A.click('.sheet button:has-text("解除封鎖")'); await A.waitForTimeout(700);
  await S(A, () => App.social.poll('preg2')); await A.waitForTimeout(700);
  ok('unblock brings B back', await seesB(A));
  await esc(A);

  // dark mode + small phone
  const D = await mk('D', { scheme: 'dark', device: 'iPhone SE' }); await baby(D, 30, '小芸');
  await go(D, 'island', null, 1500);
  await S(D, () => App.social.openJoin()); await D.waitForTimeout(400);
  await axe(D, 'join sheet (dark, small phone)');
  const over = await S(D, () => document.documentElement.scrollWidth - innerWidth);
  ok('small phone: no sideways scroll', over <= 1, over);
  await D.click('.sheet-footer .btn-primary'); await D.waitForTimeout(1200);
  await S(D, () => App.social.openResidents('newborn')); await D.waitForTimeout(900);
  const dSheet = await topSheet(D);
  ok('a mom alone on her island gets a friendly empty state + invite (or sees the others there)', (/還沒有人在這座島/.test(dSheet) || /現在有 \d+ 位媽媽在月子島/.test(dSheet)) && /邀請朋友一起逛/.test(dSheet), dSheet.slice(0, 120));
  await axe(D, 'residents sheet (dark)');
  await esc(D);
  ok('baby stage: the chibi others see holds the baby', D.sent.some((r) => /social\/here/.test(r.url) && /"pose":"baby"/.test(r.body)));

  // leaving and 清除所有資料 take you off the islands
  await S(B, () => App.social.openSettings()); await B.waitForTimeout(300);
  await B.click('.sheet button:has-text("關閉（其他媽媽看不到我）")'); await B.waitForTimeout(800);
  await S(A, () => App.social.poll('preg2')); await A.waitForTimeout(700);
  ok('turning it off: A no longer sees B', !(await seesB(A)));
  await esc(B);
  await S(D, () => App.social.poll('newborn'));
  const nidD = await S(D, () => App.social.me().nid);
  const seesD = () => S(A, (n) => App.social.forIsland('newborn').people.some((x) => x.nid === n), nidD);
  await S(A, () => App.social.poll('newborn')); await A.waitForTimeout(700);
  const seenD = await seesD();
  await S(D, () => App.store.reset()); await D.waitForTimeout(900);
  await S(A, () => App.social.poll('newborn')); await A.waitForTimeout(700);
  ok('清除所有資料 takes you off the islands too', seenD && !(await seesD()), `${seenD}`);

  /* ================= 祝福牆 ================= */
  const M = await mk('M'); await baby(M, 30, '小芸');
  await go(M, 'home', null, 3000);
  const nudge = await S(M, () => (document.querySelector('.wall-home') || {}).textContent || '');
  ok('首頁 at 1 month: 小湯圓的滿月快到了！ (open a wall)', /小湯圓的滿月快到了/.test(nudge), nudge);
  await M.click('.wall-home-main'); await M.waitForTimeout(900);
  ok('…opens the wall maker with 滿月祝福牆 picked and the baby\'s name filled in', await S(M, () => document.querySelector('.wall-occ-b.on').textContent.includes('滿月') && document.querySelector('input[aria-label="寶寶的名字或小名"]').value === '小湯圓'));
  await axe(M, 'wall maker');
  await M.click('button:has-text("開一面祝福牆")'); await M.waitForTimeout(1500);
  ok('making the wall opens the share sheet right away', /分享/.test(await topSheet(M)) && await S(M, () => !!document.querySelector('.sheet .sh-preview')));
  await esc(M);
  const wall = await S(M, () => App.social.soc().walls[0]);
  ok('the wall\'s private key stays on this phone', wall && wall.key && wall.key.length >= 24 && wall.occasion === 'month');
  await axe(M, 'wall (owner)');
  const link = await S(M, (id) => App.share.link({ path: 'wish', params: { w: id }, channel: 'line', campaign: 'wish' }), wall.id);
  ok('share link opens the wish page and carries the invite code', /#\/wish\?/.test(link) && /ref=/.test(link), link);

  const F = await mk('F');
  await F.goto(link); await F.waitForTimeout(1800);
  ok('a friend with no app set up lands on the wall (not the setup screens)', await S(F, () => document.body.dataset.screen === 'wish' && !App.store.state.onboarded));
  ok('the wall says whose it is', /小湯圓的滿月祝福牆/.test(await S(F, () => document.body.innerText)) && /小芸邀請你留下一句祝福/.test(await S(F, () => document.body.innerText)));
  ok('the friend is counted as invited by the mom', await S(F, (code) => App.store.state.share && App.store.state.share.invitedBy === code, await S(M, () => App.store.state.share.code)));
  await axe(F, 'wish page (friend)');
  await F.click('.wish-form button[type=submit]'); await F.waitForTimeout(400);
  ok('empty blessing: asks for a sentence', /請寫一句祝福/.test(await S(F, () => document.querySelector('.wish-form .login-err').textContent)));
  await F.fill('input[aria-label="你的名字"]', '阿嬤');
  await F.click('.wish-presets .chip >> nth=1');
  ok('a preset fills the text', (await F.inputValue('textarea')) === '頭好壯壯、一眠大一吋');
  await F.fill('textarea', '頭好壯壯！加 line id: abc123 www.spam.tw');
  await F.click('.wish-stk[aria-label="貼圖 🧸"]');
  await F.click('.wish-form button[type=submit]'); await F.waitForTimeout(1300);
  const fPage = await S(F, () => document.querySelector('.wish-wall').innerText);
  ok('sent: the friend sees it waiting for the mom, without the spam', /頭好壯壯/.test(fPage) && /等媽媽確認/.test(fPage) && !/spam|abc123/.test(fPage), fPage);
  const G = await mk('G'); await G.goto(link); await G.waitForTimeout(1500);
  ok('nobody else sees it before the mom approves', /成為第一個留下祝福的人/.test(await S(G, () => document.querySelector('.wish-wall').innerText)));

  await S(M, () => Promise.all(App.social.soc().walls.map((w) => App.wall.loadAdmin(w)))); await M.waitForTimeout(300);
  await go(M, 'home', null, 900);
  ok('mom\'s 首頁: 小湯圓的滿月祝福牆有 1 則新祝福', /有 1 則新祝福/.test(await S(M, () => (document.querySelector('.wall-home') || {}).textContent || '')));
  await M.click('.wall-home'); await M.waitForTimeout(1500);
  ok('pending blessing shown with 顯示／刪除', /等你確認（1）/.test(await S(M, () => document.body.innerText)) && await S(M, () => !!document.querySelector('.wish-mod .btn-primary')));
  ok('moderation buttons are big enough', !(await smallTaps(M, '.wish-mod button')).length, (await smallTaps(M, '.wish-mod button')).join(', '));
  await M.click('.wish-mod .btn-primary'); await M.waitForTimeout(1200);
  await G.reload(); await G.waitForTimeout(1500);
  ok('approved: everyone with the link sees it', /頭好壯壯/.test(await S(G, () => document.querySelector('.wish-wall').innerText)) && /阿嬤/.test(await S(G, () => document.querySelector('.wish-wall').innerText)));
  // save as a card
  await S(M, () => { window.__saved = null; App.share.saveImage = async (blob, name) => { window.__saved = { size: blob.size, name }; return 'downloaded'; }; });
  await M.click('button:has-text("存成祝福卡")'); await M.waitForTimeout(2500);
  const saved = await S(M, () => window.__saved);
  ok('存成祝福卡 makes an image', saved && saved.size > 20000 && /小湯圓的滿月祝福牆/.test(saved.name), JSON.stringify(saved));
  // print: the form and buttons are not printed
  await G.emulateMedia({ media: 'print' });
  ok('printing the wall leaves out the form', await S(G, () => getComputedStyle(document.querySelector('.wish-form')).display === 'none'));
  await G.emulateMedia({ media: 'screen' });
  // the mom opening her own link
  await M.goto(link.replace('ref=', 'x=')); await M.waitForTimeout(1500);
  ok('the mom opening her own link gets 管理這面牆', /管理這面牆/.test(await S(M, () => document.body.innerText)));
  // hide, then delete
  await go(M, 'wall', { id: wall.id }, 1500);
  await M.click('.wall-shown button:has-text("收起")'); await M.waitForTimeout(1000);
  await G.reload(); await G.waitForTimeout(1300);
  ok('收起 takes it off the public wall', /成為第一個留下祝福的人/.test(await S(G, () => document.querySelector('.wish-wall').innerText)));
  await M.click('button:has-text("刪除這面祝福牆")'); await M.waitForTimeout(400);
  await M.click('.sheet button.btn-danger, .sheet button:has-text("刪除")'); await M.waitForTimeout(1300);
  await G.reload(); await G.waitForTimeout(1300);
  ok('deleted: the link says the wall is closed', /已經關閉/.test(await S(G, () => document.body.innerText)));
  ok('…and the wall is gone from the mom\'s phone', await S(M, () => App.social.soc().walls.length === 0));

  /* ================= the walls' keys survive 載入範例資料 and a full restore ================= */
  {
    const K = await mk('K'); await baby(K, 30, '小芸');
    const w = await S(K, async () => { await App.social.api(); return App.wall.create({ occasion: 'month', baby: '小湯圓', mom: '小芸' }); });
    await S(K, () => App.demo.seed()); await K.waitForTimeout(600);
    ok('載入範例資料 keeps the key of the wall this phone opened', await S(K, (id) => App.social.soc().walls.some((x) => x.id === id && x.key), w.id));
    const backup = await S(K, () => { const d = JSON.parse(JSON.stringify(App.store.state)); delete d.social; return JSON.stringify({ app: 'yijia-mom', data: d }); });
    const file = `${process.env.SHOT_DIR || '/tmp'}/social-backup.json`; fs.writeFileSync(file, backup);
    await S(K, () => App.me.importData()); await K.waitForTimeout(400);
    await K.click('.sheet .seg button:has-text("整個取代")');
    const [fc] = await Promise.all([K.waitForEvent('filechooser'), K.click('.sheet button:has-text("選擇備份檔")')]);
    await fc.setFiles(file); await K.waitForTimeout(600);
    await K.click('.sheet-footer .btn-primary'); await K.waitForTimeout(900);
    ok('整個取代 (restore a backup) keeps it too', /匯入完成/.test(await toasts(K)) && await S(K, (id) => App.social.soc().walls.some((x) => x.id === id && x.key), w.id), await toasts(K));
    ok('…and the mom can still manage the wall', (await S(K, (id) => App.wall.loadAdmin(App.social.soc().walls.find((x) => x.id === id)).then(() => 'ok').catch((e) => e.code), w.id)) === 'ok');
  }

  /* ================= without the member service ================= */
  if (STATIC_BASE) {
    const O = await mk('O', { base: STATIC_BASE }); await preg(O, 22, '小美', AV_B);
    await go(O, 'island', null, 2500);
    ok('offline / static site: no chip on the map, no made-up numbers', await S(O, () => { const c = document.querySelector('.soc-chip'); return !c || c.hidden; }));
    await go(O, 'wall', null, 1500);
    ok('offline: the wall maker explains it needs the member service', /需要連上會員服務/.test(await S(O, () => document.body.innerText)) && await S(O, () => document.querySelector('button.btn-primary.btn-block:disabled') !== null));
    await go(O, 'wish', { w: 'AAAAAAAAAA' }, 1500);
    ok('offline: a wish link shows a calm message', /連不到|已經關閉/.test(await S(O, () => document.body.innerText)));
    await go(O, 'me');
    const meRows = await S(O, () => [...document.querySelectorAll('.list-item')].map((e) => e.innerText.replace(/\s+/g, ' ')).filter((t) => /島上的媽媽|同週好孕圈|祝福牆/.test(t)));
    ok('offline: 我的 shows one line saying the social features need the member service', meRows.length === 1 && /需要連上會員服務/.test(meRows[0]), meRows.join(' || '));
    await S(O, () => App.social.openSettings()); await O.waitForTimeout(500);
    ok('offline: 島上的媽媽 settings say it cannot connect', /目前連不到社群服務/.test(await topSheet(O)));
    await O.click('.sheet button:has-text("開啟島上的媽媽")'); await O.waitForTimeout(400);
    await O.click('.sheet-footer .btn-primary'); await O.waitForTimeout(900);
    ok('offline: joining does not pretend to work', await S(O, () => !App.social.soc().on) && /連不到/.test(await toasts(O)), await toasts(O));
  }

  ok('no page errors anywhere', !errors.length, errors.slice(0, 4).join(' | '));
  console.log('\n=== 島上的媽媽・祝福牆 ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
