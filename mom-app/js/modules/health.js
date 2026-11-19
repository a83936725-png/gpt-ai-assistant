/* 易家做媽媽 — 健康 module:
 *   screens: health (tab hub), growth, vaccines, checkups, milestones, stats, report
 *   tools:   growth, milestones, vaccines, checkups, stats, report (stage: baby)
 *   home card: baby-health */
(function () {
  const App = window.App = window.App || {};
  const C = window.Core;
  const { h, s } = App;
  const { ui } = App;
  const H = App.HEALTH;

  /* =====================================================================
   * helpers
   * ===================================================================== */
  const store = () => App.store;
  const baby = () => App.store.baby();
  const sexKey = (b) => (b && b.sex === 'boy' ? 'boy' : 'girl');
  const today = () => C.startOfDay(new Date());
  const ageMonthsAt = (birthday, date) => C.diffDays(birthday, date) / 30.4375;
  const round = (v, d = 1) => {
    const f = 10 ** d;
    return Math.round(Number(v) * f) / f;
  };
  const fmtNum = (v, d = 1) => {
    if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—';
    const r = round(v, d);
    return Number.isInteger(r) && d > 0 ? r.toFixed(1) : String(r);
  };
  const fmtYMD = (d) => {
    const x = d instanceof Date ? d : C.parseKey(d);
    return x ? `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}` : '';
  };
  // due date for a (possibly fractional) month offset from birthday
  const dueFrom = (birthday, months) => (Number.isInteger(months)
    ? C.addMonths(birthday, months)
    : C.addDays(birthday, Math.round(months * 30.4375)));
  const monthsLabel = (m) => {
    if (m < 0.5) return '出生';
    if (m < 24) return `${m} 個月`;
    if (m % 12 === 0) return `${m / 12} 歲`;
    return `${Math.floor(m / 12)} 歲 ${m % 12} 個月`;
  };

  /* ---------- growth math ---------- */
  const Z = { 3: -1.880794, 15: -1.036433, 50: 0, 85: 1.036433, 97: 1.880794 };
  const MAX_MONTH = 60; // the WHO standards (and our tables) cover 0–5 years
  const outOfBand = (p) => typeof p === 'number' && (p < 3 || p > 97); // null = no percentile (e.g. over 5 years), never a warning
  const lmsAt = (metric, sex, month) => C.interpLMS(H.WHO[metric][sex], month);
  const curveValue = (metric, sex, month, z) => {
    const [L, M, S] = lmsAt(metric, sex, month);
    return C.lmsValue(L, M, S, z);
  };
  const percentileOf = (metric, sex, month, value) => {
    if (!(value > 0) || month < 0 || month > MAX_MONTH + 0.5) return null;
    const [L, M, S] = lmsAt(metric, sex, Math.min(MAX_MONTH, month));
    return C.zToPercentile(C.lmsZ(L, M, S, value));
  };
  const pctText = (p) => {
    if (p === null || p === undefined) return '';
    if (p < 3) return '低於第 3 百分位';
    if (p > 97) return '高於第 97 百分位';
    return `約第 ${Math.round(p)} 百分位`;
  };
  // short label: "P62", or "< P3" / "> P97" outside the band (never "P0" / "P100")
  const pctShort = (p) => (p < 3 ? '< P3' : p > 97 ? '> P97' : `P${Math.round(p)}`);
  const pctTag = (p) => {
    if (p === null || p === undefined) return null;
    return h('span', { class: `tag ${outOfBand(p) ? 'warn' : 'primary'}` }, pctShort(p));
  };

  // measurements (plus birth data from profile) for one metric, sorted by date
  function growthPoints(b, metric) {
    const def = H.GROWTH_METRICS[metric];
    const pts = store().state.growth
      .filter((g) => g.babyId === b.id && Number(g[def.field]) > 0)
      .map((g) => ({ id: g.id, date: g.date, value: Number(g[def.field]) }));
    const hasBirthRow = pts.some((p) => p.date === b.birthday);
    if (!hasBirthRow && Number(b[def.birthField]) > 0 && b.birthday) {
      pts.push({ id: null, date: b.birthday, value: Number(b[def.birthField]), birth: true });
    }
    return pts
      .map((p) => ({ ...p, month: ageMonthsAt(b.birthday, p.date) }))
      .sort((a, c) => a.month - c.month);
  }
  function latestGrowth(b) {
    const out = {};
    Object.keys(H.GROWTH_METRICS).forEach((m) => {
      const pts = growthPoints(b, m);
      const last = pts[pts.length - 1];
      if (last) out[m] = { ...last, pct: percentileOf(m, sexKey(b), last.month, last.value) };
    });
    return out;
  }

  /* ---------- vaccines / checkups status ---------- */
  function vaccineStatus(v, b, doneMap, now = today()) {
    const done = doneMap[v.key];
    const due = dueFrom(b.birthday, v.months);
    const end = dueFrom(b.birthday, v.endMonths ?? v.months + 1);
    const daysToDue = C.diffDays(now, due);
    if (done) return { key: 'done', label: '已完成', cls: 'ok', due, end, daysToDue, done };
    if (v.conditional) return { key: 'cond', label: '視情況', cls: '', due, end, daysToDue };
    if (C.diffDays(end, now) > 0) {
      return v.free
        ? { key: 'overdue', label: '已逾期', cls: 'danger', due, end, daysToDue }
        : { key: 'optional', label: '自費・可補打', cls: '', due, end, daysToDue };
    }
    if (daysToDue <= 0) return { key: 'due', label: '可接種', cls: 'warn', due, end, daysToDue };
    if (daysToDue <= 14) return { key: 'soon', label: `${daysToDue}\u00a0天後到期`, cls: 'warn', due, end, daysToDue };
    return { key: 'upcoming', label: '未到', cls: '', due, end, daysToDue };
  }
  // next dose worth showing: overdue/due/soon first, else nearest upcoming (公費 first)
  function nextVaccine(b) {
    const doneMap = store().state.vaccines[b.id] || {};
    const list = H.VACCINES
      .filter((v) => !v.conditional)
      .map((v) => ({ v, st: vaccineStatus(v, b, doneMap) }))
      .filter((x) => ['overdue', 'due', 'soon', 'upcoming'].includes(x.st.key));
    list.sort((a, c) => (a.st.due - c.st.due) || (Number(c.v.free) - Number(a.v.free)));
    return list.find((x) => x.v.free) || list[0] || null;
  }
  function checkupStatus(c, b, doneMap, now = today()) {
    const done = doneMap[c.key];
    const start = dueFrom(b.birthday, c.start);
    const end = dueFrom(b.birthday, c.end);
    if (done) return { key: 'done', label: '已完成', cls: 'ok', start, end, done };
    if (C.diffDays(end, now) > 0) return { key: 'missed', label: '已過期間', cls: 'danger', start, end };
    if (C.diffDays(start, now) >= 0) return { key: 'now', label: '現在可以做', cls: 'warn', start, end };
    return { key: 'upcoming', label: '未到', cls: '', start, end };
  }

  /* ---------- daily stats from logs ---------- */
  function dailyStats(b, nDays) {
    const end = today();
    const days = [];
    for (let i = nDays - 1; i >= 0; i -= 1) {
      const d = C.addDays(end, -i);
      days.push({
        key: C.dateKey(d), date: d, milk: 0, feeds: 0, sleepMs: 0, wet: 0, dirty: 0, any: false,
      });
    }
    const byKey = Object.fromEntries(days.map((d) => [d.key, d]));
    const logs = store().babyLogs(b.id);
    const now = Date.now();
    logs.forEach((l) => {
      const k = C.dateKey(new Date(l.start));
      const d = byKey[k];
      if (d) {
        d.any = true;
        if (l.type === 'bottle') { d.milk += Number(l.data?.ml) || 0; d.feeds += 1; }
        if (l.type === 'breast') d.feeds += 1;
        if (l.type === 'diaper') {
          if (l.data?.kind === 'wet') d.wet += 1;
          else d.dirty += 1; // dirty or mixed (含便)
        }
      }
      if (l.type === 'sleep') {
        const st = new Date(l.start).getTime();
        const en = l.end ? new Date(l.end).getTime() : now;
        days.forEach((day) => {
          const ds = day.date.getTime();
          const de = C.addDays(day.date, 1).getTime();
          const ov = Math.min(en, de) - Math.max(st, ds);
          if (ov > 0) { day.sleepMs += ov; day.any = true; }
        });
      }
    });
    // averages over days since the first day that has any record
    const firstIdx = days.findIndex((d) => d.any);
    const span = firstIdx < 0 ? [] : days.slice(firstIdx);
    const avg = (f) => (span.length ? C.sum(span, f) / span.length : 0);
    return {
      days,
      hasData: firstIdx >= 0,
      spanDays: span.length,
      avg: {
        milk: avg((d) => d.milk),
        feeds: avg((d) => d.feeds),
        sleepH: avg((d) => d.sleepMs / C.HOUR),
        diapers: avg((d) => d.wet + d.dirty),
      },
    };
  }

  /* =====================================================================
   * chart primitives (hand-rolled SVG)
   * ===================================================================== */
  function niceTicks(min, max, count = 4) {
    if (max <= min) max = min + 1;
    const raw = (max - min) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= raw) || 10 * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(round(v, 4));
    return { ticks, lo, hi, step };
  }
  // rounded data-end (top), square at the baseline
  function barPath(x, y, w, hgt, r = 4) {
    if (hgt <= 0) return '';
    const rr = Math.min(r, hgt, w / 2);
    return `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}Z`;
  }
  // one shared tooltip per chart wrapper; content via textContent only
  function makeTip(wrap) {
    const strong = h('strong');
    const sub = h('span');
    const rows = h('div', { class: 'viz-tip-rows' });
    const tip = h('div', { class: 'viz-tip', role: 'status', 'aria-live': 'polite' }, strong, sub, rows);
    wrap.append(tip);
    return {
      show(target, main, secondary, lines) {
        strong.textContent = main || '';
        sub.textContent = secondary || '';
        rows.innerHTML = '';
        (lines || []).forEach((ln) => {
          rows.append(h('div', { class: 'viz-tip-row' },
            h('i', { class: 'viz-key-line', style: { background: ln.color } }),
            h('b', null, ln.value), h('span', null, ln.label)));
        });
        tip.classList.add('show');
        const wr = wrap.getBoundingClientRect();
        const tr = target.getBoundingClientRect();
        const tw = tip.offsetWidth;
        let left = tr.left - wr.left + tr.width / 2 - tw / 2;
        left = Math.max(0, Math.min(wr.width - tw, left));
        let top = tr.top - wr.top - tip.offsetHeight - 8;
        if (top < 0) top = tr.bottom - wr.top + 8;
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      },
      hide() { tip.classList.remove('show'); },
    };
  }

  /* ---------- growth chart ---------- */
  function growthChart(b, metric) {
    const def = H.GROWTH_METRICS[metric];
    const sex = sexKey(b);
    const pts = growthPoints(b, metric).filter((p) => p.month >= -0.01 && p.month <= MAX_MONTH + 0.5);
    const ageNow = Math.max(0, ageMonthsAt(b.birthday, today()));
    const maxAge = Math.max(ageNow, ...pts.map((p) => p.month), 0);
    const xMax = maxAge <= 5 ? 6 : maxAge <= 10 ? 12 : maxAge <= 16 ? 18 : maxAge <= 22 ? 24 : maxAge <= 34 ? 36 : maxAge <= 46 ? 48 : MAX_MONTH;

    const W = 340; const HGT = 240;
    const m = {
      l: 34, r: 30, t: 14, b: 30,
    };
    const pw = W - m.l - m.r; const ph = HGT - m.t - m.b;
    const samples = [];
    for (let x = 0; x <= xMax + 1e-9; x += 0.25) samples.push(x);
    const curves = {};
    Object.keys(Z).forEach((p) => { curves[p] = samples.map((x) => curveValue(metric, sex, x, Z[p])); });
    const vals = [...curves[3], ...curves[97], ...pts.map((p) => p.value)];
    const yT = niceTicks(Math.min(...vals), Math.max(...vals), 5);
    const X = (mo) => m.l + (mo / xMax) * pw;
    const Y = (v) => m.t + ph - ((v - yT.lo) / (yT.hi - yT.lo)) * ph;
    const line = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(samples[i]).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const band = (lo, hi) => `${line(curves[hi])}${curves[lo].slice().reverse().map((v, i) => `L${X(samples[samples.length - 1 - i]).toFixed(1)},${Y(v).toFixed(1)}`).join('')}Z`;

    const svg = s('svg', {
      viewBox: `0 0 ${W} ${HGT}`, class: 'viz-svg', role: 'img',
      'aria-label': `${def.label}成長曲線，${sex === 'boy' ? '男孩' : '女孩'}，WHO 百分位帶與寶寶的 ${pts.length} 筆測量`,
    });
    // grid + y ticks
    yT.ticks.forEach((t) => {
      svg.append(s('line', {
        x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: 'viz-grid',
      }));
      svg.append(s('text', {
        x: m.l - 6, y: Y(t) + 3.5, 'text-anchor': 'end', class: 'viz-tick',
      }, String(t)));
    });
    // x ticks
    const xStep = xMax <= 6 ? 1 : xMax <= 12 ? 2 : xMax <= 24 ? 3 : xMax <= 48 ? 6 : 12;
    for (let x = 0; x <= xMax; x += xStep) {
      svg.append(s('text', {
        x: X(x), y: HGT - m.b + 16, 'text-anchor': 'middle', class: 'viz-tick',
      }, x === xMax ? `${x} 月` : String(x)));
    }
    svg.append(s('line', {
      x1: m.l, x2: W - m.r, y1: m.t + ph, y2: m.t + ph, class: 'viz-axis',
    }));
    // WHO bands
    svg.append(s('path', { d: band(3, 97), class: 'viz-band-outer' }));
    svg.append(s('path', { d: band(15, 85), class: 'viz-band-inner' }));
    svg.append(s('path', { d: line(curves[50]), class: 'viz-ref' }));
    // percentile labels at right edge (skip ones that would collide)
    const labelOrder = [50, 3, 97, 15, 85];
    const placed = [];
    labelOrder.forEach((p) => {
      const y = Y(curves[p][curves[p].length - 1]);
      if (placed.some((py) => Math.abs(py - y) < 10)) return;
      placed.push(y);
      svg.append(s('text', { x: W - m.r + 4, y: y + 3.5, class: 'viz-tick' }, `P${p}`));
    });
    // today marker
    if (ageNow <= xMax) {
      svg.append(s('line', {
        x1: X(ageNow), x2: X(ageNow), y1: m.t, y2: m.t + ph, class: 'viz-today',
      }));
    }

    const wrap = h('div', { class: 'viz viz-wrap' });
    wrap.append(svg);
    const tip = makeTip(wrap);
    if (pts.length) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.month).toFixed(1)},${Y(p.value).toFixed(1)}`).join('');
      svg.append(s('path', { d, class: 'viz-line' }));
      pts.forEach((p, i) => {
        const cx = X(p.month); const cy = Y(p.value);
        svg.append(s('circle', {
          cx, cy, r: 4, class: 'viz-dot',
        }));
        const pct = percentileOf(metric, sex, p.month, p.value);
        const age = C.babyAge(b.birthday, C.parseKey(p.date));
        const main = `${fmtNum(p.value, def.digits)} ${def.unit}`;
        const sub = `${fmtYMD(p.date)}・${age ? age.text : ''}${pct !== null ? `・${pctText(pct)}` : ''}${p.birth ? '（出生）' : ''}`;
        const hit = s('circle', {
          cx, cy, r: 13, class: 'viz-hit', tabindex: '0', role: 'img', 'aria-label': `${main}，${sub}`,
        });
        const on = () => tip.show(hit, main, sub);
        hit.addEventListener('pointerenter', on);
        hit.addEventListener('focus', on);
        hit.addEventListener('click', on);
        hit.addEventListener('pointerleave', tip.hide);
        hit.addEventListener('blur', tip.hide);
        svg.append(hit);
        if (i === pts.length - 1) {
          const lx = Math.min(cx, W - m.r - 4);
          svg.append(s('text', {
            x: lx, y: cy - 9, 'text-anchor': cx > W - m.r - 30 ? 'end' : 'middle', class: 'viz-value',
          }, fmtNum(p.value, def.digits)));
        }
      });
    }
    return wrap;
  }

  /* ---------- bar chart (single or stacked series) ---------- */
  function barChart({
    days, series, unit, digits = 0, aria, labelFmt,
  }) {
    const W = 340; const HGT = 190;
    const m = {
      l: 34, r: 8, t: 20, b: 28,
    };
    const pw = W - m.l - m.r; const ph = HGT - m.t - m.b;
    const n = days.length;
    const totals = days.map((_, i) => C.sum(series, (se) => se.values[i]));
    const maxV = Math.max(...totals, 0);
    const yT = niceTicks(0, maxV || 1, 4);
    const Y = (v) => m.t + ph - (v / yT.hi) * ph;
    const slot = pw / n;
    const bw = Math.min(24, slot * 0.62);
    const fmt = labelFmt || ((v) => fmtNum(v, digits));

    const svg = s('svg', {
      viewBox: `0 0 ${W} ${HGT}`, class: 'viz-svg', role: 'img', 'aria-label': aria,
    });
    yT.ticks.forEach((t) => {
      svg.append(s('line', {
        x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'viz-axis' : 'viz-grid',
      }));
      svg.append(s('text', {
        x: m.l - 6, y: Y(t) + 3.5, 'text-anchor': 'end', class: 'viz-tick',
      }, String(t)));
    });
    const wrap = h('div', { class: 'viz viz-wrap' });
    wrap.append(svg);
    const tip = makeTip(wrap);
    const maxIdx = totals.indexOf(maxV);
    days.forEach((d, i) => {
      const cx = m.l + slot * i + slot / 2;
      const x = cx - bw / 2;
      // stacked segments bottom-up, 2px surface gap between them
      let base = 0;
      const nonZero = series.map((se, k) => (se.values[i] > 0 ? k : -1)).filter((k) => k >= 0);
      const topK = nonZero[nonZero.length - 1];
      series.forEach((se, k) => {
        const v = se.values[i];
        if (!(v > 0)) return;
        const y0 = Y(base); const y1 = Y(base + v);
        const gap = base > 0 ? 2 : 0;
        const hgt = Math.max(0, y0 - y1 - gap);
        const r = k === topK ? 4 : 0;
        if (hgt > 0) {
          svg.append(s('path', { d: barPath(x, y1, bw, hgt, r), class: 'viz-bar', style: `fill:${se.color}` }));
        }
        base += v;
      });
      // x label
      const isToday = i === n - 1;
      const showLabel = n <= 7 || (n - 1 - i) % 2 === 0;
      if (showLabel) {
        svg.append(s('text', {
          x: cx, y: HGT - m.b + 16, 'text-anchor': 'middle', class: `viz-tick${isToday ? ' viz-tick-strong' : ''}`,
        }, isToday ? '今天' : `${d.date.getMonth() + 1}/${d.date.getDate()}`));
      }
      // selective cap labels: today + the max
      if (totals[i] > 0 && (isToday || i === maxIdx)) {
        svg.append(s('text', {
          x: cx, y: Y(totals[i]) - 6, 'text-anchor': 'middle', class: 'viz-value',
        }, fmt(totals[i])));
      }
      // hit target = whole slot column
      const hit = s('rect', {
        x: m.l + slot * i, y: m.t, width: slot, height: ph, class: 'viz-hit', tabindex: '0', role: 'img',
        'aria-label': `${C.fmtDate(d.date)}：${series.map((se) => `${se.name} ${fmt(se.values[i])}${unit}`).join('，')}`,
      });
      const on = () => tip.show(hit, series.length > 1 ? `${fmt(totals[i])} ${unit}` : `${fmt(totals[i])} ${unit}`, C.fmtDate(d.date),
        series.length > 1 ? series.map((se) => ({ color: se.color, value: fmt(se.values[i]), label: se.name })) : null);
      hit.addEventListener('pointerenter', on);
      hit.addEventListener('focus', on);
      hit.addEventListener('click', on);
      hit.addEventListener('pointerleave', tip.hide);
      hit.addEventListener('blur', tip.hide);
      svg.append(hit);
    });
    return wrap;
  }

  function legend(series, shape = 'rect') {
    return h('div', { class: 'viz-legend' }, series.map((se) => h('span', { class: 'viz-legend-item' },
      h('i', { class: shape === 'line' ? 'viz-key-line' : 'viz-key-rect', style: { background: se.color } }), se.name)));
  }

  function dataTable(headers, rows) {
    return h('details', { class: 'viz-table' },
      h('summary', null, '查看數據表'),
      h('div', { class: 'viz-table-scroll' },
        h('table', null,
          h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))),
          h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))))));
  }

  const noBaby = (el) => {
    el.append(ui.empty('👶', '先建立寶寶資料，就能開始追蹤成長與健康。',
      h('button', { class: 'btn btn-primary', onclick: () => App.navigate('me') }, '新增寶寶資料')));
  };
  const needBaby = (render) => (el, params) => {
    const b = baby();
    if (!b || !b.birthday) { noBaby(el); return; }
    render(el, params, b);
  };

  /* =====================================================================
   * 健康 hub (tab)
   * ===================================================================== */
  function stageHeader() {
    const st = store().stage;
    const p = store().profile;
    if (st === 'baby') {
      const b = baby();
      if (!b) return null;
      const age = C.babyAge(b.birthday);
      return ui.card({ class: 'soft health-stage' },
        h('div', { class: 'row gap' },
          h('div', { class: 'health-avatar' }, b.avatar && b.avatar.length <= 4 ? b.avatar : '👶'),
          h('div', { class: 'grow' },
            h('div', { class: 'bold' }, b.name || '寶寶'),
            h('div', { class: 'small muted' }, [b.sex === 'boy' ? '男孩' : '女孩', age && age.text, age && age.dayText].filter(Boolean).join('・')))));
    }
    if (st === 'preg') {
      const ga = p.lmp ? C.gestAge(p.lmp) : null;
      return ui.card({ class: 'soft health-stage' },
        h('div', { class: 'row gap' }, h('div', { class: 'health-avatar' }, '🤰'),
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, '懷孕中'),
            h('div', { class: 'small muted' }, ga && ga.totalDays >= 0 ? `懷孕 ${ga.weeks} 週 ${ga.days} 天・還有 ${Math.max(0, ga.daysLeft)} 天` : '設定最後一次月經日，就能算孕週'))));
    }
    return ui.card({ class: 'soft health-stage' },
      h('div', { class: 'row gap' }, h('div', { class: 'health-avatar' }, '🌱'),
        h('div', { class: 'grow' }, h('div', { class: 'bold' }, '備孕中'),
          h('div', { class: 'small muted' }, '照顧好自己，為好孕做準備'))));
  }

  App.screen('health', {
    title: '健康',
    render(el) {
      const st = store().stage;
      if (st === 'baby' && !baby()) { noBaby(el); return; }
      const head = stageHeader();
      if (head) el.append(head);
      const tools = App.tools
        .filter((t) => store().inStage(t.stages))
        .sort((a, c) => (a.order ?? 50) - (c.order ?? 50));
      if (!tools.length) {
        el.append(ui.empty('🧰', '這個階段的工具準備中。'));
        return;
      }
      const groups = [];
      tools.forEach((t) => {
        const g = t.group || '更多工具';
        let grp = groups.find((x) => x.name === g);
        if (!grp) { grp = { name: g, tools: [] }; groups.push(grp); }
        grp.tools.push(t);
      });
      groups.forEach((g) => {
        el.append(h('div', { class: 'section-title' }, g.name));
        el.append(h('div', { class: 'grid-2' }, g.tools.map((t) => h('button', {
          class: 'tile', type: 'button', onclick: () => App.navigate(t.screen || t.id, t.params),
          style: t.color ? { borderTop: `3px solid ${t.color}` } : null,
        },
        h('span', { class: 'tile-icon' }, t.icon || '✨'),
        h('span', { class: 'tile-title' }, t.title),
        t.desc ? h('span', { class: 'tile-desc' }, t.desc) : null))));
      });
      el.append(h('p', { class: 'disclaimer' }, '本 App 內容僅供衛教參考，不能取代醫師診斷；如有任何身體不適，請儘速就醫。'));
    },
  });

  /* =====================================================================
   * 成長曲線
   * ===================================================================== */
  let growthMetric = 'weight';

  function openMeasureSheet(b, existing) {
    const inp = (attrs) => h('input', {
      type: 'number', inputmode: 'decimal', min: '0', ...attrs,
    });
    const date = h('input', { type: 'date', value: existing?.date || C.dateKey(), max: C.dateKey() });
    const w = inp({ step: '0.01', placeholder: '例：5.6', value: existing?.weight ?? '' });
    const l = inp({ step: '0.1', placeholder: '例：58.5', value: existing?.length ?? '' });
    const hc = inp({ step: '0.1', placeholder: '例：39', value: existing?.head ?? '' });
    let sh;
    const save = () => {
      const rec = {
        date: date.value || C.dateKey(),
        weight: w.value ? Number(w.value) : null,
        length: l.value ? Number(l.value) : null,
        head: hc.value ? Number(hc.value) : null,
      };
      if (!rec.weight && !rec.length && !rec.head) { ui.toast('請至少填一個數值'); return; }
      if (rec.weight && (rec.weight < 0.5 || rec.weight > 40)) { ui.toast('體重請用公斤（kg）填寫'); return; }
      if (rec.length && (rec.length < 25 || rec.length > 150)) { ui.toast('身長請用公分（cm）填寫'); return; }
      store().update((st) => {
        if (existing) Object.assign(st.growth.find((g) => g.id === existing.id) || {}, rec);
        else st.growth.push({ id: C.uid(), babyId: b.id, ...rec });
      });
      sh.close();
      ui.toast(existing ? '已更新測量' : '已新增測量');
    };
    const del = async () => {
      if (!(await ui.confirm('確定刪除這筆測量？', { ok: '刪除', danger: true }))) return;
      store().update((st) => { st.growth = st.growth.filter((g) => g.id !== existing.id); });
      sh.close();
      ui.toast('已刪除');
    };
    sh = ui.sheet({
      title: existing ? '編輯測量' : '新增測量',
      body: h('div', null,
        ui.field('測量日期', date),
        h('div', { class: 'grid-3' },
          ui.field('體重 (kg)', w),
          ui.field('身長 (cm)', l),
          ui.field('頭圍 (cm)', hc)),
        h('p', { class: 'small muted' }, '小提醒：在兒科或預防保健時量到的數字最準確。')),
      footer: h('div', { class: 'row gap' },
        existing ? h('button', { class: 'btn btn-ghost', onclick: del }, '刪除') : null,
        h('button', { class: 'btn btn-primary grow', onclick: save }, '儲存')),
    });
  }

  App.screen('growth', {
    title: '成長曲線',
    tab: 'health',
    actions: () => {
      const b = baby();
      return b ? h('button', { class: 'icon-btn', 'aria-label': '新增測量', html: ui.ICONS.plus, onclick: () => openMeasureSheet(b) }) : null;
    },
    render: needBaby((el, params, b) => {
      const latest = latestGrowth(b);
      // summary tiles
      el.append(h('div', { class: 'grid-3 growth-summary' }, Object.entries(H.GROWTH_METRICS).map(([k, def]) => {
        const v = latest[k];
        return h('button', {
          type: 'button', class: `growth-stat${growthMetric === k ? ' active' : ''}`,
          onclick: () => { growthMetric = k; App.refresh(); },
        },
        h('span', { class: 'growth-stat-label' }, def.label),
        h('span', { class: 'growth-stat-value' }, v ? fmtNum(v.value, def.digits) : '—', h('small', null, ` ${def.unit}`)),
        h('span', { class: 'growth-stat-pct' }, !v ? '尚無資料' : v.pct !== null ? pctShort(v.pct) : v.month > MAX_MONTH ? '5 歲以上' : '—'));
      })));

      const def = H.GROWTH_METRICS[growthMetric];
      const lv = latest[growthMetric];
      const chartCard = ui.card({ class: 'mt' },
        h('div', { class: 'row between' },
          h('div', null,
            h('div', { class: 'card-title' }, `${def.label}（${def.unit}）`),
            h('div', { class: 'card-sub' }, `依 WHO 兒童生長標準（近似值）・${b.sex === 'boy' ? '男孩' : '女孩'}`)),
          lv ? pctTag(lv.pct) : null),
        lv && lv.pct !== null ? h('p', { class: 'small mt' }, `最新${def.label} ${fmtNum(lv.value, def.digits)} ${def.unit}，${pctText(lv.pct)}。`) : null,
        lv && lv.pct === null && lv.month > MAX_MONTH ? h('p', { class: 'small mt' }, `最新${def.label} ${fmtNum(lv.value, def.digits)} ${def.unit}。WHO 兒童生長標準到 5 歲，曲線畫到 5 歲為止；之後的測量列在下方紀錄，可參考兒童健康手冊或學校健檢的生長曲線。`) : null,
        growthChart(b, growthMetric),
        h('div', { class: 'viz-legend' },
          h('span', { class: 'viz-legend-item' }, h('i', { class: 'viz-key-line viz-key-baby' }), b.name || '寶寶'),
          h('span', { class: 'viz-legend-item' }, h('i', { class: 'viz-key-rect viz-key-inner' }), 'P15–P85'),
          h('span', { class: 'viz-legend-item' }, h('i', { class: 'viz-key-rect viz-key-outer' }), 'P3–P97'),
          h('span', { class: 'viz-legend-item' }, h('i', { class: 'viz-key-line viz-key-ref' }), 'P50 中位數')));
      el.append(chartCard);
      if (lv && outOfBand(lv.pct)) {
        el.append(ui.card({ class: 'accent mt' }, h('p', { class: 'small' },
          `目前${def.label}落在第 3–97 百分位以外。單次數字不代表異常，重要的是長期趨勢；建議帶著紀錄和兒科醫師討論。`)));
      }

      // measurement list (also the table view)
      el.append(h('div', { class: 'section-title' }, '測量紀錄',
        h('button', { type: 'button', onclick: () => openMeasureSheet(b) }, '＋ 新增')));
      const rows = store().state.growth.filter((g) => g.babyId === b.id)
        .sort((a, c) => (a.date < c.date ? 1 : -1));
      const list = h('div', { class: 'list' });
      rows.forEach((g) => {
        const age = C.babyAge(b.birthday, C.parseKey(g.date));
        const mo = ageMonthsAt(b.birthday, g.date);
        const parts = Object.entries(H.GROWTH_METRICS)
          .filter(([, d]) => Number(g[d.field]) > 0)
          .map(([k, d]) => {
            const p = percentileOf(k, sexKey(b), mo, Number(g[d.field]));
            return `${d.label} ${fmtNum(g[d.field], d.digits)}${d.unit}${p !== null ? `（${pctShort(p)}）` : ''}`;
          });
        list.append(h('button', { type: 'button', class: 'list-item', onclick: () => openMeasureSheet(b, g) },
          h('span', { class: 'li-icon' }, '📏'),
          h('span', { class: 'li-body' },
            h('span', { class: 'li-title' }, `${fmtYMD(g.date)}・${age ? age.text : ''}`),
            h('span', { class: 'li-sub', style: { display: 'block' } }, parts.join('、'))),
          h('span', { class: 'li-right ic', html: ui.ICONS.chevron })));
      });
      if (b.birthWeight || b.birthLength) {
        list.append(h('div', { class: 'list-item' },
          h('span', { class: 'li-icon' }, '🎂'),
          h('span', { class: 'li-body' },
            h('span', { class: 'li-title' }, `${fmtYMD(b.birthday)}・出生`),
            h('span', { class: 'li-sub', style: { display: 'block' } },
              [b.birthWeight ? `體重 ${fmtNum(b.birthWeight, 2)}kg` : '', b.birthLength ? `身長 ${fmtNum(b.birthLength, 1)}cm` : ''].filter(Boolean).join('、'))),
          h('span', { class: 'li-right tiny' }, '來自寶寶資料')));
      }
      if (!rows.length && !b.birthWeight && !b.birthLength) {
        el.append(ui.empty('📏', '還沒有測量紀錄。每次量完身高體重記下來，就能看到成長曲線。',
          h('button', { class: 'btn btn-primary', onclick: () => openMeasureSheet(b) }, '新增第一筆測量')));
      } else {
        el.append(list);
      }
      el.append(h('p', { class: 'disclaimer' }, '百分位為依 WHO 兒童生長標準（0–5 歲）計算的近似值，僅供參考；5 歲以上請參考兒童健康手冊或學校健檢的生長曲線；早產兒請依矯正年齡並與醫師討論。'));
    }),
  });

  /* =====================================================================
   * 疫苗時程
   * ===================================================================== */
  function openDoneSheet({
    title, sub, note, doneDate, defaultDate, onSave, onClear,
  }) {
    const date = h('input', { type: 'date', value: doneDate || defaultDate || C.dateKey(), max: C.dateKey() });
    let sh;
    sh = ui.sheet({
      title,
      body: h('div', null,
        sub ? h('p', { class: 'muted small' }, sub) : null,
        note ? h('p', { class: 'small' }, note) : null,
        ui.field('完成日期', date)),
      footer: h('div', { class: 'row gap' },
        doneDate ? h('button', { class: 'btn btn-ghost', onclick: () => { onClear(); sh.close(); ui.toast('已取消標記'); } }, '取消標記') : null,
        h('button', { class: 'btn btn-primary grow', onclick: () => { onSave(date.value || C.dateKey()); sh.close(); ui.toast('已記錄完成'); } },
          doneDate ? '更新日期' : '標記為已完成')),
    });
  }

  let vacShowAll = false;
  const markVaccine = (v, b) => {
    const doneMap = store().state.vaccines[b.id] || {};
    const st = vaccineStatus(v, b, doneMap);
    openDoneSheet({
      title: `${v.name}`,
      sub: `${v.dose}・建議 ${fmtYMD(st.due)}（${monthsLabel(v.months)}）`,
      note: v.note,
      doneDate: doneMap[v.key],
      onSave: (d) => { store().update((S) => { S.vaccines[b.id] = { ...(S.vaccines[b.id] || {}), [v.key]: d }; }); ui.celebrate({ emojis: ['💉', '✨', '💪', '🌟'] }); },
      onClear: () => store().update((S) => { if (S.vaccines[b.id]) delete S.vaccines[b.id][v.key]; }),
    });
  };
  const markCheckup = (c, b) => {
    const doneMap = store().state.checkups[b.id] || {};
    const st = checkupStatus(c, b, doneMap);
    openDoneSheet({
      title: c.name,
      sub: `${fmtYMD(st.start)} – ${fmtYMD(st.end)}・${c.suggest}`,
      doneDate: doneMap[c.key],
      onSave: (d) => store().update((S) => { S.checkups[b.id] = { ...(S.checkups[b.id] || {}), [c.key]: d }; }),
      onClear: () => store().update((S) => { if (S.checkups[b.id]) delete S.checkups[b.id][c.key]; }),
    });
  };

  App.screen('vaccines', {
    title: '疫苗時程',
    tab: 'health',
    render: needBaby((el, params, b) => {
      const doneMap = store().state.vaccines[b.id] || {};
      const items = H.VACCINES.map((v) => ({ v, st: vaccineStatus(v, b, doneMap) }));
      const free = items.filter((x) => x.v.free && !x.v.conditional);
      const freeDone = free.filter((x) => x.st.key === 'done').length;
      const overdue = items.filter((x) => x.st.key === 'overdue').length;
      const nv = nextVaccine(b);

      el.append(ui.card({ class: 'card-hero' },
        h('div', { class: 'small muted' }, '公費疫苗進度'),
        h('div', { class: 'row between' },
          h('div', { class: 'big-num' }, `${freeDone} / ${free.length}`),
          overdue ? h('span', { class: 'tag danger' }, `${overdue} 劑逾期`) : null),
        ui.progress(free.length ? freeDone / free.length : 0),
        nv ? h('p', { class: 'small mt', style: { marginBottom: 0 } },
          `下一劑：${nv.v.name} ${nv.v.dose}・${fmtYMD(nv.st.due)}${nv.st.daysToDue > 0 ? `（還有 ${nv.st.daysToDue} 天）` : nv.st.key === 'overdue' ? '（已逾期）' : '（現在可接種）'}`) : null));

      // group by recommended month; by default hide groups that are all done or more than 6 months away
      const groups = C.groupBy(items, (x) => x.v.months);
      const horizon = C.addMonths(today(), 6);
      let hidden = 0;
      Object.keys(groups).map(Number).sort((a, c) => a - c).forEach((mo) => {
        if (!vacShowAll) {
          const allDone = groups[mo].every((x) => ['done', 'cond'].includes(x.st.key));
          const far = dueFrom(b.birthday, mo) > horizon;
          if (allDone || far) { hidden += groups[mo].length; return; }
        }
        const due = dueFrom(b.birthday, mo);
        el.append(h('div', { class: 'section-title' },
          h('span', null, mo === 60 ? '滿 5 歲至入國小前' : monthsLabel(mo)),
          h('span', { class: 'small muted', style: { fontWeight: 400 } }, fmtYMD(due))));
        const list = h('div', { class: 'list' });
        groups[mo].forEach(({ v, st }) => {
          list.append(h('button', {
            type: 'button', class: `list-item vac-item vac-${st.key}`,
            onclick: () => markVaccine(v, b),
          },
          h('span', { class: 'li-icon' }, st.key === 'done' ? '✅' : '💉'),
          h('span', { class: 'li-body' },
            h('span', { class: 'li-title', style: { display: 'block' } }, v.name),
            h('span', { class: 'li-sub', style: { display: 'block' } },
              `${v.dose}${v.free ? '' : '・自費'}${st.key === 'done' ? `・${fmtYMD(st.done)} 完成` : ''}`),
            v.note && st.key !== 'done' ? h('span', { class: 'tiny faint', style: { display: 'block' } }, v.note) : null),
          h('span', { class: 'li-right' }, h('span', { class: `tag ${st.cls}` }, st.label))));
        });
        el.append(list);
      });
      el.append(h('button', { class: 'btn btn-ghost btn-block mt', onclick: () => { vacShowAll = !vacShowAll; App.refresh(); } },
        vacShowAll ? '只看接下來半年' : `顯示全部時程（另有 ${hidden} 劑：已完成或半年後）`));
      el.append(h('p', { class: 'disclaimer' }, '實際時程以衛福部疾管署公告與醫師建議為準。自費疫苗是否接種，請與兒科醫師討論。'));
    }),
  });

  /* =====================================================================
   * 兒童預防保健
   * ===================================================================== */
  App.screen('checkups', {
    title: '兒童預防保健',
    tab: 'health',
    render: needBaby((el, params, b) => {
      const doneMap = store().state.checkups[b.id] || {};
      const items = H.CHECKUPS.map((c) => ({ c, st: checkupStatus(c, b, doneMap) }));
      const visits = items.filter((x) => x.c.kind === 'visit');
      const cur = items.find((x) => x.st.key === 'now');
      el.append(ui.card({ class: 'soft' },
        h('div', { class: 'card-title' }, '🩺 公費兒童預防保健 7 次'),
        h('p', { class: 'small muted', style: { marginBottom: 6 } }, '內容包含身體檢查、生長發育評估與衛教指導，可到健保特約的兒科或家醫科診所。'),
        h('div', { class: 'row between small' },
          h('span', null, `已完成 ${visits.filter((x) => x.st.key === 'done').length} / 7 次`),
          cur ? h('span', { class: 'tag warn' }, `現在可做：${cur.c.name.replace('兒童預防保健', '')}`) : null),
        ui.progress(visits.filter((x) => x.st.key === 'done').length / 7)));

      const render = (title, arr) => {
        el.append(h('div', { class: 'section-title' }, title));
        const list = h('div', { class: 'list' });
        arr.forEach(({ c, st }) => {
          list.append(h('button', {
            type: 'button', class: `list-item${st.key === 'now' ? ' is-current' : ''}`,
            onclick: () => markCheckup(c, b),
          },
          h('span', { class: 'li-icon' }, st.key === 'done' ? '✅' : c.kind === 'screen' ? '🧪' : '🩺'),
          h('span', { class: 'li-body' },
            h('span', { class: 'li-title', style: { display: 'block' } }, c.name),
            h('span', { class: 'li-sub', style: { display: 'block' } },
              st.key === 'done' ? `${fmtYMD(st.done)} 完成` : `${monthsLabel(c.start)}–${monthsLabel(c.end)}・${c.suggest}`)),
          h('span', { class: 'li-right' }, h('span', { class: `tag ${st.cls}` }, st.label))));
        });
        el.append(list);
      };
      render('新生兒篩檢', items.filter((x) => x.c.kind === 'screen'));
      render('預防保健 7 次', visits);
      el.append(h('p', { class: 'disclaimer' }, '時程依國民健康署兒童預防保健服務整理，實際以國健署公告為準。'));
    }),
  });

  /* =====================================================================
   * 預防保健時間表（疫苗＋兒童預防保健合併）
   * ===================================================================== */
  let prevTab = 'vaccines';
  function preventionTodo(b) {
    const vDone = store().state.vaccines[b.id] || {};
    const cDone = store().state.checkups[b.id] || {};
    const vac = H.VACCINES.filter((v) => !v.conditional).map((v) => ({ kind: 'v', v, st: vaccineStatus(v, b, vDone) }))
      .filter((x) => ['overdue', 'due', 'soon'].includes(x.st.key));
    const chk = H.CHECKUPS.map((c) => ({ kind: 'c', c, st: checkupStatus(c, b, cDone) })).filter((x) => x.st.key === 'now');
    const list = [...vac, ...chk];
    // always surface the next 公費 dose too, even when only 自費 doses are currently due
    if (!vac.some((x) => x.v.free)) { const nv = nextVaccine(b); if (nv && nv.st.key === 'upcoming') list.push({ kind: 'v', v: nv.v, st: nv.st, next: true }); }
    return list;
  }
  App.screen('prevention', {
    title: '預防保健',
    tab: 'health',
    render: needBaby((el, params, b) => {
      if (params.tab) prevTab = params.tab;
      const todo = preventionTodo(b);
      const card = ui.card({ class: 'soft prev-next' }, h('div', { class: 'card-title' }, '🗓️ 下一步要做的'),
        h('p', { class: 'tiny muted' }, '台灣常在同一次門診一起打疫苗、做兒童健檢，可以一起安排。'));
      if (!todo.length) card.append(h('p', { class: 'small' }, '目前沒有待辦的疫苗或健檢 👍'));
      else {
        card.append(h('div', { class: 'list' }, todo.map((x) => (x.kind === 'v'
          ? h('button', { type: 'button', class: 'list-item', onclick: () => markVaccine(x.v, b) },
            h('span', { class: 'li-icon' }, '💉'),
            h('span', { class: 'li-body' }, h('span', { class: 'li-title', style: { display: 'block' } }, `${x.v.name.replace(/（.*?）/g, '')} ${x.v.dose}`),
              h('span', { class: 'li-sub', style: { display: 'block' } }, `${x.next ? '下一劑・' : ''}建議 ${fmtYMD(x.st.due)}${x.v.free ? '' : '・自費'}`)),
            h('span', { class: 'li-right' }, h('span', { class: `tag ${x.st.cls}` }, x.st.label)))
          : h('button', { type: 'button', class: 'list-item', onclick: () => markCheckup(x.c, b) },
            h('span', { class: 'li-icon' }, x.c.kind === 'screen' ? '🧪' : '🩺'),
            h('span', { class: 'li-body' }, h('span', { class: 'li-title', style: { display: 'block' } }, x.c.name),
              h('span', { class: 'li-sub', style: { display: 'block' } }, `${fmtYMD(x.st.start)} – ${fmtYMD(x.st.end)}`)),
            h('span', { class: 'li-right' }, h('span', { class: `tag ${x.st.cls}` }, x.st.label)))))));
        card.append(h('p', { class: 'tiny faint mt' }, '點一下就能標記完成'));
      }
      el.append(card);
      el.append(h('div', { class: 'mt' }, ui.seg([{ value: 'vaccines', label: '💉 疫苗' }, { value: 'checkups', label: '🩺 兒童健檢' }], prevTab, (v) => { prevTab = v; App.refresh(); })));
      const box = h('div', { class: 'mt' });
      el.append(box);
      App.screens[prevTab].render(box, {});
    }),
  });

  /* =====================================================================
   * 發展里程碑
   * ===================================================================== */
  const openBands = new Set();
  App.screen('milestones', {
    title: '發展里程碑',
    tab: 'health',
    render: needBaby((el, params, b) => {
      const doneMap = store().state.milestones[b.id] || {};
      const age = Math.max(0, ageMonthsAt(b.birthday, today()));
      // current band = first band whose month >= age (the next checkpoint)
      const curIdx = Math.max(0, H.MILESTONES.findIndex((band) => band.months >= age));
      const total = C.sum(H.MILESTONES, (band) => band.items.length);
      const done = Object.keys(doneMap).length;
      el.append(ui.card({ class: 'soft' },
        h('div', { class: 'row between' },
          h('div', null, h('div', { class: 'card-title' }, '⭐ 發展里程碑'),
            h('div', { class: 'card-sub' }, `${b.name || '寶寶'} 目前 ${C.babyAge(b.birthday).text}`)),
          h('div', { class: 'big-num' }, `${done}`, h('small', { class: 'small muted' }, ` / ${total}`))),
        h('div', { class: 'chips mt' }, Object.values(H.MILESTONE_CATS).map((c) => h('span', { class: 'chip' }, `${c.icon} ${c.label}`)))));

      H.MILESTONES.forEach((band, i) => {
        const isCur = i === curIdx && H.MILESTONES.findIndex((x) => x.months >= age) !== -1;
        const isPast = band.months < age;
        const bandDone = band.items.filter(([k]) => doneMap[k]).length;
        const expanded = openBands.has(band.months) || isCur || (isPast && bandDone < band.items.length);
        const header = h('button', {
          type: 'button', class: 'ms-head', 'aria-expanded': String(expanded),
          onclick: () => { if (openBands.has(band.months)) openBands.delete(band.months); else openBands.add(band.months); App.refresh(); },
        },
        h('span', { class: 'ms-age' }, band.label),
        isCur ? h('span', { class: 'tag warn' }, '現階段') : null,
        h('span', { class: 'grow' }),
        h('span', { class: 'small muted' }, `${bandDone}/${band.items.length}`),
        h('span', { class: `ic ms-chev${expanded ? ' open' : ''}`, html: ui.ICONS.chevron }));
        const card = ui.card({ class: `ms-band${isCur ? ' is-current' : ''}` }, header,
          ui.progress(bandDone / band.items.length));
        if (expanded) {
          band.items.forEach(([key, cat, text]) => {
            const cb = h('input', {
              type: 'checkbox', checked: !!doneMap[key],
              onchange: (e) => {
                const on = e.target.checked;
                const at = (e.target.closest('label') || e.target).getBoundingClientRect(); // before the list redraws
                store().update((S) => {
                  const mm = { ...(S.milestones[b.id] || {}) };
                  if (on) mm[key] = C.dateKey(); else delete mm[key];
                  S.milestones[b.id] = mm;
                });
                if (on) { ui.toast('🎉 又長大一點了！'); ui.celebrate({ from: at, emojis: ['⭐', '🎉', '💜', '✨'] }); }
                if (on && App.share) setTimeout(() => App.share.moment(`ms-${b.id}-${key}`, { emoji: '⭐', msg: `${b.name} 新技能：${text}`, kind: 'milestone', force: true, mutedKey: 'milestone' }), 900);
              },
            });
            card.append(h('label', { class: 'check-row ms-item' }, cb,
              h('span', { class: 'grow' },
                h('span', { style: { display: 'block' } }, text),
                h('span', { class: 'tiny faint' }, `${H.MILESTONE_CATS[cat].icon} ${H.MILESTONE_CATS[cat].label}${doneMap[key] ? `・${fmtYMD(doneMap[key])} 達成` : ''}`))));
          });
        }
        el.append(card);
      });
      el.append(h('p', { class: 'disclaimer' }, '每個寶寶發展速度不同；若有疑慮請諮詢兒科醫師。項目參考兒童健康手冊與常見發展檢核，非診斷工具。'));
    }),
  });

  /* =====================================================================
   * 統計圖表
   * ===================================================================== */
  let statsRange = 7;
  const VIZ = {
    milk: 'var(--viz-2)', feeds: 'var(--viz-5)', sleep: 'var(--viz-1)', wet: 'var(--viz-1)', dirty: 'var(--viz-2)',
  };

  App.screen('stats', {
    title: '統計與報告',
    tab: 'health',
    actions: () => h('button', { class: 'icon-btn', 'aria-label': '照護報告（PDF）', html: ui.ICONS.print, onclick: () => App.navigate('report') }),
    render: needBaby((el, params, b) => {
      el.append(h('button', { class: 'btn btn-soft btn-block mb', onclick: () => App.navigate('report') }, '📄 產生照護報告（列印／存成 PDF 給醫師）'));
      const wk = weekCompare(b);
      if (wk) el.append(wk);
      el.append(h('div', { class: 'row stats-filter' },
        ui.seg([{ value: 7, label: '近 7 天' }, { value: 14, label: '近 14 天' }], statsRange,
          (v) => { statsRange = Number(v); App.refresh(); }, { small: true })));
      const st = dailyStats(b, statsRange);
      if (!st.hasData) {
        el.append(ui.empty('📊', '這段時間還沒有紀錄。到「紀錄」記下餵奶、尿布與睡眠，就會自動產生圖表。',
          h('button', { class: 'btn btn-primary', onclick: () => App.navigate('log') }, '去記錄')));
        return;
      }
      el.append(h('div', { class: 'grid-2 mt stat-tiles' },
        statTile('平均奶量', `${Math.round(st.avg.milk)}`, 'ml / 天'),
        statTile('平均餵奶', `${round(st.avg.feeds, 1)}`, '次 / 天'),
        statTile('平均睡眠', `${round(st.avg.sleepH, 1)}`, '小時 / 天'),
        statTile('平均尿布', `${round(st.avg.diapers, 1)}`, '片 / 天')));
      if (st.spanDays < statsRange) el.append(h('p', { class: 'tiny faint mt' }, `平均值以有紀錄的 ${st.spanDays} 天計算。`));

      const days = st.days;
      const chartCard = (title, sub, chart, extra, table) => ui.card({ class: 'mt' },
        h('div', { class: 'card-title' }, title), sub ? h('div', { class: 'card-sub' }, sub) : null, extra || null, chart, table || null);

      el.append(chartCard('🍼 每日瓶餵奶量', '母乳＋配方奶（ml）',
        barChart({
          days, series: [{ name: '奶量', color: VIZ.milk, values: days.map((d) => d.milk) }], unit: 'ml', aria: '每日瓶餵奶量長條圖',
        }),
        null, dataTable(['日期', '奶量 (ml)', '餵奶次數'], days.map((d) => [C.fmtDate(d.date), String(d.milk), String(d.feeds)]))));

      el.append(chartCard('🤱 每日餵奶次數', '親餵＋瓶餵',
        barChart({
          days, series: [{ name: '餵奶', color: VIZ.feeds, values: days.map((d) => d.feeds) }], unit: '次', aria: '每日餵奶次數長條圖',
        })));

      el.append(chartCard('😴 每日睡眠', '跨夜的睡眠會分到各自的日期（小時）',
        barChart({
          days, series: [{ name: '睡眠', color: VIZ.sleep, values: days.map((d) => d.sleepMs / C.HOUR) }], unit: '小時', digits: 1, aria: '每日睡眠時數長條圖',
        }), null, dataTable(['日期', '睡眠 (小時)'], days.map((d) => [C.fmtDate(d.date), fmtNum(d.sleepMs / C.HOUR, 1)]))));

      const diaperSeries = [
        { name: '濕尿布', color: VIZ.wet, values: days.map((d) => d.wet) },
        { name: '有便便', color: VIZ.dirty, values: days.map((d) => d.dirty) },
      ];
      el.append(chartCard('🧷 每日尿布', '濕尿布 vs 有便便（含尿＋便）',
        barChart({
          days, series: diaperSeries, unit: '片', aria: '每日尿布堆疊長條圖',
        }), legend(diaperSeries), dataTable(['日期', '濕尿布', '有便便'], days.map((d) => [C.fmtDate(d.date), String(d.wet), String(d.dirty)]))));
      el.append(h('p', { class: 'disclaimer' }, '新生兒一天約 6 片以上濕尿布通常代表喝得夠；若尿量明顯變少、精神差或發燒，請儘速就醫。'));
    }),
  });

  /* 本週重點：近 7 天 vs 前 7 天（每天平均，只算有紀錄的天） */
  function weekCompare(b) {
    const days = dailyStats(b, 14).days;
    const has = (d) => d.milk || d.feeds || d.sleepMs || d.wet || d.dirty;
    const prev = days.slice(0, 7).filter(has);
    const cur = days.slice(7).filter(has);
    if (cur.length < 3 || prev.length < 3) return null;
    const avg = (arr, f) => arr.reduce((x, d) => x + f(d), 0) / arr.length;
    const rows = [
      { label: '瓶餵奶量', unit: 'ml', f: (d) => d.milk, digits: 0 },
      { label: '餵奶次數', unit: '次', f: (d) => d.feeds, digits: 1 },
      { label: '睡眠', unit: '小時', f: (d) => d.sleepMs / C.HOUR, digits: 1 },
      { label: '尿布', unit: '片', f: (d) => d.wet + d.dirty, digits: 1 },
    ].map((r) => {
      const a = avg(cur, r.f); const p = avg(prev, r.f);
      const pct = p ? ((a - p) / p) * 100 : 0;
      return { ...r, a, p, pct };
    });
    const insights = [];
    const milk = rows[0]; const sleep = rows[2]; const diaper = rows[3];
    if (milk.p && milk.pct >= 8) insights.push(`奶量比上週多 ${Math.round(milk.pct)}%，寶寶胃口變大了`);
    if (milk.p && milk.pct <= -15) insights.push(`奶量比上週少 ${Math.round(-milk.pct)}%，若精神差或尿布變少請諮詢醫師`);
    if (Math.abs(sleep.a - sleep.p) >= 0.5) insights.push(`每天睡眠${sleep.a > sleep.p ? '多' : '少'}了 ${Math.abs(sleep.a - sleep.p).toFixed(1)} 小時`);
    if (diaper.p && diaper.pct <= -25) insights.push('尿布片數明顯變少，留意喝奶量與精神');
    if (!insights.length) insights.push('各項數字和上週差不多，作息很穩定 👍');
    return ui.card({ class: 'week-card' },
      h('div', { class: 'card-title' }, '📊 本週重點', h('span', { class: 'tiny muted' }, '近 7 天 vs 前 7 天・每天平均')),
      h('div', { class: 'week-rows' }, rows.map((r) => {
        const up = r.pct > 3; const down = r.pct < -3;
        return h('div', { class: 'week-row' },
          h('span', { class: 'week-label' }, r.label),
          h('span', { class: 'week-val num' }, `${fmtNum(r.a, r.digits)}`, h('small', null, ` ${r.unit}`)),
          h('span', { class: `week-delta num${up ? ' up' : down ? ' down' : ''}` }, up ? `▲ ${Math.round(r.pct)}%` : down ? `▼ ${Math.round(-r.pct)}%` : '持平'),
          h('span', { class: 'week-prev tiny muted num' }, `上週 ${fmtNum(r.p, r.digits)}`));
      })),
      h('ul', { class: 'week-insights small' }, insights.map((t) => h('li', null, t))),
      App.share ? h('div', { class: 'mt' }, App.share.button(() => ({
        sheetTitle: '分享本週重點', title: `${b.name} 本週重點`, campaign: 'week', emoji: '📊', kicker: '寶寶本週重點', theme: 'green',
        text: `【${b.name} 本週重點】\n${rows.map((r) => `${r.label} ${fmtNum(r.a, r.digits)} ${r.unit}/天（上週 ${fmtNum(r.p, r.digits)}）`).join('\n')}\n${insights.join('；')}`,
        lines: [...insights, ...rows.map((r) => `${r.label} 每天 ${fmtNum(r.a, r.digits)} ${r.unit}`)],
      }), { label: '分享本週重點', cls: 'btn btn-sm btn-ghost btn-block' })) : null);
  }

  function statTile(label, value, unit) {
    return h('div', { class: 'card flat stat-tile' },
      h('div', { class: 'small muted' }, label),
      h('div', { class: 'stat-tile-value' }, value, h('small', null, ` ${unit}`)));
  }

  /* =====================================================================
   * 照護報告 (printable / PDF)
   * ===================================================================== */
  App.screen('report', {
    title: '照護報告',
    tab: 'health',
    actions: () => h('button', { class: 'icon-btn', 'aria-label': '列印或存成 PDF', html: ui.ICONS.print, onclick: () => window.print() }),
    render: needBaby((el, params, b) => {
      const brand = window.BRAND || {};
      const age = C.babyAge(b.birthday);
      const st = dailyStats(b, 7);
      const latest = latestGrowth(b);
      const vacDone = store().state.vaccines[b.id] || {};
      const vacItems = H.VACCINES.map((v) => ({ v, st: vaccineStatus(v, b, vacDone) }));
      const msDone = store().state.milestones[b.id] || {};
      const chkDone = store().state.checkups[b.id] || {};
      const temps = store().babyLogs(b.id).filter((l) => l.type === 'temp')
        .sort((a, c) => new Date(c.start) - new Date(a.start)).slice(0, 10);

      const rep = h('article', { class: 'report' });
      const logo = brand.logoFull ? h('img', {
        src: brand.logoFull, alt: brand.brandName || '', class: 'report-logo',
      }) : null;
      if (logo) logo.addEventListener('error', () => logo.remove());
      rep.append(h('header', { class: 'report-head' },
        logo,
        h('div', { class: 'grow' },
          h('h2', null, `${b.name || '寶寶'}的照護報告`),
          h('div', { class: 'small muted' }, `${b.sex === 'boy' ? '男孩' : '女孩'}・${fmtYMD(b.birthday)} 出生・${age ? age.text : ''}`),
          h('div', { class: 'tiny faint' }, `產生日期 ${fmtYMD(new Date())}・${brand.appName || '易家做媽媽'}`))));

      const sec = (title, ...children) => h('section', { class: 'report-sec' }, h('h3', null, title), ...children);
      const table = (headers, rows, cls = '') => h('table', { class: `report-table ${cls}` },
        h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))),
        h('tbody', null, rows.length ? rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))
          : h('tr', null, h('td', { colspan: String(headers.length), class: 'faint' }, '尚無資料'))));

      rep.append(sec('近 7 天照護摘要',
        h('div', { class: 'report-kpis' },
          kpi('平均奶量', `${Math.round(st.avg.milk)} ml`, '每天'),
          kpi('平均餵奶', `${round(st.avg.feeds, 1)} 次`, '每天'),
          kpi('平均睡眠', `${round(st.avg.sleepH, 1)} 小時`, '每天'),
          kpi('平均尿布', `${round(st.avg.diapers, 1)} 片`, '每天')),
        table(['日期', '奶量 ml', '餵奶', '睡眠 h', '濕', '便'], st.days.map((d) => [
          C.fmtDate(d.date), String(d.milk), String(d.feeds), fmtNum(d.sleepMs / C.HOUR, 1), String(d.wet), String(d.dirty),
        ]))));

      const gRows = store().state.growth.filter((g) => g.babyId === b.id).sort((a, c) => (a.date > c.date ? 1 : -1));
      const birthRow = (b.birthWeight || b.birthLength) ? [[fmtYMD(b.birthday), '出生', fmtNum(b.birthWeight, 2), fmtNum(b.birthLength, 1), '—']] : [];
      rep.append(sec('成長紀錄',
        h('p', { class: 'small' }, Object.entries(H.GROWTH_METRICS).filter(([k]) => latest[k])
          .map(([k, d]) => `${d.label} ${fmtNum(latest[k].value, d.digits)} ${d.unit}（${pctText(latest[k].pct) || '—'}）`).join('；') || '尚無測量資料'),
        table(['日期', '月齡', '體重 kg', '身長 cm', '頭圍 cm'], [
          ...birthRow,
          ...gRows.map((g) => [fmtYMD(g.date), C.babyAge(b.birthday, C.parseKey(g.date))?.text || '', fmtNum(g.weight, 2), fmtNum(g.length, 1), fmtNum(g.head, 1)]),
        ]),
        h('p', { class: 'tiny faint' }, '百分位依 WHO 兒童生長標準（近似值）計算。')));

      const nb = (t) => String(t).replace(/ /g, '\u00a0'); // 「第 1 劑」 never splits across lines
      const vacDoneList = vacItems.filter((x) => x.st.key === 'done');
      const vacAttn = vacItems.filter((x) => ['overdue', 'due', 'soon'].includes(x.st.key));
      rep.append(sec('疫苗接種',
        // three columns so it fits a phone: 疫苗＋劑次 (wraps), 狀態 and 日期 (each on one line)
        table(['疫苗・劑次', '狀態', '日期'], [
          ...vacDoneList.map((x) => [`${x.v.name} ${nb(x.v.dose)}`, '已完成', fmtYMD(x.st.done)]),
          ...vacAttn.map((x) => [`${x.v.name} ${nb(x.v.dose)}`, x.st.label, fmtYMD(x.st.due)]),
        ], 'report-table-vac'),
        h('p', { class: 'tiny faint' }, '日期：已完成者為接種日，其他為建議接種日。')));

      rep.append(sec('兒童預防保健與篩檢',
        table(['項目', '狀態'], H.CHECKUPS.map((c) => [c.name, chkDone[c.key] ? `${fmtYMD(chkDone[c.key])} 完成` : '—']))));

      const msList = [];
      H.MILESTONES.forEach((band) => band.items.forEach(([k, cat, text]) => {
        if (msDone[k]) msList.push([band.label, `${H.MILESTONE_CATS[cat].label}：${text}`, fmtYMD(msDone[k])]);
      }));
      rep.append(sec('已達成的發展里程碑', table(['階段', '項目', '達成日'], msList)));

      rep.append(sec('最近體溫紀錄',
        table(['時間', '體溫'], temps.map((l) => [`${C.fmtDate(new Date(l.start), false)} ${C.fmtTime(l.start)}`, App.logSummary ? App.logSummary(l) : `${l.data?.c} °C`]))));

      rep.append(h('footer', { class: 'report-foot' },
        '本報告由家長自行記錄產生，僅供就醫時參考，不能取代醫師診斷。'));

      el.append(h('div', { class: 'row gap no-print mb' },
        h('button', { class: 'btn btn-primary grow', onclick: () => window.print() }, h('span', { class: 'ic', html: ui.ICONS.print }), '列印／存成 PDF')));
      el.append(h('p', { class: 'tiny faint no-print' }, '在列印視窗選「儲存為 PDF」，就能存檔或傳給家人、醫師。'));
      el.append(rep);
    }),
  });

  function kpi(label, value, sub) {
    return h('div', { class: 'report-kpi' }, h('span', { class: 'tiny muted' }, label), h('strong', null, value), h('span', { class: 'tiny faint' }, sub));
  }

  /* =====================================================================
   * tools (baby stage)
   * ===================================================================== */
  App.tool({
    id: 'growth', title: '成長曲線', icon: '📈', desc: '身高體重頭圍＋WHO 百分位', stages: ['baby'], screen: 'growth', order: 10, group: '成長發育',
  });
  App.tool({
    id: 'milestones', title: '發展里程碑', icon: '⭐', desc: '翻身、坐、爬、說話…', stages: ['baby'], screen: 'milestones', order: 12, group: '成長發育',
  });
  App.tool({
    id: 'prevention', title: '預防保健', icon: '💉', desc: '疫苗＋兒童健檢，先看下一步', stages: ['baby'], screen: 'prevention', order: 20, group: '預防保健',
  });
  App.tool({
    id: 'stats', title: '統計與報告', icon: '📊', desc: '趨勢圖表・一鍵 PDF 給醫師', stages: ['baby'], screen: 'stats', order: 30, group: '紀錄分析',
  });

  /* =====================================================================
   * home card
   * ===================================================================== */
  App.homeCard('baby-health', {
    stages: ['baby'],
    order: 30,
    render(el) {
      const b = baby();
      if (!b || !b.birthday) return;
      const nv = nextVaccine(b);
      const latest = latestGrowth(b);
      const row = (icon, title, sub, screen, right) => h('button', { type: 'button', class: 'hc-row', onclick: () => App.navigate(screen) },
        h('span', { class: 'hc-icon' }, icon),
        h('span', { class: 'grow' },
          h('span', { class: 'hc-title' }, title),
          h('span', { class: 'hc-sub' }, sub)),
        right || null,
        h('span', { class: 'ic faint', html: ui.ICONS.chevron }));
      const card = ui.card({ class: 'home-health' }, h('div', { class: 'card-title' }, '健康追蹤'));
      if (nv) {
        const when = nv.st.key === 'overdue' ? '已逾期' : nv.st.daysToDue > 0 ? `還有 ${nv.st.daysToDue} 天` : '現在可接種';
        card.append(row('💉', `下一劑：${nv.v.name.replace(/（.*?）/g, '')} ${nv.v.dose}`, `${fmtYMD(nv.st.due)}・${when}`, 'prevention',
          nv.st.cls ? h('span', { class: `tag ${nv.st.cls}` }, nv.st.label) : null));
      }
      const parts = ['weight', 'length'].filter((k) => latest[k]).map((k) => {
        const d = H.GROWTH_METRICS[k];
        return `${fmtNum(latest[k].value, d.digits)} ${d.unit}${latest[k].pct !== null ? `（${pctShort(latest[k].pct)}）` : ''}`;
      });
      card.append(row('📈', parts.length ? `最新：${parts.join('・')}` : '記錄第一次身高體重', parts.length ? `依 WHO 兒童生長標準・${fmtYMD((latest.weight || latest.length).date)}` : '看看寶寶落在哪個百分位', 'growth'));
      el.append(card);
    },
  });

  // expose helpers for other modules / tests
  App.health = {
    percentileOf, curveValue, vaccineStatus, nextVaccine, checkupStatus, dailyStats, latestGrowth, growthPoints, preventionTodo, weekCompare,
  };
}());
