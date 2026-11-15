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
  const checkIn = (delta = 1) => {
    store.update((s) => {
      const k = C.dateKey();
      const v = Math.max(0, (s.chicken.log[k] || 0) + delta);
      if (v) s.chicken.log[k] = v; else delete s.chicken.log[k];
    });
    if (delta > 0) ui.toast(['今天也好好照顧自己了 💜', '打卡成功！給自己一個擁抱', '溫熱一杯，休息一下 ☕'][Math.floor(Math.random() * 3)]);
  };
  App.chicken = { todayCount, streak, checkIn };

  const STAGE_COPY = {
    prep: '備孕的日子，也要記得好好吃飯、好好休息。',
    preg: '孕期的每一天，都值得被溫柔對待。',
    baby: '照顧寶寶之餘，也別忘了照顧自己。',
  };

  function checkinCard({ compact = false } = {}) {
    const n = todayCount();
    const goal = store.state.chicken.goal || 1;
    const done = n >= goal;
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = C.addDays(new Date(), -i);
      const on = !!store.state.chicken.log[C.dateKey(d)];
      days.push(h('div', { class: `cd-day${on ? ' on' : ''}${i === 0 ? ' today' : ''}` }, h('span', { class: 'cd-dot' }, on ? '💜' : ''), h('span', { class: 'tiny' }, C.WEEKDAYS[d.getDay()])));
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

  App.homeCard('chicken', { stages: ['prep', 'preg', 'baby'], order: 20, render(el) { el.append(checkinCard({ compact: true })); } });

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
      el.append(monthGrid());
      el.append(h('section', { class: 'card' },
        h('div', { class: 'card-title' }, '🔔 每日提醒'),
        h('p', { class: 'small muted' }, '設定一個固定時間，提醒自己停下來，喝一杯、休息一下。'),
        h('button', { class: 'btn btn-sm btn-soft mt', onclick: () => App.navigate('reminders') }, '設定提醒')));
      el.append(h('section', { class: 'card soft' },
        h('div', { class: 'card-title' }, '☕ 加熱與飲用小提醒'),
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

  App.tool({ id: 'brand', title: '滴雞精時光', icon: '💜', desc: '每日打卡、連續天數', stages: ['prep', 'preg', 'baby'], screen: 'brand', order: 90, group: '易家' });
}());
