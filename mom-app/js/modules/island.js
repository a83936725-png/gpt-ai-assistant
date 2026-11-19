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
      sg.appendChild(sv('path', { d: SYMS[sym], class: 'isl-sym' }));
      if (sym === 'envelope') sg.appendChild(sv('path', { d: 'M-6.8 -4.6L0 1L6.8 -4.6', class: 'isl-sym-line' }));
      g.appendChild(sg);
    }
    return [bx, cy - r];
  }

  /* =========================================================
   * Layout: tiles in "screen units" (u right, v down)
   * ========================================================= */
  const LAYOUT = [
    ['folate', -2.9, 0], ['dadgym', 0, 0], ['precheck', 2.9, 0],
    ['rhythm', 1.45, 1.45], ['@garden', -1.45, 1.45],
    ['prenatal', -2.9, 2.9], ['market', 0, 2.9], ['hospitalbag', 2.9, 2.9],
    ['lighthouse', 1.45, 4.35], ['@woods', -1.45, 4.35],
    ['hotspring', -2.9, 5.8], ['yijia', 0, 5.8], ['@harbor', 2.9, 5.8],
    ['cafe', 1.45, 7.25], ['vaccine', -1.45, 7.25],
    ['sleepforest', -2.9, 8.7], ['playland', 0, 8.7], ['post', 2.9, 8.7],
  ];
  function makeTiles() {
    const r = rng(20261115);
    return LAYOUT.map(([id, u, v], i) => {
      const ju = (r() - 0.5) * 0.22; const jv = (r() - 0.5) * 0.16;
      const [x, y] = fromUV(u + ju, v + jv);
      const decor = id.startsWith('@');
      const z = decor ? 0.28 + r() * 0.16 : 0.36 + r() * 0.26;
      return {
        id, i, x, y, z, decor, spot: decor ? null : SPOT[id], kind: decor ? id.slice(1) : SPOT[id].kind, seed: Math.floor(r() * 1e6),
      };
    });
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

  function buildScene(tiles) {
    const world = sv('g', { class: 'isl-world' });
    const waves = sv('g', { class: 'isl-waves' });
    const foams = sv('g', { class: 'isl-foams' });
    const scene = sv('g', { class: 'isl-scene' });
    const people = sv('g', { class: 'isl-people' });
    const labels = sv('g', { class: 'isl-labels' });
    world.append(waves, foams, scene, people, labels);

    // waves scattered on the sea
    const r = rng(7);
    for (let i = 0; i < 26; i += 1) {
      const u = -5.2 + r() * 10.4; const v = -2.4 + r() * 13;
      if (tiles.some((t) => { const [tu, tv] = P(t.x, t.y, 0); return Math.abs(tu / SC - u) < 1.6 && Math.abs(tv / SC - v) < 1.0; })) continue;
      waves.appendChild(sv('path', {
        d: `M${R1(u * SC)} ${R1(v * SC)}q5 -4 10 0q5 -4 10 0`, class: 'isl-wave', style: `animation-delay:${R1(-r() * 6)}s`,
      }));
    }

    // draw queue (painter's algorithm by screen depth)
    const queue = [];
    const infos = {};
    tiles.forEach((t) => {
      poly3(foams, hexPts(t.x, t.y, 0, 1.13), 'isl-foam rnd');
      queue.push({
        depth: t.x + t.y,
        draw: () => {
          const g = sv('g', { class: `isl-tile${t.spot ? ' is-spot' : ''}`, 'data-spot': t.spot ? t.spot.id : null });
          const top = hexPts(t.x, t.y, t.z, 1).map((p) => P(...p));
          const bottom = hexPts(t.x, t.y, 0, 1).map((p) => P(...p));
          const band = hexPts(t.x, t.y, t.z - 0.12, 1).map((p) => P(...p));
          poly2(g, hull(top.concat(bottom)), 'm-cliff-r rnd');
          poly2(g, hull(top.concat(band)), 'm-sand-r rnd');
          poly2(g, top, 'm-sand-t rnd');
          poly3(g, hexPts(t.x, t.y, t.z, 0.84), 'm-grass-t rnd');
          const items = [];
          const ctx = {
            g, x: t.x, y: t.y, z: t.z, seed: t.seed, add: (depth, fn) => items.push([depth, fn]), anchor: null,
          };
          (B[t.kind] || B.woods)(ctx);
          items.sort((a, b) => a[0] - b[0]).forEach(([, fn]) => fn());
          if (!ctx.anchor) ctx.anchor = P(t.x, t.y, t.z + 0.9);
          infos[t.id] = { ctx, center: P(t.x, t.y, t.z) };
          scene.appendChild(g);
        },
      });
    });
    for (let i = 1; i < tiles.length; i += 1) {
      const A = tiles[i - 1]; const Bt = tiles[i];
      queue.push({ depth: (A.x + A.y + Bt.x + Bt.y) / 2 + 0.001, draw: () => drawBridge(scene, A, Bt) });
    }
    queue.sort((a, b) => a.depth - b.depth).forEach((q) => q.draw());

    // balloon + boat (above scene, they float)
    Object.values(infos).forEach(({ ctx }) => {
      if (ctx.balloon) {
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
      if (ctx.boat) {
        const [bx, by] = ctx.boat;
        const outer = sv('g', { transform: `translate(${R1(bx)} ${R1(by)})` });
        const g = sv('g', { class: 'isl-bob' });
        poly2(g, [[-22, -6], [22, -6], [15, 4], [-15, 4]], 'm-boat-r');
        poly2(g, [[-22, -6], [22, -6], [18, -9], [-18, -9]], 'm-boat-t');
        g.appendChild(sv('line', { x1: 0, y1: -8, x2: 0, y2: -46, class: 'isl-pole' }));
        poly2(g, [[2, -44], [2, -11], [24, -12]], 'm-white-t');
        poly2(g, [[-2, -38], [-2, -12], [-17, -12]], 'm-shirtA-t');
        outer.appendChild(g);
        people.appendChild(outer);
      }
    });

    // walkers on some bridges
    const wr = rng(42);
    const shirts = ['shirtA', 'shirtB', 'shirtC', 'shirtD'];
    [0, 2, 4, 6, 8, 10, 13, 15].forEach((bi, k) => {
      const A = tiles[bi]; const Bt = tiles[bi + 1];
      if (!A || !Bt) return;
      const { s, e, inA, inB } = bridgePts(A, Bt);
      const pts = [inA, s, e, inB].map((p) => P(...p));
      const seq = pts.concat(pts.slice(0, -1).reverse()).map((p) => `${R1(p[0])} ${R1(p[1])}`).join(';');
      const g = sv('g', { class: 'isl-walker' });
      g.appendChild(sv('rect', {
        x: -2.6, y: -10, width: 5.2, height: 8, rx: 2.2, class: `m-${shirts[k % 4]}-t`,
      }));
      g.appendChild(sv('rect', { x: -2, y: -3, width: 4, height: 3.2, rx: 1, class: 'm-door-l' }));
      g.appendChild(sv('circle', { cy: -12.6, r: 2.7, class: 'm-skin-t' }));
      g.appendChild(sv('animateTransform', {
        attributeName: 'transform', type: 'translate', values: seq, dur: `${R1(20 + wr() * 14)}s`, begin: `${R1(-wr() * 20)}s`, repeatCount: 'indefinite',
      }));
      people.appendChild(g);
    });

    // crawling baby on the garden tile
    const garden = Object.values(infos).find((i) => i.ctx.babyPath);
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

    // labels
    const labelEls = [];
    D.SPOTS.forEach((spot) => {
      const info = infos[spot.id];
      if (!info) return;
      const [ax, ay] = info.ctx.anchor;
      const g = sv('g', { class: 'isl-label', 'data-spot': spot.id, transform: `translate(${R1(ax)} ${R1(ay)})` });
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
    return { world, labels, labelEls, infos, scene };
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
  const userGroups = () => D.USER_GROUPS[store.stage] || D.USER_GROUPS.prep;
  function nextSpot() {
    const st = islandState().stamps || {};
    const groups = userGroups();
    return D.SPOTS.find((s) => groups.includes(s.stage) && !st[s.id]) || D.SPOTS.find((s) => !st[s.id]) || null;
  }
  function stageTag(stage) {
    const s = D.STAGES[stage];
    return h('span', { class: 'isl-stage-tag', style: { background: `${s.color}22`, color: s.color } }, s.label);
  }

  let onStampChange = () => {};

  function quizBlock(spot) {
    const wrap = h('div', { class: 'isl-quiz' });
    let answers = [];
    let result = null;
    const finish = () => {
      const score = spot.quiz.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0);
      let isNew = false;
      store.update((s) => {
        s.island = s.island || {};
        ['stamps', 'quiz', 'visited'].forEach((k) => { s.island[k] = s.island[k] || {}; });
        s.island.quiz[spot.id] = Math.max(s.island.quiz[spot.id] || 0, score);
        if (!s.island.stamps[spot.id]) { s.island.stamps[spot.id] = C.dateKey(); isNew = true; }
      });
      result = { score, isNew };
      if (isNew) { ui.toast(`🏅 蓋章成功！獲得「${spot.name}」印章`); ui.celebrate({ emojis: ['🏅', '⭐', '✨', spot.emoji || '💜'] }); }
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
    if (!spot) return;
    if (!islandState().visited?.[id]) {
      store.update((s) => {
        s.island = s.island || {};
        s.island.visited = s.island.visited || {};
        s.island.visited[id] = C.dateKey();
      });
    }
    const stamped = !!islandState().stamps?.[id];
    const body = h('div', { class: 'isl-sh' },
      h('div', { class: 'isl-sh-hero' },
        h('div', { class: 'isl-sh-emoji', 'aria-hidden': 'true' }, spot.emoji),
        h('div', { class: 'grow' },
          h('div', { class: 'row gap-sm wrap' }, stageTag(spot.stage), stamped ? h('span', { class: 'tag ok' }, '🏅 已蓋章') : h('span', { class: 'tag' }, '尚未蓋章')),
          h('p', { class: 'isl-intro' }, spot.intro))));

    if (spot.brand) {
      const brand = window.BRAND || {};
      const canBrand = !!App.screens.brand;
      body.append(h('div', { class: 'isl-brand card soft' },
        h('img', { src: brand.logoFull || brand.logo || 'assets/logo.svg', alt: brand.brandName || '易家滴雞精', class: 'isl-brand-logo' }),
        h('p', { class: 'small' }, brand.story || ''),
        canBrand ? h('button', { class: 'btn btn-primary btn-sm', onclick: () => { sh.close(); if (App.screens.brand) App.navigate('brand'); } }, `認識${brand.brandName || '易家滴雞精'}`)
          : (brand.shopUrl ? h('a', { class: 'btn btn-primary btn-sm', href: brand.shopUrl, target: '_blank', rel: 'noopener' }, '前往官網') : null)));
    }

    body.append(h('h3', { class: 'isl-sh-h' }, '小知識'));
    body.append(h('div', { class: 'isl-know-list' }, spot.cards.map((cd) => h('div', { class: 'isl-know' }, h('strong', null, cd.t), h('p', null, cd.d)))));
    if (App.share) {
      body.append(h('div', { class: 'mt' }, App.share.button(() => ({
        sheetTitle: '分享這篇小知識', title: `${spot.name}・小知識`, campaign: `island-${spot.id}`, path: 'island', params: { spot: spot.id }, emoji: spot.emoji, kicker: '好孕島小知識', theme: 'night',
        text: `【好孕島・${spot.name}】\n${spot.cards.slice(0, 3).map((cd) => `・${cd.t}：${cd.d}`).join('\n')}`,
        lines: spot.cards.slice(0, 4).map((cd) => cd.t),
      }), { label: '分享這篇給朋友', cls: 'btn btn-sm btn-ghost btn-block' })));
    }
    body.append(h('h3', { class: 'isl-sh-h' }, '我做到了'));
    body.append(checklist(spot));
    body.append(h('h3', { class: 'isl-sh-h' }, '小測驗 ', h('span', { class: 'tiny muted' }, '完成就能蓋章')));
    body.append(quizBlock(spot));
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
    body.append(h('p', { class: 'disclaimer' }, DISCLAIMER));
    const sh = ui.sheet({ title: `${pad2(spot.no)} ${spot.name}`, body });
    return sh;
  }

  function openList(onPick) {
    const st = islandState().stamps || {};
    const groups = userGroups();
    const body = h('div', { class: 'stack-sm' });
    Object.entries(D.STAGES).forEach(([key, stg]) => {
      const spots = D.SPOTS.filter((s) => s.stage === key);
      if (!spots.length) return;
      body.append(h('div', { class: 'isl-list-h' }, stageTag(key), groups.includes(key) ? h('span', { class: 'tiny muted' }, '・你的階段') : null));
      body.append(h('div', { class: 'list' }, spots.map((s) => h('button', {
        class: 'list-item', onclick: () => { sh.close(); onPick(s.id); },
      },
      h('span', { class: 'li-icon' }, s.emoji),
      h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, `${pad2(s.no)} ${s.name}`), h('div', { class: 'li-sub' }, s.intro)),
      h('span', { class: 'li-right' }, st[s.id] ? '🏅' : h('span', { class: 'tiny faint' }, '未蓋章'))))));
    });
    body.append(h('p', { class: 'disclaimer' }, DISCLAIMER));
    const sh = ui.sheet({ title: '島上地點', body });
  }

  function openJourney(onPick) {
    const st = islandState().stamps || {};
    const n = stampCount(); const N = D.SPOTS.length;
    const groups = userGroups();
    const next = nextSpot();
    const body = h('div', { class: 'stack' },
      h('div', { class: 'card soft isl-jr-top' },
        h('div', { class: 'row between' },
          h('div', null, h('div', { class: 'tiny muted' }, '我的稱號'), h('div', { class: 'isl-jr-title' }, titleFor(n))),
          h('div', { class: 'center' }, h('div', { class: 'big-num' }, `${n}`, h('small', { class: 'small muted' }, ` / ${N}`)), h('div', { class: 'tiny muted' }, '已蓋章'))),
        ui.progress(n / N),
        next ? h('button', { class: 'btn btn-primary btn-sm mt', onclick: () => { sh.close(); onPick(next.id); } }, `下一站：${pad2(next.no)} ${next.name}`)
          : h('p', { class: 'small mt' }, '🎉 全部蓋章完成，你就是好孕島主！')));
    Object.entries(D.STAGES).forEach(([key, stg]) => {
      const spots = D.SPOTS.filter((s) => s.stage === key);
      const done = spots.filter((s) => st[s.id]).length;
      body.append(h('div', { class: `isl-jr-row${groups.includes(key) ? ' mine' : ''}` },
        h('div', { class: 'row between' }, h('div', { class: 'row gap-sm' }, stageTag(key), groups.includes(key) ? h('span', { class: 'tiny muted' }, '你的階段') : null), h('span', { class: 'small muted num' }, `${done}/${spots.length}`)),
        h('div', { class: 'isl-stamps' }, spots.map((s) => h('button', {
          class: `isl-stamp-chip${st[s.id] ? ' got' : ''}`, onclick: () => { sh.close(); onPick(s.id); }, 'aria-label': `${s.name}${st[s.id] ? '（已蓋章）' : ''}`,
        }, h('span', { class: 'isl-stamp-emoji' }, s.emoji), h('span', { class: 'tiny' }, s.name))))));
    });
    const sh = ui.sheet({ title: '我的好孕旅程', body });
  }

  /* =========================================================
   * Screen
   * ========================================================= */
  let cleanup = null;

  function renderIsland(el, params) {
    if (cleanup) { cleanup(); cleanup = null; }
    injectCSS();
    if (ST.night === null) ST.night = defaultNight();
    if (!ST.season) ST.season = defaultSeason();

    const tiles = makeTiles();
    const svg = sv('svg', { class: 'isl-svg', role: 'img', 'aria-label': '好孕島地圖，點選地點查看內容' });
    const sea = sv('rect', { class: 'm-sea-t isl-sea', x: 0, y: 0, width: '100%', height: '100%' });
    const stars = sv('g', { class: 'isl-stars' });
    const built = buildScene(tiles);
    const grad = (id, o1, o2) => sv('linearGradient', { id, x1: 0, x2: 1, y1: 0, y2: 0 },
      sv('stop', { offset: 0, 'stop-color': '#fff6c2', 'stop-opacity': o1 }),
      sv('stop', { offset: 1, 'stop-color': '#fff6c2', 'stop-opacity': o2 }));
    const defs = sv('defs', null, grad('isl-beam-r', 0.9, 0), grad('isl-beam-l', 0, 0.9));
    svg.append(defs, sea, stars, built.world);

    const fx = h('div', { class: 'isl-fx', 'aria-hidden': 'true' });
    const bubble = h('div', { class: 'isl-bubble', 'aria-live': 'polite' });
    const hud = h('button', { class: 'isl-hud' });
    const ctrl = h('div', { class: 'isl-ctrl' });
    const tickerText = h('span', { class: 'isl-ticker-text' });
    const ticker = h('button', { class: 'isl-ticker', 'aria-label': '下一則好孕小報' }, h('span', { class: 'isl-ticker-tag' }, '好孕小報'), tickerText);
    const root = h('div', { class: `isl s-${ST.season}${ST.night ? ' night' : ''}` }, svg, fx, hud, ctrl, ticker, bubble);
    el.append(root);

    /* ----- view transform ----- */
    let W = root.clientWidth || 360; let H = root.clientHeight || 600;
    const bb = built.scene.getBBox();
    const bbox = { x: bb.x - 20, y: bb.y - 50, w: bb.width + 40, h: bb.height + 60 };
    // leave room for the HUD (top), ticker (bottom) and the control column (right, on phones)
    const PAD = { t: 64, b: 56, l: 6, r: W < 600 ? 34 : 8 };
    let fitK = 1;
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
    const clampView = (v) => {
      const k = Math.min(fitK * 4, Math.max(fitK * 0.85, v.k));
      const minTx = W / 2 - (bbox.x + bbox.w) * k; const maxTx = W / 2 - bbox.x * k;
      const minTy = H / 2 - (bbox.y + bbox.h) * k; const maxTy = H / 2 - bbox.y * k;
      return { k, tx: Math.min(maxTx, Math.max(minTx, v.tx)), ty: Math.min(maxTy, Math.max(minTy, v.ty)) };
    };
    let lastK = null;
    const apply = () => {
      built.world.setAttribute('transform', `translate(${R1(view.tx)} ${R1(view.ty)}) scale(${view.k.toFixed(4)})`);
      if (view.k !== lastK) {
        lastK = view.k;
        // labels keep a constant on-screen size, slightly smaller in the zoomed-out overview
        const rel = view.k / (fitK || view.k);
        const s = ((1 / view.k) * Math.min(1, Math.max(0.88, 0.88 + (rel - 1) * 0.25))).toFixed(4);
        built.labelEls.forEach((l) => l.inner.setAttribute('transform', `scale(${s})`));
      }
      ST.view = { ...view }; ST.size = { W, H };
    };
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(); }); };
    const setView = (v) => { Object.assign(view, clampView(v)); schedule(); };
    let anim = 0;
    const animateTo = (target, ms = 380) => {
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
    const fit = computeFit();
    if (ST.view && ST.size && ST.size.W === W && ST.size.H === H) Object.assign(view, clampView(ST.view));
    else Object.assign(view, fit);
    apply();

    const zoomAt = (sx, sy, f, animated = false) => {
      const k = Math.min(fitK * 4, Math.max(fitK * 0.85, view.k * f));
      const wx = (sx - view.tx) / view.k; const wy = (sy - view.ty) / view.k;
      const target = { k, tx: sx - wx * k, ty: sy - wy * k };
      if (animated) animateTo(target, 260); else setView(target);
    };
    const focusSpot = (id) => {
      const info = built.infos[id];
      if (!info) return;
      const [cx, cy] = info.center;
      const k = Math.max(view.k, fitK * 1.8);
      animateTo({ k, tx: W / 2 - cx * k, ty: H * 0.3 - cy * k });
    };
    const goSpot = (id) => { focusSpot(id); setTimeout(() => openSpot(id), reduceMotion() ? 0 : 260); };

    /* ----- marks (stamped / current stage) ----- */
    const updateMarks = () => {
      const st = islandState().stamps || {};
      const groups = userGroups();
      built.labelEls.forEach((l) => {
        const nmW = l.nm.getComputedTextLength ? l.nm.getComputedTextLength() : l.spot.name.length * 13;
        const noW = l.no.getComputedTextLength ? l.no.getComputedTextLength() : 14;
        const w = Math.ceil(10 + noW + 5 + nmW + 11);
        l.pill.setAttribute('x', -w / 2); l.pill.setAttribute('width', w);
        l.no.setAttribute('x', -w / 2 + 10); l.nm.setAttribute('x', -w / 2 + 10 + noW + 5);
        l.badge.setAttribute('transform', `translate(${w / 2 - 3} -33)`);
        l.g.classList.toggle('stamped', !!st[l.spot.id]);
        l.g.classList.toggle('cur', groups.includes(l.spot.stage));
      });
      const n = stampCount();
      const next = nextSpot();
      hud.innerHTML = '';
      hud.append(
        h('span', { class: 'isl-hud-top' }, h('strong', null, `🏅 ${n}/${D.SPOTS.length}`), h('span', { class: 'isl-hud-title' }, titleFor(n))),
        h('span', { class: 'isl-hud-next' }, next ? `下一站 ${pad2(next.no)} ${next.name}` : '全部蓋章完成 🎉'),
      );
      hud.onclick = () => (next ? goSpot(next.id) : openJourney(goSpot));
      hud.setAttribute('aria-label', next ? `已蓋章 ${n} 個，前往下一站 ${next.name}` : '查看旅程');
    };
    onStampChange = updateMarks;
    updateMarks();

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
      if (ptrs.size === 1) { moved = 0; multi = false; downTarget = e.target.closest('[data-spot],[data-baby]'); root.classList.add('dragging'); }
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
        const k = Math.min(fitK * 4, Math.max(fitK * 0.85, g0.k * (d / g0.d)));
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
          if (downTarget.dataset.baby) showBubble(downTarget);
          else if (downTarget.dataset.spot) goSpot(downTarget.dataset.spot);
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
    // keyboard: spot labels are focusable via the list; +/- keys zoom
    root.tabIndex = 0;
    root.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.3, true);
      else if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.3, true);
      else if (e.key === '0') animateTo(computeFit());
    });

    /* ----- resize ----- */
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        const nw = root.clientWidth; const nh = root.clientHeight;
        if (!nw || !nh || (nw === W && nh === H)) return;
        const wasFit = Math.abs(view.k - fitK) < 1e-3;
        W = nw; H = nh;
        const f = computeFit();
        if (wasFit) Object.assign(view, f); else Object.assign(view, clampView(view));
        apply(); makeStars();
      });
      ro.observe(root);
    }

    if (reduceMotion() && svg.pauseAnimations) svg.pauseAnimations();

    if (params && params.spot && SPOT[params.spot]) setTimeout(() => goSpot(params.spot), 150);

    cleanup = () => {
      clearInterval(tipTimer); clearTimeout(bubbleTimer); cancelAnimationFrame(anim); cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      onStampChange = () => {};
    };
  }

  App.screen('island', {
    title: '好孕島',
    liveUpdate: false,
    render: renderIsland,
    onLeave() { if (cleanup) { cleanup(); cleanup = null; } },
  });

  /* =========================================================
   * Home card
   * ========================================================= */
  App.homeCard('island-progress', {
    stages: ['prep', 'preg', 'baby'],
    order: 40,
    render(el) {
      const n = stampCount(); const N = D.SPOTS.length;
      const next = nextSpot();
      // one line on 首頁 (the island has its own tab): where to go next, and how many stamps so far
      el.append(h('button', {
        type: 'button', class: 'card isl-home-line', onclick: () => App.navigate('island', next ? { spot: next.id } : {}),
        'aria-label': next ? `好孕島下一站：${pad2(next.no)} ${next.name}，已蓋 ${n} / ${N} 個章` : `好孕島全部蓋章完成（${N} 個）`,
      },
      h('span', { class: 'isl-home-emoji', 'aria-hidden': 'true' }, next ? next.emoji : '🏝️'),
      h('span', { class: 'grow' }, h('span', { class: 'tiny muted' }, '🏝️ 好孕島・下一站'), h('br'), h('strong', null, next ? `${pad2(next.no)} ${next.name}` : '全部蓋章完成 🎉')),
      h('span', { class: 'isl-home-count num' }, `🏅 ${n}/${N}`),
      h('span', { class: 'ic faint', html: App.ui.ICONS.chevron })));
    },
  });

  App.island = { openSpot, spots: D.SPOTS };
}());
