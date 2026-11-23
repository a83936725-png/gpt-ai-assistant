/* 分享與裂變：
 *   App.share.open({...})      分享面板（LINE／IG／Facebook／Threads／複製連結／更多）
 *   App.share.card(kind)       品牌分享卡（1080×1920，含邀請碼 QR）
 *   App.share.moment(id, ...)  關鍵時刻提醒分享（每天最多一次、可關閉）
 *   App.share.button(...)      各頁面的分享按鈕
 *   邀請碼（?ref=）、好孕點數、邀請好友頁 'invite'（雙向邀請禮的卡片在 gift.js）
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
  // 使用統計: shares by where they went (a count only; an invite goes out on LINE; saved pictures count in saveImage)
  const COUNTED = { line: 'line', invite: 'line', ig: 'ig', fb: 'fb', threads: 'threads', copy: 'copy', more: 'more' };
  const savedPic = () => { if (App.count) App.count('share_save'); };
  function record(channel, campaign) {
    if (App.count && COUNTED[channel]) App.count(`share_${COUNTED[channel]}`);
    let gained = 0;
    store.update((s) => {
      const sh = ensure(s);
      const today = C.dateKey();
      // 每天最多 60 點 from sharing; gifts (邀請禮、見面禮) and island hearts are not shares and don't use it up
      const todayPts = sh.events.filter((e) => e.at.slice(0, 10) === today && e.channel !== 'bonus').reduce((n, e) => n + (e.pts || 0), 0);
      gained = Math.max(0, Math.min(POINTS[channel] || 5, 60 - todayPts));
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
  // closing punctuation never starts a line (避頭點): it hangs at the end of the line before
  const NO_START = '，。、；：！？）」』〉》】…,.;:!?)';
  function wrap(ctx, text, maxW) {
    const lines = []; let line = '';
    [...String(text)].forEach((ch) => {
      if (ctx.measureText(line + ch).width > maxW && line && !NO_START.includes(ch)) { lines.push(line); line = ch; } else line += ch;
    });
    if (line) lines.push(line);
    return lines;
  }
  function fitLine(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    const ch = [...text];
    while (ch.length && ctx.measureText(`${ch.join('')}…`).width > maxW) ch.pop();
    return `${ch.join('')}…`;
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
  // [background from, background to, soft (circles, rows), header/footer text (white unless given), accent text]
  const THEMES = {
    purple: ['#4a1f62', '#7b4597', '#f2e9f6'],
    peach: ['#b0502f', '#ee8b6f', '#fdeee8'],
    green: ['#1f6b4a', '#4fa77a', '#e3f4ec'],
    night: ['#1d1a3a', '#4b3f8a', '#ece8ff'],
    sky: ['#2c475f', '#5f7f9c', '#e7eef4'],
    rose: ['#7a2449', '#c95a80', '#fbe8ef'],
    cream: ['#f5ebdf', '#e9d6c1', '#f3e7da', '#4a1f62', '#7b4597'], // light: dark purple text
  };
  const THEME_NAMES = {
    purple: '紫芋', peach: '蜜桃', green: '薄荷', night: '夜空', sky: '霧藍', rose: '莓果', cream: '奶茶',
  };
  const themeOf = (t) => THEMES[t] || THEMES.purple;
  const inkOf = (t) => themeOf(t)[3] || '#fff';
  const accentOf = (t) => themeOf(t)[4] || themeOf(t)[1];
  // every card shares this frame: the theme's background and the logo header (y 72–180)
  async function paintFrame(ctx, W, H, theme) {
    const [c1, c2] = THEMES[theme] || THEMES.purple;
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.09; ctx.fillStyle = '#fff';
    [[900, 260, 260], [140, 720, 200], [980, 1300, 320], [120, 1650, 150]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y * (H / 1920), r, 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 1;
    const logo = await loadImg(B().logo || 'assets/logo.svg');
    ctx.fillStyle = '#fff'; roundRect(ctx, 64, 72, 108, 108, 30); ctx.fill();
    if (inkOf(theme) !== '#fff') { ctx.strokeStyle = 'rgba(74,31,98,.14)'; ctx.lineWidth = 3; ctx.stroke(); }
    if (logo) ctx.drawImage(logo, 78, 82, 80, 88);
    ctx.fillStyle = inkOf(theme); ctx.font = `800 46px ${FONT}`; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText(B().appName || '易家做媽媽', 196, 84);
    ctx.globalAlpha = 0.85; ctx.font = `500 30px ${FONT}`; ctx.fillText(B().tagline || '', 196, 142); ctx.globalAlpha = 1;
  }
  // …and this footer at y = fy: a QR code of the invite link (size qs, unless qr is off), the invite code and the
  // hashtags, in the theme's text colour
  function paintFooter(ctx, W, fy, qs, spec, { qr = true } = {}) {
    const url = link({ path: spec.path || 'home', params: spec.params, channel: 'qr', campaign: spec.campaign || 'card' });
    const hasQR = qr && drawQR(ctx, url, 64, fy, qs);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = inkOf(spec.theme);
    const tx = hasQR ? 64 + qs + 44 : 64;
    ctx.font = `800 44px ${FONT}`; ctx.fillText(hasQR ? '掃描一起用・免費' : `${B().appName || '易家做媽媽'}・免費 App`, tx, fy + 20);
    ctx.font = `600 34px ${FONT}`; ctx.globalAlpha = 0.92;
    ctx.fillText(`邀請碼 ${ensure(store.state).code}`, tx, fy + 88);
    ctx.font = `500 28px ${FONT}`;
    wrap(ctx, tags(), W - tx - 64).slice(0, 2).forEach((ln, i) => ctx.fillText(ln, tx, fy + 146 + i * 40));
    ctx.globalAlpha = 1;
  }
  // spec: {emoji, kicker, title, subtitle, stats:[{v,l}], lines:[text | {text, done, warn}], checks, linesTitle,
  //        footnote, theme, photo, bigPhoto, campaign, path, params}
  // opts: format 'story' (9:16, 限時動態) | 'post' (4:5) | 'square' (1:1); qr (default on); note (one line from her)
  const LAYOUT = {
    story: { H: 1920, py: 300, ph: 1170, r: 130, block: 300, maxLines: 6, rowH: 72, step: 86, fs: 42, qs: 300, title: [80, 56], gap: 60 },
    post: { H: 1350, py: 240, ph: 760, r: 96, block: 228, maxLines: 4, rowH: 62, step: 72, fs: 36, qs: 230, title: [72, 52], gap: 60 },
    square: { H: 1080, py: 220, ph: 600, r: 72, block: 176, maxLines: 3, rowH: 58, step: 66, fs: 34, qs: 190, title: [62, 46], gap: 40 },
  };
  // a Q版 sticker on the panel's top-right corner, cut out with a white edge like a real sticker. Drawings only: her
  // Q 版角色 is always the drawn one (never her photo face), the baby is the Q版 baby (never the baby's photo)
  const STICKER_W = { story: 236, post: 204, square: 172 };
  function stickerSrc(kind, w) {
    if (kind === 'mascot' && App.mascot) return App.mascot.dataUrl({ mood: 'wave', size: w, ground: false });
    const av = App.avatar && App.avatar.current && App.avatar.current();
    if (kind === 'me' && av) return App.avatar.dataUrl({ ...av, mode: 'draw', face: null }, { size: w, ground: false });
    const b = store.baby && store.baby();
    if (kind === 'baby' && App.qbaby && b) return App.qbaby.dataUrl({ ...b, photo: null, avatar: '👶' }, { size: w, ground: false });
    return null;
  }
  async function paintSticker(ctx, W, format, py, kind) {
    const base = STICKER_W[format] || STICKER_W.story;
    const w = Math.round(kind === 'me' ? base * 0.84 : base);
    const src = stickerSrc(kind, w); if (!src) return false;
    const im = await loadImg(src); if (!im) return false;
    const ih = Math.round(w * ((im.naturalHeight / im.naturalWidth) || 1));
    const pad = Math.round(w * 0.06); const cw = w + pad * 2; const ch = ih + pad * 2;
    const sil = document.createElement('canvas'); sil.width = cw; sil.height = ch; // her outline in white…
    const sx = sil.getContext('2d'); sx.drawImage(im, pad, pad, w, ih);
    sx.globalCompositeOperation = 'source-in'; sx.fillStyle = '#fff'; sx.fillRect(0, 0, cw, ch);
    const cut = document.createElement('canvas'); cut.width = cw; cut.height = ch; // …stamped around for the white edge
    const cc = cut.getContext('2d');
    for (let i = 0; i < 16; i += 1) { const a = (i / 16) * Math.PI * 2; cc.drawImage(sil, Math.cos(a) * pad * 0.85, Math.sin(a) * pad * 0.85); }
    cc.drawImage(im, pad, pad, w, ih);
    const right = W - 44; const bottom = py + (format === 'square' ? 30 : 44);
    ctx.save();
    ctx.translate(right - cw / 2, bottom - ch / 2); ctx.rotate(0.12);
    ctx.shadowColor = 'rgba(40,20,50,.28)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
    ctx.drawImage(cut, -cw / 2, -ch / 2);
    ctx.restore();
    return true;
  }
  async function render(spec, { format = 'story', qr = true, note = '', sticker = 'none' } = {}) {
    const L = LAYOUT[format] || LAYOUT.story;
    const W = 1080; const H = L.H;
    let drawn = 0; // list rows that fitted (blob.lines)
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const [c1, , soft] = themeOf(spec.theme);
    const c2 = accentOf(spec.theme);
    const strong = inkOf(spec.theme) !== '#fff' ? inkOf(spec.theme) : c1; // numbers and ✓ (a light theme uses its dark text)
    await paintFrame(ctx, W, H, spec.theme);
    // main panel (a light theme gets a thin edge so the white panel still stands out)
    const px = 64; const pw = W - 128; const py = L.py; const bottom = py + L.ph;
    ctx.fillStyle = 'rgba(255,255,255,0.97)'; roundRect(ctx, px, py, pw, L.ph, 56); ctx.fill();
    if (inkOf(spec.theme) !== '#fff') { ctx.strokeStyle = 'rgba(74,31,98,.12)'; ctx.lineWidth = 3; ctx.stroke(); }
    const cx = W / 2; let y = py + (format === 'square' ? 50 : 70);
    // a big picture (an ultrasound photo) in a rounded frame, or the emoji / round photo
    const big = spec.bigPhoto ? await loadImg(spec.bigPhoto) : null;
    // a list card gives the list the room: a smaller emoji in 限時動態, in the small line above the title otherwise
    const listMode = !big && !!(spec.lines && spec.lines.length);
    const inlineEmoji = listMode && format !== 'story';
    if (big) {
      const bw = pw - 100; const bh = { story: 640, post: 420, square: 300 }[format] || 640; const bx = px + 50; const by = y - 20;
      ctx.save(); roundRect(ctx, bx, by, bw, bh, 36); ctx.clip();
      const k = Math.max(bw / big.naturalWidth, bh / big.naturalHeight);
      ctx.fillStyle = '#111'; ctx.fillRect(bx, by, bw, bh);
      ctx.drawImage(big, bx + (bw - big.naturalWidth * k) / 2, by + (bh - big.naturalHeight * k) / 2, big.naturalWidth * k, big.naturalHeight * k);
      ctx.restore();
      y = by + bh + 50;
    } else if (!inlineEmoji) {
      const R = listMode ? Math.round(L.r * 0.66) : L.r;
      const photo = spec.photo ? await loadImg(spec.photo) : null;
      const art = !photo && spec.art ? await loadImg(spec.art) : null; // a drawing (the Q版 baby)
      ctx.fillStyle = soft; ctx.beginPath(); ctx.arc(cx, y + R, R, 0, Math.PI * 2); ctx.fill();
      if (photo) { ctx.save(); ctx.beginPath(); ctx.arc(cx, y + R, R - 8, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(photo, cx - R + 8, y + 8, (R - 8) * 2, (R - 8) * 2); ctx.restore(); }
      else if (art) { const s = R * 1.62; ctx.drawImage(art, cx - s / 2, y + R - s / 2 + R * 0.04, s, s); }
      else { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${Math.round(R * 1.15)}px ${FONT}`; ctx.fillText(spec.emoji || '💜', cx, y + R + 8); }
      y += listMode ? R * 2 + 40 : L.block;
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const kicker = inlineEmoji ? `${spec.emoji || ''} ${spec.kicker || ''}`.trim() : spec.kicker;
    if (kicker) { ctx.fillStyle = c2; ctx.font = `700 ${format === 'square' ? 32 : 36}px ${FONT}`; ctx.fillText(fitLine(ctx, kicker, pw - 100), cx, y); y += format === 'square' ? 52 : 62; }
    const quote = listMode || (spec.title || '').length > 12;
    const tf = quote ? L.title[1] : L.title[0];
    ctx.fillStyle = '#2b2231'; ctx.font = `900 ${tf}px ${FONT}`;
    wrap(ctx, spec.title || '', pw - 120).slice(0, format === 'square' ? 2 : 3).forEach((ln) => { ctx.fillText(ln, cx, y); y += Math.round(tf * 1.24); });
    if (spec.subtitle) {
      ctx.fillStyle = '#5f5566'; ctx.font = `500 ${format === 'square' ? 32 : 38}px ${FONT}`;
      wrap(ctx, spec.subtitle, pw - 140).slice(0, format === 'story' ? 3 : 2).forEach((ln) => { ctx.fillText(ln, cx, y + 6); y += format === 'square' ? 46 : 54; });
      y += 14;
    }
    if (spec.stats && spec.stats.length) {
      const n = Math.min(3, spec.stats.length); const gap = 22; const sw = (pw - 120 - gap * (n - 1)) / n; const sh0 = format === 'square' ? 120 : 150;
      spec.stats.slice(0, 3).forEach((st, i) => {
        const sx = px + 60 + i * (sw + gap);
        ctx.fillStyle = soft; roundRect(ctx, sx, y + 10, sw, sh0, 30); ctx.fill();
        ctx.fillStyle = strong; ctx.font = `900 ${format === 'square' ? 44 : 52}px ${FONT}`; ctx.fillText(String(st.v), sx + sw / 2, y + 30);
        ctx.fillStyle = '#5f5566'; ctx.font = `500 28px ${FONT}`; ctx.fillText(st.l, sx + sw / 2, y + sh0 - 44);
      });
      y += sh0 + 40;
    }
    // her one line: kept at the bottom of the panel, so the list above it leaves room
    const noteRows = [];
    if (note) { ctx.font = `700 ${format === 'square' ? 34 : 40}px ${FONT}`; noteRows.push(...wrap(ctx, `「${note}」`, pw - 140).slice(0, 2)); }
    const noteH = noteRows.length ? noteRows.length * (format === 'square' ? 46 : 54) + 30 : 0;
    const limit = bottom - 40 - noteH;
    if (spec.lines && spec.lines.length) {
      if (spec.linesTitle) { y += 12; ctx.fillStyle = c2; ctx.font = `800 ${format === 'square' ? 34 : 40}px ${FONT}`; ctx.fillText(spec.linesTitle, cx, y); y += format === 'square' ? 56 : 70; }
      ctx.textAlign = 'left';
      const rows = spec.lines.slice(0, L.maxLines).map((ln) => (typeof ln === 'string' ? { text: ln } : ln));
      const lh = Math.round(L.fs * 1.3);
      let full = false;
      drawn = 0;
      rows.forEach((ln) => {
        if (full) return;
        const check = spec.checks && typeof ln.done === 'boolean';
        const r = Math.round(L.rowH * 0.27);
        const tx = px + 80 + (check ? r * 2 + 22 : 0);
        ctx.font = `600 ${L.fs}px ${FONT}`;
        const maxW = px + pw - 80 - tx;
        let parts = wrap(ctx, `${ln.warn ? '⚠️ ' : ''}${ln.text}`, maxW);
        if (parts.length > 2) parts = [parts[0], fitLine(ctx, parts.slice(1).join(''), maxW)]; // two lines at most
        const rh = L.rowH + (parts.length - 1) * lh;
        if (y + rh > limit) { full = true; return; } // no half rows: the rest is left out
        ctx.fillStyle = soft; roundRect(ctx, px + 50, y - 8, pw - 100, rh, 22); ctx.fill();
        if (check) { // 已完成 ✓ / 還沒做 ○
          const ccx = px + 80 + r; const ccy = y - 8 + L.rowH / 2;
          ctx.beginPath(); ctx.arc(ccx, ccy, r, 0, Math.PI * 2);
          if (ln.done) {
            ctx.fillStyle = strong; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(4, r * 0.28); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(ccx - r * 0.45, ccy + r * 0.02); ctx.lineTo(ccx - r * 0.1, ccy + r * 0.38); ctx.lineTo(ccx + r * 0.5, ccy - r * 0.35); ctx.stroke();
          } else { ctx.strokeStyle = c2; ctx.lineWidth = 4; ctx.stroke(); }
        }
        ctx.fillStyle = ln.done && check ? '#7a6f80' : '#3d3442'; ctx.font = `600 ${L.fs}px ${FONT}`;
        parts.forEach((t, k) => ctx.fillText(t, tx, y - 8 + (L.rowH - L.fs) / 2 + k * lh));
        y += L.step + (parts.length - 1) * lh;
        drawn += 1;
      });
      ctx.textAlign = 'center';
      if (spec.footnote && y + 40 < limit) { ctx.fillStyle = '#7a6f80'; ctx.font = `500 30px ${FONT}`; ctx.fillText(spec.footnote, cx, y + 14); }
    }
    if (noteRows.length) {
      let ny = bottom - 30 - noteH + 20;
      ctx.textAlign = 'center'; ctx.fillStyle = c2; ctx.font = `700 ${format === 'square' ? 34 : 40}px ${FONT}`;
      noteRows.forEach((ln) => { ctx.fillText(ln, cx, ny); ny += format === 'square' ? 46 : 54; });
    }
    if (sticker && sticker !== 'none') await paintSticker(ctx, W, format, py, sticker);
    // footer: QR + invite
    paintFooter(ctx, W, bottom + L.gap, L.qs, spec, { qr });
    return new Promise((res) => cv.toBlob((b) => { if (b) b.lines = drawn; res(b); }, 'image/png'));
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
  // the Q版 baby as the picture of a card, where no photo is shown and the baby's picture is the default 👶
  const qArt = (b, shownPhoto) => (App.qbaby && !shownPhoto && App.qbaby.isQ({ ...b, photo: null }) ? App.qbaby.dataUrl({ ...b, photo: null }, { size: 320, ground: false }) : null);
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
      out.push({ kind: 'baby-age', label: '成長卡', campaign: 'baby-age', spec: { emoji: b.avatar || '👶', photo: photo(b), art: qArt(b, photo(b)), kicker: '寶寶成長日記', title: `${bname(b)} ${a ? a.text : ''}`, subtitle: '每天都在長大一點點', stats, theme: 'peach' }, text: `${bname(b)} ${a ? a.text : ''}了，每天都在長大一點點 💕` });
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
    if (pp && pp.day <= 45) out.push({ kind: 'pp', label: '坐月子卡', campaign: 'postpartum', spec: { emoji: '🍲', kicker: '坐月子日記', title: pp.day >= 30 ? '產後滿月' : `產後第 ${pp.day} 天`, subtitle: pp.day >= 30 ? '坐月子告一段落' : '坐月子中', theme: 'peach' }, text: pp.day >= 30 ? '產後滿月了，謝謝一路陪伴的家人朋友 💜' : `坐月子第 ${pp.day} 天，好好休息中 🍲` });
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
    save: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 17v1.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V17"/></svg>',
  };
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, t); document.body.append(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; } ta.remove(); return ok;
    }
  }
  // a plain file name: some phones turn other characters into 「download」
  const fileName = (campaign, format) => `yijia-mom-${String(campaign || 'card').replace(/[^a-z0-9-]+/gi, '-')}${format ? `-${format}` : ''}.png`;
  function downloadBlob(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function thanks(gained) { ui.toast(gained ? `謝謝分享・好孕點數 +${gained}` : '謝謝分享'); }

  /* ================= 分享工作室: the card she sends, her way =================
   * 樣式 (seven colours) and 格式 (限時動態 9:16, 貼文 4:5, 方形 1:1) are remembered for next time; for a list she
   * picks which items go on the card (as many as the format holds), can mark the done ones ✓, adds a line of her own,
   * and decides whether the QR code goes on. The preview follows every choice. */
  const FORMATS = [
    { value: 'story', label: '限時動態', hint: '9:16', max: 6, ratio: '9 / 16' },
    { value: 'post', label: '貼文', hint: '4:5', max: 4, ratio: '4 / 5' },
    { value: 'square', label: '方形', hint: '1:1', max: 3, ratio: '1 / 1' },
  ];
  const cardPrefs = () => { const x = ensure(store.state); x.cardPrefs = x.cardPrefs || {}; return x.cardPrefs; };
  // 貼紙 she can put on the card: 小滴, her Q 版角色 (when she made one), the Q版 baby (when there is a baby)
  function stickerChoices() {
    const out = [{ value: 'none', label: '不加', pic: () => h('span', { class: 'sh-stk-none' }, '✕') }];
    if (App.mascot) out.push({ value: 'mascot', label: '小滴', pic: () => App.mascot.el({ mood: 'wave', size: 32 }) });
    const av = App.avatar && App.avatar.current && App.avatar.current();
    if (av) out.push({ value: 'me', label: '我的 Q 版', pic: () => App.avatar.head(36, { ...av, mode: 'draw', face: null }) });
    const b = store.baby && store.baby();
    if (App.qbaby && b) out.push({ value: 'baby', label: '寶寶 Q 版', pic: () => App.qbaby.face({ ...b, photo: null, avatar: '👶' }, { size: 36, cls: 'sh-stk-qb' }) });
    return out;
  }

  // payload: {title, text, path, params, campaign, spec (card spec) | kind, items:[{text, done?, warn?, extra?}], sheetTitle}
  function open(payload = {}) {
    const p = { campaign: 'share', path: 'home', ...payload };
    if (p.kind && !p.spec) { const c = cards().find((x) => x.kind === p.kind); if (c) Object.assign(p, { spec: c.spec, text: p.text || c.text, campaign: c.campaign, path: c.path || p.path }); }
    if (!p.spec && p.text) p.spec = { emoji: p.emoji || '📖', kicker: p.kicker || '易家做媽媽・小知識', title: p.title || '', subtitle: '', lines: p.lines || [], theme: p.theme || 'purple', path: p.path, params: p.params };
    if (p.spec) { p.spec.path = p.spec.path || p.path; p.spec.params = p.spec.params || p.params; p.spec.campaign = p.campaign; }
    const fullText = (ch) => `${p.text || p.title || ''}\n${link({ path: p.path, params: p.params, channel: ch, campaign: p.campaign })}\n${tags()}`;

    /* ---- her choices ---- */
    const pf = cardPrefs();
    const stk = stickerChoices();
    const items = (p.items || (p.spec && p.spec.lines) || []).map((x) => (typeof x === 'string' ? { text: x } : x));
    const hasDone = items.some((x) => typeof x.done === 'boolean');
    const opt = {
      format: FORMATS.some((f) => f.value === pf.format) ? pf.format : 'story',
      theme: THEMES[pf.theme] ? pf.theme : ((p.spec && p.spec.theme) || 'purple'),
      qr: pf.qr !== false,
      checks: hasDone,
      note: '',
      sticker: stk.some((x) => x.value === pf.sticker) ? pf.sticker : stk.some((x) => x.value === 'mascot') ? 'mascot' : 'none',
    };
    const fmt = () => FORMATS.find((f) => f.value === opt.format);
    const maxN = () => Math.max(1, fmt().max - (opt.note ? 1 : 0));
    let picked = items.map((x, i) => i).filter((i) => !items[i].extra).slice(0, maxN());
    let ownPick = false; // until she picks items herself, the default settles on what fits the card
    const fit = () => { picked = picked.slice(0, maxN()); };
    const remember = () => { Object.assign(pf, { format: opt.format, theme: opt.theme, qr: opt.qr, sticker: opt.sticker }); store.save(); };
    const specNow = () => p.spec && {
      ...p.spec, theme: opt.theme, checks: opt.checks, lines: items.length ? picked.slice().sort((a, b) => a - b).map((i) => items[i]) : p.spec.lines,
    };

    /* ---- the preview: the same picture that will be sent; a new choice fades the next one in ---- */
    const cache = new Map();
    const key = () => JSON.stringify([opt, picked]);
    const getBlob = () => { const k = key(); if (!cache.has(k)) cache.set(k, render(specNow(), { format: opt.format, qr: opt.qr, note: opt.note, sticker: opt.sticker })); return cache.get(k); };
    const img = h('img', { alt: '分享卡預覽', class: 'sh-img' });
    const frame = h('div', { class: 'sh-frame' }, img, h('span', { class: 'sh-wait', 'aria-hidden': 'true' }));
    const preview = h('div', { class: 'sh-preview busy', 'aria-live': 'polite' }, frame);
    let seq = 0;
    function refresh() {
      if (!p.spec) return;
      const n = ++seq; // eslint-disable-line no-plusplus
      preview.classList.add('busy');
      frame.style.aspectRatio = fmt().ratio;
      Object.assign(preview.dataset, { format: opt.format, theme: opt.theme, items: String(items.length ? picked.length : 0), qr: String(opt.qr), checks: String(opt.checks), note: opt.note, sticker: opt.sticker });
      getBlob().then((blob) => {
        if (!blob || n !== seq) return;
        let left = items.length ? picked.length - (blob.lines || 0) : 0;
        if (left > 0 && !ownPick) { picked = picked.slice(0, blob.lines || 0); left = 0; drawItems(); preview.dataset.items = String(picked.length); }
        fitNote.hidden = left <= 0;
        fitNote.textContent = left > 0 ? `卡片放得下 ${blob.lines} 項，另外 ${left} 項沒放進去：少選一些，或換「限時動態」` : '';
        const url = URL.createObjectURL(blob);
        img.onload = () => { if (n === seq) preview.classList.remove('busy'); URL.revokeObjectURL(url); };
        img.src = url;
      });
    }
    if (!p.spec) preview.remove();

    /* ---- 樣式: seven colours ---- */
    const swatches = h('div', { class: 'sh-swatches', role: 'radiogroup', 'aria-label': '卡片顏色' },
      Object.keys(THEMES).map((t) => h('button', {
        type: 'button', class: 'sh-sw', role: 'radio', 'aria-checked': String(t === opt.theme), 'aria-label': THEME_NAMES[t], dataset: { theme: t },
        style: { '--sw1': THEMES[t][0], '--sw2': THEMES[t][1] },
        onclick: () => {
          opt.theme = t; remember();
          swatches.querySelectorAll('.sh-sw').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.theme === t)));
          refresh();
        },
      }, h('span', { class: 'sh-sw-dot', 'aria-hidden': 'true' }), h('span', { class: 'sh-sw-name' }, THEME_NAMES[t]))));

    /* ---- 貼紙 ---- */
    const stickerRow = h('div', { class: 'sh-stickers', role: 'radiogroup', 'aria-label': '貼紙' },
      stk.map((x) => h('button', {
        type: 'button', class: 'sh-stk', role: 'radio', 'aria-checked': String(x.value === opt.sticker), dataset: { sticker: x.value },
        onclick: () => {
          opt.sticker = x.value; remember();
          stickerRow.querySelectorAll('.sh-stk').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sticker === x.value)));
          refresh();
        },
      }, h('span', { class: 'sh-stk-pic', 'aria-hidden': 'true' }, x.pic()), h('span', { class: 'sh-stk-name' }, x.label))));

    /* ---- 格式 ---- */
    const formatSeg = ui.seg(FORMATS.map((f) => ({ value: f.value, label: `${f.label} ${f.hint}` })), opt.format, (v) => { opt.format = v; remember(); fit(); drawItems(); refresh(); }, { small: true });
    formatSeg.classList.add('sh-format');

    /* ---- 內容與文字: which items, ✓ for the done ones, her line, the QR code ---- */
    const itemsBox = h('div', { class: 'sh-items' });
    const fitNote = h('p', { class: 'small sh-fit', hidden: true, role: 'status' });
    const countTag = h('span', { class: 'tag primary num sh-count' });
    function drawItems() {
      if (!items.length) return;
      itemsBox.innerHTML = '';
      countTag.textContent = `已選 ${picked.length}／${maxN()}`;
      items.forEach((it, i) => {
        const on = picked.includes(i);
        const cb = h('input', {
          type: 'checkbox', checked: on, disabled: !on && picked.length >= maxN(),
          onchange: () => { ownPick = true; picked = cb.checked ? [...picked, i] : picked.filter((x) => x !== i); drawItems(); refresh(); },
        });
        itemsBox.append(h('label', { class: `check-row sh-item${on ? ' on' : ''}` }, cb,
          h('span', { class: 'sh-item-text' }, it.warn ? '⚠️ ' : '', it.text),
          hasDone && typeof it.done === 'boolean' ? h('span', { class: `tag ${it.done ? 'ok' : ''} sh-item-done` }, it.done ? '已完成' : '還沒') : null));
      });
    }
    const switchRow = (label, sub, checked, onChange, cls = '') => {
      const sw = h('input', { type: 'checkbox', class: 'switch', checked, onchange: (e) => onChange(e.target.checked) });
      return h('label', { class: `row gap switch-row sh-switch ${cls}` }, h('span', { class: 'grow' }, h('span', { class: 'bold small' }, label), sub ? h('span', { class: 'tiny muted', style: { display: 'block' } }, sub) : null), sw);
    };
    let noteT = 0;
    const noteIn = h('input', {
      class: 'input sh-note', maxlength: 24, placeholder: '例如：老公記得陪我去產檢！', 'aria-label': '加一句話（選填，最多 24 個字）',
      oninput: () => { clearTimeout(noteT); noteT = setTimeout(() => { opt.note = noteIn.value.trim(); fit(); drawItems(); refresh(); }, 350); },
    });
    const priv = ensure(store.state).privacy;
    const babyCard = p.spec && (p.kind === 'baby-age' || p.kind === 'birth' || p.kind === 'milestone' || (p.kind || '').startsWith('custom'));
    const reopen = () => { sheet.close(); setTimeout(() => open({ ...payload, spec: null }), 240); }; // the card is built again with the new choice
    const content = h('div', { class: 'sh-content', id: `sh-content-${Date.now()}` },
      items.length ? h('div', { class: 'sh-sec-head' }, h('span', { class: 'bold small' }, '放進卡片的項目'), countTag) : null,
      items.length ? fitNote : null,
      items.length ? itemsBox : null,
      hasDone ? switchRow('標示已完成 ✓', '做到的項目打勾，還沒做的是空心圓', opt.checks, (v) => { opt.checks = v; refresh(); }, 'sh-sw-checks') : null,
      ui.field('加一句話（選填）', noteIn),
      switchRow('放 QR code', '朋友掃描就能免費下載，連結含你的邀請碼', opt.qr, (v) => { opt.qr = v; remember(); refresh(); }, 'sh-sw-qr'),
      babyCard ? switchRow('顯示寶寶名字', null, priv.showName, (v) => { store.update((s) => { ensure(s).privacy.showName = v; }); reopen(); }, 'sh-sw-name') : null,
      babyCard && store.baby() && store.baby().photo ? switchRow('顯示寶寶照片', null, priv.showPhoto, (v) => { store.update((s) => { ensure(s).privacy.showPhoto = v; }); reopen(); }, 'sh-sw-photo') : null);
    const open0 = items.length > 0; // a list: show the choice of items right away
    const contentBtn = h('button', {
      type: 'button', class: 'sh-toggle', 'aria-expanded': String(open0), 'aria-controls': content.id,
      onclick: () => { const o = content.hidden; content.hidden = !o; contentBtn.setAttribute('aria-expanded', String(o)); },
    }, h('span', { class: 'grow' }, '✏️ 內容與文字'), h('span', { class: 'chev', 'aria-hidden': 'true' }, '▾'));
    content.hidden = !open0;

    /* ---- sending ---- */
    const act = async (ch) => {
      if (ch === 'line') { openUrl(`https://line.me/R/share?text=${enc(fullText('line'))}`); thanks(record('line', p.campaign)); return; }
      if (ch === 'fb') { openUrl(`https://www.facebook.com/sharer/sharer.php?u=${enc(link({ path: p.path, params: p.params, channel: 'facebook', campaign: p.campaign }))}&quote=${enc(p.text || '')}`); thanks(record('fb', p.campaign)); return; }
      if (ch === 'threads') { openUrl(`https://www.threads.net/intent/post?text=${enc(fullText('threads'))}`); thanks(record('threads', p.campaign)); return; }
      if (ch === 'copy') { const ok = await copyText(fullText('copy')); ui.toast(ok ? '已複製文字與連結' : '複製失敗，請長按選取'); if (ok) record('copy', p.campaign); return; }
      if (ch === 'save') {
        const blob = p.spec ? await getBlob() : null;
        if (blob) { downloadBlob(blob, fileName(p.campaign, opt.format)); savedPic(); ui.toast('圖片存好了，可以傳到 LINE 群組或貼到限時動態'); }
        return;
      }
      if (ch === 'ig' || ch === 'more') {
        const blob = p.spec ? await getBlob() : null;
        const file = blob ? new File([blob], 'yijia-share.png', { type: 'image/png' }) : null;
        const data = { title: p.title || (B().appName || ''), text: fullText(ch === 'ig' ? 'instagram' : 'native') };
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
        else data.url = link({ path: p.path, params: p.params, channel: ch === 'ig' ? 'instagram' : 'native', campaign: p.campaign });
        if (navigator.share && (ch === 'more' || data.files)) {
          const done = () => thanks(record(ch, p.campaign));
          const no = () => ui.toast('無法分享，請改用其他方式');
          const r = await shareSheet(data, { msg: data.files ? '圖片做好了' : '準備好了', onShared: done, onFail: no });
          if (r === 'shared') done(); else if (r === 'none') no();
          return;
        }
        if (ch === 'ig') { // desktop / no Web Share: download the card + copy caption
          if (blob) downloadBlob(blob, fileName(p.campaign, opt.format));
          await copyText(fullText('instagram'));
          ui.toast('圖片已下載、文字已複製：打開 IG 限時動態選這張圖，加上「連結」貼紙貼上即可', { ms: 6000 });
          thanks(record('ig', p.campaign));
          return;
        }
        await copyText(fullText('copy')); ui.toast('已複製文字與連結'); record('copy', p.campaign);
      }
    };
    const chBtn = (id, label, iconHtml, cls, short) => h('button', { class: `sh-ch ${cls || ''}`, onclick: () => act(id), 'aria-label': id === 'save' ? '存圖片' : `分享到${label}` },
      h('span', { class: 'sh-ch-ico', html: iconHtml }), h('span', { class: 'sh-ch-l', 'aria-hidden': 'true' }, short || label));
    const studio = p.spec ? h('div', { class: 'sh-studio' },
      h('div', { class: 'sh-sec' }, h('div', { class: 'sh-sec-head' }, h('span', { class: 'bold small' }, '樣式')), swatches),
      h('div', { class: 'sh-sec' }, h('div', { class: 'sh-sec-head' }, h('span', { class: 'bold small' }, '格式')), formatSeg),
      h('div', { class: 'sh-sec' }, h('div', { class: 'sh-sec-head' }, h('span', { class: 'bold small' }, 'Q 版貼紙'), h('span', { class: 'tiny muted' }, '都是畫的，不會用到照片')), stickerRow),
      h('div', { class: 'sh-sec' }, contentBtn, content)) : null;
    const sendRow = h('div', { class: 'sh-grid sh-send', role: 'group', 'aria-label': '傳到' },
      chBtn('line', 'LINE', ui.ICONS.line, 'sh-line'),
      chBtn('ig', 'Instagram', ICON.ig, 'sh-ig', 'IG'),
      chBtn('fb', 'Facebook', ICON.fb, 'sh-fb', 'FB'),
      chBtn('threads', 'Threads', ICON.threads, 'sh-th'),
      chBtn('copy', '複製連結', ICON.copy, '', '複製'),
      p.spec ? chBtn('save', '存圖片', ICON.save, 'sh-save', '存圖片') : null,
      chBtn('more', '更多', ICON.more, '', '更多'));
    const sheet = ui.sheet({
      title: p.sheetTitle || '分享',
      body: h('div', { class: 'sh-body' },
        preview,
        studio,
        p.spec ? h('p', { class: 'tiny muted center sh-hint' }, '想把這張圖傳到 LINE：按「更多」選 LINE，或先存圖片') : null,
        h('p', { class: 'tiny muted center' }, `連結含你的邀請碼 ${ensure(store.state).code}・分享可得好孕點數`)),
      footer: sendRow,
    });
    drawItems();
    refresh();
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
    if (pp && pp.day >= 30 && pp.day <= 36 && !(cuNow && cuNow.id === 'm30') && moment(`pp30-${pp.start}`, { emoji: '🍲', msg: '產後滿月了', kind: 'pp' })) return;
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
  // 滿月・百日・度晬 come with a 成長回顧 of that time
  const RECAP_OF = { m30: 'm1', d100: 'd100', y1: 'y1' };
  const recapKind = (b, cu) => { const k = RECAP_OF[cu.id]; return k && App.recap && App.recap.available(b).some((x) => x.kind === k) ? k : null; };
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
          h('button', { class: 'btn btn-primary btn-block mt', onclick: () => { sh.close(); setTimeout(() => open({ kind: `custom-${cu.id}` }), 240); } }, '📤 做成分享卡'),
          recapKind(b, cu) ? h('button', {
            class: 'btn btn-soft btn-block mt-sm sh-recap',
            onclick: () => { const k = recapKind(b, cu); sh.close(); setTimeout(() => App.recap.open(b, k), 240); },
          }, `🎬 看${b.name || '寶寶'}的${App.recap.PERIODS[recapKind(b, cu)].label}`) : null,
          App.monthly && App.monthly.dueSlot(b) != null ? h('button', {
            class: 'btn btn-soft btn-block mt-sm sh-monthly',
            onclick: () => { const m = App.monthly.dueSlot(b); sh.close(); App.navigate('monthly', { m, baby: b.id }); },
          }, `📸 拍${App.monthly.label(App.monthly.dueSlot(b)).text}照`) : null),
      });
    };
    const el = h('button', { class: 'moment-line', onclick: show },
      h('span', { class: 'moment-emoji', 'aria-hidden': 'true' }, cu.emoji),
      h('span', { class: 'grow' }, h('strong', null, `${b.name} ${cu.title}`), h('span', { class: 'moment-more' }, recapKind(b, cu) ? '回顧・習俗・分享卡' : '習俗・分享卡')),
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
    // 雙向邀請禮: the friend learns what joining brings (only where the member service can give it)
    const gift = App.gift && App.gift.ready() ? `\n用我的連結加入、註冊會員，你會拿到 ${App.gift.PTS().friend} 點見面禮 🎁` : '';
    // said the way a friend would say it (it read like an ad: 「…一鍵記錄、孕產路線圖、好孕島衛教，全部免費！」)
    return `${name ? `${name}推薦你` : '推薦你'}用「${B().appName || '易家做媽媽'}」記餵奶、尿布和產檢。免費，不用註冊就能用。${gift}\n我的邀請碼：${ensure(store.state).code}`;
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
      // 雙向邀請禮: what each side gets, my friends who joined, my own welcome gift (gift.js; hidden without the member service)
      const gift = App.gift ? App.gift.section() : null;
      if (gift) el.append(gift);
      else if (sh.invitedBy) el.append(ui.card({ class: 'soft mt' }, h('div', { class: 'small' }, `你是由${sh.inviterName ? `「${sh.inviterName}」` : '朋友'}邀請加入的（邀請碼 ${sh.invitedBy}）💜`)));
      // points + rewards
      const rewards = REWARDS();
      const next = rewards.find((r) => sh.points < r.points);
      el.append(ui.card({ class: 'mt' },
        h('div', { class: 'row between' }, h('div', { class: 'card-title' }, '好孕點數'), h('span', { class: 'big-num num inv-pts' }, sh.points)),
        next ? h('div', { class: 'small muted' }, `再 ${next.points - sh.points} 點解鎖「${next.title}」`) : h('div', { class: 'small muted' }, '全部獎勵都解鎖了！'),
        ui.progress(next ? sh.points / next.points : 1),
        h('div', { class: 'inv-rewards' }, rewards.map((r) => {
          const got = sh.points >= r.points;
          const code = r.brand && got && B().shareReward && B().shareReward.code;
          return h('div', { class: `inv-reward${got ? ' got' : ''}` }, h('span', { class: 'inv-r-ico' }, got ? r.icon : '🔒'),
            h('div', { class: 'grow' }, h('div', { class: 'bold small' }, r.title), h('div', { class: 'tiny muted' }, `${r.points} 點${r.brand && got ? (code ? `・優惠碼 ${code}` : '・品牌設定中，敬請期待') : ''}`),
              code ? h('div', { class: 'tiny muted' }, B().shareReward.note || '') : null));
        })),
        h('p', { class: 'tiny faint mt' }, `分享到 LINE／Facebook／Threads +10、IG 分享卡 +20、邀請連結 +15（每天最多 60 點）${App.gift && App.gift.ready() ? `；朋友加入：見面禮 +${App.gift.PTS().friend}、邀請禮 +${App.gift.PTS().inviter}（不算在每天上限裡）` : ''}。點數記錄在這支手機。`)));
      // card gallery
      const list = cards();
      el.append(h('div', { class: 'section-title' }, '製作分享卡（IG 限時動態尺寸）'));
      // 家族週報 has its own screen (the week, a line for the family, LINE)
      const weekly = App.weekly && App.weekly.kindNow() ? h('button', { class: 'inv-card inv-weekly', onclick: () => App.navigate('weekly') },
        h('span', { class: 'inv-card-emoji' }, '📮'), h('span', { class: 'bold small' }, '家族週報'), h('span', { class: 'tiny muted' }, '每週一張，傳到家族群組')) : null;
      if (!list.length && !weekly) el.append(ui.empty('🖼️', '開始記錄後，這裡會出現孕週卡、寶寶成長卡、里程碑卡等可以分享的卡片。'));
      else {
        el.append(h('div', { class: 'inv-cards' }, weekly, list.map((c) => h('button', { class: 'inv-card', onclick: () => open({ kind: c.kind, text: c.text, campaign: c.campaign, path: c.path }) },
          h('span', { class: 'inv-card-emoji' }, c.spec.emoji), h('span', { class: 'bold small' }, c.label), h('span', { class: 'tiny muted' }, c.spec.title)))));
      }
      // stats
      const shares = sh.events.filter((e) => e.channel !== 'bonus'); // gifts and island hearts are not shares
      const byCh = C.groupBy(shares, (e) => e.channel);
      const names = { line: 'LINE', ig: 'Instagram', fb: 'Facebook', threads: 'Threads', copy: '複製連結', more: '其他', invite: '邀請連結' };
      if (shares.length) {
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
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, '邀請媽咪朋友一起用'),
            h('div', { class: 'tiny muted' }, App.gift && App.gift.ready() ? `朋友加入，你們都有邀請禮・好孕點數 ${sh.points}` : `好孕點數 ${sh.points}・分享卡、邀請碼 ${sh.code}`)),
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
      onclick: () => { if (b.lineOaUrl) { if (App.count) App.count.daily('brand_line'); openUrl(b.lineOaUrl); } else App.navigate('brand'); },
    }, b.lineOaUrl ? [h('span', { class: 'isl-consult-ico', html: ui.ICONS.line }), 'LINE 諮詢'] : [h('img', { src: b.logo || 'assets/logo.svg', alt: '', class: 'isl-consult-logo' }), b.brandName || '品牌']);
    document.body.append(consult); islandUI.els.push(consult);
    scheduleHeart(true);
  }
  new MutationObserver(() => {
    const on = document.body.dataset.screen === 'island';
    if (on && !islandUI.els.length) mountIslandUI();
    if (!on && islandUI.els.length) clearIslandUI();
  }).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });

  // a QR code as an image (for printed pages); '' when the QR library is not available
  function qr(url, size = 240) {
    try {
      const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
      return drawQR(ctx, url, 0, 0, size) ? cv.toDataURL('image/png') : '';
    } catch (e) { return ''; }
  }
  /* The phone's share sheet. A phone opens it only just after a tap; when making the picture took longer
     (an older phone), it says no: the picture is kept and a toast offers 「分享」 again, and that fresh tap opens it.
     A second tap while a share sheet is already open does nothing (it used to download the picture as well).
     → 'shared' | 'cancel' (she closed it) | 'open' (one is open already) | 'late' (the toast is waiting) | 'none' (cannot share this) */
  const shareWhy = (e) => { const n = e && e.name; return n === 'AbortError' ? 'cancel' : n === 'InvalidStateError' ? 'open' : n === 'NotAllowedError' ? 'late' : 'none'; };
  async function shareSheet(data, { msg = '圖片做好了', action = '分享', onShared = null, onFail = null } = {}) {
    try { await navigator.share(data); return 'shared'; } catch (e) {
      const r = shareWhy(e);
      if (r === 'late') {
        ui.toast(msg, {
          action, ms: 9000,
          onAction: async () => {
            try { await navigator.share(data); if (onShared) onShared(); } catch (e2) { const r2 = shareWhy(e2); if (r2 !== 'cancel' && r2 !== 'open' && onFail) onFail(); }
          },
        });
      }
      return r;
    }
  }
  // a picture made just now → the share sheet (as above); 'none' when this phone cannot share pictures
  async function sharePicture(blob, name, { text = '', title = '', action = '分享', onShared = null } = {}) {
    const file = typeof File === 'function' ? new File([blob], name, { type: blob.type || 'image/png' }) : null;
    if (!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }))) return 'none';
    const data = { files: [file] };
    if (text) data.text = text;
    if (title) data.title = title;
    return shareSheet(data, {
      action, onShared,
      onFail: () => { downloadBlob(blob, name); ui.toast('這台裝置沒有打開分享，圖片已先下載，可以從相簿傳到 LINE'); },
    });
  }
  // save a generated picture: the phone's share sheet (「儲存影像」, LINE…) when it takes files, otherwise a download.
  // → 'shared' | 'downloaded' | 'cancel' (closed, already open, or 「圖片做好了・儲存」 waiting: onDone runs if that tap saves it)
  async function saveImage(blob, name, title = '', onDone = null) {
    const r = await sharePicture(blob, name, { title, action: '儲存', onShared: onDone });
    if (r === 'shared') { savedPic(); return 'shared'; }
    if (r !== 'none') return 'cancel';
    downloadBlob(blob, name); savedPic(); return 'downloaded';
  }
  App.share = {
    open, link, render, cards, moment, checkMoments, momentLine, qr, saveImage, sharePicture, button, record, bonus, code: () => ensure(store.state).code, inviteText,
    copyText, downloadBlob, CUSTOMS, REWARDS,
    // drawing pieces for cards with their own layout (家族週報)
    draw: {
      FONT, THEMES, THEME_NAMES, loadImg, wrap, fitLine, roundRect, paintFrame, paintFooter,
    },
    FORMATS,
  };
}());
