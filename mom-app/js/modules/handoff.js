/* 易家做媽媽 — 交接卡 (handing the baby over: one page says where things stand).
 * The next person sees at a glance: the last feed (and which side to start with), when the next one is likely, the last
 * diaper, sleep (asleep for how long, or when sleep is likely), today so far, which bag of breast milk to use first, a
 * medicine or temperature from the last 24 hours (in the app only), any timer running, and a note.
 * With 家人共用紀錄 the card goes to the family's phones (encrypted, like the records) and 「換你囉」 sends them a plain
 * notification (the server only learns that a handoff happened). Without it, the words go by LINE — without 用藥 or 體溫.
 *   App.handoff = { summary, open, banner, text, deviceTag } */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const NOTE_MAX = 80;
  const FRESH_MS = 6 * C.HOUR; // a handoff shows on the other phones for 6 hours
  const DAY = 24 * C.HOUR;

  // this phone (not synced, not in backups): tells my own handoffs from the family's
  const deviceTag = () => {
    try {
      let v = localStorage.getItem('yijia-device');
      if (!v) { v = C.uid(); localStorage.setItem('yijia-device', v); }
      return v;
    } catch (e) { return 'this-phone'; }
  };
  const side = (s) => (s === 'L' ? '左' : s === 'R' ? '右' : ''); // eslint-disable-line no-nested-ternary
  const hm = (ms) => C.fmtDuration(Math.max(0, ms));
  const babyLogs = (b) => (store.state.logs || []).filter((l) => l.babyId === b.id);
  const lastOf = (logs, types) => logs.filter((l) => types.includes(l.type)).reduce((a, x) => (!a || x.start > a.start ? x : a), null);

  function summary(b = store.baby(), now = new Date()) {
    if (!b) return null;
    const t = now.getTime();
    const logs = babyLogs(b);
    const out = { baby: b, at: now.toISOString() };
    // feeding
    const feed = lastOf(logs, ['breast', 'bottle']);
    if (feed) {
      const d = feed.data || {};
      out.feed = {
        at: feed.start, ago: t - new Date(feed.start).getTime(), type: feed.type,
        detail: feed.type === 'bottle' ? `瓶餵 ${d.ml || 0} ml（${d.kind === 'formula' ? '配方奶' : '母乳'}）` : [d.leftMin ? `左 ${d.leftMin} 分` : '', d.rightMin ? `右 ${d.rightMin} 分` : ''].filter(Boolean).join('＋') || '親餵',
        nextSide: feed.type === 'breast' && d.lastSide ? (d.lastSide === 'L' ? 'R' : 'L') : null,
      };
    }
    const pf = App.predict && App.predict.feed ? App.predict.feed(t) : null;
    if (pf && pf.next && store.baby() && store.baby().id === b.id) out.next = { at: pf.next.toISOString(), inMs: pf.next.getTime() - t };
    // diapers
    const dp = lastOf(logs, ['diaper']);
    if (dp) out.diaper = { at: dp.start, ago: t - new Date(dp.start).getTime(), kind: ({ wet: '濕', dirty: '便便', mixed: '尿＋便' })[(dp.data || {}).kind] || '' };
    // sleep: asleep now, or awake since and when sleep is likely
    const act = store.state.active || {};
    const sleepKey = Object.keys(act).find((k) => /^sleep(@|$)/.test(k) && act[k] && (act[k].babyId || b.id) === b.id);
    if (sleepKey) out.sleep = { asleep: true, since: act[sleepKey].start, forMs: t - new Date(act[sleepKey].start).getTime() };
    else {
      const ps = App.predict && App.predict.sleep && store.baby() && store.baby().id === b.id ? App.predict.sleep(t) : null;
      if (ps && ps.awakeSince) out.sleep = { asleep: false, awakeSince: ps.awakeSince, awakeMs: t - new Date(ps.awakeSince).getTime(), from: ps.from.toISOString(), to: ps.to.toISOString() };
    }
    // today so far
    const today = logs.filter((l) => C.dateKey(new Date(l.start)) === C.dateKey(now));
    const feeds = today.filter((l) => l.type === 'breast' || l.type === 'bottle');
    out.today = {
      feeds: feeds.length, ml: C.sum(feeds.filter((l) => l.type === 'bottle'), (l) => l.data && l.data.ml), diapers: today.filter((l) => l.type === 'diaper').length,
      sleepMs: C.sum(today.filter((l) => l.type === 'sleep' && l.end), (l) => new Date(l.end) - new Date(l.start)),
    };
    // breast milk: which bag first
    const bags = (store.state.milk || []).filter((x) => !x.usedAt && x.ml > 0 && C.milkExpiry(x) > now).sort((x, y) => C.milkExpiry(x) - C.milkExpiry(y));
    if (bags.length) {
      out.milk = { fridge: bags.filter((x) => x.storage === 'fridge').length, freezer: bags.filter((x) => x.storage === 'freezer').length, room: bags.filter((x) => x.storage === 'room').length, first: { ml: bags[0].ml, pumpedAt: bags[0].pumpedAt, storage: bags[0].storage } };
    }
    // medicine and temperature in the last 24 hours (in the app only)
    out.meds = logs.filter((l) => l.type === 'med' && t - new Date(l.start).getTime() < DAY).sort((x, y) => (x.start < y.start ? 1 : -1)).slice(0, 3)
      .map((l) => ({ at: l.start, name: (l.data && l.data.name) || '用藥', dose: (l.data && l.data.dose) || '' }));
    const tp = logs.filter((l) => l.type === 'temp' && t - new Date(l.start).getTime() < DAY).sort((x, y) => (x.start < y.start ? 1 : -1))[0];
    if (tp) out.temp = { at: tp.start, c: Number(tp.data && tp.data.c) };
    // timers running for this baby (and 擠奶)
    out.timers = Object.keys(act).filter((k) => act[k] && /^(feed|sleep|pump)/.test(k) && (k.startsWith('pump') || (act[k].babyId || b.id) === b.id)).map((k) => ({ kind: k.split('@')[0], since: act[k].start, side: act[k].side }));
    return out;
  }

  /* ---------------- the words ---------------- */
  const where = { fridge: '冷藏', freezer: '冷凍', room: '室溫' };
  function rows(s, { medical = true } = {}) {
    const r = [];
    if (s.feed) {
      r.push(['🍼', '上次餵奶', `${C.fmtTime(s.feed.at)}（${hm(s.feed.ago)}前）・${s.feed.detail}`, s.feed.nextSide ? `下次先餵${side(s.feed.nextSide)}邊` : '']);
    }
    if (s.next) r.push(['⏰', '下一餐大約', s.next.inMs > 0 ? `${C.fmtTime(s.next.at)}（再 ${hm(s.next.inMs)}）` : `${C.fmtTime(s.next.at)}（已經到了）`, '']);
    if (s.diaper) r.push(['🧷', '上次換尿布', `${C.fmtTime(s.diaper.at)}（${hm(s.diaper.ago)}前）${s.diaper.kind ? `・${s.diaper.kind}` : ''}`, '']);
    if (s.sleep && s.sleep.asleep) r.push(['😴', '正在睡', `從 ${C.fmtTime(s.sleep.since)} 睡到現在（${hm(s.sleep.forMs)}）`, '']);
    else if (s.sleep) {
      const t = new Date(s.at).getTime(); const from = new Date(s.sleep.from).getTime(); const to = new Date(s.sleep.to).getTime();
      const when = t > to ? '已超過建議清醒時間，可能累了' : t >= from ? '現在是睡意窗口，可以準備哄睡' : `大約 ${C.fmtTime(s.sleep.from)}–${C.fmtTime(s.sleep.to)} 會想睡`; // eslint-disable-line no-nested-ternary
      r.push(['🌙', '醒著', `${hm(s.sleep.awakeMs)}・${when}`, '']);
    }
    const td = s.today;
    if (td && (td.feeds || td.diapers || td.sleepMs)) r.push(['📊', '今天', [`喝奶 ${td.feeds} 次${td.ml ? `（瓶餵 ${td.ml} ml）` : ''}`, `尿布 ${td.diapers} 片`, td.sleepMs ? `睡 ${(td.sleepMs / C.HOUR).toFixed(1).replace(/\.0$/, '')} 小時` : ''].filter(Boolean).join('・'), '']);
    if (s.milk) {
      const parts = ['fridge', 'freezer', 'room'].filter((k) => s.milk[k]).map((k) => `${where[k]} ${s.milk[k]} 包`);
      r.push(['🧊', '母乳庫存', parts.join('・'), `先用 ${C.fmtDate(new Date(s.milk.first.pumpedAt), false)} 擠的那包（${where[s.milk.first.storage] || ''} ${s.milk.first.ml} ml）`]);
    }
    if (medical) {
      s.meds.forEach((m) => r.push(['💊', '用藥', `${C.fmtTime(m.at)}・${m.name}${m.dose ? ` ${m.dose}` : ''}`, '']));
      if (s.temp) r.push(['🌡️', '體溫', `${C.fmtTime(s.temp.at)}・${s.temp.c ? s.temp.c.toFixed(1) : '-'} °C`, '']);
    }
    s.timers.forEach((x) => r.push(['⏱', { feed: '親餵計時中', sleep: '睡眠計時中', pump: '擠奶計時中' }[x.kind] || '計時中', `從 ${C.fmtTime(x.since)}${x.kind === 'feed' && x.side ? `・${side(x.side)}邊` : ''}`, '']));
    return r;
  }
  // the LINE version: no medicine, no temperature
  function text(s, note = '') {
    const L = [`【交接・${s.baby.name || '寶寶'}】${C.fmtTime(s.at)}`];
    rows(s, { medical: false }).forEach(([ico, k, v, extra]) => L.push(`${ico} ${k} ${v}${extra ? `，${extra}` : ''}`));
    if (note) L.push(`📝 ${note}`);
    return L.join('\n');
  }

  /* ---------------- the sheet ---------------- */
  const cleanNote = (v) => Array.from(String(v || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, NOTE_MAX).join('');
  const famOn = () => !!(App.family && App.family.active && App.family.active()); // in a family (who else is in it changes on other phones)
  // the card's body and buttons: in a sheet (open) or on the 交接卡 screen
  function parts(b, { from = null, done = () => {} } = {}) {
    const s = summary(b);
    const list = h('div', { class: 'ho-rows' }, rows(s).map(([ico, k, v, extra]) => h('div', { class: 'ho-row' },
      h('span', { class: 'ho-ico', 'aria-hidden': 'true' }, ico),
      h('div', { class: 'grow' }, h('div', { class: 'ho-k' }, k), h('div', { class: 'ho-v' }, v), extra ? h('div', { class: 'ho-x' }, extra) : null))));
    const note = h('textarea', { class: 'input ho-note', rows: 2, maxlength: String(NOTE_MAX), placeholder: '交代事項（例如：有點鼻塞，洗澡先跳過）', 'aria-label': '交代事項' });
    const sendBtn = h('button', { class: 'btn btn-primary grow ho-send' }, famOn() ? '📲 交給家人・通知「換你囉」' : '💬 用 LINE 傳給家人');
    const copyBtn = h('button', { class: 'btn btn-soft ho-copy' }, '複製');
    const body = h('div', { class: 'ho' },
      from ? h('div', { class: 'ho-from', role: 'note' }, h('b', null, `${from.by || '家人'}交給你的（${C.fmtTime(from.at)}）`), from.note ? h('p', null, `「${from.note}」`) : null) : null,
      h('p', { class: 'tiny muted ho-now' }, `現在 ${C.fmtTime(s.at)}・依手機上的紀錄整理`),
      rows(s).length ? list : h('p', { class: 'small muted' }, '還沒有今天的紀錄。記一筆餵奶或尿布，交接卡就會自動整理。'),
      from ? null : h('div', { class: 'ho-lbl small bold' }, '交代事項'), from ? null : note,
      from ? null : h('p', { class: 'tiny faint ho-how' }, famOn() ? '交接卡會加密傳到家人手機，通知只寫「換你囉」，伺服器看不到內容。' : '開啟「家人共用紀錄」，家人的手機會自動收到交接卡和通知。用 LINE 傳的文字不包含用藥和體溫。'));
    const footer = from ? h('button', { class: 'btn btn-primary btn-block ho-ok', onclick: () => done() }, '知道了 💜') : h('div', { class: 'row gap' }, copyBtn, sendBtn);
    copyBtn.addEventListener('click', async () => {
      const words = text(summary(b), cleanNote(note.value));
      try { if (App.share && App.share.copyText) await App.share.copyText(words); else await navigator.clipboard.writeText(words); ui.toast('已複製交接內容'); } catch (e) { ui.toast('複製失敗'); }
    });
    sendBtn.addEventListener('click', async () => {
      const n = cleanNote(note.value);
      if (!famOn()) {
        window.open(`https://line.me/R/share?text=${encodeURIComponent(text(summary(b), n))}`, '_blank', 'noopener');
        ui.toast('已開啟 LINE，選家人就能傳出去');
        return;
      }
      sendBtn.disabled = true;
      const rec = {
        id: C.uid(), babyId: b.id, at: new Date().toISOString(), by: store.state.profile.member || '家人', dev: deviceTag(), note: n,
      };
      store.update((st) => { st.handoffs = [...(st.handoffs || []), rec].slice(-20); });
      try {
        await App.family.sync(); // the card is on the family's server before anyone is told
        const r = await App.account.call('POST', 'family/nudge', { kind: 'handoff' });
        done();
        ui.toast(r && r.sent ? '已通知家人：換你顧寶寶囉 💜' : '交接卡已傳給家人（家人沒開手機通知，打開 App 就會看到）');
        ui.celebrate({ emojis: ['🤝', '💜'] });
      } catch (e) { sendBtn.disabled = false; ui.toast('暫時傳不出去，交接卡會在連上網路後同步'); }
    });
    return { body, footer };
  }
  function open(b = store.baby(), { from = null } = {}) {
    if (!b) { ui.toast('先新增寶寶，才能做交接卡'); return null; }
    let sh = null;
    const p = parts(b, { from, done: () => sh && sh.close() });
    sh = ui.sheet({ title: `🤝 交接卡・${b.name || '寶寶'}`, body: p.body, footer: p.footer });
    return sh;
  }
  App.screen('handoff', {
    title: '交接卡',
    tab: 'home',
    liveUpdate: false, // the note is typed here
    render(el) {
      const b = store.baby();
      if (!b) { el.append(ui.card({ class: 'soft center' }, h('p', null, '先新增寶寶，才能做交接卡。'))); return; }
      const p = parts(b, { done: () => App.navigate('home') });
      el.append(ui.card({ class: 'ho-card' }, h('div', { class: 'card-title' }, `🤝 ${b.name || '寶寶'}的交接卡`), p.body), h('div', { class: 'ho-foot' }, p.footer));
    },
  });

  /* ---------------- 首頁: a handoff from the family ---------------- */
  function latestFor(b) {
    const mine = deviceTag(); const now = Date.now();
    const seen = (store.state.settings && store.state.settings.handoffSeen) || {};
    return (store.state.handoffs || []).filter((x) => x && x.babyId === b.id && x.dev !== mine && !seen[x.id] && now - new Date(x.at).getTime() < FRESH_MS)
      .sort((x, y) => (x.at < y.at ? 1 : -1))[0] || null;
  }
  function banner(b = store.baby()) {
    if (!b) return null;
    const x = latestFor(b); if (!x) return null;
    const seenIt = () => store.update((s) => { s.settings.handoffSeen = { ...(s.settings.handoffSeen || {}), [x.id]: new Date().toISOString() }; });
    return h('div', { class: 'ho-banner' },
      h('button', { type: 'button', class: 'moment-line ho-go', onclick: () => { open(b, { from: x }); seenIt(); } },
        h('span', { class: 'moment-emoji', 'aria-hidden': 'true' }, '🤝'),
        h('span', { class: 'grow' }, h('strong', null, `${x.by || '家人'}把寶寶交給你了`), h('span', { class: 'moment-more' }, `${C.fmtTime(x.at)}・${x.note ? `「${x.note}」` : '看交接卡'}`)),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')),
      h('button', { type: 'button', class: 'icon-btn ho-x', 'aria-label': '知道了，關掉這則交接', onclick: () => { seenIt(); App.refresh(); } }, '✕'));
  }

  App.tool({
    id: 'handoff', title: '交接卡', icon: '🤝', desc: '換手顧寶寶時，一頁看懂現在的狀況', stages: ['baby'], screen: 'handoff', order: 34, group: '紀錄分析',
    tags: ['交接', '換手', '爸爸', '家人', '輪班', '接班'],
  });

  App.handoff = {
    summary, open, banner, text, rows, deviceTag,
  };
}());
