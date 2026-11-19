/* 好孕島 — an original 2.5D isometric island drawn in SVG from code.
 * Tap a spot to learn, tick a checklist, take a mini quiz and collect a stamp.
 * Pan (drag), zoom (pinch / wheel / double-click), day/night, four seasons. */
(function () {
  const App = window.App = window.App || {};
  const D = App.ISLAND;
  if (!D || !App.ui) return;
  const { h, ui } = App;
  const sv = App.s;
  const C = window.Core;
  const store = App.store;

  const SC = 64; // svg units per world unit
  const C30 = Math.cos(Math.PI / 6);
  const R1 = (n) => Math.round(n * 10) / 10;
  const pad2 = (n) => String(n).padStart(2, '0');
  const SPOT = Object.fromEntries(D.SPOTS.map((s) => [s.id, s]));
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =========================================================
   * Materials -> generated CSS (day / night / seasons)
   * ========================================================= */
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const SEASON_LABEL = {
    spring: { label: '春季', icon: '🌸' }, summer: { label: '夏季', icon: '☀️' }, autumn: { label: '秋季', icon: '🍁' }, winter: { label: '冬季', icon: '❄️' },
  };
  const MATS = {
    sea: '#8fd0d4',
    sand: '#f1dcae',
    cliff: '#d4a06e',
    grass: { spring: '#a9dc8c', summer: '#8ccb6a', autumn: '#c3cd7c', winter: '#eef3f6' },
    trunk: '#8a5a3c',
    leafA: { spring: '#f6b3c6', summer: '#5fae5a', autumn: '#e8743b', winter: '#e8eff3' },
    leafB: { spring: '#9fd47c', summer: '#78c266', autumn: '#f2b23e', winter: '#d3e0e6' },
    leafC: { spring: '#fbd3e0', summer: '#4b9a55', autumn: '#d4532f', winter: '#ffffff' },
    pine: { spring: '#4f9a6a', summer: '#3d8a5a', autumn: '#5f8a50', winter: '#e4edf0' },
    flowerA: { spring: '#ff8fab', summer: '#ffd166', autumn: '#ef8354', winter: '#ffffff' },
    flowerB: { spring: '#ffe0ea', summer: '#f78fb3', autumn: '#f6bd60', winter: '#dbe7ec' },
    cream: '#f7eddc',
    white: '#fbfaf6',
    pink: '#f6cad1',
    blue: '#bfd9ef',
    lav: '#e6d6f2',
    mint: '#cdebd9',
    yellow: '#f6da8c',
    coral: '#f3a995',
    roofRed: '#e2725b',
    roofPurple: '#8b57a8',
    roofBlue: '#5e86c6',
    roofGreen: '#5aa06b',
    brand: '#5a2873',
    win: '#a9d2ea',
    door: '#a0714a',
    stone: '#ddd6cb',
    water: '#79cde0',
    wood: '#bd8655',
    red: '#e05a4f',
    green: '#3f9a5f',
    awnW: '#fffaf2',
    fruit: '#f28c38',
    gold: '#f6cf62',
    skin: '#f3c9a5',
    shirtA: '#e7809a',
    shirtB: '#6476d6',
    shirtC: '#f2b23e',
    shirtD: '#4fa77a',
    onesie: '#bfe0f7',
    balA: '#f28482',
    balB: '#f6bd60',
    balC: '#84a59d',
    chick: '#fffaf0',
    boat: '#f4efe4',
    asphalt: '#8f8b98',
    slideA: '#f08a7e',
    slideB: '#3f9fbf',
  };
  const NIGHT_OVERRIDE = {
    sea: '#1b3150',
    win: '#ffd36b',
    gold: '#fff0a6',
    water: '#3f86a8',
  };

  const hex2rgb = (hx) => { const n = parseInt(hx.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgb2hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => { const A = hex2rgb(a); const B = hex2rgb(b); return rgb2hex(...A.map((v, i) => v + (B[i] - v) * t)); };
  const shade = (c, t) => (t < 0 ? mix(c, '#000000', -t) : mix(c, '#ffffff', t));
  const night = (c) => mix(c, '#121c36', 0.56);

  function matRules(prefix, name, c, nightColor) {
    const tones = (base) => [base, shade(base, -0.07), shade(base, -0.2)];
    const [t, l, r] = tones(c);
    const isWin = name === 'win';
    const [nt, nl, nr] = isWin ? [nightColor, shade(nightColor, -0.03), shade(nightColor, -0.1)] : tones(nightColor);
    const row = (sel, cc) => `${sel}{fill:${cc};stroke:${cc}}`;
    return [
      row(`${prefix.day} .m-${name}-t`, t), row(`${prefix.day} .m-${name}-l`, l), row(`${prefix.day} .m-${name}-r`, r),
      row(`${prefix.night} .m-${name}-t`, nt), row(`${prefix.night} .m-${name}-l`, nl), row(`${prefix.night} .m-${name}-r`, nr),
    ].join('\n');
  }
  function buildCSS() {
    const out = [];
    Object.entries(MATS).forEach(([name, val]) => {
      if (typeof val === 'string') {
        out.push(matRules({ day: '.isl', night: '.isl.night' }, name, val, NIGHT_OVERRIDE[name] || night(val)));
      } else {
        SEASONS.forEach((s) => {
          out.push(matRules({ day: `.isl.s-${s}`, night: `.isl.night.s-${s}` }, name, val[s], night(val[s])));
        });
      }
    });
    return out.join('\n');
  }
  function injectCSS() {
    if (document.getElementById('isl-mats')) return;
    const st = document.createElement('style');
    st.id = 'isl-mats';
    st.textContent = buildCSS();
    document.head.appendChild(st);
  }

  /* =========================================================
   * Geometry
   * ========================================================= */
  const P = (x, y, z = 0) => [(x - y) * C30 * SC, (x + y) * 0.5 * SC - z * SC];
  const fromUV = (u, v) => [(u / C30 + 2 * v) / 2, (2 * v - u / C30) / 2];
  const ptsStr = (arr) => arr.map((p) => `${R1(p[0])},${R1(p[1])}`).join(' ');
  const poly2 = (g, pts, cls, extra) => g.appendChild(sv('polygon', { points: ptsStr(pts), class: cls, ...extra }));
  const poly3 = (g, pts3, cls, extra) => poly2(g, pts3.map((p) => P(p[0], p[1], p[2])), cls, extra);
  const hexPts = (cx, cy, z, r) => [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (Math.PI / 3) * i;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
  });
  function hull(points) {
    const p = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = []; const upper = [];
    p.forEach((pt) => { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); });
    for (let i = p.length - 1; i >= 0; i -= 1) {
      const pt = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
      upper.push(pt);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- primitives ---------- */
  function box(g, x0, y0, z0, w, d, hh, mat, o = {}) {
    const z1 = z0 + hh;
    poly3(g, [[x0, y0 + d, z0], [x0 + w, y0 + d, z0], [x0 + w, y0 + d, z1], [x0, y0 + d, z1]], `m-${mat}-l`);
    poly3(g, [[x0 + w, y0, z0], [x0 + w, y0 + d, z0], [x0 + w, y0 + d, z1], [x0 + w, y0, z1]], `m-${mat}-r`);
    if (!o.noTop) poly3(g, [[x0, y0, z1], [x0 + w, y0, z1], [x0 + w, y0 + d, z1], [x0, y0 + d, z1]], `m-${mat}-t`);
    const wz = z0 + hh * 0.42; const wh = hh * 0.3;
    const doorX = x0 + w / 2;
    if (o.winL) {
      const n = o.winL; const ww = Math.min(0.12, (w / n) * 0.42);
      for (let i = 0; i < n; i += 1) {
        const cx = x0 + ((i + 0.5) * w) / n;
        if (o.door && Math.abs(cx - doorX) < ww * 1.2) continue;
        poly3(g, [[cx - ww / 2, y0 + d, wz], [cx + ww / 2, y0 + d, wz], [cx + ww / 2, y0 + d, wz + wh], [cx - ww / 2, y0 + d, wz + wh]], 'm-win-l win');
      }
    }
    if (o.winR) {
      const n = o.winR; const ww = Math.min(0.12, (d / n) * 0.42);
      for (let i = 0; i < n; i += 1) {
        const cy = y0 + ((i + 0.5) * d) / n;
        poly3(g, [[x0 + w, cy - ww / 2, wz], [x0 + w, cy + ww / 2, wz], [x0 + w, cy + ww / 2, wz + wh], [x0 + w, cy - ww / 2, wz + wh]], 'm-win-r win');
      }
    }
    if (o.door) {
      const dw = o.bigDoor ? w * 0.38 : 0.13; const dh = hh * (o.bigDoor ? 0.62 : 0.5);
      poly3(g, [[doorX - dw / 2, y0 + d, z0], [doorX + dw / 2, y0 + d, z0], [doorX + dw / 2, y0 + d, z0 + dh], [doorX - dw / 2, y0 + d, z0 + dh]], 'm-door-l');
    }
  }
  function gable(g, x0, y0, z1, w, d, rh, mat, wall) {
    const zr = z1 + rh; const ym = y0 + d / 2; const ov = 0.05;
    poly3(g, [[x0 - ov, y0 - ov, z1], [x0 + w + ov, y0 - ov, z1], [x0 + w + ov, ym, zr], [x0 - ov, ym, zr]], `m-${mat}-r`);
    poly3(g, [[x0 + w, y0, z1], [x0 + w, y0 + d, z1], [x0 + w, ym, zr]], `m-${wall}-r`);
    poly3(g, [[x0 - ov, y0 + d + ov, z1], [x0 + w + ov, y0 + d + ov, z1], [x0 + w + ov, ym, zr], [x0 - ov, ym, zr]], `m-${mat}-t`);
    return P(x0 + w / 2, ym, zr);
  }
  function pyramid(g, x0, y0, z1, w, d, rh, mat) {
    const a = [x0 + w / 2, y0 + d / 2, z1 + rh]; const ov = 0.05;
    const c = [[x0 - ov, y0 - ov, z1], [x0 + w + ov, y0 - ov, z1], [x0 + w + ov, y0 + d + ov, z1], [x0 - ov, y0 + d + ov, z1]];
    poly3(g, [c[0], c[1], a], `m-${mat}-r`);
    poly3(g, [c[3], c[0], a], `m-${mat}-t`);
    poly3(g, [c[3], c[2], a], `m-${mat}-t`);
    poly3(g, [c[1], c[2], a], `m-${mat}-r`);
    return P(a[0], a[1], a[2]);
  }
  function awning(g, x0, x1, y, z, mat, n = 4) {
    const step = (x1 - x0) / n;
    for (let i = 0; i < n; i += 1) {
      const a = x0 + step * i; const b = a + step;
      poly3(g, [[a, y - 0.02, z + 0.1], [b, y - 0.02, z + 0.1], [b, y + 0.17, z], [a, y + 0.17, z]], i % 2 ? 'm-awnW-t' : `m-${mat}-t`);
    }
  }
  function tree(g, x, y, z, s, mat = 'leafA', kind = 'round') {
    const [bx, by] = P(x, y, z);
    const th = s * SC * 0.6; const tw = 0.03 * SC;
    poly2(g, [[bx - tw, by], [bx + tw, by], [bx + tw * 0.7, by - th], [bx - tw * 0.7, by - th]], 'm-trunk-r');
    if (kind === 'pine') {
      const H = s * SC * 2.5; const W = s * SC * 0.9; const b = by - th * 0.5;
      poly2(g, [[bx - W, b], [bx, b + W * 0.22], [bx, b - H]], `m-${mat}-t`);
      poly2(g, [[bx, b + W * 0.22], [bx + W, b], [bx, b - H]], `m-${mat}-r`);
      const b2 = b - H * 0.42; const W2 = W * 0.72;
      poly2(g, [[bx - W2, b2], [bx, b2 + W2 * 0.22], [bx, b - H]], `m-${mat}-t`);
      poly2(g, [[bx, b2 + W2 * 0.22], [bx + W2, b2], [bx, b - H]], `m-${mat}-r`);
      return [bx, b - H];
    }
    const r = s * SC; const cy = by - th - r * 0.75;
    const V = [[0, -1.1], [0.95, -0.45], [0.85, 0.6], [0, 1.0], [-0.85, 0.6], [-0.95, -0.45]].map(([a, b]) => [bx + a * r, cy + b * r]);
    const Cc = [bx + 0.1 * r, cy + 0.05 * r];
    poly2(g, [V[5], V[0], V[1], Cc], `m-${mat}-t`);
    poly2(g, [V[5], Cc, V[3], V[4]], `m-${mat}-l`);
    poly2(g, [V[1], V[2], V[3], Cc], `m-${mat}-r`);
    return [bx, cy, r];
  }

  /* sign symbols, drawn in a ~16x16 box centred on 0,0 */
  const SYMS = {
    heart: 'M0 5.5C-7 0.5 -6.5 -6 -2.6 -6C-1.1 -6 0 -5 0 -3.8C0 -5 1.1 -6 2.6 -6C6.5 -6 7 0.5 0 5.5Z',
    cross: 'M-2 -6.5h4v4.5h4.5v4h-4.5v4.5h-4v-4.5h-4.5v-4h4.5z',
    moon: 'M2.5 -6.5A6.6 6.6 0 1 0 6.6 2.4A5.2 5.2 0 0 1 2.5 -6.5Z',
    dumbbell: 'M-7.5 -2h1.5v-2.6h2.2v9.2h-2.2v-2.6h-1.5zM7.5 -2h-1.5v-2.6h-2.2v9.2h2.2v-2.6h1.5zM-3.8 -0.9h7.6v1.8h-7.6z',
    bag: 'M-5.8 -2.2h11.6l-1.1 8.7h-9.4zM-2.6 -2.2v-1.6a2.6 2.6 0 0 1 5.2 0v1.6h-1.5v-1.6a1.1 1.1 0 0 0 -2.2 0v1.6z',
    drop: 'M0 -6.8C2.6 -2.8 4.8 -0.2 4.8 2.2a4.8 4.8 0 0 1 -9.6 0C-4.8 -0.2 -2.6 -2.8 0 -6.8Z',
    cup: 'M-5.8 -3.4h9.4v4.6a4.7 4.7 0 0 1 -9.4 0zM3.6 -2.3h1.4a2.1 2.1 0 0 1 0 4.2h-1.4v-1.4h1.4a.7.7 0 0 0 0 -1.4h-1.4zM-6.3 5.8h10.4v1.4h-10.4z',
    shield: 'M0 -6.8l5.8 2.1v3.8c0 4.2 -2.6 6.8 -5.8 7.8c-3.2 -1 -5.8 -3.6 -5.8 -7.8v-3.8z',
    envelope: 'M-6.8 -4.6h13.6v9.2h-13.6z',
    star: 'M0 -7l2.1 4.3 4.7 .7 -3.4 3.3 .8 4.7L0 3.5l-4.2 2.5 .8 -4.7 -3.4 -3.3 4.7 -.7z',
    leaf: 'M-6 6C-6.5 -1.5 -1 -6.5 6.5 -6.5C6.5 1 1 6.5 -6 6Z',
    foot: 'M-3.6 -7a2.3 3.2 0 1 1 -.01 0zM-3.6 -.2a1.6 1.3 0 1 1 -.01 0zM3.6 -3.6a2.3 3.2 0 1 1 -.01 0zM3.6 3.2a1.6 1.3 0 1 1 -.01 0z',
    tooth: 'M-5.5 -5.5C-3.5 -7 -1.5 -6 0 -5.2C1.5 -6 3.5 -7 5.5 -5.5C7 -4 6 -.5 5 1.5C4.2 3.2 4 6.5 2.6 6.5C1.2 6.5 1.2 2.5 0 2.5C-1.2 2.5 -1.2 6.5 -2.6 6.5C-4 6.5 -4.2 3.2 -5 1.5C-6 -.5 -7 -4 -5.5 -5.5Z',
    book: 'M-7 -5C-4.5 -6 -2 -6 0 -4.5C2 -6 4.5 -6 7 -5V5.5C4.5 4.5 2 4.5 0 6C-2 4.5 -4.5 4.5 -7 5.5Z',
    sun: 'M0 -3.4a3.4 3.4 0 1 1 -.01 0zM-.8 -7.6h1.6v2.4h-1.6zM-.8 5.2h1.6v2.4h-1.6zM-7.6 -.8h2.4v1.6h-2.4zM5.2 -.8h2.4v1.6h-2.4z',
    eye: 'M-7.2 0C-4.6 -4.8 4.6 -4.8 7.2 0C4.6 4.8 -4.6 4.8 -7.2 0ZM0 -3a3 3 0 1 0 .01 0ZM0 -1.4a1.4 1.4 0 1 0 .01 0Z',
    spoon: 'M-1.2 -1.4C-3.8 -1.9 -4.2 -6.8 -1.4 -7.2C1.4 -7.6 1.6 -2.9 .6 -1.5L1.5 6.8H-.7Z',
    car: 'M-6.6 1.8V-1.2L-4.6 -4.6H4.6L6.6 -1.2V1.8ZM-4.2 1.6a1.9 1.9 0 1 0 .01 0ZM4.2 1.6a1.9 1.9 0 1 0 .01 0Z',
  };
  function sign(g, x, y, z, sym, color, pole = 0.3) {
    const [bx, by] = P(x, y, z);
    const pl = pole * SC; const r = 0.15 * SC;
    g.appendChild(sv('line', { x1: R1(bx), y1: R1(by), x2: R1(bx), y2: R1(by - pl), class: 'isl-pole' }));
    const cy = by - pl - r * 0.7;
    g.appendChild(sv('circle', { cx: R1(bx), cy: R1(cy), r: R1(r), class: 'isl-sign' }));
    if (sym === 'logo') {
      const href = (window.BRAND && window.BRAND.logo) || 'assets/logo.svg';
      g.appendChild(sv('image', { href, x: R1(bx - r * 0.72), y: R1(cy - r * 0.72), width: R1(r * 1.44), height: R1(r * 1.44) }));
    } else {
      const sc = (r / 9.5).toFixed(3);
      const sg = sv('g', { transform: `translate(${R1(bx)} ${R1(cy)}) scale(${sc})`, style: `color:${color}` });
      sg.appendChild(sv('path', { d: SYMS[sym] || SYMS.heart, class: 'isl-sym', 'fill-rule': 'evenodd' }));
      if (sym === 'envelope') sg.appendChild(sv('path', { d: 'M-6.8 -4.6L0 1L6.8 -4.6', class: 'isl-sym-line' }));
      g.appendChild(sg);
    }
    return [bx, cy - r];
  }

  /* =========================================================
   * 好孕群島 layout: one small cluster of hex tiles per island; the islands zig-zag down the sea in journey order.
   * Positions are in "screen units" (u right, v down); neighbouring slots touch, so bridges can join them.
   * ========================================================= */
  const ISLANDS = (D.ISLANDS && D.ISLANDS.length) ? D.ISLANDS : [{ id: 'all', no: 1, name: '好孕島', emoji: '🏝️', color: '#e7809a', range: '', unlock: { kind: 'always' }, spots: D.SPOTS.map((s) => s.id), notes: [], guide: { title: '', steps: [] } }];
  // 產檢日記島: not a stage of its own — a side island next to 孕中期島 that holds every prenatal visit, the
  // ultrasound photos and the sentences to the baby (screen 'diary')
  const DIARY = { id: 'diary', special: 'diary', no: '💌', name: '產檢日記島', nick: '回憶灣', emoji: '💌', color: '#e7809a', range: '每次產檢的回憶', unlock: { kind: 'preg', weeks: 0 }, spots: [], notes: [], guide: { title: '', steps: [] }, near: 'preg2' };
  const ISL = Object.fromEntries(ISLANDS.map((i) => [i.id, i]).concat([[DIARY.id, DIARY]]));
  const DECOR = { prep: 'garden', preg1: 'woods', preg2: 'garden', preg3: 'woods', newborn: 'harbor', infant: 'garden', crawl: 'woods', y1: 'garden', y2: 'woods', y3: 'garden', y4: 'harbor' };
  // 3 stops: a diamond with a decor tile behind; 4 stops: a full diamond with a decor tile on the outer side
  const shapeFor = (n, side) => (n >= 4
    ? { slots: [[-1.45, 0], [0, -1.45], [1.45, 0], [0, 1.45]], decor: [[2.9 * side, 1.45]], links: [[0, 1], [1, 2], [2, 3], [4, side > 0 ? 2 : 0]] }
    : n === 2
      ? { slots: [[-1.45, 0], [1.45, 0]], decor: [[0, -1.45]], links: [[0, 1], [2, 0]] }
      : { slots: [[-1.45, 0], [1.45, 0], [0, 1.45]], decor: [[0, -1.45]], links: [[0, 1], [1, 2], [3, 0]] });
  const ISLAND_GAP_V = 5.0; const ISLAND_U = 3.1;
  function makeWorld() {
    const r = rng(20261115);
    const tiles = []; const islands = [];
    ISLANDS.forEach((isl, k) => {
      const side = k % 2 ? 1 : -1;
      const cu = ISLANDS.length > 1 ? side * ISLAND_U : 0; const cv = k * ISLAND_GAP_V;
      const spots = isl.spots.map((id) => SPOT[id]).filter(Boolean);
      const shape = shapeFor(spots.length, side);
      const own = [];
      const mk = (key, u, v, spot) => {
        const ju = (r() - 0.5) * 0.2; const jv = (r() - 0.5) * 0.14;
        const [x, y] = fromUV(u + ju, v + jv);
        const decor = !spot;
        const z = decor ? 0.28 + r() * 0.16 : 0.36 + r() * 0.26;
        const t = {
          id: key, isl: isl.id, x, y, z, decor, spot, kind: decor ? DECOR[isl.id] || 'woods' : spot.kind, seed: Math.floor(r() * 1e6),
        };
        own.push(t); tiles.push(t);
      };
      spots.forEach((sp, j) => { const [u, v] = shape.slots[j] || [(j - 1) * 2.9, 2.9]; mk(sp.id, cu + u, cv + v, sp); });
      shape.decor.forEach(([u, v], j) => mk(`${isl.id}@${j}`, cu + u, cv + v, null));
      const links = shape.links.filter(([a, b]) => own[a] && own[b]).map(([a, b]) => [own[a], own[b]]);
      islands.push({ isl, k, side, cu, cv, tiles: own, links });
    });
    // the diary island sits beside 孕中期島, on the other side of the sea lane
    const nearI = islands.find((x) => x.isl.id === DIARY.near);
    if (nearI && ISLANDS.length > 1) {
      const cu = -nearI.side * 3.7; const cv = nearI.cv + 0.4;
      const own = [];
      [[-0.725, -0.725, 'studio'], [0.725, 0.725, 'memorytree']].forEach(([u, v, kind], j) => {
        const [x, y] = fromUV(cu + u, cv + v);
        const t = { id: `diary@${j}`, isl: DIARY.id, x, y, z: 0.42 + j * 0.06, decor: true, spot: null, kind, seed: 900 + j };
        own.push(t); tiles.push(t);
      });
      islands.push({ isl: DIARY, k: nearI.k + 0.5, side: -nearI.side, cu, cv, tiles: own, links: [[own[0], own[1]]], special: true });
    }
    return { tiles, islands };
  }

  /* =========================================================
   * Builders (one per kind). ctx: {g, x, y, z, r, add(depth, fn), anchor}
   * ========================================================= */
  function treesAt(c, list) {
    list.forEach(([dx, dy, s, mat, kind]) => c.add(dx + dy, () => tree(c.g, c.x + dx, c.y + dy, c.z, s, mat, kind)));
  }
  const B = {
    orchard(c) {
      const spots = [[-0.5, -0.32, 'leafB'], [0.18, -0.52, 'leafB'], [-0.58, 0.28, 'leafB'], [0.02, -0.02, 'leafB'], [0.52, 0.12, 'leafB'], [-0.1, 0.5, 'leafB']];
      spots.forEach(([dx, dy, mat]) => c.add(dx + dy, () => {
        const [bx, cy, r] = tree(c.g, c.x + dx, c.y + dy, c.z, 0.19, mat);
        [[-0.4, -0.1], [0.35, 0.2], [0.05, 0.45]].forEach(([fx, fy]) => c.g.appendChild(sv('circle', {
          cx: R1(bx + fx * r), cy: R1(cy + fy * r), r: 2.4, class: 'm-fruit-t',
        })));
      }));
      c.add(0.75, () => { box(c.g, c.x + 0.35, c.y + 0.42, c.z, 0.16, 0.12, 0.08, 'wood'); });
      c.anchor = P(c.x - 0.05, c.y - 0.12, c.z + 0.95);
    },
    gym(c) {
      c.add(-0.1, () => {
        box(c.g, c.x - 0.45, c.y - 0.45, c.z, 0.86, 0.6, 0.42, 'blue', { winL: 3, winR: 2, door: true });
        box(c.g, c.x - 0.48, c.y - 0.48, c.z + 0.42, 0.92, 0.66, 0.05, 'white');
        c.anchor = sign(c.g, c.x - 0.02, c.y - 0.15, c.z + 0.47, 'dumbbell', '#5e86c6', 0.14);
      });
      treesAt(c, [[0.58, 0.32, 0.17, 'leafA'], [-0.62, 0.4, 0.16, 'leafB'], [0.1, 0.55, 0.13, 'leafC']]);
    },
    checkup(c) {
      c.add(-0.1, () => {
        box(c.g, c.x - 0.42, c.y - 0.46, c.z, 0.78, 0.62, 0.52, 'white', { winL: 3, winR: 2, door: true });
        box(c.g, c.x - 0.18, c.y - 0.3, c.z + 0.52, 0.32, 0.3, 0.1, 'white');
        c.anchor = sign(c.g, c.x - 0.02, c.y - 0.15, c.z + 0.62, 'cross', '#2f9a6a', 0.12);
      });
      treesAt(c, [[0.55, 0.38, 0.16, 'leafB'], [-0.62, 0.34, 0.15, 'pine', 'pine']]);
    },
    house(c) {
      c.add(-0.1, () => {
        box(c.g, c.x - 0.36, c.y - 0.42, c.z, 0.62, 0.55, 0.36, 'cream', { winL: 2, winR: 1, door: true });
        const top = pyramid(c.g, c.x - 0.36, c.y - 0.42, c.z + 0.36, 0.62, 0.55, 0.36, 'roofPurple');
        c.anchor = [top[0], top[1] - 6];
      });
      c.add(0.5, () => { sign(c.g, c.x + 0.42, c.y + 0.08, c.z, 'moon', '#e8b53d', 0.34); });
      treesAt(c, [[-0.62, 0.28, 0.17, 'leafA'], [0.12, 0.56, 0.14, 'leafB'], [0.55, -0.42, 0.15, 'leafC']]);
    },
    clinic(c) {
      c.add(-0.1, () => {
        box(c.g, c.x - 0.46, c.y - 0.44, c.z, 0.9, 0.62, 0.46, 'pink', { winL: 4, winR: 2, door: true });
        gable(c.g, c.x - 0.46, c.y - 0.44, c.z + 0.46, 0.9, 0.62, 0.28, 'roofRed', 'pink');
        c.anchor = sign(c.g, c.x - 0.01, c.y - 0.13, c.z + 0.74, 'heart', '#e2725b', 0.1);
      });
      treesAt(c, [[0.6, 0.35, 0.16, 'leafA'], [-0.56, 0.45, 0.15, 'leafC']]);
    },
    market(c) {
      const stalls = [[-0.55, -0.38, 'red'], [0.12, -0.5, 'shirtC'], [-0.22, 0.12, 'green']];
      stalls.forEach(([dx, dy, mat]) => c.add(dx + dy, () => {
        const x0 = c.x + dx; const y0 = c.y + dy;
        box(c.g, x0, y0, c.z, 0.36, 0.26, 0.2, 'cream');
        awning(c.g, x0 - 0.02, x0 + 0.38, y0 + 0.26, c.z + 0.26, mat);
        ['fruit', 'red', 'green'].forEach((m, k) => {
          const [px, py] = P(x0 + 0.08 + k * 0.1, y0 + 0.22, c.z + 0.21);
          c.g.appendChild(sv('circle', { cx: R1(px), cy: R1(py), r: 2.6, class: `m-${m}-t` }));
        });
      }));
      treesAt(c, [[0.55, -0.12, 0.16, 'leafB'], [0.42, 0.45, 0.14, 'leafA']]);
      c.anchor = P(c.x - 0.12, c.y - 0.25, c.z + 0.8);
    },
    warehouse(c) {
      c.add(-0.1, () => {
        box(c.g, c.x - 0.5, c.y - 0.44, c.z, 0.92, 0.6, 0.4, 'yellow', { winR: 2, door: true, bigDoor: true });
        gable(c.g, c.x - 0.5, c.y - 0.44, c.z + 0.4, 0.92, 0.6, 0.24, 'roofBlue', 'yellow');
        c.anchor = sign(c.g, c.x - 0.04, c.y - 0.14, c.z + 0.64, 'bag', '#ef9b4b', 0.1);
      });
      c.add(0.7, () => {
        box(c.g, c.x + 0.28, c.y + 0.3, c.z, 0.16, 0.16, 0.14, 'wood');
        box(c.g, c.x + 0.48, c.y + 0.22, c.z, 0.14, 0.14, 0.12, 'wood');
        box(c.g, c.x + 0.32, c.y + 0.32, c.z + 0.14, 0.12, 0.12, 0.1, 'wood');
      });
      treesAt(c, [[-0.64, 0.36, 0.15, 'pine', 'pine']]);
    },
    lighthouse(c) {
      c.add(-0.05, () => {
        box(c.g, c.x - 0.28, c.y - 0.28, c.z, 0.5, 0.5, 0.12, 'white');
        const [bx, by] = P(c.x - 0.03, c.y - 0.03, c.z + 0.12);
        const Ht = 1.15 * SC; const wb = 0.2 * SC; const wt = 0.12 * SC;
        const n = 4;
        for (let i = 0; i < n; i += 1) {
          const y0 = by - (Ht * i) / n; const y1 = by - (Ht * (i + 1)) / n;
          const w0 = wb + ((wt - wb) * i) / n; const w1 = wb + ((wt - wb) * (i + 1)) / n;
          const mat = i % 2 ? 'white' : 'red';
          poly2(c.g, [[bx - w0, y0], [bx, y0 + w0 * 0.32], [bx, y1 + w1 * 0.32], [bx - w1, y1]], `m-${mat}-l`);
          poly2(c.g, [[bx, y0 + w0 * 0.32], [bx + w0, y0], [bx + w1, y1], [bx, y1 + w1 * 0.32]], `m-${mat}-r`);
        }
        const ty = by - Ht;
        c.g.appendChild(sv('ellipse', { cx: R1(bx), cy: R1(ty), rx: R1(wt * 1.6), ry: R1(wt * 0.55), class: 'm-red-r' }));
        c.g.appendChild(sv('rect', { x: R1(bx - wt * 0.9), y: R1(ty - 0.22 * SC), width: R1(wt * 1.8), height: R1(0.22 * SC), rx: 2, class: 'm-gold-t isl-lamp' }));
        c.g.appendChild(sv('path', { d: `M${R1(bx - wt * 1.05)} ${R1(ty - 0.22 * SC)} A${R1(wt * 1.05)} ${R1(wt * 0.95)} 0 0 1 ${R1(bx + wt * 1.05)} ${R1(ty - 0.22 * SC)} Z`, class: 'm-red-t' }));
        // night beam (swings slowly)
        const ly = ty - 0.11 * SC;
        const beamWrap = sv('g', { transform: `translate(${R1(bx)} ${R1(ly)})`, class: 'isl-beam-wrap' });
        const beam = sv('g', null,
          sv('polygon', { points: `0,0 ${R1(3.4 * SC)},${R1(-0.55 * SC)} ${R1(3.4 * SC)},${R1(0.55 * SC)}`, class: 'isl-beam', fill: 'url(#isl-beam-r)' }),
          sv('polygon', { points: `0,0 ${R1(-3.4 * SC)},${R1(-0.55 * SC)} ${R1(-3.4 * SC)},${R1(0.55 * SC)}`, class: 'isl-beam', fill: 'url(#isl-beam-l)' }));
        beam.appendChild(sv('animateTransform', {
          attributeName: 'transform', type: 'rotate', values: '-28;28;-28', dur: '9s', repeatCount: 'indefinite',
        }));
        beamWrap.appendChild(beam);
        c.g.appendChild(beamWrap);
        c.anchor = [bx, ty - 0.3 * SC];
      });
      treesAt(c, [[0.5, 0.4, 0.14, 'leafB'], [-0.6, 0.35, 0.14, 'leafA'], [0.55, -0.45, 0.13, 'pine', 'pine']]);
    },
    hotspring(c) {
      c.add(-0.7, () => {
        box(c.g, c.x + 0.02, c.y - 0.68, c.z, 0.42, 0.3, 0.24, 'cream', { winL: 1, door: true });
        pyramid(c.g, c.x + 0.02, c.y - 0.68, c.z + 0.24, 0.42, 0.3, 0.2, 'roofRed');
      });
      c.add(0, () => {
        const [px, py] = P(c.x - 0.12, c.y + 0.08, c.z + 0.005);
        const rr = 0.48;
        c.g.appendChild(sv('ellipse', { cx: R1(px), cy: R1(py), rx: R1(rr * 1.2247 * SC), ry: R1(rr * 0.7071 * SC), class: 'm-stone-t' }));
        c.g.appendChild(sv('ellipse', { cx: R1(px), cy: R1(py + 1), rx: R1(rr * 0.84 * 1.2247 * SC), ry: R1(rr * 0.84 * 0.7071 * SC), class: 'm-water-t isl-pool' }));
        [[-0.9, -0.2], [0.85, 0.15], [-0.2, 0.75]].forEach(([ax, ay]) => {
          const cx = px + ax * rr * 1.2247 * SC; const cy = py + ay * rr * 0.7071 * SC;
          poly2(c.g, [[cx - 6, cy + 2], [cx - 3, cy - 4], [cx + 4, cy - 3], [cx + 6, cy + 2], [cx, cy + 4]], 'm-stone-r');
        });
        [-14, 0, 14].forEach((ox, k) => c.g.appendChild(sv('path', {
          d: `M${R1(px + ox)} ${R1(py - 4)} q-4 -6 0 -12 q4 -6 0 -12`, class: 'isl-steam', style: `animation-delay:${-k * 1.1}s`,
        })));
      });
      c.add(0.6, () => { sign(c.g, c.x + 0.55, c.y + 0.12, c.z, 'drop', '#4aa3c7', 0.3); });
      treesAt(c, [[-0.66, -0.3, 0.15, 'leafA'], [0.62, -0.38, 0.13, 'leafC']]);
      c.anchor = P(c.x - 0.15, c.y - 0.3, c.z + 1.0);
    },
    brandshop(c) {
      c.add(-0.1, () => {
        box(c.g, c.x - 0.44, c.y - 0.46, c.z, 0.84, 0.6, 0.46, 'lav', { winL: 2, winR: 2, door: true });
        awning(c.g, c.x - 0.46, c.x + 0.42, c.y + 0.14, c.z + 0.3, 'brand', 6);
        gable(c.g, c.x - 0.44, c.y - 0.46, c.z + 0.46, 0.84, 0.6, 0.28, 'brand', 'lav');
        c.anchor = sign(c.g, c.x - 0.02, c.y - 0.16, c.z + 0.74, 'logo', '#5a2873', 0.14);
      });
      c.add(0.85, () => {
        // a little hen next to the shop
        const [bx, by] = P(c.x + 0.42, c.y + 0.42, c.z);
        c.g.appendChild(sv('ellipse', { cx: R1(bx), cy: R1(by - 5), rx: 7, ry: 5.6, class: 'm-chick-t' }));
        c.g.appendChild(sv('circle', { cx: R1(bx + 5.5), cy: R1(by - 11), r: 3.8, class: 'm-chick-t' }));
        c.g.appendChild(sv('circle', { cx: R1(bx + 5.5), cy: R1(by - 15.4), r: 1.8, class: 'm-red-t' }));
        poly2(c.g, [[bx + 9, by - 11.5], [bx + 12, by - 10.5], [bx + 9, by - 9.5]], 'm-shirtC-t');
        c.g.appendChild(sv('circle', { cx: R1(bx - 9), cy: R1(by - 2.6), r: 2.6, class: 'm-balB-t' }));
      });
      treesAt(c, [[-0.64, 0.34, 0.16, 'leafA'], [0.6, -0.36, 0.14, 'leafB']]);
    },
    cafe(c) {
      c.add(-0.1, () => {
        box(c.g, c.x - 0.44, c.y - 0.46, c.z, 0.8, 0.58, 0.42, 'mint', { winL: 3, winR: 2, door: true });
        awning(c.g, c.x - 0.46, c.x + 0.38, c.y + 0.12, c.z + 0.28, 'roofGreen', 6);
        const top = pyramid(c.g, c.x - 0.44, c.y - 0.46, c.z + 0.42, 0.8, 0.58, 0.18, 'roofGreen');
        c.anchor = sign(c.g, c.x - 0.04, c.y - 0.17, c.z + 0.6, 'cup', '#8a5a3c', 0.08);
        void top;
      });
      [[0.32, 0.42], [-0.22, 0.5]].forEach(([dx, dy]) => c.add(dx + dy, () => {
        const [bx, by] = P(c.x + dx, c.y + dy, c.z);
        c.g.appendChild(sv('line', { x1: R1(bx), y1: R1(by), x2: R1(bx), y2: R1(by - 9), class: 'isl-pole' }));
        c.g.appendChild(sv('ellipse', { cx: R1(bx), cy: R1(by - 9), rx: 7, ry: 3.6, class: 'm-white-t' }));
      }));
      treesAt(c, [[0.62, -0.25, 0.15, 'leafB']]);
    },
    vaccine(c) {
      c.add(-0.1, () => {
        box(c.g, c.x - 0.42, c.y - 0.46, c.z, 0.8, 0.6, 0.46, 'white', { winL: 3, winR: 2, door: true });
        box(c.g, c.x - 0.46, c.y - 0.5, c.z + 0.46, 0.88, 0.68, 0.06, 'roofBlue');
        c.anchor = sign(c.g, c.x - 0.02, c.y - 0.16, c.z + 0.52, 'shield', '#5e86c6', 0.14);
      });
      treesAt(c, [[0.56, 0.36, 0.16, 'leafB'], [-0.62, 0.4, 0.16, 'leafA'], [0.15, 0.6, 0.12, 'leafC']]);
    },
    forest(c) {
      treesAt(c, [
        [-0.5, -0.42, 0.17, 'pine', 'pine'], [0.12, -0.6, 0.16, 'pine', 'pine'], [0.55, -0.2, 0.17, 'pine', 'pine'],
        [-0.66, 0.18, 0.15, 'pine', 'pine'], [0.48, 0.42, 0.15, 'pine', 'pine'], [-0.25, 0.55, 0.14, 'pine', 'pine'], [0.62, 0.05, 0.12, 'leafB'],
      ]);
      c.add(0.0, () => {
        const x0 = c.x - 0.2; const y0 = c.y - 0.12; const w = 0.36; const d = 0.32; const th = 0.3;
        poly3(c.g, [[x0 + w / 2, y0, c.z + th], [x0 + w / 2, y0 + d, c.z + th], [x0 + w, y0 + d, c.z], [x0 + w, y0, c.z]], 'm-coral-r');
        poly3(c.g, [[x0, y0 + d, c.z], [x0 + w, y0 + d, c.z], [x0 + w / 2, y0 + d, c.z + th]], 'm-coral-t');
        poly3(c.g, [[x0 + w * 0.36, y0 + d, c.z], [x0 + w * 0.64, y0 + d, c.z], [x0 + w / 2, y0 + d, c.z + th * 0.55]], 'm-door-l');
        const [mx, my] = P(c.x, c.y, c.z + 1.15);
        c.g.appendChild(sv('path', { d: `M${R1(mx + 3)} ${R1(my - 10)}a10 10 0 1 0 8 13a8 8 0 0 1 -8 -13z`, class: 'isl-moonmark' }));
        c.g.appendChild(sv('path', { d: `M${R1(mx + 14)} ${R1(my - 14)}l1.4 3 3 .4 -2.2 2 .6 3 -2.8 -1.6 -2.8 1.6 .6 -3 -2.2 -2 3 -.4z`, class: 'isl-moonmark' }));
        c.anchor = [mx, my - 14];
      });
    },
    park(c) {
      c.add(-0.2, () => {
        const [bx, by] = P(c.x - 0.08, c.y - 0.18, c.z);
        const cy = by - 0.82 * SC; const rr = 0.56 * SC;
        c.g.appendChild(sv('path', { d: `M${R1(bx - 0.32 * SC)} ${R1(by)}L${R1(bx)} ${R1(cy)}L${R1(bx + 0.32 * SC)} ${R1(by)}`, class: 'isl-wheel-leg' }));
        const wrap = sv('g', { transform: `translate(${R1(bx)} ${R1(cy)})` });
        const wheel = sv('g');
        wheel.appendChild(sv('circle', { r: R1(rr), class: 'isl-wheel' }));
        let spokes = '';
        for (let i = 0; i < 8; i += 1) { const a = (Math.PI / 4) * i; spokes += `M0 0L${R1(Math.cos(a) * rr)} ${R1(Math.sin(a) * rr)}`; }
        wheel.appendChild(sv('path', { d: spokes, class: 'isl-wheel-spoke' }));
        const cab = ['shirtA', 'shirtC', 'shirtB', 'shirtD'];
        for (let i = 0; i < 8; i += 1) {
          const a = (Math.PI / 4) * i;
          wheel.appendChild(sv('circle', { cx: R1(Math.cos(a) * rr), cy: R1(Math.sin(a) * rr), r: 5, class: `m-${cab[i % 4]}-t` }));
        }
        wheel.appendChild(sv('animateTransform', {
          attributeName: 'transform', type: 'rotate', from: '0', to: '360', dur: '28s', repeatCount: 'indefinite',
        }));
        wrap.appendChild(wheel);
        wrap.appendChild(sv('circle', { r: 4, class: 'm-roofRed-t' }));
        c.g.appendChild(wrap);
        c.anchor = [bx, cy - rr - 8];
      });
      c.add(0.65, () => {
        box(c.g, c.x + 0.32, c.y + 0.26, c.z, 0.24, 0.2, 0.2, 'yellow', { winL: 1 });
        pyramid(c.g, c.x + 0.32, c.y + 0.26, c.z + 0.2, 0.24, 0.2, 0.16, 'roofRed');
      });
      treesAt(c, [[-0.64, 0.36, 0.15, 'leafA'], [0.62, -0.3, 0.14, 'leafC']]);
    },
    post(c) {
      c.add(-0.1, () => {
        box(c.g, c.x - 0.46, c.y - 0.46, c.z, 0.86, 0.6, 0.44, 'cream', { winL: 3, winR: 2, door: true });
        gable(c.g, c.x - 0.46, c.y - 0.46, c.z + 0.44, 0.86, 0.6, 0.24, 'roofGreen', 'cream');
        c.anchor = sign(c.g, c.x - 0.03, c.y - 0.16, c.z + 0.68, 'envelope', '#3f9a5f', 0.1);
      });
      c.add(0.72, () => {
        box(c.g, c.x + 0.36, c.y + 0.32, c.z, 0.11, 0.11, 0.22, 'green');
        box(c.g, c.x + 0.52, c.y + 0.3, c.z, 0.11, 0.11, 0.22, 'red');
      });
      treesAt(c, [[-0.62, 0.38, 0.16, 'leafB'], [0.6, -0.34, 0.14, 'leafA']]);
    },
    /* ----- 好孕群島: buildings for the new stops (spot.sym / spot.roof / spot.wall vary the look) ----- */
    cottage(c) {
      const sp = c.spot || {}; const wall = sp.wall || 'cream'; const roof = sp.roof || 'roofRed';
      c.add(-0.1, () => {
        box(c.g, c.x - 0.36, c.y - 0.42, c.z, 0.62, 0.52, 0.34, wall, { winL: 2, winR: 1, door: true });
        const top = gable(c.g, c.x - 0.36, c.y - 0.42, c.z + 0.34, 0.62, 0.52, 0.26, roof, wall);
        box(c.g, c.x + 0.1, c.y - 0.34, c.z + 0.42, 0.09, 0.09, 0.22, 'stone');
        const [sx, sy] = P(c.x + 0.145, c.y - 0.295, c.z + 0.66);
        c.g.appendChild(sv('path', { d: `M${R1(sx)} ${R1(sy)}q-4 -6 0 -11q4 -5 0 -10`, class: 'isl-steam' }));
        c.anchor = [top[0], top[1] - 6];
      });
      c.add(0.55, () => { sign(c.g, c.x + 0.44, c.y + 0.12, c.z, sp.sym || 'heart', sp.color || '#e2725b', 0.34); });
      treesAt(c, [[-0.62, 0.3, 0.16, 'leafA'], [0.1, 0.58, 0.13, 'leafB'], [0.56, -0.44, 0.15, 'leafC']]);
    },
    tower(c) {
      const sp = c.spot || {};
      c.add(-0.1, () => {
        box(c.g, c.x - 0.2, c.y - 0.22, c.z, 0.36, 0.36, 0.72, sp.wall || 'white', { winL: 1, winR: 1, door: true });
        box(c.g, c.x - 0.28, c.y - 0.3, c.z + 0.72, 0.52, 0.52, 0.06, 'wood');
        box(c.g, c.x - 0.16, c.y - 0.18, c.z + 0.78, 0.28, 0.28, 0.18, 'blue', { winL: 1, winR: 1 });
        const top = pyramid(c.g, c.x - 0.18, c.y - 0.2, c.z + 0.96, 0.32, 0.32, 0.22, sp.roof || 'roofBlue');
        c.anchor = [top[0], top[1] - 6];
      });
      c.add(0.5, () => { sign(c.g, c.x + 0.42, c.y + 0.18, c.z, sp.sym || 'star', '#e8b53d', 0.32); });
      treesAt(c, [[-0.58, 0.32, 0.15, 'pine', 'pine'], [0.5, -0.42, 0.16, 'leafB'], [-0.3, 0.58, 0.13, 'leafA']]);
    },
    pavilion(c) {
      const sp = c.spot || {};
      c.add(-0.1, () => {
        box(c.g, c.x - 0.42, c.y - 0.36, c.z, 0.78, 0.62, 0.05, 'wood');
        [[-0.4, -0.34], [0.3, -0.34], [-0.4, 0.2], [0.3, 0.2]].forEach(([dx, dy]) => box(c.g, c.x + dx, c.y + dy, c.z + 0.05, 0.05, 0.05, 0.34, 'white'));
        [['pink', -0.28], ['mint', 0.0], ['lav', -0.14]].forEach(([m, dx], k) => box(c.g, c.x + dx, c.y - 0.2 + k * 0.12, c.z + 0.05, 0.22, 0.08, 0.012, m));
        const top = pyramid(c.g, c.x - 0.44, c.y - 0.38, c.z + 0.39, 0.82, 0.66, 0.24, sp.roof || 'roofGreen');
        c.anchor = [top[0], top[1] - 6];
      });
      c.add(0.6, () => { sign(c.g, c.x + 0.5, c.y + 0.22, c.z, sp.sym || 'heart', '#e7809a', 0.3); });
      const r = rng(c.seed);
      for (let i = 0; i < 8; i += 1) {
        const a = r() * Math.PI * 2; const d = 0.55 + r() * 0.2; const dx = Math.cos(a) * d; const dy = Math.sin(a) * d;
        c.add(dx + dy, () => { const [px, py] = P(c.x + dx, c.y + dy, c.z); c.g.appendChild(sv('circle', { cx: R1(px), cy: R1(py - 2), r: 2.4, class: i % 2 ? 'm-flowerA-t' : 'm-flowerB-t' })); });
      }
      treesAt(c, [[-0.66, -0.3, 0.15, 'leafA']]);
    },
    playground(c) {
      const sp = c.spot || {};
      c.add(-0.3, () => {
        // slide: a little tower, a ladder and a chute
        box(c.g, c.x - 0.36, c.y - 0.36, c.z, 0.24, 0.24, 0.36, 'yellow');
        const top = pyramid(c.g, c.x - 0.36, c.y - 0.36, c.z + 0.36, 0.24, 0.24, 0.16, 'roofRed');
        poly3(c.g, [[c.x - 0.12, c.y - 0.34, c.z + 0.34], [c.x - 0.12, c.y - 0.16, c.z + 0.34], [c.x + 0.36, c.y - 0.16, c.z + 0.02], [c.x + 0.36, c.y - 0.34, c.z + 0.02]], 'm-slideA-t');
        poly3(c.g, [[c.x - 0.12, c.y - 0.16, c.z + 0.34], [c.x + 0.36, c.y - 0.16, c.z + 0.02], [c.x + 0.36, c.y - 0.16, c.z - 0.02], [c.x - 0.12, c.y - 0.16, c.z + 0.3]], 'm-slideA-l');
        c.anchor = [top[0], top[1] - 6];
      });
      c.add(0.3, () => {
        // swing: two A-frames and a seat
        const legs = [[-0.36, 0.12], [-0.36, 0.5], [0.04, 0.12], [0.04, 0.5]];
        let d = '';
        legs.forEach(([dx, dy]) => { const [a, b] = P(c.x + dx, c.y + dy, c.z); const [e, f] = P(c.x + dx, c.y + 0.31, c.z + 0.42); d += `M${R1(a)} ${R1(b)}L${R1(e)} ${R1(f)}`; });
        const [l1, l2] = P(c.x - 0.36, c.y + 0.31, c.z + 0.42); const [r1, r2] = P(c.x + 0.04, c.y + 0.31, c.z + 0.42);
        d += `M${R1(l1)} ${R1(l2)}L${R1(r1)} ${R1(r2)}`;
        const [s1, s2] = P(c.x - 0.16, c.y + 0.31, c.z + 0.42); const [t1, t2] = P(c.x - 0.16, c.y + 0.31, c.z + 0.12);
        d += `M${R1(s1 - 3)} ${R1(s2)}L${R1(t1 - 3)} ${R1(t2)}M${R1(s1 + 3)} ${R1(s2)}L${R1(t1 + 3)} ${R1(t2)}`;
        c.g.appendChild(sv('path', { d, class: 'isl-leg' }));
        c.g.appendChild(sv('rect', { x: R1(t1 - 5), y: R1(t2 - 1), width: 10, height: 3, rx: 1, class: 'm-slideB-t' }));
      });
      c.add(0.7, () => {
        box(c.g, c.x + 0.24, c.y + 0.26, c.z, 0.32, 0.26, 0.05, 'wood');
        box(c.g, c.x + 0.26, c.y + 0.28, c.z + 0.05, 0.28, 0.22, 0.005, 'yellow', { noTop: false });
        sign(c.g, c.x + 0.6, c.y - 0.1, c.z, sp.sym || 'sun', '#ef9b4b', 0.32);
      });
      treesAt(c, [[-0.66, 0.36, 0.15, 'leafB'], [0.58, -0.46, 0.15, 'leafA']]);
    },
    school(c) {
      const sp = c.spot || {}; const wall = sp.wall || 'yellow';
      c.add(-0.1, () => {
        box(c.g, c.x - 0.5, c.y - 0.44, c.z, 0.94, 0.56, 0.56, wall, { winL: 4, winR: 2, door: true, bigDoor: true });
        gable(c.g, c.x - 0.5, c.y - 0.44, c.z + 0.56, 0.94, 0.56, 0.24, sp.roof || 'roofRed', wall);
        const [cx, cy] = P(c.x - 0.03, c.y + 0.12, c.z + 0.66);
        c.g.appendChild(sv('circle', { cx: R1(cx), cy: R1(cy), r: 5.5, class: 'm-white-t isl-clock' }));
        c.g.appendChild(sv('path', { d: `M${R1(cx)} ${R1(cy)}v-3.6M${R1(cx)} ${R1(cy)}h2.6`, class: 'isl-hands' }));
        // flag
        const [fx, fy] = P(c.x + 0.62, c.y - 0.42, c.z);
        c.g.appendChild(sv('line', { x1: R1(fx), y1: R1(fy), x2: R1(fx), y2: R1(fy - 58), class: 'isl-pole' }));
        c.g.appendChild(sv('path', { d: `M${R1(fx)} ${R1(fy - 58)}l16 5 -16 5z`, class: 'isl-flag', style: `fill:${sp.color || '#e2725b'}` }));
        c.anchor = P(c.x - 0.03, c.y - 0.16, c.z + 1.02);
      });
      c.add(0.7, () => { sign(c.g, c.x + 0.4, c.y + 0.36, c.z, sp.sym || 'star', '#e8b53d', 0.26); });
      treesAt(c, [[-0.66, 0.34, 0.15, 'leafA'], [0.2, 0.6, 0.12, 'leafC']]);
    },
    library(c) {
      const sp = c.spot || {};
      c.add(-0.1, () => {
        box(c.g, c.x - 0.44, c.y - 0.42, c.z, 0.8, 0.56, 0.44, sp.wall || 'lav', { winL: 3, winR: 2, door: true });
        gable(c.g, c.x - 0.44, c.y - 0.42, c.z + 0.44, 0.8, 0.56, 0.3, sp.roof || 'roofPurple', sp.wall || 'lav');
        c.anchor = sign(c.g, c.x - 0.04, c.y - 0.14, c.z + 0.74, sp.sym || 'book', '#8b57a8', 0.1);
      });
      c.add(0.7, () => { box(c.g, c.x + 0.28, c.y + 0.36, c.z, 0.3, 0.1, 0.08, 'wood'); });
      treesAt(c, [[0.6, -0.3, 0.16, 'leafC'], [-0.62, 0.38, 0.15, 'leafB']]);
    },
    kitchen(c) {
      const sp = c.spot || {}; const wall = sp.wall || 'cream';
      c.add(-0.1, () => {
        box(c.g, c.x - 0.44, c.y - 0.44, c.z, 0.78, 0.5, 0.38, wall, { winL: 2, winR: 1, door: true });
        const top = gable(c.g, c.x - 0.44, c.y - 0.44, c.z + 0.38, 0.78, 0.5, 0.24, sp.roof || 'roofGreen', wall);
        awning(c.g, c.x - 0.44, c.x + 0.34, c.y + 0.06, c.z + 0.3, 'red', 5);
        box(c.g, c.x + 0.12, c.y - 0.36, c.z + 0.46, 0.08, 0.08, 0.2, 'stone');
        const [sx, sy] = P(c.x + 0.16, c.y - 0.32, c.z + 0.68);
        c.g.appendChild(sv('path', { d: `M${R1(sx)} ${R1(sy)}q-4 -6 0 -11q4 -5 0 -10`, class: 'isl-steam' }));
        c.anchor = [top[0], top[1] - 6];
      });
      c.add(0.75, () => {
        box(c.g, c.x + 0.16, c.y + 0.34, c.z, 0.34, 0.22, 0.14, 'wood');
        [[0.24, 0.42, 'fruit'], [0.38, 0.4, 'green']].forEach(([dx, dy, m]) => { const [px, py] = P(c.x + dx, c.y + dy, c.z + 0.15); c.g.appendChild(sv('ellipse', { cx: R1(px), cy: R1(py), rx: 4, ry: 2.2, class: `m-${m}-t` })); });
        sign(c.g, c.x - 0.5, c.y + 0.4, c.z, sp.sym || 'spoon', '#4fa77a', 0.3);
      });
      treesAt(c, [[0.62, -0.4, 0.15, 'leafB']]);
    },
    dentist(c) {
      const sp = c.spot || {};
      c.add(-0.1, () => {
        box(c.g, c.x - 0.44, c.y - 0.44, c.z, 0.84, 0.6, 0.44, sp.wall || 'white', { winL: 3, winR: 2, door: true });
        gable(c.g, c.x - 0.44, c.y - 0.44, c.z + 0.44, 0.84, 0.6, 0.24, sp.roof || 'roofBlue', sp.wall || 'white');
        c.anchor = sign(c.g, c.x - 0.02, c.y - 0.14, c.z + 0.68, sp.sym || 'tooth', '#3f9fbf', 0.1);
      });
      treesAt(c, [[0.6, 0.36, 0.16, 'leafA'], [-0.6, 0.42, 0.15, 'leafB'], [0.16, 0.62, 0.12, 'leafC']]);
    },
    road(c) {
      const sp = c.spot || {};
      c.add(-1, () => {
        // a road across the tile with a zebra crossing
        poly3(c.g, [[c.x - 0.78, c.y - 0.16, c.z + 0.005], [c.x + 0.78, c.y - 0.16, c.z + 0.005], [c.x + 0.78, c.y + 0.16, c.z + 0.005], [c.x - 0.78, c.y + 0.16, c.z + 0.005]], 'm-asphalt-t');
        for (let i = 0; i < 4; i += 1) {
          const x0 = c.x - 0.18 + i * 0.1;
          poly3(c.g, [[x0, c.y - 0.15, c.z + 0.01], [x0 + 0.05, c.y - 0.15, c.z + 0.01], [x0 + 0.05, c.y + 0.15, c.z + 0.01], [x0, c.y + 0.15, c.z + 0.01]], 'm-white-t');
        }
      });
      c.add(-0.5, () => {
        box(c.g, c.x - 0.5, c.y - 0.62, c.z, 0.5, 0.36, 0.34, sp.wall || 'coral', { winL: 2, door: true });
        pyramid(c.g, c.x - 0.5, c.y - 0.62, c.z + 0.34, 0.5, 0.36, 0.2, 'roofBlue');
      });
      c.add(0.1, () => {
        // traffic light
        const [bx, by] = P(c.x + 0.36, c.y - 0.26, c.z);
        c.g.appendChild(sv('line', { x1: R1(bx), y1: R1(by), x2: R1(bx), y2: R1(by - 40), class: 'isl-pole' }));
        c.g.appendChild(sv('rect', { x: R1(bx - 4.5), y: R1(by - 58), width: 9, height: 20, rx: 2.5, class: 'isl-tlight' }));
        ['#e05a4f', '#f6cf62', '#3f9a5f'].forEach((col, k) => c.g.appendChild(sv('circle', { cx: R1(bx), cy: R1(by - 53 + k * 5.5), r: 2.1, style: `fill:${col};stroke:none` })));
        c.anchor = [bx, by - 62];
      });
      c.add(0.4, () => {
        // a little car waiting at the line
        box(c.g, c.x + 0.42, c.y - 0.1, c.z + 0.01, 0.26, 0.16, 0.08, 'red');
        box(c.g, c.x + 0.47, c.y - 0.08, c.z + 0.09, 0.14, 0.12, 0.06, 'win');
      });
      c.add(0.8, () => { sign(c.g, c.x - 0.36, c.y + 0.46, c.z, sp.sym || 'car', '#e2725b', 0.3); });
      treesAt(c, [[-0.66, 0.42, 0.14, 'leafB'], [0.5, 0.5, 0.14, 'leafA']]);
    },
    /* ----- 產檢日記島 ----- */
    studio(c) {
      c.add(-0.1, () => {
        box(c.g, c.x - 0.42, c.y - 0.44, c.z, 0.78, 0.56, 0.44, 'pink', { winL: 2, winR: 1, door: true });
        const top = gable(c.g, c.x - 0.42, c.y - 0.44, c.z + 0.44, 0.78, 0.56, 0.28, 'roofPurple', 'pink');
        // little polaroids on the wall
        [[-0.3, 0.05], [0.12, 0.08]].forEach(([dx, dz]) => {
          const [px, py] = P(c.x + dx, c.y + 0.12, c.z + 0.2 + dz);
          c.g.appendChild(sv('rect', { x: R1(px - 5), y: R1(py - 6), width: 10, height: 12, rx: 1, class: 'm-white-t isl-polaroid' }));
          c.g.appendChild(sv('rect', { x: R1(px - 3.5), y: R1(py - 4.5), width: 7, height: 6, class: 'm-blue-t' }));
        });
        c.anchor = [top[0], top[1] - 6];
      });
      c.add(0.6, () => { sign(c.g, c.x + 0.46, c.y + 0.2, c.z, 'heart', '#e7809a', 0.34); });
      treesAt(c, [[-0.62, 0.36, 0.15, 'leafC'], [0.5, -0.46, 0.14, 'leafA']]);
    },
    memorytree(c) {
      c.add(0, () => {
        const [bx, cy, r] = tree(c.g, c.x, c.y, c.z, 0.34, 'leafA');
        // hearts hanging in the tree: one for every sentence to the baby
        [[-0.55, -0.1], [0.4, -0.35], [0.1, 0.25], [-0.2, -0.55], [0.6, 0.15]].forEach(([fx, fy]) => {
          const hx = bx + fx * r; const hy = cy + fy * r;
          c.g.appendChild(sv('path', { d: `M${R1(hx)} ${R1(hy + 3)}c-5 -3.5 -4.6 -8 -1.8 -8c1 0 1.8 .7 1.8 1.6c0 -.9 .8 -1.6 1.8 -1.6c2.8 0 3.2 4.5 -1.8 8z`, class: 'isl-heartfruit' }));
        });
      });
      c.add(0.6, () => { box(c.g, c.x + 0.3, c.y + 0.32, c.z, 0.3, 0.1, 0.07, 'wood'); });
      c.add(0.7, () => { sign(c.g, c.x - 0.45, c.y + 0.38, c.z, 'envelope', '#e7809a', 0.3); });
    },
    /* ----- decor tiles ----- */
    garden(c) {
      const r = rng(c.seed);
      for (let i = 0; i < 12; i += 1) {
        const a = r() * Math.PI * 2; const d = 0.25 + r() * 0.5;
        const dx = Math.cos(a) * d; const dy = Math.sin(a) * d;
        c.add(dx + dy, () => {
          const [px, py] = P(c.x + dx, c.y + dy, c.z);
          c.g.appendChild(sv('circle', { cx: R1(px), cy: R1(py - 2), r: 2.6, class: i % 2 ? 'm-flowerA-t' : 'm-flowerB-t' }));
        });
      }
      treesAt(c, [[-0.55, -0.4, 0.17, 'leafA'], [0.55, -0.35, 0.15, 'leafC']]);
      c.add(-2, () => {
        // shadow of the balloon
        const [sx, sy] = P(c.x + 0.05, c.y - 0.05, c.z);
        c.g.appendChild(sv('ellipse', { cx: R1(sx), cy: R1(sy), rx: 16, ry: 7, class: 'isl-shadow' }));
      });
      c.balloon = P(c.x + 0.05, c.y - 0.05, c.z + 2.1);
      c.babyPath = [P(c.x + 0.1, c.y + 0.2, c.z), P(c.x + 0.56, c.y + 0.04, c.z)];
    },
    woods(c) {
      treesAt(c, [
        [-0.5, -0.35, 0.18, 'leafA'], [0.15, -0.55, 0.16, 'leafB'], [0.52, -0.08, 0.17, 'leafC'], [-0.62, 0.25, 0.16, 'leafB'],
        [0.05, 0.05, 0.19, 'leafA'], [0.4, 0.45, 0.14, 'pine', 'pine'], [-0.2, 0.52, 0.14, 'pine', 'pine'],
      ]);
    },
    harbor(c) {
      c.add(-0.6, () => {
        box(c.g, c.x - 0.38, c.y - 0.5, c.z, 0.42, 0.34, 0.28, 'white', { winL: 1, door: true });
        gable(c.g, c.x - 0.38, c.y - 0.5, c.z + 0.28, 0.42, 0.34, 0.18, 'roofBlue', 'white');
      });
      c.add(1.5, () => {
        // dock planks going out to sea
        const z = 0.16; const x0 = c.x + 0.8; const x1 = c.x + 1.75; const ya = c.y - 0.12; const yb = c.y + 0.12;
        poly3(c.g, [[x0, yb, z], [x1, yb, z], [x1, yb, z - 0.05], [x0, yb, z - 0.05]], 'm-wood-r');
        poly3(c.g, [[x1, ya, z], [x1, yb, z], [x1, yb, z - 0.05], [x1, ya, z - 0.05]], 'm-wood-r');
        poly3(c.g, [[x0, ya, z], [x1, ya, z], [x1, yb, z], [x0, yb, z]], 'm-wood-t');
        let legs = '';
        [x0 + 0.3, x0 + 0.65, x1 - 0.02].forEach((lx) => {
          const [a1, b1] = P(lx, yb, z - 0.05); const [, b2] = P(lx, yb, -0.05);
          legs += `M${R1(a1)} ${R1(b1)}L${R1(a1)} ${R1(b2)}`;
        });
        c.g.appendChild(sv('path', { d: legs, class: 'isl-leg' }));
      });
      treesAt(c, [[0.35, -0.35, 0.15, 'leafB'], [-0.55, 0.3, 0.16, 'leafA'], [0.15, 0.45, 0.13, 'leafC']]);
      c.boat = P(c.x + 1.45, c.y + 0.55, 0);
    },
  };

  /* ---------- bridge between two tiles ---------- */
  function bridgePts(A, B) {
    const dx = B.x - A.x; const dy = B.y - A.y; const len = Math.hypot(dx, dy);
    const ux = dx / len; const uy = dy / len;
    const s = [A.x + ux * 0.84, A.y + uy * 0.84, A.z];
    const e = [B.x - ux * 0.84, B.y - uy * 0.84, B.z];
    return { ux, uy, s, e, inA: [A.x + ux * 0.4, A.y + uy * 0.4, A.z], inB: [B.x - ux * 0.4, B.y - uy * 0.4, B.z] };
  }
  function drawBridge(g, A, B) {
    const { ux, uy, s, e } = bridgePts(A, B);
    const nx = -uy * 0.12; const ny = ux * 0.12;
    const N = 6; const left = []; const right = []; const leftLow = [];
    const sideSign = (nx + ny) > 0 ? 1 : -1; // which edge faces the viewer
    for (let i = 0; i <= N; i += 1) {
      const t = i / N; const arch = Math.sin(Math.PI * t) * 0.1;
      const x = s[0] + (e[0] - s[0]) * t; const y = s[1] + (e[1] - s[1]) * t; const z = s[2] + (e[2] - s[2]) * t + arch;
      left.push([x + nx, y + ny, z]); right.push([x - nx, y - ny, z]);
      leftLow.push(sideSign > 0 ? [x + nx, y + ny, z - 0.05] : [x - nx, y - ny, z - 0.05]);
    }
    const front = sideSign > 0 ? left : right;
    poly3(g, front.concat(leftLow.slice().reverse()), 'm-wood-r');
    poly3(g, left.concat(right.slice().reverse()), 'm-wood-t');
    // planks + rails
    let dPl = ''; let dRail = '';
    for (let i = 1; i < N; i += 1) {
      const a = P(...left[i]); const b = P(...right[i]);
      dPl += `M${R1(a[0])} ${R1(a[1])}L${R1(b[0])} ${R1(b[1])}`;
    }
    [left, right].forEach((edge) => {
      edge.forEach((p, i) => {
        const top = P(p[0], p[1], p[2] + 0.1); const bot = P(...p);
        dRail += `${i ? 'L' : 'M'}${R1(top[0])} ${R1(top[1])}`;
        void bot;
      });
      edge.forEach((p, i) => {
        if (i % 2) return;
        const top = P(p[0], p[1], p[2] + 0.1); const bot = P(...p);
        dRail += `M${R1(top[0])} ${R1(top[1])}L${R1(bot[0])} ${R1(bot[1])}`;
      });
    });
    g.appendChild(sv('path', { d: dPl, class: 'isl-plank' }));
    g.appendChild(sv('path', { d: dRail, class: 'isl-rail' }));
  }

  /* =========================================================
   * Unlock: an island opens by itself when the pregnancy week or the baby's age reaches it
   * ========================================================= */
  const ageLabel = (m) => (m === 0 ? '出生' : m % 12 === 0 ? `${m / 12} 歲` : `${m} 個月`);
  function pregInfo() {
    const lmp = App.preg && App.preg.pregLmp ? App.preg.pregLmp() : '';
    return lmp ? { lmp, ga: C.gestAge(lmp) } : null;
  }
  // the oldest baby who has been born (twins and siblings: the islands follow whoever got there first)
  function oldestBaby() {
    const now = new Date();
    return (store.state.babies || []).filter((b) => b && b.birthday && C.diffDays(b.birthday, now) >= 0)
      .sort((a, b) => (a.birthday < b.birthday ? -1 : 1))[0] || null;
  }
  // { open, opensAt (Date|null), why (short text for a locked island), reason (what opened it) }
  function statusOf(isl) {
    const u = isl.unlock || { kind: 'always' };
    const stage = store.stage;
    if (u.kind === 'always') return { open: true, reason: '' };
    if (u.kind === 'preg') {
      const born = !!oldestBaby();
      const pregnant = stage === 'preg' || !!store.state.profile.pregnantToo;
      const pi = pregnant ? pregInfo() : null;
      if (stage === 'baby' && born) return { open: true, reason: '' };
      if (pregnant && pi && pi.ga.totalDays >= u.weeks * 7) return { open: true, reason: u.weeks ? `懷孕滿 ${u.weeks} 週了！` : '恭喜懷孕！' };
      if (pregnant && !pi && !u.weeks) return { open: true, reason: '恭喜懷孕！' };
      if (pregnant && pi) {
        const at = C.addDays(pi.lmp, u.weeks * 7);
        return { open: false, opensAt: at, why: `懷孕 ${u.weeks} 週開放` };
      }
      return { open: false, opensAt: null, why: '懷孕後開放' };
    }
    if (u.kind === 'baby') {
      const b = oldestBaby();
      const label = ageLabel(u.months);
      if (b) {
        const at = u.months ? C.addMonths(b.birthday, u.months) : C.parseKey(b.birthday);
        if (C.diffDays(at, new Date()) >= 0) return { open: true, reason: u.months ? `${b.name || '寶寶'} 滿 ${label}了！` : `${b.name || '寶寶'} 出生了！` };
        return { open: false, opensAt: at, why: `寶寶 ${label}開放` };
      }
      return { open: false, opensAt: null, why: u.months ? `寶寶 ${label}開放` : '寶寶出生後開放' };
    }
    return { open: true, reason: '' };
  }
  const isOpen = (isl) => !!(isl && statusOf(isl).open);
  const openIslands = () => ISLANDS.filter((i) => statusOf(i).open);
  // where the family is now: the last island that has opened
  function hereIsland() { const o = openIslands(); return o[o.length - 1] || ISLANDS[0]; }
  function countdown(st) {
    if (!st.opensAt) return '';
    const d = C.diffDays(new Date(), st.opensAt);
    return d > 0 ? `還有 ${d} 天` : '';
  }
  const lockText = (st) => `${st.why}${countdown(st) ? `（${countdown(st)}）` : ''}`;
  const islandSpots = (isl) => isl.spots.map((id) => SPOT[id]).filter(Boolean);

  /* =========================================================
   * Scene
   * ========================================================= */
  const ST = { night: null, season: null, view: null, size: null };
  function defaultSeason() {
    const m = new Date().getMonth() + 1;
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    if (m >= 9 && m <= 11) return 'autumn';
    return 'winter';
  }
  function defaultNight() { const hr = new Date().getHours(); return hr >= 18 || hr < 6; }

  // lightweight stand-in for a building still under the clouds
  function mysteryTile(c) {
    treesAt(c, [[-0.36, -0.2, 0.16, 'pine', 'pine'], [0.3, -0.34, 0.15, 'leafB'], [0.1, 0.32, 0.15, 'pine', 'pine']]);
  }

  function buildScene(world, { lifting = new Set(), here = null } = {}) {
    const root = sv('g', { class: 'isl-world' });
    const waves = sv('g', { class: 'isl-waves' });
    const foams = sv('g', { class: 'isl-foams' });
    const routes = sv('g', { class: 'isl-routes' });
    const scene = sv('g', { class: 'isl-scene' });
    const fogs = sv('g', { class: 'isl-fogs' });
    const people = sv('g', { class: 'isl-people' });
    const banners = sv('g', { class: 'isl-banners' });
    const labels = sv('g', { class: 'isl-labels' });
    root.append(waves, foams, routes, scene, fogs, people, banners, labels);
    const openMap = Object.fromEntries(world.islands.map((wi) => [wi.isl.id, isOpen(wi.isl)]));

    // waves scattered on the sea, away from the islands
    const r = rng(7);
    const vMax = (world.islands.length - 1) * ISLAND_GAP_V;
    for (let i = 0; i < 26 + world.islands.length * 6; i += 1) {
      const u = -7.5 + r() * 15; const v = -3 + r() * (vMax + 6);
      if (world.tiles.some((t) => { const [tu, tv] = P(t.x, t.y, 0); return Math.abs(tu / SC - u) < 1.6 && Math.abs(tv / SC - v) < 1.0; })) continue;
      waves.appendChild(sv('path', {
        d: `M${R1(u * SC)} ${R1(v * SC)}q5 -4 10 0q5 -4 10 0`, class: 'isl-wave', style: `animation-delay:${R1(-r() * 6)}s`,
      }));
    }

    // sea lanes between islands: dashed, a little boat sails from where you are to the next island
    const routePaths = [];
    const lane = world.islands.filter((x) => !x.special);
    for (let k = 0; k + 1 < lane.length; k += 1) {
      const A = lane[k]; const Bi = lane[k + 1];
      const cB = P(...fromUV(Bi.cu, Bi.cv), 0); const cA = P(...fromUV(A.cu, A.cv), 0);
      const near = (list, to) => list.slice().sort((a, b) => Math.hypot(P(a.x, a.y, 0)[0] - to[0], P(a.x, a.y, 0)[1] - to[1]) - Math.hypot(P(b.x, b.y, 0)[0] - to[0], P(b.x, b.y, 0)[1] - to[1]))[0];
      const ta = near(A.tiles, cB); const tb = near(Bi.tiles, cA);
      const [ax, ay] = P(ta.x, ta.y, 0); const [bx, by] = P(tb.x, tb.y, 0);
      const pull = (x0, y0, x1, y1, d) => { const L = Math.hypot(x1 - x0, y1 - y0) || 1; return [x0 + ((x1 - x0) / L) * d, y0 + ((y1 - y0) / L) * d]; };
      const [sx, sy] = pull(ax, ay, bx, by, 62); const [ex, ey] = pull(bx, by, ax, ay, 62);
      const mx = (sx + ex) / 2 + (A.side > 0 ? 40 : -40); const my = (sy + ey) / 2;
      const d = `M${R1(sx)} ${R1(sy)}Q${R1(mx)} ${R1(my)} ${R1(ex)} ${R1(ey)}`;
      const toOpen = openMap[Bi.isl.id];
      routes.appendChild(sv('path', { d, class: `isl-route${toOpen ? ' open' : ''}` }));
      routePaths.push({ from: A.isl.id, to: Bi.isl.id, d });
    }
    // a soft glowing ring under the island you are on
    if (here) {
      const wi = world.islands.find((x) => x.isl.id === here);
      if (wi) {
        const [hx, hy] = P(...fromUV(wi.cu, wi.cv), 0);
        routes.appendChild(sv('ellipse', { cx: R1(hx), cy: R1(hy + 8), rx: 190, ry: 112, class: 'isl-here-ring' }));
      }
    }

    // each island in its own group (they never overlap); inside, painter's algorithm by depth
    const infos = {}; const islandGroups = {};
    world.islands.forEach((wi) => {
      const open = openMap[wi.isl.id];
      const ig = sv('g', { class: `isl-island${open ? '' : ' locked'}`, 'data-isl': wi.isl.id });
      if (!open || wi.special) ig.setAttribute('data-island', wi.isl.id); // the diary island is one big button
      scene.appendChild(ig);
      islandGroups[wi.isl.id] = ig;
      const queue = [];
      wi.tiles.forEach((t) => {
        poly3(foams, hexPts(t.x, t.y, 0, 1.13), 'isl-foam rnd');
        queue.push({
          depth: t.x + t.y,
          draw: () => {
            const g = sv('g', { class: `isl-tile${t.spot && open ? ' is-spot' : ''}`, 'data-spot': t.spot && open ? t.spot.id : null });
            const top = hexPts(t.x, t.y, t.z, 1).map((p) => P(...p));
            const bottom = hexPts(t.x, t.y, 0, 1).map((p) => P(...p));
            const band = hexPts(t.x, t.y, t.z - 0.12, 1).map((p) => P(...p));
            poly2(g, hull(top.concat(bottom)), 'm-cliff-r rnd');
            poly2(g, hull(top.concat(band)), 'm-sand-r rnd');
            poly2(g, top, 'm-sand-t rnd');
            poly3(g, hexPts(t.x, t.y, t.z, 0.84), 'm-grass-t rnd');
            const items = [];
            const ctx = {
              g, x: t.x, y: t.y, z: t.z, seed: t.seed, spot: t.spot, add: (depth, fn) => items.push([depth, fn]), anchor: null,
            };
            if (open || !t.spot) (B[t.kind] || B.woods)(ctx); else mysteryTile(ctx);
            items.sort((a, b) => a[0] - b[0]).forEach(([, fn]) => fn());
            if (!ctx.anchor) ctx.anchor = P(t.x, t.y, t.z + 0.9);
            infos[t.id] = { ctx, center: P(t.x, t.y, t.z), isl: wi.isl.id, open };
            ig.appendChild(g);
          },
        });
      });
      wi.links.forEach(([A, Bt]) => queue.push({ depth: (A.x + A.y + Bt.x + Bt.y) / 2 + 0.001, draw: () => drawBridge(ig, A, Bt) }));
      queue.sort((a, b) => a.depth - b.depth).forEach((q) => q.draw());

      // clouds over an island that has not opened yet (and, for a moment, over one that just did)
      if (!open || lifting.has(wi.isl.id)) {
        const fg = sv('g', { class: `isl-fog${lifting.has(wi.isl.id) ? ' lifting' : ''}`, 'data-island': wi.isl.id });
        const rr = rng(wi.k * 97 + 5);
        wi.tiles.forEach((t) => {
          const [cx, cy] = P(t.x, t.y, t.z + 0.42);
          for (let i = 0; i < 4; i += 1) {
            fg.appendChild(sv('ellipse', {
              cx: R1(cx + (rr() - 0.5) * 70), cy: R1(cy + (rr() - 0.5) * 34), rx: R1(40 + rr() * 26), ry: R1(22 + rr() * 12), class: 'isl-cloud', style: `animation-delay:${R1(-rr() * 9)}s`,
            }));
          }
        });
        fogs.appendChild(fg);
      }
    });

    // balloon over the island you are on; boat at the harbours
    Object.values(infos).forEach(({ ctx, isl, open }) => {
      if (ctx.balloon && isl === here) {
        const [bx, by] = ctx.balloon;
        const outer = sv('g', { transform: `translate(${R1(bx)} ${R1(by)})` });
        const g = sv('g', { class: 'isl-float' });
        const rr = 0.38 * SC;
        g.appendChild(sv('path', { d: `M${-rr * 0.55} ${rr * 0.75}L-6 ${rr * 1.35}M${rr * 0.55} ${rr * 0.75}L6 ${rr * 1.35}`, class: 'isl-rope' }));
        g.appendChild(sv('rect', { x: -6, y: R1(rr * 1.32), width: 12, height: 9, rx: 2, class: 'm-wood-r' }));
        g.appendChild(sv('path', { d: `M${-rr} 0A${rr} ${rr} 0 1 1 ${rr} 0C${rr} ${rr * 0.5} ${rr * 0.55} ${rr * 0.75} ${rr * 0.4} ${rr * 0.95}L${-rr * 0.4} ${rr * 0.95}C${-rr * 0.55} ${rr * 0.75} ${-rr} ${rr * 0.5} ${-rr} 0Z`, class: 'm-balA-t' }));
        g.appendChild(sv('path', { d: `M0 ${-rr}C${rr * 0.55} ${-rr * 0.6} ${rr * 0.5} ${rr * 0.6} ${rr * 0.18} ${rr * 0.95}L${-rr * 0.18} ${rr * 0.95}C${-rr * 0.5} ${rr * 0.6} ${-rr * 0.55} ${-rr * 0.6} 0 ${-rr}Z`, class: 'm-balB-t' }));
        g.appendChild(sv('path', { d: `M0 ${-rr}C${rr * 0.16} ${-rr * 0.5} ${rr * 0.16} ${rr * 0.6} ${rr * 0.06} ${rr * 0.95}L${-rr * 0.06} ${rr * 0.95}C${-rr * 0.16} ${rr * 0.6} ${-rr * 0.16} ${-rr * 0.5} 0 ${-rr}Z`, class: 'm-balC-t' }));
        outer.appendChild(g);
        people.appendChild(outer);
      }
      if (ctx.boat && open) {
        const [bx, by] = ctx.boat;
        const outer = sv('g', { transform: `translate(${R1(bx)} ${R1(by)})` });
        outer.appendChild(boatShape());
        people.appendChild(outer);
      }
    });
    // the little boat sailing on toward the next island
    const sail = routePaths.find((rp) => rp.from === here);
    if (sail) {
      const g = sv('g', { class: 'isl-sailer' });
      g.appendChild(boatShape(0.7));
      g.appendChild(sv('animateMotion', { path: sail.d, dur: '16s', repeatCount: 'indefinite', keyPoints: '0;1;1', keyTimes: '0;0.8;1', calcMode: 'linear' }));
      people.appendChild(g);
    }

    // walkers on bridges of open islands
    const wr = rng(42);
    const shirts = ['shirtA', 'shirtB', 'shirtC', 'shirtD'];
    world.islands.filter((wi) => openMap[wi.isl.id]).slice(-6).forEach((wi, k) => {
      const link = wi.links[k % wi.links.length]; if (!link) return;
      const [A, Bt] = link;
      const { s, e, inA, inB } = bridgePts(A, Bt);
      const pts = [inA, s, e, inB].map((p) => P(...p));
      const seq = pts.concat(pts.slice(0, -1).reverse()).map((p) => `${R1(p[0])} ${R1(p[1])}`).join(';');
      const g = sv('g', { class: 'isl-walker' });
      g.appendChild(sv('rect', { x: -2.6, y: -10, width: 5.2, height: 8, rx: 2.2, class: `m-${shirts[k % 4]}-t` }));
      g.appendChild(sv('rect', { x: -2, y: -3, width: 4, height: 3.2, rx: 1, class: 'm-door-l' }));
      g.appendChild(sv('circle', { cy: -12.6, r: 2.7, class: 'm-skin-t' }));
      g.appendChild(sv('animateTransform', {
        attributeName: 'transform', type: 'translate', values: seq, dur: `${R1(20 + wr() * 14)}s`, begin: `${R1(-wr() * 20)}s`, repeatCount: 'indefinite',
      }));
      people.appendChild(g);
    });

    // crawling baby on a garden of an open island (the one you are on if it has a garden)
    const gardens = Object.values(infos).filter((i) => i.ctx.babyPath && i.open);
    const garden = gardens.find((i) => i.isl === here) || gardens[gardens.length - 1];
    if (garden) {
      const [[x1, y1], [x2, y2]] = garden.ctx.babyPath;
      const baby = sv('g', { class: 'isl-baby', 'data-baby': '1' });
      const body = sv('g');
      body.append(
        sv('circle', { cx: 0, cy: -5, r: 15, class: 'isl-hit' }),
        sv('ellipse', { cx: 0, cy: -4.5, rx: 6.4, ry: 3.8, class: 'm-onesie-t' }),
        sv('circle', { cx: 6.8, cy: -6.8, r: 3.9, class: 'm-skin-t' }),
        sv('circle', { cx: 4.2, cy: -1.2, r: 1.5, class: 'm-skin-r' }),
        sv('circle', { cx: -4.5, cy: -1.2, r: 1.5, class: 'm-skin-r' }),
        sv('circle', { cx: 8.2, cy: -7.4, r: 0.7, class: 'isl-eye' }),
      );
      baby.appendChild(body);
      baby.appendChild(sv('animateTransform', {
        attributeName: 'transform', type: 'translate', values: `${R1(x1)} ${R1(y1)};${R1(x2)} ${R1(y2)};${R1(x1)} ${R1(y1)}`, dur: '26s', repeatCount: 'indefinite',
      }));
      people.appendChild(baby);
    }

    // stop labels (open islands only: the others are under the clouds)
    const labelEls = [];
    D.SPOTS.forEach((spot) => {
      const info = infos[spot.id];
      if (!info || !info.open) return;
      const [ax, ay] = info.ctx.anchor;
      const g = sv('g', { class: 'isl-label', 'data-spot': spot.id, 'data-isl': info.isl, transform: `translate(${R1(ax)} ${R1(ay)})` });
      const inner = sv('g', { class: 'isl-label-in' });
      const pill = sv('rect', { class: 'isl-pill', rx: 12, height: 24, y: -34 });
      const tail = sv('path', { d: 'M-5 -10.6L0 -4L5 -10.6Z', class: 'isl-pill-tail' });
      const no = sv('text', { class: 'isl-no', y: -21.5 }, pad2(spot.no));
      const nm = sv('text', { class: 'isl-name', y: -21.5 }, spot.name);
      const badge = sv('g', { class: 'isl-badge' },
        sv('circle', { r: 7.5 }),
        sv('path', { d: 'M-3.4 0.2L-1 2.6L3.6 -2.2' }));
      inner.append(tail, pill, no, nm, badge);
      g.appendChild(inner);
      labels.appendChild(g);
      labelEls.push({ g, inner, pill, no, nm, badge, spot });
    });

    // island name plates, floating on the water in front of each island
    const bannerEls = [];
    world.islands.forEach((wi) => {
      const front = wi.tiles.map((t) => P(t.x, t.y, 0)).reduce((m, p) => (p[1] > m[1] ? p : m), [0, -Infinity]);
      const [cx] = P(...fromUV(wi.cu, wi.cv), 0);
      const g = sv('g', { class: `isl-ibanner${openMap[wi.isl.id] ? '' : ' locked'}${wi.isl.id === here ? ' here' : ''}`, 'data-island': wi.isl.id, transform: `translate(${R1(cx)} ${R1(front[1] + 46)})` });
      const inner = sv('g', { class: 'isl-ibanner-in' });
      const pill = sv('rect', { class: 'isl-ib-pill', rx: 17, height: 40, y: -20 });
      const dot = sv('circle', { r: 11, class: 'isl-ib-dot', style: `fill:${wi.isl.color || '#8b57a8'}` });
      const num = sv('text', { class: 'isl-ib-no' }, String(wi.isl.no || wi.k + 1));
      const nm = sv('text', { class: 'isl-ib-name', y: -6 }, `${wi.isl.emoji} ${wi.isl.name}`);
      const sub = sv('text', { class: 'isl-ib-sub', y: 10 }, '');
      const pin = sv('g', { class: 'isl-ib-pin' }, sv('rect', { rx: 9, height: 18, y: -40 }), sv('text', { class: 'isl-ib-pin-t', y: -31 }, '📍 你在這裡'));
      inner.append(pill, dot, num, nm, sub, pin);
      // far out (群島全景) the plate becomes a small round badge: emoji + short name
      const mini = sv('g', { class: 'isl-ib-mini' },
        sv('circle', { r: 17, class: 'isl-ib-mini-c', style: `stroke:${wi.isl.color || '#8b57a8'}` }),
        sv('text', { class: 'isl-ib-mini-e' }, openMap[wi.isl.id] ? wi.isl.emoji : '🔒'),
        sv('text', { class: 'isl-ib-mini-n', x: 23 }, wi.isl.name));
      inner.appendChild(mini);
      if (wi.isl.id === here) {
        const av = App.avatar && App.avatar.current();
        const me = sv('g', { class: `isl-ib-av${av ? '' : ' empty'}`, 'data-avatar': '1' });
        if (av) me.appendChild(sv('image', { href: App.avatar.dataUrl(av), width: 50, height: 62.5, x: -25, y: -60 }));
        else {
          me.appendChild(sv('circle', { cx: 0, cy: -30, r: 17, class: 'isl-ib-av-ghost' }));
          me.appendChild(sv('text', { class: 'isl-ib-av-plus', y: -30 }, '＋'));
          me.appendChild(sv('text', { class: 'isl-ib-av-t', y: -4 }, '我的角色'));
        }
        inner.appendChild(me);
      }
      // other moms on this island (島上的媽媽, filled in by social.js)
      const nb = sv('g', { class: 'isl-ib-nb', 'data-nb': wi.isl.id });
      inner.appendChild(nb);
      g.appendChild(inner);
      banners.appendChild(g);
      bannerEls.push({ g, inner, pill, dot, num, nm, sub, pin, mini, wi, nb, me: inner.querySelector('.isl-ib-av') });
    });
    return { world: root, labels, labelEls, bannerEls, infos, scene, islandGroups, openMap };
  }
  function boatShape(scale = 1) {
    const g = sv('g', { class: 'isl-bob', transform: scale !== 1 ? `scale(${scale})` : null });
    poly2(g, [[-22, -6], [22, -6], [15, 4], [-15, 4]], 'm-boat-r');
    poly2(g, [[-22, -6], [22, -6], [18, -9], [-18, -9]], 'm-boat-t');
    g.appendChild(sv('line', { x1: 0, y1: -8, x2: 0, y2: -46, class: 'isl-pole' }));
    poly2(g, [[2, -44], [2, -11], [24, -12]], 'm-white-t');
    poly2(g, [[-2, -38], [-2, -12], [-17, -12]], 'm-shirtA-t');
    return g;
  }

  /* =========================================================
   * Sheets
   * ========================================================= */
  const TOOL_LABELS = {
    vaccines: '疫苗時程', growth: '成長曲線', milestones: '發展里程碑', checkups: '兒童健檢', cycle: '經期紀錄', pregnancy: '孕期週數',
    prenatal: '產檢時程', kick: '胎動計數', contraction: '宮縮計時', hospitalbag: '待產包清單', goods: '常見好物', milk: '母乳庫存', brand: '品牌專區', log: '寶寶紀錄',
  };
  const DISCLAIMER = '內容為一般衛教資訊，不能取代專業醫療建議。';

  const islandState = () => store.state.island || { stamps: {}, quiz: {}, visited: {} };
  const stampCount = () => D.SPOTS.filter((s) => islandState().stamps?.[s.id]).length;
  const titleFor = (n) => D.TITLES.filter((t) => n >= t.min).pop().label;
  const islandDone = (isl) => { const st = islandState().stamps || {}; const sp = islandSpots(isl); return sp.filter((s) => st[s.id]).length; };
  // next stop: the island you are on first, then the islands you have already passed (newest first)
  function nextSpot() {
    const st = islandState().stamps || {};
    const order = openIslands().reverse();
    for (const isl of order) { const sp = islandSpots(isl).find((s) => !st[s.id]); if (sp) return sp; }
    return null;
  }
  function islandTag(isl) {
    if (!isl) return null;
    return h('span', { class: 'isl-stage-tag isl-tag-c', style: { '--ic': isl.color || '#8b57a8' } }, `${isl.emoji} ${isl.name}`);
  }
  const updIsland = (fn) => store.update((s) => {
    s.island = s.island || {};
    ['stamps', 'quiz', 'visited'].forEach((k) => { s.island[k] = s.island[k] || {}; });
    fn(s.island);
  });

  let onStampChange = () => {};
  let goSpotHook = null; // set while the map is on screen, so lists can fly to a stop
  let flyHook = null;

  function quizBlock(spot) {
    const wrap = h('div', { class: 'isl-quiz' });
    let answers = [];
    let result = null;
    const finish = () => {
      const score = spot.quiz.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0);
      let isNew = false;
      updIsland((x) => {
        x.quiz[spot.id] = Math.max(x.quiz[spot.id] || 0, score);
        if (!x.stamps[spot.id]) { x.stamps[spot.id] = C.dateKey(); isNew = true; }
      });
      result = { score, isNew };
      const isl = ISL[spot.island];
      const islandComplete = isNew && isl && islandDone(isl) === islandSpots(isl).length;
      if (isNew) {
        ui.toast(islandComplete ? `🏝️ ${isl.name}全部蓋章完成！` : `🏅 蓋章成功！獲得「${spot.name}」印章`);
        ui.celebrate({ emojis: ['🏅', '⭐', '✨', spot.emoji || '💜'], big: islandComplete });
      }
      if (isNew && App.share && D.TITLES) {
        const n = Object.keys(store.state.island.stamps || {}).length;
        const t = D.TITLES.find((x) => x.min === n && n > 0);
        if (t) App.share.moment(`island-title-${t.min}`, { emoji: '🏝️', msg: `你成為「${t.label}」了！`, kind: 'island', force: true, queue: true });
      }
      onStampChange();
    };
    const render = () => {
      wrap.innerHTML = '';
      spot.quiz.forEach((qq, qi) => {
        const chosen = answers[qi];
        const qEl = h('div', { class: 'isl-q' }, h('p', { class: 'isl-q-t' }, `Q${qi + 1}. ${qq.q}`));
        const opts = h('div', { class: 'isl-opts' });
        qq.options.forEach((o, oi) => {
          let cls = 'isl-opt';
          if (chosen !== undefined) {
            if (oi === qq.answer) cls += ' correct';
            else if (oi === chosen) cls += ' wrong';
          }
          opts.append(h('button', {
            type: 'button',
            class: cls,
            disabled: chosen !== undefined,
            onclick: () => {
              answers[qi] = oi;
              if (answers.filter((a) => a !== undefined).length === spot.quiz.length) finish();
              render();
            },
          }, o));
        });
        qEl.append(opts);
        if (chosen !== undefined) qEl.append(h('p', { class: `isl-explain${chosen === qq.answer ? ' ok' : ''}` }, `${chosen === qq.answer ? '✅ 答對了！' : '💡 正確答案：' + qq.options[qq.answer] + '。'}${qq.explain}`));
        wrap.append(qEl);
      });
      if (result) {
        wrap.append(h('div', { class: 'isl-result' },
          h('div', { class: 'isl-stamp' }, h('span', null, spot.emoji), h('small', null, spot.name)),
          h('div', { class: 'grow' },
            h('div', { class: 'bold' }, `答對 ${result.score} / ${spot.quiz.length} 題`),
            h('div', { class: 'small muted' }, result.isNew ? '已蓋章！到「旅程」看看你的收藏。' : '這一站已經蓋過章囉。'),
            h('button', { class: 'link-btn small', onclick: () => { answers = []; result = null; render(); } }, '再測一次'))));
      }
    };
    render();
    return wrap;
  }

  function checklist(spot) {
    const st = islandState().checks?.[spot.id] || {};
    return h('div', { class: 'isl-checks' }, spot.checks.map((txt, i) => {
      const input = h('input', { type: 'checkbox', checked: !!st[i] });
      input.addEventListener('change', () => {
        store.update((s) => {
          s.island = s.island || {};
          s.island.checks = s.island.checks || {};
          s.island.checks[spot.id] = s.island.checks[spot.id] || {};
          s.island.checks[spot.id][i] = input.checked;
        });
        if (input.checked) ui.toast('做得好！💜');
      });
      return h('label', { class: 'check-row' }, input, h('span', null, txt));
    }));
  }

  function openSpot(id) {
    const spot = SPOT[id];
    if (!spot) return null;
    const isl = ISL[spot.island];
    const st = isl ? statusOf(isl) : { open: true };
    if (st.open && !islandState().visited?.[id]) updIsland((x) => { x.visited[id] = C.dateKey(); });
    const stamped = !!islandState().stamps?.[id];
    const body = h('div', { class: 'isl-sh' },
      h('div', { class: 'isl-sh-hero' },
        h('div', { class: 'isl-sh-emoji', 'aria-hidden': 'true' }, spot.emoji),
        h('div', { class: 'grow' },
          h('div', { class: 'row gap-sm wrap' }, isl ? h('button', { class: 'isl-tag-btn', onclick: () => { sh.close(); setTimeout(() => openIsland(isl.id), 240); } }, islandTag(isl)) : null,
            !st.open ? h('span', { class: 'tag' }, '🔒 尚未開放') : stamped ? h('span', { class: 'tag ok' }, '🏅 已蓋章') : h('span', { class: 'tag' }, '尚未蓋章')),
          h('p', { class: 'isl-intro' }, spot.intro))));
    if (!st.open) {
      body.append(h('div', { class: 'isl-lockbar' }, `🔒 這一站在「${isl.emoji} ${isl.name}」，${lockText(st)}。現在可以先看小知識；開放後就能打勾、答題蓋章。`));
    }

    if (spot.brand) {
      const brand = window.BRAND || {};
      const canBrand = !!App.screens.brand;
      body.append(h('div', { class: 'isl-brand card soft' },
        h('img', { src: brand.logoFull || brand.logo || 'assets/logo.svg', alt: brand.brandName || '易家滴雞精', class: 'isl-brand-logo' }),
        h('p', { class: 'small' }, brand.story || ''),
        canBrand ? h('button', { class: 'btn btn-primary btn-sm', onclick: () => { sh.close(); if (App.screens.brand) App.navigate('brand'); } }, `認識${brand.brandName || '易家滴雞精'}`)
          : (brand.shopUrl ? h('a', { class: 'btn btn-primary btn-sm', href: brand.shopUrl, target: '_blank', rel: 'noopener' }, '前往官網') : null)));
    }

    const cite = App.src ? App.src.collector() : null;
    const mk = (...k) => (cite ? cite.mark(...k) : null);
    body.append(h('h3', { class: 'isl-sh-h' }, '小知識'));
    body.append(h('div', { class: 'isl-know-list' }, spot.cards.map((cd, i) => h('div', { class: 'isl-know' }, h('strong', null, cd.t), h('p', null, cd.d, mk(`card:${spot.id}:${i}`))))));
    if (App.share) {
      body.append(h('div', { class: 'mt' }, App.share.button(() => ({
        sheetTitle: '分享這篇小知識', title: `${spot.name}・小知識`, campaign: `island-${spot.id}`, path: 'island', params: { spot: spot.id }, emoji: spot.emoji, kicker: isl ? `好孕群島・${isl.name}` : '好孕島小知識', theme: 'night',
        text: `【好孕群島・${spot.name}】\n${spot.cards.slice(0, 3).map((cd) => `・${cd.t}：${cd.d}`).join('\n')}`,
        lines: spot.cards.slice(0, 4).map((cd) => cd.t),
      }), { label: '分享這篇給朋友', cls: 'btn btn-sm btn-ghost btn-block' })));
    }
    if (st.open) {
      body.append(h('h3', { class: 'isl-sh-h' }, '我做到了'));
      body.append(checklist(spot));
      body.append(h('h3', { class: 'isl-sh-h' }, '小測驗 ', h('span', { class: 'tiny muted' }, '完成就能蓋章')));
      body.append(quizBlock(spot));
    }
    if (spot.tool && App.screens[spot.tool] && !spot.brand) {
      body.append(h('button', {
        class: 'btn btn-soft btn-block mt',
        onclick: () => {
          if (!App.screens[spot.tool]) { ui.toast('這個工具即將推出'); return; }
          sh.close();
          App.navigate(spot.tool);
        },
      }, `打開「${TOOL_LABELS[spot.tool] || '相關工具'}」`));
    }
    if (cite) { cite.add(`spot:${spot.id}`); const f = cite.footer(); if (f) body.append(f); }
    body.append(h('p', { class: 'disclaimer' }, DISCLAIMER));
    const sh = ui.sheet({ title: `${pad2(spot.no)} ${spot.name}`, body });
    return sh;
  }

  /* ----- one island: 注意事項, 新手教學, its stops, share / image / PDF ----- */
  function notesBlock(isl, open, cite = null) {
    if (!isl.notes || !isl.notes.length) return null;
    return h('div', { class: 'isl-notes' },
      h('h3', { class: 'isl-sh-h' }, '⚠️ 這個階段要注意'),
      isl.notes.map((n, i) => h('div', { class: `isl-note${n.urgent ? ' urgent' : ''}` },
        h('div', { class: 'isl-note-t' }, n.urgent ? h('span', { class: 'isl-urgent-tag' }, '就醫警訊') : null, n.t),
        // a warning sign is always shown in full; the rest opens with the island
        open || n.urgent ? h('p', null, n.d, cite ? cite.mark(`note:${isl.id}:${i}`) : null) : null)),
      open ? null : h('p', { class: 'tiny muted' }, '小島開放後就能看完整說明和新手教學。'));
  }
  function guideBlock(isl, cite = null) {
    const g = isl.guide;
    if (!g || !g.steps || !g.steps.length) return null;
    return h('div', { class: 'isl-guide' },
      h('h3', { class: 'isl-sh-h' }, `📖 ${g.title || '新手教學'}`, cite ? cite.mark(`guide:${isl.id}`) : null),
      h('ol', { class: 'isl-steps' }, g.steps.map((s) => h('li', null, s))));
  }
  function islandActions(isl, open, close) {
    return h('div', { class: 'isl-actions' },
      h('button', { class: 'btn btn-soft', onclick: () => shareIsland(isl) }, '📤 分享'),
      open ? h('button', { class: 'btn btn-soft', onclick: () => saveIslandImage(isl) }, '🖼️ 存成圖片') : null,
      open ? h('button', { class: 'btn btn-soft', onclick: () => { if (close) close(); App.navigate('island-guide', { island: isl.id }); } }, '📄 下載 PDF') : null);
  }
  function islandHero(isl, st) {
    const done = islandDone(isl); const all = islandSpots(isl).length;
    return h('div', { class: 'isl-ish-hero', style: { '--ic': isl.color || '#8b57a8' } },
      h('span', { class: 'isl-ish-emoji', 'aria-hidden': 'true' }, isl.emoji),
      h('div', { class: 'grow' },
        h('div', { class: 'isl-ish-name' }, isl.name, isl.nick ? h('small', null, `・${isl.nick}`) : null),
        h('div', { class: 'small muted' }, isl.range),
        st.open ? h('div', { class: 'row gap-sm mt-xs' }, h('span', { class: `tag${done === all ? ' ok' : ''}` }, done === all ? '🏝️ 全部蓋章' : `🏅 ${done}/${all}`))
          : h('div', { class: 'row gap-sm mt-xs' }, h('span', { class: 'tag' }, `🔒 ${lockText(st)}`))));
  }
  function openIsland(id) {
    const isl = ISL[id]; if (!isl) return null;
    const st = statusOf(isl);
    if (isl.special === 'diary') {
      if (st.open) { App.navigate('diary'); return null; }
      return ui.sheet({
        title: '💌 產檢日記島',
        body: h('div', { class: 'isl-sh' },
          h('p', null, '懷孕後開放：每次產檢放一張超音波照片、寫一句想對寶寶說的話，慢慢收集成一本產檢日記，還能印成 PDF。'),
          h('p', { class: 'small muted' }, '照片只存在你的手機。')),
      });
    }
    const stamps = islandState().stamps || {};
    let sh = null;
    const close = () => sh && sh.close();
    const cite = App.src ? App.src.collector() : null;
    const body = h('div', { class: 'isl-sh isl-ish' },
      islandHero(isl, st),
      isl.intro ? h('p', { class: 'isl-intro' }, isl.intro) : null,
      notesBlock(isl, st.open, cite),
      st.open ? guideBlock(isl, cite) : null,
      h('h3', { class: 'isl-sh-h' }, '📍 島上地點'),
      h('div', { class: 'list' }, islandSpots(isl).map((s) => h('button', {
        class: 'list-item', onclick: () => { close(); setTimeout(() => (goSpotHook ? goSpotHook(s.id) : openSpot(s.id)), 240); },
      },
      h('span', { class: 'li-icon' }, s.emoji),
      h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, `${pad2(s.no)} ${s.name}`), h('div', { class: 'li-sub' }, s.intro)),
      h('span', { class: 'li-right' }, !st.open ? '🔒' : stamps[s.id] ? '🏅' : h('span', { class: 'tiny faint' }, '未蓋章'))))),
      islandActions(isl, st.open, close),
      cite ? cite.footer() : null,
      h('p', { class: 'disclaimer' }, DISCLAIMER));
    sh = ui.sheet({ title: `${pad2(isl.no || 1)} ${isl.name}`, body });
    return sh;
  }
  // the moment an island opens: celebrate, and its 注意事項 and 新手教學 open right away
  function openUnlock(id, others = 0) {
    const isl = ISL[id]; if (!isl) return null;
    const st = statusOf(isl);
    let sh = null;
    const close = () => sh && sh.close();
    const cite = App.src ? App.src.collector() : null;
    const body = h('div', { class: 'isl-sh isl-unlock' },
      h('div', { class: 'isl-unlock-hero', style: { '--ic': isl.color || '#8b57a8' } },
        h('div', { class: 'isl-unlock-emoji', 'aria-hidden': 'true' }, isl.emoji),
        h('div', { class: 'isl-unlock-kicker' }, st.reason || '新的小島開放了'),
        h('div', { class: 'isl-unlock-name' }, isl.name),
        h('div', { class: 'small muted' }, `${isl.range}${isl.nick ? `・${isl.nick}` : ''}`),
        others > 0 ? h('div', { class: 'tiny muted mt-xs' }, `另外還有 ${others} 座島也開放了，在地圖上看得到。`) : null),
      isl.intro ? h('p', { class: 'isl-intro center' }, isl.intro) : null,
      notesBlock(isl, true, cite),
      guideBlock(isl, cite),
      h('button', { class: 'btn btn-primary btn-block mt', onclick: () => { close(); if (flyHook) flyHook(isl.id); } }, `🏝️ 開始逛${isl.name}`),
      islandActions(isl, true, close),
      cite ? cite.footer() : null,
      h('p', { class: 'disclaimer' }, DISCLAIMER));
    sh = ui.sheet({ title: '🎉 新的小島開放了', body });
    ui.celebrate({ big: true, emojis: [isl.emoji, '🎉', '🏝️', '✨', '💜'] });
    return sh;
  }

  /* ----- sharing: a card with the island's 注意事項 (with QR + invite code), the image itself, and a printable PDF ----- */
  const THEME_OF = { prep: 'peach', preg1: 'peach', preg2: 'peach', preg3: 'purple', newborn: 'purple', infant: 'night', crawl: 'green', y1: 'green', y2: 'peach', y3: 'peach', y4: 'night' };
  function islandSpec(isl) {
    return {
      emoji: isl.emoji, kicker: `好孕群島・${isl.range}`, title: isl.name, subtitle: isl.intro || '',
      lines: (isl.notes || []).slice(0, 5).map((n) => n.t), linesTitle: '⚠️ 這個階段要注意', footnote: '完整說明和新手教學都在 App 裡', theme: THEME_OF[isl.id] || 'purple',
      campaign: `island-${isl.id}`, path: 'island', params: { island: isl.id },
    };
  }
  function islandText(isl) {
    return `【好孕群島・${isl.emoji} ${isl.name}】${isl.range}\n這個階段要注意：\n${(isl.notes || []).map((n) => `・${n.t}`).join('\n')}`;
  }
  function shareIsland(isl) {
    if (!App.share) return;
    App.share.open({ spec: islandSpec(isl), text: islandText(isl), title: `好孕群島・${isl.name}`, campaign: `island-${isl.id}`, path: 'island', params: { island: isl.id } });
  }
  async function saveIslandImage(isl) {
    if (!App.share || !App.share.render) return;
    ui.toast('產生圖片中…');
    try {
      const blob = await App.share.render(islandSpec(isl));
      if (!blob) { ui.toast('這台裝置無法產生圖片'); return; }
      const how = App.share.saveImage ? await App.share.saveImage(blob, `好孕群島-${isl.name}.png`, isl.name) : 'none';
      if (how === 'downloaded') ui.toast('圖片已下載，可以傳到 LINE 或設成桌布');
      if (App.share.record && how !== 'cancel') App.share.record('image', `island-${isl.id}`);
    } catch (e) { ui.toast('圖片產生失敗，請再試一次'); }
  }
  function sharePassport() {
    if (!App.share) return;
    const n = stampCount(); const open = openIslands();
    const doneN = open.filter((i) => islandDone(i) === islandSpots(i).length).length;
    App.share.open({
      spec: {
        emoji: '🏝️', kicker: '我的好孕群島護照', title: titleFor(n), subtitle: `已開放 ${open.length} 座島・蓋了 ${n} 個章`,
        stats: [{ v: n, l: '印章' }, { v: open.length, l: '座島' }, { v: doneN, l: '完成' }], theme: 'night', campaign: 'island-passport', path: 'island',
      },
      text: `我在「好孕群島」已經開放 ${open.length} 座島、蓋了 ${n} 個章，成為「${titleFor(n)}」了！一起來逛：`,
      campaign: 'island-passport', path: 'island',
    });
  }

  function openList(onPick) {
    const st = islandState().stamps || {};
    const body = h('div', { class: 'stack-sm' });
    ISLANDS.forEach((isl) => {
      const ist = statusOf(isl);
      body.append(h('div', { class: 'isl-list-h' }, islandTag(isl), h('span', { class: 'tiny muted' }, ist.open ? isl.range : `🔒 ${lockText(ist)}`)));
      body.append(h('div', { class: 'list' }, islandSpots(isl).map((s) => h('button', {
        class: 'list-item', onclick: () => { sh.close(); onPick(s.id); },
      },
      h('span', { class: 'li-icon' }, s.emoji),
      h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, `${pad2(s.no)} ${s.name}`), h('div', { class: 'li-sub' }, s.intro)),
      h('span', { class: 'li-right' }, !ist.open ? '🔒' : st[s.id] ? '🏅' : h('span', { class: 'tiny faint' }, '未蓋章'))))));
    });
    body.append(h('p', { class: 'disclaimer' }, DISCLAIMER));
    const sh = ui.sheet({ title: '群島地點', body });
  }

  function openJourney(onPick) {
    const st = islandState().stamps || {};
    const n = stampCount(); const N = D.SPOTS.length;
    const next = nextSpot();
    const open = openIslands();
    const body = h('div', { class: 'stack' },
      h('div', { class: 'card soft isl-jr-top' },
        h('div', { class: 'row between' },
          h('div', null, h('div', { class: 'tiny muted' }, '我的稱號'), h('div', { class: 'isl-jr-title' }, titleFor(n))),
          h('div', { class: 'center' }, h('div', { class: 'big-num' }, `${n}`, h('small', { class: 'small muted' }, ` / ${N}`)), h('div', { class: 'tiny muted' }, `已蓋章・開放 ${open.length}/${ISLANDS.length} 座島`))),
        ui.progress(n / N),
        h('div', { class: 'row gap-sm mt wrap' },
          next ? h('button', { class: 'btn btn-primary btn-sm', onclick: () => { sh.close(); onPick(next.id); } }, `下一站：${pad2(next.no)} ${next.name}`)
            : h('span', { class: 'small' }, '🎉 開放的小島都蓋完章了！'),
          h('button', { class: 'btn btn-soft btn-sm', onclick: () => sharePassport() }, '📤 分享我的護照'))));
    ISLANDS.forEach((isl) => {
      const ist = statusOf(isl);
      const spots = islandSpots(isl);
      const done = spots.filter((s) => st[s.id]).length;
      body.append(h('div', { class: `isl-jr-row${isl.id === hereIsland().id ? ' mine' : ''}${ist.open ? '' : ' locked'}` },
        h('div', { class: 'row between' },
          h('button', { class: 'isl-tag-btn row gap-sm', onclick: () => { sh.close(); setTimeout(() => openIsland(isl.id), 240); } }, islandTag(isl), h('span', { class: 'tiny muted' }, ist.open ? isl.range : `🔒 ${lockText(ist)}`)),
          h('span', { class: 'small muted num' }, `${done}/${spots.length}`)),
        h('div', { class: 'isl-stamps' }, spots.map((s) => h('button', {
          class: `isl-stamp-chip${st[s.id] ? ' got' : ''}`, onclick: () => { sh.close(); onPick(s.id); }, 'aria-label': `${s.name}${st[s.id] ? '（已蓋章）' : ist.open ? '' : '（未開放）'}`,
        }, h('span', { class: 'isl-stamp-emoji' }, ist.open ? s.emoji : '🔒'), h('span', { class: 'tiny' }, s.name))))));
    });
    const sh = ui.sheet({ title: '我的好孕旅程', body });
  }

  /* =========================================================
   * Screen
   * ========================================================= */
  let cleanup = null;
  // the first time someone sees the archipelago, every island that is already open counts as seen (no fanfare for
  // the past); after that, an island that opens is new until it has been shown
  function seenBaseline() {
    const x = islandState();
    if (x.seen) return false;
    updIsland((y) => { y.seen = Object.fromEntries(openIslands().map((i) => [i.id, C.dateKey()])); });
    return true;
  }
  const freshIslands = () => { const seen = islandState().seen; return seen ? openIslands().filter((i) => !seen[i.id]) : []; };

  function renderIsland(el, params) {
    if (cleanup) { cleanup(); cleanup = null; }
    injectCSS();
    if (ST.night === null) ST.night = defaultNight();
    if (!ST.season) ST.season = defaultSeason();
    const firstVisit = seenBaseline();
    const fresh = freshIslands();
    const here = hereIsland().id;

    const world = makeWorld();
    const svg = sv('svg', { class: 'isl-svg', role: 'img', 'aria-label': '好孕群島地圖：每個階段一座島，點島名牌或地點查看內容' });
    const sea = sv('rect', { class: 'm-sea-t isl-sea', x: 0, y: 0, width: '100%', height: '100%' });
    const stars = sv('g', { class: 'isl-stars' });
    const built = buildScene(world, { lifting: new Set(fresh.map((i) => i.id)), here });
    const grad = (id, o1, o2) => sv('linearGradient', { id, x1: 0, x2: 1, y1: 0, y2: 0 },
      sv('stop', { offset: 0, 'stop-color': '#fff6c2', 'stop-opacity': o1 }),
      sv('stop', { offset: 1, 'stop-color': '#fff6c2', 'stop-opacity': o2 }));
    const defs = sv('defs', null, grad('isl-beam-r', 0.9, 0), grad('isl-beam-l', 0, 0.9));
    svg.append(defs, sea, stars, built.world);

    const fx = h('div', { class: 'isl-fx', 'aria-hidden': 'true' });
    const bubble = h('div', { class: 'isl-bubble', 'aria-live': 'polite' });
    const hud = h('button', { class: 'isl-hud' });
    const ctrl = h('div', { class: 'isl-ctrl' });
    const strip = h('div', { class: 'isl-strip', role: 'tablist', 'aria-label': '小島' });
    const tickerText = h('span', { class: 'isl-ticker-text' });
    const ticker = h('button', { class: 'isl-ticker', 'aria-label': '下一則好孕小報' }, h('span', { class: 'isl-ticker-tag' }, '好孕小報'), tickerText);
    const coach = h('div', { class: 'isl-coach', hidden: true });
    const root = h('div', { class: `isl s-${ST.season}${ST.night ? ' night' : ''}` }, svg, fx, hud, ctrl, strip, ticker, coach, bubble);
    // 島上的媽媽: a chip under the HUD, and other moms' chibis beside each island's name plate
    let socChip = null;
    el.append(root);

    /* ----- view transform ----- */
    let W = root.clientWidth || 360; let H = root.clientHeight || 600;
    const bb = built.scene.getBBox();
    const bbox = { x: bb.x - 30, y: bb.y - 60, w: bb.width + 60, h: bb.height + 140 };
    const iboxes = {};
    Object.entries(built.islandGroups).forEach(([id, g]) => { const b = g.getBBox(); iboxes[id] = { x: b.x - 10, y: b.y - 40, w: b.width + 20, h: b.height + 100 }; });
    // leave room for the HUD (top), the island strip + ticker (bottom) and the control column (right, on phones)
    const PAD = { t: 64, b: 150, l: 6, r: W < 600 ? 34 : 8 };
    let fitK = 1; let nearK = 1;
    const view = { k: 1, tx: 0, ty: 0 };
    const computeFit = () => {
      PAD.r = W < 600 ? 34 : 8;
      fitK = Math.min((W - PAD.l - PAD.r) / bbox.w, (H - PAD.t - PAD.b) / bbox.h);
      return {
        k: fitK,
        tx: PAD.l + (W - PAD.l - PAD.r - bbox.w * fitK) / 2 - bbox.x * fitK,
        ty: PAD.t + (H - PAD.t - PAD.b - bbox.h * fitK) / 2 - bbox.y * fitK,
      };
    };
    const islandView = (id) => {
      const b = iboxes[id] || bbox;
      const k = Math.min(1.15, 0.86 * Math.min((W - PAD.l - PAD.r) / b.w, (H - PAD.t - PAD.b) / b.h));
      return {
        k,
        tx: PAD.l + (W - PAD.l - PAD.r - b.w * k) / 2 - b.x * k,
        ty: PAD.t + (H - PAD.t - PAD.b - b.h * k) / 2 - b.y * k,
      };
    };
    const maxK = () => Math.max(fitK * 4, 2.6);
    const clampView = (v) => {
      const k = Math.min(maxK(), Math.max(fitK * 0.85, v.k));
      const minTx = W / 2 - (bbox.x + bbox.w) * k; const maxTx = W / 2 - bbox.x * k;
      const minTy = H / 2 - (bbox.y + bbox.h) * k; const maxTy = H / 2 - bbox.y * k;
      return { k, tx: Math.min(maxTx, Math.max(minTx, v.tx)), ty: Math.min(maxTy, Math.max(minTy, v.ty)) };
    };
    let lastK = null; let focusId = null;
    const nearestIsland = () => {
      const wx = (W / 2 - view.tx) / view.k; const wy = ((PAD.t + H - PAD.b) / 2 - view.ty) / view.k;
      let best = null; let bd = Infinity;
      Object.entries(iboxes).forEach(([id, b]) => { const d = Math.hypot(b.x + b.w / 2 - wx, b.y + b.h / 2 - wy); if (d < bd) { bd = d; best = id; } });
      return best;
    };
    const apply = () => {
      built.world.setAttribute('transform', `translate(${R1(view.tx)} ${R1(view.ty)}) scale(${view.k.toFixed(4)})`);
      if (view.k !== lastK) {
        lastK = view.k;
        // labels keep a constant on-screen size; far out, only the island name plates show
        const s = (1 / view.k).toFixed(4);
        built.labelEls.forEach((l) => l.inner.setAttribute('transform', `scale(${s})`));
        const far = view.k < nearK * 0.6;
        built.bannerEls.forEach((b) => b.inner.setAttribute('transform', `${far ? `translate(0 ${R1(-46 - 60)})` : ''} scale(${(1 / view.k).toFixed(4)})`));
        root.classList.toggle('far', view.k < nearK * 0.6);
      }
      const f = nearestIsland();
      if (f !== focusId) { focusId = f; markStrip(); if (App.social) { App.social.look(f); if (socChip) socChip.update(); } }
      ST.view = { ...view }; ST.size = { W, H };
    };
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(); }); };
    const setView = (v) => { Object.assign(view, clampView(v)); schedule(); };
    let anim = 0;
    const animateTo = (target, ms = 420) => {
      cancelAnimationFrame(anim);
      const from = { ...view }; const to = clampView(target); const t0 = performance.now();
      if (reduceMotion()) { Object.assign(view, to); apply(); return; }
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms); const e = 1 - (1 - t) ** 3;
        view.k = from.k + (to.k - from.k) * e; view.tx = from.tx + (to.tx - from.tx) * e; view.ty = from.ty + (to.ty - from.ty) * e;
        apply();
        if (t < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    };
    computeFit();
    nearK = islandView(here).k;
    const startOn = (params && params.island && ISL[params.island]) ? params.island : fresh.length ? fresh[fresh.length - 1].id : here;
    if (ST.view && ST.size && ST.size.W === W && ST.size.H === H && !(params && (params.island || params.spot)) && !fresh.length) Object.assign(view, clampView(ST.view));
    else Object.assign(view, clampView(islandView(startOn)));

    const zoomAt = (sx, sy, f, animated = false) => {
      const k = Math.min(maxK(), Math.max(fitK * 0.85, view.k * f));
      const wx = (sx - view.tx) / view.k; const wy = (sy - view.ty) / view.k;
      const target = { k, tx: sx - wx * k, ty: sy - wy * k };
      if (animated) animateTo(target, 260); else setView(target);
    };
    const flyTo = (id) => animateTo(islandView(id), 520);
    const focusSpot = (id) => {
      const info = built.infos[id];
      if (!info) return;
      const [cx, cy] = info.center;
      const k = Math.max(view.k, nearK * 1.15);
      animateTo({ k, tx: W / 2 - cx * k, ty: H * 0.3 - cy * k });
    };
    const goSpot = (id) => {
      const spot = SPOT[id];
      if (spot && built.infos[id] && built.infos[id].open) { focusSpot(id); setTimeout(() => openSpot(id), reduceMotion() ? 0 : 260); return; }
      if (spot && spot.island) flyTo(spot.island);
      setTimeout(() => openSpot(id), reduceMotion() ? 0 : 300);
    };
    goSpotHook = goSpot; flyHook = flyTo;

    /* ----- marks (stamped / current island), name plates, HUD, strip ----- */
    function markStrip() {
      [...strip.children].forEach((b) => {
        const sel = b.dataset.island === focusId;
        b.classList.toggle('sel', sel);
        b.setAttribute('aria-selected', sel ? 'true' : 'false');
      });
      const chip = strip.querySelector('.sel');
      if (chip && strip.scrollWidth > strip.clientWidth) {
        const left = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
        try { strip.scrollTo({ left, behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch (e) { strip.scrollLeft = left; }
      }
    }
    const textW = (t, fallback) => (t.getComputedTextLength ? t.getComputedTextLength() : fallback) || fallback;
    const updateMarks = () => {
      const st = islandState().stamps || {};
      built.labelEls.forEach((l) => {
        const nmW = textW(l.nm, l.spot.name.length * 13);
        const noW = textW(l.no, 14);
        const w = Math.ceil(10 + noW + 5 + nmW + 11);
        l.pill.setAttribute('x', -w / 2); l.pill.setAttribute('width', w);
        l.no.setAttribute('x', -w / 2 + 10); l.nm.setAttribute('x', -w / 2 + 10 + noW + 5);
        l.badge.setAttribute('transform', `translate(${w / 2 - 3} -33)`);
        l.g.classList.toggle('stamped', !!st[l.spot.id]);
        l.g.classList.toggle('cur', l.spot.island === here);
      });
      built.bannerEls.forEach((b) => {
        const isl = b.wi.isl; const ist = statusOf(isl);
        const done = islandDone(isl); const all = islandSpots(isl).length;
        const dc = isl.special && App.diary ? App.diary.counts() : null;
        b.sub.textContent = !ist.open ? `🔒 ${lockText(ist)}` : dc ? (dc.pages ? `${dc.pages} 頁日記・📷 ${dc.photos}` : '放超音波照片、寫給寶寶的話') : `${isl.range}・🏅 ${done}/${all}`;
        const w = Math.ceil(Math.max(textW(b.nm, isl.name.length * 15 + 20), textW(b.sub, 90)) + 46);
        b.pill.setAttribute('x', -w / 2); b.pill.setAttribute('width', w);
        b.dot.setAttribute('cx', -w / 2 + 19); b.num.setAttribute('x', -w / 2 + 19);
        b.nm.setAttribute('x', -w / 2 + 36); b.sub.setAttribute('x', -w / 2 + 36);
        const pw = Math.ceil(textW(b.pin.lastChild, 70) + 16);
        b.pin.firstChild.setAttribute('x', -pw / 2); b.pin.firstChild.setAttribute('width', pw);
        b.pin.lastChild.setAttribute('x', 0);
        b.g.classList.toggle('done', ist.open && all > 0 && done === all);
        if (b.me) b.me.setAttribute('transform', `translate(${-w / 2 - 30} 18)`);
        b.nb.setAttribute('transform', `translate(${w / 2 + 24} 18)`);
        b.g.setAttribute('aria-label', `${isl.name}，${b.sub.textContent}`);
      });
      const hereIsl = ISL[here];
      const n = islandDone(hereIsl); const all = islandSpots(hereIsl).length;
      const next = nextSpot();
      hud.innerHTML = '';
      hud.append(
        h('span', { class: 'isl-hud-top' }, App.avatar && App.avatar.current() ? App.avatar.head(26) : null, h('strong', null, `${hereIsl.emoji} ${hereIsl.name}`), h('span', { class: 'isl-hud-title' }, `🏅 ${n}/${all}・${titleFor(stampCount())}`)),
        h('span', { class: 'isl-hud-next' }, next ? `下一站 ${pad2(next.no)} ${next.name}` : '開放的小島都蓋完章了 🎉'),
      );
      hud.onclick = () => (next ? goSpot(next.id) : openIsland(here));
      hud.setAttribute('aria-label', next ? `你在${hereIsl.name}，前往下一站 ${next.name}` : `你在${hereIsl.name}，查看小島`);
      strip.innerHTML = '';
      const order = ISLANDS.flatMap((i) => (i.id === DIARY.near ? [i, DIARY] : [i]));
      order.forEach((isl) => {
        const ist = statusOf(isl); const done = islandDone(isl); const all = islandSpots(isl).length;
        strip.append(h('button', {
          class: `isl-chip${ist.open ? '' : ' locked'}${isl.id === here ? ' here' : ''}${ist.open && all && done === all ? ' done' : ''}${isl.special ? ' special' : ''}`,
          role: 'tab', dataset: { island: isl.id }, style: { '--ic': isl.color || '#8b57a8' },
          'aria-label': `${isl.name}（${isl.range}）${!ist.open ? `，${lockText(ist)}` : isl.special ? '' : `，蓋章 ${done}/${all}`}`,
          onclick: () => { if (focusId === isl.id) openIsland(isl.id); else flyTo(isl.id); },
        }, h('span', { class: 'isl-chip-emoji', 'aria-hidden': 'true' }, ist.open ? isl.emoji : '🔒'), h('span', { class: 'isl-chip-name' }, isl.name)));
      });
      markStrip();
    };
    // the 島上的媽媽 chip goes right under the HUD (which can wrap to more lines on a small phone)
    function placeChip() {
      if (!socChip) return;
      let top = hud.offsetTop + hud.offsetHeight + 8;
      if (!coach.hidden) { coach.style.top = `${top}px`; top += coach.offsetHeight + 8; }
      socChip.el.style.top = `${top}px`;
    }
    onStampChange = () => { updateMarks(); placeChip(); };
    apply();
    updateMarks();

    /* ----- 島上的媽媽 ----- */
    const drawNeighbours = () => {
      if (!App.social || !App.avatar) return;
      built.bannerEls.forEach((b) => {
        const isl = b.wi.isl;
        const d = !isl.special && statusOf(isl).open ? App.social.forIsland(isl.id) : null;
        // redraw only when something changed (a tap in progress keeps its target)
        const sig = d ? `${d.others}|${d.people.slice(0, 3).map((p) => `${p.nid}${JSON.stringify(p.av)}`).join(',')}` : '';
        if (b.nbSig === sig) return;
        b.nbSig = sig;
        b.nb.innerHTML = '';
        b.g.classList.toggle('has-nb', !!(d && d.others));
        // far out (群島全景): a small count on the round badge
        const old = b.mini.querySelector('.isl-mini-nb'); if (old) old.remove();
        if (d && d.others) {
          b.mini.appendChild(sv('g', { class: 'isl-mini-nb', transform: 'translate(13 -13)' },
            sv('circle', { r: 9.5 }), sv('text', null, d.others > 99 ? '99+' : String(d.others))));
        }
        if (!d || !d.others) return;
        const shown = d.people.slice(0, 3);
        shown.forEach((p, i) => {
          b.nb.appendChild(sv('image', {
            href: App.avatar.dataUrl({ ...p.av, mode: 'draw' }, { pose: p.av.pose }), width: 34, height: 42.5, x: -17 + i * 27, y: -41, class: 'isl-nb-p',
          }));
        });
        const rest = d.others - shown.length;
        if (rest > 0 || !shown.length) {
          const t = shown.length ? `+${rest}` : `👭 ${d.others}`;
          const x0 = shown.length ? shown.length * 27 - 6 : -6;
          const wPill = 14 + t.length * 8;
          b.nb.appendChild(sv('g', { class: 'isl-nb-more', transform: `translate(${x0} -16)` },
            sv('rect', { rx: 11, height: 22, width: wPill, y: -11 }),
            sv('text', { x: wPill / 2, class: 'isl-nb-t' }, t)));
        }
        b.nb.appendChild(sv('rect', { class: 'isl-hit', x: -22, y: -46, width: Math.max(44, shown.length * 27 + 30), height: 52 }));
      });
    };
    if (App.social) { socChip = App.social.mapChip(() => focusId || here); root.append(socChip.el); }
    placeChip();
    const offSocial = App.social ? App.social.subscribe(() => { drawNeighbours(); if (socChip) socChip.update(); }) : null;
    drawNeighbours();
    if (App.social) App.social.mapOpened(focusId || here);

    /* ----- controls ----- */
    const ctrlBtn = (icon, label, onclick, extraCls = '') => h('button', { class: `isl-cbtn ${extraCls}`, onclick, 'aria-label': label },
      typeof icon === 'string' && icon.length <= 3 ? h('span', { class: 'isl-cicon emoji' }, icon) : h('span', { class: 'isl-cicon', html: icon }), h('span', null, label));
    const renderCtrl = () => {
      ctrl.innerHTML = '';
      const I = App.ui.ICONS;
      ctrl.append(
        ctrlBtn(I.map, '全景', () => animateTo(computeFit())),
        ctrlBtn(I.list, '清單', () => openList(goSpot)),
        ctrlBtn(I.star, '旅程', () => openJourney(goSpot)),
        ctrlBtn(ST.night ? I.moon : I.sun, ST.night ? '夜晚' : '白天', () => { ST.night = !ST.night; root.classList.toggle('night', ST.night); makeStars(); renderCtrl(); }),
        ctrlBtn(SEASON_LABEL[ST.season].icon, SEASON_LABEL[ST.season].label, () => {
          const i = SEASONS.indexOf(ST.season);
          root.classList.remove(`s-${ST.season}`);
          ST.season = SEASONS[(i + 1) % 4];
          root.classList.add(`s-${ST.season}`);
          makeFx(); renderCtrl();
          ui.toast(`${SEASON_LABEL[ST.season].icon} 換成${SEASON_LABEL[ST.season].label}`);
        }),
      );
    };

    /* ----- stars (night) & season particles ----- */
    const makeStars = () => {
      stars.innerHTML = '';
      if (!ST.night) return;
      const r = rng(99);
      for (let i = 0; i < 46; i += 1) {
        stars.appendChild(sv('circle', {
          cx: R1(r() * W), cy: R1(r() * H), r: R1(0.6 + r() * 1.3), class: 'isl-star', style: `animation-delay:${R1(-r() * 4)}s`,
        }));
      }
      stars.appendChild(sv('circle', { cx: R1(W * 0.6), cy: 38, r: 14, class: 'isl-moon' }));
      stars.appendChild(sv('circle', { cx: R1(W * 0.6 + 6), cy: 33, r: 12, class: 'm-sea-t' }));
    };
    const makeFx = () => {
      fx.innerHTML = '';
      fx.className = `isl-fx fx-${ST.season}`;
      if (reduceMotion()) return;
      const r = rng(ST.season.length * 31);
      const count = ST.season === 'summer' ? 14 : 26;
      for (let i = 0; i < count; i += 1) {
        fx.append(h('i', {
          style: {
            left: `${R1(r() * 100)}%`,
            top: ST.season === 'summer' ? `${R1(10 + r() * 80)}%` : '-4%',
            animationDuration: `${R1(7 + r() * 9)}s`,
            animationDelay: `${R1(-r() * 14)}s`,
            '--dx': `${R1((r() - 0.5) * 120)}px`,
            '--s': R1(0.6 + r() * 0.8),
          },
        }));
      }
    };
    renderCtrl(); makeStars(); makeFx();

    /* ----- ticker ----- */
    let tipIdx = Math.floor(Math.random() * D.TIPS.length);
    const showTip = () => {
      tickerText.classList.remove('in');
      void tickerText.offsetWidth;
      tickerText.textContent = D.TIPS[tipIdx % D.TIPS.length];
      tickerText.classList.add('in');
    };
    showTip();
    const tipTimer = setInterval(() => { tipIdx += 1; showTip(); }, 6500);
    ticker.addEventListener('click', () => { tipIdx += 1; showTip(); });

    /* ----- baby bubble ----- */
    const BABY_LINES = ['咿呀～', '媽媽抱抱！', '肚子餓餓 🍼', '噗噗～', '我會爬了！', '想睡覺覺…', '嘻嘻 (｡•ᴗ•｡)', '爸爸陪我玩！'];
    let bubbleTimer = 0;
    const showBubble = (target) => {
      const rr = target.getBoundingClientRect(); const pr = root.getBoundingClientRect();
      bubble.textContent = BABY_LINES[Math.floor(Math.random() * BABY_LINES.length)];
      bubble.style.left = `${R1(rr.left + rr.width / 2 - pr.left)}px`;
      bubble.style.top = `${R1(rr.top - pr.top - 6)}px`;
      bubble.classList.add('show');
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 2600);
    };

    /* ----- pointer: pan / pinch / tap ----- */
    const ptrs = new Map();
    let g0 = null; let moved = 0; let downTarget = null; let multi = false;
    const rel = (p) => { const r = svg.getBoundingClientRect(); return { x: p.x - r.left, y: p.y - r.top }; };
    const startGesture = () => {
      const pts = [...ptrs.values()];
      if (pts.length === 1) g0 = { type: 'pan', x: pts[0].x, y: pts[0].y, tx: view.tx, ty: view.ty };
      else if (pts.length >= 2) {
        const a = rel(pts[0]); const b = rel(pts[1]);
        g0 = {
          type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, k: view.k, tx: view.tx, ty: view.ty,
        };
      }
    };
    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancelAnimationFrame(anim);
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) { moved = 0; multi = false; downTarget = e.target.closest('[data-avatar],[data-nb],[data-spot],[data-baby],[data-island]'); root.classList.add('dragging'); }
      if (ptrs.size > 1) multi = true;
      startGesture();
    });
    svg.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId) || !g0) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...ptrs.values()];
      if (g0.type === 'pan' && pts.length === 1) {
        const dx = pts[0].x - g0.x; const dy = pts[0].y - g0.y;
        moved = Math.max(moved, Math.hypot(dx, dy));
        if (moved > 6) { setView({ k: view.k, tx: g0.tx + dx, ty: g0.ty + dy }); bubble.classList.remove('show'); }
      } else if (g0.type === 'pinch' && pts.length >= 2) {
        const a = rel(pts[0]); const b = rel(pts[1]);
        const d = Math.hypot(a.x - b.x, a.y - b.y); const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
        const k = Math.min(maxK(), Math.max(fitK * 0.85, g0.k * (d / g0.d)));
        const wx = (g0.mx - g0.tx) / g0.k; const wy = (g0.my - g0.ty) / g0.k;
        moved = 99;
        setView({ k, tx: mx - wx * k, ty: my - wy * k });
      }
    });
    const end = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size === 0) {
        root.classList.remove('dragging');
        if (!multi && moved <= 6 && downTarget && e.type === 'pointerup') {
          if (downTarget.dataset.avatar) App.navigate('avatar');
          else if (downTarget.dataset.nb) { if (App.social) App.social.openResidents(downTarget.dataset.nb); }
          else if (downTarget.dataset.baby) showBubble(downTarget);
          else if (downTarget.dataset.spot) goSpot(downTarget.dataset.spot);
          else if (downTarget.dataset.island) { const id = downTarget.dataset.island; if (focusId !== id) flyTo(id); openIsland(id); }
        }
        g0 = null; downTarget = null;
      } else startGesture();
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = rel({ x: e.clientX, y: e.clientY });
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    }, { passive: false });
    svg.addEventListener('dblclick', (e) => { const p = rel({ x: e.clientX, y: e.clientY }); zoomAt(p.x, p.y, 1.7, true); });
    // keyboard: spot labels are focusable via the list; +/- keys zoom; arrows move between islands
    root.tabIndex = 0;
    root.addEventListener('keydown', (e) => {
      const idx = ISLANDS.findIndex((i) => i.id === focusId);
      if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.3, true);
      else if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.3, true);
      else if (e.key === '0') animateTo(computeFit());
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && idx < ISLANDS.length - 1) flyTo(ISLANDS[idx + 1].id);
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && idx > 0) flyTo(ISLANDS[idx - 1].id);
    });
    // the island strip scrolls sideways by itself, not the map
    ['pointerdown', 'touchstart'].forEach((ev) => strip.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));

    /* ----- resize ----- */
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        const nw = root.clientWidth; const nh = root.clientHeight;
        if (!nw || !nh || (nw === W && nh === H)) return;
        const keep = focusId;
        W = nw; H = nh;
        computeFit(); nearK = islandView(here).k; lastK = null;
        Object.assign(view, clampView(islandView(keep || here)));
        apply(); makeStars(); placeChip();
      });
      ro.observe(root);
    }

    if (reduceMotion() && svg.pauseAnimations) svg.pauseAnimations();

    /* ----- first visit: a small guide card; an island that just opened: its 注意事項 and 教學 right away ----- */
    // a small chip, not a pop-up: the map stays usable; tapping it explains the islands in a sheet
    const showCoach = () => {
      coach.innerHTML = '';
      coach.append(
        h('button', { class: 'isl-coach-main', onclick: () => openTour() }, '👋 第一次來？看看怎麼玩 ›'),
        h('button', { class: 'isl-coach-x', 'aria-label': '不用了', onclick: () => dismissCoach() }, '✕'));
      coach.hidden = false;
      placeChip();
    };
    const dismissCoach = () => { coach.hidden = true; placeChip(); updIsland((x) => { x.toured = C.dateKey(); }); };
    const openTour = () => {
      const hereIsl = ISL[here];
      let sh = null;
      const body = h('div', { class: 'isl-sh isl-tour' },
        h('ol', { class: 'isl-tour-steps' },
          h('li', null, h('strong', null, '每個階段一座島'), h('span', null, '從備孕、懷孕、月子到 6 歲，一共 11 座島。')),
          h('li', null, h('strong', null, '時間到了自己開島'), h('span', null, '懷孕週數、寶寶年齡一到，下一座島就會開放，這個階段的「注意事項」和「新手教學」馬上打開。')),
          h('li', null, h('strong', null, '點島下方的名牌'), h('span', null, '看注意事項、新手教學，還有島上有哪些地點。')),
          h('li', null, h('strong', null, '逛地點、答題蓋章'), h('span', null, '讀小知識、打勾，答完小測驗就能蓋章收集。')),
          h('li', null, h('strong', null, '分享給家人'), h('span', null, '每座島都能分享、存成圖片，或下載 PDF 手冊印出來。')),
          h('li', null, h('strong', null, '💌 產檢日記島'), h('span', null, '懷孕後開放：每次產檢放超音波照片、寫一句想對寶寶說的話。'))),
        App.avatar && !App.avatar.current() ? h('button', { class: 'btn btn-soft btn-block mt', onclick: () => { sh.close(); dismissCoach(); App.navigate('avatar'); } }, '🙂 上傳正面照，做一個長得像我的 Q 版角色') : null,
        h('div', { class: 'row gap-sm mt' },
          h('button', { class: 'btn btn-primary grow', onclick: () => { sh.close(); dismissCoach(); setTimeout(() => openIsland(here), 240); } }, `看${hereIsl.name}注意事項`),
          h('button', { class: 'btn btn-ghost', onclick: () => { sh.close(); dismissCoach(); } }, '開始逛')));
      sh = ui.sheet({ title: '🏝️ 好孕群島怎麼玩', body, onClose: () => dismissCoach() });
    };
    let afterTimer = 0;
    afterTimer = setTimeout(() => {
      if (fresh.length) {
        updIsland((x) => { x.seen = x.seen || {}; fresh.forEach((i) => { x.seen[i.id] = C.dateKey(); }); });
        const latest = fresh[fresh.length - 1];
        openUnlock(latest.id, fresh.length - 1);
        if (App.homeRefresh) App.homeRefresh();
        return;
      }
      if (params && params.spot && SPOT[params.spot]) { goSpot(params.spot); return; }
      if (params && params.island && ISL[params.island]) { openIsland(params.island); return; }
      if (!islandState().toured) showCoach();
    }, fresh.length ? 650 : 200);

    cleanup = () => {
      clearInterval(tipTimer); clearTimeout(bubbleTimer); clearTimeout(afterTimer); cancelAnimationFrame(anim); cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      if (offSocial) offSocial();
      onStampChange = () => {};
      goSpotHook = null; flyHook = null;
    };
  }

  App.screen('island', {
    title: '好孕群島',
    liveUpdate: false,
    render: renderIsland,
    onLeave() { if (cleanup) { cleanup(); cleanup = null; } },
  });

  /* =========================================================
   * 島嶼手冊: one island on paper (print / save as PDF), with a QR code that brings friends in
   * ========================================================= */
  App.screen('island-guide', {
    title: '島嶼手冊',
    tab: 'island',
    actions: () => h('button', { class: 'icon-btn', 'aria-label': '列印或存成 PDF', html: ui.ICONS.print, onclick: () => window.print() }),
    render(el, params) {
      const isl = ISL[(params && params.island) || ''] || hereIsland();
      const st = statusOf(isl);
      const share = App.share;
      const url = share && share.link ? share.link({ path: 'island', params: { island: isl.id }, channel: 'pdf', campaign: `island-${isl.id}` }) : '';
      const qr = share && share.qr ? share.qr(url, 220) : '';
      const code = share && share.code ? share.code() : '';
      const brand = window.BRAND || {};
      const cite = App.src ? App.src.collector() : null;
      const mk = (...k) => (cite ? cite.mark(...k) : null);
      el.append(h('div', { class: 'no-print mb stack-sm' },
        h('button', { class: 'btn btn-primary btn-block', onclick: () => window.print() }, h('span', { class: 'ic', html: ui.ICONS.print }), '列印／存成 PDF'),
        h('div', { class: 'row gap-sm' },
          h('button', { class: 'btn btn-soft grow', onclick: () => shareIsland(isl) }, '📤 分享給家人'),
          h('button', { class: 'btn btn-soft grow', onclick: () => saveIslandImage(isl) }, '🖼️ 存成圖片'))));
      el.append(h('p', { class: 'tiny faint no-print' }, '在列印視窗選「儲存為 PDF」，就能存檔、傳給家人或印出來貼在冰箱。'));
      const doc = h('article', { class: 'isl-doc' },
        h('header', { class: 'isl-doc-head', style: { '--ic': isl.color || '#8b57a8' } },
          h('img', { src: brand.logo || 'assets/logo.svg', alt: '', class: 'isl-doc-logo' }),
          h('div', { class: 'grow' },
            h('div', { class: 'isl-doc-kicker' }, `${brand.appName || '易家做媽媽'}・好孕群島手冊`),
            h('h2', null, `${isl.emoji} ${isl.name}`),
            h('div', { class: 'small' }, `${isl.range}${isl.nick ? `・${isl.nick}` : ''}${st.open ? '' : `・${lockText(st)}`}`))),
        isl.intro ? h('p', { class: 'isl-doc-intro' }, isl.intro) : null,
        h('section', { class: 'isl-doc-sec' }, h('h3', null, '⚠️ 這個階段要注意'),
          h('ul', { class: 'isl-doc-notes' }, (isl.notes || []).map((n, i) => h('li', { class: n.urgent ? 'urgent' : '' }, h('strong', null, `${n.urgent ? '【就醫警訊】' : ''}${n.t}`), `：${n.d}`, mk(`note:${isl.id}:${i}`))))),
        isl.guide && isl.guide.steps && isl.guide.steps.length ? h('section', { class: 'isl-doc-sec' }, h('h3', null, `📖 ${isl.guide.title || '新手教學'}`, mk(`guide:${isl.id}`)),
          h('ol', null, isl.guide.steps.map((s) => h('li', null, s)))) : null,
        islandSpots(isl).map((sp) => h('section', { class: 'isl-doc-sec' },
          h('h3', null, `${sp.emoji} ${sp.name}`),
          h('p', { class: 'small' }, sp.intro),
          h('ul', null, sp.cards.map((cd, i) => h('li', null, h('strong', null, cd.t), `：${cd.d}`, mk(`card:${sp.id}:${i}`)))),
          h('div', { class: 'isl-doc-checks' }, sp.checks.map((c) => h('span', null, `☐ ${c}`))))),
        cite ? cite.footer({ print: true }) : null,
        h('footer', { class: 'isl-doc-foot' },
          qr ? h('img', { src: qr, alt: '加入易家做媽媽的 QR code', class: 'isl-doc-qr' }) : null,
          h('div', { class: 'grow' },
            h('strong', null, '掃描一起用・免費'),
            code ? h('div', { class: 'small' }, `邀請碼 ${code}`) : null,
            h('p', { class: 'tiny' }, `${DISCLAIMER}如有身體不適請就醫。`))));
      el.append(doc);
    },
  });

  /* =========================================================
   * Home cards: where you are on the archipelago; an island that just opened
   * ========================================================= */
  // 育兒 首頁: one line right under the baby (the cards further down are below the fold)
  function newIslandLine() {
    if (!islandState().seen) return null;
    const fresh = freshIslands(); if (!fresh.length) return null;
    const isl = fresh[fresh.length - 1];
    return h('button', { type: 'button', class: 'isl-new-line', style: { '--ic': isl.color || '#8b57a8' }, onclick: () => App.navigate('island', { island: isl.id }) },
      h('span', { class: 'isl-new-line-e', 'aria-hidden': 'true' }, isl.emoji),
      h('span', { class: 'grow' }, h('strong', null, `🎉 ${isl.name}開放了！`), h('span', { class: 'isl-new-line-more' }, '注意事項・教學')),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
  }
  App.homeCard('island-new', {
    stages: ['prep', 'preg', 'baby'],
    order: 5,
    render(el) {
      if (!islandState().seen) return; // never been to the islands: the regular line below is enough
      if (store.stage === 'baby' && store.baby()) return; // shown as a line under the baby instead
      const fresh = freshIslands(); if (!fresh.length) return;
      const isl = fresh[fresh.length - 1];
      el.append(h('button', {
        type: 'button', class: 'card isl-new-card', style: { '--ic': isl.color || '#8b57a8' }, onclick: () => App.navigate('island', { island: isl.id }),
      },
      h('span', { class: 'isl-new-emoji', 'aria-hidden': 'true' }, isl.emoji),
      h('span', { class: 'grow' },
        h('span', { class: 'tiny isl-new-kicker' }, `🎉 新的小島開放了・${statusOf(isl).reason || isl.range}`), h('br'),
        h('strong', null, `${isl.name}`), h('span', { class: 'small muted' }, `・先看這個階段的注意事項`)),
      h('span', { class: 'ic faint', html: App.ui.ICONS.chevron })));
    },
  });
  App.homeCard('island-progress', {
    stages: ['prep', 'preg', 'baby'],
    order: 40,
    render(el) {
      const isl = hereIsland();
      const n = islandDone(isl); const N = islandSpots(isl).length;
      const next = nextSpot();
      // one line on 首頁 (the islands have their own tab): the island you are on and its next stop
      el.append(h('button', {
        type: 'button', class: 'card isl-home-line', onclick: () => App.navigate('island', next ? { spot: next.id } : { island: isl.id }),
        'aria-label': next ? `好孕群島・${isl.name}，下一站：${pad2(next.no)} ${next.name}，這座島已蓋 ${n} / ${N} 個章` : `好孕群島・${isl.name}，開放的小島都蓋完章了`,
      },
      h('span', { class: 'isl-home-emoji', 'aria-hidden': 'true' }, next ? next.emoji : isl.emoji),
      h('span', { class: 'grow' }, h('span', { class: 'tiny muted' }, `🏝️ ${isl.name}・下一站`), h('br'), h('strong', null, next ? `${pad2(next.no)} ${next.name}` : '都蓋完章了 🎉')),
      h('span', { class: 'isl-home-count num' }, `🏅 ${n}/${N}`),
      h('span', { class: 'ic faint', html: App.ui.ICONS.chevron })));
    },
  });

  App.island = {
    openSpot, openIsland, openUnlock, newIslandLine, spots: D.SPOTS, islands: ISLANDS, statusOf, hereIsland, openIslands, freshIslands, shareIsland, saveIslandImage,
  };
}());
