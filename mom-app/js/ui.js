/* 易家做媽媽 — UI helpers shared by every module.
 *   App.h(tag, attrs, ...children)   tiny DOM builder (attrs: class, style, on*, dataset, html)
 *   App.ui.sheet({title, body, onClose})  bottom sheet, returns {el, close}
 *   App.ui.toast(msg)
 *   App.ui.confirm(msg) -> Promise<boolean>
 *   App.ui.field(label, input, hint)
 *   App.ui.seg(options, value, onChange)   segmented control
 *   App.ui.stepper({value, step, min, max, unit, onChange})
 *   App.ui.empty(icon, text, action?)
 */
(function () {
  const App = window.App = window.App || {};

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.entries(v).forEach(([prop, val]) => {
            if (val === null || val === undefined) return;
            if (prop.startsWith('--')) el.style.setProperty(prop, val); // CSS custom properties need setProperty
            else el.style[prop] = val;
          });
        }
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    append(el, children);
    return el;
  }
  function append(el, children) {
    children.flat(Infinity).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return el;
  }
  // SVG builder (namespace aware)
  function s(tag, attrs, ...children) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (v === null || v === undefined || v === false) return;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') el.innerHTML = v;
        else el.setAttribute(k, v);
      });
    }
    children.flat(Infinity).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return el;
  }

  /* ---------- bottom sheet ---------- */
  // Each open sheet gets its own history entry (same URL), so the phone's back button closes the sheet
  // instead of leaving the screen. Sheets closed with ✕ / Escape / backdrop leave that entry behind
  // ("stale"); the next back press skips over same-URL stale entries so it never feels dead.
  const openSheets = []; // stack: { token, close(fromHistory) }
  let sheetSeq = 0;
  let stale = null; // URL of a stale sheet entry we are on / just left
  // Every history entry the app has seen carries a key (__k). A popstate that lands on a keyed entry is a real
  // back/forward press; one with no key is a new navigation (a link, a tab, location.hash = …), even to the same URL.
  let entryKey = 0;
  const tagEntry = () => {
    try { if (!history.state || history.state.__k === undefined) history.replaceState({ ...(history.state || {}), __k: (entryKey += 1) }, ''); } catch (e) { /* ignore */ }
  };
  tagEntry();
  window.addEventListener('load', tagEntry);
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);

  function sheet({ title, body, footer, onClose, wide = false } = {}) {
    const prevFocus = document.activeElement;
    const backdrop = h('div', { class: 'sheet-backdrop' });
    const closeBtn = h('button', { class: 'icon-btn', 'aria-label': '關閉', html: ICONS.close });
    const panel = h('div', { class: `sheet${wide ? ' sheet-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '', tabindex: '-1' },
      h('div', { class: 'sheet-grip' }),
      title ? h('div', { class: 'sheet-header' }, h('h2', null, title), closeBtn) : null,
      h('div', { class: 'sheet-body' }, body),
      footer ? h('div', { class: 'sheet-footer' }, footer) : null);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    sheetSeq += 1;
    const rec = { token: `sh${Date.now().toString(36)}-${sheetSeq}`, close: null };
    try { history.pushState({ ...(history.state || {}), __sheet: rec.token, __k: (entryKey += 1) }, '', location.href); stale = null; } catch (e) { /* ignore */ }
    openSheets.push(rec);
    document.body.classList.add('has-sheet');
    requestAnimationFrame(() => backdrop.classList.add('open'));
    try { panel.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    // keep Tab inside the sheet
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || openSheets[openSheets.length - 1] !== rec) return;
      const f = focusables(panel);
      if (!f.length) { e.preventDefault(); panel.focus(); return; }
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    let closed = false;
    const doClose = (fromHistory) => {
      if (closed) return; closed = true;
      const i = openSheets.indexOf(rec);
      if (i >= 0) openSheets.splice(i, 1);
      backdrop.classList.remove('open');
      // while it slides away, a second tap (double-tap on 儲存) must not hit its buttons again
      panel.style.pointerEvents = 'none';
      try { panel.inert = true; } catch (e) { /* older browsers */ }
      if (!openSheets.length) document.body.classList.remove('has-sheet');
      if (!fromHistory && history.state && history.state.__sheet === rec.token) stale = location.href;
      setTimeout(() => backdrop.remove(), 220);
      // hand focus back to what opened the sheet (if it is still on screen), else to the sheet below
      const below = openSheets[openSheets.length - 1];
      if (panel.contains(document.activeElement) || document.activeElement === document.body) {
        if (prevFocus && prevFocus.isConnected && prevFocus !== document.body && typeof prevFocus.focus === 'function') { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
        else if (below) { const bp = document.querySelector('.sheet-backdrop.open:last-of-type .sheet'); if (bp) bp.focus({ preventScroll: true }); }
      }
      if (onClose) onClose();
    };
    rec.close = doClose;
    const close = () => doClose(false);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    closeBtn.addEventListener('click', close);
    // swipe down on the grip or the title bar to close (one-handed); the sheet body keeps scrolling normally
    let drag = null;
    panel.addEventListener('pointerdown', (e) => {
      if (closed || e.pointerType === 'mouse' || !e.target.closest('.sheet-grip, .sheet-header') || e.target.closest('button, a, input, select, textarea')) return;
      drag = { id: e.pointerId, y: e.clientY, dy: 0, trail: [{ t: performance.now(), y: e.clientY }] };
      panel.style.transition = 'none';
      try { panel.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    panel.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dy = Math.max(0, e.clientY - drag.y);
      drag.trail.push({ t: performance.now(), y: e.clientY });
      if (drag.trail.length > 8) drag.trail.shift();
      panel.style.transform = drag.dy ? `translateY(${drag.dy}px)` : '';
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { dy, trail } = drag; drag = null;
      panel.style.transition = '';
      // release speed over the last ~100 ms (px/ms), so a quick flick closes even if it was short
      const now = performance.now(); const last = trail[trail.length - 1];
      const ref = trail.find((s) => now - s.t <= 100) || trail[0];
      const v = ref === last ? 0 : (last.y - ref.y) / Math.max(1, last.t - ref.t);
      const fast = dy > 30 && v > 0.5;
      if (e.type === 'pointerup' && (dy > Math.min(140, panel.offsetHeight * 0.3) || fast)) {
        panel.style.transform = 'translateY(100%)';
        close();
      } else panel.style.transform = '';
    };
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
    return { el: panel, body: panel.querySelector('.sheet-body'), close };
  }
  // Escape closes only the top sheet
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !openSheets.length) return;
    e.preventDefault();
    openSheets[openSheets.length - 1].close(false);
  });
  // back / forward / in-app navigation
  window.addEventListener('popstate', (e) => {
    const st = e.state || {};
    const here = location.href;
    if (st.__k === undefined) { // a new navigation, not back/forward: just start fresh on the new entry
      if (stale !== here) stale = null; // (re-opening the same screen keeps the skip-over for the next back)
      while (openSheets.length) openSheets[openSheets.length - 1].close(true);
      tagEntry();
      return;
    }
    if (!openSheets.length) {
      if (stale && here === stale) { history.back(); return; } // left a stale entry: skip its same-URL twin
      stale = st.__sheet ? here : null;
      return;
    }
    const leavingStale = stale && here === stale;
    const keep = st.__sheet || null;
    while (openSheets.length && openSheets[openSheets.length - 1].token !== keep) openSheets[openSheets.length - 1].close(true);
    if (leavingStale && openSheets.length && openSheets[openSheets.length - 1].token === keep) openSheets[openSheets.length - 1].close(true);
    stale = keep && !openSheets.some((x) => x.token === keep) ? here : null;
  });
  // a new screen never keeps an old sheet on top (e.g. a link tapped inside a sheet)
  const closeAllSheets = () => { while (openSheets.length) openSheets[openSheets.length - 1].close(true); };
  window.addEventListener('hashchange', () => { closeAllSheets(); tagEntry(); });

  /* ---------- toast ---------- */
  // a short buzz when a tap records something (Android phones; iPhone browsers ignore it); off with reduced motion
  function haptic(ms = 12) {
    try { if (navigator.vibrate && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }
  // toast('已儲存') or toast('已記錄', { action: '復原', onAction() {...}, ms: 5000 })
  function toast(msg, opts = {}) {
    const o = typeof opts === 'number' ? { ms: opts } : opts;
    const ms = o.ms || (o.action ? 5000 : 2200);
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = h('div', { class: 'toast-wrap', 'aria-live': 'polite' }); document.body.appendChild(wrap); }
    wrap.querySelectorAll('.toast.has-action').forEach((x) => x.remove()); // only one undo at a time
    const hide = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
    const t = h('div', { class: `toast${o.action ? ' has-action' : ''}` }, h('span', null, msg),
      o.action ? h('button', { class: 'toast-action', onclick: () => { hide(); o.onAction(); } }, o.action) : null);
    wrap.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(hide, ms);
  }

  function confirm(msg, { ok = '確定', cancel = '取消', danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); sh.close(); };
      const sh = sheet({
        title: '確認',
        body: h('p', { class: 'confirm-msg' }, msg),
        footer: h('div', { class: 'row gap' },
          h('button', { class: 'btn btn-ghost grow', onclick: () => finish(false) }, cancel),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'} grow`, onclick: () => finish(true) }, ok)),
        onClose: () => { if (!done) { done = true; resolve(false); } },
      });
    });
  }

  /* ---------- form bits ---------- */
  const field = (label, input, hint) => h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);

  function seg(options, value, onChange, { small = false } = {}) {
    const wrap = h('div', { class: `seg${small ? ' seg-sm' : ''}`, role: 'radiogroup' });
    options.forEach((o) => {
      const opt = typeof o === 'string' ? { value: o, label: o } : o;
      const b = h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(opt.value === value), class: opt.value === value ? 'active' : '',
        onclick: () => {
          wrap.querySelectorAll('button').forEach((x) => { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); });
          b.classList.add('active'); b.setAttribute('aria-checked', 'true');
          wrap.dataset.value = opt.value;
          if (onChange) onChange(opt.value);
        },
      }, opt.icon ? h('span', { class: 'seg-icon' }, opt.icon) : null, opt.label);
      wrap.appendChild(b);
    });
    wrap.dataset.value = value ?? '';
    return wrap;
  }

  function stepper({ value = 0, step = 10, min = 0, max = 9999, unit = '', onChange } = {}) {
    let v = Number(value) || 0;
    const input = h('input', { type: 'number', inputmode: 'decimal', value: v, min, max, step, class: 'stepper-input' });
    const set = (nv) => { v = Math.min(max, Math.max(min, Math.round(nv * 100) / 100)); input.value = v; if (onChange) onChange(v); };
    input.addEventListener('input', () => { v = Number(input.value) || 0; if (onChange) onChange(v); });
    const wrap = h('div', { class: 'stepper' },
      h('button', { type: 'button', class: 'stepper-btn', 'aria-label': '減少', onclick: () => set(v - step) }, '−'),
      input,
      unit ? h('span', { class: 'stepper-unit' }, unit) : null,
      h('button', { type: 'button', class: 'stepper-btn', 'aria-label': '增加', onclick: () => set(v + step) }, '+'));
    wrap.getValue = () => v;
    wrap.setValue = (nv) => set(nv);
    return wrap;
  }

  const empty = (icon, text, action) => h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon), h('p', null, text), action || null);

  const card = (attrs, ...children) => h('section', { ...attrs, class: `card ${attrs?.class || ''}` }, ...children);

  const progress = (ratio, color) => h('div', { class: 'progress' },
    h('div', { class: 'progress-bar', style: { width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`, background: color || '' } }));

  /* ---------- icons (inline SVG, stroke = currentColor) ---------- */
  const svgIcon = (d, extra = '') => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
  const ICONS = {
    home: svgIcon('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>'),
    island: svgIcon('<path d="M2.5 18c2 1.3 4 1.3 6 0s4-1.3 6 0 4 1.3 6.5 0"/><path d="M5 15.5c2-2.5 5-3.5 7-3.5s5 1 7 3.5"/><path d="M12 12V5"/><path d="M12 5c-1.5-1.5-4-1.6-5.5-.5M12 5c1.5-1.5 4-1.6 5.5-.5M12 5c-.5-1.5-2-2.6-3.5-2.5M12 5c.5-1.5 2-2.6 3.5-2.5"/>'),
    log: svgIcon('<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>'),
    health: svgIcon('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/><path d="M8.5 12.5h2l1-2 2 4 1-2h1.5"/>'),
    me: svgIcon('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.7 4.2-5.5 7.5-5.5s6.3 1.8 7.5 5.5"/>'),
    back: svgIcon('<path d="M15 5l-7 7 7 7"/>'),
    close: svgIcon('<path d="M6 6l12 12M18 6 6 18"/>'),
    plus: svgIcon('<path d="M12 5v14M5 12h14"/>'),
    chevron: svgIcon('<path d="M9 5l7 7-7 7"/>'),
    left: svgIcon('<path d="M15 5l-7 7 7 7"/>'),
    right: svgIcon('<path d="M9 5l7 7-7 7"/>'),
    edit: svgIcon('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>'),
    trash: svgIcon('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
    bell: svgIcon('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    share: svgIcon('<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4M8.2 13.2l7.6 4"/>'),
    print: svgIcon('<path d="M7 8V3.5h10V8"/><rect x="3.5" y="8" width="17" height="8.5" rx="2"/><path d="M7 13.5h10v7H7Z"/>'),
    check: svgIcon('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    clock: svgIcon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    chart: svgIcon('<path d="M4 19.5h16"/><path d="M7 16v-5M12 16V7M17 16v-8"/>'),
    gear: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'),
    play: svgIcon('<path d="M8 5.5v13l10-6.5Z"/>'),
    stop: svgIcon('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>'),
    sun: svgIcon('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
    moon: svgIcon('<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>'),
    list: svgIcon('<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/>'),
    map: svgIcon('<path d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5Z"/><path d="M9 4v13.5M15 6.5V20"/>'),
    search: svgIcon('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
    star: svgIcon('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8Z"/>'),
    line: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.8 3 2.6 6.4 2.6 10.6c0 3.8 3.3 6.9 7.8 7.5.3.1.7.2.8.5.1.2.1.6 0 .8l-.1.8c0 .2-.2.9.8.5s5.4-3.2 7.4-5.4c1.4-1.5 2-3.1 2-4.7C21.4 6.4 17.2 3 12 3Z"/></svg>',
  };
  const icon = (name, cls = '') => h('span', { class: `ic ${cls}`, html: ICONS[name] || '' });

  /* ---------- module registries (must exist before js/modules/* load) ---------- */
  App.screens = App.screens || {};
  App.homeCards = App.homeCards || [];
  App.tools = App.tools || [];
  App.screen = (id, def) => { App.screens[id] = { id, liveUpdate: true, ...def }; };
  App.homeCard = (id, def) => { App.homeCards.push({ id, order: 50, stages: ['prep', 'preg', 'baby'], ...def }); };
  App.tool = (def) => { App.tools.push({ order: 50, stages: ['prep', 'preg', 'baby'], ...def }); };

  App.h = h;
  App.s = s;
  App.ui = {
    h, s, append, sheet, toast, haptic, confirm, field, seg, stepper, empty, card, progress, ICONS, icon,
  };
}());
