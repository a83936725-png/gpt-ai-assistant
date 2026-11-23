/* 易家做媽媽 試閱本 — what the landing page does (lp/index.html, lp.css).
 *  · nothing moves by itself except one thing: while the 03:12 story is on screen the page turns night (the app's
 *    night colours), then back. (The looping phones, the auto-turning ring, the gallery that changed every few
 *    seconds and the colour wave were taken out in the 「AI 感」 pass: motion that is there to show off reads as a
 *    template.) With 減少動態效果 even the night turn stays off.
 *  · the bar at the top names the section being read
 *  · 七種紀錄 fan: tap a card to log it in the live app; on a phone a sideways swipe lifts the cards in turn
 *  · 好孕島 ring: real 3D; it turns only when she drags it, uses the arrow keys or ← →
 *  · 月照 gallery: tap a small frame to see it large
 *  · 分享卡 fan: tap a card to pick it
 *  · 試玩: the real app with ?sandbox=1 (its own storage and sample data, never the visitor's own) in a frame;
 *    five tasks tick themselves off; 「帶我去」 and the buttons in the magazine drive the app; 重新開始 clears it
 *  · 打開 App + its QR code (drawn with the app's own QR library) */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const mag = $('.mag');
  if (!mag) return;
  const root = document.documentElement;
  if (!root.lang) root.lang = 'zh-Hant-TW';
  mag.classList.add('js');
  const RM = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const still = () => RM.matches;
  const APP = mag.dataset.app || '../index.html';
  const LINK = mag.dataset.appLink || APP;
  const SANDBOX = `${APP}?sandbox=1#/home`;
  const hasIO = 'IntersectionObserver' in window;
  // calls fn(el, isOnScreen, ratio) as elements come and go (everything counts as on screen without IntersectionObserver)
  function watch(els, fn, opts) {
    if (!hasIO) { els.forEach((el) => fn(el, true, 1)); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => fn(e.target, e.isIntersecting, e.intersectionRatio)), opts);
    els.forEach((el) => io.observe(el));
  }

  /* ---- 03:12: the page turns night ---- */
  const nightStop = $('[data-scene="night"]');
  if (nightStop && !still()) {
    watch([nightStop], (el, on, ratio) => {
      if (on && ratio >= 0.42) root.dataset.scene = 'night';
      else if (!on || ratio < 0.2) delete root.dataset.scene;
    }, { threshold: [0, 0.2, 0.42, 0.6, 0.8] });
  }

  /* ---- the bar ---- */
  const cover = $('.cover');
  if (cover) watch([cover], (el, on) => mag.classList.toggle('past', !on), { threshold: 0 });
  const barNow = $('#bar-now');
  if (barNow) watch($$('[data-title]'), (el, on) => { if (on) barNow.textContent = el.dataset.title; }, { rootMargin: '-40% 0px -55% 0px' });

  /* ---- 七種紀錄 fan: it rests open; on a phone a sideways swipe lifts the cards one by one (a mouse lifts by hovering) ---- */
  const arc = $('.arc');
  if (arc) {
    const stage = arc.closest('.arc-stage'); const items = $$('li', arc);
    let cur = -1; let sx = null;
    const setUp = (k) => { cur = k; items.forEach((li, n) => li.classList.toggle('up', n === k)); };
    stage.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') sx = e.clientX; });
    stage.addEventListener('pointermove', (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx;
      if (Math.abs(dx) < 26) return;
      sx = e.clientX;
      setUp(Math.max(0, Math.min(items.length - 1, (cur < 0 ? 3 : cur) + (dx < 0 ? 1 : -1))));
    });
    const lift = () => { sx = null; };
    stage.addEventListener('pointerup', lift); stage.addEventListener('pointercancel', lift);
  }

  /* ---- 分享卡 fan: tap a card to pick it ---- */
  const rainbow = $('.rainbow');
  if (rainbow) {
    $$('button', rainbow).forEach((b) => b.addEventListener('click', () => {
      const pick = b.getAttribute('aria-pressed') !== 'true';
      $$('button', rainbow).forEach((x) => { x.setAttribute('aria-pressed', 'false'); x.parentElement.classList.remove('pick'); });
      if (pick) { b.setAttribute('aria-pressed', 'true'); b.parentElement.classList.add('pick'); }
      rainbow.classList.toggle('picked', pick);
    }));
  }

  /* ---- 04 ring: real 3D, turned by the script ---- */
  const ringStage = $('.ring-stage');
  if (ringStage) {
    const cards = $$('.spot', ringStage); const N = cards.length; const STEP = 360 / N;
    const now = $('.ring-now');
    let angle = 0; let target = null; let vel = 0; let drag = null; let raf = 0; let last = 0; let front = -1;
    const radius = () => parseFloat(getComputedStyle(ringStage).getPropertyValue('--r')) || 300;
    const paint = () => {
      const r = radius(); let best = 0; let bestZ = -2;
      cards.forEach((c, k) => {
        const a = k * STEP + angle; const z = Math.cos((a * Math.PI) / 180);
        c.style.transform = `rotateY(${a.toFixed(2)}deg) translateZ(${r}px)`;
        c.style.opacity = (0.22 + 0.78 * Math.pow((z + 1) / 2, 1.8)).toFixed(3);
        if (z > bestZ) { bestZ = z; best = k; }
      });
      if (best !== front) {
        front = best;
        cards.forEach((c, k) => c.classList.toggle('front', k === best));
        if (now) now.textContent = `${best + 1}／${N}　${$('b', cards[best]).textContent}`;
      }
    };
    const frame = (t) => {
      const dt = last ? Math.min(64, t - last) : 16; last = t;
      if (!drag) {
        // it turns only when asked: easing to a station, or the glide after a flick (no slow turn of its own)
        if (target !== null) { const d = target - angle; angle += d * Math.min(1, dt / 110); if (Math.abs(d) < 0.05) { angle = target; target = null; } } else if (Math.abs(vel) > 0.003) { angle += vel * dt; vel *= Math.pow(0.93, dt / 16); } else if (vel) { vel = 0; target = -Math.round(-angle / STEP) * STEP; }
      }
      paint();
      raf = target !== null || Math.abs(vel) > 0.003 ? requestAnimationFrame(frame) : 0;
    };
    const run = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };
    const snap = (dir) => {
      const k = Math.round(-angle / STEP) + dir;
      vel = 0;
      if (still()) { angle = -k * STEP; target = null; paint(); return; }
      target = -k * STEP; run();
    };
    ringStage.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      drag = { x: e.clientX, a: angle, t: performance.now(), v: 0 }; target = null; vel = 0;
      try { ringStage.setPointerCapture(e.pointerId); } catch (er) { /* fine */ }
      ringStage.classList.add('drag');
    });
    ringStage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const t = performance.now(); const na = drag.a + (e.clientX - drag.x) * 0.32;
      drag.v = (na - angle) / Math.max(8, t - drag.t); drag.t = t; angle = na;
      if (!raf) paint();
    });
    const end = () => {
      if (!drag) return;
      vel = still() ? 0 : Math.max(-0.6, Math.min(0.6, drag.v)); drag = null;
      ringStage.classList.remove('drag');
      if (still() || Math.abs(vel) <= 0.003) snap(0); else run();
    };
    ringStage.addEventListener('pointerup', end); ringStage.addEventListener('pointercancel', end);
    ringStage.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); snap(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); snap(-1); }
    });
    $$('[data-ring]').forEach((b) => b.addEventListener('click', () => snap(Number(b.dataset.ring))));
    ringStage.classList.add('ready');
    paint();
  }

  /* ---- 月照 gallery: tap a small frame (it does not change by itself) ---- */
  const gal = $('.gal');
  if (gal) {
    const mains = $$('.gm', gal); const thumbs = $$('.gt', gal); const cap = $('.gal-cap', gal);
    let k = 0;
    const show = (n) => {
      k = (n + mains.length) % mains.length;
      mains.forEach((m, i) => { m.classList.toggle('on', i === k); if (i === k) m.removeAttribute('aria-hidden'); else m.setAttribute('aria-hidden', 'true'); });
      thumbs.forEach((b, i) => b.setAttribute('aria-pressed', String(i === k)));
      cap.innerHTML = '';
      const b = document.createElement('b'); b.textContent = thumbs[k].dataset.name;
      const s = document.createElement('span'); s.textContent = thumbs[k].dataset.desc;
      cap.append(b, s);
    };
    thumbs.forEach((b, i) => b.addEventListener('click', () => show(i)));
  }

  /* ---- 試玩: the real app in a frame ---- */
  const T = {
    section: $('#try'), frame: $('#try-frame'), state: $('#try-state'), count: $('#try-count'), bar: $('#try-bar'),
    start: $('#try-start'), reset: $('#try-reset'), device: $('.try-device'), tasks: $$('#tasks li'),
  };
  const done = new Set();
  let booted = null; // a promise of the app's window (null: not started)
  let since = 0; // only what she does in the trial counts
  const appWin = () => {
    try {
      const w = T.frame.contentWindow;
      return w && w.App && w.App.store && !w.App.store.loading && typeof w.App.navigate === 'function' && w.App.store.state.onboarded ? w : null;
    } catch (e) { return null; }
  };
  const setState = (s, text) => { if (T.state) { T.state.dataset.s = s; T.state.textContent = text; } };
  function boot() {
    if (booted) return booted;
    if (!T.frame) return Promise.resolve(null);
    setState('loading', '載入中…');
    booted = new Promise((resolve) => {
      const t0 = Date.now(); let loadedAt = 0;
      // the page loaded but no app came up (a host that will not show it in a frame): say so soon, not after 20 s
      T.frame.addEventListener('load', () => { if (T.frame.getAttribute('src') === SANDBOX) loadedAt = Date.now(); }, { once: true });
      const poll = () => {
        const w = appWin();
        if (w) {
          since = Date.now();
          T.section.classList.add('live'); T.section.classList.remove('noframe');
          setState('ready', '試玩中');
          resolve(w); return;
        }
        if (Date.now() - t0 > 20000 || (loadedAt && Date.now() - loadedAt > 8000)) {
          setState('error', '這裡打不開試玩');
          T.section.classList.add('noframe');
          resolve(null); return;
        }
        setTimeout(poll, 250);
      };
      setTimeout(poll, 300);
    });
    T.frame.src = SANDBOX;
    return booted;
  }
  const newSince = (l) => Date.parse(l.createdAt || l.start) >= since - 1000;
  const CHECK = {
    diaper: (w) => (w.App.store.state.logs || []).some((l) => l.type === 'diaper' && newSince(l)),
    feed: (w) => Object.keys(w.App.store.state.active || {}).some((key) => /^feed/.test(key)) || (w.App.store.state.logs || []).some((l) => l.type === 'breast' && newSince(l)),
    handoff: (w) => !!w.document.querySelector('.ho'),
    recap: (w) => !!w.document.querySelector('.rc'),
    night: (w) => !!w.document.querySelector('.nt'),
  };
  const paintTasks = () => {
    T.tasks.forEach((li) => li.classList.toggle('done', done.has(li.dataset.task)));
    const n = done.size; const all = T.tasks.length;
    if (T.count) T.count.textContent = n === all ? `完成 ${n}／${all}，你已經會用了！` : `完成 ${n}／${all}`;
    if (T.bar) T.bar.style.width = `${(n / all) * 100}%`;
  };
  setInterval(() => {
    if (!booted || document.hidden) return;
    const w = appWin(); if (!w) return;
    let changed = false;
    Object.keys(CHECK).forEach((k) => { if (!done.has(k)) { try { if (CHECK[k](w)) { done.add(k); changed = true; } } catch (e) { /* not there yet */ } } });
    if (changed) paintTasks();
  }, 700);

  // what the buttons do inside the app (it closes what is open first)
  const GO = {
    home: (w) => w.App.navigate('home'),
    night: (w) => w.App.night.open(),
    handoff: (w) => w.App.navigate('handoff'),
    monthly: (w) => w.App.navigate('monthly'),
    recap: (w) => w.App.recap.open(w.App.store.baby(), 'now'),
    feed: (w) => { w.App.navigate('home'); setTimeout(() => { if (w.App.ui && w.App.ui.toast) w.App.ui.toast('按「親餵」就會開始計時'); }, 350); },
    log: (w, type) => { w.App.navigate('home'); setTimeout(() => w.App.babylog.openAdd(type), 320); },
  };
  const closeOpen = (w) => {
    try { if (w.App.night) w.App.night.close(); } catch (e) { /* fine */ }
    try { const x = w.document.querySelector('.rc-x'); if (x) x.click(); } catch (e) { /* fine */ }
  };
  async function go(spec) {
    const [k, arg] = spec.split(':');
    if (T.device) T.device.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: window.innerWidth < 900 ? 'center' : 'nearest' });
    const w = await boot();
    if (!w || !GO[k]) return;
    try { closeOpen(w); setTimeout(() => GO[k](w, arg), 60); } catch (e) { /* the app moved on */ }
  }
  mag.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b || !mag.contains(b)) return;
    e.preventDefault();
    go(b.dataset.go);
  });
  if (T.start) T.start.addEventListener('click', () => { boot(); });
  if (T.section) watch([T.section], (el, on) => { if (on) boot(); }, { rootMargin: '300px 0px 300px 0px' });
  async function reset() {
    done.clear(); paintTasks();
    T.section.classList.remove('live');
    setState('loading', '重新開始…');
    const wasBooted = booted; booted = null;
    if (wasBooted) await new Promise((r) => { T.frame.addEventListener('load', r, { once: true }); T.frame.src = 'about:blank'; setTimeout(r, 1500); });
    try { localStorage.removeItem('yijia-mom-app-sandbox'); } catch (e) { /* private window */ }
    await Promise.all(['yijia-mom-sandbox', 'yijia-mom-media-sandbox'].map((name) => new Promise((r) => {
      try { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = () => r(); setTimeout(r, 1500); } catch (e) { r(); }
    })));
    boot();
  }
  if (T.reset) T.reset.addEventListener('click', reset);

  /* ---- links to the app ---- */
  const external = /^https?:/i.test(LINK);
  const newTab = $('#try-new'); if (newTab) newTab.href = external ? LINK : SANDBOX;
  const openApp = $('#open-app'); if (openApp) { openApp.href = LINK; if (external) { openApp.target = '_blank'; openApp.rel = 'noopener'; } }
  const qrBox = $('#qr');
  if (qrBox) {
    const s = document.createElement('script');
    s.src = `${APP.replace(/[^/]*$/, '')}js/vendor/qrcode.js`;
    s.onload = () => {
      try {
        const q = window.qrcode(0, 'M'); q.addData(new URL(LINK, location.href).href); q.make();
        const n = q.getModuleCount(); let d = '';
        for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
        qrBox.innerHTML = `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}" fill="#2b2231"/></svg>`;
      } catch (e) { qrBox.closest('.qr').hidden = true; }
    };
    s.onerror = () => { qrBox.closest('.qr').hidden = true; };
    document.head.append(s);
  }

  /* ---- 設計筆記: the card patterns' names, for the team only (open the page with #notes; no button for visitors) ---- */
  const notes = () => mag.classList.toggle('notes', location.hash === '#notes');
  notes(); window.addEventListener('hashchange', notes);
}());
