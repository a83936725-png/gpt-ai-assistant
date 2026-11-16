/* 首頁 — compact baby header, quick-log tiles, What's Next, latest records, module home cards.
 * Layout goal: on a 390×844 phone the tiles AND 「接下來」 are visible without scrolling. */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  // quick tiles: the 2nd tap of an accidental double-tap must not log twice, start + stop a timer, or —
  // after the timer banner pushes the tiles down — land on another tile
  // (same tile: 700 ms; any other tile: 350 ms — quicker than anyone taps two different tiles on purpose)
  let lastQuickTap = { key: '', at: 0 };
  const quickTapOk = (key) => {
    const now = Date.now(); const gap = now - lastQuickTap.at;
    if (gap < 350 || (key === lastQuickTap.key && gap < 700)) return false;
    lastQuickTap = { key, at: now }; return true;
  };

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

  // one compact row: avatar | name + age | height / weight
  function babyHero(baby) {
    const age = C.babyAge(baby.birthday);
    const g = latestGrowth(baby);
    const avatar = baby.photo
      ? h('img', { src: baby.photo, alt: '', class: 'hero-avatar' })
      : h('span', { class: 'hero-avatar emoji', 'aria-hidden': 'true' }, baby.avatar || '👶');
    return h('section', { class: 'baby-hero' },
      h('button', { class: 'hero-main', onclick: () => App.me && App.me.editBaby(baby), 'aria-label': `編輯${baby.name}的資料` },
        avatar,
        h('span', { class: 'hero-text' },
          h('span', { class: 'hero-name' }, baby.name),
          h('span', { class: 'tiny muted' }, age ? `${age.text}・第 ${age.days + 1} 天` : ''))),
      h('div', { class: 'hero-stats' },
        h('a', { class: 'hero-stat', href: '#/growth' }, h('b', { class: 'num' }, g.length || '—'), h('span', { class: 'tiny muted' }, '公分')),
        h('a', { class: 'hero-stat', href: '#/growth' }, h('b', { class: 'num' }, g.weight || '—'), h('span', { class: 'tiny muted' }, '公斤'))),
      App.share ? h('button', { class: 'icon-btn hero-share', 'aria-label': '分享寶寶成長卡', html: ui.ICONS.share, onclick: () => App.share.open({ kind: 'baby-age', sheetTitle: '分享寶寶成長卡' }) }) : null,
      store.state.babies.length > 1 ? h('button', { class: 'hero-switch link-btn tiny', onclick: switchBaby }, '切換') : null);
  }

  function switchBaby() {
    const sh = ui.sheet({
      title: '切換寶寶',
      body: h('div', { class: 'list' }, store.state.babies.map((b) => h('button', {
        class: 'list-item', onclick: () => { store.update((s) => { s.activeBabyId = b.id; }); sh.close(); },
      }, h('span', { class: 'li-icon' }, b.avatar || '👶'), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, b.name), h('div', { class: 'li-sub' }, C.babyAge(b.birthday)?.text || '')),
      b.id === store.baby()?.id ? h('span', { class: 'tag primary' }, '目前') : null))),
    });
  }

  // tap the tile = full form; tap ＋ = one-tap quick log (see App.babylog.quickLog)
  const QUICK_DEFS = {
    breast: { label: '親餵', active: 'feed', plusHint: '開始計時' },
    bottle: { label: '瓶餵', plusHint: '同上次' },
    diaper: { label: '尿布', plusHint: '濕尿布' },
    sleep: { label: '睡眠', active: 'sleep', plusHint: '開始計時' },
    pump: { label: '擠奶', active: 'pump', plusHint: '開始計時' },
    temp: { label: '體溫', plusHint: '量體溫' },
    food: { label: '副食品', plusHint: '記一筆' },
    med: { label: '用藥', plusHint: '記一筆' },
    visit: { label: '看診', plusHint: '記一筆' },
    bath: { label: '洗澡', plusHint: '洗好了' },
    other: { label: '其他', plusHint: '記一筆' },
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
        list.append(h('label', { class: 'list-item check-row' }, cb, h('span', { class: 'li-icon' }, def.icon),
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
      const running = q.active && store.state.active[q.active];
      const todayCount = today.filter((l) => l.type === q.type).length;
      let sub;
      if (running) sub = h('span', { class: 'qt-running' }, '● 計時中');
      else if (last) sub = h('span', { dataset: { ago: last.start } }, C.ago(last.start));
      else sub = h('span', { class: 'faint' }, '尚無紀錄');
      const extra = q.type === 'breast' && last?.data?.lastSide && !running ? `・上次${last.data.lastSide === 'L' ? '左' : '右'}` : '';
      const plusLabel = running ? `完成${def.label}` : `${def.label}：${q.type === 'bottle' && last ? `${last.data?.ml || ''} ml ${q.plusHint}` : q.plusHint}`;
      wrap.append(h('div', { class: `quick-tile${running ? ' running' : ''}`, role: 'listitem', style: { '--tc': def.color } },
        todayCount ? h('span', { class: 'qt-badge', 'aria-label': `今天 ${todayCount} 次` }, todayCount) : null,
        h('button', { class: 'qt-main', onclick: () => { if (quickTapOk(q.type)) App.babylog.openAdd(q.type); }, 'aria-label': `新增${def.label}（完整表單）` },
          h('span', { class: 'qt-ico' }, def.icon),
          h('span', { class: 'qt-label' }, q.label),
          h('span', { class: 'qt-sub tiny' }, sub, extra)),
        h('button', {
          class: 'qt-plus', 'aria-label': plusLabel, title: plusLabel,
          onclick: () => {
            if (!quickTapOk(q.type)) return;
            if (running) App.timers.stopWithUndo(q.type); else App.babylog.quickLog(q.type);
          },
        }, running ? '✓' : '+')));
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
      return ui.card({ class: 'next-card' }, h('div', { class: 'card-title' }, '✨ 接下來'),
        h('p', { class: 'small muted' }, '開始記錄餵奶、睡眠、尿布後，這裡會預測寶寶下一次的需求。紀錄越多，預測越貼近寶寶的作息。'));
    }
    const rows = [];
    if (sleep && sleep.sleeping) {
      rows.push(h('div', { class: 'next-big' }, h('span', { class: 'next-ico' }, '😴'),
        h('div', null, h('div', { class: 'small muted' }, '寶寶已經睡了'), h('div', { class: 'big-num num', dataset: { clock: sleep.since } }, '00:00'))));
    } else if (sleep) {
      const now = Date.now();
      const from = sleep.from.getTime(); const to = sleep.to.getTime();
      const start = new Date(sleep.awakeSince).getTime();
      const span = Math.max(1, to - start);
      const nowPct = C.clamp(((now - start) / span) * 100, 0, 100);
      const fromPct = C.clamp(((from - start) / span) * 100, 0, 100);
      rows.push(h('div', { class: 'next-big' }, h('span', { class: 'next-ico' }, '🌙'),
        h('div', { class: 'grow' },
          h('div', { class: 'small muted' }, now < from ? '留意寶寶睡意' : now <= to ? '現在是睡意窗口' : '已超過建議清醒時間'),
          now < from ? h('div', { class: 'big-num num', dataset: { countdown: sleep.from.toISOString() } }, C.fmtDuration(from - now)) : h('div', { class: 'big-num' }, now <= to ? '可以準備哄睡了' : '寶寶可能累了')),
        h('div', { class: 'next-range small' }, '可能在', h('br'), h('b', { class: 'num' }, `${C.fmtTime(sleep.from)}–${C.fmtTime(sleep.to)}`))),
      h('div', { class: 'ww-bar' },
        h('span', { class: 'ww-window', style: { left: `${fromPct}%`, width: `${100 - fromPct}%` } }),
        h('span', { class: 'ww-now', style: { left: `${nowPct}%` } })),
      h('div', { class: 'row between tiny faint num' }, h('span', null, `醒來 ${C.fmtTime(sleep.awakeSince)}`), h('span', null, `清醒窗口 ${Math.round(sleep.ww.min / 6) / 10}–${Math.round(sleep.ww.max / 6) / 10} 小時`)));
    }
    const lines = [];
    if (feed) {
      const ms = feed.next.getTime() - Date.now();
      lines.push(h('div', { class: 'next-line' }, h('span', null, '🍼'),
        ms > 0 ? h('span', null, '下一次餵食可能在 ', h('b', { dataset: { countdown: feed.next.toISOString() } }, C.fmtDuration(ms)), ' 後（', C.fmtTime(feed.next), '）')
          : h('span', null, '已到平常的餵食時間（上次 ', h('b', { dataset: { ago: feed.last.start } }, C.ago(feed.last.start)), '）')));
    }
    if (diaper) {
      const ms = diaper.next.getTime() - Date.now();
      lines.push(h('div', { class: 'next-line' }, h('span', null, '🧷'),
        ms > 0 ? h('span', null, '約 ', h('b', { dataset: { countdown: diaper.next.toISOString() } }, C.fmtDuration(ms)), ' 後檢查尿布') : h('span', null, '可以檢查一下尿布囉')));
    }
    return ui.card({ class: 'next-card' },
      h('div', { class: 'card-title' }, '✨ 接下來', h('span', { class: 'tag primary' }, '預測')),
      rows, lines.length ? h('div', { class: 'next-lines' }, lines) : null,
      h('div', { class: 'tiny faint center mt' }, `依最近 ${feed ? feed.samples : 0} 次餵食與寶寶月齡估算・紀錄越多越準`));
  }

  function moduleCards(el) {
    App.homeCards
      .filter((c) => store.inStage(c.stages))
      .sort((a, b) => a.order - b.order)
      .forEach((c) => {
        const slot = h('div', { class: 'home-slot', dataset: { card: c.id } });
        try { c.render(slot); } catch (e) { console.error(c.id, e); }
        if (slot.childNodes.length) el.append(slot);
      });
  }

  App.screen('home', {
    title: '首頁',
    render(el) {
      const stage = store.stage;
      const name = store.state.profile.momName;
      const hour = new Date().getHours();
      const greet = hour < 5 ? '夜深了，辛苦了' : hour < 11 ? '早安' : hour < 14 ? '午安' : hour < 18 ? '午後好' : '晚安';
      const stageLabel = STAGES.find((s) => s.value === stage) || STAGES[2];
      el.append(h('div', { class: 'greet row between' },
        h('div', null, h('div', { class: 'greet-hi' }, `${greet}${name ? `，${name}` : ''} 💜`), h('div', { class: 'tiny muted' }, C.fmtDateLong(new Date()))),
        h('a', { class: 'stage-pill', href: '#/me', title: '到「我的」切換階段' }, `${stageLabel.icon} ${stageLabel.label}${store.state.profile.pregnantToo && stage === 'baby' ? '＋懷孕' : ''}`)));
      if (App.livePill) el.append(App.livePill('home-live'));

      if (stage === 'baby') {
        const baby = store.baby();
        if (!baby) {
          el.append(ui.card({ class: 'soft center' }, h('div', { class: 'empty-icon' }, '👶'), h('p', null, '新增寶寶資料，開始記錄每天的照護。'),
            h('button', { class: 'btn btn-primary', onclick: () => App.me && App.me.editBaby() }, '新增寶寶')));
        } else {
          el.append(babyHero(baby));
          const banner = App.babylog.activeBanner();
          if (banner) el.append(banner);
          el.append(quickTiles());
          el.append(whatsNext());
          const today = store.logsOn(new Date());
          el.append(h('div', { class: 'section-title' }, h('span', null, '最新紀錄'), h('a', { href: '#/log' }, today.length > 3 ? `今天共 ${today.length} 筆・看日記 ›` : '日記 ›')));
          if (today.length) el.append(App.babylog.timeline(today, { limit: 3 }));
          else el.append(h('p', { class: 'small muted center' }, '今天還沒有紀錄。點卡片填完整資料，或按 ＋ 一鍵記錄。'));
          el.append(h('div', { class: 'mt-lg' }));
        }
      }
      moduleCards(el);
      el.append(h('p', { class: 'disclaimer center' }, '本 App 內容為一般衛教與紀錄工具，不能取代專業醫療建議。如有身體不適請就醫。'));
    },
  });
}());
