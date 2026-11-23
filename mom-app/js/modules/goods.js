/* 常見好物：依階段推薦要準備的東西、怎麼挑、安全提醒、哪些先別買；
 * 我的清單（要買／想請親友送／已有／不需要）、自己新增、願望清單分享給親友（'wishlist' 公開頁）。 */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const G = () => App.GOODS;
  const B = () => window.BRAND || {};

  const ST = {
    buy: { label: '要買', icon: '🛒' },
    want: { label: '想請人送', icon: '🎁' },
    have: { label: '已有', icon: '✅' },
    skip: { label: '不需要', icon: '➖' },
  };
  const ensure = (s) => {
    s.goods = s.goods || {};
    s.goods.st = s.goods.st || {};
    s.goods.custom = s.goods.custom || [];
    return s.goods;
  };
  ensure(store.state);

  /* ---------- catalog ---------- */
  function brandItem() {
    const b = B(); const cfg = b.goodsBrandItem || {};
    if (cfg.show === false || !b.brandName) return null;
    return {
      id: 'brand', cat: 'mom', name: cfg.name || b.brandName, emoji: '💜', need: 'nice', when: cfg.when || '孕期、坐月子', brand: true,
      tips: [
        '孕期、坐月子期間的日常飲品選擇之一，搭配均衡飲食',
        '有特殊飲食限制（例如醫師要求限制蛋白質或鈉）時，請先詢問醫師或營養師',
        '保存與加熱方式請依包裝標示',
      ],
      link: 'brand',
    };
  }
  const customItems = () => ensure(store.state).custom.map((c) => ({ ...c, emoji: c.emoji || '⭐', need: c.need || 'nice', custom: true }));
  function catalog() {
    const list = G().ITEMS.slice();
    const bi = brandItem();
    if (bi) list.splice(list.findIndex((x) => x.cat === 'mom'), 0, bi);
    return list.concat(customItems());
  }
  const byId = (id) => catalog().find((x) => x.id === id);
  const catOf = (id) => G().CATS.find((c) => c.id === id) || { id, name: id, emoji: '⭐' };
  const statusOf = (id) => (ensure(store.state).st[id] || {}).s || '';
  const entry = (id) => ensure(store.state).st[id] || {};

  function babyMonths() {
    const b = store.baby();
    if (!b || !b.birthday || !store.inStage(['baby'])) return null;
    try { return C.babyAge(b.birthday).months; } catch (e) { return null; }
  }
  // categories that matter right now (stage + baby age), most urgent first
  function nowCats() {
    const stages = store.stages();
    const m = babyMonths();
    const fits = (c) => {
      if (stages.includes('preg') && c.stages.includes('preg')) return true;
      if (stages.includes('prep') && c.stages.includes('prep')) return true;
      if (!stages.includes('baby') || !c.stages.includes('baby')) return false;
      if (m === null) return !c.ageFrom;
      return (c.ageFrom === undefined || m >= c.ageFrom) && (c.ageTo === undefined || m < c.ageTo);
    };
    const cats = G().CATS.filter(fits);
    if (m !== null && m >= 4 && !stages.includes('preg')) {
      const first = cats.filter((c) => c.id === 'solid' || c.id === 'safe');
      return first.concat(cats.filter((c) => !first.includes(c)));
    }
    return cats;
  }

  /* ---------- mutations ---------- */
  function setStatus(id, s) {
    store.update((st) => {
      const g = ensure(st);
      const cur = g.st[id] || {};
      if (!s) { delete cur.s; delete cur.at; } else { cur.s = s; cur.at = C.dateKey(); }
      if (!cur.s && cur.price === undefined && !cur.note) delete g.st[id]; else g.st[id] = cur;
    });
  }
  function setField(id, k, v) {
    store.update((st) => {
      const g = ensure(st);
      const cur = g.st[id] || {};
      if (v === '' || v === null || v === undefined) delete cur[k]; else cur[k] = v;
      if (!cur.s && cur.price === undefined && !cur.note) delete g.st[id]; else g.st[id] = cur;
    });
  }
  const safeUrl = (u) => {
    const v = String(u || '').trim();
    if (!v) return '';
    try { const x = new URL(v); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch (e) { return null; }
  };
  const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

  /* ---------- detail sheet ---------- */
  const TOOL_NAME = { hospitalbag: '待產包清單', monitor: '看寶寶', milk: '母乳庫存', outing: '外出好幫手', cycle: '經期與排卵', log: '寶寶紀錄', brand: '品牌專區' };
  function shareItem(it) {
    if (!App.share) return;
    const lines = it.need === 'skip' ? [it.why, `可以改用：${it.alt}`] : (it.tips || []).concat(it.safety ? [`⚠️ ${it.safety}`] : []);
    App.share.open({
      title: it.need === 'skip' ? `${it.name}：先別買` : `${it.name}怎麼挑？`,
      text: it.need === 'skip' ? `${it.name}先別買 🙅 ${it.why}` : `${it.name}怎麼挑？${(it.tips || [])[0] || ''}`,
      lines, emoji: it.need === 'skip' ? '🙅' : it.emoji, kicker: '易家做媽媽・常見好物', theme: it.need === 'skip' ? 'peach' : 'green',
      campaign: 'goods-item', path: 'goods', params: { item: it.id }, sheetTitle: '分享這篇好物筆記',
    });
  }

  function openItem(id) {
    const it = byId(id);
    if (!it) return null;
    const N = G().NEED[it.need] || G().NEED.nice;
    const cat = catOf(it.cat);
    const e = entry(id);
    const body = h('div', { class: 'gd-sheet' });
    const head = h('div', { class: 'gd-head' },
      h('span', { class: 'gd-emoji', 'aria-hidden': 'true' }, it.emoji),
      h('div', { class: 'grow' },
        h('div', { class: 'row gap wrap' },
          h('span', { class: `tag ${N.cls}` }, N.label),
          h('span', { class: 'tag' }, `${cat.emoji} ${cat.name}`),
          it.brand ? h('span', { class: 'tag primary' }, '品牌') : null,
          it.custom ? h('span', { class: 'tag' }, '自己新增') : null),
        it.when ? h('div', { class: 'small mt-xs' }, h('b', null, '什麼時候買：'), it.when) : null,
        it.qty ? h('div', { class: 'small' }, h('b', null, '建議數量：'), it.qty) : null));
    body.append(head);
    if (it.need === 'skip') {
      body.append(h('div', { class: 'gd-box gd-why' }, h('div', { class: 'bold' }, '為什麼先別買'), h('p', { class: 'small' }, it.why)),
        h('div', { class: 'gd-box gd-save' }, h('div', { class: 'bold' }, '💡 可以改用'), h('p', { class: 'small' }, it.alt)));
    } else {
      if (it.tips && it.tips.length) body.append(h('div', { class: 'bold mt' }, '挑選重點'), h('ul', { class: 'small gd-tips' }, it.tips.map((t) => h('li', null, t))));
      if (it.safety) body.append(h('div', { class: 'gd-box gd-safety', role: 'note' }, h('div', { class: 'bold' }, '⚠️ 安全提醒'), h('p', { class: 'small' }, it.safety)));
      if (it.save) body.append(h('div', { class: 'gd-box gd-save' }, h('div', { class: 'bold' }, '💡 省錢・二手'), h('p', { class: 'small' }, it.save)));
      if (it.custom && it.url) {
        const u = safeUrl(it.url);
        if (u) body.append(h('a', { class: 'btn btn-ghost btn-block mt', href: u, target: '_blank', rel: 'noopener noreferrer' }, '🔗 打開商品連結'));
      }
      // status
      const opts = ['', 'buy', 'want', 'have', 'skip'];
      const cur = () => statusOf(id);
      const stRow = h('div', { class: 'gd-status', role: 'radiogroup', 'aria-label': '我的狀態' });
      const paint = () => stRow.querySelectorAll('button').forEach((b) => {
        const on = b.dataset.s === cur(); b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on));
      });
      opts.forEach((s) => stRow.append(h('button', {
        type: 'button', role: 'radio', class: 'chip gd-st', dataset: { s },
        onclick: () => { setStatus(id, s); paint(); if (s) ui.toast(`已標記「${ST[s].label}」`); },
      }, s ? `${ST[s].icon} ${ST[s].label}` : '還沒決定')));
      paint();
      const price = h('input', { type: 'number', inputmode: 'numeric', min: '0', max: '9999999', class: 'input', placeholder: '例：1200', value: e.price ?? '', 'aria-label': '價格' });
      price.addEventListener('change', () => {
        const v = price.value === '' ? '' : Math.max(0, Math.min(9999999, Math.round(Number(price.value) || 0)));
        setField(id, 'price', v);
      });
      const note = h('input', { type: 'text', maxlength: '60', class: 'input', placeholder: '例：表姐說可以借我', value: e.note || '', 'aria-label': '備註' });
      note.addEventListener('change', () => setField(id, 'note', note.value.trim().slice(0, 60)));
      body.append(h('div', { class: 'bold mt' }, '我的狀態'), stRow,
        h('div', { class: 'grid-2 mt' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, '價格（選填，元）'), price),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, '備註（選填）'), note)));
    }
    const actions = h('div', { class: 'row gap wrap mt' });
    if (it.link && App.screens[it.link]) actions.append(h('button', { type: 'button', class: 'btn btn-soft grow', onclick: () => { sh.close(); App.navigate(it.link); } }, `前往「${TOOL_NAME[it.link] || '相關工具'}」`));
    if (it.brand && B().shopUrl) actions.append(h('a', { class: 'btn btn-primary grow', href: B().shopUrl, target: '_blank', rel: 'noopener' }, '前往官網'));
    if (!it.custom && App.share) actions.append(h('button', { type: 'button', class: 'btn btn-ghost grow', onclick: () => shareItem(it) }, '📤 分享給朋友'));
    if (it.custom) {
      actions.append(
        h('button', { type: 'button', class: 'btn btn-ghost grow', onclick: () => { sh.close(); setTimeout(() => openCustom(it), 240); } }, '編輯'),
        h('button', {
          type: 'button', class: 'btn btn-ghost grow danger-text',
          onclick: async () => {
            if (!(await ui.confirm(`要刪除「${it.name}」嗎？`, { danger: true, ok: '刪除' }))) return;
            store.update((s) => { const g = ensure(s); g.custom = g.custom.filter((x) => x.id !== it.id); delete g.st[it.id]; });
            sh.close(); ui.toast('已刪除');
          },
        }, '刪除'));
    }
    if (actions.childNodes.length) body.append(actions);
    if (!it.custom && it.need !== 'skip') body.append(h('p', { class: 'tiny muted mt' }, '一般選購原則整理，不推薦特定品牌；規格與法規以商品標示及政府最新公告為準。'));
    const sh = ui.sheet({ title: it.name, body });
    return sh;
  }

  /* ---------- add / edit custom item ---------- */
  function openCustom(existing) {
    const cats = G().CATS.filter((c) => c.id !== 'skip');
    const name = h('input', { type: 'text', class: 'input', maxlength: '30', placeholder: '例：安撫奶嘴', value: existing ? existing.name : '', 'aria-label': '名稱' });
    const cat = h('select', { class: 'input', 'aria-label': '分類' }, cats.map((c) => h('option', { value: c.id, selected: existing ? existing.cat === c.id : c.id === (nowCats()[0] || cats[0]).id }, `${c.emoji} ${c.name}`)));
    const url = h('input', { type: 'url', class: 'input', maxlength: '500', placeholder: 'https://…（選填）', value: existing ? existing.url || '' : '', 'aria-label': '商品連結' });
    const price = h('input', { type: 'number', inputmode: 'numeric', min: '0', class: 'input', placeholder: '選填', value: existing ? entry(existing.id).price ?? '' : '', 'aria-label': '價格' });
    let sh = null;
    const save = h('button', {
      type: 'button', class: 'btn btn-primary btn-block mt',
      onclick: () => {
        const n = name.value.trim().slice(0, 30);
        if (!n) { ui.toast('請輸入名稱'); name.focus(); return; }
        const u = safeUrl(url.value);
        if (u === null) { ui.toast('連結要用 https:// 開頭'); url.focus(); return; }
        const p = price.value === '' ? undefined : Math.max(0, Math.min(9999999, Math.round(Number(price.value) || 0)));
        const isNew = !existing;
        store.update((s) => {
          const g = ensure(s);
          if (existing) {
            const x = g.custom.find((c) => c.id === existing.id);
            if (x) Object.assign(x, { name: n, cat: cat.value, url: u });
          } else {
            const id = `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
            g.custom.push({ id, name: n, cat: cat.value, url: u });
            g.st[id] = { s: 'buy', at: C.dateKey() };
            existing = { id };
          }
          const e = g.st[existing.id] || {};
          if (p === undefined) delete e.price; else e.price = p;
          g.st[existing.id] = e;
        });
        sh.close(); ui.toast(isNew ? '已加入「要買」清單' : '已儲存');
      },
    }, '儲存');
    sh = ui.sheet({
      title: existing ? '編輯好物' : '新增自己的好物',
      body: h('div', { class: 'stack' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '名稱'), name),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '分類'), cat),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '商品連結（選填）'), url),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '價格（選填，元）'), price),
        save),
    });
    setTimeout(() => name.focus(), 260);
  }

  /* ---------- wishlist share ---------- */
  function wishParams() {
    const g = ensure(store.state);
    const ids = catalog().filter((x) => g.st[x.id] && g.st[x.id].s === 'want');
    const w = ids.filter((x) => !x.custom && !x.brand).map((x) => x.id).slice(0, 30);
    const c = ids.filter((x) => x.custom).map((x) => x.name.slice(0, 30)).slice(0, 12);
    const p = { w: w.join(',') };
    if (c.length) p.c = c;
    const nm = store.state.profile.momName;
    const priv = (store.state.share && store.state.share.privacy) || { showName: true };
    if (nm && priv.showName !== false) p.n = String(nm).slice(0, 20);
    return { p, items: ids };
  }
  function shareWishlist() {
    const { p, items } = wishParams();
    if (!items.length) { ui.toast('先在好物裡標記「想請人送」'); return; }
    const names = items.map((x) => x.name);
    const who = p.n ? `${p.n}的` : '我的';
    App.share.open({
      title: `${who}寶寶好物願望清單`,
      text: `${who}寶寶好物願望清單 🎁\n${names.slice(0, 8).map((n) => `・${n}`).join('\n')}${names.length > 8 ? `\n…共 ${names.length} 項` : ''}\n想送禮的親友可以點連結看完整清單，避免買重複 💜`,
      lines: names.slice(0, 5), items: names, emoji: '🎁', kicker: '寶寶好物願望清單', theme: 'peach',
      campaign: 'wishlist', path: 'wishlist', params: p, sheetTitle: '分享願望清單給親友',
    });
  }
  function shareShopping(items) {
    const total = items.reduce((a, x) => a + (entry(x.id).price || 0), 0);
    App.share.open({
      title: '寶寶用品購物清單',
      text: `寶寶用品購物清單 🛒\n${items.map((x) => `・${x.name}${entry(x.id).price ? `（${money(entry(x.id).price)}）` : ''}`).join('\n')}${total ? `\n預估 ${money(total)}` : ''}`,
      lines: items.slice(0, 5).map((x) => x.name), items: items.map((x) => x.name), emoji: '🛒', kicker: '易家做媽媽・常見好物', theme: 'green',
      campaign: 'goods-list', path: 'goods', sheetTitle: '分享購物清單',
    });
  }

  /* ---------- list UI ---------- */
  const NEED_FILTERS = [{ value: 'all', label: '全部' }, { value: 'must', label: '必備' }, { value: 'nice', label: '好用' }, { value: 'later', label: '晚點買' }];
  let tab = 'now';
  let needF = 'all';
  let catF = 'all';

  function itemRow(it) {
    const s = statusOf(it.id);
    const N = it.custom ? { label: '自己新增', cls: 'gd-later' } : (G().NEED[it.need] || G().NEED.nice);
    const e = entry(it.id);
    const sub = it.need === 'skip' ? it.why : [it.when, it.qty].filter(Boolean).join('・');
    return h('button', {
      type: 'button', class: `list-item gd-item${s === 'have' || s === 'skip' ? ' done' : ''}`, dataset: { item: it.id },
      onclick: () => openItem(it.id),
    },
    h('span', { class: 'gd-ico', 'aria-hidden': 'true' }, it.emoji),
    h('span', { class: 'li-body' },
      h('span', { class: 'li-title' }, it.name, it.brand ? h('span', { class: 'tag primary gd-mini' }, '品牌') : null),
      sub ? h('span', { class: 'li-sub' }, sub) : null),
    h('span', { class: 'gd-right' },
      s ? h('span', { class: `gd-state gd-s-${s}`, title: ST[s].label }, `${ST[s].icon} ${ST[s].label}`) : h('span', { class: `tag ${N.cls}` }, N.label),
      e.price ? h('span', { class: 'tiny muted num' }, money(e.price)) : null));
  }

  function group(cat, items) {
    if (!items.length) return null;
    const real = items.filter((x) => x.need !== 'skip');
    const done = real.filter((x) => ['have', 'skip'].includes(statusOf(x.id))).length;
    return h('div', { class: 'gd-group', dataset: { cat: cat.id } },
      h('div', { class: 'section-title' }, h('span', null, `${cat.emoji} ${cat.name}`), real.length ? h('span', { class: 'small muted num' }, `${done}/${real.length}`) : null),
      cat.id === 'skip' ? h('p', { class: 'small muted gd-skip-intro' }, '這些東西常被當成必買，其實不需要，有些甚至有安全疑慮。') : null,
      h('div', { class: 'list' }, items.map(itemRow)));
  }

  const filterNeed = (list) => (needF === 'all' ? list : list.filter((x) => x.need === needF));

  function renderList(el, cats) {
    const all = catalog();
    let shown = 0;
    cats.forEach((c) => {
      if (needF !== 'all' && c.id === 'skip') return;
      const items = filterNeed(all.filter((x) => x.cat === c.id));
      shown += items.length;
      const g = group(c, items);
      if (g) el.append(g);
    });
    if (!shown) el.append(ui.empty('🛍️', '這個條件下沒有項目，換個篩選看看。'));
  }

  function summaryCard() {
    const cats = nowCats().filter((c) => c.id !== 'skip');
    const must = catalog().filter((x) => x.need === 'must' && cats.some((c) => c.id === x.cat));
    const done = must.filter((x) => ['have', 'skip'].includes(statusOf(x.id))).length;
    const g = ensure(store.state);
    const count = (s) => Object.values(g.st).filter((e) => e.s === s).length;
    const stage = store.stage;
    const intro = stage === 'prep' ? '備孕期間真正需要的不多，先把葉酸吃起來。'
      : stage === 'preg' ? '寶寶的東西不用一次買齊：先備好「必備」，其他等寶寶出生、知道需要再買。'
        : '依寶寶月齡推薦下一階段要準備的東西。';
    return ui.card({ class: 'soft gd-summary' },
      h('div', { class: 'row between' },
        h('div', { class: 'bold' }, '🛍️ 必備準備進度'),
        h('div', { class: 'bold num' }, `${done}/${must.length}`)),
      h('div', { class: 'mt-xs' }, ui.progress(must.length ? done / must.length : 0)),
      h('p', { class: 'small muted mt-xs' }, intro),
      h('div', { class: 'gd-counts' },
        ['buy', 'want', 'have'].map((s) => h('button', {
          type: 'button', class: 'gd-count', onclick: () => { tab = 'mine'; App.refresh(); },
        }, h('b', { class: 'num' }, count(s)), h('span', null, `${ST[s].icon} ${ST[s].label}`)))));
  }

  function renderMine(el) {
    const all = catalog();
    const g = ensure(store.state);
    const pick = (s) => all.filter((x) => g.st[x.id] && g.st[x.id].s === s);
    const buy = pick('buy'); const want = pick('want'); const have = pick('have'); const skip = pick('skip');
    const sum = (list) => list.reduce((a, x) => a + (entry(x.id).price || 0), 0);
    if (!buy.length && !want.length && !have.length && !skip.length) {
      el.append(ui.empty('📝', '還沒有加入任何東西。到「現在需要」點一項，標記要買、已有，或想請親友送。'));
    } else {
      el.append(ui.card({ class: 'gd-budget' },
        h('div', { class: 'grid-2' },
          h('div', null, h('div', { class: 'tiny muted' }, '還要買（預估）'), h('div', { class: 'big-num num' }, money(sum(buy)))),
          h('div', null, h('div', { class: 'tiny muted' }, '已買（有填價格的）'), h('div', { class: 'big-num num' }, money(sum(have))))),
        h('p', { class: 'tiny muted mt-xs' }, '在每一項填上價格，就會自動加總。')));
    }
    el.append(h('div', { class: 'gd-group gd-wish' },
      h('div', { class: 'section-title' }, h('span', null, '🎁 想請親友送'), h('span', { class: 'small muted num' }, want.length)),
      want.length ? h('div', { class: 'list' }, want.map(itemRow)) : h('p', { class: 'small muted' }, '把想要親友送的東西標記「想請人送」，做成願望清單分享出去，大家就不會送重複。'),
      App.share ? h('button', { type: 'button', class: 'btn btn-primary btn-block mt gd-wish-share', onclick: shareWishlist, disabled: !want.length }, '📤 分享願望清單給親友') : null));
    if (buy.length) {
      el.append(h('div', { class: 'gd-group' },
        h('div', { class: 'section-title' }, h('span', null, '🛒 要自己買'), h('span', { class: 'small muted num' }, buy.length)),
        h('div', { class: 'list' }, buy.map(itemRow)),
        App.share ? h('button', { type: 'button', class: 'btn btn-soft btn-block mt', onclick: () => shareShopping(buy) }, '傳購物清單給另一半') : null));
    }
    if (have.length) el.append(group({ id: 'have', name: '已有', emoji: '✅' }, have));
    if (skip.length) {
      el.append(h('details', { class: 'gd-group gd-skipped' },
        h('summary', { class: 'section-title' }, `不需要（${skip.length}）`),
        h('div', { class: 'list' }, skip.map(itemRow))));
    }
  }

  function render(el, params = {}) {
    ensure(store.state);
    if (params.tab && ['now', 'all', 'mine'].includes(params.tab)) tab = params.tab;
    if (params.item || params.tab) {
      try { history.replaceState(history.state, '', `${location.pathname}${location.search}#/goods`); } catch (e) { /* ignore */ }
      if (params.item) { const id = String(params.item); setTimeout(() => openItem(id), 50); }
    }
    el.append(summaryCard());
    el.append(h('div', { class: 'mt' }, ui.seg([
      { value: 'now', label: '現在需要' }, { value: 'all', label: '全部分類' }, { value: 'mine', label: '我的清單' },
    ], tab, (v) => { tab = v; App.refresh(); })));
    if (tab !== 'mine') {
      el.append(h('div', { class: 'chips gd-filter', role: 'group', 'aria-label': '篩選' }, NEED_FILTERS.map((f) => h('button', {
        type: 'button', class: `chip${needF === f.value ? ' active' : ''}`, 'aria-pressed': String(needF === f.value),
        onclick: () => { needF = f.value; App.refresh(); },
      }, f.label))));
    }
    if (tab === 'now') {
      renderList(el, nowCats());
      el.append(h('p', { class: 'small muted center mt' }, '想看其他階段的東西？到「全部分類」。'));
    } else if (tab === 'all') {
      const cats = G().CATS;
      el.append(h('div', { class: 'chips gd-cats', role: 'group', 'aria-label': '分類' },
        [{ id: 'all', name: '全部', emoji: '🛍️' }].concat(cats).map((c) => h('button', {
          type: 'button', class: `chip${catF === c.id ? ' active' : ''}`, 'aria-pressed': String(catF === c.id), dataset: { cat: c.id },
          onclick: () => { catF = c.id; App.refresh(); },
        }, `${c.emoji} ${c.name}`))));
      renderList(el, catF === 'all' ? cats : cats.filter((c) => c.id === catF));
    } else {
      renderMine(el);
    }
    el.append(h('button', { type: 'button', class: 'btn btn-ghost btn-block mt', onclick: () => openCustom() }, '＋ 新增自己的好物'));
    el.append(h('p', { class: 'disclaimer' }, '內容為一般選購與安全原則，不推薦特定第三方品牌，也不是醫療建議；寶寶或你有特殊狀況時，請先問醫師。'));
  }

  App.screen('goods', { title: '常見好物', tab: 'health', render });

  /* ---------- public wishlist page (friends & family open the shared link) ---------- */
  function renderWishlist(el, params = {}) {
    const ids = (typeof params.w === 'string' ? params.w : '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 30);
    const items = ids.map((id) => G().ITEMS.find((x) => x.id === id)).filter((x) => x && x.need !== 'skip');
    const custom = (Array.isArray(params.c) ? params.c : []).slice(0, 12).map((x) => (typeof x === 'string' ? x.trim().slice(0, 30) : '')).filter(Boolean);
    const who = (typeof params.n === 'string' ? params.n : '').trim().slice(0, 20);
    const appName = B().appName || '易家做媽媽';
    const gift = (name) => {
      const text = `${who ? `${who}，` : ''}我想送你「${name}」🎁\n（在${appName}的好物願望清單看到的，先跟你確認還需要嗎？）`;
      window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    };
    el.append(ui.card({ class: 'soft gd-wish-head center' },
      h('div', { class: 'gd-wish-emoji', 'aria-hidden': 'true' }, '🎁'),
      h('h2', { class: 'gd-wish-title' }, who ? `${who}的寶寶好物願望清單` : '寶寶好物願望清單'),
      h('p', { class: 'small muted' }, `想送禮的話，點「我想送這個」用 LINE 跟${who || '準爸媽'}說一聲，避免大家送重複`)));
    if (!items.length && !custom.length) {
      el.append(ui.empty('🎁', '這份清單是空的，或連結不完整。'));
    }
    if (items.length || custom.length) {
      el.append(h('div', { class: 'list gd-wish-list' },
        items.map((it) => h('div', { class: 'list-item gd-wish-item', dataset: { item: it.id } },
          h('span', { class: 'gd-ico', 'aria-hidden': 'true' }, it.emoji),
          h('div', { class: 'li-body' },
            h('div', { class: 'li-title' }, it.name),
            it.tips && it.tips[0] ? h('div', { class: 'li-sub' }, `挑選重點：${it.tips[0]}`) : null,
            it.safety ? h('div', { class: 'li-sub gd-wish-safe' }, `⚠️ ${it.safety}`) : null),
          h('button', { type: 'button', class: 'btn btn-sm btn-line gd-gift', onclick: () => gift(it.name) }, '我想送這個'))),
        custom.map((name) => h('div', { class: 'list-item gd-wish-item' },
          h('span', { class: 'gd-ico', 'aria-hidden': 'true' }, '⭐'),
          h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, name)),
          h('button', { type: 'button', class: 'btn btn-sm btn-line gd-gift', onclick: () => gift(name) }, '我想送這個')))));
    }
    el.append(ui.card({ class: 'gd-cta center' },
      h('div', { class: 'bold' }, `你也在準備寶寶的東西嗎？`),
      h('p', { class: 'small muted' }, `用「${appName}」看每樣東西怎麼挑、哪些先別買，也能做自己的願望清單。`),
      h('button', { type: 'button', class: 'btn btn-primary btn-block mt', onclick: () => App.navigate(store.state.onboarded ? 'goods' : 'onboarding') }, store.state.onboarded ? '看常見好物' : '免費開始使用')));
  }
  App.screen('wishlist', { title: '好物願望清單', tab: 'home', render: renderWishlist });

  /* ---------- registration ---------- */
  App.tool({ id: 'goods', title: '常見好物', icon: '🛍️', desc: '買什麼、怎麼挑、哪些先別買', stages: ['prep', 'preg', 'baby'], screen: 'goods', order: 66, group: '工具', tags: ['好物', '買什麼', '寶寶用品', '願望清單', '購物清單', '嬰兒用品'] });

  // home: a gentle nudge only when it matters (孕 20–37 週, or baby 4–6 months before solids)
  App.homeCard('goods', {
    stages: ['preg', 'baby'],
    order: 46,
    render(el) {
      const g = ensure(store.state);
      if (g.hideHome) return;
      const stages = store.stages();
      let show = false; let msg = '';
      const p = store.state.profile;
      if (stages.includes('preg') && (p.lmp || p.edd)) {
        try {
          const ga = C.gestAge(p.lmp || C.lmpFromEdd(p.edd));
          if (ga.weeks >= 20 && ga.weeks <= 37) { show = true; msg = ga.weeks >= 32 ? '汽座、嬰兒床、待產包準備好了嗎？' : '寶寶用品可以開始慢慢準備，先買必備的就好。'; }
        } catch (e) { /* ignore */ }
      }
      const m = babyMonths();
      if (!show && m !== null && m >= 4 && m < 7) { show = true; msg = '快要開始吃副食品了：餐椅、軟湯匙、圍兜準備好了嗎？'; }
      if (!show) return;
      const cats = nowCats().filter((c) => c.id !== 'skip');
      const must = catalog().filter((x) => x.need === 'must' && cats.some((c) => c.id === x.cat));
      const done = must.filter((x) => ['have', 'skip'].includes(statusOf(x.id))).length;
      if (must.length && done === must.length) return;
      el.append(ui.card({ class: 'gd-home' },
        h('div', { class: 'card-title' }, '常見好物', h('span', { class: 'tag primary num' }, `必備 ${done}/${must.length}`)),
        h('p', { class: 'small muted' }, msg),
        h('div', { class: 'row gap mt' },
          h('button', { type: 'button', class: 'btn btn-primary grow', onclick: () => App.navigate('goods') }, '看清單'),
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { store.update((s) => { ensure(s).hideHome = true; }); ui.toast('首頁不再顯示，可以在「健康」找到常見好物'); } }, '不再顯示'))));
    },
  });

  App.goods = { catalog, nowCats, openItem, setStatus, wishParams, safeUrl };
}());
