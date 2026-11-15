/* 生育力自我評估（備孕）＋ 補助福利清單（全階段）。
 * 評估只判斷「是否該找生殖醫學專科」與生活建議，不是診斷。 */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const X = () => App.EXTRAS;

  const ensure = (s) => {
    s.fertility = s.fertility || { answers: {}, result: null };
    s.benefits = s.benefits || {};
  };
  ensure(store.state);

  /* ================= 生育力自我評估 ================= */
  function evaluate(a) {
    const age = Number(a.age) || 0;
    const months = Number(a.trying) || 0;
    const hist = a.history || [];
    const partner = a.partner || [];
    const life = a.life || [];
    const reasons = [];
    let level = 'ok';
    const see = (why) => { reasons.push(why); level = 'see'; };
    if (age >= 40) see('40 歲以上，建議直接與生殖醫學專科討論');
    if (age >= 35 && months >= 6) see('35 歲以上、嘗試超過 6 個月');
    if (age < 35 && months >= 13) see('嘗試超過 12 個月');
    if (a.cycle === 'absent') see('超過 3 個月沒有月經');
    if (a.cycle === 'irregular') see('月經週期不規律（可能影響排卵）');
    if (hist.includes('endo') || a.pain === 'yes') see('經痛明顯或有子宮內膜異位症病史');
    if (hist.includes('pid') || hist.includes('surgery')) see('有骨盆腔發炎或卵巢／輸卵管手術史');
    if (hist.includes('miscarriage')) see('曾流產 2 次以上');
    if (hist.includes('chemo')) see('曾接受化療或放射治療');
    if (partner.includes('abnormal')) see('伴侶精液檢查有異常');
    if (level === 'ok' && (hist.includes('pcos') || hist.includes('thyroid'))) { level = 'watch'; reasons.push('有多囊或甲狀腺病史，建議先和醫師討論、規律追蹤'); }
    const tips = [];
    if (!life.includes('folic')) tips.push('每天補充葉酸（備孕期間就開始）');
    if (life.includes('smoke') || partner.includes('pSmoke')) tips.push('夫妻一起戒菸，菸害會影響卵子與精子品質');
    if (life.includes('alcohol')) tips.push('減少飲酒，備孕期間最好不喝');
    if (life.includes('stay')) tips.push('規律作息、減少熬夜，給身體穩定的節奏');
    if (!partner.includes('semen')) tips.push('伴侶可以做一次精液檢查，簡單又重要');
    if (partner.includes('heat')) tips.push('伴侶避免長時間泡溫泉、久坐或高溫環境');
    if (age && age < 35 && months < 13) tips.push('在易孕期（排卵前後）規律同房，可用「經期與排卵」幫你推算');
    tips.push('夫妻一起做孕前健康檢查（可查詢國健署孕前檢查補助）');
    return { level, reasons, tips, date: C.dateKey() };
  }

  function renderFertility(el) {
    ensure(store.state);
    const a = JSON.parse(JSON.stringify(store.state.fertility.answers || {}));
    const form = h('div', { class: 'stack' });
    X().FERTILITY_Q.forEach((q) => {
      let ctrl;
      if (q.type === 'num') {
        ctrl = h('input', { type: 'number', inputmode: 'numeric', class: 'input', min: q.min, max: q.max, value: a[q.id] ?? '', placeholder: q.unit, 'aria-label': q.q });
        ctrl.addEventListener('input', () => { a[q.id] = ctrl.value ? Number(ctrl.value) : ''; });
      } else if (q.type === 'one') {
        ctrl = h('div', { class: 'ex-opts', role: 'radiogroup', 'aria-label': q.q }, q.options.map((o) => {
          const b = h('button', {
            type: 'button', role: 'radio', class: `chip ex-opt${a[q.id] === o.v ? ' active' : ''}`, 'aria-checked': String(a[q.id] === o.v),
            onclick: () => { a[q.id] = o.v; ctrl.querySelectorAll('.ex-opt').forEach((x) => { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); }); b.classList.add('active'); b.setAttribute('aria-checked', 'true'); },
          }, o.l);
          return b;
        }));
      } else {
        a[q.id] = a[q.id] || [];
        ctrl = h('div', { class: 'ex-opts' }, q.options.map((o) => {
          const b = h('button', {
            type: 'button', class: `chip ex-opt${a[q.id].includes(o.v) ? ' active' : ''}`, 'aria-pressed': String(a[q.id].includes(o.v)),
            onclick: () => { const on = !a[q.id].includes(o.v); a[q.id] = on ? [...a[q.id], o.v] : a[q.id].filter((x) => x !== o.v); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); },
          }, o.l);
          return b;
        }));
      }
      form.append(h('div', { class: 'ex-q' }, h('div', { class: 'ex-q-t' }, q.q), ctrl));
    });
    const r = store.state.fertility.result;
    el.append(ui.card({ class: 'soft' },
      h('div', { class: 'card-title' }, '🧪 生育力自我評估'),
      h('p', { class: 'small muted' }, '回答幾個問題，幫你判斷什麼時候該找生殖醫學專科，以及現在可以先做什麼。答案只存在你的手機。')));
    if (r) el.append(resultCard(r));
    el.append(h('div', { class: 'section-title' }, r ? '重新評估' : '開始評估'));
    el.append(ui.card(null, form,
      h('button', {
        class: 'btn btn-primary btn-block mt',
        onclick: () => {
          if (!a.age || a.trying === undefined || !a.cycle) { ui.toast('請至少填年齡、嘗試多久、月經週期'); return; }
          const res = evaluate(a);
          store.update((s) => { ensure(s); s.fertility = { answers: a, result: res }; });
          window.scrollTo(0, 0);
          ui.toast('已產生評估結果');
        },
      }, '看評估結果')));
    el.append(h('p', { class: 'disclaimer' }, '一般原則：35 歲以下規律同房一年、35 歲以上半年仍未懷孕，建議尋求生殖醫學專科。此評估不是診斷，詳細請與醫師討論。'));
  }
  function resultCard(r) {
    const copy = {
      see: { title: '建議找生殖醫學專科聊聊', cls: 'ex-see', icon: '🩺' },
      watch: { title: '可以先自然嘗試，並和醫師討論', cls: 'ex-watch', icon: '💬' },
      ok: { title: '目前可以先自然嘗試', cls: 'ex-ok', icon: '🌱' },
    }[r.level];
    return ui.card({ class: `ex-result ${copy.cls}` },
      h('div', { class: 'tiny muted' }, `評估日期 ${C.fmtDate(r.date)}`),
      h('div', { class: 'ex-result-title' }, `${copy.icon} ${copy.title}`),
      r.reasons.length ? h('ul', { class: 'tight small' }, r.reasons.map((x) => h('li', null, x))) : null,
      h('div', { class: 'bold small mt' }, '現在可以做的事'),
      h('ul', { class: 'tight small' }, r.tips.map((x) => h('li', null, x))),
      h('div', { class: 'row gap-sm wrap mt' },
        App.screens.cycle ? h('button', { class: 'btn btn-sm btn-soft', onclick: () => App.navigate('cycle') }, '🌸 經期與排卵') : null,
        App.screens.prepcheck ? h('button', { class: 'btn btn-sm btn-soft', onclick: () => App.navigate('prepcheck') }, '📋 孕前準備清單') : null,
        h('button', { class: 'btn btn-sm btn-soft', onclick: () => App.navigate('benefits') }, '🏛️ 補助清單')));
  }
  App.screen('fertility', { title: '生育力自我評估', tab: 'health', render: renderFertility });
  App.tool({ id: 'fertility', title: '生育力自我評估', icon: '🧪', desc: '何時該看生殖科、現在能做什麼', stages: ['prep'], screen: 'fertility', order: 15, group: '備孕' });

  /* ================= 補助福利清單（政策島） ================= */
  const STAGE_LABEL = { prep: '備孕', preg: '懷孕', birth: '生產', baby: '育兒' };
  const STATUS = [{ value: 'todo', label: '還沒辦' }, { value: 'applied', label: '已申請' }, { value: 'done', label: '完成' }];
  let bFilter = null;
  const defaultFilter = () => (store.stage === 'baby' ? (store.inStage(['preg']) ? 'preg' : 'baby') : store.stage);
  function openBenefit(b) {
    const cur = store.state.benefits[b.id] || { status: 'todo' };
    const status = ui.seg(STATUS, cur.status || 'todo', null, { small: true });
    const date = h('input', { type: 'date', value: cur.date || '' });
    const note = h('textarea', { rows: 2, placeholder: '例如：送件編號、要補的文件' }, cur.note || '');
    const sh = ui.sheet({
      title: b.title,
      body: h('div', null,
        h('p', { class: 'small' }, b.desc),
        h('p', { class: 'small muted' }, `承辦：${b.where}`),
        b.url ? h('a', { class: 'btn btn-sm btn-ghost mb', href: b.url, target: '_blank', rel: 'noopener' }, '開啟官方網站 ↗') : null,
        ui.field('辦理進度', status), ui.field('日期', date), ui.field('備註', note)),
      footer: h('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => { store.update((s) => { ensure(s); s.benefits[b.id] = { status: status.dataset.value, date: date.value, note: note.value.trim() }; }); sh.close(); ui.toast('已更新'); },
      }, '儲存'),
    });
  }
  App.screen('benefits', {
    title: '補助福利清單',
    tab: 'health',
    render(el) {
      ensure(store.state);
      if (!bFilter) bFilter = defaultFilter();
      const all = X().BENEFITS;
      const doneCount = all.filter((b) => (store.state.benefits[b.id] || {}).status === 'done').length;
      el.append(ui.card({ class: 'soft' },
        h('div', { class: 'row between' }, h('div', { class: 'card-title' }, '🏛️ 補助福利清單'), h('span', { class: 'tag primary' }, `完成 ${doneCount}/${all.length}`)),
        h('p', { class: 'small muted' }, '從備孕到育兒可以用的補助、假別與手續，一項一項打勾。金額與資格請以政府最新公告為準。'),
        ui.progress(doneCount / all.length)));
      el.append(h('div', { class: 'mt' }, ui.seg(Object.entries(STAGE_LABEL).map(([value, label]) => ({ value, label })), bFilter, (v) => { bFilter = v; App.refresh(); }, { small: true })));
      el.append(h('div', { class: 'list mt' }, all.filter((b) => b.stage === bFilter).map((b) => {
        const st = (store.state.benefits[b.id] || {}).status || 'todo';
        return h('button', { class: 'list-item', onclick: () => openBenefit(b) },
          h('span', { class: 'li-icon' }, st === 'done' ? '✅' : st === 'applied' ? '📨' : '📄'),
          h('span', { class: 'li-body' }, h('span', { class: 'li-title', style: { display: 'block' } }, b.title), h('span', { class: 'li-sub', style: { display: 'block' } }, `${b.where}・${b.desc}`)),
          h('span', { class: 'li-right' }, h('span', { class: `tag ${st === 'done' ? 'ok' : st === 'applied' ? 'warn' : ''}` }, STATUS.find((x) => x.value === st).label)));
      })));
      el.append(h('p', { class: 'disclaimer' }, '整理自政府公開資訊，不含金額；各項資格、金額與流程以主管機關最新公告為準。'));
    },
  });
  App.tool({ id: 'benefits', title: '補助福利清單', icon: '🏛️', desc: '產檢假、生育給付、育兒津貼…', stages: ['prep', 'preg', 'baby'], screen: 'benefits', order: 80, group: '福利' });

  App.extras = { evaluate };
}());
