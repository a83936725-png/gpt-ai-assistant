/* 易家做媽媽 — 手機通知 (Web Push from the member server).
 * A member turns it on for this phone and picks what she wants: 團購進度 (someone joined her team, one more to go, it
 * is full), 提醒 (餵奶、預約、滴雞精時光 from 提醒設定, also when the app is closed) and 家人共用. The reminders are sent
 * to the server only as a kind and a time (feed / appt / chicken at 21:30): what an appointment is about, or anything
 * else from her records, stays on the phone. iPhone needs the app on the home screen (iOS 16.4+).
 *   App.push = { status, enable, disable, setTopics, test, card, offer, jobs, sync } */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const TOPICS = [
    { key: 'gb', label: '團購進度', sub: '有人加入你的團、差 1 人、成團了' },
    { key: 'remind', label: '提醒', sub: '下面的餵奶、預約、滴雞精提醒，App 關著也會通知' },
    { key: 'family', label: '家人共用', sub: '家人加入你們的共用紀錄' },
  ];
  const ALL_ON = { gb: true, remind: true, family: true };
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const prefs = () => (store.state.settings && store.state.settings.push) || null; // {on, endpoint, topics}
  const keyBytes = (b64) => {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const sameKey = (a, b) => { if (!a || !b) return false; const x = new Uint8Array(a); return x.length === b.length && x.every((v, i) => v === b[i]); };
  async function serverKey() { const cfg = await App.account.config(); return cfg && cfg.push ? cfg.push : null; }
  async function registration() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await Promise.race([navigator.serviceWorker.ready, new Promise((r) => { setTimeout(() => r(null), 4000); })]); } catch (e) { return null; }
  }
  async function currentSub() { const r = await registration(); try { return r && r.pushManager ? await r.pushManager.getSubscription() : null; } catch (e) { return null; } }

  // what this phone can do now: unsupported | ios-home | no-server | soon | login | denied | off | on
  async function status() {
    const key = await serverKey();
    // 0.9.8: the site answers but has no push key yet (the live site before its settings are in): say so first, so an
    // iPhone is not sent to add the App to its home screen for something that is not open yet
    if (!key && (await App.account.config())) return { why: 'soon' };
    if (!supported()) return { why: isIOS() && !standalone() ? 'ios-home' : 'unsupported' };
    if (isIOS() && !standalone()) return { why: 'ios-home' };
    if (!key) return { why: 'no-server' };
    if (!store.state.auth) return { why: 'login' };
    if (Notification.permission === 'denied') return { why: 'denied' };
    const p = prefs();
    const sub = await currentSub();
    if (p && p.on && sub && sub.endpoint === p.endpoint) return { why: 'on', topics: { ...p.topics } };
    return { why: 'off' };
  }
  async function enable(topics = ALL_ON) {
    const key = await serverKey();
    if (!key) throw Object.assign(new Error('no-server'), { code: 'no-server' });
    if (!store.state.auth) throw Object.assign(new Error('login'), { code: 'login' });
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw Object.assign(new Error('denied'), { code: perm === 'denied' ? 'denied' : 'dismissed' });
    const reg = await registration();
    if (!reg || !reg.pushManager) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
    const appKey = keyBytes(key);
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options && sub.options.applicationServerKey && !sameKey(sub.options.applicationServerKey, appKey)) { await sub.unsubscribe(); sub = null; } // the server's key changed
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    const j = sub.toJSON();
    const t = { ...ALL_ON, ...topics };
    await App.account.call('POST', 'push/subscribe', { sub: { endpoint: j.endpoint, keys: j.keys }, topics: t });
    store.update((s) => { s.settings.push = { on: true, endpoint: j.endpoint, topics: t }; });
    lastSig = ''; sync();
    return t;
  }
  async function setTopics(topics) {
    const p = prefs(); const sub = await currentSub();
    if (!p || !sub) return enable(topics);
    const j = sub.toJSON();
    await App.account.call('POST', 'push/subscribe', { sub: { endpoint: j.endpoint, keys: j.keys }, topics });
    store.update((s) => { s.settings.push = { ...p, topics: { ...topics } }; });
    lastSig = ''; sync();
    return topics;
  }
  async function disable({ quiet = false } = {}) {
    const p = prefs(); const sub = await currentSub();
    const endpoint = (p && p.endpoint) || (sub && sub.endpoint);
    try { if (endpoint && store.state.auth) await App.account.call('POST', 'push/unsubscribe', { endpoint }); } catch (e) { /* the server forgets it when it bounces */ }
    try { if (sub) await sub.unsubscribe(); } catch (e) { /* already gone */ }
    store.update((s) => { s.settings.push = null; });
    if (!quiet) ui.toast('這支手機不會再收到通知');
  }
  // logged out: this phone's subscription goes (the server was told by account.js while the token was still there)
  async function forgetHere() { try { const sub = await currentSub(); if (sub) await sub.unsubscribe(); } catch (e) { /* already gone */ } }
  async function test() {
    const p = prefs();
    if (!p) return false;
    try { await App.account.call('POST', 'push/test', { endpoint: p.endpoint }); return true; } catch (e) { return false; }
  }

  /* ---------------- reminders: kinds and times only ---------------- */
  const at = (day, hhmm) => { const [hh, mm] = String(hhmm || '09:00').split(':').map(Number); const d = new Date(day); d.setHours(hh || 0, mm || 0, 0, 0); return d; };
  function jobs(now = new Date()) {
    const s = store.state; const out = [];
    (s.reminders || []).filter((r) => r.enabled).forEach((r) => {
      if (r.type === 'feed' && s.profile.stage === 'baby' && store.lastLog) {
        const last = store.lastLog(['breast', 'bottle']);
        const feeding = App.timers && App.timers.running().some((x) => x.base === 'feed');
        if (last && !feeding) {
          const pred = r.mode !== 'fixed' && App.predict ? App.predict.feed() : null;
          const due = pred && pred.next ? pred.next.getTime() : new Date(last.start).getTime() + (r.minutes || 180) * C.MIN;
          if (due > now.getTime()) out.push({ kind: 'feed', at: due });
        }
      }
      if (r.type === 'chicken') { // today if it is still ahead and she has not had one, else tomorrow; the server repeats it
        const today = at(now, r.time);
        const first = today > now && !(s.chicken && s.chicken.log && s.chicken.log[C.dateKey(now)]) ? today : at(C.addDays(now, 1), r.time);
        out.push({ kind: 'chicken', at: first.getTime(), daily: true });
      }
      if (r.type === 'appt' && App.reminders && App.reminders.upcomingAppointments) {
        for (let i = 0; i < 7; i += 1) {
          const day = C.addDays(C.startOfDay(now), i); const when = at(day, r.time);
          if (when > now && App.reminders.upcomingAppointments(day).length) out.push({ kind: 'appt', at: when.getTime() });
        }
      }
    });
    return out;
  }
  // the phone's coming reminders, sent when they change (and when the app goes to the background)
  let lastSig = ''; let syncT = 0;
  async function sync() {
    clearTimeout(syncT);
    const p = prefs();
    if (!p || !p.on || !store.state.auth) return false;
    const list = p.topics && p.topics.remind ? jobs() : [];
    const sig = JSON.stringify(list.map((j) => [j.kind, Math.round(j.at / 60e3), j.daily ? 1 : 0]));
    if (sig === lastSig) return false;
    try { await App.account.call('POST', 'push/schedule', { endpoint: p.endpoint, jobs: list }); lastSig = sig; return true; } catch (e) {
      if (e && e.status === 404 && e.code === 'no_device') store.update((s) => { s.settings.push = null; }); // the server dropped this phone
      return false;
    }
  }
  store.subscribe(() => { clearTimeout(syncT); if (prefs()) syncT = setTimeout(sync, 2500); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sync(); });
  // a tapped notification opens its page in the app that is already open
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'open' && typeof d.url === 'string' && d.url.startsWith('#/')) location.hash = d.url;
    });
  }
  // the local checker leaves system notifications to the server when this phone gets them from there
  const remindsHere = () => { const p = prefs(); return !!(p && p.on && p.topics && p.topics.remind); };

  /* ---------------- the settings card (提醒設定) ---------------- */
  const WHY = {
    unsupported: '這個瀏覽器不能收推播通知。可以改用手機的 Chrome，或 iPhone 把 App 加到主畫面。',
    'ios-home': 'iPhone 要先把 App 加到主畫面（Safari「分享」→「加入主畫面」），從主畫面打開後就能開啟通知（iOS 16.4 以上）。',
    'no-server': '這個網址還沒有開啟推播通知（例如網頁預覽版）。正式上線後就能使用。',
    soon: '手機通知即將開放，敬請期待。',
    login: '登入會員後，就能在 App 關著的時候也收到團購進度和提醒。',
    denied: '通知被封鎖了：請到手機的「設定 → 通知」或瀏覽器的網站設定，允許這個 App 傳送通知，再回來開啟。',
  };
  function card() {
    const box = h('section', { class: 'card push-card', 'aria-live': 'polite' }, h('div', { class: 'card-title' }, '手機通知'), h('p', { class: 'small muted' }, '讀取中…'));
    const paint = async () => {
      const st = await status();
      const line = await lineRow();
      box.innerHTML = '';
      box.append(h('div', { class: 'push-head' }, ui.pic('push', 52), h('div', { class: 'card-title' }, '手機通知')));
      if (st.why !== 'on' && st.why !== 'off') {
        box.append(h('p', { class: 'small muted push-why', dataset: { why: st.why } }, WHY[st.why]));
        if (st.why === 'login') box.append(h('button', { class: 'btn btn-sm btn-primary mt', onclick: () => App.navigate('login') }, '登入／註冊'));
        if (line) box.append(line);
        return;
      }
      if (st.why === 'off') {
        box.append(h('p', { class: 'small muted' }, 'App 關著也收得到：團購進度、提醒、家人的消息。隨時可以關。'),
          h('button', {
            class: 'btn btn-primary btn-block mt push-on',
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              try { await enable(); ui.toast('通知開了'); ui.celebrate({ from: box, emojis: ['🔔', '💜'] }); } catch (er) {
                const c = er && er.code;
                ui.toast(c === 'denied' ? '通知被封鎖了，請到設定允許通知' : c === 'dismissed' ? '沒有開啟通知' : c === 'login' ? '請先登入會員' : '開啟失敗，請稍後再試'); // eslint-disable-line no-nested-ternary
              }
              paint();
            },
          }, '🔔 開啟手機通知'));
        if (line) box.append(line);
        return;
      }
      const t = st.topics || {};
      box.append(h('p', { class: 'small muted' }, '這支手機會收到：'));
      TOPICS.forEach((tp) => {
        const sw = h('input', { type: 'checkbox', class: 'switch', checked: !!t[tp.key], 'aria-label': tp.label, dataset: { topic: tp.key } });
        sw.addEventListener('change', async () => {
          const next = { ...t, [tp.key]: sw.checked };
          try { await setTopics(next); t[tp.key] = sw.checked; } catch (e) { sw.checked = !sw.checked; ui.toast('沒有改成功，請再試一次'); }
        });
        box.append(h('label', { class: 'row between switch-row push-topic' }, h('span', null, h('b', null, tp.label), h('span', { class: 'tiny muted push-sub' }, tp.sub)), sw));
      });
      box.append(h('div', { class: 'row gap mt' },
        h('button', { class: 'btn btn-sm btn-soft grow push-test', onclick: async () => { ui.toast((await test()) ? '已傳一則測試通知' : '測試通知沒有送出，請稍後再試'); } }, '傳一則測試通知'),
        h('button', { class: 'btn btn-sm btn-ghost push-off', onclick: async () => { await disable(); paint(); } }, '關閉')));
      if (line) box.append(line);
      box.append(h('p', { class: 'tiny faint mt' }, '提醒只把「種類和時間」交給伺服器（例如 21:30 餵奶提醒），預約的內容不會離開這支手機。'));
    };
    paint();
    return box;
  }
  // LINE members: group-buy and family news also as a LINE message from the official account (no Web Push needed,
  // so it works on an iPhone that has not added the app to the home screen)
  async function lineRow() {
    const cfg = await App.account.config();
    const au = store.state.auth && store.state.auth.user;
    if (!cfg || !cfg.lineNotify || !au || au.provider !== 'line') return null;
    const sw = h('input', { type: 'checkbox', class: 'switch', checked: !!store.state.settings.lineNotify, 'aria-label': 'LINE 通知' });
    sw.addEventListener('change', async () => {
      try {
        await App.account.call('POST', 'push/line', { on: sw.checked });
        store.update((s) => { s.settings.lineNotify = sw.checked; });
        ui.toast(sw.checked ? '團購進度和家人消息，也會用 LINE 通知你' : '不會再用 LINE 通知');
      } catch (e) { sw.checked = !sw.checked; ui.toast('沒有改成功，請再試一次'); }
    });
    const oa = (window.BRAND || {}).lineOaUrl;
    return h('div', { class: 'push-line' },
      h('label', { class: 'row between switch-row push-topic' }, h('span', null, h('b', null, 'LINE 通知'), h('span', { class: 'tiny muted push-sub' }, '團購進度和家人消息，也由官方帳號傳 LINE 給你（要先加官方帳號好友）')), sw),
      oa ? h('a', { class: 'link-btn small', href: oa, target: '_blank', rel: 'noopener' }, '加官方帳號好友 ›') : null);
  }
  // a small inline offer where news matters (after starting or joining a team): only when it can work and is off
  function offer(el, { text = '成團時通知我', topic = 'gb' } = {}) {
    if (!supported() || (isIOS() && !standalone())) return;
    status().then((st) => {
      if (st.why !== 'off' || !el.isConnected) return;
      el.append(h('button', {
        class: 'btn btn-sm btn-soft push-offer',
        onclick: async (e) => {
          const btn = e.currentTarget; btn.disabled = true;
          try { await enable({ ...ALL_ON, [topic]: true }); btn.textContent = '已開啟通知 🔔'; ui.toast('有進度會通知你'); } catch (er) { btn.disabled = false; ui.toast(er && er.code === 'denied' ? '通知被封鎖了，請到設定允許通知' : '沒有開啟通知'); }
        },
      }, `🔔 ${text}`));
    });
  }

  App.push = {
    status, enable, disable, setTopics, test, card, offer, jobs, sync, remindsHere, forgetHere, TOPICS,
  };
}());
