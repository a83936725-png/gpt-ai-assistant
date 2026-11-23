/* 生育力自我評估（備孕）＋ 補助福利清單（全階段）＋ 首頁「現在可以申請的福利」。
 * 評估只判斷「是否該找生殖醫學專科」與生活建議，不是診斷。
 * 福利：金額、時機與期限整理自 2026 年 11 月的公告（js/data/extras-data.js），以主管機關最新公告為準。 */
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
      h('div', { class: 'card-title' }, '生育力自我評估'),
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
  // days left until a deadline: counted from the baby's birth (due), or this year's last day (ends); the sooner one.
  // null when there is none, or it has passed
  const daysLeft = (b, baby, today = new Date()) => {
    const lefts = [];
    if (b.due && baby && baby.birthday) lefts.push(b.due - C.diffDays(baby.birthday, today));
    if (b.ends) lefts.push(C.diffDays(today, b.ends));
    if (!lefts.length) return null;
    const left = Math.min(...lefts);
    return left >= 0 ? left : null;
  };
  const ended = (b, today = new Date()) => !!b.ends && C.diffDays(today, b.ends) < 0; // this year's round is over
  const whenText = (b, left, today) => `⏰ ${b.when}${left !== null ? `（還剩 ${left} 天）` : ended(b, today) ? '（今年度已截止，請看最新公告）' : ''}`;
  const titleOf = (b) => (b.cond ? `${b.title}（${b.cond}）` : b.title);
  function openBenefit(b) {
    ensure(store.state);
    const cur = store.state.benefits[b.id] || { status: 'todo' };
    const status = ui.seg(STATUS, cur.status || 'todo', null, { small: true });
    const date = h('input', { type: 'date', value: cur.date || '' });
    const note = h('textarea', { rows: 2, placeholder: '例如：送件編號、要補的文件' }, cur.note || '');
    const left = daysLeft(b, store.stage === 'baby' ? store.baby() : null);
    const sh = ui.sheet({
      title: titleOf(b),
      body: h('div', { class: 'bn-sheet' },
        b.amount ? h('div', { class: 'bn-amount' }, b.amount) : null,
        b.when ? h('p', { class: 'small bn-when' }, whenText(b, left)) : null,
        b.local ? h('p', { class: 'small bn-local' }, '📍 只有部分縣市有，請以戶籍地的公告為準') : null,
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
        h('div', { class: 'row between' }, h('div', { class: 'card-title' }, '補助福利清單'), h('span', { class: 'tag primary' }, `完成 ${doneCount}/${all.length}`)),
        h('p', { class: 'small muted' }, '從備孕到育兒可以領的補助、可以請的假和要辦的手續，標出金額、什麼時候辦，一項一項打勾。金額與資格整理自 2026 年 11 月的公告，以政府最新公告為準。'),
        ui.progress(doneCount / all.length)));
      // the money most families can count on, at a glance (each line opens its item)
      if (store.inStage(['preg', 'baby'])) {
        const cash = ['birth-pay', 'allowance-02', 'parental', 'tax-preschool'].map((id) => all.find((b) => b.id === id)).filter(Boolean);
        el.append(ui.card({ class: 'bn-cash' },
          h('div', { class: 'card-title' }, '寶寶出生後常見的現金福利'),
          h('div', { class: 'bn-rows' }, cash.map((b) => h('button', { class: 'bn-row', onclick: () => openBenefit(b) },
            h('span', { class: 'grow' }, h('b', null, b.title), h('span', { class: 'small muted bn-row-sub' }, `${b.amount}${b.when ? `・${b.when.split('；')[0].split('（')[0]}` : ''}`)),
            h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')))),
          h('p', { class: 'tiny muted mt' }, '育兒津貼和托育補助只能擇一；每一項的資格以公告為準。')));
      }
      el.append(h('div', { class: 'mt' }, ui.seg(Object.entries(STAGE_LABEL).map(([value, label]) => ({ value, label })), bFilter, (v) => { bFilter = v; App.refresh(); }, { small: true })));
      const baby = store.stage === 'baby' ? store.baby() : null;
      el.append(h('div', { class: 'list mt' }, all.filter((b) => b.stage === bFilter).map((b) => {
        const st = (store.state.benefits[b.id] || {}).status || 'todo';
        const left = daysLeft(b, baby);
        return h('button', { class: 'list-item bn-item', onclick: () => openBenefit(b) },
          h('span', { class: 'li-icon' }, st === 'done' ? '✅' : st === 'applied' ? '📨' : '📄'),
          h('span', { class: 'li-body' },
            h('span', { class: 'li-title', style: { display: 'block' } }, titleOf(b), b.amount ? h('span', { class: 'bn-pill' }, b.amount) : null),
            h('span', { class: 'li-sub', style: { display: 'block' } }, b.when ? whenText(b, left) : `${b.where}・${b.desc}`)),
          h('span', { class: 'li-right' }, h('span', { class: `tag ${st === 'done' ? 'ok' : st === 'applied' ? 'warn' : ''}` }, b.auto && st === 'todo' ? '免申請' : STATUS.find((x) => x.value === st).label)));
      })));
      el.append(h('p', { class: 'disclaimer' }, '整理自政府公開資訊與新聞（2026 年 11 月）；各項資格、金額與流程以主管機關最新公告為準。標「免申請」的是到院所就有的公費服務。'));
    },
  });
  App.tool({
    id: 'benefits', title: '補助福利清單', icon: '🏛️', desc: '生育補助 10 萬、育兒津貼、育嬰留停 8 成薪…', stages: ['prep', 'preg', 'baby'], screen: 'benefits', order: 80, group: '福利',
    tags: ['福利', '補助', '津貼', '育兒津貼', '生育補助', '生育給付', '育嬰假', '育嬰留停', '托育', '托育補助', '產假', '產檢假', '陪產假', '哺乳時間', '報稅', '扣除額', '流感疫苗', '新生兒篩檢', '出生登記',
      '租金補貼', '租屋', '羊膜穿刺', '產前遺傳診斷', '唐氏症篩檢', 'NIPT', '好孕專車', '試管嬰兒', '塗氟'],
  });

  /* ================= 首頁：現在可以申請的福利 =================
   * 懷孕中：孕期的假與疫苗；育兒中：依寶寶天數（有期限的排前面、倒數天數）。已申請／完成、到院所就有的不提醒；
   * 季節性的（流感疫苗、報稅）只在那幾個月。✕ 兩週內不再出現。 */
  function nowItems(today = new Date()) {
    ensure(store.state);
    const st = store.state.benefits;
    // (county-only items and ones whose round is over are never suggested)
    const pending = (b) => !b.auto && !b.local && !ended(b, today) && !['done', 'applied'].includes((st[b.id] || {}).status) && (!b.months || b.months.includes(today.getMonth() + 1));
    let list = [];
    if (store.inStage(['preg'])) list = X().BENEFITS.filter((b) => b.stage === 'preg' && pending(b)).map((b) => ({ b, left: null }));
    const baby = store.stage === 'baby' ? store.baby() : null;
    if (baby && baby.birthday) {
      const age = C.diffDays(baby.birthday, today);
      list = list.concat(X().BENEFITS.filter((b) => b.ages && age >= b.ages[0] && age <= b.ages[1] && pending(b)).map((b) => ({ b, left: daysLeft(b, baby, today) })));
    }
    // for every family first (deadlines first, soonest first); things for some families (租屋族) after those
    return list.sort((x, y) => (x.b.cond ? 1 : 0) - (y.b.cond ? 1 : 0) || (x.left ?? 1e9) - (y.left ?? 1e9));
  }
  App.homeCard('benefits-now', {
    stages: ['preg', 'baby'],
    order: 14,
    render(el) {
      const off = store.state.benefitsHomeOff;
      if (off && C.diffDays(off, new Date()) < 14) return;
      const items = nowItems();
      if (!items.length) return;
      el.append(ui.card({ class: 'bn-home' },
        h('div', { class: 'row between' },
          h('div', { class: 'card-title' }, '現在可以申請的福利'),
          h('button', {
            class: 'icon-btn bn-home-x', 'aria-label': '先不要提醒',
            onclick: () => { store.update((s) => { s.benefitsHomeOff = C.dateKey(); }); ui.toast('兩週內不提醒；福利清單隨時在「健康 → 補助福利清單」'); },
          }, '✕')),
        h('div', { class: 'bn-rows' }, items.slice(0, 3).map(({ b, left }) => h('button', { class: 'bn-row', onclick: () => openBenefit(b) },
          h('span', { class: 'grow' }, h('b', null, titleOf(b)),
            h('span', { class: 'small muted bn-row-sub' }, left !== null ? h('span', { class: 'bn-left' }, `還剩 ${left} 天`) : null, left !== null && b.amount ? '・' : null, b.amount || (left === null ? b.when || '' : ''))),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')))),
        h('button', { class: 'link-btn small bn-all', onclick: () => App.navigate('benefits') }, `看全部福利（${X().BENEFITS.length} 項）›`)));
    },
  });

  App.extras = { evaluate, nowItems, openBenefit };
}());
