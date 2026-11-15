/* 易家做媽媽 — store: single state tree persisted to localStorage.
 * Usage:
 *   App.store.state                      // read
 *   App.store.update(s => { s.x = 1 })   // mutate + persist + notify
 *   App.store.subscribe(fn)              // fn(state) after each update
 */
(function () {
  const App = window.App = window.App || {};
  const KEY = 'yijia-mom-app-v1';
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
    settings: { theme: 'auto', notify: false, nightMode: true, quickTiles: null }, // quickTiles null = default set
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
    return s;
  };
  const load = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate(merge(defaults(), JSON.parse(raw)));
    } catch (e) { /* storage blocked or corrupt */ }
    return defaults();
  };

  const listeners = new Set();
  const store = {
    KEY,
    state: load(),
    defaults,
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { /* ignore */ }
    },
    update(fn) {
      fn(this.state);
      this.save();
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

  App.store = store;
}());
