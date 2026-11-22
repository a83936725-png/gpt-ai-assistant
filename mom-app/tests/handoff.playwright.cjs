// 交接卡 (js/modules/handoff.js): one page says where things stand when the baby is handed over — the last feed and the
// side to start with, the next feed, the last diaper, asleep or when sleep is likely, today so far, the breast-milk bag to
// use first, medicine and temperature from the last 24 hours (in the app only), timers. Without 家人共用 it goes by LINE
// (no medicine, no temperature); with it, mom hands over with a note, dad's phone gets the card (encrypted) and a banner
// on 首頁, and the server is only told 「換你囉」. Entry points: 接下來 「🤝 交接」, the 交接卡 tool, a11y, small phone.
// Usage: BASE=http://localhost:8731/ (static copy)  API_BASE=http://localhost:8790/mom-app/ (member server)
//        AXE_PATH=<axe.min.js>  node tests/handoff.playwright.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');

const BASE = process.env.BASE || 'http://localhost:8731/';
const API_BASE = process.env.API_BASE || '';
const AXE = process.env.AXE_PATH || '';
const SHOT = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/` : null;
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const NOW = '2026-11-22T15:02:00+08:00';
const RUN = Date.now().toString(36);

(async () => {
  const b = await chromium.launch();
  const mk = async (base, { width = 390, height = 844, demo = true, auth = null, clock = true } = {}) => {
    const c = await b.newContext({ viewport: { width, height }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
    if (clock) await c.clock.install({ time: new Date(NOW) });
    await c.addInitScript(() => { window.__noShareMoments = true; window.open = (u) => { window.__opened = u; return null; }; });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(base);
    await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.handoff);
    if (demo) { await p.click('text=先看看範例資料'); await p.waitForTimeout(900); }
    if (auth) await p.evaluate((a) => App.store.update((s) => { s.auth = a; }), auth);
    await p.evaluate(() => { App.isNight = () => false; App.applyTheme(); App.store.update((s) => { s.settings.a2hsDismissed = '1'; }); });
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: `${SHOT}${name}.png` }); };
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE });
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const toast = (p) => S(p, () => (document.querySelector('.toast-wrap') || {}).innerText || '').then((t) => t.replace(/\s+/g, ' ').trim());

  /* ---------- 1. what the card says (made-up records at 15:02) ---------- */
  const P = await mk(BASE);
  const u = await S(P, () => {
    const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
    App.store.update((s) => {
      const bid = s.activeBabyId;
      s.logs = s.logs.filter((l) => l.babyId !== bid || new Date(l.start) < new Date(Date.now() - 30 * 3600e3)); // keep yesterday and before
      const L = (type, h, m, data = {}, endM = null) => s.logs.push({ id: `h-${type}-${h}-${m}`, babyId: bid, type, start: at(h, m), end: endM != null ? at(h, endM) : null, data, note: '', by: '媽媽' });
      L('bottle', 9, 30, { kind: 'breastmilk', ml: 110 });
      L('breast', 12, 50, { leftMin: 12, rightMin: 10, lastSide: 'R' }, 72);
      L('diaper', 14, 0, { kind: 'wet' });
      L('sleep', 10, 30, {}, 100);
      L('med', 11, 0, { name: '退燒藥', dose: '2.5 ml' });
      L('temp', 10, 45, { c: 37.9, site: '耳溫' });
      s.milk = [
        { id: 'm1', ml: 120, pumpedAt: new Date(Date.now() - 30 * 3600e3).toISOString(), storage: 'fridge', usedAt: null },
        { id: 'm2', ml: 90, pumpedAt: new Date(Date.now() - 5 * 3600e3).toISOString(), storage: 'fridge', usedAt: null },
        { id: 'm3', ml: 150, pumpedAt: new Date(Date.now() - 9 * 86400e3).toISOString(), storage: 'freezer', usedAt: null },
      ];
    });
    const s = App.handoff.summary();
    return { s, rows: App.handoff.rows(s).map((r) => `${r[1]}|${r[2]}|${r[3]}`), txt: App.handoff.text(s, '有點鼻塞，洗澡先跳過') };
  });
  const row = (k) => u.rows.find((x) => x.startsWith(`${k}|`)) || '';
  ok('the last feed: 12:50, how long ago, both sides — and start with the left next time', /^上次餵奶\|12:50（2 小時 12 分前）・左 12 分＋右 10 分\|下次先餵左邊$/.test(row('上次餵奶')), row('上次餵奶'));
  ok('the next feed from the baby\'s own rhythm', /^下一餐大約\|\d\d:\d\d/.test(row('下一餐大約')), row('下一餐大約'));
  ok('the last diaper: 14:00, wet', /^上次換尿布\|14:00（1 小時 2 分前）・濕/.test(row('上次換尿布')), row('上次換尿布'));
  ok('awake since the nap; well past the usual awake time it says the baby may be tired', /^醒著\|3 小時 22 分・已超過建議清醒時間，可能累了/.test(row('醒著')), row('醒著'));
  ok('today so far: 2 feeds (110 ml from the bottle), 1 diaper, 1.2 h of sleep', /^今天\|喝奶 2 次（瓶餵 110 ml）・尿布 1 片・睡 1\.2 小時/.test(row('今天')), row('今天'));
  ok('breast milk: how many bags where, and which one to use first (the oldest that is still good)', /^母乳庫存\|冷藏 2 包・冷凍 1 包\|先用 11\/21 擠的那包（冷藏 120 ml）/.test(row('母乳庫存')), row('母乳庫存'));
  ok('medicine and temperature from the last 24 hours are in the app\'s card', /^用藥\|11:00・退燒藥 2\.5 ml/.test(row('用藥')) && /^體溫\|10:45・37\.9 °C/.test(row('體溫')), u.rows.join(' / '));
  ok('the LINE words have the rest and the note, but no medicine or temperature', /【交接・小乖】15:02/.test(u.txt) && /下次先餵左邊/.test(u.txt) && /📝 有點鼻塞，洗澡先跳過/.test(u.txt) && !/退燒|37\.9|用藥|體溫/.test(u.txt), u.txt);

  /* ---------- 2. on its own (no family): 接下來 「🤝 交接」 → LINE ---------- */
  await S(P, () => App.navigate('home')); await P.waitForTimeout(900);
  ok('接下來 has 「🤝 交接」', !!(await P.$('.next-card .next-handoff')));
  await P.click('.next-card .next-handoff'); await P.waitForTimeout(600);
  const sheet = await S(P, () => { const s = document.querySelector('.sheet'); return s ? { title: s.querySelector('h2').innerText, text: s.innerText.replace(/\s+/g, ' '), btn: (s.querySelector('.ho-send') || {}).innerText } : null; });
  ok('the card opens with every row and a note box; without 家人共用 it sends by LINE', sheet && /交接卡・小乖/.test(sheet.title) && /上次餵奶/.test(sheet.text) && /母乳庫存/.test(sheet.text) && /交代事項/.test(sheet.text) && /用 LINE 傳給家人/.test(sheet.btn), JSON.stringify(sheet));
  ok('…and says the LINE words leave out medicine and temperature', /用 LINE 傳的文字不包含用藥和體溫/.test(sheet.text));
  await shot(P, 'handoff-sheet');
  await axe(P, 'handoff sheet');
  await P.fill('.sheet .ho-note', '有點鼻塞，洗澡先跳過');
  await P.click('.sheet .ho-send'); await P.waitForTimeout(400);
  const line = decodeURIComponent(await S(P, () => window.__opened || ''));
  ok('LINE opens with the words and the note (no medicine)', /line\.me\/R\/share/.test(line) && /有點鼻塞/.test(line) && !/退燒/.test(line), line.slice(0, 160));
  await S(P, () => document.querySelector('.sheet .icon-btn[aria-label="關閉"]').click()); await P.waitForTimeout(300);
  await S(P, () => App.navigate('handoff')); await P.waitForTimeout(700);
  ok('the 交接卡 tool opens the same card as a page', /小乖的交接卡/.test(await S(P, () => document.getElementById('view').innerText)) && !!(await P.$('#view .ho-send')));
  ok('交接卡 is a tool', await S(P, () => !!(App.tools || []).find((t) => t.id === 'handoff' && t.screen === 'handoff')));
  ok('sw.js caches it', await S(P, async () => (await (await fetch('sw.js')).text()).includes("'js/modules/handoff.js'")));
  const R = await mk(BASE, { width: 320, height: 568 });
  await S(R, () => App.handoff.open()); await R.waitForTimeout(500);
  ok('320 px: the card fits', await S(R, () => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.ho-row')].every((x) => x.getBoundingClientRect().right <= innerWidth)));

  /* ---------- 3. with 家人共用: mom hands over, dad's phone shows it ---------- */
  if (API_BASE) {
    const cfg = (await axios.get(`${API_BASE}api/config`)).data;
    let n = 0;
    const member = async (nick) => {
      n += 1;
      const r = await axios.post(`${API_BASE}api/auth/register`, { consent: cfg.policy, account: `ho-${RUN}-${n}@example.com`, password: 'baby-sleeps-9', nickname: nick }, { headers: { 'X-Forwarded-For': `10.91.${Math.floor(Math.random() * 250)}.${n}` }, validateStatus: () => true });
      return { token: r.data.token, user: r.data.user };
    };
    const M = await mk(API_BASE, { auth: await member('小美'), clock: false });
    await S(M, () => { App.navigate('family'); }); await M.waitForTimeout(1500);
    await M.click('.fm-agree'); await M.click('.fm-create'); await M.waitForTimeout(2500);
    await S(M, () => App.family.sync());
    const link = await S(M, () => App.family.link());
    const D = await mk(API_BASE, { demo: false, auth: await member('阿弘'), clock: false });
    await S(D, (x) => { location.hash = x; }, `#/family?${link.split('#/family?')[1]}`);
    await D.waitForFunction(() => document.querySelector('.fm-join'), null, { timeout: 8000 }).catch(() => {});
    await D.selectOption('.fm-who', '爸爸'); await D.click('.fm-agree'); await D.click('.fm-join');
    await D.waitForFunction(() => App.store.state.logs.length > 0, null, { timeout: 15000 }).catch(() => {});
    await S(M, () => App.family.sync());
    await S(M, () => { App.navigate('home'); }); await M.waitForTimeout(800);
    await M.click('.next-card .next-handoff'); await M.waitForTimeout(600);
    const fam = await S(M, () => ({ btn: document.querySelector('.sheet .ho-send').innerText, how: document.querySelector('.sheet .ho-how').innerText }));
    ok('with 家人共用: 「交給家人・通知換你囉」, and it says the card is encrypted and the notice only says 換你囉', /交給家人・通知「換你囉」/.test(fam.btn) && /加密傳到家人手機/.test(fam.how), JSON.stringify(fam));
    await M.fill('.sheet .ho-note', '剛餵完右邊，記得拍嗝');
    await M.click('.sheet .ho-send'); await M.waitForTimeout(2500);
    ok('handed over: the card is saved, the family is told, the sheet closes', await S(M, () => (App.store.state.handoffs || []).some((x) => x.note === '剛餵完右邊，記得拍嗝')) && !(await M.$('.sheet .ho-send')) && /交接卡已傳給家人|已通知家人/.test(await toast(M)), await toast(M));
    await S(D, () => App.family.sync()); await S(D, () => { App.navigate('home'); App.refresh(); }); await D.waitForTimeout(1200);
    const ban = await S(D, () => (document.querySelector('.ho-banner') || {}).innerText || '');
    ok('dad\'s 首頁: 「媽媽把寶寶交給你了」 with the time and the note', /媽媽把寶寶交給你了/.test(ban) && /剛餵完右邊，記得拍嗝/.test(ban), ban);
    await shot(D, 'handoff-dad-home');
    await axe(D, 'dad home with the handoff');
    await D.click('.ho-banner .ho-go'); await D.waitForTimeout(600);
    const dsh = await S(D, () => (document.querySelector('.sheet') || {}).innerText || '');
    ok('…which opens the card, mom\'s note on top, and today\'s rows from the shared records', /媽媽交給你的/.test(dsh) && /剛餵完右邊，記得拍嗝/.test(dsh) && /上次餵奶/.test(dsh) && /知道了/.test(dsh), dsh.slice(0, 200));
    await D.click('.sheet .ho-ok'); await D.waitForTimeout(400);
    await S(D, () => App.refresh()); await D.waitForTimeout(500);
    ok('seen: the banner goes away', !(await D.$('.ho-banner')));
    await S(M, () => App.family.sync()); await S(M, () => App.refresh()); await M.waitForTimeout(500);
    ok('mom\'s own handoff is not shown back to her', !(await M.$('.ho-banner')));
  }

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  const pass = results.filter((x) => x.pass).length;
  results.forEach((x) => console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${x.pass ? '' : `  ← ${x.info}`}`));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
