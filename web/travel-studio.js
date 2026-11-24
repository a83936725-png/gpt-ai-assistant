// Share images people want to post: a check-in postcard, a story-sized polaroid, a passport page of
// stamps, a footprint map and a badge card. Pure drawing: the page passes the data and image URLs,
// every template resolves to a canvas.
(function studio() {
  const SERIF = '"Noto Serif TC", "Songti TC", "PMingLiU", serif';
  const SANS = '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';
  const INKS = ['#c8102e', '#1d4fd8', '#0b7a5a', '#7b2cbf', '#b85c00', '#0e6ba8'];

  const make = (w, h) => {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return [cv, cv.getContext('2d')];
  };
  const fontsReady = async (text) => {
    try {
      await Promise.all([document.fonts.load(`900 64px ${SERIF}`, text), document.fonts.load(`600 64px ${SERIF}`, text)]);
    } catch { /* system serif is fine */ }
  };
  const loadImg = (src) => new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const im = new Image();
    if (/^https?:/i.test(src) && !src.startsWith(window.location.origin)) { im.crossOrigin = 'anonymous'; im.referrerPolicy = 'no-referrer'; }
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
  const firstImg = (list) => list.reduce((p, src) => p.then((found) => found || loadImg(src)), Promise.resolve(null));
  const svgImage = async (svg) => {
    if (!svg) return null;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const im = await loadImg(url);
    URL.revokeObjectURL(url);
    return im;
  };
  const rr = (x, X, Y, W, H, r) => {
    x.beginPath();
    x.moveTo(X + r, Y);
    x.arcTo(X + W, Y, X + W, Y + H, r);
    x.arcTo(X + W, Y + H, X, Y + H, r);
    x.arcTo(X, Y + H, X, Y, r);
    x.arcTo(X, Y, X + W, Y, r);
    x.closePath();
  };
  const coverDraw = (x, im, X, Y, W, H) => {
    const s = Math.max(W / im.naturalWidth, H / im.naturalHeight);
    const w = im.naturalWidth * s;
    const h = im.naturalHeight * s;
    x.drawImage(im, X + (W - w) / 2, Y + (H - h) / 2, w, h);
  };
  const noPhoto = (x, X, Y, W, H, a = '#2b4a7a', b = '#0f1d38') => {
    const g = x.createLinearGradient(X, Y, X + W, Y + H);
    g.addColorStop(0, a); g.addColorStop(1, b);
    x.fillStyle = g; x.fillRect(X, Y, W, H);
  };
  const fit = (x, text, weight, family, size, maxW) => {
    let s = size;
    x.font = `${weight} ${s}px ${family}`;
    while (s > 12 && x.measureText(text).width > maxW) { s -= 2; x.font = `${weight} ${s}px ${family}`; }
    return s;
  };
  // Chinese wraps by character; an overlong last line ends with an ellipsis.
  const wrap = (x, text, maxW, maxLines = 3) => {
    const lines = [];
    let line = '';
    [...String(text || '')].forEach((ch) => {
      if (ch === '\n') { lines.push(line); line = ''; return; }
      if (line && x.measureText(line + ch).width > maxW) { lines.push(line); line = ch; } else line += ch;
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
    }
    return lines;
  };
  // Seeded jitter, so the same stamps land in the same places every time.
  const seeded = (seed) => {
    let s = seed % 2147483647 || 1;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  };

  // ---------- paper: warm stock, a fine grain, light from the top, a soft edge
  const grain = (x, dark) => {
    const [g, gx] = make(220, 220);
    const d = gx.createImageData(220, 220);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.random();
      d.data[i] = dark ? 255 : 70; d.data[i + 1] = dark ? 245 : 55; d.data[i + 2] = dark ? 230 : 30;
      d.data[i + 3] = v < 0.45 ? 0 : (v - 0.45) * (dark ? 24 : 46);
    }
    gx.putImageData(d, 0, 0);
    return x.createPattern(g, 'repeat');
  };
  const paper = (x, w, h, dark = false, tone = null) => {
    x.fillStyle = tone || (dark ? '#14130f' : '#f3eee4');
    x.fillRect(0, 0, w, h);
    const light = x.createRadialGradient(w / 2, -h * 0.1, 0, w / 2, -h * 0.1, h);
    light.addColorStop(0, dark ? 'rgba(255,240,215,.07)' : 'rgba(255,253,246,.85)');
    light.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = light; x.fillRect(0, 0, w, h);
    x.fillStyle = grain(x, dark); x.fillRect(0, 0, w, h);
    const edge = x.createRadialGradient(w / 2, h * 0.45, h * 0.4, w / 2, h * 0.45, h * 0.85);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, dark ? 'rgba(0,0,0,.4)' : 'rgba(110,80,30,.11)');
    x.fillStyle = edge; x.fillRect(0, 0, w, h);
  };

  // ---------- passport stamps: round or square, ink that did not quite take everywhere
  function arcText(x, text, radius, size, top) {
    x.save();
    x.font = `800 ${size}px ${SANS}`;
    const chars = [...String(text || '')];
    const widths = chars.map((c) => x.measureText(c).width + size * 0.14);
    const total = widths.reduce((a, b) => a + b, 0);
    let a = -(total / radius) / 2;
    chars.forEach((ch, i) => {
      const step = widths[i] / radius;
      const mid = a + step / 2;
      x.save();
      if (top) { x.rotate(mid); x.translate(0, -radius); } else { x.rotate(-mid); x.translate(0, radius); }
      x.fillText(ch, 0, 0);
      x.restore();
      a += step;
    });
    x.restore();
  }
  function stampCanvas(r, s) {
    const size = Math.ceil(r * 2.9);
    const [cv, x] = make(size, size);
    x.translate(size / 2, size / 2);
    x.strokeStyle = s.color; x.fillStyle = s.color;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (s.shape === 'rect') {
      const w = r * 2.5; const h = r * 1.55;
      rr(x, -w / 2, -h / 2, w, h, r * 0.16); x.lineWidth = r * 0.07; x.stroke();
      rr(x, -w / 2 + r * 0.13, -h / 2 + r * 0.13, w - r * 0.26, h - r * 0.26, r * 0.1); x.lineWidth = r * 0.025; x.stroke();
      x.font = `800 ${r * 0.19}px ${SANS}`; x.fillText(s.top || '', 0, -h / 2 + r * 0.37);
      fit(x, s.mid || '', 900, SERIF, r * 0.55, w - r * 0.55); x.fillText(s.mid || '', 0, r * 0.03);
      x.font = `800 ${r * 0.19}px ${SANS}`; x.fillText(s.bottom || '', 0, h / 2 - r * 0.35);
    } else {
      x.lineWidth = r * 0.075; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke();
      x.lineWidth = r * 0.028; x.beginPath(); x.arc(0, 0, r * 0.74, 0, Math.PI * 2); x.stroke();
      arcText(x, s.top || '', r * 0.87, r * 0.17, true);
      arcText(x, s.bottom || '', r * 0.87, r * 0.17, false);
      [-1, 1].forEach((side) => { x.beginPath(); x.arc(side * r * 0.87, 0, r * 0.045, 0, Math.PI * 2); x.fill(); });
      fit(x, s.mid || '', 900, SERIF, r * 0.48, r * 1.3); x.fillText(s.mid || '', 0, r * 0.03);
      x.fillRect(-r * 0.42, -r * 0.34, r * 0.84, r * 0.028);
      x.fillRect(-r * 0.42, r * 0.31, r * 0.84, r * 0.028);
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 320; i += 1) {
      x.globalAlpha = Math.random() * 0.75;
      x.beginPath();
      x.arc(Math.random() * size, Math.random() * size, Math.random() * r * 0.035 + 0.6, 0, Math.PI * 2);
      x.fill();
    }
    return cv;
  }
  const drawStamp = (x, cx, cy, r, s) => {
    const c = stampCanvas(r, s);
    x.save();
    x.translate(cx, cy);
    x.rotate(s.rot ?? -0.18);
    x.globalAlpha = s.alpha ?? 0.88;
    if (s.multiply) x.globalCompositeOperation = 'multiply';
    x.drawImage(c, -c.width / 2, -c.height / 2);
    x.restore();
  };
  const footer = (x, w, h, brand, dark = false) => {
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.fillStyle = dark ? 'rgba(255,255,255,.55)' : 'rgba(60,50,35,.55)';
    x.font = `700 26px ${SANS}`;
    x.fillText(`${brand}・記錄你的旅行足跡`, w / 2, h - 46);
  };

  // ---------- 1. postcard (4:5 feed post): the photo on a white mat, a stamp over the corner
  async function postcard(d) {
    await fontsReady(`${d.city}${d.place}${d.caption}${d.country}`);
    const W = 1080; const H = 1350;
    const [cv, x] = make(W, H);
    paper(x, W, H);
    x.save(); x.shadowColor = 'rgba(70,50,20,.22)'; x.shadowBlur = 40; x.shadowOffsetY = 14;
    x.fillStyle = '#fffdf8'; rr(x, 40, 40, W - 80, H - 80, 22); x.fill(); x.restore();
    const im = await firstImg([d.photo, d.fallbackPhoto]);
    x.save(); rr(x, 70, 70, W - 140, 870, 12); x.clip();
    if (im) coverDraw(x, im, 70, 70, W - 140, 870); else noPhoto(x, 70, 70, W - 140, 870);
    x.restore();
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#9a8f7d'; x.font = `800 26px ${SANS}`;
    x.fillText(`CHECK-IN${d.count ? `  No.${String(d.count).padStart(2, '0')}` : ''}`, 80, 1000);
    x.fillStyle = '#1d1b17'; fit(x, d.city, 900, SERIF, 88, 600); x.fillText(d.city, 76, 1088);
    let y = 1088;
    if (d.place) { y += 50; x.fillStyle = '#5a5246'; fit(x, d.place, 700, SANS, 34, 600); x.fillText(d.place, 80, y); }
    if (d.caption || d.mood) {
      y += 50;
      x.fillStyle = '#3a342b'; x.font = `600 32px ${SERIF}`;
      const text = [d.mood, d.caption].filter(Boolean).join('｜');
      x.fillText(`「${wrap(x, text, 600, 1)[0]}」`, 66, y);
    }
    const flag = await loadImg(d.flag);
    if (flag) { x.save(); rr(x, 80, 1236, 48, 32, 4); x.clip(); x.drawImage(flag, 80, 1236, 48, 32); x.restore(); }
    x.fillStyle = '#7a705f'; x.font = `700 28px ${SANS}`;
    x.fillText(`${d.country || ''}・${d.date || ''}`, flag ? 142 : 80, 1262);
    x.textAlign = 'right'; x.fillStyle = '#a39883'; x.font = `700 24px ${SANS}`;
    x.fillText(d.brand || '', W - 80, 1262);
    drawStamp(x, W - 225, 945, 125, {
      top: d.country || 'CHECK-IN', mid: d.city.slice(0, 5), bottom: d.date || '', color: d.ink || '#c8102e', rot: -0.22, alpha: 0.9,
    });
    return cv;
  }

  // ---------- 2. story (9:16): a taped polaroid on paper, the city big, a stamp over the corner
  async function story(d) {
    await fontsReady(`${d.city}${d.place}${d.caption}${d.name}`);
    const W = 1080; const H = 1920;
    const [cv, x] = make(W, H);
    paper(x, W, H);
    x.textAlign = 'left'; x.fillStyle = '#7a705f'; x.font = `700 34px ${SANS}`;
    x.fillText(`${d.name ? `${d.name} 的` : ''}旅行日記`, 90, 150);
    x.textAlign = 'right'; x.fillText(d.date || '', W - 90, 150);
    const im = await firstImg([d.photo, d.fallbackPhoto]);
    x.save();
    x.translate(540, 820); x.rotate(-0.035);
    x.shadowColor = 'rgba(60,40,10,.28)'; x.shadowBlur = 46; x.shadowOffsetY = 18;
    x.fillStyle = '#fffefb'; x.fillRect(-430, -560, 860, 1060);
    x.shadowColor = 'transparent';
    x.save(); x.beginPath(); x.rect(-395, -525, 790, 820); x.clip();
    if (im) coverDraw(x, im, -395, -525, 790, 820); else noPhoto(x, -395, -525, 790, 820);
    x.restore();
    x.fillStyle = '#3a342b'; x.textAlign = 'center'; x.font = `600 40px ${SERIF}`;
    const lines = wrap(x, d.caption || d.mood || d.place || d.city, 700, 2);
    lines.forEach((ln, i) => x.fillText(ln, 0, 375 + i * 54));
    x.fillStyle = 'rgba(235,222,190,.78)';
    [[-330, -560, -0.5], [330, -560, 0.5]].forEach(([tx, ty, rot]) => { x.save(); x.translate(tx, ty); x.rotate(rot); x.fillRect(-90, -24, 180, 48); x.restore(); });
    x.restore();
    x.textAlign = 'left'; x.fillStyle = '#1d1b17';
    fit(x, d.city, 900, SERIF, 150, 700); x.fillText(d.city, 90, 1555);
    x.fillStyle = '#5a5246'; x.font = `700 44px ${SANS}`;
    const flag = await loadImg(d.flag);
    if (flag) { x.save(); rr(x, 92, 1598, 60, 40, 5); x.clip(); x.drawImage(flag, 92, 1598, 60, 40); x.restore(); }
    x.fillText([d.country, d.place].filter(Boolean).join('・'), flag ? 168 : 92, 1634);
    if (d.mood) {
      x.font = `800 36px ${SANS}`;
      const w = x.measureText(d.mood).width + 56;
      x.fillStyle = '#1d1b17'; rr(x, 90, 1680, w, 66, 33); x.fill();
      x.fillStyle = '#fffaf0'; x.fillText(d.mood, 118, 1726);
    }
    drawStamp(x, 820, 1300, 150, {
      top: d.country || 'CHECK-IN', mid: d.city.slice(0, 5), bottom: d.date || '', color: d.ink || '#c8102e', rot: 0.2, alpha: 0.9,
    });
    footer(x, W, H, d.brand || '');
    return cv;
  }

  // ---------- 3. passport page: every check-in as a stamp
  async function passport(d) {
    const stamps = (d.stamps || []).slice(0, 12);
    await fontsReady(`${d.title}${d.subtitle}${stamps.map((s) => s.city + s.country).join('')}`);
    const W = 1080; const H = 1350;
    const [cv, x] = make(W, H);
    paper(x, W, H, false, '#eef0e6');
    x.strokeStyle = 'rgba(70,110,120,.09)'; x.lineWidth = 2;
    for (let row = 0; row < 40; row += 1) {
      x.beginPath();
      for (let px = 0; px <= W; px += 12) {
        const py = 40 + row * 34 + Math.sin(px / 60 + row) * 9;
        if (px) x.lineTo(px, py); else x.moveTo(px, py);
      }
      x.stroke();
    }
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#26413f'; x.font = `800 26px ${SANS}`;
    x.fillText('PASSPORT・VISAS', W / 2, 108);
    x.font = `900 60px ${SERIF}`; x.fillText(d.title || '入境紀錄', W / 2, 180);
    x.fillStyle = '#5f726f'; x.font = `700 28px ${SANS}`; x.fillText(d.subtitle || '', W / 2, 226);
    const rand = seeded(stamps.length * 7919 + 17);
    const cols = 3;
    stamps.forEach((s, i) => {
      const c = i % cols; const r = Math.floor(i / cols);
      const cx = 200 + c * 340 + (rand() - 0.5) * 60;
      const cy = 380 + r * 245 + (rand() - 0.5) * 40;
      drawStamp(x, cx, cy, 98 + rand() * 14, {
        shape: i % 3 === 1 ? 'rect' : 'circle', top: s.country || '', mid: (s.city || '').slice(0, 5), bottom: s.date || '',
        color: INKS[i % INKS.length], rot: (rand() - 0.5) * 0.7, alpha: 0.82, multiply: true,
      });
    });
    if (!stamps.length) { x.fillStyle = '#7d8b88'; x.font = `700 36px ${SANS}`; x.fillText('還沒有打卡，第一個印章等你蓋', W / 2, 640); }
    x.fillStyle = '#26413f'; x.font = `800 32px ${SANS}`;
    x.fillText(d.summary || '', W / 2, H - 110);
    footer(x, W, H, d.brand || '');
    return cv;
  }

  // ---------- 4. footprint map: the visited countries coloured, a line from home to each place
  let worldP = null;
  const world = () => {
    if (!worldP) {
      worldP = fetch('vendor/countries-110m.json').then((r) => r.json())
        .then((w) => topojson.feature(w, w.objects.countries).features).catch(() => { worldP = null; return []; });
    }
    return worldP;
  };
  async function footprint(d) {
    await fontsReady(`${d.title}${d.subtitle}${(d.stats || []).map((s) => s[1]).join('')}`);
    const W = 1080; const H = 1350;
    const [cv, x] = make(W, H);
    paper(x, W, H);
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#9a8f7d'; x.font = `800 26px ${SANS}`; x.fillText('MY FOOTPRINTS', 80, 120);
    x.fillStyle = '#1d1b17'; x.font = `900 76px ${SERIF}`; x.fillText(d.title || '我的旅行足跡', 76, 206);
    x.fillStyle = '#6b655a'; x.font = `700 30px ${SANS}`; x.fillText(d.subtitle || '', 80, 256);
    const features = typeof d3 !== 'undefined' && typeof topojson !== 'undefined' ? await world() : [];
    if (features.length) {
      const proj = d3.geoNaturalEarth1().fitExtent([[50, 300], [W - 50, 900]], { type: 'Sphere' });
      const path = d3.geoPath(proj, x);
      x.beginPath(); path({ type: 'Sphere' }); x.fillStyle = 'rgba(120,150,170,.08)'; x.fill();
      features.forEach((f) => {
        x.beginPath(); path(f);
        x.fillStyle = d.visited?.[f.id] || '#e3d9c6'; x.fill();
        x.strokeStyle = '#f3eee4'; x.lineWidth = 0.8; x.stroke();
      });
      x.setLineDash([7, 7]); x.lineWidth = 2.4; x.strokeStyle = 'rgba(20,99,255,.75)';
      (d.routes || []).forEach((r) => { x.beginPath(); path({ type: 'LineString', coordinates: [r.from, r.to] }); x.stroke(); });
      x.setLineDash([]);
      (d.routes || []).forEach((r) => {
        const p = proj(r.to);
        if (!p) return;
        x.beginPath(); x.arc(p[0], p[1], 7, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill();
        x.beginPath(); x.arc(p[0], p[1], 4.5, 0, Math.PI * 2); x.fillStyle = '#e03131'; x.fill();
      });
      if (d.home) {
        const p = proj(d.home);
        if (p) { x.beginPath(); x.arc(p[0], p[1], 9, 0, Math.PI * 2); x.fillStyle = '#1d1b17'; x.fill(); x.beginPath(); x.arc(p[0], p[1], 4, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill(); }
      }
    }
    const stats = (d.stats || []).slice(0, 4);
    const colW = (W - 160) / Math.max(1, stats.length);
    stats.forEach(([value, label], i) => {
      const cx = 80 + colW * i;
      x.textAlign = 'left'; x.fillStyle = '#1d1b17'; fit(x, String(value), 900, SERIF, 88, colW - 44); x.fillText(String(value), cx, 1060);
      x.fillStyle = '#6b655a'; x.font = `700 28px ${SANS}`; x.fillText(label, cx, 1106);
    });
    x.strokeStyle = 'rgba(60,50,35,.18)'; x.lineWidth = 2; x.beginPath(); x.moveTo(80, 960); x.lineTo(W - 80, 960); x.stroke();
    let lx = 80;
    (d.legend || []).forEach(([color, label]) => {
      x.fillStyle = color; rr(x, lx, 1160, 30, 22, 5); x.fill();
      x.fillStyle = '#5a5246'; x.font = `700 26px ${SANS}`; x.textAlign = 'left'; x.fillText(label, lx + 42, 1180);
      lx += 60 + x.measureText(label).width + 30;
    });
    footer(x, W, H, d.brand || '');
    return cv;
  }

  // ---------- 5. badge card: the medal drawn large, its line and where it was earned
  async function drawMedal(x, cx, cy, R, d) {
    const tail = (dx, rot) => {
      x.save(); x.translate(cx + dx, cy + R * 0.3); x.rotate(rot);
      const w = R * 0.42; const h = R * 1.05;
      x.beginPath(); x.moveTo(-w / 2, 0); x.lineTo(w / 2, 0); x.lineTo(w / 2, h); x.lineTo(0, h * 0.8); x.lineTo(-w / 2, h); x.closePath(); x.clip();
      x.fillStyle = d.m2; x.fillRect(-w / 2, 0, w, h);
      x.fillStyle = '#fff7e6'; x.fillRect(-w * 0.24, 0, w * 0.1, h); x.fillRect(w * 0.14, 0, w * 0.1, h);
      x.fillStyle = d.m1; x.fillRect(-w * 0.14, 0, w * 0.28, h);
      const sh = x.createLinearGradient(0, 0, 0, h); sh.addColorStop(0, 'rgba(0,0,0,.3)'); sh.addColorStop(0.4, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.18)');
      x.fillStyle = sh; x.fillRect(-w / 2, 0, w, h);
      x.restore();
    };
    tail(-R * 0.32, 0.42); tail(R * 0.32, -0.42);
    const circle = (r) => { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); };
    x.save(); x.shadowColor = 'rgba(80,50,10,.38)'; x.shadowBlur = R * 0.2; x.shadowOffsetY = R * 0.08; circle(R); x.fillStyle = '#c9932c'; x.fill(); x.restore();
    let rim;
    if (x.createConicGradient) {
      rim = x.createConicGradient(3.5, cx, cy);
      [[0, '#fff4c4'], [0.16, '#e3ad40'], [0.3, '#8c5c10'], [0.46, '#f2cd68'], [0.54, '#fff6cf'], [0.7, '#b9801f'], [0.82, '#6d4408'], [0.93, '#e7bb55'], [1, '#fff4c4']].forEach(([o, c]) => rim.addColorStop(o, c));
    } else {
      rim = x.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      rim.addColorStop(0, '#fff4c4'); rim.addColorStop(0.5, '#c48a22'); rim.addColorStop(1, '#fff0b0');
    }
    circle(R); x.fillStyle = rim; x.fill();
    x.save(); x.translate(cx, cy);
    for (let i = 0; i < 220; i += 1) {
      x.rotate((Math.PI * 2) / 220);
      x.fillStyle = i % 2 ? 'rgba(60,35,0,.22)' : 'rgba(255,255,255,.2)';
      x.fillRect(-R * 0.007, -R, R * 0.014, R * 0.075);
    }
    x.restore();
    const en = x.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    en.addColorStop(0, d.m1); en.addColorStop(1, d.m2);
    circle(R * 0.82); x.fillStyle = en; x.fill();
    x.lineWidth = R * 0.03; x.strokeStyle = 'rgba(0,0,0,.22)'; x.stroke();
    const pc = x.createRadialGradient(cx - R * 0.15, cy - R * 0.2, R * 0.05, cx, cy, R * 0.62);
    pc.addColorStop(0, '#fffefa'); pc.addColorStop(1, '#f1e6d0');
    circle(R * 0.6); x.fillStyle = pc; x.fill();
    x.lineWidth = R * 0.016; x.strokeStyle = 'rgba(80,50,10,.3)'; x.stroke();
    const pic = await svgImage(d.picSvg);
    if (pic) x.drawImage(pic, cx - R * 0.48, cy - R * 0.48, R * 0.96, R * 0.96);
    x.save(); circle(R * 0.82); x.clip();
    const gl = x.createLinearGradient(cx - R, cy - R, cx + R * 0.1, cy + R * 0.1);
    gl.addColorStop(0, 'rgba(255,255,255,.5)'); gl.addColorStop(0.55, 'rgba(255,255,255,0)');
    x.fillStyle = gl; x.fillRect(cx - R, cy - R, R * 2, R * 2);
    x.restore();
  }
  async function badge(d) {
    await fontsReady(`${d.name}${d.line}${d.sub}${d.progress}解鎖新徽章`);
    const W = 1080; const H = 1350;
    const [cv, x] = make(W, H);
    paper(x, W, H);
    const halo = x.createRadialGradient(540, 560, 60, 540, 560, 520);
    halo.addColorStop(0, 'rgba(255,214,120,.42)'); halo.addColorStop(1, 'rgba(255,214,120,0)');
    x.fillStyle = halo; x.fillRect(0, 0, W, H);
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#a3741a'; x.font = `800 30px ${SANS}`; x.fillText(d.kicker || '解鎖新徽章', W / 2, 150);
    await drawMedal(x, 540, 520, 250, d);
    x.fillStyle = '#1d1b17'; fit(x, d.name, 900, SERIF, 96, 900); x.fillText(d.name, W / 2, 1000);
    x.fillStyle = '#3a342b'; x.font = `600 40px ${SERIF}`;
    wrap(x, d.line ? `「${d.line}」` : '', 860, 2).forEach((ln, i) => x.fillText(ln, W / 2, 1075 + i * 56));
    x.fillStyle = '#6b655a'; x.font = `700 30px ${SANS}`; x.fillText(d.sub || '', W / 2, 1200);
    x.fillStyle = '#9a8f7d'; x.font = `700 26px ${SANS}`; x.fillText(d.progress || '', W / 2, 1246);
    footer(x, W, H, d.brand || '');
    return cv;
  }

  const toBlob = (cv, type = 'image/jpeg', quality = 0.9) => new Promise((resolve, reject) => {
    try { cv.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), type, quality); } catch (err) { reject(err); }
  });

  window.TravelStudio = {
    postcard, story, passport, footprint, badge, toBlob,
  };
}());
