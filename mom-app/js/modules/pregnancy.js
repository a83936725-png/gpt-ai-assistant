/* 備孕 + 懷孕 module
 * Screens: cycle, prepcheck, pregnancy, prenatal, kick, contraction, pregweight, hospitalbag
 * Home cards: prep-cycle, preg-week
 * Also exposes App.preg helpers for other modules (home, report). */
(function () {
  const App = window.App;
  const C = window.Core;
  const { h, s } = App;
  const { ui } = App;
  const D = App.PREG_DATA;
  const store = App.store;

  const DISCLAIMER = '內容為一般衛教資訊，不能取代專業醫療建議；身體有任何不適，請諮詢醫師。';
  const add = (el, ...kids) => ui.append(el, kids);
  const disclaimer = (extra) => h('p', { class: 'disclaimer' }, extra ? `${extra} ` : '', DISCLAIMER);
  const todayKey = () => C.dateKey();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ensure = (s0) => {
    s0.preg = s0.preg || {};
    s0.preg.kicks = s0.preg.kicks || [];
    s0.preg.contractions = s0.preg.contractions || [];
    s0.preg.weights = s0.preg.weights || [];
    s0.preg.prenatal = s0.preg.prenatal || {};
    s0.folic = s0.folic || { log: {} };
    s0.folic.log = s0.folic.log || {};
    s0.active = s0.active || {};
    s0.prepChecklist = s0.prepChecklist || {};
    s0.hospitalBag = s0.hospitalBag || {};
    return s0;
  };
  ensure(store.state);

  /* =========================================================
   * Shared helpers
   * ======================================================= */
  const pregLmp = () => {
    const p = store.state.profile;
    return p.lmp || (p.edd ? C.lmpFromEdd(p.edd) : '');
  };
  const pregEdd = () => {
    const p = store.state.profile;
    return p.edd || (p.lmp ? C.eddFromLmp(p.lmp) : '');
  };
  const weekInfo = (w) => D.WEEKS.find((x) => x.w === clamp(w, 4, 40));
  const trimesterLabel = (t) => ['', '第一孕期', '第二孕期', '第三孕期'][t] || '';
  const sizeText = (wk) => {
    const wt = wk.wt < 1 ? '不到\u00a01\u00a0g' : wk.wt >= 1000 ? `${(wk.wt / 1000).toFixed(1)}\u00a0kg` : `${wk.wt}\u00a0g`;
    return `約\u00a0${wk.len}\u00a0cm・${wt}`;
  };

  function nextPrenatal() {
    const lmp = pregLmp();
    if (!lmp) return null;
    const ga = C.gestAge(lmp);
    const done = store.state.preg.prenatal || {};
    const v = D.PRENATAL.find((x) => !done[x.key] && x.week >= ga.weeks);
    if (!v) return null;
    return { ...v, date: C.dateKey(C.addDays(lmp, v.week * 7)) };
  }

  /* ---------- cycle math ---------- */
  function sortedPeriods() {
    return [...(store.state.periods || [])].filter((p) => p.start).sort((a, b) => (a.start < b.start ? -1 : 1));
  }
  function periodEnd(p, periodLength) {
    return p.end || C.dateKey(C.addDays(p.start, periodLength - 1));
  }
  function cycleInfo(now = new Date()) {
    const prof = store.state.profile;
    const periods = sortedPeriods();
    const periodLength = Number(prof.periodLength) || 5;
    const cycleLength = C.avgCycleLength(periods, Number(prof.cycleLength) || 28);
    const last = periods[periods.length - 1] || null;
    if (!last) return { periods, periodLength, cycleLength, last: null };
    const today = C.dateKey(now);
    const cycleDay = C.diffDays(last.start, now) + 1;
    const late = cycleDay - 1 - cycleLength; // >0 means later than predicted
    const nextStart = C.dateKey(C.addDays(last.start, cycleLength));
    const ovulation = C.dateKey(C.addDays(nextStart, -14));
    const fertileStart = C.dateKey(C.addDays(ovulation, -5));
    const fertileEnd = C.dateKey(C.addDays(ovulation, 1));
    const inPeriod = today >= last.start && today <= periodEnd(last, periodLength);
    const inFertile = today >= fertileStart && today <= fertileEnd;
    let phase = 'follicular';
    if (inPeriod) phase = 'period';
    else if (today === ovulation) phase = 'ovulation';
    else if (inFertile) phase = 'fertile';
    else if (today > ovulation) phase = 'luteal';
    return {
      periods, periodLength, cycleLength, last, cycleDay, late, nextStart,
      daysToNext: C.diffDays(now, nextStart), ovulation, fertileStart, fertileEnd, inPeriod, inFertile, phase,
    };
  }
  const PHASE = {
    period: { label: '經期中', cls: 'pg-tag-period' },
    fertile: { label: '易孕期', cls: 'pg-tag-fertile' },
    ovulation: { label: '預測排卵日', cls: 'pg-tag-fertile' },
    luteal: { label: '黃體期', cls: '' },
    follicular: { label: '濾泡期', cls: '' },
  };

  // marks for one day: {period, pred, fertile, ovu}
  function dayMarker(info) {
    const { periods, periodLength, cycleLength, last } = info;
    const ranges = periods.map((p) => [p.start, periodEnd(p, periodLength)]);
    const ovus = new Set();
    const fertile = [];
    // past cycles: ovulation ≈ next start − 14
    for (let i = 1; i < periods.length; i += 1) {
      const ov = C.addDays(periods[i].start, -14);
      ovus.add(C.dateKey(ov));
      fertile.push([C.dateKey(C.addDays(ov, -5)), C.dateKey(C.addDays(ov, 1))]);
    }
    const preds = [];
    if (last) {
      for (let k = 1; k <= 8; k += 1) {
        const st = C.addDays(last.start, k * cycleLength);
        preds.push([C.dateKey(st), C.dateKey(C.addDays(st, periodLength - 1))]);
        const ov = C.addDays(st, -14);
        ovus.add(C.dateKey(ov));
        fertile.push([C.dateKey(C.addDays(ov, -5)), C.dateKey(C.addDays(ov, 1))]);
      }
    }
    const inR = (rs, k) => rs.some(([a, b]) => k >= a && k <= b);
    return (key) => {
      const period = inR(ranges, key);
      return {
        period,
        pred: !period && inR(preds, key),
        fertile: !period && inR(fertile, key),
        ovu: !period && ovus.has(key),
      };
    };
  }

  function folicStreak() {
    const log = store.state.folic.log || {};
    let d = new Date();
    if (!log[C.dateKey(d)]) d = C.addDays(d, -1);
    let n = 0;
    while (log[C.dateKey(d)]) { n += 1; d = C.addDays(d, -1); }
    return n;
  }
  function toggleFolic(key = todayKey()) {
    store.update((st) => {
      ensure(st);
      if (st.folic.log[key]) delete st.folic.log[key];
      else st.folic.log[key] = true;
    });
  }

  function folicRow() {
    const log = store.state.folic.log || {};
    const days = [];
    for (let i = 6; i >= 0; i -= 1) days.push(C.addDays(new Date(), -i));
    const tk = todayKey();
    const took = !!log[tk];
    return h('div', { class: 'pg-folic' },
      h('div', { class: 'row between' },
        h('div', null,
          h('div', { class: 'bold' }, '💊 葉酸打卡'),
          h('div', { class: 'small muted' }, `連續 ${folicStreak()} 天`)),
        h('button', {
          class: `btn btn-sm ${took ? 'btn-soft' : 'btn-primary'}`,
          'aria-pressed': String(took),
          onclick: (e) => { e.stopPropagation(); toggleFolic(); ui.toast(took ? '已取消今天的打卡' : '今天的葉酸打卡完成 ✓'); },
        }, took ? '✓ 今天吃了' : '今天吃了嗎？')),
      h('div', { class: 'pg-folic-dots', 'aria-label': '最近 7 天葉酸紀錄' },
        days.map((d) => {
          const k = C.dateKey(d);
          return h('div', { class: `pg-dot-day${log[k] ? ' on' : ''}${k === tk ? ' today' : ''}` },
            h('span', { class: 'pg-dot' }, log[k] ? '✓' : ''),
            h('span', { class: 'tiny faint' }, C.WEEKDAYS[d.getDay()]));
        })));
  }

  /* ---------- period logging sheet ---------- */
  function openPeriodSheet(key) {
    const tk = todayKey();
    if (key > tk) { ui.toast('不能記錄未來的日期'); return; }
    const info = cycleInfo();
    const { periodLength } = info;
    const periods = sortedPeriods();
    const inside = periods.find((p) => key >= p.start && key <= periodEnd(p, periodLength));
    const before = [...periods].reverse().find((p) => p.start < key && C.diffDays(p.start, key) <= 14);
    const body = h('div', { class: 'stack' });
    const sh = ui.sheet({ title: C.fmtDateLong(key), body });
    const act = (label, cls, fn) => h('button', { class: `btn btn-block ${cls}`, onclick: () => { fn(); sh.close(); } }, label);
    if (inside) {
      const n = C.diffDays(inside.start, key) + 1;
      body.append(h('p', { class: 'muted' }, `這天是經期第 ${n} 天（${C.fmtDate(inside.start, false)} 開始）。`));
      if (key !== inside.start) {
        body.append(act('設為這次經期的最後一天', 'btn-primary', () => {
          store.update((st) => { const p = st.periods.find((x) => x.id === inside.id); if (p) p.end = key; });
          ui.toast('已更新經期結束日');
        }));
      }
      body.append(act('把這天設為月經第一天', 'btn-ghost', () => {
        store.update((st) => { const p = st.periods.find((x) => x.id === inside.id); if (p) { p.start = key; if (p.end && p.end < key) p.end = null; } });
        ui.toast('已更新');
      }));
      body.append(act('刪除這次經期紀錄', 'btn-ghost pg-danger-text', () => {
        store.update((st) => { st.periods = st.periods.filter((x) => x.id !== inside.id); });
        ui.toast('已刪除');
      }));
    } else {
      body.append(act('🌸 記錄為月經第一天', 'btn-primary', () => {
        store.update((st) => { st.periods.push({ id: C.uid(), start: key, end: null }); });
        ui.toast('已記錄月經開始');
      }));
      if (before && (!before.end || before.end < key)) {
        body.append(act(`設為上次經期（${C.fmtDate(before.start, false)}）的最後一天`, 'btn-ghost', () => {
          store.update((st) => { const p = st.periods.find((x) => x.id === before.id); if (p) p.end = key; });
          ui.toast('已更新經期結束日');
        }));
      }
    }
  }

  function openLastPeriodSheet() {
    const input = h('input', { type: 'date', value: todayKey(), max: todayKey() });
    const sh = ui.sheet({
      title: '記錄最近一次月經',
      body: h('div', null, ui.field('月經第一天', input, '只要記得大概日期也可以，之後可以再修改')),
      footer: h('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => {
          if (!input.value) { ui.toast('請選擇日期'); return; }
          store.update((st) => { st.periods.push({ id: C.uid(), start: input.value, end: null }); });
          sh.close();
          ui.toast('已記錄，開始為你預測排卵日');
        },
      }, '儲存'),
    });
  }

  function openCycleSettings() {
    const p = store.state.profile;
    let cyc = Number(p.cycleLength) || 28;
    let per = Number(p.periodLength) || 5;
    const sh = ui.sheet({
      title: '週期設定',
      body: h('div', null,
        ui.field('平均週期長度（天）', ui.stepper({ value: cyc, step: 1, min: 20, max: 45, unit: '天', onChange: (v) => { cyc = v; } }), '有兩次以上紀錄後，會自動用你的實際紀錄計算'),
        ui.field('經期天數', ui.stepper({ value: per, step: 1, min: 2, max: 10, unit: '天', onChange: (v) => { per = v; } }))),
      footer: h('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => {
          store.update((st) => { st.profile.cycleLength = cyc; st.profile.periodLength = per; });
          sh.close(); ui.toast('已儲存');
        },
      }, '儲存'),
    });
  }

  /* =========================================================
   * Screen: cycle 經期與排卵
   * ======================================================= */
  let calMonth = null; // Date (1st of month) currently shown

  function cycleSummaryCard(info) {
    if (!info.last) {
      return ui.card({ class: 'soft' },
        h('div', { class: 'card-title' }, '🌸 開始記錄月經'),
        h('p', { class: 'small muted' }, '記錄月經第一天，就能預測下次月經、排卵日和易孕期。'),
        h('button', { class: 'btn btn-primary mt', onclick: openLastPeriodSheet }, '記錄最近一次月經'));
    }
    const ph = PHASE[info.phase];
    let nextText;
    let nextSub;
    if (info.late > 0) {
      nextText = `晚了 ${info.late} 天`;
      nextSub = '若有性行為，可考慮驗孕確認';
    } else if (info.daysToNext === 0) {
      nextText = '預計今天';
      nextSub = C.fmtDate(info.nextStart);
    } else {
      nextText = `${info.daysToNext} 天後`;
      nextSub = C.fmtDate(info.nextStart);
    }
    return ui.card({ class: 'pg-cycle-summary' },
      h('div', { class: 'row between' },
        h('div', null,
          h('div', { class: 'small muted' }, '目前週期'),
          h('div', { class: 'big-num' }, `第 ${info.cycleDay} 天`)),
        h('span', { class: `tag ${ph.cls}` }, ph.label)),
      info.inFertile ? h('div', { class: 'pg-fertile-banner' }, info.phase === 'ovulation' ? '✨ 今天是預測排卵日' : '🌿 今天在易孕期') : null,
      h('div', { class: 'grid-3 mt' },
        h('div', { class: 'pg-stat' }, h('div', { class: 'tiny muted' }, '下次月經'), h('div', { class: 'bold' }, nextText), h('div', { class: 'tiny faint' }, nextSub)),
        h('div', { class: 'pg-stat' }, h('div', { class: 'tiny muted' }, '易孕期'), h('div', { class: 'bold' }, `${C.fmtDate(info.fertileStart, false)}–${C.fmtDate(info.fertileEnd, false)}`), h('div', { class: 'tiny faint' }, `排卵 ${C.fmtDate(info.ovulation, false)}`)),
        h('div', { class: 'pg-stat' }, h('div', { class: 'tiny muted' }, '平均週期'), h('div', { class: 'bold' }, `${info.cycleLength} 天`), h('div', { class: 'tiny faint' }, `經期 ${info.periodLength} 天`))));
  }

  function calendarCard(info) {
    const now = new Date();
    if (!calMonth) calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const wrap = ui.card({ class: 'pg-cal-card' });
    const paint = () => {
      wrap.innerHTML = '';
      const mark = dayMarker(info);
      const y = calMonth.getFullYear();
      const m = calMonth.getMonth();
      const first = new Date(y, m, 1);
      const startOffset = first.getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const tk = todayKey();
      const grid = h('div', { class: 'pg-cal-grid', role: 'group', 'aria-label': '經期月曆' });
      C.WEEKDAYS.forEach((wd) => grid.append(h('div', { class: 'pg-cal-wd' }, wd)));
      for (let i = 0; i < startOffset; i += 1) grid.append(h('div', { class: 'pg-cal-blank' }));
      for (let d = 1; d <= daysInMonth; d += 1) {
        const key = C.dateKey(new Date(y, m, d));
        const mk = mark(key);
        const cls = ['pg-cal-day'];
        if (mk.period) cls.push('is-period');
        else if (mk.pred) cls.push('is-pred');
        if (mk.fertile) cls.push('is-fertile');
        if (mk.ovu) cls.push('is-ovu');
        if (key === tk) cls.push('is-today');
        if (key > tk) cls.push('is-future');
        const label = [`${m + 1}月${d}日`, mk.period && '經期', mk.pred && '預測經期', mk.ovu && '預測排卵日', mk.fertile && !mk.ovu && '易孕期'].filter(Boolean).join('，');
        grid.append(h('button', { class: cls.join(' '), 'aria-label': label, onclick: () => openPeriodSheet(key) },
          h('span', { class: 'pg-cal-num' }, d),
          mk.ovu ? h('span', { class: 'pg-cal-ovu' }, '●') : null));
      }
      wrap.append(
        h('div', { class: 'row between pg-cal-head' },
          h('button', { class: 'icon-btn', 'aria-label': '上個月', html: ui.ICONS.left, onclick: () => { calMonth = new Date(y, m - 1, 1); paint(); } }),
          h('div', { class: 'bold' }, `${y} 年 ${m + 1} 月`),
          h('button', { class: 'icon-btn', 'aria-label': '下個月', html: ui.ICONS.right, onclick: () => { calMonth = new Date(y, m + 1, 1); paint(); } })),
        grid,
        h('div', { class: 'pg-legend' },
          h('span', null, h('i', { class: 'pg-lg pg-lg-period' }), '經期'),
          h('span', null, h('i', { class: 'pg-lg pg-lg-pred' }), '預測經期'),
          h('span', null, h('i', { class: 'pg-lg pg-lg-fertile' }), '易孕期'),
          h('span', null, h('i', { class: 'pg-lg pg-lg-ovu' }), '排卵日')),
        h('p', { class: 'tiny faint center mt' }, '點日期即可記錄月經開始或結束'));
    };
    paint();
    return wrap;
  }

  function historyCard(info) {
    const ps = [...info.periods].reverse();
    if (!ps.length) return null;
    const asc = info.periods;
    return h('div', null,
      h('div', { class: 'section-title' }, '過去的週期'),
      h('div', { class: 'list' }, ps.slice(0, 12).map((p) => {
        const idx = asc.indexOf(p);
        const next = asc[idx + 1];
        const len = p.end ? C.diffDays(p.start, p.end) + 1 : null;
        const cyc = next ? C.diffDays(p.start, next.start) : null;
        return h('button', { class: 'list-item', onclick: () => openPeriodSheet(p.start) },
          h('div', { class: 'li-icon pg-li-period' }, '🌸'),
          h('div', { class: 'li-body' },
            h('div', { class: 'li-title' }, C.fmtDateLong(p.start)),
            h('div', { class: 'li-sub' }, [len ? `經期 ${len} 天` : (idx === asc.length - 1 && C.diffDays(p.start, new Date()) < info.periodLength ? '經期進行中' : `未記錄結束日（以 ${info.periodLength} 天計）`), cyc ? `週期 ${cyc} 天` : null].filter(Boolean).join('・'))),
          h('span', { class: 'li-right', html: ui.ICONS.chevron }));
      })));
  }

  function renderCycle(el) {
    ensure(store.state);
    const info = cycleInfo();
    add(el, 
      h('div', { class: 'stack' },
        cycleSummaryCard(info),
        ui.card(null, folicRow()),
        calendarCard(info)),
      h('div', { class: 'row gap mt' },
        info.last ? h('button', { class: 'btn btn-soft grow', onclick: () => openPeriodSheet(todayKey()) }, '🌸 記錄今天') : null,
        h('button', { class: 'btn btn-ghost grow', onclick: openCycleSettings }, '週期設定')),
      historyCard(info),
      disclaimer('排卵預測以「下次月經前 14 天」推估，週期不規律時誤差較大；若規律性行為一年仍未懷孕（35 歲以上為半年），建議尋求生殖醫學專科協助。'));
  }

  /* =========================================================
   * Screen: generic grouped checklist (prepcheck, hospitalbag)
   * ======================================================= */
  function renderChecklist(el, { groups, stateKey, intro, doneText }) {
    ensure(store.state);
    const st = store.state[stateKey] || {};
    const all = groups.flatMap((g) => g.items);
    const done = all.filter((i) => st[i.id]).length;
    add(el, 
      ui.card({ class: 'soft' },
        h('div', { class: 'row between' },
          h('div', { class: 'bold' }, intro),
          h('div', { class: 'bold num' }, `${done}/${all.length}`)),
        h('div', { class: 'mt' }, ui.progress(done / all.length)),
        done === all.length ? h('p', { class: 'small mt' }, doneText) : null),
      groups.map((g) => {
        const gd = g.items.filter((i) => st[i.id]).length;
        return h('div', null,
          h('div', { class: 'section-title' }, g.group, h('span', { class: 'small muted' }, `${gd}/${g.items.length}`)),
          h('div', { class: 'list pg-checklist' }, g.items.map((it) => {
            const cb = h('input', {
              type: 'checkbox', checked: !!st[it.id],
              onchange: () => store.update((s0) => { ensure(s0); if (cb.checked) s0[stateKey][it.id] = C.dateKey(); else delete s0[stateKey][it.id]; }),
            });
            return h('label', { class: `list-item pg-check${st[it.id] ? ' done' : ''}` },
              cb,
              h('div', { class: 'li-body' },
                h('div', { class: 'li-title' }, it.label),
                it.hint ? h('div', { class: 'li-sub' }, it.hint) : null));
          })));
      }),
      h('div', { class: 'row mt-lg' },
        h('button', {
          class: 'btn btn-ghost btn-sm',
          onclick: async () => {
            if (await ui.confirm('要清除全部勾選嗎？')) store.update((s0) => { s0[stateKey] = {}; });
          },
        }, '重設清單')));
  }

  /* =========================================================
   * Screen: pregnancy 孕期週記
   * ======================================================= */
  let viewWeek = null;

  function dueDateForm({ compact = false, onSaved } = {}) {
    const p = store.state.profile;
    let mode = p.edd && !p.lmp ? 'edd' : 'lmp';
    const input = h('input', { type: 'date', value: (mode === 'lmp' ? p.lmp : p.edd) || '' });
    const preview = h('p', { class: 'small muted pg-preview' });
    const label = h('span', { class: 'field-label' });
    const upd = () => {
      label.textContent = mode === 'lmp' ? '最後一次月經的第一天' : '預產期';
      const v = input.value;
      if (!v) { preview.textContent = '選好日期就會自動換算'; return; }
      const lmp = mode === 'lmp' ? v : C.lmpFromEdd(v);
      const edd = mode === 'lmp' ? C.eddFromLmp(v) : v;
      const ga = C.gestAge(lmp);
      preview.textContent = ga.totalDays < 0 || ga.totalDays > 44 * 7
        ? '日期好像不太對，請再確認一次'
        : `預產期 ${C.fmtDateLong(edd)}・目前 ${ga.weeks} 週 ${ga.days} 天`;
    };
    input.addEventListener('input', upd);
    const segc = ui.seg([{ value: 'lmp', label: '用最後月經' }, { value: 'edd', label: '用預產期' }], mode, (v) => {
      mode = v; input.value = (mode === 'lmp' ? store.state.profile.lmp : store.state.profile.edd) || ''; upd();
    });
    upd();
    const save = h('button', {
      class: 'btn btn-primary btn-block',
      onclick: () => {
        const v = input.value;
        if (!v) { ui.toast('請選擇日期'); return; }
        const lmp = mode === 'lmp' ? v : C.lmpFromEdd(v);
        const ga = C.gestAge(lmp);
        if (ga.totalDays < 0 || ga.totalDays > 44 * 7) { ui.toast('日期好像不太對，請再確認'); return; }
        store.update((st) => { st.profile.lmp = lmp; st.profile.edd = mode === 'lmp' ? C.eddFromLmp(v) : v; });
        viewWeek = null;
        ui.toast('已儲存');
        if (onSaved) onSaved();
      },
    }, '儲存');
    return h('div', { class: compact ? '' : 'stack' },
      segc,
      h('label', { class: 'field mt' }, label, input),
      preview,
      save);
  }

  function openDueDateSheet() {
    let sh = null;
    sh = ui.sheet({ title: '設定預產期', body: dueDateForm({ compact: true, onSaved: () => sh && sh.close() }) });
  }

  function weekCard(currentWeek) {
    const wrap = ui.card({ class: 'pg-week-card' });
    const paint = () => {
      const w = clamp(viewWeek ?? currentWeek, 4, 40);
      const wk = weekInfo(w);
      const slider = h('input', {
        type: 'range', min: 4, max: 40, step: 1, value: w, class: 'pg-slider', 'aria-label': '選擇孕週',
        oninput: (e) => { viewWeek = Number(e.target.value); paint(); },
      });
      wrap.innerHTML = '';
      wrap.append(
        h('div', { class: 'row between' },
          h('button', { class: 'icon-btn', 'aria-label': '上一週', html: ui.ICONS.left, disabled: w <= 4, onclick: () => { viewWeek = w - 1; paint(); } }),
          h('div', { class: 'center' },
            h('div', { class: 'bold pg-week-title' }, `第 ${w} 週`),
            w === currentWeek ? h('span', { class: 'tag primary' }, '本週') : h('button', { class: 'link-btn small', onclick: () => { viewWeek = null; paint(); } }, '回到本週')),
          h('button', { class: 'icon-btn', 'aria-label': '下一週', html: ui.ICONS.right, disabled: w >= 40, onclick: () => { viewWeek = w + 1; paint(); } })),
        slider,
        h('div', { class: 'pg-fruit' },
          h('div', { class: 'pg-fruit-emoji', 'aria-hidden': 'true' }, wk.emoji),
          h('div', null,
            h('div', { class: 'small muted' }, '寶寶大約像'),
            h('div', { class: 'pg-fruit-name' }, wk.fruit),
            h('div', { class: 'small muted num' }, sizeText(wk)))),
        h('div', { class: 'pg-week-info' },
          h('div', { class: 'pg-week-row' }, h('span', { class: 'pg-week-k' }, '👶 寶寶'), h('span', null, wk.baby)),
          h('div', { class: 'pg-week-row' }, h('span', { class: 'pg-week-k' }, '🤰 媽媽'), h('span', null, wk.mom)),
          h('div', { class: 'pg-week-row pg-tip' }, h('span', { class: 'pg-week-k' }, '💡 小提醒'), h('span', null, wk.tip))),
        h('p', { class: 'tiny faint mt' }, '大小為平均值參考；20 週前為頭臀長，20 週後為頭到腳跟的長度。'));
    };
    paint();
    return wrap;
  }

  function renderPregnancy(el) {
    ensure(store.state);
    const lmp = pregLmp();
    if (!lmp) {
      add(el, 
        ui.card({ class: 'soft' },
          h('div', { class: 'card-title' }, '🤰 先設定預產期'),
          h('p', { class: 'small muted' }, '輸入最後一次月經的第一天或醫師告訴你的預產期，就能看到每週的寶寶變化、產檢時程與倒數。'),
          h('div', { class: 'mt' }, dueDateForm())),
        disclaimer());
      return;
    }
    const ga = C.gestAge(lmp);
    const edd = pregEdd();
    if (ga.totalDays < 0 || ga.totalDays > 44 * 7) {
      add(el, ui.card({ class: 'soft' },
        h('div', { class: 'card-title' }, '日期需要確認'),
        h('p', { class: 'small muted' }, `目前的設定換算為 ${ga.weeks} 週，看起來不太對。`),
        h('button', { class: 'btn btn-primary mt', onclick: openDueDateSheet }, '重新設定預產期')));
      return;
    }
    const cw = clamp(ga.weeks, 4, 40);
    const np = nextPrenatal();
    add(el, 
      ui.card({ class: 'card-hero pg-hero' },
        h('div', { class: 'row between' },
          h('span', { class: 'pg-hero-tri' }, trimesterLabel(ga.trimester)),
          h('button', { class: 'pg-hero-edit', onclick: openDueDateSheet }, '修改')),
        h('div', { class: 'pg-hero-week' }, `懷孕 ${ga.weeks} 週 ${ga.days} 天`),
        h('div', { class: 'muted small' }, `預產期 ${C.fmtDateLong(edd)}`),
        h('div', { class: 'mt' }, ui.progress(ga.progress)),
        h('div', { class: 'row between mt small' },
          h('span', null, ga.daysLeft > 0 ? `距離預產期還有 ${ga.daysLeft} 天` : ga.daysLeft === 0 ? '就是今天！' : `已超過預產期 ${-ga.daysLeft} 天`),
          h('span', { class: 'num' }, `${Math.round(ga.progress * 100)}%`))),
      np ? ui.card({ class: 'tap pg-next-visit', onclick: () => App.navigate('prenatal') },
        h('div', { class: 'row gap' },
          h('div', { class: 'li-icon' }, '🩺'),
          h('div', { class: 'grow' },
            h('div', { class: 'bold' }, `下次產檢：第 ${np.no} 次（第 ${np.week} 週）`),
            h('div', { class: 'small muted' }, `約 ${C.fmtDate(np.date)}・${np.items[np.items.length > 1 ? 1 : 0]}`)),
          h('span', { class: 'faint', html: ui.ICONS.chevron }))) : null,
      h('div', { class: 'section-title' }, '每週寶寶變化'),
      weekCard(cw),
      h('div', { class: 'row gap-sm wrap mt pg-shortcuts' },
        h('button', { class: 'chip', onclick: () => App.navigate('kick') }, '👣 胎動'),
        h('button', { class: 'chip', onclick: () => App.navigate('pregweight') }, '⚖️ 體重'),
        h('button', { class: 'chip', onclick: () => App.navigate('journey') }, '🗺️ 路線圖'),
        h('button', { class: 'chip', onclick: () => App.navigate('health') }, '🧰 全部孕期工具')),
      h('button', {
        class: 'btn btn-accent btn-block mt-lg',
        onclick: async () => {
          if (App.journey) { App.journey.openBirthSheet(); return; } // 生產紀錄表單
          if (!(await ui.confirm('恭喜！要切換到「育兒」模式，開始記錄寶寶的生活嗎？', { ok: '寶寶出生了' }))) return;
          const secondBaby = store.state.profile.pregnantToo && store.state.babies.length > 0;
          store.update((st) => { st.profile.stage = 'baby'; st.profile.pregnantToo = false; });
          if (secondBaby || !store.state.babies.length) store.addBaby({ name: secondBaby ? '二寶' : '寶寶', birthday: todayKey() });
          ui.toast('恭喜你！可以到「我的」修改寶寶資料');
          App.navigate('home');
        },
      }, '🎉 寶寶出生了'),
      disclaimer());
  }

  /* =========================================================
   * Screen: prenatal 產檢時程
   * ======================================================= */
  function openVisitSheet(v, recDate) {
    const done = store.state.preg.prenatal[v.key];
    const notes = (store.state.preg.visitNotes || {})[v.key] || {};
    const input = h('input', { type: 'date', value: done || (recDate && recDate <= todayKey() ? recDate : todayKey()) });
    const num = (val, ph, label, step = '1') => h('input', { type: 'number', inputmode: 'decimal', step, value: val ?? '', placeholder: ph, 'aria-label': label, class: 'input' });
    const wIn = num(notes.weight, 'kg', '體重', '0.1');
    const fhrIn = num(notes.fhr, '次/分', '胎心');
    const sysIn = num(notes.sys, '收縮壓', '收縮壓');
    const diaIn = num(notes.dia, '舒張壓', '舒張壓');
    const noteIn = h('textarea', { rows: 2, placeholder: '醫師交代、下次要問的問題、檢查結果' }, notes.note || '');
    const sh = ui.sheet({
      title: `第 ${v.no} 次產檢`,
      body: h('div', null,
        h('p', { class: 'small muted' }, `建議週數：${v.range}（約第 ${v.week} 週）`),
        h('ul', { class: 'pg-items' }, v.items.map((t) => h('li', null, t))),
        ui.field('完成日期', input),
        h('div', { class: 'grid-2' }, ui.field('體重（kg）', wIn), ui.field('胎心（次/分）', fhrIn)),
        ui.field('血壓（mmHg）', h('div', { class: 'row gap-sm' }, sysIn, h('span', null, '/'), diaIn)),
        ui.field('醫師交代／備註', noteIn)),
      footer: h('div', { class: 'row gap' },
        done ? h('button', {
          class: 'btn btn-ghost grow',
          onclick: () => { store.update((st) => { delete st.preg.prenatal[v.key]; }); sh.close(); },
        }, '取消完成') : null,
        h('button', {
          class: 'btn btn-primary grow',
          onclick: () => {
            const day = input.value || todayKey();
            const rec = {
              weight: wIn.value ? Number(wIn.value) : null, fhr: fhrIn.value ? Number(fhrIn.value) : null,
              sys: sysIn.value ? Number(sysIn.value) : null, dia: diaIn.value ? Number(diaIn.value) : null, note: noteIn.value.trim(),
            };
            store.update((st) => {
              ensure(st);
              st.preg.prenatal[v.key] = day;
              st.preg.visitNotes = st.preg.visitNotes || {};
              st.preg.visitNotes[v.key] = rec;
              if (rec.weight) { // 產檢量的體重也放進孕期體重曲線
                st.preg.weights = st.preg.weights.filter((x) => x.date !== day);
                st.preg.weights.push({ id: C.uid(), date: day, kg: Math.round(rec.weight * 10) / 10 });
              }
            });
            sh.close();
            const flag = App.journeyAlert ? App.journeyAlert.levelOf([], [], rec) : { level: null };
            if (flag.level) setTimeout(() => App.journeyAlert.alertSheet(flag.level, flag.hits), 260);
            else ui.toast(`第 ${v.no} 次產檢完成 ✓`);
          },
        }, done ? '更新日期' : '標記完成')),
    });
  }

  function renderPrenatal(el) {
    ensure(store.state);
    const lmp = pregLmp();
    const done = store.state.preg.prenatal;
    const ga = lmp ? C.gestAge(lmp) : null;
    const np = nextPrenatal();
    const doneCount = D.PRENATAL.filter((v) => done[v.key]).length;
    add(el, 
      ui.card({ class: 'soft' },
        h('div', { class: 'row between' },
          h('div', null,
            h('div', { class: 'bold' }, '公費產前檢查'),
            h('div', { class: 'small muted' }, ga ? `目前 ${ga.weeks} 週 ${ga.days} 天` : '設定預產期後會幫你算出每次的日期')),
          h('div', { class: 'bold num' }, `${doneCount}/14`)),
        h('div', { class: 'mt' }, ui.progress(doneCount / 14)),
        !lmp ? h('button', { class: 'btn btn-primary btn-sm mt', onclick: openDueDateSheet }, '設定預產期') : null),
      h('div', { class: 'pg-timeline' }, D.PRENATAL.map((v) => {
        const date = lmp ? C.dateKey(C.addDays(lmp, v.week * 7)) : null;
        const isDone = !!done[v.key];
        const isNext = np && np.key === v.key;
        const overdue = !isDone && ga && v.week < ga.weeks;
        return h('button', { class: `pg-visit${isDone ? ' done' : ''}${isNext ? ' next' : ''}`, onclick: () => openVisitSheet(v, date) },
          h('div', { class: 'pg-visit-no', 'aria-hidden': 'true' }, isDone ? '✓' : v.no),
          h('div', { class: 'pg-visit-body' },
            h('div', { class: 'row between wrap gap-sm' },
              h('div', { class: 'bold' }, `第 ${v.no} 次・${v.range}`),
              h('div', { class: 'row gap-sm' },
                v.us ? h('span', { class: 'tag primary' }, '超音波') : null,
                isNext ? h('span', { class: 'tag warn' }, '下一次') : null,
                isDone ? h('span', { class: 'tag ok' }, `已完成 ${C.fmtDate(done[v.key], false)}`) : null,
                overdue ? h('span', { class: 'tag' }, '已過建議週數') : null)),
            date ? h('div', { class: 'small muted' }, `約 ${C.fmtDate(date)}（第 ${v.week} 週）`) : h('div', { class: 'small muted' }, `約第 ${v.week} 週`),
            h('ul', { class: 'pg-items small' }, v.items.map((t) => h('li', null, t)))));
      })),
      ui.card({ class: 'flat mt' },
        h('div', { class: 'card-title' }, '📘 公費產檢包含'),
        h('ul', { class: 'pg-items small' },
          h('li', null, '產前檢查 14 次（2023 年 7 月起由 10 次增加）'),
          h('li', null, '超音波 3 次（各孕期各一次）'),
          h('li', null, '妊娠糖尿病篩檢、貧血檢驗（24–28 週）'),
          h('li', null, '乙型鏈球菌篩檢（35–37 週）'),
          h('li', null, '孕婦產前健康照護衛教指導 2 次'))),
      disclaimer('實際項目與時程依國健署公告及醫師安排為準。'));
  }

  /* =========================================================
   * Screen: kick 胎動計數 (self-painting, liveUpdate:false)
   * ======================================================= */
  function renderKick(el) {
    ensure(store.state);
    const paint = () => {
      el.innerHTML = '';
      const act = store.state.active.kick;
      const goal = 10;
      if (act) {
        const count = act.count || 0;
        add(el, 
          ui.card({ class: 'center pg-kick-card' },
            h('div', { class: 'small muted' }, '這次已經數了'),
            h('div', { class: 'pg-kick-count num' }, h('span', null, count), h('small', null, ` / ${goal}`)),
            h('div', { class: 'small muted' }, '經過時間 ', h('span', { class: 'bold num', 'data-clock': act.start }, '00:00')),
            h('button', {
              class: 'pg-kick-btn', 'aria-label': '寶寶動了，加一次',
              onclick: () => {
                store.update((st) => { st.active.kick.count = (st.active.kick.count || 0) + 1; st.active.kick.last = new Date().toISOString(); });
                const n = store.state.active.kick.count;
                if (navigator.vibrate) navigator.vibrate(30);
                if (n === goal) ui.toast(`數到 ${goal} 次了！共花了 ${C.fmtDuration(Date.now() - new Date(act.start).getTime())}`, 3500);
                paint();
              },
            }, h('span', { class: 'pg-kick-emoji' }, '👣'), h('span', null, '動了！')),
            h('div', { class: 'row gap mt' },
              h('button', {
                class: 'btn btn-ghost btn-sm', disabled: !count,
                onclick: () => { store.update((st) => { st.active.kick.count = Math.max(0, (st.active.kick.count || 0) - 1); }); paint(); },
              }, '−1 修正'),
              h('button', {
                class: 'btn btn-ghost btn-sm',
                onclick: async () => { if (await ui.confirm('要放棄這次計數嗎？')) { store.update((st) => { delete st.active.kick; }); paint(); } },
              }, '放棄'),
              h('button', {
                class: 'btn btn-primary btn-sm grow',
                onclick: () => {
                  store.update((st) => {
                    const k = st.active.kick;
                    st.preg.kicks.push({ id: C.uid(), start: k.start, end: new Date().toISOString(), count: k.count || 0 });
                    delete st.active.kick;
                  });
                  ui.toast('已儲存這次胎動紀錄');
                  paint();
                },
              }, '完成並儲存'))));
      } else {
        add(el, ui.card({ class: 'center pg-kick-card' },
          h('div', { class: 'pg-kick-emoji-lg' }, '👣'),
          h('div', { class: 'bold' }, '找個安靜的時間，側躺或坐著'),
          h('p', { class: 'small muted' }, '每感覺到一次胎動（踢、翻身、伸展）就按一下。'),
          h('button', {
            class: 'btn btn-primary mt', onclick: () => {
              store.update((st) => { st.active.kick = { start: new Date().toISOString(), count: 0 }; });
              paint();
            },
          }, '開始數胎動')));
      }
      // history
      const list = [...store.state.preg.kicks].sort((a, b) => new Date(b.start) - new Date(a.start)).slice(0, 20);
      add(el, h('div', { class: 'section-title' }, '最近紀錄'));
      if (!list.length) add(el, ui.empty('🫶', '還沒有胎動紀錄'));
      else {
        add(el, h('div', { class: 'list' }, list.map((k) => {
          const dur = new Date(k.end) - new Date(k.start);
          return h('div', { class: 'list-item' },
            h('div', { class: 'li-icon' }, '👣'),
            h('div', { class: 'li-body' },
              h('div', { class: 'li-title' }, `${k.count} 次`),
              h('div', { class: 'li-sub' }, `${C.fmtDate(new Date(k.start))} ${C.fmtTime(k.start)}・用了 ${C.fmtDuration(dur, { seconds: true })}`)),
            h('button', {
              class: 'icon-btn', 'aria-label': '刪除', html: ui.ICONS.trash,
              onclick: async () => { if (await ui.confirm('刪除這筆紀錄？', { danger: true, ok: '刪除' })) { store.update((st) => { st.preg.kicks = st.preg.kicks.filter((x) => x.id !== k.id); }); paint(); } },
            }));
        })));
      }
      add(el, 
        ui.card({ class: 'flat mt' },
          h('div', { class: 'card-title' }, '💡 怎麼數胎動？'),
          h('ul', { class: 'pg-items small' },
            h('li', null, '一般從 28 週左右開始，每天固定一個寶寶比較活躍的時段（例如飯後）來數。'),
            h('li', null, '常見的方法是記錄感覺到 10 次胎動需要多久，並和平常的自己比較。'),
            h('li', null, '每個寶寶的節奏都不一樣，重點是「和平常相比」有沒有明顯改變。'))),
        ui.card({ class: 'pg-alert-danger mt' },
          h('div', { class: 'bold' }, '⚠️ 胎動明顯減少或感覺不對勁時'),
          h('p', { class: 'small' }, '不要等到隔天，請立即聯絡你的產檢醫師或醫院。')),
        disclaimer());
      App.updateTickers();
    };
    paint();
  }

  /* =========================================================
   * Screen: contraction 宮縮計時 (self-painting)
   * ======================================================= */
  function contractionStats(list, now = Date.now()) {
    const sorted = [...list].filter((c) => c.end).sort((a, b) => new Date(a.start) - new Date(b.start));
    const hourAgo = now - 60 * 60 * 1000;
    const inHour = sorted.filter((c) => new Date(c.start).getTime() >= hourAgo);
    const durs = inHour.map((c) => new Date(c.end) - new Date(c.start));
    const intervals = [];
    for (let i = 1; i < sorted.length; i += 1) {
      if (new Date(sorted[i].start).getTime() >= hourAgo) intervals.push(new Date(sorted[i].start) - new Date(sorted[i - 1].start));
    }
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const avgDur = avg(durs);
    const avgInt = avg(intervals);
    const span = inHour.length ? now - new Date(inHour[0].start).getTime() : 0;
    const regular = inHour.length >= 8 && avgInt && avgInt <= 5.5 * 60000 && avgDur >= 45000 && span >= 45 * 60000;
    const frequent = !regular && inHour.length >= 4 && avgInt && avgInt <= 10 * 60000;
    return { sorted, inHour, avgDur, avgInt, regular, frequent };
  }

  function renderContraction(el) {
    ensure(store.state);
    const paint = () => {
      el.innerHTML = '';
      const act = store.state.active.contraction;
      const list = store.state.preg.contractions;
      const st = contractionStats(list);
      const last = st.sorted[st.sorted.length - 1];
      add(el, ui.card({ class: 'center pg-con-card' },
        act
          ? h('div', null, h('div', { class: 'small muted' }, '宮縮中・持續'), h('div', { class: 'pg-con-clock num', 'data-clock': act.start }, '00:00'))
          : h('div', null, h('div', { class: 'small muted' }, last ? '距離上次宮縮開始' : '宮縮開始時按下按鈕'), h('div', { class: 'pg-con-clock num', 'data-clock': last ? last.start : null }, last ? '' : '--:--')),
        h('button', {
          class: `pg-con-btn${act ? ' on' : ''}`,
          onclick: () => {
            if (act) {
              store.update((s0) => { s0.preg.contractions.push({ id: C.uid(), start: s0.active.contraction.start, end: new Date().toISOString() }); delete s0.active.contraction; });
            } else {
              store.update((s0) => { s0.active.contraction = { start: new Date().toISOString() }; });
            }
            if (navigator.vibrate) navigator.vibrate(30);
            paint();
          },
        }, act ? '宮縮結束' : '宮縮開始'),
        h('div', { class: 'grid-3 mt' },
          h('div', { class: 'pg-stat' }, h('div', { class: 'tiny muted' }, '1 小時內'), h('div', { class: 'bold num' }, `${st.inHour.length} 次`)),
          h('div', { class: 'pg-stat' }, h('div', { class: 'tiny muted' }, '平均持續'), h('div', { class: 'bold num' }, st.avgDur ? C.fmtClock(st.avgDur) : '--')),
          h('div', { class: 'pg-stat' }, h('div', { class: 'tiny muted' }, '平均間隔'), h('div', { class: 'bold num' }, st.avgInt ? C.fmtClock(st.avgInt) : '--')))));
      if (st.regular) {
        add(el, ui.card({ class: 'pg-alert-warn mt' },
          h('div', { class: 'bold' }, '⏰ 宮縮已經接近規律'),
          h('p', { class: 'small' }, '過去一小時大約每 5 分鐘一次、每次約 1 分鐘（常說的「5-1-1」）。建議聯絡你的產檢醫院，依指示準備前往。經產婦或住得較遠的人可以更早出發。')));
      } else if (st.frequent) {
        add(el, ui.card({ class: 'soft mt' },
          h('div', { class: 'bold' }, '宮縮變頻繁了'),
          h('p', { class: 'small muted' }, '持續記錄並觀察，若變得規律、越來越強，或有任何不舒服，請聯絡醫院。')));
      }
      add(el, ui.card({ class: 'pg-alert-danger mt' },
        h('div', { class: 'bold' }, '🚑 這些狀況請立即就醫'),
        h('p', { class: 'small' }, '破水、陰道出血、胎動明顯減少、持續劇烈腹痛，或未滿 37 週就出現規律宮縮。')));

      const recent = [...st.sorted].reverse().filter((c) => Date.now() - new Date(c.start) < 24 * 3600 * 1000).slice(0, 30);
      add(el, h('div', { class: 'section-title' }, '最近 24 小時',
        recent.length ? h('button', {
          onclick: async () => { if (await ui.confirm('要清除所有宮縮紀錄嗎？', { danger: true, ok: '清除' })) { store.update((s0) => { s0.preg.contractions = []; }); paint(); } },
        }, '清除全部') : null));
      if (!recent.length) add(el, ui.empty('⏱️', '還沒有宮縮紀錄'));
      else {
        const asc = st.sorted;
        add(el, h('div', { class: 'list pg-con-table' },
          h('div', { class: 'pg-con-row pg-con-th' }, h('span', null, '開始'), h('span', null, '持續'), h('span', null, '間隔')),
          recent.map((c) => {
            const i = asc.indexOf(c);
            const prev = asc[i - 1];
            const interval = prev ? new Date(c.start) - new Date(prev.start) : null;
            return h('div', { class: 'pg-con-row' },
              h('span', { class: 'num' }, C.fmtTime(c.start)),
              h('span', { class: 'num' }, C.fmtClock(new Date(c.end) - new Date(c.start))),
              h('span', { class: 'num' }, interval && interval < 3 * 3600 * 1000 ? C.fmtClock(interval) : '—'));
          })));
      }
      add(el, disclaimer('間隔為「這次開始」到「上次開始」的時間。'));
      App.updateTickers();
    };
    paint();
  }

  /* =========================================================
   * Screen: pregweight 孕期體重
   * ======================================================= */
  function bmiInfo(bmi) {
    // Taiwan category label (衛福部: <18.5 過輕, 18.5–24 正常, 24–27 過重, ≥27 肥胖)
    const tw = bmi < 18.5 ? '體重過輕' : bmi < 24 ? '健康體位' : bmi < 27 ? '過重' : '肥胖';
    // IOM 2009 total gain recommendation (singleton), IOM BMI cutoffs
    let iom;
    if (bmi < 18.5) iom = { low: 12.5, high: 18, rate: '0.44–0.58' };
    else if (bmi < 25) iom = { low: 11.5, high: 16, rate: '0.35–0.50' };
    else if (bmi < 30) iom = { low: 7, high: 11.5, rate: '0.23–0.33' };
    else iom = { low: 5, high: 9, rate: '0.17–0.27' };
    return { tw, ...iom };
  }
  // recommended band at gestational week w (first trimester 0.5–2 kg, then linear to total)
  const bandAt = (w, low, high) => (w <= 13
    ? [0.5 * (w / 13), 2 * (w / 13)]
    : [0.5 + (low - 0.5) * ((w - 13) / 27), 2 + (high - 2) * ((w - 13) / 27)]);

  function weightChart(points, b) {
    const W = 340; const H = 220;
    const m = { l: 34, r: 12, t: 14, b: 28 };
    const iw = W - m.l - m.r; const ih = H - m.t - m.b;
    const gains = points.map((p) => p.gain);
    const yMin = Math.min(0, Math.floor(Math.min(...gains, 0)) - 1);
    const yMax = Math.max(b.high + 2, Math.ceil(Math.max(...gains, 0)) + 1);
    const x = (w) => m.l + (w / 40) * iw;
    const y = (g) => m.t + ih - ((g - yMin) / (yMax - yMin)) * ih;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pg-chart', role: 'img', 'aria-label': '孕期體重增加圖' });
    // grid + y labels
    const step = yMax - yMin > 16 ? 4 : 2;
    for (let g = Math.ceil(yMin / step) * step; g <= yMax; g += step) {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(g), y2: y(g), class: g === 0 ? 'pg-axis' : 'pg-grid' }));
      svg.append(s('text', { x: m.l - 6, y: y(g) + 4, 'text-anchor': 'end', class: 'pg-tick' }, g > 0 ? `+${g}` : g));
    }
    [0, 8, 16, 24, 32, 40].forEach((w) => {
      svg.append(s('text', { x: x(w), y: H - 8, 'text-anchor': 'middle', class: 'pg-tick' }, `${w}週`));
    });
    // band
    const ws = [0, 13, 20, 30, 40];
    const up = ws.map((w) => `${x(w)},${y(bandAt(w, b.low, b.high)[1])}`);
    const lo = ws.slice().reverse().map((w) => `${x(w)},${y(bandAt(w, b.low, b.high)[0])}`);
    svg.append(s('polygon', { points: [...up, ...lo].join(' '), class: 'pg-band' }));
    svg.append(s('polyline', { points: up.join(' '), class: 'pg-band-edge' }));
    svg.append(s('polyline', { points: ws.map((w) => `${x(w)},${y(bandAt(w, b.low, b.high)[0])}`).join(' '), class: 'pg-band-edge' }));
    svg.append(s('text', { x: x(37), y: y((bandAt(37, b.low, b.high)[0] + bandAt(37, b.low, b.high)[1]) / 2) + 4, 'text-anchor': 'end', class: 'pg-band-label' }, '建議範圍'));
    // series
    const pts = points.filter((p) => p.week >= 0 && p.week <= 42).sort((a, c) => a.week - c.week);
    if (pts.length > 1) svg.append(s('polyline', { points: pts.map((p) => `${x(Math.min(p.week, 40))},${y(p.gain)}`).join(' '), class: 'pg-line' }));
    const tip = h('div', { class: 'pg-tip-box', role: 'status' });
    const wrap = h('div', { class: 'pg-chart-wrap' }, svg, tip);
    pts.forEach((p) => {
      const cx = x(Math.min(p.week, 40)); const cy = y(p.gain);
      svg.append(s('circle', { cx, cy, r: 4, class: 'pg-dot-mark' }));
      const show = () => {
        tip.textContent = `第 ${Math.floor(p.week)} 週・${p.kg} kg（${p.gain >= 0 ? '+' : ''}${p.gain.toFixed(1)} kg）`;
        tip.style.left = `${(cx / W) * 100}%`;
        tip.style.top = `${(cy / H) * 100}%`;
        tip.classList.add('show');
      };
      svg.append(s('circle', {
        cx, cy, r: 12, class: 'pg-hit', tabindex: 0, 'aria-label': `第 ${Math.floor(p.week)} 週 ${p.kg} 公斤`,
        onpointerenter: show, onfocus: show, onclick: show,
        onpointerleave: () => tip.classList.remove('show'), onblur: () => tip.classList.remove('show'),
      }));
    });
    return wrap;
  }

  function openWeightSheet() {
    const ws = store.state.preg.weights;
    const lastKg = ws.length ? [...ws].sort((a, b) => (a.date < b.date ? 1 : -1))[0].kg : Number(store.state.profile.prePregWeight) || 55;
    let kg = lastKg;
    const date = h('input', { type: 'date', value: todayKey(), max: todayKey() });
    const sh = ui.sheet({
      title: '記錄體重',
      body: h('div', null,
        ui.field('日期', date),
        ui.field('體重', ui.stepper({ value: kg, step: 0.1, min: 30, max: 200, unit: 'kg', onChange: (v) => { kg = v; } }))),
      footer: h('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => {
          if (!kg || !date.value) { ui.toast('請輸入體重與日期'); return; }
          store.update((st) => {
            ensure(st);
            st.preg.weights = st.preg.weights.filter((w) => w.date !== date.value);
            st.preg.weights.push({ id: C.uid(), date: date.value, kg: Math.round(kg * 10) / 10 });
          });
          sh.close(); ui.toast('已記錄');
        },
      }, '儲存'),
    });
  }

  function openBodySheet() {
    const p = store.state.profile;
    const hIn = h('input', { type: 'number', inputmode: 'decimal', value: p.heightCm || '', placeholder: '例如 160', min: 120, max: 200 });
    const wIn = h('input', { type: 'number', inputmode: 'decimal', value: p.prePregWeight || '', placeholder: '例如 52', min: 30, max: 200, step: 0.1 });
    const sh = ui.sheet({
      title: '身高與孕前體重',
      body: h('div', null, ui.field('身高（cm）', hIn), ui.field('懷孕前體重（kg）', wIn)),
      footer: h('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => {
          const hv = Number(hIn.value); const wv = Number(wIn.value);
          if (!(hv > 100 && hv < 230) || !(wv > 25 && wv < 250)) { ui.toast('請輸入正確的身高與體重'); return; }
          store.update((st) => { st.profile.heightCm = hv; st.profile.prePregWeight = wv; });
          sh.close();
        },
      }, '儲存'),
    });
  }

  function renderPregWeight(el) {
    ensure(store.state);
    const p = store.state.profile;
    const hcm = Number(p.heightCm); const pre = Number(p.prePregWeight);
    if (!hcm || !pre) {
      add(el, ui.card({ class: 'soft' },
        h('div', { class: 'card-title' }, '⚖️ 先輸入身高和孕前體重'),
        h('p', { class: 'small muted' }, '用來計算你的 BMI 和建議的孕期增重範圍。'),
        h('button', { class: 'btn btn-primary mt', onclick: openBodySheet }, '輸入資料')), disclaimer());
      return;
    }
    const bmi = pre / ((hcm / 100) ** 2);
    const b = bmiInfo(bmi);
    const lmp = pregLmp();
    const ws = [...store.state.preg.weights].sort((a, c) => (a.date < c.date ? -1 : 1));
    const points = lmp ? ws.map((w) => ({ ...w, week: C.diffDays(lmp, w.date) / 7, gain: w.kg - pre })) : [];
    const latest = ws[ws.length - 1];
    const ga = lmp ? C.gestAge(lmp) : null;
    let status = null;
    if (latest && lmp) {
      const wk = C.diffDays(lmp, latest.date) / 7;
      const [lo, hi] = bandAt(clamp(wk, 0, 40), b.low, b.high);
      const g = latest.kg - pre;
      status = g < lo - 0.3 ? { cls: 'warn', text: '低於建議範圍' } : g > hi + 0.3 ? { cls: 'warn', text: '高於建議範圍' } : { cls: 'ok', text: '在建議範圍內' };
    }
    add(el, 
      ui.card(null,
        h('div', { class: 'row between' },
          h('div', null,
            h('div', { class: 'small muted' }, '目前增加'),
            h('div', { class: 'big-num' }, latest ? `${latest.kg - pre >= 0 ? '+' : ''}${(latest.kg - pre).toFixed(1)} kg` : '—'),
            latest ? h('div', { class: 'small muted' }, `${latest.kg} kg・${C.fmtDate(latest.date)}`) : h('div', { class: 'small muted' }, '還沒有紀錄')),
          status ? h('span', { class: `tag ${status.cls}` }, status.text) : null),
        h('div', { class: 'grid-3 mt' },
          h('div', { class: 'pg-stat' }, h('div', { class: 'tiny muted' }, '孕前 BMI'), h('div', { class: 'bold num' }, bmi.toFixed(1)), h('div', { class: 'tiny faint' }, b.tw)),
          h('div', { class: 'pg-stat' }, h('div', { class: 'tiny muted' }, '建議總增重'), h('div', { class: 'bold num' }, `${b.low}–${b.high}`), h('div', { class: 'tiny faint' }, 'kg・整個孕期')),
          h('div', { class: 'pg-stat' }, h('div', { class: 'tiny muted' }, '中後期每週'), h('div', { class: 'bold num' }, `${b.rate}`), h('div', { class: 'tiny faint' }, 'kg／週'))),
        h('div', { class: 'row gap mt' },
          h('button', { class: 'btn btn-primary grow', onclick: openWeightSheet }, '＋ 記錄體重'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: openBodySheet }, '修改身高體重'))),
      h('div', { class: 'section-title' }, '孕期體重增加（kg）', ga ? h('span', { class: 'small muted' }, `目前 ${ga.weeks} 週`) : null),
      lmp
        ? ui.card({ class: 'pg-chart-card' }, weightChart(points, b), !points.length ? h('p', { class: 'small muted center' }, '記錄體重後，這裡會畫出你的增重曲線') : null)
        : ui.card({ class: 'soft' }, h('p', { class: 'small' }, '設定預產期後，才能把體重對應到孕週。'), h('button', { class: 'btn btn-primary btn-sm mt', onclick: openDueDateSheet }, '設定預產期')),
      ws.length ? h('div', null,
        h('div', { class: 'section-title' }, '紀錄'),
        h('div', { class: 'list' }, [...ws].reverse().map((w) => h('div', { class: 'list-item' },
          h('div', { class: 'li-body' },
            h('div', { class: 'li-title num' }, `${w.kg} kg`),
            h('div', { class: 'li-sub' }, `${C.fmtDate(w.date)}${lmp ? `・第 ${Math.floor(C.diffDays(lmp, w.date) / 7)} 週` : ''}`)),
          h('div', { class: 'li-right num' }, `${w.kg - pre >= 0 ? '+' : ''}${(w.kg - pre).toFixed(1)}`),
          h('button', {
            class: 'icon-btn', 'aria-label': '刪除', html: ui.ICONS.trash,
            onclick: async () => { if (await ui.confirm('刪除這筆體重？', { danger: true, ok: '刪除' })) store.update((st) => { st.preg.weights = st.preg.weights.filter((x) => x.id !== w.id); }); },
          }))))) : null,
      disclaimer('建議範圍參考美國醫學研究院（IOM 2009）單胞胎建議，並用 IOM 的 BMI 分級（25、30）計算；BMI 分類文字採台灣標準（24、27）。雙胞胎或特殊狀況請依醫師建議。'));
  }

  /* =========================================================
   * Registration
   * ======================================================= */
  App.screen('cycle', { title: '經期與排卵', tab: 'health', render: renderCycle });
  App.screen('prepcheck', {
    title: '孕前準備清單',
    tab: 'health',
    render: (el) => {
      renderChecklist(el, { groups: D.PREP_CHECKLIST, stateKey: 'prepChecklist', intro: '孕前準備進度', doneText: '🎉 都準備好了！好孕會來的。' });
      add(el, disclaimer());
    },
  });
  App.screen('pregnancy', { title: '孕期週記', tab: 'health', render: renderPregnancy });
  App.screen('prenatal', { title: '產檢時程', tab: 'health', render: renderPrenatal });
  App.screen('kick', { title: '胎動計數', tab: 'health', liveUpdate: false, render: renderKick });
  App.screen('contraction', { title: '宮縮計時', tab: 'health', liveUpdate: false, render: renderContraction });
  App.screen('pregweight', { title: '孕期體重', tab: 'health', render: renderPregWeight });
  App.screen('hospitalbag', {
    title: '待產包清單',
    tab: 'health',
    render: (el) => renderChecklist(el, { groups: D.HOSPITAL_BAG, stateKey: 'hospitalBag', intro: '待產包準備進度', doneText: '🎒 全部準備好了！放在門口隨時出發。' }),
  });

  [
    { id: 'cycle', title: '經期排卵', icon: '🌸', desc: '月經紀錄・排卵預測', stages: ['prep'], screen: 'cycle', order: 10, group: '備孕' },
    { id: 'prepcheck', title: '孕前準備清單', icon: '📋', desc: '檢查・疫苗・生活習慣', stages: ['prep'], screen: 'prepcheck', order: 20, group: '備孕' },
    { id: 'pregnancy', title: '孕期週記', icon: '🤰', desc: '每週寶寶變化', stages: ['preg'], screen: 'pregnancy', order: 10, group: '孕期' },
    { id: 'prenatal', title: '產檢時程', icon: '🩺', desc: '公費 14 次產檢', stages: ['preg'], screen: 'prenatal', order: 20, group: '孕期' },
    { id: 'kick', title: '胎動計數', icon: '👣', desc: '數到 10 下', stages: ['preg'], screen: 'kick', order: 30, group: '孕期' },
    { id: 'contraction', title: '宮縮計時', icon: '⏱️', desc: '判斷產兆 5-1-1', stages: ['preg'], screen: 'contraction', order: 40, group: '孕期' },
    { id: 'pregweight', title: '孕期體重', icon: '⚖️', desc: '建議增重範圍', stages: ['preg'], screen: 'pregweight', order: 50, group: '孕期' },
    { id: 'hospitalbag', title: '待產包', icon: '🎒', desc: '清單一次備齊', stages: ['preg'], screen: 'hospitalbag', order: 60, group: '孕期' },
  ].forEach((t) => App.tool(t));

  /* ---------- home cards ---------- */
  App.homeCard('prep-cycle', {
    stages: ['prep'],
    order: 10,
    render(el) {
      ensure(store.state);
      const info = cycleInfo();
      if (!info.last) {
        add(el, ui.card({ class: 'soft' },
          h('div', { class: 'card-title' }, '🌸 經期・排卵'),
          h('p', { class: 'small muted' }, '記錄最近一次月經，幫你預測排卵日與易孕期。'),
          h('button', { class: 'btn btn-primary btn-sm mt', onclick: openLastPeriodSheet }, '記錄最近一次月經')));
        return;
      }
      const ph = PHASE[info.phase];
      const nextLine = info.late > 0 ? `月經晚了 ${info.late} 天` : info.daysToNext === 0 ? '月經預計今天來' : `距離下次月經 ${info.daysToNext} 天`;
      add(el, ui.card({ class: `tap pg-home-cycle${info.inFertile ? ' fertile' : ''}`, onclick: () => App.navigate('cycle') },
        h('div', { class: 'row between' },
          h('div', { class: 'card-title' }, '🌸 經期・排卵'),
          h('span', { class: `tag ${ph.cls}` }, ph.label)),
        h('div', { class: 'row gap mt' },
          h('div', { class: 'grow' },
            h('div', { class: 'big-num' }, `第 ${info.cycleDay} 天`),
            h('div', { class: 'small muted' }, nextLine)),
          h('div', { class: 'right small' },
            h('div', { class: 'muted' }, '易孕期'),
            h('div', { class: 'bold' }, `${C.fmtDate(info.fertileStart, false)}–${C.fmtDate(info.fertileEnd, false)}`))),
        info.inFertile ? h('div', { class: 'pg-fertile-banner' }, info.phase === 'ovulation' ? '✨ 今天是預測排卵日' : '🌿 今天在易孕期') : null));
    },
  });

  App.homeCard('preg-week', {
    stages: ['preg'],
    order: 10,
    render(el) {
      ensure(store.state);
      const lmp = pregLmp();
      if (!lmp) {
        add(el, ui.card({ class: 'soft' },
          h('div', { class: 'card-title' }, '🤰 恭喜懷孕！'),
          h('p', { class: 'small muted' }, '設定預產期，看每週寶寶的變化與產檢時程。'),
          h('button', { class: 'btn btn-primary btn-sm mt', onclick: () => App.navigate('pregnancy') }, '設定預產期')));
        return;
      }
      const ga = C.gestAge(lmp);
      if (ga.totalDays < 0 || ga.totalDays > 44 * 7) {
        add(el, ui.card({ class: 'soft' },
          h('div', { class: 'card-title' }, '🤰 預產期需要確認'),
          h('p', { class: 'small muted' }, '目前的設定換算出來的週數不太對，請重新設定。'),
          h('button', { class: 'btn btn-primary btn-sm mt', onclick: openDueDateSheet }, '重新設定')));
        return;
      }
      const wk = weekInfo(ga.weeks);
      const np = nextPrenatal();
      add(el, ui.card({ class: 'card-hero tap pg-hero', onclick: () => App.navigate('pregnancy') },
        h('div', { class: 'row between' },
          h('span', { class: 'pg-hero-tri' }, trimesterLabel(ga.trimester)),
          h('span', { class: 'small' }, `預產期 ${C.fmtDate(pregEdd(), false)}`)),
        h('div', { class: 'row gap' },
          h('div', { class: 'grow' },
            h('div', { class: 'pg-hero-week' }, `懷孕 ${ga.weeks} 週 ${ga.days} 天`),
            h('div', { class: 'small muted' }, ga.weeks >= 4 ? `寶寶大約像${wk.fruit}一樣大（${sizeText(wk)}）` : '小生命剛剛開始')),
          ga.weeks >= 4 ? h('div', { class: 'pg-hero-emoji', 'aria-hidden': 'true' }, wk.emoji) : null),
        h('div', { class: 'mt' }, ui.progress(ga.progress)),
        h('div', { class: 'row between small mt' },
          h('span', null, ga.daysLeft > 0 ? `還有 ${ga.daysLeft} 天見面` : ga.daysLeft === 0 ? '預產期就是今天！' : `已超過預產期 ${-ga.daysLeft} 天`),
          np ? h('span', null, `下次產檢 ${C.fmtDate(np.date, false)}`) : null),
        h('div', { class: 'row gap-sm mt' },
          h('button', { class: 'btn btn-sm pg-hero-btn', onclick: (e) => { e.stopPropagation(); App.navigate('kick'); } }, '👣 胎動'),
          h('button', { class: 'btn btn-sm pg-hero-btn', onclick: (e) => { e.stopPropagation(); App.navigate('contraction'); } }, '⏱️ 宮縮'),
          h('button', { class: 'btn btn-sm pg-hero-btn', onclick: (e) => { e.stopPropagation(); App.navigate('prenatal'); } }, '🩺 產檢'))));
    },
  });

  // helpers for other modules (home, report…)
  App.preg = {
    pregLmp, pregEdd, weekInfo, cycleInfo, nextPrenatal, folicStreak, toggleFolic, openDueDateSheet, openLastPeriodSheet, openVisitSheet, openWeightSheet,
  };
}());
