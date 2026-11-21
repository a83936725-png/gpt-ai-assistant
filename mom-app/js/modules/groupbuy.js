/* 團購揪團（第一階段：App 不收款、不收地址）
 * 品牌在伺服器設定團購（mom-api/groupbuy.js，MOM_GROUPBUYS）。媽媽「開一團」拿到團的連結，傳到媽媽群組；朋友打開連結
 * 「我要跟團」；在時間內湊滿人數就成團，每位團員拿到折扣碼，到品牌官網結帳（退換貨、發票依官網規定）。
 * 人數都是伺服器算的真實會員人數；折扣碼成團前不會送到手機；團的頁面只顯示團名、人數與剩下的時間，看不到誰跟了團。
 *   screen 'groupbuy'   團購清單、開團、我的團、從連結打開的團（還沒設定好 App 的朋友也能先看）
 *   首頁卡 'groupbuy'    成團了（看折扣碼）／我的團進度／朋友揪的團／有新的團購
 *   App.groupbuy = { load, live, listItem, brandCard, pendingTeam } */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const B = () => window.BRAND || {};
  const enc = encodeURIComponent;

  const ensure = (s) => {
    s.groupbuy = s.groupbuy || {};
    const g = s.groupbuy;
    g.skip = g.skip || {}; // campaign id → day the home card was closed
    g.seen = g.seen || {}; // team id → day its code was first shown
    return g;
  };
  const user = () => (store.state.auth && store.state.auth.user) || null;
  const money = (n) => `NT$${Number(n || 0).toLocaleString('zh-TW')}`;
  const teamName = (t) => `${t.leader || '媽媽'}的團`;
  function leftShort(ms) { // for a share card's number tile: 「1天23時」「5時20分」「12分」
    const d = Math.floor(Math.max(0, ms) / C.DAY); const hh = Math.floor((Math.max(0, ms) % C.DAY) / C.HOUR); const mm = Math.max(1, Math.floor((Math.max(0, ms) % C.HOUR) / C.MIN));
    if (d) return `${d}天${hh}時`;
    return hh ? `${hh}時${mm}分` : `${mm}分`;
  }
  function left(ms) { // 「2 天 4 小時」「3 小時 20 分」「12 分鐘」
    if (ms <= 0) return '時間到了';
    const d = Math.floor(ms / C.DAY); const hh = Math.floor((ms % C.DAY) / C.HOUR); const mm = Math.max(1, Math.floor((ms % C.HOUR) / C.MIN));
    if (d) return `${d} 天${hh ? ` ${hh} 小時` : ''}`;
    if (hh) return `${hh} 小時${mm ? ` ${mm} 分` : ''}`;
    return `${mm} 分鐘`;
  }
  // countdowns on screen tick by themselves (only while one is showing)
  setInterval(() => {
    document.querySelectorAll('[data-gb-until]').forEach((e) => { e.textContent = left(Number(e.dataset.gbUntil) - Date.now()); });
  }, 30 * 1000);

  /* ---------------- data from the member service ---------------- */
  let live = null; // {at, campaigns, mine}
  let loading = null;
  const teams = new Map(); // team id → {at, team, campaign, active} or {at, gone: true}
  const call = (m, p, b) => App.account.call(m, p, b);
  function load(force = false) {
    if (!App.account) return Promise.resolve(null);
    if (!force && live && Date.now() - live.at < 60 * 1000) return Promise.resolve(live);
    if (!loading) {
      loading = (async () => {
        const before = JSON.stringify(live && { c: live.campaigns, m: live.mine });
        try {
          const cfg = await App.account.config();
          const r = cfg ? await call('GET', 'groupbuy') : null;
          live = { at: Date.now(), campaigns: (r && r.campaigns) || [], mine: (r && r.mine) || {} };
        } catch (e) { live = { at: Date.now(), campaigns: (live && live.campaigns) || [], mine: (live && live.mine) || {} }; }
        loading = null;
        // something changed: the screens that show it are drawn again
        if (JSON.stringify({ c: live.campaigns, m: live.mine }) !== before) {
          const scr = document.body.dataset.screen;
          if (scr === 'home' && App.homeRefresh) App.homeRefresh();
          else if (['groupbuy', 'me', 'brand'].includes(scr)) App.refresh();
        }
        return live;
      })();
    }
    return loading;
  }
  async function loadTeam(id, force = false) {
    const c = teams.get(id);
    if (c && !force && Date.now() - c.at < 20 * 1000) return c;
    try {
      const r = await call('GET', `groupbuy/team/${enc(id)}`);
      const v = { at: Date.now(), team: r.team, campaign: r.campaign, active: r.active };
      teams.set(id, v);
      return v;
    } catch (e) {
      const v = { at: Date.now(), gone: e.status === 404, error: e.code || 'offline' };
      teams.set(id, v);
      return v;
    }
  }
  const campaignOf = (id) => (live && live.campaigns.find((c) => c.id === id)) || null;
  const myTeam = (cid) => (live && live.mine[cid]) || null;
  // after logging in from a friend's team link, come back to that team
  const pendingTeam = () => {
    const p = ensure(store.state).pending;
    return p && p.team && Date.now() - new Date(p.at).getTime() < 3 * C.DAY ? p.team : null;
  };
  // (once: a later login goes to 首頁 as usual, where the team still has its card until she joins)
  App.afterLogin = () => {
    const t = pendingTeam(); const p = ensure(store.state).pending;
    if (!t || p.back) return null;
    p.back = true; store.save();
    return { id: 'groupbuy', params: { team: t } };
  };
  setTimeout(() => load(), 1200);

  /* ---------------- actions ---------------- */
  const ERR = {
    unauthorized: '請先登入會員',
    need_consent: '請先同意隱私權政策與使用條款',
    need_verify: '請先驗證你的 Email／手機',
    no_campaign: '這個團購已經結束了',
    in_team: '你已經在這個團購的另一團了',
    full: '這一團剛好滿了，可以自己開一團',
    closed: '這一團時間到了',
    busy: '處理中，請稍候',
    too_many: '操作太多次了，請稍後再試',
    too_many_here: '同一個網路跟這一團的人數已經到上限了',
    leader_stays: '已經有朋友跟團，開團的人不能退出',
    not_found: '找不到這一團，可能已經取消了',
  };
  const errText = (e) => ERR[e.code] || '目前連不到會員服務，請稍後再試';
  function needLogin(teamId) {
    if (teamId) store.update((s) => { ensure(s).pending = { team: teamId, at: new Date().toISOString() }; });
    if (App.account.openRegister) App.account.openRegister(); else App.navigate('login');
  }
  function startSheet(c) {
    const u = user();
    if (!u) { needLogin(null); return; }
    const name = h('input', {
      type: 'text', class: 'input', maxlength: 10, value: (u.nickname || store.state.profile.momName || '').slice(0, 10), 'aria-label': '團名',
    });
    const err = h('p', { class: 'login-err', hidden: true, role: 'alert' });
    const go = h('button', {
      class: 'btn btn-primary btn-block gb-start-go',
      onclick: async () => {
        go.disabled = true; err.hidden = true;
        try {
          const r = await call('POST', 'groupbuy/start', { campaign: c.id, name: name.value });
          sheet.close();
          await load(true);
          teams.set(r.team.id, { at: Date.now(), team: r.team, campaign: c, active: true });
          App.navigate('groupbuy', { team: r.team.id });
          setTimeout(() => invite(r.team, c), 450);
        } catch (e) {
          go.disabled = false;
          if (e.code === 'in_team' && e.status === 409) { sheet.close(); await load(true); const t = myTeam(c.id); if (t) App.navigate('groupbuy', { team: t.id }); return; }
          if (e.code === 'need_consent' && App.account.ensureConsent) { sheet.close(); App.account.ensureConsent(user()); return; }
          if (e.code === 'need_verify' && App.account.verifySheet) { sheet.close(); App.account.verifySheet('參加團購前，先驗證你的 Email／手機。'); return; }
          err.textContent = errText(e); err.hidden = false;
        }
      },
    }, '開團');
    const sheet = ui.sheet({
      title: `開一團：${c.title}`,
      body: h('div', { class: 'stack-sm' },
        ui.field('團名', name, '朋友打開連結會看到「○○的團」和人數，看不到你的帳號或電話'),
        h('p', { class: 'small muted' }, `${c.size} 人成團，開團後 ${c.hours} 小時內要湊齊；成團後每個人都拿到折扣碼，到官網結帳。`),
        err),
      footer: go,
    });
  }
  async function join(team, btn) {
    if (!user()) { needLogin(team.id); return; }
    btn.disabled = true;
    try {
      const r = await call('POST', `groupbuy/team/${enc(team.id)}/join`, {});
      store.update((s) => { delete ensure(s).pending; }); // joined: nothing left to come back to
      teams.set(team.id, { ...(teams.get(team.id) || {}), at: Date.now(), team: r.team });
      await load(true);
      if (r.done) { ui.celebrate({ emojis: ['🎉', '🛒', '💜', '✨'], big: true }); ui.toast('🎉 成團了！折扣碼在下面'); } else ui.toast(`跟團成功！還差 ${r.team.size - r.team.count} 人`);
      App.refresh();
    } catch (e) {
      btn.disabled = false;
      if (e.code === 'need_consent' && App.account.ensureConsent) { App.account.ensureConsent(user()); return; }
      if (e.code === 'need_verify' && App.account.verifySheet) { App.account.verifySheet('參加團購前，先驗證你的 Email／手機。'); return; }
      ui.toast(errText(e));
      if (['full', 'closed', 'in_team'].includes(e.code)) { teams.delete(team.id); await load(true); App.refresh(); }
    }
  }
  async function leave(team) {
    if (!(await ui.confirm(`退出「${teamName(team)}」？`, { ok: '退出' }))) return;
    try {
      await call('POST', `groupbuy/team/${enc(team.id)}/leave`, {});
      teams.delete(team.id);
      await load(true);
      ui.toast('已退出這一團');
      App.navigate('groupbuy');
    } catch (e) { ui.toast(errText(e)); }
  }
  const linkFor = (team, channel) => App.share.link({ path: 'groupbuy', params: { team: team.id }, channel, campaign: 'groupbuy' });
  function inviteText(team, c) {
    const need = Math.max(0, team.size - team.count);
    return `${teamName(team)}揪團中：${c.title}\n團購價 ${money(c.price)}${c.listPrice ? `（原價 ${money(c.listPrice)}）` : ''}・${c.size} 人成團${need ? `，還差 ${need} 人` : ''}\n湊齊後每個人都拿到折扣碼，到官網結帳 🛒`;
  }
  function invite(team, c) {
    App.share.open({
      sheetTitle: '邀請朋友跟團',
      title: `${teamName(team)}揪團中`,
      text: inviteText(team, c),
      path: 'groupbuy',
      params: { team: team.id },
      campaign: 'groupbuy',
      spec: {
        emoji: c.emoji || '🛒',
        kicker: `團購揪團・${teamName(team)}`,
        title: c.title,
        subtitle: `團購價 ${money(c.price)}${c.listPrice ? `（原價 ${money(c.listPrice)}）` : ''}`,
        stats: [{ v: `${team.count}/${team.size}`, l: '已跟團' }, { v: leftShort(team.endsAt - Date.now()), l: '剩下' }],
        lines: ['掃 QR 或點連結就能跟團', '湊齊後每個人都拿到折扣碼', '到官網結帳，App 不收款'],
        theme: 'peach',
      },
    });
  }
  function lineInvite(team, c) {
    window.open(`https://line.me/R/share?text=${enc(`${inviteText(team, c)}\n${linkFor(team, 'line')}`)}`, '_blank', 'noopener');
    App.share.record('line', 'groupbuy');
  }

  /* ---------------- pieces ---------------- */
  const priceRow = (c) => h('div', { class: 'gb-price' },
    h('span', { class: 'gb-price-now' }, h('span', { class: 'tiny' }, '團購價 '), money(c.price)),
    c.listPrice ? h('span', { class: 'gb-price-was' }, '原價 ', h('s', null, money(c.listPrice))) : null);
  const endDay = (c) => C.fmtDate(c.ends);
  function progressBlock(team) {
    const need = Math.max(0, team.size - team.count);
    return h('div', { class: 'gb-progress' },
      h('div', { class: 'row between' },
        h('b', { class: 'gb-count' }, `已 ${team.count}／${team.size} 人`),
        team.status === 'open' ? h('span', { class: 'small muted' }, '還剩 ', h('b', { dataset: { gbUntil: String(team.endsAt) } }, left(team.endsAt - Date.now()))) : null),
      ui.progress(team.count / team.size),
      team.status === 'open' ? h('div', { class: 'small muted' }, need ? `還差 ${need} 人就成團` : '人數到了') : null);
  }
  function codeBox(team, c) {
    const copy = h('button', {
      class: 'btn btn-soft gb-copy',
      onclick: async () => { const okc = await App.share.copyText(team.code); ui.toast(okc ? '已複製折扣碼' : '複製失敗，請長按折扣碼'); },
    }, '複製折扣碼');
    return h('div', { class: 'gb-code-box' },
      h('div', { class: 'small' }, '你的折扣碼'),
      h('div', { class: 'gb-code num', 'aria-label': `折扣碼 ${team.code.split('').join(' ')}` }, team.code),
      team.codeNote ? h('div', { class: 'tiny muted' }, team.codeNote) : null,
      h('div', { class: 'row gap-sm wrap mt' }, copy,
        team.shopUrl || c.shopUrl ? h('a', { class: 'btn btn-primary grow gb-shop', href: team.shopUrl || c.shopUrl, target: '_blank', rel: 'noopener' }, '到官網結帳') : null),
      h('p', { class: 'tiny muted' }, '結帳、出貨、退換貨與發票都在官網，依官網規定。'));
  }
  const fine = () => h('p', { class: 'disclaimer' }, '團購在品牌官網結帳：App 不收款、不收地址。人數是真實的會員人數；團的頁面只顯示團名、人數和剩下的時間。折扣碼只給成團的團員，使用規則以官網為準。');
  const demoTag = (c) => (c.demo ? h('span', { class: 'tag warn' }, '測試環境') : null);

  /* ---------------- screen ---------------- */
  function renderList(el) {
    el.append(ui.card({ class: 'card-hero gb-hero' },
      h('div', { class: 'small muted' }, '一起買比較划算'),
      h('div', { class: 'big-num' }, '團購揪團'),
      h('p', { class: 'small' }, '開一團、把連結傳到媽媽群組，湊滿人數就成團，每個人都拿到折扣碼，到官網結帳。')));
    if (!live) { el.append(h('p', { class: 'center muted mt', role: 'status' }, '載入中…')); load(); return; }
    if (!live.campaigns.length) {
      el.append(ui.empty('🛒', '目前沒有進行中的團購。有新的團購時，會出現在這裡和首頁。'));
      el.append(fine());
      return;
    }
    live.campaigns.forEach((c) => {
      const mine = myTeam(c.id);
      el.append(ui.card({ class: 'gb-card' },
        h('div', { class: 'row gap gb-card-top' },
          c.image ? h('img', { class: 'gb-img', src: c.image, alt: '', loading: 'lazy' }) : h('span', { class: 'gb-emoji', 'aria-hidden': 'true' }, c.emoji || '🛒'),
          h('div', { class: 'grow' }, h('div', { class: 'card-title' }, c.title, demoTag(c)), c.desc ? h('div', { class: 'small muted' }, c.desc) : null)),
        priceRow(c),
        h('div', { class: 'small muted gb-meta' }, `${c.size} 人成團・開團後 ${c.hours} 小時內湊齊・活動到 ${endDay(c)}`),
        mine ? h('button', { class: 'gb-mine', onclick: () => App.navigate('groupbuy', { team: mine.id }) },
          h('span', { class: 'grow' }, h('b', null, mine.status === 'done' ? '🎉 你的團成團了' : `${teamName(mine)}・已 ${mine.count}／${mine.size} 人`),
            h('span', { class: 'small muted' }, mine.status === 'done' ? '看折扣碼' : '邀請朋友跟團')),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))
          : h('button', { class: 'btn btn-primary btn-block gb-start', onclick: () => startSheet(c) }, user() ? '🛒 開一團' : '🛒 登入後開一團')));
    });
    el.append(howTo(), fine());
  }
  const howTo = () => ui.card({ class: 'soft gb-how' },
    h('div', { class: 'card-title' }, '怎麼揪團'),
    h('ol', { class: 'gb-steps small' },
      h('li', null, '開一團，或打開朋友傳來的團的連結「我要跟團」'),
      h('li', null, '把團的連結傳到 LINE 媽媽群組'),
      h('li', null, '時間內湊滿人數就成團，每個人都拿到折扣碼'),
      h('li', null, '到品牌官網結帳時輸入折扣碼')));

  let viewing = null; // the team on screen
  let navSeen = -1; // App._navCount when it was drawn: a new visit (not a redraw) always asks the server again
  // the page is drawn again only when something changed, so asking never loops
  function refreshTeam(id) {
    const before = JSON.stringify((teams.get(id) || {}).team || null);
    return loadTeam(id, true).then((v) => {
      if (viewing === id && document.body.dataset.screen === 'groupbuy' && JSON.stringify(v.team || null) !== before) App.refresh();
    });
  }
  // while a team is open on screen, friends joining show up by themselves
  setInterval(() => { if (viewing && document.body.dataset.screen === 'groupbuy' && document.visibilityState === 'visible') refreshTeam(viewing); }, 15 * 1000);
  function renderTeam(el, id) {
    viewing = id;
    const cached = teams.get(id);
    const arrived = App._navCount !== navSeen;
    navSeen = App._navCount;
    if (!cached || arrived || Date.now() - cached.at > 15 * 1000) {
      if (!cached) el.append(h('p', { class: 'center muted mt-lg', role: 'status' }, '載入這一團…'));
      refreshTeam(id);
      if (!cached) return;
    }
    if (cached.gone || cached.error) {
      el.append(ui.empty('🛒', cached.gone ? '找不到這一團，可能已經取消了。' : '目前連不到會員服務，請稍後再試。',
        h('button', { class: 'btn btn-primary', onclick: () => App.navigate('groupbuy') }, '看看其他團購')));
      return;
    }
    const { team, campaign: c } = cached;
    const u = user();
    const mine = myTeam(c.id);
    // remembered quietly (no redraw in the middle of drawing): the team to come back to after logging in, and that
    // this team's code has been seen (the 首頁 card then stops pointing at it)
    const g = ensure(store.state);
    if (!u && team.status === 'open' && (!g.pending || g.pending.team !== id)) { g.pending = { team: id, at: new Date().toISOString() }; store.save(); }
    if (team.status === 'done' && team.member && !g.seen[team.id]) { g.seen[team.id] = C.dateKey(); store.save(); }
    const head = ui.card({ class: 'gb-team' },
      h('div', { class: 'row gap gb-card-top' },
        h('span', { class: 'gb-emoji', 'aria-hidden': 'true' }, team.status === 'done' ? '🎉' : (c.emoji || '🛒')),
        h('div', { class: 'grow' }, h('div', { class: 'small muted' }, teamName(team), demoTag(c)), h('div', { class: 'card-title' }, c.title))),
      priceRow(c),
      progressBlock(team));
    el.append(head);
    const actions = h('div', { class: 'gb-actions' });
    if (team.status === 'done') {
      if (team.member && team.code) actions.append(h('p', { class: 'gb-done' }, '🎉 成團了！謝謝大家'), codeBox(team, c));
      else actions.append(h('p', { class: 'gb-done' }, '這一團已經成團了 🎉'), cached.active && !mine ? h('button', { class: 'btn btn-primary btn-block', onclick: () => startSheet(c) }, '🛒 自己開一團') : null);
    } else if (team.status === 'failed') {
      actions.append(h('p', { class: 'small' }, '時間到了，這一團沒有湊齊人數，不會有折扣碼。'),
        cached.active && !mine ? h('button', { class: 'btn btn-primary btn-block', onclick: () => startSheet(c) }, '🛒 再開一團') : null);
    } else if (team.member) {
      actions.append(
        h('button', { class: 'btn btn-line btn-block gb-line', onclick: () => lineInvite(team, c), html: `${ui.ICONS.line}<span>邀請朋友跟團</span>` }),
        h('button', { class: 'btn btn-soft btn-block gb-more', onclick: () => invite(team, c) }, '📤 其他方式（分享卡、IG…）'),
        !team.mine || team.count <= 1 ? h('button', { class: 'link-btn small gb-leave', onclick: () => leave(team) }, team.mine ? '取消這一團' : '退出這一團') : null);
    } else if (mine && mine.id !== team.id) {
      actions.append(h('p', { class: 'small' }, `你已經在「${teamName(mine)}」了（每個團購只能跟一團）。`),
        h('button', { class: 'btn btn-soft btn-block', onclick: () => App.navigate('groupbuy', { team: mine.id }) }, '看我的團'));
    } else if (!cached.active) {
      actions.append(h('p', { class: 'small' }, '這個團購已經結束了。'));
    } else {
      const btn = h('button', { class: 'btn btn-primary btn-block gb-join', onclick: () => join(team, btn) }, u ? `🛒 我要跟團（還差 ${team.size - team.count} 人）` : '🛒 登入後跟團');
      actions.append(btn, h('p', { class: 'tiny muted center' }, u ? '跟團不用付款；成團後拿到折扣碼，要不要買由你決定。' : '用 Email、手機或 LINE 註冊會員就能跟團，不用付款。'));
    }
    el.append(ui.card({ class: 'gb-act-card' }, actions));
    if (!store.state.onboarded) {
      el.append(ui.card({ class: 'soft' }, h('div', { class: 'small' }, `${B().appName || '易家做媽媽'}：從備孕、懷孕到育兒的紀錄 App，全部免費。`),
        h('button', { class: 'btn btn-soft btn-block mt', onclick: () => App.navigate('onboarding') }, '開始使用 App')));
    }
    el.append(howTo(), fine());
  }

  App.screen('groupbuy', {
    title: '團購揪團',
    tab: 'me',
    render(el, params) {
      if (App.account) App.account.refreshSoon();
      if (params && params.team) renderTeam(el, String(params.team));
      else { viewing = null; renderList(el); load(); }
    },
    onLeave() { viewing = null; navSeen = -1; },
  });

  /* ---------------- 首頁 ---------------- */
  // one card, the most useful: a full team's code, my team, a friend's team from a link, a new group-buy
  function homeItem() {
    if (!live) { load(); return null; }
    const g = ensure(store.state);
    const mineList = Object.values(live.mine);
    const done = mineList.find((t) => t.status === 'done' && t.code && !g.seen[t.id]);
    if (done) return { team: done, kind: 'done' };
    const open = mineList.find((t) => t.status === 'open');
    if (open) return { team: open, kind: 'mine' };
    const p = pendingTeam();
    const pt = p && teams.get(p);
    if (pt && pt.team && pt.team.status === 'open' && !pt.team.member) return { team: pt.team, kind: 'friend', c: pt.campaign };
    if (p && !pt) loadTeam(p).then((v) => { if (v.team && App.homeRefresh) App.homeRefresh(); });
    const c = live.campaigns.find((x) => !g.skip[x.id] && !live.mine[x.id]);
    return c ? { kind: 'new', c } : null;
  }
  App.homeCard('groupbuy', {
    stages: ['prep', 'preg', 'baby'],
    order: 41,
    render(el) {
      const it = homeItem();
      if (!it) return;
      const c = it.c || campaignOf(it.team.campaign);
      if (!c) return;
      if (it.kind !== 'new') el.dataset.personal = '1'; // her team, a friend's team, 成團了: never folded away (首頁 in 坐月子)
      let title; let sub; let btnText; let go;
      if (it.kind === 'done') { title = '🎉 你的團成團了！'; sub = `${c.title}・折扣碼準備好了`; btnText = '看折扣碼'; go = () => App.navigate('groupbuy', { team: it.team.id }); }
      else if (it.kind === 'mine') {
        title = `🛒 ${teamName(it.team)}・已 ${it.team.count}／${it.team.size} 人`;
        sub = [h('span', { class: 'nowrap' }, `還差 ${it.team.size - it.team.count} 人`), '・', h('span', { class: 'nowrap' }, `剩 ${left(it.team.endsAt - Date.now())}`)];
        btnText = '邀請朋友跟團'; go = () => App.navigate('groupbuy', { team: it.team.id });
      } else if (it.kind === 'friend') {
        title = `🛒 ${teamName(it.team)}等你跟團`; sub = `${c.title}・已 ${it.team.count}／${it.team.size} 人`; btnText = '看這一團'; go = () => App.navigate('groupbuy', { team: it.team.id });
      } else {
        title = `🛒 團購：${c.title}`; sub = [h('span', { class: 'nowrap' }, `團購價 ${money(c.price)}`), '・', h('span', { class: 'nowrap' }, `${c.size} 人成團`)]; btnText = '看團購'; go = () => App.navigate('groupbuy');
      }
      el.append(ui.card({ class: 'gb-home' },
        h('div', { class: 'row gap' },
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, title, demoTag(c)), h('div', { class: 'small muted' }, sub)),
          it.kind === 'new' ? h('button', {
            class: 'icon-btn gb-home-x', 'aria-label': '這個團購先不看',
            onclick: () => { store.update((s) => { ensure(s).skip[c.id] = C.dateKey(); }); ui.toast('不會再在首頁提醒這個團購，「我的 → 團購揪團」隨時看得到'); },
          }, '✕') : null),
        h('button', { class: 'btn btn-primary btn-block wk-mt-sm gb-home-go', onclick: go }, btnText)));
    },
  });

  /* ---------------- 我的 and 品牌 ---------------- */
  function listItem() {
    if (!live) { load(); return null; }
    if (!live.campaigns.length && !Object.keys(live.mine).length) return null;
    const mineList = Object.values(live.mine);
    const sub = mineList.length ? mineList.map((t) => (t.status === 'done' ? '🎉 成團了' : `${teamName(t)} ${t.count}／${t.size} 人`)).join('・') : `${live.campaigns.length} 個團購進行中`;
    return h('a', { class: 'list-item', href: '#/groupbuy' }, h('span', { class: 'li-icon' }, '🛒'),
      h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '團購揪團'), h('div', { class: 'li-sub' }, sub)),
      h('span', { class: 'li-right', html: ui.ICONS.chevron }));
  }
  function brandCard() {
    if (!live) { load(); return null; }
    if (!live.campaigns.length) return null;
    const c = live.campaigns[0];
    return ui.card({ class: 'gb-brand' },
      h('div', { class: 'card-title' }, '🛒 團購揪團', demoTag(c)),
      h('p', { class: 'small' }, `${c.title}：團購價 ${money(c.price)}，${c.size} 人成團${live.campaigns.length > 1 ? `（還有 ${live.campaigns.length - 1} 個團購）` : ''}`),
      h('button', { class: 'btn btn-primary btn-block', onclick: () => App.navigate('groupbuy') }, '看團購'));
  }

  App.groupbuy = {
    load, live: () => live, listItem, brandCard, pendingTeam, left, homeItem,
  };
}());
