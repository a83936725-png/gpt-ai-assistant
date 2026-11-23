/* 易家滴雞精 — brand page + daily 滴雞精時光 check-in (habit tracker).
 * 注意：食品不可宣稱醫療效能（食安法第 28 條），文案只談習慣、心情與保存飲用方式。 */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const B = () => window.BRAND || {};

  const todayCount = () => store.state.chicken.log[C.dateKey()] || 0;
  const streak = () => {
    let n = 0; let d = new Date();
    if (!store.state.chicken.log[C.dateKey(d)]) d = C.addDays(d, -1); // today not yet counted doesn't break streak
    while (store.state.chicken.log[C.dateKey(d)]) { n += 1; d = C.addDays(d, -1); }
    return n;
  };
  const STREAKS = [7, 14, 21, 30, 60, 100, 180, 365];
  const checkIn = (delta = 1) => {
    const first = !todayCount();
    store.update((s) => {
      const k = C.dateKey();
      const v = Math.max(0, (s.chicken.log[k] || 0) + delta);
      if (v) s.chicken.log[k] = v; else delete s.chicken.log[k];
    });
    if (delta <= 0) return;
    const n = streak();
    if (first && STREAKS.includes(n)) { // a streak worth celebrating (counted once, on the day's first check-in)
      ui.toast(`滴雞精時光，連續 ${n} 天了`, 3500);
      ui.celebrate({ emojis: ['🎉', '✨', '🌟'] });
    } else ui.toast(`記下了・今天 ${todayCount()} 次`); // a plain line (it used to pick one of three pep talks at random)
  };
  App.chicken = { todayCount, streak, checkIn };

  // what the button does, said plainly (these used to be slogans: 「孕期的每一天，都值得被溫柔對待」, 「也要好好疼自己」)
  const STAGE_COPY = { prep: '喝了就打卡，這週喝了幾天一看就知道。', preg: '喝了就打卡，這週喝了幾天一看就知道。', baby: '喝了就打卡，這週喝了幾天一看就知道。' };
  const SHORT_COPY = { prep: '喝了就點一下', preg: '喝了就點一下', baby: '喝了就點一下' };

  function checkinCard({ compact = false } = {}) {
    const n = todayCount();
    const goal = store.state.chicken.goal || 1;
    const done = n >= goal;
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = C.addDays(new Date(), -i);
      const on = !!store.state.chicken.log[C.dateKey(d)];
      days.push(h('div', { class: `cd-day${on ? ' on' : ''}${i === 0 ? ' today' : ''}` }, h('span', { class: 'cd-dot', role: 'img', 'aria-label': on ? '有打卡' : '沒有打卡' }), h('span', { class: 'tiny' }, C.WEEKDAYS[d.getDay()])));
    }
    return h('section', { class: `card chicken-card${done ? ' done' : ''}` },
      h('div', { class: 'row gap' },
        h('img', { src: B().logo || 'assets/logo.svg', alt: B().brandName || '', class: 'chicken-logo' }),
        h('div', { class: 'grow' },
          h('div', { class: 'card-title' }, '今天的滴雞精時光'),
          h('div', { class: 'card-sub' }, done ? `已完成 ${n} 次・連續 ${streak()} 天` : STAGE_COPY[store.stage])),
        done
          ? h('button', { class: 'btn btn-sm btn-soft', onclick: () => checkIn(1) }, `+1（${n}）`)
          : h('button', { class: 'btn btn-sm btn-primary', onclick: () => checkIn(1) }, '打卡')),
      h('div', { class: 'cd-week' }, days),
      compact ? h('button', { class: 'link-btn small', onclick: () => App.navigate('brand') }, `認識${B().brandName || '品牌'} ›`) : null);
  }

  /* ---------- 今日小任務：葉酸／維他命＋滴雞精＋喝水，一張卡完成每天的自我照顧 ---------- */
  // 喝水 has no target of ours: 「8 杯」 had no source behind it. One glass ticks the task; the count is hers to read.
  const dayLog = () => store.state.daily.log[C.dateKey()] || {};
  const setWater = (n) => store.update((s) => {
    const k = C.dateKey();
    s.daily.log[k] = { ...(s.daily.log[k] || {}), water: Math.max(0, Math.min(16, n)) };
  });
  // finishing a task gives its tick a little pop; finishing the last one of the day is celebrated (once a day)
  let lastTapped = null;
  function tapTask(t, e, tasks) {
    const before = tasks.filter((x) => x.done).length;
    const at = (e.currentTarget.closest('.daily-card') || e.currentTarget).getBoundingClientRect();
    lastTapped = t.id;
    t.tap();
    const list = dailyTasks();
    if (list.every((x) => x.done) && before < list.length && !(dayLog().cheered)) {
      store.update((s) => { const k = C.dateKey(); s.daily.log[k] = { ...(s.daily.log[k] || {}), cheered: true }; });
      // said once a day, quietly: everyday tasks are not a milestone (no confetti)
      setTimeout(() => { ui.toast(`今天的 ${list.length} 件小事都記了`, 3000); }, 120);
    }
  }
  // the brand's own logo for 滴雞精時光; line icons (the app's set) for the others
  const WATER_LINE = "<path d='M6.5 4.5h11l-1.4 14.2a2 2 0 0 1-2 1.8H9.9a2 2 0 0 1-2-1.8Z'/><path d='M7.3 11.5c1.6-.9 3.2-.9 4.7 0s3.1.9 4.7 0'/>";
  function dailyIcon(kind) {
    if (kind === 'brand') return h('img', { src: B().logo || 'assets/logo.svg', alt: '', class: 'daily-logo' });
    const line = kind === 'water' ? WATER_LINE : (App.LOG_LINE || {})[kind] || '';
    return h('span', { class: 'daily-svg', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${line}</svg>` });
  }
  function dailyTasks() {
    const stages = store.stages();
    const tasks = [];
    if (stages.includes('prep') || stages.includes('preg')) {
      const done = !!store.state.folic.log[C.dateKey()];
      tasks.push({
        id: 'folic', icon: 'med', label: stages.includes('preg') ? '葉酸／孕婦維他命' : '葉酸', done,
        sub: done ? '今天吃過了' : '每天一顆',
        tap: () => {
          if (App.preg && App.preg.toggleFolic) App.preg.toggleFolic();
          else store.update((s) => { const k = C.dateKey(); if (s.folic.log[k]) delete s.folic.log[k]; else s.folic.log[k] = true; });
        },
      });
    }
    const n = todayCount();
    tasks.push({
      id: 'chicken', icon: 'brand', label: '滴雞精時光', done: n >= (store.state.chicken.goal || 1),
      sub: n ? `今天 ${n} 次・連續 ${streak()} 天` : SHORT_COPY[store.stage] || SHORT_COPY.baby,
      tap: () => checkIn(1),
    });
    const w = dayLog().water || 0;
    tasks.push({
      id: 'water', icon: 'water', label: '喝水', done: w >= 1, sub: w ? `今天 ${w} 杯` : '喝了一杯就點一下', tap: () => setWater(w + 1), minus: w > 0 ? () => setWater(w - 1) : null,
    });
    return tasks;
  }
  function dailyCard() {
    const tasks = dailyTasks();
    const doneCount = tasks.filter((t) => t.done).length;
    const justId = lastTapped; lastTapped = null;
    return h('section', { class: 'card daily-card' },
      h('div', { class: 'row between' },
        h('div', { class: 'card-title' }, '今日小任務', h('span', { class: `tag ${doneCount === tasks.length ? 'ok' : 'primary'}` }, `${doneCount}/${tasks.length}`)),
        h('button', { class: 'link-btn tiny daily-brand', onclick: () => App.navigate('brand') },
          h('img', { src: B().logo || 'assets/logo.svg', alt: '' }), B().brandName || '品牌')),
      h('div', { class: 'daily-list' }, tasks.map((t) => h('div', { class: `daily-item${t.done ? ' done' : ''}${t.done && t.id === justId ? ' just' : ''}` },
        h('button', { class: 'daily-main', onclick: (e) => tapTask(t, e, tasks), 'aria-label': `${t.label}：${t.sub}，點一下記錄` },
          h('span', { class: 'daily-ico' }, t.done ? '✓' : dailyIcon(t.icon)),
          h('span', { class: 'daily-text' }, h('b', null, t.label), h('span', { class: 'tiny muted' }, t.sub))),
        t.minus ? h('button', { class: 'daily-minus', 'aria-label': `${t.label}減一`, onclick: t.minus }, '−') : null))));
  }
  App.dailyCard = dailyCard;
  App.homeCard('daily', { stages: ['prep', 'preg', 'baby'], order: 20, render(el) { el.append(dailyCard()); } });

  function monthGrid() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first.getDay(); i += 1) cells.push(h('span', { class: 'mg-cell empty' }));
    for (let d = 1; d <= daysIn; d += 1) {
      const k = C.dateKey(new Date(now.getFullYear(), now.getMonth(), d));
      const n = store.state.chicken.log[k] || 0;
      cells.push(h('span', { class: `mg-cell${n ? ' on' : ''}${d === now.getDate() ? ' today' : ''}`, title: `${d} 日${n ? `：${n} 次` : ''}` }, d));
    }
    const count = Object.keys(store.state.chicken.log).filter((k) => k.startsWith(C.dateKey(now).slice(0, 7))).length;
    return h('section', { class: 'card' },
      h('div', { class: 'card-title' }, `${now.getMonth() + 1} 月打卡`, h('span', { class: 'tag primary' }, `${count} 天`)),
      h('div', { class: 'mg-head tiny faint' }, C.WEEKDAYS.map((w) => h('span', null, w))),
      h('div', { class: 'month-grid' }, cells));
  }

  App.screen('brand', {
    title: () => B().brandName || '品牌',
    render(el) {
      const b = B();
      el.append(h('section', { class: 'brand-hero center' },
        h('img', { src: b.logoFull || b.logo, alt: b.brandName || '', class: 'brand-hero-logo' }),
        h('p', { class: 'brand-story' }, b.story || '')));
      el.append(checkinCard());
      const gb = App.groupbuy && App.groupbuy.brandCard(); // 團購揪團, while one is on
      if (gb) el.append(gb);
      if (App.share) {
        el.append(h('div', { class: 'grid-2 mt' },
          h('button', { class: 'btn btn-soft', onclick: () => (streak() >= 3 ? App.share.open({ kind: 'streak', sheetTitle: '分享打卡成就' }) : App.share.open({ title: `${B().brandName || ''}陪我照顧自己`, text: `我在用「${B().appName || '易家做媽媽'}」每天留一點時間給自己 💜`, campaign: 'brand', emoji: '💜', kicker: B().brandName || '', theme: 'purple' })) }, '📤 分享打卡'),
          h('button', { class: 'btn btn-primary', onclick: () => App.navigate('invite') }, '💌 邀請好友')));
      }
      el.append(monthGrid());
      el.append(h('section', { class: 'card' },
        h('div', { class: 'card-title' }, '每日提醒'),
        h('p', { class: 'small muted' }, '設定一個固定時間，提醒自己停下來，喝一杯、休息一下。'),
        h('button', { class: 'btn btn-sm btn-soft mt', onclick: () => App.navigate('reminders') }, '設定提醒')));
      el.append(h('section', { class: 'card soft' },
        h('div', { class: 'card-title' }, '加熱與飲用小提醒'),
        h('ul', { class: 'small tight' },
          h('li', null, '冷凍品可先移到冷藏退冰，或連同包裝隔水加熱；不建議整包直接微波。'),
          h('li', null, '開封後請盡快飲用完畢，未喝完勿再冷凍。'),
          h('li', null, '有特殊飲食限制（例如醫師要求限制蛋白質或鈉）時，請先詢問醫師或營養師。'),
          h('li', null, '保存方式與期限請以產品包裝標示為準。'))));
      const links = [];
      if (b.shopUrl) links.push(h('a', { class: 'btn btn-primary grow', href: b.shopUrl, target: '_blank', rel: 'noopener' }, '前往官網選購'));
      if (b.lineOaUrl) links.push(h('a', { class: 'btn btn-line grow', href: b.lineOaUrl, target: '_blank', rel: 'noopener', html: `${ui.ICONS.line}<span>加入 LINE 好友</span>` }));
      if (b.phone) links.push(h('a', { class: 'btn btn-ghost grow', href: `tel:${b.phone}` }, `客服 ${b.phone}`));
      if (links.length) el.append(h('div', { class: 'row gap wrap mt' }, links));
      el.append(h('p', { class: 'disclaimer' }, '本頁為生活習慣紀錄功能。食品不具醫療效能，身體狀況請諮詢醫師。'));
    },
  });
  // 品牌入口：首頁「今日小任務」、我的、好孕島小舖（不放在「健康」醫療工具裡）
}());
