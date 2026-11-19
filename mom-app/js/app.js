/* 易家做媽媽 — app shell: registry, hash router, tab bar, live tickers, boot.
 * Loaded LAST (after all modules registered themselves).
 *
 * Module API (used by js/modules/*.js):
 *   App.screen(id, { title, tab, render(el, params), actions?(params), liveUpdate?: true })
 *   App.homeCard(id, { stages:['prep'|'preg'|'baby'], order, render(el) })  // el is an empty card container
 *   App.tool({ id, title, icon, desc, stages, screen, params, order, color })  // tiles on 健康 tab
 *   App.navigate(id, params?)   App.back()   App.refresh()
 */
(function () {
  const App = window.App = window.App || {};
  const { h, ICONS } = App.ui;

  // App.screen / App.homeCard / App.tool registries are defined in ui.js (loaded before modules).

  const TABS = [
    // ordered by how often a mom needs them: logging many times a day, the island now and then
    { id: 'home', label: '首頁', icon: 'home' },
    { id: 'log', label: '紀錄', icon: 'log' },
    { id: 'health', label: '健康', icon: 'health' },
    { id: 'island', label: '好孕島', icon: 'island' },
    { id: 'me', label: '我的', icon: 'me' },
  ];

  /* ---------- routing ---------- */
  const parseHash = () => {
    const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    const [id, q] = raw.split('?');
    let params = {};
    if (q) { try { params = JSON.parse(q); } catch (e) { params = {}; } }
    return { id: id || 'home', params };
  };
  App.navigate = (id, params) => {
    const q = params && Object.keys(params).length ? `?${encodeURIComponent(JSON.stringify(params))}` : '';
    location.hash = `#/${id}${q}`;
  };
  App.back = () => {
    if (history.length > 1 && App._navCount > 0) history.back();
    else App.navigate('home');
  };
  App._navCount = 0;

  let current = null;
  const view = () => document.getElementById('view');

  function renderAppbar(def, params) {
    const bar = document.getElementById('appbar');
    bar.innerHTML = '';
    const isTab = TABS.some((t) => t.id === def.id);
    const title = typeof def.title === 'function' ? def.title(params) : def.title;
    if (isTab && def.id === 'home') {
      bar.append(h('div', { class: 'brand' },
        h('img', { src: (window.BRAND && BRAND.logo) || 'assets/logo.svg', alt: '', class: 'brand-logo' }),
        h('div', { class: 'brand-text' },
          h('strong', null, (window.BRAND && BRAND.appName) || '易家做媽媽'),
          h('span', null, (window.BRAND && BRAND.tagline) || ''))));
    } else {
      if (!isTab) bar.append(h('button', { class: 'icon-btn', 'aria-label': '返回', html: ICONS.back, onclick: App.back }));
      bar.append(h('h1', { class: 'appbar-title' }, title || ''));
    }
    const actions = def.actions ? def.actions(params) : null;
    const search = isTab && App.screens.search && def.id !== 'island'
      ? h('button', { class: 'icon-btn', 'aria-label': '問答搜尋', html: ICONS.search, onclick: () => App.navigate('search') }) : null;
    bar.append(h('div', { class: 'appbar-actions' }, actions || null, search));
  }

  function renderTabbar(activeTab) {
    const nav = document.getElementById('tabbar');
    nav.innerHTML = '';
    // shown only on tablets / desktop, where the tab bar becomes a side menu
    nav.append(h('div', { class: 'side-brand' },
      h('img', { src: (window.BRAND && BRAND.logo) || 'assets/logo.svg', alt: '' }),
      h('span', null, (window.BRAND && BRAND.appName) || '易家做媽媽')));
    TABS.forEach((t) => {
      nav.append(h('a', {
        href: `#/${t.id}`, class: `tab${t.id === activeTab ? ' active' : ''}`, 'aria-current': t.id === activeTab ? 'page' : null,
      }, h('span', { class: 'tab-icon', html: ICONS[t.icon] }), h('span', { class: 'tab-label' }, t.label)));
    });
  }

  let enterTimer = null;
  function render({ keepScroll = false } = {}) {
    // records kept in IndexedDB are still loading: show nothing that could act on an empty, not-yet-loaded state
    if (App.store.loading) {
      const v = view(); v.innerHTML = '';
      v.append(h('p', { class: 'center muted mt-lg', role: 'status' }, App.store.health === 'failed' ? '暫時讀不到手機裡的紀錄，請關閉 App 後再開一次。紀錄沒有被刪除。' : '載入紀錄中…'));
      return;
    }
    const { id, params } = parseHash();
    let def = App.screens[id];
    // visitors who haven't set up yet can still open login and shared content (Q&A, island articles, roadmap)
    const PUBLIC = ['onboarding', 'login', 'search', 'island', 'journey', 'wishlist'];
    if (!App.store.state.onboarded && App.screens.onboarding && !PUBLIC.includes(id)) def = App.screens.onboarding;
    if (!def) def = App.screens.home;
    const el = view();
    const scroll = keepScroll ? window.scrollY : 0;
    if (current && current.def.onLeave && current.def !== def) current.def.onLeave();
    current = { def, params };
    document.body.dataset.screen = def.id;
    document.body.dataset.stage = App.store.stage;
    el.innerHTML = '';
    // arriving on a screen (not an update of the same one): cards settle in (css/motion.css)
    el.classList.remove('view-enter');
    clearTimeout(enterTimer);
    if (!keepScroll) { void el.offsetWidth; el.classList.add('view-enter'); enterTimer = setTimeout(() => el.classList.remove('view-enter'), 700); }
    renderAppbar(def, params);
    renderTabbar(def.tab || def.id);
    document.getElementById('tabbar').hidden = def.id === 'onboarding';
    document.getElementById('appbar').hidden = def.id === 'onboarding';
    try {
      def.render(el, params || {});
    } catch (e) {
      console.error(e);
      el.append(h('div', { class: 'card' }, h('p', null, '這個頁面發生錯誤：'), h('pre', { class: 'small' }, String(e && e.stack || e))));
    }
    updateTickers();
    if (keepScroll) window.scrollTo(0, scroll);
    else window.scrollTo(0, 0);
  }
  App.refresh = () => render({ keepScroll: true });

  window.addEventListener('hashchange', () => { App._navCount += 1; render(); });
  App.store.subscribe(() => {
    if (current && current.def.liveUpdate === false) return;
    // Don't rebuild the screen under an open sheet's inputs; refresh once it closes.
    if (document.body.classList.contains('has-sheet')) { App._pendingRefresh = true; return; }
    App.refresh();
  });
  // flush deferred refresh after sheets close
  new MutationObserver(() => {
    if (App._pendingRefresh && !document.body.classList.contains('has-sheet')) {
      App._pendingRefresh = false;
      if (!current || current.def.liveUpdate !== false) App.refresh();
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  /* ---------- live tickers ----------
   * <span data-ago="ISO">      -> "12 分前"
   * <span data-clock="ISO">    -> "05:12" stopwatch since ISO
   * <span data-countdown="ISO">-> "1 小時 5 分" until ISO */
  function updateTickers() {
    const now = Date.now();
    document.querySelectorAll('[data-ago]').forEach((e) => { e.textContent = Core.ago(e.dataset.ago, now); });
    document.querySelectorAll('[data-clock]').forEach((e) => { e.textContent = Core.fmtClock(now - new Date(e.dataset.clock).getTime()); });
    document.querySelectorAll('[data-countdown]').forEach((e) => {
      const ms = new Date(e.dataset.countdown).getTime() - now;
      e.textContent = ms > 0 ? Core.fmtDuration(ms) : '現在';
    });
  }
  App.updateTickers = updateTickers;
  setInterval(updateTickers, 1000);

  /* ---------- theme ---------- */
  // 夜間模式：22:00–06:00 自動深色＋按鈕放大（給半夜單手餵奶用）。手動選「淺色」時不強制變暗。
  App.isNight = (d = new Date()) => d.getHours() >= 22 || d.getHours() < 6;
  App.applyTheme = () => {
    const { theme, nightMode } = App.store.state.settings;
    const night = nightMode !== false && App.isNight();
    document.body.classList.toggle('night', night);
    const t = night && theme !== 'light' ? 'dark' : theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  };
  setInterval(() => App.applyTheme(), 60 * 1000);

  /* ---------- a save that could not be kept: never silent ---------- */
  let lastWarn = 0;
  const warnStorage = () => {
    if (App.store.health !== 'failed' || Date.now() - lastWarn < 60 * 1000 || !App.ui) return;
    lastWarn = Date.now();
    App.ui.toast('⚠️ 手機空間不足，最新的紀錄可能沒有存到。請先匯出備份。', { action: '匯出備份', onAction: () => App.me && App.me.exportData(), ms: 10000 });
  };
  window.addEventListener('store-health', () => { warnStorage(); if (current) App.refresh(); });

  /* ---------- boot ---------- */
  function boot() {
    document.title = (window.BRAND && BRAND.appName) || '易家做媽媽';
    App.applyTheme();
    if (App.reminders && App.reminders.start) App.reminders.start();
    render();
    const action = new URLSearchParams(location.search).get('action');
    if (action) {
      history.replaceState(history.state, '', location.pathname + (location.hash || '#/home'));
      setTimeout(() => App.babylog && App.babylog.handleAction(action), 50);
    }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  // wait for the saved data first (instant unless it lives in IndexedDB)
  const start = () => { if (!App.store.loading) boot(); else { render(); App.store.ready.then(() => { if (!App.store.loading) boot(); else render(); }); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
