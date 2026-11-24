/* 首頁 — compact baby header, quick-log tiles, What's Next, latest records, module home cards.
 * Layout goal: on a 390×844 phone the tiles AND 「接下來」 are visible without scrolling. */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  // quick tiles: the 2nd tap of an accidental double-tap must not log twice or start + stop a timer (same tile,
  // 700 ms); and right after a timer starts/stops, its banner pushes the tiles down, so for 400 ms a tap on
  // any tile is ignored (it would land on a different tile than the one under the finger)
  let lastQuickTap = { key: '', at: 0 };
  let shiftUntil = 0;
  const quickTapOk = (key) => {
    const now = Date.now();
    if (now < shiftUntil || (key === lastQuickTap.key && now - lastQuickTap.at < 700)) return false;
    lastQuickTap = { key, at: now }; return true;
  };

  // the greeting follows the sun: 傍晚 comes with the season's own sunset, 深夜 lasts until the sky starts to light up
  function greeting(now = new Date()) {
    const hour = now.getHours();
    const phase = App.dayPhase ? App.dayPhase(now) : (hour >= 22 || hour < 5 ? 'late' : 'day');
    if (phase === 'late') return hour >= 22 || hour < 4 ? '夜深了，辛苦了' : '天還沒亮，辛苦了';
    if (phase === 'dawn') return App.sun && now < App.sun(now).sunrise ? '天快亮了' : '早安';
    if (phase === 'dusk') return '傍晚好';
    if (phase === 'evening') return '晚安';
    return hour < 11 ? '早安' : hour < 14 ? '午安' : '午後好';
  }
  // (the next sunrise or sunset used to sit under the date; it is in 我的 → 夜間模式, where it explains something)
  App.greeting = greeting;

  const STAGES = [
    { value: 'prep', label: '備孕中', icon: '🌱' },
    { value: 'preg', label: '懷孕中', icon: '🤰' },
    { value: 'baby', label: '育兒中', icon: '👶' },
  ];
  App.STAGES = STAGES;

  function latestGrowth(baby) {
    const g = store.state.growth.filter((x) => x.babyId === baby.id).sort((a, b) => (a.date < b.date ? 1 : -1));
    const w = g.find((x) => x.weight);
    const l = g.find((x) => x.length);
    return { weight: w ? w.weight : baby.birthWeight, length: l ? l.length : baby.birthLength };
  }

  // the one thing a tired parent wants at a glance: when is the next feed (and which side was last)
  function feedStatus(baby) {
    const run = App.timers && App.timers.get('breast', baby.id);
    if (run) return `親餵中・${run.side === 'L' ? '左' : '右'}邊`;
    const pred = App.predict && App.predict.feed();
    if (!pred) return '記一次餵奶，就會算出下一餐大約幾點';
    const mins = Math.round((pred.next.getTime() - Date.now()) / C.MIN);
    const side = pred.last.type === 'breast' && pred.last.data && pred.last.data.lastSide ? `・上次${pred.last.data.lastSide === 'L' ? '左' : '右'}邊` : '';
    // short enough for a small phone: the time is what matters; a countdown only when it is close
    if (mins >= 60) return `下一餐約 ${C.fmtTime(pred.next)}${side}`;
    if (mins > 0) return `${mins} 分後下一餐・${C.fmtTime(pred.next)}${side}`; // countdown first: it is what fits
    if (mins > -90) return `差不多該餵了（約 ${C.fmtTime(pred.next)}）${side}`;
    return `上次餵奶 ${C.ago(pred.last.start)}${side}`;
  }

  // one compact card: avatar | name / age・weight・length / next feed
  function babyHero(baby) {
    const age = C.babyAge(baby.birthday);
    const g = latestGrowth(baby);
    // the baby shows what is happening right now: z z z while asleep, hearts while feeding (css/motion.css); the
    // Q版 baby also closes its eyes or smiles (js/modules/qban.js)
    const asleep = App.timers && App.timers.get('sleep', baby.id);
    const feeding = App.timers && App.timers.get('breast', baby.id);
    const avatar = App.qbaby ? App.qbaby.face(baby, { size: 56, state: asleep ? 'sleep' : feeding ? 'feed' : 'awake', cls: 'hero-avatar' })
      : baby.photo ? h('img', { src: baby.photo, alt: '', class: 'hero-avatar' })
        : h('span', { class: 'hero-avatar emoji', 'aria-hidden': 'true' }, baby.avatar || '👶');
    const fx = asleep ? h('span', { class: 'hero-fx sleep', 'aria-hidden': 'true' }, h('i', null, 'z'), h('i', null, 'z'), h('i', null, 'Z'))
      : feeding ? h('span', { class: 'hero-fx feed', 'aria-hidden': 'true' }, h('i', null, '💗'), h('i', null, '💕'), h('i', null, '💗')) : null;
    return h('section', { class: 'baby-hero' },
      h('button', { class: 'hero-main', onclick: () => App.me && App.me.editBaby(baby), 'aria-label': `編輯${baby.name}的資料${asleep ? '（睡覺中）' : feeding ? '（親餵中）' : ''}` },
        avatar, fx,
        h('span', { class: 'hero-text' },
          h('span', { class: 'hero-name' }, baby.name),
          // age, then size on the same line (on the birthday itself: 今天出生)
          h('span', { class: 'hero-sub' }, [!age ? '' : age.days < 0 ? age.text : age.days === 0 ? '今天出生 🎉' : age.text,
            g.weight ? `${g.weight} kg` : '', g.length ? `${g.length} cm` : ''].filter(Boolean).join('・')),
          age && age.days >= 0 ? h('span', { class: 'hero-next' }, feedStatus(baby)) : null)),
      App.share ? h('button', { class: 'icon-btn hero-share', 'aria-label': '分享寶寶成長卡', html: ui.ICONS.share, onclick: () => App.share.open({ kind: 'baby-age', sheetTitle: '分享寶寶成長卡' }) }) : null,
      store.state.babies.length > 1 ? h('button', { class: 'hero-switch link-btn tiny', onclick: switchBaby }, '切換') : null);
  }

  function switchBaby() {
    const sh = ui.sheet({
      title: '切換寶寶',
      body: h('div', { class: 'list' }, store.state.babies.map((b) => h('button', {
        class: 'list-item', onclick: () => { store.update((s) => { s.activeBabyId = b.id; }); sh.close(); },
      }, App.qbaby ? App.qbaby.icon(b) : h('span', { class: 'li-icon' }, b.avatar || '👶'), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, b.name), h('div', { class: 'li-sub' }, C.babyAge(b.birthday)?.text || '')),
      b.id === store.baby()?.id ? h('span', { class: 'tag primary' }, '目前') : null))),
    });
  }

  // tap the tile = full form; tap ＋ = one-tap quick log (see App.babylog.quickLog)
  const QUICK_DEFS = {
    // short: printed on the ＋ itself, so it is clear what one tap does (timer? a wet diaper? the same bottle again?)
    breast: { label: '親餵', active: 'feed', plusHint: '開始計時', short: '計時' },
    bottle: { label: '瓶餵', plusHint: '同上次', short: '記錄' },
    diaper: { label: '尿布', plusHint: '濕尿布', short: '濕尿布' },
    sleep: { label: '睡眠', active: 'sleep', plusHint: '開始計時', short: '計時' },
    pump: { label: '擠奶', active: 'pump', plusHint: '記奶量', short: '奶量' }, // ＋ opens 記奶量 (the timer is in there)
    temp: { label: '體溫', plusHint: '量體溫', short: '量體溫' },
    food: { label: '副食品', plusHint: '記一筆', short: '記錄' },
    med: { label: '用藥', plusHint: '記一筆', short: '記錄' },
    visit: { label: '看診', plusHint: '記一筆', short: '記錄' },
    bath: { label: '洗澡', plusHint: '洗好了', short: '洗好了' },
    other: { label: '其他', plusHint: '記一筆', short: '記錄' },
  };
  const DEFAULT_TILES = ['breast', 'bottle', 'diaper', 'sleep', 'pump', 'temp'];
  const MAX_TILES = 9;
  const tileTypes = () => {
    const t = store.state.settings.quickTiles;
    return (Array.isArray(t) && t.length ? t : DEFAULT_TILES).filter((x) => QUICK_DEFS[x]);
  };
  App.home = { DEFAULT_TILES, tileTypes };

  function editTiles() {
    let chosen = tileTypes().slice();
    const ageM = store.baby() ? C.babyAge(store.baby().birthday)?.months || 0 : 0;
    const list = h('div', { class: 'list' });
    const count = h('span', { class: 'tag primary' });
    const draw = () => {
      list.innerHTML = '';
      count.textContent = `${chosen.length} / ${MAX_TILES}`;
      App.LOG_ORDER.forEach((t) => {
        const def = App.LOG_TYPES[t];
        const on = chosen.includes(t);
        const cb = h('input', { type: 'checkbox', checked: on, disabled: !on && chosen.length >= MAX_TILES });
        cb.addEventListener('change', () => { chosen = cb.checked ? App.LOG_ORDER.filter((x) => x === t || chosen.includes(x)) : chosen.filter((x) => x !== t); draw(); });
        list.append(h('label', { class: 'list-item check-row', style: { '--tc': def.color } }, cb, App.logIcon(t, 'li-icon lt-tinted'),
          h('span', { class: 'li-body' }, h('span', { class: 'li-title' }, def.label), h('span', { class: 'li-sub', style: { display: 'block' } }, `＋：${QUICK_DEFS[t].plusHint}`))));
      });
    };
    draw();
    const sh = ui.sheet({
      title: '自訂快速鍵',
      body: h('div', null,
        h('p', { class: 'small muted' }, '選 3～9 個常用的紀錄放在首頁，順序跟「紀錄」相同。', count),
        ageM >= 5 && !chosen.includes('food') ? h('p', { class: 'small', style: { color: 'var(--c-accent)' } }, '💡 寶寶快要開始吃副食品了，可以把「擠奶」換成「副食品」。') : null,
        list),
      footer: h('div', { class: 'row gap' },
        h('button', { class: 'btn btn-ghost', onclick: () => { store.update((s) => { s.settings.quickTiles = null; }); sh.close(); ui.toast('已恢復預設'); } }, '恢復預設'),
        h('button', {
          class: 'btn btn-primary grow',
          onclick: () => {
            if (chosen.length < 3) { ui.toast('至少選 3 個'); return; }
            store.update((s) => { s.settings.quickTiles = chosen; });
            sh.close(); ui.toast('已更新首頁快速鍵');
          },
        }, '儲存')),
    });
  }
  App.home.editTiles = editTiles;

  function quickTiles() {
    const wrap = h('div', { class: 'quick-row', role: 'list' });
    const today = store.logsOn(new Date());
    tileTypes().map((type) => ({ type, ...QUICK_DEFS[type] })).forEach((q) => {
      const def = App.LOG_TYPES[q.type];
      const last = store.lastLog(q.type);
      const running = q.active && App.timers.get(q.active); // this baby's timer (twins each have their own)
      const todayCount = today.filter((l) => l.type === q.type).length;
      let sub;
      const pumpToday = q.type === 'pump' ? C.sum(today.filter((l) => l.type === 'pump'), App.pumpMl) : 0;
      if (running) sub = h('span', { class: 'qt-running' }, '● 計時中');
      else if (pumpToday) sub = h('span', { class: 'qt-pump' }, `今天 ${pumpToday} ml`); // 擠奶: how much today, at a glance
      else if (last) sub = h('span', { dataset: { ago: last.start } }, C.ago(last.start));
      else sub = h('span', { class: 'faint' }, '尚無紀錄');
      const extra = q.type === 'breast' && last?.data?.lastSide && !running ? `・上次${last.data.lastSide === 'L' ? '左' : '右'}` : '';
      const plusLabel = running ? `完成${def.label}` : `${def.label}：${q.type === 'bottle' && last ? `${last.data?.ml || ''} ml ${q.plusHint}` : q.plusHint}`;
      wrap.append(h('div', { class: `quick-tile${running ? ' running' : ''}`, role: 'listitem', style: { '--tc': def.color }, dataset: { type: q.type } },
        // today's count, as a quiet 「今天 3」 (the word comes from the style sheet): not a red-dot notification
        todayCount ? h('span', { class: 'qt-badge', 'aria-label': `今天 ${todayCount} 次` }, todayCount) : null,
        h('button', { class: 'qt-main', onclick: () => { if (quickTapOk(q.type)) App.babylog.openAdd(q.type); }, 'aria-label': `新增${def.label}（完整表單）` },
          App.logIcon(q.type, 'qt-ico'),
          h('span', { class: 'qt-label' }, q.label),
          h('span', { class: 'qt-sub tiny' }, sub, extra)),
        h('button', {
          class: 'qt-plus', 'aria-label': plusLabel, title: plusLabel,
          onclick: (e) => {
            if (!quickTapOk(q.type)) return;
            if (running || ['breast', 'sleep'].includes(q.type)) shiftUntil = Date.now() + 400; // timer banner appears / goes
            const at = e.currentTarget.getBoundingClientRect(); // before the screen updates
            const n0 = store.logsOn(new Date()).length;
            if (running) App.timers.stopWithUndo(q.type);
            else if (q.type === 'pump') App.babylog.openAdd('pump'); // 擠奶: the amount is the point (one tap away)
            else App.babylog.quickLog(q.type);
            // logged (not a form that opened instead): a little puff from the button, and today's count pops
            if (!document.body.classList.contains('has-sheet')) {
              ui.burst(at, '●', { color: def.color, size: 9 }); // a few dots in the record's colour
              if (store.logsOn(new Date()).length > n0) {
                requestAnimationFrame(() => { const b = document.querySelector(`.quick-tile[data-type="${q.type}"] .qt-badge`); if (b) b.classList.add('pop'); });
                if (App.qbaby) requestAnimationFrame(App.qbaby.hop); // the Q版 baby hops
              }
            }
          },
        }, running ? [h('span', { class: 'qt-plus-sign', 'aria-hidden': 'true' }, '✓'), '完成']
          : [h('span', { class: 'qt-plus-sign', 'aria-hidden': 'true' }, '＋'), q.type === 'bottle' && last && last.data && last.data.ml ? `${last.data.ml}ml` : q.short])));
    });
    return h('div', null, wrap,
      h('div', { class: 'quick-edit-row' }, h('button', { class: 'link-btn tiny', onclick: editTiles }, '⚙︎ 自訂快速鍵')));
  }

  function whatsNext() {
    const P = App.predict;
    const feed = P.feed();
    const sleep = P.sleep();
    const diaper = P.diaper();
    if (!feed && !sleep && !diaper) {
      return ui.card({ class: 'next-card' }, h('div', { class: 'card-title' }, '接下來'),
        h('div', { class: 'pic-intro' }, ui.pic('next', 64),
          h('p', { class: 'small muted' }, '記一次餵奶、睡眠或尿布，這裡就會算出下一次大約幾點；記得越多越準。')));
    }
    const rows = [];
    if (sleep && sleep.sleeping) {
      rows.push(h('div', { class: 'next-big' }, App.logIcon('sleep', 'next-ico'),
        h('div', null, h('div', { class: 'small muted' }, '寶寶已經睡了'), h('div', { class: 'big-num num', dataset: { clock: sleep.since } }, '00:00'))));
    } else if (sleep) {
      const now = Date.now();
      const from = sleep.from.getTime(); const to = sleep.to.getTime();
      const start = new Date(sleep.awakeSince).getTime();
      const span = Math.max(1, to - start);
      const nowPct = C.clamp(((now - start) / span) * 100, 0, 100);
      const fromPct = C.clamp(((from - start) / span) * 100, 0, 100);
      rows.push(h('div', { class: 'next-big' }, App.logIcon('sleep', 'next-ico'),
        h('div', { class: 'grow' },
          h('div', { class: 'small muted' }, now < from ? '寶寶可能想睡的時間' : now <= to ? '現在是睡意窗口' : '已超過建議清醒時間'),
          now < from ? h('div', { class: 'big-num num' }, h('span', { dataset: { countdown: sleep.from.toISOString() } }, C.fmtDuration(from - now)), h('small', { class: 'big-suffix' }, '後'))
            : h('div', { class: 'big-num' }, now <= to ? '可以準備哄睡了' : '寶寶可能累了')),
        h('div', { class: 'next-range small' }, '可能在', h('br'), h('b', { class: 'num' }, `${C.fmtTime(sleep.from)}–${C.fmtTime(sleep.to)}`))),
      h('div', { class: 'ww-bar' },
        h('span', { class: 'ww-window', style: { left: `${fromPct}%`, width: `${100 - fromPct}%` } }),
        h('span', { class: 'ww-now', style: { left: `${nowPct}%` } })),
      h('div', { class: 'row between tiny faint num' }, h('span', null, `醒來 ${C.fmtTime(sleep.awakeSince)}`), h('span', null, `清醒窗口 ${Math.round(sleep.ww.min / 6) / 10}–${Math.round(sleep.ww.max / 6) / 10} 小時`)));
    }
    const lines = [];
    if (feed) {
      const ms = feed.next.getTime() - Date.now();
      lines.push(h('div', { class: 'next-line' }, App.logIcon('bottle', 'next-line-ico'),
        ms > 0 ? h('span', null, '下一次餵食可能在 ', h('b', { dataset: { countdown: feed.next.toISOString() } }, C.fmtDuration(ms)), '後（', C.fmtTime(feed.next), '）')
          : h('span', null, '已到平常的餵食時間（上次 ', h('b', { dataset: { ago: feed.last.start } }, C.ago(feed.last.start)), '）')));
    }
    if (diaper) {
      const ms = diaper.next.getTime() - Date.now();
      lines.push(h('div', { class: 'next-line' }, App.logIcon('diaper', 'next-line-ico'),
        ms > 0 ? h('span', null, '約 ', h('b', { dataset: { countdown: diaper.next.toISOString() } }, C.fmtDuration(ms)), '後檢查尿布') : h('span', null, '可以檢查一下尿布囉')));
    }
    return ui.card({ class: 'next-card' },
      h('div', { class: 'card-title' }, '接下來', h('span', { class: 'tag primary' }, '預測'),
        App.handoff ? h('button', { class: 'link-btn small next-handoff', onclick: () => App.handoff.open() }, '交接卡') : null),
      rows, lines.length ? h('div', { class: 'next-lines' }, lines) : null,
      h('div', { class: 'tiny faint center mt' }, `依最近 ${feed ? feed.samples : 0} 次餵食與寶寶月齡估算・紀錄越多越準`));
  }

  /* 坐月子（寶寶未滿 30 天）：當天要用的卡片照常，下面的推薦（好孕島、團購、好孕圈、好物、邀請朋友）收成一列「更多」，
   * 首頁短一點。她自己的事（她的團、成團了、排好的外出）和滿月祝福牆照常顯示（卡片在 slot 上標 data-personal）。 */
  const FOLD_FROM = 40;
  const FOLD_KEEP = new Set(['wall-nudge', 'share-moments']);
  const FOLD_NAME = {
    'island-progress': '好孕島', groupbuy: '團購', 'circle-join': '好孕圈', outing: '外出', goods: '好物', invite: '邀請朋友',
  };
  let foldOpen = false;
  function calmHome() {
    if (store.stage !== 'baby' || store.state.settings.calmHomeOff) return false;
    const b = store.baby();
    if (!b || !b.birthday) return false;
    const d = C.diffDays(b.birthday, new Date());
    return d >= 0 && d < 30;
  }
  /* 0.9.5: every card on 首頁 carries its drawing (assets/thumbs) — next to its title, or in place of the emoji a one-line
   * card starts with — so each one is recognised before it is read. 島上的媽媽 keeps the other mom's Q版 face and the
   * pregnancy week its fruit: those pictures say something the drawing can't. */
  const CARD_PIC = {
    'benefits-now': 'benefits', daily: 'brand', 'baby-health': 'prevention', journey: 'journey', postpartum: 'postpartum',
    starter: 'starter', goods: 'goods', outing: 'outing', 'prep-cycle': 'cycle', weekly: 'weekly', groupbuy: 'groupbuy',
    'circle-join': 'circle', circle: 'circle', gift: 'gift', invite: 'invite', wall: 'wall', 'wall-nudge': 'wall',
    'island-new': 'island', 'island-progress': 'island',
    'keep-safe': (slot) => (slot.querySelector('[data-keep="a2hs"]') ? 'a2hs' : 'backup'),
  };
  const LEAD_EMOJI = '.cc-home-e, .gift-home-ico, .isl-new-emoji, .isl-home-emoji, .inv-home-ico, .wall-home-e';
  function cardPic(slot, id) {
    const want = CARD_PIC[id];
    const name = typeof want === 'function' ? want(slot) : want;
    if (!name || slot.querySelector('img.pic')) return;
    const lead = slot.querySelector(LEAD_EMOJI);
    if (lead) { lead.replaceWith(ui.pic(name, 44, 'card-pic')); return; }
    const title = slot.querySelector('.card-title');
    if (title) { title.prepend(ui.pic(name, 36, 'card-pic')); return; }
    const row = slot.querySelector('.card > .row');
    if (row) row.prepend(ui.pic(name, 44, 'card-pic'));
  }
  function moduleCards(el) {
    const calm = calmHome();
    const more = h('div', { class: 'home-more-cards', hidden: !foldOpen });
    App.homeCards
      .filter((c) => store.inStage(c.stages))
      .sort((a, b) => a.order - b.order)
      .forEach((c) => {
        const slot = h('div', { class: 'home-slot', dataset: { card: c.id } });
        try { c.render(slot); } catch (e) { console.error(c.id, e); }
        if (!slot.childNodes.length) return;
        cardPic(slot, c.id);
        if (calm && c.order >= FOLD_FROM && !FOLD_KEEP.has(c.id) && slot.dataset.personal !== '1') more.append(slot); else el.append(slot);
      });
    if (!more.childNodes.length) return;
    const names = [...new Set([...more.children].map((x) => FOLD_NAME[x.dataset.card]).filter(Boolean))];
    const label = h('span', { class: 'grow' },
      h('span', { class: 'bold' }, foldOpen ? '收起推薦' : `更多：${names.join('、')}`),
      h('span', { class: 'tiny muted home-more-sub' }, '坐月子期間先收起來，讓首頁短一點'));
    const chev = h('span', { class: 'chev', 'aria-hidden': 'true' }, foldOpen ? '︿' : '﹀');
    const toggle = h('button', {
      type: 'button', class: 'home-more', 'aria-expanded': String(foldOpen),
      onclick: () => { foldOpen = !foldOpen; if (App.homeRefresh) App.homeRefresh(); },
    }, label, chev);
    el.append(h('div', { class: 'home-slot', dataset: { card: 'more' } }, toggle, more,
      foldOpen ? h('button', {
        type: 'button', class: 'link-btn small home-more-off',
        onclick: () => { store.update((s) => { s.settings.calmHomeOff = true; }); ui.toast('之後首頁都會全部展開'); },
      }, '以後都不要收起來') : null));
  }

  App.screen('home', {
    title: '首頁',
    render(el) {
      const stage = store.stage;
      const name = store.state.profile.momName;
      const now = new Date();
      const greet = greeting(now);
      const stageLabel = STAGES.find((s) => s.value === stage) || STAGES[2];
      const myHead = App.avatar && App.avatar.head(44);
      // 「早安，小美」 and the date: no heart after her name (a person would not write one), 小滴 only in the night
      el.append(h('div', { class: 'greet row between' },
        h('div', { class: 'row' },
          myHead ? h('button', { class: 'greet-av', 'aria-label': '我的 Q 版角色', onclick: () => App.navigate('avatar') }, myHead) : null,
          h('div', null, h('div', { class: 'greet-hi' }, `${greet}${name ? `，${name}` : ''} `,
            App.mascot && App.mascot.night() ? App.mascot.el({ mood: 'sleepy', size: 30, cls: 'greet-md' }) : null), h('div', { class: 'tiny muted greet-date' }, C.fmtDateLong(now)))),
        h('a', { class: 'stage-pill', href: '#/me', title: '到「我的」切換階段' }, `${stageLabel.label}${store.state.profile.pregnantToo && stage === 'baby' ? '＋懷孕' : ''}`)));
      if (App.livePill) el.append(App.livePill('home-live'));
      // a save that could not be kept: the warning goes right under the greeting, above everything else
      const storageAlert = App.storageAlert && App.storageAlert();
      if (storageAlert) el.append(h('div', { class: 'home-slot', dataset: { card: 'storage-alert' } }, storageAlert));

      if (stage === 'baby') {
        const baby = store.baby();
        if (!baby) {
          el.append(ui.card({ class: 'soft center' }, App.qbaby ? App.qbaby.face({ avatar: '👶' }, { size: 72, cls: 'qb-hello' }) : h('div', { class: 'empty-icon' }, '👶'), h('p', null, '新增寶寶資料，開始記錄每天的照護。'),
            h('button', { class: 'btn btn-primary', onclick: () => App.me && App.me.editBaby() }, '新增寶寶')));
        } else {
          el.append(babyHero(baby));
          const moment = App.share && App.share.momentLine && App.share.momentLine(baby);
          if (moment) el.append(moment);
          const handed = App.handoff && App.handoff.banner(baby); // 交接卡 from the family
          if (handed) el.append(handed);
          const isle = App.island && App.island.newIslandLine && App.island.newIslandLine();
          if (isle) el.append(isle);
          // 寶寶月照 on the month-day: under a new island (that happens once), and not with a 滿月／收涎 line (its sheet offers it)
          if (!moment) { const mo = App.monthly && App.monthly.homeLine && App.monthly.homeLine(baby); if (mo) el.append(mo); }
          const gift = App.gift && App.gift.line(); // 雙向邀請禮: a friend's welcome gift waiting
          if (gift) el.append(gift);
          const banner = App.babylog.activeBanner();
          if (banner) el.append(banner);
          el.append(quickTiles());
          el.append(whatsNext());
          const today = store.logsOn(new Date());
          el.append(h('div', { class: 'section-title' }, h('span', null, '最新紀錄'), h('a', { href: '#/log' }, today.length > 3 ? `今天共 ${today.length} 筆・看全部 ›` : '全部紀錄 ›')));
          if (today.length) el.append(App.babylog.timeline(today, { limit: 3 }));
          else el.append(h('div', { class: 'card home-empty pic-intro' }, ui.pic('records', 56), h('p', { class: 'small muted' }, '今天還沒有紀錄。按上面的 ＋ 一鍵記錄，或點卡片填完整資料。')));
          el.append(h('div', { class: 'mt-lg' }));
        }
      }
      moduleCards(el);
      el.append(h('p', { class: 'disclaimer center' }, '本 App 內容為一般衛教與紀錄工具，不能取代專業醫療建議。如有身體不適請就醫。'));
    },
  });
}());
