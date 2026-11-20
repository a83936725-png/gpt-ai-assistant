/* 雙向邀請禮：朋友用你的邀請連結（或邀請碼）加入、完成設定並註冊會員時，兩個人都拿到好孕點數。
 *   朋友：見面禮 BRAND.inviteGift.friend（預設 30 點），每個帳號一次，註冊後 14 天內
 *   邀請人：邀請禮 BRAND.inviteGift.inviter（預設 50 點），每一位加入的朋友一次
 * 誰符合由伺服器決定（POST /invite/claim：帳號是新的、同意了目前的隱私權政策、每個帳號一次，邀請人此時才計入）；
 * 點數記在各自的手機。邀請人只看得到人數，看不到朋友是誰。只算直接邀請的朋友（一層），朋友的朋友不算。
 *   App.gift.sync(user)   登入、回到 App、同意政策、完成設定後：領見面禮、把新加入的朋友換成邀請禮
 *   App.gift.claim(code)  沒用連結加入：輸入朋友的邀請碼領取
 *   App.gift.section()    「邀請好友」頁的雙向邀請禮卡片
 *   首頁 'gift'            被邀請、還沒領見面禮時（連不到會員服務就不出現）：育兒中是寶寶卡下面的一行（App.gift.line），
 *                         懷孕／備孕是最上面的卡片 */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const B = () => window.BRAND || {};
  const PTS = () => ({ friend: 30, inviter: 50, ...(B().inviteGift || {}) });
  const WINDOW_DAYS = 14; // the server's CLAIM_DAYS
  const enc = encodeURIComponent;

  const ensure = (s) => {
    s.share = s.share || {};
    const g = s.share.gift || {};
    s.share.gift = g;
    g.credited = g.credited || {}; // account id → how many of its friends this phone has already turned into points
    g.log = g.log || []; // [{at, n, pts}] invite gifts received on this phone, newest first
    return g;
  };
  const user = () => (store.state.auth && store.state.auth.user) || null;
  const sh = () => store.state.share || {};
  const nameOf = () => sh().inviterName || '';
  const who = () => (nameOf() ? `「${nameOf()}」` : '朋友'); // 「小美」 in a sentence
  const consentOk = (u) => !App.privacy || u.consent === App.privacy.VERSION;

  /* ---- is the member service there? (a static copy of the app has none: then nothing here shows) ---- */
  let apiOk = null;
  function checkApi() {
    if (!App.account || !App.account.config) return;
    App.account.config().then((cfg) => {
      const ok = !!(cfg && cfg.providers && (cfg.providers.password || cfg.providers.line));
      if (ok === apiOk) return;
      apiOk = ok;
      document.querySelectorAll('.needs-member').forEach((e) => { e.hidden = !ok; });
      if (App.homeRefresh) App.homeRefresh();
      if (document.body.dataset.screen === 'invite') App.refresh();
    });
  }
  setTimeout(checkApi, 300);
  // while 邀請好友 is open, a friend who joins shows up within seconds (refreshSoon waits 10 s between checks)
  setInterval(() => { if (document.body.dataset.screen === 'invite' && document.visibilityState === 'visible' && App.account) App.account.refreshSoon(); }, 15000);

  /* ---- 邀請人：friends counted by the server since this phone last looked ---- */
  function creditInviter(u) {
    const refs = Number(u.referrals) || 0;
    const g = ensure(store.state);
    const seen = g.credited[u.id];
    // the first time this phone sees this account, nothing is new (friends from before were thanked on the phone
    // that was logged in then); quietly remember the count
    if (seen === undefined || refs < seen) { g.credited[u.id] = refs; store.save(); return; }
    if (refs === seen) return;
    const n = refs - seen; const pts = n * PTS().inviter;
    store.update((s) => {
      const x = ensure(s);
      x.credited[u.id] = refs;
      x.log.unshift({ at: new Date().toISOString(), n, pts });
      x.log = x.log.slice(0, 20);
    });
    App.share.bonus(pts, 'invite-gift');
    ui.celebrate({ emojis: ['🎉', '💌', '💜', '✨'] });
    ui.toast(`🎉 有 ${n} 位朋友接受你的邀請！邀請禮 +${pts} 好孕點數`, { action: '看看', onAction: () => App.navigate('invite'), ms: 6000 });
  }

  /* ---- 朋友：the welcome gift ---- */
  // the code to claim with: the server already knows hers (joined with a link) → none needed; otherwise the link's
  // code kept on this phone, unless that one was already tried and refused
  function linkCode(u) {
    if (u && u.invite && u.invite.by) return '';
    const g = ensure(store.state);
    const c = sh().invitedBy || '';
    return c && !(g.failed && g.failed.code === c) ? c : '';
  }
  const canAutoClaim = (u) => !!(u && u.invite && u.invite.open && consentOk(u) && store.state.onboarded && (u.invite.by || linkCode(u))
    && !(App.account && App.account.needVerify && App.account.needVerify(u))); // an older account verifies first

  function whenFree(fn, tries = 0) { // after any sheet that is open (the consent sheet, say) has closed
    if (!document.body.classList.contains('has-sheet') || tries > 120) { fn(); return; }
    setTimeout(() => whenFree(fn, tries + 1), 500);
  }
  function thank(counted) {
    const text = `我加入「${B().appName || '易家做媽媽'}」了，謝謝你的邀請 💜${counted ? '我們都拿到邀請禮了！' : ''}`;
    window.open(`https://line.me/R/share?text=${enc(text)}`, '_blank', 'noopener');
  }
  function celebrateFriend(r, pts, unlocked) {
    whenFree(() => {
      ui.celebrate({ emojis: ['🎁', '💜', '🎉', '✨'], big: true });
      const total = (sh().points) || 0;
      const sheet = ui.sheet({
        title: `🎁 見面禮 +${pts} 好孕點數`,
        body: h('div', { class: 'gift-sheet' },
          h('p', null, `謝謝你接受${who()}的邀請，歡迎一起做媽媽 💜`),
          r.counted ? h('p', { class: 'small muted' }, `${who()}也收到了 ${PTS().inviter} 點邀請禮。`) : null,
          unlocked ? h('p', { class: 'gift-unlock' }, `${unlocked.icon} 解鎖「${unlocked.title}」`) : null,
          h('p', { class: 'small muted' }, `你現在有 ${total} 點好孕點數，在「我的 → 邀請好友」看還能解鎖什麼。`),
          h('button', { class: 'btn btn-line btn-block gift-thanks', onclick: () => { thank(r.counted); sheet.close(); }, html: `${ui.ICONS.line}<span>跟${nameOf() || '朋友'}說聲謝謝</span>` }),
          h('button', { class: 'btn btn-ghost btn-block', onclick: () => sheet.close() }, '好')),
      });
    });
  }

  let busy = false;
  // auto (from sync) uses the link's code; a typed code comes from the invite page
  async function claim(typed) {
    const u = user();
    if (!u || busy) return { error: busy ? 'busy' : 'login' };
    const code = typed !== undefined ? String(typed).trim() : linkCode(u);
    busy = true;
    try {
      const r = await App.account.call('POST', 'invite/claim', code ? { code } : {});
      store.update((s) => { if (s.auth) s.auth.user = r.user; });
      if (r.gift) {
        const pts = PTS().friend;
        const before = sh().points || 0;
        App.share.bonus(pts, 'invite-welcome');
        store.update((s) => { const g = ensure(s); g.friendAt = new Date().toISOString(); g.friendPts = pts; g.counted = !!r.counted; delete g.failed; });
        const unlocked = (App.share.REWARDS ? App.share.REWARDS() : []).filter((x) => before < x.points && before + pts >= x.points).pop();
        celebrateFriend(r, pts, unlocked);
      }
      return r;
    } catch (e) {
      // a link's code that the server refused is not tried again on every start (the invite page offers to type one)
      if (typed === undefined && code && ['bad_code', 'own_code'].includes(e.code)) store.update((s) => { ensure(s).failed = { code, error: e.code }; });
      if (e.status === 401 && App.account) App.account.refreshMe();
      return { error: e.code || 'offline' };
    } finally { busy = false; }
  }

  function sync(u = user()) {
    if (!u || !App.share) return;
    creditInviter(u);
    if (canAutoClaim(u)) claim();
  }

  /* ---- her own invitation: 'given' | 'register' (not a member yet) | 'claim' | 'failed' (the link's code was
   * refused: she can type another) | 'closed' (more than 14 days) | null (nobody invited her) ---- */
  function mine(u = user()) {
    const s = sh(); const g = ensure(store.state);
    const inv = u && u.invite;
    if (!s.invitedBy && !(inv && inv.by)) return null;
    if (g.friendAt || (inv && inv.gift)) return 'given';
    if (!u) return s.invitedAt && C.diffDays(s.invitedAt, new Date()) > WINDOW_DAYS ? 'closed' : 'register';
    if (!inv || !inv.open) return 'closed';
    return inv.by || linkCode(u) ? 'claim' : 'failed';
  }
  // 首頁: null, or {mode: 'register' | 'claim'}
  function friendState() {
    if (apiOk !== true || !store.state.onboarded || ensure(store.state).homeOff) return null;
    const m = mine();
    return m === 'register' || m === 'claim' ? { mode: m } : null;
  }
  const ERR = {
    bad_code: '找不到這個邀請碼，請再確認一次',
    own_code: '這是你自己的邀請碼喔，請輸入朋友的邀請碼',
    no_code: '請輸入朋友的邀請碼',
    too_late: '見面禮要在註冊後 14 天內領取',
    need_consent: '請先同意隱私權政策與使用條款',
    need_verify: '請先驗證你的 Email／手機',
    too_many: '嘗試太多次了，請 10 分鐘後再試',
    login: '請先登入會員',
    busy: '處理中，請稍候',
  };
  const errText = (code) => ERR[code] || '目前連不到會員服務，請稍後再試';
  async function claimFromButton(btn, typed) {
    btn.disabled = true;
    const r = await claim(typed);
    btn.disabled = false;
    if (r && r.error === 'need_consent' && App.account.ensureConsent) App.account.ensureConsent(user());
    else if (r && r.error === 'need_verify' && App.account.verifySheet) App.account.verifySheet('領見面禮前，先驗證你的 Email／手機。');
    else if (r && r.error) ui.toast(errText(r.error));
    else if (r && r.already) ui.toast('見面禮已經領過囉');
    return r;
  }
  function go(st, btn) {
    if (st.mode === 'register') App.account.openRegister();
    else claimFromButton(btn);
  }

  const dismiss = () => { store.update((s) => { ensure(s).homeOff = C.dateKey(); }); ui.toast('見面禮隨時可以在「我的 → 邀請好友」領取'); };
  // 育兒中: the baby and the quick buttons come first on 首頁, so the gift is one line right under the baby
  function line() {
    const st = friendState();
    if (!st) return null;
    const main = h('button', { class: 'gift-line-main', onclick: () => go(st, main) },
      h('span', { class: 'gift-line-e', 'aria-hidden': 'true' }, '🎁'),
      h('span', { class: 'grow' }, h('strong', null, `${nameOf() || '朋友'}送你的見面禮`),
        h('span', { class: 'gift-line-more' }, st.mode === 'register' ? `註冊領 ${PTS().friend} 點` : `領取 ${PTS().friend} 點`)),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
    return h('div', { class: 'gift-line' }, main, h('button', { class: 'icon-btn gift-line-x', 'aria-label': '先不要', onclick: dismiss }, '✕'));
  }
  App.homeCard('gift', {
    stages: ['prep', 'preg', 'baby'],
    order: 4,
    render(el) {
      if (store.stage === 'baby' && store.baby()) return; // shown as a line under the baby instead
      const st = friendState();
      if (!st) return;
      const P = PTS();
      const btn = h('button', { class: 'btn btn-primary btn-block wk-mt-sm gift-home-go', onclick: () => go(st, btn) }, st.mode === 'register' ? '🎁 註冊會員領取' : '🎁 領取見面禮');
      el.append(ui.card({ class: 'gift-home' },
        h('div', { class: 'row gap' },
          h('span', { class: 'gift-home-ico', 'aria-hidden': 'true' }, '🎁'),
          h('div', { class: 'grow' },
            h('div', { class: 'bold' }, `${nameOf() || '朋友'}送你的見面禮`),
            h('div', { class: 'small muted' }, st.mode === 'register'
              ? [h('span', { class: 'nowrap' }, `註冊會員就能領 ${P.friend} 點`), '・', h('span', { class: 'nowrap' }, `${nameOf() || '朋友'}也會收到邀請禮`)]
              : `${P.friend} 點好孕點數，${nameOf() || '朋友'}也會收到邀請禮`)),
          h('button', { class: 'icon-btn gift-home-x', 'aria-label': '先不要', onclick: dismiss }, '✕')),
        btn));
    },
  });

  /* ---- 邀請好友 page ---- */
  function nextReward(points) {
    const list = App.share.REWARDS ? App.share.REWARDS() : [];
    return list.find((r) => points < r.points) || null;
  }
  function codeBox() {
    const inp = h('input', {
      type: 'text', class: 'input gift-code-in', maxlength: 16, autocomplete: 'off', autocapitalize: 'characters', placeholder: '朋友的邀請碼', 'aria-label': '朋友的邀請碼',
    });
    const err = h('p', { class: 'login-err gift-code-err', hidden: true, role: 'alert' });
    const btn = h('button', {
      class: 'btn btn-primary gift-code-go',
      onclick: async () => {
        err.hidden = true;
        if (!inp.value.trim()) { err.textContent = ERR.no_code; err.hidden = false; return; }
        btn.disabled = true;
        const r = await claim(inp.value);
        btn.disabled = false;
        if (r && r.error) {
          err.textContent = errText(r.error); err.hidden = false;
          if (r.error === 'need_consent' && App.account.ensureConsent) App.account.ensureConsent(user());
          if (r.error === 'need_verify' && App.account.verifySheet) App.account.verifySheet('領見面禮前，先驗證你的 Email／手機。');
        }
      },
    }, '領取');
    // folded: most people who see it are inviting, not invited
    return h('details', { class: 'gift-code' },
      h('summary', { class: 'small' }, `有朋友的邀請碼嗎？輸入領 ${PTS().friend} 點見面禮`),
      h('p', { class: 'tiny muted' }, `註冊後 ${WINDOW_DAYS} 天內輸入，你會拿到 ${PTS().friend} 點見面禮，朋友也會收到邀請禮。`),
      h('div', { class: 'row gap-sm' }, inp, btn), err);
  }
  function section() {
    if (apiOk !== true) return null; // not known yet: the page is drawn again once it is
    const P = PTS(); const u = user(); const s = sh(); const g = ensure(store.state);
    const points = s.points || 0;
    const m = mine(u);
    const kids = [
      h('div', { class: 'card-title' }, '🎁 雙向邀請禮'),
      App.livePill ? App.livePill('inv-live') : null,
      h('div', { class: 'gift-two' },
        h('div', { class: 'gift-side' }, h('span', { class: 'gift-side-e', 'aria-hidden': 'true' }, '💌'), h('b', null, `朋友 +${P.friend} 點`), h('span', { class: 'tiny muted' }, '見面禮')),
        h('div', { class: 'gift-side' }, h('span', { class: 'gift-side-e', 'aria-hidden': 'true' }, '💜'), h('b', null, `你 +${P.inviter} 點`), h('span', { class: 'tiny muted' }, '每位加入的朋友'))),
      h('p', { class: 'small' }, '朋友用你的連結或邀請碼加入，完成設定並註冊會員後，你們都會拿到好孕點數。'),
    ];
    if (u) {
      const n = u.referrals || 0;
      kids.push(h('p', { class: 'small gift-count' }, n ? `已有 ${n} 位朋友接受你的邀請` : '還沒有朋友加入：先傳給一位最常聊天的媽咪吧'));
      const got = g.log.reduce((a, x) => a + (x.pts || 0), 0);
      if (got) kids.push(h('p', { class: 'tiny muted' }, `邀請禮共 +${got} 點（記在這支手機）`));
      const nr = nextReward(points);
      if (nr) kids.push(h('p', { class: 'tiny muted' }, `再邀請 ${Math.max(1, Math.ceil((nr.points - points) / P.inviter))} 位朋友，就能解鎖「${nr.title}」`));
    } else if (m !== 'register') { // (someone invited and not signed up yet: her own gift line below says it all)
      kids.push(h('div', { class: 'row gap mt' },
        h('p', { class: 'small muted grow' }, '先登入會員再邀請：朋友加入時，邀請禮才會送到你這裡。'),
        App.screens.login ? h('button', { class: 'btn btn-sm btn-primary', onclick: () => App.navigate('login') }, '登入') : null));
    }
    // her own invitation
    if (m === 'given') {
      kids.push(h('div', { class: 'gift-mine' },
        h('div', { class: 'small' }, `🎁 見面禮已領取${g.friendPts ? `（+${g.friendPts}）` : ''}・謝謝${who()}的邀請 💜`),
        h('button', { class: 'link-btn small', onclick: () => thank(!!g.counted) }, `跟${nameOf() || '朋友'}說聲謝謝`)));
    } else if (m === 'register' || m === 'claim') {
      const btn = h('button', { class: 'btn btn-sm btn-primary gift-mine-go', onclick: () => go({ mode: m }, btn) }, m === 'claim' ? '領取' : '註冊領取');
      kids.push(h('div', { class: 'row gap gift-mine' }, h('div', { class: 'small grow' }, `🎁 ${who()}送你 ${P.friend} 點見面禮${m === 'claim' ? '' : '：註冊會員就能領'}`), btn));
    } else if (m === 'failed') {
      kids.push(h('div', { class: 'small gift-mine' }, `連結裡的邀請碼 ${s.invitedBy} 目前無法使用（邀請你的朋友可能還沒登入會員）。可以請朋友再給你一次邀請碼，在下面輸入。`));
    } else if (m === 'closed') {
      kids.push(h('div', { class: 'small gift-mine' }, `你是由${who()}邀請加入的（邀請碼 ${s.invitedBy || u.invite.by}）💜`));
    }
    // joined without the link (or the link's code didn't work): type a friend's code
    if (u && u.invite && u.invite.open && !u.invite.by && !linkCode(u) && !g.friendAt) kids.push(codeBox());
    kids.push(h('p', { class: 'tiny faint mt' }, `每位朋友只算一次，只算你直接邀請的朋友；同一個網路每天最多計入 3 位、每個邀請碼每天最多 30 位。見面禮要在註冊後 ${WINDOW_DAYS} 天內領取。點數記在這支手機，不能兌換現金。`));
    return ui.card({ class: 'mt gift-card' }, kids);
  }

  App.gift = {
    sync, claim, section, line, friendState, mine, ready: () => apiOk, PTS, ensure,
  };
}());
