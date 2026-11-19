/* 易家做媽媽 — 資料來源 (citations).
 * Every piece of health knowledge points at an official or professional source (js/data/sources-data.js):
 * a small number after the sentence, and under it a 「📚 資料來源」 list — tap to open the source, with a short note
 * saying what that source backs up. Screens get the list at the bottom; the island, Q&A and handbooks number each fact.
 *   const cite = App.src.collector();  cite.mark('card:folate:0') -> <sup>  …  cite.footer() -> the list
 *   App.src.footerFor(['vaccines'])   App.src.refs(key)   screen 'sources' (every source in one place) */
(function () {
  const App = window.App = window.App || {};
  const { h } = App;
  const SOURCES = () => App.SOURCES || {};
  const MAP = () => App.SOURCE_MAP || {};
  const KIND = { gov: '政府機關', intl: '國際組織', society: '專業學會' };

  // [{ s: key, n: note, src }] for a content key ('' keys and unknown sources are dropped)
  function refs(key) {
    const list = (MAP()[key] || []).map((x) => (typeof x === 'string' ? { s: x, n: '' } : x));
    return list.filter((x) => SOURCES()[x.s]).map((x) => ({ ...x, src: SOURCES()[x.s] }));
  }
  const link = (src, label) => h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer', class: 'src-link' }, label || `${src.org}・${src.title}`, h('span', { class: 'src-ext', 'aria-hidden': 'true' }, ' ↗'));

  // numbers the sources of one sheet / page in the order they first appear
  function collector() {
    const order = []; const notes = {};
    const num = (r) => { let i = order.indexOf(r.s); if (i < 0) { order.push(r.s); i = order.length - 1; } (notes[r.s] = notes[r.s] || new Set()).add(r.n); return i + 1; };
    return {
      mark(...keys) {
        const nums = [...new Set(keys.flatMap((k) => refs(k).map(num)))].sort((a, b) => a - b);
        if (!nums.length) return null;
        return h('sup', { class: 'src-mark', 'aria-label': `資料來源 ${nums.join('、')}` }, nums.map((n) => `[${n}]`).join(''));
      },
      add(...keys) { keys.forEach((k) => refs(k).forEach(num)); },
      count: () => order.length,
      footer({ print = false } = {}) {
        if (!order.length) return null;
        return h('div', { class: 'src-foot' },
          h('div', { class: 'src-foot-t' }, '📚 資料來源', h('span', { class: 'tiny faint' }, `・點一下開啟（最後確認 ${App.SOURCES_CHECKED || ''}）`)),
          h('ol', null, order.map((k) => {
            const src = SOURCES()[k];
            const ns = [...(notes[k] || [])].filter(Boolean);
            return h('li', null, link(src),
              ns.length ? h('small', { class: 'src-note' }, ns.slice(0, 3).join('；')) : (src.note ? h('small', { class: 'src-note' }, src.note) : null),
              print ? h('small', { class: 'src-url' }, src.url) : null);
          })),
          h('p', { class: 'tiny faint' }, '內容整理自上述來源的公開資訊，如有更新以來源網站最新公告為準。'),
          h('a', { href: '#/sources', class: 'tiny src-all' }, '看全部資料來源 ›'));
      },
    };
  }
  function footerFor(keys, opts) { const c = collector(); c.add(...keys); return c.footer(opts); }

  /* every screen with health knowledge shows its sources at the bottom */
  const allKeys = (prefix) => Object.keys(MAP()).filter((k) => k.startsWith(prefix));
  const SCREEN_KEYS = {
    vaccines: () => ['vaccines', ...allKeys('vaccine:')],
    checkups: () => ['checkups'],
    milestones: () => ['milestones'],
    growth: () => ['growth'],
    prevention: () => ['vaccines', 'checkups'],
    prenatal: () => ['prenatal'],
    pregnancy: () => ['weeks'],
    prepcheck: () => ['prep'],
    hospitalbag: () => ['hospitalbag'],
    kick: () => ['card:kickpark:0', 'card:kickpark:1', 'note:preg3:0', 'guide:preg3'],
    contraction: () => ['note:preg3:1', 'card:lighthouse:0', 'card:lighthouse:1'],
    journey: () => allKeys('phase:'),
    postpartum: () => ['pp-symptoms', 'lochia', 'moods', 'hotlines', 'newborn'],
    pregrecords: () => ['preg-symptoms'],
    goods: () => allKeys('goods:'),
    benefits: () => allKeys('benefit:'),
    outing: () => ['outing'],
  };
  Object.entries(SCREEN_KEYS).forEach(([id, keys]) => {
    const def = App.screens && App.screens[id]; if (!def || def.__src) return;
    const orig = def.render;
    def.render = function (el, params) {
      const r = orig.call(this, el, params);
      const add = () => { if (!el.querySelector(':scope > .src-foot')) { const f = footerFor(keys()); if (f) el.append(f); } };
      if (r && typeof r.then === 'function') r.then(add); else add();
      return r;
    };
    def.__src = true;
  });

  /* every source in one place */
  App.screen('sources', {
    title: '資料來源',
    tab: 'me',
    render(el) {
      const all = Object.entries(SOURCES());
      const used = {}; Object.values(MAP()).forEach((list) => list.forEach((x) => { const k = typeof x === 'string' ? x : x.s; used[k] = (used[k] || 0) + 1; }));
      el.append(h('p', { class: 'small muted' }, `App 裡的衛教內容整理自下列 ${all.length} 個官方與專業來源，每一則知識下方都有對應的來源編號。最後確認：${App.SOURCES_CHECKED || ''}。內容如有更新，以來源網站最新公告為準；有身體不適請就醫。`));
      Object.entries(KIND).forEach(([kind, label]) => {
        const list = all.filter(([, s]) => (s.kind || 'gov') === kind);
        if (!list.length) return;
        el.append(h('div', { class: 'section-title' }, h('span', null, label)));
        el.append(h('div', { class: 'card src-list' }, list.map(([k, s]) => h('div', { class: 'src-item' },
          link(s), s.note ? h('small', { class: 'src-note' }, s.note) : null, h('small', { class: 'tiny faint' }, `引用 ${used[k] || 0} 處`)))));
      });
      if (!all.length) el.append(h('p', { class: 'muted' }, '資料來源整理中。'));
    },
  });

  App.src = { refs, collector, footerFor, link };
}());
