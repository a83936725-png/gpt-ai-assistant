/* 易家做媽媽 — 夜奶陪伴 (company for the feeds in the middle of the night).
 * When a feed starts late at night (深夜: from 22:00 until shortly before sunrise) a very dark, warm screen keeps her
 * company: a big timer, 左／右, 完成, the time, gentle words — and, where the member service is there, how many other
 * moms are awake with the app open right now (the real count, never made up). If she has joined 島上的媽媽 she can wave
 * to one of them. The screen stays on while it is open (where the phone allows). Opens by itself at night when a feed
 * timer starts (she can turn that off), or from the timer banner.
 *   App.night = { open, close, isNow, autoOn } */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  // quiet, practical lines (no slogans: 「每一次夜奶，都是給寶寶的擁抱」 and 「天亮之前，你已經很努力了」 are gone)
  const WORDS = [
    '累了就靠著休息一下，計時會繼續',
    '記得喝口水',
    '肩膀放鬆，深呼吸一下',
    '換邊的時候，按一下另一邊就好',
    '餵完記得幫寶寶拍嗝',
  ];
  const isNow = (d = new Date()) => !!(App.isLate && App.isLate(d));
  // 凌晨 03:12, 清晨 05:40 (before a winter sunrise), 晚上 23:05 — and right for any hour it is opened by hand
  const partOfDay = (d) => { const hr = d.getHours(); return hr < 5 ? '凌晨' : hr < 8 ? '清晨' : hr < 11 ? '早上' : hr < 14 ? '中午' : hr < 18 ? '下午' : '晚上'; };
  const autoOn = () => (store.state.settings || {}).nightCompanion !== false;
  const feedKey = (babyId) => { const act = store.state.active || {}; return Object.keys(act).find((k) => /^feed(@|$)/.test(k) && act[k] && (!babyId || (act[k].babyId || babyId) === babyId)) || null; };
  let root = null; let lock = null; let wordT = 0; let liveT = 0; let unsub = null; let prevFocus = null;

  async function keepOn() {
    try { if (navigator.wakeLock && navigator.wakeLock.request && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } } catch (e) { lock = null; }
  }
  const onVis = () => { if (document.visibilityState === 'visible' && root) keepOn(); };
  // the real number of moms with the app open now, other than her (nothing when there is no member service)
  async function awake(line) {
    let L = App.live;
    try { if (App.account && await App.account.available()) L = await App.account.call('GET', 'stats'); } catch (e) { /* keep the last */ }
    const others = L && Number.isFinite(L.online) ? Math.max(0, L.online - 1) : null;
    if (!line.isConnected) return;
    line.hidden = !others;
    if (others) line.textContent = `現在還有 ${others.toLocaleString('en-US')} 位媽媽也醒著`;
  }
  function waveRow() {
    const S = App.social;
    if (!S || (S.isReady && S.isReady() === false)) return null;
    if (!(S.soc && S.soc().on)) {
      return h('button', { class: 'nt-soft nt-join', onclick: () => { close(); if (S.openJoin) S.openJoin(); } }, '加入島上的媽媽，和醒著的媽媽互相揮手');
    }
    return h('button', {
      class: 'nt-soft nt-wave',
      onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try { if (S.poll) await S.poll(); } catch (er) { /* use what we have */ }
        const people = (S.people ? S.people() : []).filter((p) => p && p.nid);
        if (!people.length) { ui.toast('島上現在沒有其他媽媽，晚點再試試'); btn.disabled = false; return; }
        const p = people[Math.floor(Math.random() * people.length)];
        if (S.react) await S.react(p.nid, 'wave');
        btn.disabled = false;
      },
    }, '👋 跟醒著的媽媽揮手');
  }
  function paint(babyId) {
    if (!root) return;
    const k = feedKey(babyId);
    const t = k ? store.state.active[k] : null;
    const bid = t ? (t.babyId || babyId) : babyId;
    const b = (store.state.babies || []).find((x) => x.id === bid) || store.baby();
    const now = new Date();
    const last = b ? (store.state.logs || []).filter((l) => l.babyId === b.id && (l.type === 'breast' || l.type === 'bottle')).reduce((a, x) => (!a || x.start > a.start ? x : a), null) : null;
    const body = root.querySelector('.nt-body');
    body.innerHTML = '';
    // DOM append() would print a left-out part (null) as the word "null": leave those out first
    body.append(...[
      h('div', { class: 'nt-time' }, `${partOfDay(now)} ${C.fmtTime(now)}`),
      t ? h('div', { class: 'nt-what' }, `${b && (store.state.babies || []).length > 1 ? `${b.name}・` : ''}親餵中・${t.side === 'L' ? '左' : '右'}邊`) : h('div', { class: 'nt-what' }, last ? `上一餐 ${C.fmtTime(last.start)}（${C.ago(last.start)}）` : '準備餵奶了嗎？'),
      t ? h('div', { class: 'nt-clock', dataset: { clock: t.start }, role: 'timer', 'aria-label': '餵奶計時' }, C.fmtClock(now - new Date(t.start).getTime())) : null,
      t ? h('div', { class: 'nt-sides', role: 'group', 'aria-label': '換邊' },
        ['L', 'R'].map((sd) => h('button', { class: `nt-side${t.side === sd ? ' on' : ''}`, 'aria-pressed': String(t.side === sd), onclick: () => { App.timers.switchSide(sd, bid); } }, sd === 'L' ? '左' : '右')))
        : h('div', { class: 'nt-sides' },
          ['L', 'R'].map((sd) => h('button', { class: 'nt-side', onclick: () => { App.timers.start('breast', { side: sd }, bid); } }, `${sd === 'L' ? '左' : '右'}邊開始`))),
      h('p', { class: 'nt-awake', hidden: true }),
      h('p', { class: 'nt-words', 'aria-live': 'polite' }, WORDS[Math.floor(Date.now() / 20000) % WORDS.length]),
      waveRow(),
      t ? h('button', { class: 'nt-done', onclick: () => { App.timers.stopWithUndo('breast', bid); close(); } }, '✓ 餵完了') : h('button', { class: 'nt-done nt-bottle', onclick: () => { close(); if (App.babylog && App.babylog.openAdd) App.babylog.openAdd('bottle'); } }, '🍼 記一筆瓶餵'),
      h('label', { class: 'nt-auto' }, h('input', {
        type: 'checkbox', checked: autoOn(), onchange: (e) => { store.update((s) => { s.settings.nightCompanion = e.target.checked; }); },
      }), h('span', null, '深夜開始餵奶時自動打開')),
    ].filter(Boolean));
    awake(body.querySelector('.nt-awake'));
  }
  function open(babyId = null) {
    if (root) { paint(babyId); return root; }
    if (App.count) App.count('night_open'); // 使用統計 (a count only)
    prevFocus = document.activeElement;
    root = h('div', { class: 'nt', role: 'dialog', 'aria-modal': 'true', 'aria-label': '夜奶陪伴', tabindex: '-1' },
      h('button', { class: 'nt-x', 'aria-label': '關閉夜奶陪伴', onclick: () => close() }, '✕'),
      h('div', { class: 'nt-moon', 'aria-hidden': 'true' }, '🌙'),
      h('div', { class: 'nt-body' }));
    document.body.append(root); document.body.classList.add('nt-open');
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    paint(babyId);
    root.focus({ preventScroll: true });
    keepOn(); document.addEventListener('visibilitychange', onVis);
    // the side, the timer and the words follow along; the awake count every minute
    let lastKey = JSON.stringify((store.state.active || {}));
    unsub = store.subscribe(() => { const k = JSON.stringify(store.state.active || {}); if (k !== lastKey) { lastKey = k; paint(babyId); } });
    wordT = setInterval(() => { const w = root && root.querySelector('.nt-words'); if (w) w.textContent = WORDS[Math.floor(Date.now() / 20000) % WORDS.length]; }, 20000);
    liveT = setInterval(() => { const l = root && root.querySelector('.nt-awake'); if (l) awake(l); }, 60000);
    return root;
  }
  function close() {
    if (!root) return;
    const r = root; root = null;
    clearInterval(wordT); clearInterval(liveT); if (unsub) unsub(); unsub = null;
    document.removeEventListener('visibilitychange', onVis);
    try { if (lock) lock.release(); } catch (e) { /* gone */ } lock = null;
    r.classList.add('out'); setTimeout(() => r.remove(), 200);
    document.body.classList.remove('nt-open');
    try { if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (e) { /* fine */ }
  }

  // late at night, a feed timer opens it (once per feed)
  if (App.timers && App.timers.start && !App.timers.start.__night) {
    const start = App.timers.start;
    App.timers.start = function nightStart(type, extra, babyId) {
      const before = feedKey(babyId);
      const r = start.call(this, type, extra, babyId);
      // (window.__noNightAuto: the test suites that run on the machine's real clock set it, like __noShareMoments, so a
      // run in the middle of the night does not have this screen cover what they look at; tests/night checks it)
      if ((type === 'breast' || type === 'feed') && !before && !window.__noNightAuto && autoOn() && isNow() && !root) setTimeout(() => { if (feedKey()) open(); }, 250);
      return r;
    };
    App.timers.start.__night = true;
  }
  // the running-feed banner gets 「🌙 夜奶陪伴」 at night
  if (App.babylog && App.babylog.activeBanner && !App.babylog.activeBanner.__night) {
    const banner = App.babylog.activeBanner;
    App.babylog.activeBanner = function nightBanner(...a) {
      const el = banner.apply(this, a);
      if (el && isNow() && feedKey()) {
        const row = el.querySelector('.active-timer');
        if (row) row.after(h('button', { class: 'btn btn-sm btn-soft btn-block nt-open-btn', onclick: () => open() }, '🌙 夜奶陪伴'));
      }
      return el;
    };
    App.babylog.activeBanner.__night = true;
  }

  App.night = {
    open, close, isNow, autoOn, WORDS,
  };
}());
