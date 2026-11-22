/* 易家做媽媽 — 家人共用紀錄: the family's phones share the baby's records, end-to-end encrypted.
 * A family key is made on the phone (32 random bytes). HKDF turns it into an AES-GCM key (the records) and an HMAC key
 * (record names, so the server cannot tell a feed from a diaper). The key travels only in the invite link after #, which
 * is never sent to a server; the member server keeps ciphertext it cannot read and hands out changes in order.
 * Shared: 寶寶資料 (not the photo), every log, 成長, 疫苗、健檢、發展里程碑, 母乳庫存. Not shared: pregnancy records,
 * 產檢日記, 月照 photos, her own health, settings.
 * Sync: push what changed since the last sync (a quick hash per record), then pull what others changed, in the order the
 * server received it (the last change wins). Deletions are sent only for records this phone itself synced before (an
 * `epoch` ties that memory to this copy of the data, so a restored backup or sample data never deletes family records).
 *   screen 'family' (params {j: 'familyId.inviteToken', k: key} from an invite link)
 *   App.family = { active, sync, link, rebase, status, encrypt, decrypt, ridOf, TYPES } */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const B = () => window.BRAND || {};
  const te = new TextEncoder(); const td = new TextDecoder();
  const CHECK = 'yijia-family-check-v1';
  const META = 'yijia-family-sync';
  const PENDING = 'yijia-family-join';
  const MAX_D = 15000;
  const META_ID = 'meta'; // what names and the key check are bound to (they exist before the family has an id)
  const subtle = () => (window.crypto && window.crypto.subtle) || null;

  /* ---------------- bytes ---------------- */
  const toB64 = (buf) => { let s = ''; new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64 = (str) => { const s = String(str).replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(s + '='.repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  const hash53 = (str) => { // a quick fingerprint to see what changed (not for security)
    let h1 = 0xdeadbeef; let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i += 1) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };

  /* ---------------- keys and encryption ---------------- */
  let kc = { raw: null, aes: null, mac: null };
  async function keysOf(raw) {
    if (kc.raw === raw) return kc;
    const base = await subtle().importKey('raw', fromB64(raw), 'HKDF', false, ['deriveKey']);
    const salt = te.encode('yijia-family-v1');
    const aes = await subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('records') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const mac = await subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('names') }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    kc = { raw, aes, mac };
    return kc;
  }
  const newKey = () => toB64(crypto.getRandomValues(new Uint8Array(32)));
  async function encrypt(obj, key, fid, rid) {
    const { aes } = await keysOf(key);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(`${fid}|${rid}`) }, aes, te.encode(JSON.stringify(obj)));
    const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
    return toB64(out);
  }
  async function decrypt(str, key, fid, rid) {
    try {
      const { aes } = await keysOf(key);
      const all = fromB64(str);
      const pt = await subtle().decrypt({ name: 'AES-GCM', iv: all.slice(0, 12), additionalData: te.encode(`${fid}|${rid}`) }, aes, all.slice(12));
      return JSON.parse(td.decode(pt));
    } catch (e) { return null; } // a wrong key, or something changed on the way
  }
  const ridCache = new Map();
  async function ridOf(key, type, id) {
    const k = `${key.slice(0, 8)}|${type}:${id}`;
    if (ridCache.has(k)) return ridCache.get(k);
    const { mac } = await keysOf(key);
    const r = toB64(await subtle().sign('HMAC', mac, te.encode(`${type}:${id}`))).slice(0, 22);
    ridCache.set(k, r);
    return r;
  }

  /* ---------------- what is shared ---------------- */
  const byId = (list) => (list || []).filter((x) => x && x.id).map((x) => [x.id, x]);
  const perBaby = (o) => Object.entries(o || {});
  const TYPES = {
    baby: { get: (s) => byId(s.babies).map(([id, b]) => [id, { ...b, photo: undefined }]) },
    log: { get: (s) => byId(s.logs) },
    growth: { get: (s) => byId(s.growth) },
    milk: { get: (s) => byId(s.milk) },
    ms: { get: (s) => perBaby(s.milestones) },
    vac: { get: (s) => perBaby(s.vaccines) },
    chk: { get: (s) => perBaby(s.checkups) },
  };
  const LIST = { baby: 'babies', log: 'logs', growth: 'growth', milk: 'milk' };
  const MAP = { ms: 'milestones', vac: 'vaccines', chk: 'checkups' };

  /* ---------------- sync memory (this phone only, tied to this copy of the data) ---------------- */
  const fam = () => store.state.family || null;
  const active = () => { const f = fam(); return !!(f && f.id && f.key && store.state.auth && subtle()); };
  function meta() {
    const f = fam(); if (!f) return null;
    let m = null;
    try { m = JSON.parse(localStorage.getItem(META) || 'null'); } catch (e) { m = null; }
    if (!m || m.fid !== f.id || m.epoch !== f.epoch) m = { fid: f.id, epoch: f.epoch, seq: 0, known: {}, at: null }; // nothing synced from this copy yet: a merge, never a deletion
    return m;
  }
  const saveMeta = (m) => { try { localStorage.setItem(META, JSON.stringify(m)); } catch (e) { /* full: it will merge again */ } };
  // a restored backup, or anything else that swaps the data: the next sync merges (no deletions from old memory)
  function rebase() { store.update((s) => { if (s.family) s.family.epoch = C.uid(); }); }

  let applying = false;
  // the records here now: [{type, id, val, json}]
  function current() {
    const s = store.state; const out = [];
    Object.entries(TYPES).forEach(([type, d]) => d.get(s).forEach(([id, val]) => { const json = JSON.stringify(val); out.push({ type, id, val, json }); }));
    return out;
  }
  function apply(recs, m) {
    if (!recs.length) return 0;
    applying = true;
    try {
      store.update((s) => {
        recs.forEach((r) => {
          if (r.del) {
            const where = m.where[r.rid];
            if (!where) return;
            if (LIST[where.type]) s[LIST[where.type]] = (s[LIST[where.type]] || []).filter((x) => x.id !== where.id);
            else if (MAP[where.type] && s[MAP[where.type]]) delete s[MAP[where.type]][where.id];
            if (where.type === 'baby' && s.activeBabyId === where.id) s.activeBabyId = (s.babies[0] && s.babies[0].id) || null;
            return;
          }
          if (LIST[r.t]) {
            const k = LIST[r.t]; s[k] = s[k] || [];
            const i = s[k].findIndex((x) => x.id === r.id);
            const val = r.t === 'baby' && i >= 0 && s[k][i].photo ? { ...r.v, photo: s[k][i].photo } : r.v; // her own photo of the baby stays
            if (i >= 0) s[k][i] = val; else s[k].push(val);
            if (r.t === 'baby' && !s.activeBabyId) s.activeBabyId = r.id;
            if (r.t === 'log') s.logs.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)); // eslint-disable-line no-nested-ternary
          } else if (MAP[r.t]) { s[MAP[r.t]] = s[MAP[r.t]] || {}; s[MAP[r.t]][r.id] = r.v; }
        });
        if (s.babies.length && s.profile.stage !== 'baby' && recs.some((r) => r.t === 'baby')) s.profile.stage = 'baby'; // a family with a baby: this phone shows the baby too
        if (!s.onboarded && s.babies.length) s.onboarded = true;
      });
    } finally { applying = false; }
    return recs.length;
  }

  let busy = null;
  const call = (method, path, body) => App.account.call(method, path, body);
  async function syncNow() {
    const f = fam(); const m = meta();
    m.where = {};
    // 1. what changed here goes up first (so it is newer than anything pulled in the same round)
    const cur = current();
    await Promise.all(cur.map(async (r) => { r.rid = await ridOf(f.key, r.type, r.id); m.where[r.rid] = { type: r.type, id: r.id }; }));
    const seen = new Set();
    const ups = [];
    cur.forEach((r) => { seen.add(r.rid); const hsh = hash53(r.json); if (m.known[r.rid] !== hsh) ups.push({ rid: r.rid, r, hsh }); });
    Object.keys(m.known).forEach((rid) => { if (!seen.has(rid)) ups.push({ rid, del: true }); });
    status.pending = ups.length;
    // in batches of at most 150 records and about 400 KB
    let i = 0;
    while (i < ups.length) {
      const changes = []; const sentNow = []; let bytes = 0;
      while (i < ups.length && changes.length < 150 && bytes < 400000) {
        const u = ups[i]; i += 1;
        if (u.del) { changes.push({ r: u.rid, x: true }); sentNow.push(u); bytes += 40; } else {
          const d = await encrypt({ t: u.r.type, id: u.r.id, v: u.r.val }, f.key, f.id, u.rid); // eslint-disable-line no-await-in-loop
          if (d.length <= MAX_D) { changes.push({ r: u.rid, d }); sentNow.push(u); bytes += d.length + 40; } else m.known[u.rid] = u.hsh; // too big to share (kept on this phone)
        }
      }
      if (changes.length) await call('POST', 'family/push', { changes }); // eslint-disable-line no-await-in-loop
      sentNow.forEach((u) => { if (u.del) delete m.known[u.rid]; else m.known[u.rid] = u.hsh; });
      status.pending = ups.length - i; paintStatus();
      saveMeta(m);
    }
    // 2. what the others changed comes down, oldest first
    let more = true; let got = 0;
    while (more) {
      const r = await call('GET', `family/pull?since=${m.seq}&limit=300`); // eslint-disable-line no-await-in-loop
      const recs = [];
      for (const c of r.changes) { // eslint-disable-line no-restricted-syntax
        if (c.x) { if (m.known[c.r] !== undefined || m.where[c.r]) recs.push({ rid: c.r, del: true }); } else {
          const v = await decrypt(c.d, f.key, f.id, c.r); // eslint-disable-line no-await-in-loop
          if (v && TYPES[v.t] && v.id != null && v.v && typeof v.v === 'object') {
            const json = JSON.stringify(v.t === 'baby' ? { ...v.v, photo: undefined } : v.v);
            if (m.known[c.r] !== hash53(json)) recs.push({ rid: c.r, t: v.t, id: v.id, v: v.v }); // (my own changes come back too)
            m.known[c.r] = hash53(json); m.where[c.r] = { type: v.t, id: v.id };
          }
        }
      }
      recs.filter((x) => x.del).forEach((x) => { delete m.known[x.rid]; });
      got += apply(recs, m);
      m.seq = r.changes.length ? r.changes[r.changes.length - 1].s : Math.max(m.seq, r.seq || 0);
      more = !!r.more;
      saveMeta(m);
    }
    m.at = new Date().toISOString(); delete m.where; saveMeta(m);
    return got;
  }
  // one sync at a time; a request while one runs waits for the next round
  async function sync({ quiet = true } = {}) {
    if (!active()) return null;
    if (busy) { busy.again = true; return busy.p; }
    busy = { again: false };
    status.state = 'syncing'; paintStatus();
    busy.p = (async () => {
      let got = 0;
      try {
        got = await syncNow();
        status.state = 'ok'; status.error = '';
        if (got && !quiet) ui.toast(`已更新家人的 ${got} 筆紀錄`);
      } catch (e) {
        if (e && e.status === 404 && e.code === 'no_family') {
          store.update((s) => { s.family = null; });
          ui.toast('你已經不在這個家庭的共用紀錄了（手機上的紀錄都還在）');
          status.state = 'off';
        } else { status.state = 'error'; status.error = e && e.code === 'offline' ? '離線中' : '暫時連不上，稍後會再試'; }
      }
      const again = busy.again; busy = null; paintStatus();
      if (again) setTimeout(() => sync(), 300);
      return got;
    })();
    return busy.p;
  }
  const status = { state: 'idle', pending: 0, error: '' };
  let statusEl = null;
  function paintStatus() {
    if (!statusEl || !statusEl.isConnected) return;
    const m = meta();
    const when = m && m.at ? C.fmtAgo ? C.fmtAgo(m.at) : C.fmtTime(new Date(m.at)) : '';
    statusEl.textContent = status.state === 'syncing' ? `同步中…${status.pending ? `（還有 ${status.pending} 筆）` : ''}`
      : status.state === 'error' ? `⚠️ ${status.error}` : m && m.at ? `✓ 已同步・${when}` : '尚未同步'; // eslint-disable-line no-nested-ternary
    statusEl.dataset.state = status.state;
  }
  // when to sync: after a change here (a few seconds later), every 30 s while open, when the app comes back
  let changeT = 0;
  store.subscribe(() => {
    if (applying || !active()) return;
    clearTimeout(changeT); changeT = setTimeout(() => sync(), 2500);
  });
  setInterval(() => { if (document.visibilityState === 'visible' && active()) sync(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && active()) sync(); });

  /* ---------------- the invite link ---------------- */
  const appBase = () => (B().appUrl || location.href.split(/[?#]/)[0]).replace(/#.*$/, '');
  async function link() {
    const f = fam(); if (!f) return '';
    let inv = f.invite;
    if (!inv || !inv.token || inv.until < Date.now() + 3600e3) {
      inv = (await call('POST', 'family/invite')).invite;
      store.update((s) => { if (s.family) s.family.invite = inv; });
    }
    return `${appBase()}#/family?${encodeURIComponent(JSON.stringify({ j: `${f.id}.${inv.token}`, k: f.key }))}`;
  }
  const parseInvite = (p) => {
    const [fid, token] = String((p && p.j) || '').split('.');
    const key = String((p && p.k) || '');
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(fid || '') || !/^[A-Za-z0-9_-]{10,64}$/.test(token || '') || !/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
    return { fid, token, key };
  };
  const pendingJoin = () => { try { return JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch (e) { return null; } };
  const setPending = (v) => { try { if (v) sessionStorage.setItem(PENDING, JSON.stringify(v)); else sessionStorage.removeItem(PENDING); } catch (e) { /* private mode */ } };
  // after logging in, an invite opened before goes on
  store.subscribe(() => { const p = pendingJoin(); if (p && store.state.auth && !/^#\/family/.test(location.hash)) { App.navigate('family', p); } });

  /* ---------------- the screen ---------------- */
  const MEMBERS = ['媽媽', '爸爸', '阿嬤', '阿公', '外婆', '外公', '保母', '其他'];
  const SHARED = '寶寶資料、所有日常紀錄（餵奶、尿布、睡眠、擠奶…）、成長、疫苗與健檢、發展里程碑、母乳庫存';
  const NOT_SHARED = '懷孕紀錄、產檢日記、月照照片、你自己的健康紀錄和設定';
  const ownRecords = () => (store.state.logs || []).length + (store.state.babies || []).length + (store.state.growth || []).length;
  const consentBox = (ok) => {
    const cb = h('input', { type: 'checkbox', class: 'fm-consent' });
    cb.addEventListener('change', () => ok(cb.checked));
    return h('label', { class: 'check-row fm-agree' }, cb, h('span', { class: 'small' }, `我了解：共用的紀錄（${SHARED}）會在手機上加密後存到伺服器，只有家人手機上的金鑰能打開，伺服器看不到內容。邀請連結就是鑰匙，只傳給家人。`));
  };
  const whoSelect = () => h('select', { class: 'input fm-who', 'aria-label': '你是寶寶的' }, MEMBERS.map((m) => h('option', { value: m, selected: m === (store.state.profile.member || '媽媽') }, m)));
  const labelOf = async (key, enc) => { const v = enc ? await decrypt(enc, key, META_ID, 'label') : null; return (v && v.name) || '家人'; };

  async function renderJoin(el, inv) {
    el.append(h('p', { class: 'center muted mt-lg', role: 'status' }, '讀取邀請…'));
    if (!store.state.auth) {
      setPending({ j: `${inv.fid}.${inv.token}`, k: inv.key });
      el.innerHTML = '';
      el.append(ui.card({ class: 'fm-card center' }, h('div', { class: 'fm-ico', 'aria-hidden': 'true' }, '👨‍👩‍👧'), h('h2', { class: 'fm-h' }, '家人邀請你一起記錄寶寶'),
        h('p', { class: 'small muted' }, '登入或註冊會員（免費）後就能加入，你們的紀錄會加密同步到彼此的手機。'),
        h('button', { class: 'btn btn-primary btn-block mt', onclick: () => App.navigate('login') }, '登入／註冊後加入')));
      return;
    }
    let pv = null; let err = '';
    try { pv = await call('GET', `family/preview?f=${encodeURIComponent(inv.fid)}&t=${encodeURIComponent(inv.token)}`); } catch (e) { err = e && e.status === 404 ? '這個邀請連結已經失效（超過 7 天，或已經換了新的連結），請家人再傳一次。' : '暫時連不上會員服務，請稍後再試。'; }
    const checkOk = pv && (await decrypt(pv.check, inv.key, META_ID, 'check')) === CHECK;
    el.innerHTML = '';
    if (!err && pv && !checkOk) err = '這個連結不完整（可能被截斷了），請家人用「LINE 傳送」或「複製連結」再傳一次。';
    if (!err && pv && pv.inOther) err = '你已經在另一個家庭的共用紀錄裡，要先在「家人共用紀錄」離開，才能加入這一個。';
    if (!err && pv && pv.full && !pv.already) err = '這個家庭已經有 8 位家人了。';
    if (err) { setPending(null); el.append(ui.card({ class: 'fm-card' }, h('p', { role: 'alert' }, err), h('button', { class: 'btn btn-soft btn-block mt', onclick: () => App.navigate('family') }, '回家人共用紀錄'))); return; }
    const owner = await labelOf(inv.key, pv.ownerLabel);
    if (pv.already && fam() && fam().id === inv.fid) { setPending(null); history.replaceState(null, '', '#/family'); App.refresh(); return; }
    const who = whoSelect();
    const hasOwn = ownRecords() > 0 && !store.state.sampleData;
    let mode = 'theirs';
    const modeSeg = hasOwn ? ui.seg([{ value: 'theirs', label: '用家人的紀錄' }, { value: 'merge', label: '兩邊合併' }], mode, (v) => { mode = v; }, { small: true }) : null;
    const go = h('button', { class: 'btn btn-primary btn-block mt fm-join', disabled: true }, '加入，一起記錄');
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        if (hasOwn && mode === 'theirs') {
          if (App.me && App.me.exportData) await App.me.exportData(); // her own records first go into a backup file
        }
        const label = await encrypt({ name: who.value }, inv.key, META_ID, 'label');
        const r = await call('POST', 'family/join', { f: inv.fid, t: inv.token, label });
        store.update((s) => {
          s.profile.member = who.value;
          s.family = {
            id: inv.fid, key: inv.key, role: 'member', joinedAt: new Date().toISOString(), epoch: C.uid(), consentAt: new Date().toISOString(), members: r.family.members.length,
          };
          if (hasOwn && mode === 'theirs') { s.babies = []; s.logs = []; s.growth = []; s.milk = []; s.milestones = {}; s.vaccines = {}; s.checkups = {}; s.activeBabyId = null; }
          if (s.sampleData) { s.babies = []; s.logs = []; s.growth = []; s.milk = []; s.milestones = {}; s.vaccines = {}; s.checkups = {}; s.activeBabyId = null; s.sampleData = false; } // sample data is never shared
        });
        setPending(null);
        history.replaceState(null, '', '#/family'); // the key leaves the address bar
        ui.toast('已加入家人共用紀錄 💜 正在同步…');
        ui.celebrate({ from: go, emojis: ['💜', '👨‍👩‍👧', '✨'] });
        App.refresh();
        const got = await sync();
        if (got != null) ui.toast(`同步完成，收到 ${got} 筆紀錄`);
      } catch (e) { go.disabled = false; ui.toast(e && e.code === 'in_family' ? '你已經在另一個家庭了' : e && e.code === 'full' ? '這個家庭已經滿 8 位了' : '加入失敗，請稍後再試'); } // eslint-disable-line no-nested-ternary
    });
    el.append(ui.card({ class: 'fm-card' },
      h('div', { class: 'fm-ico', 'aria-hidden': 'true' }, '👨‍👩‍👧'),
      h('h2', { class: 'fm-h' }, `${owner}邀請你一起記錄`),
      h('p', { class: 'small muted' }, `這個家庭現在有 ${pv.members} 位家人。加入後，你們手機上的寶寶紀錄會自動同步。`),
      h('div', { class: 'fm-lbl small bold' }, '你是寶寶的'), who,
      hasOwn ? h('div', { class: 'fm-lbl small bold' }, '這支手機原本的紀錄') : null, modeSeg,
      hasOwn ? h('p', { class: 'tiny muted' }, '「用家人的紀錄」：原本的寶寶和紀錄會先下載成備份檔，再換成家人的。「兩邊合併」：兩邊的都保留（同一個寶寶可能出現兩次）。') : null,
      consentBox((v) => { go.disabled = !v; }),
      go,
      h('p', { class: 'tiny faint mt' }, `會同步：${SHARED}。不會同步：${NOT_SHARED}。`)));
  }

  function renderIntro(el) {
    const who = whoSelect();
    const go = h('button', { class: 'btn btn-primary btn-block mt fm-create', disabled: true }, '建立家人共用紀錄');
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        const key = newKey();
        // names and the key check are made before the family has an id: they are bound to 'meta' (records to the family)
        const r = await call('POST', 'family/create', { label: await encrypt({ name: who.value }, key, META_ID, 'label'), check: await encrypt(CHECK, key, META_ID, 'check') });
        store.update((s) => {
          s.profile.member = who.value;
          s.family = {
            id: r.family.id, key, role: 'owner', joinedAt: new Date().toISOString(), epoch: C.uid(), consentAt: new Date().toISOString(), invite: r.invite, members: 1,
          };
        });
        ui.toast('已建立 💜 現在邀請家人吧');
        App.refresh();
        sync();
      } catch (e) { go.disabled = false; ui.toast(e && e.code === 'in_family' ? '你已經在一個家庭裡了' : '建立失敗，請稍後再試'); }
    });
    el.append(ui.card({ class: 'fm-card' },
      h('div', { class: 'fm-ico', 'aria-hidden': 'true' }, '👨‍👩‍👧'),
      h('h2', { class: 'fm-h' }, '家人共用紀錄'),
      h('p', { class: 'small' }, '爸爸、阿嬤也能在自己的手機上記錄和查看：誰餵了奶、換了尿布、睡多久，大家都看得到，不用再傳訊息問。'),
      h('ul', { class: 'fm-points small' },
        h('li', null, '🔒 紀錄在手機上先加密，伺服器只存看不懂的密文'),
        h('li', null, '🔑 鑰匙只在邀請連結裡，只傳給家人'),
        h('li', null, '👀 會同步：', SHARED),
        h('li', null, '🙈 不會同步：', NOT_SHARED)),
      h('div', { class: 'fm-lbl small bold' }, '你是寶寶的'), who,
      consentBox((v) => { go.disabled = !v; }),
      go));
  }

  async function renderFamily(el) {
    const f = fam();
    statusEl = h('p', { class: 'small fm-status', role: 'status' });
    let view = null; let err = '';
    try { view = (await call('GET', 'family')).family; } catch (e) { err = '暫時連不上會員服務，顯示的是這支手機上的資料。'; }
    if (!err && !view) { store.update((s) => { s.family = null; }); ui.toast('這個家庭的共用紀錄已經結束了（手機上的紀錄都還在）'); App.refresh(); return; }
    const members = view ? await Promise.all(view.members.map(async (m) => ({ ...m, name: await labelOf(f.key, m.label) }))) : [];
    const owner = view ? view.owner : f.role === 'owner';
    if (view && f.members !== members.length) store.update((s) => { if (s.family) s.family.members = members.length; });
    el.append(ui.card({ class: 'fm-card fm-top' },
      h('div', { class: 'row gap' }, h('span', { class: 'fm-ico sm', 'aria-hidden': 'true' }, '👨‍👩‍👧'),
        h('div', { class: 'grow' }, h('div', { class: 'bold' }, '家人共用紀錄'), statusEl)),
      h('button', { class: 'btn btn-sm btn-soft mt fm-sync', onclick: () => sync({ quiet: false }) }, '🔄 立即同步'),
      err ? h('p', { class: 'small fm-err' }, err) : null));
    paintStatus();
    if (members.length) {
      el.append(h('div', { class: 'section-title' }, h('span', null, `家人（${members.length}）`)));
      el.append(h('div', { class: 'list fm-members' }, members.map((m) => h('div', { class: 'list-item fm-member' },
        h('span', { class: 'li-icon', 'aria-hidden': 'true' }, m.role === 'owner' ? '👑' : '💜'),
        h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, m.name, m.me ? h('span', { class: 'tag primary' }, '你') : null, m.role === 'owner' ? h('span', { class: 'tag' }, '建立者') : null),
          h('div', { class: 'li-sub' }, `${C.fmtDate(new Date(m.at))} 加入`)),
        owner && !m.me ? h('button', {
          class: 'btn btn-sm btn-ghost fm-remove',
          onclick: async () => {
            if (!(await ui.confirm(`把「${m.name}」移出家人共用紀錄？對方手機上的紀錄會留著，但不會再同步。`, { ok: '移出', danger: true }))) return;
            try { await call('POST', 'family/remove', { member: m.mid }); store.update((s) => { if (s.family) s.family.invite = null; }); ui.toast('已移出，舊的邀請連結也失效了'); App.refresh(); } catch (e) { ui.toast('沒有成功，請稍後再試'); }
          },
        }, '移出') : null))));
    }
    // inviting
    const shareText = (url) => `${store.state.profile.member || '我'}邀請你一起用「${B().appName || '易家做媽媽'}」記錄寶寶 💜\n點連結加入我們的共用紀錄（只傳給家人喔）：\n${url}`;
    const qrBox = h('div', { class: 'fm-qr' });
    el.append(ui.card({ class: 'fm-card fm-invite' },
      h('div', { class: 'card-title' }, '邀請家人'),
      h('p', { class: 'small muted' }, '連結 7 天內有效。這個連結可以打開你們的紀錄，只傳給家人。'),
      h('div', { class: 'grid-2' },
        h('button', {
          class: 'btn btn-line fm-line', html: `${ui.ICONS.line}<span>LINE 傳送</span>`, 'aria-label': '用 LINE 傳邀請連結給家人',
          onclick: async () => { try { const url = await link(); window.open(`https://line.me/R/share?text=${encodeURIComponent(shareText(url))}`, '_blank', 'noopener'); } catch (e) { ui.toast('暫時拿不到邀請連結，請稍後再試'); } },
        }),
        h('button', {
          class: 'btn btn-soft fm-copy',
          onclick: async () => { try { const url = await link(); if (App.share && App.share.copyText) await App.share.copyText(shareText(url)); else await navigator.clipboard.writeText(shareText(url)); ui.toast('已複製邀請連結'); } catch (e) { ui.toast('複製失敗，請稍後再試'); } },
        }, '複製連結')),
      h('button', {
        class: 'link-btn small fm-showqr',
        onclick: async () => { try { const url = await link(); qrBox.innerHTML = ''; const src = App.share && App.share.qr ? App.share.qr(url, 240) : ''; if (src) qrBox.append(h('img', { src, alt: '邀請家人的 QR code', width: 200, height: 200 }), h('p', { class: 'tiny muted' }, '用家人的手機相機掃描')); } catch (e) { ui.toast('暫時拿不到邀請連結'); } },
      }, '顯示 QR code（家人就在旁邊時）'),
      qrBox));
    el.append(ui.card({ class: 'fm-card soft' },
      h('p', { class: 'small' }, h('b', null, '會同步：'), SHARED),
      h('p', { class: 'small' }, h('b', null, '不會同步：'), NOT_SHARED),
      h('p', { class: 'tiny muted' }, '🔒 紀錄在手機上加密（AES-GCM），金鑰只在家人的手機和邀請連結裡；伺服器只存密文和「誰在哪個家庭」。')));
    el.append(h('button', {
      class: 'btn btn-ghost btn-block mt fm-leave',
      onclick: async () => {
        const msg = owner ? '結束家人共用紀錄？伺服器上的共用資料會刪除、所有家人都不會再同步；每個人手機上的紀錄都還在。' : '離開家人共用紀錄？這支手機上的紀錄會留著，但不會再同步。';
        if (!(await ui.confirm(msg, { ok: owner ? '結束共用' : '離開', danger: true }))) return;
        try { await call('POST', 'family/leave'); } catch (e) { if (!(e && e.code === 'no_family')) { ui.toast('沒有成功，請稍後再試'); return; } }
        store.update((s) => { s.family = null; });
        try { localStorage.removeItem(META); } catch (e) { /* fine */ }
        ui.toast(owner ? '已結束家人共用紀錄' : '已離開家人共用紀錄');
        App.refresh();
      },
    }, owner ? '結束家人共用紀錄' : '離開家人共用紀錄'));
  }

  function renderScreen(el, params) {
    const inv = parseInvite(params) || (params && params.j ? null : parseInvite(pendingJoin()));
    if (params && params.j && !inv) { el.append(ui.card({ class: 'fm-card' }, h('p', { role: 'alert' }, '這個邀請連結不完整，請家人用「LINE 傳給家人」或「複製連結」再傳一次。'))); return; }
    if (!subtle()) { el.append(ui.card({ class: 'fm-card' }, h('p', null, '這個瀏覽器不支援加密功能，請用手機的 Chrome 或 Safari 開啟。'))); return; }
    const host = h('div', { class: 'fm' }); el.append(host);
    App.account.config().then(() => {
      if (!host.isConnected) return;
      if (App.account.noService()) {
        host.append(ui.card({ class: 'fm-card' }, h('div', { class: 'fm-ico', 'aria-hidden': 'true' }, '👨‍👩‍👧'), h('h2', { class: 'fm-h' }, '家人共用紀錄'),
          h('p', { class: 'small' }, '爸爸、阿嬤也能在自己的手機上記錄和查看寶寶的紀錄，加密同步。'),
          h('p', { class: 'small muted fm-why', dataset: { why: 'no-server' } }, '這個網址還沒有開啟會員服務（例如網頁預覽版），正式上線後就能使用。現在可以先用「我的 → 匯出／匯入備份」和家人交換紀錄。')));
        return;
      }
      if (inv && !(fam() && fam().id === inv.fid)) { renderJoin(host, inv); return; }
      if (inv) { setPending(null); history.replaceState(null, '', '#/family'); }
      if (!store.state.auth) {
        host.append(ui.card({ class: 'fm-card center' }, h('div', { class: 'fm-ico', 'aria-hidden': 'true' }, '👨‍👩‍👧'), h('h2', { class: 'fm-h' }, '家人共用紀錄'),
          h('p', { class: 'small muted fm-why', dataset: { why: 'login' } }, '登入會員（免費）後，就能和家人加密同步寶寶的紀錄。'),
          h('button', { class: 'btn btn-primary btn-block mt', onclick: () => App.navigate('login') }, '登入／註冊')));
        return;
      }
      if (fam() && fam().id) renderFamily(host); else renderIntro(host);
    });
  }
  App.screen('family', {
    title: '家人共用紀錄',
    tab: 'me',
    liveUpdate: false,
    render(el, params) { renderScreen(el, params || {}); },
  });

  // 我的: a line with where things stand
  function listItem() {
    const f = fam();
    const m = f ? meta() : null;
    return h('a', { class: 'list-item fm-li', href: '#/family' }, h('span', { class: 'li-icon', 'aria-hidden': 'true' }, '👨‍👩‍👧'),
      h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '家人共用紀錄'),
        h('div', { class: 'li-sub' }, f && f.id ? `已和 ${Math.max(1, (f.members || 1) - 1)} 位家人共用・${m && m.at ? '已同步' : '尚未同步'}` : '爸爸、阿嬤的手機也能一起記錄（加密同步）')),
      h('span', { class: 'li-right', html: ui.ICONS.chevron }));
  }

  // start: a sync shortly after the app opens
  setTimeout(() => { if (active()) sync(); }, 2000);

  App.family = {
    active, sync, link, rebase, status, encrypt, decrypt, ridOf, TYPES, listItem, parseInvite, hash53, keysOf, CHECK,
  };
}());
