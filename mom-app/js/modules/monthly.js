/* 易家做媽媽 — 寶寶月照 (a framed photo for every month of the first two years).
 * On each monthly birthday (出生、滿月、2 個月 … 1 歲 … 2 歲) the mom picks a photo; the app puts it in a frame with the
 * month, the name, the date, the size from 成長紀錄 and a short line, and makes the picture on this phone. Twelve months
 * make a 「第一年」 collage. The photos stay on the phone (App.media, IndexedDB) and go with the backup file; nothing is
 * uploaded. Saving or sharing a picture is her choice each time, and the picture carries no invite QR unless she adds it.
 *   screen 'monthly' (params {m, baby})   首頁 line on the month-day (from 滿月)   tool 'monthly'
 *   App.monthly = { label, slotDate, slotOf, dueSlot, homeLine, drawCard, drawCollage, open, FRAMES, ensure } */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const B = () => window.BRAND || {};
  const W = 1080; const H = 1350; // 4:5: an Instagram / Facebook post, a LINE album photo
  const LAST = 24; // 出生 (0) … 2 歲 (24)
  const NOTE_MAX = 24;
  const NAME_MAX = 12;
  const PREVIEW = 0.5; // the live preview is drawn at half size; saving draws the full 1080×1350

  /* ---------------- data ---------------- */
  // s.monthly = { babies: {babyId: {month: {photo, frame, crop:{x,y,z}, note, name|null, growth, at}}}, skip: {}, frame, qr }
  const ensure = (s) => {
    s.monthly = s.monthly || {};
    const mo = s.monthly;
    mo.babies = mo.babies || {};
    mo.skip = mo.skip || {}; // {'babyId:month': 'YYYY-MM-DD'} 首頁「這個月先不拍」
    if (!mo.frame) mo.frame = 'cream';
    if (mo.qr == null) mo.qr = false; // the invite QR is off unless she turns it on
    return mo;
  };
  const prefs = () => store.state.monthly || {};
  const slotsOf = (babyId) => ((prefs().babies || {})[babyId]) || {};
  const slotOf = (babyId, m) => { const sl = slotsOf(babyId)[m]; return sl && sl.photo ? sl : null; };
  const clamp = (v, a, z) => Math.max(a, Math.min(z, v));
  const chars = (s, n) => Array.from(String(s || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, n).join('');
  const cleanNote = (s) => chars(s, NOTE_MAX);
  const cleanName = (s) => chars(s, NAME_MAX);
  const num = (v) => String(Math.round(Number(v) * 100) / 100);
  const range = (a, z) => Array.from({ length: z - a + 1 }, (_, i) => a + i);

  // the month-day: 出生 is the birthday; month m is the m-th monthly birthday (1/31 + 1 month = 2/28)
  const slotDate = (b, m) => (m === 0 ? b.birthday : C.dateKey(C.addMonths(C.parseKey(b.birthday), m)));
  const dotDate = (key) => String(key || '').replace(/-/g, '.');
  function label(m) {
    if (m === 0) return { big: '出生', unit: '', text: '出生' };
    if (m === 1) return { big: '滿月', unit: '', text: '滿月' };
    if (m % 12 === 0) return { big: String(m / 12), unit: '歲', text: `${m / 12} 歲` };
    return { big: String(m), unit: '個月', text: `${m} 個月` };
  }
  const reached = (L) => (L.text === '出生' ? '出生了' : `${L.text}了`);
  const photoName = (L) => (L.text === '出生' ? '出生照' : `${L.text}的月照`);
  const lead = (t) => (/^\d/.test(t) ? ` ${t}` : t); // 「刪除 3 個月的月照」: a space before a number

  // height and weight for the card: the birth size for 出生, else the 成長紀錄 nearest the month-day (within 10 days)
  function growthFor(b, m) {
    if (m === 0) return [b.birthWeight ? `${num(b.birthWeight)} kg` : '', b.birthLength ? `${num(b.birthLength)} cm` : ''].filter(Boolean).join('・');
    const t = C.parseKey(slotDate(b, m)).getTime();
    let best = null; let bd = Infinity;
    (store.state.growth || []).forEach((g) => {
      if (g.babyId !== b.id || !(g.weight || g.length) || !g.date) return;
      const d = Math.abs(C.parseKey(g.date).getTime() - t) / C.DAY;
      if (d <= 10 && d < bd) { best = g; bd = d; }
    });
    return best ? [best.weight ? `${num(best.weight)} kg` : '', best.length ? `${num(best.length)} cm` : ''].filter(Boolean).join('・') : '';
  }
  // a short line for the card: skills checked in 發展里程碑 that month first, then a few warm ones
  function suggestions(b, m) {
    const out = [];
    const labels = {};
    ((App.HEALTH && App.HEALTH.MILESTONES) || []).forEach((band) => band.items.forEach((it) => { labels[it[0]] = it[2]; }));
    const ms = (store.state.milestones || {})[b.id] || {};
    const from = m === 0 ? '0000' : slotDate(b, m - 1);
    const to = C.dateKey(C.addDays(C.parseKey(slotDate(b, m)), 7));
    Object.entries(ms).forEach(([k, d]) => { if (d && d > from && d <= to && labels[k]) out.push(`${labels[k]}了`); });
    if (m === 0) out.push('歡迎來到這個世界', '我們的小寶貝來了');
    else if (m === 1) out.push('滿月快樂', '謝謝你選擇我們');
    else if (m === 12) out.push('一歲生日快樂', '第一年辛苦了，我們都是');
    else if (m === 24) out.push('兩歲生日快樂');
    out.push('每天都在長大', '最愛抱抱', '笑起來好可愛', '一起慢慢長大');
    return [...new Set(out.filter((x) => Array.from(x).length <= NOTE_MAX))].slice(0, 6);
  }

  /* ---------------- photos ---------------- */
  // 範例資料 carries drawn sample pictures (never a real baby): made on demand under their fixed ids
  const isDemo = (id) => /^demo-m\d+$/.test(String(id || ''));
  async function demoBlob(m) {
    const D = App.share.draw;
    const cv = document.createElement('canvas'); cv.width = 960; cv.height = 1200;
    const ctx = cv.getContext('2d');
    const tones = [['#fde8ef', '#f6c9d8'], ['#e3f2e8', '#c4e2cf'], ['#fff1dc', '#f7d9ae'], ['#ebe7fb', '#d2caf2']];
    const [a, z] = tones[m % tones.length];
    const g = ctx.createLinearGradient(0, 0, 0, 1200); g.addColorStop(0, a); g.addColorStop(1, z);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 1200);
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; // a soft blanket of dots
    for (let y = 40; y < 1200; y += 80) for (let x = (y / 80) % 2 ? 40 : 80; x < 960; x += 80) { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    const b = (store.state.babies || []).find((x) => x.id === 'demo-baby') || store.baby();
    const src = App.qbaby && b ? App.qbaby.dataUrl({ ...b, photo: null }, { size: 680, ground: false }) : null;
    const im = src ? await D.loadImg(src) : null;
    if (im) { const w = 680; const hh = w * ((im.naturalHeight / im.naturalWidth) || 1); ctx.drawImage(im, 480 - w / 2, 640 - hh / 2, w, hh); } else {
      ctx.font = `360px ${D.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('👶', 480, 620);
    }
    ctx.fillStyle = 'rgba(255,255,255,.88)'; D.roundRect(ctx, 760, 1110, 170, 60, 30); ctx.fill();
    ctx.fillStyle = '#7b4597'; ctx.font = `800 32px ${D.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('範例圖', 845, 1141);
    return new Promise((res) => cv.toBlob((bl) => res(bl), 'image/jpeg', 0.9));
  }
  async function photoUrl(id) {
    if (!id || !App.media) return null;
    let u = await App.media.url(id);
    if (!u && isDemo(id)) {
      const bl = await demoBlob(Number(id.slice(6)));
      if (bl) { try { await App.media.put(bl, id); u = await App.media.url(id); } catch (e) { u = URL.createObjectURL(bl); } }
    }
    return u;
  }
  async function loadPhoto(id) { const u = await photoUrl(id); return u ? App.share.draw.loadImg(u) : null; }

  /* ---------------- drawing ---------------- */
  const F = () => App.share.draw.FONT;
  let logoP = null;
  const logo = () => { logoP = logoP || App.share.draw.loadImg(B().logo || 'assets/logo.svg'); return logoP; };
  async function assets(sp) {
    const qrSrc = sp.qr && App.share.qr ? App.share.qr(App.share.link({ path: 'home', channel: 'qr', campaign: 'monthly' }), 240) : '';
    const [lg, qr] = await Promise.all([logo(), qrSrc ? App.share.draw.loadImg(qrSrc) : null]);
    return { logo: lg, qr };
  }
  // the photo fills its box ('cover'); crop.z zooms in, crop.x / crop.y (-1…1) choose which part shows
  function cover(img, w, hh, crop) {
    const z = clamp((crop && crop.z) || 1, 1, 3);
    const k = Math.max(w / img.naturalWidth, hh / img.naturalHeight) * z;
    const dw = img.naturalWidth * k; const dh = img.naturalHeight * k;
    const ox = dw - w; const oy = dh - hh;
    return { dx: (-ox * (1 + clamp((crop && crop.x) || 0, -1, 1))) / 2, dy: (-oy * (1 + clamp((crop && crop.y) || 0, -1, 1))) / 2, dw, dh, ox, oy };
  }
  function photo(ctx, sp, r, clip, tone) {
    ctx.save(); clip(ctx); ctx.clip();
    if (sp.img) {
      const c = cover(sp.img, r.w, r.h, sp.crop);
      ctx.drawImage(sp.img, r.x + c.dx, r.y + c.dy, c.dw, c.dh);
    } else { // the preview before a photo is chosen
      ctx.fillStyle = tone[0]; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `120px ${F()}`; ctx.fillText('📷', r.x + r.w / 2, r.y + r.h / 2 - 46);
      ctx.font = `800 46px ${F()}`; ctx.fillStyle = tone[1]; ctx.fillText('點這裡選照片', r.x + r.w / 2, r.y + r.h / 2 + 76);
    }
    ctx.restore();
  }
  function text(ctx, s, x, y, font, color, maxW, align = 'left') {
    if (!s) return;
    ctx.font = `${font} ${F()}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'top';
    ctx.fillText(App.share.draw.fitLine(ctx, String(s), maxW), x, y);
  }
  const noteLine = (ctx, sp, x, y, color, size = 42) => text(ctx, sp.note ? `「${sp.note}」` : '', x, y, `800 ${size}px`, color, sp.qr ? 660 : 920, 'center');
  // the month in big type: a number with its unit on the same baseline, or a word (出生・滿月); y is the top
  function bigLabel(ctx, L, x, y, { size, unit, color, align = 'left' }) {
    const s1 = L.unit ? size : Math.round(size * 0.72);
    ctx.font = `900 ${s1}px ${F()}`; const w1 = ctx.measureText(L.big).width;
    ctx.font = `800 ${unit}px ${F()}`; const gap = unit * 0.22; const w2 = L.unit ? gap + ctx.measureText(L.unit).width : 0;
    const tw = w1 + w2; const sx = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
    const base = y + s1 * 0.88;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color;
    ctx.font = `900 ${s1}px ${F()}`; ctx.fillText(L.big, sx, base);
    if (L.unit) { ctx.font = `800 ${unit}px ${F()}`; ctx.fillText(L.unit, sx + w1 + gap, base); }
    ctx.textBaseline = 'top';
    return { w: tw, h: s1 };
  }
  // the small 「易家做媽媽・寶寶月照」 mark at the bottom, and the invite QR in the corner when she adds it
  function brand(ctx, a, x, y, color, align = 'left') {
    const t = `${B().appName || '易家做媽媽'}・寶寶月照`;
    ctx.font = `700 28px ${F()}`; const tw = ctx.measureText(t).width; const total = 46 + 12 + tw;
    const sx = align === 'center' ? x - total / 2 : x;
    ctx.fillStyle = '#fff'; App.share.draw.roundRect(ctx, sx, y, 46, 46, 13); ctx.fill();
    if (a.logo) ctx.drawImage(a.logo, sx + 7, y + 4, 32, 36);
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, sx + 58, y + 24); ctx.textBaseline = 'top';
  }
  function qrMark(ctx, a) {
    if (!a.qr) return;
    const s = 112; const x = W - 40 - s; const y = H - 40 - s;
    ctx.fillStyle = '#fff'; App.share.draw.roundRect(ctx, x - 8, y - 8, s + 16, s + 16, 16); ctx.fill();
    ctx.drawImage(a.qr, x, y, s, s);
  }
  // a seeded scatter so the same month always gets the same confetti
  const rng = (seed) => { let v = (seed * 7919 + 13) % 2147483647; return () => { v = (v * 16807) % 2147483647; return (v - 1) / 2147483646; }; };
  function confetti(ctx, seed, colors, n, alpha = 0.8) {
    const r = rng(seed); ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i += 1) { ctx.fillStyle = colors[i % colors.length]; ctx.beginPath(); ctx.arc(r() * W, r() * H, 5 + r() * 9, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  function heart(ctx, x, y, s) {
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3); ctx.fill();
  }
  function sparkle(ctx, x, y, s) {
    ctx.beginPath(); ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s, y); ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s, y); ctx.quadraticCurveTo(x, y, x, y - s); ctx.fill();
  }
  function archPath(ctx, x, y, w, hh, rb) {
    ctx.beginPath(); ctx.moveTo(x, y + w / 2); ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, Math.PI * 2);
    ctx.lineTo(x + w, y + hh - rb); ctx.arcTo(x + w, y + hh, x + w - rb, y + hh, rb);
    ctx.lineTo(x + rb, y + hh); ctx.arcTo(x, y + hh, x, y + hh - rb, rb); ctx.closePath();
  }

  const FRAMES = {
    cream: {
      name: '奶油', swatch: '#f3e3d3', rect: { x: 90, y: 84, w: 900, h: 840 },
      draw(ctx, sp, a) {
        const R = this.rect; const D = App.share.draw;
        ctx.fillStyle = '#fbf4ec'; ctx.fillRect(0, 0, W, H);
        confetti(ctx, 11 + sp.m, ['#f4c6d3', '#cfe3d4', '#f8dca8', '#d9cdee'], 46);
        ctx.save(); ctx.shadowColor = 'rgba(74,31,98,.18)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
        ctx.fillStyle = '#fff'; D.roundRect(ctx, R.x - 16, R.y - 16, R.w + 32, R.h + 32, 56); ctx.fill(); ctx.restore();
        photo(ctx, sp, R, (c) => D.roundRect(c, R.x, R.y, R.w, R.h, 42), ['#f3e7dc', '#9a7f6e']);
        const top = R.y + R.h + 40;
        const lb = bigLabel(ctx, sp.label, 96, top, { size: 176, unit: 58, color: '#7b4597' });
        const rx = 96 + lb.w + 44; const rw = W - 92 - rx;
        const rows = [[sp.name, '800 52px', '#2b2231', 70], [sp.date, '600 32px', '#7a6f80', 46], [sp.growth, '700 32px', '#7b4597', 46]].filter((x) => x[0]);
        let y = top + 12 + Math.max(0, (3 - rows.length) * 22);
        rows.forEach(([t, f, c, step]) => { text(ctx, t, rx, y, f, c, rw); y += step; });
        noteLine(ctx, sp, W / 2, top + 196, '#4a1f62');
        brand(ctx, a, 96, H - 92, '#7a6f80');
        qrMark(ctx, a);
      },
    },
    polaroid: {
      name: '拍立得', swatch: '#f9d9d9', rect: { x: 186, y: 126, w: 708, h: 708 },
      draw(ctx, sp, a) {
        const R = this.rect; const D = App.share.draw;
        const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#fde4e4'); g.addColorStop(1, '#fbeedd');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        const r = rng(29 + sp.m); ctx.fillStyle = 'rgba(232,140,160,.35)';
        for (let i = 0; i < 18; i += 1) heart(ctx, r() * W, r() * H, 18 + r() * 22);
        ctx.save(); ctx.translate(540, 560); ctx.rotate(-0.04); ctx.translate(-540, -560);
        ctx.save(); ctx.shadowColor = 'rgba(80,40,40,.22)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 14;
        ctx.fillStyle = '#fff'; D.roundRect(ctx, 150, 90, 780, 930, 10); ctx.fill(); ctx.restore();
        photo(ctx, sp, R, (c) => D.roundRect(c, R.x, R.y, R.w, R.h, 4), ['#f6ecec', '#a07a7a']);
        bigLabel(ctx, sp.label, 540, 858, { size: 104, unit: 44, color: '#2b2231', align: 'center' });
        text(ctx, sp.date, 540, 972, '600 32px', '#8a7f90', 640, 'center');
        ctx.save(); ctx.translate(540, 94); ctx.rotate(0.06); ctx.fillStyle = 'rgba(246,214,168,.78)'; ctx.fillRect(-120, -30, 240, 60); ctx.restore();
        ctx.restore();
        text(ctx, [sp.name, sp.growth].filter(Boolean).join('・'), 540, 1062, '800 42px', '#4a1f62', 920, 'center');
        noteLine(ctx, sp, 540, 1132, '#b0502f');
        brand(ctx, a, a.qr ? 96 : 540, H - 96, '#8a6f78', a.qr ? 'left' : 'center');
        qrMark(ctx, a);
      },
    },
    wreath: {
      name: '花圈', swatch: '#dcebd8', rect: { x: 180, y: 160, w: 720, h: 720 },
      draw(ctx, sp, a) {
        const D = App.share.draw; const cx = 540; const cy = 520; const RR = 360;
        const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#eef4ea'); g.addColorStop(1, '#f9f5ec');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.shadowColor = 'rgba(40,70,40,.18)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 8;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, RR + 18, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        photo(ctx, sp, this.rect, (c) => { c.beginPath(); c.arc(cx, cy, RR, 0, Math.PI * 2); }, ['#eaf2e6', '#6f8f72']);
        // leaves all round, with a gap at the bottom for the ribbon
        const greens = ['#7fae86', '#5e9466', '#a3c9a0'];
        for (let i = 0; i < 64; i += 1) {
          const t = -Math.PI / 2 + (i * Math.PI * 2) / 64;
          if (Math.abs(t - Math.PI / 2) < 0.5) continue; // eslint-disable-line no-continue
          const rr = RR + 44 + (i % 3) * 5;
          ctx.save(); ctx.translate(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr); ctx.rotate(t + Math.PI / 2 + (i % 2 ? 0.55 : -0.55));
          ctx.fillStyle = greens[i % 3]; ctx.beginPath(); ctx.ellipse(0, 0, 36, 14, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
        [-90, -140, -40, 180, 0, 142, 38].map((d) => (d * Math.PI) / 180).forEach((t, i) => {
          const fx = cx + Math.cos(t) * (RR + 46); const fy = cy + Math.sin(t) * (RR + 46);
          ctx.fillStyle = i % 2 ? '#fbe3a8' : '#f4b6c4';
          for (let p = 0; p < 5; p += 1) { const q = (p * Math.PI * 2) / 5; ctx.beginPath(); ctx.arc(fx + Math.cos(q) * 13, fy + Math.sin(q) * 13, 12, 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.arc(fx, fy, 9, 0, Math.PI * 2); ctx.fill();
        });
        // the ribbon with the month on it
        const ry = cy + RR + 4; const rw = 500; const rx = cx - rw / 2;
        ctx.fillStyle = '#a8476a';
        [[rx + 40, -1], [rx + rw - 40, 1]].forEach(([x0, s]) => {
          ctx.beginPath(); ctx.moveTo(x0, ry + 22); ctx.lineTo(x0 + s * 110, ry + 22); ctx.lineTo(x0 + s * 80, ry + 70); ctx.lineTo(x0 + s * 110, ry + 122); ctx.lineTo(x0, ry + 122); ctx.closePath(); ctx.fill();
        });
        ctx.fillStyle = '#c95a80'; D.roundRect(ctx, rx, ry, rw, 104, 18); ctx.fill();
        bigLabel(ctx, sp.label, cx, ry + 10, { size: 84, unit: 38, color: '#fff', align: 'center' });
        text(ctx, sp.name, cx, 1016, '800 50px', '#2b2231', 920, 'center');
        text(ctx, [sp.date, sp.growth].filter(Boolean).join('・'), cx, 1082, '600 32px', '#6f6676', 920, 'center');
        noteLine(ctx, sp, cx, 1136, '#4f8758', 40);
        brand(ctx, a, a.qr ? 96 : 540, H - 96, '#6f6676', a.qr ? 'left' : 'center');
        qrMark(ctx, a);
      },
    },
    night: {
      name: '夜空', swatch: '#3b3170', rect: { x: 150, y: 130, w: 780, h: 780 },
      draw(ctx, sp, a) {
        const R = this.rect;
        const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1d1a3a'); g.addColorStop(1, '#3d3274');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        const r = rng(47 + sp.m);
        for (let i = 0; i < 90; i += 1) { ctx.globalAlpha = 0.35 + r() * 0.65; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r() * W, r() * H, 1.5 + r() * 2.2, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1; ctx.fillStyle = '#f3d27a';
        [[86, 120, 22], [990, 420, 16], [70, 760, 18], [1000, 980, 20], [120, 1200, 14], [960, 1240, 12]].forEach(([x, y, s]) => sparkle(ctx, x, y, s));
        const moon = document.createElement('canvas'); moon.width = 200; moon.height = 200; // a crescent cut out of a disc
        const mc = moon.getContext('2d'); mc.fillStyle = '#f6e3a1'; mc.beginPath(); mc.arc(100, 100, 66, 0, Math.PI * 2); mc.fill();
        mc.globalCompositeOperation = 'destination-out'; mc.beginPath(); mc.arc(130, 82, 58, 0, Math.PI * 2); mc.fill();
        ctx.drawImage(moon, 846, 22);
        archPath(ctx, R.x - 14, R.y - 14, R.w + 28, R.h + 28, 50); ctx.strokeStyle = '#f3d27a'; ctx.lineWidth = 8; ctx.stroke();
        photo(ctx, sp, R, (c) => archPath(c, R.x, R.y, R.w, R.h, 36), ['#2c2752', '#c9c1f0']);
        bigLabel(ctx, sp.label, 540, 948, { size: 122, unit: 48, color: '#f3d27a', align: 'center' });
        text(ctx, [sp.name, sp.date].filter(Boolean).join('・'), 540, 1086, '700 38px', '#ece8ff', 920, 'center');
        text(ctx, sp.growth, 540, 1138, '600 32px', '#c9c1f0', 920, 'center');
        noteLine(ctx, sp, 540, sp.growth ? 1188 : 1146, '#f3d27a', 40);
        brand(ctx, a, a.qr ? 96 : 540, H - 92, '#c9c1f0', a.qr ? 'left' : 'center');
        qrMark(ctx, a);
      },
    },
  };
  const frameOf = (id) => (FRAMES[id] ? id : 'cream');

  // spec: {m, frame, img, crop, label, name, date, growth, note, qr}
  async function drawCard(sp, scale = 1) {
    const a = await assets(sp);
    const cv = document.createElement('canvas'); cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    const ctx = cv.getContext('2d'); ctx.scale(scale, scale);
    FRAMES[frameOf(sp.frame)].draw(ctx, sp, a);
    return cv;
  }
  // spec: {title, sub, cells:[{label, img, crop}], qr}: the year as a 3 × 4 grid
  async function drawCollage(sp, scale = 1) {
    const a = await assets(sp); const D = App.share.draw;
    const cv = document.createElement('canvas'); cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    const ctx = cv.getContext('2d'); ctx.scale(scale, scale);
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, '#fbf3ea'); g.addColorStop(1, '#f6e9f2');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    confetti(ctx, 5, ['#f4c6d3', '#cfe3d4', '#f8dca8', '#d9cdee'], 30, 0.6);
    text(ctx, sp.title, W / 2, 62, '900 60px', '#4a1f62', 940, 'center');
    text(ctx, sp.sub, W / 2, 142, '600 30px', '#8a7f90', 940, 'center');
    const x0 = 60; const y0 = 210; const gap = 20; const cw = (W - 120 - gap * 2) / 3;
    const bottom = sp.qr ? 1186 : 1236; const ch = (bottom - y0 - gap * 3) / 4;
    sp.cells.forEach((cell, i) => {
      const x = x0 + (i % 3) * (cw + gap); const y = y0 + Math.floor(i / 3) * (ch + gap);
      ctx.save(); D.roundRect(ctx, x, y, cw, ch, 26); ctx.clip();
      if (cell.img) {
        const c = cover(cell.img, cw, ch, cell.crop); ctx.drawImage(cell.img, x + c.dx, y + c.dy, c.dw, c.dh);
      } else {
        ctx.fillStyle = '#efe4ec'; ctx.fillRect(x, y, cw, ch);
        ctx.fillStyle = '#c3aec3'; ctx.font = `800 44px ${F()}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(cell.label.text, x + cw / 2, y + ch / 2);
      }
      ctx.restore();
      if (cell.img) {
        ctx.font = `800 26px ${F()}`; const tw = ctx.measureText(cell.label.text).width;
        ctx.fillStyle = 'rgba(255,255,255,.93)'; D.roundRect(ctx, x + 12, y + ch - 56, tw + 28, 44, 22); ctx.fill();
        ctx.fillStyle = '#7b4597'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(cell.label.text, x + 26, y + ch - 33);
      }
    });
    ctx.textBaseline = 'top';
    brand(ctx, a, 60, H - 88, '#8a7f90');
    qrMark(ctx, a);
    return cv;
  }
  const toJpeg = (cv) => new Promise((res) => cv.toBlob((bl) => res(bl), 'image/jpeg', 0.92));

  /* ---------------- saving and sharing ---------------- */
  // done() runs once the picture has left the app (shared, saved or downloaded), also after 「圖片做好了・分享」
  async function deliver(how, blob, fileName, words, done = () => {}) {
    if (!blob) { ui.toast('圖片做不出來，請再試一次'); return; }
    if (how === 'share') {
      const thanks = () => {
        const pts = App.share.record ? App.share.record('more', 'monthly') : 0;
        ui.toast(`謝謝分享${pts ? `・好孕點數 +${pts}` : ''}`);
        done();
      };
      const r = await App.share.sharePicture(blob, fileName, { text: words, onShared: thanks });
      if (r === 'shared') { thanks(); return; }
      if (r !== 'none') return; // closed, already open, or 「圖片做好了・分享」 is waiting for her tap
      App.share.downloadBlob(blob, fileName);
      ui.toast('這台裝置不能直接分享圖片，已先下載，可以從相簿傳到 LINE');
      done();
      return;
    }
    const r = await App.share.saveImage(blob, fileName, '寶寶月照', done);
    if (r === 'downloaded') ui.toast('圖片已下載');
    if (r !== 'cancel') done();
  }

  /* ---------------- the editor (a sheet over the screen) ---------------- */
  function open(b, m) {
    const L = label(m);
    const date = slotDate(b, m);
    const mo = prefs();
    const cur = slotsOf(b.id)[m] || {};
    const st = {
      photo: cur.photo || null,
      frame: frameOf(cur.photo ? cur.frame : mo.frame),
      crop: { x: 0, y: 0, z: 1, ...(cur.crop || {}) },
      note: cur.note || '',
      name: cur.name != null ? cur.name : (b.name || ''),
      growth: cur.growth !== false,
      qr: !!mo.qr,
    };
    let img = null;
    const growth = growthFor(b, m);
    const spec = () => ({
      m, frame: st.frame, img, crop: st.crop, label: L, name: cleanName(st.name), date: dotDate(date), growth: st.growth ? growth : '', note: cleanNote(st.note), qr: st.qr,
    });

    const cv = h('canvas', { class: 'mo-cv', width: Math.round(W * PREVIEW), height: Math.round(H * PREVIEW), tabindex: '0', role: 'img', 'aria-label': `${photoName(L)}預覽` });
    const cx = cv.getContext('2d');
    let seq = 0; let queued = false;
    const paint = () => {
      if (queued) return; queued = true;
      requestAnimationFrame(async () => {
        queued = false; seq += 1; const mine = seq;
        const off = await drawCard(spec(), PREVIEW);
        if (mine === seq) { cx.clearRect(0, 0, cv.width, cv.height); cx.drawImage(off, 0, 0); cv.dataset.painted = String(Number(cv.dataset.painted || 0) + 1); }
      });
    };

    // saving as she goes: the month keeps its photo, frame, crop and words without a 儲存 button
    let saveT = 0;
    const commit = () => {
      clearTimeout(saveT);
      let first = false;
      store.update((s) => {
        const M = ensure(s);
        M.frame = st.frame; M.qr = st.qr;
        if (!st.photo) return;
        const bs = M.babies[b.id] || (M.babies[b.id] = {});
        first = !(bs[m] && bs[m].photo);
        const nm = cleanName(st.name);
        bs[m] = {
          photo: st.photo, frame: st.frame, crop: { x: Math.round(st.crop.x * 1000) / 1000, y: Math.round(st.crop.y * 1000) / 1000, z: Math.round(st.crop.z * 1000) / 1000 },
          note: cleanNote(st.note), name: nm === (b.name || '') ? null : nm, growth: st.growth, at: (bs[m] && bs[m].at) || new Date().toISOString(),
        };
      });
      if (first && App.count) App.count('monthly_photo'); // 使用統計: a month got its photo (a count only)
    };
    const persist = () => { clearTimeout(saveT); saveT = setTimeout(commit, 300); };

    const file = h('input', { type: 'file', accept: 'image/*', class: 'hide', 'aria-hidden': 'true', tabindex: '-1' });
    const pickBtn = h('button', { type: 'button', class: 'btn btn-soft grow mo-pick', onclick: () => file.click() });
    const zoom = h('input', {
      type: 'range', min: '1', max: '3', step: '0.01', value: String(st.crop.z), class: 'mo-zoom', 'aria-label': '放大照片',
      oninput: (e) => { st.crop.z = clamp(Number(e.target.value) || 1, 1, 3); paint(); persist(); },
    });
    const hint = h('p', { class: 'tiny muted center mo-hint' }, '在照片上拖曳移動・兩指或拉桿放大');
    const demoNote = h('p', { class: 'tiny center mo-demo' }, '這是範例圖，換成你自己的照片吧 📷');
    const frames = h('div', { class: 'chips mo-frames', role: 'group', 'aria-label': '相框' }, Object.entries(FRAMES).map(([id, f]) => h('button', {
      type: 'button', class: 'chip mo-frame', 'aria-pressed': String(id === st.frame), dataset: { frame: id },
      onclick: () => { st.frame = id; frames.querySelectorAll('.mo-frame').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.frame === id))); paint(); persist(); },
    }, h('span', { class: 'mo-sw', style: { background: f.swatch }, 'aria-hidden': 'true' }), f.name)));
    const nameIn = h('input', {
      type: 'text', class: 'input mo-name', maxlength: String(NAME_MAX), value: st.name, placeholder: '名字或小名（可留白）', 'aria-label': '卡片上的名字',
      oninput: (e) => { st.name = e.target.value; paint(); persist(); },
    });
    const noteIn = h('input', {
      type: 'text', class: 'input mo-note', maxlength: String(NOTE_MAX), value: st.note, placeholder: '一句話，例如：會翻身了！', 'aria-label': '卡片上的一句話',
      oninput: (e) => { st.note = e.target.value; paint(); persist(); },
    });
    const ideas = h('div', { class: 'chips mo-ideas' }, suggestions(b, m).map((t) => h('button', {
      type: 'button', class: 'chip', onclick: () => { st.note = t; noteIn.value = t; paint(); persist(); },
    }, t)));
    const growthRow = growth ? h('label', { class: 'check-row mo-growth' },
      h('input', { type: 'checkbox', checked: st.growth, onchange: (e) => { st.growth = e.target.checked; paint(); persist(); } }),
      h('span', { class: 'small' }, `放上身高體重（${growth}）`)) : null;
    const qrRow = h('label', { class: 'check-row mo-qr' },
      h('input', { type: 'checkbox', checked: st.qr, onchange: (e) => { st.qr = e.target.checked; paint(); persist(); } }),
      h('span', { class: 'small' }, '角落放邀請 QR（朋友掃描就能一起用）'));
    const delBtn = h('button', {
      type: 'button', class: 'btn btn-ghost btn-sm mo-del',
      onclick: async () => {
        if (!st.photo) return;
        if (!(await ui.confirm(`刪除${lead(photoName(L))}？手機相簿裡的原照片不會受影響。`, { ok: '刪除', danger: true }))) return;
        const old = st.photo; st.photo = null; img = null; st.crop = { x: 0, y: 0, z: 1 };
        clearTimeout(saveT);
        store.update((s) => { const M = ensure(s); if (M.babies[b.id]) delete M.babies[b.id][m]; });
        if (App.media) App.media.del(old);
        sync(); paint(); ui.toast('已刪除這張月照');
      },
    }, '🗑 刪除這張月照');
    // making the full-size picture takes a moment (about a second, longer on an older phone): the button says so
    const saveBtn = h('button', { type: 'button', class: 'btn btn-soft grow mo-save', onclick: () => ui.busy(saveBtn, () => out('save'), { also: [shareBtn] }) }, '💾 存圖片');
    const shareBtn = h('button', { type: 'button', class: 'btn btn-primary grow mo-share', onclick: () => ui.busy(shareBtn, () => out('share'), { also: [saveBtn] }) }, '📤 分享');

    function sync() {
      pickBtn.textContent = st.photo ? '🖼 換一張照片' : '📷 選一張照片';
      [zoom, saveBtn, shareBtn].forEach((x) => { x.disabled = !st.photo; });
      zoom.value = String(st.crop.z);
      delBtn.hidden = !st.photo; hint.hidden = !st.photo; demoNote.hidden = !isDemo(st.photo);
      cv.classList.toggle('can-drag', !!st.photo);
    }
    async function out(how) {
      if (st.photo && !img) img = await imgP; // tapped before the photo finished loading
      if (!img) { if (!st.photo) file.click(); else ui.toast('照片還在讀取，請再按一次'); return; }
      commit();
      const blob = await toJpeg(await drawCard(spec(), 1));
      await deliver(how, blob, `yijia-month-${String(m).padStart(2, '0')}.jpg`, `${cleanName(st.name) || '寶寶'}${reached(L)} 📸`,
        () => store.update((s) => { const sl = (ensure(s).babies[b.id] || {})[m]; if (sl) sl.out = C.dateKey(); }));
    }

    file.addEventListener('change', async () => {
      const f = file.files && file.files[0]; file.value = '';
      if (!f) return;
      let id = null;
      try {
        const blob = await App.media.fromFile(f, { max: 2048, quality: 0.88 });
        id = await App.media.put(blob);
      } catch (e) { ui.toast(e && /quota/i.test(`${e.name} ${e.message}`) ? '手機空間不夠，這張照片存不下來' : '這張照片讀不出來，換一張試試'); return; }
      const old = st.photo; const first = !old;
      st.photo = id; st.crop = { x: 0, y: 0, z: 1 };
      img = await loadPhoto(id);
      commit();
      if (old && old !== id && App.media) App.media.del(old); // the photo it replaces (the original is still in her album)
      sync(); paint();
      if (first) {
        ui.toast(`已放進${lead(L.text === '出生' ? '出生照' : L.text)}的相框`);
        ui.celebrate({ from: cv, emojis: ['📸', '💜', '✨'] });
      }
    });

    // move the photo with a finger (or the mouse), zoom with two fingers or the wheel; arrow keys and +/- too
    const pts = new Map(); let pinch = null;
    const dist = () => { const [p, q] = [...pts.values()]; return Math.hypot(p.x - q.x, p.y - q.y) || 1; };
    cv.addEventListener('pointerdown', (e) => {
      if (!img) { file.click(); return; }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { cv.setPointerCapture(e.pointerId); } catch (er) { /* fine */ }
      if (pts.size === 2) pinch = { d: dist(), z: st.crop.z };
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p || !img) return;
      if (pts.size >= 2 && pinch) {
        p.x = e.clientX; p.y = e.clientY;
        st.crop.z = clamp((pinch.z * dist()) / pinch.d, 1, 3); zoom.value = String(st.crop.z); paint();
        return;
      }
      const k = W / (cv.clientWidth || cv.width); const R = FRAMES[st.frame].rect;
      const c = cover(img, R.w, R.h, st.crop);
      const dx = (e.clientX - p.x) * k; const dy = (e.clientY - p.y) * k;
      p.x = e.clientX; p.y = e.clientY;
      if (c.ox > 1) st.crop.x = clamp(st.crop.x - (2 * dx) / c.ox, -1, 1);
      if (c.oy > 1) st.crop.y = clamp(st.crop.y - (2 * dy) / c.oy, -1, 1);
      paint();
    });
    const lift = (e) => { if (pts.delete(e.pointerId)) persist(); if (pts.size < 2) pinch = null; };
    cv.addEventListener('pointerup', lift); cv.addEventListener('pointercancel', lift);
    cv.addEventListener('wheel', (e) => {
      if (!img) return; e.preventDefault();
      st.crop.z = clamp(st.crop.z - e.deltaY * 0.0015, 1, 3); zoom.value = String(st.crop.z); paint(); persist();
    }, { passive: false });
    cv.addEventListener('keydown', (e) => {
      if (!img) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } return; }
      const mv = { ArrowLeft: [-0.08, 0], ArrowRight: [0.08, 0], ArrowUp: [0, -0.08], ArrowDown: [0, 0.08] }[e.key];
      if (mv) { e.preventDefault(); st.crop.x = clamp(st.crop.x + mv[0], -1, 1); st.crop.y = clamp(st.crop.y + mv[1], -1, 1); }
      else if (e.key === '+' || e.key === '=') st.crop.z = clamp(st.crop.z + 0.1, 1, 3);
      else if (e.key === '-') st.crop.z = clamp(st.crop.z - 0.1, 1, 3);
      else return;
      zoom.value = String(st.crop.z); paint(); persist();
    });

    const whenText = `${C.fmtDate(date, false)}${date > C.dateKey() ? `（還有 ${C.diffDays(new Date(), C.parseKey(date))} 天）` : ''}`;
    const sheet = ui.sheet({
      title: `${b.name || '寶寶'} ${L.text}`,
      body: h('div', { class: 'mo-ed' },
        h('p', { class: 'tiny muted center mo-when' }, `${photoName(L)}・${whenText}`),
        h('div', { class: 'mo-stage' }, cv), hint, demoNote,
        h('div', { class: 'row gap mo-tools' }, pickBtn, file),
        h('label', { class: 'mo-zoom-row' }, h('span', { class: 'tiny muted', 'aria-hidden': 'true' }, '🔍'), zoom),
        h('div', { class: 'mo-lbl small bold' }, '相框'), frames,
        h('div', { class: 'mo-lbl small bold' }, '名字'), nameIn,
        h('div', { class: 'mo-lbl small bold' }, '一句話'), noteIn, ideas,
        growthRow, qrRow,
        h('p', { class: 'tiny faint mo-safe' }, '🔒 照片只存在這支手機，不會上傳；備份檔會一起帶走。存圖或分享都由你決定。'),
        h('div', { class: 'center' }, delBtn)),
      footer: h('div', { class: 'row gap' }, saveBtn, shareBtn),
      onClose: () => { commit(); if (/^#\/monthly\b/.test(location.hash)) App.refresh(); },
    });
    sync(); paint();
    let imgP = Promise.resolve(null);
    if (st.photo) {
      const first = st.photo;
      imgP = loadPhoto(first);
      imgP.then((im) => { if (st.photo !== first) return; if (!img) img = im; if (!im) { st.photo = null; sync(); } paint(); });
    }
    return sheet;
  }

  /* ---------------- the year collage ---------------- */
  async function collageSpec(b, months, title, qr) {
    const imgs = await Promise.all(months.map((m) => { const sl = slotOf(b.id, m); return sl ? loadPhoto(sl.photo) : null; }));
    return {
      title, qr,
      sub: `${dotDate(slotDate(b, months[0]))} – ${dotDate(slotDate(b, months[months.length - 1]))}`,
      cells: months.map((m, i) => ({ label: label(m), img: imgs[i], crop: (slotOf(b.id, m) || {}).crop })),
    };
  }
  function openCollage(b, year) {
    const months = year === 2 ? range(13, 24) : range(1, 12);
    const title = `${b.name || '寶寶'}的${year === 2 ? '第二年' : '第一年'}`;
    const have = months.filter((m) => slotOf(b.id, m)).length;
    const st = { qr: !!prefs().qr };
    const cv = h('canvas', { class: 'mo-cv mo-cv-col', width: Math.round(W * PREVIEW), height: Math.round(H * PREVIEW), role: 'img', 'aria-label': `${title}拼貼預覽` });
    const cx = cv.getContext('2d'); let seq = 0;
    const paint = async () => {
      seq += 1; const mine = seq;
      const off = await drawCollage(await collageSpec(b, months, title, st.qr), PREVIEW);
      if (mine === seq) { cx.clearRect(0, 0, cv.width, cv.height); cx.drawImage(off, 0, 0); cv.dataset.painted = String(Number(cv.dataset.painted || 0) + 1); }
    };
    const out = async (how) => {
      const blob = await toJpeg(await drawCollage(await collageSpec(b, months, title, st.qr), 1));
      await deliver(how, blob, `yijia-year-${year}.jpg`, `${title} 📸`);
    };
    const colSave = h('button', { type: 'button', class: 'btn btn-soft grow mo-save', onclick: () => ui.busy(colSave, () => out('save'), { also: [colShare] }) }, '💾 存圖片');
    const colShare = h('button', { type: 'button', class: 'btn btn-primary grow mo-share', onclick: () => ui.busy(colShare, () => out('share'), { also: [colSave] }) }, '📤 分享');
    const sheet = ui.sheet({
      title: `${title}`,
      body: h('div', { class: 'mo-ed' },
        h('div', { class: 'mo-stage' }, cv),
        h('p', { class: 'small muted center mo-count' }, have >= months.length ? `${months.length} 個月都到齊了 🎉` : `已放 ${have}／${months.length} 張，還沒拍的月份會留白`),
        h('label', { class: 'check-row mo-qr' },
          h('input', { type: 'checkbox', checked: st.qr, onchange: (e) => { st.qr = e.target.checked; store.update((s) => { ensure(s).qr = st.qr; }); paint(); } }),
          h('span', { class: 'small' }, '角落放邀請 QR（朋友掃描就能一起用）'))),
      footer: h('div', { class: 'row gap' }, colSave, colShare),
    });
    paint();
    return sheet;
  }

  /* ---------------- the screen ---------------- */
  const view = { baby: null, opened: null };
  function thumb(sl) {
    const im = h('img', { alt: '', class: 'mo-img', decoding: 'async' });
    const c = sl.crop || {};
    im.style.objectPosition = `${((1 + clamp(c.x || 0, -1, 1)) / 2) * 100}% ${((1 + clamp(c.y || 0, -1, 1)) / 2) * 100}%`;
    photoUrl(sl.photo).then((u) => { if (u) im.src = u; else im.classList.add('gone'); });
    return im;
  }
  function tile(b, m, a, todayKey, { wide = false } = {}) {
    const L = label(m); const date = slotDate(b, m); const sl = slotOf(b.id, m);
    const state = sl ? 'done' : date > todayKey ? 'future' : a.months === m ? 'now' : 'past';
    const soon = state === 'future' && C.diffDays(C.parseKey(todayKey), C.parseKey(date)) <= 3; // a day or three early is fine
    const sub = state === 'done' ? C.fmtDate(date, false) : state === 'now' ? '這個月・拍一張' : state === 'past' ? '補拍' : C.fmtDate(date, false);
    const what = { done: '已拍', now: '這個月，還沒拍', past: '還沒拍，可以補拍', future: soon ? '快到了，可以先拍' : '還沒到' }[state];
    return h('button', {
      type: 'button', class: `mo-tile is-${state}${wide ? ' mo-wide' : ''}${soon ? ' is-soon' : ''}`, dataset: { m: String(m) },
      'aria-label': `${L.text}，${C.fmtDate(date, false)}，${what}`,
      onclick: () => {
        if (state === 'future' && !soon) { ui.toast(`${L.text}是 ${C.fmtDate(date, false)}，到時候再來拍 📅`); return; }
        open(b, m);
      },
    },
    h('span', { class: 'mo-thumb' }, sl ? thumb(sl) : h('span', { class: 'mo-ph', 'aria-hidden': 'true' }, state === 'future' ? (soon ? '📷' : '🗓') : '＋')),
    h('span', { class: 'mo-tx' }, h('span', { class: 'mo-tl' }, wide ? photoName(L) : L.text),
      h('span', { class: 'mo-td' }, wide && sl ? `${C.fmtDate(date, false)}${growthFor(b, 0) ? `・${growthFor(b, 0)}` : ''}` : wide && state !== 'done' ? '選一張出生時的照片' : sub)));
  }
  function renderScreen(el, params) {
    const s = store.state;
    const babies = s.babies || [];
    if (params.baby && babies.some((x) => x.id === params.baby)) view.baby = params.baby;
    const b = babies.find((x) => x.id === view.baby) || store.baby();
    if (!b) {
      el.append(ui.card({ class: 'soft center mo-empty' },
        ui.pic('monthly', 112, 'empty-pic'),
        h('p', null, '寶寶出生後，每個月拍一張月照，套上相框。'),
        App.me && App.me.editBaby ? h('button', { class: 'btn btn-primary', onclick: () => App.me.editBaby() }, '新增寶寶') : null));
      return;
    }
    if (babies.length > 1) {
      el.append(h('div', { class: 'mb' }, ui.seg(babies.map((x) => ({ value: x.id, label: x.name || '寶寶' })), b.id,
        (v) => { view.baby = v; App.refresh(); }, { small: true })));
    }
    if (!b.birthday) {
      el.append(ui.card({ class: 'soft center' }, h('p', null, '先填寶寶的生日，月照才知道每個月是哪一天。'),
        App.me && App.me.editBaby ? h('button', { class: 'btn btn-primary', onclick: () => App.me.editBaby(b) }, '填生日') : null));
      return;
    }
    const now = new Date(); const todayKey = C.dateKey(now);
    const a = C.babyAge(b.birthday, now) || { months: 0, days: 0 };
    const done = range(0, LAST).filter((m) => slotOf(b.id, m)).length;
    const total = a.months >= 11 ? LAST + 1 : 13;
    let next = a.months <= LAST && !slotOf(b.id, a.months) && a.days >= 0 ? a.months : null;
    if (next == null) next = range(a.months + 1, LAST).find((m) => !slotOf(b.id, m));
    let nextLine;
    if (a.months > LAST) nextLine = '兩歲以前的每個月都在這裡，隨時可以補拍';
    else if (next == null) nextLine = '每個月都拍好了。';
    else if (next === 0) nextLine = '先放一張出生時的照片吧';
    else if (next === a.months) nextLine = `這個月（${label(next).text}）還沒拍，現在就來拍一張`;
    else nextLine = `下一張：${label(next).text}・${C.fmtDate(slotDate(b, next), false)}（還有 ${C.diffDays(now, C.parseKey(slotDate(b, next)))} 天）`;
    el.append(ui.card({ class: 'mo-intro' },
      h('div', { class: 'row gap' },
        ui.pic('monthly', 52, 'mo-intro-pic'),
        h('div', { class: 'grow' }, h('div', { class: 'bold' }, `${b.name || '寶寶'}的月照`), h('div', { class: 'small muted mo-next' }, nextLine))),
      h('div', { class: 'mo-prog', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(Math.min(done, total)), 'aria-label': `已拍 ${done} 張` },
        h('span', { style: { width: `${Math.min(100, (done / total) * 100)}%` } })),
      h('div', { class: 'tiny muted' }, `已拍 ${done} 張・每個月的同一天拍一張，套上相框留作紀念`)));

    el.append(h('div', { class: 'mo-grid mo-grid-0' }, tile(b, 0, a, todayKey, { wide: true })));
    el.append(h('div', { class: 'section-title' }, h('span', null, '第一年'), h('span', { class: 'tiny muted' }, '滿月 → 1 歲')));
    el.append(h('div', { class: 'mo-grid' }, range(1, 12).map((m) => tile(b, m, a, todayKey))));
    const y1 = range(1, 12).filter((m) => slotOf(b.id, m)).length;
    el.append(h('button', {
      type: 'button', class: 'btn btn-block btn-soft mt mo-col-btn', disabled: !y1,
      onclick: () => openCollage(b, 1),
    }, y1 ? `🧩 做成「第一年」拼貼（${y1}／12）` : '🧩 拍了月照就能做成「第一年」拼貼'));
    if (a.months >= 11) {
      el.append(h('div', { class: 'section-title' }, h('span', null, '第二年'), h('span', { class: 'tiny muted' }, '13 個月 → 2 歲')));
      el.append(h('div', { class: 'mo-grid' }, range(13, 24).map((m) => tile(b, m, a, todayKey))));
      const y2 = range(13, 24).filter((m) => slotOf(b.id, m)).length;
      if (y2) el.append(h('button', { type: 'button', class: 'btn btn-block btn-soft mt mo-col-btn mo-col-2', onclick: () => openCollage(b, 2) }, `🧩 做成「第二年」拼貼（${y2}／12）`));
    }
    el.append(h('p', { class: 'disclaimer' }, '月照在這支手機上製作，照片不會上傳；換手機前記得到「我的 → 備份」，照片會一起帶走。卡片上不會放 QR，除非你自己打開。'));

    // from 首頁 (or a link) with a month: open that month once
    const key = `${location.hash}|${b.id}`;
    if (params.m != null && view.opened !== key) {
      view.opened = key;
      const m = clamp(Math.round(Number(params.m)) || 0, 0, LAST);
      setTimeout(() => open(b, m), 60);
    }
  }
  App.screen('monthly', {
    title: '寶寶月照',
    tab: 'health',
    liveUpdate: false, // the editor sheet saves as she types; the grid redraws when it closes
    render(el, params) { renderScreen(el, params || {}); },
    onLeave() { view.opened = null; },
  });

  /* ---------------- 首頁: the month-day (from 滿月 to 2 歲, for a week) ---------------- */
  function dueSlot(b, now = new Date()) {
    if (!b || !b.birthday) return null;
    const a = C.babyAge(b.birthday, now);
    if (!a || a.days < 0 || a.months < 1 || a.months > LAST || a.remDays > 6) return null;
    if (slotOf(b.id, a.months) || (prefs().skip || {})[`${b.id}:${a.months}`]) return null;
    return a.months;
  }
  function homeLine(b) {
    const m = dueSlot(b); if (m == null) return null;
    const L = label(m);
    return h('div', { class: 'mo-home' },
      h('button', { type: 'button', class: 'moment-line mo-home-go', onclick: () => App.navigate('monthly', { m, baby: b.id }) },
        h('span', { class: 'moment-emoji', 'aria-hidden': 'true' }, '📸'),
        h('span', { class: 'grow' }, h('strong', null, `${b.name || '寶寶'}${L.unit ? ' ' : ''}${reached(L)}`), h('span', { class: 'moment-more' }, '拍張月照留作紀念')),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')),
      h('button', {
        type: 'button', class: 'icon-btn mo-home-x', 'aria-label': '這個月先不拍',
        onclick: () => { store.update((s) => { ensure(s).skip[`${b.id}:${m}`] = C.dateKey(); }); ui.toast('這個月先不拍。月照隨時可以在「健康 → 寶寶月照」補拍'); App.refresh(); },
      }, '✕'));
  }

  App.tool({
    id: 'monthly', title: '寶寶月照', icon: '📸', desc: '每月一張相框照，做成一年拼貼', stages: ['baby'], screen: 'monthly', order: 32, group: '成長發育',
    tags: ['月照', '照片', '拍照', '相框', '滿月照', '周歲', '度晬', '拼貼', '成長照', '每月'],
  });

  App.monthly = {
    label, slotDate, slotOf, slotsOf, dueSlot, homeLine, growthFor, suggestions, drawCard, drawCollage, open, openCollage, FRAMES, ensure, isDemo, cover, photoUrl,
  };
}());
