/* 易家做媽媽 — 品牌數據 (the brand's own dashboard, #/admin; not linked anywhere for moms).
 * Members, sign-ups and app opens per day, the phones in use (day / week / month), the stage new users choose, what
 * gets recorded, 滴雞精時光 and the brand page's shop and LINE links, shares by channel, the 同週好孕圈 by due month and
 * baby age, invites, group-buys and what moms do in the app — counts only, never who
 * (GET /admin/stats, see mom-api/metrics.js). It needs the server's admin key (MOM_ADMIN_KEY), kept on this device only
 * (this visit, or 「記住這台裝置」). Where there is no member service (the web preview), it shows clearly marked sample
 * numbers so the page can be seen.
 *   screen 'admin'   App.admin = { sample, sums, delta, csv } */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const DAY = 86400e3;
  const TW = 8 * 3600e3;
  const KEY = 'yijia-admin-key';
  const dayKey = (t) => new Date(t + TW).toISOString().slice(0, 10);
  const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
  const fmt = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
  const view = { range: 30, data: null, sample: false, loading: false, error: '', key: '' };

  /* ---------------- the key: this visit, or this device when she asks ---------------- */
  const getKey = () => { try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const setKey = (k, remember) => {
    try { sessionStorage.setItem(KEY, k); if (remember) localStorage.setItem(KEY, k); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
  };
  const clearKey = () => { try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch (e) { /* private mode */ } };

  /* ---------------- numbers ---------------- */
  // the range now and the same length just before it (for 「比前 30 天」)
  function sums(rows, len) {
    const cur = rows.slice(-len); const prev = rows.slice(-2 * len, -len);
    const add = (list, f) => list.reduce((a, r) => a + (Number(r[f]) || 0), 0);
    return { cur: (f) => add(cur, f), prev: (f) => (prev.length === len ? add(prev, f) : null), rows: cur };
  }
  function delta(now, before) {
    if (before == null) return null;
    if (!before) return now ? { text: `前期 0`, dir: 'up' } : { text: '持平', dir: 'flat' };
    const pct = Math.round(((now - before) / before) * 100);
    if (!pct) return { text: '持平', dir: 'flat' };
    return { text: `${Math.abs(pct)}%`, dir: pct > 0 ? 'up' : 'down' };
  }
  // clearly marked sample numbers for a place without the member service (the web preview)
  function sample(range = 30, t = Date.now()) {
    const len = Math.min(90, Math.max(62, range * 2));
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const rows = Array.from({ length: len }, (_, i) => {
      const t0 = t - (len - 1 - i) * DAY;
      const wd = new Date(t0 + TW).getUTCDay();
      const k = (0.75 + (0.5 * i) / len) * (wd === 0 || wd === 6 ? 1.3 : 1);
      const signup = Math.round((7 + rnd() * 7) * k);
      const line = Math.round(signup * 0.55); const phone = Math.round(signup * 0.25);
      const start = Math.round(rnd() * 4 * k);
      return {
        day: dayKey(t0), signup, signup_line: line, signup_phone: phone, signup_email: Math.max(0, signup - line - phone), login: Math.round(signup * 2.2),
        open: Math.round((120 + rnd() * 60) * k + i * 2), invite: Math.round(signup * 0.3), gift: Math.round(signup * 0.28),
        gb_start: start, gb_join: Math.round(start * 1.9), gb_done: Math.round(start * 0.6), wall_new: Math.round(rnd() * 3), wall_wish: Math.round(rnd() * 14),
        circle_join: Math.round(signup * 0.4), circle_vote: Math.round(20 + rnd() * 30), wave: Math.round(40 + rnd() * 50), deleted: rnd() < 0.15 ? 1 : 0,
        push_sub: Math.round(signup * 0.45), push_sent: Math.round(60 + rnd() * 40), family_new: Math.round(rnd() * 3), family_join: Math.round(rnd() * 5),
        // what the app was used for (sent by the phones)
        active_d: Math.round((150 + rnd() * 40) * k + i * 2), active_w: Math.round((wd === 1 ? 260 : 25) * k * (0.8 + rnd() * 0.4)), active_m: new Date(t0 + TW).getUTCDate() === 1 ? Math.round(520 * k) : Math.round(12 * k * rnd()),
        first_open: Math.round(signup * 2.6), ob_prep: Math.round(signup * 0.35), ob_preg: Math.round(signup * 0.9), ob_baby: Math.round(signup * 1.1), ob_demo: Math.round(signup * 0.8),
        log_breast: Math.round((300 + rnd() * 80) * k), log_bottle: Math.round((220 + rnd() * 60) * k), log_pump: Math.round((60 + rnd() * 30) * k), log_diaper: Math.round((420 + rnd() * 90) * k),
        log_sleep: Math.round((180 + rnd() * 50) * k), log_food: Math.round((25 + rnd() * 15) * k), log_other: Math.round((30 + rnd() * 20) * k),
        checkin: Math.round((45 + rnd() * 25) * k), monthly_photo: Math.round(3 + rnd() * 6), recap_view: Math.round(5 + rnd() * 10), night_open: Math.round((20 + rnd() * 15) * k),
        island_stamp: Math.round((30 + rnd() * 20) * k), search: Math.round((40 + rnd() * 30) * k), weekly_sent: wd === 0 ? Math.round(18 * k) : Math.round(rnd() * 3),
        share_line: Math.round((12 + rnd() * 8) * k), share_ig: Math.round((4 + rnd() * 4) * k), share_fb: Math.round((2 + rnd() * 3) * k), share_threads: Math.round(rnd() * 3),
        share_copy: Math.round(rnd() * 4), share_more: Math.round((3 + rnd() * 3) * k), share_save: Math.round((5 + rnd() * 5) * k),
        brand_view: Math.round((22 + rnd() * 12) * k), brand_shop: Math.round((6 + rnd() * 5) * k), brand_line: Math.round((3 + rnd() * 3) * k),
        handoff: Math.round((2 + rnd() * 4) * k),
      };
    });
    return {
      at: t, days: len, storage: 'sample', members: 1284, online: 23, totals: { marketing: 712, push: 388, families: 96 }, rows,
      groupbuys: [
        { id: 'gb-sample-1', title: '易家滴雞精 10 入（範例）', emoji: '🍲', size: 3, active: true, endsAt: t + 3 * DAY, teams: 46, people: 121, done: 31 },
        { id: 'gb-sample-2', title: '月子禮盒（範例）', emoji: '🎁', size: 5, active: false, endsAt: t - 9 * DAY, teams: 18, people: 64, done: 9 },
      ],
      circles: (() => {
        const due = Array.from({ length: 11 }, (_, i) => { const d = new Date(t + TW); const m = d.getUTCFullYear() * 12 + d.getUTCMonth() + i; return { month: `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`, n: [6, 14, 21, 25, 22, 19, 17, 12, 8, 4, 1][i] }; });
        const baby = [['0–3 個月', 48], ['4–6 個月', 31], ['7–12 個月', 27], ['1–2 歲', 15], ['2–3 歲', 6], ['3 歲以上', 2]].map(([label, n]) => ({ label, n }));
        const preg = due.reduce((a, x) => a + x.n, 0); const babies = baby.reduce((a, x) => a + x.n, 0);
        return { prep: 23, preg, babies, total: 23 + preg + babies, due, baby };
      })(),
    };
  }
  const COLS = [
    ['day', '日期'], ['signup', '新註冊'], ['signup_email', 'Email 註冊'], ['signup_phone', '手機註冊'], ['signup_line', 'LINE 註冊'], ['login', '登入'], ['open', 'App 開啟'],
    ['invite', '成功邀請'], ['gift', '邀請禮領取'], ['gb_start', '開團'], ['gb_join', '參團'], ['gb_done', '成團'], ['wall_new', '祝福牆新開'], ['wall_wish', '祝福留言'],
    ['circle_join', '好孕圈新成員'], ['circle_vote', '好孕圈投票'], ['wave', '島上打招呼'], ['push_sub', '開啟推播'], ['push_sent', '推播送出'], ['family_new', '家人共用（新家庭）'],
    ['family_join', '家人共用（加入）'], ['handoff', '交接卡'], ['deleted', '刪除帳號'],
    ['active_d', '當天使用的手機'], ['active_w', '本週第一次使用的手機'], ['active_m', '本月第一次使用的手機'], ['first_open', '第一次打開的手機'],
    ['ob_prep', '設定：備孕中'], ['ob_preg', '設定：懷孕中'], ['ob_baby', '設定：育兒中'], ['ob_demo', '先看範例'],
    ['log_breast', '記錄：親餵'], ['log_bottle', '記錄：瓶餵'], ['log_pump', '記錄：擠奶'], ['log_diaper', '記錄：尿布'], ['log_sleep', '記錄：睡眠'], ['log_food', '記錄：副食品'], ['log_other', '記錄：其他'],
    ['checkin', '滴雞精時光打卡'], ['brand_view', '看品牌頁的手機'], ['brand_shop', '點官網的手機'], ['brand_line', '點 LINE 的手機'],
    ['share_line', '分享：LINE'], ['share_ig', '分享：IG'], ['share_fb', '分享：Facebook'], ['share_threads', '分享：Threads'], ['share_copy', '分享：複製連結'], ['share_save', '分享：存圖片'], ['share_more', '分享：其他'],
    ['monthly_photo', '月照'], ['recap_view', '成長回顧'], ['night_open', '夜奶陪伴'], ['island_stamp', '好孕島蓋章'], ['search', '問答搜尋'], ['weekly_sent', '家族週報'],
  ];
  function csv(rows) {
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    return `﻿${[COLS.map((c) => c[1]).map(q).join(','), ...rows.map((r) => COLS.map(([k]) => q(k === 'day' ? r.day : (Number(r[k]) || 0))).join(','))].join('\r\n')}\r\n`;
  }

  /* ---------------- a column chart (one series: no legend, the title names it) ---------------- */
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, ...kids) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => { if (v != null) el.setAttribute(k, String(v)); });
    kids.flat().forEach((k) => { if (k != null) el.append(typeof k === 'string' ? document.createTextNode(k) : k); });
    return el;
  };
  const niceMax = (v) => {
    if (v <= 4) return 4;
    const p = 10 ** Math.floor(Math.log10(v)); const m = v / p;
    return (m <= 2 ? 2 : m <= 4 ? 4 : m <= 5 ? 5 : 10) * p; // eslint-disable-line no-nested-ternary
  };
  function columns(rows, field, { title, unit }) {
    const VW = 340; const VH = 170; const L = 34; const R = 6; const T = 22; const Bm = 24;
    const pw = VW - L - R; const ph = VH - T - Bm;
    const vals = rows.map((r) => Number(r[field]) || 0);
    const total = vals.reduce((a, b) => a + b, 0);
    const max = niceMax(Math.max(...vals, 1));
    const slot = pw / rows.length; const bw = Math.min(24, Math.max(2, slot - 2));
    const y = (v) => T + ph - (v / max) * ph;
    const top = Math.max(...vals); const iTop = vals.lastIndexOf(top); const iLast = vals.length - 1;
    const wrap = h('div', { class: 'ad-chart' });
    const tip = h('div', { class: 'ad-tip', role: 'status', 'aria-live': 'polite', hidden: true });
    const label = `${title}，近 ${rows.length} 天共 ${fmt(total)} ${unit}，最多 ${md(rows[iTop].day)} 的 ${fmt(top)} ${unit}`;
    const g = svg('svg', {
      viewBox: `0 0 ${VW} ${VH}`, class: 'ad-svg', role: 'img', 'aria-label': label, tabindex: '0', focusable: 'true',
    });
    [0, max / 2, max].forEach((v) => {
      g.append(svg('line', { x1: L, x2: VW - R, y1: y(v), y2: y(v), class: 'ad-grid' }));
      g.append(svg('text', { x: L - 6, y: y(v) + 4, class: 'ad-tick', 'text-anchor': 'end' }, fmt(v)));
    });
    const bars = vals.map((v, i) => {
      const x = L + i * slot + (slot - bw) / 2; const hh = (v / max) * ph; const r = Math.min(4, bw / 2, hh);
      const yb = T + ph;
      const d = hh <= 0 ? '' : `M${x},${yb}V${yb - hh + r}Q${x},${yb - hh} ${x + r},${yb - hh}H${x + bw - r}Q${x + bw},${yb - hh} ${x + bw},${yb - hh + r}V${yb}Z`;
      const bar = svg('path', { d, class: 'ad-bar' });
      g.append(bar);
      return bar;
    });
    // the highest day and today get their number. A number sits above every bar under it (today's, drawn leftwards so
    // it stays inside the chart, used to land on a taller bar beside it); when the two numbers would touch, only the
    // highest keeps its own
    const tag = (i) => {
      const text = fmt(vals[i]); const w = text.length * 6.2 + 2; const cx = L + i * slot + slot / 2;
      const anchor = i === iLast && slot < 14 ? 'end' : 'middle';
      const x0 = anchor === 'end' ? cx - w : cx - w / 2; const x1 = anchor === 'end' ? cx : cx + w / 2;
      let ty = y(vals[i]) - 5;
      vals.forEach((v, j) => { const bx = L + j * slot + (slot - bw) / 2; if (bx < x1 && bx + bw > x0) ty = Math.min(ty, y(v) - 5); });
      return { i, text, cx, anchor, x0, x1, ty: Math.max(9, ty) };
    };
    const tags = [iTop, iLast].filter((i, k, a) => a.indexOf(i) === k && vals[i] > 0).map(tag);
    if (tags.length === 2 && tags[0].x0 < tags[1].x1 + 2 && tags[1].x0 < tags[0].x1 + 2 && Math.abs(tags[0].ty - tags[1].ty) < 12) tags.pop();
    tags.forEach((t) => g.append(svg('text', { x: t.cx, y: t.ty, class: 'ad-val', 'text-anchor': t.anchor }, t.text)));
    [0, Math.floor((rows.length - 1) / 2), rows.length - 1].forEach((i, k) => {
      g.append(svg('text', { x: L + i * slot + slot / 2, y: VH - 6, class: 'ad-tick', 'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle' }, k === 2 ? '今天' : md(rows[i].day))); // eslint-disable-line no-nested-ternary
    });
    // the hover / focus layer: each day's slot (taller and wider than its bar) shows the day and the number
    let on = -1;
    const show = (i) => {
      if (on >= 0 && bars[on]) bars[on].classList.remove('on');
      on = i;
      if (i < 0) { tip.hidden = true; return; }
      bars[i].classList.add('on');
      tip.textContent = '';
      tip.append(h('strong', null, `${fmt(vals[i])} ${unit}`), h('span', null, `${md(rows[i].day)}${i === iLast ? '（今天，還沒結束）' : ''}`));
      tip.hidden = false;
      const px = ((L + i * slot + slot / 2) / VW) * 100;
      tip.style.left = `${Math.max(14, Math.min(86, px))}%`;
    };
    vals.forEach((v, i) => {
      const hit = svg('rect', { x: L + i * slot, y: T, width: slot, height: ph + Bm, class: 'ad-hit' });
      hit.addEventListener('pointerenter', () => show(i));
      hit.addEventListener('pointerdown', () => show(i));
      g.append(hit);
    });
    g.addEventListener('pointerleave', () => show(-1));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(Math.max(0, Math.min(iLast, (on < 0 ? iLast : on) + (e.key === 'ArrowRight' ? 1 : -1)))); }
      if (e.key === 'Escape') show(-1);
    });
    g.addEventListener('blur', () => show(-1));
    wrap.append(g, tip);
    return wrap;
  }
  // the same numbers as a table (no hover needed)
  function table(rows, fields) {
    return h('details', { class: 'ad-table' }, h('summary', { class: 'small' }, '看每天的數字'),
      h('div', { class: 'ad-scroll' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, '日期'), fields.map(([, t]) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, rows.slice().reverse().map((r) => h('tr', null, h('th', { scope: 'row' }, md(r.day)), fields.map(([k]) => h('td', null, fmt(r[k])))))))));
  }

  // label | bar | number (and its share of the group): one colour, the number beside each bar, no legend needed.
  // All rows share one set of columns (css grid), so every bar is measured against the same track.
  // An item's `note` replaces its share of the group (the brand funnel shows "of the brand page" instead).
  function hbars(items) {
    const max = Math.max(1, ...items.map((x) => x.v)); const sum = items.reduce((a, x) => a + x.v, 0);
    const note = (x) => (x.note !== undefined ? x.note : sum ? `${Math.round((x.v / sum) * 100)}%` : '');
    return h('div', { class: 'ad-hbars' }, items.map((x) => h('div', { class: 'ad-hrow' },
      h('span', { class: 'ad-hn' }, x.t),
      h('span', { class: 'ad-htrack' }, h('span', { class: 'ad-hfill', style: { width: `${(x.v / max) * 100}%` } })),
      h('span', { class: 'ad-hv2' }, fmt(x.v), note(x) ? h('small', null, ` ${note(x)}`) : null))));
  }
  // phones in use: today (sent once a day by each phone), this week (once a week, since Monday), this month (since the 1st)
  function inUse(rows, t = Date.now()) {
    const today = dayKey(t);
    const d = new Date(t + TW); const wd = d.getUTCDay() || 7;
    const monday = dayKey(t - (wd - 1) * DAY); const first = `${today.slice(0, 8)}01`;
    const add = (f, from) => rows.filter((r) => r.day >= from && r.day <= today).reduce((a, r) => a + (Number(r[f]) || 0), 0);
    const last = rows.find((r) => r.day === today) || {};
    return { day: Number(last.active_d) || 0, week: add('active_w', monday), month: add('active_m', first) };
  }
  const monthLabel = (m) => `${m.slice(0, 4)} 年 ${Number(m.slice(5, 7))} 月`;

  /* ---------------- the page ---------------- */
  function tile(labelText, value, d, { good = 'up', sub = '' } = {}) {
    const cls = !d || d.dir === 'flat' ? 'flat' : d.dir === good ? 'good' : 'bad';
    return h('div', { class: 'ad-tile' },
      h('div', { class: 'ad-tl' }, labelText),
      h('div', { class: 'ad-tv' }, value),
      d ? h('div', { class: `ad-td ${cls}` }, h('span', { 'aria-hidden': 'true' }, d.dir === 'up' ? '▲ ' : d.dir === 'down' ? '▼ ' : '＝ '), `${d.text}`, h('span', { class: 'ad-vs' }, ` 比前 ${view.range} 天`)) // eslint-disable-line no-nested-ternary
        : (sub ? h('div', { class: 'ad-td flat' }, sub) : null));
  }
  function keyForm(el) {
    const input = h('input', {
      type: 'password', class: 'input ad-key', autocomplete: 'off', spellcheck: 'false', placeholder: '管理金鑰', 'aria-label': '管理金鑰',
    });
    const remember = h('input', { type: 'checkbox' });
    const go = () => {
      const k = input.value.trim();
      if (k.length < 24) { ui.toast('金鑰至少 24 個字元'); input.focus(); return; }
      setKey(k, remember.checked); view.error = ''; load();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    el.append(ui.card({ class: 'ad-login' },
      h('div', { class: 'ad-lock', 'aria-hidden': 'true' }, '🔐'),
      h('h2', { class: 'ad-h' }, '品牌數據'),
      h('p', { class: 'small muted' }, '這一頁給易家的工作人員看會員與活動的數字（只有次數，沒有是誰）。請輸入伺服器設定的管理金鑰（MOM_ADMIN_KEY）。'),
      view.error ? h('p', { class: 'small ad-err', role: 'alert' }, view.error) : null,
      input,
      h('label', { class: 'check-row' }, remember, h('span', { class: 'small' }, '記住這台裝置（只在自己的手機或電腦勾選）')),
      h('button', { class: 'btn btn-primary btn-block mt', onclick: go }, '查看數據'),
      h('p', { class: 'tiny faint mt' }, '金鑰只存在這台裝置；猜錯太多次，這個網路會被暫停一小時。')));
  }
  function render(el) {
    const d = view.data;
    if (!d) {
      if (view.loading) { el.append(h('p', { class: 'center muted mt-lg', role: 'status' }, '讀取數據中…')); return; }
      keyForm(el); return;
    }
    const S = sums(d.rows || [], view.range);
    if (view.sample) {
      el.append(h('div', { class: 'ad-sample', role: 'note' }, h('strong', null, '範例數字（不是真實數據）'),
        h('span', null, '這裡沒有連上會員伺服器，所以先用範例數字讓你看看版面。正式上線、設定 MOM_ADMIN_KEY 後，這一頁會顯示真實的數字。')));
    }
    const updated = new Date(d.at || Date.now());
    el.append(h('div', { class: 'ad-bar-row' },
      ui.seg([{ value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }], view.range, (v) => { view.range = Number(v); if (view.sample) { view.data = sample(view.range); paint(); } else load(); }, { small: true }),
      h('span', { class: 'tiny muted grow ad-upd' }, `更新 ${updated.getHours()}:${String(updated.getMinutes()).padStart(2, '0')}`),
      h('button', { class: 'icon-btn ad-refresh', 'aria-label': '重新整理', onclick: () => (view.sample ? (view.data = sample(view.range), paint()) : load()) }, '↻')));
    if (view.loading) el.classList.add('ad-loading');

    // the one number the page leads with, then the tiles
    el.append(h('div', { class: 'ad-hero' },
      h('div', { class: 'ad-hl' }, '會員總數'),
      h('div', { class: 'ad-hv' }, fmt(d.members)),
      h('div', { class: 'small muted' }, `現在 ${fmt(d.online)} 位在線上`)));
    // the phones in use (members or not): the number the app is judged by
    const U = inUse(d.rows || [], d.at || Date.now());
    el.append(h('div', { class: 'ad-tiles ad-use' },
      tile('今天在用的手機', fmt(U.day), null, { sub: '今天打開過 App' }),
      tile('本週在用', fmt(U.week), null, { sub: '星期一到今天' }),
      tile('本月在用', fmt(U.month), null, { sub: '1 號到今天' }),
      tile('新手機', fmt(S.cur('first_open')), delta(S.cur('first_open'), S.prev('first_open')), {})));
    const T = d.totals || {};
    const mk = Number(T.marketing) || 0;
    el.append(h('div', { class: 'ad-tiles' },
      tile('新註冊', fmt(S.cur('signup')), delta(S.cur('signup'), S.prev('signup'))),
      tile('App 開啟', fmt(S.cur('open')), delta(S.cur('open'), S.prev('open'))),
      tile('成功邀請', fmt(S.cur('invite')), delta(S.cur('invite'), S.prev('invite'))),
      tile('團購成團', fmt(S.cur('gb_done')), delta(S.cur('gb_done'), S.prev('gb_done'))),
      tile('同意行銷訊息', fmt(mk), null, { sub: d.members ? `會員的 ${Math.round((mk / d.members) * 100)}%` : '' }),
      tile('刪除帳號', fmt(S.cur('deleted')), delta(S.cur('deleted'), S.prev('deleted')), { good: 'down' })));

    el.append(ui.card({ class: 'ad-card ad-c-active' }, h('h3', { class: 'ad-ct' }, '每天在用的手機'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・支（當天打開過 App，會員和沒註冊的都算）`), columns(S.rows, 'active_d', { title: '每天在用的手機', unit: '支' }), table(S.rows, [['active_d', '在用的手機'], ['first_open', '新手機']])));
    el.append(ui.card({ class: 'ad-card ad-c-signup' }, h('h3', { class: 'ad-ct' }, '每日新註冊'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・人`), columns(S.rows, 'signup', { title: '每日新註冊', unit: '人' }), table(S.rows, [['signup', '新註冊']])));
    el.append(ui.card({ class: 'ad-card ad-c-open' }, h('h3', { class: 'ad-ct' }, '每日 App 開啟'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・次（打開 App，或隔一小時以上再回來）`), columns(S.rows, 'open', { title: '每日 App 開啟', unit: '次' }), table(S.rows, [['open', 'App 開啟'], ['login', '登入']])));

    // how they sign up
    el.append(ui.card({ class: 'ad-card' }, h('h3', { class: 'ad-ct' }, '註冊方式'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・人`),
      hbars([['signup_line', 'LINE'], ['signup_phone', '手機'], ['signup_email', 'Email']].map(([k, t]) => ({ t, v: S.cur(k) })))));

    // the stage new users choose when they set up the app (and those who look at the sample data first)
    el.append(ui.card({ class: 'ad-card ad-stage' }, h('h3', { class: 'ad-ct' }, '新使用者選的階段'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・人（第一次設定時選的）`),
      hbars([['ob_prep', '備孕中'], ['ob_preg', '懷孕中'], ['ob_baby', '育兒中']].map(([k, t]) => ({ t, v: S.cur(k) }))),
      h('p', { class: 'small muted mt' }, `先看範例資料：${fmt(S.cur('ob_demo'))} 次`)));

    // what gets recorded
    el.append(ui.card({ class: 'ad-card ad-logs' }, h('h3', { class: 'ad-ct' }, '記錄了什麼'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・筆（範例資料不算）`),
      hbars([['log_diaper', '尿布'], ['log_breast', '親餵'], ['log_bottle', '瓶餵'], ['log_sleep', '睡眠'], ['log_pump', '擠奶'], ['log_food', '副食品'], ['log_other', '其他']].map(([k, t]) => ({ t, v: S.cur(k) })))));

    // the brand: 滴雞精時光 every day, and the way from the brand page to the shop
    const bv = S.cur('brand_view'); const bs = S.cur('brand_shop'); const bl = S.cur('brand_line');
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
    el.append(ui.card({ class: 'ad-card ad-brand' }, h('h3', { class: 'ad-ct' }, '滴雞精時光打卡'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・次`),
      columns(S.rows, 'checkin', { title: '每天的滴雞精時光打卡', unit: '次' }), table(S.rows, [['checkin', '打卡']]),
      h('h3', { class: 'ad-ct mt-lg' }, '從品牌頁到官網'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・每支手機每天各算一次・百分比是看品牌頁的幾成`),
      hbars([{ t: '看品牌頁', v: bv, note: '' }, { t: '點官網', v: bs, note: pct(bs, bv) }, { t: '點 LINE', v: bl, note: pct(bl, bv) }]),
      h('p', { class: 'small muted mt' }, '「點官網」也包含好物和好孕島小舖裡的官網連結，「點 LINE」也包含好孕島的 LINE 諮詢，所以百分比是大約的。')));

    // shares, by where they went
    el.append(ui.card({ class: 'ad-card ad-shares' }, h('h3', { class: 'ad-ct' }, '分享'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・次`),
      hbars([['share_line', 'LINE'], ['share_ig', 'IG'], ['share_fb', 'Facebook'], ['share_threads', 'Threads'], ['share_save', '存圖片'], ['share_copy', '複製連結'], ['share_more', '其他']].map(([k, t]) => ({ t, v: S.cur(k) }))),
      h('p', { class: 'small muted mt' }, `分享帶來：成功邀請 ${fmt(S.cur('invite'))} 位・領邀請禮 ${fmt(S.cur('gift'))} 位`)));

    // group-buys
    const gbs = d.groupbuys || [];
    el.append(ui.card({ class: 'ad-card' }, h('h3', { class: 'ad-ct' }, '團購活動'), h('p', { class: 'tiny muted ad-cs' }, '每檔活動到現在的累計'),
      gbs.length ? h('div', { class: 'ad-gbs' }, gbs.map((g) => {
        const rate = g.teams ? Math.round((g.done / g.teams) * 100) : 0;
        return h('div', { class: 'ad-gb' },
          h('div', { class: 'row gap ad-gbh' }, h('span', { 'aria-hidden': 'true' }, g.emoji || '🛒'), h('strong', { class: 'grow' }, g.title), h('span', { class: `chip ad-st ${g.active ? 'on' : ''}` }, g.active ? '進行中' : '已結束')),
          h('div', { class: 'ad-gbn' }, h('span', null, '開團 ', h('b', null, fmt(g.teams))), h('span', null, '參加 ', h('b', null, fmt(g.people))), h('span', null, '成團 ', h('b', null, fmt(g.done)))),
          h('div', { class: 'ad-meter', role: 'img', 'aria-label': `成團率 ${rate}%` }, h('span', { style: { width: `${rate}%` } })),
          h('div', { class: 'tiny muted' }, `成團率 ${rate}%・${g.size} 人成團`));
      })) : h('p', { class: 'small muted' }, '還沒有團購活動（在伺服器的 MOM_GROUPBUYS 設定）。')));

    // 同週好孕圈 (moms who chose to join; opened it in the last two weeks): 備孕, due months, babies' ages
    const C = d.circles;
    if (C) {
      const dueRows = (C.due || []).filter((x, i, a) => x.n > 0 || a.slice(i).some((y) => y.n > 0)); // no empty months at the end
      el.append(ui.card({ class: 'ad-card ad-circles' }, h('h3', { class: 'ad-ct' }, '同週好孕圈的媽媽'),
        h('p', { class: 'tiny muted ad-cs' }, `現在 ${fmt(C.total)} 位（自己選擇加入、近 14 天打開過）・備孕 ${fmt(C.prep)}・懷孕 ${fmt(C.preg)}・育兒 ${fmt(C.babies)}`),
        h('h4', { class: 'ad-sub' }, '預產期在哪個月'),
        dueRows.length ? hbars(dueRows.map((x) => ({ t: monthLabel(x.month), v: x.n }))) : h('p', { class: 'small muted' }, '還沒有懷孕中的媽媽加入。'),
        h('h4', { class: 'ad-sub' }, '寶寶多大'),
        C.babies ? hbars((C.baby || []).map((x) => ({ t: x.label, v: x.n }))) : h('p', { class: 'small muted' }, '還沒有育兒中的媽媽加入。')));
    }

    // what moms do
    const acts = [['gift', '邀請禮領取'], ['gb_start', '開團'], ['gb_join', '參團'], ['wall_new', '祝福牆新開'], ['wall_wish', '祝福留言'], ['circle_join', '好孕圈新成員'], ['circle_vote', '好孕圈投票'], ['wave', '島上打招呼'], ['login', '登入'], ['push_sub', '開啟推播'], ['push_sent', '推播送出'], ['family_new', '家人共用（新家庭）'], ['family_join', '家人共用（加入）'], ['handoff', '交接卡']];
    el.append(ui.card({ class: 'ad-card' }, h('h3', { class: 'ad-ct' }, '互動'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天合計・次`),
      h('table', { class: 'ad-acts' }, h('tbody', null, acts.map(([k, t]) => h('tr', null, h('th', { scope: 'row' }, t), h('td', null, fmt(S.cur(k)))))))));
    const uses = [['night_open', '夜奶陪伴'], ['recap_view', '成長回顧'], ['monthly_photo', '寶寶月照（放照片）'], ['island_stamp', '好孕島蓋章'], ['search', '問答搜尋'], ['weekly_sent', '家族週報傳出']];
    el.append(ui.card({ class: 'ad-card ad-uses' }, h('h3', { class: 'ad-ct' }, '功能使用'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天合計・次`),
      h('table', { class: 'ad-acts' }, h('tbody', null, uses.map(([k, t]) => h('tr', null, h('th', { scope: 'row' }, t), h('td', null, fmt(S.cur(k)))))))));
    if (T.push != null || T.families != null) {
      el.append(h('p', { class: 'small muted ad-tot' }, [T.push != null ? `收推播的手機 ${fmt(T.push)} 支` : '', T.families != null ? `家人共用 ${fmt(T.families)} 個家庭` : ''].filter(Boolean).join('・')));
    }

    el.append(h('div', { class: 'row gap mt ad-foot' },
      h('button', {
        class: 'btn btn-soft grow ad-csv',
        onclick: () => { const blob = new Blob([csv(S.rows)], { type: 'text/csv;charset=utf-8' }); App.share.downloadBlob(blob, `yijia-stats-${dayKey(Date.now())}.csv`); ui.toast('已下載 CSV（可用 Excel 開啟）'); },
      }, '⬇️ 匯出 CSV'),
      view.sample ? null : h('button', { class: 'btn btn-ghost ad-out', onclick: () => { clearKey(); view.data = null; paint(); } }, '登出')));
    el.append(h('p', { class: 'disclaimer' }, '這一頁只有次數，沒有姓名、帳號或電話。新註冊以會員名單為準（也包含這版以前的日子）；其他數字從開始統計的那一版起累計。在用的手機、選的階段、記錄、打卡、分享、品牌頁和功能使用，是 App 跟著每分鐘的連線送來的「次數」（不含是誰；範例資料不算；沒網路時先存在手機，連上再送）。同意行銷訊息為目前人數。'));
  }
  let host = null;
  function paint() {
    if (!host || !host.isConnected) return;
    host.innerHTML = ''; host.classList.remove('ad-loading');
    render(host);
  }
  async function load() {
    const key = getKey();
    if (!key) { view.data = null; paint(); return; }
    view.loading = true; paint();
    try {
      // at least two months of days: 「本月在用」 adds up from the 1st (and the range is compared with the one before it)
      view.data = await App.account.call('GET', `admin/stats?days=${Math.min(90, Math.max(62, view.range * 2))}`, null, { 'X-Admin-Key': key });
      view.sample = false; view.error = '';
    } catch (e) {
      const st = e && e.status;
      if (st === 401) { clearKey(); view.data = null; view.error = '金鑰不對，請再輸入一次。'; }
      else if (st === 429) { view.data = null; view.error = '猜錯太多次，這個網路暫停一小時，請稍後再試。'; }
      else if (st === 404) { view.data = null; view.error = '這個伺服器還沒有開啟品牌數據（請在伺服器設定 MOM_ADMIN_KEY，至少 24 個字元）。'; }
      else if (!view.data) view.error = '暫時連不上伺服器，請稍後再試。';
      else ui.toast('暫時連不上伺服器，顯示的是上一次的數字');
    }
    view.loading = false; paint();
  }
  App.screen('admin', {
    title: '品牌數據',
    liveUpdate: false,
    render(el) {
      host = h('div', { class: 'ad' }); el.append(host);
      if (view.data) { paint(); return; }
      view.loading = true; paint();
      App.account.config().then(() => {
        if (App.account.noService()) { view.sample = true; view.loading = false; view.data = sample(view.range); paint(); return; }
        view.loading = false;
        if (getKey()) load(); else paint();
      });
    },
  });

  App.admin = {
    sample, sums, delta, csv, dayKey, inUse,
  };
}());
