// 家人共用紀錄 (js/modules/family.js + the member server): mom creates a family (consent first), her records go up
// encrypted, dad opens the invite link on a fresh phone, sees who invited him, joins and gets every record; what he logs
// reaches mom and what she deletes leaves his phone. The server only ever holds ciphertext; a broken key or an old link
// is caught; a restored backup merges instead of deleting; removing a member and ending the family stop the sync and
// leave each phone's own records. Also: no member service (the web preview), small phone, accessibility.
// Usage: API_BASE=http://localhost:8790/mom-app/ (the member server)  BASE=http://localhost:8731/ (a static copy)
//        AXE_PATH=<axe.min.js>  node tests/family.playwright.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:8790/mom-app/';
const BASE = process.env.BASE || 'http://localhost:8731/';
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const api = axios.create({ validateStatus: () => true });
const RUN = Date.now().toString(36);

(async () => {
  const cfg = (await api.get(`${API_BASE}api/config`)).data;
  let n = 0;
  const member = async (nick) => {
    n += 1;
    const r = await api.post(`${API_BASE}api/auth/register`, { consent: cfg.policy, account: `fam-${RUN}-${n}@example.com`, password: 'baby-sleeps-9', nickname: nick }, { headers: { 'X-Forwarded-For': `10.88.${Math.floor(Math.random() * 250)}.${n}` } });
    if (r.status !== 201) throw new Error(`register ${r.status} ${JSON.stringify(r.data)}`);
    return { token: r.data.token, user: r.data.user };
  };
  const b = await chromium.launch();
  const mk = async (base, { width = 390, height = 844, demo = false, auth = null, hash = '' } = {}) => {
    const c = await b.newContext({ viewport: { width, height }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', acceptDownloads: true });
    await c.addInitScript(() => { window.__noShareMoments = true; window.open = (u) => { window.__opened = u; return null; }; });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(base);
    await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.family);
    if (demo) { await p.click('text=先看看範例資料'); await p.waitForTimeout(900); }
    if (auth) await p.evaluate((a) => App.store.update((s) => { s.auth = a; }), auth);
    await p.evaluate(() => { App.isNight = () => false; App.applyTheme(); App.store.update((s) => { s.settings.a2hsDismissed = '1'; }); });
    if (hash) { await p.evaluate((x) => { location.hash = x; }, hash); await p.waitForTimeout(1200); }
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const go = async (p, screen, ms = 1200) => { await S(p, (x) => { App.navigate(x); App.refresh(); }, screen); await p.waitForTimeout(ms); };
  const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: `${SHOT}${name}.png`, fullPage: true }); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((y) => y.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const text = (p) => S(p, () => document.getElementById('view').innerText.replace(/\s+/g, ' '));
  const counts = (p) => S(p, () => ({ logs: App.store.state.logs.length, babies: App.store.state.babies.map((x) => x.name).join(), growth: App.store.state.growth.length, milk: App.store.state.milk.length }));
  const syncNow = (p) => S(p, () => App.family.sync());

  /* ---------- 1. no member service (the web preview) ---------- */
  const W = await mk(BASE, { demo: true });
  await go(W, 'family', 1500);
  ok('no member service: the page says what it is and that it needs the member service', /還沒有開啟會員服務/.test(await text(W)) && /匯出／匯入備份/.test(await text(W)));
  ok('我的 has a 家人共用紀錄 line', await S(W, async () => { App.navigate('me'); await new Promise((r) => setTimeout(r, 700)); return /家人共用紀錄/.test((document.querySelector('.fm-li') || {}).innerText || ''); }));

  /* ---------- 2. mom creates a family ---------- */
  const mom = await member('小美');
  const dad = await member('阿弘');
  const M = await mk(API_BASE, { demo: true, auth: mom });
  await go(M, 'family', 1800);
  let t = await text(M);
  ok('the intro says what is shared, what is not, and that only the family\'s phones can read it', /會同步：寶寶資料/.test(t) && /不會同步：懷孕紀錄、產檢日記、月照照片/.test(t) && /伺服器只存看不懂的密文/.test(t), t.slice(0, 200));
  ok('creating waits for her consent', await S(M, () => document.querySelector('.fm-create').disabled));
  await axe(M, 'family intro');
  await M.click('.fm-agree'); await M.waitForTimeout(200);
  await M.click('.fm-create'); await M.waitForTimeout(2500);
  const fam1 = await S(M, () => App.store.state.family);
  ok('a family: its id, a 32-byte key made on the phone, owner, consent time', fam1 && fam1.id && /^[A-Za-z0-9_-]{43}$/.test(fam1.key) && fam1.role === 'owner' && fam1.consentAt, JSON.stringify(fam1).slice(0, 200));
  await syncNow(M);
  const momCount = await counts(M);
  // what the server holds: ciphertext only
  const raw = (await api.get(`${API_BASE}api/family/pull?since=0&limit=500`, { headers: { Authorization: `Bearer ${mom.token}` } })).data;
  ok('her records went up (babies, logs, growth, milk, milestones…)', raw.changes.length >= momCount.logs + 5, `${raw.changes.length} vs ${momCount.logs} logs`);
  const blob = JSON.stringify(raw);
  ok('the server holds only ciphertext: no names, types, notes or times', !/小乖|breast|diaper|bottle|demo-baby|小美/.test(blob) && raw.changes.every((c) => /^[A-Za-z0-9_-]{22}$/.test(c.r)), blob.slice(0, 160));
  const wrong = await S(M, async (c) => App.family.decrypt(c.d, 'A'.repeat(43), App.store.state.family.id, c.r), raw.changes[0]);
  const right = await S(M, async (c) => App.family.decrypt(c.d, App.store.state.family.key, App.store.state.family.id, c.r), raw.changes[0]);
  ok('the family key opens a record; another key cannot', wrong === null && right && right.t && right.v, JSON.stringify(right).slice(0, 80));
  const moved = await S(M, async (cs) => App.family.decrypt(cs[0].d, App.store.state.family.key, App.store.state.family.id, cs[1].r), raw.changes);
  ok('a record moved under another name does not open (bound to its name and family)', moved === null);
  await shot(M, 'family-mom');
  t = await text(M);
  ok('her page: synced, the members, inviting, what is shared, 結束家人共用紀錄', /已同步/.test(t) && /家人（1）/.test(t) && /邀請家人/.test(t) && /結束家人共用紀錄/.test(t), t.slice(0, 240));
  await axe(M, 'family page (owner)');

  /* ---------- 3. dad joins from the link on a fresh phone ---------- */
  const link = await S(M, () => App.family.link());
  ok('the invite link: the app address, the family and invite, and the key after #', link.startsWith(API_BASE) && /#\/family\?/.test(link) && JSON.parse(decodeURIComponent(link.split('#/family?')[1])).k === fam1.key, link.slice(0, 80));
  await M.click('.fm-line'); await M.waitForTimeout(500);
  const sent = await S(M, () => window.__opened || '');
  ok('LINE 傳送 opens LINE with the link and a note to send it only to family', /line\.me\/R\/share/.test(sent) && decodeURIComponent(sent).includes('只傳給家人') && decodeURIComponent(sent).includes('#/family?'), decodeURIComponent(sent).slice(0, 120));
  const D = await mk(API_BASE, { auth: dad, hash: `#/family?${link.split('#/family?')[1]}` });
  await D.waitForFunction(() => document.querySelector('.fm-join'), null, { timeout: 8000 }).catch(() => {});
  t = await text(D);
  ok('a fresh phone opens the invite (no setup first) and sees who invited him', /媽媽邀請你一起記錄/.test(t) && /這個家庭現在有 1 位家人/.test(t), t.slice(0, 200));
  await D.selectOption('.fm-who', '爸爸');
  await D.click('.fm-agree'); await D.waitForTimeout(200);
  await shot(D, 'family-join');
  await axe(D, 'family join');
  await D.click('.fm-join');
  await D.waitForFunction(() => App.store.state.logs.length > 0, null, { timeout: 15000 }).catch(() => {});
  await D.waitForTimeout(1500);
  const dadCount = await counts(D);
  ok('dad joined and got everything: the baby, every log, growth, milk', dadCount.babies === '小乖' && dadCount.logs === momCount.logs && dadCount.growth === momCount.growth && dadCount.milk === momCount.milk, `${JSON.stringify(dadCount)} vs ${JSON.stringify(momCount)}`);
  ok('…his phone is set up for the baby, and the key left the address bar', await S(D, () => App.store.state.onboarded && App.store.state.profile.stage === 'baby' && App.store.state.profile.member === '爸爸' && location.hash === '#/family'));
  const vac = await S(D, () => JSON.stringify(App.store.state.vaccines['demo-baby'] || {}));
  ok('vaccines, check-ups and milestones came too', vac.includes('hepb1') && await S(D, () => !!App.store.state.checkups['demo-baby'] && !!App.store.state.milestones['demo-baby']), vac);

  /* ---------- 4. both ways ---------- */
  const newId = await S(D, () => { const id = `dad-${Date.now()}`; App.store.update((s) => { s.logs.push({ id, babyId: 'demo-baby', type: 'diaper', start: new Date().toISOString(), end: null, data: { kind: 'wet' }, note: '爸爸換的', by: s.profile.member, createdAt: new Date().toISOString() }); }); return id; });
  await D.waitForTimeout(500); await syncNow(D);
  await syncNow(M);
  const got = await S(M, (id) => App.store.state.logs.find((l) => l.id === id) || null, newId);
  ok('what dad logs reaches mom (with who logged it)', got && got.by === '爸爸' && got.note === '爸爸換的', JSON.stringify(got));
  const delId = await S(M, () => { const l = App.store.state.logs.find((x) => x.type === 'bath'); App.store.update((s) => { s.logs = s.logs.filter((x) => x.id !== l.id); }); return l.id; });
  await syncNow(M); await syncNow(D);
  ok('what mom deletes leaves dad\'s phone', await S(D, (id) => !App.store.state.logs.some((l) => l.id === id), delId));
  await S(M, () => App.store.update((s) => { s.babies[0].name = '小乖乖'; }));
  await syncNow(M); await syncNow(D);
  ok('a change to the baby reaches dad (his own baby photo would stay)', await S(D, () => App.store.state.babies[0].name) === '小乖乖');
  // the same record changed on both phones before a sync: the one the server got last wins, and both end the same
  const fid = await S(M, () => App.store.state.logs.find((l) => l.type === 'temp').id);
  await S(M, (id) => App.store.update((s) => { s.logs.find((l) => l.id === id).data.c = 37.1; }), fid);
  await S(D, (id) => App.store.update((s) => { s.logs.find((l) => l.id === id).data.c = 37.4; }), fid);
  await syncNow(M); await syncNow(D); await syncNow(M);
  const both = [await S(M, (id) => App.store.state.logs.find((l) => l.id === id).data.c, fid), await S(D, (id) => App.store.state.logs.find((l) => l.id === id).data.c, fid)];
  ok('two phones changing the same record end up the same (the later one wins)', both[0] === both[1] && both[0] === 37.4, both.join());

  /* ---------- 5. a restored backup merges, never deletes ---------- */
  const before = (await api.get(`${API_BASE}api/family/pull?since=0&limit=500`, { headers: { Authorization: `Bearer ${dad.token}` } })).data.changes.filter((c) => !c.x).length;
  await S(M, () => { const s = JSON.parse(JSON.stringify(App.store.state)); s.logs = s.logs.slice(0, 10); App.store.replace({ ...s, family: App.store.state.family, auth: App.store.state.auth }); App.family.rebase(); });
  await syncNow(M);
  const after = (await api.get(`${API_BASE}api/family/pull?since=0&limit=500`, { headers: { Authorization: `Bearer ${dad.token}` } })).data.changes.filter((c) => !c.x).length;
  ok('restoring an older backup on mom\'s phone does not delete the family\'s records (it merges)', after === before && await S(M, () => App.store.state.logs.length) === momCount.logs + 1 - 1, `${before} → ${after}; mom ${await S(M, () => App.store.state.logs.length)}`);

  /* ---------- 6. links that do not work ---------- */
  const broken = link.split('#/family?')[1].replace(/%22k%22%3A%22([A-Za-z0-9_-])/, (m0, ch) => m0.slice(0, -1) + (ch === 'A' ? 'B' : 'A'));
  const X = await mk(API_BASE, { auth: await member('阿嬤'), hash: `#/family?${broken}` });
  await X.waitForTimeout(1500);
  ok('a link with a damaged key is caught before joining', /連結不完整/.test(await text(X)), (await text(X)).slice(0, 120));
  const Y = await mk(API_BASE, { auth: await member('阿公'), hash: `#/family?${encodeURIComponent(JSON.stringify({ j: `${fam1.id}.not-a-real-token-xx`, k: fam1.key }))}` });
  await Y.waitForTimeout(1500);
  ok('an old or wrong invite says it has expired', /邀請連結已經失效/.test(await text(Y)), (await text(Y)).slice(0, 120));
  const Z = await mk(API_BASE, { hash: `#/family?${link.split('#/family?')[1]}` });
  await Z.waitForTimeout(1200);
  ok('not logged in: 「登入／註冊後加入」, and the invite waits for the log-in', /登入／註冊後加入/.test(await text(Z)) && await S(Z, () => !!sessionStorage.getItem('yijia-family-join')));

  /* ---------- 7. removing dad, ending the family ---------- */
  await go(M, 'family', 1800);
  ok('mom sees dad in the family', /家人（2）/.test(await text(M)) && /爸爸/.test(await text(M)));
  await M.click('.fm-remove'); await M.waitForTimeout(400);
  await M.click('.sheet .btn-danger'); await M.waitForTimeout(1500);
  const logsBefore = await S(D, () => App.store.state.logs.length);
  await syncNow(D); await D.waitForTimeout(500);
  ok('removed: dad\'s phone stops syncing and keeps its own records', await S(D, () => !App.store.state.family) && await S(D, () => App.store.state.logs.length) === logsBefore);
  await go(M, 'family', 1800);
  await M.click('.fm-leave'); await M.waitForTimeout(400);
  ok('ending the family asks first and says what happens', /伺服器上的共用資料會刪除/.test(await S(M, () => (document.querySelector('.confirm-msg') || {}).innerText || '')));
  await M.click('.sheet .btn-danger'); await M.waitForTimeout(1500);
  ok('ended: mom\'s phone keeps its records; the family is gone on the server', await S(M, () => !App.store.state.family && App.store.state.logs.length > 0) && (await api.get(`${API_BASE}api/family`, { headers: { Authorization: `Bearer ${mom.token}` } })).data.family === null);

  /* ---------- 8. small phone ---------- */
  const SM = await mk(API_BASE, { demo: true, auth: await member('小芳'), width: 320, height: 568 });
  await go(SM, 'family', 1800);
  ok('320 px: nothing wider than the screen', await S(SM, () => document.documentElement.scrollWidth <= innerWidth));
  await shot(SM, 'family-small');

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  const pass = results.filter((r) => r.pass).length;
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ← ${r.info}`}`));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
