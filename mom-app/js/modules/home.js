/* 首頁 — stage switcher, baby hero, quick-add tiles, What's Next, today timeline, module home cards. */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;

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

  function babyHero(baby) {
    const age = C.babyAge(baby.birthday);
    const g = latestGrowth(baby);
    const avatar = baby.photo
      ? h('img', { src: baby.photo, alt: baby.name, class: 'hero-avatar' })
      : h('div', { class: 'hero-avatar emoji' }, baby.avatar || '👶');
    return h('section', { class: 'baby-hero' },
      h('div', { class: 'hero-stat' }, h('div', { class: 'hero-num num' }, g.length ? `${g.length}` : '—', h('small', null, ' 公分')), h('div', { class: 'tiny muted' }, '身長')),
      h('button', { class: 'hero-center', onclick: () => App.me && App.me.editBaby(baby), 'aria-label': '編輯寶寶資料' },
        avatar,
        h('div', { class: 'hero-name' }, baby.name),
        h('div', { class: 'tiny muted' }, age ? `${age.text}・${age.dayText}` : '')),
      h('div', { class: 'hero-stat' }, h('div', { class: 'hero-num num' }, g.weight ? `${g.weight}` : '—', h('small', null, ' 公斤')), h('div', { class: 'tiny muted' }, '體重')),
      store.state.babies.length > 1 ? h('button', { class: 'hero-switch link-btn tiny', onclick: switchBaby }, '切換寶寶') : null);
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

  const QUICK = [
    { type: 'breast', label: '親餵', active: 'feed' },
    { type: 'bottle', label: '瓶餵' },
    { type: 'diaper', label: '尿布' },
    { type: 'sleep', label: '睡眠', active: 'sleep' },
    { type: 'pump', label: '擠奶', active: 'pump' },
    { type: 'temp', label: '體溫' },
  ];
  function quickTiles() {
    const wrap = h('div', { class: 'quick-row', role: 'list' });
    QUICK.forEach((q) => {
      const def = App.LOG_TYPES[q.type];
      const last = store.lastLog(q.type);
      const running = q.active && store.state.active[q.active];
      const todayCount = store.logsOn(new Date()).filter((l) => l.type === q.type).length;
      let sub;
      if (running) sub = h('span', { class: 'qt-running num', dataset: { clock: running.start } }, '00:00');
      else if (last) sub = h('span', { dataset: { ago: last.start } }, C.ago(last.start));
      else sub = h('span', { class: 'faint' }, '尚無紀錄');
      const extra = q.type === 'breast' && last?.data?.lastSide && !running ? h('div', { class: 'tiny faint' }, `上次${last.data.lastSide === 'L' ? '左' : '右'}`) : null;
      wrap.append(h('div', { class: `quick-tile${running ? ' running' : ''}`, role: 'listitem', style: { '--tc': def.color } },
        todayCount ? h('span', { class: 'qt-badge' }, todayCount) : null,
        h('button', { class: 'qt-main', onclick: () => App.babylog.openAdd(q.type), 'aria-label': `新增${def.label}` },
          h('span', { class: 'qt-ico' }, def.icon),
          h('span', { class: 'qt-label' }, q.label),
          h('span', { class: 'qt-sub tiny' }, sub), extra),
        h('button', {
          class: 'qt-plus', 'aria-label': running ? `完成${def.label}` : `快速新增${def.label}`,
          onclick: () => {
            if (running) { App.timers.stop(q.type); ui.toast(`已記錄${def.label}`); return; }
            if (q.type === 'sleep') { App.timers.start('sleep'); ui.toast('開始記錄睡眠 😴'); return; }
            if (q.type === 'pump') { App.timers.start('pump'); ui.toast('開始擠奶計時'); return; }
            if (q.type === 'breast') { const side = last?.data?.lastSide === 'L' ? 'R' : 'L'; App.timers.start('breast', { side }); ui.toast(`開始餵${side === 'L' ? '左' : '右'}邊`); return; }
            App.babylog.openAdd(q.type);
          },
        }, running ? '✓' : '+')));
    });
    return wrap;
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
    const stage = store.stage;
    App.homeCards
      .filter((c) => c.stages.includes(stage))
      .sort((a, b) => a.order - b.order)
      .forEach((c) => {
        const slot = h('div', { class: 'home-slot', dataset: { card: c.id } });
        try { c.render(slot); } catch (e) { console.error(c.id, e); }
        if (slot.childNodes.length) el.append(slot);
      });
  }

  function stageSwitcher() {
    return h('div', { class: 'stage-switch' }, ui.seg(STAGES.map((s) => ({ value: s.value, label: s.label, icon: s.icon })), store.stage, (v) => {
      store.update((s) => { s.profile.stage = v; });
      if (v === 'baby' && !store.state.babies.length && App.me) App.me.editBaby();
    }, { small: true }));
  }

  App.screen('home', {
    title: '首頁',
    render(el) {
      const stage = store.stage;
      const name = store.state.profile.momName;
      const hour = new Date().getHours();
      const greet = hour < 5 ? '夜深了，辛苦了' : hour < 11 ? '早安' : hour < 14 ? '午安' : hour < 18 ? '午後好' : '晚安';
      el.append(h('div', { class: 'greet' }, h('div', { class: 'greet-hi' }, `${greet}${name ? `，${name}` : ''} 💜`), h('div', { class: 'tiny muted' }, C.fmtDateLong(new Date()))));
      el.append(stageSwitcher());

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
          el.append(h('div', { class: 'section-title' }, h('span', null, '今天'), h('a', { href: '#/log' }, '日記 ›')));
          if (today.length) {
            const s = App.babylog.daySummary(today);
            el.append(h('div', { class: 'today-chips' },
              h('span', { class: 'chip' }, `🍼 ${s.bottleMl} ml`), h('span', { class: 'chip' }, `餵 ${s.feedCount} 次`),
              h('span', { class: 'chip' }, `🧷 ${s.diaperCount}`), h('span', { class: 'chip' }, `😴 ${s.sleepMs ? C.fmtDuration(s.sleepMs) : '0'}`)));
            el.append(App.babylog.timeline(today, { limit: 6 }));
          } else {
            el.append(h('p', { class: 'small muted center' }, '今天還沒有紀錄，點上面的卡片開始吧！'));
          }
          el.append(h('div', { class: 'mt-lg' }));
        }
      }
      moduleCards(el);
      el.append(h('p', { class: 'disclaimer center' }, '本 App 內容為一般衛教與紀錄工具，不能取代專業醫療建議。如有身體不適請就醫。'));
    },
  });
}());
