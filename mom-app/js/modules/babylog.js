/* 育兒紀錄 — baby day log (tab 紀錄), add/edit sheets, running timers, What's Next predictions. */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const T = () => App.LOG_TYPES;

  /* ================= predictions ================= */
  const ageMonths = () => {
    const b = store.baby();
    const a = b && C.babyAge(b.birthday);
    return a ? Math.max(0, a.ageMonthsFloat) : 1;
  };
  App.predict = {
    feed(now = Date.now()) {
      const logs = store.babyLogs().filter((l) => ['breast', 'bottle'].includes(l.type));
      if (!logs.length) return null;
      const last = logs.reduce((a, b) => (new Date(a.start) > new Date(b.start) ? a : b));
      const recent = logs.filter((l) => now - new Date(l.start) < 48 * C.HOUR).map((l) => l.start);
      const gap = C.avgInterval(recent) || C.defaultFeedGapHours(ageMonths()) * C.HOUR;
      return { last, gap, next: new Date(new Date(last.start).getTime() + gap), samples: recent.length };
    },
    sleep(now = Date.now()) {
      const active = timers.get('sleep');
      if (active) return { sleeping: true, since: active.start };
      const last = store.babyLogs().filter((l) => l.type === 'sleep' && l.end)
        .sort((a, b) => new Date(b.end) - new Date(a.end))[0];
      if (!last) return null;
      const ww = C.wakeWindow(ageMonths());
      const awake = new Date(last.end).getTime();
      if (now - awake > 12 * C.HOUR) return null;
      return { awakeSince: last.end, from: new Date(awake + ww.min * C.MIN), to: new Date(awake + ww.max * C.MIN), ww };
    },
    diaper() {
      const last = store.lastLog('diaper');
      if (!last) return null;
      const gapH = ageMonths() < 1 ? 2.5 : 3.5;
      return { last, next: new Date(new Date(last.start).getTime() + gapH * C.HOUR) };
    },
  };

  /* ================= timers =================
   * 親餵 and 睡眠 run per baby (twins can sleep at the same time); 擠奶 is the mother's, one at a time.
   * Every timer remembers its baby, so finishing it records it under that baby even if another one is selected by
   * then. Storage stays as before for one baby (active.feed / active.sleep / active.pump); a second baby's timer of
   * the same kind goes in active['sleep@<babyId>']. */
  const BASE = { breast: 'feed', feed: 'feed', sleep: 'sleep', pump: 'pump' };
  const PER_BABY = { feed: true, sleep: true };
  const curBabyId = () => (store.baby() || {}).id || null;
  const slotKey = (type, babyId = curBabyId(), act = store.state.active || {}) => {
    const base = BASE[type] || type;
    return Object.keys(act).find((k) => (k === base || k.startsWith(`${base}@`)) && act[k]
      && (!PER_BABY[base] || !act[k].babyId || act[k].babyId === babyId)) || null;
  };
  const timers = {
    // this baby's running timer of this kind (or the mother's 擠奶 timer)
    get(type, babyId) { const k = slotKey(type, babyId); return k ? store.state.active[k] : null; },
    // every running baby timer (all babies), for the banner
    running() {
      const act = store.state.active || {};
      return Object.keys(act).filter((k) => /^(feed|sleep|pump)(@|$)/.test(k) && act[k]).map((k) => ({ key: k, base: k.split('@')[0], t: act[k] }));
    },
    start(type, extra = {}, babyId = curBabyId()) {
      const base = BASE[type] || type;
      if (slotKey(type, babyId)) return; // already running for this baby
      store.update((s) => {
        const now = new Date().toISOString();
        const k = s.active[base] ? `${base}@${babyId}` : base;
        s.active[k] = base === 'feed'
          ? { start: now, side: extra.side || 'L', segments: [{ side: extra.side || 'L', start: now }], babyId }
          : { start: now, babyId };
      });
    },
    switchSide(side, babyId = curBabyId()) {
      const k = slotKey('feed', babyId); if (!k) return;
      store.update((s) => {
        const a = s.active[k]; if (!a) return;
        const now = new Date().toISOString();
        const seg = a.segments[a.segments.length - 1];
        if (seg && !seg.end) { if (seg.side === side) return; seg.end = now; }
        a.segments.push({ side, start: now });
        a.side = side;
      });
    },
    stop(type, babyId = curBabyId()) {
      const s = store.state;
      const now = new Date();
      const k = slotKey(type, babyId); if (!k) return null;
      const a = s.active[k];
      const owner = a.babyId || babyId; // the baby this timer was started for
      if (type === 'breast') {
        let L = 0; let R = 0;
        a.segments.forEach((seg) => {
          const ms = (seg.end ? new Date(seg.end) : now) - new Date(seg.start);
          if (seg.side === 'L') L += ms; else R += ms;
        });
        const entry = store.addLog({
          type: 'breast', start: a.start, end: now.toISOString(), babyId: owner,
          data: { leftMin: Math.round(L / C.MIN), rightMin: Math.round(R / C.MIN), lastSide: a.side },
        });
        store.update((st) => { delete st.active[k]; });
        return entry;
      }
      store.update((st) => { delete st.active[k]; });
      if (type === 'sleep') return store.addLog({ type: 'sleep', start: a.start, end: now.toISOString(), babyId: owner });
      if (type === 'pump') { openAdd('pump', null, { start: a.start, durationMin: Math.max(1, Math.round((now - new Date(a.start)) / C.MIN)) }); }
      return null;
    },
    cancel(type, babyId = curBabyId()) { const k = slotKey(type, babyId); if (k) store.update((s) => { delete s.active[k]; }); },
    // stop + toast with 復原 (restores the running timer and removes the saved log)
    stopWithUndo(type, babyId = curBabyId()) {
      const key = slotKey(type, babyId);
      const snap = key ? JSON.parse(JSON.stringify(store.state.active[key])) : null;
      const entry = timers.stop(type, babyId);
      if (!entry) return null;
      ui.haptic();
      ui.toast(`已記錄${T()[type].label}・${App.logSummary(entry)}`, {
        action: '復原',
        onAction: () => store.update((s) => { s.logs = s.logs.filter((l) => l.id !== entry.id); if (snap) s.active[key] = snap; }),
      });
      return entry;
    },
  };
  App.timers = timers;

  /* ================= undo helper ================= */
  // Run `fn` (which saves something), then offer 復原 that restores logs + milk inventory exactly as before.
  function withUndo(label, fn) {
    const before = { logs: store.state.logs.map((l) => l.id), milk: JSON.parse(JSON.stringify(store.state.milk)) };
    const result = fn();
    ui.toast(label, {
      action: '復原',
      onAction: () => store.update((s) => {
        s.logs = s.logs.filter((l) => before.logs.includes(l.id));
        s.milk = before.milk;
      }),
    });
    return result;
  }

  /* ================= one-tap quick log (the ＋ on home tiles) =================
   * 親餵／睡眠／擠奶：開始計時；瓶餵：照上一次的種類與奶量；尿布：濕尿布；體溫：打開表單 */
  function quickLog(type) {
    const def = T()[type];
    if (type === 'breast') {
      const last = store.lastLog('breast');
      const side = last?.data?.lastSide === 'L' ? 'R' : 'L';
      timers.start('breast', { side }); ui.haptic();
      ui.toast(`開始餵${side === 'L' ? '左' : '右'}邊`, { action: '取消', onAction: () => timers.cancel('breast') });
      return;
    }
    if (type === 'sleep' || type === 'pump') {
      timers.start(type); ui.haptic();
      ui.toast(type === 'sleep' ? '開始記錄睡眠 😴' : '開始擠奶計時', { action: '取消', onAction: () => timers.cancel(type) });
      return;
    }
    if (type === 'bottle') {
      const last = store.lastLog('bottle');
      if (!last) { openAdd('bottle'); return; }
      const data = { kind: last.data?.kind || 'breastmilk', ml: last.data?.ml || 90 };
      ui.haptic();
      withUndo(`已記錄瓶餵・${data.ml} ml ${data.kind === 'formula' ? '配方奶' : '母乳'}`, () => store.addLog({ type, data }));
      return;
    }
    if (type === 'diaper') {
      ui.haptic();
      withUndo('已記錄濕尿布', () => store.addLog({ type, data: { kind: 'wet' } }));
      return;
    }
    if (type === 'bath') {
      ui.haptic();
      withUndo('已記錄洗澡 🛁', () => store.addLog({ type }));
      return;
    }
    openAdd(type);
    return def;
  }

  /* ================= launch actions (home-screen icon shortcuts, ?action=...) =================
   * 計時類直接開始（有「取消」），瓶餵／尿布打開表單，避免一碰就誤記。 */
  function handleAction(action) {
    if (!App.LOG_TYPES[action] || !store.state.onboarded) return false;
    if (!store.baby()) { App.navigate('home'); ui.toast('先新增寶寶資料，就能用捷徑記錄'); return false; }
    if (store.stage !== 'baby') store.update((s) => { s.profile.stage = 'baby'; });
    if (['breast', 'sleep', 'pump'].includes(action)) {
      if (timers.get(action)) { ui.toast('已經在計時中'); return true; }
      quickLog(action);
    } else openAdd(action);
    return true;
  }

  /* ================= add / edit sheets ================= */
  const timeInput = (v) => h('input', { type: 'datetime-local', value: C.toLocalInput(v || new Date()), max: C.toLocalInput(new Date(Date.now() + C.DAY)) });

  function typePicker() {
    const sh = ui.sheet({
      title: '新增紀錄',
      body: h('div', { class: 'type-grid' }, App.LOG_ORDER.map((t) => {
        const def = T()[t];
        return h('button', { class: 'type-btn', style: { '--tc': def.color }, onclick: () => { sh.close(); setTimeout(() => openAdd(t), 230); } },
          h('span', { class: 'type-ico' }, def.icon), h('span', null, def.label));
      })),
    });
  }

  function openAdd(type, existing, preset = {}) {
    const def = T()[type];
    const isEdit = !!existing;
    const log = existing || { type, start: preset.start || new Date().toISOString(), end: null, data: {}, note: '' };
    const data = JSON.parse(JSON.stringify(log.data || {}));
    const body = h('div', { class: 'log-form' });
    const startIn = timeInput(log.start);
    const noteIn = h('textarea', { rows: 2, placeholder: '備註（選填）' }, log.note || '');
    let collect = () => ({});
    const lastOf = (t) => store.lastLog(t);

    if (type === 'breast') {
      const running = timers.get('breast');
      if (!isEdit) {
        body.append(h('div', { class: 'card soft mb' },
          h('div', { class: 'card-title' }, '⏱ 計時餵奶'),
          h('p', { class: 'small muted' }, '按左或右開始計時，換邊直接按另一側，結束再按「完成」。'),
          running ? h('p', { class: 'small' }, '目前已在計時中，可以在首頁或下方控制。') : null,
          h('div', { class: 'grid-2 mt' },
            h('button', { class: 'btn btn-primary', onclick: () => { if (running) timers.switchSide('L'); else timers.start('breast', { side: 'L' }); sh.close(); ui.toast('開始餵左邊'); } }, '左邊開始'),
            h('button', { class: 'btn btn-primary', onclick: () => { if (running) timers.switchSide('R'); else timers.start('breast', { side: 'R' }); sh.close(); ui.toast('開始餵右邊'); } }, '右邊開始'))));
        body.append(h('div', { class: 'section-title small' }, '或手動輸入'));
      }
      const leftS = ui.stepper({ value: data.leftMin || 0, step: 1, unit: '分' });
      const rightS = ui.stepper({ value: data.rightMin || 0, step: 1, unit: '分' });
      const lastSide = ui.seg([{ value: 'L', label: '左' }, { value: 'R', label: '右' }], data.lastSide || (lastOf('breast')?.data?.lastSide === 'L' ? 'R' : 'L'), null, { small: true });
      body.append(ui.field('開始時間', startIn), ui.field('左側', leftS), ui.field('右側', rightS), ui.field('最後餵的是', lastSide));
      collect = () => {
        const L = leftS.getValue(); const R = rightS.getValue();
        return { data: { leftMin: L, rightMin: R, lastSide: lastSide.dataset.value }, end: new Date(new Date(startIn.value).getTime() + (L + R) * C.MIN).toISOString() };
      };
    } else if (type === 'bottle') {
      const kind = ui.seg([{ value: 'breastmilk', label: '母乳' }, { value: 'formula', label: '配方奶' }], data.kind || lastOf('bottle')?.data?.kind || 'breastmilk', (v) => { useInv.closest('.check-row').hidden = v !== 'breastmilk' || isEdit || !invMl(); });
      const ml = ui.stepper({ value: data.ml ?? lastOf('bottle')?.data?.ml ?? 90, step: 10, unit: 'ml', onChange: (v) => markPreset(v) });
      const presets = h('div', { class: 'chips preset-chips' });
      const markPreset = (v) => presets.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.ml) === Number(v)));
      [60, 90, 120, 150, 180, 210].forEach((v) => presets.append(h('button', { type: 'button', class: 'chip', dataset: { ml: v }, onclick: () => { ml.setValue(v); } }, `${v}`)));
      markPreset(ml.getValue());
      const useInv = h('input', { type: 'checkbox' });
      const invMl = () => (App.milk ? App.milk.available() : 0);
      const invRow = h('label', { class: 'check-row' }, useInv, h('span', null, `從母乳庫存扣除（目前 ${invMl()} ml，先進先出）`));
      invRow.hidden = (data.kind || 'breastmilk') !== 'breastmilk' || isEdit || !invMl();
      body.append(ui.field('時間', startIn), ui.field('種類', kind), ui.field('奶量（ml）', h('div', null, ml, presets)), invRow);
      collect = () => {
        if (useInv.checked && App.milk) App.milk.consume(ml.getValue());
        return { data: { ...data, kind: kind.dataset.value, ml: ml.getValue() } };
      };
    } else if (type === 'pump') {
      const dur = ui.stepper({ value: data.durationMin || preset.durationMin || 15, step: 1, unit: '分' });
      const left = ui.stepper({ value: data.left || 0, step: 10, unit: 'ml' });
      const right = ui.stepper({ value: data.right || 0, step: 10, unit: 'ml' });
      const store1 = h('input', { type: 'checkbox', checked: !isEdit });
      const where = ui.seg([{ value: 'fridge', label: '冷藏' }, { value: 'freezer', label: '冷凍' }, { value: 'room', label: '室溫' }], 'fridge', null, { small: true });
      body.append(ui.field('開始時間', startIn), ui.field('時長', dur), h('div', { class: 'grid-2' }, ui.field('左側', left), ui.field('右側', right)));
      if (!isEdit) body.append(h('label', { class: 'check-row' }, store1, h('span', null, '存入母乳庫存')), ui.field('存放方式', where));
      collect = () => {
        const total = left.getValue() + right.getValue();
        const out = { data: { ...data, durationMin: dur.getValue(), left: left.getValue(), right: right.getValue(), ml: total }, end: new Date(new Date(startIn.value).getTime() + dur.getValue() * C.MIN).toISOString() };
        if (!isEdit && store1.checked && total > 0 && App.milk) {
          App.milk.addBag({ ml: total, pumpedAt: new Date(startIn.value).toISOString(), storage: where.dataset.value });
          out.data.stored = true;
        }
        return out;
      };
    } else if (type === 'diaper') {
      const poo = data.poo || { amount: 'm', texture: 'soft', color: 'yellow' };
      const pooBox = h('div', { class: 'poo-box' });
      const kind = ui.seg([{ value: 'wet', label: '💧 濕' }, { value: 'dirty', label: '💩 便' }, { value: 'mixed', label: '尿＋便' }], data.kind || 'wet', (v) => { pooBox.hidden = v === 'wet'; });
      const amount = ui.seg(Object.entries(App.POO.AMOUNT).map(([value, label]) => ({ value, label })), poo.amount, null, { small: true });
      const texture = h('div', { class: 'chips' });
      Object.entries(App.POO.TEXTURE).forEach(([k, label]) => {
        const c = h('button', { type: 'button', class: `chip${poo.texture === k ? ' active' : ''}`, onclick: () => { texture.querySelectorAll('.chip').forEach((x) => x.classList.remove('active')); c.classList.add('active'); poo.texture = k; } }, label);
        texture.append(c);
      });
      const warn = h('p', { class: 'small warn-text', hidden: !App.POO.COLOR[poo.color]?.alert }, '⚠️ 灰白色、黑色（非初期胎便）或帶血的便便，建議盡快諮詢兒科醫師。');
      const colors = h('div', { class: 'swatches' });
      Object.entries(App.POO.COLOR).forEach(([k, c]) => {
        const b = h('button', { type: 'button', class: `swatch${poo.color === k ? ' active' : ''}`, 'aria-label': c.label, title: c.label, onclick: () => { colors.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active')); b.classList.add('active'); poo.color = k; warn.hidden = !c.alert; } },
          h('span', { class: 'swatch-dot', style: { background: c.hex } }), h('span', { class: 'tiny' }, c.label));
        colors.append(b);
      });
      pooBox.append(ui.field('份量', amount), ui.field('質地', texture), ui.field('顏色', colors), warn);
      pooBox.hidden = (data.kind || 'wet') === 'wet';
      body.append(ui.field('時間', startIn), ui.field('種類', kind), pooBox);
      collect = () => {
        const k = kind.dataset.value;
        return { data: k === 'wet' ? { kind: k } : { kind: k, poo: { ...poo, amount: amount.dataset.value } } };
      };
    } else if (type === 'sleep') {
      const endIn = h('input', { type: 'datetime-local', value: log.end ? C.toLocalInput(log.end) : '' });
      if (!isEdit && !timers.get('sleep')) {
        body.append(h('button', { class: 'btn btn-primary btn-block mb', onclick: () => { timers.start('sleep'); sh.close(); ui.toast('開始記錄睡眠 😴'); } }, '😴 寶寶睡著了（開始計時）'),
          h('div', { class: 'section-title small' }, '或補登一段睡眠'));
      }
      body.append(ui.field('入睡', startIn), ui.field('醒來', endIn, '還在睡可以先留空'));
      collect = () => ({ end: endIn.value ? new Date(endIn.value).toISOString() : null });
    } else if (type === 'temp') {
      const c = ui.stepper({ value: data.c || 36.8, step: 0.1, min: 34, max: 42, unit: '°C' });
      const site = ui.seg(['耳溫', '額溫', '肛溫', '腋溫'], data.site || '耳溫', null, { small: true });
      body.append(ui.field('時間', startIn), ui.field('體溫', c), ui.field('測量位置', site),
        h('p', { class: 'small muted' }, '一般以 ≥38°C 視為發燒。未滿 3 個月的寶寶發燒，請盡快就醫。'));
      collect = () => ({ data: { c: c.getValue(), site: site.dataset.value } });
    } else if (type === 'food') {
      const item = h('input', { value: data.item || '', placeholder: '例如：米糊、南瓜泥' });
      const amount = h('input', { value: data.amount || '', placeholder: '例如：2 湯匙、30 g' });
      const reaction = h('input', { value: data.reaction || '', placeholder: '過敏反應／喜好（選填）' });
      body.append(ui.field('時間', startIn), ui.field('食物', item), ui.field('份量', amount), ui.field('反應', reaction));
      collect = () => ({ data: { item: item.value.trim(), amount: amount.value.trim(), reaction: reaction.value.trim() } });
    } else if (type === 'visit') {
      const clinic = h('input', { value: data.clinic || '', placeholder: '診所／醫院、醫師' });
      const reason = h('input', { value: data.reason || '', placeholder: '例如：咳嗽三天、發燒、預防保健' });
      const diag = h('textarea', { rows: 2, placeholder: '醫師說明、診斷' }, data.diagnosis || '');
      const meds = h('input', { value: data.meds || '', placeholder: '藥物（依處方，選填）' });
      const fu = h('input', { type: 'date', value: data.followUp || '' });
      body.append(ui.field('時間', startIn), ui.field('看診地點', clinic), ui.field('原因／症狀', reason), ui.field('醫師說明', diag), ui.field('藥物', meds), ui.field('回診日期', fu, '設定後會出現在提醒中心的「預約與到期提醒」'));
      collect = () => ({ data: { clinic: clinic.value.trim(), reason: reason.value.trim(), diagnosis: diag.value.trim(), meds: meds.value.trim(), followUp: fu.value } });
    } else if (type === 'med') {
      const name = h('input', { value: data.name || '', placeholder: '藥名（依醫師處方）' });
      const dose = h('input', { value: data.dose || '', placeholder: '劑量' });
      body.append(ui.field('時間', startIn), ui.field('藥品', name), ui.field('劑量', dose));
      collect = () => ({ data: { name: name.value.trim(), dose: dose.value.trim() } });
    } else {
      body.append(ui.field('時間', startIn));
    }
    body.append(ui.field('備註', noteIn));

    const save = () => {
      if (!startIn.value) { ui.toast('請填時間'); return; }
      const extra = collect();
      const patch = { start: new Date(startIn.value).toISOString(), note: noteIn.value.trim(), ...extra };
      if (patch.data === undefined) patch.data = data;
      sh.close();
      if (isEdit) { store.updateLog(existing.id, patch); ui.toast('已更新'); return; }
      withUndo(`已記錄${def.label}`, () => store.addLog({ type, ...patch }));
    };
    // collect() may touch the milk inventory, so run it inside the undo snapshot for new entries
    const saveNew = () => {
      if (!startIn.value) { ui.toast('請填時間'); return; }
      sh.close();
      withUndo(`已記錄${def.label}`, () => {
        const extra = collect();
        const patch = { start: new Date(startIn.value).toISOString(), note: noteIn.value.trim(), ...extra };
        if (patch.data === undefined) patch.data = data;
        return store.addLog({ type, ...patch });
      });
    };
    const footer = h('div', { class: 'row gap' },
      isEdit ? h('button', {
        class: 'btn btn-ghost', 'aria-label': '刪除', onclick: async () => { if (await ui.confirm('刪除這筆紀錄？', { ok: '刪除', danger: true })) { store.removeLog(existing.id); sh.close(); ui.toast('已刪除'); } },
      }, ui.icon('trash')) : null,
      h('button', { class: 'btn btn-primary grow', onclick: isEdit ? save : saveNew }, isEdit ? '儲存' : '新增'));
    const sh = ui.sheet({ title: `${def.icon} ${isEdit ? '編輯' : ''}${def.label}`, body, footer });
  }
  App.babylog = { openAdd, typePicker, quickLog, withUndo, handleAction };

  /* ================= running timer banner (home + log) ================= */
  App.babylog.activeBanner = () => {
    // the selected baby's timers first, then the other babies' (twins), then 擠奶; with more than one baby each says whose it is
    const babies = store.state.babies || [];
    const cur = (store.baby() || {}).id;
    const nameOf = (id) => (babies.length > 1 ? `${(babies.find((x) => x.id === id) || {}).name || '寶寶'}・` : '');
    const runs = timers.running().sort((x, y) => (x.base === 'pump') - (y.base === 'pump') || (x.t.babyId !== cur) - (y.t.babyId !== cur));
    const items = runs.map(({ base, t }) => {
      const bid = t.babyId || cur;
      if (base === 'feed') {
        return h('div', { class: 'active-timer', style: { '--tc': 'var(--t-feed)' } },
          h('span', { class: 'at-ico' }, '🤱'),
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, `${nameOf(bid)}親餵中・${t.side === 'L' ? '左' : '右'}邊`), h('div', { class: 'big-num small-num', dataset: { clock: t.start } }, '00:00')),
          h('div', { class: 'seg seg-sm at-seg' },
            h('button', { class: t.side === 'L' ? 'active' : '', onclick: () => timers.switchSide('L', bid) }, '左'),
            h('button', { class: t.side === 'R' ? 'active' : '', onclick: () => timers.switchSide('R', bid) }, '右')),
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => timers.stopWithUndo('breast', bid) }, '完成'));
      }
      if (base === 'sleep') {
        return h('div', { class: 'active-timer', style: { '--tc': 'var(--t-sleep)' } },
          h('span', { class: 'at-ico' }, '😴'),
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, `${nameOf(bid)}睡覺中`), h('div', { class: 'big-num small-num', dataset: { clock: t.start } }, '00:00')),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (await ui.confirm('取消這次睡眠計時？')) timers.cancel('sleep', bid); } }, '取消'),
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => timers.stopWithUndo('sleep', bid) }, '醒來了'));
      }
      return h('div', { class: 'active-timer', style: { '--tc': 'var(--t-pump)' } },
        h('span', { class: 'at-ico' }, '🥛'),
        h('div', { class: 'grow' }, h('div', { class: 'bold' }, '擠奶中'), h('div', { class: 'big-num small-num', dataset: { clock: t.start } }, '00:00')),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => timers.stop('pump') }, '完成'));
    });
    return items.length ? h('div', { class: 'stack-sm mb' }, items) : null;
  };

  /* ================= day summary ================= */
  App.babylog.daySummary = (logs) => {
    const bottles = logs.filter((l) => l.type === 'bottle');
    const breasts = logs.filter((l) => l.type === 'breast');
    const diapers = logs.filter((l) => l.type === 'diaper');
    const sleeps = logs.filter((l) => l.type === 'sleep' && l.end);
    return {
      bottleCount: bottles.length,
      bottleMl: C.sum(bottles, (l) => l.data?.ml),
      breastCount: breasts.length,
      feedCount: bottles.length + breasts.length,
      wet: diapers.filter((l) => l.data?.kind !== 'dirty').length,
      dirty: diapers.filter((l) => l.data?.kind !== 'wet').length,
      diaperCount: diapers.length,
      sleepMs: C.sum(sleeps, (l) => new Date(l.end) - new Date(l.start)),
      pumpMl: C.sum(logs.filter((l) => l.type === 'pump'), (l) => l.data?.ml),
    };
  };

  /* 24h strip: sleep blocks + event ticks */
  function dayStrip(dayKey, logs) {
    const dayStart = C.parseKey(dayKey).getTime();
    const pct = (t) => C.clamp(((new Date(t).getTime() - dayStart) / C.DAY) * 100, 0, 100);
    const strip = h('div', { class: 'daystrip', role: 'img', 'aria-label': '24 小時作息條' });
    store.babyLogs().filter((l) => l.type === 'sleep').forEach((l) => {
      const end = l.end ? new Date(l.end).getTime() : Date.now();
      if (end < dayStart || new Date(l.start).getTime() > dayStart + C.DAY) return;
      const a = pct(l.start); const b = pct(end);
      strip.append(h('span', { class: 'ds-sleep', style: { left: `${a}%`, width: `${Math.max(0.6, b - a)}%` } }));
    });
    logs.filter((l) => l.type !== 'sleep').forEach((l) => {
      strip.append(h('span', { class: 'ds-tick', style: { left: `${pct(l.start)}%`, background: T()[l.type]?.color } }));
    });
    if (C.dateKey() === dayKey) strip.append(h('span', { class: 'ds-now', style: { left: `${pct(Date.now())}%` } }));
    return h('div', { class: 'daystrip-wrap' }, strip,
      h('div', { class: 'daystrip-axis tiny faint' }, ['0', '6', '12', '18', '24'].map((x) => h('span', null, x))));
  }

  /* ================= timeline list ================= */
  App.babylog.timeline = (logs, { limit, showAgoFirst = true } = {}) => {
    const list = h('div', { class: 'timeline' });
    let prevHour = null;
    (limit ? logs.slice(0, limit) : logs).forEach((l, i) => {
      const def = T()[l.type] || T().other;
      const d = new Date(l.start);
      const hr = d.getHours();
      const timeLabel = hr === prevHour ? `:${C.pad(d.getMinutes())}` : C.fmtTime(d);
      prevHour = hr;
      list.append(h('button', { class: 'tl-item', onclick: () => openAdd(l.type, l) },
        h('div', { class: 'tl-time num' }, timeLabel,
          i === 0 && showAgoFirst ? h('div', { class: 'tiny faint', dataset: { ago: l.start } }, C.ago(l.start)) : null),
        h('span', { class: 'tl-ico', style: { '--tc': def.color } }, def.icon),
        h('div', { class: 'tl-body' },
          h('div', { class: 'tl-title' }, def.label, l.by && l.by !== store.state.profile.member ? h('span', { class: 'tag' }, l.by) : null),
          h('div', { class: 'tl-sub' }, App.logSummary(l), l.note ? ` ・${l.note}` : ''))));
    });
    return list;
  };

  /* ================= 紀錄 tab ================= */
  let viewDay = C.dateKey();
  let followToday = true; // stays on "today" even if the app is left open past midnight
  const setDay = (d) => { viewDay = d; followToday = d === C.dateKey(); };
  let filter = 'all';
  const FILTERS = [
    { value: 'all', label: '全部' },
    { value: 'feed', label: '餵食', types: ['breast', 'bottle', 'food', 'pump'] },
    { value: 'diaper', label: '尿布', types: ['diaper'] },
    { value: 'sleep', label: '睡眠', types: ['sleep'] },
    { value: 'health', label: '健康', types: ['temp', 'med', 'visit', 'bath', 'other'] },
  ];

  function renderBabyLog(el) {
    const baby = store.baby();
    if (!baby) {
      el.append(ui.empty('👶', '先新增寶寶資料，就可以開始記錄餵奶、尿布和睡眠。',
        h('button', { class: 'btn btn-primary', onclick: () => App.me && App.me.editBaby() }, '新增寶寶')));
      return;
    }
    el.append(h('div', { class: 'row gap-sm log-top' },
      h('div', { class: 'grow' }, ui.seg([{ value: 'day', label: '日' }, { value: 'month', label: '月曆' }], logMode, (v) => { logMode = v; if (v === 'month') viewMonth = null; App.refresh(); }, { small: true })),
      h('button', { class: 'btn btn-sm btn-line', onclick: () => shareDay(baby, viewDay), html: `${ui.ICONS.line}<span>傳給家人</span>` })));
    if (followToday) viewDay = C.dateKey();
    if (logMode === 'month') { renderMonth(el, baby); return; }
    const isToday = viewDay === C.dateKey();
    const age = C.babyAge(baby.birthday, C.parseKey(viewDay));
    el.append(h('div', { class: 'datenav' },
      h('button', { class: 'icon-btn', 'aria-label': '前一天', html: ui.ICONS.left, onclick: () => { setDay(C.dateKey(C.addDays(viewDay, -1))); App.refresh(); } }),
      h('div', { class: 'datenav-mid' },
        h('div', { class: 'tiny muted' }, `${baby.avatar || '👶'} ${baby.name}・${age ? age.text : ''}`),
        h('div', { class: 'bold' }, C.fmtDateLong(viewDay))),
      h('button', { class: 'icon-btn', 'aria-label': '後一天', html: ui.ICONS.right, disabled: isToday, onclick: () => { setDay(C.dateKey(C.addDays(viewDay, 1))); App.refresh(); } })));
    if (!isToday) el.append(h('div', { class: 'center mb' }, h('button', { class: 'link-btn small', onclick: () => { setDay(C.dateKey()); App.refresh(); } }, '回到今天')));

    if (isToday) { const b = App.babylog.activeBanner(); if (b) el.append(b); }

    const logs = store.logsOn(viewDay);
    const s = App.babylog.daySummary(logs);
    el.append(h('div', { class: 'sum-row' },
      sumChip('🍼', `${s.bottleCount} 次`, `${s.bottleMl} ml`),
      sumChip('🤱', `${s.breastCount} 次`, '親餵'),
      sumChip('🧷', `${s.diaperCount} 次`, `💧${s.wet} 💩${s.dirty}`),
      sumChip('😴', s.sleepMs ? C.fmtDuration(s.sleepMs) : '0', '睡眠')));
    el.append(dayStrip(viewDay, logs));

    el.append(h('div', { class: 'mt' }, ui.seg(FILTERS, filter, (v) => { filter = v; App.refresh(); }, { small: true })));
    const f = FILTERS.find((x) => x.value === filter);
    const shown = f.types ? logs.filter((l) => f.types.includes(l.type)) : logs;
    if (!shown.length) el.append(ui.empty('🌙', isToday ? '今天還沒有紀錄，按右下角＋開始吧！' : '這天沒有紀錄'));
    else el.append(h('div', { class: 'mt' }, App.babylog.timeline(shown, { showAgoFirst: isToday })));

    el.append(h('button', { class: 'fab', 'aria-label': '新增紀錄', html: ui.ICONS.plus, onclick: typePicker }));
  }
  /* ---------- 月曆：一眼看出每天的奶量、尿布、睡眠與大事 ---------- */
  let logMode = 'day';
  let viewMonth = null; // Date (first of month)
  function renderMonth(el, baby) {
    const ref = C.parseKey(viewDay);
    if (!viewMonth) viewMonth = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const y = viewMonth.getFullYear(); const m = viewMonth.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const byDay = C.groupBy(store.babyLogs(baby.id), (l) => C.dateKey(new Date(l.start)));
    const vDone = store.state.vaccines[baby.id] || {};
    const cDone = store.state.checkups[baby.id] || {};
    const marks = {};
    const mark = (d, ico) => { if (d) (marks[d] = marks[d] || new Set()).add(ico); };
    Object.values(vDone).forEach((d) => mark(d, '💉'));
    Object.values(cDone).forEach((d) => mark(d, '🩺'));
    store.state.growth.filter((g) => g.babyId === baby.id).forEach((g) => mark(g.date, '📏'));
    const today = C.dateKey();
    const atMonthStart = y === new Date().getFullYear() && m === new Date().getMonth();
    el.append(h('div', { class: 'datenav' },
      h('button', { class: 'icon-btn', 'aria-label': '上個月', html: ui.ICONS.left, onclick: () => { viewMonth = new Date(y, m - 1, 1); App.refresh(); } }),
      h('div', { class: 'datenav-mid bold' }, `${y} 年 ${m + 1} 月`),
      h('button', { class: 'icon-btn', 'aria-label': '下個月', html: ui.ICONS.right, disabled: atMonthStart, onclick: () => { viewMonth = new Date(y, m + 1, 1); App.refresh(); } })));
    const grid = h('div', { class: 'cal-grid', role: 'group', 'aria-label': `${y} 年 ${m + 1} 月紀錄月曆` });
    C.WEEKDAYS.forEach((w) => grid.append(h('div', { class: 'cal-wd' }, w)));
    for (let i = 0; i < new Date(y, m, 1).getDay(); i += 1) grid.append(h('div', { class: 'cal-cell empty' }));
    let recDays = 0; let mlSum = 0; let sleepSum = 0;
    for (let d = 1; d <= days; d += 1) {
      const key = C.dateKey(new Date(y, m, d));
      const logs = byDay[key] || [];
      const s = App.babylog.daySummary(logs);
      if (logs.length) { recDays += 1; mlSum += s.bottleMl; sleepSum += s.sleepMs; }
      logs.filter((l) => l.type === 'visit').forEach(() => mark(key, '🏥'));
      if (logs.some((l) => l.type === 'temp' && Number(l.data?.c) >= 38)) mark(key, '🌡️');
      const disabled = key > today || key < baby.birthday;
      grid.append(h('button', {
        class: `cal-cell${key === today ? ' today' : ''}${logs.length ? ' has' : ''}`, disabled,
        'aria-label': `${m + 1} 月 ${d} 日${logs.length ? `：瓶餵 ${s.bottleMl} 毫升，尿布 ${s.diaperCount} 片` : ''}`,
        onclick: () => { setDay(key); logMode = 'day'; App.refresh(); },
      },
      h('span', { class: 'cal-d' }, d),
      logs.length ? h('span', { class: 'cal-ml num' }, s.bottleMl ? `${s.bottleMl}` : `${s.feedCount}次`) : null,
      logs.length ? h('span', { class: 'cal-sub num' }, `🧷${s.diaperCount}`) : null,
      marks[key] ? h('span', { class: 'cal-marks' }, [...marks[key]].join('')) : null));
    }
    el.append(grid);
    el.append(h('div', { class: 'tiny muted mt' }, '格子：瓶餵奶量 ml（或餵食次數）・尿布片數｜💉 疫苗 🩺 健檢 📏 量身高體重 🏥 看診 🌡️ 發燒'));
    if (recDays) {
      el.append(h('div', { class: 'grid-3 mt' },
        h('div', { class: 'card flat center' }, h('div', { class: 'bold num' }, recDays), h('div', { class: 'tiny muted' }, '有紀錄的天數')),
        h('div', { class: 'card flat center' }, h('div', { class: 'bold num' }, Math.round(mlSum / recDays)), h('div', { class: 'tiny muted' }, '平均瓶餵 ml／天')),
        h('div', { class: 'card flat center' }, h('div', { class: 'bold num' }, (sleepSum / recDays / C.HOUR).toFixed(1)), h('div', { class: 'tiny muted' }, '平均睡眠 小時／天'))));
    }
    el.append(h('button', { class: 'fab', 'aria-label': '新增紀錄', html: ui.ICONS.plus, onclick: typePicker }));
  }

  /* ---------- 傳給家人：今天的照護摘要（LINE） ---------- */
  function daySummaryText(baby, day) {
    const logs = store.logsOn(day, baby.id).slice().sort((a, b) => new Date(a.start) - new Date(b.start));
    const s = App.babylog.daySummary(logs);
    const lastFeed = logs.filter((l) => ['bottle', 'breast'].includes(l.type)).pop();
    const temps = logs.filter((l) => l.type === 'temp');
    const visits = logs.filter((l) => l.type === 'visit');
    const age = C.babyAge(baby.birthday, C.parseKey(day));
    const lines = [
      `【${baby.name} ${C.fmtDate(day)} 照護摘要】${age ? `（${age.text}）` : ''}`,
      `🍼 瓶餵 ${s.bottleCount} 次 ${s.bottleMl} ml・親餵 ${s.breastCount} 次`,
      `🧷 尿布 ${s.diaperCount} 片（濕 ${s.wet}・便便 ${s.dirty}）`,
      `😴 睡眠 ${s.sleepMs ? C.fmtDuration(s.sleepMs) : '0'}`,
      s.pumpMl ? `🥛 擠奶 ${s.pumpMl} ml` : '',
      temps.length ? `🌡️ 體溫 ${temps.map((t) => `${C.fmtTime(t.start)} ${Number(t.data?.c).toFixed(1)}°C`).join('、')}` : '',
      visits.length ? `🏥 看診：${visits.map((v) => App.logSummary(v)).join('；')}` : '',
      lastFeed ? `⏰ 最後一次喝奶 ${C.fmtTime(lastFeed.start)}（${App.logSummary(lastFeed)}）` : '',
      '— 易家做媽媽',
    ];
    return lines.filter(Boolean).join('\n');
  }
  function shareDay(baby, day) {
    const text = daySummaryText(baby, day);
    try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); } catch (e) { /* ignore */ }
    window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    const pts = App.share ? App.share.record('line', 'day-summary') : 0;
    ui.toast(`已開啟 LINE，摘要也已複製${pts ? `・好孕點數 +${pts}` : ''}`);
  }
  App.babylog.daySummaryText = daySummaryText;

  const sumChip = (ico, a, b) => h('div', { class: 'sum-chip' }, h('span', { class: 'sum-ico' }, ico), h('div', null, h('div', { class: 'bold num' }, a), h('div', { class: 'tiny muted' }, b)));

  App.screen('log', {
    title: () => ({ prep: '經期紀錄', preg: '孕期紀錄', baby: '育兒日記' }[store.stage]),
    render(el, params) {
      const stage = store.stage;
      if (stage === 'prep' && App.screens.cycle) { App.screens.cycle.render(el, params); return; }
      if (stage === 'preg' && App.screens.pregrecords) { App.screens.pregrecords.render(el, params); return; }
      if (stage === 'preg' && App.screens.pregnancy) { App.screens.pregnancy.render(el, params); return; }
      if (params.day) setDay(params.day);
      renderBabyLog(el);
    },
    actions: () => (store.stage === 'baby' ? [h('button', { class: 'icon-btn', 'aria-label': '統計', html: ui.ICONS.chart, onclick: () => App.navigate(App.screens.stats ? 'stats' : 'health') })] : null),
  });
}());
