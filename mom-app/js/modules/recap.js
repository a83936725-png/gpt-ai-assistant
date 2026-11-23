/* 易家做媽媽 — 成長回顧 (the baby's story so far, made on the phone from the records).
 * 滿月 (the first 30 days), 百日 (100 days), 第一年 (365 days), or 到今天. Told like a story, one slide at a time: the
 * feeds, the nights she was up, diapers, sleep, how much the baby grew, the firsts, the milk she pumped, the 月照 — and
 * a thank-you. Nothing is uploaded. The share card (1080×1920) holds counts only: no medical records (體溫、用藥、看診、
 * 疫苗), the drawn Q版 baby (never a photo), and the name only when she shares names.
 *   screen 'recap' (params {kind, baby})   App.recap = { PERIODS, available, build, slides, open, draw, text } */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const B = () => window.BRAND || {};
  const PERIODS = {
    now: { days: 0, label: '到今天', emoji: '✨' },
    m1: { days: 30, label: '滿月回顧', emoji: '🎂' },
    d100: { days: 100, label: '百日回顧', emoji: '💯' },
    y1: { days: 365, label: '第一年回顧', emoji: '🎉' },
  };
  const ORDER = ['now', 'm1', 'd100', 'y1'];
  const fmt = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
  const privacy = () => (store.state.share && store.state.share.privacy) || { showName: true };
  const nameOf = (b, share = false) => (share && !privacy().showName ? '寶寶' : (b && b.name) || '寶寶');
  const ageDays = (b, now = new Date()) => { const a = b && b.birthday ? C.babyAge(b.birthday, now) : null; return a && a.days >= 0 ? a.days + 1 : 0; }; // 出生第幾天

  // which recaps this baby has: 到今天 from the first day; 滿月／百日／第一年 once that many days have passed
  function available(b, now = new Date()) {
    const d = ageDays(b, now);
    return ORDER.filter((k) => (k === 'now' ? d >= 1 : d >= PERIODS[k].days)).map((k) => ({ kind: k, ...PERIODS[k] }));
  }
  const title = (b, kind, now, share) => {
    const n = nameOf(b, share);
    if (kind === 'm1') return `${n}的第一個月`;
    if (kind === 'd100') return `${n}的 100 天`;
    if (kind === 'y1') return `${n}的第一年`;
    return `${n}的 ${fmt(ageDays(b, now))} 天`;
  };

  /* ---------------- the numbers (one pass over the baby's records) ---------------- */
  function build(b, kind = 'now', now = new Date()) {
    const birth = C.startOfDay(C.parseKey(b.birthday));
    const P = PERIODS[kind] || PERIODS.now;
    const end = kind === 'now' ? now : new Date(Math.min(C.addDays(birth, P.days).getTime(), now.getTime()));
    const t0 = birth.getTime(); const t1 = end.getTime();
    const logs = (store.state.logs || []).filter((l) => l.babyId === b.id && l.start).filter((l) => { const t = new Date(l.start).getTime(); return t >= t0 && t < t1; });
    const r = {
      kind, from: C.dateKey(birth), to: C.dateKey(new Date(t1 - 1)), days: Math.max(1, Math.round((t1 - t0) / C.DAY)),
      feeds: 0, breast: 0, breastMin: 0, bottle: 0, ml: 0, night: 0, nightHours: {}, diapers: 0, wet: 0, dirty: 0,
      sleepMs: 0, longest: null, pumps: 0, pumpMl: 0, foods: [], baths: 0, records: logs.length, dayKeys: new Set(), firstLog: null,
    };
    const foods = new Map();
    logs.forEach((l) => {
      const st = new Date(l.start); const dk = C.dateKey(st);
      r.dayKeys.add(dk);
      if (!r.firstLog || l.start < r.firstLog) r.firstLog = l.start;
      const d = l.data || {};
      if (l.type === 'breast' || l.type === 'bottle') {
        r.feeds += 1;
        if (l.type === 'breast') { r.breast += 1; r.breastMin += (Number(d.leftMin) || 0) + (Number(d.rightMin) || 0) || (l.end ? Math.round((new Date(l.end) - st) / C.MIN) : 0); }
        else { r.bottle += 1; r.ml += Number(d.ml) || 0; }
        const hr = st.getHours();
        if (hr < 5) { r.night += 1; r.nightHours[hr] = (r.nightHours[hr] || 0) + 1; } // 半夜 0:00–4:59
      } else if (l.type === 'diaper') {
        r.diapers += 1;
        if (d.kind !== 'dirty') r.wet += 1;
        if (d.kind && d.kind !== 'wet') r.dirty += 1;
      } else if (l.type === 'sleep' && l.end) {
        const ms = Math.max(0, Math.min(new Date(l.end).getTime(), t1) - st.getTime());
        r.sleepMs += ms;
        if (!r.longest || ms > r.longest.ms) r.longest = { ms, date: dk };
      } else if (l.type === 'pump') {
        r.pumps += 1; r.pumpMl += App.pumpMl ? App.pumpMl(l) : (Number(d.ml) || 0);
      } else if (l.type === 'food' && d.item) {
        const item = String(d.item).trim();
        if (item && (!foods.has(item) || foods.get(item) > l.start)) foods.set(item, l.start);
      } else if (l.type === 'bath') r.baths += 1;
    });
    r.foods = [...foods.entries()].sort((x, y) => (x[1] < y[1] ? -1 : 1)).map(([item, at]) => ({ item, date: C.dateKey(new Date(at)) }));
    const hours = Object.entries(r.nightHours).sort((x, y) => y[1] - x[1]);
    r.nightHour = hours.length ? Number(hours[0][0]) : null;
    r.recordDays = r.dayKeys.size; delete r.dayKeys;
    // growth: from the birth size to the latest measurement in the period
    const gs = (store.state.growth || []).filter((g) => g.babyId === b.id && g.date && C.parseKey(g.date).getTime() < t1).sort((x, y) => (x.date < y.date ? -1 : 1));
    const lastW = [...gs].reverse().find((g) => g.weight); const lastL = [...gs].reverse().find((g) => g.length);
    r.growth = {
      w0: Number(b.birthWeight) || null, w1: lastW ? Number(lastW.weight) : null, l0: Number(b.birthLength) || null, l1: lastL ? Number(lastL.length) : null,
    };
    // the firsts she checked in 發展里程碑
    const labels = {};
    ((App.HEALTH && App.HEALTH.MILESTONES) || []).forEach((band) => band.items.forEach((it) => { labels[it[0]] = it[2]; }));
    r.firsts = Object.entries((store.state.milestones || {})[b.id] || {})
      .filter(([k, d]) => labels[k] && d && C.parseKey(d).getTime() >= t0 && C.parseKey(d).getTime() < t1)
      .sort((x, y) => (x[1] < y[1] ? -1 : 1)).map(([k, d]) => ({ label: labels[k], date: d }));
    // 月照 in the period
    r.photos = [];
    if (App.monthly) {
      for (let m = 0; m <= 24; m += 1) {
        const sl = App.monthly.slotOf(b.id, m);
        if (sl && C.parseKey(App.monthly.slotDate(b, m)).getTime() < t1) r.photos.push({ m, id: sl.photo, crop: sl.crop });
      }
    }
    return r;
  }

  /* ---------------- the story ---------------- */
  const num1 = (v) => String(Math.round(v * 10) / 10);
  const kg = (v) => String(Math.round(v * 100) / 100); // 3.12 kg stays 3.12
  const litres = (ml) => (ml >= 1000 ? { v: num1(ml / 1000), u: '公升' } : { v: fmt(ml), u: 'ml' });
  const hm = (ms) => { const m = Math.round(ms / C.MIN); return m >= 60 ? `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分`; };
  const md = (key) => C.fmtDate(key, false);
  function slides(b, r, now = new Date()) {
    const out = [];
    const started = r.firstLog && C.dateKey(new Date(r.firstLog)) > r.from ? md(C.dateKey(new Date(r.firstLog))) : null;
    out.push({
      id: 'intro', tone: 0, kicker: PERIODS[r.kind].label, title: title(b, r.kind, now), sub: `${md(r.from)}～${md(r.to)}${started ? `・從 ${started} 開始記錄` : ''}`, art: true,
    });
    if (r.records < 5) { out.push({ id: 'few', tone: 1, title: '這段時間的紀錄還不多', sub: '從今天開始記錄餵奶、尿布和睡眠，下次的回顧會更完整 💜' }); }
    if (r.feeds) {
      const parts = [r.breast ? `親餵 ${fmt(r.breast)} 次` : '', r.bottle ? `瓶餵 ${fmt(r.bottle)} 次` : '', r.ml ? `共 ${litres(r.ml).v} ${litres(r.ml).u}` : ''].filter(Boolean);
      out.push({ id: 'feeds', tone: 1, kicker: '喝奶', big: r.feeds, unit: '次', sub: parts.join('・') });
    }
    if (r.night) out.push({ id: 'night', tone: 2, kicker: '你在半夜起來餵奶', big: r.night, unit: '次', sub: r.nightHour != null ? `最常在凌晨 ${r.nightHour} 點左右。` : '都在 0 點到 5 點之間。' });
    if (r.diapers) out.push({ id: 'diapers', tone: 3, kicker: '換了', big: r.diapers, unit: '片尿布', sub: `濕的 ${fmt(r.wet)} 片・有便便 ${fmt(r.dirty)} 片` });
    if (r.sleepMs >= C.HOUR) out.push({ id: 'sleep', tone: 4, kicker: '睡了', big: Math.round(r.sleepMs / C.HOUR), unit: '小時', sub: r.longest ? `最長一覺 ${hm(r.longest.ms)}（${md(r.longest.date)}）` : '' });
    const g = r.growth;
    if (g.w0 && g.w1 && g.w1 > g.w0) out.push({ id: 'grow', tone: 5, kicker: `從 ${kg(g.w0)} kg 長到 ${kg(g.w1)} kg`, big: kg(g.w1 - g.w0), unit: 'kg', plus: true, sub: g.l0 && g.l1 && g.l1 > g.l0 ? `身長 ${num1(g.l0)} → ${num1(g.l1)} cm，長高了 ${num1(g.l1 - g.l0)} cm` : '每一天都在長大' });
    if (r.firsts.length) out.push({ id: 'firsts', tone: 0, kicker: '這些第一次', list: r.firsts.slice(-5).map((x) => `${x.label}・${md(x.date)}`) });
    if (r.foods.length) out.push({ id: 'foods', tone: 1, kicker: '吃過', big: r.foods.length, unit: '種副食品', sub: `第一口是 ${r.foods[0].item}（${md(r.foods[0].date)}）` });
    if (r.pumpMl) { const L = litres(r.pumpMl); out.push({ id: 'pump', tone: 2, kicker: '媽媽擠了', big: L.v, unit: `${L.u}母乳`, sub: `一共 ${fmt(r.pumps)} 次，每一滴都是你的愛` }); }
    if (r.photos.length) out.push({ id: 'photos', tone: 3, kicker: '每個月的你', photos: r.photos.slice(-9), sub: `${r.photos.length} 張月照` });
    if (r.records >= 5) out.push({ id: 'you', tone: 4, kicker: '你記錄了', big: r.recordDays, unit: '天', sub: `一共 ${fmt(r.records)} 筆紀錄` });
    out.push({ id: 'end', tone: 5, title: '這些日子，都記下來了', sub: `${nameOf(b)}會長大，這些紀錄會一直在你的手機裡。`, end: true });
    return out;
  }

  /* ---------------- the share card (1080×1920; counts only) ---------------- */
  function tiles(r) {
    const out = [];
    if (r.feeds) out.push({ v: fmt(r.feeds), u: '次', l: '喝奶' });
    if (r.night) out.push({ v: fmt(r.night), u: '次', l: '半夜餵奶' });
    if (r.diapers) out.push({ v: fmt(r.diapers), u: '片', l: '尿布' });
    if (r.sleepMs >= C.HOUR) out.push({ v: fmt(Math.round(r.sleepMs / C.HOUR)), u: '小時', l: '睡眠' });
    const g = r.growth;
    if (g.w0 && g.w1 && g.w1 > g.w0) out.push({ v: `+${kg(g.w1 - g.w0)}`, u: 'kg', l: '長大了' });
    if (r.pumpMl) { const L = litres(r.pumpMl); out.push({ v: L.v, u: L.u, l: '擠的母乳' }); }
    if (r.foods.length) out.push({ v: fmt(r.foods.length), u: '種', l: '副食品' });
    return out.slice(0, 6);
  }
  async function draw(b, r, now = new Date()) {
    const D = App.share.draw; const F = D.FONT;
    const W = 1080; const H = 1920;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const theme = 'purple';
    const [c1, c2, soft] = D.THEMES[theme];
    await D.paintFrame(ctx, W, H, theme);
    const qs = 250; const fy = H - 64 - qs;
    const px = 64; const pw = W - 128; const top = 232; const ph = fy - 46 - top;
    ctx.fillStyle = 'rgba(255,255,255,0.97)'; D.roundRect(ctx, px, top, pw, ph, 56); ctx.fill();
    const cx = W / 2; const ix = px + 56; const iw = pw - 112;
    const say = (s, x, y, font, color, align = 'center', maxW = iw) => { ctx.font = `${font} ${F}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'top'; ctx.fillText(D.fitLine(ctx, String(s), maxW), x, y); };
    say(PERIODS[r.kind].label, cx, top + 52, '700 34px', c2);
    say(title(b, r.kind, now, true), cx, top + 100, '900 76px', '#2b2231');
    say(`${md(r.from)}～${md(r.to)}`, cx, top + 196, '600 32px', '#7a6f80');
    // the drawn Q版 baby (never a photo)
    const art = App.qbaby ? await D.loadImg(App.qbaby.dataUrl({ ...b, photo: null }, { size: 300, ground: false })) : null;
    const ay = top + 254;
    ctx.fillStyle = soft; ctx.beginPath(); ctx.arc(cx, ay + 120, 120, 0, Math.PI * 2); ctx.fill();
    if (art) { const s = 220; ctx.drawImage(art, cx - s / 2, ay + 120 - s / 2 + 6, s, s * ((art.naturalHeight / art.naturalWidth) || 1)); }
    else { ctx.font = `120px ${F}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('👶', cx, ay + 124); ctx.textBaseline = 'top'; }
    // the numbers, two to a row
    const ts = tiles(r);
    const gy = ay + 280; const gap = 22; const tw = (iw - gap) / 2; const th = 150;
    ts.forEach((tt, i) => {
      const x = ix + (i % 2) * (tw + gap); const y = gy + Math.floor(i / 2) * (th + gap);
      ctx.fillStyle = soft; D.roundRect(ctx, x, y, tw, th, 30); ctx.fill();
      ctx.font = `900 60px ${F}`; const vw = ctx.measureText(tt.v).width; ctx.font = `700 30px ${F}`; const uw = ctx.measureText(` ${tt.u}`).width;
      const sx = x + tw / 2 - (vw + uw) / 2;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = c1; ctx.font = `900 60px ${F}`; ctx.fillText(tt.v, sx, y + 22);
      ctx.font = `700 30px ${F}`; ctx.fillText(` ${tt.u}`, sx + vw, y + 50);
      say(tt.l, x + tw / 2, y + 96, '600 30px', '#5f5566', 'center', tw - 24);
    });
    let y = gy + Math.ceil(ts.length / 2) * (th + gap) + 10;
    r.firsts.slice(-2).forEach((f) => { if (y < fy - 200) { say(`⭐ ${f.label}・${md(f.date)}`, cx, y, '600 34px', '#3d3442'); y += 52; } });
    say('這些日子，都記下來了', cx, Math.min(y + 18, fy - 150), '800 44px', c1);
    D.paintFooter(ctx, W, fy, qs, { theme, path: 'home', campaign: 'recap' });
    return new Promise((res) => cv.toBlob((bl) => res(bl), 'image/png'));
  }
  function text(b, r, now = new Date()) {
    const L = [`【${title(b, r.kind, now, true)}】${md(r.from)}～${md(r.to)}`];
    if (r.feeds) L.push(`🍼 喝奶 ${fmt(r.feeds)} 次${r.night ? `（半夜 ${fmt(r.night)} 次）` : ''}`);
    if (r.diapers) L.push(`🧷 換了 ${fmt(r.diapers)} 片尿布`);
    if (r.sleepMs >= C.HOUR) L.push(`😴 睡了 ${fmt(Math.round(r.sleepMs / C.HOUR))} 小時`);
    const g = r.growth;
    if (g.w0 && g.w1 && g.w1 > g.w0) L.push(`📈 從 ${kg(g.w0)} kg 長到 ${kg(g.w1)} kg`);
    r.firsts.slice(-3).forEach((f) => L.push(`⭐ ${f.label}（${md(f.date)}）`));
    if (r.pumpMl) L.push(`🥛 媽媽擠了 ${litres(r.pumpMl).v} ${litres(r.pumpMl).u}母乳`);
    L.push('這些日子，都記下來了。');
    L.push(`— 用「${B().appName || '易家做媽媽'}」記錄：${App.share.link({ path: 'home', channel: 'line', campaign: 'recap' })}`);
    return L.join('\n');
  }
  async function deliver(how, b, r) {
    const blob = await draw(b, r);
    if (!blob) { ui.toast('回顧卡做不出來，請再試一次'); return; }
    const name = `yijia-recap-${r.kind}.png`;
    if (how === 'share') {
      const thanks = () => {
        const pts = App.share.record ? App.share.record('more', 'recap') : 0;
        ui.toast(`謝謝分享${pts ? `・好孕點數 +${pts}` : ''}`);
      };
      const s = await App.share.sharePicture(blob, name, { text: text(b, r), onShared: thanks });
      if (s === 'shared') { thanks(); return; }
      if (s !== 'none') return; // closed, already open, or 「圖片做好了・分享」 is waiting for her tap
    }
    const res = await App.share.saveImage(blob, name, '成長回顧');
    if (res === 'downloaded') ui.toast(how === 'share' ? '這台裝置不能直接分享圖片，已先下載，可以從相簿傳到 LINE' : '回顧卡已下載');
  }

  /* ---------------- the story player (full screen, like stories) ---------------- */
  const reduced = () => ui.reducedMotion && ui.reducedMotion();
  function countUp(el, to, { plus = false } = {}) {
    const target = Number(String(to).replace(/,/g, ''));
    const decimals = (String(to).split('.')[1] || '').length;
    const exact = `${plus ? '+' : ''}${typeof to === 'number' ? fmt(to) : to}`;
    const show = (v) => { el.textContent = `${plus ? '+' : ''}${decimals ? v.toFixed(decimals) : fmt(v)}`; };
    if (reduced() || !Number.isFinite(target)) { el.textContent = exact; return; }
    const t0 = performance.now(); const dur = 1100;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); const e = 1 - (1 - k) ** 3; if (k < 1 && el.isConnected) { show(target * e); requestAnimationFrame(step); } else el.textContent = exact; }; // it ends on the exact number
    requestAnimationFrame(step);
  }
  function open(b, kind = 'now') {
    if (!b || !b.birthday) { ui.toast('先填寶寶的生日，才能做回顧'); return null; }
    const now = new Date();
    const r = build(b, kind, now);
    const list = slides(b, r, now);
    let i = 0; let timer = 0; let paused = false;
    const bars = h('div', { class: 'rc-bars', 'aria-hidden': 'true' }, list.map(() => h('span', null, h('i'))));
    const stage = h('div', { class: 'rc-stage', 'aria-live': 'polite' });
    const closeBtn = h('button', { class: 'rc-x', 'aria-label': '關閉回顧' }, '✕');
    const prevBtn = h('button', { class: 'rc-tap rc-prev', 'aria-label': '上一張' });
    const nextBtn = h('button', { class: 'rc-tap rc-next', 'aria-label': '下一張' });
    const root = h('div', { class: 'rc', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${title(b, kind, now)}・成長回顧`, tabindex: '-1' }, bars, closeBtn, stage, prevBtn, nextBtn);
    const prevFocus = document.activeElement;
    const close = () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); root.classList.add('out'); setTimeout(() => root.remove(), 220); document.body.classList.remove('rc-open'); try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) { /* fine */ } };
    const schedule = () => { clearTimeout(timer); if (!paused && !list[i].end) timer = setTimeout(() => go(i + 1), list[i].photos ? 6500 : 5200); };
    function paint() {
      const s = list[i];
      root.dataset.tone = String(s.tone || 0); root.dataset.slide = s.id;
      [...bars.children].forEach((x, k) => { x.className = k < i ? 'done' : k === i ? (paused ? 'on paused' : 'on') : ''; }); // eslint-disable-line no-nested-ternary
      stage.innerHTML = '';
      const kids = [];
      if (s.art && App.qbaby) kids.push(h('div', { class: 'rc-art', 'aria-hidden': 'true' }, App.qbaby.face({ ...b, photo: null }, { size: 140 })));
      if (s.kicker) kids.push(h('div', { class: 'rc-kicker' }, s.kicker));
      if (s.title) kids.push(h('h2', { class: 'rc-title' }, s.title));
      if (s.big != null) {
        const n = h('span', { class: 'rc-num' }, '0');
        kids.push(h('div', { class: 'rc-big' }, n, h('span', { class: 'rc-unit' }, s.unit || '')));
        countUp(n, s.big, { plus: s.plus });
      }
      if (s.list) kids.push(h('ul', { class: 'rc-list' }, s.list.map((x) => h('li', null, `⭐ ${x}`))));
      if (s.photos) {
        const grid = h('div', { class: 'rc-photos' });
        s.photos.forEach((p) => {
          const im = h('img', { alt: '', class: 'rc-ph' });
          const c = p.crop || {};
          im.style.objectPosition = `${((1 + (c.x || 0)) / 2) * 100}% ${((1 + (c.y || 0)) / 2) * 100}%`;
          (App.monthly && App.monthly.photoUrl ? App.monthly.photoUrl(p.id) : Promise.resolve(null)).then((u) => { if (u) im.src = u; });
          grid.append(h('figure', null, im, h('figcaption', null, App.monthly ? App.monthly.label(p.m).text : '')));
        });
        kids.push(grid);
      }
      if (s.sub) kids.push(h('p', { class: 'rc-sub' }, s.sub));
      if (s.end) {
        // making the card takes a moment: the button says so, and a second tap meanwhile does nothing
        const shareB = h('button', { class: 'btn btn-primary btn-block rc-share', onclick: (e) => { e.stopPropagation(); ui.busy(shareB, () => deliver('share', b, r), { also: [saveB] }); } }, '📤 分享回顧卡');
        const saveB = h('button', { class: 'btn btn-soft grow rc-save', onclick: (e) => { e.stopPropagation(); ui.busy(saveB, () => deliver('save', b, r), { also: [shareB] }); } }, '💾 存圖片');
        kids.push(h('div', { class: 'rc-actions' }, shareB,
          h('div', { class: 'row gap' }, saveB,
            h('button', { class: 'btn btn-soft grow rc-again', onclick: (e) => { e.stopPropagation(); go(0); } }, '↺ 再看一次'))));
      }
      stage.append(h('div', { class: 'rc-card' }, kids));
      prevBtn.disabled = i === 0;
      nextBtn.hidden = !!s.end;
      schedule();
    }
    function go(k) { i = Math.max(0, Math.min(list.length - 1, k)); paint(); }
    const onKey = (e) => {
      if (!root.isConnected) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(i + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    };
    closeBtn.addEventListener('click', close);
    prevBtn.addEventListener('click', () => go(i - 1));
    nextBtn.addEventListener('click', () => go(i + 1));
    // hold to pause (like stories); swipe down to close
    let down = null;
    root.addEventListener('pointerdown', (e) => { if (e.target.closest('.rc-actions, .rc-x')) return; down = { y: e.clientY, t: Date.now() }; paused = true; clearTimeout(timer); [...bars.children][i].classList.add('paused'); });
    root.addEventListener('pointerup', (e) => {
      if (!down) return;
      const dy = e.clientY - down.y; down = null; paused = false;
      [...bars.children][i].classList.remove('paused');
      if (dy > 90) { close(); return; }
      schedule();
    });
    document.addEventListener('keydown', onKey);
    document.body.append(root); document.body.classList.add('rc-open');
    root.focus({ preventScroll: true });
    paint();
    return { close, go, slides: list, data: r };
  }

  /* ---------------- the screen: the recaps this baby has ---------------- */
  App.screen('recap', {
    title: '成長回顧',
    tab: 'health',
    render(el, params) {
      const s = store.state; const babies = s.babies || [];
      const b = babies.find((x) => x.id === (params && params.baby)) || store.baby();
      if (!b) { el.append(ui.card({ class: 'soft center' }, h('p', null, '寶寶出生後，滿月、百日、週歲都會有一份回顧。'))); return; }
      if (!b.birthday) { el.append(ui.card({ class: 'soft center' }, h('p', null, '先填寶寶的生日，才能做回顧。'), App.me && App.me.editBaby ? h('button', { class: 'btn btn-primary mt', onclick: () => App.me.editBaby(b) }, '填生日') : null)); return; }
      if (babies.length > 1) el.append(h('div', { class: 'mb' }, ui.seg(babies.map((x) => ({ value: x.id, label: x.name || '寶寶' })), b.id, (v) => App.navigate('recap', { baby: v }), { small: true })));
      const now = new Date(); const d = ageDays(b, now);
      const have = available(b, now).map((x) => x.kind);
      el.append(h('p', { class: 'small muted rc-lead' }, '把這段日子的紀錄做成一段回顧：喝了幾次奶、陪了幾個深夜、長大了多少。在這支手機上做，不會上傳。'));
      el.append(h('div', { class: 'rc-tiles' }, ORDER.map((k) => {
        const P = PERIODS[k]; const ok = have.includes(k);
        const left = k === 'now' ? 0 : P.days - d;
        return h('button', {
          type: 'button', class: `rc-tile${ok ? '' : ' locked'}`, dataset: { kind: k }, 'aria-label': ok ? `${P.label}，打開` : `${P.label}，還有 ${left} 天`,
          onclick: () => { if (ok) open(b, k); else ui.toast(`${P.label}還有 ${left} 天，到時候再來看`); },
        }, h('span', { class: 'rc-te', 'aria-hidden': 'true' }, ok ? P.emoji : '🔒'), h('b', null, k === 'now' ? `${title(b, 'now', now)}` : P.label), h('small', null, ok ? (k === 'now' ? '到今天為止' : '已經可以看了') : `還有 ${left} 天`));
      })));
      if (params && params.kind && have.includes(params.kind) && !el.dataset.autoplay) { el.dataset.autoplay = '1'; setTimeout(() => open(b, params.kind), 80); }
    },
  });

  App.tool({
    id: 'recap', title: '成長回顧', icon: '🎬', desc: '滿月、百日、週歲，做成一段回顧', stages: ['baby'], screen: 'recap', order: 33, group: '成長發育',
    tags: ['回顧', '年度回顧', '週歲', '百日', '滿月', '成長', '紀念', '一年'],
  });

  App.recap = {
    PERIODS, available, build, slides, open, draw, text, tiles,
  };
}());
