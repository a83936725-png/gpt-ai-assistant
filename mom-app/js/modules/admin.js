/* 易家做媽媽 — 品牌數據 (the brand's own dashboard, #/admin; not linked anywhere for moms).
 * Members, sign-ups and app opens per day, invites, group-buys and what moms do in the app — counts only, never who
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
    const len = Math.min(90, range * 2);
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
      };
    });
    return {
      at: t, days: len, storage: 'sample', members: 1284, online: 23, totals: { marketing: 712, push: 388, families: 96 }, rows,
      groupbuys: [
        { id: 'gb-sample-1', title: '易家滴雞精 10 入（範例）', emoji: '🍲', size: 3, active: true, endsAt: t + 3 * DAY, teams: 46, people: 121, done: 31 },
        { id: 'gb-sample-2', title: '月子禮盒（範例）', emoji: '🎁', size: 5, active: false, endsAt: t - 9 * DAY, teams: 18, people: 64, done: 9 },
      ],
    };
  }
  const COLS = [
    ['day', '日期'], ['signup', '新註冊'], ['signup_email', 'Email 註冊'], ['signup_phone', '手機註冊'], ['signup_line', 'LINE 註冊'], ['login', '登入'], ['open', 'App 開啟'],
    ['invite', '成功邀請'], ['gift', '邀請禮領取'], ['gb_start', '開團'], ['gb_join', '參團'], ['gb_done', '成團'], ['wall_new', '祝福牆新開'], ['wall_wish', '祝福留言'],
    ['circle_join', '好孕圈新成員'], ['circle_vote', '好孕圈投票'], ['wave', '島上打招呼'], ['push_sub', '開啟推播'], ['push_sent', '推播送出'], ['family_new', '家人共用（新家庭）'],
    ['family_join', '家人共用（加入）'], ['deleted', '刪除帳號'],
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
    // the highest day and today get their number; when the two would touch, only the highest keeps it
    const near = iTop !== iLast && Math.abs(iTop - iLast) * slot < 26 && Math.abs(y(vals[iTop]) - y(vals[iLast])) < 13;
    [iTop, near ? -1 : iLast].filter((i, k, a) => i >= 0 && a.indexOf(i) === k && vals[i] > 0).forEach((i) => {
      g.append(svg('text', { x: L + i * slot + slot / 2, y: y(vals[i]) - 5, class: 'ad-val', 'text-anchor': i === iLast && slot < 14 ? 'end' : 'middle' }, fmt(vals[i])));
    });
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
    const T = d.totals || {};
    const mk = Number(T.marketing) || 0;
    el.append(h('div', { class: 'ad-tiles' },
      tile('新註冊', fmt(S.cur('signup')), delta(S.cur('signup'), S.prev('signup'))),
      tile('App 開啟', fmt(S.cur('open')), delta(S.cur('open'), S.prev('open'))),
      tile('成功邀請', fmt(S.cur('invite')), delta(S.cur('invite'), S.prev('invite'))),
      tile('團購成團', fmt(S.cur('gb_done')), delta(S.cur('gb_done'), S.prev('gb_done'))),
      tile('同意行銷訊息', fmt(mk), null, { sub: d.members ? `會員的 ${Math.round((mk / d.members) * 100)}%` : '' }),
      tile('刪除帳號', fmt(S.cur('deleted')), delta(S.cur('deleted'), S.prev('deleted')), { good: 'down' })));

    el.append(ui.card({ class: 'ad-card' }, h('h3', { class: 'ad-ct' }, '每日新註冊'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・人`), columns(S.rows, 'signup', { title: '每日新註冊', unit: '人' }), table(S.rows, [['signup', '新註冊']])));
    el.append(ui.card({ class: 'ad-card' }, h('h3', { class: 'ad-ct' }, '每日 App 開啟'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・次（打開 App，或隔一小時以上再回來）`), columns(S.rows, 'open', { title: '每日 App 開啟', unit: '次' }), table(S.rows, [['open', 'App 開啟'], ['login', '登入']])));

    // how they sign up
    const kinds = [['signup_line', 'LINE'], ['signup_phone', '手機'], ['signup_email', 'Email']].map(([k, t]) => ({ t, v: S.cur(k) }));
    const kMax = Math.max(1, ...kinds.map((x) => x.v)); const kSum = kinds.reduce((a, x) => a + x.v, 0);
    el.append(ui.card({ class: 'ad-card' }, h('h3', { class: 'ad-ct' }, '註冊方式'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天・人`),
      h('div', { class: 'ad-hbars' }, kinds.map((x) => h('div', { class: 'ad-hrow' },
        h('span', { class: 'ad-hn' }, x.t),
        h('span', { class: 'ad-htrack' }, h('span', { class: 'ad-hfill', style: { width: `${(x.v / kMax) * 100}%` } })),
        h('span', { class: 'ad-hv2' }, `${fmt(x.v)}`, h('small', null, kSum ? ` ${Math.round((x.v / kSum) * 100)}%` : '')))))));

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

    // what moms do
    const acts = [['gift', '邀請禮領取'], ['gb_start', '開團'], ['gb_join', '參團'], ['wall_new', '祝福牆新開'], ['wall_wish', '祝福留言'], ['circle_join', '好孕圈新成員'], ['circle_vote', '好孕圈投票'], ['wave', '島上打招呼'], ['login', '登入'], ['push_sub', '開啟推播'], ['push_sent', '推播送出'], ['family_new', '家人共用（新家庭）'], ['family_join', '家人共用（加入）']];
    el.append(ui.card({ class: 'ad-card' }, h('h3', { class: 'ad-ct' }, '互動'), h('p', { class: 'tiny muted ad-cs' }, `近 ${view.range} 天合計・次`),
      h('table', { class: 'ad-acts' }, h('tbody', null, acts.map(([k, t]) => h('tr', null, h('th', { scope: 'row' }, t), h('td', null, fmt(S.cur(k)))))))));
    if (T.push != null || T.families != null) {
      el.append(h('p', { class: 'small muted ad-tot' }, [T.push != null ? `收推播的手機 ${fmt(T.push)} 支` : '', T.families != null ? `家人共用 ${fmt(T.families)} 個家庭` : ''].filter(Boolean).join('・')));
    }

    el.append(h('div', { class: 'row gap mt ad-foot' },
      h('button', {
        class: 'btn btn-soft grow ad-csv',
        onclick: () => { const blob = new Blob([csv(S.rows)], { type: 'text/csv;charset=utf-8' }); App.share.downloadBlob(blob, `yijia-stats-${dayKey(Date.now())}.csv`); ui.toast('已下載 CSV（可用 Excel 開啟）'); },
      }, '⬇️ 匯出 CSV'),
      view.sample ? null : h('button', { class: 'btn btn-ghost ad-out', onclick: () => { clearKey(); view.data = null; paint(); } }, '登出')));
    el.append(h('p', { class: 'disclaimer' }, '這一頁只有次數，沒有姓名、帳號或電話。新註冊以會員名單為準（也包含這版以前的日子）；其他數字從這一版開始累計。同意行銷訊息為目前人數。'));
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
      view.data = await App.account.call('GET', `admin/stats?days=${Math.min(90, view.range * 2)}`, null, { 'X-Admin-Key': key });
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
    sample, sums, delta, csv, dayKey,
  };
}());
