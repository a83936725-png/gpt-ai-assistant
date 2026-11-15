/* 會員：登入／註冊頁（Email、手機、LINE）、即時在線人數與註冊人數、我的帳號。
 * 只有在連得到會員 API（/mom-app/api）時才顯示人數與登入；離線或純靜態網站時自動隱藏，絕不顯示假數字。
 * 紀錄資料仍只存在手機，不會上傳。 */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const store = App.store;
  const B = () => window.BRAND || {};

  /* ================= API client ================= */
  const base = (() => {
    if (B().apiBase) return B().apiBase.replace(/\/?$/, '/');
    if (!/^https?:$/.test(location.protocol)) return null;
    return new URL('api/', location.href.split(/[?#]/)[0]).href;
  })();
  const token = () => (store.state.auth && store.state.auth.token) || '';
  async function call(method, path, body) {
    if (!base) throw Object.assign(new Error('offline'), { code: 'offline' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(base + path, {
        method, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(data.error || String(r.status)), { code: data.error || String(r.status), status: r.status });
      return data;
    } finally { clearTimeout(timer); }
  }
  let cfgP = null;
  const config = () => { if (!cfgP) cfgP = call('GET', 'config').catch(() => null); return cfgP; };

  /* ================= live counts ================= */
  App.live = null; // {online, registered, todaySignups, storage}
  const sid = (() => {
    try {
      let v = sessionStorage.getItem('mom-sid');
      if (!v) { v = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(36).padStart(2, '0')).join(''); sessionStorage.setItem('mom-sid', v); }
      return v;
    } catch (e) { return `s${Math.random().toString(36).slice(2, 14)}`; }
  })();
  const fmtN = (n) => Number(n || 0).toLocaleString('zh-TW');
  function fillPills() {
    document.querySelectorAll('.live-pill').forEach((el) => {
      const L = App.live;
      const th = (B().liveStats) || {};
      const showOn = L && L.online >= (th.showOnlineFrom || 1);
      const showReg = L && L.registered >= (th.showRegisteredFrom || 1);
      el.hidden = !(showOn || showReg);
      if (el.hidden) return;
      el.innerHTML = '';
      ui.append(el, [h('span', { class: 'live-dot', 'aria-hidden': 'true' }),
        showOn ? h('span', null, `現在 ${fmtN(L.online)} 位在線上`) : null,
        showOn && showReg ? h('span', { class: 'live-sep', 'aria-hidden': 'true' }, '・') : null,
        showReg ? h('span', null, `已有 ${fmtN(L.registered)} 位媽咪註冊`) : null,
        L.todaySignups ? h('span', { class: 'live-today' }, `今天 +${fmtN(L.todaySignups)}`) : null,
        L.storage === 'memory' ? h('span', { class: 'live-test' }, '測試環境') : null]); // ui.append skips nulls
    });
  }
  async function tick() {
    if (document.visibilityState !== 'visible') return;
    const cfg = await config();
    if (!cfg) return;
    try { await call('POST', 'presence', { sid }); } catch (e) { /* ignore */ }
    try { App.live = await call('GET', 'stats'); } catch (e) { App.live = null; }
    fillPills();
  }
  // a pill that fills itself with the latest real numbers (hidden until we have them)
  App.livePill = (cls = '') => {
    const el = h('button', { class: `live-pill ${cls}`, hidden: !App.live, 'aria-live': 'polite', onclick: () => App.navigate(store.state.auth ? 'invite' : 'login') });
    setTimeout(fillPills, 0);
    return el;
  };
  setTimeout(tick, 400);
  setInterval(tick, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });

  /* ================= session ================= */
  function setAuth(tok, user) {
    store.update((s) => {
      s.auth = { token: tok, user };
      if (user && user.code) { s.share = s.share || {}; s.share.code = user.code; } // the server-registered code counts referrals
      if (user && user.nickname && !s.profile.momName) s.profile.momName = user.nickname;
    });
    setTimeout(tick, 100); // show the new registered count right away
  }
  let lastRefresh = 0;
  async function refreshMe() {
    if (!token()) return;
    lastRefresh = Date.now();
    try {
      const { user } = await call('GET', 'me');
      const before = JSON.stringify(store.state.auth && store.state.auth.user);
      if (JSON.stringify(user) !== before) store.update((s) => { s.auth.user = user; }); // re-renders 我的／邀請好友
    } catch (e) {
      if (e.status === 401) { store.update((s) => { delete s.auth; }); ui.toast('登入已過期，請重新登入'); }
    }
  }
  setTimeout(refreshMe, 800);
  // keep 「已成功邀請 N 位」 fresh when the user comes back to 我的 or 邀請好友
  const maybeRefresh = () => { if (token() && Date.now() - lastRefresh > 10000) setTimeout(refreshMe, 0); };
  function logout() { mode = 'login'; store.update((s) => { delete s.auth; }); ui.toast('已登出（手機上的紀錄都還在）'); }

  let mode = 'login'; // 登入／註冊 toggle on the login page
  const ERR = {
    bad_account: '請輸入正確的 Email 或手機號碼（09 開頭 10 碼）',
    weak_password: '密碼至少 8 個字',
    exists: '這個帳號已經註冊過了，請直接登入',
    invalid: '帳號或密碼不正確',
    too_many: '嘗試太多次了，請 10 分鐘後再試',
    offline: '目前連不到會員服務，請稍後再試',
    state: 'LINE 登入逾時，請再試一次',
    denied: '你取消了 LINE 登入',
    line_error: 'LINE 登入失敗，請再試一次',
    line_disabled: '尚未開放 LINE 登入',
  };
  const errText = (e) => ERR[e.code] || (e.name === 'AbortError' ? ERR.offline : '發生錯誤，請稍後再試');

  /* ================= 登入／註冊頁 ================= */
  App.screen('login', {
    title: '登入／註冊',
    liveUpdate: false,
    render(el, params) {
      el.append(h('div', { class: 'login-hero center' },
        h('img', { src: B().logoFull || B().logo, alt: B().brandName || '', class: 'login-logo' }),
        h('h1', { class: 'login-title' }, `歡迎來到${B().appName || '易家做媽媽'}`),
        App.livePill('login-live')));
      const box = h('div', { class: 'login-box' });
      el.append(box);
      // LINE callback lands here with a token or an error
      if (params && params.token) {
        box.append(h('p', { class: 'center muted' }, '登入中…'));
        store.update((s) => { s.auth = { token: params.token, user: null }; });
        call('GET', 'me').then(({ user }) => {
          setAuth(params.token, user);
          ui.toast(`歡迎，${user.nickname} 💜`);
          App.navigate(store.state.onboarded ? 'home' : 'onboarding');
        }).catch((e) => { store.update((s) => { delete s.auth; }); box.innerHTML = ''; box.append(h('p', { class: 'login-err' }, errText(e))); drawForm(); });
        return;
      }
      if (params && params.error) box.append(h('p', { class: 'login-err' }, ERR[params.error] || '登入失敗，請再試一次'));
      if (store.state.auth && store.state.auth.user) {
        const u = store.state.auth.user;
        box.append(ui.card({ class: 'soft center' }, h('div', { class: 'bold' }, `已登入：${u.nickname}`), h('div', { class: 'small muted' }, u.accountHint),
          h('button', { class: 'btn btn-primary btn-block mt', onclick: () => App.navigate('home') }, '回首頁'),
          h('button', { class: 'btn btn-ghost btn-block mt', onclick: () => { logout(); App.refresh(); } }, '登出')));
        return;
      }
      drawForm();
      function drawForm() {
        const holder = h('div', null, h('p', { class: 'center muted small' }, '連線中…'));
        box.append(holder);
        config().then((cfg) => {
          holder.innerHTML = '';
          if (!cfg) {
            holder.append(ui.card({ class: 'soft' }, h('div', { class: 'card-title' }, '目前無法連到會員服務'),
              h('p', { class: 'small muted' }, '可能是離線，或網站還沒有部署會員後端。你仍然可以不登入，使用 App 的全部紀錄功能。'),
              h('button', { class: 'btn btn-primary btn-block mt', onclick: () => App.navigate(store.state.onboarded ? 'home' : 'onboarding') }, '先不登入，直接使用')));
            return;
          }
          const share = store.state.share || {};
          if (cfg.providers.line) {
            holder.append(h('button', {
              class: 'btn btn-block login-line', html: `${ui.ICONS.line}<span>用 LINE 登入</span>`,
              onclick: () => { location.href = `${base}auth/line/start?ref=${encodeURIComponent(share.invitedBy || '')}`; },
            }), h('div', { class: 'login-or' }, h('span', null, '或用 Email／手機')));
          }
          const acct = h('input', { type: 'text', inputmode: 'email', autocomplete: 'username', placeholder: 'Email 或手機（09xxxxxxxx）', class: 'input', 'aria-label': 'Email 或手機' });
          const pw = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: mode === 'login' ? '密碼' : '設定密碼（至少 8 個字）', class: 'input', 'aria-label': '密碼' });
          const showPw = h('button', { type: 'button', class: 'link-btn small login-show', onclick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; showPw.textContent = pw.type === 'password' ? '顯示' : '隱藏'; } }, '顯示');
          const nick = h('input', { type: 'text', value: store.state.profile.momName || '', placeholder: '暱稱（例如：小美）', class: 'input', maxlength: 20, 'aria-label': '暱稱' });
          const inv = h('input', { type: 'text', value: share.invitedBy || '', placeholder: '邀請碼（選填）', class: 'input', maxlength: 12, 'aria-label': '邀請碼' });
          const err = h('p', { class: 'login-err', hidden: true });
          const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, mode === 'login' ? '登入' : '註冊並登入');
          const form = h('form', { class: 'login-form', novalidate: true },
            ui.seg([{ value: 'login', label: '登入' }, { value: 'register', label: '註冊' }], mode, (v) => { mode = v; App.refresh(); }),
            ui.field('帳號', acct),
            ui.field('密碼', h('div', { class: 'login-pw' }, pw, showPw)),
            mode === 'register' ? ui.field('暱稱', nick) : null,
            mode === 'register' ? ui.field('邀請碼', inv, share.inviterName ? `由「${share.inviterName}」邀請` : '朋友給你的邀請碼，可以不填') : null,
            err, submit);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            err.hidden = true; submit.disabled = true; submit.textContent = '處理中…';
            try {
              const body = mode === 'login'
                ? { account: acct.value, password: pw.value }
                : { account: acct.value, password: pw.value, nickname: nick.value, invitedBy: inv.value, code: share.code, stage: store.state.onboarded ? store.stage : '' };
              const res = await call('POST', mode === 'login' ? 'auth/login' : 'auth/register', body);
              setAuth(res.token, res.user);
              ui.toast(mode === 'login' ? `歡迎回來，${res.user.nickname} 💜` : `註冊成功！歡迎 ${res.user.nickname} 💜`);
              mode = 'login';
              App.navigate(store.state.onboarded ? 'home' : 'onboarding');
            } catch (ex) {
              err.textContent = errText(ex); err.hidden = false;
              submit.disabled = false; submit.textContent = mode === 'login' ? '登入' : '註冊並登入';
            }
          });
          holder.append(form,
            h('button', { class: 'btn btn-ghost btn-block mt', onclick: () => App.navigate(store.state.onboarded ? 'home' : 'onboarding') }, '先不登入，直接使用'),
            h('p', { class: 'tiny muted center mt' }, '登入只用來辨識帳號、計算邀請人數與社群人數；你的懷孕、寶寶紀錄仍只存在這支手機，不會上傳。'));
        });
      }
    },
  });

  /* ================= 我的：帳號卡 ================= */
  App.account = {
    card() {
      maybeRefresh();
      const a = store.state.auth;
      if (a && a.user) {
        const u = a.user;
        return ui.card({ class: 'acct-card' },
          h('div', { class: 'row gap' },
            h('div', { class: 'grow' },
              h('div', { class: 'card-title' }, `👤 ${u.nickname}`, h('span', { class: 'tag primary' }, { line: 'LINE', email: 'Email', phone: '手機' }[u.provider] || '')),
              h('div', { class: 'small muted' }, `${u.accountHint}・邀請碼 ${u.code}`),
              h('div', { class: 'small' }, `已成功邀請 ${u.referrals || 0} 位加入`)),
            h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { logout(); App.refresh(); } }, '登出')));
      }
      return ui.card({ class: 'acct-card soft' },
        h('div', { class: 'row gap' },
          h('div', { class: 'grow' }, h('div', { class: 'card-title' }, '登入／註冊'), h('div', { class: 'small muted' }, 'Email、手機或 LINE・邀請好友可以累積人數')),
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => App.navigate('login') }, '登入')),
        App.livePill('acct-live'));
    },
    logout, refreshMe, refreshSoon: () => maybeRefresh(), call, available: async () => !!(await config()),
  };
}());
