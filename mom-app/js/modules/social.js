/* 易家做媽媽 — 島上的媽媽: moms who choose to, show up on the islands as their chibi and can send each other a preset
 * 👋 揮手／💜 愛心／🌸 加油／🤗 抱抱. No messages, no comments: nothing to moderate except a short display name.
 * Off by default; the mom joins in a sheet that says exactly what others will and won't see. Only the drawn chibi
 * (colours + style) is shared, never the face photo; only the island (stage, coarse); an optional name ≤ 10 chars.
 * Everything here needs the member API (/mom-app/api); without it the feature hides itself and never shows a made-up count.
 *   App.social.api()  forIsland(id)  subscribe(fn)  look(id)  mapChip(getFocus)  openResidents(id)  openSettings()  openJoin() */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const store = App.store;

  const REACT = [
    { kind: 'wave', emoji: '👋', label: '揮手', verb: '向你揮手' },
    { kind: 'heart', emoji: '💜', label: '愛心', verb: '送你一顆愛心' },
    { kind: 'cheer', emoji: '🌸', label: '加油', verb: '幫你加油' },
    { kind: 'hug', emoji: '🤗', label: '抱抱', verb: '給你一個抱抱' },
  ];
  const RK = Object.fromEntries(REACT.map((r) => [r.kind, r]));
  const SERVER_ISLANDS = ['prep', 'preg1', 'preg2', 'preg3', 'newborn', 'infant', 'crawl', 'y1', 'y2', 'y3', 'y4'];

  /* ---------------- local state ---------------- */
  const blank = () => ({
    on: false, key: '', name: '', blocked: {}, inbox: [], walls: [], wrote: {},
  });
  const soc = () => ({ ...blank(), ...(store.state.social || {}) });
  const upd = (fn) => store.update((s) => { s.social = { ...blank(), ...(s.social || {}) }; fn(s.social); });
  const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 40);
  const ensureKey = () => { if (!soc().key) upd((x) => { x.key = newKey(); }); return soc().key; };

  /* ---------------- API ---------------- */
  const call = (m, p, b) => App.account.call(m, p, b);
  let apiP = null; let apiOk = null;
  function api() {
    if (!apiP) {
      apiP = call('GET', 'config').then((c) => !!(c && c.social)).catch(() => false).then((ok) => {
        apiOk = ok; emit();
        if (ok && App.homeRefresh) App.homeRefresh();
        if (!ok && document.body.dataset.screen === 'me' && !document.body.classList.contains('has-sheet') && App.refresh) App.refresh(); // 我的 says it can't connect
        return ok;
      });
    }
    return apiP;
  }

  const islands = () => (App.island && App.island.islands) || [];
  const islOf = (id) => islands().find((i) => i.id === id);
  const islName = (id) => (islOf(id) ? islOf(id).name : '島上');
  const myIsland = () => { const i = App.island && App.island.hereIsland && App.island.hereIsland(); return i && SERVER_ISLANDS.includes(i.id) ? i.id : 'prep'; };
  const pose = () => (store.stage === 'preg' ? 'preg' : store.stage === 'baby' && store.baby && store.baby() ? 'baby' : 'plain');
  // the drawn chibi only: colours and style. A mom who uses 「照片大頭」 still appears as her drawn chibi to others.
  function publicAv() {
    const av = (App.avatar && App.avatar.current()) || (App.avatar && App.avatar.DEFAULT) || {};
    return {
      skin: av.skin, hair: av.hair, outfit: av.outfit, style: av.style, eyes: av.eyes, glasses: !!av.glasses, blush: av.blush !== false, pose: pose(),
    };
  }
  const chibi = (av, size = 60) => {
    const el = h('span', { class: 'soc-chibi', style: { width: `${size}px`, height: `${Math.round(size * 1.25)}px` }, 'aria-hidden': 'true' });
    el.innerHTML = App.avatar ? App.avatar.svg({ ...av, mode: 'draw' }, { pose: (av && av.pose) || 'plain', size }) : '';
    return el;
  };
  const who = (p) => (p && p.name) || '匿名媽咪';

  /* ---------------- live data ---------------- */
  const live = {
    people: [], counts: {}, me: null, look: null, at: 0, error: '',
  };
  const subs = new Set();
  function emit() { subs.forEach((fn) => { try { fn(); } catch (e) { /* a closed view */ } }); }
  const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };

  let busy = false; let lastBeat = 0; let lastCounts = 0; let queued = null;
  async function poll(look) {
    const st = soc();
    if (!st.on || !st.key || !(await api())) return;
    if (busy) { if (look) queued = look; return; } // the map moved to another island mid-request: ask again after it
    busy = true;
    lastBeat = Date.now(); // also when it fails: an unreachable server is tried again at the normal pace, not every tick
    const want = SERVER_ISLANDS.includes(look) ? look : (live.look || myIsland());
    try {
      const r = await call('POST', 'social/here', {
        key: st.key, island: myIsland(), av: publicAv(), name: st.name || '', look: want,
      });
      const blocked = soc().blocked || {};
      live.people = (r.people || []).filter((p) => !blocked[p.nid]);
      live.counts = r.counts || {}; live.me = r.me || null; live.look = want; live.at = Date.now(); live.error = '';
      // the server drops phone numbers, links and the like from names: show the name others actually see
      if (r.me && !r.me.hidden && typeof r.me.name === 'string' && r.me.name !== (st.name || '')) upd((x) => { x.name = r.me.name; });
      if (r.inbox && r.inbox.length) receive(r.inbox);
    } catch (e) {
      live.error = e.code || 'error';
    } finally { busy = false; }
    emit();
    if (queued) { const q = queued; queued = null; if (q !== live.look) poll(q); }
  }
  async function counts() {
    if (!(await api())) return;
    lastCounts = Date.now();
    try { live.counts = (await call('GET', 'social/counts')).counts || {}; emit(); } catch (e) { /* keep the last */ }
  }
  let lookTimer = 0;
  const isOpen = (id) => { const i = islOf(id); return !!(i && App.island.statusOf && App.island.statusOf(i).open); };
  function look(id) {
    if (!SERVER_ISLANDS.includes(id) || id === live.look || !isOpen(id)) return;
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => { if (soc().on) poll(id); }, 900);
  }
  const onMap = () => document.body.dataset.screen === 'island';
  function mapOpened(id) { api().then((ok) => { if (!ok) return; if (soc().on) poll(id); else counts(); }); }
  function tick() {
    if (document.visibilityState !== 'visible' || apiOk === false) return;
    const t = Date.now();
    if (soc().on) { if (t - lastBeat > (onMap() ? 20000 : 55000)) poll(); } else if (onMap() && t - lastCounts > 60000) counts();
  }
  setTimeout(() => { api().then((ok) => { if (ok) { if (soc().on) poll(); else if (onMap()) counts(); } }); }, 900);
  setInterval(tick, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });

  // what to show on one island: others there (people only for the island we asked about) and the anonymous count
  function forIsland(id) {
    if (!apiOk) return null;
    const meHere = soc().on && myIsland() === id && live.me;
    const total = live.counts[id] || 0;
    const others = Math.max(0, total - (meHere ? 1 : 0));
    const people = live.look === id ? live.people.filter((p) => p.island === id) : [];
    return { others: Math.max(others, people.length), people, meHere: !!meHere };
  }
  const totalOnline = () => Object.values(live.counts).reduce((a, b) => a + b, 0);

  /* ---------------- inbox ---------------- */
  function receive(items) {
    const fresh = items.filter((m) => m && RK[m.kind]).map((m) => ({ ...m, read: false }));
    if (!fresh.length) return;
    upd((x) => { x.inbox = [...fresh, ...(x.inbox || [])].slice(0, 40); });
    const m = fresh[0]; const r = RK[m.kind];
    const more = fresh.length > 1 ? `（還有 ${fresh.length - 1} 則）` : '';
    ui.haptic && ui.haptic([10, 40, 10]);
    ui.toast(`${r.emoji} ${who(m.from)}（${islName(m.from.island)}）${r.verb}${more}`, {
      ms: 5000, action: '回應', onAction: () => openResidents(m.from.island, { inbox: true }),
    });
    if (App.homeRefresh) App.homeRefresh();
  }
  const unread = () => (soc().inbox || []).filter((m) => !m.read).length;
  const markRead = () => { if (unread()) upd((x) => { x.inbox = (x.inbox || []).map((m) => ({ ...m, read: true })); }); };

  /* ---------------- actions ---------------- */
  const sent = new Map(); // `${nid}:${kind}` -> time (one of each per 30 minutes, like the server)
  const wasSent = (nid, kind) => Date.now() - (sent.get(`${nid}:${kind}`) || 0) < 30 * 60 * 1000;
  async function react(nid, kind, btn) {
    const r = RK[kind];
    if (btn) btn.disabled = true;
    try {
      let res;
      try { res = await call('POST', 'social/react', { key: soc().key, to: nid, kind }); } catch (e) {
        if (e.code !== 'not_here') throw e;
        await poll(); res = await call('POST', 'social/react', { key: soc().key, to: nid, kind }); // back on the island, then again
      }
      sent.set(`${nid}:${kind}`, Date.now());
      if (btn) { btn.classList.add('sent'); btn.setAttribute('aria-pressed', 'true'); btn.disabled = false; if (ui.burst) ui.burst(btn, r.emoji); }
      ui.toast(res && res.again ? `剛剛已經${r.label}過了` : `已送出 ${r.emoji} ${r.label}`);
    } catch (e) {
      if (btn) btn.disabled = false;
      ui.toast(e.code === 'gone' ? '對方已經離開島上了' : e.code === 'too_many' ? '送得太快了，休息一下再試' : '目前連不到，請稍後再試');
    }
  }
  async function block(p, { report = false } = {}) {
    try { await call('POST', report ? 'social/report' : 'social/block', { key: soc().key, nid: p.nid }); } catch (e) { /* still hide here */ }
    upd((x) => { x.blocked = { ...(x.blocked || {}), [p.nid]: { name: who(p), at: new Date().toISOString() } }; });
    live.people = live.people.filter((q) => q.nid !== p.nid);
    emit();
    ui.toast(report ? '已檢舉並封鎖，謝謝你讓島上更友善' : '已封鎖，不會再看到這位媽媽');
  }
  async function unblock(nid) {
    try { await call('POST', 'social/unblock', { key: soc().key, nid }); } catch (e) { /* local only then */ }
    upd((x) => { const b = { ...(x.blocked || {}) }; delete b[nid]; x.blocked = b; });
  }
  async function join(name) {
    if (!(await api())) { ui.toast('目前連不到社群服務，請連上網路後再試'); return false; }
    ensureKey();
    upd((x) => { x.on = true; x.name = (name || '').trim().slice(0, 10); x.joinedAt = x.joinedAt || new Date().toISOString(); });
    await poll(myIsland());
    if (live.error) ui.toast('已開啟，連上網路後其他媽媽就會看到你');
    else ui.toast('👭 你已經在島上了！');
    return true;
  }
  async function leave() {
    const key = soc().key;
    upd((x) => { x.on = false; });
    live.people = []; live.me = null; live.look = null; emit();
    try { if (key) await call('POST', 'social/leave', { key }); } catch (e) { /* the server forgets in 2 minutes anyway */ }
    ui.toast('已關閉，其他媽媽看不到你了');
  }

  /* ---------------- sheets ---------------- */
  const privacyList = () => h('div', { class: 'soc-privacy' },
    h('div', { class: 'soc-pv' }, h('strong', null, '其他媽媽會看到'),
      h('ul', null, h('li', null, '你的 Q 版角色（畫的版本，不會用你的照片）'), h('li', null, '你在哪一座島（例如孕中期島）'), h('li', null, '你取的名稱（可以不填）'))),
    h('div', { class: 'soc-pv no' }, h('strong', null, '不會看到'),
      h('ul', null, h('li', null, '你的照片、週數、寶寶資料'), h('li', null, '任何紀錄（都只存在你的手機）'), h('li', null, '你的帳號、電話、位置'))));

  function openJoin(after) {
    let sh = null;
    const name = h('input', {
      class: 'input', type: 'text', maxlength: 10, value: soc().name || '', placeholder: '例如：小美（可不填）', 'aria-label': '顯示名稱',
    });
    const body = h('div', { class: 'soc-join' },
      h('div', { class: 'soc-join-hero' }, chibi(publicAv(), 74),
        h('div', null, h('div', { class: 'soc-join-t' }, '和同階段的媽媽一起逛島'), h('div', { class: 'small muted' }, '看到誰也在這座島，互相揮手、送愛心、加油打氣。'))),
      privacyList(),
      h('p', { class: 'small soc-rule' }, '互動只有 👋 揮手、💜 愛心、🌸 加油、🤗 抱抱四種，不能私訊、不能留言。隨時可以封鎖、檢舉或關閉。'),
      ui.field('顯示名稱', name, '不填就顯示「匿名媽咪」；不要放電話、LINE ID'),
      App.avatar && !App.avatar.current() ? h('button', { class: 'btn btn-soft btn-block', onclick: () => { sh.close(); App.navigate('avatar'); } }, '🙂 先做我的 Q 版角色') : null);
    sh = ui.sheet({
      title: '👭 島上的媽媽',
      body,
      footer: h('div', { class: 'row gap-sm' },
        h('button', { class: 'btn btn-ghost', onclick: () => sh.close() }, '先不要'),
        h('button', {
          class: 'btn btn-primary grow',
          onclick: async (e) => {
            const btn = e.currentTarget; btn.disabled = true;
            const ok = await join(name.value);
            if (!ok) { btn.disabled = false; return; }
            sh.close(); if (after) setTimeout(after, 260);
          },
        }, '加入，一起逛島')),
    });
  }

  function personCard(p) {
    const acts = h('div', { class: 'soc-acts', role: 'group', 'aria-label': `和${who(p)}互動` },
      REACT.map((r) => {
        const done = wasSent(p.nid, r.kind);
        return h('button', {
          class: `soc-act${done ? ' sent' : ''}`, 'aria-label': `${r.label}給${who(p)}`, 'aria-pressed': done ? 'true' : 'false', title: r.label,
          onclick: (e) => react(p.nid, r.kind, e.currentTarget),
        }, h('span', { 'aria-hidden': 'true' }, r.emoji), h('span', { class: 'soc-act-l' }, r.label));
      }));
    return h('div', { class: 'soc-p', dataset: { nid: p.nid } },
      chibi(p.av, 54),
      h('div', { class: 'soc-p-main' },
        h('div', { class: 'soc-p-top' },
          h('span', { class: 'soc-p-name' }, who(p)),
          p.hearts ? h('span', { class: 'soc-p-hearts', 'aria-label': `收到 ${p.hearts} 顆愛心` }, `💜 ${p.hearts}`) : null,
          h('button', { class: 'soc-more', 'aria-label': `${who(p)}：封鎖或檢舉`, onclick: () => openMore(p) }, '⋯')),
        h('div', { class: 'soc-p-meta' }, `${(islOf(p.island) || {}).emoji || '🏝️'} ${islName(p.island)}`),
        acts));
  }
  function openMore(p) {
    let sh = null;
    sh = ui.sheet({
      title: who(p),
      body: h('div', { class: 'stack-sm' },
        h('button', { class: 'btn btn-ghost btn-block', onclick: async () => { sh.close(); if (await ui.confirm(`封鎖「${who(p)}」？封鎖後你們互相看不到，也收不到對方的互動。`, { ok: '封鎖' })) block(p); } }, '🚫 封鎖這位媽媽'),
        h('button', { class: 'btn btn-ghost btn-block', onclick: async () => { sh.close(); if (await ui.confirm(`檢舉「${who(p)}」的名稱不恰當？檢舉也會封鎖對方；多人檢舉後這個名稱會被隱藏。`, { ok: '檢舉', danger: true })) block(p, { report: true }); } }, '⚠️ 檢舉不恰當的名稱'),
        h('p', { class: 'tiny muted' }, '島上沒有私訊和留言，只有固定的四種互動。')),
    });
  }
  const ago = (t) => {
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return '剛剛'; if (m < 60) return `${m} 分鐘前`; const hh = Math.round(m / 60); if (hh < 24) return `${hh} 小時前`; return `${Math.round(hh / 24)} 天前`;
  };
  function inboxList(limit = 8) {
    const items = (soc().inbox || []).filter((m) => !(soc().blocked || {})[m.from && m.from.nid]).slice(0, limit);
    if (!items.length) return null;
    return h('div', { class: 'soc-inbox' },
      h('div', { class: 'soc-h' }, '收到的互動'),
      items.map((m) => {
        const r = RK[m.kind];
        return h('div', { class: `soc-in${m.read ? '' : ' new'}` },
          chibi(m.from.av || {}, 30),
          h('div', { class: 'grow' }, h('div', { class: 'soc-in-t' }, `${r.emoji} ${who(m.from)} ${r.verb}`), h('div', { class: 'tiny muted' }, `${islName(m.from.island)}・${ago(m.at)}`)),
          h('button', { class: 'btn btn-sm btn-soft', 'aria-label': `回 ${r.label}給${who(m.from)}`, onclick: (e) => react(m.from.nid, m.kind, e.currentTarget) }, `回 ${r.emoji}`));
      }));
  }

  function openResidents(islandId, { inbox: wantInbox = false } = {}) {
    if (apiOk === false) { ui.toast('目前連不到社群服務，請稍後再試'); return; }
    const id = SERVER_ISLANDS.includes(islandId) ? islandId : myIsland();
    if (!soc().on) { openJoin(() => openResidents(id)); return; }
    const isl = islOf(id) || { name: '島上', emoji: '🏝️' };
    const body = h('div', { class: 'soc-res' });
    const draw = () => {
      body.innerHTML = '';
      const d = forIsland(id) || { others: 0, people: [], meHere: false };
      const loading = live.look !== id;
      const me = h('div', { class: 'soc-me' },
        chibi(publicAv(), 40),
        h('div', { class: 'grow' },
          h('div', { class: 'bold' }, `我：${soc().name || '匿名媽咪'}`),
          h('div', { class: 'tiny muted' }, `${islName(myIsland())}${live.me && live.me.hearts ? `・收到 💜 ${live.me.hearts}` : ''}${live.me && live.me.hidden ? '・名稱已被隱藏' : ''}`)),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openSettings() }, '設定'));
      body.append(
        h('p', { class: 'soc-count', role: 'status' }, loading ? '看看誰在島上…' : d.others ? `現在有 ${d.others} 位媽媽在${isl.name}${d.meHere ? '，還有你' : ''}` : `${isl.name}現在還沒有其他媽媽`),
        me);
      if (!loading && d.people.length) body.append(h('div', { class: 'soc-list' }, d.people.map(personCard)));
      if (!loading && !d.people.length) {
        body.append(h('div', { class: 'soc-empty' },
          h('div', { class: 'soc-empty-e', 'aria-hidden': 'true' }, '🌊'),
          h('p', null, d.others ? '其他媽媽剛好在別處逛，等等再來看看' : '還沒有人在這座島，邀請同階段的朋友一起來吧！')));
      }
      const inb = inboxList();
      if (inb) { if (wantInbox) body.prepend(inb); else body.append(inb); }
      body.append(h('div', { class: 'row gap-sm mt' },
        h('button', { class: 'btn btn-soft grow', onclick: () => App.share && App.share.open({ title: '一起逛好孕群島', text: '我在「好孕群島」和同階段的媽媽們一起逛島、互相加油，你也一起來吧！', campaign: 'island-friends', path: 'island' }) }, '📨 邀請朋友一起逛'),
        h('button', { class: 'btn btn-ghost', onclick: () => { poll(id); } }, '重新整理')));
    };
    const off = subscribe(draw);
    draw();
    poll(id);
    markRead();
    ui.sheet({ title: `👭 ${isl.emoji} ${isl.name}的媽媽們`, body, onClose: () => { off(); markRead(); } });
  }

  function openSettings() {
    let sh = null;
    const body = h('div', { class: 'stack' });
    const draw = () => {
      body.innerHTML = '';
      const st = soc();
      if (apiOk === false) body.append(h('p', { class: 'small soc-warn' }, '目前連不到社群服務（可能是網路不穩，或這個網址還沒開放會員服務），島上的媽媽暫時看不到。'));
      if (!st.on) {
        body.append(h('p', { class: 'small muted' }, '目前沒有開啟，其他媽媽看不到你。'),
          h('button', { class: 'btn btn-primary btn-block', onclick: () => { sh.close(); openJoin(); } }, '👭 開啟島上的媽媽'));
      } else {
        const name = h('input', {
          class: 'input', type: 'text', maxlength: 10, value: st.name || '', placeholder: '不填就顯示「匿名媽咪」', 'aria-label': '顯示名稱',
        });
        ui.append(body, [
          h('div', { class: 'row gap' }, chibi(publicAv(), 52), h('div', { class: 'grow small' }, '其他媽媽看到的是畫的 Q 版角色，不會用你的照片。',
            App.avatar ? h('button', { class: 'link-btn small', onclick: () => { sh.close(); App.navigate('avatar'); } }, '換角色樣子 ›') : null)),
          ui.field('顯示名稱', h('div', { class: 'row gap-sm' }, name,
            h('button', { class: 'btn btn-soft', onclick: () => { upd((x) => { x.name = name.value.trim().slice(0, 10); }); poll(); ui.toast('已更新名稱'); } }, '儲存'))),
          live.me && live.me.hidden ? h('p', { class: 'small soc-warn' }, '你的名稱被多位媽媽檢舉，目前顯示為「匿名媽咪」。') : null,
          h('button', { class: 'btn btn-ghost btn-block', onclick: async () => { await leave(); draw(); } }, '關閉（其他媽媽看不到我）')]);
      }
      const bl = Object.entries(st.blocked || {});
      if (bl.length) {
        body.append(h('div', { class: 'soc-h' }, `已封鎖（${bl.length}）`),
          h('div', { class: 'stack-sm' }, bl.map(([nid, b]) => h('div', { class: 'row gap-sm soc-bl' },
            h('span', { class: 'grow' }, b.name || '匿名媽咪'),
            h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await unblock(nid); draw(); } }, '解除封鎖')))));
      }
      body.append(privacyList());
    };
    draw();
    if (apiOk === null) api().then(() => { if (body.isConnected) draw(); });
    sh = ui.sheet({ title: '👭 島上的媽媽・設定', body });
  }

  /* ---------------- the chip on the map ---------------- */
  function mapChip(getFocus) {
    const el = h('button', { class: 'soc-chip', hidden: true });
    const update = () => {
      if (!apiOk) { el.hidden = true; return; }
      const f = SERVER_ISLANDS.includes(getFocus()) && isOpen(getFocus()) ? getFocus() : myIsland();
      const isl = islOf(f) || { name: '' };
      const d = forIsland(f) || { others: 0, people: [] };
      const n = unread();
      el.hidden = false;
      el.innerHTML = '';
      if (!soc().on) {
        const all = totalOnline();
        el.append(h('span', { class: 'soc-chip-e', 'aria-hidden': 'true' }, '👭'), h('span', null, all ? `${all} 位媽媽在島上・一起逛` : '和其他媽媽一起逛島'));
        el.setAttribute('aria-label', all ? `現在有 ${all} 位媽媽在群島上，加入一起逛` : '加入島上的媽媽，和其他媽媽一起逛島');
      } else {
        const heads = h('span', { class: 'soc-heads', 'aria-hidden': 'true' }, d.people.slice(0, 3).map((p) => chibi(p.av, 22)));
        ui.append(el, [d.people.length ? heads : h('span', { class: 'soc-chip-e', 'aria-hidden': 'true' }, '👭'),
          h('span', null, d.others ? `${isl.name} ${d.others} 位媽媽` : `${isl.name}・邀朋友來`),
          n ? h('span', { class: 'soc-dot' }, String(n)) : null]);
        el.setAttribute('aria-label', `${isl.name}現在有 ${d.others} 位媽媽${n ? `，${n} 則新的互動` : ''}，打開看看`);
      }
    };
    el.addEventListener('click', () => openResidents(SERVER_ISLANDS.includes(getFocus()) && isOpen(getFocus()) ? getFocus() : myIsland()));
    ['pointerdown', 'touchstart'].forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
    update();
    return { el, update };
  }

  /* ---------------- 首頁: someone waved ---------------- */
  App.homeCard('social-inbox', {
    stages: ['prep', 'preg', 'baby'],
    order: 6,
    render(el) {
      const n = unread(); if (!n || !soc().on) return;
      const m = (soc().inbox || []).find((x) => !x.read); const r = RK[m.kind];
      el.append(h('button', {
        type: 'button', class: 'card soc-home', onclick: () => openResidents(m.from.island, { inbox: true }),
      }, chibi(m.from.av || {}, 40),
      h('span', { class: 'grow' }, h('strong', null, `${r.emoji} ${who(m.from)} ${r.verb}`), h('span', { class: 'small muted' }, n > 1 ? `還有 ${n - 1} 則島上的互動・點我回應` : `${islName(m.from.island)}的媽媽・點我回應`)),
      h('span', { class: 'soc-dot' }, String(n))));
    },
  });

  // 清除所有資料: also take me off the islands (the server forgets the rest in minutes)
  if (store && typeof store.reset === 'function' && !store.reset.__social) {
    const reset = store.reset;
    store.reset = function (...a) {
      const st = soc();
      const r = reset.apply(this, a);
      live.people = []; live.me = null; live.look = null;
      if (st.key) call('POST', 'social/leave', { key: st.key }).catch(() => {});
      if (st.key && st.circle && st.circle.cohort) call('POST', 'circle/leave', { key: st.key, cohort: st.circle.cohort }).catch(() => {});
      (st.walls || []).forEach((w) => { if (w.key) call('POST', `wall/${w.id}/delete`, { key: w.key }).catch(() => {}); });
      return r;
    };
    store.reset.__social = true;
    Object.keys(reset).forEach((k) => { if (k !== '__social') store.reset[k] = reset[k]; });
  }

  App.social = {
    api, isReady: () => apiOk, me: () => live.me, forIsland, subscribe, look, poll, mapOpened, mapChip, openResidents, openSettings, openJoin, unread, publicAv, chibi, soc, upd, call, REACT,
  };
}());
