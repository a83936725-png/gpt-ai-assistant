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
    // 👶 is the Q版 baby (js/modules/qban.js): its outfit colour and one small accessory are chosen right here
    const Q = App.qbaby;
    const q = Q ? Q.qOf(b) : {};
    const cur = () => ({ ...b, avatar, photo, q });
    const preview = h('div', { class: 'avatar-preview' });
    const picker = h('div', { class: 'avatar-picker' }, AVATARS.map((a) => h('button', {
      type: 'button', class: 'av-btn', dataset: { av: a }, 'aria-pressed': 'false', 'aria-label': a === '👶' && Q ? 'Q 版寶寶' : null,
      onclick: () => { avatar = a; photo = null; drawPreview(); },
    }, a)));
    const qBtn = (cls, data, label, on, extra = {}) => h('button', { type: 'button', class: cls, role: 'radio', 'aria-checked': String(on), dataset: data, onclick: extra.onclick, style: extra.style, 'aria-label': extra.aria || null, title: extra.aria || null }, extra.aria ? null : label);
    const wearBtns = Q ? Q.WEARS.map(([k, label, hex]) => qBtn('qb-wear', { wear: k }, label, q.wear === k, { aria: label, style: { '--w': hex }, onclick: () => { q.wear = k; drawPreview(); } })) : [];
    const accBtns = Q ? Q.ACCS.map(([k, label]) => qBtn('chip qb-acc', { acc: k }, label, q.acc === k, { onclick: () => { q.acc = k; drawPreview(); } })) : [];
    const qBox = h('div', { class: 'qb-opts', hidden: true },
      h('div', { class: 'qb-row' }, h('span', { class: 'qb-label small bold', 'aria-hidden': 'true' }, '衣服'), h('div', { class: 'qb-wears', role: 'radiogroup', 'aria-label': 'Q 版寶寶的衣服顏色' }, wearBtns)),
      h('div', { class: 'qb-row' }, h('span', { class: 'qb-label small bold', 'aria-hidden': 'true' }, '配件'), h('div', { class: 'qb-accs', role: 'radiogroup', 'aria-label': 'Q 版寶寶的小配件' }, accBtns)));
    function drawPreview() {
      const c = cur();
      const isQ = !!(Q && Q.isQ(c));
      preview.innerHTML = '';
      preview.append(photo ? h('img', { src: photo, alt: '' }) : isQ ? Q.face(c, { size: 84 }) : h('span', null, avatar));
      picker.querySelectorAll('.av-btn').forEach((x) => {
        const on = !photo && x.dataset.av === avatar;
        x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on));
        if (Q && x.dataset.av === '👶') { x.innerHTML = ''; x.append(Q.face({ avatar: '👶', q }, { size: 30, cls: 'av-q' })); }
      });
      wearBtns.forEach((x) => x.setAttribute('aria-checked', String(x.dataset.wear === q.wear)));
      accBtns.forEach((x) => x.setAttribute('aria-checked', String(x.dataset.acc === q.acc)));
      qBox.hidden = !isQ;
    }
    drawPreview();
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
        qBox,
        ui.field('名字／小名', name), ui.field('性別（用於生長曲線）', sex),
        h('div', { class: 'grid-2' }, ui.field('生日', bday), ui.field('出生時間', btime)),
        h('div', { class: 'grid-2' }, ui.field('出生體重（kg）', bw), ui.field('出生身長（cm）', bl))),
      footer: h('div', { class: 'row gap' },
        isEdit && store.state.babies.length > 0 ? h('button', {
          class: 'btn btn-ghost', 'aria-label': '刪除寶寶',
          onclick: async () => {
            if (!(await ui.confirm(`刪除「${baby.name || '寶寶'}」和所有相關紀錄？此動作無法復原。`, { ok: '刪除', danger: true }))) return;
            store.update((s) => {
              s.babies = s.babies.filter((x) => x.id !== baby.id);
              s.logs = s.logs.filter((l) => l.babyId !== baby.id);
              s.growth = s.growth.filter((g) => g.babyId !== baby.id);
              if (s.monthly && s.monthly.babies) delete s.monthly.babies[baby.id]; // 寶寶月照
              Object.keys(s.active || {}).forEach((k) => { if (s.active[k] && s.active[k].babyId === baby.id) delete s.active[k]; }); // their running timers
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
              ...(Q ? { q: { wear: q.wear, acc: q.acc } } : {}),
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
      // a device that was never set up (e.g. dad opening mom's backup) takes her profile as it is: stage, 預產期, …;
      // otherwise only blanks are filled in, so nobody's own settings change
      const inP = incoming.profile || {};
      if (!s.onboarded) s.profile = { ...s.profile, ...inP, member: s.profile.member };
      else ['momName', 'lmp', 'edd', 'heightCm', 'prePregWeight'].forEach((k) => { if (!s.profile[k] && inP[k]) s.profile[k] = inP[k]; });
      s.babies = mergeById(s.babies, incoming.babies);
      s.logs = mergeById(s.logs, incoming.logs);
      s.growth = mergeById(s.growth, incoming.growth);
      s.milk = mergeById(s.milk, incoming.milk);
      s.periods = mergeById(s.periods, incoming.periods);
      ['kicks', 'contractions', 'weights', 'journal', 'diary'].forEach((k) => { s.preg[k] = mergeById(s.preg[k], incoming.preg?.[k]); });
      s.preg.prenatal = mergeMaps(s.preg.prenatal, incoming.preg?.prenatal);
      s.preg.visitNotes = mergeMaps(s.preg.visitNotes, incoming.preg?.visitNotes); // 產檢當天的體重、血壓、醫師交代
      // 產後恢復紀錄 and the 生產日
      s.postpartum.log = mergeById(s.postpartum.log, incoming.postpartum?.log);
      if (!s.postpartum.start && incoming.postpartum?.start) { s.postpartum.start = incoming.postpartum.start; s.postpartum.method = incoming.postpartum.method || s.postpartum.method; }
      s.journey.done = mergeMaps(s.journey.done, incoming.journey?.done); // 孕產路線圖 checklist
      s.folic.log = mergeMaps(s.folic.log, incoming.folic?.log);
      s.daily.log = mergeMaps(s.daily.log, incoming.daily?.log);
      ['vaccines', 'checkups', 'milestones'].forEach((k) => { s[k] = mergeMaps(s[k], incoming[k]); });
      s.chicken.log = mergeMaps(s.chicken.log, incoming.chicken?.log);
      if (!s.activeBabyId && s.babies[0]) s.activeBabyId = s.babies[0].id;
      s.onboarded = true;
    });
  }
  App.mergeState = mergeState;
  // a full restore must not lose the keys of the walls this phone opened: without them a wall can't be managed
  function keepSocial(mine, theirs) {
    if (!mine || !mine.key) return theirs || mine;
    const walls = [...(mine.walls || [])];
    ((theirs && theirs.walls) || []).forEach((w) => { if (w && w.id && w.key && !walls.some((x) => x.id === w.id)) walls.push(w); });
    return { ...mine, walls };
  }

  async function exportData() {
    let media = {};
    try { if (App.media) media = await App.media.exportAll(App.media.referenced(store.state)); } catch (e) { media = {}; }
    const json = JSON.stringify({ app: 'yijia-mom', exportedAt: new Date().toISOString(), data: store.state, media });
    const blob = new Blob([json], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `做媽媽備份-${C.dateKey()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    store.update((st) => { st.settings.lastBackupAt = new Date().toISOString(); });
    ui.toast('已下載備份檔');
  }
  // how much is saved and where, plus the last backup — shown under the backup buttons
  function storageLine() {
    const st = store.state;
    const n = st.logs.length;
    const days = st.settings.lastBackupAt ? C.diffDays(st.settings.lastBackupAt, new Date()) : null;
    const backup = days === null ? '還沒匯出過備份' : days <= 0 ? '今天匯出過備份' : `上次匯出備份：${days} 天前`;
    const where = store.where === 'idb' ? '存在手機的資料庫（空間充足）' : `已用手機儲存空間約 ${Math.max(1, Math.round((store.savedChars / 5e6) * 100))}%`;
    return `紀錄 ${n.toLocaleString()} 筆・${where}・${backup}`;
  }
  // red card on 首頁 and 我的 while a save could not be kept (otherwise not shown at all)
  const storageAlert = () => (store.health !== 'failed' ? null : ui.card({ class: 'accent storage-alert', role: 'alert' },
    h('div', { class: 'card-title' }, '最新的紀錄可能沒有存到'),
    h('p', { class: 'small' }, '手機的儲存空間不足（或瀏覽器不允許儲存）。紀錄還在畫面上，但關掉 App 後可能會不見。請先匯出備份，再清出一些手機空間。'),
    h('button', { class: 'btn btn-primary btn-sm mt', onclick: exportData }, '⬇️ 立刻匯出備份')));
  App.storageAlert = storageAlert; // 首頁 shows it right under the greeting

  /* ---------- keeping records safe on the phone ----------
   * iPhone Safari clears a website's saved data after 7 days without a visit unless it was added to the home
   * screen, and any phone can be lost or reset. So 首頁 shows (one at a time, only once there is something worth
   * keeping): an add-to-home-screen card on iPhone/iPad Safari, then a gentle reminder to export a backup. */
  const isStandalone = () => { try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
  const inFrame = () => { try { return window.top !== window.self; } catch (e) { return true; } };
  const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const recordCount = (st) => st.logs.length + st.growth.length + st.periods.length + st.milk.length
    + st.preg.weights.length + st.preg.kicks.length + st.preg.journal.length + st.postpartum.log.length;
  const worthKeeping = (st) => recordCount(st) >= 20;
  const needsHomeScreen = () => isIOS() && !isStandalone() && !inFrame();
  function a2hsCard() {
    const st = store.state;
    if (!needsHomeScreen() || st.settings.a2hsDismissed || !worthKeeping(st)) return null;
    return ui.card({ class: 'soft keep-card', dataset: { keep: 'a2hs' } },
      h('div', { class: 'card-title' }, '加到主畫面，紀錄更安全'),
      h('p', { class: 'small' }, 'iPhone 的 Safari 如果 7 天都沒打開這個網站，可能會自動清掉存在手機裡的紀錄；把 App 加到主畫面就不會。'),
      h('ol', { class: 'small tight' },
        h('li', null, '點 Safari 的「分享」按鈕（方框加上箭頭）'),
        h('li', null, '往下選「加入主畫面」'),
        h('li', null, '之後都從桌面的圖示打開')),
      h('button', { class: 'btn btn-ghost btn-sm mt', onclick: () => store.update((x) => { x.settings.a2hsDismissed = new Date().toISOString(); }) }, '知道了'));
  }
  function backupCard() {
    const st = store.state;
    if (!worthKeeping(st)) return null;
    const days = st.settings.lastBackupAt ? C.diffDays(st.settings.lastBackupAt, new Date()) : null;
    if (days !== null && days < 30) return null;
    if (days === null && C.diffDays(st.createdAt, new Date()) < 7) return null; // not in the first week
    if (st.settings.backupSnoozeUntil && Date.now() < Date.parse(st.settings.backupSnoozeUntil)) return null;
    return ui.card({ class: 'soft keep-card', dataset: { keep: 'backup' } },
      h('div', { class: 'card-title' }, '幫紀錄備份一下'),
      h('p', { class: 'small' }, days === null
        ? '還沒匯出過備份。手機遺失、換手機或清除資料時，備份檔可以把紀錄全部找回來。'
        : `上次備份是 ${days} 天前。匯出一份新的備份，存到 LINE「Keep 筆記」或雲端硬碟比較安心。`),
      h('div', { class: 'row gap-sm mt' },
        h('button', { class: 'btn btn-primary btn-sm', onclick: exportData }, '⬇️ 匯出備份'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => store.update((x) => { x.settings.backupSnoozeUntil = new Date(Date.now() + 7 * C.DAY).toISOString(); }) }, '下週再說')));
  }
  App.homeCard('keep-safe', { stages: ['prep', 'preg', 'baby'], order: 3, render(el) { const c = a2hsCard() || backupCard(); if (c) el.append(c); } });
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
        if (parsed.media && App.media) await App.media.importAll(parsed.media); // 產檢日記的照片
        if (mode.dataset.value === 'replace') {
          if (!(await ui.confirm('用備份檔取代這台裝置上的所有資料？'))) return;
          // keep my own invite code, login, and 島上的媽媽 identity + 祝福牆 keys (the backup's walls are added to mine)
          const next = {
            ...data, share: store.state.share || data.share, auth: store.state.auth, social: keepSocial(store.state.social, data.social),
          };
          const fam = store.state.family || data.family; // 家人共用: this phone's family (or the backup's, restoring her own phone)
          if (fam) next.family = fam; else delete next.family;
          store.replace(next);
          if (App.family && store.state.family) App.family.rebase(); // 家人共用: the next sync merges, it never deletes the family's records
          if (App.media) await App.media.prune(); // photos of the replaced data go; the backup's own photos stay
        } else mergeState(data);
        sh.close(); ui.toast('匯入完成');
      } catch (e) { ui.toast('檔案格式不正確'); }
    });
  }
  function inviteLine() {
    if (App.starter) App.starter.mark('family'); // 新手任務「用 LINE 邀請家人一起記錄」
    const url = location.href.split('#')[0];
    const baby = store.baby();
    const text = `一起用「${B().appName || '易家做媽媽'}」記錄${baby ? baby.name : '寶寶'}的日常吧！\n${url}`;
    window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  App.inviteFamily = inviteLine;

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
  // when this phone gets reminders from the server (手機通知), they are not shown twice: only a note while it is open
  const say = (title, body) => (App.push && App.push.remindsHere() ? (document.visibilityState === 'visible' ? ui.toast(`🔔 ${title}：${body}`, 5000) : null) : notify(title, body));
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
        if (!last || App.timers.running().some((r) => r.base === 'feed')) return; // someone is feeding right now
        const pred = r.mode !== 'fixed' && App.predict ? App.predict.feed() : null;
        const due = pred ? pred.next.getTime() : new Date(last.start).getTime() + (r.minutes || 180) * C.MIN;
        if (now.getTime() >= due && n.feed !== last.id) {
          n.feed = last.id; setN(n);
          say('餵奶提醒', `${pred ? '差不多是寶寶平常喝奶的時間了・' : ''}距離上次餵奶 ${C.fmtDuration(now - new Date(last.start))}`);
        }
      }
      if (r.type === 'appt' && pastTime && n.appt !== today) {
        const items = upcomingAppointments(now);
        if (items.length) { n.appt = today; setN(n); say('預約提醒', items.join('、')); }
      }
      if (r.type === 'chicken' && pastTime && n.chicken !== today && !s.chicken.log[today]) {
        n.chicken = today; setN(n);
        say('滴雞精時光', '今天的滴雞精時光還沒打卡');
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
      if (App.push) el.append(App.push.card()); // 手機通知: also when the app is closed (members)
      el.append(h('section', { class: 'card soft' },
        h('div', { class: 'card-title' }, 'App 開著時的通知'),
        h('p', { class: 'small muted' }, perm === 'granted' ? '已開啟：App 開著或在背景時，到時間會跳出通知。' : perm === 'denied' ? '通知被封鎖了，請到瀏覽器設定開啟。' : perm === 'unsupported' ? '這個瀏覽器不支援通知，提醒會以畫面訊息顯示。' : '開啟後，App 開著或在背景時，到時間會跳出通知。iPhone 請先「加入主畫面」再開啟。'),
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
          // the whole title row toggles the switch (a bigger target than the switch alone)
          h('label', { class: 'row between switch-row' }, h('span', { class: 'card-title' }, r.label), toggle),
          h('p', { class: 'small muted' }, {
            feed: r.mode === 'fixed' ? '距離上次餵奶超過設定時間時提醒' : '到了「接下來」預測的下一餐時間就提醒，會跟著寶寶的作息調整',
            appt: '每天這個時間檢查：疫苗到期、兒童健檢開始、產檢日（今天或明天）',
            chicken: '每天在這個時間提醒（當天已打卡就不提醒）',
          }[r.type]),
          h('div', { class: 'mt' }, control)));
      });
      el.append(h('p', { class: 'disclaimer' }, '開啟上面的「手機通知」（會員），App 關著也會收到提醒；沒有開啟時，提醒在 App 開著或在背景時運作。'));
    },
  });

  /* ================= demo data ================= */
  // what she has written herself (records, babies, growth, diary, prenatal visits): sample data must never take it by surprise
  const ownRecords = (st = store.state) => (st.logs || []).length + (st.babies || []).length + (st.growth || []).length
    + ((st.preg && st.preg.diary) || []).length + Object.keys((st.preg && st.preg.visitNotes) || {}).length;
  function seedDemo({ undo = false } = {}) {
    const prev = undo && ownRecords() ? JSON.stringify(store.state) : null; // kept for 「復原」 for a few seconds
    const s = store.defaults();
    const now = new Date();
    const birthday = C.dateKey(C.addDays(now, -75));
    const babyId = 'demo-baby';
    s.onboarded = true;
    s.profile = { ...s.profile, momName: '小美', stage: 'baby', heightCm: 160, prePregWeight: 52, lmp: C.dateKey(C.addDays(now, -75 - 275)), edd: C.dateKey(C.addDays(now, -70)) };
    s.babies = [{ id: babyId, name: '小乖', sex: 'girl', birthday, birthTime: '08:12', birthWeight: 3.12, birthLength: 49.5, avatar: '👶', q: { wear: 'pink', acc: 'bow' } }]; // the Q版 baby
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
    s.milestones[babyId] = { m2c: dayN(52) };
    s.monthly = { // 寶寶月照: drawn sample pictures, made on this phone when first shown
      frame: 'cream', qr: false, skip: {},
      babies: { [babyId]: {
        0: { photo: 'demo-m0', frame: 'cream', crop: { x: 0, y: 0, z: 1 }, note: '歡迎來到這個世界', name: null, growth: true, at: new Date(now - 74 * C.DAY).toISOString() },
        1: { photo: 'demo-m1', frame: 'wreath', crop: { x: 0, y: 0, z: 1 }, note: '滿月快樂', name: null, growth: true, at: new Date(now - 44 * C.DAY).toISOString() },
        2: { photo: 'demo-m2', frame: 'polaroid', crop: { x: 0, y: 0, z: 1 }, note: '會發出「咕咕」「啊」等聲音了', name: null, growth: true, at: new Date(now - 14 * C.DAY).toISOString() },
      } },
    };
    s.milk = [
      { id: C.uid(), ml: 120, originalMl: 120, pumpedAt: new Date(now - 20 * C.DAY).toISOString(), storage: 'freezer', thawedAt: null, usedAt: null, note: 'A1' },
      { id: C.uid(), ml: 150, originalMl: 150, pumpedAt: new Date(now - 9 * C.DAY).toISOString(), storage: 'freezer', thawedAt: null, usedAt: null, note: 'A2' },
      { id: C.uid(), ml: 110, originalMl: 110, pumpedAt: new Date(now - 30 * C.HOUR).toISOString(), storage: 'fridge', thawedAt: null, usedAt: null, note: '' },
      { id: C.uid(), ml: 90, originalMl: 90, pumpedAt: new Date(now - 6 * C.HOUR).toISOString(), storage: 'fridge', thawedAt: null, usedAt: null, note: '' },
    ];
    for (let d = 1; d <= 9; d += 1) if (d !== 4) s.chicken.log[C.dateKey(C.addDays(now, -d))] = 1;
    s.island.stamps = {};
    s.starter = { demo: true }; // sample data: no 新手任務
    s.sampleData = true; // 範例資料 (with no member service, 團購 shows its sample group-buys too)
    if (App.count) App.count('ob_demo'); // 使用統計: looked at the sample data (a count only)
    if (store.state.share) s.share = store.state.share; // keep invite code + who invited me
    if (store.state.auth) s.auth = store.state.auth; // stay logged in
    if (store.state.social) s.social = store.state.social; // keep 島上的媽媽／好孕圈 and the keys of my 祝福牆
    store.replace(s);
    App.navigate('home');
    App.refresh();
    if (App.gift) setTimeout(() => App.gift.sync(), 500);
    if (!prev) { if (App.media) App.media.prune(); ui.toast('已載入範例資料，可以隨意點點看！'); return; }
    // her own data was replaced: 復原 brings it back (photos too), and its photos are only cleared once that chance is over
    let undone = false;
    ui.toast('已載入範例資料，可以隨意點點看！', {
      action: '復原', ms: 8000,
      onAction: () => { undone = true; store.replace(JSON.parse(prev)); App.navigate('home'); App.refresh(); ui.toast('已復原你的資料'); },
    });
    setTimeout(() => { if (!undone && App.media) App.media.prune(); }, 9000);
  }
  App.demo = { seed: seedDemo };

  /* ================= onboarding ================= */
  let ob = { step: 0, stage: null };
  const OB_STEPS = ['你的階段', '基本資料', '開始記錄'];
  App.screen('onboarding', {
    title: '歡迎',
    liveUpdate: false,
    render(el) {
      const wrap = h('div', { class: 'onboard' });
      el.append(wrap);
      const go = (patch) => { Object.assign(ob, patch); wrap.innerHTML = ''; draw(); };
      const finish = () => {
        store.update((s) => { s.onboarded = true; s.onboardedAt = new Date().toISOString(); });
        if (App.count) { App.count(`ob_${ob.stage}`); App.count.active(); } // 使用統計: the stage new users choose (a count only)
        ob = { step: 0, stage: null }; App.navigate('home'); App.refresh();
        if (App.gift) setTimeout(() => App.gift.sync(), 500); // set up: a friend's welcome gift can be claimed now
      };
      function draw() {
        if (ob.step === 0) {
          const inv = store.state.share && store.state.share.invitedBy;
          // first screen: the app asks who she is straight away. (It used to show a slogan and four emoji feature lines
          // and ask this one tap later.) The sample data and 登入 stay within thumb reach at the bottom.
          wrap.append(h('div', { class: 'ob-hero' },
            inv ? h('div', { class: 'ob-invited' }, `${store.state.share.inviterName || '朋友'}邀請你一起使用`,
              // 雙向邀請禮 (only where the member service is there to give it)
              App.gift ? h('span', { class: 'ob-gift needs-member', hidden: App.gift.ready() !== true }, '註冊會員，你們都有邀請禮') : null) : null,
            h('div', { class: 'ob-brand' },
              h('img', { src: B().logo, alt: '', class: 'ob-icon' }),
              h('div', null, h('h1', { class: 'ob-title' }, B().appName || '易家做媽媽'), h('div', { class: 'ob-by' }, `by ${B().brandName || '易家滴雞精'}`)),
              App.mascot ? App.mascot.el({ mood: 'wave', size: 50, cls: 'ob-md' }) : null),
            h('h2', { class: 'ob-q' }, '你現在是？'),
            h('div', { class: 'stack ob-stages' }, App.STAGES.map((st) => h('button', { class: 'ob-choice', onclick: () => go({ step: 2, stage: st.value }) },
              ui.pic(`stage-${st.value}`, 56, 'ob-pic'), // 0.9.4: a drawing of each stage, so the choice is seen before it is read
              h('span', { class: 'ob-choice-t' }, h('b', null, st.label), h('span', { class: 'small muted' }, { prep: '經期・排卵日・孕前檢查', preg: '孕週・產檢・胎動', baby: '餵奶・尿布・睡眠・疫苗' }[st.value])),
              h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')))),
            h('p', { class: 'ob-note small muted' }, '不用註冊，紀錄預設只存在這支手機。')),
          h('div', { class: 'ob-actions' },
            App.livePill ? App.livePill('ob-live') : null,
            h('button', { class: 'btn btn-ghost btn-block', onclick: () => { ob = { step: 0, stage: null }; seedDemo(); } }, '先看看範例資料'),
            App.screens.login ? h('button', { class: 'link-btn ob-login', onclick: () => App.navigate('login') }, '已有帳號？登入／註冊') : null));
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
            // the first hepatitis B dose is given in hospital within 24 h of birth: without this the vaccine list would
            // greet a new parent with a red 「已逾期」 for a shot the baby already had
            const hepb = h('input', { type: 'checkbox', checked: true });
            fields.append(ui.field('寶寶名字', bname), ui.field('性別', sex), ui.field('生日', bday), ui.field('出生體重（kg，選填）', bw),
              h('label', { class: 'check-row ob-hepb' }, hepb, h('span', null, '出生時在醫院打的 B 肝疫苗第 1 劑已完成', h('br'), h('span', { class: 'tiny muted' }, '之後可在「疫苗」修改'))));
            collect = (s) => {
              const baby = { id: C.uid(), name: bname.value.trim() || '寶寶', sex: sex.dataset.value, birthday: bday.value || C.dateKey(), birthWeight: bw.value ? Number(bw.value) : '', avatar: '👶' };
              s.babies.push(baby); s.activeBabyId = baby.id;
              if (hepb.checked) s.vaccines[baby.id] = { ...(s.vaccines[baby.id] || {}), hepb1: baby.birthday };
            };
          }
          wrap.append(ui.steps(OB_STEPS, 1), h('h2', { class: 'ob-q' }, '基本資料'), ui.field('你的暱稱', name), fields,
            h('button', { class: 'btn btn-primary btn-block mt', onclick: () => { store.update((s) => { s.profile.stage = ob.stage; s.profile.momName = name.value.trim(); collect(s); }); finish(); } }, '完成，開始使用'),
            h('button', { class: 'link-btn mt', onclick: () => go({ step: 0 }) }, '‹ 上一步'));
        }
      }
      draw();
    },
  });

  // 錨點導航: chips that jump to a section of a long screen (and light it up for a moment)
  function jumpChips(items) {
    return h('nav', { class: 'jump-chips', 'aria-label': '跳到' }, items.map(([id, label]) => h('button', {
      type: 'button', class: 'jump-chip',
      onclick: (e) => {
        const t = document.getElementById(id); if (!t) return;
        e.currentTarget.parentNode.querySelectorAll('.jump-chip').forEach((x) => x.classList.toggle('on', x === e.currentTarget));
        t.scrollIntoView({ behavior: ui.reducedMotion && ui.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        t.classList.remove('jump-flash'); void t.offsetWidth; t.classList.add('jump-flash'); // eslint-disable-line no-void
      },
    }, label)));
  }

  /* ================= 我的 tab ================= */
  App.screen('me', {
    title: '我的',
    render(el) {
      const s = store.state;
      const p = s.profile;
      const stageLabel = App.STAGES.find((x) => x.value === p.stage) || App.STAGES[2];
      const alertCard = storageAlert(); if (alertCard) el.append(alertCard);
      el.append(jumpChips([['me-babies', '寶寶'], ['me-family', '家人共享'], ['me-settings', '設定'], ['me-data', '資料與備份']]));
      if (App.account) el.append(App.account.card());
      el.append(h('section', { class: 'card me-card' },
        h('div', { class: 'row gap' },
          h('button', { class: 'me-avatar av-me', 'aria-label': p.avatar ? '編輯我的 Q 版角色' : '建立我的 Q 版角色', onclick: () => App.navigate('avatar') },
            p.avatar && App.avatar ? App.avatar.head(52) : h('span', { class: 'av-me-initial' }, [...(p.momName || '我')][0]), p.avatar ? null : h('span', { class: 'av-me-plus' }, '＋')),
          h('div', { class: 'grow' }, h('div', { class: 'card-title' }, p.momName || '媽媽'), h('div', { class: 'card-sub' }, `${stageLabel.label}・這台裝置記錄者：${p.member}`)),
          h('button', { class: 'btn btn-sm btn-soft', onclick: editProfile }, '編輯')),
        h('div', { class: 'mt' }, ui.seg(App.STAGES.map((x) => ({ value: x.value, label: x.label })), p.stage, (v) => {
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

      el.append(h('div', { class: 'section-title jump-target', id: 'me-babies' }, h('span', null, '寶寶'), h('button', { onclick: () => editBaby() }, '＋ 新增')));
      if (s.babies.length) {
        el.append(h('div', { class: 'list' }, s.babies.map((b) => h('button', { class: 'list-item', onclick: () => editBaby(b) },
          App.qbaby ? App.qbaby.icon(b) : b.photo ? h('img', { src: b.photo, alt: '', class: 'li-icon li-photo' }) : h('span', { class: 'li-icon' }, b.avatar || '👶'),
          h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, b.name, b.id === store.baby()?.id ? h('span', { class: 'tag primary' }, '目前') : null),
            h('div', { class: 'li-sub' }, `${b.sex === 'boy' ? '男孩' : '女孩'}・${C.fmtDateLong(b.birthday)}・${C.babyAge(b.birthday)?.text || ''}`)),
          h('span', { class: 'li-right', html: ui.ICONS.chevron })))));
      } else el.append(h('p', { class: 'small muted' }, '還沒有寶寶資料。'));

      el.append(h('div', { class: 'section-title jump-target', id: 'me-family' }, '家人共享'));
      const memberSel = h('select', { class: 'input' }, ['媽媽', '爸爸', '阿嬤', '阿公', '外婆', '外公', '保母', '其他'].map((m) => h('option', { value: m, selected: m === p.member }, m)));
      memberSel.addEventListener('change', () => store.update((st) => { st.profile.member = memberSel.value; }));
      if (App.family) el.append(h('div', { class: 'list mb' }, App.family.listItem())); // 家人共用紀錄 (end-to-end encrypted)
      el.append(h('section', { class: 'card' },
        ui.field('這台裝置是誰在記錄', memberSel, '每筆紀錄會標示是誰記的'),
        h('div', { class: 'grid-2' },
          h('button', { class: 'btn btn-line', onclick: inviteLine, html: `${ui.ICONS.line}<span>LINE 邀請</span>` }),
          h('button', { class: 'btn btn-soft', onclick: exportData }, '⬇️ 匯出備份')),
        h('button', { class: 'btn btn-ghost btn-block mt', onclick: importData }, '⬆️ 匯入／合併家人的備份'),
        (() => {
          const line = h('p', { class: 'small muted mt storage-line' }, storageLine());
          // diary photos live in their own store on the phone: say how many and how much room they take
          if (App.media) App.media.stats().then(({ count, bytes }) => { if (count) line.textContent = `${storageLine()}・照片 ${count} 張（產檢日記、寶寶月照，約 ${Math.max(0.1, bytes / 1048576).toFixed(1)} MB）`; });
          return line;
        })(),
        needsHomeScreen() ? h('p', { class: 'tiny faint' }, 'iPhone：把 App 加到主畫面（Safari「分享」→「加入主畫面」），7 天沒打開也不會被清掉紀錄。') : null,
        h('p', { class: 'tiny faint mt' }, '沒有開啟「家人共用紀錄」時，紀錄只存在這台手機；也可以「匯出 → 用 LINE 傳檔 → 匯入合併」交換紀錄。')));

      el.append(h('div', { class: 'section-title jump-target', id: 'me-settings' }, '設定'));
      // 夜間模式 and 白天黑夜跟著: today's sunrise and sunset for the chosen place (the texts update when it changes)
      const nightSub = h('div', { class: 'li-sub' });
      const sunSub = h('div', { class: 'li-sub sun-sub' });
      const sunTexts = () => {
        const place = App.sunPlace();
        if (place === 'clock') {
          nightSub.textContent = '18 點後自動變暗、6 點後變亮；深夜按鈕再放大，半夜單手好按';
          sunSub.textContent = !store.state.settings.sunPlace && !App.inTaiwanTime()
            ? '手機不在台灣時區，先用固定時鐘：6 點天亮・18 點天黑' : '固定 6 點天亮・18 點天黑，不跟季節變';
          return;
        }
        const t = App.sun();
        const nw = (x) => h('span', { style: { whiteSpace: 'nowrap' } }, x); // a time never breaks away from its word
        nightSub.textContent = '日落後自動變暗、日出後變亮；深夜按鈕再放大，半夜單手好按';
        sunSub.replaceChildren('今天', nw(`日出 ${C.fmtTime(t.sunrise)}`), '・', nw(`日落 ${C.fmtTime(t.sunset)}`), '，跟著季節變');
      };
      sunTexts();
      el.append(h('div', { class: 'list' },
        App.screens.invite ? h('a', { class: 'list-item', href: '#/invite' }, h('span', { class: 'li-icon' }, '💌'), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '邀請好友・分享卡'), h('div', { class: 'li-sub' }, App.gift && App.gift.ready() ? `好孕點數 ${(s.share && s.share.points) || 0}・會員福利：見面禮、邀請禮、點數換好禮` : `好孕點數 ${(s.share && s.share.points) || 0}・邀請碼 ${(s.share && s.share.code) || ''}`)), h('span', { class: 'li-right', html: ui.ICONS.chevron })) : null,
        App.groupbuy ? App.groupbuy.listItem() : null, // 團購揪團 (only while a group-buy is on, or she is in a team)
        App.social ? (() => {
          const so = App.social.soc();
          if (App.social.isReady() === false) {
            // a site without the member service (or offline): say so once, instead of three invitations that can't work
            return h('div', { class: 'list-item' }, h('span', { class: 'li-icon' }, '👭'),
              h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '島上的媽媽・同週好孕圈・祝福牆'), h('div', { class: 'li-sub' }, '需要連上會員服務，目前連不到（離線，或這個網址還沒開放）')));
          }
          return h('button', { class: 'list-item', onclick: () => App.social.openSettings() }, h('span', { class: 'li-icon' }, '👭'),
            h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '島上的媽媽'), h('div', { class: 'li-sub' }, so.on ? `已開啟・顯示為「${so.name || '匿名媽咪'}」` : '和同階段的媽媽互相揮手、送愛心（未開啟）')),
            h('span', { class: 'li-right', html: ui.ICONS.chevron }));
        })() : null,
        App.screens.circle && !(App.social && App.social.isReady() === false) ? (() => {
          const cc = (App.social && App.social.soc().circle) || {};
          const lb = App.circle && App.circle.label();
          return h('a', { class: 'list-item', href: '#/circle' }, h('span', { class: 'li-icon' }, '🗳️'),
            h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '同週好孕圈'), h('div', { class: 'li-sub' }, cc.on && lb ? `已加入・${lb.title}` : '和同週的媽媽一起回答每週小問題、互相打氣')),
            h('span', { class: 'li-right', html: ui.ICONS.chevron }));
        })() : null,
        App.screens.wall && !(App.social && App.social.isReady() === false) ? (() => {
          const ws = (App.social && App.social.soc().walls) || [];
          const pend = ws.reduce((n, w) => n + (w.pending || 0), 0);
          return h('a', { class: 'list-item', href: '#/wall' }, h('span', { class: 'li-icon' }, '💌'),
            h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '祝福牆'), h('div', { class: 'li-sub' }, ws.length ? `${ws.length} 面牆${pend ? `・${pend} 則等你確認` : ''}` : '滿月、百日、週歲，親友不用下載 App 就能留言')),
            h('span', { class: 'li-right', html: ui.ICONS.chevron }));
        })() : null,
        h('a', { class: 'list-item', href: '#/reminders' }, h('span', { class: 'li-icon' }, '🔔'), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '提醒中心'), h('div', { class: 'li-sub' }, '餵奶、疫苗／健檢／產檢、滴雞精時光')), h('span', { class: 'li-right', html: ui.ICONS.chevron })),
        h('a', { class: 'list-item', href: '#/brand' }, h('img', { class: 'li-icon li-logo', src: B().logo, alt: '' }), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, B().brandName || '品牌'), h('div', { class: 'li-sub' }, '品牌故事・滴雞精時光打卡')), h('span', { class: 'li-right', html: ui.ICONS.chevron })),
        h('div', { class: 'list-item' }, h('span', { class: 'li-icon' }, '🌓'), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '外觀')),
          ui.seg([{ value: 'auto', label: '自動' }, { value: 'light', label: '淺色' }, { value: 'dark', label: '深色' }], s.settings.theme, (v) => { store.update((st) => { st.settings.theme = v; }); App.applyTheme(); }, { small: true })),
        h('label', { class: 'list-item' }, h('span', { class: 'li-icon' }, '🌙'),
          h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '夜間模式'), nightSub),
          h('input', {
            type: 'checkbox', class: 'switch', checked: s.settings.nightMode !== false, 'aria-label': '夜間模式',
            onchange: (e) => { store.update((st) => { st.settings.nightMode = e.target.checked; }); App.applyTheme(); },
          })),
        h('label', { class: 'list-item' }, h('span', { class: 'li-icon' }, '🌅'),
          h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '白天黑夜跟著'), sunSub),
          h('select', {
            class: 'input sun-place', 'aria-label': '白天黑夜跟著哪裡的日出日落',
            onchange: (e) => { store.update((st) => { st.settings.sunPlace = e.target.value; }); App.applyTheme(); sunTexts(); },
          }, Object.entries(C.SUN_PLACES).map(([v, p]) => h('option', { value: v, selected: v === App.sunPlace() }, p.label))))));

      el.append(h('div', { class: 'section-title jump-target', id: 'me-data' }, '資料'));
      el.append(h('div', { class: 'grid-2' },
        h('button', {
          class: 'btn btn-ghost',
          onclick: async () => {
            const n = ownRecords();
            const ask = n ? `範例資料會取代你目前的 ${n} 筆紀錄和照片。想留著的話，請先按上面的「匯出備份」。` : '載入範例資料會取代目前所有資料，確定嗎？';
            if (await ui.confirm(ask, n ? { ok: '取代', danger: true } : {})) seedDemo({ undo: true });
          },
        }, '載入範例資料'),
        h('button', { class: 'btn btn-ghost danger-text', onclick: async () => { if (await ui.confirm('清除這台裝置上的所有資料？建議先匯出備份。', { ok: '清除', danger: true })) { store.reset(); if (App.count) App.count.forget(); App.navigate('onboarding'); } } }, '清除所有資料')));

      el.append(h('section', { class: 'card flat mt-lg about' },
        h('img', { src: B().logoFull || B().logo, alt: '', class: 'about-logo' }),
        h('p', { class: 'small center muted' }, `${B().appName || ''}・版本 0.9.5`),
        h('button', { class: 'btn btn-soft btn-sm center-btn', onclick: () => App.navigate('sources') }, '📚 資料來源（點擊可開啟）'),
        App.screens.privacy ? h('button', { class: 'btn btn-ghost btn-sm center-btn', onclick: () => App.navigate('privacy') }, '🔒 隱私權政策與使用條款') : null,
        // the web preview (no member service) can show the brand's dashboard with its sample numbers; never linked for moms
        App.screens.admin && App.account && App.account.noService() ? h('button', { class: 'btn btn-ghost btn-sm center-btn me-admin', onclick: () => App.navigate('admin') }, '📊 品牌數據後台（預覽）') : null,
        h('p', { class: 'disclaimer' }, '本 App 提供一般衛教資訊與紀錄工具，內容參考國健署、疾管署、WHO 等公開資料整理（每則都附來源，可點開查看），不能取代醫師的診斷與建議。寶寶或自己身體不舒服時，請直接就醫。紀錄只儲存在你的裝置上；只有你開啟「島上的媽媽」、同週好孕圈或祝福牆時，才會送出角色樣子、名稱、預產週或出生月份，以及你的回答和祝福。')));
    },
  });

  App.me = { editBaby, editProfile, exportData, importData };
  // the landing page's 試玩 (?sandbox=1) opens straight on the sample data
  App.sandbox = /[?&]sandbox=1(&|$)/.test(location.search);
  if (App.sandbox) {
    // once the app is up (app.js loads after this file) and the sandbox's own storage is read
    const demo = () => {
      if (store.loading || typeof App.navigate !== 'function') { setTimeout(demo, 40); return; }
      if (!store.state.onboarded) seedDemo();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demo, { once: true }); else demo();
  }
}());
