/* 易家做媽媽 — 同週好孕圈: moms with a due date in the same week (or babies born in the same month, or everyone
 * 備孕) answer one light question a week, share this week's mood and cheer each other on. Opt-in; anonymous: everyone
 * sees only totals, and a result shows once 3 moms answered. What leaves the phone: the circle (a week or a month,
 * never a date) and the answers. Needs the member API, like 島上的媽媽.
 *   screen 'circle'   home card 'circle'   App.circle.cohort() / sync() */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const store = App.store;
  const C = window.Core;

  const MOODS = [
    ['good', '😊', '還不錯'], ['tired', '😴', '好累'], ['sick', '🤢', '不舒服'],
    ['worried', '😰', '有點擔心'], ['happy', '🥰', '好幸福'], ['busy', '😵', '手忙腳亂'],
  ];
  const MOOD = Object.fromEntries(MOODS.map(([k, e, l]) => [k, { e, l }]));
  const ERR = {
    bad_cohort: '預產期或寶寶生日好像不太對，請到「我的」確認', too_many: '操作太快了，休息一下再試', not_member: '請重新加入同週好孕圈', offline: '目前連不到，請檢查網路後再試',
  };
  const errText = (e) => ERR[e && e.code] || '目前連不到，請稍後再試';

  const soc = () => (App.social ? App.social.soc() : {});
  const circ = () => soc().circle || {};
  const upd = (fn) => App.social && App.social.upd((x) => { x.circle = { ...(x.circle || {}) }; fn(x.circle, x); });
  const call = (m, p, b) => App.account.call(m, p, b);

  /* ---------- which circle ---------- */
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear(); const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    return { y, w, key: `${y}-W${String(w).padStart(2, '0')}` };
  }
  // the saved due date, or the one worked out from the last period
  const dueDate = () => { const p = store.state.profile; return p.edd || (p.lmp ? C.eddFromLmp(p.lmp) : ''); };
  function cohort() {
    if (store.stage === 'preg') {
      const edd = dueDate(); if (!edd) return null;
      return `p:${isoWeek(C.parseKey(edd)).key}`;
    }
    if (store.stage === 'baby') {
      const b = store.baby && store.baby(); if (!b || !b.birthday) return null;
      return `b:${b.birthday.slice(0, 7)}`;
    }
    return 'prep';
  }
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  function label(co = cohort()) {
    if (!co) return null;
    if (co === 'prep') return { emoji: '🌱', title: '一起備孕的媽媽', sub: '每週一題，一起準備迎接寶寶' };
    if (co.startsWith('p:')) {
      const edd = C.parseKey(dueDate());
      const mon = C.addDays(edd, -((edd.getDay() + 6) % 7));
      const ga = store.state.profile.lmp ? C.gestAge(store.state.profile.lmp) : null;
      return { emoji: '🤰', title: `預產期 ${md(mon)}–${md(C.addDays(mon, 6))} 的媽媽`, sub: ga && ga.weeks >= 0 ? `大家都差不多懷孕 ${ga.weeks} 週` : '和你同一週預產的媽媽' };
    }
    const [y, m] = co.slice(2).split('-').map(Number);
    const b = store.baby && store.baby(); const a = b && b.birthday ? C.babyAge(b.birthday) : null;
    return { emoji: '👶', title: `${y} 年 ${m} 月出生寶寶的媽媽`, sub: a ? `寶寶都差不多 ${a.months ? `${a.months} 個月` : `${a.days} 天`}大` : '和你同月出生的寶寶' };
  }

  /* ---------- data ---------- */
  const live = { data: null, at: 0, error: null, busy: false };
  const subs = new Set();
  const emit = () => subs.forEach((fn) => { try { fn(); } catch (e) { /* closed */ } });
  async function sync({ quiet = false } = {}) {
    const co = cohort(); const st = circ();
    if (!st.on || !co || !App.social || !(await App.social.api())) return null;
    if (live.busy) return live.data;
    live.busy = true;
    try {
      // moved on to another circle (birth, a new due date): leave the old one
      if (st.cohort && st.cohort !== co) {
        call('POST', 'circle/leave', { key: soc().key, cohort: st.cohort }).catch(() => {});
        if (!quiet) ui.toast(`已移到「${label(co).title}」的好孕圈`);
      }
      const r = await call('POST', 'circle/sync', { key: soc().key, cohort: co });
      if (st.cohort !== co) upd((x) => { x.cohort = co; });
      live.data = r; live.at = Date.now(); live.error = null;
    } catch (e) { live.error = e; } finally { live.busy = false; }
    emit();
    return live.data;
  }
  async function act(path, body) {
    try {
      const r = await call('POST', `circle/${path}`, { key: soc().key, cohort: cohort(), ...body });
      live.data = r; live.at = Date.now(); live.error = null; emit();
      return r;
    } catch (e) {
      if (e.code === 'old_poll' || e.code === 'not_member') { await sync({ quiet: true }); ui.toast(e.code === 'old_poll' ? '本週換新題目了，再選一次' : '已重新加入，請再試一次'); return null; }
      ui.toast(errText(e)); return null;
    }
  }
  async function join() {
    if (!App.social || !(await App.social.api())) { ui.toast('目前連不到社群服務，請連上網路後再試'); return false; }
    const co = cohort(); if (!co) return false;
    if (!soc().key) App.social.upd((x) => { x.key = Array.from(crypto.getRandomValues(new Uint8Array(24)), (v) => v.toString(36).padStart(2, '0')).join('').slice(0, 40); });
    upd((x, all) => {
      x.on = true; x.cohort = co; x.joinedAt = x.joinedAt || new Date().toISOString();
      all.consent = { ...(all.consent || {}), circle: { version: App.privacy ? App.privacy.VERSION : '', at: new Date().toISOString() } }; // she ticked 同意
    });
    await sync({ quiet: true });
    if (live.error) { upd((x) => { x.on = false; }); ui.toast(errText(live.error)); return false; }
    ui.toast('🗳️ 歡迎加入同週好孕圈！');
    return true;
  }
  async function leave() {
    const st = circ();
    upd((x) => { x.on = false; });
    live.data = null; emit();
    try { if (st.cohort) await call('POST', 'circle/leave', { key: soc().key, cohort: st.cohort }); } catch (e) { /* forgotten in 2 weeks anyway */ }
    ui.toast('已離開同週好孕圈');
  }

  /* ---------- pieces ---------- */
  const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
  const waiting = (total, need) => h('p', { class: 'small muted cc-wait' }, total ? `目前 ${total} 位回答，${need} 位以上回答就公布結果` : `還沒有人回答，${need} 位以上回答就公布結果`);
  function pollBlock(d, { compact = false } = {}) {
    const p = d.poll; const voted = p.mine !== null;
    const box = h('div', { class: `cc-poll${compact ? ' compact' : ''}` });
    box.append(h('div', { class: 'cc-q' }, p.q));
    const opts = h('div', { class: 'cc-opts', role: 'group', 'aria-label': p.q });
    p.options.forEach((o, i) => {
      const n = p.counts ? p.counts[i] : null;
      const share = n !== null ? pct(n, p.total) : null;
      const b = h('button', {
        class: `cc-opt${p.mine === i ? ' mine' : ''}${voted ? ' voted' : ''}`, 'aria-pressed': p.mine === i ? 'true' : 'false',
        'aria-label': `${o}${share !== null ? `，${share}%（${n} 位）` : ''}${p.mine === i ? '，你的選擇' : ''}`,
        onclick: async (e) => {
          const btn = e.currentTarget; btn.disabled = true;
          const r = await act('vote', { poll: p.instance, option: i });
          if (r) { if (ui.burst) ui.burst(btn, '💜'); if (compact) { justVoted = Date.now(); if (App.homeRefresh) App.homeRefresh(); } } else btn.disabled = false;
        },
      },
      share !== null ? h('span', { class: 'cc-bar', style: { width: `${share}%` }, 'aria-hidden': 'true' }) : null,
      h('span', { class: 'cc-opt-t' }, p.mine === i ? `✓ ${o}` : o),
      share !== null ? h('span', { class: 'cc-opt-n', 'aria-hidden': 'true' }, `${share}%`) : null);
      opts.append(b);
    });
    box.append(opts);
    if (voted && !p.counts) box.append(waiting(p.total, d.minShown || 3));
    if (voted && p.counts && !compact) {
      const same = p.counts[p.mine] - 1;
      box.append(h('p', { class: 'small cc-same' }, same > 0 ? `有 ${same} 位同週媽媽和你選一樣 💜` : '你的答案比較特別！'));
    }
    return box;
  }
  function moodBlock(d) {
    const m = d.mood;
    const box = h('div', { class: 'cc-moods', role: 'group', 'aria-label': '這週的心情' },
      MOODS.map(([k, e, l]) => {
        const n = m.counts ? m.counts[k] : null;
        return h('button', {
          class: `cc-mood${m.mine === k ? ' mine' : ''}`, 'aria-pressed': m.mine === k ? 'true' : 'false', 'aria-label': `${l}${n !== null ? `，${n} 位` : ''}`,
          onclick: async (ev) => { const b = ev.currentTarget; b.disabled = true; const r = await act('mood', { mood: k }); if (!r) b.disabled = false; },
        }, h('span', { class: 'cc-mood-e', 'aria-hidden': 'true' }, e), h('span', { class: 'cc-mood-l' }, l), n !== null ? h('span', { class: 'cc-mood-n', 'aria-hidden': 'true' }, `${n} 位`) : null);
      }));
    const out = h('div', null, box);
    if (m.mine && !m.counts) out.append(waiting(m.total, d.minShown || 3));
    if (m.mine && m.counts) {
      const same = (m.counts[m.mine] || 0) - 1;
      out.append(h('p', { class: 'small cc-same' }, same > 0 ? `這週有 ${same} 位媽媽也覺得「${MOOD[m.mine].l}」，你不是一個人 🤍` : '謝謝你分享這週的心情'));
    }
    // worried, or not feeling well: a gentle way to reach someone
    if (m.mine === 'worried' || m.mine === 'sick') {
      out.append(h('div', { class: 'cc-care' },
        h('p', { class: 'small' }, m.mine === 'worried'
          ? '擔心、心情低落或睡不好持續兩週以上，或影響到生活，可以和醫師聊聊，也可以打電話找人說說話：'
          : '身體不舒服的時候，請好好休息；症狀嚴重或讓你擔心，請直接就醫或打電話諮詢：'),
        h('div', { class: 'row gap-sm wrap' },
          h('a', { class: 'btn btn-sm btn-soft', href: 'tel:0800870870' }, '📞 孕產婦關懷專線 0800-870-870'),
          h('a', { class: 'btn btn-sm btn-soft', href: 'tel:1925' }, '📞 安心專線 1925（24 小時）'))));
    }
    return out;
  }

  /* ---------- the screen ---------- */
  let offScreen = null;
  let lastTry = 0;
  let justVoted = 0; // a vote on 首頁 keeps its result showing there for a while
  App.screen('circle', {
    title: '同週好孕圈',
    tab: 'home',
    liveUpdate: false,
    onLeave() { if (offScreen) { offScreen(); offScreen = null; } },
    render(el) {
      if (offScreen) { offScreen(); offScreen = null; }
      const box = h('div', { class: 'stack cc' });
      el.append(box);
      const draw = () => {
        box.innerHTML = '';
        const co = cohort(); const lb = label(co);
        if (!co) {
          box.append(ui.card({ class: 'soft' }, h('div', { class: 'card-title' }, '🗳️ 同週好孕圈'),
            h('p', { class: 'small' }, store.stage === 'preg' ? '先填預產期，才知道你和哪一週的媽媽同一圈。' : '先填寶寶的生日，才知道你和哪個月出生的寶寶媽媽同一圈。'),
            h('button', { class: 'btn btn-primary btn-block', onclick: () => App.navigate('me') }, '到「我的」填寫')));
          return;
        }
        if (App.social && App.social.isReady() === false) {
          box.append(ui.card({ class: 'soft' }, h('div', { class: 'card-title' }, '🗳️ 同週好孕圈'), h('p', { class: 'small muted' }, '需要連上會員服務才能和其他媽媽一起投票；目前連不到，連上網路後再試試。')));
          return;
        }
        if (!circ().on) {
          const agree = App.privacy ? App.privacy.box({ label: ['我同意分享上面「會送出」的資料（大家只看得到總數，可隨時離開），並同意', App.privacy.link()] }) : null;
          box.append(h('div', { class: 'cc-hero' }, h('div', { class: 'cc-hero-e', 'aria-hidden': 'true' }, lb.emoji),
            h('div', null, h('div', { class: 'cc-kicker' }, '🗳️ 同週好孕圈'), h('h2', { class: 'cc-title' }, lb.title), h('div', { class: 'cc-sub' }, lb.sub))));
          box.append(ui.card(null,
            h('div', { class: 'card-title' }, '和同一週的媽媽一起'),
            h('ul', { class: 'cc-list' },
              h('li', null, '🗳️ 每週一題小問題，看看大家怎麼選'),
              h('li', null, '🌤️ 分享這週的心情，原來大家都一樣累'),
              h('li', null, '💜 每天按一下，為同一圈的媽媽加油')),
            h('div', { class: 'soc-privacy' },
              h('div', { class: 'soc-pv' }, h('strong', null, '會送出'), h('ul', null, h('li', null, co === 'prep' ? '你在備孕' : co.startsWith('p:') ? '預產期是哪一週（不是日期）' : '寶寶出生的年月（不是日期）'), h('li', null, '你的回答（大家只看到總數）'))),
              h('div', { class: 'soc-pv no' }, h('strong', null, '不會送出'), h('ul', null, h('li', null, '名字、照片、生日'), h('li', null, '任何紀錄'), h('li', null, '誰選了什麼（3 位以上回答才公布結果）')))),
            agree ? agree.el : null,
            h('button', {
              class: 'btn btn-primary btn-block mt',
              onclick: async (e) => {
                if (agree && !agree.need('請先勾選同意，才能加入同週好孕圈')) return;
                const btn = e.currentTarget; btn.disabled = true;
                if (!(await join())) btn.disabled = false; else draw();
              },
            }, '加入同週好孕圈')));
          return;
        }
        const d = live.data;
        box.append(h('div', { class: 'cc-hero' }, h('div', { class: 'cc-hero-e', 'aria-hidden': 'true' }, lb.emoji),
          h('div', { class: 'grow' }, h('div', { class: 'cc-kicker' }, '🗳️ 同週好孕圈'), h('h2', { class: 'cc-title' }, lb.title), h('div', { class: 'cc-sub' }, lb.sub)),
          h('div', { class: 'cc-count' }, h('strong', null, d ? String(d.members) : '…'), h('span', null, '位媽媽'))));
        if (live.error && !d) { box.append(h('p', { class: 'login-err' }, errText(live.error))); return; }
        if (!d) { box.append(h('p', { class: 'center muted' }, '載入中…')); return; }
        if (d.members <= 1) {
          box.append(ui.card({ class: 'soft cc-alone' }, h('p', { class: 'small' }, '目前只有你在這一圈。邀請同一週預產（或同月出生）的朋友加入，就能一起看大家的回答！'),
            h('button', { class: 'btn btn-soft btn-block', onclick: () => App.share.open({ title: '同週好孕圈', text: '我在「同週好孕圈」和同一週的媽媽一起回答每週小問題、互相打氣，你也一起來吧！', campaign: 'circle', path: 'circle' }) }, '📨 邀請朋友加入')));
        }
        // cheering
        box.append(ui.card({ class: 'cc-cheer' },
          h('div', { class: 'grow' }, h('div', { class: 'card-title' }, '💜 互相加油'), h('div', { class: 'small muted' }, d.cheers.week ? `這週大家已經互相加油 ${d.cheers.week} 次` : '這週還沒有人加油，當第一個吧！')),
          h('button', {
            class: `btn ${d.cheers.today ? 'btn-ghost' : 'btn-primary'}`, disabled: d.cheers.today,
            onclick: async (e) => { const b = e.currentTarget; b.disabled = true; const r = await act('cheer'); if (r) { if (ui.celebrate) ui.celebrate({ from: b, emojis: ['💜', '✨', '🌸'] }); ui.toast('已為同一圈的媽媽加油 💜'); } else b.disabled = false; },
          }, d.cheers.today ? '今天加油過了' : '為大家加油')));
        // the question of the week
        const spot = d.poll.spot && App.island && App.island.spots && App.island.spots.find((s) => s.id === d.poll.spot);
        box.append(ui.card({ class: 'cc-poll-card' },
          h('div', { class: 'row gap' }, h('div', { class: 'card-title grow' }, '🗳️ 本週小問題'), h('span', { class: 'tiny muted' }, '每週一換新題')),
          pollBlock(d),
          spot ? h('button', { class: 'link-btn small', onclick: () => App.navigate('island', { spot: spot.id }) }, `相關小知識：${spot.emoji || '📍'} ${spot.name} ›`) : null));
        // mood
        box.append(ui.card(null, h('div', { class: 'card-title' }, '🌤️ 這週的心情'), h('p', { class: 'tiny muted' }, '選一個最接近的；大家只看得到每種心情有幾位。'), moodBlock(d)));
        box.append(h('div', { class: 'row gap-sm' },
          h('button', { class: 'btn btn-soft grow', onclick: () => App.share.open({ title: '同週好孕圈', text: '我在「同週好孕圈」和同一週的媽媽一起回答每週小問題、互相打氣，你也一起來吧！', campaign: 'circle', path: 'circle' }) }, '📨 邀請朋友'),
          App.social ? h('button', { class: 'btn btn-ghost grow', onclick: () => App.navigate('island') }, '👭 島上的媽媽') : null));
        box.append(h('p', { class: 'tiny muted' }, '大家只看得到總數，看不到誰選了什麼；3 位以上回答才會公布結果。這裡的問題只是交流，身體有狀況請以醫師的建議為準。'),
          h('button', { class: 'btn btn-ghost btn-block danger-text', onclick: async () => { if (await ui.confirm('離開同週好孕圈？之後隨時可以再加入。', { ok: '離開' })) { await leave(); draw(); } } }, '離開同週好孕圈'));
      };
      subs.add(draw); offScreen = () => subs.delete(draw);
      draw();
      if (App.social) App.social.api().then(() => { if (box.isConnected) { draw(); if (circ().on) sync(); } });
    },
  });

  /* ---------- 首頁 ---------- */
  // not joined yet: an invitation below the main cards (one invitation at a time: a 祝福牆 one comes first)
  App.homeCard('circle-join', {
    stages: ['prep', 'preg', 'baby'],
    order: 43,
    render(el) {
      if (!App.social || App.social.isReady() !== true) return;
      const co = cohort(); const st = circ();
      if (!co || st.on || st.homeSkip || (App.wall && App.wall.nudgeKey && App.wall.nudgeKey())) return;
      const lb = label(co);
      el.append(h('div', { class: 'card cc-home' },
        h('span', { class: 'cc-home-e', 'aria-hidden': 'true' }, '🗳️'),
        h('button', { type: 'button', class: 'grow cc-home-main', onclick: () => App.navigate('circle') },
          h('strong', null, '同週好孕圈'), h('span', { class: 'small muted' }, `和「${lb.title}」一起回答每週小問題、互相打氣`)),
        h('button', { class: 'icon-btn', 'aria-label': '不用了', onclick: () => { upd((x) => { x.homeSkip = C.dateKey(); }); if (App.homeRefresh) App.homeRefresh(); } }, '✕')));
    },
  });
  // joined: this week's question, right after the day's main cards, until answered
  App.homeCard('circle', {
    stages: ['prep', 'preg', 'baby'],
    order: 22,
    render(el) {
      if (!App.social || App.social.isReady() !== true) return;
      if (!cohort() || !circ().on) return;
      const d = live.data;
      // fetch when missing or old, at most once a minute (a server that is down must not make 首頁 ask again and again)
      if ((!d || Date.now() - live.at > 10 * 60 * 1000) && Date.now() - lastTry > 60 * 1000) {
        lastTry = Date.now();
        sync({ quiet: true }).then((r) => { if (r && live.at > lastTry - 1 && App.homeRefresh) App.homeRefresh(); });
      }
      if (!d) return;
      if (d.poll.mine !== null && Date.now() - justVoted > 10 * 60 * 1000) return; // answered: nothing waiting here
      el.append(h('div', { class: 'card cc-home-poll' },
        h('div', { class: 'row gap' }, h('div', { class: 'card-title grow' }, `🗳️ 同週媽媽的本週小問題`), h('button', { class: 'link-btn small', onclick: () => App.navigate('circle') }, `${d.members} 位媽媽 ›`)),
        pollBlock(d, { compact: true })));
    },
  });

  App.tool({
    id: 'circle', title: '同週好孕圈', icon: '🗳️', desc: '同週媽媽的每週小問題、心情、互相加油', stages: ['prep', 'preg', 'baby'], screen: 'circle', order: 63, group: '媽媽', tags: ['同週', '同月', '媽媽', '投票', '心情', '社群', '交流'],
  });

  App.circle = {
    cohort, label, sync, join, leave, live: () => live.data, isoWeek,
  };
}());
