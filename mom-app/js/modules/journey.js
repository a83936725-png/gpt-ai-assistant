/* 孕產路線圖 — 懷孕到出生到坐月子的完整流程：
 *   journey      路線圖（每階段 該做的事 ＋ 注意事項）
 *   pregrecords  懷孕期間的「紀錄」分頁：身體狀況日記、產檢紀錄、體重、胎動、宮縮 一條時間軸
 *   postpartum   產後恢復：惡露、傷口、體溫、心情 ＋ 新生兒觀察
 *   生產紀錄（寶寶出生了）、危險徵兆提醒（記錄到需要就醫的狀況會立刻提示）
 * 內容為一般衛教，不能取代醫師建議。 */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const J = () => App.JOURNEY;

  const ensure = (s) => {
    s.journey = s.journey || { done: {} };
    s.journey.done = s.journey.done || {};
    s.postpartum = s.postpartum || { start: '', method: '', log: [] };
    s.postpartum.log = s.postpartum.log || [];
    s.preg.journal = s.preg.journal || [];
    s.preg.visitNotes = s.preg.visitNotes || {};
  };
  ensure(store.state);

  /* ================= where am I in the journey ================= */
  const lmp = () => (App.preg && App.preg.pregLmp ? App.preg.pregLmp() : store.state.profile.lmp);
  // 產後天數：以生產紀錄日（或目前寶寶生日）起算，第 1 天 = 生產當天
  function ppInfo(now = new Date()) {
    const b = store.baby();
    const start = store.state.postpartum.start || (b && b.birthday);
    if (!start) return null;
    const day = C.diffDays(start, now) + 1;
    return day >= 1 ? { start, day, inConfinement: day <= 42 } : null;
  }
  function current(now = new Date()) {
    const phases = J().PHASES;
    if (store.inStage(['preg']) && lmp()) {
      const ga = C.gestAge(lmp(), now);
      const found = phases.findIndex((p) => p.to !== undefined && ga.weeks <= p.to);
      return { idx: found === -1 ? 3 : found, ga, kind: 'preg' }; // past 42 weeks stays on 足月待產
    }
    if (store.stage === 'baby') {
      const pp = ppInfo(now);
      if (pp && pp.inConfinement) return { idx: 5, pp, kind: 'pp' };
      return { idx: 6, pp, kind: 'done' };
    }
    return { idx: -1, kind: store.stage };
  }

  /* ================= warning signs ================= */
  const LEVEL_RANK = { soon: 1, urgent: 2, crisis: 3 };
  function levelOf(symptomIds, list, { sys, dia, temp } = {}) {
    const hits = [];
    let level = null;
    const bump = (lv, label) => { hits.push(label); if (!level || LEVEL_RANK[lv] > LEVEL_RANK[level]) level = lv; };
    (symptomIds || []).forEach((id) => { const s = list.find((x) => x.id === id); if (s && s.level) bump(s.level, s.label); });
    const S = Number(sys); const D = Number(dia);
    if (S >= 160 || D >= 110) bump('urgent', `血壓 ${S}/${D} 明顯偏高`);
    else if (S >= 140 || D >= 90) bump('soon', `血壓 ${S}/${D} 偏高（≥140/90）`);
    if (Number(temp) >= 38) bump('soon', `體溫 ${Number(temp).toFixed(1)}°C`);
    return { level, hits };
  }
  function alertSheet(level, hits) {
    if (!level) return;
    const tel = (n, label) => h('a', { class: 'btn btn-ghost btn-block jr-tel', href: `tel:${n.replace(/-/g, '')}` }, `📞 ${label} ${n}`);
    const copy = {
      urgent: { title: '⚠️ 請立即就醫', text: '你記錄的狀況需要盡快由醫師評估。請直接前往產檢醫院或急診；情況緊急請撥 119。' },
      soon: { title: '請盡快聯絡醫師', text: '建議今天就聯絡你的產檢醫院或醫師，說明以下狀況：' },
      crisis: { title: '你不是一個人 💜', text: '謝謝你願意說出來。請立刻告訴身邊信任的人，並撥打專線，有專人 24 小時陪你：' },
    }[level];
    const sh = ui.sheet({
      title: copy.title,
      body: h('div', { class: `jr-alert jr-alert-${level}` },
        h('p', null, copy.text),
        h('ul', { class: 'tight' }, hits.map((x) => h('li', null, x))),
        level === 'crisis' ? J().HOTLINES.map((x) => tel(x.number, x.label)) : null,
        level === 'urgent' ? tel('119', '緊急救護') : null,
        h('p', { class: 'tiny muted mt' }, '此提醒依一般衛教原則判斷，不是診斷；不確定時，寧可先詢問醫師。')),
      footer: h('button', { class: 'btn btn-primary btn-block', onclick: () => sh.close() }, '我知道了'),
    });
  }
  App.journeyAlert = { levelOf, alertSheet };

  /* ================= symptom chips ================= */
  function symptomPicker(list, selected) {
    const set = new Set(selected || []);
    const wrap = h('div', { class: 'jr-chips' });
    list.forEach((s) => {
      const b = h('button', {
        type: 'button', class: `chip jr-chip${s.level ? ` lv-${s.level}` : ''}${set.has(s.id) ? ' active' : ''}`, 'aria-pressed': String(set.has(s.id)),
        onclick: () => { if (set.has(s.id)) set.delete(s.id); else set.add(s.id); b.classList.toggle('active'); b.setAttribute('aria-pressed', String(set.has(s.id))); },
      }, s.level ? '⚠️ ' : '', s.label);
      wrap.append(b);
    });
    wrap.getValue = () => [...set];
    return wrap;
  }
  function moodPicker(value) {
    let v = value || 0;
    const wrap = h('div', { class: 'jr-moods', role: 'radiogroup', 'aria-label': '心情' });
    J().MOODS.forEach((m) => {
      const b = h('button', {
        type: 'button', role: 'radio', class: `jr-mood${v === m.value ? ' active' : ''}`, 'aria-checked': String(v === m.value), 'aria-label': m.label,
        onclick: () => { v = m.value; wrap.querySelectorAll('.jr-mood').forEach((x) => { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); }); b.classList.add('active'); b.setAttribute('aria-checked', 'true'); },
      }, h('span', { class: 'jr-mood-emoji' }, m.emoji), h('span', { class: 'tiny' }, m.label));
      wrap.append(b);
    });
    wrap.getValue = () => v;
    return wrap;
  }
  const numIn = (value, placeholder, extra = {}) => h('input', { type: 'number', inputmode: 'numeric', value: value ?? '', placeholder, class: 'input', ...extra });
  const moodEmoji = (v) => (J().MOODS.find((m) => m.value === v) || {}).emoji || '';

  /* ================= 懷孕：身體狀況日記 ================= */
  function openPregJournal(entry) {
    const isEdit = !!entry;
    const e = entry || {};
    const at = h('input', { type: 'datetime-local', value: C.toLocalInput(e.at || new Date()) });
    const chips = symptomPicker(J().PREG_SYMPTOMS, e.symptoms);
    const sys = numIn(e.sys, '收縮壓', { 'aria-label': '收縮壓' });
    const dia = numIn(e.dia, '舒張壓', { 'aria-label': '舒張壓' });
    const mood = moodPicker(e.mood);
    const note = h('textarea', { rows: 2, placeholder: '例如：今天孕吐比較少、寶寶晚上動很多' }, e.note || '');
    const sh = ui.sheet({
      title: isEdit ? '編輯身體狀況' : '📝 今天身體狀況',
      body: h('div', null,
        ui.field('時間', at),
        ui.field('症狀（可複選，⚠️ 為需要留意的狀況）', chips),
        ui.field('血壓（選填，mmHg）', h('div', { class: 'row gap-sm jr-bp' }, sys, h('span', null, '/'), dia)),
        ui.field('心情', mood),
        ui.field('備註', note)),
      footer: h('div', { class: 'row gap' },
        isEdit ? h('button', { class: 'btn btn-ghost', 'aria-label': '刪除', onclick: async () => { if (await ui.confirm('刪除這筆紀錄？', { ok: '刪除', danger: true })) { store.update((s) => { s.preg.journal = s.preg.journal.filter((x) => x.id !== e.id); }); sh.close(); } } }, ui.icon('trash')) : null,
        h('button', {
          class: 'btn btn-primary grow',
          onclick: () => {
            const rec = { id: e.id || C.uid(), at: new Date(at.value || Date.now()).toISOString(), symptoms: chips.getValue(), sys: sys.value ? Number(sys.value) : null, dia: dia.value ? Number(dia.value) : null, mood: mood.getValue() || null, note: note.value.trim() };
            store.update((s) => { ensure(s); s.preg.journal = s.preg.journal.filter((x) => x.id !== rec.id); s.preg.journal.push(rec); });
            sh.close();
            const { level, hits } = levelOf(rec.symptoms, J().PREG_SYMPTOMS, rec);
            if (level) setTimeout(() => alertSheet(level, hits), 260);
            else ui.toast(isEdit ? '已更新' : '已記錄今天的身體狀況 💜');
          },
        }, '儲存')),
    });
  }

  /* ================= 產後：身體恢復紀錄 ================= */
  function openPPLog(entry) {
    const isEdit = !!entry;
    const e = entry || {};
    const L = J().LOCHIA;
    const at = h('input', { type: 'datetime-local', value: C.toLocalInput(e.at || new Date()) });
    const amount = ui.seg(L.amount, e.lochia?.amount || 'm', null, { small: true });
    let color = e.lochia?.color || 'red';
    const colors = h('div', { class: 'swatches jr-swatches' }, L.color.map((c) => {
      const b = h('button', { type: 'button', class: `swatch${color === c.value ? ' active' : ''}`, 'aria-label': c.label, onclick: () => { color = c.value; colors.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active')); b.classList.add('active'); } },
        h('span', { class: 'swatch-dot', style: { background: c.hex } }), h('span', { class: 'tiny' }, c.label));
      return b;
    }));
    const pain = h('input', { type: 'range', min: 0, max: 10, step: 1, value: e.pain ?? 3, class: 'jr-range', 'aria-label': '傷口疼痛 0 到 10' });
    const painLabel = h('b', { class: 'num' }, `${pain.value}`);
    pain.addEventListener('input', () => { painLabel.textContent = pain.value; });
    const temp = ui.stepper({ value: e.temp || 36.8, step: 0.1, min: 34, max: 42, unit: '°C' });
    const mood = moodPicker(e.mood);
    const chips = symptomPicker(J().PP_SYMPTOMS, e.symptoms);
    const note = h('textarea', { rows: 2, placeholder: '例如：今天下床走動比較輕鬆' }, e.note || '');
    const sh = ui.sheet({
      title: isEdit ? '編輯產後紀錄' : '🍲 今天的身體恢復',
      body: h('div', null,
        ui.field('時間', at),
        ui.field('惡露量', amount),
        ui.field('惡露顏色', colors, '通常：鮮紅（約 3 天）→ 粉褐（到 2 週）→ 黃白（到 4–6 週）'),
        ui.field(h('span', null, '傷口疼痛（0 不痛 – 10 最痛）：', painLabel), pain),
        ui.field('體溫', temp),
        ui.field('心情', mood),
        ui.field('其他狀況（⚠️ 為需要就醫的警訊）', chips),
        ui.field('備註', note)),
      footer: h('div', { class: 'row gap' },
        isEdit ? h('button', { class: 'btn btn-ghost', 'aria-label': '刪除', onclick: async () => { if (await ui.confirm('刪除這筆紀錄？', { ok: '刪除', danger: true })) { store.update((s) => { s.postpartum.log = s.postpartum.log.filter((x) => x.id !== e.id); }); sh.close(); } } }, ui.icon('trash')) : null,
        h('button', {
          class: 'btn btn-primary grow',
          onclick: () => {
            const rec = {
              id: e.id || C.uid(), at: new Date(at.value || Date.now()).toISOString(), lochia: { amount: amount.dataset.value, color }, pain: Number(pain.value), temp: temp.getValue(), mood: mood.getValue() || null, symptoms: chips.getValue(), note: note.value.trim(),
            };
            store.update((s) => { ensure(s); s.postpartum.log = s.postpartum.log.filter((x) => x.id !== rec.id); s.postpartum.log.push(rec); });
            sh.close();
            const { level, hits } = levelOf(rec.symptoms, J().PP_SYMPTOMS, { temp: rec.temp });
            if (level) setTimeout(() => alertSheet(level, hits), 260);
            else ui.toast(isEdit ? '已更新' : '已記錄，今天也辛苦了 💜');
          },
        }, '儲存')),
    });
  }

  /* ================= 生產紀錄（寶寶出生了） ================= */
  function openBirthSheet() {
    const second = store.state.profile.pregnantToo && store.state.babies.length > 0;
    const now = new Date();
    const name = h('input', { value: second ? '二寶' : '', placeholder: '寶寶的名字或小名', maxlength: 20 });
    const sex = ui.seg([{ value: 'girl', label: '女孩' }, { value: 'boy', label: '男孩' }], 'girl', null, { small: true });
    const date = h('input', { type: 'date', value: C.dateKey(now), max: C.dateKey(now) });
    const time = h('input', { type: 'time', value: `${C.pad(now.getHours())}:${C.pad(now.getMinutes())}` });
    const w = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', placeholder: '3.20' });
    const len = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: '50' });
    const head = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: '34' });
    const method = ui.seg([{ value: 'vaginal', label: '自然產' }, { value: 'csection', label: '剖腹產' }], 'vaginal', null, { small: true });
    const hospital = h('input', { placeholder: '醫院／診所（選填）' });
    const note = h('textarea', { rows: 2, placeholder: '想記住的話（選填）' });
    const gaText = h('span', { class: 'tag primary' });
    const updGa = () => {
      if (!lmp() || !date.value) { gaText.textContent = ''; return; }
      const g = C.gestAge(lmp(), C.parseKey(date.value));
      gaText.textContent = `出生週數：${g.weeks} 週 ${g.days} 天${g.weeks < 37 ? '（早產）' : ''}`;
    };
    date.addEventListener('change', updGa); updGa();
    const sh = ui.sheet({
      title: '🎉 寶寶出生了！',
      body: h('div', null,
        h('p', { class: 'small muted' }, '恭喜你！填寫生產紀錄，App 會切換到「育兒＋坐月子」，成長曲線也會從出生開始畫。', gaText),
        ui.field('寶寶名字', name), ui.field('性別', sex),
        h('div', { class: 'grid-2' }, ui.field('出生日期', date), ui.field('出生時間', time)),
        h('div', { class: 'grid-3' }, ui.field('體重 kg', w), ui.field('身長 cm', len), ui.field('頭圍 cm', head)),
        ui.field('生產方式', method), ui.field('醫院', hospital), ui.field('備註', note)),
      footer: h('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => {
          const g = lmp() ? C.gestAge(lmp(), C.parseKey(date.value || C.dateKey())) : null;
          const baby = {
            id: C.uid(), name: name.value.trim() || '寶寶', sex: sex.dataset.value, birthday: date.value || C.dateKey(), birthTime: time.value,
            birthWeight: w.value ? Number(w.value) : '', birthLength: len.value ? Number(len.value) : '', birthHead: head.value ? Number(head.value) : '', avatar: '👶',
            birth: { method: method.dataset.value, hospital: hospital.value.trim(), ga: g ? `${g.weeks}+${g.days}` : '', note: note.value.trim() },
          };
          store.update((s) => {
            ensure(s);
            s.babies.push(baby); s.activeBabyId = baby.id;
            if (baby.birthHead) s.growth.push({ id: C.uid(), babyId: baby.id, date: baby.birthday, head: baby.birthHead });
            s.profile.stage = 'baby'; s.profile.pregnantToo = false;
            s.postpartum = { start: baby.birthday, method: baby.birth.method, log: [] };
            s.journey.done['b-record'] = C.dateKey();
          });
          sh.close();
          App.navigate('home');
          ui.toast(`🎉 歡迎 ${baby.name}！接下來是坐月子，好好休息`);
          if (App.share) setTimeout(() => App.share.moment(`birth-${baby.id}`, { emoji: '🎉', msg: `歡迎 ${baby.name} 來到這個世界！`, kind: 'birth', force: true, queue: true }), 1500);
        },
      }, '寶寶出生了，儲存'),
    });
  }

  /* ================= 新生兒觀察（出生 28 天內） ================= */
  function newbornChecks() {
    const b = store.baby();
    if (!b) return null;
    const age = C.babyAge(b.birthday);
    if (!age || age.days > 28) return null;
    const dayOfLife = age.days + 1;
    const today = store.logsOn(new Date());
    const wet = today.filter((l) => l.type === 'diaper' && l.data?.kind !== 'dirty').length;
    const need = Math.min(6, dayOfLife);
    const now = Date.now();
    const alertPoo = store.babyLogs().filter((l) => l.type === 'diaper' && now - new Date(l.start) < 48 * C.HOUR && App.POO?.COLOR[l.data?.poo?.color]?.alert);
    const g = store.state.growth.filter((x) => x.babyId === b.id && x.weight).sort((a, c) => (a.date < c.date ? 1 : -1))[0];
    let wLine = null;
    if (g && b.birthWeight) {
      const pct = ((g.weight - b.birthWeight) / b.birthWeight) * 100;
      const bad = pct < -10 || (dayOfLife >= 15 && pct < 0);
      wLine = { bad, text: `體重 ${g.weight} kg（出生 ${b.birthWeight} kg，${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%）${bad ? '・請諮詢兒科醫師' : ''}` };
    }
    const rows = [
      { ok: wet >= need, icon: '💧', text: `今天濕尿布 ${wet} 片／第 ${dayOfLife} 天建議至少 ${need} 片`, act: () => App.navigate('log') },
      alertPoo.length ? { ok: false, icon: '💩', text: '最近有灰白、黑色或帶血的便便紀錄，請盡快就醫', act: () => App.navigate('log') } : null,
      wLine ? { ok: !wLine.bad, icon: '⚖️', text: wLine.text, act: () => App.navigate('growth') } : null,
      dayOfLife <= 21 ? { ok: null, icon: '🟡', text: '黃疸：自然光下看眼白、皮膚；黃到肚子手腳要就醫' } : null,
      dayOfLife <= 21 ? { ok: null, icon: '🩹', text: '臍帶：保持乾燥清潔，紅腫流膿或異味要就醫' } : null,
    ].filter(Boolean);
    return h('div', { class: 'jr-newborn' },
      h('div', { class: 'bold small mb' }, `👶 ${b.name} 出生第 ${dayOfLife} 天・要觀察`),
      rows.map((r) => h(r.act ? 'button' : 'div', { class: `jr-check${r.ok === false ? ' bad' : r.ok ? ' good' : ''}`, onclick: r.act || null },
        h('span', { class: 'jr-check-ico' }, r.ok === true ? '✓' : r.icon), h('span', null, r.text))));
  }

  /* ================= 路線圖 screen ================= */
  const toggleTodo = (id) => store.update((s) => { ensure(s); if (s.journey.done[id]) delete s.journey.done[id]; else s.journey.done[id] = C.dateKey(); });
  const openTool = (t) => {
    if (t.action === 'birth') { if (store.inStage(['preg'])) openBirthSheet(); else ui.toast('已經記錄過生產囉'); return; }
    if (t.tool && App.screens[t.tool]) App.navigate(t.tool);
  };
  let openPhase = null;
  function phaseCard(p, i, cur) {
    const status = i < cur.idx ? 'done' : i === cur.idx ? 'now' : 'next';
    const expanded = openPhase === null ? status === 'now' || (cur.idx < 0 && i === 0) : openPhase === p.id;
    const done = store.state.journey.done;
    const doneCount = p.todo.filter((t) => done[t.id]).length;
    const head = h('button', { class: 'jr-phase-head', 'aria-expanded': String(expanded), onclick: () => { openPhase = expanded ? '' : p.id; App.refresh(); } },
      h('span', { class: 'jr-dot', 'aria-hidden': 'true' }, status === 'done' ? '✓' : p.icon),
      h('span', { class: 'grow' }, h('span', { class: 'bold' }, p.title), h('span', { class: 'tiny muted' }, `　${p.range}`)),
      h('span', { class: `tag ${status === 'now' ? 'primary' : status === 'done' ? 'ok' : ''}` }, status === 'now' ? '你在這裡' : status === 'done' ? '已走過' : `${doneCount}/${p.todo.length}`));
    const card = h('section', { class: `jr-phase jr-${status}${expanded ? ' open' : ''}`, id: `phase-${p.id}` }, head);
    if (!expanded) return card;
    card.append(h('div', { class: 'jr-phase-body' },
      h('p', { class: 'small muted' }, p.intro),
      h('div', { class: 'jr-sub' }, `✅ 該做的事（${doneCount}/${p.todo.length}）`),
      h('div', { class: 'jr-todos' }, p.todo.map((t) => h('div', { class: `jr-todo${done[t.id] ? ' done' : ''}` },
        h('label', { class: 'jr-todo-main' },
          h('input', { type: 'checkbox', checked: !!done[t.id], onchange: () => toggleTodo(t.id) }),
          h('span', null, t.text, t.week ? h('span', { class: 'tiny faint' }, `（約第 ${t.week} 週）`) : null)),
        (t.tool && App.screens[t.tool]) || t.action ? h('button', { class: 'btn btn-sm btn-soft', onclick: () => openTool(t) }, t.action ? '填寫' : '前往') : null))),
      h('div', { class: 'jr-sub jr-sub-warn' }, '⚠️ 注意事項：出現以下情況要就醫'),
      h('ul', { class: 'jr-watch' }, p.watch.map((x) => h('li', null, x))),
      p.tips && p.tips.length ? h('div', { class: 'jr-sub' }, '💡 小提醒') : null,
      p.tips && p.tips.length ? h('ul', { class: 'tight small' }, p.tips.map((x) => h('li', null, x))) : null,
      App.share ? h('div', { class: 'mt' }, App.share.button(() => ({
        sheetTitle: `分享「${p.title}」清單`, title: `${p.title}：該做的事＋注意事項`, campaign: `journey-${p.id}`, path: 'journey', emoji: p.icon, kicker: `孕產路線圖・${p.range}`, theme: 'purple',
        text: `【${p.title}・${p.range}】\n✅ 該做的事：\n${p.todo.map((t) => `・${t.text}`).join('\n')}\n⚠️ 注意：${p.watch.slice(0, 3).join('；')}`,
        lines: p.todo.slice(0, 5).map((t) => t.text),
      }), { label: '分享這份清單給另一半／家人', cls: 'btn btn-sm btn-ghost btn-block' })) : null));
    return card;
  }
  function hotlineCard() {
    return ui.card({ class: 'flat jr-hotlines' },
      h('div', { class: 'card-title' }, '☎️ 需要幫忙時'),
      J().HOTLINES.map((x) => h('a', { class: 'list-item', href: `tel:${x.number.replace(/-/g, '')}` },
        h('span', { class: 'li-body' }, h('span', { class: 'li-title' }, x.label)), h('span', { class: 'li-right bold num' }, x.number))));
  }
  App.screen('journey', {
    title: '孕產路線圖',
    tab: 'health',
    render(el) {
      const cur = current();
      const phases = J().PHASES;
      let headline; let sub;
      if (cur.kind === 'preg') { headline = `懷孕 ${cur.ga.weeks} 週 ${cur.ga.days} 天`; sub = `目前在「${phases[cur.idx].title}」・預產期 ${C.fmtDate(C.eddFromLmp(lmp()), false)}`; }
      else if (cur.kind === 'pp') { headline = `產後第 ${cur.pp.day} 天`; sub = `坐月子中・${cur.pp.day <= 42 ? `還有 ${42 - cur.pp.day} 天滿 6 週` : ''}`; }
      else if (cur.kind === 'done') { headline = '路線圖都走完了 🎉'; sub = '產後 6 週之後，記得持續照顧自己'; }
      else { headline = '準備好了再出發'; sub = '懷孕後設定預產期，路線圖會自動標出你在哪裡'; }
      el.append(ui.card({ class: 'card-hero jr-hero' },
        h('div', { class: 'small muted' }, '從懷孕到出生到坐月子'),
        h('div', { class: 'big-num' }, headline), h('div', { class: 'small muted' }, sub),
        h('div', { class: 'jr-steps', 'aria-hidden': 'true' }, phases.map((p, i) => h('span', { class: `jr-step${i < cur.idx ? ' done' : i === cur.idx ? ' now' : ''}` }, p.icon))),
        h('div', { class: 'row gap-sm mt' },
          cur.kind === 'preg' ? h('button', { class: 'btn btn-sm jr-hero-btn', onclick: () => openPregJournal() }, '📝 記錄身體狀況') : null,
          cur.kind === 'pp' || (cur.kind === 'done' && cur.pp && cur.pp.day <= 90) ? h('button', { class: 'btn btn-sm jr-hero-btn', onclick: () => openPPLog() }, '🍲 記錄身體恢復') : null,
          cur.kind === 'preg' && cur.ga.weeks >= 20 ? h('button', { class: 'btn btn-sm jr-hero-btn', onclick: openBirthSheet }, '🎉 寶寶出生了') : null)));
      if (cur.kind === 'pp') { const nb = newbornChecks(); if (nb) el.append(ui.card({ class: 'mt' }, nb)); }
      el.append(h('div', { class: 'jr-list' }, phases.map((p, i) => phaseCard(p, i, cur))));
      el.append(hotlineCard());
      el.append(h('p', { class: 'disclaimer' }, '內容依國健署孕婦健康手冊、兒童健康手冊等公開衛教資料整理，不能取代醫師建議；身體不適請直接就醫。'));
    },
  });

  /* ================= 懷孕「紀錄」分頁：一條時間軸 ================= */
  function pregEntries() {
    const s = store.state;
    const out = [];
    (s.preg.journal || []).forEach((e) => {
      const { level } = levelOf(e.symptoms, J().PREG_SYMPTOMS, e);
      const names = (e.symptoms || []).map((id) => (J().PREG_SYMPTOMS.find((x) => x.id === id) || {}).label).filter(Boolean);
      out.push({
        at: e.at, icon: '📝', title: '身體狀況', level,
        sub: [names.join('、'), e.sys && e.dia ? `血壓 ${e.sys}/${e.dia}` : '', e.mood ? `心情 ${moodEmoji(e.mood)}` : '', e.note].filter(Boolean).join('・') || '（沒有特別狀況）',
        open: () => openPregJournal(e),
      });
    });
    const D = App.PREG_DATA || {};
    Object.entries(s.preg.prenatal || {}).forEach(([key, date]) => {
      const v = (D.PRENATAL || []).find((x) => x.key === key) || { no: key.replace('v', ''), key };
      const n = (s.preg.visitNotes || {})[key] || {};
      const { level } = levelOf([], [], n);
      out.push({
        at: `${date}T12:00:00`, icon: '🩺', title: `第 ${v.no} 次產檢`, level,
        sub: [n.weight ? `體重 ${n.weight} kg` : '', n.sys && n.dia ? `血壓 ${n.sys}/${n.dia}` : '', n.fhr ? `胎心 ${n.fhr}` : '', n.note].filter(Boolean).join('・') || '已完成',
        open: () => (App.preg.openVisitSheet ? App.preg.openVisitSheet(v, date) : App.navigate('prenatal')),
      });
    });
    const pre = Number(s.profile.prePregWeight);
    (s.preg.weights || []).forEach((w) => out.push({ at: `${w.date}T08:00:00`, icon: '⚖️', title: `體重 ${w.kg} kg`, sub: pre ? `比孕前 ${w.kg - pre >= 0 ? '+' : ''}${(w.kg - pre).toFixed(1)} kg` : '', open: () => App.navigate('pregweight') }));
    (s.preg.kicks || []).forEach((k) => out.push({ at: k.start, icon: '👣', title: `胎動 ${k.count} 次`, sub: k.end ? `用時 ${C.fmtDuration(new Date(k.end) - new Date(k.start))}` : '', open: () => App.navigate('kick') }));
    const byDay = C.groupBy(s.preg.contractions || [], (c) => C.dateKey(new Date(c.start)));
    Object.entries(byDay).forEach(([day, list]) => {
      const sorted = list.slice().sort((a, b) => new Date(a.start) - new Date(b.start));
      const gaps = sorted.slice(1).map((c, i) => new Date(c.start) - new Date(sorted[i].start));
      out.push({ at: sorted[sorted.length - 1].start, icon: '⏱️', title: `宮縮 ${list.length} 次`, sub: gaps.length ? `平均間隔 ${C.fmtDuration(C.sum(gaps) / gaps.length)}` : day, open: () => App.navigate('contraction') });
    });
    return out.sort((a, b) => new Date(b.at) - new Date(a.at));
  }
  function addPregRecord() {
    const np = App.preg && App.preg.nextPrenatal ? App.preg.nextPrenatal() : null;
    const items = [
      ['📝', '身體狀況日記', '症狀、血壓、心情', () => openPregJournal()],
      ['🩺', '產檢紀錄', np ? `第 ${np.no} 次（約 ${C.fmtDate(np.date, false)}）` : '體重、血壓、胎心、醫師交代', () => (np && App.preg.openVisitSheet ? App.preg.openVisitSheet(np, np.date) : App.navigate('prenatal'))],
      ['⚖️', '體重', '看增重是否在建議範圍', () => (App.preg.openWeightSheet ? App.preg.openWeightSheet() : App.navigate('pregweight'))],
      ['👣', '胎動計數', '數到 10 下', () => App.navigate('kick')],
      ['⏱️', '宮縮計時', '判斷產兆 5-1-1', () => App.navigate('contraction')],
    ];
    const sh = ui.sheet({
      title: '新增孕期紀錄',
      body: h('div', { class: 'list' }, items.map(([icon, title, desc, fn]) => h('button', { class: 'list-item', onclick: () => { sh.close(); setTimeout(fn, 240); } },
        h('span', { class: 'li-icon' }, icon), h('span', { class: 'li-body' }, h('span', { class: 'li-title', style: { display: 'block' } }, title), h('span', { class: 'li-sub' }, desc))))),
    });
  }
  App.screen('pregrecords', {
    title: '孕期紀錄',
    tab: 'log',
    render(el) {
      const l = lmp();
      if (l) {
        const ga = C.gestAge(l);
        el.append(h('div', { class: 'row between mb' },
          h('div', null, h('div', { class: 'bold' }, `懷孕 ${ga.weeks} 週 ${ga.days} 天`), h('div', { class: 'tiny muted' }, `預產期 ${C.fmtDateLong(C.eddFromLmp(l))}`)),
          h('button', { class: 'btn btn-sm btn-soft', onclick: () => App.navigate('journey') }, '🗺️ 路線圖')));
      } else if (App.preg) {
        el.append(ui.card({ class: 'soft mb' }, h('p', { class: 'small' }, '設定預產期，紀錄會自動標上孕週。'), h('button', { class: 'btn btn-sm btn-primary', onclick: App.preg.openDueDateSheet }, '設定預產期')));
      }
      el.append(h('div', { class: 'jr-quick' },
        h('button', { class: 'chip', onclick: () => openPregJournal() }, '📝 身體狀況'),
        h('button', { class: 'chip', onclick: addPregRecord }, '🩺 產檢'),
        h('button', { class: 'chip', onclick: () => (App.preg.openWeightSheet ? App.preg.openWeightSheet() : App.navigate('pregweight')) }, '⚖️ 體重'),
        h('button', { class: 'chip', onclick: () => App.navigate('kick') }, '👣 胎動'),
        h('button', { class: 'chip', onclick: () => App.navigate('contraction') }, '⏱️ 宮縮')));
      const entries = pregEntries();
      const recentFlag = entries.find((e) => e.level && Date.now() - new Date(e.at) < 48 * C.HOUR);
      if (recentFlag) {
        el.append(ui.card({ class: `jr-flag jr-flag-${recentFlag.level}` }, h('div', { class: 'bold' }, recentFlag.level === 'urgent' ? '⚠️ 最近有需要立即就醫的紀錄' : '⚠️ 最近有需要留意的紀錄'),
          h('p', { class: 'small' }, `${recentFlag.title}：${recentFlag.sub}`), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => App.navigate('journey') }, '看注意事項')));
      }
      if (!entries.length) {
        el.append(ui.empty('📒', '還沒有孕期紀錄。每天花 10 秒記下身體狀況，產檢時拿給醫師看最方便。',
          h('button', { class: 'btn btn-primary', onclick: () => openPregJournal() }, '記錄今天的身體狀況')));
      } else {
        const groups = C.groupBy(entries, (e) => C.dateKey(new Date(e.at)));
        Object.keys(groups).sort().reverse().forEach((day) => {
          const ga = l ? C.gestAge(l, C.parseKey(day)) : null;
          el.append(h('div', { class: 'section-title small' }, h('span', null, C.fmtDate(day)), ga && ga.totalDays >= 0 ? h('span', { class: 'tiny muted' }, `${ga.weeks} 週 ${ga.days} 天`) : null));
          el.append(h('div', { class: 'timeline' }, groups[day].map((e) => h('button', { class: 'tl-item', onclick: e.open },
            h('div', { class: 'tl-time num' }, C.fmtTime(e.at)),
            h('span', { class: 'tl-ico', style: { '--tc': e.level ? 'var(--c-danger)' : 'var(--c-primary)' } }, e.icon),
            h('div', { class: 'tl-body' }, h('div', { class: 'tl-title' }, e.title, e.level ? h('span', { class: `tag ${e.level === 'urgent' ? 'danger' : 'warn'}` }, e.level === 'urgent' ? '需就醫' : '留意') : null),
              h('div', { class: 'tl-sub' }, e.sub))))));
        });
      }
      el.append(h('button', { class: 'fab', 'aria-label': '新增孕期紀錄', html: ui.ICONS.plus, onclick: addPregRecord }));
    },
  });

  /* ================= 產後恢復 screen ================= */
  App.screen('postpartum', {
    title: '產後恢復',
    tab: 'health',
    actions: () => [h('button', { class: 'icon-btn', 'aria-label': '新增產後紀錄', html: ui.ICONS.plus, onclick: () => openPPLog() })],
    render(el) {
      const pp = ppInfo();
      const log = (store.state.postpartum.log || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at));
      const method = store.state.postpartum.method === 'csection' ? '剖腹產' : store.state.postpartum.method === 'vaginal' ? '自然產' : '';
      const loggedToday = log.some((x) => C.dateKey(new Date(x.at)) === C.dateKey());
      el.append(ui.card({ class: 'card-hero' },
        h('div', { class: 'small muted' }, pp ? `${method ? `${method}・` : ''}${C.fmtDateLong(pp.start)} 生產` : '產後恢復'),
        h('div', { class: 'big-num' }, pp ? `產後第 ${pp.day} 天` : '記錄身體恢復'),
        pp ? h('div', { class: 'mt' }, ui.progress(Math.min(1, pp.day / 42))) : null,
        h('div', { class: 'small muted mt' }, pp && pp.day <= 42 ? `坐月子中・產後 6 週約在 ${C.fmtDate(C.addDays(pp.start, 41), false)}，記得回診` : '產後 6 週已過，有不舒服仍可記錄、隨時就醫'),
        h('div', { class: 'row gap-sm wrap mt' },
          h('button', { class: 'btn btn-sm jr-hero-btn', onclick: () => openPPLog() }, loggedToday ? '＋ 再記一筆' : '🍲 記錄今天的身體恢復'),
          App.share && pp && pp.day <= 45 ? h('button', { class: 'btn btn-sm jr-hero-btn', 'aria-label': '分享坐月子卡', onclick: () => App.share.open({ kind: 'pp', sheetTitle: '分享坐月子卡' }) }, '📤 分享') : null)));
      // mood support: several low days in the last 2 weeks
      const low = log.filter((x) => x.mood && x.mood <= 2 && Date.now() - new Date(x.at) < 14 * C.DAY).length;
      if (low >= 4) {
        el.append(ui.card({ class: 'soft mt' }, h('div', { class: 'card-title' }, '💜 最近好像比較辛苦'),
          h('p', { class: 'small' }, `最近兩週有 ${low} 天心情低落。產後情緒起伏很常見，但如果持續超過兩週，或你覺得撐不住了，請讓家人知道，也可以打專線聊聊。`),
          J().HOTLINES.slice(1).map((x) => h('a', { class: 'btn btn-ghost btn-block mt', href: `tel:${x.number.replace(/-/g, '')}` }, `📞 ${x.label} ${x.number}`))));
      }
      const nb = newbornChecks();
      if (nb) el.append(ui.card({ class: 'mt' }, nb));
      // trend: last 10 records
      if (log.length) {
        const recent = log.slice(0, 10).reverse();
        const colorOf = (c) => (J().LOCHIA.color.find((x) => x.value === c) || {}).hex || '#ccc';
        el.append(ui.card({ class: 'mt' }, h('div', { class: 'card-title' }, '📈 最近的變化'),
          h('div', { class: 'jr-trend' }, recent.map((x) => h('div', { class: 'jr-trend-col', title: C.fmtDate(x.at) },
            h('span', { class: 'jr-trend-mood' }, moodEmoji(x.mood) || '·'),
            h('span', { class: 'jr-trend-dot', style: { background: colorOf(x.lochia?.color), opacity: x.lochia?.amount === 'none' ? 0.25 : 1 } }),
            h('span', { class: 'tiny num' }, x.pain ?? '-'),
            h('span', { class: 'tiny faint' }, C.fmtDate(x.at, false))))),
          h('div', { class: 'tiny muted' }, '上排心情・中排惡露顏色・下排傷口疼痛（0–10）')));
      }
      el.append(h('div', { class: 'section-title' }, h('span', null, '紀錄'), h('button', { onclick: () => openPPLog() }, '＋ 新增')));
      if (!log.length) el.append(ui.empty('🍲', '每天記一下惡露、傷口、體溫和心情，回診時給醫師看，也能及早發現警訊。'));
      else {
        el.append(h('div', { class: 'timeline' }, log.map((x) => {
          const { level } = levelOf(x.symptoms, J().PP_SYMPTOMS, { temp: x.temp });
          const am = (J().LOCHIA.amount.find((a) => a.value === x.lochia?.amount) || {}).label;
          const co = (J().LOCHIA.color.find((a) => a.value === x.lochia?.color) || {}).label;
          const names = (x.symptoms || []).map((id) => (J().PP_SYMPTOMS.find((s) => s.id === id) || {}).label).filter(Boolean);
          return h('button', { class: 'tl-item', onclick: () => openPPLog(x) },
            h('div', { class: 'tl-time num' }, C.fmtDate(x.at, false), h('div', { class: 'tiny faint' }, C.fmtTime(x.at))),
            h('span', { class: 'tl-ico', style: { '--tc': level ? 'var(--c-danger)' : 'var(--c-accent)' } }, moodEmoji(x.mood) || '🍲'),
            h('div', { class: 'tl-body' }, h('div', { class: 'tl-title' }, `惡露 ${am || '-'}・${co || '-'}`, level ? h('span', { class: `tag ${level === 'soon' ? 'warn' : 'danger'}` }, level === 'soon' ? '留意' : '需就醫') : null),
              h('div', { class: 'tl-sub' }, [`疼痛 ${x.pain}/10`, `${Number(x.temp).toFixed(1)}°C`, names.join('、'), x.note].filter(Boolean).join('・'))));
        })));
      }
      const pf = J().PHASES.find((p) => p.id === 'pp');
      el.append(ui.card({ class: 'flat mt jr-watch-card' }, h('div', { class: 'card-title' }, '⚠️ 產後要就醫的警訊'), h('ul', { class: 'jr-watch' }, pf.watch.map((x) => h('li', null, x)))));
      el.append(hotlineCard());
      el.append(h('p', { class: 'disclaimer' }, '內容為一般衛教資訊，不能取代醫師建議。'));
    },
  });

  /* ================= home cards ================= */
  App.homeCard('journey', {
    stages: ['preg'],
    order: 12,
    render(el) {
      const cur = current();
      if (cur.kind !== 'preg') return;
      const p = J().PHASES[cur.idx];
      const done = store.state.journey.done;
      const next = p.todo.filter((t) => !done[t.id] && (!t.week || t.week <= cur.ga.weeks + 4)).slice(0, 2);
      el.append(ui.card({ class: 'jr-home' },
        h('div', { class: 'row between' }, h('div', { class: 'card-title' }, '🗺️ 孕產路線圖'), h('span', { class: 'tag primary' }, `${p.icon} ${p.title}`)),
        next.length ? h('div', { class: 'jr-todos' }, next.map((t) => h('div', { class: 'jr-todo' },
          h('label', { class: 'jr-todo-main' }, h('input', { type: 'checkbox', onchange: () => toggleTodo(t.id) }), h('span', null, t.text)),
          (t.tool && App.screens[t.tool]) ? h('button', { class: 'btn btn-sm btn-soft', onclick: () => openTool(t) }, '前往') : null)))
          : h('p', { class: 'small muted' }, '這個階段該做的事都完成了 👏'),
        h('div', { class: 'jr-home-warn small' }, h('b', null, '⚠️ 注意：'), p.watch[0]),
        h('div', { class: 'row gap-sm mt' },
          h('button', { class: 'btn btn-sm btn-primary grow', onclick: () => openPregJournal() }, '📝 記錄身體狀況'),
          h('button', { class: 'btn btn-sm btn-ghost grow', onclick: () => App.navigate('journey') }, '完整路線圖'))));
    },
  });
  App.homeCard('postpartum', {
    stages: ['baby'],
    order: 8,
    render(el) {
      const pp = ppInfo();
      if (!pp || !pp.inConfinement) return;
      const loggedToday = (store.state.postpartum.log || []).some((x) => C.dateKey(new Date(x.at)) === C.dateKey());
      el.append(ui.card({ class: 'jr-home jr-pp-home' },
        h('div', { class: 'row between' }, h('div', { class: 'card-title' }, `🍲 坐月子・產後第 ${pp.day} 天`), h('span', { class: `tag ${loggedToday ? 'ok' : 'warn'}` }, loggedToday ? '今天已記錄' : '今天還沒記錄')),
        h('div', { class: 'mt' }, ui.progress(pp.day / 42)),
        newbornChecks(),
        h('div', { class: 'row gap-sm mt' },
          h('button', { class: 'btn btn-sm btn-primary grow', onclick: () => openPPLog() }, '記錄身體恢復'),
          h('button', { class: 'btn btn-sm btn-ghost grow', onclick: () => App.navigate('postpartum') }, '注意事項'))));
    },
  });

  /* ================= tools ================= */
  App.tool({ id: 'journey', title: '孕產路線圖', icon: '🗺️', desc: '每階段該做的事＋注意事項', stages: ['preg'], screen: 'journey', order: 5, group: '孕期' });
  App.tool({ id: 'postpartum', title: '產後恢復', icon: '🍲', desc: '惡露、傷口、心情＋新生兒觀察', stages: ['baby'], screen: 'postpartum', order: 60, group: '媽媽' });
  App.tool({ id: 'journey-baby', title: '孕產路線圖', icon: '🗺️', desc: '生產到坐月子的注意事項', stages: ['baby'], screen: 'journey', order: 61, group: '媽媽' });

  App.journey = { current, ppInfo, openPregJournal, openPPLog, openBirthSheet, newbornChecks, pregEntries };
}());
