/* 母乳庫存 — breast-milk bag inventory with storage-based expiry, FIFO use. */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;

  const live = () => store.state.milk.filter((b) => !b.usedAt && b.ml > 0);
  const byExpiry = (a, b) => C.milkExpiry(a) - C.milkExpiry(b);

  App.milk = {
    available() { return C.sum(live().filter((b) => C.milkExpiry(b) > new Date()), (b) => b.ml); },
    addBag({ ml, pumpedAt = new Date().toISOString(), storage = 'fridge', note = '' }) {
      store.update((s) => { s.milk.push({ id: C.uid(), ml: Number(ml), originalMl: Number(ml), pumpedAt, storage, thawedAt: null, usedAt: null, note }); });
    },
    // use `ml` from oldest-expiring, non-expired bags first
    consume(ml) {
      let need = Number(ml) || 0;
      store.update((s) => {
        const bags = s.milk.filter((b) => !b.usedAt && b.ml > 0 && C.milkExpiry(b) > new Date()).sort(byExpiry);
        for (const b of bags) {
          if (need <= 0) break;
          const take = Math.min(b.ml, need);
          b.ml -= take; need -= take;
          if (b.ml <= 0) { b.ml = 0; b.usedAt = new Date().toISOString(); }
        }
      });
    },
  };

  function status(bag) {
    const exp = C.milkExpiry(bag);
    const left = exp - Date.now();
    if (left <= 0) return { cls: 'danger', text: '已過期', exp };
    if (left < 24 * C.HOUR) return { cls: 'warn', text: `${C.fmtDuration(left)}後到期`, exp };
    return { cls: 'ok', text: `${Math.ceil(left / C.DAY)} 天後到期`, exp };
  }

  function bagSheet(bag) {
    const isEdit = !!bag;
    const ml = ui.stepper({ value: bag ? bag.ml : 100, step: 10, unit: 'ml' });
    const at = h('input', { type: 'datetime-local', value: C.toLocalInput(bag ? bag.pumpedAt : new Date()) });
    const where = ui.seg([{ value: 'fridge', label: '冷藏' }, { value: 'freezer', label: '冷凍' }, { value: 'room', label: '室溫' }], bag ? bag.storage : 'fridge', null, { small: true });
    const note = h('input', { value: bag?.note || '', placeholder: '例如：袋號、標籤' });
    const sh = ui.sheet({
      title: isEdit ? '編輯母乳袋' : '新增母乳袋',
      body: h('div', null, ui.field('奶量', ml), ui.field('擠出時間', at), ui.field('存放方式', where), ui.field('備註', note)),
      footer: h('div', { class: 'row gap' },
        isEdit ? h('button', { class: 'btn btn-ghost', 'aria-label': '刪除', onclick: async () => { if (await ui.confirm('刪除這袋母乳紀錄？', { ok: '刪除', danger: true })) { store.update((s) => { s.milk = s.milk.filter((x) => x.id !== bag.id); }); sh.close(); } } }, ui.icon('trash')) : null,
        h('button', {
          class: 'btn btn-primary grow',
          onclick: () => {
            if (isEdit) {
              store.update((s) => { const b = s.milk.find((x) => x.id === bag.id); Object.assign(b, { ml: ml.getValue(), pumpedAt: new Date(at.value).toISOString(), storage: where.dataset.value, note: note.value.trim() }); });
            } else {
              App.milk.addBag({ ml: ml.getValue(), pumpedAt: new Date(at.value).toISOString(), storage: where.dataset.value, note: note.value.trim() });
            }
            sh.close(); ui.toast('已儲存');
          },
        }, '儲存')),
    });
  }

  function bagRow(bag) {
    const st = status(bag);
    const label = bag.thawedAt ? '已解凍' : C.MILK_RULES[bag.storage]?.label;
    const actions = h('div', { class: 'row gap-sm milk-actions' },
      bag.storage === 'freezer' && !bag.thawedAt ? h('button', { class: 'btn btn-sm btn-soft', onclick: () => store.update((s) => { s.milk.find((x) => x.id === bag.id).thawedAt = new Date().toISOString(); }) }, '解凍') : null,
      bag.storage === 'fridge' && !bag.thawedAt ? h('button', { class: 'btn btn-sm btn-soft', onclick: () => store.update((s) => { s.milk.find((x) => x.id === bag.id).storage = 'freezer'; }) }, '移冷凍') : null,
      h('button', { class: 'btn btn-sm btn-primary', onclick: () => { store.update((s) => { const b = s.milk.find((x) => x.id === bag.id); b.usedAt = new Date().toISOString(); }); ui.toast('已標記使用'); } }, '用掉'));
    return h('div', { class: 'list-item milk-row' },
      h('span', { class: 'li-icon', style: { background: 'var(--c-primary-soft)' } }, bag.storage === 'freezer' && !bag.thawedAt ? '🧊' : '🥛'),
      h('button', { class: 'li-body link-reset', onclick: () => bagSheet(bag) },
        h('div', { class: 'li-title num' }, `${bag.ml} ml`, h('span', { class: 'tag' }, label)),
        h('div', { class: 'li-sub' }, `${C.fmtDate(bag.pumpedAt)} ${C.fmtTime(bag.pumpedAt)} 擠`, bag.note ? `・${bag.note}` : ''),
        h('span', { class: `tag ${st.cls}` }, st.text)),
      actions);
  }

  App.screen('milk', {
    title: '母乳庫存',
    actions: () => [h('button', { class: 'icon-btn', 'aria-label': '新增', html: ui.ICONS.plus, onclick: () => bagSheet() })],
    render(el) {
      const bags = live().sort(byExpiry);
      const valid = bags.filter((b) => C.milkExpiry(b) > new Date());
      const sumOf = (f) => C.sum(valid.filter(f), (b) => b.ml);
      el.append(h('div', { class: 'grid-3' },
        stat('冷藏', sumOf((b) => b.storage === 'fridge' && !b.thawedAt)),
        stat('冷凍', sumOf((b) => b.storage === 'freezer' && !b.thawedAt)),
        stat('已解凍／室溫', sumOf((b) => b.thawedAt || b.storage === 'room'))));
      const expired = bags.filter((b) => C.milkExpiry(b) <= new Date());
      if (expired.length) {
        el.append(h('div', { class: 'card accent mt' }, h('div', { class: 'card-title' }, `有 ${expired.length} 袋已超過建議保存時間`),
          h('button', { class: 'btn btn-sm btn-ghost mt', onclick: async () => { if (await ui.confirm('把過期的母乳袋全部移除？', { ok: '移除', danger: true })) store.update((s) => { s.milk = s.milk.filter((b) => !expired.some((e) => e.id === b.id)); }); } }, '清除過期')));
      }
      el.append(h('div', { class: 'section-title' }, h('span', null, `庫存（${bags.length} 袋，先到期先用）`), h('button', { onclick: () => bagSheet() }, '＋ 新增')));
      if (!bags.length) el.append(ui.empty('🍶', '還沒有庫存。記錄「擠奶」時勾選「存入母乳庫存」，或按右上角＋新增。'));
      else el.append(h('div', { class: 'list' }, bags.map(bagRow)));

      el.append(h('div', { class: 'card soft mt-lg' },
        h('div', { class: 'card-title' }, '母乳保存參考'),
        h('ul', { class: 'small tight' },
          h('li', null, '室溫（25°C 以下）：4 小時內'),
          h('li', null, '冷藏（4°C）：4 天內'),
          h('li', null, '冷凍（-18°C）：6 個月內最佳，最長 12 個月'),
          h('li', null, '解凍後放冷藏：24 小時內用完，不要再次冷凍'),
          h('li', null, '寶寶喝過剩下的奶：2 小時內未喝完就丟棄')),
        h('p', { class: 'tiny faint' }, '依常見母乳保存指引整理（如美國 CDC、國健署母乳哺育資料），實際請依醫療院所衛教為準。')));
    },
  });
  const stat = (label, ml) => h('div', { class: 'card flat center stat-card' }, h('div', { class: 'big-num num' }, ml), h('div', { class: 'tiny muted' }, `${label}（ml）`));

  App.tool({ id: 'milk', title: '母乳庫存', icon: '🧊', desc: '冷藏冷凍袋數、到期提醒', stages: ['baby'], screen: 'milk', order: 15, group: '餵養' });
}());
