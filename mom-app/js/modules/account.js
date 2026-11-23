/* 會員：登入／註冊頁（Email、手機、LINE）、即時在線人數與註冊人數、我的帳號。
 * 個資：註冊要勾選同意隱私權政策與使用條款（版本與時間存在帳號裡）；行銷訊息另外勾選、可隨時關閉；
 * LINE 新帳號與政策更新時，登入後先請她同意；帳號卡可以下載我的會員資料、刪除帳號。
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
  async function call(method, path, body, headers = null) {
    if (!base) throw Object.assign(new Error('offline'), { code: 'offline' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(base + path, {
        method, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(headers || {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(data.error || String(r.status)), { code: data.error || String(r.status), status: r.status });
      return data;
    } finally { clearTimeout(timer); }
  }
  let cfgP = null;
  let cfgNow = null; // the same, once it has arrived (for things drawn without waiting)
  // no config: 'none' — this site has no member service (a static copy, like the web preview: the address answers
  // 404 / 403), or 'down' — it is there but not reachable right now (offline, a timeout, too many tries, a server error)
  let cfgWhy = null;
  const noApiHere = (st) => st >= 400 && st < 500 && st !== 408 && st !== 429;
  const config = () => {
    if (!cfgP) {
      cfgP = call('GET', 'config').catch((e) => { cfgWhy = e && noApiHere(e.status) ? 'none' : 'down'; return null; }).then((c) => { cfgNow = c; return c; });
    }
    return cfgP;
  };
  // 驗證碼: which kinds of account (Email / phone) the server can send a code to
  const kindOf = (account) => (/@/.test(String(account)) ? 'email' : 'phone');
  const canVerify = (cfg, kind) => !!(cfg && cfg.verify && cfg.verify[kind]);
  const mask = (account) => {
    const v = String(account || '').trim();
    if (/@/.test(v)) { const [n, d] = v.split('@'); return `${n.slice(0, 1)}***@${d}`; }
    const ph = v.replace(/\D/g, '').replace(/^886/, '0');
    return ph.length >= 7 ? `${ph.slice(0, 4)}***${ph.slice(-3)}` : v;
  };

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
    if (document.visibilityState !== 'visible' || App.sandbox) return; // the landing page's 試玩 is not a mom opening the app
    const cfg = await config();
    if (!cfg) return;
    let here = false;
    try { await call('POST', 'presence', { sid }); here = true; } catch (e) { /* ignore */ }
    try {
      App.live = await call('GET', 'stats');
      // the server caches counts for ~15 s; if this phone just checked in, it is online, so count at least itself
      if (here) App.live = { ...App.live, online: Math.max(App.live.online, 1) };
    } catch (e) { App.live = null; }
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
  // back in the app (after sending an invite on LINE, say): fresh counts, and friends who joined meanwhile
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); maybeRefresh(); } });

  /* ================= session ================= */
  function setAuth(tok, user) {
    store.update((s) => {
      s.auth = { token: tok, user };
      if (user && user.code) { s.share = s.share || {}; s.share.code = user.code; } // the server-registered code counts referrals
      if (user && user.nickname && !s.profile.momName) s.profile.momName = user.nickname;
    });
    setTimeout(tick, 100); // show the new registered count right away
    if (App.gift && user) App.gift.sync(user); // 雙向邀請禮: her welcome gift (once set up and agreed), friends who joined
  }
  let lastRefresh = 0;
  async function refreshMe() {
    if (!token()) return;
    lastRefresh = Date.now();
    try {
      const { user } = await call('GET', 'me');
      const before = JSON.stringify(store.state.auth && store.state.auth.user);
      if (JSON.stringify(user) !== before) store.update((s) => { s.auth.user = user; }); // re-renders 我的／邀請好友
      ensureConsent(user);
      if (App.gift) App.gift.sync(user);
    } catch (e) {
      if (e.status === 401) { store.update((s) => { delete s.auth; }); ui.toast('登入已過期，請重新登入'); }
    }
  }
  setTimeout(refreshMe, 800);
  // keep 「已成功邀請 N 位」 fresh when the user comes back to 我的 or 邀請好友
  const maybeRefresh = () => { if (token() && Date.now() - lastRefresh > 10000) setTimeout(refreshMe, 0); };
  function logout({ quiet = false } = {}) {
    mode = 'login';
    const pp = store.state.settings && store.state.settings.push; // 手機通知 stop on this phone with the account
    if (pp && pp.endpoint && store.state.auth) { call('POST', 'push/unsubscribe', { endpoint: pp.endpoint }).catch(() => {}); if (App.push) App.push.forgetHere(); }
    store.update((s) => { delete s.auth; if (s.settings && s.settings.push) s.settings.push = null; });
    if (!quiet) ui.toast('已登出（手機上的紀錄都還在）');
  }

  /* ---- 個資：同意、下載、刪除 ---- */
  const MKT_LABEL = () => `我願意收到${B().brandName || '品牌'}的優惠與活動訊息（可隨時關閉）`;
  let consentOpen = false;
  // a LINE sign-up, or a policy that changed since she agreed: ask before any member feature
  function ensureConsent(user) {
    if (!user || !App.privacy || user.consent === App.privacy.VERSION || consentOpen) return;
    consentOpen = true;
    const fresh = !user.consent && user.createdAt && Date.now() - user.createdAt < 15 * 60 * 1000; // made just now (LINE)
    const agree = App.privacy.box();
    const mkt = App.privacy.box({ label: MKT_LABEL(), required: false, checked: !!user.marketing });
    let done = false;
    const sh = ui.sheet({
      title: user.consent ? '隱私權政策已更新' : '使用會員功能前',
      body: h('div', { class: 'stack-sm' },
        h('p', { class: 'small' }, user.consent
          ? '我們更新了隱私權政策與使用條款，請閱讀後勾選同意，才能繼續使用會員功能。'
          : '請先閱讀並勾選同意隱私權政策與使用條款，才能使用會員功能（邀請計數、社群人數）。你的懷孕與寶寶紀錄仍只存在手機。'),
        h('button', { class: 'btn btn-soft btn-block', onclick: () => App.privacy.open() }, '📄 閱讀隱私權政策與使用條款'),
        agree.el, mkt.el),
      footer: h('div', { class: 'row gap-sm' },
        h('button', { class: 'btn btn-ghost', onclick: () => sh.close() }, '不同意'),
        h('button', {
          class: 'btn btn-primary grow',
          onclick: async (e) => {
            if (!agree.need('請先勾選同意，才能繼續使用會員功能')) return;
            const btn = e.currentTarget; btn.disabled = true;
            try {
              const r = await call('POST', 'me', { consent: App.privacy.VERSION, marketing: mkt.checked });
              store.update((s) => { if (s.auth) s.auth.user = r.user; });
              done = true; sh.close(); ui.toast('謝謝你的回饋');
              if (App.gift) App.gift.sync(r.user); // a friend's welcome gift waits for this
            } catch (err) { btn.disabled = false; ui.toast(errText(err)); }
          },
        }, '同意並繼續')),
      onClose: async () => {
        consentOpen = false;
        if (done) return;
        // not agreed: no member features. An account made a minute ago (LINE) is removed, so nothing is kept without consent
        if (fresh) { try { await call('POST', 'auth/delete', {}); } catch (e) { /* logged out below either way */ } }
        logout({ quiet: true });
        ui.toast(fresh ? '沒有同意，所以沒有建立會員帳號（紀錄都還在手機裡）' : '需要同意新的政策才能使用會員功能，已登出（紀錄都還在手機裡）');
        App.refresh();
      },
    });
  }
  // 個資法 §3: a copy of what the server keeps about me
  async function exportMine() {
    try {
      const data = await call('GET', 'me/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `我的會員資料-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      ui.toast('已下載你的會員資料');
    } catch (e) { ui.toast(errText(e)); }
  }
  // 個資法 §3: correct my data (the nickname is the only thing others ever see)
  function editNickname(u) {
    const nick = h('input', {
      type: 'text', class: 'input', maxlength: 20, value: u.nickname || '', 'aria-label': '暱稱',
    });
    let sh = null;
    sh = ui.sheet({
      title: '修改暱稱',
      body: h('div', { class: 'stack-sm' }, ui.field('暱稱', nick, '最多 20 個字')),
      footer: h('button', {
        class: 'btn btn-primary btn-block',
        onclick: async (e) => {
          const btn = e.currentTarget; btn.disabled = true;
          try {
            const r = await call('POST', 'me', { nickname: nick.value });
            store.update((s) => { if (s.auth) s.auth.user = r.user; });
            sh.close(); ui.toast('暱稱已更新');
          } catch (err) { btn.disabled = false; ui.toast(errText(err)); }
        },
      }, '儲存'),
    });
  }
  // 個資法 §3: delete my account (a password account confirms with its password)
  function deleteAccount(u) {
    const pw = u.provider === 'line' ? null : h('input', {
      type: 'password', class: 'input', autocomplete: 'current-password', placeholder: '輸入密碼確認', 'aria-label': '密碼',
    });
    const also = App.social ? h('input', { type: 'checkbox', checked: true }) : null;
    const err = h('p', { class: 'login-err', hidden: true });
    let sh = null;
    const go = h('button', {
      class: 'btn btn-danger btn-block',
      onclick: async () => {
        err.hidden = true; go.disabled = true;
        try {
          await call('POST', 'auth/delete', pw ? { password: pw.value } : {});
          if (also && also.checked && App.social && App.social.forgetAll) await App.social.forgetAll();
          sh.close(); logout({ quiet: true });
          ui.toast('帳號已刪除'); App.refresh();
        } catch (e) {
          err.textContent = e.code === 'invalid' ? '密碼不正確' : errText(e); err.hidden = false; go.disabled = false;
        }
      },
    }, '永久刪除帳號');
    sh = ui.sheet({
      title: '刪除帳號',
      body: h('div', { class: 'stack-sm' },
        h('p', { class: 'small' }, '會從伺服器永久刪除：Email／手機、暱稱、邀請碼、同意紀錄與行銷設定，邀請人數也會歸零。刪除後無法復原。'),
        h('p', { class: 'small muted' }, '手機上的懷孕、寶寶紀錄和照片不會被刪除，App 照常可以使用。'),
        also ? h('label', { class: 'check-row' }, also, h('span', { class: 'small' }, '同時關閉島上的媽媽、同週好孕圈，並刪除我開的祝福牆')) : null,
        pw, err, go),
    });
  }

  /* ---- 驗證碼 pieces ---- */
  function codeField(onResend) {
    const input = h('input', {
      type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '6 位數驗證碼', class: 'input login-code', 'aria-label': '驗證碼',
    });
    const hint = h('p', { class: 'tiny muted login-code-hint', role: 'status' });
    const resend = h('button', { type: 'button', class: 'link-btn small login-resend', onclick: () => onResend() }, '重新寄送');
    let timer = null;
    const cool = (sec) => {
      clearInterval(timer); let left = sec; resend.disabled = true; resend.textContent = `重新寄送（${left}）`;
      timer = setInterval(() => {
        left -= 1;
        if (left <= 0 || !resend.isConnected) { clearInterval(timer); resend.disabled = false; resend.textContent = '重新寄送'; } else resend.textContent = `重新寄送（${left}）`;
      }, 1000);
    };
    const wrapped = (fn) => async () => { try { await fn(); } catch (e) { ui.toast(errText(e)); } };
    resend.onclick = wrapped(onResend);
    return { el: h('div', { class: 'login-code-box' }, input, hint, resend), input, hint, cool };
  }
  // 忘記密碼: a code to the Email / phone, then a new password (other devices are logged out)
  function forgotSheet(prefill = '') {
    const account = h('input', {
      type: 'text', inputmode: 'email', autocomplete: 'username', value: prefill, placeholder: 'Email 或手機（09xxxxxxxx）', class: 'input', 'aria-label': 'Email 或手機',
    });
    const err = h('p', { class: 'login-err', hidden: true, role: 'alert' });
    const codeUI = codeField(() => send(true));
    const npw = h('input', {
      type: 'password', autocomplete: 'new-password', placeholder: '新密碼（至少 8 個字）', class: 'input', 'aria-label': '新密碼',
    });
    const step2 = h('div', { class: 'login-step2', hidden: true }, ui.field('驗證碼', codeUI.el), ui.field('新密碼', npw));
    const go = h('button', { class: 'btn btn-primary btn-block login-reset-go' }, '寄驗證碼');
    let stage = 1;
    account.addEventListener('input', () => { if (stage === 2) { stage = 1; step2.hidden = true; go.textContent = '寄驗證碼'; } });
    async function send(again) {
      const r = await call('POST', 'auth/code', { account: account.value, purpose: 'reset' });
      stage = 2; step2.hidden = false; go.textContent = '設定新密碼並登入';
      codeUI.hint.textContent = `如果 ${mask(account.value)} 有註冊，會收到 6 位數驗證碼（10 分鐘內有效）${r.devCode ? `（測試環境：${r.devCode}）` : ''}`;
      codeUI.cool(60);
      if (again) ui.toast('已重新寄送驗證碼'); else codeUI.input.focus();
    }
    go.onclick = async () => {
      err.hidden = true; go.disabled = true;
      try {
        if (stage === 1) { await send(false); go.disabled = false; return; }
        const r = await call('POST', 'auth/reset', { account: account.value, code: codeUI.input.value, password: npw.value });
        sh.close();
        setAuth(r.token, r.user);
        ui.toast('密碼已更新，其他裝置都已登出');
        goOn();
      } catch (e) { err.textContent = errText(e); err.hidden = false; go.disabled = false; }
    };
    const sh = ui.sheet({
      title: '忘記密碼',
      body: h('div', { class: 'stack-sm' }, h('p', { class: 'small muted' }, '輸入註冊用的 Email 或手機，我們會寄驗證碼給你，再設定新的密碼。'), ui.field('帳號', account), step2, err),
      footer: go,
    });
  }
  // an account that hasn't proved its Email / phone yet (made before codes existed)
  const needVerify = (u) => !!(u && u.verified === false && canVerify(cfgNow, u.provider));
  function verifySheet(reason = '') {
    const u = store.state.auth && store.state.auth.user;
    if (!u) return;
    const what = u.provider === 'phone' ? '手機' : 'Email';
    const err = h('p', { class: 'login-err', hidden: true, role: 'alert' });
    const codeUI = codeField(() => send(true));
    const step2 = h('div', { class: 'login-step2', hidden: true }, ui.field('驗證碼', codeUI.el));
    const go = h('button', { class: 'btn btn-primary btn-block verify-go' }, `寄驗證碼到我的${what}`);
    let stage = 1;
    async function send(again) {
      const r = await call('POST', 'auth/verify/send', {});
      if (r.already) { sh.close(); ui.toast('已經驗證過了'); refreshMe(); return; }
      stage = 2; step2.hidden = false; go.textContent = '確認驗證碼';
      codeUI.hint.textContent = `已寄出 6 位數驗證碼到 ${u.accountHint}（10 分鐘內有效）${r.devCode ? `（測試環境：${r.devCode}）` : ''}`;
      codeUI.cool(60);
      if (again) ui.toast('已重新寄送驗證碼'); else codeUI.input.focus();
    }
    go.onclick = async () => {
      err.hidden = true; go.disabled = true;
      try {
        if (stage === 1) { await send(false); go.disabled = false; return; }
        const r = await call('POST', 'auth/verify', { code: codeUI.input.value });
        store.update((s) => { if (s.auth) s.auth.user = r.user; });
        sh.close();
        ui.toast('驗證好了');
        if (App.gift) App.gift.sync(r.user); // a welcome gift that was waiting for this
      } catch (e) { err.textContent = errText(e); err.hidden = false; go.disabled = false; }
    };
    const sh = ui.sheet({
      title: `驗證你的${what}`,
      body: h('div', { class: 'stack-sm' },
        reason ? h('p', { class: 'small bold' }, reason) : null,
        h('p', { class: 'small muted' }, `確認 ${u.accountHint} 是你本人的：帳號比較安全，也才能領邀請禮、參加團購。`),
        step2, err),
      footer: go,
    });
  }

  let mode = 'login'; // 登入／註冊 toggle on the login page
  // after logging in: where she was heading (App.afterLogin, e.g. a friend's group-buy team), else 首頁 or setup
  const goOn = () => {
    const next = App.afterLogin && App.afterLogin();
    if (next) App.navigate(next.id, next.params); else App.navigate(store.state.onboarded ? 'home' : 'onboarding');
  };
  const ERR = {
    bad_account: '請輸入正確的 Email 或手機號碼（09 開頭 10 碼）',
    weak_password: '密碼至少 8 個字',
    common_password: '這個密碼太常見，很容易被猜到，請換一個（例如加上幾個字或符號）',
    bad_request: '送出的資料有問題，請重新整理後再試',
    exists: '這個帳號已經註冊過了，請直接登入',
    invalid: '帳號或密碼不正確',
    too_many: '嘗試太多次了，請 10 分鐘後再試',
    offline: '目前連不到會員服務，請稍後再試',
    state: 'LINE 登入逾時，請再試一次',
    denied: '你取消了 LINE 登入',
    line_error: 'LINE 登入失敗，請再試一次',
    line_disabled: '尚未開放 LINE 登入',
    not_configured: '會員服務尚未開放',
    need_code: '請輸入寄給你的 6 位數驗證碼',
    bad_code: '驗證碼不正確，請再看一次',
    code_expired: '驗證碼已過期，請按「重新寄送」',
    code_too_many: '錯太多次了，請按「重新寄送」拿新的驗證碼',
    wait: '剛寄過驗證碼，請等 1 分鐘再重新寄送',
    send_failed: '驗證碼寄不出去，請確認 Email／手機是否正確，稍後再試',
    need_verify: '請先驗證你的 Email／手機',
    verify_off: '目前無法寄送驗證碼',
    need_consent: '請先勾選「我已閱讀並同意隱私權政策與使用條款」才能註冊',
    policy_changed: '隱私權政策剛更新，請重新整理頁面後再看一次並同意',
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
      // LINE callback lands here with a token or an error. Only accept it if it carries the nonce this
      // browser created when it started the LINE login (otherwise someone could plant their own session).
      const expectNonce = (() => { try { return sessionStorage.getItem('mom-line-nonce') || ''; } catch (e) { return ''; } })();
      if (params && (params.token || params.error)) {
        try { sessionStorage.removeItem('mom-line-nonce'); } catch (e) { /* ignore */ }
        history.replaceState(history.state, '', `${location.pathname}${location.search}#/login`); // keep the token out of history
      }
      if (params && params.token && (!expectNonce || params.nonce !== expectNonce)) {
        box.append(ui.card({ class: 'soft' }, h('div', { class: 'card-title' }, '這個登入連結無法使用'),
          h('p', { class: 'small muted' }, '為了保護你的帳號，只接受從這支手機發起的 LINE 登入。請重新按「用 LINE 登入」。')));
        params = {};
      }
      if (params && params.token) {
        box.append(h('p', { class: 'center muted' }, '登入中…'));
        store.update((s) => { s.auth = { token: params.token, user: null }; });
        call('GET', 'me').then(({ user }) => {
          setAuth(params.token, user);
          ui.toast(`歡迎，${user.nickname}`);
          goOn();
          setTimeout(() => ensureConsent(user), 300); // a new LINE account agrees before anything else
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
              h('p', { class: 'small muted' }, '可能是網路不穩，或登入服務暫時無法使用。你仍然可以不登入，使用 App 的全部紀錄功能。'),
              h('button', { class: 'btn btn-primary btn-block mt', onclick: () => App.navigate(store.state.onboarded ? 'home' : 'onboarding') }, '先不登入，直接使用')));
            return;
          }
          if (!cfg.providers.password && !cfg.providers.line) {
            holder.append(ui.card({ class: 'soft' }, h('div', { class: 'card-title' }, '會員服務即將開放'),
              h('p', { class: 'small muted' }, '目前還不能登入，你仍然可以直接使用 App 的全部紀錄功能。'),
              h('button', { class: 'btn btn-primary btn-block mt', onclick: () => App.navigate(store.state.onboarded ? 'home' : 'onboarding') }, '直接使用')));
            return;
          }
          const share = store.state.share || {};
          const giftPts = App.gift ? App.gift.PTS() : null;
          // 雙向邀請禮: someone who came with a link sees what joining brings to both
          if (mode === 'register' && giftPts && share.invitedBy) {
            holder.append(h('p', { class: 'login-gift' }, `🎁 註冊後你會拿到 ${giftPts.friend} 點見面禮，${share.inviterName ? `「${share.inviterName}」` : '邀請你的朋友'}也會收到邀請禮`));
          }
          if (cfg.providers.line) {
            holder.append(h('button', {
              class: 'btn btn-block login-line', html: `${ui.ICONS.line}<span>用 LINE 登入</span>`,
              onclick: () => {
                const nonce = Array.from(crypto.getRandomValues(new Uint8Array(18)), (x) => x.toString(16).padStart(2, '0')).join('');
                try { sessionStorage.setItem('mom-line-nonce', nonce); } catch (e) { /* ignore */ }
                location.href = `${base}auth/line/start?nonce=${nonce}&ref=${encodeURIComponent(share.invitedBy || '')}`;
              },
            }), h('div', { class: 'login-or' }, h('span', null, '或用 Email／手機')));
          }
          const acct = h('input', { type: 'text', inputmode: 'email', autocomplete: 'username', placeholder: 'Email 或手機（09xxxxxxxx）', class: 'input', 'aria-label': 'Email 或手機' });
          const pw = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: mode === 'login' ? '密碼' : '設定密碼（至少 8 個字）', class: 'input', 'aria-label': '密碼' });
          const showPw = h('button', { type: 'button', class: 'link-btn small login-show', onclick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; showPw.textContent = pw.type === 'password' ? '顯示' : '隱藏'; } }, '顯示');
          const nick = h('input', { type: 'text', value: store.state.profile.momName || '', placeholder: '暱稱（例如：小美）', class: 'input', maxlength: 20, 'aria-label': '暱稱' });
          const inv = h('input', { type: 'text', value: share.invitedBy || '', placeholder: '邀請碼（選填）', class: 'input', maxlength: 12, 'aria-label': '邀請碼' });
          const err = h('p', { class: 'login-err', hidden: true });
          const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, mode === 'login' ? '登入' : '註冊並登入');
          // 驗證碼: first a code to the Email / phone, then the account (only when the server can send one)
          let sent = null; // the address a sign-up code went to
          const codeUI = codeField(() => sendSignupCode(true));
          const codeWrap = h('div', { class: 'login-code-wrap', hidden: true }, ui.field('驗證碼', codeUI.el));
          // 步驟條: 填寫資料 → 輸入驗證碼 → 完成註冊, while the kind of account she types gets a code
          const SIGN_STEPS = ['填寫資料', '輸入驗證碼', '完成註冊'];
          const stepsBox = mode === 'register' && (canVerify(cfg, 'email') || canVerify(cfg, 'phone')) ? h('div', { class: 'login-steps' }, ui.steps(SIGN_STEPS, 0)) : null;
          const showSteps = () => { if (stepsBox) stepsBox.hidden = !!acct.value.trim() && !canVerify(cfg, kindOf(acct.value.trim())); };
          acct.addEventListener('input', () => {
            if (sent && acct.value.trim() !== sent) { sent = null; codeWrap.hidden = true; submit.textContent = '註冊並登入'; if (stepsBox) stepsBox.replaceChildren(ui.steps(SIGN_STEPS, 0)); }
            showSteps();
          });
          async function sendSignupCode(again) {
            const r = await call('POST', 'auth/code', { account: acct.value, purpose: 'register', consent: App.privacy ? App.privacy.VERSION : '' });
            sent = acct.value.trim();
            codeWrap.hidden = false;
            if (stepsBox && !stepsBox.querySelector('li.now:nth-child(2)')) stepsBox.replaceChildren(ui.steps(SIGN_STEPS, 1));
            codeUI.hint.textContent = `已寄出 6 位數驗證碼到 ${mask(acct.value)}，10 分鐘內有效${r.devCode ? `（測試環境：${r.devCode}）` : ''}`;
            codeUI.cool(60);
            submit.textContent = '確認驗證碼並註冊';
            if (again) ui.toast('已重新寄送驗證碼'); else codeUI.input.focus();
          }
          const forgot = mode === 'login' && (canVerify(cfg, 'email') || canVerify(cfg, 'phone'))
            ? h('button', { type: 'button', class: 'link-btn small login-forgot', onclick: () => forgotSheet(acct.value) }, '忘記密碼？') : null;
          // 註冊: an unticked box for the policy (required) and a separate one for marketing (optional)
          const agree = mode === 'register' && App.privacy ? App.privacy.box() : null;
          const mkt = mode === 'register' && App.privacy ? App.privacy.box({ label: MKT_LABEL(), required: false }) : null;
          const form = h('form', { class: 'login-form', novalidate: true },
            ui.seg([{ value: 'login', label: '登入' }, { value: 'register', label: '註冊' }], mode, (v) => { mode = v; App.refresh(); }),
            stepsBox,
            ui.field('帳號', acct),
            ui.field('密碼', h('div', { class: 'login-pw' }, pw, showPw)),
            forgot,
            mode === 'register' ? ui.field('暱稱', nick) : null,
            mode === 'register' ? ui.field('邀請碼', inv, share.inviterName ? `由「${share.inviterName}」邀請` : '朋友給你的邀請碼（選填）：填了你們都有邀請禮') : null,
            agree ? h('div', { class: 'pv-boxes' }, agree.el, mkt.el) : null,
            codeWrap,
            err, submit);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            err.hidden = true;
            if (agree && !agree.need('請先勾選「我已閱讀並同意隱私權政策與使用條款」才能註冊')) return;
            const label = submit.textContent;
            submit.disabled = true; submit.textContent = '處理中…';
            // 註冊 where the server can send a code: send it first (the account is made with the code)
            if (mode === 'register' && canVerify(cfg, kindOf(acct.value)) && !sent) {
              try {
                if (pw.value.length < 8) throw Object.assign(new Error('weak'), { code: 'weak_password' });
                await sendSignupCode(false);
              } catch (ex) { err.textContent = errText(ex); err.hidden = false; submit.textContent = label; }
              submit.disabled = false;
              return;
            }
            try {
              const body = mode === 'login'
                ? { account: acct.value, password: pw.value }
                : {
                  account: acct.value, password: pw.value, nickname: nick.value, invitedBy: inv.value, consent: App.privacy ? App.privacy.VERSION : '', marketing: !!(mkt && mkt.checked), ...(sent ? { code: codeUI.input.value } : {}),
                };
              const res = await call('POST', mode === 'login' ? 'auth/login' : 'auth/register', body);
              if (mode !== 'login' && App.starter) App.starter.hush(); // the welcome list shows 註冊會員 ✓
              setAuth(res.token, res.user);
              ui.toast(mode === 'login' ? `歡迎回來，${res.user.nickname}` : `註冊好了，歡迎 ${res.user.nickname}`);
              const joined = mode !== 'login';
              mode = 'login';
              goOn();
              if (joined && App.starter) setTimeout(() => App.starter.welcome(res.user), 700); // 新手任務 as the welcome
              setTimeout(() => ensureConsent(res.user), 300); // agreed to an older policy: ask again
            } catch (ex) {
              err.textContent = errText(ex); err.hidden = false;
              submit.disabled = false; submit.textContent = label;
            }
          });
          holder.append(form,
            h('button', { class: 'btn btn-ghost btn-block mt', onclick: () => App.navigate(store.state.onboarded ? 'home' : 'onboarding') }, '先不登入，直接使用'),
            h('p', { class: 'tiny muted center mt' }, '登入只用來辨識帳號、寄驗證碼、計算邀請人數、團購與社群功能；你的懷孕、寶寶紀錄仍只存在這支手機，不會上傳。'),
            App.privacy ? h('p', { class: 'center pv-standalone' }, App.privacy.link()) : null);
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
          h('div', { class: 'row gap acct-row' },
            h('div', { class: 'grow' },
              h('div', { class: 'card-title' }, `${u.nickname}`, h('span', { class: 'tag primary' }, { line: 'LINE', email: 'Email', phone: '手機' }[u.provider] || '')),
              h('div', { class: 'small muted' }, `${u.accountHint}・邀請碼 ${u.code}`),
              h('div', { class: 'small' }, `已成功邀請 ${u.referrals || 0} 位加入`),
              needVerify(u) ? h('div', { class: 'acct-verify' },
                h('span', { class: 'small grow' }, `${u.provider === 'phone' ? '手機' : 'Email'}還沒驗證：驗證後才能領邀請禮、參加團購`),
                h('button', { class: 'btn btn-sm btn-primary acct-verify-go', onclick: () => verifySheet() }, '驗證')) : null),
            h('div', { class: 'stack-sm' },
              h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { logout(); App.refresh(); } }, '登出'),
              h('button', {
                class: 'btn btn-sm btn-ghost acct-all',
                onclick: async () => {
                  if (!(await ui.confirm('登出所有登入這個帳號的裝置？（手機上的紀錄不會刪除）', { ok: '全部登出' }))) return;
                  try { await call('POST', 'auth/logout-all'); } catch (e) { /* still log out here */ }
                  logout(); App.refresh();
                },
              }, '登出所有裝置'))),
          // 個資：行銷訊息（可隨時關閉）、隱私權政策、下載我的資料、刪除帳號
          h('label', { class: 'check-row acct-mkt' },
            h('input', {
              type: 'checkbox', class: 'switch', checked: !!u.marketing, 'aria-label': '接收優惠與活動訊息',
              onchange: async (e) => {
                const on = e.target.checked; e.target.disabled = true;
                try { const r = await call('POST', 'me', { marketing: on }); store.update((s) => { if (s.auth) s.auth.user = r.user; }); ui.toast(on ? '已開啟優惠與活動訊息' : '已關閉，不會再寄送優惠與活動訊息'); } catch (er) { e.target.checked = !on; ui.toast(errText(er)); }
                e.target.disabled = false;
              },
            }),
            h('span', null, h('b', null, '接收優惠與活動訊息'), h('br'), h('span', { class: 'tiny muted' }, '可隨時關閉，關閉後立即停止寄送'))),
          h('div', { class: 'acct-links' },
            App.privacy ? App.privacy.link('隱私權政策') : null,
            h('button', { class: 'link-btn small', onclick: () => editNickname(u) }, '修改暱稱'),
            h('button', { class: 'link-btn small', onclick: exportMine }, '下載我的會員資料'),
            h('button', { class: 'link-btn small danger-text', onclick: () => deleteAccount(u) }, '刪除帳號')));
      }
      return ui.card({ class: 'acct-card soft' },
        h('div', { class: 'row gap' },
          h('div', { class: 'grow' }, h('div', { class: 'card-title' }, '登入／註冊'), h('div', { class: 'small muted' }, '用 Email、手機或 LINE 登入・邀請好友的人數會記在你的帳號')),
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => App.navigate('login') }, '登入')),
        App.livePill('acct-live'));
    },
    logout, refreshMe, refreshSoon: () => maybeRefresh(), call, available: async () => !!(await config()), noService: () => cfgWhy === 'none', ensureConsent, exportMine,
    config,
    verifySheet,
    needVerify,
    // 登入／註冊 page opened on 註冊 (the 見面禮 card)
    openRegister() { mode = 'register'; if (document.body.dataset.screen === 'login') App.refresh(); else App.navigate('login'); },
  };
}());
