/* 我的 — profile, babies, onboarding, family sharing (backup/merge + LINE invite), reminders, theme, demo data. */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const B = () => window.BRAND || {};

  /* ================= baby editor ================= */
  const AVATARS = ['👶', '👧', '👦', '🐣', '🐻', '🐰', '🐱', '🦊', '🐼', '🌸', '⭐', '🍼'];
  function resizeImage(file, size = 256) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          const s = Math.min(img.width, img.height);
          c.width = size; c.height = size;
          c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = reject;
        img.src = r.result;
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function editBaby(baby) {
    const isEdit = !!baby;
    const b = baby ? { ...baby } : { name: '', sex: 'girl', birthday: C.dateKey(), avatar: '👶' };
    const name = h('input', { value: b.name || '', placeholder: '例如：小乖', maxlength: 20 });
    const sex = ui.seg([{ value: 'girl', label: '女孩' }, { value: 'boy', label: '男孩' }], b.sex || 'girl', null, { small: true });
    const bday = h('input', { type: 'date', value: b.birthday || C.dateKey(), max: C.dateKey(C.addDays(new Date(), 300)) });
    const btime = h('input', { type: 'time', value: b.birthTime || '' });
    const bw = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: b.birthWeight || '', placeholder: '3.20' });
    const bl = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', value: b.birthLength || '', placeholder: '50' });
    let photo = b.photo || null;
    let avatar = b.avatar || '👶';
    const preview = h('div', { class: 'avatar-preview' });
    const drawPreview = () => { preview.innerHTML = ''; preview.append(photo ? h('img', { src: photo, alt: '' }) : h('span', null, avatar)); };
    drawPreview();
    const picker = h('div', { class: 'avatar-picker' }, AVATARS.map((a) => h('button', { type: 'button', class: 'av-btn', onclick: () => { avatar = a; photo = null; drawPreview(); } }, a)));
    const file = h('input', { type: 'file', accept: 'image/*', class: 'hide' });
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      try { photo = await resizeImage(file.files[0]); drawPreview(); } catch (e) { ui.toast('無法讀取這張照片'); }
    });
    const sh = ui.sheet({
      title: isEdit ? '編輯寶寶' : '新增寶寶',
      body: h('div', null,
        h('div', { class: 'row gap mb' }, preview, h('div', { class: 'grow' }, picker,
          h('button', { type: 'button', class: 'btn btn-sm btn-ghost mt', onclick: () => file.click() }, '📷 用照片'), file)),
        ui.field('名字／小名', name), ui.field('性別（用於生長曲線）', sex),
        h('div', { class: 'grid-2' }, ui.field('生日', bday), ui.field('出生時間', btime)),
        h('div', { class: 'grid-2' }, ui.field('出生體重（kg）', bw), ui.field('出生身長（cm）', bl))),
      footer: h('div', { class: 'row gap' },
        isEdit && store.state.babies.length > 0 ? h('button', {
          class: 'btn btn-ghost', 'aria-label': '刪除寶寶',
          onclick: async () => {
            if (!(await ui.confirm(`刪除「${baby.name}」和他的所有紀錄？此動作無法復原。`, { ok: '刪除', danger: true }))) return;
            store.update((s) => {
              s.babies = s.babies.filter((x) => x.id !== baby.id);
              s.logs = s.logs.filter((l) => l.babyId !== baby.id);
              s.growth = s.growth.filter((g) => g.babyId !== baby.id);
              if (s.activeBabyId === baby.id) s.activeBabyId = s.babies[0]?.id || null;
            });
            sh.close();
          },
        }, ui.icon('trash')) : null,
        h('button', {
          class: 'btn btn-primary grow',
          onclick: () => {
            const patch = {
              name: name.value.trim() || '寶寶', sex: sex.dataset.value, birthday: bday.value, birthTime: btime.value,
              birthWeight: bw.value ? Number(bw.value) : '', birthLength: bl.value ? Number(bl.value) : '', avatar, photo,
            };
            if (isEdit) store.update((s) => { Object.assign(s.babies.find((x) => x.id === baby.id), patch); });
            else { store.addBaby(patch); store.update((s) => { s.profile.stage = 'baby'; }); }
            sh.close(); ui.toast('已儲存');
          },
        }, '儲存')),
    });
  }

  /* ================= profile editor ================= */
  function editProfile() {
    const p = store.state.profile;
    const name = h('input', { value: p.momName || '', placeholder: '怎麼稱呼你？' });
    const height = h('input', { type: 'number', inputmode: 'decimal', value: p.heightCm || '', placeholder: '160' });
    const weight = h('input', { type: 'number', inputmode: 'decimal', value: p.prePregWeight || '', placeholder: '52' });
    const lmp = h('input', { type: 'date', value: p.lmp || '' });
    const edd = h('input', { type: 'date', value: p.edd || '' });
    lmp.addEventListener('change', () => { if (lmp.value) edd.value = C.eddFromLmp(lmp.value); });
    edd.addEventListener('change', () => { if (edd.value) lmp.value = C.lmpFromEdd(edd.value); });
    const cycle = h('input', { type: 'number', value: p.cycleLength || 28, min: 20, max: 45 });
    const period = h('input', { type: 'number', value: p.periodLength || 5, min: 2, max: 10 });
    const sh = ui.sheet({
      title: '我的資料',
      body: h('div', null,
        ui.field('暱稱', name),
        h('div', { class: 'grid-2' }, ui.field('身高（cm）', height), ui.field('孕前體重（kg）', weight)),
        h('div', { class: 'section-title small' }, '經期與孕期'),
        h('div', { class: 'grid-2' }, ui.field('最後一次月經第一天', lmp), ui.field('預產期', edd)),
        h('div', { class: 'grid-2' }, ui.field('週期天數', cycle), ui.field('經期天數', period))),
      footer: h('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => {
          store.update((s) => Object.assign(s.profile, {
            momName: name.value.trim(), heightCm: height.value, prePregWeight: weight.value, lmp: lmp.value, edd: edd.value,
            cycleLength: Number(cycle.value) || 28, periodLength: Number(period.value) || 5,
          }));
          sh.close(); ui.toast('已儲存');
        },
      }, '儲存'),
    });
  }

  /* ================= family sharing: export / import / merge ================= */
  const mergeById = (a = [], b = []) => {
    const map = new Map(a.map((x) => [x.id, x]));
    b.forEach((x) => { if (x && x.id && !map.has(x.id)) map.set(x.id, x); });
    return [...map.values()];
  };
  const mergeMaps = (a = {}, b = {}) => {
    const out = { ...a };
    Object.entries(b).forEach(([k, v]) => {
      out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? mergeMaps(a[k] || {}, v) : (k in a ? a[k] : v);
    });
    return out;
  };
  function mergeState(incoming) {
    store.update((s) => {
      s.babies = mergeById(s.babies, incoming.babies);
      s.logs = mergeById(s.logs, incoming.logs);
      s.growth = mergeById(s.growth, incoming.growth);
      s.milk = mergeById(s.milk, incoming.milk);
      s.periods = mergeById(s.periods, incoming.periods);
      ['kicks', 'contractions', 'weights'].forEach((k) => { s.preg[k] = mergeById(s.preg[k], incoming.preg?.[k]); });
      s.preg.prenatal = mergeMaps(s.preg.prenatal, incoming.preg?.prenatal);
      ['vaccines', 'checkups', 'milestones'].forEach((k) => { s[k] = mergeMaps(s[k], incoming[k]); });
      s.chicken.log = mergeMaps(s.chicken.log, incoming.chicken?.log);
      if (!s.activeBabyId && s.babies[0]) s.activeBabyId = s.babies[0].id;
      s.onboarded = true;
    });
  }
  App.mergeState = mergeState;

  function exportData() {
    const json = JSON.stringify({ app: 'yijia-mom', exportedAt: new Date().toISOString(), data: store.state });
    const blob = new Blob([json], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `做媽媽備份-${C.dateKey()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    ui.toast('已下載備份檔');
  }
  function importData() {
    const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'hide' });
    const mode = ui.seg([{ value: 'merge', label: '合併（家人資料）' }, { value: 'replace', label: '整個取代' }], 'merge', null, { small: true });
    const sh = ui.sheet({
      title: '匯入資料',
      body: h('div', null,
        h('p', { class: 'small muted' }, '選擇家人傳給你的備份檔（.json）。「合併」會把對方的新紀錄加進來，不會刪掉你的紀錄。'),
        ui.field('匯入方式', mode), file,
        h('button', { class: 'btn btn-primary btn-block', onclick: () => file.click() }, '選擇備份檔')),
    });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try {
        const parsed = JSON.parse(await f.text());
        const data = parsed.data || parsed;
        if (!data || !Array.isArray(data.logs)) throw new Error('bad');
        if (mode.dataset.value === 'replace') {
          if (!(await ui.confirm('用備份檔取代這台裝置上的所有資料？'))) return;
          store.replace({ ...data, share: store.state.share || data.share, auth: store.state.auth }); // keep my own invite code and login
        } else mergeState(data);
        sh.close(); ui.toast('匯入完成');
      } catch (e) { ui.toast('檔案格式不正確'); }
    });
  }
  function inviteLine() {
    const url = location.href.split('#')[0];
    const baby = store.baby();
    const text = `一起用「${B().appName || '易家做媽媽'}」記錄${baby ? baby.name : '寶寶'}的日常吧！\n${url}`;
    window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  /* ================= reminders (while app is open / in background tab) ================= */
  const NKEY = 'yijia-mom-notified';
  const getN = () => { try { return JSON.parse(localStorage.getItem(NKEY) || '{}'); } catch (e) { return {}; } };
  const setN = (o) => { try { localStorage.setItem(NKEY, JSON.stringify(o)); } catch (e) { /* ignore */ } };
  async function notify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg) { reg.showNotification(title, { body, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png' }); return; }
        new Notification(title, { body, icon: 'assets/icon-192.png' }); // eslint-disable-line no-new
        return;
      } catch (e) { /* fall through */ }
    }
    ui.toast(`🔔 ${title}：${body}`, 5000);
  }
  function checkReminders() {
    const s = store.state;
    const n = getN();
    const now = new Date();
    s.reminders.forEach((r) => {
      if (!r.enabled) return;
      const today = C.dateKey(now);
      const [hh, mm] = (r.time || '09:00').split(':').map(Number);
      const pastTime = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
      if (r.type === 'feed' && s.profile.stage === 'baby') {
        // 依預測：用「接下來」算出的時間（寶寶自己的作息）；固定：上次餵奶＋設定的間隔
        const last = store.lastLog(['breast', 'bottle']);
        if (!last || store.state.active.feed) return;
        const pred = r.mode !== 'fixed' && App.predict ? App.predict.feed() : null;
        const due = pred ? pred.next.getTime() : new Date(last.start).getTime() + (r.minutes || 180) * C.MIN;
        if (now.getTime() >= due && n.feed !== last.id) {
          n.feed = last.id; setN(n);
          notify('餵奶提醒', `${pred ? '差不多是寶寶平常喝奶的時間了・' : ''}距離上次餵奶 ${C.fmtDuration(now - new Date(last.start))}`);
        }
      }
      if (r.type === 'appt' && pastTime && n.appt !== today) {
        const items = upcomingAppointments(now);
        if (items.length) { n.appt = today; setN(n); notify('預約提醒', items.join('、')); }
      }
      if (r.type === 'chicken' && pastTime && n.chicken !== today && !s.chicken.log[today]) {
        n.chicken = today; setN(n);
        notify('滴雞精時光', '休息一下，溫熱一杯給自己 💜');
      }
    });
  }
  // 今天或明天要做的：疫苗、兒童健檢、產檢
  function upcomingAppointments(now = new Date()) {
    const out = [];
    const tomorrow = C.dateKey(C.addDays(now, 1));
    const b = store.baby();
    if (store.inStage(['baby']) && b && App.health && App.HEALTH) {
      const vDone = store.state.vaccines[b.id] || {};
      App.HEALTH.VACCINES.filter((v) => v.free && !v.conditional).forEach((v) => {
        const st = App.health.vaccineStatus(v, b, vDone);
        if (st.key === 'done') return;
        const due = C.dateKey(st.due);
        if (due === C.dateKey(now) || due === tomorrow) out.push(`${b.name} ${v.name.replace(/（.*?）/g, '')}${v.dose}（${due === tomorrow ? '明天' : '今天'}）`);
      });
      const cDone = store.state.checkups[b.id] || {};
      App.HEALTH.CHECKUPS.forEach((c) => {
        const st = App.health.checkupStatus(c, b, cDone);
        if (st.key !== 'done' && C.dateKey(st.start) === tomorrow) out.push(`${c.name}從明天開始可以做`);
      });
    }
    // 看診紀錄裡設定的回診日期
    store.state.logs.filter((l) => l.type === 'visit' && l.data && l.data.followUp).forEach((l) => {
      const b2 = store.state.babies.find((x) => x.id === l.babyId);
      if (l.data.followUp === C.dateKey(now) || l.data.followUp === tomorrow) out.push(`${b2 ? b2.name : '寶寶'}回診（${l.data.followUp === tomorrow ? '明天' : '今天'}${l.data.clinic ? `・${l.data.clinic}` : ''}）`);
    });
    if (store.inStage(['preg']) && App.preg && App.preg.nextPrenatal) {
      const np = App.preg.nextPrenatal();
      if (np && (np.date === tomorrow || np.date === C.dateKey(now))) out.push(`第 ${np.no} 次產檢（約${np.date === tomorrow ? '明天' : '今天'}）`);
    }
    return out;
  }

  App.reminders = { upcomingAppointments, start() { checkReminders(); setInterval(checkReminders, 60 * 1000); }, notify };

  App.screen('reminders', {
    title: '提醒設定',
    render(el) {
      const perm = 'Notification' in window ? Notification.permission : 'unsupported';
      el.append(h('section', { class: 'card soft' },
        h('div', { class: 'card-title' }, '🔔 通知權限'),
        h('p', { class: 'small muted' }, perm === 'granted' ? '已開啟通知。' : perm === 'denied' ? '通知被封鎖了，請到瀏覽器設定開啟。' : perm === 'unsupported' ? '這個瀏覽器不支援通知，提醒會以畫面訊息顯示。' : '開啟通知，才能在背景收到提醒。iPhone 請先「加入主畫面」再開啟。'),
        perm === 'default' ? h('button', { class: 'btn btn-sm btn-primary mt', onclick: async () => { await Notification.requestPermission(); App.refresh(); } }, '開啟通知') : null));
      store.state.reminders.forEach((r) => {
        const toggle = h('input', { type: 'checkbox', class: 'switch', checked: r.enabled, 'aria-label': r.label });
        toggle.addEventListener('change', () => store.update((s) => { s.reminders.find((x) => x.id === r.id).enabled = toggle.checked; }));
        let control;
        if (r.type === 'feed') {
          const setR = (patch) => store.update((s) => { Object.assign(s.reminders.find((x) => x.id === r.id), patch); });
          control = h('div', { class: 'stack-sm' },
            ui.seg([{ value: 'predict', label: '依寶寶作息預測' }, { value: 'fixed', label: '固定間隔' }], r.mode || 'predict', (v) => setR({ mode: v }), { small: true }),
            r.mode === 'fixed' ? ui.seg([120, 150, 180, 210, 240].map((m) => ({ value: m, label: `${m / 60}h` })), r.minutes, (v) => setR({ minutes: Number(v) }), { small: true }) : null);
        } else {
          const t = h('input', { type: 'time', value: r.time || '09:00', class: 'input', 'aria-label': `${r.label}時間` });
          t.addEventListener('change', () => store.update((s) => { s.reminders.find((x) => x.id === r.id).time = t.value; }));
          control = t;
        }
        el.append(h('section', { class: 'card' },
          h('div', { class: 'row between' }, h('div', { class: 'card-title' }, r.label), toggle),
          h('p', { class: 'small muted' }, {
            feed: r.mode === 'fixed' ? '距離上次餵奶超過設定時間時提醒' : '到了「接下來」預測的下一餐時間就提醒，會跟著寶寶的作息調整',
            appt: '每天這個時間檢查：疫苗到期、兒童健檢開始、產檢日（今天或明天）',
            chicken: '每天在這個時間提醒（當天已打卡就不提醒）',
          }[r.type]),
          h('div', { class: 'mt' }, control)));
      });
      el.append(h('p', { class: 'disclaimer' }, '目前提醒在 App 開著或在背景時運作。要在 App 完全關閉時也收到推播，需要後端推播服務（見 docs/TEARDOWN.md 第二階段）。'));
    },
  });

  /* ================= demo data ================= */
  function seedDemo() {
    const s = store.defaults();
    const now = new Date();
    const birthday = C.dateKey(C.addDays(now, -75));
    const babyId = 'demo-baby';
    s.onboarded = true;
    s.profile = { ...s.profile, momName: '小美', stage: 'baby', heightCm: 160, prePregWeight: 52, lmp: C.dateKey(C.addDays(now, -75 - 275)), edd: C.dateKey(C.addDays(now, -70)) };
    s.babies = [{ id: babyId, name: '小乖', sex: 'girl', birthday, birthTime: '08:12', birthWeight: 3.12, birthLength: 49.5, avatar: '👧' }];
    s.activeBabyId = babyId;
    const add = (type, start, extra = {}) => s.logs.push({ id: C.uid(), babyId, type, start: new Date(start).toISOString(), end: null, data: {}, note: '', by: Math.random() < 0.3 ? '爸爸' : '媽媽', createdAt: new Date(start).toISOString(), ...extra });
    // 3 days of logs, every ~3h a feed, diapers, naps
    const startT = now.getTime() - 14 * C.DAY; // two weeks so 月曆 and 本週重點 have data
    let t = startT;
    let i = 0;
    while (t < now.getTime() - 25 * C.MIN) {
      if (i % 3 === 0) add('breast', t, { end: new Date(t + 22 * C.MIN).toISOString(), data: { leftMin: 12, rightMin: 10, lastSide: i % 2 ? 'L' : 'R' } });
      else add('bottle', t, { data: { kind: i % 4 === 1 ? 'formula' : 'breastmilk', ml: 100 + Math.floor((t - startT) / C.DAY) * 3 + (i % 3) * 10 } }); // 奶量隨日齡慢慢增加
      add('diaper', t + 15 * C.MIN, { data: i % 3 === 1 ? { kind: 'mixed', poo: { amount: 'm', texture: 'soft', color: 'yellow' } } : { kind: 'wet' } });
      const nap = t + 60 * C.MIN;
      const napLen = (new Date(nap).getHours() >= 21 || new Date(nap).getHours() < 5 ? 150 : 70) * C.MIN;
      if (nap + napLen < now.getTime()) add('sleep', nap, { end: new Date(nap + napLen).toISOString() });
      if (i % 4 === 2) add('pump', t + 40 * C.MIN, { end: new Date(t + 55 * C.MIN).toISOString(), data: { durationMin: 15, left: 60, right: 50, ml: 110, stored: true } });
      t += (2.6 + (i % 3) * 0.3) * C.HOUR;
      i += 1;
    }
    add('temp', now.getTime() - 5 * C.HOUR, { data: { c: 36.9, site: '耳溫' } });
    add('bath', now.getTime() - 26 * C.HOUR);
    s.growth = [
      { id: C.uid(), babyId, date: C.dateKey(C.addDays(birthday, 30)), weight: 4.25, length: 53.6, head: 36.8 },
      { id: C.uid(), babyId, date: C.dateKey(C.addDays(birthday, 61)), weight: 5.2, length: 57.2, head: 38.6 },
    ];
    const dayN = (n) => C.dateKey(C.addDays(birthday, n));
    s.vaccines[babyId] = { hepb1: dayN(0), hepb2: dayN(31), dtap1: dayN(61), pcv1: dayN(61) };
    s.checkups[babyId] = { nbs: dayN(2), hearing: dayN(2), v1: dayN(30), v2: dayN(62) };
    s.milestones[babyId] = {};
    s.milk = [
      { id: C.uid(), ml: 120, originalMl: 120, pumpedAt: new Date(now - 20 * C.DAY).toISOString(), storage: 'freezer', thawedAt: null, usedAt: null, note: 'A1' },
      { id: C.uid(), ml: 150, originalMl: 150, pumpedAt: new Date(now - 9 * C.DAY).toISOString(), storage: 'freezer', thawedAt: null, usedAt: null, note: 'A2' },
      { id: C.uid(), ml: 110, originalMl: 110, pumpedAt: new Date(now - 30 * C.HOUR).toISOString(), storage: 'fridge', thawedAt: null, usedAt: null, note: '' },
      { id: C.uid(), ml: 90, originalMl: 90, pumpedAt: new Date(now - 6 * C.HOUR).toISOString(), storage: 'fridge', thawedAt: null, usedAt: null, note: '' },
    ];
    for (let d = 1; d <= 9; d += 1) if (d !== 4) s.chicken.log[C.dateKey(C.addDays(now, -d))] = 1;
    s.island.stamps = {};
    if (store.state.share) s.share = store.state.share; // keep invite code + who invited me
    if (store.state.auth) s.auth = store.state.auth; // stay logged in
    store.replace(s);
    App.navigate('home');
    App.refresh();
    ui.toast('已載入範例資料，可以隨意點點看！');
  }
  App.demo = { seed: seedDemo };

  /* ================= onboarding ================= */
  let ob = { step: 0, stage: null };
  App.screen('onboarding', {
    title: '歡迎',
    liveUpdate: false,
    render(el) {
      const wrap = h('div', { class: 'onboard' });
      el.append(wrap);
      const go = (patch) => { Object.assign(ob, patch); wrap.innerHTML = ''; draw(); };
      const finish = () => { store.update((s) => { s.onboarded = true; }); ob = { step: 0, stage: null }; App.navigate('home'); App.refresh(); };
      function draw() {
        if (ob.step === 0) {
          const inv = store.state.share && store.state.share.invitedBy;
          wrap.append(h('div', { class: 'ob-hero center' },
            inv ? h('div', { class: 'ob-invited' }, `💌 ${store.state.share.inviterName || '朋友'}邀請你一起使用`) : null,
            h('img', { src: B().logoFull || B().logo, alt: B().brandName || '', class: 'ob-logo' }),
            h('h1', { class: 'ob-title' }, B().appName || '易家做媽媽'),
            h('p', { class: 'muted' }, '從備孕、懷孕到育兒，一個 App 陪你記錄每一步。'),
            h('ul', { class: 'ob-feats' },
              h('li', null, '🏝️ 好孕島：邊逛邊學的衛教小島'),
              h('li', null, '🍼 餵奶・尿布・睡眠，一鍵記錄＋智慧預測'),
              h('li', null, '📈 成長曲線、疫苗、里程碑、PDF 報告'),
              h('li', null, '👨‍👩‍👧 全家一起記錄')),
            App.livePill ? App.livePill('ob-live') : null,
            h('button', { class: 'btn btn-primary btn-block', onclick: () => go({ step: 1 }) }, '開始使用'),
            h('button', { class: 'btn btn-ghost btn-block mt', onclick: () => { ob = { step: 0, stage: null }; seedDemo(); } }, '先看看範例資料'),
            App.screens.login ? h('button', { class: 'link-btn ob-login', onclick: () => App.navigate('login') }, '已有帳號？登入／註冊') : null));
        } else if (ob.step === 1) {
          wrap.append(h('h2', { class: 'ob-q' }, '你現在是？'),
            h('div', { class: 'stack' }, App.STAGES.map((st) => h('button', { class: 'ob-choice', onclick: () => go({ step: 2, stage: st.value }) },
              h('span', { class: 'ob-choice-ico' }, st.icon),
              h('span', null, h('b', null, st.label), h('br'), h('span', { class: 'small muted' }, { prep: '記錄經期、預測排卵、孕前準備', preg: '孕週、產檢、胎動與宮縮', baby: '餵奶、尿布、睡眠、成長與疫苗' }[st.value]))))),
            h('button', { class: 'link-btn mt', onclick: () => go({ step: 0 }) }, '‹ 上一步'));
        } else {
          const name = h('input', { placeholder: '怎麼稱呼你？（選填）', value: store.state.profile.momName || '' });
          const fields = h('div');
          let collect = () => {};
          if (ob.stage === 'prep') {
            const last = h('input', { type: 'date', max: C.dateKey() });
            const cyc = h('input', { type: 'number', value: 28, min: 20, max: 45 });
            fields.append(ui.field('最近一次月經第一天', last), ui.field('平均週期天數', cyc));
            collect = (s) => { s.profile.cycleLength = Number(cyc.value) || 28; if (last.value) s.periods.push({ id: C.uid(), start: last.value, end: C.dateKey(C.addDays(last.value, 4)) }); };
          } else if (ob.stage === 'preg') {
            const lmp = h('input', { type: 'date', max: C.dateKey() });
            const edd = h('input', { type: 'date' });
            lmp.addEventListener('change', () => { if (lmp.value) edd.value = C.eddFromLmp(lmp.value); });
            edd.addEventListener('change', () => { if (edd.value) lmp.value = C.lmpFromEdd(edd.value); });
            fields.append(ui.field('最後一次月經第一天', lmp), ui.field('或：預產期', edd, '填一個就會自動換算另一個'));
            collect = (s) => { s.profile.lmp = lmp.value; s.profile.edd = edd.value; };
          } else {
            const bname = h('input', { placeholder: '寶寶的名字或小名' });
            const sex = ui.seg([{ value: 'girl', label: '女孩' }, { value: 'boy', label: '男孩' }], 'girl', null, { small: true });
            const bday = h('input', { type: 'date', value: C.dateKey(), max: C.dateKey() });
            const bw = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', placeholder: '3.20' });
            fields.append(ui.field('寶寶名字', bname), ui.field('性別', sex), ui.field('生日', bday), ui.field('出生體重（kg，選填）', bw));
            collect = (s) => {
              const baby = { id: C.uid(), name: bname.value.trim() || '寶寶', sex: sex.dataset.value, birthday: bday.value || C.dateKey(), birthWeight: bw.value ? Number(bw.value) : '', avatar: '👶' };
              s.babies.push(baby); s.activeBabyId = baby.id;
            };
          }
          wrap.append(h('h2', { class: 'ob-q' }, '基本資料'), ui.field('你的暱稱', name), fields,
            h('button', { class: 'btn btn-primary btn-block mt', onclick: () => { store.update((s) => { s.profile.stage = ob.stage; s.profile.momName = name.value.trim(); collect(s); }); finish(); } }, '完成，開始使用'),
            h('button', { class: 'link-btn mt', onclick: () => go({ step: 1 }) }, '‹ 上一步'));
        }
      }
      draw();
    },
  });

  /* ================= 我的 tab ================= */
  App.screen('me', {
    title: '我的',
    render(el) {
      const s = store.state;
      const p = s.profile;
      const stageLabel = App.STAGES.find((x) => x.value === p.stage) || App.STAGES[2];
      if (App.account) el.append(App.account.card());
      el.append(h('section', { class: 'card me-card' },
        h('div', { class: 'row gap' },
          h('div', { class: 'me-avatar' }, '💜'),
          h('div', { class: 'grow' }, h('div', { class: 'card-title' }, p.momName || '媽媽'), h('div', { class: 'card-sub' }, `${stageLabel.icon} ${stageLabel.label}・這台裝置記錄者：${p.member}`)),
          h('button', { class: 'btn btn-sm btn-soft', onclick: editProfile }, '編輯')),
        h('div', { class: 'mt' }, ui.seg(App.STAGES.map((x) => ({ value: x.value, label: x.label, icon: x.icon })), p.stage, (v) => {
          store.update((st) => { st.profile.stage = v; if (v !== 'baby') st.profile.pregnantToo = false; });
          if (v === 'baby' && !store.state.babies.length) editBaby();
          const ga = store.state.profile.lmp ? C.gestAge(store.state.profile.lmp) : null;
          if (v === 'preg' && App.preg && (!ga || ga.totalDays < 0 || ga.totalDays > 42 * 7)) App.preg.openDueDateSheet();
        })),
        p.stage === 'baby' ? h('label', { class: 'check-row' },
          h('input', {
            type: 'checkbox', class: 'switch', checked: !!p.pregnantToo,
            onchange: (e) => {
              const on = e.target.checked;
              store.update((st) => { st.profile.pregnantToo = on; });
              // the saved LMP may belong to the first pregnancy — ask unless it's a current one (0–42 weeks)
              const lmp = store.state.profile.lmp;
              const ga = lmp ? C.gestAge(lmp) : null;
              if (on && App.preg && (!ga || ga.totalDays < 0 || ga.totalDays > 42 * 7)) App.preg.openDueDateSheet();
            },
          }),
          h('span', null, h('b', null, '同時懷孕中（二寶）'), h('br'), h('span', { class: 'tiny muted' }, '首頁和健康會同時顯示孕期與寶寶的內容'))) : null));

      el.append(h('div', { class: 'section-title' }, h('span', null, '寶寶'), h('button', { onclick: () => editBaby() }, '＋ 新增')));
      if (s.babies.length) {
        el.append(h('div', { class: 'list' }, s.babies.map((b) => h('button', { class: 'list-item', onclick: () => editBaby(b) },
          b.photo ? h('img', { src: b.photo, alt: '', class: 'li-icon li-photo' }) : h('span', { class: 'li-icon' }, b.avatar || '👶'),
          h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, b.name, b.id === store.baby()?.id ? h('span', { class: 'tag primary' }, '目前') : null),
            h('div', { class: 'li-sub' }, `${b.sex === 'boy' ? '男孩' : '女孩'}・${C.fmtDateLong(b.birthday)}・${C.babyAge(b.birthday)?.text || ''}`)),
          h('span', { class: 'li-right', html: ui.ICONS.chevron })))));
      } else el.append(h('p', { class: 'small muted' }, '還沒有寶寶資料。'));

      el.append(h('div', { class: 'section-title' }, '家人共享'));
      const memberSel = h('select', { class: 'input' }, ['媽媽', '爸爸', '阿嬤', '阿公', '外婆', '外公', '保母', '其他'].map((m) => h('option', { value: m, selected: m === p.member }, m)));
      memberSel.addEventListener('change', () => store.update((st) => { st.profile.member = memberSel.value; }));
      el.append(h('section', { class: 'card' },
        ui.field('這台裝置是誰在記錄', memberSel, '每筆紀錄會標示是誰記的'),
        h('div', { class: 'grid-2' },
          h('button', { class: 'btn btn-line', onclick: inviteLine, html: `${ui.ICONS.line}<span>LINE 邀請</span>` }),
          h('button', { class: 'btn btn-soft', onclick: exportData }, '⬇️ 匯出備份')),
        h('button', { class: 'btn btn-ghost btn-block mt', onclick: importData }, '⬆️ 匯入／合併家人的備份'),
        h('p', { class: 'tiny faint mt' }, '目前資料只存在這台裝置。家人之間可用「匯出 → 用 LINE 傳檔 → 匯入合併」同步。即時雲端同步（LINE 登入）規劃於第二階段。')));

      el.append(h('div', { class: 'section-title' }, '設定'));
      el.append(h('div', { class: 'list' },
        App.screens.invite ? h('a', { class: 'list-item', href: '#/invite' }, h('span', { class: 'li-icon' }, '💌'), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '邀請好友・分享卡'), h('div', { class: 'li-sub' }, `好孕點數 ${(s.share && s.share.points) || 0}・邀請碼 ${(s.share && s.share.code) || ''}`)), h('span', { class: 'li-right', html: ui.ICONS.chevron })) : null,
        h('a', { class: 'list-item', href: '#/reminders' }, h('span', { class: 'li-icon' }, '🔔'), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '提醒中心'), h('div', { class: 'li-sub' }, '餵奶、疫苗／健檢／產檢、滴雞精時光')), h('span', { class: 'li-right', html: ui.ICONS.chevron })),
        h('a', { class: 'list-item', href: '#/brand' }, h('img', { class: 'li-icon li-logo', src: B().logo, alt: '' }), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, B().brandName || '品牌'), h('div', { class: 'li-sub' }, '品牌故事・滴雞精時光打卡')), h('span', { class: 'li-right', html: ui.ICONS.chevron })),
        h('div', { class: 'list-item' }, h('span', { class: 'li-icon' }, '🌓'), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '外觀')),
          ui.seg([{ value: 'auto', label: '自動' }, { value: 'light', label: '淺色' }, { value: 'dark', label: '深色' }], s.settings.theme, (v) => { store.update((st) => { st.settings.theme = v; }); App.applyTheme(); }, { small: true })),
        h('label', { class: 'list-item' }, h('span', { class: 'li-icon' }, '🌙'),
          h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '夜間模式'), h('div', { class: 'li-sub' }, '22:00–06:00 自動變暗、按鈕放大，半夜單手好按')),
          h('input', {
            type: 'checkbox', class: 'switch', checked: s.settings.nightMode !== false, 'aria-label': '夜間模式',
            onchange: (e) => { store.update((st) => { st.settings.nightMode = e.target.checked; }); App.applyTheme(); },
          }))));

      el.append(h('div', { class: 'section-title' }, '資料'));
      el.append(h('div', { class: 'grid-2' },
        h('button', { class: 'btn btn-ghost', onclick: async () => { if (await ui.confirm('載入範例資料會取代目前所有資料，確定嗎？')) seedDemo(); } }, '載入範例資料'),
        h('button', { class: 'btn btn-ghost danger-text', onclick: async () => { if (await ui.confirm('清除這台裝置上的所有資料？建議先匯出備份。', { ok: '清除', danger: true })) { store.reset(); App.navigate('onboarding'); } } }, '清除所有資料')));

      el.append(h('section', { class: 'card flat mt-lg about' },
        h('img', { src: B().logoFull || B().logo, alt: '', class: 'about-logo' }),
        h('p', { class: 'small center muted' }, `${B().appName || ''}・版本 0.4.0`),
        h('p', { class: 'disclaimer' }, '本 App 提供一般衛教資訊與紀錄工具，內容參考國健署、疾管署、WHO 等公開資料整理，不能取代醫師的診斷與建議。寶寶或自己身體不舒服時，請直接就醫。資料只儲存在你的裝置上。')));
    },
  });

  App.me = { editBaby, editProfile, exportData, importData };
}());
