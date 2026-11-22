/* 易家做媽媽 — store: single state tree persisted to localStorage (IndexedDB when it outgrows it).
 * Usage:
 *   App.store.state                      // read
 *   App.store.update(s => { s.x = 1 })   // mutate + persist + notify
 *   App.store.subscribe(fn)              // fn(state) after each update
 */
(function () {
  const App = window.App = window.App || {};
  // ?sandbox=1 (the landing page's 試玩): its own data, so a demo never touches the real app's records on the same site
  const SANDBOX = /[?&]sandbox=1(&|$)/.test(location.search);
  const KEY = SANDBOX ? 'yijia-mom-app-sandbox' : 'yijia-mom-app-v1';
  const { uid, dateKey } = window.Core;

  const defaults = () => ({
    version: 1,
    createdAt: new Date().toISOString(),
    onboarded: false,
    profile: {
      momName: '',
      stage: 'baby', // 'prep' 備孕 | 'preg' 懷孕 | 'baby' 育兒
      member: '媽媽', // who is recording on this device
      lmp: '', // last menstrual period start (YYYY-MM-DD)
      edd: '', // estimated due date
      cycleLength: 28,
      periodLength: 5,
      heightCm: '',
      prePregWeight: '',
      pregnantToo: false, // 育兒中又懷了二寶：首頁與健康同時顯示孕期內容
    },
    babies: [], // {id, name, sex:'girl'|'boy', birthday, birthTime, birthWeight(kg), birthLength(cm), avatar}
    activeBabyId: null,
    logs: [], // {id, babyId, type, start, end, data:{}, note, by, createdAt}
    growth: [], // {id, babyId, date, weight, length, head}
    vaccines: {}, // {[babyId]: {[key]: 'YYYY-MM-DD'}}
    checkups: {}, // {[babyId]: {[key]: 'YYYY-MM-DD'}}
    milestones: {}, // {[babyId]: {[key]: 'YYYY-MM-DD'}}
    milk: [], // breast-milk bags {id, ml, pumpedAt, storage:'room'|'fridge'|'freezer', thawedAt, usedAt, note}
    periods: [], // {id, start, end}
    preg: {
      kicks: [], // {id, start, end, count}
      contractions: [], // {id, start, end}
      weights: [], // {id, date, kg}
      prenatal: {}, // {[visitKey]: 'YYYY-MM-DD'}
      visitNotes: {}, // {[visitKey]: {weight, sys, dia, fhr, note}} 產檢當天的紀錄
      journal: [], // 身體狀況日記 {id, at, symptoms:[], sys, dia, mood, note}
      notes: [],
    },
    journey: { done: {} }, // 孕產路線圖 checklist {itemId: 'YYYY-MM-DD'}
    postpartum: { start: '', method: '', log: [] }, // 產後：start=生產日；log {id, at, lochia:{amount,color}, pain, temp, mood, symptoms:[], note}
    island: { stamps: {}, quiz: {}, visited: {} },
    chicken: { log: {}, goal: 1 }, // 滴雞精打卡 {'YYYY-MM-DD': count}
    folic: { log: {} }, // 葉酸打卡
    daily: { log: {} }, // 今日小任務 {'YYYY-MM-DD': {water: n}}
    reminders: defaultReminders(),
    active: {}, // running timers: { feed: {start, side}, sleep: {start}, pump: {start} }
    settings: { theme: 'auto', notify: false, nightMode: true, sunPlace: null, quickTiles: null, lastBackupAt: null, backupSnoozeUntil: null, a2hsDismissed: null }, // sunPlace null = 北部, or 固定時鐘 when the phone is not on Taiwan time; quickTiles null = default set; lastBackupAt = last 匯出備份; the other two: 首頁 safety cards
  });
  function defaultReminders() {
    return [
      { id: 'feed', label: '餵奶提醒', type: 'feed', enabled: false, mode: 'predict', minutes: 180 },
      { id: 'appt', label: '預約與到期提醒', type: 'appt', enabled: false, time: '09:00' },
      { id: 'chicken', label: '滴雞精時光提醒', type: 'chicken', enabled: false, time: '09:00' },
    ];
  }

  // Merge saved state onto defaults so newly added keys always exist.
  const merge = (base, saved) => {
    if (Array.isArray(base) || typeof base !== 'object' || base === null) return saved === undefined ? base : saved;
    const out = { ...base };
    Object.keys(saved || {}).forEach((k) => {
      out[k] = (k in base) ? merge(base[k], saved[k]) : saved[k];
    });
    return out;
  };

  // arrays are taken from the saved state as-is, so add reminders introduced in later versions
  const migrate = (s) => {
    if (!['prep', 'preg', 'baby'].includes(s.profile.stage)) s.profile.stage = 'baby';
    defaultReminders().forEach((r) => {
      const cur = s.reminders.find((x) => x.id === r.id);
      if (!cur) s.reminders.push(r);
      else Object.keys(r).forEach((k) => { if (!(k in cur)) cur[k] = r[k]; });
    });
    s.reminders.sort((a, b) => defaultReminders().findIndex((r) => r.id === a.id) - defaultReminders().findIndex((r) => r.id === b.id));
    if (Array.isArray(s.logs)) s.logs = s.logs.map(unpackLog);
    // timers saved before they remembered their baby belong to the baby selected then
    ['feed', 'sleep', 'pump'].forEach((k) => { const t = s.active && s.active[k]; if (t && !t.babyId) t.babyId = s.activeBabyId || (s.babies[0] && s.babies[0].id) || null; });
    return s;
  };

  /* ---------- saving on the phone ----------
   * localStorage holds about 5 MB per site; a family logs 20–40 records a day, so one baby fills it in under
   * 3 years and twins in about 1½. Two things keep that from ever losing a record:
   *  1. Logs (most of the data) are saved without their blank parts (end: null, note: '', data: {}, createdAt equal to
   *     start) and with times as numbers; loading puts every field back exactly.
   *  2. If it still does not fit, everything moves to IndexedDB (far more room) and localStorage keeps only a small
   *     copy of the newest week (see writeRecent). The app waits for that data before showing anything, so nothing
   *     can overwrite it with an empty start.
   * A save that cannot be kept anywhere is never silent: health turns 'failed' and the app asks for a backup. */
  const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
  const TIMES = ['start', 'end', 'createdAt'];
  const packLog = (l) => {
    if (!l || typeof l !== 'object') return l;
    const o = {};
    Object.keys(l).forEach((k) => {
      const v = l[k];
      if (k === 'end' && v == null) return;
      if (k === 'note' && (v === '' || v == null)) return;
      if (k === 'data' && v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return;
      if (k === 'createdAt' && v === l.start) return;
      o[k] = TIMES.includes(k) && typeof v === 'string' && ISO.test(v) ? Date.parse(v) : v;
    });
    return o;
  };
  function unpackLog(o) {
    if (!o || typeof o !== 'object') return o;
    const l = { ...o };
    TIMES.forEach((k) => { if (typeof l[k] === 'number') l[k] = new Date(l[k]).toISOString(); });
    if (!('end' in l)) l.end = null;
    if (!('note' in l)) l.note = '';
    if (!('data' in l)) l.data = {};
    if (!('createdAt' in l) && l.start) l.createdAt = l.start;
    return l;
  }
  const serialize = (st) => JSON.stringify({ ...st, logs: (st.logs || []).map(packLog) });
  const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);

  // IndexedDB: one key/value store, the whole saved state as one string
  let dbp = null;
  const idb = () => dbp || (dbp = new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('no IndexedDB')); return; }
    const rq = indexedDB.open(SANDBOX ? 'yijia-mom-sandbox' : 'yijia-mom', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
    rq.onblocked = () => rej(new Error('IndexedDB blocked'));
  }));
  const idbDo = (mode, fn) => idb().then((db) => new Promise((res, rej) => {
    const tx = db.transaction('kv', mode);
    const rq = fn(tx.objectStore('kv'));
    tx.oncomplete = () => res(rq.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('aborted'));
  }));
  const idbGet = () => idbDo('readonly', (os) => os.get(KEY));
  const idbPut = (rec) => idbDo('readwrite', (os) => os.put(rec, KEY)); // rec = { seq, json }

  // While the data lives in IndexedDB, every save also writes (instantly, to localStorage) a small copy of the
  // newest part: everything except logs, plus the logs of the last 7 days. Database writes take a moment; if the
  // app is closed before one finishes, the next start puts this copy on top (its seq is newer), so a record tapped
  // just before closing is never lost.
  const RECENT_MS = 7 * 864e5;
  const ms = (v) => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : 0; };
  // a log counts as recent if it happened or was written down in the last week (so moving a new log's time back is kept too)
  const logTime = (l) => Math.max(ms(l.start), ms(l.createdAt === undefined ? l.start : l.createdAt));
  let walSeq = 0;
  const writeRecent = (st, seq) => {
    const cutoff = Date.now() - RECENT_MS;
    const rest = { ...st }; delete rest.logs;
    try {
      localStorage.setItem(KEY, JSON.stringify({ __idb: 1, seq, cutoff, rest, recent: (st.logs || []).filter((l) => logTime(l) >= cutoff).map(packLog) }));
    } catch (e) { /* ignore: the database copy still follows */ }
  };

  let pointer = null; // set when the saved data lives in IndexedDB
  let loadedChars = 0;
  const load = () => {
    try {
      const raw = localStorage.getItem(KEY);
      loadedChars = raw ? raw.length : 0;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.__idb) { pointer = parsed; walSeq = parsed.seq || 0; return defaults(); }
        return migrate(merge(defaults(), parsed));
      }
    } catch (e) { /* storage blocked or corrupt */ }
    return defaults();
  };

  const listeners = new Set();
  let saveSeq = 0;
  let pendingSave = null; // timer of a save waiting for the screen to update first (big data only)
  let lastWrite = Promise.resolve(); // the IndexedDB write in flight, if any
  const BIG = 400000; // characters: about 3 months of records; below this every change is saved at once
  const store = {
    KEY,
    state: load(),
    defaults,
    where: pointer ? 'idb' : 'local', // where the saved data lives
    loading: !!pointer, // true until IndexedDB data is back in memory: nothing is saved meanwhile
    health: 'ok', // 'ok' | 'failed' (a save could not be kept anywhere)
    savedChars: loadedChars, // size of the last save (characters)
    ready: null, // Promise: resolves when the saved data is loaded (immediately unless it lives in IndexedDB)
    setHealth(h) {
      if (this.health === h) return;
      this.health = h;
      try { window.dispatchEvent(new CustomEvent('store-health', { detail: h })); } catch (e) { /* ignore */ }
    },
    save() {
      if (this.loading) return; // never overwrite the real data while it is still loading
      const json = serialize(this.state);
      this.savedChars = json.length;
      if (this.where === 'local') {
        try { localStorage.setItem(KEY, json); this.setHealth('ok'); return; } catch (e) {
          if (!isQuota(e)) return; // storage blocked (private mode): the app keeps working in memory, as before
        }
      }
      // too big for localStorage (or already moved): keep it in IndexedDB
      saveSeq += 1; walSeq += 1;
      const seq = saveSeq; const wseq = walSeq;
      if (this.where === 'idb') writeRecent(this.state, wseq);
      lastWrite = idbPut({ seq: wseq, json }).then(() => {
        if (this.where !== 'idb') {
          // first move: only now that the database holds everything does localStorage give up the full copy
          this.where = 'idb';
          writeRecent(this.state, walSeq);
          // ask the browser to keep this data even when the phone is short of space
          try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
        }
        if (seq === saveSeq) this.setHealth('ok');
      }).catch(() => this.setHealth('failed'));
    },
    // With years of records, writing everything takes a moment on a phone (0.5 s for 2½ years of twins), so the
    // screen updates first and the save follows right after; a burst of taps becomes one save. Hiding or leaving
    // the app saves at once (flush), so nothing waits long enough to be lost.
    scheduleSave() {
      if (this.savedChars < BIG) { this.save(); return; }
      if (pendingSave) return;
      pendingSave = setTimeout(() => { pendingSave = null; this.save(); }, 250);
    },
    flush() {
      if (pendingSave) { clearTimeout(pendingSave); pendingSave = null; this.save(); }
    },
    // resolves once everything changed so far is stored (tests, and before export)
    whenSaved() { this.flush(); return lastWrite.catch(() => {}); },
    update(fn) {
      fn(this.state);
      this.scheduleSave();
      listeners.forEach((l) => { try { l(this.state); } catch (e) { console.error(e); } });
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    replace(next) { this.state = migrate(merge(defaults(), next)); this.update(() => {}); },
    reset() { this.state = defaults(); this.update(() => {}); },

    /* ----- convenience selectors ----- */
    get profile() { return this.state.profile; },
    get stage() { return this.state.profile.stage; },
    // every stage whose content should show right now (育兒＋二寶懷孕 -> ['baby','preg'])
    stages() {
      const p = this.state.profile;
      return p.stage === 'baby' && p.pregnantToo ? ['baby', 'preg'] : [p.stage];
    },
    inStage(list) { return this.stages().some((st) => (list || []).includes(st)); },
    baby() {
      const s = this.state;
      return s.babies.find((b) => b.id === s.activeBabyId) || s.babies[0] || null;
    },
    babyLogs(babyId = this.baby()?.id) {
      return this.state.logs.filter((l) => l.babyId === babyId);
    },
    logsOn(day, babyId = this.baby()?.id) {
      const key = typeof day === 'string' ? day : dateKey(day);
      return this.babyLogs(babyId)
        .filter((l) => dateKey(new Date(l.start)) === key)
        .sort((a, b) => new Date(b.start) - new Date(a.start));
    },
    lastLog(types, babyId = this.baby()?.id) {
      const ts = [].concat(types);
      return this.babyLogs(babyId)
        .filter((l) => ts.includes(l.type))
        .sort((a, b) => new Date(b.start) - new Date(a.start))[0] || null;
    },

    /* ----- mutations ----- */
    addLog(log) {
      const baby = this.baby();
      const entry = {
        id: uid(),
        babyId: baby ? baby.id : null,
        start: new Date().toISOString(),
        end: null,
        data: {},
        note: '',
        by: this.state.profile.member,
        createdAt: new Date().toISOString(),
        ...log,
      };
      this.update((s) => { s.logs.push(entry); });
      return entry;
    },
    updateLog(id, patch) {
      this.update((s) => {
        const l = s.logs.find((x) => x.id === id);
        if (l) Object.assign(l, patch);
      });
    },
    removeLog(id) {
      this.update((s) => { s.logs = s.logs.filter((x) => x.id !== id); });
    },
    addBaby(b) {
      const baby = { id: uid(), name: '寶寶', sex: 'girl', birthday: dateKey(), avatar: '👶', ...b };
      this.update((s) => { s.babies.push(baby); s.activeBabyId = baby.id; });
      return baby;
    },
  };

  // leaving or hiding the app (switching apps, locking the phone, closing the tab) saves whatever is waiting
  window.addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });
  store.ready = !pointer ? Promise.resolve() : idbGet().then((rec) => {
    const base = rec && typeof rec === 'object' ? rec : rec ? { seq: 0, json: rec } : null;
    let st = base ? JSON.parse(base.json) : null;
    if (pointer.rest && (!base || (pointer.seq || 0) > (base.seq || 0))) {
      // closed before the last database write finished: put the newest part (from localStorage) on top
      const fresh = new Set((pointer.recent || []).map((l) => l.id));
      const older = st && Array.isArray(st.logs) ? st.logs.filter((l) => logTime(l) < pointer.cutoff && !fresh.has(l.id)) : [];
      st = { ...(st || {}), ...pointer.rest, logs: [...older, ...(pointer.recent || [])] };
    }
    if (st) { store.state = migrate(merge(defaults(), st)); store.savedChars = base ? base.json.length : JSON.stringify(st).length; }
    else { store.where = 'local'; try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } } // the browser cleared it
    store.loading = false;
  }).catch(() => {
    // the data is there but cannot be read right now: keep it untouched (no saves) and say so
    store.setHealth('failed');
  }).then(() => { listeners.forEach((l) => { try { l(store.state); } catch (e) { console.error(e); } }); });
  App.store = store;
}());
