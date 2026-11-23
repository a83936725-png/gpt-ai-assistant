/* 新手任務：剛開始用的 3 週（或剛註冊會員的 1 週），首頁一張小卡列出 5 件小事，做完一件好孕點數 +5，全部做完再 +15
 * （BRAND.starter = { points, bonus } 可以改）。做完是 App 自動看出來的，不用自己按「完成」。
 *   填好基本資料   備孕：最近一次月經；懷孕：預產期；育兒：寶寶的出生體重（成長曲線從出生開始畫）
 *   第一筆紀錄     備孕：孕前準備清單勾一項；懷孕：胎動、體重或身體狀況；育兒：餵奶、尿布或睡眠
 *   邀請家人       我的 →「LINE 邀請」，或傳過家族週報
 *   好孕島第一個章
 *   註冊會員       有會員服務時（沒有時換成「第一次滴雞精打卡」）
 *   App.starter.mark(id)        記下一件 App 看不出來的事（目前只有 family）
 *   App.starter.welcome(user)   剛註冊：這支手機的新手任務從今天起再開 7 天，沒有其他視窗時打開清單當作歡迎
 *   App.starter.tasks()         目前的任務與完成狀態（測試也用）
 * 範例資料不顯示新手任務。 */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const B = () => window.BRAND || {};
  const PTS = () => Number((B().starter || {}).points) || 5;
  const BONUS = () => Number((B().starter || {}).bonus) || 15;
  const DAYS = 21; // after setting the app up
  const MEMBER_DAYS = 7; // after signing up on this phone

  const ensure = (s) => {
    s.starter = s.starter || {};
    const st = s.starter;
    st.done = st.done || {}; // task id → the day it was done (and its points given)
    st.marks = st.marks || {}; // things only the app's buttons know about (family)
    return st;
  };
  const state = () => store.state.starter || {};
  const daysSince = (d) => (d ? C.diffDays(C.dateKey(d), C.dateKey()) : Infinity);
  const memberService = () => !!(App.gift && App.gift.ready() === true);

  /* ---------- the five tasks, for her stage ---------- */
  function list(s = store.state) {
    const stage = s.profile.stage;
    const preg = s.preg || {};
    const babies = s.babies || [];
    const T = [];
    if (stage === 'prep') {
      T.push({ id: 'profile', title: '記下最近一次月經', sub: '經期和排卵日從這裡算', btn: '去記錄', go: () => App.navigate('cycle'), ok: (s.periods || []).length > 0 });
      T.push({ id: 'record', title: '孕前準備清單勾一項', sub: '檢查、疫苗、生活習慣一項一項來', btn: '去看看', go: () => App.navigate('prepcheck'), ok: Object.keys(s.prepChecklist || {}).length > 0 });
    } else if (stage === 'preg') {
      T.push({ id: 'profile', title: '填好預產期', sub: '孕週、產檢和寶寶大小都從這裡算', btn: '去填', go: () => App.navigate('pregnancy'), ok: !!(s.profile.lmp || s.profile.edd) });
      T.push({ id: 'record', title: '記錄一次胎動、體重或身體狀況', sub: '產檢時可以拿給醫師看', btn: '記體重', go: () => App.navigate('pregweight'), ok: !!((preg.kicks || []).length || (preg.weights || []).length || (preg.journal || []).length || (preg.contractions || []).length || Object.keys(preg.visitNotes || {}).length) });
    } else {
      T.push({ id: 'profile', title: '填好寶寶的出生體重', sub: '成長曲線從出生開始畫', btn: '去填', go: () => App.navigate('growth'), ok: babies.some((b) => b.birthWeight) || (s.growth || []).some((g) => g.weight) });
      T.push({ id: 'record', title: '記下第一筆餵奶、尿布或睡眠', sub: '記越多，「接下來」算得越準', btn: '去記錄', go: () => App.navigate('log'), ok: (s.logs || []).length > 0 });
    }
    T.push({ id: 'family', title: '用 LINE 邀請家人一起記錄', sub: '另一半、阿嬤也能一起記', btn: 'LINE 邀請', go: () => (App.inviteFamily ? App.inviteFamily() : App.navigate('me')), ok: !!(s.starter && s.starter.marks && s.starter.marks.family) || ((s.share && s.share.events) || []).some((e) => e.campaign === 'weekly') });
    T.push({ id: 'island', title: '在好孕島蓋第一個章', sub: '每一站都有一則小知識', btn: '上島', go: () => App.navigate('island'), ok: Object.keys((s.island && s.island.stamps) || {}).length > 0 });
    if (memberService()) T.push({ id: 'member', title: '註冊會員', sub: '可以參加團購揪團、領邀請禮', btn: '註冊', go: () => App.navigate('login'), ok: !!(s.auth && s.auth.token) });
    else T.push({ id: 'chicken', title: '第一次滴雞精打卡', sub: '每天留一點時間給自己', btn: '打卡', go: () => App.chicken && App.chicken.checkIn(1), ok: Object.keys((s.chicken && s.chicken.log) || {}).length > 0 });
    return T;
  }

  // shown while the first weeks last (or the first week after signing up here), until done or put away
  function active(s = store.state) {
    const st = s.starter || {};
    if (st.demo || st.off) return false;
    if (st.finished) return C.dateKey(st.finished) === C.dateKey(); // the day she finishes: a little 「完成」
    return daysSince(s.onboardedAt || s.createdAt) <= DAYS || daysSince(st.memberAt) <= MEMBER_DAYS;
  }
  const inWindow = (s = store.state) => !(s.starter || {}).demo && (daysSince(s.onboardedAt || s.createdAt) <= DAYS || daysSince((s.starter || {}).memberAt) <= MEMBER_DAYS);

  /* ---------- points for each task, once; quietly for what was already done when the list first appears ---------- */
  let busy = false;
  let hushUntil = 0; // signing up: the welcome list says it all, no toast on top of it
  function settle({ quiet = false } = {}) {
    const s = store.state;
    if (busy || !s.onboarded || !inWindow(s) || (s.starter && s.starter.finished)) return;
    // the member service is still being asked: wait, so 「註冊會員」 and 「滴雞精打卡」 don't swap places under her
    if (App.gift && App.gift.ready() === null) return;
    const first = !s.starter || !s.starter.seen;
    const tasks = list(s);
    const fresh = tasks.filter((t) => t.ok && !(s.starter && s.starter.done && s.starter.done[t.id]));
    const all = tasks.every((t) => t.ok);
    if (!fresh.length && !(all && first)) { if (first) { busy = true; store.update((x) => { ensure(x).seen = C.dateKey(); }); busy = false; } return; }
    busy = true;
    store.update((x) => {
      const st = ensure(x);
      st.seen = st.seen || C.dateKey();
      fresh.forEach((t) => { st.done[t.id] = C.dateKey(); });
      if (all) st.finished = C.dateKey();
    });
    fresh.forEach((t) => { if (App.share) App.share.bonus(PTS(), `starter-${t.id}`); });
    if (all && App.share) App.share.bonus(BONUS(), 'starter-all');
    busy = false;
    if (quiet || first || Date.now() < hushUntil) return;
    if (all) {
      ui.toast(`🎉 新手任務全部完成！好孕點數 +${fresh.length * PTS() + BONUS()}`, 3500);
      if (ui.celebrate) ui.celebrate({ emojis: ['🌱', '🎉', '💜', '⭐'] });
      if (App.mascot) App.mascot.cheer({ text: '全部完成！' });
    } else ui.toast(`🌱 新手任務：${fresh.map((t) => t.title).join('、')}　好孕點數 +${fresh.length * PTS()}`, 3000);
  }
  // after every change (a record, a stamp, signing up…), once the app has finished what it was doing
  let queued = false;
  store.subscribe(() => {
    if (queued || busy) return;
    queued = true;
    setTimeout(() => { queued = false; settle(); }, 0);
  });

  /* ---------- 首頁 ---------- */
  App.homeCard('starter', {
    stages: ['prep', 'preg', 'baby'],
    order: 13,
    render(el) {
      const s = store.state;
      if (!s.onboarded || !active(s)) return;
      if (App.gift && App.gift.ready() === null) return; // the list settles once the member service has answered
      const tasks = list(s);
      const n = tasks.filter((t) => t.ok).length;
      const next = tasks.find((t) => !t.ok);
      if ((s.starter && s.starter.finished) || !next) { // (all done a moment before its points are given: already 完成)
        el.append(ui.card({ class: 'st-home st-done' },
          h('div', { class: 'row between' },
            h('div', { class: 'card-title' }, '新手任務完成了'),
            h('button', { class: 'icon-btn st-x', 'aria-label': '收起來', onclick: () => { store.update((x) => { ensure(x).off = C.dateKey(); }); } }, '✕')),
          h('div', { class: 'row gap st-done-body' },
            App.mascot ? App.mascot.el({ mood: 'cheer', size: 50 }) : null,
            h('div', { class: 'grow' },
              h('p', { class: 'small muted' }, `${tasks.length} 件都做到了，好孕點數一共 +${tasks.length * PTS() + BONUS()}。`),
              h('button', { class: 'link-btn small', onclick: () => App.navigate('invite') }, '看我的好孕點數 ›')))));
        return;
      }
      el.append(ui.card({ class: 'st-home' },
        h('div', { class: 'row between' },
          h('div', { class: 'card-title' }, '新手任務 ', h('span', { class: 'tag primary num st-count' }, `${n}/${tasks.length}`)),
          h('button', {
            class: 'icon-btn st-x', 'aria-label': '不用了，收起新手任務',
            onclick: () => { store.update((x) => { ensure(x).off = C.dateKey(); }); ui.toast('新手任務收起來了；做到的事一樣會加好孕點數'); },
          }, '✕')),
        ui.progress(n / tasks.length),
        h('div', { class: 'st-next' },
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, next.title), h('div', { class: 'tiny muted' }, `${next.sub}・+${PTS()} 點`)),
          h('button', { class: 'btn btn-sm btn-primary st-go', onclick: next.go }, next.btn)),
        h('button', { class: 'link-btn small st-all', onclick: () => open() }, `看全部（做完再 +${BONUS()} 點）›`)));
    },
  });

  /* ---------- the list ---------- */
  function open({ title, intro } = {}) {
    const tasks = list();
    const n = tasks.filter((t) => t.ok).length;
    let sh = null;
    const row = (t) => h('div', { class: `st-row${t.ok ? ' ok' : ''}` },
      h('span', { class: 'st-mark', 'aria-hidden': 'true' }, t.ok ? '✓' : ''),
      h('div', { class: 'grow' }, h('div', { class: 'bold small' }, t.title), h('div', { class: 'tiny muted' }, t.ok ? `完成・+${PTS()} 點` : `${t.sub}・+${PTS()} 點`)),
      t.ok ? null : h('button', { class: 'btn btn-sm btn-soft st-row-go', onclick: () => { sh.close(); setTimeout(t.go, 200); } }, t.btn));
    sh = ui.sheet({
      title: title || `🌱 新手任務 ${n}/${tasks.length}`,
      body: h('div', { class: 'st-sheet' },
        intro ? h('p', { class: 'small' }, intro) : null,
        h('div', { class: 'st-list' }, tasks.map(row)),
        h('p', { class: 'tiny muted mt' }, `每件 +${PTS()} 點，全部做完再 +${BONUS()} 點。好孕點數可以在「我的 → 邀請好友」換獎勵。`)),
    });
    return sh;
  }

  // just signed up here: the list (with 註冊會員 ticked) is the welcome, unless another window is already open
  function welcome(u) {
    if (store.state.starter && store.state.starter.demo) return;
    if (!(store.state.starter && store.state.starter.memberAt)) { store.update((x) => { ensure(x).memberAt = C.dateKey(); }); }
    settle({ quiet: true });
    if (document.body.classList.contains('has-sheet') || document.body.dataset.screen !== 'home' || !active()) return;
    const name = (u && u.nickname) || store.state.profile.momName || '';
    document.querySelectorAll('.toast:not(.has-action)').forEach((t) => t.remove()); // 「註冊成功」 is what the list says
    open({ title: `歡迎加入${name ? `，${name}` : ''}！`, intro: '接下來做這幾件小事，熟悉 App 也能拿好孕點數：' });
  }

  function mark(id) {
    if ((ensure(store.state).marks || {})[id]) return;
    store.update((x) => { ensure(x).marks[id] = C.dateKey(); });
  }

  App.starter = {
    tasks: () => list(), active: () => active(), open, welcome, mark, settle, hush: (ms = 3000) => { hushUntil = Date.now() + ms; },
  };
}());
