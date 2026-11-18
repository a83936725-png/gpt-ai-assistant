// 資料安全測試：紀錄存得完整（壓縮不掉資料）、用了幾年空間不夠時自動改存手機資料庫（IndexedDB）、
// 存不了時一定會提醒、匯出／匯入（取代、家人合併）不漏資料、壞檔案不會弄壞現有資料、大量資料仍然順。
// Usage: cd mom-app && python3 -m http.server 8080   then   node tests/data-safety.playwright.cjs   [BASE=...]
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const results = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctxs = [];
  const open = async (init) => {
    const ctx = await browser.newContext({ locale: 'zh-TW', viewport: { width: 390, height: 844 }, acceptDownloads: true });
    ctxs.push(ctx);
    await ctx.addInitScript(() => {
      window.__noShareMoments = true;
      // keep every exported backup so the test can read it back
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { window.__lastBlob = blob; return orig(blob); };
    });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.dismiss().catch(() => {}));
    return p;
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const boot = async (p) => {
    await p.goto(BASE);
    await p.waitForFunction(() => window.App && App.screens && App.screens.goods && App.store && !App.store.loading, null, { timeout: 30000 });
    await S(p, () => { App.isNight = () => false; });
  };
  const settle = (p) => p.evaluate(() => App.store.whenSaved()).then(() => p.waitForTimeout(200));
  // a rich state: every kind of record, including notes, edited times, breastfeeding segments
  const RICH = () => {
    App.demo.seed();
    App.store.update((s) => {
      const b = s.babies[0].id; const t = Date.now();
      s.logs.push({ id: 'note1', babyId: b, type: 'bottle', start: new Date(t - 5e6).toISOString(), end: null, data: { kind: 'formula', ml: 95 }, note: '喝得很慢，打了兩次嗝', by: '爸爸', createdAt: new Date(t - 4e6).toISOString() });
      s.logs.push({ id: 'seg1', babyId: b, type: 'breast', start: new Date(t - 9e6).toISOString(), end: new Date(t - 8e6).toISOString(), data: { leftMin: 9, rightMin: 7, lastSide: 'R', segments: [{ side: 'L', start: new Date(t - 9e6).toISOString(), end: new Date(t - 8.5e6).toISOString() }] }, note: '', by: '媽媽', createdAt: new Date(t - 9e6).toISOString() });
      s.logs.push({ id: 'odd1', babyId: b, type: 'temp', start: '2026-01-05T08:00:00+08:00', end: null, data: { c: 37.6, site: '耳溫' }, note: '有點燒', by: '阿嬤', createdAt: '2026-01-05T00:00:00.000Z' });
      s.preg.journal.push({ id: 'j1', at: new Date(t - 3e7).toISOString(), symptoms: ['頭痛'], sys: 118, dia: 76, mood: 4, note: '下午有點累' });
      s.preg.visitNotes.v3 = { weight: 55.2, sys: 110, dia: 70, fhr: 148, note: '醫師說一切正常' };
      s.preg.prenatal.v3 = '2026-06-01';
      s.journey.done['w1-checkin'] = '2026-05-01';
      s.postpartum.log.push({ id: 'pp1', at: new Date(t - 2e7).toISOString(), lochia: { amount: 'm', color: 'dark' }, pain: 3, temp: 36.8, mood: 4, symptoms: [], note: '' });
      s.folic.log['2026-05-02'] = 1;
      s.daily.log['2026-11-01'] = { water: 6 };
    });
  };
  // years of realistic use: per baby per day 8 feeds, 8 diapers, 4 sleeps, 3 pumps, a temperature every 3 days
  const YEARS = ([babies, days]) => {
    const s = App.store.defaults(); s.onboarded = true; s.profile.stage = 'baby'; s.profile.momName = '小美';
    const now = Date.now(); let n = 0;
    for (let bi = 0; bi < babies; bi += 1) {
      const id = `twin${bi}`; s.babies.push({ id, name: ['大寶', '小寶'][bi] || `寶${bi}`, sex: 'girl', birthday: Core.dateKey(new Date(now - days * 864e5)), avatar: '👶' });
      for (let d = 0; d < days; d += 1) {
        const day0 = now - (days - d) * 864e5;
        const add = (type, h, extra) => { n += 1; s.logs.push({ id: `L${n}`, babyId: id, type, start: new Date(day0 + h * 36e5).toISOString(), end: null, data: {}, note: '', by: '媽媽', createdAt: new Date(day0 + h * 36e5).toISOString(), ...extra }); };
        for (let k = 0; k < 8; k += 1) {
          if (k % 2) add('bottle', k * 3, { data: { kind: 'formula', ml: 120 } });
          else add('breast', k * 3, { end: new Date(day0 + (k * 3 + 0.3) * 36e5).toISOString(), data: { leftMin: 10, rightMin: 8, lastSide: 'L' } });
          add('diaper', k * 3 + 1, { data: k % 3 ? { kind: 'wet' } : { kind: 'mixed', poo: { amount: 'm', texture: 'soft', color: 'yellow' } } });
        }
        for (let k = 0; k < 4; k += 1) add('sleep', k * 6 + 2, { end: new Date(day0 + (k * 6 + 3.5) * 36e5).toISOString() });
        for (let k = 0; k < 3; k += 1) add('pump', k * 8, { end: new Date(day0 + (k * 8 + 0.25) * 36e5).toISOString(), data: { durationMin: 15, left: 60, right: 50, ml: 110, stored: true } });
        if (d % 3 === 0) add('temp', 9, { data: { c: 36.8, site: '耳溫' } });
      }
    }
    s.activeBabyId = 'twin0';
    App.store.replace(s);
    return { logs: s.logs.length, plain: JSON.stringify(s).length };
  };
  const snapshot = (p) => S(p, () => JSON.stringify(App.store.state));

  /* ---------- 1. compact saving loses nothing ---------- */
  {
    const p = await open(); await boot(p);
    await S(p, RICH); await settle(p);
    // some screens add their own empty settings the first time they open (待產包, 補助…): let that happen once first
    await p.reload(); await p.waitForFunction(() => window.App && App.store && !App.store.loading); await p.waitForTimeout(300);
    const before = await snapshot(p);
    const sizes = await S(p, () => ({ saved: localStorage.getItem(App.store.KEY).length, plain: JSON.stringify(App.store.state).length }));
    await p.reload(); await p.waitForFunction(() => window.App && App.store && !App.store.loading);
    const after = await snapshot(p);
    ok('every record comes back exactly after closing and reopening (notes, edited times, 親餵 left/right, 身體狀況, 產檢筆記, 產後紀錄, 路線圖)', before === after, before === after ? '' : `${before.length} vs ${after.length}`);
    ok(`saved data is about a third smaller than before (${Math.round((1 - sizes.saved / sizes.plain) * 100)}% smaller)`, sizes.saved < sizes.plain * 0.75, JSON.stringify(sizes));
    // an old-format save (full fields, before this version) still opens unchanged
    await S(p, () => localStorage.setItem(App.store.KEY, JSON.stringify(App.store.state)));
    await p.reload(); await p.waitForFunction(() => window.App && App.store && !App.store.loading);
    ok('data saved by an earlier version opens unchanged', (await snapshot(p)) === before);
  }

  /* ---------- 2. years of records: moves to the phone database by itself, nothing lost ---------- */
  {
    const p = await open(); await boot(p);
    const gen = await S(p, YEARS, [2, 900]); // twins, about 2½ years
    await settle(p);
    const st = await S(p, () => ({ where: App.store.where, health: App.store.health, pointer: localStorage.getItem(App.store.KEY) }));
    ok(`twins, 2½ years (${gen.logs.toLocaleString()} records, ${(gen.plain / 1048576).toFixed(1)} M characters — more than the ~5 M a site may keep): moves to the phone database without a word lost`, st.where === 'idb' && st.health === 'ok' && st.pointer && /__idb/.test(st.pointer) && st.pointer.length < gen.plain * 0.05, JSON.stringify({ ...st, pointer: `${(st.pointer || '').slice(0, 40)}… ${(st.pointer || '').length} chars` }));
    ok('what stays in the small storage is only the newest week (a few % of the whole), as a safety copy', st.pointer.length < 400000, `${st.pointer.length} chars`);
    const t0 = Date.now();
    await p.reload();
    await p.waitForFunction(() => window.App && App.store && !App.store.loading && document.querySelector('#view .qt-main'), null, { timeout: 30000 });
    const loadMs = Date.now() - t0;
    const back = await S(p, () => ({ n: App.store.state.logs.length, screen: document.body.dataset.screen, babies: App.store.state.babies.length }));
    ok(`after reopening: all ${gen.logs.toLocaleString()} records and both babies are back, straight to 首頁 (${(loadMs / 1000).toFixed(1)} s)`, back.n === gen.logs && back.babies === 2 && back.screen === 'home', JSON.stringify(back));
    // keep recording: one tap, close, reopen
    const tap = await S(p, () => { const t = performance.now(); App.babylog.quickLog('diaper'); return Math.round(performance.now() - t); });
    await settle(p);
    await p.reload(); await p.waitForFunction(() => window.App && App.store && !App.store.loading, null, { timeout: 30000 });
    const n2 = await S(p, () => App.store.state.logs.length);
    ok(`a new record after the move is kept too (one-tap log ${tap} ms)`, n2 === gen.logs + 1 && tap < 600, `${n2} vs ${gen.logs + 1}`);
    // with this much data the save follows the screen update by a moment; closing the app right after the tap still keeps it
    await S(p, () => App.babylog.quickLog('diaper'));
    await p.reload(); await p.waitForFunction(() => window.App && App.store && !App.store.loading, null, { timeout: 30000 });
    const n3 = await S(p, () => App.store.state.logs.length);
    ok('tap a record and close the app straight away: it is still there', n3 === gen.logs + 2, `${n3} vs ${gen.logs + 2}`);
    // force the worst case: the database write never finished (roll the database back one step by hand);
    // the newest week kept in the small storage must bring back the new record, an edit and a deletion
    const idbRaw = (op, val) => S(p, ([o, v]) => new Promise((res, rej) => {
      const rq = indexedDB.open('yijia-mom', 1);
      rq.onsuccess = () => { const tx = rq.result.transaction('kv', o === 'get' ? 'readonly' : 'readwrite'); const st = tx.objectStore('kv'); const r = o === 'get' ? st.get(App.store.KEY) : st.put(v, App.store.KEY); tx.oncomplete = () => { rq.result.close(); res(r.result); }; tx.onerror = () => rej(tx.error); };
      rq.onerror = () => rej(rq.error);
    }), [op, val]);
    const older = await idbRaw('get');
    const change = await S(p, () => {
      const recent = App.store.state.logs.filter((l) => l.babyId === 'twin0' && Date.now() - new Date(l.start) < 3 * 864e5);
      const edit = recent[0]; const del = recent[1];
      App.store.updateLog(edit.id, { note: '改過的備註' });
      App.store.removeLog(del.id);
      const added = App.store.addLog({ type: 'bottle', babyId: 'twin0', data: { kind: 'formula', ml: 135 }, note: '最後一筆' });
      // a new record whose time is then set back 10 days (outside the newest week)
      const moved = App.store.addLog({ type: 'diaper', babyId: 'twin0', data: { kind: 'wet' }, note: '補記十天前' });
      App.store.updateLog(moved.id, { start: new Date(Date.now() - 10 * 864e5).toISOString() });
      return { edit: edit.id, del: del.id, moved: moved.id, n: App.store.state.logs.length, added: !!added };
    });
    await settle(p);
    await idbRaw('put', older); // the database is one step behind, as if the app closed mid-write
    await p.reload(); await p.waitForFunction(() => window.App && App.store && !App.store.loading, null, { timeout: 30000 });
    const rec = await S(p, ([e, d, m]) => { const L = App.store.state.logs; const mv = L.find((l) => l.id === m); return { n: L.length, edited: (L.find((l) => l.id === e) || {}).note, deleted: !L.some((l) => l.id === d), last: L.some((l) => l.note === '最後一筆'), moved: !!mv && Date.now() - new Date(mv.start) > 9 * 864e5, dupes: L.length - new Set(L.map((l) => l.id)).size }; }, [change.edit, change.del, change.moved]);
    ok('app closed before the database finished writing: the newest record, an edit, a deletion and a record moved 10 days back all come back right, no duplicates', rec.n === change.n && rec.edited === '改過的備註' && rec.deleted && rec.last && rec.moved && rec.dupes === 0, JSON.stringify(rec));
    const timing = {};
    for (const id of ['home', 'log', 'stats', 'report', 'health', 'growth', 'me']) {
      timing[id] = await S(p, (r) => { const t = performance.now(); location.hash = `#/${r}?${Math.random()}`; return new Promise((res) => setTimeout(() => res(Math.round(performance.now() - t)), 0)); }, id);
    }
    ok('with 2½ years of twins every screen still opens quickly (< 1.5 s on this machine)', Object.values(timing).every((ms) => ms < 1500), JSON.stringify(timing));
    const line = await S(p, () => (document.querySelector('.storage-line') || {}).textContent || '');
    ok('我的 shows how much is saved and where, and when the last backup was', /紀錄 [\d,]+ 筆・存在手機的資料庫/.test(line) && /還沒匯出過備份/.test(line), line);
  }

  /* ---------- 3. a save that cannot be kept anywhere is never silent ---------- */
  {
    const p = await open(() => {
      // phone completely full: localStorage refuses and the database cannot open
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (window.__full && String(v).length > 50) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return real.call(this, k, v); };
      const realOpen = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...a) { if (window.__full) throw new Error('no space'); return realOpen.apply(this, a); };
    });
    await boot(p);
    await S(p, () => App.demo.seed()); await settle(p);
    const n0 = await S(p, () => App.store.state.logs.length);
    await S(p, () => { window.__full = true; location.hash = '#/home?f=1'; });
    await p.waitForTimeout(300);
    await S(p, () => App.babylog.quickLog('diaper'));
    await p.waitForFunction(() => App.store.health === 'failed', null, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(400);
    const r = await S(p, () => ({ health: App.store.health, n: App.store.state.logs.length, toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '), card: !!document.querySelector('[data-card="storage-alert"] .storage-alert'), onTop: (() => { const c = document.querySelector('.storage-alert'); const t = document.querySelector('.qt-main'); return !!c && !!t && c.getBoundingClientRect().top < t.getBoundingClientRect().top; })() }));
    ok('phone full: says so right away (message with 匯出備份) instead of silently dropping the record', r.health === 'failed' && /手機空間不足/.test(r.toast) && /匯出備份/.test(r.toast), JSON.stringify(r));
    ok('phone full: a red card stays at the top of 首頁 (above the record buttons) until it is solved, and the record is still on screen', r.card && r.onTop && r.n === n0 + 1, JSON.stringify(r));
    await S(p, () => { location.hash = '#/me'; }); await p.waitForTimeout(300);
    ok('phone full: 我的 shows the same warning with a backup button', await p.isVisible('.storage-alert >> text=立刻匯出備份'));
    await S(p, () => { window.__full = false; App.store.update(() => {}); }); await p.waitForTimeout(300);
    await S(p, () => { location.hash = '#/home?f=2'; }); await p.waitForTimeout(300);
    ok('once there is room again the next save succeeds and the warning goes away', (await S(p, () => App.store.health)) === 'ok' && !(await p.isVisible('.storage-alert')));
  }

  /* ---------- 4. backup: export, then replace on a new phone — identical ---------- */
  let backupText = null; let richState = null;
  {
    const p = await open(); await boot(p);
    await S(p, RICH); await settle(p);
    richState = JSON.parse(await snapshot(p));
    await S(p, () => { location.hash = '#/me'; }); await p.waitForTimeout(300);
    await p.click('text=匯出備份');
    await p.waitForTimeout(300);
    backupText = await S(p, () => window.__lastBlob.text());
    const after = await S(p, () => ({ last: App.store.state.settings.lastBackupAt, line: document.querySelector('.storage-line').textContent }));
    ok('匯出備份 remembers the date: 我的 now says 今天匯出過備份', !!after.last && /今天匯出過備份/.test(after.line), after.line);

    const q = await open(); await boot(q); // a brand-new phone
    await S(q, () => App.me.importData()); await q.waitForTimeout(300);
    await q.click('.sheet .seg button:has-text("整個取代")');
    await q.setInputFiles('.sheet input[type=file]', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
    await q.waitForTimeout(400);
    await q.click('.sheet button:has-text("確定")').catch(() => {});
    await q.waitForTimeout(500);
    const got = JSON.parse(await snapshot(q));
    const strip = (s) => { const o = JSON.parse(JSON.stringify(s)); delete o.share; delete o.auth; delete o.settings.lastBackupAt; return JSON.stringify(o); };
    ok('backup → new phone (整個取代): everything identical — babies, records, notes, 產檢, 產後, 路線圖, settings', strip(got) === strip(richState), strip(got).length + ' vs ' + strip(richState).length);
  }

  /* ---------- 5. family merge: nothing of hers is left behind ---------- */
  {
    // dad's brand-new phone merges mom's backup
    const q = await open(); await boot(q);
    await S(q, () => App.me.importData()); await q.waitForTimeout(300);
    await q.setInputFiles('.sheet input[type=file]', { name: 'mom.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
    await q.waitForTimeout(500);
    const d = await S(q, () => { const s = App.store.state; return { stage: s.profile.stage, edd: s.profile.edd, member: s.profile.member, journal: s.preg.journal.length, visit: !!s.preg.visitNotes.v3, pp: s.postpartum.log.length, ppStart: s.postpartum.start, journey: Object.keys(s.journey.done).length, folic: Object.keys(s.folic.log).length, daily: Object.keys(s.daily.log).length, logs: s.logs.length, onboarded: s.onboarded }; });
    const m = richState;
    ok('家人合併 on a new phone: her stage, 預產期, 身體狀況日記, 產檢筆記, 產後紀錄, 路線圖 and 葉酸 all arrive', d.stage === m.profile.stage && d.edd === m.profile.edd && d.journal === m.preg.journal.length && d.visit && d.pp === m.postpartum.log.length && d.ppStart === m.postpartum.start && d.journey === Object.keys(m.journey.done).length && d.folic >= 1 && d.daily >= 1 && d.logs === m.logs.length && d.onboarded, JSON.stringify(d));
    ok('家人合併 keeps who records on this phone (not copied from hers)', d.member === '媽媽');
    // grandma's phone already has its own records and settings
    const g = await open(); await boot(g);
    await S(g, () => {
      const s = App.store.defaults(); s.onboarded = true; s.profile.stage = 'baby'; s.profile.momName = '阿嬤家'; s.profile.member = '阿嬤';
      s.babies = [{ id: 'demo-baby', name: '小乖', sex: 'girl', birthday: Core.dateKey(Core.addDays(new Date(), -75)), avatar: '👧' }]; s.activeBabyId = 'demo-baby';
      s.logs = [{ id: 'gm1', babyId: 'demo-baby', type: 'diaper', start: new Date().toISOString(), end: null, data: { kind: 'wet' }, note: '', by: '阿嬤', createdAt: new Date().toISOString() }];
      s.preg.journal = [{ id: 'gj', at: new Date().toISOString(), symptoms: [], mood: 3, note: '' }];
      App.store.replace(s);
    });
    await S(g, () => App.me.importData()); await g.waitForTimeout(300);
    await g.setInputFiles('.sheet input[type=file]', { name: 'mom.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
    await g.waitForTimeout(500);
    const gm = await S(g, () => { const s = App.store.state; return { name: s.profile.momName, member: s.profile.member, mine: s.logs.some((l) => l.id === 'gm1'), hers: s.logs.some((l) => l.id === 'note1'), journal: s.preg.journal.length }; });
    ok('家人合併 on a phone with its own records: both sides kept, its own name and settings unchanged', gm.name === '阿嬤家' && gm.member === '阿嬤' && gm.mine && gm.hers && gm.journal === m.preg.journal.length + 1, JSON.stringify(gm));
  }

  /* ---------- 6. a bad file never harms what is there ---------- */
  {
    const p = await open(); await boot(p);
    await S(p, RICH); await settle(p);
    const before = await snapshot(p);
    for (const [name, text] of [['broken.json', '{"data": {"logs": [1,2'], ['notes.json', '{"hello":"world"}'], ['photo.json', 'GIF89a……']]) {
      await S(p, () => App.me.importData()); await p.waitForTimeout(300);
      await p.click('.sheet .seg button:has-text("整個取代")');
      await p.setInputFiles('.sheet input[type=file]', { name, mimeType: 'application/json', buffer: Buffer.from(text) });
      await p.waitForTimeout(400);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    }
    ok('wrong or broken backup files (even with 整個取代 chosen): told 檔案格式不正確, nothing changed', (await snapshot(p)) === before);
  }

  ok('no page errors anywhere', !errors.length, errors.slice(0, 4).join(' | '));
  console.log('\n=== 資料安全 ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await Promise.all(ctxs.map((c) => c.close().catch(() => {})));
  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
