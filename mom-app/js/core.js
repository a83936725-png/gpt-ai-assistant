/* 易家做媽媽 — core: pure helpers (dates, pregnancy, cycle, predictions, growth math).
 * No DOM access here, so it can be unit-tested with Jest.
 * Exposed as window.Core in the browser and module.exports in Node. */
(function (root, factory) {
  const Core = factory();
  if (typeof module === 'object' && module.exports) module.exports = Core;
  else root.Core = Core;
}(typeof self !== 'undefined' ? self : this, () => {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- dates ---------- */
  // 'YYYY-MM-DD' in local time
  const dateKey = (d = new Date()) => {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  // parse 'YYYY-MM-DD' as local midnight
  const parseKey = (key) => {
    if (!key) return null;
    const [y, m, d] = String(key).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d instanceof Date ? d : parseKey(d)); x.setDate(x.getDate() + n); return x; };
  const addMonths = (d, n) => {
    const x = new Date(d instanceof Date ? d : parseKey(d));
    const day = x.getDate();
    x.setDate(1); x.setMonth(x.getMonth() + n);
    const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
    x.setDate(Math.min(day, last));
    return x;
  };
  // whole calendar days from a to b (b - a)
  const diffDays = (a, b) => {
    const A = startOfDay(a instanceof Date ? a : parseKey(a));
    const B = startOfDay(b instanceof Date ? b : parseKey(b));
    return Math.round((B - A) / DAY);
  };
  const fmtDate = (d, withWeekday = true) => {
    const x = d instanceof Date ? d : parseKey(d);
    if (!x) return '';
    return `${x.getMonth() + 1}/${x.getDate()}${withWeekday ? `（${WEEKDAYS[x.getDay()]}）` : ''}`;
  };
  const fmtDateLong = (d) => {
    const x = d instanceof Date ? d : parseKey(d);
    if (!x) return '';
    return `${x.getFullYear()}年${x.getMonth() + 1}月${x.getDate()}日 週${WEEKDAYS[x.getDay()]}`;
  };
  const fmtTime = (d) => { const x = new Date(d); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
  // "2 小時 5 分" / "45 分" / "30 秒"
  const fmtDuration = (ms, { seconds = false } = {}) => {
    const neg = ms < 0; ms = Math.abs(ms);
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / MIN);
    const s = Math.floor((ms % MIN) / 1000);
    let out;
    if (h > 0) out = `${h} 小時${m ? ` ${m} 分` : ''}`;
    else if (m > 0 || !seconds) out = `${m} 分${seconds && s ? ` ${s} 秒` : ''}`;
    else out = `${s} 秒`;
    return neg ? `-${out}` : out;
  };
  // "00:12:05" stopwatch style
  const fmtClock = (ms) => {
    ms = Math.max(0, ms);
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / MIN);
    const s = Math.floor((ms % MIN) / 1000);
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };
  // "剛剛" / "12 分前" / "3 小時 5 分前" / "2 天前"
  const ago = (d, now = Date.now()) => {
    const ms = now - new Date(d).getTime();
    if (ms < MIN) return '剛剛';
    if (ms < HOUR) return `${Math.floor(ms / MIN)} 分前`;
    if (ms < DAY) {
      const h = Math.floor(ms / HOUR); const m = Math.floor((ms % HOUR) / MIN);
      return `${h} 小時${m ? ` ${m} 分` : ''}前`;
    }
    return `${Math.floor(ms / DAY)} 天前`;
  };
  // datetime-local input value <-> Date
  const toLocalInput = (d = new Date()) => {
    const x = new Date(d);
    return `${dateKey(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
  };
  const fromLocalInput = (v) => (v ? new Date(v) : null);

  /* ---------- baby age ---------- */
  // { days, months, remDays, text: "2 個月 28 天", dayText: "出生第 89 天" }
  const babyAge = (birthday, now = new Date()) => {
    const b = parseKey(birthday);
    if (!b) return null;
    const days = diffDays(b, now);
    // whole months = the largest m whose monthly "birthday" (clamped to month end, e.g. 2/29 → 2/28) has passed
    let months = Math.max(0, (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth()) + 1);
    while (months > 0 && diffDays(addMonths(b, months), now) < 0) months -= 1;
    const remDays = diffDays(addMonths(b, months), now);
    let text;
    if (days < 0) text = `還有 ${-days} 天出生`;
    else if (months === 0) text = `${days} 天`;
    else if (months < 24) text = `${months} 個月${remDays ? ` ${remDays} 天` : ''}`;
    else text = `${Math.floor(months / 12)} 歲${months % 12 ? ` ${months % 12} 個月` : ''}`;
    return { days, months, remDays, ageMonthsFloat: days / 30.4375, text, dayText: `出生第 ${days + 1} 天` };
  };

  /* ---------- pregnancy ---------- */
  const eddFromLmp = (lmp) => dateKey(addDays(parseKey(lmp), 280));
  const lmpFromEdd = (edd) => dateKey(addDays(parseKey(edd), -280));
  // gestational age from LMP
  const gestAge = (lmp, now = new Date()) => {
    const total = diffDays(lmp, now);
    return {
      totalDays: total,
      weeks: Math.floor(total / 7),
      days: ((total % 7) + 7) % 7,
      trimester: total < 14 * 7 ? 1 : total < 28 * 7 ? 2 : 3,
      daysLeft: 280 - total,
      progress: Math.min(1, Math.max(0, total / 280)),
    };
  };

  /* ---------- menstrual cycle ---------- */
  // periods: [{start:'YYYY-MM-DD', end?}] ; returns average cycle length from history (fallback to setting)
  const avgCycleLength = (periods, fallback = 28) => {
    const starts = periods.map((p) => p.start).filter(Boolean).sort();
    const gaps = [];
    for (let i = 1; i < starts.length; i += 1) {
      const g = diffDays(starts[i - 1], starts[i]);
      if (g >= 18 && g <= 60) gaps.push(g);
    }
    if (!gaps.length) return fallback;
    const recent = gaps.slice(-6);
    return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
  };
  // predict next period / ovulation / fertile window
  const predictCycle = ({ lastStart, cycleLength = 28, periodLength = 5, now = new Date() }) => {
    if (!lastStart) return null;
    let next = addDays(parseKey(lastStart), cycleLength);
    while (diffDays(now, next) < -periodLength) next = addDays(next, cycleLength);
    const currentStart = addDays(next, -cycleLength);
    const ovulation = addDays(next, -14);
    const fertileStart = addDays(ovulation, -5);
    const fertileEnd = addDays(ovulation, 1);
    const cycleDay = diffDays(currentStart, now) + 1;
    const inPeriod = cycleDay >= 1 && cycleDay <= periodLength;
    const inFertile = diffDays(fertileStart, now) >= 0 && diffDays(now, fertileEnd) >= 0;
    return {
      cycleDay,
      nextPeriod: dateKey(next),
      daysToNext: diffDays(now, next),
      ovulation: dateKey(ovulation),
      fertileStart: dateKey(fertileStart),
      fertileEnd: dateKey(fertileEnd),
      inPeriod,
      inFertile,
      phase: inPeriod ? 'period' : inFertile ? 'fertile' : diffDays(ovulation, now) > 0 ? 'luteal' : 'follicular',
    };
  };

  /* ---------- predictions (What's Next) ---------- */
  // Average gap between consecutive events (start times), only using recent ones.
  const avgInterval = (times, { maxCount = 8, maxGapHours = 8, minGapMin = 20 } = {}) => {
    const ts = times.map((t) => new Date(t).getTime()).sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < ts.length; i += 1) {
      const g = ts[i] - ts[i - 1];
      if (g >= minGapMin * MIN && g <= maxGapHours * HOUR) gaps.push(g);
    }
    if (!gaps.length) return null;
    const recent = gaps.slice(-maxCount);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  };
  // Typical awake windows (minutes) by age in months — common pediatric sleep guidance ranges.
  const WAKE_WINDOWS = [
    { maxMonths: 1, min: 35, max: 60 },
    { maxMonths: 2, min: 60, max: 90 },
    { maxMonths: 3, min: 75, max: 105 },
    { maxMonths: 5, min: 105, max: 150 },
    { maxMonths: 7, min: 120, max: 180 },
    { maxMonths: 10, min: 150, max: 210 },
    { maxMonths: 13, min: 180, max: 240 },
    { maxMonths: 18, min: 240, max: 330 },
    { maxMonths: 120, min: 300, max: 360 },
  ];
  const wakeWindow = (ageMonths) => WAKE_WINDOWS.find((w) => ageMonths < w.maxMonths) || WAKE_WINDOWS[WAKE_WINDOWS.length - 1];
  // Default feeding gap (hours) when there is not enough history.
  const defaultFeedGapHours = (ageMonths) => (ageMonths < 1 ? 2.5 : ageMonths < 3 ? 3 : ageMonths < 6 ? 3.5 : 4);

  /* ---------- breast milk storage ----------
   * Commonly cited guidance (e.g. US CDC): room temp ≤4h, fridge ≤4 days,
   * freezer best ≤6 months (≤12 acceptable); thawed: fridge ≤24h, room temp ≤2h. */
  const MILK_RULES = {
    room: { label: '室溫', hours: 4 },
    fridge: { label: '冷藏', hours: 4 * 24 },
    freezer: { label: '冷凍', hours: 182 * 24 },
    thawed: { label: '已解凍（冷藏）', hours: 24 },
  };
  const milkExpiry = (bag) => {
    if (bag.storage === 'freezer' && !bag.thawedAt) return new Date(new Date(bag.pumpedAt).getTime() + MILK_RULES.freezer.hours * HOUR);
    if (bag.thawedAt) return new Date(new Date(bag.thawedAt).getTime() + MILK_RULES.thawed.hours * HOUR);
    const rule = MILK_RULES[bag.storage] || MILK_RULES.fridge;
    return new Date(new Date(bag.pumpedAt).getTime() + rule.hours * HOUR);
  };

  /* ---------- growth (WHO LMS method) ---------- */
  // value at z-score for given L, M, S
  const lmsValue = (L, M, S, z) => (Math.abs(L) < 1e-6 ? M * Math.exp(S * z) : M * (1 + L * S * z) ** (1 / L));
  const lmsZ = (L, M, S, x) => (Math.abs(L) < 1e-6 ? Math.log(x / M) / S : ((x / M) ** L - 1) / (L * S));
  // standard normal CDF -> percentile
  const zToPercentile = (z) => {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    if (z > 0) p = 1 - p;
    return p * 100;
  };
  // linear interpolation in a table of rows [month, L, M, S]
  const interpLMS = (rows, month) => {
    if (month <= rows[0][0]) return rows[0].slice(1);
    for (let i = 1; i < rows.length; i += 1) {
      if (month <= rows[i][0]) {
        const [m0, ...a] = rows[i - 1];
        const [m1, ...b] = rows[i];
        const f = (month - m0) / (m1 - m0);
        return a.map((v, k) => v + (b[k] - v) * f);
      }
    }
    return rows[rows.length - 1].slice(1);
  };

  /* ---------- misc ---------- */
  const sum = (arr, f = (x) => x) => arr.reduce((a, b) => a + (Number(f(b)) || 0), 0);
  const groupBy = (arr, f) => arr.reduce((acc, x) => { const k = f(x); (acc[k] = acc[k] || []).push(x); return acc; }, {});
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  return {
    MIN, HOUR, DAY, WEEKDAYS,
    pad, uid, dateKey, parseKey, startOfDay, addDays, addMonths, diffDays,
    fmtDate, fmtDateLong, fmtTime, fmtDuration, fmtClock, ago, toLocalInput, fromLocalInput,
    babyAge, eddFromLmp, lmpFromEdd, gestAge,
    avgCycleLength, predictCycle,
    avgInterval, wakeWindow, defaultFeedGapHours, WAKE_WINDOWS,
    MILK_RULES, milkExpiry,
    lmsValue, lmsZ, zToPercentile, interpLMS,
    sum, groupBy, clamp, esc,
  };
}));
