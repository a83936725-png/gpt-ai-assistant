/* 分享與裂變：
 *   App.share.open({...})      分享面板（LINE／IG／Facebook／Threads／複製連結／更多）
 *   App.share.card(kind)       品牌分享卡（1080×1920，含邀請碼 QR）
 *   App.share.moment(id, ...)  關鍵時刻提醒分享（每天最多一次、可關閉）
 *   App.share.button(...)      各頁面的分享按鈕
 *   邀請碼（?ref=）、好孕點數、邀請好友頁 'invite'
 * 寶寶照片預設不放上分享卡；醫療紀錄不做成公開分享卡。 */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const B = () => window.BRAND || {};

  /* ================= state + referral capture ================= */
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const genCode = () => Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
  const ensure = (s) => {
    s.share = s.share || {};
    const sh = s.share;
    if (!sh.code) sh.code = genCode();
    sh.events = sh.events || [];
    sh.points = sh.points || 0;
    sh.moments = sh.moments || {};
    sh.muted = sh.muted || {};
    sh.privacy = sh.privacy || { showName: true, showPhoto: false };
    return sh;
  };
  ensure(store.state);
  store.save();

  (function captureReferral() {
    const qs = new URLSearchParams(location.search);
    const ref = (qs.get('ref') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (!ref) return;
    const sh = ensure(store.state);
    if (!sh.invitedBy && ref !== sh.code) {
      sh.invitedBy = ref;
      sh.inviterName = (qs.get('from') || '').slice(0, 20);
      sh.invitedAt = new Date().toISOString();
      sh.landing = { source: qs.get('utm_source') || '', campaign: qs.get('utm_campaign') || '' };
      store.save();
    }
    const keep = new URLSearchParams();
    if (qs.get('action')) keep.set('action', qs.get('action'));
    history.replaceState(history.state, '', location.pathname + (keep.toString() ? `?${keep}` : '') + location.hash);
  }());

  /* ================= links ================= */
  const baseUrl = () => (B().appUrl || location.href).split(/[?#]/)[0];
  function link({ path = 'home', params, channel = 'link', campaign = 'share' } = {}) {
    const sh = ensure(store.state);
    const q = new URLSearchParams();
    q.set('ref', sh.code);
    const name = store.state.profile.momName;
    if (name && sh.privacy.showName) q.set('from', name);
    q.set('utm_source', channel); q.set('utm_medium', 'share'); q.set('utm_campaign', campaign);
    const hp = params && Object.keys(params).length ? `?${encodeURIComponent(JSON.stringify(params))}` : '';
    return `${baseUrl()}?${q.toString()}#/${path}${hp}`;
  }
  const tags = () => (B().hashtags || []).map((t) => `#${t}`).join(' ');

  /* ================= points ================= */
  const POINTS = { line: 10, ig: 20, fb: 10, threads: 10, copy: 5, more: 10, invite: 15 };
  function record(channel, campaign) {
    let gained = 0;
    store.update((s) => {
      const sh = ensure(s);
      const today = C.dateKey();
      const todayPts = sh.events.filter((e) => e.at.slice(0, 10) === today).reduce((n, e) => n + (e.pts || 0), 0);
      gained = Math.max(0, Math.min(POINTS[channel] || 5, 60 - todayPts)); // 每天最多 60 點
      sh.events.push({ at: new Date().toISOString(), channel, campaign, pts: gained });
      if (sh.events.length > 300) sh.events = sh.events.slice(-300);
      sh.points += gained;
    });
    return gained;
  }
  const REWARDS = () => [
    { points: 30, icon: '🥉', title: '分享新手徽章' },
    { points: 60, icon: '🏅', title: '好孕島金色印章框' },
    { points: (B().shareReward && B().shareReward.points) || 100, icon: '🎁', title: (B().shareReward && B().shareReward.title) || '品牌好禮', brand: true },
  ];

  /* ================= share card renderer (canvas) ================= */
  const FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei","Heiti TC",sans-serif';
  const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  function wrap(ctx, text, maxW) {
    const lines = []; let line = '';
    [...String(text)].forEach((ch) => {
      if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; } else line += ch;
    });
    if (line) lines.push(line);
    return lines;
  }
  function roundRect(ctx, x, y, w, h0, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h0, r); ctx.arcTo(x + w, y + h0, x, y + h0, r);
    ctx.arcTo(x, y + h0, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawQR(ctx, text, x, y, size) {
    if (typeof window.qrcode !== 'function') return false;
    const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
    const n = qr.getModuleCount(); const cell = size / (n + 2);
    ctx.fillStyle = '#fff'; roundRect(ctx, x, y, size, size, 18); ctx.fill();
    ctx.fillStyle = '#2b2231';
    for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) ctx.fillRect(x + (c + 1) * cell, y + (r + 1) * cell, Math.ceil(cell), Math.ceil(cell));
    return true;
  }
  const THEMES = {
    purple: ['#4a1f62', '#7b4597', '#f2e9f6'],
    peach: ['#b0502f', '#ee8b6f', '#fdeee8'],
    green: ['#1f6b4a', '#4fa77a', '#e3f4ec'],
    night: ['#1d1a3a', '#4b3f8a', '#ece8ff'],
  };
  // spec: {emoji, kicker, title, subtitle, stats:[{v,l}], lines:[], theme, photo, campaign, path, params}
  async function render(spec, { format = 'story' } = {}) {
    const W = 1080; const H = format === 'story' ? 1920 : 1350;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const [c1, c2, soft] = THEMES[spec.theme] || THEMES.purple;
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.09; ctx.fillStyle = '#fff';
    [[900, 260, 260], [140, 720, 200], [980, 1300, 320], [120, 1650, 150]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y * (H / 1920), r, 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 1;
    // header: logo + app name
    const logo = await loadImg(B().logo || 'assets/logo.svg');
    ctx.fillStyle = '#fff'; roundRect(ctx, 64, 72, 108, 108, 30); ctx.fill();
    if (logo) ctx.drawImage(logo, 78, 82, 80, 88);
    ctx.fillStyle = '#fff'; ctx.font = `800 46px ${FONT}`; ctx.textBaseline = 'top';
    ctx.fillText(B().appName || '易家做媽媽', 196, 84);
    ctx.globalAlpha = 0.85; ctx.font = `500 30px ${FONT}`; ctx.fillText(B().tagline || '', 196, 142); ctx.globalAlpha = 1;
    // main panel
    const px = 64; const pw = W - 128; let y = format === 'story' ? 300 : 240;
    const panelH = format === 'story' ? 1170 : 760;
    ctx.fillStyle = 'rgba(255,255,255,0.97)'; roundRect(ctx, px, y, pw, panelH, 56); ctx.fill();
    const cx = W / 2; y += 70;
    // emoji / photo
    const photo = spec.photo ? await loadImg(spec.photo) : null;
    ctx.fillStyle = soft; ctx.beginPath(); ctx.arc(cx, y + 130, 130, 0, Math.PI * 2); ctx.fill();
    if (photo) { ctx.save(); ctx.beginPath(); ctx.arc(cx, y + 130, 122, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(photo, cx - 122, y + 8, 244, 244); ctx.restore(); }
    else { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `150px ${FONT}`; ctx.fillText(spec.emoji || '💜', cx, y + 138); }
    y += 300;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if (spec.kicker) { ctx.fillStyle = c2; ctx.font = `700 36px ${FONT}`; ctx.fillText(spec.kicker, cx, y); y += 62; }
    ctx.fillStyle = '#2b2231'; ctx.font = `900 80px ${FONT}`;
    wrap(ctx, spec.title || '', pw - 120).slice(0, 3).forEach((ln) => { ctx.fillText(ln, cx, y); y += 98; });
    if (spec.subtitle) {
      ctx.fillStyle = '#5f5566'; ctx.font = `500 38px ${FONT}`;
      wrap(ctx, spec.subtitle, pw - 140).slice(0, 3).forEach((ln) => { ctx.fillText(ln, cx, y + 6); y += 54; });
      y += 14;
    }
    if (spec.stats && spec.stats.length) {
      const n = Math.min(3, spec.stats.length); const gap = 22; const sw = (pw - 120 - gap * (n - 1)) / n;
      spec.stats.slice(0, 3).forEach((st, i) => {
        const sx = px + 60 + i * (sw + gap);
        ctx.fillStyle = soft; roundRect(ctx, sx, y + 10, sw, 150, 30); ctx.fill();
        ctx.fillStyle = c1; ctx.font = `900 52px ${FONT}`; ctx.fillText(String(st.v), sx + sw / 2, y + 36);
        ctx.fillStyle = '#5f5566'; ctx.font = `500 28px ${FONT}`; ctx.fillText(st.l, sx + sw / 2, y + 106);
      });
      y += 190;
    }
    if (spec.lines && spec.lines.length) {
      ctx.textAlign = 'left'; ctx.fillStyle = '#3d3442'; ctx.font = `500 34px ${FONT}`;
      spec.lines.slice(0, format === 'story' ? 5 : 3).forEach((ln) => {
        wrap(ctx, `• ${ln}`, pw - 140).slice(0, 2).forEach((l2) => { if (y < 300 + panelH - 60) { ctx.fillText(l2, px + 70, y); y += 50; } });
      });
      ctx.textAlign = 'center';
    }
    // footer: QR + invite
    const fy = (format === 'story' ? 300 + 1170 : 240 + 760) + 60;
    const url = link({ path: spec.path || 'home', params: spec.params, channel: 'qr', campaign: spec.campaign || 'card' });
    const qs = format === 'story' ? 300 : 230;
    const hasQR = drawQR(ctx, url, 64, fy, qs);
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
    const tx = hasQR ? 64 + qs + 44 : 64;
    ctx.font = `800 44px ${FONT}`; ctx.fillText('掃描一起用・免費', tx, fy + 20);
    ctx.font = `600 34px ${FONT}`; ctx.globalAlpha = 0.92;
    ctx.fillText(`邀請碼 ${ensure(store.state).code}`, tx, fy + 88);
    ctx.font = `500 28px ${FONT}`;
    wrap(ctx, tags(), W - tx - 64).slice(0, 2).forEach((ln, i) => ctx.fillText(ln, tx, fy + 146 + i * 40));
    ctx.globalAlpha = 1;
    return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
  }

  /* ================= card catalog (what can be shared right now) ================= */
  function babyAgeInfo(b) { return b ? C.babyAge(b.birthday) : null; }
  const CUSTOMS = [
    { id: 'm30', day: 30, emoji: '🎂', title: '滿月了！', sub: '謝謝每一個陪我們走過第一個月的人' },
    { id: 'd100', day: 100, emoji: '💯', title: '百日快樂！', sub: '一百天的小小奇蹟' },
    { id: 'm4', month: 4, emoji: '🍪', title: '四個月收涎', sub: '收收口水，平安長大' },
    { id: 'y1', month: 12, emoji: '🎉', title: '一歲度晬！', sub: '抓周看看寶寶以後喜歡什麼' },
  ];
  function customFor(b, now = new Date()) {
    const a = babyAgeInfo(b); if (!a) return null;
    return CUSTOMS.find((c) => (c.day ? a.days + 1 >= c.day && a.days + 1 <= c.day + 6 : a.months === c.month && a.remDays <= 6)) || null;
  }
  function cards() {
    const s = store.state; const out = [];
    const priv = ensure(s).privacy;
    const b = store.baby();
    const bname = (bb) => (priv.showName ? bb.name : '寶寶');
    const photo = (bb) => (priv.showPhoto && bb.photo ? bb.photo : null);
    if (store.inStage(['preg']) && App.preg && App.preg.pregLmp && App.preg.pregLmp()) {
      const ga = C.gestAge(App.preg.pregLmp());
      const wk = App.preg.weekInfo(ga.weeks);
      if (ga.totalDays >= 0 && wk) {
        out.push({
          kind: 'preg-week', label: '孕週卡', campaign: 'preg-week',
          spec: { emoji: wk.emoji, kicker: '懷孕週記', title: `懷孕 ${ga.weeks} 週 ${ga.days} 天`, subtitle: `寶寶大約像${wk.fruit}一樣大（約 ${wk.len} cm）`, stats: [{ v: Math.max(0, ga.daysLeft), l: '天後見面' }, { v: `第${ga.trimester}`, l: '孕期' }], theme: 'purple' },
          text: `懷孕 ${ga.weeks} 週 ${ga.days} 天了！寶寶現在大約像${wk.fruit}一樣大 ${wk.emoji}`,
        });
      }
    }
    if (b) {
      const a = babyAgeInfo(b);
      const g = s.growth.filter((x) => x.babyId === b.id && x.weight).sort((x, y) => (x.date < y.date ? 1 : -1))[0];
      const stats = [{ v: a ? a.days + 1 : '-', l: '出生第幾天' }];
      if (g || b.birthWeight) stats.push({ v: `${(g && g.weight) || b.birthWeight}`, l: '公斤' });
      const gl = s.growth.filter((x) => x.babyId === b.id && x.length).sort((x, y) => (x.date < y.date ? 1 : -1))[0];
      if (gl || b.birthLength) stats.push({ v: `${(gl && gl.length) || b.birthLength}`, l: '公分' });
      out.push({ kind: 'baby-age', label: '成長卡', campaign: 'baby-age', spec: { emoji: b.avatar || '👶', photo: photo(b), kicker: '寶寶成長日記', title: `${bname(b)} ${a ? a.text : ''}`, subtitle: '每天都在長大一點點', stats, theme: 'peach' }, text: `${bname(b)} ${a ? a.text : ''}了，每天都在長大一點點 💕` });
      const cu = customFor(b);
      if (cu) out.push({ kind: `custom-${cu.id}`, label: cu.title.replace('！', ''), campaign: `custom-${cu.id}`, spec: { emoji: cu.emoji, photo: photo(b), kicker: bname(b), title: cu.title, subtitle: cu.sub, theme: 'peach' }, text: `${bname(b)} ${cu.title}${cu.sub}` });
      if (a && a.days <= 60) {
        const bt = b.birthTime ? ` ${b.birthTime}` : '';
        out.push({ kind: 'birth', label: '出生卡', campaign: 'birth', spec: { emoji: '🍼', photo: photo(b), kicker: '歡迎來到這個世界', title: bname(b), subtitle: `${C.fmtDateLong(b.birthday)}${bt}`, stats: [b.birthWeight ? { v: b.birthWeight, l: '公斤' } : null, b.birthLength ? { v: b.birthLength, l: '公分' } : null].filter(Boolean), theme: 'green' }, text: `歡迎 ${bname(b)} 來到這個世界！🎉` });
      }
      const ms = s.milestones[b.id] || {};
      const last = Object.entries(ms).sort((x, y) => (x[1] < y[1] ? 1 : -1))[0];
      if (last && App.HEALTH) {
        const item = App.HEALTH.MILESTONES.flatMap((band) => band.items).find((it) => it[0] === last[0]);
        if (item) out.push({ kind: 'milestone', label: '里程碑卡', campaign: 'milestone', spec: { emoji: '⭐', photo: photo(b), kicker: `${bname(b)} 的新技能`, title: item[2], subtitle: `${C.fmtDateLong(last[1])} 達成`, theme: 'green' }, text: `${bname(b)} 新技能解鎖：${item[2]}！⭐` });
      }
    }
    const streak = App.chicken ? App.chicken.streak() : 0;
    if (streak >= 3) out.push({ kind: 'streak', label: '打卡卡', campaign: 'streak', spec: { emoji: '💜', kicker: '每天留一點時間給自己', title: `滴雞精時光 連續 ${streak} 天`, subtitle: `${B().brandName || ''}陪我好好照顧自己`, theme: 'purple' }, text: `我已經連續 ${streak} 天好好照顧自己了 💜` });
    const stamps = Object.keys((s.island && s.island.stamps) || {}).length;
    if (stamps && App.ISLAND) {
      const title = [...App.ISLAND.TITLES].reverse().find((t) => stamps >= t.min);
      out.push({ kind: 'island', label: '好孕島稱號', campaign: 'island', path: 'island', spec: { emoji: '🏝️', kicker: '好孕島', title: title ? title.label : '島民', subtitle: `已收集 ${stamps}／${App.ISLAND.SPOTS.length} 個印章`, theme: 'night', path: 'island' }, text: `我在好孕島收集了 ${stamps} 個印章，成為「${title ? title.label : '島民'}」🏝️ 一起來逛！` });
    }
    const pp = App.journey && App.journey.ppInfo ? App.journey.ppInfo() : null;
    if (pp && pp.day <= 45) out.push({ kind: 'pp', label: '坐月子卡', campaign: 'postpartum', spec: { emoji: '🍲', kicker: '坐月子日記', title: pp.day >= 30 ? '產後滿月，辛苦了！' : `產後第 ${pp.day} 天`, subtitle: '好好休息，也是在照顧寶寶', theme: 'peach' }, text: pp.day >= 30 ? '產後滿月了，謝謝一路陪伴的家人朋友 💜' : `坐月子第 ${pp.day} 天，好好休息中 🍲` });
    return out;
  }

  /* ================= share sheet ================= */
  const enc = encodeURIComponent;
  const openUrl = (u) => window.open(u, '_blank', 'noopener');
  const ICON = {
    ig: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor"/></svg>',
    fb: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3Z"/></svg>',
    threads: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16.5 11.2c-.6-2.6-2.6-3.6-4.6-3.4-2.4.2-3.6 1.9-3.4 3.6.2 1.8 1.9 2.8 3.8 2.6 2.2-.2 3.6-1.9 3.4-4.8M16.6 9c.9 4 .3 7.6-3.9 8.6-4.6 1.1-8.2-1.8-8.2-5.9 0-4.7 3.5-7.6 7.7-7.6 3.8 0 6.6 2.1 7.2 5.4"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v11M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/></svg>',
  };
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, t); document.body.append(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; } ta.remove(); return ok;
    }
  }
  function downloadBlob(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function thanks(gained) { ui.toast(gained ? `謝謝分享 💜 好孕點數 +${gained}` : '謝謝分享 💜'); }

  // payload: {title, text, path, params, campaign, spec (card spec) | kind, article:true}
  function open(payload = {}) {
    const p = { campaign: 'share', path: 'home', ...payload };
    if (p.kind && !p.spec) { const c = cards().find((x) => x.kind === p.kind); if (c) Object.assign(p, { spec: c.spec, text: p.text || c.text, campaign: c.campaign, path: c.path || p.path }); }
    if (!p.spec && p.text) p.spec = { emoji: p.emoji || '📖', kicker: p.kicker || '易家做媽媽・小知識', title: p.title || '', subtitle: '', lines: p.lines || [], theme: p.theme || 'purple', path: p.path, params: p.params };
    if (p.spec) { p.spec.path = p.spec.path || p.path; p.spec.params = p.spec.params || p.params; p.spec.campaign = p.campaign; }
    const fullText = (ch) => `${p.text || p.title || ''}\n${link({ path: p.path, params: p.params, channel: ch, campaign: p.campaign })}\n${tags()}`;
    let blobP = null;
    const getBlob = () => { if (!blobP) blobP = render(p.spec); return blobP; };
    const preview = h('div', { class: 'sh-preview' }, h('div', { class: 'sh-preview-ph' }, '產生分享卡中…'));
    if (p.spec) getBlob().then((blob) => { if (!blob) return; preview.innerHTML = ''; preview.append(h('img', { src: URL.createObjectURL(blob), alt: '分享卡預覽', class: 'sh-img' })); });
    else preview.remove();
    const act = async (ch) => {
      if (ch === 'line') { openUrl(`https://line.me/R/share?text=${enc(fullText('line'))}`); thanks(record('line', p.campaign)); return; }
      if (ch === 'fb') { openUrl(`https://www.facebook.com/sharer/sharer.php?u=${enc(link({ path: p.path, params: p.params, channel: 'facebook', campaign: p.campaign }))}&quote=${enc(p.text || '')}`); thanks(record('fb', p.campaign)); return; }
      if (ch === 'threads') { openUrl(`https://www.threads.net/intent/post?text=${enc(fullText('threads'))}`); thanks(record('threads', p.campaign)); return; }
      if (ch === 'copy') { const ok = await copyText(fullText('copy')); ui.toast(ok ? '已複製文字與連結' : '複製失敗，請長按選取'); if (ok) record('copy', p.campaign); return; }
      if (ch === 'ig' || ch === 'more') {
        const blob = p.spec ? await getBlob() : null;
        const file = blob ? new File([blob], 'yijia-share.png', { type: 'image/png' }) : null;
        const data = { title: p.title || (B().appName || ''), text: fullText(ch === 'ig' ? 'instagram' : 'native') };
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
        else data.url = link({ path: p.path, params: p.params, channel: ch === 'ig' ? 'instagram' : 'native', campaign: p.campaign });
        if (navigator.share && (ch === 'more' || data.files)) {
          try { await navigator.share(data); thanks(record(ch, p.campaign)); } catch (e) { if (e && e.name !== 'AbortError') ui.toast('無法分享，請改用其他方式'); }
          return;
        }
        if (ch === 'ig') { // desktop / no Web Share: download the card + copy caption
          if (blob) downloadBlob(blob, `易家做媽媽-${p.campaign}.png`);
          await copyText(fullText('instagram'));
          ui.toast('圖片已下載、文字已複製：打開 IG 限時動態選這張圖，加上「連結」貼紙貼上即可', { ms: 6000 });
          thanks(record('ig', p.campaign));
          return;
        }
        await copyText(fullText('copy')); ui.toast('已複製文字與連結'); record('copy', p.campaign);
      }
    };
    const chBtn = (id, label, iconHtml, cls) => h('button', { class: `sh-ch ${cls || ''}`, onclick: () => act(id), 'aria-label': `分享到${label}` },
      h('span', { class: 'sh-ch-ico', html: iconHtml }), h('span', { class: 'sh-ch-l' }, label));
    const priv = ensure(store.state).privacy;
    const privRow = p.spec && (p.kind === 'baby-age' || p.kind === 'birth' || p.kind === 'milestone' || (p.kind || '').startsWith('custom')) ? h('div', { class: 'sh-priv' },
      h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: priv.showName, onchange: (e) => { store.update((s) => { ensure(s).privacy.showName = e.target.checked; }); sheet.close(); setTimeout(() => open({ ...payload, spec: null }), 240); } }), h('span', { class: 'small' }, '顯示寶寶名字')),
      store.baby() && store.baby().photo ? h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: priv.showPhoto, onchange: (e) => { store.update((s) => { ensure(s).privacy.showPhoto = e.target.checked; }); sheet.close(); setTimeout(() => open({ ...payload, spec: null }), 240); } }), h('span', { class: 'small' }, '放寶寶照片')) : null) : null;
    const sheet = ui.sheet({
      title: p.sheetTitle || '分享',
      body: h('div', { class: 'sh-body' },
        preview,
        privRow,
        h('div', { class: 'sh-grid' },
          chBtn('line', 'LINE', ui.ICONS.line, 'sh-line'),
          chBtn('ig', 'Instagram', ICON.ig, 'sh-ig'),
          chBtn('fb', 'Facebook', ICON.fb, 'sh-fb'),
          chBtn('threads', 'Threads', ICON.threads, 'sh-th'),
          chBtn('copy', '複製連結', ICON.copy, ''),
          chBtn('more', '更多', ICON.more, '')),
        h('p', { class: 'tiny muted center' }, `連結含你的邀請碼 ${ensure(store.state).code}・分享可得好孕點數`)),
    });
    return sheet;
  }

  /* ================= moments (gentle prompts at big moments) ================= */
  const pending = [];
  function moment(id, opts = {}) {
    const { emoji = '🎉', msg, kind, payload, mutedKey, force = false, queue = false } = opts;
    const sh = ensure(store.state);
    const key = mutedKey || (kind || 'misc');
    if (sh.moments[id] || sh.muted[key] || window.__noShareMoments) return false; // tests can switch prompts off
    if (!force && sh.lastPromptAt && Date.now() - new Date(sh.lastPromptAt) < 20 * C.HOUR) return false;
    if (document.body.classList.contains('has-sheet')) {
      if (queue && !pending.some((x) => x.id === id)) pending.push({ id, opts }); // show after the current sheet closes
      return false;
    }
    store.update((s) => { const x = ensure(s); x.moments[id] = C.dateKey(); x.lastPromptAt = new Date().toISOString(); });
    const sheet = ui.sheet({
      title: `${emoji} ${msg}`,
      body: h('div', { class: 'sh-moment' },
        h('p', { class: 'small muted' }, '把這個時刻分享給家人朋友吧！分享卡已經幫你做好了。'),
        h('button', { class: 'btn btn-primary btn-block', onclick: () => { sheet.close(); setTimeout(() => open(payload || { kind }), 240); } }, '📤 做成分享卡'),
        h('div', { class: 'row gap mt' },
          h('button', { class: 'btn btn-ghost grow', onclick: () => sheet.close() }, '這次先不要'),
          h('button', { class: 'btn btn-ghost grow', onclick: () => { store.update((s) => { ensure(s).muted[key] = true; }); sheet.close(); ui.toast('不會再提醒這類分享'); } }, '不要再提醒這類'))),
    });
    return true;
  }
  new MutationObserver(() => {
    if (pending.length && !document.body.classList.contains('has-sheet')) {
      const next = pending.shift();
      setTimeout(() => moment(next.id, { ...next.opts, queue: false }), 450);
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  function checkMoments() {
    if (!store.state.onboarded) return;
    // the day someone sets the app up is for getting started, not for share prompts
    if (store.state.onboardedAt && C.dateKey(store.state.onboardedAt) === C.dateKey()) return;
    if (store.inStage(['preg']) && App.preg && App.preg.pregLmp && App.preg.pregLmp()) {
      const ga = C.gestAge(App.preg.pregLmp());
      // only when the week has really changed since we last looked (not the week the app was started in)
      const seen = ensure(store.state).seenWeek;
      if (seen !== ga.weeks) store.update((s) => { ensure(s).seenWeek = ga.weeks; });
      if (seen && ga.weeks > seen && ga.weeks >= 5 && ga.weeks <= 42 && moment(`pw-${App.preg.pregLmp()}-${ga.weeks}`, { emoji: '🤰', msg: `進入第 ${ga.weeks} 週了！`, kind: 'preg-week' })) return;
    }
    // 滿月、收涎、百日、度晬 are shown as a warm card on 首頁 (custom-moment below), not as a pop-up
    const pp = App.journey && App.journey.ppInfo ? App.journey.ppInfo() : null;
    const cuNow = store.baby() ? customFor(store.baby()) : null;
    if (pp && pp.day >= 30 && pp.day <= 36 && !(cuNow && cuNow.id === 'm30') && moment(`pp30-${pp.start}`, { emoji: '🍲', msg: '產後滿月，坐月子辛苦了！', kind: 'pp' })) return;
    const streak = App.chicken ? App.chicken.streak() : 0;
    const hit = [7, 14, 30, 60, 100].find((n) => streak === n);
    if (hit) moment(`streak-${hit}-${C.dateKey(C.addDays(new Date(), -hit))}`, { emoji: '💜', msg: `連續 ${hit} 天好好照顧自己！`, kind: 'streak' });
  }
  /* 滿月・百日・四個月收涎・度晬：during that week a one-line banner sits right under the baby on 首頁 (so the
   * little celebration the first time it shows is seen, not off-screen). Tapping it shows the custom in a line and
   * the share card one tap away. Nothing pops up by itself. */
  const TRADITION = {
    m30: '滿月習俗：剃胎毛、分送滿月油飯或蛋糕，謝謝這個月幫忙的親友。',
    d100: '百日：拍一張百日照，記下這一百天的樣子。',
    m4: '收涎：把收涎餅串起來掛在寶寶胸前，請親友來幫忙「收口水」。',
    y1: '度晬：準備抓周的小物，看看寶寶先拿起什麼。',
  };
  let cheering = null;
  function momentLine(b) {
    if (!b) return null;
    const cu = customFor(b); if (!cu) return null;
    const key = `${b.id}-${cu.id}`;
    const show = () => {
      const sh = ui.sheet({
        title: `${cu.emoji} ${b.name} ${cu.title}`,
        body: h('div', { class: 'sh-moment' },
          h('p', null, cu.sub),
          TRADITION[cu.id] ? h('p', { class: 'small muted' }, TRADITION[cu.id]) : null,
          h('button', { class: 'btn btn-primary btn-block mt', onclick: () => { sh.close(); setTimeout(() => open({ kind: `custom-${cu.id}` }), 240); } }, '📤 做成分享卡')),
      });
    };
    const el = h('button', { class: 'moment-line', onclick: show },
      h('span', { class: 'moment-emoji', 'aria-hidden': 'true' }, cu.emoji),
      h('span', { class: 'grow' }, h('strong', null, `${b.name} ${cu.title}`), h('span', { class: 'moment-more' }, '習俗・分享卡')),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
    if (!(ensure(store.state).cheered || {})[key] && cheering !== key && !window.__noShareMoments) {
      cheering = key;
      setTimeout(() => {
        store.update((st) => { const x = ensure(st); x.cheered = { ...(x.cheered || {}), [key]: C.dateKey() }; });
        const line = document.querySelector('.moment-line');
        ui.celebrate({ from: line || undefined, emojis: [cu.emoji, '🎉', '💜', '✨'] });
      }, 500);
    }
    return el;
  }

  // runs after the home screen renders (renders nothing itself)
  App.homeCard('share-moments', { stages: ['prep', 'preg', 'baby'], order: 999, render() { setTimeout(checkMoments, 700); } });

  /* ================= small share button for any screen ================= */
  function button(getPayload, { label = '分享', cls = 'btn btn-sm btn-soft', icon = true } = {}) {
    return h('button', { class: `${cls} sh-btn`, 'aria-label': label, onclick: (e) => { e.stopPropagation(); open(typeof getPayload === 'function' ? getPayload() : getPayload); } },
      icon ? h('span', { class: 'ic', html: ICON.more }) : null, label);
  }

  /* ================= 邀請好友 screen ================= */
  function inviteText() {
    const name = store.state.profile.momName;
    return `${name ? `${name}邀請你` : '推薦你'}一起用「${B().appName || '易家做媽媽'}」💜\n從備孕、懷孕到育兒：餵奶尿布一鍵記錄、孕產路線圖、好孕島衛教，全部免費！\n我的邀請碼：${ensure(store.state).code}`;
  }
  App.screen('invite', {
    title: '邀請好友',
    tab: 'me',
    render(el) {
      const sh = ensure(store.state);
      const inviteLink = link({ path: 'home', channel: 'invite', campaign: 'invite' });
      const qrBox = h('div', { class: 'inv-qr', role: 'img', 'aria-label': '邀請連結 QR Code' });
      if (typeof window.qrcode === 'function') {
        const qr = window.qrcode(0, 'M'); qr.addData(inviteLink); qr.make();
        qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      }
      el.append(ui.card({ class: 'card-hero inv-hero' },
        h('div', { class: 'small muted' }, '一起做媽媽，路上有伴'),
        h('div', { class: 'big-num' }, '邀請好友'),
        h('div', { class: 'inv-code-row' }, h('span', { class: 'small' }, '我的邀請碼'), h('span', { class: 'inv-code num' }, sh.code)),
        qrBox,
        h('div', { class: 'grid-2 mt' },
          h('button', { class: 'btn btn-line', onclick: () => { openUrl(`https://line.me/R/share?text=${enc(`${inviteText()}\n${link({ path: 'home', channel: 'line', campaign: 'invite' })}`)}`); thanks(record('invite', 'invite')); }, html: `${ui.ICONS.line}<span>LINE 邀請</span>` }),
          h('button', { class: 'btn jr-hero-btn', onclick: () => open({ title: '邀請你一起用', text: inviteText(), campaign: 'invite', spec: { emoji: '💌', kicker: '邀請你一起用', title: B().appName || '易家做媽媽', subtitle: '備孕・懷孕・育兒 一個 App 陪你', lines: ['餵奶尿布睡眠 一鍵記錄＋預測', '孕產路線圖：該做的事＋注意事項', '好孕島：邊逛邊學的衛教小島'], theme: 'purple' } }) }, '📤 其他方式'))));
      if (App.account) App.account.refreshSoon();
      const au = store.state.auth && store.state.auth.user;
      el.append(ui.card({ class: 'mt' },
        h('div', { class: 'card-title' }, '👥 一起做媽媽的人'),
        App.livePill ? App.livePill('inv-live') : null,
        au ? h('p', { class: 'small mt' }, `你已成功邀請 ${au.referrals || 0} 位加入（以註冊時填你的邀請碼計算）`)
          : h('div', { class: 'row gap mt' }, h('p', { class: 'small muted grow' }, '登入後，朋友用你的邀請碼註冊就會計入「成功邀請人數」。'),
            App.screens.login ? h('button', { class: 'btn btn-sm btn-primary', onclick: () => App.navigate('login') }, '登入') : null)));
      if (sh.invitedBy) el.append(ui.card({ class: 'soft mt' }, h('div', { class: 'small' }, `你是由${sh.inviterName ? `「${sh.inviterName}」` : '朋友'}邀請加入的（邀請碼 ${sh.invitedBy}）💜`)));
      // points + rewards
      const rewards = REWARDS();
      const next = rewards.find((r) => sh.points < r.points);
      el.append(ui.card({ class: 'mt' },
        h('div', { class: 'row between' }, h('div', { class: 'card-title' }, '⭐ 好孕點數'), h('span', { class: 'big-num num inv-pts' }, sh.points)),
        next ? h('div', { class: 'small muted' }, `再 ${next.points - sh.points} 點解鎖「${next.title}」`) : h('div', { class: 'small muted' }, '全部獎勵都解鎖了！'),
        ui.progress(next ? sh.points / next.points : 1),
        h('div', { class: 'inv-rewards' }, rewards.map((r) => {
          const got = sh.points >= r.points;
          const code = r.brand && got && B().shareReward && B().shareReward.code;
          return h('div', { class: `inv-reward${got ? ' got' : ''}` }, h('span', { class: 'inv-r-ico' }, got ? r.icon : '🔒'),
            h('div', { class: 'grow' }, h('div', { class: 'bold small' }, r.title), h('div', { class: 'tiny muted' }, `${r.points} 點${r.brand && got ? (code ? `・優惠碼 ${code}` : '・品牌設定中，敬請期待') : ''}`),
              code ? h('div', { class: 'tiny muted' }, B().shareReward.note || '') : null));
        })),
        h('p', { class: 'tiny faint mt' }, `分享到 LINE／Facebook／Threads +10、IG 分享卡 +20、邀請連結 +15（每天最多 60 點）。點數記錄在這支手機。`)));
      // card gallery
      const list = cards();
      el.append(h('div', { class: 'section-title' }, '📸 製作分享卡（IG 限時動態尺寸）'));
      if (!list.length) el.append(ui.empty('🖼️', '開始記錄後，這裡會出現孕週卡、寶寶成長卡、里程碑卡等可以分享的卡片。'));
      else el.append(h('div', { class: 'inv-cards' }, list.map((c) => h('button', { class: 'inv-card', onclick: () => open({ kind: c.kind, text: c.text, campaign: c.campaign, path: c.path }) },
        h('span', { class: 'inv-card-emoji' }, c.spec.emoji), h('span', { class: 'bold small' }, c.label), h('span', { class: 'tiny muted' }, c.spec.title)))));
      // stats
      const byCh = C.groupBy(sh.events, (e) => e.channel);
      const names = { line: 'LINE', ig: 'Instagram', fb: 'Facebook', threads: 'Threads', copy: '複製連結', more: '其他', invite: '邀請連結' };
      if (sh.events.length) {
        el.append(h('div', { class: 'section-title' }, '我的分享'));
        el.append(h('div', { class: 'chips' }, Object.entries(byCh).map(([k, v]) => h('span', { class: 'chip' }, `${names[k] || k} ${v.length} 次`))));
      }
      el.append(h('p', { class: 'disclaimer' }, '分享卡不會放上寶寶照片（除非你打開）；醫療紀錄不會做成公開分享卡。邀請連結只帶你的邀請碼與暱稱。'));
    },
  });

  App.homeCard('invite', {
    stages: ['prep', 'preg', 'baby'],
    order: 95,
    render(el) {
      // asked only after a week of use: someone who just arrived has nothing to recommend yet
      const since = store.state.onboardedAt || store.state.createdAt;
      if (since && C.diffDays(since, new Date()) < 7) return;
      const sh = ensure(store.state);
      el.append(ui.card({ class: 'inv-home tap', onclick: () => App.navigate('invite') },
        h('div', { class: 'row gap' }, h('span', { class: 'inv-home-ico' }, '💌'),
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, '邀請媽咪朋友一起用'), h('div', { class: 'tiny muted' }, `好孕點數 ${sh.points}・分享卡、邀請碼 ${sh.code}`)),
          h('span', { class: 'ic faint', html: ui.ICONS.chevron }))));
    },
  });

  /* ================= 好孕島：可收集的愛心彩蛋 ＋ 常駐「諮詢」按鈕 =================
   * 參考備孕島的喜鵲彩蛋與常駐預約鈕；做成島上的覆蓋層，不改島本身。 */
  function bonus(pts, reason) {
    store.update((s) => { const x = ensure(s); x.points += pts; x.events.push({ at: new Date().toISOString(), channel: 'bonus', campaign: reason, pts }); });
  }
  const islandUI = { els: [], timer: null };
  function clearIslandUI() { islandUI.els.forEach((e) => e.remove()); islandUI.els = []; clearTimeout(islandUI.timer); islandUI.timer = null; }
  function heartsToday() { const s = ensure(store.state); return (s.hearts && s.hearts.date === C.dateKey()) ? s.hearts.n : 0; }
  function scheduleHeart(first) {
    clearTimeout(islandUI.timer);
    if (heartsToday() >= 3) return;
    islandUI.timer = setTimeout(() => {
      if (document.body.dataset.screen !== 'island') return;
      const btn = h('button', { class: 'isl-heart', 'aria-label': '收集愛心' }, '💜');
      btn.style.left = `${10 + Math.random() * 70}vw`;
      btn.style.top = `${28 + Math.random() * 38}vh`;
      btn.addEventListener('click', () => {
        btn.remove();
        store.update((s) => { const x = ensure(s); const n = heartsToday() + 1; x.hearts = { date: C.dateKey(), n }; });
        bonus(5, 'island-heart');
        const n = heartsToday();
        drawBadge();
        if (n >= 3) {
          ui.toast('🎉 今天的 3 顆愛心都收集到了！好孕點數 +15');
          setTimeout(() => moment(`hearts-${C.dateKey()}`, { emoji: '💜', msg: '集滿 3 顆好孕愛心！', kind: 'island', mutedKey: 'hearts' }), 900);
        } else { ui.toast(`💜 收集到愛心 ${n}/3・好孕點數 +5`); scheduleHeart(); }
      });
      document.body.append(btn); islandUI.els.push(btn);
      setTimeout(() => { if (btn.isConnected) { btn.remove(); scheduleHeart(); } }, 9000);
    }, first ? 6000 : 15000 + Math.random() * 20000);
  }
  function drawBadge() {
    islandUI.els.filter((e) => e.classList.contains('isl-heart-badge')).forEach((e) => e.remove());
    const badge = h('div', { class: 'isl-heart-badge', 'aria-label': `今天收集的愛心 ${heartsToday()} 顆，最多 3 顆` }, '💜', ` ${heartsToday()}/3`);
    document.body.append(badge); islandUI.els = islandUI.els.filter((e) => e.isConnected); islandUI.els.push(badge);
  }
  function mountIslandUI() {
    clearIslandUI();
    drawBadge();
    const b = B();
    const consult = h('button', {
      class: 'isl-consult', 'aria-label': '諮詢與購買',
      onclick: () => { if (b.lineOaUrl) openUrl(b.lineOaUrl); else App.navigate('brand'); },
    }, b.lineOaUrl ? '💬 LINE 諮詢' : `💜 ${b.brandName || '品牌'}`);
    document.body.append(consult); islandUI.els.push(consult);
    scheduleHeart(true);
  }
  new MutationObserver(() => {
    const on = document.body.dataset.screen === 'island';
    if (on && !islandUI.els.length) mountIslandUI();
    if (!on && islandUI.els.length) clearIslandUI();
  }).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });

  App.share = { open, link, render, cards, moment, checkMoments, momentLine, button, record, bonus, code: () => ensure(store.state).code, inviteText };
}());
