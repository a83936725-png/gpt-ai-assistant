/* 旅圖 eSIM：前端邏輯。資料存在瀏覽器 localStorage（示範版），地圖用 d3 + world-atlas。 */
(function main() {
  const {
    ELEMENTS, REGIONS, RATES, COUNTRIES, DESTS, PACKS, HOMES, WIKI, PLAN_TYPES, POLICY, CULTURE, WORLD, DAY_COST,
  } = window.TRAVEL_DATA;

  const CONFIG = {
    brand: '旅圖 eSIM', esimUrl: 'https://www.ccesim.com/', ai: false, years: [2025, 2026],
  };
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- helpers
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const TODAY = ymd(new Date());
  const parseDate = (s) => new Date(`${s}T00:00:00`);
  const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000) + 1;
  const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); };
  const md = (s) => { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const fmt = (n) => Math.round(n).toLocaleString('zh-TW');
  const fmtKm = (km) => (km < 10 ? `${km.toFixed(1)} 公里` : `${fmt(km)} 公里`);
  const sum = (list, fn) => list.reduce((s, x) => s + (fn(x) || 0), 0);
  const uid = () => Math.random().toString(36).slice(2, 10);
  // Emoji flags only for plain text (select options, share text). Everywhere else real flag images
  // (web/flags, MIT): Windows shows emoji flags as two letters.
  const flagText = (code) => (code && code.length === 2
    ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '');
  const flagSrc = (code) => `flags/${String(code).toLowerCase()}.svg`;
  const flag = (code, cls = '') => (/^[A-Za-z]{2}$/.test(code || '')
    ? `<img class="fl ${cls}" src="${flagSrc(code)}" alt="" loading="lazy" decoding="async">` : `<span class="fl fl-none ${cls}"></span>`);
  const gmaps = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const gsearch = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const haversine = (a, b) => {
    const r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r;
    const dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  const toast = (msg) => {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  };

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(`tm:${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(`tm:${key}`, JSON.stringify(value)); } catch { /* storage blocked */ }
    },
  };

  const NUM = {};
  Object.entries(COUNTRIES).forEach(([code, c]) => { NUM[c.n] = { ...c, code }; });
  // Every other country on the map, by its map id (web/travel-geo.js), with its name in Traditional Chinese.
  const ZH_REGION = (() => { try { return new Intl.DisplayNames(['zh-TW'], { type: 'region' }); } catch { return null; } })();
  const N2CODE = {};
  Object.entries(window.TRAVEL_GEO || {}).forEach(([n, g]) => { if (!/^x/.test(n)) [N2CODE[n]] = g; });
  const DEST = Object.fromEntries(DESTS.map((d) => [d.id, d]));
  const el = (key) => ELEMENTS[key] || { label: key, icon: '•' };
  const TAG_COLORS = {
    food: ['#ff8a3d', '#e2453c'], culture: ['#b5651d', '#7a3b12'], nature: ['#2fb36d', '#11704a'], island: ['#19b5d8', '#1463ff'],
    city: ['#6a5cff', '#2b2e8f'], shopping: ['#ff5fa2', '#b0306f'], onsen: ['#ff7e6b', '#a8435a'], snow: ['#6fb7ff', '#3a5bd9'],
    family: ['#ffb020', '#ef6c00'], night: ['#5b3cc4', '#1b1446'], art: ['#e05297', '#6c2bd9'], adventure: ['#3aa45a', '#0f5e6e'],
  };
  // Small line icons for the few places that need a picture (empty states, quick actions).
  const ICONS = {
    plane: '<path d="M2 16l20-6-20-6 3 6-3 6zM5 10h9"/>',
    cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.7a1.5 1.5 0 0 0 1.5-1.1L21 7.5H6"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16M8 7h7"/>',
    gift: '<rect x="3" y="9" width="18" height="12" rx="1.5"/><path d="M12 9v12M3 13h18M12 9c-2-4-6-4-6-1.5S10 9 12 9zm0 0c2-4 6-4 6-1.5S14 9 12 9z"/>',
    calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    flight: '<path d="M10.5 21l1.8-1.2V14l7.7 3v-2l-7.7-5.2V4.5a1.3 1.3 0 0 0-2.6 0v5.3L2 15v2l7.7-3v5.8z"/>',
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  };
  const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  // Tags are a colored dot plus the label; no emoji (they read as template UI).
  const dot = (k) => `<i class="dot" style="background:${(TAG_COLORS[k] || ['var(--brand)'])[0]}"></i>`;
  const tagChip = (k, extra = '') => `<span class="chip tag">${dot(k)}${(ELEMENTS[k] || { label: k }).label}${extra}</span>`;

  // ---------- small realistic pictures for the travel elements, starting points and filters.
  // Gradients are defined once in <svg class="art-defs"> in travel.html; each picture moves while its chip is picked.
  const STEAM = '<g class="steam"><path d="M8 9.5c-1.2-1.4 1.2-2.4 0-4"/><path d="M12 9c-1.2-1.4 1.2-2.4 0-4"/><path d="M16 9.5c-1.2-1.4 1.2-2.4 0-4"/></g>';
  const PICS = {
    food: `${STEAM}<ellipse cx="12" cy="12.5" rx="8.5" ry="2" fill="url(#g-broth)"/><path d="M6 12.6c1-.8 2 .8 3 0s2 .8 3 0 2 .8 3 0 2 .8 3 0" fill="none" stroke="#fff1c2" stroke-width=".9"/><path d="M9.6 12.4L19.6 3.2M11 12.8L21.4 4.2" stroke="#8a5a2b" stroke-width="1.1" stroke-linecap="round"/><path d="M3.5 12.5h17a8.5 8 0 0 1-17 0z" fill="url(#g-bowl)"/><path d="M4.6 15.3h14.8" stroke="rgba(255,255,255,.55)" stroke-width=".8" stroke-dasharray="1.4 1"/><path d="M5.8 14.6c.9 2.4 2.6 4 4.8 4.8" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1" stroke-linecap="round"/><rect x="9" y="20.2" width="6" height="1.5" rx=".6" fill="#8e1b16"/>`,
    culture: '<path d="M6.1 9.6h2l.4 10.8H5.7z" fill="url(#g-torii-h)"/><path d="M15.9 9.6h2l.4 10.8h-2.8z" fill="url(#g-torii-h)"/><rect x="3.6" y="8.2" width="16.8" height="1.5" fill="url(#g-torii)"/><rect x="11.2" y="9.5" width="1.6" height="2" fill="url(#g-torii)"/><rect x="3.8" y="11.3" width="16.4" height="1.6" rx=".3" fill="url(#g-torii)"/><path d="M1.8 5c3.2 1 6.6 1.4 10.2 1.4S19 6 22.2 5l-.7 2.3c-3 .8-6.1 1.1-9.5 1.1s-6.5-.3-9.5-1.1z" fill="#262626"/><rect x="5.1" y="20" width="3.8" height="1.8" rx=".4" fill="#262626"/><rect x="15.1" y="20" width="3.8" height="1.8" rx=".4" fill="#262626"/><path class="petal" d="M19.5 2.5c1 .1 1.5.9 1.1 1.5-.5.6-1.4.5-1.7-.2z" fill="#ffa8c2"/>',
    nature: '<circle cx="18" cy="6.2" r="2.8" fill="url(#g-sun)"/><path d="M10.5 21.5L16.8 10l6.7 11.5z" fill="#7488ab"/><path d="M16.8 10l6.7 11.5h-4z" fill="rgba(20,30,60,.2)"/><path d="M.5 21.5L9.5 5.5l9 16z" fill="url(#g-mtn)"/><path d="M9.5 5.5l9 16h-6.2z" fill="rgba(20,30,60,.22)"/><path d="M9.5 5.5l3 5.4-1.5-.9-1.5 1.3-1.4-1.3-1.6.9z" fill="url(#g-snowcap)"/><g class="cloud" fill="#fff"><ellipse cx="8" cy="9.4" rx="3" ry="1.2"/><ellipse cx="9.2" cy="8.6" rx="1.8" ry="1.3"/></g><path d="M0 21.2c4-2.6 8-3 12-1.7s8 1.2 12-.3V23H0z" fill="url(#g-grass)"/>',
    island: '<rect x=".5" y="16" width="23" height="6.5" rx="3" fill="url(#g-sea)"/><path class="wave" d="M-6 19.8q1.5-1 3 0t3 0 3 0 3 0 3 0 3 0 3 0 3 0 3 0 3 0 3 0" fill="none" stroke="rgba(255,255,255,.75)" stroke-width=".8"/><ellipse cx="10.5" cy="16.8" rx="7.5" ry="2.4" fill="url(#g-sand)"/><path d="M10.4 16.4c.4-3.6 1.6-6.8 3.8-9.4l.9.6c-1.9 2.6-3 5.5-3.3 8.8z" fill="url(#g-trunk)"/><g class="fronds" fill="url(#g-leaf)"><path d="M14.6 7.2C12.2 5.6 9.6 5.8 8 7.6c2.2-.6 4.4-.3 6.6-.4z"/><path d="M14.6 7.2c-.6-2.6-2.6-4-5-3.8 2 .9 3.6 2.2 5 3.8z"/><path d="M14.6 7.2c1.2-2.4 3.6-3.2 6-2.4-2.2.2-4.2 1-6 2.4z"/><path d="M14.6 7.2c2.6-.8 5-.1 6.4 2-2.1-.9-4.2-1.4-6.4-2z"/><circle cx="14.2" cy="7.8" r=".8" fill="#6b4320"/><circle cx="15.2" cy="8" r=".7" fill="#7a4b22"/></g>',
    city: '<rect x="1.5" y="10" width="5" height="11.5" fill="url(#g-bldg2)"/><rect x="15" y="7.5" width="5" height="14" fill="url(#g-bldg2)"/><path d="M9.5 1v2.5" stroke="#56688f" stroke-width=".7"/><path d="M6 21.5V5.5l3.5-2 3.5 2v16z" fill="url(#g-bldg)"/><rect x="12.5" y="12" width="4.5" height="9.5" fill="url(#g-bldg)"/><rect x="18.8" y="14" width="4.2" height="7.5" fill="url(#g-bldg)"/><g class="wins" fill="#ffd76a"><rect x="7.2" y="7.5" width=".9" height="1"/><rect x="10.6" y="7.5" width=".9" height="1"/><rect x="8.9" y="10" width=".9" height="1"/><rect x="7.2" y="12.5" width=".9" height="1"/><rect x="10.6" y="12.5" width=".9" height="1"/><rect x="8.9" y="15" width=".9" height="1"/><rect x="10.6" y="17.5" width=".9" height="1"/><rect x="7.2" y="17.5" width=".9" height="1"/><rect x="13.5" y="13.5" width=".9" height="1"/><rect x="15.4" y="15.8" width=".9" height="1"/><rect x="13.5" y="18" width=".9" height="1"/><rect x="2.8" y="12" width=".9" height="1"/><rect x="4.6" y="14.5" width=".9" height="1"/><rect x="2.8" y="17" width=".9" height="1"/><rect x="16.3" y="9.5" width=".9" height="1"/><rect x="20" y="16" width=".9" height="1"/><rect x="21.6" y="18.4" width=".9" height="1"/></g><rect x=".5" y="21.3" width="23" height="1.2" rx=".6" fill="#3a4866"/>',
    shopping: '<g class="bag"><path d="M4.5 8.5h15l-1 13H5.5z" fill="url(#g-bag)"/><path d="M16 8.5h3.5l-1 13h-3.1z" fill="rgba(0,0,0,.14)"/><rect x="4.5" y="8.5" width="15" height="1.2" fill="rgba(255,255,255,.28)"/><path d="M8.5 10.8V6.5a3.5 3.5 0 0 1 7 0v4.3" fill="none" stroke="#9e244d" stroke-width="1.3" stroke-linecap="round"/><circle cx="8.5" cy="10.8" r=".7" fill="#7d1c3e"/><circle cx="15.5" cy="10.8" r=".7" fill="#7d1c3e"/><path d="M12 13.3l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3z" fill="rgba(255,255,255,.9)"/></g>',
    onsen: `${STEAM}<path d="M3 12.5h18l-1.5 9H4.5z" fill="url(#g-wood)"/><path d="M3.5 15.3h17M4.1 18.8h15.8" stroke="#6b3f16" stroke-width=".8"/><path d="M7.5 12.5l.6 9M12 12.5v9M16.5 12.5l-.6 9" stroke="rgba(90,50,15,.35)" stroke-width=".5"/><ellipse cx="12" cy="12.5" rx="9" ry="1.9" fill="url(#g-water)" stroke="#9a6430" stroke-width=".8"/><ellipse class="ripple" cx="12" cy="12.5" rx="3" ry=".6" fill="none" stroke="rgba(255,255,255,.85)" stroke-width=".5"/>`,
    snow: '<g class="flakes" fill="#9fb8e3"><circle cx="4" cy="3" r=".8"/><circle cx="10" cy="5" r=".7"/><circle cx="16" cy="2.5" r=".9"/><circle cx="20.5" cy="6" r=".7"/><circle cx="7" cy="9" r=".6"/><circle cx="14" cy="8.5" r=".7"/></g><path d="M0 22.5c2.5-6 7.5-9.5 12.5-9.5S21.5 16 24 19.5v3z" fill="url(#g-snowhill)" stroke="#b6c7e3" stroke-width=".5"/><path d="M9.8 12.8l2.6 5.4H7.2zM9.8 15.6l3.9 6.2H5.9z" fill="url(#g-pine)"/><path d="M9.8 12.8l1 2.1c-.6-.25-1.4-.25-2 0z" fill="#fff"/><rect x="9.3" y="21.8" width="1" height="1.2" fill="#6b4320"/><path d="M17.6 14.6l1.8 3.6h-3.6zM17.6 16.4l2.6 4.2h-5.2z" fill="url(#g-pine)"/><path d="M17.6 14.6l.7 1.4c-.45-.2-.95-.2-1.4 0z" fill="#fff"/><rect x="17.2" y="20.6" width=".8" height="1" fill="#6b4320"/>',
    family: '<path d="M12 10.5l-4.6 11.2M12 10.5l4.6 11.2" stroke="#3b5b94" stroke-width="1.2" stroke-linecap="round"/><rect x="5" y="21.2" width="14" height="1.3" rx=".65" fill="#3b5b94"/><g class="wheel"><circle cx="12" cy="10.5" r="7.6" fill="none" stroke="#5b7db8" stroke-width="1"/><circle cx="12" cy="10.5" r="5" fill="none" stroke="#a9bde0" stroke-width=".5"/><path d="M12 2.9v15.2M4.4 10.5h15.2M6.6 5.1l10.8 10.8M17.4 5.1L6.6 15.9" stroke="#a9bde0" stroke-width=".5"/><circle cx="12" cy="2.9" r="1.4" fill="#ff6b6b"/><circle cx="17.4" cy="5.1" r="1.4" fill="#ffd43b"/><circle cx="19.6" cy="10.5" r="1.4" fill="#51cf66"/><circle cx="17.4" cy="15.9" r="1.4" fill="#339af0"/><circle cx="12" cy="18.1" r="1.4" fill="#cc5de8"/><circle cx="6.6" cy="15.9" r="1.4" fill="#ff922b"/><circle cx="4.4" cy="10.5" r="1.4" fill="#20c997"/><circle cx="6.6" cy="5.1" r="1.4" fill="#f06595"/></g><circle cx="12" cy="10.5" r="1.3" fill="#2f4a7a"/>',
    night: '<circle cx="14" cy="8.2" r="7.5" fill="url(#g-moonglow)"/><path d="M14.5 2.6A6.2 6.2 0 1 0 20.2 12.9A7 7 0 0 1 14.5 2.6z" fill="url(#g-moon)"/><g class="stars" fill="#ffcf3a"><path d="M4.5 3.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"/><path d="M21 2l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"/><path d="M7.5 9.6l.35.9.9.35-.9.35-.35.9-.35-.9-.9-.35.9-.35z"/></g><path d="M1 22.5V17h2.5v-2h2v3H8v-5h3v9.5h1.5V15h2.5v2h2v-3.5h2.5V18H21v-1.5h2v6z" fill="url(#g-night)"/><g fill="#ffd76a"><rect x="9" y="15" width=".8" height=".8"/><rect x="9" y="17.5" width=".8" height=".8"/><rect x="13.3" y="17" width=".8" height=".8"/><rect x="18.2" y="15.5" width=".8" height=".8"/><rect x="3.3" y="18.5" width=".8" height=".8"/></g>',
    art: '<path d="M12 3C6.5 3 2.5 6.8 2.5 11.6c0 4.7 3.9 8.4 8.6 8.4 1.6 0 2.4-.9 2.4-2s-.8-1.6-.8-2.6c0-1 .8-1.6 1.9-1.6h2.2c2.9 0 5.2-2.1 5.2-5C22 5.9 17.6 3 12 3z" fill="url(#g-wood)"/><ellipse cx="7.6" cy="15" rx="1.4" ry="1.1" fill="rgba(80,45,15,.5)"/><circle cx="6.6" cy="10" r="1.6" fill="#e03131"/><circle cx="10.5" cy="6.6" r="1.6" fill="#1c7ed6"/><circle cx="15.5" cy="6.8" r="1.6" fill="#fab005"/><circle cx="18.6" cy="10.4" r="1.5" fill="#2f9e44"/><g fill="rgba(255,255,255,.6)"><circle cx="6.1" cy="9.5" r=".45"/><circle cx="10" cy="6.1" r=".45"/><circle cx="15" cy="6.3" r=".45"/><circle cx="18.1" cy="9.9" r=".45"/></g><g class="brush"><path d="M12.6 22.4l6.6-8.6 1.2 1-6.1 8.8z" fill="#8a5a2b"/><path d="M19.2 13.8l1.2-1.5 1.2 1-1.2 1.5z" fill="#c0c7d2"/><path d="M20.4 12.3c.2-1.2 1-2.2 2.3-2.6.1 1.3-.3 2.6-1.1 3.6z" fill="#e03131"/></g>',
    adventure: '<path d="M10 5L9 3M10 5l1-2" stroke="#7a4b22" stroke-width=".7" stroke-linecap="round"/><path d="M2 21.2L10 5l8 16.2z" fill="url(#g-tent)"/><path d="M10 5l8 16.2h-5z" fill="rgba(0,0,0,.16)"/><path d="M10 11.5l-3.2 9.7h6.4z" fill="#6e2a05"/><path d="M10 11.5l3.2 9.7h-1.8z" fill="#ff9f43"/><path d="M.8 21.6h22.4" stroke="#5c940d" stroke-width="1.4" stroke-linecap="round"/><path d="M17.6 21.6l4.6-1.5M17.6 20.1l4.6 1.5" stroke="#6b3f16" stroke-width="1.1" stroke-linecap="round"/><path class="flame" d="M19.9 20.4c-1.7-.5-2-2.4-.7-3.9.1 1 .7 1.4 1 1.2-.4-1.4.3-2.7 1.5-3.3-.3 1.4.9 2.3 1 3.5.2 1.5-.9 2.5-2.8 2.5z" fill="url(#g-fire)"/>',
    gps: '<ellipse class="pulse" cx="12" cy="20.6" rx="5.5" ry="1.8" fill="none" stroke="#e03131" stroke-width=".8"/><ellipse cx="12" cy="20.6" rx="2.2" ry=".8" fill="rgba(0,0,0,.28)"/><g class="pin"><path d="M12 20.3c-.5 0-6.5-6.2-6.5-10.8a6.5 6.5 0 0 1 13 0c0 4.6-6 10.8-6.5 10.8z" fill="url(#g-pin)"/><circle cx="12" cy="9.5" r="2.4" fill="#fff"/><path d="M8.2 7.6a4.4 4.4 0 0 1 2.8-2.7" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1" stroke-linecap="round"/></g>',
    home: '<g class="smoke" fill="#c3cad6"><circle cx="16.8" cy="3.2" r="1"/><circle cx="17.8" cy="1.6" r=".8"/></g><rect x="15.6" y="4.4" width="2.4" height="4.4" fill="#8a3a22"/><path d="M4.5 11.6L12 5.4l7.5 6.2V21h-15z" fill="url(#g-wall)"/><path d="M1.8 12.2L12 3.6l10.2 8.6-1.3 1.4L12 6.1l-8.9 7.5z" fill="url(#g-roof)"/><rect x="10" y="14.6" width="4" height="6.4" rx=".6" fill="#8a5a2b"/><circle cx="13.1" cy="18" r=".35" fill="#ffd76a"/><g class="lamp" fill="#ffd76a"><rect x="5.9" y="13" width="2.8" height="2.8" rx=".3"/><rect x="15.3" y="13" width="2.8" height="2.8" rx=".3"/></g><path d="M7.3 13v2.8M5.9 14.4h2.8M16.7 13v2.8M15.3 14.4h2.8" stroke="#fff" stroke-width=".4"/><rect x="2.5" y="20.6" width="19" height="1.5" rx=".75" fill="url(#g-grass)"/>',
    plane: '<g transform="rotate(-18 12 12)"><g class="jet"><path class="trail" d="M-4 12.7h6" stroke="rgba(140,160,195,.7)" stroke-width=".9" stroke-dasharray="1.2 1" stroke-linecap="round"/><path d="M10.4 12L7.6 5.4h1.8l5.6 6.6z" fill="#c4cfdf" stroke="#8d9bb3" stroke-width=".35"/><path d="M2.8 12.7c0-.7.6-1.3 1.4-1.3h15c1.8 0 3.4.6 3.4 1.3S21 14 19.2 14h-15c-.8 0-1.4-.6-1.4-1.3z" fill="url(#g-plane)" stroke="#8d9bb3" stroke-width=".35"/><path d="M4.4 11.6L2.9 7.6h1.6l2.9 4z" fill="#1463ff"/><path d="M12.2 12.4h6" stroke="#5c6f91" stroke-width=".6" stroke-dasharray=".6 .7"/><path d="M20 12.2h1.5" stroke="#34425e" stroke-width=".7" stroke-linecap="round"/><path d="M10.4 13.3l-2.8 6.6h1.8l5.6-6.6z" fill="url(#g-plane)" stroke="#8d9bb3" stroke-width=".35"/><path d="M4.6 13.8l-1.5 2.3h1.5l2.4-2.3z" fill="#1046c4"/></g></g>',
    ticket: '<g transform="rotate(-12 12 12)"><path d="M2.5 7.5h13v9h-13v-3a1.5 1.5 0 0 0 0-3z" fill="url(#g-ticket)"/><path d="M5 10.6h7.5M5 13.2h5" stroke="rgba(255,255,255,.9)" stroke-width="1.1" stroke-linecap="round"/><g class="stub"><path d="M15.5 7.5h6v3a1.5 1.5 0 0 0 0 3v3h-6z" fill="url(#g-ticket2)"/><path d="M18.5 10.4l.5 1 1.1.15-.8.75.2 1.1-1-.5-1 .5.2-1.1-.8-.75 1.1-.15z" fill="rgba(255,255,255,.9)"/></g><path d="M15.5 7.9v8.2" stroke="rgba(255,255,255,.85)" stroke-width=".7" stroke-dasharray="1 .8"/></g>',
    coins: '<path d="M5 19v1.6a6 2.2 0 0 0 12 0V19" fill="url(#g-coin-edge)"/><ellipse cx="11" cy="19" rx="6" ry="2.2" fill="url(#g-coin)"/><path d="M5 16.6v1.6a6 2.2 0 0 0 12 0v-1.6" fill="url(#g-coin-edge)"/><ellipse cx="11" cy="16.6" rx="6" ry="2.2" fill="url(#g-coin)"/><path d="M5 14.2v1.6a6 2.2 0 0 0 12 0v-1.6" fill="url(#g-coin-edge)"/><ellipse cx="11" cy="14.2" rx="6" ry="2.2" fill="url(#g-coin)"/><path d="M15 20.6v1.2a4.2 1.6 0 0 0 8.4 0v-1.2" fill="url(#g-coin-edge)"/><ellipse cx="19.2" cy="20.6" rx="4.2" ry="1.6" fill="url(#g-coin)"/><g class="drop"><path d="M5 11.8v1.6a6 2.2 0 0 0 12 0v-1.6" fill="url(#g-coin-edge)"/><ellipse cx="11" cy="11.8" rx="6" ry="2.2" fill="url(#g-coin)"/><ellipse cx="11" cy="11.8" rx="4.2" ry="1.4" fill="none" stroke="rgba(150,100,0,.5)" stroke-width=".5"/><path d="M11 10.9v1.8" stroke="rgba(150,100,0,.6)" stroke-width=".7" stroke-linecap="round"/></g>',
    camera: '<path d="M8 7l1.4-2.4h5.2L16 7z" fill="#2a2f38"/><rect x="2.5" y="6.6" width="19" height="13.4" rx="3" fill="url(#g-cam)"/><path d="M2.5 10.2h19" stroke="rgba(255,255,255,.1)" stroke-width="1.6"/><circle cx="12" cy="13.6" r="4.8" fill="#11151c" stroke="#9aa3b5" stroke-width=".8"/><circle cx="12" cy="13.6" r="3.3" fill="url(#g-lens)"/><circle cx="10.8" cy="12.4" r=".95" fill="rgba(255,255,255,.75)"/><rect x="16.8" y="8.2" width="2.8" height="1.7" rx=".5" fill="#ffe08a"/><circle cx="5.4" cy="8.9" r=".8" fill="#ff4d4d"/>',
    passport: '<path d="M5 2.5h12.5a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H5z" fill="url(#g-passport)"/><path d="M5 2.5h1.4v19H5z" fill="rgba(0,0,0,.25)"/><circle cx="12.4" cy="10" r="3.2" fill="none" stroke="#e8c56a" stroke-width=".7"/><path d="M9.2 10h6.4M12.4 6.8c-1.6 1.8-1.6 4.6 0 6.4M12.4 6.8c1.6 1.8 1.6 4.6 0 6.4" fill="none" stroke="#e8c56a" stroke-width=".5"/><path d="M9.5 16h5.8M10.3 17.6h4.2" stroke="#e8c56a" stroke-width=".6" stroke-linecap="round"/>',
  };
  const pic = (k) => (PICS[k] ? `<svg class="ea ea-${k}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PICS[k]}</svg>` : '');
  const elArt = (k) => pic(k) || dot(k);
  const originArt = (o) => {
    if (o.key === 'home') return pic('home');
    if (o.next) return pic('plane');
    if (o.code) return `<span class="wave-flag">${flag(o.code)}</span>`;
    return pic('gps');
  };

  let world = null;
  let planTripId = null;
  const country = (n) => NUM[n] || (N2CODE[n] ? {
    name: ZH_REGION?.of(N2CODE[n]) || N2CODE[n], code: N2CODE[n], region: '', base: 0,
  } : { name: world?.byId.get(n)?.properties?.name || '未知地區', code: '', region: '', base: 0 });

  // ---------- state
  let user = store.get('user', null);
  let trips = store.get('trips', []);
  let orders = store.get('orders', []);
  let wish = store.get('wish', []);
  const settings = {
    year: 'all', home: 'TPE', theme: '', uses: ['maps', 'social'], people: 1, ...store.get('settings', {}),
  };
  let cart = store.get('cart', []);
  let pendingGift = null;
  let guideState = null;
  const recState = {
    origin: null, tags: [], month: new Date().getMonth() + 1, hours: 0, fee: 'any', unvisited: false, gps: null, budget: 0,
  };
  const home = () => HOMES[settings.home] || HOMES.TPE;

  // ---------- flight time (概估): great-circle distance from home to where flights usually land.
  // Nonstop routes are the ones Taiwan's airports usually fly; elsewhere one stop of about 2.5 hours.
  const GEO = {};
  Object.entries(window.TRAVEL_GEO || {}).forEach(([n, g]) => { GEO[g[0]] = { n, lng: g[1], lat: g[2], area: g[3], hub: { lng: g[4], lat: g[5] } }; });
  const DIRECT = {
    TPE: new Set('JP KR CN HK MO TH VN SG MY ID PH KH MM US CA AU NZ GB FR DE NL AT CZ IT TR AE PW GU'.split(' ')),
    other: new Set('JP KR CN HK MO TH VN SG MY PH'.split(' ')),
  };
  const half = (h) => Math.max(1, Math.round(h * 2) / 2);
  function flightInfo(code) {
    const g = GEO[code];
    const dests = DESTS.filter((d) => d.c === code);
    if (!code || code === 'TW' || !(g || dests.length)) return null;
    const direct = (DIRECT[settings.home] || DIRECT.other).has(code);
    const to = g ? g.hub : dests[0];
    const km = haversine(home(), to);
    const speed = to.lng < -25 ? 900 : 790; // the jet stream speeds up flights to the Americas
    let hours = (km * (direct ? 1 : 1.15)) / speed + 0.6 + (direct ? 0 : 2.5);
    let range = null;
    if (direct && settings.home === 'TPE' && dests.length) {
      const hs = dests.map((d) => d.hours);
      hours = Math.min(...hs);
      if (Math.max(...hs) - hours >= 1.5) range = [hours, Math.max(...hs)];
    }
    const span = range ? `${half(range[0])}–${half(range[1])}` : half(hours);
    return {
      direct, km, hours: half(hours), text: `${direct ? '直飛' : '轉機'}約 ${span} 小時`,
    };
  }
  const flightChip = (code) => { const f = flightInfo(code); return f ? `<span class="flight-chip">${icon('flight')}${f.text}</span>` : ''; };
  // A trip's own flight: the city's nonstop time when known, otherwise worked out from where it is.
  function tripFlight(t) {
    const f = flightInfo(country(t.n).code);
    if (!f) return null;
    const d = DEST[t.dest];
    if (d && f.direct && settings.home === 'TPE') return { ...f, hours: d.hours, text: `直飛約 ${d.hours} 小時` };
    const km = haversine(home(), t);
    const hours = half((km * (f.direct ? 1 : 1.15)) / (t.lng < -25 ? 900 : 790) + 0.6 + (f.direct ? 0 : 2.5));
    return {
      ...f, km, hours, text: `${f.direct ? '直飛' : '轉機'}約 ${hours} 小時`,
    };
  }
  const tripFlightChip = (t) => { const f = tripFlight(t); return f ? `<span class="flight-chip">${icon('flight')}${f.text}</span>` : ''; };
  // fromCloud: the data just came from the LINE sync, so it is not pushed back or re-stamped.
  const save = (fromCloud) => {
    store.set('user', user); store.set('trips', trips); store.set('orders', orders); store.set('wish', wish); store.set('settings', settings); store.set('cart', cart);
    if (fromCloud === true) return;
    store.set('updatedAt', Date.now());
    if (typeof schedulePush === 'function') schedulePush(); // eslint-disable-line no-use-before-define
  };

  // ---------- trip helpers
  const tripYear = (t) => Number(t.start.slice(0, 4));
  const isUpcoming = (t) => t.start > TODAY;
  const isOngoing = (t) => t.start <= TODAY && t.end >= TODAY;
  const sortTrips = (list) => [...list].sort((a, b) => a.start.localeCompare(b.start));
  const tripsIn = (year) => sortTrips(trips.filter((t) => (year === 'all' ? CONFIG.years.includes(tripYear(t)) : tripYear(t) === Number(year))));
  const tripDays = (t) => daysBetween(t.start, t.end < TODAY ? t.end : TODAY);
  const tripLabel = (t) => `${flag(country(t.n).code)} ${t.city}`;
  const upcomingTrips = () => sortTrips(trips.filter((t) => isUpcoming(t) || isOngoing(t)));

  // Trips that follow each other within a day form one journey (e.g. Paris → London).
  const journeys = (list) => {
    const out = [];
    sortTrips(list).forEach((t) => {
      const last = out[out.length - 1];
      if (last && daysBetween(last[last.length - 1].end, t.start) <= 2) last.push(t); else out.push([t]);
    });
    return out;
  };
  const journeyKm = (j) => {
    let km = 0; let prev = home();
    j.forEach((t) => { km += haversine(prev, t); prev = t; });
    return km + haversine(prev, home());
  };

  function stats(year) { return statsOf(tripsIn(year)); } // eslint-disable-line no-use-before-define
  function statsOf(list) {
    const past = list.filter((t) => !isUpcoming(t));
    const countries = new Set(past.map((t) => t.n));
    const elements = {};
    past.forEach((t) => t.tags.forEach((k) => { elements[k] = (elements[k] || 0) + 1; }));
    const byRegion = {};
    countries.forEach((n) => { const r = country(n).region; if (r) byRegion[r] = (byRegion[r] || 0) + 1; });
    const months = new Set();
    past.forEach((t) => { for (let d = t.start; d <= t.end && d <= TODAY; d = addDays(d, 1)) months.add(Number(d.slice(5, 7))); });
    return {
      list,
      past,
      upcoming: list.filter(isUpcoming),
      countries,
      cities: new Set(past.map((t) => t.city)),
      days: sum(past, tripDays),
      km: sum(journeys(past), journeyKm),
      gb: sum(past, (t) => Number(t.gb)),
      esimCount: past.filter((t) => Number(t.gb) > 0).length,
      elements,
      topElements: Object.entries(elements).sort((a, b) => b[1] - a[1]),
      regions: new Set(Object.keys(byRegion)),
      byRegion,
      months,
      checkins: list.flatMap((t) => (t.checkins || []).map((c) => ({ ...c, city: t.city, tripId: t.id }))),
      photos: LIB.filter((p) => list.some((t) => t.id === p.tripId)).length, // eslint-disable-line no-use-before-define
    };
  }

  // ---------- 我的照片庫: photos kept in IndexedDB (travel-photo-db.js), sorted into trips by the date they were taken
  const PDB = window.TravelPhotoDB;
  let LIB = [];
  const libUrls = new Map();
  const libSrc = (p, kind = 'thumb') => {
    const blob = (kind === 'full' && p.full) || p.thumb || p.full;
    if (!blob) return '';
    const key = `${p.id}:${blob === p.full ? 'full' : 'thumb'}`;
    if (!libUrls.has(key)) libUrls.set(key, URL.createObjectURL(blob));
    return libUrls.get(key);
  };
  const dropUrls = (id) => ['full', 'thumb'].forEach((k) => {
    const u = libUrls.get(`${id}:${k}`);
    if (u) { URL.revokeObjectURL(u); libUrls.delete(`${id}:${k}`); }
  });
  const photoMeta = (p) => ({
    id: p.id, tripId: p.tripId || '', checkinId: p.checkinId || '', taken: p.taken || '', added: p.added || 0, caption: p.caption || '', lat: p.lat ?? null, lng: p.lng ?? null, w: p.w || 0, h: p.h || 0,
  });
  const tripForDate = (date, lat, lng) => {
    if (!date) return null;
    const hits = trips.filter((t) => t.start <= date && date <= t.end);
    if (hits.length < 2 || lat == null) return hits[0] || null;
    return hits.slice().sort((a, b) => haversine({ lat, lng }, a) - haversine({ lat, lng }, b))[0];
  };
  const byTaken = (a, b) => (b.taken || '').localeCompare(a.taken || '') || (b.added || 0) - (a.added || 0);
  const tripPhotos = (tripId) => LIB.filter((p) => p.tripId === tripId).sort(byTaken).reverse();
  const allCheckins = (list = trips) => list.flatMap((t) => (t.checkins || []).map((c) => ({ ...c, trip: t })))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const checkinTrip = () => trips.find(isOngoing) || sortTrips(trips.filter((t) => t.start <= TODAY)).reverse()[0] || sortTrips(trips)[0] || null;
  const INKS = ['#c8102e', '#1d4fd8', '#0b7a5a', '#7b2cbf', '#b85c00', '#0e6ba8'];
  const inkOf = (id) => INKS[[...String(id)].reduce((s, ch) => s + ch.charCodeAt(0), 0) % INKS.length];

  const stampHtml = (c, i = 0) => {
    const t = c.trip;
    const label = c.place && [...c.place].length <= 6 ? c.place : t.city;
    return `<button class="stamp-chip" data-ci-open="${t.id}:${c.id}" style="--ink:${inkOf(c.id)};--rot:${((i * 37) % 17) - 8}deg"><small>${esc(country(t.n).name)}</small><b>${esc(label.slice(0, 6))}</b><small>${esc((c.date || t.start).slice(2).replace(/-/g, '.'))}</small></button>`;
  };
  const shareCount = () => Number(settings.shares) || 0;
  let ci = null;
  const updatePhoto = async (p, patch) => {
    Object.assign(p, patch);
    await PDB?.put(p).catch(() => {});
    save();
  };

  // ---------- badges: 30 of them; each opens the trips, food and sights that earned it
  const SEASONS = ['冬', '冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬'];
  const tripSeasons = (t) => {
    const out = new Set();
    for (let d = t.start; d <= t.end && d <= TODAY; d = addDays(d, 1)) out.add(SEASONS[Number(d.slice(5, 7)) - 1]);
    return out;
  };
  const ateOf = (t) => (Array.isArray(t.ate) ? t.ate : []);
  const didOf = (t) => (Array.isArray(t.did) ? t.did : []);
  const flightHours = (t) => tripFlight(t)?.hours || 0;
  const countBy = (list) => { const m = {}; list.forEach((t) => { m[t.n] = (m[t.n] || 0) + 1; }); return m; };
  const hasMemory = (t) => Boolean(t.memo) || albumPhotos(t.id).length > 0; // eslint-disable-line no-use-before-define
  const GOLD = ['#f6c453', '#b7700b']; const BLUE = ['#5ab8ff', '#1d4fd8']; const TEAL = ['#34d6c0', '#0b6f68'];
  const VIOLET = ['#b39bff', '#6327d6']; const ROSE = ['#ff8aa0', '#c0173f'];
  const tagBadge = (tag, name, goal) => ({
    key: tag, group: 'element', tag, name, color: TAG_COLORS[tag], desc: `${goal} 趟${el(tag).label}之旅`,
    progress: (s) => [s.elements[tag] || 0, goal], trips: (s) => s.past.filter((t) => t.tags.includes(tag)),
  });
  const pastWhere = (fn) => (s) => s.past.filter(fn);
  const shortTrip = (t) => daysBetween(t.start, t.end) <= 3;
  const slowTrip = (t) => daysBetween(t.start, t.end) >= 10;
  const BADGES = [
    { key: 'first', group: 'milestone', color: GOLD, name: '第一次出國', desc: '完成第一趟旅行', progress: (s) => [s.past.length, 1], trips: (s) => s.past },
    { key: 'c5', group: 'milestone', color: BLUE, name: '五國旅人', desc: '去過 5 個國家・地區', kind: 'country', progress: (s) => [s.countries.size, 5] },
    { key: 'c10', group: 'milestone', color: BLUE, name: '十國收藏家', desc: '去過 10 個國家・地區', kind: 'country', progress: (s) => [s.countries.size, 10] },
    {
      key: 'asia', group: 'milestone', color: ROSE, name: '亞洲通', desc: '去 4 個亞洲國家・地區', kind: 'country', region: 'asia', progress: (s) => [s.byRegion.asia || 0, 4],
    },
    {
      key: 'europe', group: 'milestone', color: VIOLET, name: '歐洲漫遊者', desc: '去 3 個歐洲國家', kind: 'country', region: 'europe', progress: (s) => [s.byRegion.europe || 0, 3],
    },
    { key: 'world2', group: 'milestone', color: TEAL, name: '跨洲旅人', desc: '足跡跨 2 個洲', kind: 'region', progress: (s) => [s.regions.size, 2] },
    { key: 'world3', group: 'milestone', color: TEAL, name: '三洲制霸', desc: '足跡跨 3 個洲', kind: 'region', progress: (s) => [s.regions.size, 3] },
    tagBadge('food', '美食獵人', 3), tagBadge('culture', '文化探索家', 2), tagBadge('nature', '山海知己', 2), tagBadge('island', '海島控', 2),
    tagBadge('city', '城市漫遊者', 3), tagBadge('shopping', '購物狂', 2), tagBadge('onsen', '溫泉達人', 2), tagBadge('snow', '雪國旅人', 1),
    tagBadge('family', '親子玩家', 2), tagBadge('night', '夜貓子', 2), tagBadge('art', '藝術控', 2), tagBadge('adventure', '冒險王', 1),
    {
      key: 'eat10', group: 'element', color: TAG_COLORS.food, name: '吃貨認證', desc: '在足跡打卡 10 道在地美食', kind: 'eat', progress: (s) => [sum(s.past, (t) => ateOf(t).length), 10], trips: pastWhere((t) => ateOf(t).length),
    },
    { key: 'esim', group: 'style', color: BLUE, name: 'eSIM 達人', desc: '用 eSIM 出國 4 次', progress: (s) => [s.esimCount, 4], trips: pastWhere((t) => Number(t.gb) > 0) },
    { key: 'km', group: 'style', color: TEAL, name: '萬里旅人', desc: '飛行 2 萬公里', kind: 'km', progress: (s) => [Math.round(s.km), 20000] },
    { key: 'earth', group: 'style', color: TEAL, name: '繞地球一圈', desc: '飛行 40,075 公里', kind: 'km', progress: (s) => [Math.round(s.km), 40075] },
    { key: 'long', group: 'style', color: VIOLET, name: '長途飛行', desc: '飛到 10 小時以上的地方', progress: (s) => [s.past.filter((t) => flightHours(t) >= 10).length, 1], trips: pastWhere((t) => flightHours(t) >= 10) },
    { key: 'month', group: 'style', color: GOLD, name: '一個月在路上', desc: '旅行 30 天', kind: 'days', progress: (s) => [s.days, 30] },
    { key: 'weekend', group: 'style', color: ROSE, name: '週末快閃', desc: '去一趟 3 天內的小旅行', progress: (s) => [s.past.filter(shortTrip).length, 1], trips: pastWhere(shortTrip) },
    { key: 'slow', group: 'style', color: TEAL, name: '慢旅行', desc: '一趟待 10 天以上', progress: (s) => [s.past.filter(slowTrip).length, 1], trips: pastWhere(slowTrip) },
    { key: 'seasons', group: 'style', color: GOLD, name: '四季旅人', desc: '春夏秋冬都出國', kind: 'season', progress: (s) => [new Set(s.past.flatMap((t) => [...tripSeasons(t)])).size, 4] },
    {
      key: 'again', group: 'style', color: ROSE, name: '回訪老朋友', desc: '同一個國家去 2 次', progress: (s) => [Math.max(0, ...Object.values(countBy(s.past))), 2], trips: (s) => { const c = countBy(s.past); return s.past.filter((t) => c[t.n] > 1); },
    },
    { key: 'memory', group: 'style', color: VIOLET, name: '紀念冊作者', desc: '幫一趟旅行寫回憶或放照片', progress: (s) => [s.past.filter(hasMemory).length, 1], trips: pastWhere(hasMemory) },
    { key: 'checkin1', group: 'social', color: ROSE, name: '打卡新手', desc: '第一次打卡', kind: 'checkin', progress: (s) => [s.checkins.length, 1] },
    { key: 'checkin10', group: 'social', color: VIOLET, name: '打卡達人', desc: '打卡 10 次', kind: 'checkin', progress: (s) => [s.checkins.length, 10] },
    { key: 'stamps5', group: 'social', color: BLUE, name: '印章收藏家', desc: '在 5 座城市打卡', kind: 'checkin', progress: (s) => [new Set(s.checkins.map((c) => c.city)).size, 5] },
    { key: 'photo30', group: 'social', color: TEAL, name: '旅行攝影師', desc: '照片庫收藏 30 張旅行照片', kind: 'photo', progress: (s) => [s.photos, 30] },
    { key: 'share3', group: 'social', color: GOLD, name: '分享家', desc: '分享 3 次旅行圖卡或打卡', kind: 'share', progress: () => [Number(settings.shares) || 0, 3] },
  ];
  const BADGE_GROUPS = { milestone: '里程碑', element: '旅行元素', style: '旅行方式', social: '打卡與分享' };
  const badgeState = (b, s) => {
    const [v, goal] = b.progress(s);
    return {
      v, goal, ok: v >= goal, pct: Math.min(100, Math.round((v / goal) * 100)),
    };
  };

  // Badge pictures and a line for each, so a badge feels like a keepsake rather than a letter.
  const GLOBE = '<circle cx="12" cy="12" r="9" fill="url(#g-sea)"/><g clip-path="url(#g-globe-clip)" fill="url(#g-grass)"><path d="M6 7.5c1.5-1 3.2-.8 4 .4.6 1-.2 2 .8 2.8 1 .8.4 2.2-.8 2.4-1.4.2-1.6 1.6-2.8 1.4-1.4-.3-1.2-2-2.2-2.8-.7-.6-.4-2.6 1-4.2z"/><path d="M13.5 5.2c1.4-.2 3 .4 3.8 1.4-.8.4-1.8.2-2.2 1-.4.9.8 1.4.4 2.3-.5 1-2 .6-2.4-.4-.5-1.2-1.4-1.8-.6-3.2z"/><path d="M14 13c1.2-.6 2.8-.2 3.6.8.7.9.2 2.4-.6 3.3-.9 1-1.2 2.4-2.4 2.3-1-.1-.8-1.6-1.2-2.6-.5-1.3-.8-3.1.6-3.8z"/><path d="M3 15.5c1.5.2 2.6 1.3 3 2.8-1 .2-2.4-.4-3.2-1.4z"/></g><circle cx="12" cy="12" r="9" fill="url(#g-globe-shade)"/>';
  const PIN = (x, y) => `<path transform="translate(${x} ${y})" d="M0-2.6c-.8 0-1.4.6-1.4 1.4C-1.4 0 0 1.2 0 1.2S1.4 0 1.4-1.2C1.4-2 .8-2.6 0-2.6z" fill="#e03131" stroke="#fff" stroke-width=".35"/>`;
  const JET = '<path d="M21.5 11.2c.9 0 1.5.4 1.5.8s-.6.8-1.5.8h-5l-4.2 6h-2l2.4-6H8.6l-1.6 2H5.4l1-2.8-1-2.8h1.6l1.6 2h4.1L10.3 5.2h2l4.2 6z" fill="url(#g-plane)" stroke="#6d7d99" stroke-width=".45"/>';
  const BANNER = (text) => `<path d="M3.5 17.4h17l-1.5 1.9 1.5 1.9h-17l1.5-1.9z" fill="#c92a2a"/><path d="M3.5 17.4h17" stroke="rgba(255,255,255,.35)" stroke-width=".4"/><text x="12" y="20.4" text-anchor="middle" font-size="3.3" font-weight="800" fill="#fff" font-family="system-ui,sans-serif">${text}</text>`;
  const BADGE_PICS = {
    first: `<circle cx="16.5" cy="7.5" r="4.2" fill="url(#g-sun)"/><path d="M2 20.5h20" stroke="#8e98aa" stroke-width="1.3" stroke-linecap="round"/><path d="M4 20.5h2.5M9 20.5h2.5M14 20.5h2.5" stroke="#fff" stroke-width=".5"/><g transform="translate(-.5 1.5) scale(.95)">${PICS.plane}</g>`,
    c5: `<g transform="translate(1.4 .3) scale(.88)">${GLOBE}</g>${PIN(8, 7.5)}${PIN(14.5, 6.5)}${PIN(16.5, 12)}${PIN(9.5, 13)}${PIN(12.5, 9.8)}${BANNER('5 國')}`,
    c10: `<g transform="translate(1.4 .3) scale(.88)">${GLOBE}</g>${PIN(7, 7)}${PIN(10, 5.5)}${PIN(14.5, 5.5)}${PIN(17, 9)}${PIN(16.5, 13)}${PIN(12.5, 9.5)}${PIN(9, 11)}${PIN(6, 12.5)}${PIN(12, 14)}${PIN(15, 15)}${BANNER('10 國')}`,
    asia: '<circle cx="12" cy="11" r="8.5" fill="#ffe3c4"/><path d="M12 2v3" stroke="#7a2b12" stroke-width=".8"/><rect x="9.6" y="6.4" width="4.8" height="2.2" fill="#f6e7c8"/><rect x="8.8" y="10" width="6.4" height="2.4" fill="#f6e7c8"/><rect x="8" y="13.8" width="8" height="2.6" fill="#f6e7c8"/><rect x="7" y="17.6" width="10" height="3.2" fill="#f6e7c8"/><rect x="11" y="18.6" width="2" height="2.2" rx=".4" fill="#7a2b12"/><path d="M8 6.6c1.6.5 6.4.5 8 0l-1-1.5H9z" fill="#a8321b"/><path d="M6.8 10.2c2 .6 8.4.6 10.4 0l-1.2-1.7H8z" fill="#a8321b"/><path d="M5.6 14c2.4.7 10.4.7 12.8 0l-1.3-1.8H6.9z" fill="#a8321b"/><path d="M4.4 17.8c2.8.8 12.4.8 15.2 0l-1.4-1.8H5.8z" fill="#a8321b"/><rect x="3" y="20.6" width="18" height="1.3" rx=".65" fill="#b9a37a"/>',
    europe: '<path d="M3 21v-7l3-2.6 3 2.6v7z" fill="#ecd6b2"/><path d="M2.3 14.3L6 11l3.7 3.3" fill="none" stroke="#b5532e" stroke-width="1.1" stroke-linejoin="round"/><path d="M15 21v-6h6.2v6z" fill="#f1dfbf"/><path d="M14.3 15.2h7.6l-1.3-2.1h-5z" fill="#b5532e"/><rect x="9" y="7" width="6" height="14" fill="url(#g-stonew)"/><path d="M8.4 7.3L12 1.4l3.6 5.9z" fill="#46607f"/><circle cx="12" cy="10.5" r="2.2" fill="#fff" stroke="#c9a24a" stroke-width=".7"/><path d="M12 10.5V9.1M12 10.5l1 .6" stroke="#333" stroke-width=".45" stroke-linecap="round"/><path d="M10.6 14.6a1.4 1.4 0 0 1 2.8 0V17.5h-2.8z" fill="#46607f"/><path d="M4.8 16.2h2.4v2.4H4.8zM16.5 16.6h1.6v1.8h-1.6zM18.8 16.6h1.6v1.8h-1.6z" fill="#7d93b3"/><rect x="2" y="21" width="20" height="1.3" rx=".65" fill="#9a8f80"/>',
    world2: '<path d="M2 15c1.6-2.4 4.6-3 6.6-1.6 1.2.8 1.2 2.6 2.6 3 1 .3 1.2 1.6.2 2.2-2 1.2-5.2 1.2-7.4.2C2.5 18.2 1.2 16.4 2 15z" fill="url(#g-grass)"/><path d="M15 9.5c1.8-1.2 4.2-1 5.8.4 1.2 1 1.6 2.8.6 3.8-1 1-2.6.4-3.6 1.2-1 .8-2.4.6-3-.6-.7-1.4-1.4-3.6.2-4.8z" fill="url(#g-grass)"/><path d="M6 14.5C7 6 14 4 17.5 10" fill="none" stroke="#e03131" stroke-width=".9" stroke-dasharray="1.4 1.1" stroke-linecap="round"/><circle cx="6" cy="14.5" r="1.1" fill="#e03131"/><circle cx="17.5" cy="10" r="1.1" fill="#e03131"/><g transform="translate(12.2 5.6) rotate(8) scale(.42) translate(-14 -12)">JET</g>',
    world3: `<g transform="translate(2.4 4.4) scale(.8)">${GLOBE}</g><path d="M8.3 6.6L9.1 2.6l2.1 2.1.8-2.8.8 2.8 2.1-2.1.8 4z" fill="url(#g-coin)" stroke="#a87710" stroke-width=".4" stroke-linejoin="round"/><circle cx="12" cy="1.9" r=".6" fill="#e03131"/>`,
    eat10: `<g transform="translate(-.5 -2)">${STEAM}</g><ellipse cx="12" cy="13" rx="9" ry="2.2" fill="#f3dca6" stroke="#b88a3a" stroke-width=".7"/><g fill="url(#g-dumpling)" stroke="#d6c4a0" stroke-width=".35"><path d="M9 11.6c0-2 1.4-3.2 3-3.2s3 1.2 3 3.2c-1 .6-5 .6-6 0z"/><path d="M4.8 13.2c0-2.2 1.6-3.6 3.1-3.6s3.1 1.4 3.1 3.6c-1 .7-5.2.7-6.2 0z"/><path d="M13 13.2c0-2.2 1.6-3.6 3.1-3.6s3.1 1.4 3.1 3.6c-1 .7-5.2.7-6.2 0z"/></g><path d="M7.9 9.8v1.6M7.9 9.8l-.7 1.4M7.9 9.8l.7 1.4M16.1 9.8v1.6M16.1 9.8l-.7 1.4M16.1 9.8l.7 1.4" stroke="#d2bf98" stroke-width=".4"/><path d="M3 13.2h18v5.3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="url(#g-bamboo)"/><path d="M3 15.4h18M3 17.8h18" stroke="rgba(120,80,20,.45)" stroke-width=".6"/>`,
    esim: '<g transform="rotate(-10 12 12)"><path d="M7 3h7.5L19 7.5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V4.5A1.5 1.5 0 0 1 7 3z" fill="url(#g-simb)"/><rect x="8" y="10" width="8.5" height="7.5" rx="1.4" fill="url(#g-coin)"/><path d="M8 12.6h2.8v2.4H8M16.5 12.6h-2.8v2.4h2.8M10.8 10v7.5M13.7 10v7.5" fill="none" stroke="#8a6414" stroke-width=".45"/></g><path d="M18.4 4.6a3 3 0 0 1 2 2M18.8 2.2a5.6 5.6 0 0 1 3.9 3.9" fill="none" stroke="#1463ff" stroke-width=".9" stroke-linecap="round"/>',
    km: '<path d="M3.5 19.5c3 0 3-5 6.5-5s3.5 3.5 7 1.5c2-1.2 2.2-4.4 3.2-6.4" fill="none" stroke="#1463ff" stroke-width="1" stroke-dasharray="1.3 1.1" stroke-linecap="round"/><circle cx="3.5" cy="19.5" r="1.5" fill="#e03131"/><circle cx="3.5" cy="19.5" r=".55" fill="#fff"/><g transform="translate(19.6 7.4) rotate(-62) scale(.5) translate(-14 -12)">JET</g>',
    earth: `<g transform="translate(3 3) scale(.75)">${GLOBE}</g><ellipse cx="12" cy="12" rx="10.6" ry="4" fill="none" stroke="#e8a92a" stroke-width=".8" stroke-dasharray="1.2 .8" transform="rotate(-20 12 12)"/><g transform="translate(20.8 8.2) rotate(-95) scale(.42) translate(-14 -12)">${JET}</g>`,
    long: '<circle cx="14.5" cy="9" r="7.5" fill="url(#g-moonglow)"/><path d="M15 2.8A6 6 0 1 0 21 12.3 6.8 6.8 0 0 1 15 2.8z" fill="url(#g-moon)"/><g fill="#ffcf3a"><path d="M4.5 4l.45 1.1 1.1.45-1.1.45-.45 1.1-.45-1.1-1.1-.45 1.1-.45z"/><path d="M20.5 18l.35.9.9.35-.9.35-.35.9-.35-.9-.9-.35.9-.35z"/><path d="M7 19l.3.7.7.3-.7.3-.3.7-.3-.7-.7-.3.7-.3z"/></g><g transform="translate(10.5 14) rotate(-12) scale(.62) translate(-14 -12)">JET</g>',
    month: '<rect x="3.5" y="4" width="17" height="17" rx="2.5" fill="#fff" stroke="#d5dae3" stroke-width=".6"/><path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h12a2.5 2.5 0 0 1 2.5 2.5V9h-17z" fill="url(#g-cal)"/><rect x="7.2" y="2.4" width="1.4" height="3.3" rx=".7" fill="#4a5262"/><rect x="15.4" y="2.4" width="1.4" height="3.3" rx=".7" fill="#4a5262"/><text x="12" y="18.7" text-anchor="middle" font-size="8.6" font-weight="900" fill="#1d2433" font-family="system-ui,sans-serif">30</text>',
    weekend: '<path d="M10.6 3.6a1.4 1.4 0 0 1 2.8 0" fill="none" stroke="#7a2a06" stroke-width="1"/><path d="M7.5 8a4.5 4.5 0 0 1 9 0v12a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 20z" fill="url(#g-pack)"/><path d="M8.3 6.8a3.8 3.8 0 0 1 2.4-2.6" fill="none" stroke="rgba(255,255,255,.45)" stroke-width=".8" stroke-linecap="round"/><rect x="9" y="13.4" width="6" height="5.8" rx="1.4" fill="rgba(0,0,0,.16)"/><path d="M9.5 15.2h5" stroke="#ffe08a" stroke-width=".6"/><path d="M7.5 10.5h9" stroke="rgba(0,0,0,.18)" stroke-width=".7"/><path d="M19 3.6l-2.5 4.2h1.9l-1.7 3.8 3.8-4.9h-2l1.7-3.1z" fill="#ffd43b" stroke="#c99a06" stroke-width=".3" stroke-linejoin="round"/>',
    slow: `<g transform="translate(-1 -1)">${STEAM}</g><ellipse cx="11.5" cy="20.8" rx="8" ry="1.6" fill="#f1ece4" stroke="#d6cfc3" stroke-width=".5"/><path d="M5 10.5h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" fill="url(#g-cup)" stroke="#d6cfc3" stroke-width=".4"/><path d="M17 11.8h1.3a2.3 2.3 0 0 1 0 4.6H17" fill="none" stroke="#e2dbcf" stroke-width="1.4"/><ellipse cx="11" cy="10.5" rx="6" ry="1.4" fill="#6b3b1d"/><path d="M11 11.3c-.9-.5-1.6-.9-1.6-1.4 0-.4.4-.6.8-.5.3 0 .6.2.8.5.2-.3.5-.5.8-.5.4 0 .8.2.8.5 0 .5-.7.9-1.6 1.4z" fill="#f3dcbc"/>`,
    seasons: '<circle cx="7.5" cy="7.5" r="5" fill="#ffd9e4"/><g fill="#ff8fb1" transform="translate(7.5 7.5)"><circle cy="-1.7" r="1.3"/><circle cx="1.6" cy="-.5" r="1.3"/><circle cx="1" cy="1.4" r="1.3"/><circle cx="-1" cy="1.4" r="1.3"/><circle cx="-1.6" cy="-.5" r="1.3"/><circle r=".7" fill="#ffd43b"/></g><circle cx="16.5" cy="7.5" r="5" fill="#fff1b8"/><path d="M16.5 3.6v1.1M16.5 10.3v1.1M12.6 7.5h1.1M19.3 7.5h1.1M13.7 4.7l.8.8M18.5 9.5l.8.8M13.7 10.3l.8-.8M18.5 5.5l.8-.8" stroke="#f59f00" stroke-width=".7" stroke-linecap="round"/><circle cx="16.5" cy="7.5" r="2.2" fill="url(#g-sun)"/><circle cx="7.5" cy="16.5" r="5" fill="#ffe2c6"/><path d="M7.5 12.8l.9 1.9 1.6-.6-.5 1.9 1.7.4-1.4 1.2.4.8H8.1v1.4H6.9v-1.4H5l.4-.8-1.4-1.2 1.7-.4-.5-1.9 1.6.6z" fill="#e8590c"/><circle cx="16.5" cy="16.5" r="5" fill="#dbe9ff"/><path d="M16.5 13.3v6.4M13.7 14.9l5.6 3.2M13.7 18.1l5.6-3.2" stroke="#4c8bf5" stroke-width=".8" stroke-linecap="round"/>',
    again: '<path d="M21 14A9.5 9.5 0 0 1 3 14" fill="none" stroke="#1463ff" stroke-width="1.1" stroke-linecap="round"/><path d="M3 11.8l1.7 3-3.3.1z" fill="#1463ff"/><path d="M12 18.5s-7-4.3-7-9.3A3.9 3.9 0 0 1 12 7a3.9 3.9 0 0 1 7 2.2c0 5-7 9.3-7 9.3z" fill="url(#g-pin)"/><path d="M7.4 8.7a2.3 2.3 0 0 1 2.2-1.8" fill="none" stroke="rgba(255,255,255,.65)" stroke-width="1" stroke-linecap="round"/>',
    memory: '<g transform="rotate(-8 12 12)"><rect x="4" y="3.5" width="14" height="16.5" rx="1" fill="#fff" stroke="#d9dde5" stroke-width=".5"/><rect x="5.5" y="5" width="11" height="10" fill="url(#g-sea)"/><path d="M5.5 15l3.5-4 2.4 2.4 2-2 3.1 3.6z" fill="url(#g-grass)"/><circle cx="14" cy="7.6" r="1.3" fill="url(#g-sun)"/><path d="M7 17.6h5" stroke="#9aa3b5" stroke-width=".6" stroke-linecap="round"/></g><path d="M18.6 21s-2.8-1.7-2.8-3.6a1.5 1.5 0 0 1 2.8-.8 1.5 1.5 0 0 1 2.8.8c0 1.9-2.8 3.6-2.8 3.6z" fill="#ff5c7a"/><path d="M20.2 3.4l1.4 1.4-7 7-2 .6.6-2z" fill="#3b4a66"/><path d="M20.2 3.4l1.4 1.4.8-.8a1 1 0 0 0-1.4-1.4z" fill="#e8a92a"/>',
    checkin1: `${PICS.camera}<path d="M19.5 2.2l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" fill="#ffcf3a"/>`,
    checkin10: `<g transform="translate(-2.5 0)">${PICS.passport}</g><g transform="rotate(-12 17 16)"><circle cx="17" cy="16" r="4.6" fill="rgba(255,255,255,.88)" stroke="#c8102e" stroke-width=".9"/><circle cx="17" cy="16" r="3.3" fill="none" stroke="#c8102e" stroke-width=".4"/><path d="M15 16h4" stroke="#c8102e" stroke-width="1"/></g><g transform="rotate(14 17 5.5)"><rect x="13" y="3" width="8" height="5" rx="1" fill="rgba(255,255,255,.88)" stroke="#1d4fd8" stroke-width=".8"/><path d="M15 5.5h4" stroke="#1d4fd8" stroke-width=".9"/></g>`,
    stamps5: '<g fill="rgba(255,255,255,.75)" stroke-width=".9"><circle cx="6.5" cy="6.5" r="4" stroke="#c8102e"/><circle cx="17.5" cy="6.5" r="4" stroke="#1d4fd8"/><circle cx="12" cy="12.2" r="4" stroke="#0b7a5a"/><circle cx="6.5" cy="17.8" r="4" stroke="#7b2cbf"/><circle cx="17.5" cy="17.8" r="4" stroke="#b85c00"/></g><g stroke-width="1" stroke-linecap="round"><path d="M4.8 6.5h3.4" stroke="#c8102e"/><path d="M15.8 6.5h3.4" stroke="#1d4fd8"/><path d="M10.3 12.2h3.4" stroke="#0b7a5a"/><path d="M4.8 17.8h3.4" stroke="#7b2cbf"/><path d="M15.8 17.8h3.4" stroke="#b85c00"/></g>',
    photo30: '<g transform="rotate(-14 12 12)"><rect x="5" y="4.5" width="13" height="15.5" rx="1" fill="#fff" stroke="#d9dde5" stroke-width=".4"/><rect x="6.2" y="5.7" width="10.6" height="10" fill="#ffd6a5"/></g><g transform="rotate(9 12 12)"><rect x="5" y="4.5" width="13" height="15.5" rx="1" fill="#fff" stroke="#d9dde5" stroke-width=".4"/><rect x="6.2" y="5.7" width="10.6" height="10" fill="#b9e3c6"/></g><rect x="5.5" y="4" width="13" height="16" rx="1" fill="#fff" stroke="#d9dde5" stroke-width=".4"/><rect x="6.7" y="5.2" width="10.6" height="10.4" fill="url(#g-sea)"/><path d="M6.7 15.6l3.6-4 2.4 2.4 2-2 2.6 3.6z" fill="url(#g-grass)"/><circle cx="14.6" cy="7.9" r="1.2" fill="url(#g-sun)"/><path d="M8.2 17.9h4.4" stroke="#9aa3b5" stroke-width=".6" stroke-linecap="round"/>',
    share3: '<path d="M2.5 19.8c2.2-.4 3.8-1.6 5.4-3.2" fill="none" stroke="#1463ff" stroke-width=".9" stroke-dasharray="1.2 1" stroke-linecap="round"/><path d="M3 11.2L21.2 3.8l-4.6 16.4-4.3-5.5z" fill="#fff" stroke="#9aa8c0" stroke-width=".5" stroke-linejoin="round"/><path d="M12.3 14.7L21.2 3.8 9.4 13.1z" fill="#dfe6f3"/><path d="M9.4 13.1l.5 5.8 2.4-4.2z" fill="#c4cfe2"/>',
  };
  const BADGE_LINES = {
    first: '那一天，你推開了世界的門。',
    c5: '五個國家，五種不同的早晨。',
    c10: '十個國家，十種說謝謝的方式。',
    asia: '亞洲的巷弄，你已經走熟了。',
    europe: '石板路和教堂鐘聲，歐洲記得你。',
    world2: '跨過大洋，世界忽然變近了。',
    world3: '三塊大陸上，都有你的腳印。',
    food: '旅行的記憶，有一半是味道。',
    culture: '在古老的地方，聽見時間的聲音。',
    nature: '山和海，是最好的充電器。',
    island: '赤腳、海風，什麼都不用想。',
    city: '在陌生的街角，找到自己的步調。',
    shopping: '行李箱的重量，是快樂的重量。',
    onsen: '泡進熱水那一刻，疲憊都化開了。',
    snow: '第一次踩進雪裡的聲音，還記得嗎？',
    family: '一起看過的風景，會變成家裡的故事。',
    night: '城市的燈亮起來，旅行才剛開始。',
    art: '美的東西，會悄悄改變你看世界的方式。',
    adventure: '心跳加速的那一刻，最像活著。',
    eat10: '十道在地味道，一口一個回憶。',
    esim: '一落地就上線，從來不迷路。',
    km: '兩萬公里的天空，都是你的。',
    earth: '你飛過的距離，已經繞地球一圈。',
    long: '十個小時的夜航，換一個全新的世界。',
    month: '一整個月在路上，家變成一種心情。',
    weekend: '說走就走，週末也能去遠方。',
    slow: '慢下來，才看得見當地人的日常。',
    seasons: '春櫻、夏海、秋楓、冬雪，你都收藏了。',
    again: '有些地方，去一次是不夠的。',
    memory: '把旅行寫下來，它就不會被忘記。',
    checkin1: '按下打卡的那一刻，這裡就成了你的地方。',
    checkin10: '十個印章，十個不想忘記的瞬間。',
    stamps5: '五座城市的印章，蓋滿你的護照。',
    photo30: '你看見的風景，值得被好好收藏。',
    share3: '把喜歡的地方分享出去，世界就更近一點。',
  };
  const badgePic = (b) => {
    if (b.tag) return pic(b.tag);
    const body = BADGE_PICS[b.key];
    return body ? `<svg class="ea" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body.replace(/JET/g, JET)}</svg>` : '';
  };
  // A medal: gold rim, enamel in the badge colour, its picture; locked ones are pewter with a progress ring.
  const medal = (b, ok = true, size = '', opt = {}) => `<span class="medal ${size} ${ok ? '' : 'locked'}" style="--m1:${b.color[0]};--m2:${b.color[1]};--i:${opt.i || 0};--p:${opt.pct || 0}">${ok ? '<span class="medal-ribbon"></span>' : '<span class="medal-ring"></span>'}<span class="medal-disc"><span class="medal-face">${badgePic(b) || esc(b.name.slice(0, 1))}</span></span></span>`;
  const medalByName = (name, size = '') => medal(BADGES.find((b) => b.name === name) || { name, color: GOLD }, true, size);
  // The trip that unlocked a badge: the first one after which it was earned.
  function badgeUnlocked(b, list) {
    if (b.kind === 'share') return null;
    // Check-in badges are earned on the day of a check-in, not at the end of the trip.
    if (b.kind === 'checkin') {
      const cs = allCheckins(list).slice().reverse();
      const cities = new Set();
      const hit = cs.find((c, i) => { cities.add(c.trip.city); return b.key === 'stamps5' ? cities.size >= 5 : i + 1 >= b.progress({ checkins: cs })[1]; });
      return hit ? { ...hit.trip, end: hit.date || hit.trip.end } : null;
    }
    const past = list.filter((t) => !isUpcoming(t)).sort((p, q) => p.end.localeCompare(q.end));
    for (let i = 1; i <= past.length; i += 1) {
      if (badgeState(b, statsOf(past.slice(0, i))).ok) return past[i - 1];
    }
    return null;
  }
  const badgeTile = (b, s, year, i = 0) => {
    const st = badgeState(b, s);
    const at = st.ok ? badgeUnlocked(b, s.list) : null;
    let where = `${fmt(Math.min(st.v, st.goal))}/${fmt(st.goal)}`;
    if (st.ok) where = at ? `${at.end.slice(0, 4)}・${esc(at.city)}` : '已解鎖';
    return `<button class="badge ${st.ok ? '' : 'locked'}" data-badge="${b.key}" data-by="${year}">${medal(b, st.ok, '', { i, pct: st.pct })}<span>${esc(b.name)}</span><small class="medal-where">${where}</small></button>`;
  };
  const travelerType = (s) => {
    const top = s.topElements.slice(0, 2).map(([k]) => el(k).label);
    if (!top.length) return '還沒有旅行紀錄';
    return `最常玩：${top.join('、')}`;
  };

  // ---------- ticket helpers
  const ticketText = (spot) => {
    if (spot.fee === 0) return '免費';
    if (spot.fee == null) return spot.note || '依方案';
    const symbol = { JPY: '¥', USD: 'US$', EUR: '€', GBP: '£', KRW: '₩', THB: '฿', AUD: 'A$', NZD: 'NZ$', CAD: 'C$', SGD: 'S$', HKD: 'HK$' }[spot.cur];
    const amount = symbol ? `${symbol}${spot.fee.toLocaleString()}` : `${spot.cur} ${spot.fee.toLocaleString()}`;
    return amount;
  };
  const toTwd = (spot) => (spot.fee ? Math.round(spot.fee * (RATES[spot.cur] || 0)) : 0);
  const ticketTotal = (d) => sum(d.spots, toTwd);
  const freeCount = (d) => d.spots.filter((s) => s.fee === 0).length;

  // ---------- eSIM plans, pricing and card states
  const packIcon = (key) => {
    if (key === 'EU') return flag('EU');
    if (key === 'GLOBAL') return icon('globe');
    return `<span class="fl-stack">${PACKS[key].countries.slice(0, 3).map((c) => flag(c)).join('')}</span>`;
  };
  const target = (key) => (PACKS[key] ? {
    ...PACKS[key], key, pack: true, icon: packIcon(key),
  } : { ...COUNTRIES[key], key, icon: flag(key) });
  const nice = (v) => Math.max(29, Math.ceil(v / 10) * 10 - 1);
  const planOpt = (plan) => PLAN_TYPES[plan.type]?.options.find((o) => o.size === String(plan.size)) || PLAN_TYPES.daily.options[1];
  const planDays = (plan) => (plan.type === 'total' ? planOpt(plan).days : plan.days);
  const planPrice = (key, plan, qty = 1) => {
    const { base } = target(key);
    const o = planOpt(plan);
    return (plan.type === 'total' ? nice(base * o.k) : nice(base * plan.days * o.k)) * qty;
  };
  const planSpec = (plan) => (plan.type === 'total' ? `${planOpt(plan).name}・${planOpt(plan).days} 天內有效` : `${plan.days} 天・${planOpt(plan).name}`);
  const planLabel = (key, plan) => `${target(key).name} ${planSpec(plan)}`;
  const fromPrice = (key) => nice(target(key).base * PLAN_TYPES.daily.options[0].k);
  const USES = {
    maps: { label: '地圖導航、LINE 訊息', icon: '🗺️', gb: 0.3 },
    social: { label: 'IG／FB 打卡、上傳照片', icon: '📸', gb: 0.8 },
    video: { label: '看影片、追劇', icon: '🎬', gb: 1.5 },
    work: { label: '視訊會議、遠端工作', icon: '💻', gb: 1 },
    share: { label: '分享熱點給同行的人', icon: '📶', gb: 0 },
  };
  const usagePerDay = (uses = settings.uses, people = settings.people) => {
    const base = uses.reduce((s, k) => s + (USES[k]?.gb || 0), 0) || 0.3;
    return base + (uses.includes('share') ? 0.8 * Math.max(0, people - 1) : 0);
  };
  const pickForUsage = (gb = usagePerDay()) => {
    if (gb <= 0.9) return { type: 'daily', size: '1' };
    if (gb <= 1.8) return { type: 'daily', size: '2' };
    if (gb <= 2.8) return { type: 'daily', size: '3' };
    return { type: 'unl', size: gb > 4 ? 'pro' : 'std' };
  };

  // Smallest pack (or single country) that covers every country of a journey.
  const coverFor = (codes) => {
    const uniq = [...new Set(codes)].filter(Boolean);
    if (uniq.length === 1 && COUNTRIES[uniq[0]]?.base) return uniq[0];
    const packs = Object.entries(PACKS).filter(([, p]) => uniq.every((c) => p.countries.includes(c)))
      .sort((a, b) => a[1].countries.length - b[1].countries.length);
    return packs[0]?.[0] || 'GLOBAL';
  };
  const smartPick = () => {
    const next = journeys(upcomingTrips())[0];
    if (!next) return null;
    const key = coverFor(next.map((t) => country(t.n).code));
    const days = daysBetween(next[0].start, next[next.length - 1].end);
    return { journey: next, key, plan: { ...pickForUsage(), days: Math.min(30, days) } };
  };

  const orderTrips = (o) => sortTrips(trips.filter((t) => o.tripIds?.includes(t.id)));
  const ordersFor = (tripId) => orders.filter((o) => o.tripIds?.includes(tripId));
  const LONG_REGIONS = ['europe', 'america', 'oceania', 'mideast'];
  const isShortHaul = (o) => {
    const ts = orderTrips(o);
    if (ts.length) return Math.max(...ts.map((t) => DEST[t.dest]?.hours || (LONG_REGIONS.includes(country(t.n).region) ? 12 : 4))) <= 5;
    return !(['EU', 'NA', 'ANZ', 'GLOBAL'].includes(o.key) || LONG_REGIONS.includes(COUNTRIES[o.key]?.region));
  };
  const installAdvice = (o) => {
    const [t] = orderTrips(o);
    if (isShortHaul(o)) return `短程航線：建議${t && isUpcoming(t) ? ` ${md(t.start)} ` : ''}出發當天在機場連 Wi-Fi 安裝，落地後開啟數據漫遊就能上網。`;
    return `長程航線：建議抵達${t ? ` ${t.city} ` : '當地'}後，連機場 Wi-Fi 再安裝，避免轉機途中提前開始計算天數。`;
  };
  const CARD_STATE = {
    unclaimed: { label: '待領取', tab: 'pending', cls: 'pending', step: 0 },
    shared: { label: '待親友領取', tab: 'pending', cls: 'pending', step: 0 },
    claimed: { label: '待安裝', tab: 'pending', cls: 'pending', step: 1 },
    installed: { label: '已安裝・待出發', tab: 'pending', cls: 'ready', step: 2 },
    active: { label: '使用中', tab: 'active', cls: 'active', step: 3 },
    expired: { label: '已到期', tab: 'expired', cls: 'done', step: 3 },
  };
  function cardState(o, c) {
    const ts = orderTrips(o);
    const end = ts.length ? ts[ts.length - 1].end : null;
    const start = ts[0]?.start;
    if (end && end < TODAY) return 'expired';
    if (c.activatedAt) return addDays(c.activatedAt, planDays(o.plan) - 1) < TODAY ? 'expired' : 'active';
    if (c.installed && start && start <= TODAY) return 'active';
    if (c.installed) return 'installed';
    if (c.claimed) return 'claimed';
    if (c.sharedAt) return 'shared';
    return 'unclaimed';
  }
  const ORDER_RANK = ['active', 'installed', 'claimed', 'unclaimed', 'shared', 'expired'];
  const orderState = (o) => {
    const states = o.cards.map((c) => cardState(o, c));
    return CARD_STATE[ORDER_RANK.find((s) => states.includes(s)) || 'unclaimed'];
  };
  const orderStatus = (o) => [orderState(o).cls, orderState(o).label];
  const orderNo = (date) => `TM${date.replace(/-/g, '')}${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const makeOrder = ({ key, plan, qty = 1, tripIds = [], at = TODAY, gift = null }) => ({
    id: `o-${uid()}`, orderNo: orderNo(at), key, plan, qty, price: planPrice(key, plan, qty), tripIds, at, title: planLabel(key, plan),
    cards: Array.from({ length: qty }, (_, i) => ({ id: `c-${uid()}`, n: i + 1, claimed: Boolean(gift), installed: false, sharedAt: null, activatedAt: null, gift: Boolean(gift), from: gift?.from || '' })),
  });
  // Orders saved by the first version had one implicit card and a `kind` field.
  function migrateOrders() {
    orders.forEach((o) => {
      if (o.plan?.kind) {
        const { kind, size, days } = o.plan;
        if (kind === 'total') o.plan = { type: 'total', size: ['5', '10', '20'].includes(String(size)) ? String(size) : '5', days };
        else o.plan = size === 'unl' ? { type: 'unl', size: 'std', days } : { type: 'daily', size: String(size), days };
      }
      if (!o.cards) {
        o.qty = 1;
        o.cards = [{ id: `c-${uid()}`, n: 1, claimed: Boolean(o.installed), installed: Boolean(o.installed), sharedAt: null, activatedAt: null }];
      }
      if (!o.orderNo) o.orderNo = orderNo(o.at || TODAY);
      o.title = planLabel(o.key, o.plan);
    });
  }

  // ---------- photos (web/travel-photos.json: Wikimedia Commons, credited to each author)
  let PHOTOS = {};
  const photoOf = (key) => PHOTOS[key] || null;
  const destPhoto = (id) => photoOf(`dest:${id}`);
  const spotPhoto = (destId, name) => photoOf(`spot:${destId}:${name}`);
  const culturePhoto = (code, name) => photoOf(`culture:${code}:${name}`);
  const creditHtml = (p) => (p ? `<a class="credit-mini" href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.author || 'Wikimedia Commons')}${p.license ? `・${esc(p.license)}` : ''}</a>` : '');
  const imgHtml = (p, alt) => (p ? `<img src="${esc(p.src)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '');
  const photoCard = (p, title, sub = '') => `<figure class="ph-card"><div class="ph ${p ? '' : 'ph-missing'}">${imgHtml(p, title)}</div><figcaption><b>${esc(title)}</b>${sub}${creditHtml(p)}</figcaption></figure>`;
  async function loadPhotos() {
    try {
      const res = await fetch('travel-photos.json');
      if (res.ok) PHOTOS = (await res.json()).photos || {};
    } catch { /* photos are optional */ }
  }
  // A photo that fails to load leaves the designed placeholder instead of a broken image.
  document.addEventListener('error', (e) => {
    const box = e.target.tagName === 'IMG' && e.target.closest('.ph, .cover, .album-photo');
    if (box) { box.classList.add('ph-missing'); e.target.remove(); }
  }, true);

  // ---------- famous sights of every country (web/travel-sights.json, built by scripts/travel-sights.js)
  let SIGHTS = null;
  function loadSights() {
    if (!loadSights.p) {
      loadSights.p = fetch('travel-sights.json').then((r) => r.json()).then((d) => { SIGHTS = d.sights || {}; }).catch(() => { SIGHTS = {}; });
    }
    return loadSights.p;
  }
  const sightsOf = (code) => (SIGHTS && SIGHTS[code]) || [];
  // Sights the build script could not look up get their photo and position from Wikipedia in the browser.
  const sightPending = {};
  const sightCache = store.get('sights', {});
  function fillSight(x) {
    if (x.img && x.lat != null) return Promise.resolve(x);
    const key = `sight:${x.t}`;
    if (sightCache[key]) return Promise.resolve(Object.assign(x, { ...sightCache[key], ...x }));
    if (!sightPending[x.t]) {
      sightPending[x.t] = fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(x.t.replace(/ /g, '_'))}`, { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const add = {};
          const original = d?.originalimage;
          const thumb = d?.thumbnail?.source;
          if (original?.source) add.img = { src: original.width > 1280 && thumb ? thumb.replace(/\/\d+px-/, '/1280px-') : original.source, page: d.content_urls?.desktop?.page || '' };
          if (d?.coordinates) { add.lat = d.coordinates.lat; add.lng = d.coordinates.lon; }
          if (d) { sightCache[key] = add; store.set('sights', sightCache); }
          return add;
        })
        .catch(() => ({}));
    }
    return sightPending[x.t].then((add) => Object.assign(x, { ...add, ...x }));
  }
  // Wikimedia renders thumbnails in standard widths; small tiles ask for a small one.
  const thumbAt = (src, w) => (/\/thumb\/.+\/\d+px-[^/]+$/.test(src || '') ? src.replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`) : src);
  const sightImg = (x, w = 500) => (x.img ? `<img src="${esc(thumbAt(x.img.src, w))}" alt="${esc(x.n)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '');
  // Every sight with a photo and a position, for the globe's photo layer: the best-known of each country first.
  // A country's best-known sight without a recorded position stands at the country's centre, so every
  // country still shows a photo.
  const worldSights = () => Object.entries(SIGHTS || {}).flatMap(([code, list]) => list.map((x, i) => {
    const at = x.lat != null ? { lng: x.lng, lat: x.lat } : (i === 0 && GEO[code]) || null;
    return x.img && at ? {
      code, i, name: x.n, lng: at.lng, lat: at.lat, photo: thumbAt(x.img.src, 250), rank: i, home: COUNTRIES[code] ? 0 : 1,
    } : null;
  }).filter(Boolean)).sort((a, b) => a.rank - b.rank || a.home - b.home);
  const sightCredit = (x) => (x.img ? `<a class="credit-mini" href="${esc(x.img.page)}" target="_blank" rel="noopener">${esc(x.img.author || 'Wikimedia Commons')}${x.img.license ? `・${esc(x.img.license)}` : ''}</a>` : '');
  // Puts photos into sight tiles already on screen as they arrive.
  function hydrateSights(code) {
    return Promise.all(sightsOf(code).map((x, i) => fillSight(x).then(() => {
      if (!x.img) return;
      $$('[data-sight]').filter((b) => b.dataset.sight === `${code}:${i}` && !b.querySelector('img')).forEach((b) => {
        const holder = b.querySelector('.ph') || b;
        holder.classList.remove('ph-missing');
        holder.insertAdjacentHTML('afterbegin', sightImg(x));
      });
    })));
  }
  const sightCards = (code, skip = -1) => sightsOf(code).map((x, i) => (i === skip ? '' : `<button class="ph-card city pop" data-sight="${code}:${i}" style="--d:${i * 60}ms"><div class="ph ${x.img ? '' : 'ph-missing'}">${sightImg(x)}</div><figcaption><b>${esc(x.n)}</b><small class="muted">${esc(x.b)}</small></figcaption></button>`)).join('');

  // ---------- every country (探索世界), names in Traditional Chinese
  const REGION_NAMES = ZH_REGION;
  const countryName = (code) => COUNTRIES[code]?.name || REGION_NAMES?.of(code) || code;
  const WORLD_CODES = Object.fromEntries(Object.entries(WORLD).map(([k, v]) => [k, v.split(' ')]));
  const ALL_CODES = [...new Set(Object.values(WORLD_CODES).flat())].filter((c) => c !== 'TW');
  function packFor(code) {
    if (COUNTRIES[code]?.base) return code;
    if (PACKS.EU.countries.includes(code)) return 'EU';
    if (PACKS.ASIA.countries.includes(code)) return 'ASIA';
    return 'GLOBAL';
  }

  // ---------- trip cost estimate (概估) used by 隨機出國 and 預算回推
  const FLIGHT_COST = [[2, 7000], [3.5, 11000], [5, 14000], [10, 26000], [13, 33000], [99, 38000]];
  const flightCost = (hours) => FLIGHT_COST.find(([max]) => hours <= max)[1];
  function tripCost(d, days, people = 1) {
    const day = DAY_COST[d.c] || 5000;
    const flight = flightCost(d.hours) * people;
    const stay = day * days * people;
    const tickets = ticketTotal(d) * people;
    const esim = planPrice(d.c, { type: 'daily', size: '2', days: Math.min(30, days) }) * people;
    return { day, flight, stay, tickets, esim, total: flight + stay + tickets + esim };
  }
  const costRows = (c) => `<div class="cost">
    <div><span>來回機票</span><b>NT$${fmt(c.flight)}</b></div><div><span>住宿・餐飲・交通</span><b>NT$${fmt(c.stay)}</b></div>
    <div><span>景點門票</span><b>NT$${fmt(c.tickets)}</b></div><div><span>eSIM</span><b>NT$${fmt(c.esim)}</b></div>
    <div class="total"><span>概估總計</span><b>NT$${fmt(c.total)}</b></div></div>`;

  // ---------- demo data
  const demoTrip = (dest, start, end, tags, gb) => {
    const d = DEST[dest];
    return {
      id: `d-${dest}-${start}`, n: COUNTRIES[d.c].n, dest, city: d.name, lat: d.lat, lng: d.lng, start, end, tags, gb, note: '', src: 'demo',
    };
  };
  function loadDemo() {
    trips = [
      demoTrip('tokyo', '2025-01-10', '2025-01-15', ['city', 'shopping', 'food'], 7.8),
      demoTrip('seoul', '2025-03-20', '2025-03-24', ['food', 'shopping', 'night'], 5.1),
      demoTrip('bangkok', '2025-05-01', '2025-05-05', ['food', 'night', 'culture'], 4.6),
      demoTrip('danang', '2025-07-12', '2025-07-17', ['island', 'food', 'family'], 6.3),
      demoTrip('kyoto', '2025-11-20', '2025-11-25', ['culture', 'food', 'art'], 5.5),
      demoTrip('osaka', '2026-02-14', '2026-02-18', ['food', 'family', 'shopping'], 6.9),
      demoTrip('singapore', '2026-04-03', '2026-04-06', ['city', 'family', 'food'], 3.8),
      demoTrip('bali', '2026-06-20', '2026-06-26', ['island', 'nature', 'adventure'], 8.2),
      demoTrip('paris', '2026-09-10', '2026-09-15', ['art', 'culture', 'food'], 9.4),
      demoTrip('london', '2026-09-16', '2026-09-20', ['city', 'art', 'shopping'], 6.1),
      demoTrip('sapporo', '2026-12-18', '2026-12-24', ['snow', 'food', 'onsen'], 0),
    ];
    orders = [];
    journeys(trips).forEach((j) => {
      const key = coverFor(j.map((t) => country(t.n).code));
      const days = daysBetween(j[0].start, j[j.length - 1].end);
      const upcoming = isUpcoming(j[0]);
      // The coming trip is a family order: two cards, the second shared with a friend.
      const o = makeOrder({ key, plan: { type: 'daily', size: '2', days }, qty: upcoming ? 2 : 1, tripIds: j.map((t) => t.id), at: upcoming ? addDays(TODAY, -1) : addDays(j[0].start, -7) });
      if (upcoming) o.cards[1].sharedAt = `${addDays(TODAY, -1)}T21:23`;
      else o.cards.forEach((c) => { c.claimed = true; c.installed = true; c.activatedAt = j[0].start; });
      orders.push(o);
    });
    cart = [];
    save();
  }

  // ---------- LINE login + cloud sync (only when the server has TRAVEL_LIFF_ID)
  let liffReady = null;
  const sync = { state: 'off', at: 0, timer: null };
  function loadLiff() {
    if (!CONFIG.liff) return Promise.resolve(null);
    if (!liffReady) {
      liffReady = new Promise((resolve) => {
        const tag = document.createElement('script');
        tag.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
        tag.onload = () => window.liff.init({ liffId: CONFIG.liff }).then(() => resolve(window.liff), () => resolve(null));
        tag.onerror = () => resolve(null);
        document.head.appendChild(tag);
      });
    }
    return liffReady;
  }
  async function syncCall(path, body = {}) {
    const liff = await loadLiff();
    const idToken = liff?.isLoggedIn() ? liff.getIDToken() : null;
    if (!idToken) { const err = new Error('請重新用 LINE 登入'); err.status = 401; throw err; }
    const res = await fetch(`api/sync/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.status = res.status; throw err; }
    return data;
  }
  const snapshot = () => ({
    user: { name: user?.name || '' }, trips, orders, cart, wish, settings, updatedAt: store.get('updatedAt', Date.now()),
    photos: LIB.filter((p) => p.cloud).map(photoMeta), // eslint-disable-line no-use-before-define
  });
  function renderSync() {
    const box = $('#sync-status');
    if (!box) return;
    if (!CONFIG.liff) { box.hidden = true; return; }
    box.hidden = false;
    const time = sync.at ? new Date(sync.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '';
    const text = {
      ok: `已用 LINE 登入（${esc(user?.name || '')}），${time} 同步完成`, syncing: '同步中…', error: '同步失敗，資料先存在這支手機，稍後會再試', login: 'LINE 登入已過期，請重新登入',
    }[sync.state];
    box.innerHTML = user?.line ? `<span class="small">${text || '已用 LINE 登入'}</span><button class="btn sm" data-sync-now>立即同步</button>`
      : '<span class="small">用 LINE 登入後，換手機也看得到你的行程與 eSIM</span><button class="btn sm line" data-line-login>用 LINE 登入</button>';
  }
  async function pushNow() {
    if (!user?.line) return;
    sync.state = 'syncing'; renderSync();
    try {
      await syncCall('push', { data: snapshot() });
      sync.state = 'ok'; sync.at = Date.now();
    } catch (err) {
      sync.state = err.status === 401 ? 'login' : 'error';
    }
    renderSync();
  }
  function schedulePush() {
    if (!user?.line || !CONFIG.liff) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(pushNow, 2500);
  }
  // After LINE login: the newer copy wins (the cloud's or this phone's), then both match.
  async function lineLogin() {
    const liff = await loadLiff();
    if (!liff) { toast('LINE 登入暫時無法使用，請稍後再試'); return; }
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href.split('#')[0] }); return; }
    const profile = await liff.getProfile().catch(() => null);
    sync.state = 'syncing';
    try {
      const { data } = await syncCall('pull');
      const localAt = user ? store.get('updatedAt', 0) : 0;
      if (data && (data.updatedAt || 0) >= localAt) {
        trips = Array.isArray(data.trips) ? data.trips : [];
        orders = Array.isArray(data.orders) ? data.orders : [];
        cart = Array.isArray(data.cart) ? data.cart : [];
        wish = Array.isArray(data.wish) ? data.wish : [];
        Object.assign(settings, data.settings || {});
        migrateOrders();
        store.set('updatedAt', data.updatedAt || Date.now());
      }
      user = { ...(user || {}), name: profile?.displayName || data?.user?.name || user?.name || '旅人', line: true, since: user?.since || TODAY };
      save(true);
      if (!data || (data.updatedAt || 0) < localAt) await pushNow();
      restoreCloudPhotos(data?.photos).then(queueBackup); // eslint-disable-line no-use-before-define
      sync.state = 'ok'; sync.at = Date.now();
    } catch (err) {
      sync.state = 'error';
      user = { ...(user || {}), name: profile?.displayName || user?.name || '旅人', line: true, since: user?.since || TODAY };
      save(true);
      toast(`雲端同步失敗：${err.message}`);
    }
    showApp();
    renderSync();
  }

  // ---------- installable app (PWA): home-screen install, offline use
  let installPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  function renderInstall() {
    const box = $('#install-card');
    if (!box) return;
    const dismissed = store.get('installDismissed', false);
    box.hidden = isStandalone() || dismissed || !(installPrompt || isIos);
    box.innerHTML = `<div class="grow"><b>把旅圖加到主畫面</b><div class="small muted">像 App 一樣全螢幕打開，沒有網路也看得到行程與安裝教學。</div></div>
      <button class="btn primary sm" data-install-app>${installPrompt ? '安裝' : '怎麼加'}</button><button class="icon-btn" data-install-dismiss aria-label="不要再顯示">✕</button>`;
  }
  async function installApp() {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice.catch(() => ({}));
      installPrompt = null;
      if (outcome === 'accepted') toast('已加到主畫面');
      renderInstall();
      return;
    }
    openModal('加到主畫面', `<ol class="steps">
        <li>用 <b>Safari</b> 打開這個網頁（LINE 裡請先點右上角「⋯」→「用預設瀏覽器開啟」）</li>
        <li>點下方中間的<b>分享</b>按鈕（方框加向上箭頭）</li>
        <li>往下滑，選<b>「加入主畫面」</b></li>
        <li>按右上角<b>「新增」</b>，主畫面就會出現旅圖的圖示</li></ol>
      <p class="small muted" style="margin:0">之後從主畫面打開，會全螢幕顯示；出國還沒裝好 eSIM 時，也能看行程與安裝教學。</p>`, { sheet: true });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; renderInstall(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; renderInstall(); });
  function renderOnline() {
    const bar = $('#offline-bar');
    if (bar) bar.hidden = navigator.onLine;
  }
  window.addEventListener('online', renderOnline);
  window.addEventListener('offline', renderOnline);
  if ('serviceWorker' in navigator && /^(https:|http:\/\/(localhost|127\.0\.0\.1))/.test(window.location.href) && window.top === window.self) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  // ---------- login
  function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#avatar').textContent = (user?.name || '旅').slice(0, 1);
    renderAll();
    if (!world) loadWorld();
    if (pendingGift) openGift(pendingGift);
  }
  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-line').hidden = !CONFIG.liff;
    $('#cart-fab').hidden = true;
    $('#login-gift').hidden = !pendingGift;
    if (pendingGift) $('#login-gift').innerHTML = `<b>${esc(pendingGift.f)}</b> 送你一張 ${esc(target(pendingGift.k).name)} eSIM，登入後就能領取。`;
    $('#login-name').value = user?.name || '';
  }
  $('#login-demo').addEventListener('click', () => {
    user = { name: $('#login-name').value.trim() || '旅人', since: TODAY };
    loadDemo();
    showApp();
  });
  $('#login-new').addEventListener('click', () => {
    user = { name: $('#login-name').value.trim() || '旅人', since: TODAY };
    trips = []; orders = []; save();
    showApp();
  });
  $('#logout').addEventListener('click', async () => {
    if (user?.line) { const liff = await loadLiff(); if (liff?.isLoggedIn()) liff.logout(); }
    user = null; save(true); showLogin();
  });
  $('#login-line').addEventListener('click', lineLogin);
  $('#load-demo').addEventListener('click', () => {
    const run = () => { loadDemo(); renderAll(); toast('已載入範例足跡'); };
    if (!trips.length) { run(); return; }
    askConfirm('載入範例足跡？', '範例會取代目前所有的行程、行程表與 eSIM 紀錄。想保留的話，先到「足跡」匯出備份。', '取代為範例', run);
  });

  // ---------- tabs (with smooth view transitions)
  let currentTab = 'map';
  let popChip = ''; // the chip just tapped in 探索, so it pops after the list re-renders
  function go(tab) {
    if (document.documentElement.classList.contains('map-open')) setMapFull(false);
    if (tab === currentTab) return;
    const swap = () => {
      currentTab = tab;
      $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      $$('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== tab; });
      window.scrollTo({ top: 0 });
      if (tab === 'map') requestAnimationFrame(drawMap);
      if (tab === 'plan') renderPlanner();
      renderCartFab(); renderFab();
      animateIn($(`[data-view="${tab}"]`));
    };
    if (document.startViewTransition && !REDUCED) {
      // A transition can be cut short (e.g. the phone rotates); the tab still switches.
      const vt = document.startViewTransition(swap);
      vt.ready.catch(() => {}); vt.finished.catch(() => {});
    } else swap();
  }
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) go(g.dataset.goto);
  });

  // Staggered entrance for cards and count-up numbers.
  function animateIn(root) {
    if (REDUCED || !root) return;
    $$('.card, .tcard, .trip, .country', root).forEach((node, i) => {
      node.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], {
        duration: 420, delay: Math.min(i, 12) * 35, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards',
      });
    });
    $$('[data-count]', root).forEach((node) => {
      const to = Number(node.dataset.count); const dec = Number(node.dataset.dec || 0); const t0 = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - t0) / 700); const v = to * (1 - (1 - p) ** 3);
        node.textContent = dec ? v.toFixed(dec) : fmt(v);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  const count = (v, dec = 0) => `<b data-count="${v}" data-dec="${dec}">${dec ? Number(v).toFixed(dec) : fmt(v)}</b>`;

  // ---------- year filter
  $$('#year-seg button').forEach((b) => b.addEventListener('click', () => {
    settings.year = b.dataset.year; save();
    $$('#year-seg button').forEach((x) => x.classList.toggle('on', x === b));
    renderHero(); renderStats(); drawMap();
  }));

  // ---------- hero
  function yearLine(y) {
    const s = stats(y);
    if (!s.list.length) return `<div><b>${y}</b>：還沒有紀錄</div>`;
    const top = s.topElements[0];
    const soon = s.upcoming.length ? `，另有 ${s.upcoming.length} 趟即將出發` : '';
    return `<div><button class="tap-text" data-review="${y}"><b>${y}</b>：去了 ${s.countries.size} 個國家、${s.cities.size} 座城市、${s.days} 天${soon}${top ? `｜最常玩${el(top[0]).label}` : ''} ›</button></div>`;
  }
  function renderHero() {
    const name = esc(user?.name || '旅人');
    const all = stats('all');
    const next = upcomingTrips()[0];
    let nextHtml = '';
    if (next) {
      const d = daysBetween(TODAY, next.start) - 1;
      const pick = smartPick();
      const order = orders.find((o) => o.tripIds?.includes(next.id));
      const esimState = order ? orderStatus(order)[1] : '還沒買 eSIM';
      nextHtml = `<div class="next-trip"><div style="font-size:30px">${flag(country(next.n).code)}</div>
        <div style="flex:1;min-width:180px"><button class="tap-text" data-trip="${next.id}"><b>下一站：${esc(next.city)} ›</b></button><div class="small">${md(next.start)}–${md(next.end)}・${isOngoing(next) ? '旅行中' : `還有 ${d} 天`}・eSIM：${esimState}</div></div>
        ${order ? '<button class="btn sm" data-goto="esim">查看 eSIM</button>' : `<button class="btn sm" data-plan="${pick?.key || ''}">買 eSIM</button>`}
        <button class="btn sm" data-near="${next.id}">附近還能去哪</button></div>`;
    }
    $('#hero').innerHTML = trips.length ? `
      <h2 class="serif">${name}的 2025–2026</h2>
      <p style="margin:4px 0 0" class="muted"><button class="tap-text" data-badge="c10" data-by="all">去過 ${all.countries.size} 個國家</button>・${travelerType(all)}</p>
      <div class="yr">${CONFIG.years.map(yearLine).join('')}</div>${nextHtml}` : `
      <h2 class="serif">${name}，從第一趟開始</h2>
      <p style="margin:6px 0 12px;opacity:.92">新增去過的旅行，或匯入 Google 地圖時間軸，自動找出 2025、2026 去過的國家。</p>
      <div class="row"><button class="btn" data-goto="trips">＋ 新增第一趟</button><button class="btn" id="hero-demo">看範例足跡</button></div>`;
    $('#hero-demo')?.addEventListener('click', () => { loadDemo(); renderAll(); });
  }

  function renderStats() {
    const s = stats(settings.year);
    const items = [
      [count(s.countries.size), '國家・地區'], [count(s.cities.size), '城市'], [count(s.days), '旅行天數'],
      [count(s.km), '飛行公里'], [count(s.gb, 1), 'eSIM 用量 GB'],
    ];
    const opens = ['data-badge="c10"', 'data-goto="trips"', 'data-badge="month"', 'data-badge="km"', 'data-goto="esim"'];
    $('#stats').innerHTML = items.map(([v, l], i) => `<button class="stat" ${opens[i]} data-by="${settings.year}">${v}<span>${l} ›</span></button>`).join('');
    animateIn($('#stats'));
  }

  // ---------- map (web/travel-map.js): NASA satellite imagery as a 3D globe or a flat map
  let worldMap = null;
  async function loadWorld() {
    try {
      const [topo, lite] = await Promise.all(['vendor/countries-50m.json', 'vendor/countries-110m.json'].map((u) => fetch(u).then((r) => r.json())));
      const features = topojson.feature(topo, topo.objects.countries).features.filter((f) => f.id !== '010'); // 南極洲
      world = {
        features,
        byId: new Map(features.map((f) => [f.id, f])),
        bounds: features.map((f) => d3.geoBounds(f)),
        lite: topojson.feature(lite, lite.objects.countries).features.filter((f) => f.id !== '010'),
        borders: topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b),
        bordersLite: topojson.mesh(lite, lite.objects.countries, (a, b) => a !== b),
      };
      $('#map-loading').hidden = true;
      drawMap();
      if (user) { renderCover(); if (currentTab === 'plan') renderPlanner(); }
    } catch (err) {
      $('#map-loading').textContent = '地圖載入失敗，請重新整理';
    }
  }
  function visitMap(year) {
    const m = new Map();
    tripsIn(year).forEach((t) => {
      const e = m.get(t.n) || { years: new Set(), soon: false };
      if (isUpcoming(t)) e.soon = true; else e.years.add(tripYear(t));
      m.set(t.n, e);
    });
    return m;
  }
  const visitClass = (v) => {
    if (!v) return '';
    if (v.years.size > 1) return 'vboth';
    if (v.years.has(2025)) return 'v25';
    if (v.years.has(2026)) return 'v26';
    return v.soon ? 'vsoon' : '';
  };
  const tripClass = (t) => (isUpcoming(t) ? 'soon' : `y${tripYear(t)}`);
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function mapData() {
    const h = home();
    const list = tripsIn(settings.year);
    const visits = new Map();
    visitMap(settings.year).forEach((v, n) => { const c = visitClass(v); if (c) visits.set(n, c); });
    const arcs = [];
    journeys(list).forEach((j) => {
      const pts = [[h.lng, h.lat], ...j.map((t) => [t.lng, t.lat]), [h.lng, h.lat]];
      for (let i = 0; i < pts.length - 1; i += 1) arcs.push([pts[i], pts[i + 1], tripClass(j[Math.min(i, j.length - 1)])]);
    });
    const been = new Set(trips.map((t) => t.dest));
    return {
      features: world.features,
      lite: world.lite,
      borders: world.borders,
      bordersLite: world.bordersLite,
      visits,
      home: h,
      arcs,
      trips: sortTrips(list).reverse().map((t) => ({
        id: t.id, lng: t.lng, lat: t.lat, city: t.city, cls: tripClass(t), code: country(t.n).code, photo: destPhoto(t.dest)?.src || null, date: `${md(t.start)}–${md(t.end)}`,
      })),
      recs: DESTS.filter((d) => !been.has(d.id)).map((d) => ({
        id: d.id, lng: d.lng, lat: d.lat, name: d.name, photo: destPhoto(d.id)?.src || null,
      })),
    };
  }
  function renderMapMode() {
    $$('#map-modes button').forEach((b) => b.classList.toggle('on', b.dataset.mapMode === (settings.mapMode || 'globe')));
  }
  function drawMap() {
    if (!world || currentTab !== 'map' || !window.TravelMap) return;
    if (!worldMap) {
      worldMap = window.TravelMap.create($('#map'), {
        name: countryName,
        flagSrc,
        colors: () => ({
          v25: cssVar('--y25'), v26: cssVar('--y26'), vboth: cssVar('--both'), vsoon: cssVar('--soon'), y2025: cssVar('--y25'), y2026: cssVar('--y26'), soon: cssVar('--soon'),
        }),
        onCountry: (n) => selectCountry(n),
        onTrip: (id) => openTrip(id),
        onDest: (id) => openDest(id),
        onSight: (code, i) => openSight(code, i),
        describeSight: (code, i) => {
          const x = sightsOf(code)[i];
          const f = flightInfo(code);
          return { title: x ? x.n : '', sub: [countryName(code), f ? f.text : ''].filter(Boolean).join('・') };
        },
      });
      worldMap.setMode(settings.mapMode || 'globe');
      $('#map').append($('#map-country'), $('#map-tip'));
      worldMap.setWorldPhotos(settings.mapPhotos !== false);
      loadSights().then(() => worldMap.setWorldSights(worldSights()));
      if (!store.get('tipSeen', false)) setTimeout(() => $('#map-tip').classList.add('show'), REDUCED ? 0 : 2200);
    }
    worldMap.setData(mapData());
    renderLegend(visitMap(settings.year));
    renderMapMode();
  }
  $('#map-modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-map-mode]');
    if (!b || !worldMap) return;
    settings.mapMode = b.dataset.mapMode;
    save();
    worldMap.setMode(settings.mapMode);
    renderMapMode();
  });
  function renderLegend(visits) {
    let c25 = 0; let c26 = 0; let both = 0; let soon = 0;
    visits.forEach((v) => {
      if (v.years.size > 1) both += 1; else if (v.years.has(2025)) c25 += 1; else if (v.years.has(2026)) c26 += 1; else if (v.soon) soon += 1;
    });
    const items = [];
    if (settings.year !== '2026') items.push(`<button class="tap-text" data-year-pick="${settings.year === '2025' ? 'all' : '2025'}"><i style="background:var(--y25)"></i>2025 去過 ${c25}</button>`);
    if (settings.year !== '2025') items.push(`<button class="tap-text" data-year-pick="${settings.year === '2026' ? 'all' : '2026'}"><i style="background:var(--y26)"></i>2026 去過 ${c26}</button>`);
    if (settings.year === 'all') items.push(`<button class="tap-text" data-badge="again" data-by="all"><i style="background:var(--both)"></i>兩年都去 ${both}</button>`);
    items.push(`<span><i style="background:var(--soon-fill);outline:1.5px dashed var(--soon)"></i>即將出發 ${soon}</span>`);
    const touch = window.matchMedia('(pointer: coarse)').matches;
    items.push(`<span class="spacer"></span><span>${touch ? '兩指轉動與縮放・⤢ 全螢幕單指操作' : '拖曳旋轉・Ctrl＋滾輪縮放'}・點國家看文化與飛行時間</span>`);
    $('#legend').innerHTML = items.join('');
  }
  // Full screen: the map fills the phone and takes one-finger gestures; Esc or ✕ closes it.
  function setMapFull(on) {
    $('.map-card').classList.toggle('full', on);
    if ($('#map-country').classList.contains('show')) setTimeout(renderMapCountry, 50); // floats in full screen, sits under the map on phones
    document.documentElement.classList.toggle('map-open', on);
    const b = $('#map-full');
    b.textContent = on ? '✕' : '⤢';
    b.setAttribute('aria-label', on ? '關閉全螢幕地圖' : '全螢幕地圖');
    b.setAttribute('aria-pressed', String(on));
    worldMap?.setExpanded(on);
  }
  $('#map-full').addEventListener('click', () => setMapFull(!worldMap?.expanded));
  // Sight photos on the globe, on unless turned off.
  function renderPhotoToggle() {
    const on = settings.mapPhotos !== false;
    $('#map-photos').setAttribute('aria-pressed', String(on));
    $('#map-photos').classList.toggle('on', on);
  }
  $('#map-photos').addEventListener('click', () => {
    settings.mapPhotos = settings.mapPhotos === false;
    save();
    worldMap?.setWorldPhotos(settings.mapPhotos);
    renderPhotoToggle();
    toast(settings.mapPhotos ? '地球上顯示各國景點照片' : '已隱藏景點照片');
  });
  renderPhotoToggle();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && worldMap?.expanded && !$('#modal').open) setMapFull(false); });
  $('#zoom-in').addEventListener('click', () => worldMap?.zoomBy(1.6));
  $('#zoom-out').addEventListener('click', () => worldMap?.zoomBy(1 / 1.6));
  $('#zoom-reset').addEventListener('click', () => worldMap?.reset());
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => worldMap?.resize(), 200); });
  function showOnMap(lng, lat) {
    go('map');
    setTimeout(() => worldMap?.focus(lng, lat, 5, true), REDUCED ? 80 : 400);
  }

  // ---------- modal
  const modal = $('#modal');
  function openModal(title, html, opts = {}) {
    $('#modal-title').innerHTML = title;
    $('#modal-body').innerHTML = html;
    modal.classList.toggle('tall', opts.sheet === 'tall');
    if (!modal.open) modal.showModal();
    modal.scrollTop = 0;
  }
  // On phones the dialog is a bottom sheet: drag its header down to close it.
  (function sheetDrag() {
    const head = $('.modal-head');
    let startY = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || window.innerWidth > 640) return;
      startY = e.clientY;
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (startY == null) return;
      modal.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
    });
    const end = (e) => {
      if (startY == null) return;
      const moved = e.clientY - startY;
      startY = null;
      modal.style.transform = '';
      if (moved > 90) modal.close();
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }());
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) modal.close(); });
  // In-page confirmation (browser confirm() dialogs are blocked in embedded previews).
  function askConfirm(title, message, action, onYes) {
    openModal(esc(title), `<p style="margin:0">${esc(message)}</p>
      <div class="actions"><button class="btn" data-close>取消</button><button class="btn primary" id="confirm-yes" style="background:var(--danger);border-color:var(--danger);color:#fff">${esc(action)}</button></div>`);
    $('#confirm-yes').addEventListener('click', () => { modal.close(); onYes(); });
  }

  // 吃了什麼・做了什麼: the country's classics as photo tiles to tick, plus anything typed in.
  function logHtml(t, kind) {
    const { code } = country(t.n);
    const cul = CULTURE[code];
    const done = kind === 'food' ? ateOf(t) : didOf(t);
    const base = cul ? (kind === 'food' ? cul.food : cul.culture).map(([zh]) => zh) : [];
    const extra = done.filter((x) => !base.includes(x));
    const word = kind === 'food' ? '吃過' : '做過';
    return `<div class="log" data-log-box="${t.id}:${kind}"><div class="log-grid">${base.map((zh) => {
      const on = done.includes(zh);
      const ph = culturePhoto(code, zh);
      return `<button class="log-item ${on ? 'on' : ''}" data-log="${t.id}" data-kind="${kind}" data-name="${esc(zh)}" aria-pressed="${on}"><span class="ph ${ph ? '' : 'ph-missing'}">${imgHtml(ph, zh)}<i class="log-check">${icon('check')}</i></span><b>${esc(zh)}</b><small>${on ? `${word}了` : `標記${word}`}</small></button>`;
    }).join('')}</div>
      ${extra.length ? `<div class="row" style="margin-top:8px">${extra.map((x) => `<button class="chip lg on" data-log="${t.id}" data-kind="${kind}" data-name="${esc(x)}" aria-pressed="true">${icon('check')}${esc(x)} ✕</button>`).join('')}</div>` : ''}
      <form class="row log-add" data-log-add="${t.id}" data-kind="${kind}" style="margin-top:8px"><input class="input" name="entry" maxlength="30" placeholder="${kind === 'food' ? '還吃了什麼？例如：一蘭拉麵' : '還做了什麼？例如：搭熱氣球'}" aria-label="${kind === 'food' ? '加一道吃過的' : '加一件做過的事'}"><button class="btn sm">加入</button></form></div>`;
  }
  function openTrip(id) {
    const t = trips.find((x) => x.id === id);
    if (!t) return;
    const c = country(t.n);
    const d = t.dest && DEST[t.dest];
    openModal(`${flag(c.code)} ${esc(t.city)}`, `
      <div class="muted">${t.start} – ${t.end}（${daysBetween(t.start, t.end)} 天）・${esc(c.name)}</div>
      <div class="row">${tripFlightChip(t)}${t.tags.map((k) => `${tagChip(k)}`).join('')}</div>
      ${Number(t.gb) ? `<div class="small">eSIM 用了 ${t.gb} GB</div>` : ''}
      ${t.note ? `<p>${esc(t.note)}</p>` : ''}
      ${CULTURE[c.code] ? `<section><h3>我吃了什麼</h3>${logHtml(t, 'food')}</section><section><h3>我做了什麼</h3>${logHtml(t, 'culture')}</section>` : ''}
      <section><h3>打卡印章 ${(t.checkins || []).length} 個</h3>${(t.checkins || []).length ? `<div class="stamp-row">${allCheckins([t]).map(stampHtml).join('')}</div>` : '<p class="small muted">還沒在這趟打卡，現在補打卡也可以。</p>'}
        <div class="row"><button class="btn primary" data-checkin="${t.id}">在 ${esc(t.city)} 打卡</button><button class="btn" data-share-trip="${t.id}">做成分享圖</button></div></section>
      ${d ? spotsHtml(d) : ''}
      <div class="actions">
        <button class="btn" data-near="${t.id}">附近還能去哪</button>
        <a class="btn" href="${gmaps(`${t.city} ${c.name}`)}" target="_blank" rel="noopener">Google 地圖 ↗</a>
        <button class="btn" data-open-plan="${t.id}">行程表</button>
        <button class="btn" data-edit="${t.id}">編輯</button>
      </div>`);
  }

  // ---------- recommendations
  function originOptions() {
    const opts = [];
    if (recState.gps) opts.push({ key: 'gps', label: '目前位置', ...recState.gps });
    else opts.push({ key: 'gps', label: '用目前位置' });
    opts.push({ key: 'home', label: `家・${home().name}`, lat: home().lat, lng: home().lng, name: home().name });
    const next = upcomingTrips()[0];
    if (next) opts.push({ key: `trip:${next.id}`, label: `下一站 ${next.city}`, lat: next.lat, lng: next.lng, name: next.city, next: true });
    sortTrips(trips.filter((t) => t.end < TODAY)).reverse().slice(0, 4).forEach((t) => {
      opts.push({
        key: `trip:${t.id}`, label: `去過・${t.city}`, lat: t.lat, lng: t.lng, name: t.city, code: country(t.n).code,
      });
    });
    const extra = recState.origin && !opts.find((o) => o.key === recState.origin.key) ? [recState.origin] : [];
    return [...opts, ...extra];
  }
  function defaultOrigin() {
    const opts = originOptions();
    return opts.find((o) => o.next) || opts.find((o) => o.key === 'home');
  }
  function elementPrefs() {
    const counts = {};
    trips.filter((t) => !isUpcoming(t)).forEach((t) => t.tags.forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
    const max = Math.max(1, ...Object.values(counts));
    return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / max]));
  }
  function recommend(origin, opts = recState, limit = 12) {
    const pref = elementPrefs();
    const visitedCities = new Set(trips.filter((t) => !isUpcoming(t)).map((t) => t.dest || t.city));
    const visitedCountries = new Set(trips.map((t) => t.n));
    return DESTS.map((d) => {
      const dist = haversine(origin, d);
      if (dist < 30) return null;
      if (opts.hours && d.hours > opts.hours) return null;
      if (opts.unvisited && visitedCities.has(d.id)) return null;
      if (opts.tags.length && !opts.tags.some((t) => d.tags.includes(t))) return null;
      if (opts.fee === 'free' && !freeCount(d)) return null;
      if (opts.fee === 'budget' && ticketTotal(d) > 1500) return null;
      if (opts.budget && tripCost(d, 5).total > opts.budget) return null;
      const why = [];
      let score = Math.max(0, 1 - dist / 4000) * 40;
      if (dist < 600) why.push(`離${origin.name} ${fmtKm(dist)}`);
      else if (dist < 2500) why.push(`離${origin.name} ${fmtKm(dist)}`);
      const matched = d.tags.filter((t) => pref[t] >= 0.5);
      score += (d.tags.reduce((s, t) => s + (pref[t] || 0), 0) / d.tags.length) * 30;
      if (matched.length) why.push(`你常玩${matched.slice(0, 2).map((k) => el(k).label).join('、')}`);
      if (opts.tags.length) score += 8;
      if (d.months.includes(Number(opts.month))) { score += 14; why.push(`${opts.month} 月適合去`); }
      const { n } = COUNTRIES[d.c];
      if (!visitedCities.has(d.id)) {
        score += 6;
        if (!visitedCountries.has(n)) { score += 4; why.push(`還沒去過${COUNTRIES[d.c].name}`); }
      } else why.push('去過，可以換季再去');
      const free = freeCount(d);
      if (free) why.push(`${free} 個景點免費`);
      return {
        d, dist, score: Math.round(Math.min(99, score + 10)), why: why.slice(0, 3),
      };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  function spotsHtml(d) {
    const c = COUNTRIES[d.c];
    return `<div class="gallery">${d.spots.map((x) => {
      const fee = `<span class="chip ${x.fee === 0 ? 'free' : 'fee'}">${x.fee === 0 ? '免費' : esc(ticketText(x))}</span>`;
      const sub = `<span class="row" style="gap:6px">${fee}<a class="small" href="${gmaps(`${x.name} ${d.name}`)}" target="_blank" rel="noopener">地圖 ↗</a></span>
        <small class="muted">${x.fee ? `成人門票 ≈ NT$${fmt(toTwd(x))}${x.note ? `・${esc(x.note)}` : ''}` : esc(x.note || '不需門票')}</small>`;
      return photoCard(spotPhoto(d.id, x.name), x.name, sub);
    }).join('')}</div>
    <div class="ticket-sum"><span>門票合計（成人）</span><b>≈ NT$${fmt(ticketTotal(d))}</b></div>
    <div class="small muted">參考價（匯率概估），以景點官網公告為準。貨幣 ${c.cur}・插座 ${esc(c.plug)}</div>`;
  }

  function travelCard(r, i) {
    const { d } = r;
    const c = COUNTRIES[d.c];
    const [c1, c2] = TAG_COLORS[d.tags[0]] || ['#1463ff', '#00b3a4'];
    const wished = wish.includes(d.id);
    return `<article class="tcard" data-card="${d.id}" style="--i:${i}">
      <div class="tcard-inner">
        <div class="face front">
          <div class="cover ${destPhoto(d.id) ? 'has-photo' : ''}" style="background:linear-gradient(135deg,${c1},${c2})">
            ${imgHtml(destPhoto(d.id), d.name)}
            ${d.months.includes(Number(recState.month)) ? `<span class="score">${recState.month} 月當季</span>` : '<span></span>'}
            <div><button class="small tap-text" style="opacity:.9;color:#fff" data-country-n="${c.n}">${flag(d.c)} ${c.name}・${r.dist ? fmtKm(r.dist) : ''}</button><h3>${esc(d.name)}</h3></div>
          </div>
          <div class="body">
            <div class="small">${esc(d.blurb)}</div>
            <div class="row">${d.tags.slice(0, 4).map((k) => `<button class="chip tag" data-rec-tag="${k}">${dot(k)}${el(k).label}</button>`).join('')}</div>
            <p class="why-line">${esc(r.why.join('・'))}</p>
            <button class="ticket-sum tap-text" data-flip><span>${d.spots.length} 個景點・${freeCount(d)} 個免費</span><b>≈ NT$${fmt(ticketTotal(d))} ›</b></button>
            <button class="small muted tap-text" data-country-n="${c.n}">台北直飛約 ${d.hours} 小時・最佳 ${d.months.length === 12 ? '全年' : `${d.months.slice(0, 4).join('、')} 月`}</button>
            <div class="actions">
              <button class="btn sm primary" data-flip>景點與門票 ↻</button>
              <button class="link-btn" data-ai="${d.id}">排行程 →</button>
              <span class="spacer"></span>
              <button class="heart-btn" data-wish="${d.id}" aria-pressed="${wished}" aria-label="加入願望清單">${wished ? '♥' : '♡'}</button>
            </div>
          </div>
        </div>
        <div class="face back">
          <div class="row"><h3>${flag(d.c)} ${esc(d.name)} 景點與門票</h3><span class="spacer"></span><button class="btn sm" data-flip>↺</button></div>
          ${spotsHtml(d)}
          <div class="actions">
            <a class="btn sm" href="${c.site}" target="_blank" rel="noopener">官方觀光網 ↗</a>
            <a class="btn sm" href="${gmaps(`${d.name} 景點`)}" target="_blank" rel="noopener">Google 地圖 ↗</a>
            <a class="btn sm" href="${gmaps(`${d.name} 美食`)}" target="_blank" rel="noopener">附近美食 ↗</a>
            <a class="btn sm" href="${gsearch(`${d.name} 自由行 攻略 ${new Date().getFullYear()}`)}" target="_blank" rel="noopener">最新攻略 ↗</a>
            <button class="btn sm" data-show="${d.id}">地圖上看</button>
            <button class="btn sm primary" data-plan="${d.c}">${c.name} eSIM</button>
          </div>
        </div>
      </div>
    </article>`;
  }

  function renderRecs() {
    if (!recState.origin) recState.origin = defaultOrigin();
    const opts = originOptions();
    $('#origin-chips').innerHTML = opts.map((o) => `<button class="chip el ${recState.origin?.key === o.key ? 'on' : ''}" data-origin="${esc(o.key)}">${originArt(o)}${esc(o.label)}</button>`).join('');
    $('#tag-chips').innerHTML = Object.entries(ELEMENTS).map(([k, v]) => `<button class="chip el ${recState.tags.includes(k) ? 'on' : ''}" data-tag="${k}">${elArt(k)}${v.label}</button>`).join('');
    if (popChip) { $(popChip)?.classList.add('just'); popChip = ''; }
    const list = recState.origin?.lat != null ? recommend(recState.origin) : [];
    $('#recs-count').textContent = list.length ? `從 ${recState.origin.name} 出發・${list.length} 個推薦` : '';
    $('#recs').innerHTML = list.length ? list.map(travelCard).join('') : '<div class="card muted">沒有符合條件的推薦，試著放寬篩選條件。</div>';
    animateIn($('#recs'));
  }
  function renderMapRecs() {
    const origin = defaultOrigin();
    const list = recommend(origin, {
      tags: [], month: recState.month, hours: 0, fee: 'any', unvisited: true, budget: 0,
    }, 6);
    $('#map-recs').innerHTML = list.map(travelCard).join('');
  }
  (function initRecControls() {
    $$('[data-art]').forEach((n) => { n.innerHTML = pic(n.dataset.art) + (n.dataset.art === 'passport' ? '<b class="stamp">新</b>' : ''); });
    const calNum = () => { $('.cal-num').textContent = recState.month; };
    // Changing a filter plays its picture once: the calendar flips, the plane takes off, the ticket tears, a coin drops.
    const playSel = (sel) => {
      const art = sel.parentElement.querySelector('.sel-art');
      if (!art) return;
      art.classList.remove('go');
      art.getBoundingClientRect();
      art.classList.add('go');
    };
    $('#rec-month').innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1} 月</option>`).join('');
    $('#rec-month').value = recState.month;
    calNum();
    $('#rec-month').addEventListener('change', (e) => { recState.month = Number(e.target.value); calNum(); playSel(e.target); renderRecs(); });
    $('#rec-hours').addEventListener('change', (e) => { recState.hours = Number(e.target.value); playSel(e.target); renderRecs(); });
    $('#rec-fee').addEventListener('change', (e) => { recState.fee = e.target.value; playSel(e.target); renderRecs(); });
    $('#rec-new').addEventListener('change', (e) => { recState.unvisited = e.target.checked; renderRecs(); });
    $('#rec-budget').addEventListener('change', (e) => { recState.budget = Number(e.target.value); playSel(e.target); renderRecs(); });
  }());
  function setOrigin(key) {
    if (key === 'gps') {
      if (!navigator.geolocation) { toast('這個瀏覽器不支援定位'); return; }
      toast('取得目前位置中…');
      navigator.geolocation.getCurrentPosition((pos) => {
        recState.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, name: '目前位置' };
        recState.origin = { key: 'gps', label: '目前位置', ...recState.gps };
        renderRecs();
      }, () => toast('無法取得位置，請允許定位或改選其他出發點'), { timeout: 10000 });
      return;
    }
    recState.origin = originOptions().find((o) => o.key === key) || recState.origin;
    renderRecs();
  }
  function nearFrom(lat, lng, name, key) {
    recState.origin = {
      key, label: `${name}`, lat, lng, name,
    };
    modal.close();
    go('recs');
    renderRecs();
  }

  // ---------- AI itinerary
  const ACTS = {
    food: '在地美食巡禮：搜尋「{city} 美食」，挑評分 4.3 以上的老店', culture: '走訪歷史街區與博物館', nature: '安排半天自然景點散策',
    island: '海灘或跳島半日遊，記得防曬', city: '城市散步＋咖啡廳', shopping: '商圈購物，記得辦退稅', onsen: '入住溫泉旅館泡湯', snow: '滑雪或雪景體驗',
    family: '親子樂園或水族館', night: '夜市與夜景', art: '美術館與設計小店', adventure: '戶外活動（浮潛、健行或飛行傘）',
  };
  function localPlan(d, days) {
    const out = [];
    const { tags } = d;
    for (let i = 1; i <= days; i += 1) {
      const spot = d.spots[(i - 1) % d.spots.length];
      const act = ACTS[tags[(i - 1) % tags.length]].replace('{city}', d.name);
      let line;
      if (i === 1) line = `抵達 ${d.name}，開啟 eSIM 數據漫遊 → ${spot.name}（${ticketText(spot)}）→ ${act}`;
      else if (i === days && days > 1) line = '睡飽退房 → 伴手禮與最後採買 → 前往機場';
      else line = `${spot.name}（${ticketText(spot)}）→ ${act}`;
      out.push(`<li><b>Day ${i}</b> ${esc(line)}</li>`);
    }
    return out.join('');
  }
  function mdToHtml(text) {
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    let html = ''; let list = false;
    esc(text).split('\n').forEach((raw) => {
      const l = raw.trimEnd();
      const li = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
      if (li) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(li[1])}</li>`; return; }
      if (list) { html += '</ul>'; list = false; }
      const hd = l.match(/^#{1,4}\s+(.*)/);
      if (hd) html += `<h4>${inline(hd[1])}</h4>`;
      else if (l.trim()) html += `<p>${inline(l)}</p>`;
    });
    return list ? `${html}</ul>` : html;
  }
  function openAi(id) {
    const d = DEST[id];
    const c = COUNTRIES[d.c];
    const days = Math.max(3, Math.min(7, Math.round(d.hours / 2) + 3));
    const pick = { ...pickForUsage(), days };
    openModal(`${flag(d.c)} ${esc(d.name)} ${days} 天行程`, `
      <div class="row"><label class="small muted" for="ai-days">天數</label><select class="input" id="ai-days" style="width:auto">${[2, 3, 4, 5, 6, 7, 8, 10].map((n) => `<option ${n === days ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <span class="spacer"></span>${CONFIG.ai ? '<button class="btn sm primary" id="ai-run">請 AI 客製</button>' : ''}</div>
      <div id="ai-out"><ul class="steps" style="gap:10px">${localPlan(d, days)}</ul></div>
      <div class="notice">行前清單：出發前一天在 Wi-Fi 下安裝 eSIM、抵達後把行動數據切到旅遊 eSIM 並開啟數據漫遊・貨幣 ${c.cur}・插座 ${esc(c.plug)}${c.note ? `・${esc(c.note)}` : ''}</div>
      ${spotsHtml(d)}
      <div class="actions">
        <button class="btn primary" data-plan="${d.c}">${esc(planLabel(d.c, pick))}・NT$${fmt(planPrice(d.c, pick))}</button>
        <a class="btn" href="${c.site}" target="_blank" rel="noopener">官方觀光網 ↗</a>
        <a class="btn" href="${gmaps(`${d.name} 景點`)}" target="_blank" rel="noopener">Google 地圖 ↗</a>
      </div>
      ${CONFIG.ai ? '' : '<p class="small muted">目前顯示內建行程建議；伺服器開啟 AI（TRAVEL_AI_ENABLED）後可依你的足跡客製。</p>'}`);
    $('#ai-days').addEventListener('change', (e) => {
      $('#ai-out').innerHTML = `<ul class="steps" style="gap:10px">${localPlan(d, Number(e.target.value))}</ul>`;
    });
    $('#ai-run')?.addEventListener('click', () => runAi(d, Number($('#ai-days').value)));
  }
  async function runAi(d, days) {
    const out = $('#ai-out');
    out.innerHTML = '<p class="muted">AI 規劃中，大約需要 10–30 秒…</p>';
    const s = stats('all');
    try {
      const res = await fetch('api/advise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: d.name,
          country: COUNTRIES[d.c].name,
          days,
          month: recState.month,
          tags: d.tags,
          likes: s.topElements.slice(0, 4).map(([k]) => k),
          visited: [...new Set(trips.map((t) => t.city))].slice(0, 20),
          home: home().name,
          spots: d.spots.map((x) => `${x.name}（${ticketText(x)}）`),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      out.innerHTML = `<div class="md">${mdToHtml(data.text)}</div>`;
    } catch (err) {
      out.innerHTML = `<p class="small" style="color:var(--danger)">AI 暫時無法使用：${esc(err.message)}</p><ul class="steps" style="gap:10px">${localPlan(d, days)}</ul>`;
    }
  }

  // ---------- eSIM store: browse → plan → cart → checkout → my eSIM (claim → install → activate) → share
  const UA = navigator.userAgent || '';
  const IS_IOS = /iPhone|iPad|iPod/.test(UA);
  const IS_ANDROID = /Android/.test(UA);
  let esimRegion = 'hot';
  let esimNear = false; // 探索世界: closest flights first
  let esimTab = null;
  let planState = null;
  const HOT = ['JP', 'KR', 'TH', 'VN', 'SG', 'HK', 'MO', 'MY', 'US', 'FR', 'GB', 'AU'];
  const REGION_CHIPS = [['hot', '精選熱門'], ['jk', '日韓'], ['sea', '東南亞'], ['hkmo', '中港澳'], ['southasia', '南亞'], ['mideast', '中東'], ['europe', '歐洲'], ['america', '美洲'], ['oceania', '大洋洲'], ['africa', '非洲'], ['centralasia', '中亞・高加索'], ['packs', '多國方案'], ['all', '全部']];
  const REGION_CODES = { hot: HOT, jk: ['JP', 'KR'], sea: ['TH', 'VN', 'SG', 'MY', 'ID', 'PH', 'KH', 'LA', 'MM', 'BN', 'TL'], hkmo: ['HK', 'MO', 'CN'] };
  function regionCodes(r) {
    if (r === 'all') return ALL_CODES;
    return (REGION_CODES[r] || WORLD_CODES[r] || []).filter((c) => c !== 'TW');
  }
  const allCards = () => orders.flatMap((o) => (o.cards || []).map((c) => ({ o, c, st: cardState(o, c) })));
  const findCard = (ref) => {
    const [oid, cid] = String(ref).split(':');
    const o = orders.find((x) => x.id === oid);
    return { o, c: o?.cards.find((x) => x.id === cid) };
  };
  const lineBtn = (label, attrs) => `<button class="btn line" ${attrs}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s5.9-3.5 8-6C21.4 14.2 22 12.7 22 11c0-4.4-4.5-8-10-8z" fill="currentColor"/></svg>${label}</button>`;

  function stepsHtml(st, shared) {
    const { step } = CARD_STATE[st];
    const items = [['取得 eSIM', shared && step === 0 ? '等待親友領取' : '領取安裝資料'], ['安裝到手機', '依建議時機安裝'], ['抵達開通', '開啟數據漫遊']];
    return `<ol class="track">${items.map(([t, sub], i) => {
      let cls = 'todo';
      if (i < step || st === 'expired') cls = 'done';
      else if (i === step) cls = 'now';
      return `<li class="${cls}"><span class="dot">${cls === 'done' ? '✓' : i + 1}</span><b>${t}</b><small>${cls === 'done' ? '完成' : sub}</small></li>`;
    }).join('')}</ol>`;
  }
  function cardActions(o, c, st) {
    const ref = `${o.id}:${c.id}`;
    if (st === 'unclaimed') return `<button class="btn primary" data-claim="${ref}">⬇ 取得 eSIM</button>${lineBtn('分享給親友', `data-share="${ref}"`)}`;
    if (st === 'shared') return `${lineBtn('再送一次分享連結', `data-share="${ref}"`)}<button class="btn" data-claim="${ref}">改成自己用</button>`;
    if (st === 'claimed') return `<button class="btn primary" data-install="${ref}">${IS_ANDROID ? '安裝 eSIM' : '一鍵安裝到 iPhone'}</button><button class="btn" data-guide-card="${ref}">圖文教學</button>`;
    if (st === 'installed') return `<button class="btn primary" data-activate="${ref}">我已抵達，開始使用</button><button class="btn" data-guide-card="${ref}">抵達後怎麼設定</button>`;
    if (st === 'active') return `<button class="btn" data-guide-card="${ref}">連不上網？</button><button class="btn" data-plan="${o.key}">加購天數</button>`;
    return `<button class="btn" data-plan="${o.key}">再買一次</button>`;
  }
  function esimCardHtml(o, c, st) {
    const t = target(o.key);
    const S = CARD_STATE[st];
    const ts = orderTrips(o);
    const used = st === 'expired' ? sum(ts, (x) => Number(x.gb)) / (o.qty || 1) : 0;
    let total = 0;
    if (o.plan.type === 'total') total = Number(o.plan.size);
    else if (o.plan.type === 'daily') total = Number(o.plan.size) * o.plan.days;
    return `<article class="esim-card">
      <div class="esim-top">
        <span class="flag-tile">${t.icon}</span>
        <div class="grow">
          <div class="row" style="gap:6px"><b class="esim-name">${esc(t.name)}</b><span class="status ${S.cls}">${S.label}</span>${o.qty > 1 ? `<span class="chip sm">第 ${c.n} 張（共 ${o.qty} 張）</span>` : ''}${c.gift ? `<span class="chip sm">${esc(c.from || '親友')}送的</span>` : ''}</div>
          <div class="small muted">${esc(planSpec(o.plan))}${ts.length ? `・${ts.map((x) => `<button class="tap-text" data-trip="${x.id}">${tripLabel(x)}</button>`).join(' → ')}` : ''}</div>
          <div class="small muted">${c.installed ? `手機上的名稱：<b>${esc(labelOf(o, c))}</b>` : `購買日期 ${o.at}`}</div>
        </div>
        <button class="icon-btn" data-card-open="${o.id}:${c.id}" aria-label="詳細資訊">⋯</button>
      </div>
      ${st === 'shared' ? '<div class="banner good">已分享給親友，等待領取</div>' : ''}
      ${['unclaimed', 'claimed', 'shared'].includes(st) ? `<div class="banner warn">${esc(installAdvice(o))}</div>` : ''}
      ${stepsHtml(st, st === 'shared')}
      ${st === 'expired' && used && total ? `<div><div class="usage"><div style="width:${Math.min(100, (used / total) * 100)}%"></div></div><div class="small muted" style="margin-top:4px">用了 ${used.toFixed(1)} GB／${total} GB</div></div>` : ''}
      <div class="actions two">${cardActions(o, c, st)}</div>
    </article>`;
  }
  function renderWallet() {
    const cards = allCards();
    const counts = { active: 0, pending: 0, expired: 0 };
    cards.forEach(({ st }) => { counts[CARD_STATE[st].tab] += 1; });
    if (!esimTab) esimTab = counts.pending || !counts.active ? 'pending' : 'active';
    const tabs = [['active', '使用中'], ['pending', '待啟用'], ['expired', '已到期']];
    $('#esim-tabs').innerHTML = tabs.map(([k, l]) => `<button data-esim-tab="${k}" class="${esimTab === k ? 'on' : ''}">${l}${counts[k] ? `<span class="count">${counts[k]}</span>` : ''}</button>`).join('');
    const list = cards.filter(({ st }) => CARD_STATE[st].tab === esimTab)
      .sort((a, b) => (esimTab === 'expired' ? b.o.at.localeCompare(a.o.at) : a.o.at.localeCompare(b.o.at)) || a.c.n - b.c.n);
    const empty = { active: '目前沒有使用中的 eSIM。', pending: '沒有待啟用的 eSIM。', expired: '還沒有到期的 eSIM。' };
    $('#wallet').innerHTML = list.length ? list.map(({ o, c, st }) => esimCardHtml(o, c, st)).join('')
      : `<div class="empty"><div class="empty-icon">${icon('plane')}</div><b>暫無資料</b><span class="muted small">${empty[esimTab]}</span><button class="btn primary" data-scroll="esim-shop">前往挑選方案</button></div>`;
  }
  function renderEsim() {
    $('#esim-site').href = CONFIG.esimUrl;
    renderWallet();
    const pick = smartPick();
    const bought = pick && pick.journey.some((t) => ordersFor(t.id).length);
    $('#smart-pick').innerHTML = pick && !bought ? `<div class="pick"><span class="flag-tile">${target(pick.key).icon}</span><div class="grow">
      <span class="small muted">下一趟適合的方案</span><b>${esc(planLabel(pick.key, pick.plan))}</b>
      <div class="small muted">${pick.journey.map(tripLabel).join(' → ')}・${md(pick.journey[0].start)} 出發${pick.journey.length > 1 ? `・跨 ${pick.journey.length} 地一張搞定` : ''}</div></div>
      <button class="btn primary" data-plan="${pick.key}">NT$${fmt(planPrice(pick.key, pick.plan))}</button></div>` : '';
    const chips = REGION_CHIPS.map(([k, v]) => `<button class="chip lg ${esimRegion === k ? 'on' : ''}" data-region="${k}">${v}</button>`).join('');
    $('#esim-regions').innerHTML = `${chips}<button class="chip lg sort-chip ${esimNear ? 'on' : ''}" data-esim-near aria-pressed="${esimNear}">${icon('flight')}由近到遠</button>`;
    const q = $('#esim-search').value.trim();
    let items;
    if (esimRegion === 'packs' && !q) {
      items = Object.keys(PACKS).map((k) => ({ key: k, icon: packIcon(k), name: PACKS[k].name, sub: `${PACKS[k].countries.length} 國` }));
    } else {
      const codes = q ? ALL_CODES.filter((code) => countryName(code).includes(q) || code.toLowerCase() === q.toLowerCase()) : regionCodes(esimRegion);
      items = codes.map((code) => ({ key: packFor(code), code, icon: flag(code), name: countryName(code) }));
      if (q) items.push(...Object.keys(PACKS).filter((k) => PACKS[k].name.includes(q)).map((k) => ({ key: k, icon: packIcon(k), name: PACKS[k].name })));
    }
    if (esimNear) {
      const hours = (it) => (it.code ? flightInfo(it.code)?.hours ?? 99 : 99);
      items.sort((a, b) => hours(a) - hours(b));
    }
    $('#esim-count').textContent = items.length ? `${items.length} 個國家・地區${esimNear ? `・從${home().name}飛最近的在前面` : ''}` : '';
    $('#esim-grid').innerHTML = items.length ? items.map((it) => `<button class="flag-btn" data-plan="${it.key}" ${it.code && it.code !== it.key ? `data-for="${it.code}"` : ''}><span class="flag-tile lg">${it.icon}</span><b>${esc(it.name)}</b>${it.code ? flightChip(it.code) : ''}<small>${it.code && it.code !== it.key ? `${esc(PACKS[it.key].name)}・` : ''}NT$${fmt(fromPrice(it.key))} 起</small></button>`).join('')
      : '<p class="muted">找不到這個國家，試試「多國方案」或「全球通用」。</p>';
    renderCartFab();
  }
  $('#esim-search').addEventListener('input', () => renderEsim());

  // Plan sheet
  function orderTripsEnd(ids) { return sortTrips(trips.filter((t) => ids.includes(t.id))).pop()?.end || TODAY; }
  function openPlan(key, preset = {}) {
    if (!key) { go('esim'); return; }
    const pick = smartPick();
    const fromTrip = pick?.key === key;
    planState = {
      key, ...pickForUsage(), days: fromTrip ? pick.plan.days : 5, qty: 1, tripIds: fromTrip ? pick.journey.map((t) => t.id) : [], ...preset,
    };
    const title = planState.forCountry && planState.forCountry !== key ? `${flag(planState.forCountry)} ${esc(countryName(planState.forCountry))}` : `${target(key).icon} ${esc(target(key).name)}`;
    openModal(title, '<div id="plan-sheet"></div>', { sheet: 'tall' });
    renderPlanSheet();
  }
  function renderPlanSheet() {
    const p = planState;
    const t = target(p.key);
    const type = PLAN_TYPES[p.type];
    if (!type.options.some((o) => o.size === String(p.size))) p.size = type.options[p.type === 'daily' ? 1 : 0].size;
    const trip = p.tripIds.length ? trips.find((x) => x.id === p.tripIds[0]) : null;
    const optHtml = (o) => {
      const price = p.type === 'total' ? planPrice(p.key, { type: 'total', size: o.size }) : planPrice(p.key, { type: p.type, size: o.size, days: p.days });
      const on = String(p.size) === o.size;
      return `<button class="plan-card ${on ? 'on' : ''} ${o.premium ? 'premium' : ''}" data-size="${o.size}" aria-pressed="${on}">
        <span class="icon-tile size">${p.type === 'unl' ? '∞' : `${o.size}<small>GB</small>`}</span>
        <span class="grow"><span class="row" style="gap:6px"><b class="plan-name">${esc(o.name)}</b><span class="persona">${esc(o.persona)}</span></span>
          <span class="desc">${esc(o.desc)}</span>
          ${o.perks ? `<span class="perks">${o.perks.map((x) => `<span>✓ ${esc(x)}</span>`).join('')}</span>` : ''}
          <span class="hashes">${o.tags.map((x) => `<span>#${esc(x)}</span>`).join('')}</span></span>
        <span class="plan-price">${o.speed ? `<small class="speed">超量降速<br>${o.speed}</small>` : ''}${o.days ? `<small class="speed">${o.days} 天內有效</small>` : ''}<b>NT$${fmt(price)}</b></span>
      </button>`;
    };
    const dayChips = [3, 5, 7, 10, 15, 30];
    const total = planPrice(p.key, p, p.qty);
    $('#plan-sheet').innerHTML = `
      ${p.forCountry && p.forCountry !== p.key ? `<div class="banner info">${flag(p.forCountry)} ${esc(countryName(p.forCountry))} 使用「${esc(t.name)}」方案，一張就能上網</div>` : ''}
      <div class="small muted">${t.pack ? `適用 ${t.countries.length} 國：${t.countries.slice(0, 14).map((c) => `${flag(c)} ${esc(countryName(c))}`).join('、')}${t.countries.length > 14 ? ' 等' : ''}` : `可連網路：${esc(t.ops)}（以官網為準）`}</div>
      ${trip ? `<div class="banner info">已依你的行程帶入：${esc(trip.city)} ${md(trip.start)}–${md(orderTripsEnd(p.tripIds))}，共 ${p.days} 天</div>` : ''}
      <div><h3>選擇最適合你的連網方式</h3><p class="small muted" style="margin:2px 0 0">不確定？<button class="link" data-guide="quiz">回答 3 題幫你挑</button></p></div>
      <div class="seg seg-lg seg-full" id="type-seg">${Object.entries(PLAN_TYPES).map(([k, v]) => `<button data-type="${k}" class="${p.type === k ? 'on' : ''}">${v.label}</button>`).join('')}</div>
      <p class="small muted" style="margin:0">${esc(type.note)}</p>
      <div class="grid" style="gap:10px">${type.options.map(optHtml).join('')}</div>
      ${p.type === 'total' ? '' : `<div class="field"><label>使用天數</label><div class="row">${dayChips.map((d) => `<button class="chip lg ${p.days === d ? 'on' : ''}" data-days-set="${d}">${d} 天</button>`).join('')}
        <span class="stepper"><button data-days-step="-1" aria-label="少一天">－</button><b>${p.days} 天</b><button data-days-step="1" aria-label="多一天">＋</button></span></div></div>`}
      <div class="row"><div><b>購買張數</b><div class="small muted">幫家人朋友一起買，買完可以用 LINE 分享</div></div><span class="spacer"></span>
        <span class="stepper"><button data-qty-step="-1" aria-label="少一張">－</button><b>${p.qty} 張</b><button data-qty-step="1" aria-label="多一張">＋</button></span></div>
      <p class="notice">示意價格，正式價格與方案以官網為準。</p>
      <div class="sheet-bar"><div><small class="muted">${esc(planSpec(p))}${p.qty > 1 ? ` × ${p.qty}` : ''}</small><div class="price">NT$${fmt(total)}</div></div><span class="spacer"></span>
        <button class="btn" data-add-cart>加入購物車</button><button class="btn primary" data-buy-now>直接購買</button></div>`;
  }
  function planSheetClick(e) {
    const b = e.target.closest('button');
    if (!b || !planState || !b.closest('#plan-sheet')) return false;
    const p = planState;
    const ds = b.dataset;
    if (ds.type) { p.type = ds.type; p.size = PLAN_TYPES[p.type].options[p.type === 'daily' ? 1 : 0].size; } else if (ds.size) p.size = ds.size;
    else if (ds.daysSet) p.days = Number(ds.daysSet);
    else if (ds.daysStep) p.days = Math.max(1, Math.min(30, p.days + Number(ds.daysStep)));
    else if (ds.qtyStep) p.qty = Math.max(1, Math.min(10, p.qty + Number(ds.qtyStep)));
    else if ('addCart' in ds) { addToCart(); return true; } else if ('buyNow' in ds) { addToCart(true); return true; } else return false;
    renderPlanSheet();
    return true;
  }
  function addToCart(checkoutNow) {
    const p = planState;
    const plan = { type: p.type, size: p.size, days: p.type === 'total' ? planOpt({ type: 'total', size: p.size }).days : p.days };
    cart.push({ id: `k-${uid()}`, key: p.key, plan, qty: p.qty, tripIds: p.tripIds });
    save();
    renderCartFab();
    if (checkoutNow) openCheckout(); else { modal.close(); toast(`已加入購物車：${planLabel(p.key, plan)}`); bumpFab(); }
  }

  // Cart, checkout, success
  function renderCartFab() {
    const fab = $('#cart-fab');
    // Only where it helps: on the eSIM tab, or once something is in the cart.
    fab.hidden = !user || (!cart.length && currentTab !== 'esim');
    const n = sum(cart, (k) => k.qty);
    $('#cart-count').textContent = n || '';
    $('#cart-count').hidden = !n;
  }
  function bumpFab() {
    if (!REDUCED) $('#cart-fab').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function openCart() {
    const total = sum(cart, (k) => planPrice(k.key, k.plan, k.qty));
    openModal('購物車', cart.length ? `
      <div class="grid" style="gap:10px">${cart.map((k) => `<div class="cart-row"><span class="flag-tile">${target(k.key).icon}</span><div class="grow"><b>${esc(target(k.key).name)}</b><div class="small muted">${esc(planSpec(k.plan))}</div><div class="small"><b>NT$${fmt(planPrice(k.key, k.plan, k.qty))}</b></div></div>
        <span class="stepper"><button data-cart-qty="${k.id}:-1" aria-label="少一張">－</button><b>${k.qty}</b><button data-cart-qty="${k.id}:1" aria-label="多一張">＋</button></span><button class="icon-btn" data-cart-del="${k.id}" aria-label="移除">✕</button></div>`).join('')}</div>
      <div class="sheet-bar"><div><small class="muted">共 ${sum(cart, (k) => k.qty)} 張</small><div class="price">NT$${fmt(total)}</div></div><span class="spacer"></span><button class="btn primary" data-checkout>前往結帳</button></div>`
      : `<div class="empty"><div class="empty-icon">${icon('cart')}</div><b>購物車是空的</b><span class="small muted">${smartPick() ? '依你的下一趟行程，我們已經挑好方案。' : '先挑一個目的地吧。'}</span>${smartPick() ? `<button class="btn primary" data-plan="${smartPick().key}">看推薦方案</button>` : '<button class="btn primary" data-scroll="esim-shop">去挑方案</button>'}</div>`, { sheet: true });
  }
  function openCheckout() {
    const total = sum(cart, (k) => planPrice(k.key, k.plan, k.qty));
    const pays = [['card', '信用卡'], ['apple', 'Apple Pay'], ['line', 'LINE Pay']];
    openModal('結帳', `
      <div class="grid" style="gap:8px">${cart.map((k) => `<div class="row small"><span>${target(k.key).icon} ${esc(planLabel(k.key, k.plan))} × ${k.qty}</span><span class="spacer"></span><b>NT$${fmt(planPrice(k.key, k.plan, k.qty))}</b></div>`).join('')}</div>
      <div class="field"><label for="co-email">接收 eSIM 的 Email</label><input class="input" id="co-email" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(user?.email || '')}"></div>
      <div class="field"><label>付款方式</label><div class="pay-grid">${pays.map(([k, l], i) => `<label class="pay"><input type="radio" name="pay" value="${k}" ${i === (IS_IOS ? 1 : 0) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <label class="row small"><input type="checkbox" id="co-agree" checked> 我已確認手機支援 eSIM，並同意使用條款</label>
      <p class="notice">示範結帳：不會真的扣款。正式購買請到 <a href="${CONFIG.esimUrl}" target="_blank" rel="noopener">官網</a>。</p>
      <div class="sheet-bar"><div><small class="muted">應付金額</small><div class="price">NT$${fmt(total)}</div></div><span class="spacer"></span><button class="btn primary" data-pay>確認付款（示範）</button></div>`, { sheet: true });
  }
  function pay() {
    const email = $('#co-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('請填寫正確的 Email，eSIM 會寄到這裡'); $('#co-email').focus(); return; }
    if (!$('#co-agree').checked) { toast('請先確認手機支援 eSIM'); return; }
    user.email = email;
    const btn = $('[data-pay]');
    btn.disabled = true; btn.textContent = '付款處理中…';
    setTimeout(() => {
      const made = cart.map((k) => makeOrder({ key: k.key, plan: k.plan, qty: k.qty, tripIds: k.tripIds }));
      orders.push(...made);
      cart = [];
      save();
      esimTab = 'pending';
      renderAll();
      openSuccess(made);
    }, REDUCED ? 100 : 900);
  }
  function openSuccess(made) {
    const first = made[0];
    const many = sum(made, (o) => o.qty) > 1;
    openModal('', `<div class="success">
        <div class="check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>
        <h2>購買成功！</h2><div class="small muted">訂單編號 #${esc(first.orderNo)}・eSIM 已寄到 ${esc(user.email || '')}</div>
      </div>
      <div class="banner warn"><b>安裝時機建議</b><br>${esc(installAdvice(first))}到「我的 eSIM」依步驟取得並安裝。在台灣顯示「無法啟用」不一定是安裝失敗。</div>
      ${many ? `<div class="card soft"><b>幫親友買？直接分享</b><p class="small muted" style="margin:6px 0 10px">把其中一張 eSIM 用 LINE 傳給同行的人，對方點連結就能領取並一鍵安裝。</p>${lineBtn('分享安裝資訊給好友', `data-share="${first.id}:${first.cards[first.cards.length - 1].id}"`)}</div>` : ''}
      <div class="actions two"><button class="btn primary" data-goto-esim>查看我的 eSIM</button><button class="btn" data-close>繼續逛逛</button></div>`, { sheet: true });
  }

  // Card detail, claim, install, activate, share
  function openCardDetail(ref) {
    const { o, c } = findCard(ref);
    if (!o) return;
    const st = cardState(o, c);
    const t = target(o.key);
    const claimBy = addDays(o.at, POLICY.claimDays);
    openModal(`${t.icon} ${esc(t.name)}`, `
      <div class="row" style="gap:6px"><span class="status ${CARD_STATE[st].cls}">${CARD_STATE[st].label}</span>${o.qty > 1 ? `<span class="chip sm">第 ${c.n} 張（共 ${o.qty} 張）</span>` : ''}</div>
      <dl class="kv"><dt>方案</dt><dd>${esc(planSpec(o.plan))}</dd><dt>訂單編號</dt><dd>${esc(o.orderNo)}</dd><dt>購買日期</dt><dd>${o.at}</dd>${orderTrips(o).length ? `<dt>行程</dt><dd>${orderTrips(o).map(tripLabel).join(' → ')}</dd>` : ''}</dl>
      ${stepsHtml(st, st === 'shared')}
      <div class="banner info"><b>請於 ${claimBy} 前取得 eSIM</b><br>取得後 ${POLICY.installDays} 天內安裝到手機，安裝後 ${POLICY.activateDays} 天內抵達當地開始使用。逾期未使用的 eSIM 會失效，無法延期或補發。<span class="muted">（示意條款，以官網為準）</span></div>
      ${st !== 'expired' && st !== 'active' ? `<div class="banner warn"><b>建議安裝時機</b><br>${esc(installAdvice(o))}</div>` : ''}
      ${st === 'shared' ? `<div class="card soft"><b>已分享給親友，等待領取</b><p class="small muted" style="margin:6px 0 10px">連結 24 小時內有效。對方還沒收到的話，可以再送一次。</p>${lineBtn('再送一次分享連結', `data-share="${ref}"`)}</div>` : ''}
      <div class="actions two">${cardActions(o, c, st)}</div>`, { sheet: true });
  }
  function claimCard(ref) {
    const { o, c } = findCard(ref);
    if (!o) return;
    c.claimed = true; c.sharedAt = null;
    save(); renderEsim(); refreshTripViews();
    toast('已取得 eSIM 安裝資料');
    openInstall(ref);
  }
  function openInstall(ref, force) {
    const { o, c } = findCard(ref);
    if (!o) return;
    const t = target(o.key);
    const warnings = force ? [] : installWarnings(o, c);
    if (warnings.length) {
      openModal('安裝前請確認', `${warnings.map((w) => `<div class="banner warn">${esc(w)}</div>`).join('')}
        <div class="actions two">${o.qty > 1 && c.n > 1 && !c.gift && !c.installed ? lineBtn('改成分享給親友', `data-share="${ref}"`) : '<button class="btn" data-guide="install">看設定教學</button>'}<button class="btn" data-install-force="${ref}">我確定要安裝</button></div>`, { sheet: true });
      return;
    }
    const ideas = labelIdeas(o);
    const label = labelOf(o, c);
    // With real activation data (LPA) iOS 17.4+ opens its own eSIM setup from this link.
    const appleLink = c.lpa ? `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(c.lpa)}` : '';
    openModal(`安裝 ${esc(t.name)} eSIM`, `
      <div class="banner warn">${esc(installAdvice(o))}</div>
      <div class="card soft"><b>1. 安裝前檢查</b>
        <ul class="pre-list"><li>✓ 已連上穩定的 Wi-Fi</li><li>✓ 手機支援 eSIM、沒有鎖網路 <button class="link" data-guide="device">怎麼確認</button></li><li>✓ 設定 → 行動服務 裡，沒有已經裝好的「${esc(label)}」</li><li>✓ 這張是自己要用的（要給別人請用「分享給親友」）</li></ul></div>
      <div class="card soft"><b>2. 先想好手機上的名稱</b><p class="small muted" style="margin:4px 0 8px">安裝時 iPhone 會問「行動方案標籤」，寫目的地＋日期，抵達後才知道要選哪一個，也不會重複安裝。</p>
        <div class="row">${ideas.map((x) => `<button class="chip lg ${x === label ? 'on' : ''}" data-label-pick="${esc(x)}" data-ref="${ref}">${esc(x)}</button>`).join('')}</div>
        <div class="row" style="margin-top:8px"><input class="input" id="label-input" maxlength="16" value="${esc(label)}" aria-label="自訂名稱" style="flex:1"><button class="btn" data-copy-label>複製</button></div></div>
      <div class="card soft"><b>3. 安裝</b>
        ${IS_ANDROID ? '' : `<p class="small muted" style="margin:4px 0 8px">iPhone（iOS 17.4 以上）點一下就會打開「啟用 eSIM」畫面，不用掃 QR Code。</p>
        ${appleLink ? `<a class="btn primary block" href="${appleLink}">一鍵安裝到 iPhone</a>` : '<button class="btn primary block" data-demo-install>一鍵安裝到 iPhone</button>'}`}
        <div class="qr-box">${c.lpa ? '' : '<span>付款完成後，這裡會顯示安裝 QR Code 與手動輸入代碼（Android 或另一支手機掃描）</span>'}</div>
        <button class="btn block" data-guide-card="${ref}" style="margin-top:10px">看圖文教學（逐步畫面＋設定檢查表）</button></div>
      <button class="btn primary block" data-installed-card="${ref}">我已安裝完成</button>`, { sheet: 'tall' });
    const input = $('#label-input');
    input.addEventListener('change', () => { c.label = input.value.trim() || ideas[0]; save(); });
  }
  function giftLink(o, c) {
    const data = { k: o.key, p: o.plan, f: user?.name || '親友', o: o.orderNo, n: c.n, t: orderTrips(o)[0]?.start || '' };
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${window.location.origin}${window.location.pathname}#gift=${code}`;
  }
  function openGiftShare(ref) {
    const { o, c } = findCard(ref);
    if (!o) return;
    const t = target(o.key);
    const link = giftLink(o, c);
    const text = `我幫你買好 ${t.name} eSIM（${planSpec(o.plan)}）🎁\n點連結領取，iPhone 可以一鍵安裝：\n${link}\n${installAdvice(o)}`;
    openModal('分享給親友', `
      <div class="gift-card"><span class="flag-tile lg">${t.icon}</span><div><b>${esc(t.name)}</b><div class="small muted">${esc(planSpec(o.plan))}${o.qty > 1 ? `・第 ${c.n} 張` : ''}</div></div></div>
      <p class="small muted" style="margin:0">對方點連結就能領取，不需要再付款。連結 24 小時內有效（正式版）。</p>
      <a class="btn line block" href="https://line.me/R/share?text=${encodeURIComponent(text)}" target="_blank" rel="noopener" data-shared="${ref}">用 LINE 傳送</a>
      <div class="row"><input class="input" id="share-link" readonly value="${esc(link)}" style="flex:1"><button class="btn" data-copy-share="${ref}">複製連結</button></div>
      ${navigator.share ? `<button class="btn block" data-native-share="${ref}">其他分享方式</button>` : ''}
      <p class="notice">示範版的連結只帶方案資訊；正式版會由伺服器產生一次性的領取連結。</p>`, { sheet: true });
    openGiftShare.text = text;
  }
  function markShared(ref) {
    const { o, c } = findCard(ref);
    if (!o || c.claimed) return;
    c.sharedAt = new Date().toISOString().slice(0, 16);
    save(); renderEsim();
  }
  function activateCard(ref) {
    const { o, c } = findCard(ref);
    if (!o) return;
    c.installed = true; c.activatedAt = TODAY;
    save(); esimTab = 'active'; renderEsim(); refreshTripViews();
    openInstallGuide(ref);
    guideState.i = guideState.steps.findIndex((x) => x.stage === 'after');
    renderGuide();
    toast(`照著設定「${labelOf(o, c)}」，完成檢查表就能上網`);
  }
  function refreshTripViews() { renderHero(); renderCover(); if (currentTab === 'plan') renderPlanner(); }

  // Friend opens a gift link: "親友送你網卡！"
  function readGift() {
    const m = window.location.hash.match(/^#gift=([\w-]+)/);
    if (!m) return null;
    try {
      const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
      const g = JSON.parse(json);
      if (!target(g.k)?.name || !PLAN_TYPES[g.p?.type]) return null;
      return g;
    } catch { return null; }
  }
  function openGift(g) {
    const t = target(g.k);
    const claimed = orders.some((o) => o.giftOf === `${g.o}-${g.n}`);
    openModal('', `<div class="success"><div class="gift-icon">${icon('gift')}</div><h2>親友送你網卡！</h2><div class="small muted">${esc(g.f)} 分享了一張 eSIM 旅遊網卡給你</div></div>
      <div class="gift-card"><span class="flag-tile lg">${t.icon}</span><div class="grow"><b>${esc(t.name)}</b><div class="small muted">${esc(planSpec(g.p))}</div></div></div>
      <div class="banner warn"><b>重要提醒</b><br>天數從抵達當地、連上網路後才開始計算，建議依航線在出發當天或抵達後再安裝。領取後可以在「我的 eSIM」查看安裝步驟。</div>
      ${claimed ? '<button class="btn block" data-goto-esim>已領取，查看我的 eSIM</button>' : '<button class="btn primary block" data-claim-gift>確認領取 eSIM</button>'}`, { sheet: true });
    pendingGift = g;
  }
  function claimGift() {
    const g = pendingGift;
    if (!g) return;
    const btn = $('[data-claim-gift]');
    btn.disabled = true; btn.textContent = '領取中…';
    setTimeout(() => {
      const trip = g.t ? upcomingTrips().find((x) => x.start === g.t) : null;
      const o = makeOrder({ key: g.k, plan: g.p, qty: 1, tripIds: trip ? [trip.id] : [], gift: { from: g.f } });
      o.giftOf = `${g.o}-${g.n}`;
      orders.push(o);
      pendingGift = null;
      save();
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
      esimTab = 'pending';
      modal.close();
      go('esim');
      renderAll();
      toast('領取成功！依步驟安裝就能上網');
    }, REDUCED ? 100 : 800);
  }

  // ---------- illustrated install guide (圖文教學), label names and duplicate-install checks
  function shortPlace(o) {
    const t = orderTrips(o)[0];
    if (t) return t.city.split('・').pop().slice(0, 4);
    return target(o.key).name.replace(/多國|通用/g, '').slice(0, 4);
  }
  function labelIdeas(o) {
    const t = orderTrips(o)[0];
    const d = t ? parseDate(t.start) : parseDate(o.at);
    const mmdd = `${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const place = shortPlace(o);
    return [...new Set([`${place}旅遊 ${mmdd}`, `${target(o.key).name.slice(0, 4)} eSIM ${d.getMonth() + 1}月`, `旅遊-${place}`])];
  }
  function labelOf(o, c) { return c.label || labelIdeas(o)[0]; }
  // A guide opened from the quick actions uses the next eSIM still to be installed.
  function guideTarget() {
    const pend = allCards().filter(({ st }) => ['unclaimed', 'claimed', 'installed'].includes(st))
      .sort((a, b) => (orderTrips(a.o)[0]?.start || a.o.at).localeCompare(orderTrips(b.o)[0]?.start || b.o.at));
    return pend[0] || null;
  }
  function phone(title, rows, opts = {}) {
    return `<div class="phone ${opts.android ? 'android' : ''}" aria-hidden="true"><div class="phone-screen">
      <div class="phone-status"><span>10:00</span><span>●●● 〰 ▮</span></div>
      <div class="phone-nav">${opts.back ? `<span class="back">‹ ${esc(opts.back)}</span>` : ''}<b>${esc(title)}</b></div>
      ${opts.header ? `<div class="phone-header">${opts.header}</div>` : ''}
      <div class="phone-list">${rows.map((r) => (r.section ? `<div class="psec">${esc(r.section)}</div>` : `<div class="prow ${r.hl ? 'hl' : ''}">
        ${r.icon ? `<span class="pi" style="background:${r.color || '#8e8e93'}">${r.icon}</span>` : ''}<span class="pl">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span>
        <span class="pv">${r.toggle != null ? `<i class="tg ${r.toggle ? 'on' : ''}"></i>` : esc(r.value || '')}${r.check ? '<span class="ck">✓</span>' : ''}${r.chev ? '<span class="chev">›</span>' : ''}</span>
        ${r.hl ? '<span class="tap"></span>' : ''}</div>`)).join('')}</div>
      ${opts.note ? `<div class="phone-note">${esc(opts.note)}</div>` : ''}
    </div></div>`;
  }
  function guideSteps(os, label) {
    if (os === 'android') {
      return [
        { stage: 'before', title: '打開「設定」→「網路和網際網路」→「SIM 卡」', mock: phone('網路和網際網路', [{ icon: '📶', label: 'SIM 卡', sub: '中華電信', chev: true, hl: true, color: '#1a73e8' }, { icon: '📡', label: 'Wi-Fi', value: '已連線', chev: true, color: '#1a73e8' }, { icon: '✈️', label: '飛航模式', toggle: false, color: '#5f6368' }], { android: true, back: '設定' }) },
        { stage: 'before', title: '點「新增 eSIM」或「下載 SIM」，掃描 QR Code', mock: phone('SIM 卡', [{ section: 'SIM 卡' }, { label: '中華電信', sub: '主要', chev: true }, { label: '+ 新增 eSIM／下載 SIM', hl: true }], { android: true, back: '網路' }) },
        { stage: 'before', title: `把 eSIM 改名為「${label}」`, mock: phone(label, [{ label: '名稱', value: label, hl: true }, { label: '使用 SIM', toggle: false }, { label: '漫遊', toggle: false }], { android: true, back: 'SIM 卡', note: '名稱寫目的地＋日期，之後才不會選錯或重複安裝' }) },
        { stage: 'after', title: `抵達後：開啟「${label}」的「使用 SIM」與「漫遊」`, mock: phone(label, [{ label: '使用 SIM', toggle: true, hl: true }, { label: '行動數據', toggle: true }, { label: '漫遊', toggle: true, hl: true }], { android: true, back: 'SIM 卡' }) },
        { stage: 'after', title: `「行動數據」改用「${label}」，台灣門號關閉漫遊`, mock: phone('SIM 卡', [{ section: '偏好設定' }, { label: '行動數據', value: label, chev: true, hl: true }, { label: '通話', value: '中華電信', chev: true }, { label: '簡訊', value: '中華電信', chev: true }], { android: true, back: '網路' }) },
      ];
    }
    return [
      { stage: 'before', title: '連上 Wi-Fi，打開「設定」→「行動服務」', mock: phone('設定', [{ icon: '✈', label: '飛航模式', toggle: false, color: '#ff9500' }, { icon: '◉', label: 'Wi-Fi', value: '已連線', chev: true, color: '#007aff' }, { icon: '✱', label: '藍牙', value: '開啟', chev: true, color: '#007aff' }, { icon: '((·))', label: '行動服務', chev: true, hl: true, color: '#34c759' }]) },
      { stage: 'before', title: '點「加入 eSIM」（用一鍵安裝的話會直接跳到下一步）', mock: phone('行動服務', [{ label: '行動數據', value: '主要', chev: true }, { label: '個人熱點', value: '關閉', chev: true }, { section: 'SIM' }, { label: '主要', sub: '+886 9xx-xxx-xxx', value: '開啟', chev: true }, { label: '加入 eSIM', hl: true }], { back: '設定' }) },
      { stage: 'before', title: '選「使用 QR Code」掃描（或用一鍵安裝）', mock: phone('加入 eSIM', [{ label: '使用 QR Code', chev: true, hl: true }, { label: '手動輸入詳細資訊', chev: true }], { back: '行動服務' }) },
      { stage: 'before', title: '「你擁有哪一種方案？」選「只限數據」', mock: phone('啟用 eSIM', [{ label: '只限數據', sub: '可以上網、地圖、LINE', check: true, hl: true }, { label: '語音和數據', sub: '通話、訊息和上網' }], { header: '你擁有哪一種方案？' }) },
      { stage: 'before', title: `「行動方案標籤」選「自訂標籤」，輸入「${label}」`, mock: phone('行動方案標籤', [{ label: '主要' }, { label: '個人' }, { label: '工作' }, { label, check: true, hl: true }], { back: '行動服務', note: '名稱寫目的地＋日期，之後才不會選錯或重複安裝' }) },
      { stage: 'before', title: '預設語音、iMessage 都保留「主要」（台灣門號）', mock: phone('預設語音號碼', [{ label: '主要', sub: '台灣門號', check: true, hl: true }, { label, sub: '只限數據' }], { back: '行動服務' }) },
      { stage: 'after', title: `抵達後：點「${label}」→ 開啟「啟用此號碼」`, mock: phone(label, [{ label: '啟用此號碼', toggle: true, hl: true }, { label: '數據漫遊', toggle: false }, { label: '語音與數據', value: '5G 自動', chev: true }], { back: '行動服務' }) },
      { stage: 'after', title: `「行動數據」選「${label}」，關閉「允許行動數據切換」`, mock: phone('行動數據', [{ label: '主要' }, { label, check: true, hl: true }, { section: '' }, { label: '允許行動數據切換', toggle: false, hl: true }], { back: '行動服務', note: '關閉後，不會自動切回台灣門號上網' }) },
      { stage: 'after', title: `「${label}」開啟「數據漫遊」`, mock: phone(label, [{ label: '啟用此號碼', toggle: true }, { label: '數據漫遊', toggle: true, hl: true }, { label: '語音與數據', value: '4G', chev: true }], { back: '行動服務' }) },
      { stage: 'after', title: '台灣門號（主要）關閉「數據漫遊」，避免高額漫遊費', mock: phone('主要', [{ label: '啟用此號碼', toggle: true }, { label: '數據漫遊', toggle: false, hl: true }], { back: '行動服務' }) },
    ];
  }
  const CHECKS = (label) => [
    ['on', `${label}：啟用此號碼`, '開啟'], ['on', `${label}：數據漫遊`, '開啟'], ['pick', `行動數據：選「${label}」`, '選擇'],
    ['off', '允許行動數據切換', '關閉'], ['off', '台灣門號：數據漫遊', '關閉'],
  ];
  function openInstallGuide(ref, os) {
    const found = ref ? findCard(ref) : guideTarget();
    const o = found?.o; const c = found?.c;
    const label = o ? labelOf(o, c) : '日本旅遊 1218';
    const platform = os || (IS_ANDROID ? 'android' : 'ios');
    const steps = guideSteps(platform, label);
    if (guideState?.timer) clearInterval(guideState.timer);
    guideState = { ref: o ? `${o.id}:${c.id}` : null, os: platform, label, steps, i: 0, timer: null, checks: c?.checks || {} };
    openModal('圖文安裝教學', '<div id="guide"></div>', { sheet: 'tall' });
    renderGuide();
  }
  function renderGuide() {
    const g = guideState;
    const step = g.steps[g.i];
    const found = g.ref ? findCard(g.ref) : {};
    const before = g.steps.filter((x) => x.stage === 'before').length;
    const stageLabel = step.stage === 'before' ? `一、安裝 eSIM（${before} 步）` : `二、抵達後開通（${g.steps.length - before} 步）`;
    const checks = CHECKS(g.label);
    const doneChecks = checks.filter(([, text]) => g.checks[text]).length;
    $('#guide').innerHTML = `
      <div class="seg seg-lg seg-full" id="guide-os2"><button data-gos="ios" class="${g.os === 'ios' ? 'on' : ''}">iPhone</button><button data-gos="android" class="${g.os === 'android' ? 'on' : ''}">Android</button></div>
      ${found.o && g.i === 0 ? `<div class="banner warn">${esc(installAdvice(found.o))}</div>` : ''}
      <div class="guide-stage"><span class="kicker plain muted">${stageLabel}</span><div class="row"><h3>${g.i + 1}. ${esc(step.title)}</h3></div></div>
      <div class="guide-stage-body">${step.mock}</div>
      <div class="guide-nav"><button class="btn" data-gstep="-1" ${g.i === 0 ? 'disabled' : ''} aria-label="上一步">‹ 上一步</button>
        <div class="dots">${g.steps.map((x, i) => `<button class="${i === g.i ? 'on' : ''} ${x.stage}" data-gto="${i}" aria-label="第 ${i + 1} 步"></button>`).join('')}</div>
        <button class="btn primary" data-gstep="1" ${g.i === g.steps.length - 1 ? 'disabled' : ''} aria-label="下一步">下一步 ›</button></div>
      <button class="btn block" data-gplay>${g.timer ? '暫停自動播放' : '▶ 自動播放教學'}</button>
      ${CONFIG.guideVideo ? `<a class="btn block" href="${esc(CONFIG.guideVideo)}" target="_blank" rel="noopener">看影片教學</a>` : ''}
      <div class="card soft"><div class="row"><b>三、設定總檢查表</b><span class="spacer"></span><span class="small muted">${doneChecks}/${checks.length}</span></div>
        <p class="small muted" style="margin:4px 0 8px">抵達後照著設定，每完成一項就點一下。</p>
        ${checks.map(([kind, text, state]) => `<button class="check-row ${g.checks[text] ? 'done' : ''}" data-gcheck="${esc(text)}"><span class="cbox">${g.checks[text] ? '✓' : ''}</span><span class="grow">${esc(text)}</span><i class="tg ${kind === 'off' ? '' : 'on'}"></i><span class="state ${kind}">${state}</span></button>`).join('')}
        ${doneChecks === checks.length ? '<div class="banner good" style="margin-top:8px">設定完成！打開瀏覽器或 LINE 確認可以上網。</div>' : ''}
      </div>
      <details class="faq" open><summary>注意事項</summary><ul class="small" style="margin:8px 0 0;padding-left:20px;display:grid;gap:4px">
        <li>台灣門號的「數據漫遊」請務必關閉，避免產生高額漫遊費。</li>
        <li>不要刪除已安裝的 eSIM：多數 QR Code 只能使用一次，刪掉就裝不回來。</li>
        <li>同一張 eSIM 不要在兩支手機安裝；要給同行的人，請用「分享給親友」。</li>
        <li>在台灣安裝後顯示「無服務」是正常的，抵達當地才會連上。</li></ul></details>
      <details class="faq"><summary>抵達後還是不能上網？</summary><ol class="small" style="margin:8px 0 0;padding-left:20px;display:grid;gap:4px">
        <li>測速很快、實際很慢：把台灣門號關掉，右上角只留「${esc(g.label)}」一排訊號。</li>
        <li>確認「行動數據」選的是「${esc(g.label)}」，而且它的「數據漫遊」已開啟。</li>
        <li>開啟「飛航模式」約 10 秒再關閉，讓手機重新找網路。</li>
        <li>把「語音與數據」改成 4G／LTE 試試。</li>
        <li>重新開機。還是不行就聯絡客服，提供訂單編號${found.o ? `（${esc(found.o.orderNo)}）` : ''}。</li></ol></details>`;
  }
  function guideClick(e) {
    const b = e.target.closest('button');
    if (!b || !guideState || !b.closest('#guide')) return false;
    const g = guideState;
    const ds = b.dataset;
    const stop = () => { if (g.timer) { clearInterval(g.timer); g.timer = null; } };
    if (ds.gstep) { stop(); g.i = Math.max(0, Math.min(g.steps.length - 1, g.i + Number(ds.gstep))); } else if (ds.gto) { stop(); g.i = Number(ds.gto); } else if (ds.gos) {
      stop();
      const found = g.ref ? findCard(g.ref) : null;
      g.os = ds.gos; g.steps = guideSteps(g.os, g.label); g.i = 0;
      if (!found) g.ref = null;
    } else if ('gplay' in ds) {
      if (g.timer) stop();
      else {
        if (g.i === g.steps.length - 1) g.i = 0;
        g.timer = setInterval(() => {
          if (!modal.open || !$('#guide')) { stop(); return; }
          if (g.i >= g.steps.length - 1) { stop(); renderGuide(); return; }
          g.i += 1;
          renderGuide();
          const stage = $('#guide .guide-stage');
          if (stage) modal.scrollTo({ top: Math.max(0, stage.offsetTop - $('.modal-head').offsetHeight - 8), behavior: REDUCED ? 'auto' : 'smooth' });
        }, 3200);
      }
    } else if (ds.gcheck) {
      g.checks[ds.gcheck] = !g.checks[ds.gcheck];
      const found = g.ref ? findCard(g.ref) : null;
      if (found?.c) { found.c.checks = g.checks; save(); }
    } else return false;
    renderGuide();
    // Keep the step title in view when moving between steps.
    if (ds.gstep || ds.gto || ds.gos) {
      const stage = $('#guide .guide-stage');
      if (stage) modal.scrollTo({ top: Math.max(0, stage.offsetTop - $('.modal-head').offsetHeight - 8), behavior: REDUCED ? 'auto' : 'smooth' });
    }
    return true;
  }
  modal.addEventListener('close', () => { if (guideState?.timer) { clearInterval(guideState.timer); guideState.timer = null; } });

  // Before installing: warn about installing twice, or installing a friend's card on your own phone.
  function installWarnings(o, c) {
    const out = [];
    if (c.installed) out.push(`這張 eSIM 已經標記為安裝在你的手機（名稱「${labelOf(o, c)}」）。到 設定 → 行動服務 看到它就不用再裝，重複安裝通常會失敗。`);
    const twin = allCards().find((x) => x.c.id !== c.id && x.o.key === o.key && ['installed', 'active'].includes(x.st));
    if (twin) out.push(`你已經安裝了一張${target(o.key).name} eSIM（「${labelOf(twin.o, twin.c)}」）。同一支手機通常只需要一張。`);
    if (o.qty > 1 && c.n > 1 && !c.gift) out.push(`這是第 ${c.n} 張（共 ${o.qty} 張），通常是給同行的人用。要給別人的話，請改用「分享給親友」，讓對方在自己的手機安裝。`);
    return out;
  }

  // Guides: install, data, device, quiz
  const GUIDE_STEPS = {
    ios: ['到「我的 eSIM」點「取得 eSIM」', '依建議時機點「一鍵安裝到 iPhone」（iOS 17.4 以上），或到 設定 → 行動服務 → 加入 eSIM 掃 QR Code', '「你擁有哪一種方案？」選「只限數據」，標籤取名「旅遊」', '抵達後：行動數據選「旅遊」，開啟它的「數據漫遊」', '台灣門號關閉數據漫遊，簡訊與電話照常可收'],
    android: ['到「我的 eSIM」點「取得 eSIM」', '設定 → 網路和網際網路 → SIM 卡 → 新增 eSIM／下載 SIM，掃描 QR Code', '將 eSIM 命名為「旅遊」', '抵達後：行動數據改用「旅遊」，並開啟「漫遊」', '台灣門號關閉漫遊，保留簡訊與通話'],
  };
  function openGuide(kind) {
    if (kind === 'install') { openInstallGuide(); return; }
    if (kind === 'install-text') {
      const os = IS_ANDROID ? 'android' : 'ios';
      openModal('安裝教學', `<div class="seg seg-lg" id="guide-os"><button data-os="ios" class="${os === 'ios' ? 'on' : ''}">iPhone</button><button data-os="android" class="${os === 'android' ? 'on' : ''}">Android</button></div>
        <ol class="steps" id="guide-steps">${GUIDE_STEPS[os].map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        <div class="banner warn"><b>什麼時候安裝？</b><br>日本、韓國、港澳、東南亞等短程航線：出發當天在機場安裝。歐洲、美洲、澳洲等長程航線：抵達後連機場 Wi-Fi 再安裝。</div>
        <div class="banner info">在台灣安裝後顯示「無法啟用」或「無服務」是正常的，抵達當地才會連上網路。</div>`, { sheet: true });
    } else if (kind === 'data') {
      const rows = [['Google 地圖導航', '約 5 MB／小時'], ['LINE 文字訊息', '幾乎不用流量'], ['LINE 語音通話', '約 1 MB／分鐘'], ['IG／FB 滑動態', '約 300～500 MB／小時'], ['上傳一張照片', '約 3～5 MB'], ['YouTube 720p', '約 1～1.5 GB／小時'], ['視訊會議', '約 0.5～1 GB／小時']];
      openModal('流量指南', `<table class="tbl"><tbody>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table>
        <div class="grid" style="gap:8px">${Object.values(PLAN_TYPES).map((v) => `<div class="card soft"><b>${v.label}</b><div class="small muted">${esc(v.note)}</div></div>`).join('')}</div>
        <button class="btn primary block" data-guide="quiz">幫我挑選 eSIM 方案</button>`, { sheet: true });
    } else if (kind === 'device') {
      openModal('相容性檢查', `<p class="small muted" style="margin:0">購買前請確認手機可以使用 eSIM</p>
        <div class="card soft"><b>方法一：查看 EID</b><p class="small" style="margin:6px 0 0">撥號畫面輸入 <b>*#06#</b>，出現「EID」條碼就代表支援。</p></div>
        <div class="card soft"><b>方法二：系統設定</b><p class="small" style="margin:6px 0 0"><span class="chip sm">iOS</span> 設定 → 行動服務 → 有「加入 eSIM」<br><span class="chip sm">Android</span> 設定 → 網路 → SIM 卡 → 有「新增 eSIM」</p></div>
        <div class="field"><label for="device">或輸入手機型號</label><div class="row"><input class="input" id="device" placeholder="例如：iPhone 13、Pixel 8、Galaxy S23" style="flex:1"><button class="btn" id="device-check">檢查</button></div><p id="device-result" class="small" style="margin:4px 0 0"></p></div>
        <a class="btn primary block" href="tel:*%2306%23">撥打 *#06#</a>`, { sheet: true });
      $('#device-check').addEventListener('click', checkDevice);
      $('#device').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkDevice(); });
    } else if (kind === 'quiz') openQuiz();
  }
  const quiz = { key: null, days: 5, uses: null, people: 1 };
  function openQuiz() {
    const pick = smartPick();
    quiz.key = quiz.key || pick?.key || 'JP';
    quiz.days = pick?.key === quiz.key ? pick.plan.days : quiz.days;
    quiz.uses = quiz.uses || [...settings.uses];
    quiz.people = settings.people;
    openModal('幫我挑選 eSIM 方案', '<div id="quiz"></div>', { sheet: 'tall' });
    renderQuiz();
  }
  function renderQuiz() {
    const gb = usagePerDay(quiz.uses, quiz.people);
    const rec = { ...pickForUsage(gb), days: quiz.days };
    const shareHotspot = quiz.uses.includes('share');
    const qty = shareHotspot ? 1 : quiz.people;
    const opt = planOpt(rec);
    let qtyNote = '';
    if (qty > 1) qtyNote = `・${qty} 張（每人一張）`;
    else if (shareHotspot && quiz.people > 1) qtyNote = '・一張分享熱點給大家';
    const options = [...Object.keys(COUNTRIES).filter((k) => COUNTRIES[k].base), ...Object.keys(PACKS)];
    $('#quiz').innerHTML = `
      <div class="field"><label for="qz-key">1. 去哪裡？</label><select class="input" id="qz-key">${options.map((k) => `<option value="${k}" ${quiz.key === k ? 'selected' : ''}>${flagText(PACKS[k] ? '' : k)} ${target(k).name}</option>`).join('')}</select></div>
      <div class="field"><label>2. 玩幾天？</label><span class="stepper"><button data-qz-days="-1" aria-label="少一天">－</button><b>${quiz.days} 天</b><button data-qz-days="1" aria-label="多一天">＋</button></span></div>
      <div class="field"><label>3. 主要會用來做什麼？（可複選）</label><div class="use-grid">${Object.entries(USES).map(([k, u]) => `<button class="use ${quiz.uses.includes(k) ? 'on' : ''}" data-qz-use="${k}" aria-pressed="${quiz.uses.includes(k)}">${u.label}</button>`).join('')}</div></div>
      <div class="field"><label>幾個人一起旅行？</label><span class="stepper"><button data-qz-people="-1" aria-label="少一人">－</button><b>${quiz.people} 人</b><button data-qz-people="1" aria-label="多一人">＋</button></span></div>
      <div class="rec"><span class="small">推薦</span><div class="row"><span class="icon-tile size">${rec.type === 'unl' ? '∞' : `${opt.size}<small>GB</small>`}</span><div class="grow"><b>${esc(planLabel(quiz.key, rec))}</b><div class="small">每天約 ${gb.toFixed(1)} GB・${esc(opt.persona)}${qtyNote}</div></div><b>NT$${fmt(planPrice(quiz.key, rec, qty))}</b></div>
        <button class="btn primary block" data-qz-go>選這個方案</button></div>`;
    $('#qz-key').addEventListener('change', (e) => { quiz.key = e.target.value; renderQuiz(); });
  }
  function quizClick(e) {
    const b = e.target.closest('button');
    if (!b || !b.closest('#quiz')) return false;
    const ds = b.dataset;
    if (ds.qzDays) quiz.days = Math.max(1, Math.min(30, quiz.days + Number(ds.qzDays)));
    else if (ds.qzPeople) quiz.people = Math.max(1, Math.min(10, quiz.people + Number(ds.qzPeople)));
    else if (ds.qzUse) quiz.uses = quiz.uses.includes(ds.qzUse) ? quiz.uses.filter((x) => x !== ds.qzUse) : [...quiz.uses, ds.qzUse];
    else if ('qzGo' in ds) {
      settings.uses = [...quiz.uses]; settings.people = quiz.people; save();
      const gb = usagePerDay(quiz.uses, quiz.people);
      const pick = smartPick();
      openPlan(quiz.key, { ...pickForUsage(gb), days: quiz.days, qty: quiz.uses.includes('share') ? 1 : quiz.people, tripIds: pick?.key === quiz.key ? pick.journey.map((t) => t.id) : [] });
      return true;
    } else return false;
    renderQuiz();
    return true;
  }
  // The first answers come from the brand's own replies on Threads (@esim_87cc, data/esim-threads.json).
  const FAQ = [
    ['測速很快，實際用起來卻跑不動？', '把右上角台灣門號的訊號關掉，只留旅遊 eSIM 一排訊號，手機就不會在兩張卡之間切換。（喜仔CC 實戰解法）'],
    ['去日本選哪家電信比較穩？', 'Docomo 給旅客的線路常會優先照顧當地用戶，尖峰時段容易變慢；喜仔CC 建議選 KDDI 線路。實際方案以官網說明為準。'],
    ['為什麼不追求最便宜？', '每個方案都實際測過，不把 3GB／5GB 用完降速的方案包裝成吃到飽。出國斷網或被降速到不能用，可以直接找客服補發或退款。'],
    ['哪一家 eSIM 一定最好？', 'eSIM 每年都在迭代，沒有哪一家永遠最好，找信任、售後完整的品牌比較重要。有問題可以到 Threads @esim_87cc 主頁或 LINE 官方帳號詢問。'],
    ['什麼時候開始計算天數？', '大多數方案在抵達目的地、eSIM 第一次連上當地網路時才開始計算，提早安裝不會浪費天數。'],
    ['可以保留台灣門號收簡訊嗎？', '可以。eSIM 只負責上網，台灣門號照常收簡訊與來電（關閉台灣門號的數據漫遊即可避免漫遊費）。'],
    ['可以分享給家人朋友嗎？', '可以。一次買多張，在「我的 eSIM」點「分享給親友」用 LINE 傳連結，對方點開就能領取安裝。'],
    ['QR Code 可以重複掃嗎？', '多數 eSIM 只能安裝一次，刪除後無法再裝回，請不要隨意刪除。'],
    ['手機有鎖嗎？', '電信綁約機若有鎖網路，需先解鎖才能使用其他 eSIM。中國大陸與港澳版 iPhone 多數不支援 eSIM。'],
    ['用不完可以退嗎？', '已領取或已安裝的 eSIM 通常無法退款，未領取的依官網退款規則辦理。'],
  ];
  $('#faq').innerHTML = FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
  function checkDevice() {
    const v = $('#device').value.trim().toLowerCase().replace(/\s+/g, ' ');
    const out = $('#device-result');
    if (!v) { out.textContent = ''; return; }
    const ok = [
      /iphone ?(xs|xr|1[1-9]|se ?\(?[23]|se ?20(20|22)|air|1[6-9]e?)/, /pixel ?([3-9]|1\d|fold)/, /galaxy ?(s ?2[0-9]|z ?(fold|flip)|note ?20|a ?5[4-9])/,
      /(s2[0-9]|z fold|z flip)/, /ipad (pro|air|mini)/, /(sony|xperia) ?(1|5|10)/, /(oppo ?find ?x[3-9]|vivo ?x(90|100|200))/,
    ].some((re) => re.test(v));
    const no = /iphone ?([4-8]|x\b|se ?\(?1)|中國|大陸|港版/.test(v);
    if (no) out.innerHTML = '<span style="color:var(--danger)">這個型號（或版本）可能不支援 eSIM。</span>';
    else if (ok) out.innerHTML = '<span style="color:var(--good)">一般支援 eSIM。</span> 綁約機請確認已解鎖。';
    else out.innerHTML = '無法確定，請撥 *#06#，有出現 EID 就支援。';
  }

  // Store events
  $('#modal-body').addEventListener('click', (e) => {
    if (planSheetClick(e) || quizClick(e) || guideClick(e) || randomClick(e)) return;
    const b = e.target.closest('button, a');
    if (!b) return;
    const ds = b.dataset;
    if (ds.cartQty) {
      const [id, d] = ds.cartQty.split(':');
      const k = cart.find((x) => x.id === id);
      if (k) { k.qty = Math.max(1, Math.min(10, k.qty + Number(d))); save(); renderCartFab(); openCart(); }
    } else if (ds.cartDel) { cart = cart.filter((x) => x.id !== ds.cartDel); save(); renderCartFab(); openCart(); } else if ('checkout' in ds) openCheckout();
    else if ('pay' in ds) pay();
    else if ('gotoEsim' in ds) { modal.close(); esimTab = 'pending'; go('esim'); renderEsim(); } else if ('demoInstall' in ds) toast('示範版：正式版會直接開啟 iPhone 的「啟用 eSIM」畫面');
    else if (ds.installedCard) {
      const { o, c } = findCard(ds.installedCard);
      if (o) {
        const input = $('#label-input');
        if (input?.value.trim()) c.label = input.value.trim();
        c.claimed = true; c.installed = true; save(); modal.close(); renderEsim(); refreshTripViews();
        toast(`已安裝「${labelOf(o, c)}」！抵達後照教學開啟就能上網`);
      }
    } else if (ds.shared) markShared(ds.shared);
    else if (ds.copyShare) {
      const input = $('#share-link');
      const done = () => { markShared(ds.copyShare); toast('已複製連結'); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(input.value).then(done, () => { input.select(); toast('請長按連結複製'); });
      else { input.select(); toast('請長按連結複製'); }
    } else if (ds.nativeShare) navigator.share({ text: openGiftShare.text }).then(() => markShared(ds.nativeShare)).catch(() => {});
    else if ('claimGift' in ds) claimGift();
    else if (ds.labelPick) {
      const { c } = findCard(ds.ref);
      if (c) { c.label = ds.labelPick; save(); }
      $('#label-input').value = ds.labelPick;
      $$('[data-label-pick]').forEach((x) => x.classList.toggle('on', x === b));
    } else if ('copyLabel' in ds) {
      const input = $('#label-input');
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(input.value).then(() => toast(`已複製「${input.value}」，安裝時貼上`), () => { input.select(); toast('請長按名稱複製'); });
      else { input.select(); toast('請長按名稱複製'); }
    } else if (ds.installForce) openInstall(ds.installForce, true);
    else if (ds.guideCard) openInstallGuide(ds.guideCard);
    else if (ds.albumExport) exportAlbum(ds.albumExport, b);
    else if (ds.albumStep) { const album = $('#album'); album.scrollBy({ left: album.clientWidth * Number(ds.albumStep), behavior: REDUCED ? 'auto' : 'smooth' }); } else if (ds.albumDel) {
      const [tripId, id] = ds.albumDel.split(':');
      if (LIB.some((p) => p.id === id)) deletePhoto(id); else store.set(albumKey(tripId), store.get(albumKey(tripId), []).filter((x) => x.id !== id));
      const page = Math.round($('#album').scrollLeft / $('#album').clientWidth);
      openAlbum(openAlbum.year);
      $('#album').scrollLeft = page * $('#album').clientWidth;
    } else if (ds.os) {
      $$('#guide-os button').forEach((x) => x.classList.toggle('on', x === b));
      $('#guide-steps').innerHTML = GUIDE_STEPS[ds.os].map((x) => `<li>${esc(x)}</li>`).join('');
    }
  });
  $('#cart-fab').addEventListener('click', openCart);
  $('#modal-body').addEventListener('change', (e) => { if (e.target.dataset.albumAdd && e.target.files.length) addAlbumPhotos(e.target.dataset.albumAdd, e.target.files); });
  $('#modal-body').addEventListener('input', (e) => {
    const id = e.target.dataset.memo;
    const t = id && trips.find((x) => x.id === id);
    if (!t) return;
    t.memo = e.target.value;
    clearTimeout(openAlbum.timer);
    openAlbum.timer = setTimeout(save, 400);
  });

  // ---------- trips list & form
  function renderTrips() {
    renderSync();
    $('#home-select').innerHTML = Object.entries(HOMES).map(([k, h]) => `<option value="${k}" ${settings.home === k ? 'selected' : ''}>${h.name}</option>`).join('');
    $('#theme-select').value = settings.theme;
    const byYear = {};
    sortTrips(trips).reverse().forEach((t) => { (byYear[tripYear(t)] ||= []).push(t); });
    const years = Object.keys(byYear).sort().reverse();
    $('#trip-list').innerHTML = years.length ? years.map((y) => `<div class="section-title"><h3>${y}</h3><span class="muted small">${byYear[y].length} 趟</span></div>
      <div class="grid">${byYear[y].map((t) => `<div class="trip"><button class="flag tap-text" data-country-n="${t.n}" aria-label="${esc(country(t.n).name)}">${flag(country(t.n).code)}</button><div class="grow">
        <div class="row"><button class="tap-text" data-trip="${t.id}"><b>${esc(t.city)} ›</b></button><span class="muted small">${esc(country(t.n).name)}</span>${isUpcoming(t) ? '<span class="status pending">即將出發</span>' : ''}${isOngoing(t) ? '<span class="status active">旅行中</span>' : ''}</div>
        <div class="small muted">${t.start} – ${t.end}・${daysBetween(t.start, t.end)} 天${Number(t.gb) ? `・上網 ${t.gb} GB` : ''}${t.src === 'import' ? '・來自時間軸' : ''}</div>
        <div class="row" style="margin-top:4px">${tripFlightChip(t)}${ateOf(t).length ? `<span class="flight-chip">吃了 ${ateOf(t).length} 道</span>` : ''}</div>
        <div class="tags">${t.tags.map((k) => `${el(k).label}`).join('　')}</div></div>
        <button class="btn sm primary" data-open-plan="${t.id}">行程表</button><button class="btn sm" data-edit="${t.id}">編輯</button></div>`).join('')}</div>`).join('')
      : '<div class="card muted">還沒有行程。按「新增行程」或匯入 Google 地圖時間軸開始。</div>';
  }
  $('#home-select').addEventListener('change', (e) => { settings.home = e.target.value; save(); recState.origin = null; renderAll(); });
  $('#theme-select').addEventListener('change', (e) => { settings.theme = e.target.value; save(); applyTheme(); drawMap(); });
  function applyTheme() {
    if (settings.theme) document.documentElement.dataset.theme = settings.theme; else delete document.documentElement.dataset.theme;
  }
  $('#trip-add').addEventListener('click', () => openTripForm());
  function openTripForm(id, presetN, presetDest) {
    const t = trips.find((x) => x.id === id) || {
      dest: presetDest || '', n: presetN || '', city: '', start: TODAY, end: TODAY, tags: [], gb: '', note: '',
    };
    const destOptions = Object.entries(COUNTRIES).filter(([, c]) => c.base).map(([code, c]) => {
      const ds = DESTS.filter((d) => d.c === code);
      return ds.length ? `<optgroup label="${flagText(code)} ${c.name}">${ds.map((d) => `<option value="${d.id}" ${t.dest === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}</optgroup>` : '';
    }).join('');
    const custom = !t.dest && (t.city || presetN);
    openModal(id ? '編輯行程' : '新增行程', `
      <div class="field"><label for="f-dest">目的地</label><select class="input" id="f-dest"><option value="">— 選擇城市 —</option>${destOptions}<option value="custom" ${custom ? 'selected' : ''}>其他城市（自行輸入）</option></select></div>
      <div class="row" id="f-custom" ${custom ? '' : 'hidden'}>
        <div class="field" style="flex:1"><label for="f-country">國家</label><select class="input" id="f-country">${Object.entries(COUNTRIES).filter(([c]) => c !== 'TW').map(([code, c]) => `<option value="${c.n}" ${t.n === c.n ? 'selected' : ''}>${flagText(code)} ${c.name}</option>`).join('')}${t.n && !NUM[t.n] ? `<option value="${t.n}" selected>${esc(country(t.n).name)}</option>` : ''}</select></div>
        <div class="field" style="flex:1"><label for="f-city">城市</label><input class="input" id="f-city" maxlength="30" value="${esc(t.dest ? '' : t.city)}"></div>
      </div>
      <div class="row"><div class="field" style="flex:1"><label for="f-start">出發</label><input type="date" class="input" id="f-start" value="${t.start}"></div>
        <div class="field" style="flex:1"><label for="f-end">回程</label><input type="date" class="input" id="f-end" value="${t.end}"></div></div>
      <div class="field"><label>旅行元素</label><div class="row" id="f-tags">${Object.entries(ELEMENTS).map(([k, v]) => `<button type="button" class="chip el ${t.tags.includes(k) ? 'on' : ''}" data-ftag="${k}">${elArt(k)}${v.label}</button>`).join('')}</div></div>
      <div class="row"><div class="field" style="flex:1"><label for="f-gb">eSIM 用量（GB，選填）</label><input type="number" min="0" step="0.1" class="input" id="f-gb" value="${t.gb ?? ''}"></div></div>
      <div class="field"><label for="f-note">備註</label><textarea class="input" id="f-note" rows="2" maxlength="200">${esc(t.note)}</textarea></div>
      <div class="actions"><button class="btn primary" id="f-save">儲存</button>${id ? '<button class="btn" id="f-del" style="color:var(--danger)">刪除</button>' : ''}</div>`);
    $('#f-dest').addEventListener('change', (e) => {
      $('#f-custom').hidden = e.target.value !== 'custom';
      const d = DEST[e.target.value];
      if (d && !$$('#f-tags .on').length) $$('#f-tags [data-ftag]').forEach((b) => b.classList.toggle('on', d.tags.slice(0, 3).includes(b.dataset.ftag)));
    });
    $$('#f-tags [data-ftag]').forEach((b) => b.addEventListener('click', () => b.classList.toggle('on')));
    $('#f-save').addEventListener('click', () => {
      const destId = $('#f-dest').value;
      const start = $('#f-start').value; const end = $('#f-end').value;
      if (!destId) { toast('請選擇目的地'); return; }
      if (!start || !end || end < start) { toast('請確認日期（回程不能早於出發）'); return; }
      let place;
      if (destId === 'custom') {
        const n = $('#f-country').value; const city = $('#f-city').value.trim() || country(n).name;
        const f = world?.byId.get(n);
        const [lng, lat] = f ? d3.geoCentroid(f) : [0, 0];
        const keepPos = t.n === n && t.city === city && t.lat != null;
        place = {
          dest: '', n, city, lat: keepPos ? t.lat : lat, lng: keepPos ? t.lng : lng,
        };
      } else {
        const d = DEST[destId];
        place = {
          dest: d.id, n: COUNTRIES[d.c].n, city: d.name, lat: d.lat, lng: d.lng,
        };
      }
      const data = {
        ...place, start, end, tags: $$('#f-tags .on').map((b) => b.dataset.ftag), gb: $('#f-gb').value === '' ? '' : Number($('#f-gb').value), note: $('#f-note').value.trim(),
      };
      if (id) Object.assign(t, data); else trips.push({ id: `t-${uid()}`, src: 'manual', ...data });
      save(); modal.close(); renderAll(); toast('行程已儲存');
    });
    $('#f-del')?.addEventListener('click', () => {
      askConfirm(`刪除「${t.city}」這趟行程？`, '行程表、預算與待辦會一起刪除，無法復原。', '刪除行程', () => {
        trips = trips.filter((x) => x.id !== id);
        orders.forEach((o) => { o.tripIds = (o.tripIds || []).filter((x) => x !== id); });
        if (planTripId === id) planTripId = null;
        save(); modal.close(); renderAll(); toast('已刪除行程');
      });
    });
  }

  // ---------- Google Maps Timeline import
  function extractPoints(json) {
    const pts = [];
    const walk = (o, ctx, depth) => {
      if (!o || typeof o !== 'object' || depth > 14 || pts.length > 300000) return;
      if (Array.isArray(o)) { o.forEach((x) => walk(x, ctx, depth + 1)); return; }
      const time = o.startTimestamp || o.startTime || o.timestamp || o.time || o.duration?.startTimestamp
        || (o.timestampMs ? new Date(Number(o.timestampMs)).toISOString() : null) || ctx;
      if (typeof o.latitudeE7 === 'number' && typeof o.longitudeE7 === 'number' && time) pts.push([o.longitudeE7 / 1e7, o.latitudeE7 / 1e7, time]);
      Object.entries(o).forEach(([k, v]) => {
        if (typeof v === 'string' && time && /^(latLng|placeLocation|point|latlng)$/.test(k)) {
          const m = v.match(/(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)/);
          if (m) pts.push([Number(m[2]), Number(m[1]), time]);
        } else if (v && typeof v === 'object') walk(v, time, depth + 1);
      });
    };
    walk(json, null, 0);
    return pts;
  }
  function countryAt(lng, lat) {
    for (let i = 0; i < world.features.length; i += 1) {
      const [[w, s], [e, n]] = world.bounds[i];
      const inLng = w <= e ? lng >= w && lng <= e : lng >= w || lng <= e;
      if (lat >= s && lat <= n && inLng && d3.geoContains(world.features[i], [lng, lat])) return world.features[i].id;
    }
    return null;
  }
  function pointsToTrips(pts) {
    const days = new Map(); const cache = new Map();
    pts.forEach(([lng, lat, time]) => {
      const day = String(time).slice(0, 10);
      if (!/^\d{4}-\d\d-\d\d$/.test(day) || !CONFIG.years.includes(Number(day.slice(0, 4)))) return;
      const key = `${Math.round(lat * 4)},${Math.round(lng * 4)}`;
      if (!cache.has(key)) cache.set(key, countryAt(lng, lat));
      const n = cache.get(key);
      if (!n || n === home().n) return;
      const m = days.get(day) || new Map();
      const e = m.get(n) || { c: 0, lat: 0, lng: 0 };
      e.c += 1; e.lat += lat; e.lng += lng; m.set(n, e); days.set(day, m);
    });
    const out = [];
    [...days.keys()].sort().forEach((day) => {
      const [n, e] = [...days.get(day).entries()].sort((a, b) => b[1].c - a[1].c)[0];
      const last = out[out.length - 1];
      if (last && last.n === n && daysBetween(last.end, day) <= 2) {
        last.end = day; last.c += e.c; last.lat += e.lat; last.lng += e.lng;
      } else out.push({ n, start: day, end: day, ...e });
    });
    return out.map((t) => {
      const lat = t.lat / t.c; const lng = t.lng / t.c;
      const near = DESTS.map((d) => ({ d, km: haversine({ lat, lng }, d) })).sort((a, b) => a.km - b.km)[0];
      const d = near && near.km < 150 && COUNTRIES[near.d.c].n === t.n ? near.d : null;
      return {
        id: `i-${t.n}-${t.start}`, n: t.n, dest: d?.id || '', city: d?.name || country(t.n).name, lat, lng, start: t.start, end: t.end, tags: d ? d.tags.slice(0, 3) : [], gb: '', note: '', src: 'import',
      };
    }).filter((t) => !trips.some((x) => x.n === t.n && x.start <= t.end && x.end >= t.start));
  }
  $('#import-timeline').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    if (!world) { toast('地圖資料還在載入，請稍後再試'); return; }
    toast('分析時間軸中…');
    try {
      const texts = await Promise.all(files.map((f) => f.text()));
      const pts = texts.flatMap((text) => extractPoints(JSON.parse(text)));
      const found = pointsToTrips(pts);
      if (!found.length) { toast(pts.length ? '沒有找到 2025、2026 的海外足跡（或都已在行程中）' : '看不懂這個檔案，請選 Google 地圖時間軸 JSON'); return; }
      openModal(`找到 ${found.length} 趟海外旅行`, `
        <p class="small muted">從 ${fmt(pts.length)} 個位置點分析。勾選要加入的旅行：</p>
        <div class="grid">${found.map((t, i) => `<label class="trip"><input type="checkbox" checked data-imp="${i}"><span class="flag">${flag(country(t.n).code)}</span><span class="grow"><b>${esc(t.city)}</b><div class="small muted">${t.start} – ${t.end}・${daysBetween(t.start, t.end)} 天</div></span></label>`).join('')}</div>
        <div class="actions"><button class="btn primary" id="imp-go">加入足跡</button></div>`);
      $('#imp-go').addEventListener('click', () => {
        const picked = $$('[data-imp]').filter((c) => c.checked).map((c) => found[Number(c.dataset.imp)]);
        trips.push(...picked); save(); modal.close(); renderAll(); toast(`已加入 ${picked.length} 趟旅行`);
      });
    } catch (err) {
      toast('讀取失敗：請確認是 JSON 檔');
    }
  });

  // ---------- backup
  $('#export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({
      version: 1, user, trips, orders, wish, settings,
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `travel-backup-${TODAY}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import-backup').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.trips)) throw new Error('format');
      trips = data.trips.filter((t) => t && t.start && t.end && t.n && Array.isArray(t.tags));
      orders = Array.isArray(data.orders) ? data.orders : [];
      wish = Array.isArray(data.wish) ? data.wish : [];
      save(); renderAll(); toast(`已匯入 ${trips.length} 趟行程`);
    } catch { toast('備份檔格式不正確'); }
  });

  // ---------- review & share card
  function renderReview() {
    const cards = CONFIG.years.map((y) => {
      const s = stats(y);
      const max = Math.max(1, ...s.topElements.map(([, v]) => v));
      const color = y === 2025 ? 'var(--y25)' : 'var(--y26)';
      return `<div class="card" style="display:grid;gap:14px;border-top:4px solid ${color}">
        <div class="row"><h2>${y}</h2><span class="muted small">${travelerType(s)}</span><span class="spacer"></span><button class="btn sm" data-album="${y}">紀念冊</button><button class="btn sm" data-year-card="${y}">年度分享圖</button></div>
        <div class="grid stats" style="grid-template-columns:repeat(4,1fr)">
          <button class="stat" data-badge="c10" data-by="${y}">${count(s.countries.size)}<span>國家</span></button><button class="stat" data-album="${y}">${count(s.cities.size)}<span>城市</span></button>
          <button class="stat" data-badge="month" data-by="${y}">${count(s.days)}<span>天</span></button><button class="stat" data-badge="km" data-by="${y}">${count(s.km)}<span>公里</span></button></div>
        <div><b class="small">旅行月份</b><div class="months" style="margin-top:6px">${Array.from({ length: 12 }, (_, i) => `<span class="${s.months.has(i + 1) ? 'on' : ''}" style="${s.months.has(i + 1) ? `background:${color}` : ''}">${i + 1}</span>`).join('')}</div></div>
        <div><b class="small">旅行元素</b><div class="grid" style="gap:6px;margin-top:6px">${s.topElements.length ? s.topElements.slice(0, 6).map(([k, v]) => `<button class="bar" data-badge="${k}" data-by="${y}"><span>${el(k).label}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%;background:${color}"></div></div><span>${v} ›</span></button>`).join('') : '<span class="muted small">還沒有資料</span>'}</div></div>
        <div><div class="row"><b class="small">徽章 ${BADGES.filter((b) => badgeState(b, s).ok).length}/${BADGES.length}</b><span class="spacer"></span><button class="btn sm ghost" data-badge-wall="${y}">全部徽章 →</button></div><div class="badges" style="margin-top:6px">${[...BADGES].sort((p, q) => badgeState(q, s).pct - badgeState(p, s).pct).slice(0, 8).map((b) => badgeTile(b, s, y)).join('')}</div></div>
        <div><b class="small">足跡</b><ul class="timeline" style="margin-top:6px">${s.list.length ? s.list.map((t) => `<li data-trip="${t.id}"><span class="flag">${flag(country(t.n).code)}</span><div style="flex:1"><b>${esc(t.city)}</b> <span class="small muted">${md(t.start)}–${md(t.end)}・${esc(country(t.n).name)}</span><div class="small">${t.tags.map((k) => el(k).label).join('・')}${Number(t.gb) ? `・上網 ${t.gb}GB` : ''}${isUpcoming(t) ? '・即將出發' : ''}</div></div></li>`).join('') : '<li class="muted small">還沒有紀錄</li>'}</ul></div>
      </div>`;
    });
    const a = stats('2025'); const b = stats('2026');
    const diff = b.countries.size - a.countries.size;
    $('#review').innerHTML = cards.join('') + (a.past.length && b.past.length ? `<div class="card" style="grid-column:1/-1"><b>2026 vs 2025：</b>${diff >= 0 ? `多去了 ${diff}` : `少去了 ${-diff}`} 個國家，旅行天數 ${b.days - a.days >= 0 ? '+' : ''}${b.days - a.days} 天，飛行里程 ${b.km - a.km >= 0 ? '+' : ''}${fmt(b.km - a.km)} 公里。</div>` : '');
  }
  async function shareCanvas(year) {
    const s = stats(year);
    const W = 1080; const H = 1350;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H; cv.className = 'share';
    const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, year === 2025 ? '#0fa597' : '#f2711c'); g.addColorStop(1, '#1463ff');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = 0; i < 9; i += 1) { x.beginPath(); x.arc(W - 120, 160, 120 + i * 70, 0, Math.PI * 2); x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.12)'; x.stroke(); }
    const font = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    x.fillStyle = '#fff';
    x.font = `600 40px ${font}`; x.fillText(`${CONFIG.brand}・年度旅行`, 80, 120);
    x.font = `800 150px ${font}`; x.fillText(String(year), 80, 300);
    x.font = `700 54px ${font}`; x.fillText(`${user?.name || '旅人'} 的旅行足跡`, 80, 390);
    x.font = `500 38px ${font}`; x.fillText(travelerType(s), 80, 450);
    const nums = [[s.countries.size, '國家'], [s.cities.size, '城市'], [s.days, '天'], [fmt(s.km), '公里']];
    nums.forEach(([v, l], i) => {
      const cx = 80 + i * 240;
      x.fillStyle = 'rgba(255,255,255,.16)'; roundRect(x, cx, 510, 210, 190, 28); x.fill();
      x.fillStyle = '#fff'; x.font = `800 ${String(v).length > 4 ? 54 : 72}px ${font}`; x.fillText(String(v), cx + 28, 610);
      x.font = `500 32px ${font}`; x.fillText(l, cx + 28, 665);
    });
    x.font = `700 40px ${font}`; x.fillText('去過的地方', 80, 790);
    // Real flag images: emoji flags draw as letters on Windows.
    const codes = [...new Set(s.past.map((t) => country(t.n).code).filter(Boolean))];
    const ims = await Promise.all(codes.slice(0, 9).map((c) => loadImage(flagSrc(c)))); // eslint-disable-line no-use-before-define
    ims.forEach((im, i) => {
      if (!im) return;
      const fx = 80 + i * 100;
      x.save(); roundRect(x, fx, 826, 84, 56, 8); x.clip(); x.drawImage(im, fx, 826, 84, 56); x.restore();
    });
    x.font = `500 40px ${font}`;
    if (!codes.length) x.fillText('—', 80, 880);
    if (codes.length > 9) x.fillText(`+${codes.length - 9}`, 80 + 9 * 100, 868);
    x.font = `500 34px ${font}`;
    const cities = s.past.map((t) => t.city).join('・');
    wrapText(x, cities || '還沒有紀錄', 80, 950, W - 160, 48);
    x.font = `700 40px ${font}`; x.fillText('旅行元素', 80, 1110);
    x.font = `500 38px ${font}`;
    x.fillText(s.topElements.slice(0, 4).map(([k]) => el(k).label).join('・') || '—', 80, 1170);
    x.globalAlpha = 0.8; x.font = `500 28px ${font}`; x.fillText(`eSIM ${s.gb.toFixed(1)} GB・${window.location.host || CONFIG.brand}`, 80, 1270);
    x.globalAlpha = 1;
    return cv;
  }
  function roundRect(x, l, t, w, h, r) { x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath(); }
  function wrapText(x, text, l, t, maxW, lh) {
    let line = ''; let y = t; let lines = 0;
    [...text].forEach((ch) => {
      if (x.measureText(line + ch).width > maxW && lines < 2) { x.fillText(line, l, y); line = ch; y += lh; lines += 1; } else line += ch;
    });
    x.fillText(lines >= 2 && x.measureText(line).width > maxW ? `${line.slice(0, -2)}…` : line, l, y);
  }
  async function openShare(year = new Date().getFullYear() >= 2026 ? 2026 : 2025) {
    const cv = await shareCanvas(Number(year));
    openModal(`${year} 年度分享圖`, `<div class="seg" id="share-seg">${CONFIG.years.map((y) => `<button data-sy="${y}" class="${Number(year) === y ? 'on' : ''}">${y}</button>`).join('')}</div><div id="share-holder"></div>
      <div class="actions"><button class="btn primary" id="share-dl">下載圖片</button>${navigator.share ? '<button class="btn" id="share-native">分享</button>' : ''}</div>
      <p class="small muted">尺寸 1080×1350，適合 IG／Threads 貼文。</p>`);
    $('#share-holder').appendChild(cv);
    $$('#share-seg button').forEach((b) => b.addEventListener('click', () => openShare(b.dataset.sy)));
    $('#share-dl').addEventListener('click', () => {
      const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `travel-${year}.png`; a.click();
    });
    $('#share-native')?.addEventListener('click', () => cv.toBlob(async (blob) => {
      try {
        const file = new File([blob], `travel-${year}.png`, { type: 'image/png' });
        await navigator.share({ files: [file], title: `${year} 旅行回顧` });
      } catch { /* cancelled */ }
    }));
  }
  $('#share-card').addEventListener('click', () => openShare());

  // ---------- interaction: confetti, a light buzz, tilting cards, a sliding tab highlight, mouse-drag rows
  const CONFETTI = ['#ff7a1a', '#1463ff', '#16915a', '#f6c453', '#ff5fa2', '#7c4dff'];
  function burst(from, pieces = 16) {
    if (REDUCED || !from) return;
    const r = from.getBoundingClientRect();
    const host = from.closest?.('dialog[open]') || document.body;
    const hr = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
    const wrap = document.createElement('div');
    wrap.className = 'burst';
    wrap.style.left = `${r.left + r.width / 2 - hr.left}px`;
    wrap.style.top = `${r.top + Math.min(r.height / 2, 60) - hr.top}px`;
    for (let i = 0; i < pieces; i += 1) {
      const a = (i / pieces) * Math.PI * 2 + Math.random() * 0.5;
      const d = 36 + Math.random() * (pieces > 20 ? 90 : 50);
      const bit = document.createElement('i');
      bit.style.setProperty('--x', `${Math.cos(a) * d}px`);
      bit.style.setProperty('--y', `${Math.sin(a) * d - 24}px`);
      bit.style.setProperty('--r', `${Math.round(Math.random() * 540 - 270)}deg`);
      bit.style.background = CONFETTI[i % CONFETTI.length];
      wrap.appendChild(bit);
    }
    host.appendChild(wrap);
    setTimeout(() => wrap.remove(), 1100);
  }
  const buzz = () => { try { if (!REDUCED) navigator.vibrate?.(10); } catch { /* not supported */ } };
  // ---------- home quick actions: small real objects (a die, an album, a SIM card, a hand of cards, a phone)
  // The album cover and the cards show photos from your own latest trips.
  function renderQuickArt() {
    const pool = [...sortTrips(trips).reverse().map((t) => destPhoto(t.dest)), ...DESTS.map((d) => destPhoto(d.id))].filter(Boolean);
    const photos = [...new Map(pool.map((p) => [p.src, p])).values()];
    if (!photos.length) return;
    $$('img[data-art-photo]').forEach((img) => {
      const p = photos[Number(img.dataset.artPhoto) % photos.length];
      if (img.getAttribute('src') === p.src) return;
      img.referrerPolicy = 'no-referrer';
      img.src = p.src;
    });
  }
  const quickArts = $$('.quick-art .art');
  const playArt = (art) => {
    art.classList.remove('play');
    art.getBoundingClientRect();
    art.classList.add('play');
  };
  quickArts.forEach((art) => {
    const btn = art.closest('button');
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') playArt(art); });
    btn.addEventListener('pointerdown', () => playArt(art));
  });
  // While the home screen is in view, the five take turns moving, one every couple of seconds.
  let artTurn = 0;
  if (!REDUCED && quickArts.length) {
    setInterval(() => {
      if (document.hidden || currentTab !== 'map' || modal.open) return;
      const r = quickArts[0].closest('.quick').getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return;
      playArt(quickArts[artTurn % quickArts.length]);
      artTurn += 1;
    }, 2400);
  }

  // Tapping the big medal in a badge sheet spins it again.
  document.addEventListener('click', (e) => {
    const m = e.target.closest('.badge-hero .medal');
    if (!m) return;
    m.classList.remove('again');
    m.getBoundingClientRect();
    m.classList.add('again');
    if (!m.classList.contains('locked')) burst(m, 18);
  });
  // Travel cards lean toward the mouse (or the finger while pressed) and catch the light.
  function tilt(card, e) {
    const r = card.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    card.style.setProperty('--ry', `${(px - 0.5) * 16}deg`);
    card.style.setProperty('--rx', `${(0.5 - py) * 12}deg`);
    card.style.setProperty('--gx', `${px * 100}%`);
    card.style.setProperty('--gy', `${py * 100}%`);
    card.classList.add('tilting');
  }
  function untilt(card) {
    card.classList.remove('tilting');
    card.style.removeProperty('--rx'); card.style.removeProperty('--ry');
  }
  if (!REDUCED) {
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest?.('.pcard');
      if (card && (e.pointerType !== 'touch' || card.classList.contains('pressed'))) tilt(card, e);
    }, { passive: true });
    document.addEventListener('pointerdown', (e) => {
      const card = e.target.closest?.('.pcard');
      if (card && e.pointerType === 'touch') { card.classList.add('pressed'); tilt(card, e); }
    }, { passive: true });
    ['pointerup', 'pointercancel'].forEach((t) => document.addEventListener(t, () => $$('.pcard.pressed').forEach((c) => { c.classList.remove('pressed'); untilt(c); }), { passive: true }));
    document.addEventListener('pointerout', (e) => {
      const card = e.target.closest?.('.pcard');
      if (card && e.pointerType !== 'touch' && !card.contains(e.relatedTarget)) untilt(card);
    }, { passive: true });
  }
  // The tab highlight slides from tab to tab.
  const ink = document.createElement('span');
  ink.className = 'tab-ink';
  $('.tabs').prepend(ink);
  function moveInk() {
    const on = $('.tabs button.on');
    if (!on) return;
    ink.style.left = `${on.offsetLeft}px`;
    ink.style.top = `${on.offsetTop}px`;
    ink.style.width = `${on.offsetWidth}px`;
    ink.style.height = `${on.offsetHeight}px`;
  }
  new MutationObserver(moveInk).observe($('.tabs'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  window.addEventListener('resize', moveInk);
  setTimeout(moveInk, 60);
  // With a mouse, sideways rows (day timeline, travel cards, photo rows) can be dragged, and keep gliding.
  function dragScroll(row) {
    if (row.dataset.drag) return;
    row.dataset.drag = '1';
    row.classList.add('drag-scroll');
    let start = null;
    let v = 0;
    let lastX = 0;
    let lastT = 0;
    row.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      start = { x: e.clientX, left: row.scrollLeft, moved: false };
      lastX = e.clientX; lastT = performance.now(); v = 0;
    });
    window.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (!start.moved && Math.abs(dx) < 6) return;
      if (!start.moved) { start.moved = true; row.classList.add('dragging'); }
      row.scrollLeft = start.left - dx;
      const now = performance.now();
      v = (e.clientX - lastX) / Math.max(1, now - lastT);
      lastX = e.clientX; lastT = now;
    });
    window.addEventListener('pointerup', () => {
      if (!start) return;
      const { moved } = start;
      start = null;
      if (!moved) return;
      // A drag is not a click on the card under the mouse.
      row.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true });
      setTimeout(() => row.classList.remove('dragging'), 0);
      let speed = v * 16;
      const glide = () => {
        if (REDUCED || Math.abs(speed) < 0.5) return;
        row.scrollLeft -= speed;
        speed *= 0.92;
        requestAnimationFrame(glide);
      };
      requestAnimationFrame(glide);
    });
  }
  const dragRows = () => $$('.day-strip, .pcards, .gallery, .cards.scroll, .mc-strip').forEach(dragScroll);
  let dragPending = false;
  new MutationObserver(() => {
    if (dragPending) return;
    dragPending = true;
    requestAnimationFrame(() => { dragPending = false; dragRows(); });
  }).observe(document.body, { childList: true, subtree: true });
  dragRows();

  // ---------- photos (Wikipedia REST API; falls back to the designed gradient when blocked)
  const photoCache = store.get('photos', {});
  const photoPending = {};
  function wikiPhoto(title) {
    if (!title) return Promise.resolve(null);
    if (title in photoCache) return Promise.resolve(photoCache[title]);
    if (!photoPending[title]) {
      photoPending[title] = fetch(`https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { Accept: 'application/json' } })
        .then((res) => {
          if (res.status === 404) return null;
          if (!res.ok) throw new Error(String(res.status));
          return res.json();
        })
        .then((data) => {
          let result = null;
          const original = data?.originalimage;
          const thumb = data?.thumbnail?.source;
          if (original?.source) {
            // Large originals can be several MB, so ask Wikimedia for a 1600px rendition instead.
            const src = original.width > 2000 && thumb ? thumb.replace(/\/\d+px-/, '/1600px-') : original.source;
            result = { src, page: data.content_urls?.desktop?.page || '' };
          }
          photoCache[title] = result;
          store.set('photos', photoCache);
          return result;
        })
        .catch(() => null);
    }
    return photoPending[title];
  }
  const spotTitle = (name) => name.replace(/（.*?）|\(.*?\)/g, '').split(/[ ＋+]/)[0];
  function applyPhoto(node, title) {
    if (!node) return;
    const local = node.dataset.photoKey ? photoOf(node.dataset.photoKey) : null;
    (local ? Promise.resolve(local) : wikiPhoto(title)).then((p) => {
      if (!p) { if (node.classList.contains('photo')) { node.classList.add('empty'); node.innerHTML = '<span>沒有找到照片，點「照片」看更多</span>'; } return; }
      const img = new Image();
      img.onload = () => {
        if (node.classList.contains('photo')) {
          node.style.backgroundImage = `url("${p.src}")`;
          node.innerHTML = p.page ? `<a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.author || 'Wikipedia')}${p.license ? `・${esc(p.license)}` : ''}</a>` : '';
        } else {
          node.style.setProperty('--cover-img', `url("${p.src}")`);
          node.classList.add('loaded');
          const credit = node.querySelector('.credit');
          if (credit && p.page) { credit.href = p.page; credit.textContent = `${p.author || 'Wikipedia'}${p.license ? `・${p.license}` : ''}`; credit.hidden = false; }
        }
      };
      img.src = p.src;
    });
  }

  // ---------- magazine cover (首頁) and day strip
  const WEEK = '日一二三四五六';
  const dayLabel = (t, i) => { const date = addDays(t.start, i); return `${md(date)}（${WEEK[parseDate(date).getDay()]}）`; };
  const season = (s) => ['冬', '冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬'][parseDate(s).getMonth()];
  function coverTrip() {
    return upcomingTrips()[0] || sortTrips(trips).reverse()[0] || null;
  }
  function tripStatus(t) {
    if (isOngoing(t)) return '旅行中';
    if (isUpcoming(t)) return `${daysBetween(TODAY, t.start) - 1} 天後出發`;
    return '旅行回顧';
  }
  // Editorial map plate behind the cover title, shown until (or instead of) a photo.
  function coverArt(lng, lat) {
    if (!world || lng == null) return '';
    const W = 1200; const H = 640;
    const proj = d3.geoMercator().center([lng, lat]).scale(2600).translate([W * 0.72, H * 0.42]).clipExtent([[0, 0], [W, H]]);
    const path = d3.geoPath(proj);
    const [x, y] = proj([lng, lat]);
    const land = world.features.map((f) => path(f)).filter(Boolean).join('');
    const grat = path(d3.geoGraticule().step([2, 2])());
    return `<svg class="cover-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d="${grat}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="1"/>
      <path d="${land}" fill="rgba(255,255,255,.10)" stroke="rgba(255,255,255,.55)" stroke-width="1.2"/>
      <circle cx="${x}" cy="${y}" r="40" fill="rgba(255,255,255,.12)"/><circle cx="${x}" cy="${y}" r="18" fill="rgba(255,255,255,.25)"/><circle cx="${x}" cy="${y}" r="7" fill="#fff"/>
    </svg>`;
  }
  function coverHtml(t, planner) {
    const d = t.dest && DEST[t.dest];
    const c = country(t.n);
    const key = t.tags[0] || d?.tags[0];
    const [c1, c2] = TAG_COLORS[key] || ['#1463ff', '#00b3a4'];
    const n = daysBetween(t.start, t.end);
    const plan = t.plan || null;
    const items = plan ? plan.days.flat() : [];
    const tickets = items.filter((it) => it.fee).length;
    const order = orders.find((o) => o.tripIds?.includes(t.id));
    const vol = parseDate(t.start);
    return `<header class="mag-cover ${planner ? 'plan-cover' : ''}" data-cover="${esc(WIKI[t.dest] || t.city)}" data-photo-key="dest:${esc(t.dest || '')}" style="--cover-fallback:linear-gradient(160deg,${c1} 0%,${c2} 45%,#0b1430 100%)">
      ${coverArt(t.lng, t.lat)}
      <div class="masthead"><span>${esc(CONFIG.brand)}</span><span>${vol.getFullYear()} 年 ${vol.getMonth() + 1} 月號</span></div>
      <div class="content">
        <button class="kicker tap-text" data-country-n="${t.n}">${flag(c.code)} ${esc(c.name)}・${season(t.start)}季・${tripStatus(t)} ›</button>
        <h1 class="cover-title serif">${esc(t.city)}</h1>
        <p class="cover-lede">${esc(d?.blurb || t.note || `${n} 天的${c.name}之旅`)}</p>
        <div class="cover-meta"><button data-edit="${t.id}" aria-label="修改日期">${md(t.start)} – ${md(t.end)}・${n} 天</button>${items.length ? `<button data-open-plan="${t.id}">${items.length} 個行程</button>` : ''}${tickets ? `<button data-tickets="${t.id}">${tickets} 張門票</button>` : ''}${order ? '<button data-goto="esim">eSIM ' : `<button data-plan="${packFor(c.code)}" ${packFor(c.code) !== c.code ? `data-for="${c.code}"` : ''}>`}${order ? orderStatus(order)[1] : '尚未購買 eSIM'}</button></div>
        ${planner ? '' : `<div class="row" style="margin-top:6px">${isOngoing(t) ? `<button class="btn primary" data-checkin="${t.id}">在 ${esc(t.city)} 打卡</button>` : ''}<button class="btn" data-open-plan="${t.id}">打開行程表 →</button><button class="btn glass" data-near="${t.id}">附近還能去哪</button></div>`}
      </div>
      <a class="credit" target="_blank" rel="noopener" hidden>照片：Wikipedia</a>
    </header>`;
  }
  function renderCover() {
    const t = coverTrip();
    if (!t) {
      const pick = recommend({ ...home(), name: home().name }, { tags: [], month: recState.month, hours: 5, fee: 'any', unvisited: false }, 1)[0];
      const d = pick?.d;
      $('#cover').innerHTML = d ? `<header class="mag-cover" data-cover="${esc(WIKI[d.id] || d.name)}" data-photo-key="dest:${d.id}" style="--cover-fallback:linear-gradient(160deg,${(TAG_COLORS[d.tags[0]] || [])[0]} 0%,${(TAG_COLORS[d.tags[0]] || [])[1]} 45%,#0b1430 100%)">
        ${coverArt(d.lng, d.lat)}
        <div class="masthead"><span>${esc(CONFIG.brand)}</span><span>本期推薦</span></div>
        <div class="content"><span class="kicker">${flag(d.c)} ${COUNTRIES[d.c].name}・台北直飛 ${d.hours} 小時</span><h1 class="cover-title serif">${esc(d.name)}</h1>
        <p class="cover-lede">${esc(d.blurb)}</p><div class="row"><button class="btn" data-trip-dest="${d.id}">＋ 排進我的行程</button><button class="btn glass" data-ai="${d.id}">看建議行程</button></div></div>
        <a class="credit" target="_blank" rel="noopener" hidden>照片：Wikipedia</a></header>` : '';
      $('#strip-title').innerHTML = ''; $('#day-strip').innerHTML = '';
      applyPhoto($('#cover .mag-cover'), $('#cover .mag-cover')?.dataset.cover);
      return;
    }
    ensurePlan(t);
    $('#cover').innerHTML = coverHtml(t, false);
    applyPhoto($('#cover .mag-cover'), $('#cover .mag-cover').dataset.cover);
    $('#strip-title').innerHTML = `<h2 class="serif">${esc(t.city)} ${t.plan.days.length} 日行程</h2><span class="spacer"></span><button class="link-btn" data-open-plan="${t.id}">編輯行程表 →</button>`;
    // A timeline rail, one stop per day, rather than a box per day.
    const today = daysBetween(t.start, TODAY) - 1;
    $('#day-strip').innerHTML = t.plan.days.map((items, i) => `<button class="day-card ${i === today ? 'now' : ''} ${i < today ? 'past' : ''}" data-open-plan="${t.id}" data-day="${i}" style="--d:${i * 50}ms">
      <span class="dn">Day ${i + 1}</span><span class="dd">${dayLabel(t, i)}</span>
      <ol>${items.slice(0, 3).map((it) => `<li>${it.time ? `<time>${esc(it.time)}</time>` : ''}<span>${esc(it.name)}</span></li>`).join('') || '<li class="muted">還沒安排，點一下開始排</li>'}</ol>${items.length > 3 ? `<span class="more">還有 ${items.length - 3} 項</span>` : ''}</button>`).join('');
  }

  // ---------- planner (行程表)
  const openItems = new Set();
  let sortables = [];
  const newItem = (name, time, extra = {}) => ({
    id: `p-${uid()}`, name, time: time || '', kind: 'spot', fee: null, cur: '', note: '', ...extra,
  });
  function seedPlan(t) {
    const d = t.dest && DEST[t.dest];
    const n = daysBetween(t.start, t.end);
    const days = Array.from({ length: n }, () => []);
    const slots = ['10:00', '14:00', '16:30'];
    days[0].push(newItem(`抵達 ${t.city}・開啟 eSIM 數據漫遊`, '13:00', { kind: 'move' }));
    const spots = d ? d.spots : [];
    const middle = n > 2 ? n - 2 : 1;
    spots.forEach((s, i) => {
      const day = n > 2 ? 1 + (i % middle) : Math.min(i, n - 1);
      days[day].push(newItem(s.name, slots[Math.floor(i / middle) % slots.length], { fee: s.fee, cur: s.cur, note: s.note }));
    });
    if ((d?.tags || t.tags).includes('food')) days[0].push(newItem('晚餐：飯店附近找在地小店', '19:00', { kind: 'food' }));
    if (n > 1) days[n - 1].push(newItem('退房・伴手禮・前往機場', '10:00', { kind: 'move' }));
    days.forEach((list) => list.sort((a, b) => (a.time || '99').localeCompare(b.time || '99')));
    return {
      days,
      budget: { people: 1, cap: 0, flight: 0, hotel: 0, transport: 0, food: 0, shopping: 0, other: 0 },
      todos: ['確認護照效期 6 個月以上', '訂機票', '訂住宿', '保旅平險', '準備信用卡／換匯'].map((text) => ({ id: `td-${uid()}`, text, done: false })),
      done: {},
    };
  }
  function ensurePlan(t) {
    if (!t.plan) { t.plan = seedPlan(t); save(); }
    const n = daysBetween(t.start, t.end);
    const { days } = t.plan;
    while (days.length < n) days.push([]);
    if (days.length > n) { const extra = days.splice(n).flat(); days[n - 1].push(...extra); }
    return t.plan;
  }
  const planTrip = () => trips.find((x) => x.id === planTripId);
  function defaultPlanTrip() { return coverTrip(); }
  function openPlanner(id, day) {
    planTripId = id;
    if (currentTab === 'plan') renderPlanner(); else go('plan');
    if (day != null) setTimeout(() => $(`#day-${day}`)?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }), REDUCED ? 30 : 380);
  }
  function poolFor(t) {
    const d = t.dest && DEST[t.dest];
    const used = new Set(t.plan.days.flat().map((it) => it.name));
    const own = d ? d.spots.map((s) => ({ ...s, city: d.name })) : [];
    const near = DESTS.filter((x) => x.id !== d?.id && haversine(t, x) < 400)
      .flatMap((x) => x.spots.slice(0, 2).map((s) => ({ ...s, city: x.name, side: true })));
    return [...own, ...near].filter((s) => !used.has(s.name));
  }
  function itemHtml(t, it, dayIndex) {
    const c = country(t.n);
    const open = openItems.has(it.id);
    const place = `${spotTitle(it.name)} ${t.city}`;
    const fee = it.fee != null && it.kind === 'spot' ? `<span class="chip ${it.fee === 0 ? 'free' : 'fee'}">${it.fee === 0 ? '免費' : esc(ticketText(it))}</span>` : '<span></span>';
    return `<li class="item k-${it.kind}" data-id="${it.id}">
      <div class="item-row">
        <span class="handle" title="拖曳排序" aria-label="拖曳排序">⋮⋮</span>
        <input class="time" value="${esc(it.time)}" data-time="${it.id}" inputmode="numeric" maxlength="5" placeholder="--:--" aria-label="時間（例如 09:30）">
        <button class="item-name" data-toggle="${it.id}" aria-expanded="${open}">${esc(it.name)}</button>
        ${fee}
      </div>
      ${open ? `<div class="item-detail">
        ${it.kind === 'move' ? '' : `<div class="photo" data-photo="${esc(it.kind === 'food' ? (WIKI[t.dest] || t.city) : spotTitle(it.name))}" data-photo-key="${it.kind === 'food' ? `dest:${esc(t.dest || '')}` : `spot:${esc(t.dest || '')}:${esc(it.name)}`}">載入照片中…</div>`}
        <div class="links">
          <a class="btn sm" href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent(place)}" target="_blank" rel="noopener">照片</a>
          <a class="btn sm" href="https://www.youtube.com/results?search_query=${encodeURIComponent(`${place} 旅遊`)}" target="_blank" rel="noopener">▶️ 影片</a>
          <a class="btn sm" href="${gmaps(place)}" target="_blank" rel="noopener">地圖</a>
          ${it.fee ? `<a class="btn sm primary" href="${gsearch(`${spotTitle(it.name)} 門票 官方 預約`)}" target="_blank" rel="noopener">訂票</a>` : ''}
          ${c.site ? `<a class="btn sm" href="${c.site}" target="_blank" rel="noopener">官方觀光網</a>` : ''}
        </div>
        ${it.fee ? `<div class="small muted">成人門票 ${esc(ticketText(it))} ≈ NT$${fmt(toTwd(it))}${it.note ? `・${esc(it.note)}` : ''}（參考價，以官方公告為準）</div>` : ''}
        <textarea class="input" rows="2" data-note="${it.id}" placeholder="備註：訂位代號、集合地點、交通方式…">${esc(it.kind === 'spot' && it.fee != null ? it.memo || '' : it.note)}</textarea>
        <div class="row"><label class="small muted" for="mv-${it.id}">移到</label>
          <select class="input" id="mv-${it.id}" data-move="${it.id}" style="width:auto">${t.plan.days.map((_, i) => `<option value="${i}" ${i === dayIndex ? 'selected' : ''}>Day ${i + 1}・${dayLabel(t, i)}</option>`).join('')}</select>
          <span class="spacer"></span><button class="btn sm" data-remove="${it.id}" style="color:var(--danger)">刪除</button></div>
      </div>` : ''}
    </li>`;
  }
  function budgetOf(t) {
    const b = t.plan.budget;
    const tickets = sum(t.plan.days.flat(), toTwd) * (b.people || 1);
    const linked = ordersFor(t.id);
    const order = linked[0];
    const esim = sum(linked, (o) => o.price);
    const manual = ['flight', 'hotel', 'transport', 'food', 'shopping', 'other'].reduce((s, k) => s + (Number(b[k]) || 0), 0);
    return { tickets, esim, order, total: manual + tickets + esim };
  }
  function autoTodos(t) {
    const c = country(t.n);
    const list = [];
    const order = ordersFor(t.id)[0];
    if (!order) list.push({ key: 'esim-buy', text: `購買 ${c.name} eSIM`, action: `<button class="btn sm" data-plan="${coverFor([c.code])}">選方案</button>` });
    else {
      const mine = order.cards.find((x) => !x.sharedAt || x.claimed) || order.cards[0];
      const st = cardState(order, mine);
      const ref = `${order.id}:${mine.id}`;
      if (st === 'unclaimed') list.push({ key: 'esim-claim', text: '取得 eSIM 安裝資料', action: `<button class="btn sm" data-claim="${ref}">取得</button>` });
      if (['unclaimed', 'claimed'].includes(st)) list.push({ key: 'esim-install', text: installAdvice(order), action: st === 'claimed' ? `<button class="btn sm" data-install="${ref}">安裝</button>` : '' });
      order.cards.filter((x) => cardState(order, x) === 'shared').forEach((x) => list.push({ key: `esim-share-${x.id}`, text: `確認親友已領取第 ${x.n} 張 eSIM`, action: `<button class="btn sm" data-share="${order.id}:${x.id}">再傳一次</button>` }));
    }
    if (c.note) list.push({ key: 'entry', text: c.note });
    t.plan.days.flat().filter((it) => it.fee).forEach((it) => list.push({ key: `tk-${it.id}`, text: `預訂門票：${it.name}（${ticketText(it)}）` }));
    return list;
  }
  // ---------- 行程表 views: 時間軸 (drag-and-drop days), 表格 (one printable table) and 行事曆 (a month calendar of every trip)
  const PLAN_VIEWS = [['timeline', '時間軸'], ['table', '表格'], ['calendar', '行事曆']];
  let planView = store.get('planView', 'timeline');
  let calMonth = '';
  let calDay = '';
  const KIND_LABEL = { spot: '景點', food: '美食', move: '交通' };
  // Taiwan's public holidays and long weekends, to plan trips around. The official calendar has the final word.
  const HOLIDAY_RANGES = [
    ['2025-01-01', '2025-01-01', '元旦'], ['2025-01-25', '2025-02-02', '春節'], ['2025-02-28', '2025-03-02', '和平紀念日'], ['2025-04-03', '2025-04-06', '兒童節・清明'],
    ['2025-05-01', '2025-05-01', '勞動節'], ['2025-05-30', '2025-06-01', '端午'], ['2025-09-27', '2025-09-29', '教師節'], ['2025-10-04', '2025-10-06', '中秋'],
    ['2025-10-10', '2025-10-12', '國慶'], ['2025-10-24', '2025-10-26', '光復節'], ['2025-12-25', '2025-12-25', '行憲紀念日'],
    ['2026-01-01', '2026-01-01', '元旦'], ['2026-02-14', '2026-02-22', '春節'], ['2026-02-27', '2026-03-01', '和平紀念日'], ['2026-04-03', '2026-04-06', '兒童節・清明'],
    ['2026-05-01', '2026-05-03', '勞動節'], ['2026-06-19', '2026-06-21', '端午'], ['2026-09-25', '2026-09-28', '中秋・教師節'], ['2026-10-09', '2026-10-11', '國慶'],
    ['2026-10-24', '2026-10-26', '光復節'], ['2026-12-25', '2026-12-27', '行憲紀念日'],
  ];
  const HOLIDAYS = {};
  HOLIDAY_RANGES.forEach(([from, to, name]) => { for (let d = from; d <= to; d = addDays(d, 1)) HOLIDAYS[d] = name; });
  const nextLongWeekend = () => HOLIDAY_RANGES.find(([from, to]) => to >= TODAY && daysBetween(from, to) >= 3);
  const tripOn = (date) => sortTrips(trips).find((t) => t.start <= date && date <= t.end);
  const tripColor = (t) => TAG_COLORS[t.tags[0]] || ['#1463ff', '#00b3a4'];
  const noteOf = (it) => (it.kind === 'spot' && it.fee != null ? [it.memo, it.note] : [it.note]).filter(Boolean).join('・');
  const feeOf = (it) => {
    if (it.fee == null || it.kind !== 'spot') return '';
    return it.fee === 0 ? '免費' : `${ticketText(it)}（約 NT$${fmt(toTwd(it))}）`;
  };
  const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99');
  // A day's rows: its plan items in time order, with the check-ins made that day.
  const dayRows = (t, i) => {
    const date = addDays(t.start, i);
    return [
      ...t.plan.days[i].map((it) => ({ time: it.time, it })),
      ...(t.checkins || []).filter((c) => c.date === date).map((c) => ({ time: '', c })),
    ].sort(byTime);
  };

  // ---------- 表格
  function planText(t) {
    ensurePlan(t);
    const lines = [`【${t.city} ${t.plan.days.length} 日行程】${md(t.start)}（${WEEK[parseDate(t.start).getDay()]}）– ${md(t.end)}（${WEEK[parseDate(t.end).getDay()]}）`];
    t.plan.days.forEach((items, i) => {
      lines.push('', `Day ${i + 1}・${dayLabel(t, i)}`);
      const rows = dayRows(t, i);
      if (!rows.length) lines.push('（自由活動）');
      rows.forEach((r) => lines.push(r.it ? `${r.it.time || '　　 '} ${r.it.name}${feeOf(r.it) ? `｜門票 ${feeOf(r.it)}` : ''}${noteOf(r.it) ? `｜${noteOf(r.it)}` : ''}` : `打卡 ${r.c.place}${r.c.caption ? `「${r.c.caption}」` : ''}`));
    });
    lines.push('', `— 用 ${CONFIG.brand} 排的行程`);
    return lines.join('\n');
  }
  function planTableHtml(t) {
    const c = country(t.n);
    const { tickets, total } = budgetOf(t);
    const people = t.plan.budget.people || 1;
    const order = ordersFor(t.id)[0];
    const body = t.plan.days.map((items, i) => {
      const rows = dayRows(t, i);
      const cis = rows.filter((r) => r.c).length;
      return `<tbody>
        <tr class="pt-day"><th colspan="3"><span class="serif">Day ${i + 1}</span><span>${dayLabel(t, i)}</span>${HOLIDAYS[addDays(t.start, i)] ? `<em class="pt-hol">${HOLIDAYS[addDays(t.start, i)]}</em>` : ''}${cis ? `<em class="pt-ci-n">打卡 ${cis}</em>` : ''}</th></tr>
        ${rows.map((r) => (r.it ? `<tr class="k-${r.it.kind}"><td class="pt-time">${esc(r.it.time || '—')}</td><td class="pt-name"><button class="pt-link" data-pt-open="${r.it.id}:${i}"><i class="pt-dot"></i>${esc(r.it.name)}</button><small class="pt-sub">${[KIND_LABEL[r.it.kind] || '行程', noteOf(r.it)].filter(Boolean).map(esc).join('・')}</small></td><td class="pt-fee">${esc(feeOf(r.it))}</td></tr>`
    : `<tr class="pt-ci"><td class="pt-time"><span class="pt-stamp" style="--ink:${inkOf(r.c.id)}">打卡</span></td><td class="pt-name"><button class="pt-link" data-ci-open="${t.id}:${r.c.id}">${esc(r.c.place)}${r.c.mood ? `・${esc(r.c.mood)}` : ''}</button>${r.c.caption ? `<small class="pt-sub">「${esc(r.c.caption)}」</small>` : ''}</td><td class="pt-fee"></td></tr>`)).join('')
  || '<tr class="pt-empty"><td></td><td colspan="2">自由活動</td></tr>'}
      </tbody>`;
    }).join('');
    return `<div class="pt-sheet">
      <header class="pt-head">
        <div><span class="kicker plain muted">${flag(c.code)} ${esc(c.name)}・${t.plan.days.length} 天${tripFlight(t) ? `・${tripFlight(t).text}` : ''}</span>
          <h2 class="serif">${esc(t.city)} 行程表</h2>
          <p class="muted small">${t.start.replace(/-/g, '.')} – ${t.end.replace(/-/g, '.')}・${people} 人・eSIM ${order ? orderStatus(order)[1] : '尚未購買'}</p></div>
        <div class="pt-actions"><button class="btn sm primary" data-ics="${t.id}">加入行事曆</button><button class="btn sm" data-pt-copy="${t.id}">複製文字</button><button class="btn sm" data-pt-csv="${t.id}">下載表格</button><button class="btn sm" data-pt-print>列印／存 PDF</button></div>
      </header>
      <div class="pt-scroll"><table class="plan-table">
        <thead><tr><th class="pt-time">時間</th><th>行程・備註</th><th class="pt-fee">門票</th></tr></thead>
        ${body}
        <tfoot><tr><td colspan="2">門票合計${people > 1 ? `（${people} 人）` : ''}</td><td>NT$${fmt(tickets)}</td></tr><tr><td colspan="2">預算合計（含機票住宿與 eSIM）</td><td>NT$${fmt(total)}${people > 1 ? `<br>每人 NT$${fmt(total / people)}` : ''}</td></tr></tfoot>
      </table></div>
      <p class="small muted pt-foot">點行程名稱會回到時間軸編輯；門票為參考價，以官方公告為準。</p>
    </div>`;
  }
  function planCsv(t) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Day', '日期', '時間', '行程', '類型', '門票', '備註']];
    t.plan.days.forEach((items, i) => dayRows(t, i).forEach((r) => rows.push(r.it
      ? [i + 1, addDays(t.start, i), r.it.time, r.it.name, KIND_LABEL[r.it.kind] || '行程', feeOf(r.it), noteOf(r.it)]
      : [i + 1, addDays(t.start, i), '', r.c.place, '打卡', '', r.c.caption || ''])));
    return `\ufeff${rows.map((r) => r.map(q).join(',')).join('\r\n')}`;
  }

  // ---------- 加入行事曆: an .ics file (iPhone, Android, Outlook) and a Google Calendar link
  const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const icsDay = (d) => d.replace(/-/g, '');
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}`;
  // Lines longer than 75 bytes are folded, counting Chinese characters as the 3 bytes they take.
  const icsFold = (line) => {
    const out = [];
    let cur = '';
    let bytes = 0;
    [...line].forEach((ch) => {
      const n = new TextEncoder().encode(ch).length;
      if (bytes + n > 73) { out.push(cur); cur = ' '; bytes = 1; }
      cur += ch; bytes += n;
    });
    out.push(cur);
    return out.join('\r\n');
  };
  function tripIcs(t) {
    ensurePlan(t);
    const c = country(t.n);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const ev = (uid2, start, end, summary, extra = []) => ['BEGIN:VEVENT', `UID:${uid2}@travel`, `DTSTAMP:${stamp}`, start, end, `SUMMARY:${icsEsc(summary)}`, ...extra, 'END:VEVENT'];
    const events = [ev(t.id, `DTSTART;VALUE=DATE:${icsDay(t.start)}`, `DTEND;VALUE=DATE:${icsDay(addDays(t.end, 1))}`, `${t.city} 旅行`, [`LOCATION:${icsEsc(`${t.city}, ${c.name}`)}`, `DESCRIPTION:${icsEsc(planText(t))}`])];
    t.plan.days.forEach((items, i) => {
      const date = icsDay(addDays(t.start, i));
      const timed = items.filter((it) => /^\d{1,2}:\d{2}$/.test(it.time)).sort(byTime);
      timed.forEach((it, k) => {
        const [h, m] = it.time.split(':').map(Number);
        const from = Math.min(h * 60 + m, 23 * 60 + 30);
        const next = timed[k + 1] ? timed[k + 1].time.split(':').map(Number) : null;
        const nextMin = next ? next[0] * 60 + next[1] : 0;
        const to = Math.min(nextMin > from ? Math.min(nextMin, from + 120) : from + 90, 23 * 60 + 59);
        events.push(ev(it.id, `DTSTART:${date}T${hhmm(from)}00`, `DTEND:${date}T${hhmm(to)}00`, it.name, [
          `LOCATION:${icsEsc(it.kind === 'move' ? t.city : `${spotTitle(it.name)} ${t.city}`)}`,
          ...([feeOf(it) && `門票 ${feeOf(it)}`, noteOf(it)].filter(Boolean).length ? [`DESCRIPTION:${icsEsc([feeOf(it) && `門票 ${feeOf(it)}`, noteOf(it)].filter(Boolean).join('\n'))}`] : []),
        ]));
      });
    });
    if (t.start > TODAY) {
      events.push(ev(`${t.id}-esim`, `DTSTART:${icsDay(addDays(t.start, -1))}T200000`, `DTEND:${icsDay(addDays(t.start, -1))}T201500`, `安裝 ${c.name} eSIM`, [
        `DESCRIPTION:${icsEsc(`明天出發去 ${t.city}：在 Wi-Fi 下先把 eSIM 裝好，抵達後再開啟數據漫遊。`)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', `DESCRIPTION:${icsEsc('安裝 eSIM')}`, 'END:VALARM',
      ]));
    }
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${icsEsc(CONFIG.brand)}//Travel//ZH-TW`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(`${t.city} 行程`)}`, ...events.flat(), 'END:VCALENDAR']
      .map(icsFold).join('\r\n');
  }
  const calIcon = (date) => `<span class="cal-ico"><i>${parseDate(date).getMonth() + 1}月</i><b>${parseDate(date).getDate()}</b></span>`;
  function openIcs(t) {
    ensurePlan(t);
    const c = country(t.n);
    const timed = t.plan.days.flat().filter((it) => /^\d{1,2}:\d{2}$/.test(it.time)).length;
    const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${t.city} 旅行`)}&dates=${icsDay(t.start)}/${icsDay(addDays(t.end, 1))}&details=${encodeURIComponent(planText(t).slice(0, 1400))}&location=${encodeURIComponent(`${t.city}, ${c.name}`)}`;
    openModal('加入行事曆', `
      <p class="muted" style="margin:0">把 ${esc(t.city)} 這趟放進手機的行事曆：整趟旅行一個全天事件，${timed} 個有時間的行程各一個事件${t.start > TODAY ? '，出發前一晚 8 點提醒你安裝 eSIM' : ''}。</p>
      <div class="ics-options">
        <button class="ics-opt" data-ics-dl="${t.id}"><span class="ics-ico">${calIcon(t.start)}</span><span><b>下載行事曆檔（.ics）</b><small>iPhone、Android、Outlook、Mac 行事曆：打開檔案就會加入</small></span></button>
        <a class="ics-opt" href="${google}" target="_blank" rel="noopener"><span class="ics-ico g">G</span><span><b>加到 Google 日曆</b><small>整趟旅行一個事件，每天的行程寫在說明裡</small></span></a>
      </div>`);
  }

  // ---------- 行事曆
  function calendarHtml() {
    const [y, m] = calMonth.split('-').map(Number);
    const first = `${calMonth}-01`;
    const days = new Date(y, m, 0).getDate();
    const lead = parseDate(first).getDay();
    const weeks = Math.ceil((lead + days) / 7);
    const gridStart = addDays(first, -lead);
    const items = {};
    trips.forEach((t) => { if (!t.plan) return; t.plan.days.forEach((list, i) => { items[addDays(t.start, i)] = (items[addDays(t.start, i)] || 0) + list.length; }); });
    const cis = {};
    allCheckins().forEach((c) => { cis[c.date] = (cis[c.date] || 0) + 1; });
    const pics = {};
    LIB.slice().sort(byTaken).forEach((p) => { if (p.taken && !pics[p.taken]) pics[p.taken] = p; });
    const rows = Array.from({ length: weeks }, (_, w) => {
      const ws = addDays(gridStart, w * 7);
      const we = addDays(ws, 6);
      const lanes = [];
      const bars = sortTrips(trips.filter((t) => t.start <= we && t.end >= ws)).map((t) => {
        const s = t.start > ws ? t.start : ws;
        const e = t.end < we ? t.end : we;
        const col = daysBetween(ws, s);
        const span = daysBetween(s, e);
        let lane = lanes.findIndex((end) => end < col);
        if (lane < 0) { lane = lanes.length; lanes.push(0); }
        lanes[lane] = col + span - 1;
        const [c1, c2] = tripColor(t);
        const head = s === t.start;
        return `<button class="cal-bar ${head ? 'head' : ''} ${e === t.end ? 'tail' : ''} ${t.end < TODAY ? 'past' : ''}" data-cal-trip="${t.id}" style="grid-column:${col}/span ${span};grid-row:${lane + 1};--c1:${c1};--c2:${c2}">${head || col === 1 ? `${flag(country(t.n).code)}<span>${esc(t.city)}</span>` : ''}</button>`;
      }).join('');
      const cells = Array.from({ length: 7 }, (__, d) => {
        const date = addDays(ws, d);
        const p = pics[date];
        const cls = [date.slice(0, 7) !== calMonth && 'other', date === TODAY && 'today', date === calDay && 'sel', HOLIDAYS[date] && 'hol', (d === 0 || d === 6) && 'wkend', p && 'has-ph'].filter(Boolean).join(' ');
        return `<button class="cal-cell ${cls}" data-cal-day="${date}" aria-label="${md(date)}${HOLIDAYS[date] ? ` ${HOLIDAYS[date]}` : ''}">${p ? `<img class="cal-ph" src="${libSrc(p)}" alt="" loading="lazy">` : ''}<span class="cal-n">${Number(date.slice(8))}</span>${HOLIDAYS[date] && (date === first || !HOLIDAYS[addDays(date, -1)] || d === 0) ? `<small class="cal-hol">${HOLIDAYS[date]}</small>` : ''}<span class="cal-marks">${items[date] ? `<i class="cal-dot" title="${items[date]} 個行程">${items[date]}</i>` : ''}${cis[date] ? '<i class="cal-ci" title="打卡"></i>' : ''}</span></button>`;
      }).join('');
      return `<div class="cal-week" style="--lanes:${Math.max(1, lanes.length)}"><div class="cal-cells">${cells}</div><div class="cal-bars">${bars}</div></div>`;
    }).join('');
    const nl = nextLongWeekend();
    const monthTrips = sortTrips(trips.filter((t) => t.start.slice(0, 7) <= calMonth && t.end.slice(0, 7) >= calMonth));
    return `<div class="calendar">
      <div class="cal-top"><button class="icon-btn" data-cal-nav="-1" aria-label="上個月">‹</button><h2 class="serif">${y} 年 ${m} 月</h2><button class="icon-btn" data-cal-nav="1" aria-label="下個月">›</button><span class="spacer"></span><button class="btn sm" data-cal-today>今天</button></div>
      ${nl ? `<button class="cal-next" data-cal-jump="${nl[0]}"><b>下一個連假</b><span>${nl[2]}・${md(nl[0])}–${md(nl[1])}（${daysBetween(nl[0], nl[1])} 天）</span><span class="spacer"></span><span class="link-btn">看這個月 →</span></button>` : ''}
      <div class="cal-head">${[...WEEK].map((w, i) => `<span class="${i === 0 || i === 6 ? 'wkend' : ''}">${w}</span>`).join('')}</div>
      <div class="cal-grid">${rows}</div>
      <div class="cal-legend small muted"><span><i class="cal-dot">3</i>行程數</span><span><i class="cal-ci"></i>打卡</span><span><i class="cal-hol-key"></i>國定假日・連假</span><span>有照片的日子會顯示照片</span></div>
      ${monthTrips.length ? `<div class="cal-month-trips">${monthTrips.map((t) => { const [c1, c2] = tripColor(t); return `<button class="cal-trip-row" data-cal-trip="${t.id}" style="--c1:${c1};--c2:${c2}"><i></i>${flag(country(t.n).code)}<b>${esc(t.city)}</b><span class="muted small">${md(t.start)}–${md(t.end)}・${daysBetween(t.start, t.end)} 天</span></button>`; }).join('')}</div>` : ''}
      <div id="cal-agenda">${calAgendaHtml(calDay)}</div>
      <p class="small muted">國定假日與連假依行政院人事行政總處公告，訂票前請再確認。</p>
    </div>`;
  }
  function calAgendaHtml(date) {
    if (!date) return '';
    const t = tripOn(date);
    const d = parseDate(date);
    const head = `<div class="cal-ag-head">${calIcon(date)}<div><b>${d.getMonth() + 1} 月 ${d.getDate()} 日（${WEEK[d.getDay()]}）</b>${HOLIDAYS[date] ? `<span class="pt-hol">${HOLIDAYS[date]}</span>` : ''}${t ? `<div class="small muted">${flag(country(t.n).code)} ${esc(t.city)}・Day ${daysBetween(t.start, date)} / ${daysBetween(t.start, t.end)}</div>` : ''}</div></div>`;
    const photos = LIB.filter((p) => p.taken === date).sort(byTaken).slice(0, 12);
    const photoRow = photos.length ? `<div class="cal-ag-photos">${photos.map((p) => `<button class="lib-ph" data-lib-photo="${p.id}"><img src="${libSrc(p)}" alt="" loading="lazy"></button>`).join('')}</div>` : '';
    if (!t) {
      return `<div class="cal-agenda">${head}${photoRow}<p class="muted" style="margin:6px 0 10px">這天沒有旅行${HOLIDAYS[date] ? `，剛好是${HOLIDAYS[date]}連假，要不要出國走走？` : '。'}</p>
        <div class="row"><button class="btn primary" data-trip-on="${date}">從這天開始一趟旅行</button><button class="btn" data-random>隨機出國找靈感</button></div></div>`;
    }
    ensurePlan(t);
    const i = daysBetween(t.start, date) - 1;
    const rows = dayRows(t, i);
    return `<div class="cal-agenda">${head}
      <ul class="cal-ag-list">${rows.map((r) => (r.it ? `<li class="k-${r.it.kind}"><time>${esc(r.it.time || '—')}</time><button class="pt-link" data-pt-open="${r.it.id}:${i}"><i class="pt-dot"></i>${esc(r.it.name)}</button>${feeOf(r.it) ? `<span class="chip ${r.it.fee === 0 ? 'free' : 'fee'}">${r.it.fee === 0 ? '免費' : esc(ticketText(r.it))}</span>` : ''}</li>`
    : `<li class="pt-ci"><time><span class="pt-stamp" style="--ink:${inkOf(r.c.id)}">打卡</span></time><button class="pt-link" data-ci-open="${t.id}:${r.c.id}">${esc(r.c.place)}${r.c.caption ? `「${esc(r.c.caption)}」` : ''}</button></li>`)).join('') || '<li class="muted">這天還沒有安排，自由活動。</li>'}</ul>
      ${photoRow}
      <form class="add-item cal-add" data-cal-add="${t.id}:${i}"><input class="input" maxlength="40" placeholder="在這天新增行程，例如：19:00 晚餐 燒肉" aria-label="新增行程"><button class="btn sm">新增</button></form>
      <div class="row"><button class="btn" data-plan-day="${t.id}:${i}">在時間軸編輯這天</button>${date <= TODAY ? `<button class="btn" data-checkin="${t.id}">打卡</button>` : ''}<button class="btn" data-ics="${t.id}">加入行事曆</button></div>
    </div>`;
  }
  function renderPlanAlt(t) {
    const box = $('#plan-alt');
    if (planView === 'table') { box.innerHTML = planTableHtml(t); return; }
    if (!calMonth) calMonth = (t && t.end >= TODAY && t.start > TODAY ? t.start : TODAY).slice(0, 7);
    if (!calDay) {
      calDay = `${calMonth}-01`;
      if (TODAY.slice(0, 7) === calMonth) calDay = TODAY;
      if (t && t.start.slice(0, 7) === calMonth) calDay = t.start;
    }
    box.innerHTML = calendarHtml();
  }
  function setCalDay(date) {
    calDay = date;
    $$('#plan-alt .cal-cell').forEach((c) => c.classList.toggle('sel', c.dataset.calDay === date));
    $('#cal-agenda').innerHTML = calAgendaHtml(date);
    if (!REDUCED) $('#cal-agenda .cal-agenda')?.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  // A day's check-in stamps and photos, under its plan on the 時間軸.
  const dayMemHtml = (t, i) => {
    const date = addDays(t.start, i);
    const cs = (t.checkins || []).filter((c) => c.date === date);
    const ps = LIB.filter((p) => p.tripId === t.id && p.taken === date).sort(byTaken).slice(0, 8);
    if (!cs.length && !ps.length) return '';
    return `<div class="day-mem">${cs.map((c) => `<button class="pt-stamp big" data-ci-open="${t.id}:${c.id}" style="--ink:${inkOf(c.id)}">${esc([...c.place].slice(0, 5).join(''))}</button>`).join('')}${ps.map((p) => `<button class="day-ph" data-lib-photo="${p.id}"><img src="${libSrc(p)}" alt="" loading="lazy"></button>`).join('')}</div>`;
  };
  function renderPlanner() {
    sortables.forEach((s) => s.destroy());
    sortables = [];
    let t = planTrip();
    if (!t) { t = defaultPlanTrip(); planTripId = t?.id || null; }
    if (!t) {
      $('#plan-cover').innerHTML = '<div class="card"><h2>還沒有行程</h2><p class="muted">先新增一趟旅行，就能用拖曳的方式排行程、算預算與待辦。</p><button class="btn primary" id="plan-new">＋ 新增行程</button></div>';
      $('#plan-days').innerHTML = ''; $('#plan-side').innerHTML = '';
      $('#plan-new').addEventListener('click', () => openTripForm());
      return;
    }
    ensurePlan(t);
    const switcher = sortTrips(trips).reverse().map((x) => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(x.city)}・${x.start}${isUpcoming(x) || isOngoing(x) ? '（即將出發）' : ''}</option>`).join('');
    $('#plan-cover').innerHTML = `<div class="row plan-top"><h2>行程表</h2><div class="seg plan-views" role="tablist" aria-label="檢視方式">${PLAN_VIEWS.map(([k, l]) => `<button data-plan-view="${k}" class="${planView === k ? 'on' : ''}" role="tab" aria-selected="${planView === k}">${l}</button>`).join('')}</div><span class="spacer"></span>
      <select class="input" id="plan-switch" style="width:auto;max-width:60vw" aria-label="切換行程">${switcher}</select><button class="btn sm" data-edit="${t.id}">行程資訊</button></div>${planView === 'timeline' ? coverHtml(t, true) : ''}`;
    if (planView === 'timeline') applyPhoto($('#plan-cover .mag-cover'), $('#plan-cover .mag-cover').dataset.cover);
    $('#plan-switch').addEventListener('change', (e) => {
      planTripId = e.target.value; openItems.clear();
      const picked = trips.find((x) => x.id === planTripId);
      if (picked) { calMonth = picked.start.slice(0, 7); calDay = picked.start; }
      renderPlanner();
    });
    const alt = planView !== 'timeline';
    $('#plan-view-main').hidden = alt;
    $('#plan-alt').hidden = !alt;
    if (alt) { renderPlanAlt(t); animateIn($('[data-view="plan"]')); return; }

    const empty = poolFor(t).length ? t.plan.days.filter((d) => !d.length).length : 0;
    $('#plan-days').innerHTML = `<div class="row" style="margin-bottom:12px"><span class="small muted">拖曳 ⋮⋮ 調整順序或移到別天；點名稱看照片、影片、地圖與訂票。</span><span class="spacer"></span>${empty ? `<button class="btn sm" data-fill="1">用景點庫補 ${empty} 個空白天</button>` : ''}</div>
      ${t.plan.days.map((items, i) => `<section class="day" id="day-${i}">
        <div class="day-head"><span class="dn serif">Day ${i + 1}</span><span class="date">${dayLabel(t, i)}</span><span class="spacer"></span><span class="small muted">${items.length} 項${sum(items, toTwd) ? `・<button class="tap-text" data-tickets="${t.id}">門票 ≈ NT$${fmt(sum(items, toTwd))} ›</button>` : ''}</span></div>
        <ul class="items" data-day="${i}">${items.map((it) => itemHtml(t, it, i)).join('')}</ul>
        ${dayMemHtml(t, i)}
        <form class="add-item" data-add="${i}"><input class="input" maxlength="40" placeholder="新增行程，例如：午餐 一蘭拉麵" aria-label="Day ${i + 1} 新增行程"><button class="btn sm">新增</button></form>
      </section>`).join('')}`;

    const b = t.plan.budget;
    const { tickets, esim, order, total } = budgetOf(t);
    const pool = poolFor(t);
    const autos = autoTodos(t);
    const doneCount = autos.filter((a) => t.plan.done[a.key]).length + t.plan.todos.filter((x) => x.done).length;
    const todoTotal = autos.length + t.plan.todos.length;
    const fields = [['flight', '機票'], ['hotel', '住宿'], ['transport', '當地交通'], ['food', '餐飲'], ['shopping', '購物'], ['other', '其他']];
    const pct = b.cap ? Math.min(100, (total / b.cap) * 100) : 0;
    $('#plan-side').innerHTML = `
      <div class="card"><div class="row"><h3>預算</h3><span class="spacer"></span><label class="small muted" for="bp">人數</label><input class="input" id="bp" type="number" min="1" max="20" value="${b.people}" data-budget="people" style="width:64px;min-height:32px;padding:4px 8px"></div>
        <div class="grid" style="gap:6px;margin-top:10px">
          ${fields.map(([k, label]) => `<div class="budget-row"><label for="b-${k}">${label}</label><input class="input" id="b-${k}" type="number" min="0" step="100" inputmode="numeric" value="${b[k] || ''}" placeholder="0" data-budget="${k}"></div>`).join('')}
          <div class="budget-row"><span>門票（自動）</span><span class="auto">NT$${fmt(tickets)}</span></div>
          <div class="budget-row"><span>eSIM（自動）</span><span class="auto">${order ? `NT$${fmt(esim)}` : `<button class="btn sm" data-plan="${coverFor([country(t.n).code])}">選方案</button>`}</span></div>
        </div>
        <div class="ticket-sum" style="margin-top:10px"><span>合計${b.people > 1 ? `（每人 NT$${fmt(total / b.people)}）` : ''}</span><b>NT$${fmt(total)}</b></div>
        <div class="budget-row" style="margin-top:8px"><label for="b-cap" class="small muted">預算上限</label><input class="input" id="b-cap" type="number" min="0" step="1000" value="${b.cap || ''}" placeholder="不設定" data-budget="cap"></div>
        ${b.cap ? `<div class="usage" style="margin-top:8px"><div style="width:${pct}%;background:${total > b.cap ? 'var(--danger)' : 'var(--brand-2)'}"></div></div><div class="small muted">${total > b.cap ? `超出 NT$${fmt(total - b.cap)}` : `還剩 NT$${fmt(b.cap - total)}`}</div>` : ''}
      </div>
      ${budgetAdvice(t)}
      <div class="card"><div class="row"><h3>待辦</h3><span class="spacer"></span><span class="small muted">${doneCount}/${todoTotal}</span></div>
        <div style="margin-top:6px">
          ${autos.map((a) => `<label class="todo ${t.plan.done[a.key] ? 'done' : ''}"><input type="checkbox" data-auto="${esc(a.key)}" ${t.plan.done[a.key] ? 'checked' : ''}><span style="flex:1">${esc(a.text)} <span class="auto-tag">自動</span></span>${a.action || ''}</label>`).join('')}
          ${t.plan.todos.map((x) => `<label class="todo ${x.done ? 'done' : ''}"><input type="checkbox" data-todo="${x.id}" ${x.done ? 'checked' : ''}><span style="flex:1">${esc(x.text)}</span><button class="btn sm ghost" data-todo-del="${x.id}" aria-label="刪除">✕</button></label>`).join('')}
        </div>
        <form class="row" id="todo-add" style="margin-top:8px"><input class="input" maxlength="60" placeholder="新增待辦" style="flex:1" aria-label="新增待辦"><button class="btn sm">新增</button></form>
      </div>
      <div class="card"><h3>景點庫</h3><p class="small muted" style="margin:4px 0 8px">拖曳到左邊任一天${pool.some((p) => p.side) ? '，含 400 公里內可順遊的城市' : ''}</p>
        <ul class="pool" id="pool">${pool.map((p, i) => `<li data-pool="${i}"><span style="flex:1">${esc(p.name)}${p.side ? `<span class="small muted">・${esc(p.city)}</span>` : ''}</span><span class="chip ${p.fee === 0 ? 'free' : 'fee'}">${p.fee === 0 ? '免費' : esc(ticketText(p))}</span></li>`).join('') || '<li style="cursor:default">景點都排進去了</li>'}</ul>
      </div>`;

    const resync = () => setTimeout(() => syncFromDom(t, pool), 0);
    $$('#plan-days .items').forEach((ul) => sortables.push(Sortable.create(ul, {
      group: 'plan', handle: '.handle', animation: REDUCED ? 0 : 180, ghostClass: 'drag-ghost', chosenClass: 'drag-chosen', forceFallback: true, fallbackTolerance: 4, onEnd: resync,
    })));
    if ($('#pool [data-pool]')) {
      sortables.push(Sortable.create($('#pool'), {
        group: { name: 'plan', pull: 'clone', put: false }, sort: false, animation: REDUCED ? 0 : 180, ghostClass: 'drag-ghost', forceFallback: true, fallbackTolerance: 4,
        onEnd: (e) => { if (e.to !== e.from) resync(); },
      }));
    }
    $$('#plan-days .photo[data-photo]').forEach((node) => applyPhoto(node, node.dataset.photo));
    animateIn($('[data-view="plan"]'));
  }
  function syncFromDom(t, pool) {
    const all = new Map(t.plan.days.flat().map((it) => [it.id, it]));
    t.plan.days = $$('#plan-days .items').map((ul) => $$(':scope > li', ul).map((li) => {
      if (li.dataset.id && all.has(li.dataset.id)) return all.get(li.dataset.id);
      const p = li.dataset.pool != null ? pool[Number(li.dataset.pool)] : null;
      return p ? newItem(p.side ? `${p.name}（${p.city}）` : p.name, '', { fee: p.fee, cur: p.cur, note: p.note }) : null;
    }).filter(Boolean));
    save();
    renderPlanner();
    renderCover();
  }
  function fillEmptyDays(t) {
    const pool = poolFor(t);
    let filled = 0;
    t.plan.days.forEach((list) => {
      if (list.length || !pool.length) return;
      pool.splice(0, 2).forEach((p, i) => { list.push(newItem(p.side ? `${p.name}（${p.city}）` : p.name, ['10:00', '14:00'][i], { fee: p.fee, cur: p.cur, note: p.note })); });
      filled += 1;
    });
    save(); renderPlanner(); renderCover();
    toast(filled ? `已補上 ${filled} 天，可再拖曳調整` : '景點庫沒有可用的景點了');
  }
  function findItem(t, id) {
    for (let i = 0; i < t.plan.days.length; i += 1) {
      const j = t.plan.days[i].findIndex((it) => it.id === id);
      if (j >= 0) return [i, j];
    }
    return [-1, -1];
  }
  (function initPlannerEvents() {
    const days = $('#plan-days');
    const side = $('#plan-side');
    days.addEventListener('click', (e) => {
      const t = planTrip();
      const btn = e.target.closest('button');
      if (!t || !btn) return;
      if (btn.dataset.toggle) {
        const id = btn.dataset.toggle;
        if (openItems.has(id)) openItems.delete(id); else openItems.add(id);
        renderPlanner();
      } else if (btn.dataset.remove) {
        const [i, j] = findItem(t, btn.dataset.remove);
        if (i >= 0) { t.plan.days[i].splice(j, 1); save(); renderPlanner(); renderCover(); toast('已刪除，景點回到景點庫'); }
      } else if (btn.dataset.fill) fillEmptyDays(t);
    });
    days.addEventListener('change', (e) => {
      const t = planTrip();
      if (!t) return;
      const { time, move } = e.target.dataset;
      if (time) {
        const [i, j] = findItem(t, time);
        const m = e.target.value.trim().match(/^(\d{1,2})[:：.]?(\d{2})?$/);
        const value = m && Number(m[1]) < 24 && Number(m[2] || 0) < 60 ? `${pad(Number(m[1]))}:${m[2] || '00'}` : '';
        e.target.value = value;
        if (i >= 0) { t.plan.days[i][j].time = value; save(); }
      }
      if (move) {
        const [i, j] = findItem(t, move);
        const to = Number(e.target.value);
        if (i >= 0 && to !== i) { const [it] = t.plan.days[i].splice(j, 1); t.plan.days[to].push(it); save(); renderPlanner(); renderCover(); toast(`已移到 Day ${to + 1}`); }
      }
    });
    days.addEventListener('input', (e) => {
      const t = planTrip();
      const id = e.target.dataset.note;
      if (!t || !id) return;
      const [i, j] = findItem(t, id);
      if (i < 0) return;
      const it = t.plan.days[i][j];
      if (it.kind === 'spot' && it.fee != null) it.memo = e.target.value; else it.note = e.target.value;
      clearTimeout(days.saveTimer);
      days.saveTimer = setTimeout(save, 400);
    });
    days.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = planTrip();
      const form = e.target.closest('[data-add]');
      const input = form?.querySelector('input');
      if (!t || !input.value.trim()) return;
      const text = input.value.trim();
      const kind = /餐|吃|拉麵|咖啡|早午|晚|午/.test(text) ? 'food' : 'custom';
      t.plan.days[Number(form.dataset.add)].push(newItem(text, '', { kind }));
      save(); renderPlanner(); renderCover();
    });
    side.addEventListener('change', (e) => {
      const t = planTrip();
      if (!t) return;
      const { budget, auto, todo } = e.target.dataset;
      if (budget) {
        t.plan.budget[budget] = budget === 'people' ? Math.max(1, Number(e.target.value) || 1) : Math.max(0, Number(e.target.value) || 0);
        save(); renderPlanner();
      } else if (auto) { t.plan.done[auto] = e.target.checked; save(); renderPlanner(); } else if (todo) {
        const x = t.plan.todos.find((y) => y.id === todo);
        if (x) { x.done = e.target.checked; save(); renderPlanner(); }
      }
    });
    side.addEventListener('click', (e) => {
      const t = planTrip();
      if (t && e.target.closest('[data-bfill]')) { fillBudget(t); return; }
      if (t && e.target.closest('[data-badjust]')) { adjustToBudget(t); return; }
      const del = e.target.closest('[data-todo-del]');
      if (!t || !del) return;
      e.preventDefault();
      t.plan.todos = t.plan.todos.filter((x) => x.id !== del.dataset.todoDel);
      save(); renderPlanner();
    });
    side.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = planTrip();
      const input = e.target.querySelector('input');
      if (!t || !input.value.trim()) return;
      t.plan.todos.push({ id: `td-${uid()}`, text: input.value.trim(), done: false });
      save(); renderPlanner();
    });
  }());

  // ---------- country sheet: famous food, culture, souvenirs and tips
  function openCountry(n) {
    const c = country(n);
    const { code } = c;
    const cul = CULTURE[code];
    const visits = sortTrips(trips.filter((t) => t.n === n));
    const dests = DESTS.filter((d) => COUNTRIES[d.c]?.n === n);
    const hero = dests[0] ? destPhoto(dests[0].id) : null;
    const { name } = c;
    const plan = code ? packFor(code) : 'GLOBAL';
    const fly = flightInfo(code);
    if (!SIGHTS) {
      loadSights().then(() => {
        const sec = $('#country-sights');
        if (!sec) return;
        sec.hidden = !sightsOf(code).length;
        sec.querySelector('.gallery').innerHTML = sightCards(code);
        hydrateSights(code);
      });
    } else {
      setTimeout(() => hydrateSights(code), 0);
    }
    openModal(`${flag(code)} ${esc(name)}`, `
      <div class="country-hero ${hero ? '' : 'ph-missing'}">${imgHtml(hero, name)}<div class="country-hero-text"><span class="kicker">${flag(code)} ${esc(REGIONS[c.region] || '世界')}</span><h2 class="serif">${esc(name)}</h2>${c.cur ? `<span class="small">貨幣 ${esc(c.cur)}・插座 ${esc(c.plug)}</span>` : ''}</div>${creditHtml(hero)}</div>
      ${fly ? `<div class="fly-row">${icon('flight')}<div class="grow"><b>從${esc(home().name)}${fly.text}</b><small class="muted">${fly.direct ? '直飛' : '需要轉機，含約 2.5 小時轉機時間'}・距離約 ${fmt(fly.km)} 公里・概估</small></div></div>` : ''}
      <section id="country-sights" ${SIGHTS && !sightsOf(code).length ? 'hidden' : ''}><h3>必去景點</h3><div class="gallery">${sightCards(code)}</div></section>
      ${cul ? `<section><h3>必吃美食</h3><div class="gallery">${cul.food.map(([zh]) => photoCard(culturePhoto(code, zh), zh, `<a class="small" href="${gmaps(`${zh} ${name}`)}" target="_blank" rel="noopener">找附近的店 ↗</a>`)).join('')}</div></section>
      <section><h3>必體驗文化</h3><div class="gallery">${cul.culture.map(([zh]) => photoCard(culturePhoto(code, zh), zh, `<a class="small" href="${gsearch(`${zh} ${name} 體驗`)}" target="_blank" rel="noopener">怎麼體驗 ↗</a>`)).join('')}</div></section>
      <section><h3>伴手禮</h3><div class="row">${cul.buy.map((b) => `<span class="chip lg">${esc(b)}</span>`).join('')}</div></section>
      <div class="banner info"><b>小提醒</b><br>${[...cul.tips, c.note].filter(Boolean).map(esc).join('<br>')}</div>`
    : `<p class="muted" style="margin:0">這個國家還沒有整理在地資料。</p><div class="row"><a class="btn" href="https://en.wikipedia.org/wiki/${encodeURIComponent(name)}" target="_blank" rel="noopener">認識這個國家 ↗</a><a class="btn" href="${gsearch(`${name} 必吃 必玩`)}" target="_blank" rel="noopener">必吃必玩 ↗</a></div>`}
      ${dests.length ? `<section><h3>推薦城市</h3><div class="gallery">${dests.map((d) => `<button class="ph-card city" data-dest="${d.id}"><div class="ph ${destPhoto(d.id) ? '' : 'ph-missing'}">${imgHtml(destPhoto(d.id), d.name)}</div><figcaption><b>${esc(d.name)}</b><small class="muted">${esc(d.blurb)}</small></figcaption></button>`).join('')}</div></section>` : ''}
      ${visits.length ? `<section><h3>你去過 ${visits.length} 次</h3><ul class="timeline" style="margin-top:8px">${visits.map((t) => `<li data-trip="${t.id}"><span class="flag">${icon(isUpcoming(t) ? 'calendar' : 'pin')}</span><div><b>${esc(t.city)}</b><div class="small muted">${t.start} – ${t.end}・${t.tags.map((k) => el(k).label).join('・')}</div></div></li>`).join('')}</ul></section>` : ''}
      <div class="actions two">
        <button class="btn primary" data-plan="${plan}" ${code && plan !== code ? `data-for="${code}"` : ''}>${esc(name)} eSIM</button>
        ${c.site ? `<a class="btn" href="${c.site}" target="_blank" rel="noopener">官方觀光網 ↗</a>` : `<a class="btn" href="${gmaps(`${name} 景點`)}" target="_blank" rel="noopener">Google 地圖 ↗</a>`}
        <button class="btn" data-trip-new="${n}">＋ 記錄一趟</button>
        ${dests[0] ? `<button class="btn" data-dest="${dests[0].id}">附近推薦</button>` : `<a class="btn" href="${gmaps(`${name} 景點`)}" target="_blank" rel="noopener">景點地圖 ↗</a>`}
      </div>`, { sheet: 'tall' });
  }

  // ---------- tap a country on the map: fly there, pop its famous sights out as photo pins, and a card
  let picked = null;
  function renderMapCountry() {
    const box = $('#map-country');
    if (!picked) { box.classList.remove('show'); worldMap?.setInset(0); return; }
    const c = country(picked);
    const f = flightInfo(c.code);
    const list = sightsOf(c.code);
    const plan = packFor(c.code);
    box.innerHTML = `<div class="mc-head">${flag(c.code)}<div class="grow"><b>${esc(c.name)}</b><small>${f ? f.text : esc(REGIONS[c.region] || '')}${list.length ? `・${list.length} 個必去景點` : ''}</small></div><button class="mc-close" data-mc-close aria-label="關閉">✕</button></div>
      ${list.length ? `<div class="mc-strip">${list.map((x, i) => `<button class="mc-sight" data-sight="${c.code}:${i}" style="--d:${i * 70}ms">${sightImg(x, 330)}<span>${esc(x.n)}</span></button>`).join('')}</div>`
    : `<p class="mc-empty">這裡的景點還在整理，<a href="${gmaps(`${c.name} 景點`)}" target="_blank" rel="noopener">在 Google 地圖找 ↗</a></p>`}
      <div class="mc-actions"><button class="btn sm primary" data-country-n="${picked}">美食・文化・城市</button><button class="btn sm" data-plan="${plan}" ${plan !== c.code ? `data-for="${c.code}"` : ''}>${esc(c.name)} eSIM</button></div>`;
    box.classList.remove('show');
    box.getBoundingClientRect(); // restart the entrance animation
    box.classList.add('show');
    // Floating over the map (computers, full screen): lift the globe above it. Under the map (phones): bring it into view.
    const floating = getComputedStyle(box).position === 'absolute';
    worldMap?.setInset(floating ? box.offsetHeight + 16 : 0);
    if (!floating) setTimeout(() => box.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'nearest' }), 250);
  }
  async function selectCountry(n, keepView) {
    const c = country(n);
    if (!c.code) { openCountry(n); return; }
    picked = n;
    store.set('tipSeen', true);
    $('#map-tip').classList.remove('show');
    await loadSights();
    if (picked !== n) return;
    const pins = () => sightsOf(c.code).map((x, i) => ({
      i, name: x.n, lng: x.lng, lat: x.lat, photo: x.img ? thumbAt(x.img.src, 250) : null,
    })).filter((x) => x.lat != null);
    renderMapCountry();
    worldMap?.showSights({ id: n, code: c.code, list: pins() });
    const g = GEO[c.code];
    if (g && worldMap && !keepView) worldMap.focusArea(g.lng, g.lat, g.area);
    // Once every position is known, fit them all in view (unless the visitor asked for one sight).
    const fit = () => { const ps = pins(); if (!keepView && ps.length > 1) worldMap?.fitPoints(ps.map((x) => [x.lng, x.lat])); };
    if (pins().length === sightsOf(c.code).length) setTimeout(fit, REDUCED ? 0 : 1100);
    hydrateSights(c.code).then(() => {
      if (picked !== n) return;
      const before = pins().length;
      worldMap?.showSights({ id: n, code: c.code, list: pins() });
      if (before && !keepView) fit();
    });
  }
  function closeMapCountry() {
    picked = null;
    worldMap?.showSights(null);
    renderMapCountry();
  }
  async function openSight(code, i) {
    const x = sightsOf(code)[i];
    if (!x) return;
    await Promise.race([fillSight(x), new Promise((resolve) => { setTimeout(resolve, 1500); })]);
    const n = COUNTRIES[code]?.n || GEO[code]?.n;
    const f = flightInfo(code);
    worldMap?.setActiveSight(i);
    const more = sightCards(code, i);
    setTimeout(() => hydrateSights(code), 0);
    openModal(`${flag(code)} ${esc(x.n)}`, `
      <div class="sight-hero ph ${x.img ? '' : 'ph-missing'}">${sightImg(x, 960)}</div>
      <div class="sight-text"><span class="kicker plain muted">${flag(code)} ${esc(countryName(code))}${f ? `・${f.text}` : ''}</span><h2 class="serif">${esc(x.n)}</h2><p>${esc(x.b)}</p>${sightCredit(x)}</div>
      <div class="actions two">
        ${x.lat != null ? `<button class="btn primary" data-sight-map="${code}:${i}">在 3D 地圖上看</button>` : ''}
        <a class="btn" href="${gmaps(x.t)}" target="_blank" rel="noopener">Google 地圖 ↗</a>
        <a class="btn" href="https://en.wikipedia.org/wiki/${encodeURIComponent(x.t.replace(/ /g, '_'))}" target="_blank" rel="noopener">維基百科 ↗</a>
        ${n && !String(n).startsWith('x') ? `<button class="btn" data-trip-new="${n}">＋ 記錄一趟</button>` : ''}
        ${trips.some((t) => country(t.n).code === code) ? `<button class="btn" data-ci-sight="${code}:${i}">在這裡打卡</button>` : ''}
      </div>
      ${more ? `<section><h3>${esc(countryName(code))}也推薦</h3><div class="gallery">${more}</div></section>` : ''}`);
  }
  // ---------- search the map: countries (by Chinese or English name, or code) and sights
  function mapSearch(q) {
    const text = q.trim().toLowerCase();
    if (!text) return [];
    const has = (v) => String(v || '').toLowerCase().includes(text);
    const countries = [...ALL_CODES, 'TW'].filter((code) => has(countryName(code)) || code.toLowerCase() === text || has(new Intl.DisplayNames(['en'], { type: 'region' }).of(code)))
      .slice(0, 6).map((code) => ({ type: 'country', code }));
    const sights = Object.entries(SIGHTS || {}).flatMap(([code, list]) => list.map((x, i) => ({ type: 'sight', code, i, x })))
      .filter(({ code, x }) => has(x.n) || has(x.t) || has(x.b) || has(countryName(code))).slice(0, 12);
    return [...countries, ...sights];
  }
  function renderMapSearch() {
    const results = mapSearch($('#map-q').value);
    const q = $('#map-q').value.trim();
    $('#map-q-list').innerHTML = results.map((r, k) => {
      if (r.type === 'country') {
        const f = flightInfo(r.code);
        return `<button class="ms-item" role="option" data-ms-country="${r.code}" style="--d:${k * 30}ms">${flag(r.code)}<span class="grow"><b>${esc(countryName(r.code))}</b><small>${sightsOf(r.code).length} 個必去景點${f ? `・${f.text}` : ''}</small></span></button>`;
      }
      return `<button class="ms-item" role="option" data-ms-sight="${r.code}:${r.i}" style="--d:${k * 30}ms"><span class="ms-thumb">${r.x.img ? `<img src="${esc(thumbAt(r.x.img.src, 120))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span><span class="grow"><b>${esc(r.x.n)}</b><small>${esc(countryName(r.code))}・${esc(r.x.b)}</small></span></button>`;
    }).join('') || (q ? `<p class="ms-empty">找不到「${esc(q)}」，試試國家名稱或英文。</p>` : '');
  }
  function openMapSearch(on) {
    $('#map-search').hidden = !on;
    $('#map-find').setAttribute('aria-expanded', String(on));
    if (on) {
      loadSights().then(renderMapSearch);
      setTimeout(() => $('#map-q').focus(), 30);
    }
  }
  $('#map-find').addEventListener('click', () => openMapSearch($('#map-search').hidden));
  $('#map-q-close').addEventListener('click', () => openMapSearch(false));
  $('#map-q').addEventListener('input', renderMapSearch);
  $('#map-q').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); openMapSearch(false); }
    if (e.key === 'Enter') { e.preventDefault(); $('#map-q-list .ms-item')?.click(); }
  });
  $('#map-q-list').addEventListener('click', (e) => {
    const b = e.target.closest('.ms-item');
    if (!b) return;
    openMapSearch(false);
    if (b.dataset.msCountry) {
      const code = b.dataset.msCountry;
      const n = COUNTRIES[code]?.n || GEO[code]?.n;
      if (n && !String(n).startsWith('x')) selectCountry(n); else openCountry(n);
      return;
    }
    const [code, i] = b.dataset.msSight.split(':');
    showSightOnMap(code, Number(i));
  });

  async function showSightOnMap(code, i) {
    const n = COUNTRIES[code]?.n || GEO[code]?.n;
    const x = sightsOf(code)[i];
    if ($('#modal').open) $('#modal').close();
    go('map');
    await new Promise((resolve) => { setTimeout(resolve, REDUCED ? 80 : 420); });
    $('.map-card').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
    await selectCountry(n, true);
    worldMap?.setActiveSight(i);
    if (x?.lat != null) worldMap?.focus(x.lng, x.lat, 7);
  }

  // Tickets for a trip: every paid sight in the itinerary with its price and where to book, then the free ones.
  function openTickets(id) {
    const t = trips.find((x) => x.id === id);
    if (!t) return;
    const plan = ensurePlan(t);
    const rows = plan.days.flatMap((list, day) => list.filter((it) => it.fee != null).map((it) => ({ it, day })));
    const paid = rows.filter(({ it }) => it.fee > 0);
    const free = rows.filter(({ it }) => it.fee === 0);
    const twd = (it) => Math.round(it.fee * (RATES[it.cur] || 0));
    const people = plan.budget?.people || 1;
    openModal(`${flag(country(t.n).code)} ${esc(t.city)} 門票`, `
      <p class="muted" style="margin:0">${paid.length} 個要買票・${free.length} 個免費・每人約 <b>NT$${fmt(sum(paid, ({ it }) => twd(it)))}</b>${people > 1 ? `，${people} 人約 NT$${fmt(sum(paid, ({ it }) => twd(it)) * people)}` : ''}</p>
      ${paid.length ? `<ul class="ticket-list">${paid.map(({ it, day }) => `<li><div class="grow"><b>${esc(it.name)}</b><small class="muted">Day ${day + 1}・${ticketText({ fee: it.fee, cur: it.cur, note: it.note })}${it.note ? `・${esc(it.note)}` : ''}</small></div>
        <span class="ticket-price">≈ NT$${fmt(twd(it))}</span><a class="link-btn" href="${gsearch(`${it.name} 門票 預約`)}" target="_blank" rel="noopener">訂票 ↗</a></li>`).join('')}</ul>` : '<p class="muted">這趟的行程裡還沒有要買票的景點。</p>'}
      ${free.length ? `<section><h3>免費景點</h3><div class="row">${free.map(({ it }) => `<a class="chip free" href="${gmaps(`${it.name} ${t.city}`)}" target="_blank" rel="noopener">${esc(it.name)} ↗</a>`).join('')}</div></section>` : ''}
      <p class="small muted" style="margin:0">價格是成人票概估，依官網與日期為準。</p>
      <div class="actions two"><button class="btn primary" data-open-plan="${t.id}">在行程表調整</button><button class="btn" data-edit="${t.id}">修改日期</button></div>`);
  }

  function openDest(id) {
    const d = DEST[id];
    if (!d) return;
    const ph = destPhoto(d.id);
    const c = COUNTRIES[d.c];
    const f = flightInfo(d.c);
    const fly = f && f.direct && settings.home === 'TPE' ? `台北直飛約 ${d.hours} 小時` : f?.text || '';
    openModal(`${flag(d.c)} ${esc(d.name)}`, `
      <div class="country-hero ${ph ? '' : 'ph-missing'}">${imgHtml(ph, d.name)}<div class="country-hero-text"><span class="kicker">${flag(d.c)} ${esc(c.name)}${fly ? `・${fly}` : ''}</span><h2 class="serif">${esc(d.name)}</h2><span class="small">${esc(d.blurb)}</span></div>${creditHtml(ph)}</div>
      <div class="row">${d.tags.map((k) => tagChip(k)).join('')}</div>
      ${spotsHtml(d)}
      <div class="actions two">
        <button class="btn primary" data-ai="${d.id}">幫我排行程</button>
        <button class="btn" data-country-n="${c.n}">${esc(c.name)}美食與文化</button>
        <button class="btn" data-trip-dest="${d.id}">＋ 記錄一趟</button>
        <button class="btn" data-plan="${packFor(d.c)}" ${packFor(d.c) !== d.c ? `data-for="${d.c}"` : ''}>${esc(c.name)} eSIM</button>
      </div>`, { sheet: 'tall' });
  }

  // ---------- 隨機出國
  const BUDGETS = [[15000, '1.5 萬'], [30000, '3 萬'], [50000, '5 萬'], [80000, '8 萬'], [0, '不限']];
  const rnd = { budget: 30000, days: 5, month: ((new Date().getMonth() + 1) % 12) + 1, tags: [], fresh: false, result: null };
  function randomCandidates() {
    const visited = new Set(trips.filter((t) => !isUpcoming(t)).map((t) => t.dest));
    return DESTS.filter((d) => (!rnd.budget || tripCost(d, rnd.days).total <= rnd.budget)
      && (!rnd.tags.length || rnd.tags.some((k) => d.tags.includes(k)))
      && (!rnd.fresh || !visited.has(d.id)));
  }
  function openRandom() {
    openModal('隨機出國', '<div id="rnd"></div>', { sheet: 'tall' });
    renderRandom();
  }
  function randomResult(d) {
    const cost = tripCost(d, rnd.days);
    const cul = CULTURE[d.c];
    const ph = destPhoto(d.id);
    return `<div class="rnd-result">
      <div class="country-hero ${ph ? '' : 'ph-missing'}">${imgHtml(ph, d.name)}<div class="country-hero-text"><span class="kicker">${flag(d.c)} ${esc(COUNTRIES[d.c].name)}・台北直飛約 ${d.hours} 小時</span><h2 class="serif">${esc(d.name)}</h2><span class="small">${esc(d.blurb)}</span></div>${creditHtml(ph)}</div>
      <div class="row">${d.months.includes(rnd.month) ? `<span class="chip free">${rnd.month} 月正是好季節</span>` : `<span class="chip">${rnd.month} 月非旺季，人少比較便宜</span>`}${d.tags.slice(0, 3).map((k) => `${tagChip(k)}`).join('')}</div>
      <div><b class="small">${rnd.days} 天每人概估</b>${costRows(cost)}</div>
      ${cul ? `<div class="small"><b>必吃：</b>${cul.food.map(([x]) => esc(x)).join('、')}<br><b>必體驗：</b>${cul.culture.map(([x]) => esc(x)).join('、')}</div>` : ''}
      <div class="actions two"><button class="btn primary" data-trip-dest="${d.id}">＋ 排進我的行程</button><button class="btn" data-ai="${d.id}">建議行程</button><button class="btn" data-country-code="${d.c}">看在地文化</button><button class="btn" data-plan="${d.c}">${esc(COUNTRIES[d.c].name)} eSIM</button></div>
      <p class="notice">機票、住宿與門票都是概估，實際價格依日期與訂購管道而定。</p></div>`;
  }
  function renderRandom() {
    const list = randomCandidates();
    const result = rnd.result && DEST[rnd.result];
    $('#rnd').innerHTML = `
      <div class="field"><label>每人總預算（含機票）</label><div class="row">${BUDGETS.map(([v, l]) => `<button class="chip lg ${rnd.budget === v ? 'on' : ''}" data-rbudget="${v}">${l}</button>`).join('')}</div></div>
      <div class="row"><div class="field"><label>天數</label><span class="stepper"><button data-rdays="-1" aria-label="少一天">－</button><b>${rnd.days} 天</b><button data-rdays="1" aria-label="多一天">＋</button></span></div>
        <div class="field"><label for="rnd-month">出發月份</label><select class="input" id="rnd-month" style="width:auto">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${rnd.month === i + 1 ? 'selected' : ''}>${i + 1} 月</option>`).join('')}</select></div>
        <label class="row small" style="margin-top:20px"><input type="checkbox" id="rnd-fresh" ${rnd.fresh ? 'checked' : ''}> 只去沒去過的</label></div>
      <div class="field"><label>想要的元素（可不選）</label><div class="row">${Object.entries(ELEMENTS).slice(0, 8).map(([k, v]) => `<button class="chip el ${rnd.tags.includes(k) ? 'on' : ''}" data-rtag="${k}">${elArt(k)}${v.label}</button>`).join('')}</div></div>
      <div class="slot" id="slot">${result ? randomResult(result) : `<div class="slot-empty"><div class="slot-deck" aria-hidden="true">${list.slice().sort(() => Math.random() - 0.5).slice(0, 3).map((d) => `<span>${imgHtml(destPhoto(d.id), '')}</span>`).join('')}</div><b>從 ${list.length} 個符合條件的地點抽一個</b><small class="muted">改上面的預算、天數或月份，範圍會跟著變</small></div>`}</div>
      <div class="sheet-bar"><span class="small muted">${list.length ? `${list.length} 個地點符合` : '沒有符合的地點，放寬預算或天數試試'}</span><span class="spacer"></span><button class="btn primary" data-rspin ${list.length ? '' : 'disabled'}>${result ? '再抽一次' : '抽一個'}</button></div>`;
    $('#rnd-month').addEventListener('change', (e) => { rnd.month = Number(e.target.value); renderRandom(); });
    $('#rnd-fresh').addEventListener('change', (e) => { rnd.fresh = e.target.checked; rnd.result = null; renderRandom(); });
  }
  function spin() {
    const list = randomCandidates();
    if (!list.length) return;
    const pref = elementPrefs();
    const weights = list.map((d) => 1 + (d.months.includes(rnd.month) ? 2 : 0) + d.tags.reduce((s, k) => s + (pref[k] || 0), 0) / d.tags.length);
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
    const pick = list.find((d, i) => { roll -= weights[i]; return roll <= 0; }) || list[0];
    const done = () => { rnd.result = pick.id; renderRandom(); $('#rnd .rnd-result')?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'nearest' }); };
    if (REDUCED || list.length === 1) { done(); return; }
    const slot = $('#slot');
    const btn = $('[data-rspin]');
    btn.disabled = true;
    const frames = Array.from({ length: 16 }, () => list[Math.floor(Math.random() * list.length)]);
    let i = 0;
    const step = () => {
      const d = frames[i];
      slot.innerHTML = `<div class="slot-frame"><div class="ph ${destPhoto(d.id) ? '' : 'ph-missing'}">${imgHtml(destPhoto(d.id), d.name)}</div><b>${flag(d.c)} ${esc(d.name)}</b></div>`;
      i += 1;
      if (i < frames.length) setTimeout(step, 50 + i * i * 1.6); else setTimeout(done, 380);
    };
    step();
  }
  function randomClick(e) {
    const b = e.target.closest('button');
    if (!b || !b.closest('#rnd')) return false;
    const ds = b.dataset;
    if (ds.rbudget) { rnd.budget = Number(ds.rbudget); rnd.result = null; } else if (ds.rdays) { rnd.days = Math.max(2, Math.min(21, rnd.days + Number(ds.rdays))); rnd.result = null; } else if (ds.rtag) { rnd.tags = rnd.tags.includes(ds.rtag) ? rnd.tags.filter((x) => x !== ds.rtag) : [...rnd.tags, ds.rtag]; rnd.result = null; } else if ('rspin' in ds) { spin(); return true; } else return false;
    renderRandom();
    return true;
  }

  // ---------- 預算回推 (planner): estimate the trip, then fit the plan to the budget cap
  function budgetAdvice(t) {
    const d = t.dest && DEST[t.dest];
    if (!d) return '<div class="card"><h3>預算回推</h3><p class="small muted" style="margin:6px 0 0">自訂城市沒有價格資料，無法概估。</p></div>';
    const b = t.plan.budget;
    const people = b.people || 1;
    const days = t.plan.days.length;
    const est = tripCost(d, days, people);
    const planned = sum(t.plan.days.flat(), toTwd) * people;
    let advice = '<p class="small muted" style="margin:8px 0 0">在上面設定「預算上限」，就能回推每天可以花多少、該排哪些景點。</p>';
    if (b.cap) {
      const perDay = (b.cap - est.flight - est.esim - planned) / (days * people);
      let tier;
      let tip;
      if (perDay < est.day * 0.7) {
        const maxDays = Math.max(1, Math.floor((b.cap - est.flight - est.esim) / (est.day * 0.7 * people)));
        tier = '省錢模式';
        tip = perDay > 0 ? `每人每天只剩 NT$${fmt(perDay)}：住青旅或商務旅館、吃在地小吃、優先排免費景點。${maxDays < days ? `或把行程縮短到 ${maxDays} 天比較寬裕。` : ''}` : `預算不夠支付機票與 eSIM，建議提高預算或換成較近的目的地（例如 ${DESTS.filter((x) => x.hours <= 3 && x.c !== d.c).slice(0, 2).map((x) => x.name).join('、')}）。`;
      } else if (perDay < est.day * 1.3) {
        tier = '舒適模式';
        tip = `每人每天約 NT$${fmt(perDay)}：三星飯店、每天一個付費景點剛好。`;
      } else {
        tier = '享受模式';
        const paid = poolFor(t).filter((s) => s.fee > 0).slice(0, 2).map((s) => s.name);
        tip = `每人每天約 NT$${fmt(perDay)}：可以升級住宿${paid.length ? `，或加排 ${paid.join('、')}` : ''}。`;
      }
      advice = `<div class="banner ${perDay < est.day * 0.7 ? 'warn' : 'good'}" style="margin-top:8px"><b>${tier}</b><br>${esc(tip)}</div>
        <button class="btn block" data-badjust style="margin-top:8px">依預算自動調整景點</button>`;
    }
    return `<div class="card"><h3>預算回推</h3><p class="small muted" style="margin:4px 0 0">${esc(d.name)} ${days} 天・${people} 人的概估</p>
      ${costRows({ ...est, tickets: planned, total: est.flight + est.stay + planned + est.esim })}
      <button class="btn sm" data-bfill>把概估帶入預算表</button>${advice}</div>`;
  }
  function fillBudget(t) {
    const d = DEST[t.dest];
    if (!d) return;
    const b = t.plan.budget;
    const est = tripCost(d, t.plan.days.length, b.people || 1);
    if (!b.flight) b.flight = est.flight;
    const round100 = (v) => Math.round(v / 100) * 100;
    if (!b.hotel) b.hotel = round100(est.stay * 0.55);
    if (!b.food) b.food = round100(est.stay * 0.3);
    if (!b.transport) b.transport = round100(est.stay * 0.15);
    save(); renderPlanner(); toast('已帶入概估，可以再自己修改');
  }
  function adjustToBudget(t) {
    const d = DEST[t.dest];
    const b = t.plan.budget;
    if (!d || !b.cap) return;
    const people = b.people || 1;
    const est = tripCost(d, t.plan.days.length, people);
    const room = b.cap - est.flight - est.esim - est.day * 0.7 * t.plan.days.length * people;
    let spend = sum(t.plan.days.flat(), toTwd) * people;
    const removed = [];
    const added = [];
    if (spend > room) {
      const paid = t.plan.days.flatMap((list, i) => list.filter((it) => it.fee > 0).map((it) => ({ it, i }))).sort((a, c) => toTwd(c.it) - toTwd(a.it));
      const free = poolFor(t).filter((s) => s.fee === 0);
      paid.forEach(({ it, i }) => {
        if (spend <= room) return;
        t.plan.days[i] = t.plan.days[i].filter((x) => x.id !== it.id);
        spend -= toTwd(it) * people;
        removed.push(it.name);
        const swap = free.shift();
        if (swap) t.plan.days[i].push(newItem(swap.side ? `${swap.name}（${swap.city}）` : swap.name, it.time, { fee: 0, cur: swap.cur, note: swap.note }));
      });
    } else {
      poolFor(t).filter((s) => s.fee > 0).sort((a, c) => toTwd(c) - toTwd(a)).forEach((s) => {
        if (added.length >= 3 || spend + toTwd(s) * people > room) return;
        const day = t.plan.days.reduce((best, list, i) => (list.length < t.plan.days[best].length ? i : best), 0);
        t.plan.days[day].push(newItem(s.side ? `${s.name}（${s.city}）` : s.name, '', { fee: s.fee, cur: s.cur, note: s.note }));
        spend += toTwd(s) * people;
        added.push(s.name);
      });
    }
    save(); renderPlanner(); renderCover();
    if (removed.length) toast(`超出預算：拿掉 ${removed.join('、')}，換成免費景點`);
    else if (added.length) toast(`預算還有空間：加排 ${added.join('、')}`);
    else toast('目前的景點剛好在預算內');
  }

  // ---------- 回憶紀念冊
  function albumKey(tripId) { return `album:${tripId}`; }
  function albumPhotos(tripId) {
    const lib = tripPhotos(tripId).filter((p) => p.full || p.thumb).map((p) => ({ id: p.id, src: libSrc(p, 'full'), lib: true })); // eslint-disable-line no-use-before-define
    return [...store.get(albumKey(tripId), []), ...lib];
  }
  // An album is built from data, so a shared link can show it on someone else's phone.
  function albumData(year) {
    const s = stats(year);
    return {
      year,
      name: user?.name || '旅人',
      own: true,
      trips: s.past.map((t) => ({ id: t.id, dest: t.dest, city: t.city, n: t.n, start: t.start, end: t.end, tags: t.tags, gb: t.gb, memo: t.memo || '' })),
      countries: s.countries.size,
      cities: s.cities.size,
      days: s.days,
      km: s.km,
      gb: s.gb,
      type: travelerType(s),
      badges: BADGES.filter((x) => { const [v, g] = x.progress(s); return v >= g; }).map((x) => x.name),
    };
  }
  const b64url = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64url = (code) => JSON.parse(decodeURIComponent(escape(atob(code.replace(/-/g, '+').replace(/_/g, '/')))));
  function albumLink(a) {
    const data = {
      y: a.year, f: a.name, k: Math.round(a.km), b: a.badges, p: a.type,
      t: a.trips.slice(0, 24).map((t) => [t.dest || '', t.city, t.n, t.start, t.end, t.tags.slice(0, 4).join(','), (t.memo || '').slice(0, 140)]),
    };
    return `${window.location.origin}${window.location.pathname}#album=${b64url(data)}`;
  }
  function readSharedAlbum() {
    const m = window.location.hash.match(/^#album=([\w-]+)/);
    if (!m) return null;
    try {
      const d = fromB64url(m[1]);
      const list = (d.t || []).map(([dest, city, n, start, end, tags, memo], i) => ({
        id: `shared-${i}`, dest: DEST[dest] ? dest : '', city: String(city).slice(0, 30), n: String(n), start, end, tags: String(tags || '').split(',').filter((k) => ELEMENTS[k]), gb: '', memo: String(memo || '').slice(0, 140),
      })).filter((t) => /^\d{4}-\d\d-\d\d$/.test(t.start) && /^\d{4}-\d\d-\d\d$/.test(t.end));
      return {
        year: Number(d.y) || new Date().getFullYear(),
        name: String(d.f || '旅人').slice(0, 20),
        own: false,
        trips: list,
        countries: new Set(list.map((t) => t.n)).size,
        cities: new Set(list.map((t) => t.city)).size,
        days: sum(list, (t) => daysBetween(t.start, t.end)),
        km: Number(d.k) || 0,
        gb: 0,
        type: String(d.p || '').slice(0, 40),
        badges: (Array.isArray(d.b) ? d.b : []).map(String).slice(0, 8),
      };
    } catch { return null; }
  }

  const ownSection = (t, mine) => `<div class="album-grid mine">${mine.map((m) => `<figure class="album-photo"><img src="${m.src}" alt="我的照片"><button class="icon-btn" data-album-del="${t.id}:${m.id}" aria-label="刪除照片">✕</button></figure>`).join('')}
      <label class="album-add"><input type="file" accept="image/*" multiple hidden data-album-add="${t.id}"><span>＋</span>加入我的照片</label></div>
    <textarea class="input journal" rows="3" data-memo="${t.id}" placeholder="寫下這趟最難忘的一刻…">${esc(t.memo || '')}</textarea>`;
  const memoText = (t) => (t.memo ? `<p class="journal-text serif">${esc(t.memo)}</p>` : '');
  function albumPages(a) {
    const coverPhotos = a.trips.map((t) => destPhoto(t.dest)).filter(Boolean).slice(0, 4);
    const flags = [...new Set(a.trips.map((t) => flag(country(t.n).code)))].join(' ');
    return [`<section class="album-page album-cover">
        <div class="collage n${coverPhotos.length}">${coverPhotos.map((p) => `<div class="album-photo">${imgHtml(p, '')}</div>`).join('')}</div>
        <div class="album-cover-text"><span class="kicker plain">旅行紀念冊</span><h2 class="serif">${a.year}</h2><p>${esc(a.name)} 的旅行紀念冊</p>
        <p class="small">${a.countries} 個國家・${a.cities} 座城市・${a.days} 天${a.km ? `・${fmt(a.km)} 公里` : ''}</p><div class="flags">${flags}</div></div></section>`,
    ...a.trips.map((t, i) => {
      const p = destPhoto(t.dest);
      const d = DEST[t.dest];
      const mine = a.own ? albumPhotos(t.id) : [];
      const spotsShown = d ? d.spots.map((x) => ({ x, ph: spotPhoto(d.id, x.name) })).filter((x) => x.ph).slice(0, 2) : [];
      return `<section class="album-page">
        <div class="album-hero album-photo ${p ? '' : 'ph-missing'}">${imgHtml(p, t.city)}<span class="album-no">No. ${pad(i + 1)}</span></div>
        <div class="album-body">
          <span class="kicker plain muted">${flag(country(t.n).code)} ${esc(country(t.n).name)}・${t.start.replace(/-/g, '.')} – ${t.end.slice(5).replace('-', '.')}</span>
          <h2 class="serif">${esc(t.city)}</h2>
          <div class="row">${t.tags.map((k) => tagChip(k)).join('')}${Number(t.gb) ? `<span class="chip">${t.gb} GB</span>` : ''}</div>
          ${spotsShown.length ? `<div class="album-grid">${spotsShown.map(({ x, ph }) => `<figure class="album-photo">${imgHtml(ph, x.name)}<figcaption>${esc(x.name)}</figcaption></figure>`).join('')}</div>` : ''}
          ${a.own ? ownSection(t, mine) : memoText(t)}
        </div></section>`;
    }),
    `<section class="album-page album-end"><span class="kicker plain muted">年度總結</span><h2 class="serif">${a.year}</h2>
      <div class="grid stats" style="grid-template-columns:repeat(2,1fr)"><div class="stat"><b>${a.countries}</b><span>國家</span></div><div class="stat"><b>${a.days}</b><span>天</span></div><div class="stat"><b>${fmt(a.km)}</b><span>公里</span></div><div class="stat"><b>${a.cities}</b><span>城市</span></div></div>
      ${a.type ? `<p>${esc(a.type)}</p>` : ''}<div class="badges">${a.badges.map((n) => `<div class="badge">${medalByName(n)}<span>${esc(n)}</span></div>`).join('') || '<span class="muted small">明年一起解鎖徽章！</span>'}</div>
      ${a.own ? `<button class="btn block" data-year-card="${a.year}">產生年度分享圖</button>` : `<a class="btn primary block" href="${window.location.pathname}">做一本自己的紀念冊</a>`}</section>`];
  }

  let currentAlbum = null;
  function openAlbum(year, shared) {
    const a = shared || albumData(year);
    currentAlbum = a;
    const pages = albumPages(a);
    openModal(`${a.year} 旅行紀念冊${a.own ? '' : `・${esc(a.name)}`}`, a.trips.length ? `<div class="album" id="album">${pages.join('')}</div>
      <div class="album-nav"><button class="btn sm" data-album-step="-1" aria-label="上一頁">‹</button><span class="small muted" id="album-page">1 / ${pages.length}</span><button class="btn sm" data-album-step="1" aria-label="下一頁">›</button></div>
      <div class="album-tools">
        <button class="btn" data-album-export="page">存這一頁</button>
        <button class="btn" data-album-export="all">全部存成圖片</button>
        ${navigator.share ? '<button class="btn" data-album-export="share">分享圖片</button>' : ''}
        ${a.own ? '<button class="btn" data-album-export="link">分享連結</button>' : ''}
        <button class="btn" data-album-export="print">列印／存成 PDF</button>
      </div>
      <p class="small muted" style="margin:0">圖片尺寸 1080×1350，適合 IG／Threads。${a.own ? '分享連結會帶目的地照片、日期與旅行日記；你上傳的照片只存在這支手機，不會放進連結。' : ''}</p>`
      : `<div class="empty"><div class="empty-icon">${icon('book')}</div><b>${a.year} 還沒有旅行紀錄</b><span class="small muted">新增行程或匯入 Google 地圖時間軸，就能做出紀念冊。</span></div>`, { sheet: 'tall' });
    const album = $('#album');
    if (!album) return;
    album.addEventListener('scroll', () => {
      const i = Math.round(album.scrollLeft / album.clientWidth);
      $('#album-page').textContent = `${i + 1} / ${pages.length}`;
    }, { passive: true });
    openAlbum.year = a.year;
  }
  const albumPageIndex = () => { const box = $('#album'); return box ? Math.round(box.scrollLeft / box.clientWidth) : 0; };

  // ---------- album pages as 1080×1350 images
  const W = 1080;
  const H = 1350;
  const SERIF = '"Noto Serif TC", "Songti TC", serif';
  const SANS = '-apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) { resolve(null); return; }
      const im = new Image();
      if (!/^(data:|blob:)/.test(src) && /^https?:/.test(src)) im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = src;
    });
  }
  // Draws an image to fill the box (like object-fit: cover), or a soft gradient when it is missing.
  function cover(x, im, l, t, w, h, r = 0) {
    x.save();
    roundRect(x, l, t, w, h, r);
    x.clip();
    if (im) {
      const s = Math.max(w / im.width, h / im.height);
      x.drawImage(im, l + (w - im.width * s) / 2, t + (h - im.height * s) / 2, im.width * s, im.height * s);
    } else {
      const g = x.createLinearGradient(l, t, l + w, t + h);
      g.addColorStop(0, '#d9e4ff'); g.addColorStop(1, '#cdeee9');
      x.fillStyle = g; x.fillRect(l, t, w, h);
    }
    x.restore();
  }
  function wrapLines(x, text, maxW, maxLines) {
    const lines = [];
    let line = '';
    [...String(text)].forEach((ch) => {
      if (ch === '\n' || x.measureText(line + ch).width > maxW) { lines.push(line); line = ch === '\n' ? '' : ch; } else line += ch;
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`; }
    return lines;
  }
  async function drawAlbumPage(a, index) {
    try { await document.fonts.load(`900 40px ${SERIF}`); } catch { /* fallback font */ }
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    x.fillStyle = '#fbfaf7'; x.fillRect(0, 0, W, H);
    const last = a.trips.length + 1;
    x.textBaseline = 'alphabetic';
    if (index === 0) {
      const photos = await Promise.all(a.trips.map((t) => destPhoto(t.dest)?.src).filter(Boolean).slice(0, 4).map(loadImage));
      const ims = photos.filter(Boolean);
      const LAYOUTS = {
        4: [[0, 0, 540, 675], [540, 0, 540, 675], [0, 675, 540, 675], [540, 675, 540, 675]],
        3: [[0, 0, 540, 1350], [540, 0, 540, 675], [540, 675, 540, 675]],
        2: [[0, 0, 540, 1350], [540, 0, 540, 1350]],
      };
      const cells = LAYOUTS[Math.min(4, ims.length)] || [[0, 0, W, H]];
      cells.forEach(([l, t, w, h], i) => cover(x, ims[i] || null, l + 3, t + 3, w - 6, h - 6));
      const g = x.createLinearGradient(0, H * 0.45, 0, H);
      g.addColorStop(0, 'rgba(5,10,25,0)'); g.addColorStop(1, 'rgba(5,10,25,.88)');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.fillStyle = '#fff';
      x.font = `600 34px ${SANS}`; x.fillText('旅行紀念冊', 72, 980);
      x.font = `900 190px ${SERIF}`; x.fillText(String(a.year), 64, 1160);
      x.font = `600 40px ${SANS}`; x.fillText(`${a.name} 的旅行紀念冊`, 72, 1225);
      x.font = `400 32px ${SANS}`; x.globalAlpha = 0.85;
      x.fillText(`${a.countries} 個國家・${a.cities} 座城市・${a.days} 天${a.km ? `・${fmt(a.km)} 公里` : ''}`, 72, 1280);
      x.globalAlpha = 1;
    } else if (index < last) {
      const t = a.trips[index - 1];
      const hero = await loadImage(destPhoto(t.dest)?.src);
      cover(x, hero, 0, 0, W, 720);
      x.fillStyle = 'rgba(255,255,255,.92)'; x.font = `900 34px ${SERIF}`; x.fillText(`No. ${pad(index)}`, 56, 80);
      x.fillStyle = '#6b6f7a'; x.font = `500 30px ${SANS}`;
      x.fillText(`${country(t.n).name}・${t.start.replace(/-/g, '.')} – ${t.end.slice(5).replace('-', '.')}`, 64, 800);
      x.fillStyle = '#141a2a'; x.font = `900 92px ${SERIF}`; x.fillText(t.city, 60, 905);
      let tx = 64;
      x.font = `500 28px ${SANS}`;
      t.tags.slice(0, 4).forEach((k) => {
        const { label } = el(k);
        const w = x.measureText(label).width + 56;
        x.strokeStyle = '#d9dde6'; x.lineWidth = 2; roundRect(x, tx, 935, w, 52, 26); x.stroke();
        [x.fillStyle] = TAG_COLORS[k] || ['#1463ff']; x.beginPath(); x.arc(tx + 24, 961, 7, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#141a2a'; x.fillText(label, tx + 40, 971);
        tx += w + 12;
      });
      const mine = a.own ? albumPhotos(t.id).slice(0, 2).map((m) => m.src) : [];
      const d = DEST[t.dest];
      const spots = d ? d.spots.map((s) => spotPhoto(d.id, s.name)?.src).filter(Boolean) : [];
      const small = await Promise.all([...mine, ...spots].slice(0, 2).map(loadImage));
      const memoTop = small.some(Boolean) ? 1270 : 1030;
      if (small.some(Boolean)) small.forEach((im, i) => cover(x, im, 64 + i * 484, 1020, 468, 210, 20));
      if (t.memo) {
        x.fillStyle = '#3a3f4b'; x.font = `500 34px ${SERIF}`;
        const room = Math.max(1, Math.floor((H - 40 - memoTop) / 46));
        wrapLines(x, t.memo, W - 128, room).forEach((ln, i) => x.fillText(ln, 64, memoTop + 10 + i * 46));
      }
    } else {
      x.fillStyle = '#141a2a';
      x.font = `500 32px ${SANS}`; x.fillStyle = '#6b6f7a'; x.fillText('年度總結', 72, 200);
      x.fillStyle = '#141a2a'; x.font = `900 190px ${SERIF}`; x.fillText(String(a.year), 64, 390);
      const figs = [[a.countries, '國家'], [a.cities, '城市'], [a.days, '天'], [fmt(a.km), '公里']];
      figs.forEach(([v, l], i) => {
        const cx = 72 + (i % 2) * 480; const cy = 520 + Math.floor(i / 2) * 230;
        x.fillStyle = '#141a2a'; x.font = `900 96px ${SERIF}`; x.fillText(String(v), cx, cy + 90);
        x.fillStyle = '#6b6f7a'; x.font = `500 32px ${SANS}`; x.fillText(l, cx, cy + 145);
      });
      if (a.type) { x.fillStyle = '#141a2a'; x.font = `600 38px ${SANS}`; x.fillText(a.type, 72, 1050); }
      x.font = `500 32px ${SANS}`; x.fillStyle = '#6b6f7a';
      wrapLines(x, a.badges.length ? `徽章：${a.badges.join('、')}` : '', W - 144, 2).forEach((ln, i) => x.fillText(ln, 72, 1120 + i * 44));
    }
    x.fillStyle = index === 0 ? 'rgba(255,255,255,.7)' : '#9aa0ab';
    x.font = `500 24px ${SANS}`;
    x.fillText(`${CONFIG.brand}・${index + 1} / ${last + 1}`, 64, H - 36);
    return cv;
  }
  const canvasBlob = (cv) => new Promise((resolve, reject) => {
    try { cv.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/jpeg', 0.9); } catch (err) { reject(err); }
  });
  async function albumFiles(a, indexes) {
    const files = [];
    for (const i of indexes) { // eslint-disable-line no-restricted-syntax
      const cv = await drawAlbumPage(a, i); // eslint-disable-line no-await-in-loop
      const blob = await canvasBlob(cv); // eslint-disable-line no-await-in-loop
      files.push(new File([blob], `${a.year}-album-${pad(i + 1)}.jpg`, { type: 'image/jpeg' }));
    }
    return files;
  }
  function saveFile(file) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url; link.download = file.name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function exportAlbum(kind, button) {
    if (!currentAlbum) return;
    // Rebuild your own album so journal edits made after opening it are included.
    const a = currentAlbum.own ? albumData(currentAlbum.year) : currentAlbum;
    const total = a.trips.length + 2;
    if (kind === 'link') {
      const url = albumLink(a);
      const done = () => toast('已複製紀念冊連結');
      if (navigator.share) navigator.share({ title: `${a.year} 旅行紀念冊`, text: `${a.name} 的 ${a.year} 旅行紀念冊`, url }).catch(() => {});
      else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt('複製這個連結', url)); // eslint-disable-line no-alert
      else window.prompt('複製這個連結', url); // eslint-disable-line no-alert
      return;
    }
    if (kind === 'print') { printAlbum(a); return; }
    const label = button.textContent;
    button.disabled = true; button.textContent = '製作中…';
    try {
      const indexes = kind === 'page' ? [albumPageIndex()] : Array.from({ length: total }, (_, i) => i);
      const files = await albumFiles(a, indexes);
      if (kind === 'share' && navigator.canShare?.({ files })) {
        await navigator.share({ files, title: `${a.year} 旅行紀念冊` }).catch(() => {});
      } else {
        files.forEach((f, i) => setTimeout(() => saveFile(f), i * 400));
        toast(files.length > 1 ? `正在下載 ${files.length} 張圖片` : '已存成圖片');
      }
    } catch {
      toast('有照片無法放進圖片，請稍後再試');
    } finally {
      button.disabled = false; button.textContent = label;
    }
  }
  // Print view: every page as a full-size image, one per sheet; the browser can save it as PDF.
  async function printAlbum(a) {
    toast('準備列印版…');
    const files = await albumFiles(a, Array.from({ length: a.trips.length + 2 }, (_, i) => i)).catch(() => null);
    if (!files) { toast('有照片無法放進列印版，請稍後再試'); return; }
    const urls = files.map((f) => URL.createObjectURL(f));
    const box = document.createElement('div');
    box.id = 'print-album';
    box.innerHTML = urls.map((u) => `<img src="${u}" alt="">`).join('');
    document.body.appendChild(box);
    document.body.classList.add('printing');
    await Promise.all([...box.querySelectorAll('img')].map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; }))));
    const cleanup = () => { document.body.classList.remove('printing'); box.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(() => { if (document.body.classList.contains('printing') && !window.matchMedia('print').matches) cleanup(); }, 60000);
  }
  // ---------- badge sheets: what you did and ate for each badge, and how to get the ones still locked
  function tripStory(t, focus, extra = '') {
    const c = country(t.n);
    const ph = destPhoto(t.dest);
    let body = '';
    if (focus === 'food' || focus === 'culture') {
      body = logHtml(t, focus);
    } else {
      const planned = t.plan ? t.plan.days.flat().filter((i) => i.kind === 'spot').map((i) => i.name) : [];
      const names = planned.length ? planned : (DEST[t.dest]?.spots || []).map((x) => x.name);
      if (names.length) body = `<div class="small muted" style="margin:8px 0 4px">${planned.length ? '行程裡去了' : '這座城市的必去'}</div><div class="row">${names.slice(0, 6).map((n) => `<span class="chip">${icon('pin')}${esc(n)}</span>`).join('')}</div>`;
      const logged = [...ateOf(t).map((x) => `吃了 ${x}`), ...didOf(t).map((x) => `做了 ${x}`)];
      if (logged.length) body += `<div class="row" style="margin-top:6px">${logged.map((x) => `<span class="chip on">${icon('check')}${esc(x)}</span>`).join('')}</div>`;
    }
    return `<article class="story"><button class="story-head" data-trip="${t.id}"><span class="story-ph ph ${ph ? '' : 'ph-missing'}">${imgHtml(ph, t.city)}</span><span class="grow"><span class="small muted">${flag(c.code)} ${esc(c.name)}・${t.start.replace(/-/g, '.')} – ${t.end.slice(5).replace('-', '.')}${extra}</span><b>${esc(t.city)}</b></span><span class="muted" aria-hidden="true">›</span></button>${body}</article>`;
  }
  const flagPill = (n, s, small) => `<button class="flag-pill ${small ? 'sm' : ''}" data-country-n="${n}">${flag(country(n).code)}<b>${esc(country(n).name)}</b>${s ? `<small>${s.past.filter((t) => t.n === n).length} 趟</small>` : ''}</button>`;
  function badgeEvidence(b, s) {
    if (b.kind === 'checkin') {
      const cs = allCheckins(s.list);
      return `<section><h3>你的印章 ${cs.length} 個</h3>${cs.length ? `<div class="stamp-row">${cs.map(stampHtml).join('')}</div>` : '<p class="small muted">還沒有打卡。</p>'}</section>`;
    }
    if (b.kind === 'photo') {
      const ps = LIB.filter((p) => s.list.some((t) => t.id === p.tripId)).sort(byTaken);
      return `<section><h3>照片庫裡 ${ps.length} 張旅行照片</h3><div class="lib-grid">${ps.slice(0, 12).map((p) => `<button class="lib-ph" data-lib-photo="${p.id}"><img src="${libSrc(p)}" alt="" loading="lazy"></button>`).join('')}</div></section>`;
    }
    if (b.kind === 'share') return `<section><h3>已經分享 ${shareCount()} 次</h3><p class="small muted">分享打卡明信片、限時動態、足跡地圖或徽章卡都算，傳 LINE、發 IG 或存圖片都可以。</p></section>`;
    if (b.kind === 'country') {
      const ns = [...s.countries].filter((n) => !b.region || country(n).region === b.region);
      return `<section><h3>收集到的${b.region ? REGIONS[b.region] : ''}國旗 ${ns.length} 面</h3><div class="flag-list">${ns.map((n) => flagPill(n, s)).join('') || '<span class="muted small">還沒有</span>'}</div></section>`;
    }
    if (b.kind === 'region') {
      return `<section><h3>你的足跡跨了 ${s.regions.size} 個洲</h3>${[...s.regions].map((r) => `<div class="region-row"><b>${REGIONS[r]}</b><div class="flag-list">${[...s.countries].filter((n) => country(n).region === r).map((n) => flagPill(n, null, true)).join('')}</div></div>`).join('') || '<span class="muted small">還沒有</span>'}</section>`;
    }
    if (b.kind === 'km') {
      return `<section><h3>飛了 ${fmt(s.km)} 公里</h3><ul class="route-list">${journeys(s.past).map((j) => `<li><span>${esc([home().name, ...j.map((t) => t.city), home().name].join(' → '))}</span><b>${fmt(journeyKm(j))} 公里</b></li>`).join('')}</ul>${b.key === 'earth' && s.km < 40075 ? `<p class="small muted">繞地球一圈還差 ${fmt(40075 - s.km)} 公里</p>` : ''}</section>`;
    }
    if (b.kind === 'days') {
      const max = Math.max(1, ...s.past.map(tripDays));
      return `<section><h3>在路上 ${s.days} 天</h3><div class="grid" style="gap:6px">${s.past.map((t) => `<div class="bar"><span>${flag(country(t.n).code)} ${esc(t.city)}</span><div class="track"><div class="fill" style="width:${(tripDays(t) / max) * 100}%;background:var(--brand)"></div></div><span>${tripDays(t)} 天</span></div>`).join('')}</div></section>`;
    }
    if (b.kind === 'season') {
      return `<section><h3>四季的足跡</h3><div class="season-grid">${['春', '夏', '秋', '冬'].map((se) => {
        const ts = s.past.filter((t) => tripSeasons(t).has(se));
        return `<div class="season ${ts.length ? 'on' : ''}"><b>${se}</b>${ts.map((t) => `<button class="chip" data-trip="${t.id}">${flag(country(t.n).code)}${esc(t.city)}</button>`).join('') || '<small class="muted">還沒去</small>'}</div>`;
      }).join('')}</div></section>`;
    }
    if (b.kind === 'eat') {
      const ts = s.past.filter((t) => CULTURE[country(t.n).code] || ateOf(t).length);
      return `<section><h3>打卡了 ${sum(s.past, (t) => ateOf(t).length)} 道在地美食</h3><p class="small muted">點美食標記吃過，沒列出來的可以自己加。</p>${ts.map((t) => tripStory(t, 'food')).join('') || '<p class="muted small">還沒有可以打卡的旅行</p>'}</section>`;
    }
    const list = b.trips ? b.trips(s) : [];
    const focus = b.tag === 'food' || b.tag === 'culture' ? b.tag : null;
    const extra = (t) => {
      if (b.key === 'esim') return `・上網 ${t.gb} GB`;
      if (b.key === 'long') return `・${tripFlight(t)?.text || ''}`;
      if (b.key === 'weekend' || b.key === 'slow') return `・${daysBetween(t.start, t.end)} 天`;
      return '';
    };
    const hint = { food: '點美食標記吃過，沒列出來的可以自己加。', culture: '點體驗標記做過，也可以自己加。' }[focus];
    return list.length ? `<section><h3>${b.tag ? `你的 ${list.length} 趟${el(b.tag).label}之旅` : `相關的旅行 ${list.length} 趟`}</h3>${hint ? `<p class="small muted">${hint}</p>` : ''}${list.map((t) => tripStory(t, focus, extra(t))).join('')}</section>` : '';
  }
  function badgeNext(b, s) {
    if (b.kind === 'checkin') return '<p class="small muted">旅途中拍一張、選地點，就會蓋上一個印章；去過的旅行也可以補打卡。</p><button class="btn primary" data-checkin>現在打卡</button>';
    if (b.kind === 'photo') return '<p class="small muted">把手機裡的旅行照片加進來，會依拍攝日期自動放進每一趟旅行。</p><label class="btn primary"><input type="file" accept="image/*" multiple hidden data-lib-add>加入照片</label>';
    if (b.kind === 'share') return '<button class="btn primary" data-share-year="all">分享我的足跡地圖</button>';
    const seen = new Set(trips.map((t) => t.dest));
    const destCards = (list) => (list.length ? `<div class="gallery">${list.slice(0, 6).map((d) => `<button class="ph-card city" data-dest="${d.id}"><div class="ph ${destPhoto(d.id) ? '' : 'ph-missing'}">${imgHtml(destPhoto(d.id), d.name)}</div><figcaption><b>${flag(d.c)} ${esc(d.name)}</b><small class="muted">${flightInfo(d.c)?.text || ''}</small></figcaption></button>`).join('')}</div>` : '');
    const inRegion = (d) => COUNTRIES[d.c]?.region;
    if (b.tag) return `<p class="small muted">去這些有${el(b.tag).label}的地方：</p>${destCards(DESTS.filter((d) => d.tags.includes(b.tag) && !seen.has(d.id)))}`;
    if (b.kind === 'country') return `<p class="small muted">還沒去過的國家：</p>${destCards(DESTS.filter((d) => !s.countries.has(COUNTRIES[d.c].n) && (!b.region || inRegion(d) === b.region)))}`;
    if (b.kind === 'region') return `<p class="small muted">換個洲走走：</p>${destCards(DESTS.filter((d) => !s.regions.has(inRegion(d))))}`;
    if (b.key === 'long') return `<p class="small muted">10 小時以上的航線：</p>${destCards(DESTS.filter((d) => d.hours >= 10 && !seen.has(d.id)))}`;
    if (b.key === 'esim') return '<p class="small muted">下次出國用 eSIM 上網，在行程裡填上用量就會累積。</p><button class="btn primary" data-goto="esim">挑一張 eSIM</button>';
    if (b.key === 'eat10') return '<p class="small muted">打開任一趟旅行，在「我吃了什麼」點一下吃過的美食。</p>';
    if (b.key === 'memory') return `<p class="small muted">在紀念冊幫旅行寫一段回憶或放照片。</p><button class="btn primary" data-album="${CONFIG.years[CONFIG.years.length - 1]}">打開紀念冊</button>`;
    if (b.kind === 'season') return `<p class="small muted">還沒去的季節：${['春', '夏', '秋', '冬'].filter((se) => !s.past.some((t) => tripSeasons(t).has(se))).join('、')}</p><button class="btn primary" data-random>隨機出國</button>`;
    return '<button class="btn primary" data-random>隨機出國找靈感</button>';
  }
  function openBadge(key, year = 'all') {
    const b = BADGES.find((x) => x.key === key);
    if (!b) return;
    const list = tripsIn(year);
    const s = statsOf(list);
    const st = badgeState(b, s);
    const at = st.ok ? badgeUnlocked(b, list) : null;
    const when = at?.end;
    const atPhoto = at && destPhoto(at.dest);
    openModal(esc(b.name), `
      <div class="badge-hero">${medal(b, st.ok, 'xl', { pct: st.pct })}<div class="grow"><span class="kicker plain muted">${BADGE_GROUPS[b.group]}</span><h2 class="serif">${esc(b.name)}</h2><p class="muted" style="margin:2px 0 8px">${esc(b.desc)}</p>
        ${st.ok ? `<span class="status active">已解鎖${when ? `・${when.replace(/-/g, '.')} 達成` : ''}</span>` : `<div class="progress"><i style="width:${st.pct}%;background:linear-gradient(90deg,${b.color[0]},${b.color[1]})"></i></div><small class="muted">${fmt(st.v)} / ${fmt(st.goal)}</small>`}</div></div>
      ${BADGE_LINES[b.key] ? `<p class="badge-line">「${BADGE_LINES[b.key]}」</p>` : ''}
      ${st.ok ? `<div class="actions"><button class="btn primary" data-share-badge="${b.key}">分享這枚徽章</button></div>` : ''}
      ${at ? `<figure class="unlock-photo">${atPhoto ? imgHtml(atPhoto, at.city) : ''}<figcaption>${flag(country(at.n).code)}在 ${esc(at.city)} 解鎖・${at.end.replace(/-/g, '.')}</figcaption></figure>` : ''}
      <div class="seg">${['all', ...CONFIG.years].map((y) => `<button data-badge="${key}" data-by="${y}" class="${String(year) === String(y) ? 'on' : ''}">${y === 'all' ? '2025–2026' : y}</button>`).join('')}</div>
      ${badgeEvidence(b, s)}
      ${st.ok ? '' : `<section><h3>怎麼解鎖</h3>${badgeNext(b, s)}</section>`}`, { sheet: 'tall' });
    if (st.ok) setTimeout(() => burst($('#modal .badge-hero .medal'), 22), 650);
  }
  let wallYear = 'all';
  const badgeWallHtml = (year) => {
    const s = stats(year);
    return Object.entries(BADGE_GROUPS).map(([g, label]) => `<div class="wall-group"><h4>${label}</h4><div class="badges">${BADGES.filter((b) => b.group === g).map((b, i) => badgeTile(b, s, year, i)).join('')}</div></div>`).join('');
  };
  function renderBadgeWall() {
    const s = stats(wallYear);
    $('#badge-count').textContent = `已解鎖 ${BADGES.filter((b) => badgeState(b, s).ok).length} / ${BADGES.length}`;
    $('#badge-seg').innerHTML = ['all', ...CONFIG.years].map((y) => `<button data-wall="${y}" class="${String(wallYear) === String(y) ? 'on' : ''}">${y === 'all' ? '全部' : y}</button>`).join('');
    $('#badge-wall').innerHTML = badgeWallHtml(wallYear);
  }
  $('#badge-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-wall]'); if (b) { wallYear = b.dataset.wall; renderBadgeWall(); } });
  function openBadgeWall(year) {
    openModal(`${year === 'all' ? '2025–2026' : year} 全部徽章`, `<p class="muted small" style="margin:0">點徽章看你做了什麼、吃了什麼；還沒解鎖的會告訴你怎麼拿到。</p>${badgeWallHtml(year)}`, { sheet: 'tall' });
  }

  // Ticking a dish or an experience: saved on the trip (so it syncs), and may unlock a badge.
  const unlockedKeys = () => { const s = stats('all'); return BADGES.filter((b) => badgeState(b, s).ok).map((b) => b.key); };
  function toggleLog(id, kind, name) {
    const t = trips.find((x) => x.id === id);
    if (!t || !name) return;
    const key = kind === 'food' ? 'ate' : 'did';
    const list = Array.isArray(t[key]) ? t[key] : [];
    const on = !list.includes(name);
    const before = unlockedKeys();
    t[key] = on ? [...list, name].slice(-60) : list.filter((x) => x !== name);
    save();
    $$('[data-log-box]').forEach((box) => { if (box.dataset.logBox === `${t.id}:${kind}`) box.outerHTML = logHtml(t, kind); });
    renderReview(); renderBadgeWall(); renderCards(); renderTrips();
    const btn = $$('[data-log]').find((b) => b.dataset.log === id && b.dataset.kind === kind && b.dataset.name === name);
    if (on && btn) { btn.classList.add('just'); burst(btn); buzz(); }
    const fresh = BADGES.filter((b) => unlockedKeys().includes(b.key) && !before.includes(b.key));
    if (fresh.length) setTimeout(() => burst(btn || document.body, 34), 250);
    if (fresh.length) toast(`解鎖徽章：${fresh.map((b) => b.name).join('、')}！`);
    else if (on) toast(kind === 'food' ? `記下了：吃了${name}` : `記下了：做了${name}`);
  }
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-log-add]');
    if (!form) return;
    e.preventDefault();
    const name = form.elements.namedItem('entry').value.trim().slice(0, 30);
    const t = trips.find((x) => x.id === form.dataset.logAdd);
    const key = form.dataset.kind === 'food' ? 'ate' : 'did';
    if (name && t && !(t[key] || []).includes(name)) toggleLog(t.id, form.dataset.kind, name);
  });

  // ---------- 旅遊卡: one collectible card per trip; tap to flip, save as an image to share
  let cardYear = 'all';
  const tripNo = (t) => sortTrips(trips).findIndex((x) => x.id === t.id) + 1;
  const seasonName = (t) => `${SEASONS[Number(t.start.slice(5, 7)) - 1]}季`;
  function travelCardHtml(t, i) {
    const c = country(t.n);
    const ph = destPhoto(t.dest);
    const f = tripFlight(t);
    const days = daysBetween(t.start, t.end);
    const ate = ateOf(t);
    const did = didOf(t);
    return `<article class="pcard ${tripClass(t)}" data-pcard="${t.id}" tabindex="0" aria-label="${esc(t.city)} 旅遊卡，按一下翻面" style="--i:${i}">
      <div class="pcard-inner">
        <div class="pcard-face pcard-front">
          <div class="ph ${ph ? '' : 'ph-missing'}">${imgHtml(ph, t.city)}</div>
          <span class="pcard-shine" aria-hidden="true"></span>
          <div class="pcard-top">${flag(c.code)}<span>${esc(c.name)}</span><span class="spacer"></span><span class="pcard-no">No.${pad(tripNo(t))}</span></div>
          <span class="pcard-stamp"><b>${tripYear(t)}</b><small>TRAVEL</small></span>
          <div class="pcard-bottom">
            <span class="pcard-kicker">${seasonName(t)}・${isUpcoming(t) ? '即將出發' : `${md(t.start)} – ${md(t.end)}`}</span>
            <h3 class="serif">${esc(t.city)}</h3>
            <div class="pcard-meta"><span>${days} 天</span>${f ? `<span>${icon('flight')}${f.hours} 小時</span>` : ''}${ate.length ? `<span>吃了 ${ate.length} 道</span>` : ''}</div>
            <div class="pcard-tags">${t.tags.slice(0, 3).map((k) => `<span>${dot(k)}${el(k).label}</span>`).join('')}</div>
          </div>
        </div>
        <div class="pcard-face pcard-back">
          <div class="pcard-route"><div><small>FROM</small><b>${esc(home().name)}</b></div>${icon('flight')}<div><small>TO</small><b>${esc(t.city)}</b></div></div>
          <dl class="pcard-kv">
            <dt>日期</dt><dd>${t.start.replace(/-/g, '.')} – ${t.end.slice(5).replace('-', '.')}</dd>
            <dt>天數</dt><dd>${days} 天</dd>
            ${f ? `<dt>飛行</dt><dd>${f.text}</dd>` : ''}
            <dt>距離</dt><dd>${fmt(haversine(home(), t))} 公里</dd>
            ${Number(t.gb) ? `<dt>eSIM</dt><dd>${t.gb} GB</dd>` : ''}
            <dt>吃了</dt><dd>${ate.length ? esc(ate.slice(0, 4).join('、')) : '—'}</dd>
            <dt>做了</dt><dd>${did.length ? esc(did.slice(0, 3).join('、')) : '—'}</dd>
          </dl>
          ${t.memo ? `<p class="pcard-memo serif">「${esc(t.memo.slice(0, 50))}${t.memo.length > 50 ? '…' : ''}」</p>` : ''}
          <div class="pcard-actions"><button class="btn sm primary" data-card-dl="${t.id}">下載卡片</button>${navigator.share ? `<button class="btn sm" data-card-dl="${t.id}" data-mode="share">分享</button>` : ''}<button class="btn sm" data-trip="${t.id}">記錄吃喝玩</button></div>
        </div>
      </div>
    </article>`;
  }
  function renderCards() {
    const list = sortTrips(trips).reverse().filter((t) => cardYear === 'all' || tripYear(t) === Number(cardYear));
    $('#pcard-seg').innerHTML = ['all', ...CONFIG.years].map((y) => `<button data-cy="${y}" class="${String(cardYear) === String(y) ? 'on' : ''}">${y === 'all' ? '全部' : y}</button>`).join('');
    $('#pcard-count').textContent = list.length ? `${list.length} 張・點卡片翻面` : '';
    $('#pcards').innerHTML = list.length ? list.map(travelCardHtml).join('') : '<div class="card muted">新增一趟旅行，就會得到第一張旅遊卡。</div>';
  }
  $('#pcard-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-cy]'); if (b) { cardYear = b.dataset.cy; renderCards(); } });
  const flipCard = (card) => card.classList.toggle('flipped');
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.pcard');
    if (card && !e.target.closest('button, a')) flipCard(card);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('pcard')) { e.preventDefault(); flipCard(e.target); }
  });
  async function drawTravelCard(t) {
    try { await document.fonts.load(`900 40px ${SERIF}`); } catch { /* fallback font */ }
    const c = country(t.n);
    const f = tripFlight(t);
    const [hero, fl] = await Promise.all([loadImage(destPhoto(t.dest)?.src), c.code ? loadImage(flagSrc(c.code)) : null]);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    x.fillStyle = '#0d1424'; x.fillRect(0, 0, W, H);
    cover(x, hero, 0, 0, W, H);
    let g = x.createLinearGradient(0, H * 0.36, 0, H);
    g.addColorStop(0, 'rgba(5,10,25,0)'); g.addColorStop(1, 'rgba(5,10,25,.94)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    g = x.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, 'rgba(5,10,25,.6)'); g.addColorStop(1, 'rgba(5,10,25,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, 300);
    x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 3; roundRect(x, 40, 40, W - 80, H - 80, 34); x.stroke();
    let tx = 84;
    if (fl) {
      x.save(); roundRect(x, 84, 88, 108, 72, 10); x.clip(); x.drawImage(fl, 84, 88, 108, 72); x.restore();
      x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 3; roundRect(x, 84, 88, 108, 72, 10); x.stroke();
      tx = 214;
    }
    x.fillStyle = '#fff'; x.font = `700 40px ${SANS}`; x.fillText(c.name, tx, 138);
    x.textAlign = 'right'; x.font = `900 40px ${SERIF}`; x.fillText(`No. ${pad(tripNo(t))}`, W - 84, 138);
    x.save(); x.translate(W - 190, 300); x.rotate(-0.18);
    x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 4; x.beginPath(); x.arc(0, 0, 92, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 78, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = `900 48px ${SERIF}`; x.fillText(String(tripYear(t)), 0, 12);
    x.font = `700 20px ${SANS}`; x.fillText('TRAVEL CARD', 0, 46);
    x.restore();
    x.textAlign = 'left';
    x.fillStyle = 'rgba(255,255,255,.85)'; x.font = `500 34px ${SANS}`;
    x.fillText(`${seasonName(t)}・${t.start.replace(/-/g, '.')} – ${t.end.slice(5).replace('-', '.')}`, 84, H - 440);
    let size = 150;
    x.fillStyle = '#fff'; x.font = `900 ${size}px ${SERIF}`;
    while (x.measureText(t.city).width > W - 168 && size > 70) { size -= 10; x.font = `900 ${size}px ${SERIF}`; }
    x.fillText(t.city, 78, H - 262);
    x.fillStyle = 'rgba(255,255,255,.9)'; x.font = `500 34px ${SANS}`;
    x.fillText([`${daysBetween(t.start, t.end)} 天`, f ? f.text : '', `${fmt(haversine(home(), t))} 公里`].filter(Boolean).join('・'), 84, H - 192);
    let cx = 84;
    x.font = `500 28px ${SANS}`;
    t.tags.slice(0, 4).forEach((k) => {
      const { label } = el(k);
      const w = x.measureText(label).width + 58;
      x.fillStyle = 'rgba(255,255,255,.16)'; roundRect(x, cx, H - 152, w, 52, 26); x.fill();
      [x.fillStyle] = TAG_COLORS[k] || ['#1463ff']; x.beginPath(); x.arc(cx + 25, H - 126, 8, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff'; x.fillText(label, cx + 42, H - 116);
      cx += w + 12;
    });
    x.fillStyle = 'rgba(255,255,255,.6)'; x.font = `500 24px ${SANS}`; x.fillText(`${CONFIG.brand}・旅遊卡`, 84, H - 66);
    return cv;
  }
  async function saveTravelCard(id, button) {
    const t = trips.find((x) => x.id === id);
    if (!t) return;
    const label = button.textContent;
    button.disabled = true; button.textContent = '製作中…';
    try {
      const file = new File([await canvasBlob(await drawTravelCard(t))], `travel-card-${t.start}-${t.city}.png`, { type: 'image/png' });
      if (button.dataset.mode === 'share' && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: `${t.city} 旅遊卡` }); } catch { /* cancelled */ }
      } else {
        saveFile(file);
        toast('旅遊卡已存成圖片');
      }
    } catch {
      toast('圖片製作失敗，請再試一次');
    }
    button.disabled = false; button.textContent = label;
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(im.width, im.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(im.width * scale); cv.height = Math.round(im.height * scale);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', 0.78));
      };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      im.src = url;
    });
  }
  async function addAlbumPhotos(tripId, files) {
    const added = await addPhotos(files, { tripId, quiet: true });
    if (!added.length) { toast('照片沒辦法存，請換一張試試'); return; }
    const page = albumPageIndex();
    openAlbum(openAlbum.year);
    $('#album').scrollLeft = page * $('#album').clientWidth;
    toast('已加入紀念冊');
  }

  async function loadLibrary() {
    if (!PDB) return;
    try { LIB = await PDB.all(); } catch { LIB = []; return; }
    // Photos added to the album before the library existed were data URLs in localStorage: move them over.
    const legacy = trips.filter((t) => store.get(albumKey(t.id), []).length);
    await Promise.all(legacy.map(async (t) => {
      const keep = [];
      await Promise.all(store.get(albumKey(t.id), []).map(async (m) => {
        try {
          const { fileDate, ...prep } = await PDB.prepare(await PDB.fromDataUrl(m.src));
          const rec = {
            id: /^[\w-]{6,48}$/.test(m.id || '') ? m.id : `p-${uid()}${uid()}`, tripId: t.id, checkinId: '', caption: '', added: Date.now(), cloud: false, ...prep, taken: prep.taken || t.start,
          };
          await PDB.put(rec);
          LIB.push(rec);
        } catch { keep.push(m); }
      }));
      if (keep.length) store.set(albumKey(t.id), keep); else localStorage.removeItem(`tm:${albumKey(t.id)}`);
    }));
  }

  /** Files from the camera, the photo picker or a drop → library records, each sorted into its trip. */
  async function addPhotos(files, opts = {}) {
    if (!PDB) { toast('這個瀏覽器沒辦法存照片'); return []; }
    const list = [...files].filter((f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || '')).slice(0, 60);
    if (!list.length) return [];
    if (!opts.quiet && list.length > 2) toast(`整理 ${list.length} 張照片中…`);
    const added = [];
    let sorted = 0;
    await list.reduce((chain, f, i) => chain.then(async () => {
      try {
        const { fileDate, ...prep } = await PDB.prepare(f);
        const trip = opts.tripId ? trips.find((t) => t.id === opts.tripId) : tripForDate(prep.taken || fileDate, prep.lat, prep.lng);
        if (trip && !opts.tripId) sorted += 1;
        const rec = {
          id: `p-${uid()}${uid()}`, tripId: trip?.id || '', checkinId: opts.checkinId || '', caption: opts.caption || '', added: Date.now() + i, cloud: false, ...prep, taken: prep.taken || fileDate || '',
        };
        await PDB.put(rec);
        LIB.push(rec);
        added.push(rec);
      } catch { /* a file the browser cannot open */ }
    }), Promise.resolve());
    PDB.persist();
    if (added.length) { save(); renderLibrary(); renderBadgeWall(); queueBackup(); }
    if (!opts.quiet) {
      toast(added.length ? `加入 ${added.length} 張照片${sorted ? `，${sorted} 張依拍攝日期放進對應的旅行` : ''}` : '這些檔案讀不出來，換 JPEG 或 PNG 試試');
    }
    return added;
  }
  async function deletePhoto(id) {
    const p = LIB.find((x) => x.id === id);
    if (!p) return;
    LIB = LIB.filter((x) => x.id !== id);
    dropUrls(id);
    await PDB?.del(id).catch(() => {});
    trips.forEach((t) => (t.checkins || []).forEach((c) => { if (c.photo === id) c.photo = ''; }));
    if (p.cloud && user?.line) photoFetch('DELETE', id).catch(() => {});
    save();
  }

  // ---------- cloud backup after LINE login: each photo goes up once; on a new phone the thumbnails come back
  const backup = { busy: false };
  async function photoFetch(method, path, body) {
    const liff = await loadLiff();
    const idToken = liff?.isLoggedIn() ? liff.getIDToken() : null;
    if (!idToken) throw Object.assign(new Error('login'), { status: 401 });
    const res = await fetch(`api/photos/${path}`, { method, headers: { 'X-Line-Token': idToken, ...(body ? { 'Content-Type': 'image/jpeg' } : {}) }, body });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res;
  }
  async function queueBackup() {
    if (!user?.line || !CONFIG.liff || backup.busy || !PDB) return;
    backup.busy = true;
    renderLibraryStatus();
    await LIB.filter((p) => !p.cloud && p.full && p.thumb).reduce((chain, p) => chain.then(async () => {
      await photoFetch('PUT', `${p.id}/thumb`, p.thumb);
      await photoFetch('PUT', `${p.id}/full`, p.full);
      p.cloud = true;
      await PDB.put(p);
      renderLibraryStatus();
    }), Promise.resolve()).catch(() => {});
    backup.busy = false;
    renderLibraryStatus();
  }
  async function restoreCloudPhotos(metas) {
    if (!Array.isArray(metas) || !PDB) return;
    const have = new Set(LIB.map((p) => p.id));
    const missing = metas.filter((m) => m && /^[\w-]{6,48}$/.test(m.id || '') && !have.has(m.id)).slice(0, 400);
    await missing.reduce((chain, m) => chain.then(async () => {
      try {
        const thumb = await (await photoFetch('GET', `${m.id}/thumb`)).blob();
        const rec = { ...photoMeta(m), thumb, full: null, cloud: true };
        await PDB.put(rec);
        LIB.push(rec);
      } catch { /* comes back on the next login */ }
    }), Promise.resolve());
    if (missing.length) renderLibrary();
  }
  async function fullPhoto(p) {
    if (!p || p.full || !p.cloud) return p;
    try { await updatePhoto(p, { full: await (await photoFetch('GET', `${p.id}/full`)).blob() }); } catch { /* the thumbnail will do */ }
    return p;
  }

  // ---------- the library on the 足跡 tab: recent check-in stamps, then the photos by trip
  let libFilter = 'all';
  let libShown = 60;
  const libSel = new Set();
  let libSelecting = false;
  const libFiltered = () => LIB.filter((p) => libFilter === 'all' || (libFilter === 'none' ? !trips.some((t) => t.id === p.tripId) : p.tripId === libFilter)).sort(byTaken);
  function renderLibraryStatus() {
    const box = $('#lib-status');
    if (!box) return;
    const cloud = LIB.filter((p) => p.cloud).length;
    let text = PDB ? `照片存在這支手機${LIB.length ? `，共 ${LIB.length} 張` : ''}` : '這個瀏覽器不能存照片';
    if (user?.line && LIB.length) text += backup.busy ? `・備份到雲端中 ${cloud}/${LIB.length}` : `・雲端已備份 ${cloud}/${LIB.length}`;
    else if (CONFIG.liff && LIB.length) text += '・用 LINE 登入就會備份到雲端，換手機也找得回來';
    box.textContent = text;
  }
  function renderLibrary() {
    const grid = $('#lib-grid');
    if (!grid) return;
    const cs = allCheckins();
    $('#lib-count').textContent = `${cs.length} 個打卡・${LIB.length} 張照片`;
    $('#stamp-row').innerHTML = cs.length
      ? `<div class="stamp-row">${cs.slice(0, 24).map(stampHtml).join('')}<button class="stamp-chip add" data-checkin><b>＋</b><small>蓋新的章</small></button></div>`
      : '<button class="stamp-invite" data-checkin><span class="stamp-chip ghost"><small>CHECK-IN</small><b>第一個章</b><small>等你來蓋</small></span><span><b>在旅途中打卡</b><small>拍一張、選地點，就蓋上一個印章，做成明信片分享出去</small></span></button>';
    const withPhotos = sortTrips(trips.filter((t) => LIB.some((p) => p.tripId === t.id))).reverse();
    const loose = LIB.filter((p) => !trips.some((t) => t.id === p.tripId)).length;
    if (libFilter !== 'all' && libFilter !== 'none' && !withPhotos.some((t) => t.id === libFilter)) libFilter = 'all';
    $('#lib-filter').innerHTML = LIB.length ? [
      `<button class="chip ${libFilter === 'all' ? 'on' : ''}" data-lib-filter="all">全部 ${LIB.length}</button>`,
      ...withPhotos.map((t) => `<button class="chip ${libFilter === t.id ? 'on' : ''}" data-lib-filter="${t.id}">${flag(country(t.n).code)}${esc(t.city)} ${tripPhotos(t.id).length}</button>`),
      loose ? `<button class="chip ${libFilter === 'none' ? 'on' : ''}" data-lib-filter="none">未分類 ${loose}</button>` : '',
      `<span class="spacer"></span><button class="link-btn" data-lib-select>${libSelecting ? '完成' : '選取'}</button>`,
    ].join('') : '';
    const list = libFiltered();
    grid.classList.toggle('selecting', libSelecting);
    grid.innerHTML = list.length
      ? `${list.slice(0, libShown).map((p) => `<button class="lib-ph ${libSel.has(p.id) ? 'sel' : ''}" data-lib-photo="${p.id}"><img src="${libSrc(p)}" alt="${esc(p.caption || '旅行照片')}" loading="lazy" decoding="async">${p.checkinId ? '<i class="lib-tag">打卡</i>' : ''}</button>`).join('')}${list.length > libShown ? `<button class="lib-more" data-lib-more>再看 ${list.length - libShown} 張</button>` : ''}`
      : `<label class="lib-drop">${pic('camera')}<b>把旅行照片加進來</b><small>可以一次選很多張，會依拍攝日期自動放進每一趟旅行；電腦上也可以直接拖進來</small><input type="file" accept="image/*" multiple hidden data-lib-add></label>`;
    $('#lib-bar').hidden = !libSelecting;
    $('#lib-bar').innerHTML = `<span><b>已選 ${libSel.size} 張</b></span><span class="spacer"></span><button class="btn sm" data-lib-act="share" ${libSel.size ? '' : 'disabled'}>分享</button><button class="btn sm" data-lib-act="save" ${libSel.size ? '' : 'disabled'}>下載</button><button class="btn sm danger-text" data-lib-act="delete" ${libSel.size ? '' : 'disabled'}>刪除</button>`;
    renderLibraryStatus();
  }
  async function libAction(kind) {
    const list = LIB.filter((p) => libSel.has(p.id));
    if (!list.length) return;
    if (kind === 'delete') {
      askConfirm(`刪除 ${list.length} 張照片？`, '照片會從這支手機和雲端備份一起刪掉，打卡會保留。', '刪除', async () => {
        await Promise.all(list.map((p) => deletePhoto(p.id)));
        libSel.clear(); libSelecting = false; renderLibrary(); renderBadgeWall();
      });
      return;
    }
    await Promise.all(list.map(fullPhoto));
    const files = list.filter((p) => p.full || p.thumb).map((p, i) => new File([p.full || p.thumb], `travel-${p.taken || 'photo'}-${i + 1}.jpg`, { type: 'image/jpeg' }));
    if (kind === 'share' && navigator.canShare?.({ files })) {
      try { await navigator.share({ files }); bumpShare(); } catch { /* cancelled */ }
      return;
    }
    files.forEach((f, i) => setTimeout(() => saveFile(f), i * 250));
    toast(kind === 'share' ? '這個瀏覽器不能直接分享，照片已存到下載' : `已下載 ${files.length} 張`);
  }

  async function openPhoto(id) {
    const p = LIB.find((x) => x.id === id);
    if (!p) return;
    await fullPhoto(p);
    const t = trips.find((x) => x.id === p.tripId);
    const c = t && (t.checkins || []).find((x) => x.photo === p.id);
    const list = libFiltered();
    const i = list.findIndex((x) => x.id === id);
    const prev = list[(i - 1 + list.length) % list.length];
    const next = list[(i + 1) % list.length];
    openModal(t ? `${flag(country(t.n).code)} ${esc(t.city)}` : '照片', `
      <figure class="lb"><img src="${libSrc(p, 'full')}" alt="${esc(p.caption || '旅行照片')}">${list.length > 1 ? `<button class="lb-nav prev" data-lib-photo="${prev.id}" aria-label="上一張">‹</button><button class="lb-nav next" data-lib-photo="${next.id}" aria-label="下一張">›</button>` : ''}</figure>
      <div class="lb-meta">${p.taken ? `<span>${p.taken.replace(/-/g, '.')}</span>` : ''}${c ? `<button class="chip" data-ci-open="${t.id}:${c.id}">打卡・${esc(c.place)}</button>` : ''}${p.cloud ? '<span class="chip">已備份到雲端</span>' : ''}<span class="spacer"></span><span class="small muted">${i + 1} / ${list.length}</span></div>
      <input class="input" maxlength="80" placeholder="幫這張照片寫一句話" value="${esc(p.caption || '')}" data-lb-caption="${p.id}" aria-label="照片說明">
      <div class="field"><label>放在哪一趟旅行</label><select class="input" data-lb-trip="${p.id}"><option value="">未分類</option>${sortTrips(trips).reverse().map((x) => `<option value="${x.id}" ${x.id === p.tripId ? 'selected' : ''}>${esc(x.city)}・${x.start.slice(0, 7).replace('-', '.')}</option>`).join('')}</select></div>
      <div class="actions two"><button class="btn primary" data-share-photo="${p.id}">做成分享圖</button>${c ? '' : `<button class="btn" data-ci-photo="${p.id}">用這張打卡</button>`}<button class="btn" data-lib-dl="${p.id}">下載原圖</button><button class="btn danger-text" data-lib-del="${p.id}">刪除</button></div>`, { sheet: 'tall' });
  }

  // ---------- 打卡: a photo, a place and a word, stamped into the trip
  const MOODS = ['好美', '好吃', '好好玩', '好感動', '好放鬆', '想再來'];
  function checkinPlaces(t) {
    const { code } = country(t.n);
    const list = sightsOf(code).map((x, i) => ({ name: x.n, key: `${code}:${i}`, lat: x.lat, lng: x.lng }));
    // Nearest first: to where you are (GPS or the photo's location), otherwise to the trip's city.
    const from = ci.lat != null ? ci : t;
    const near = from.lat != null ? [...list.filter((p) => p.lat != null).sort((a, b) => haversine(from, a) - haversine(from, b)), ...list.filter((p) => p.lat == null)] : list;
    return [{ name: t.city, key: '' }, ...near.slice(0, 9)];
  }
  const ciPlacesHtml = (t) => checkinPlaces(t).map((p) => `<button class="chip ${ci.place === p.name ? 'on' : ''}" data-ci-place="${esc(p.name)}" data-ci-key="${esc(p.key)}">${esc(p.name)}</button>`).join('');
  const ciPhotoHtml = () => {
    const src = ci.preview || (ci.photoId ? libSrc(LIB.find((p) => p.id === ci.photoId) || {}, 'full') : '');
    return `${src ? `<img src="${src}" alt="打卡照片">` : `<div class="ci-empty">${pic('camera')}<b>拍一張，或從相簿選</b><small>沒有照片也能打卡，明信片會用這個地方的風景照</small></div>`}
      <div class="ci-photo-btns"><label class="btn ${src ? 'glass' : 'primary'}"><input type="file" accept="image/*" capture="environment" hidden data-ci-file>拍照</label><label class="btn ${src ? 'glass' : ''}"><input type="file" accept="image/*" hidden data-ci-file>從相簿選</label></div>`;
  };
  function openCheckin(opts = {}) {
    if (!trips.length) { toast('先記錄一趟旅行，就能在旅途中打卡'); openTripForm(); return; }
    const t = trips.find((x) => x.id === opts.tripId) || checkinTrip();
    ci = {
      tripId: t.id, place: opts.place || '', key: opts.key || '', lat: null, lng: null, mood: '', caption: '', file: null, preview: '', photoId: opts.photoId || '',
    };
    openModal('打卡', `
      <div class="ci-photo">${ciPhotoHtml()}</div>
      <div class="field"><label>在哪裡</label><div class="row ci-places" id="ci-places">${ciPlacesHtml(t)}</div>
        <div class="row" style="margin-top:8px"><input class="input grow" id="ci-place" maxlength="40" placeholder="或自己輸入，例如：一蘭拉麵 本店" value="${esc(ci.place)}"><button class="btn" data-ci-gps>${pic('gps')}附近</button></div></div>
      <div class="field"><label>心情</label><div class="row">${MOODS.map((m) => `<button class="chip" data-ci-mood="${m}">${m}</button>`).join('')}</div></div>
      <div class="field"><label for="ci-caption">說一句話</label><input class="input" id="ci-caption" maxlength="60" placeholder="例如：排了 40 分鐘，值得"></div>
      <div class="field"><label for="ci-trip">哪一趟旅行</label><select class="input" id="ci-trip">${sortTrips(trips).reverse().map((x) => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(x.city)}・${x.start.slice(0, 7).replace('-', '.')}${isOngoing(x) ? '（旅行中）' : ''}</option>`).join('')}</select></div>
      <div class="sheet-bar"><span class="small muted">會蓋一個印章在這趟旅行，並做成明信片</span><button class="btn primary" data-ci-save>蓋章打卡</button></div>`, { sheet: 'tall' });
  }
  async function ciPickFile(file) {
    if (!file || !ci) return;
    ci.file = file; ci.photoId = '';
    if (ci.preview) URL.revokeObjectURL(ci.preview);
    ci.preview = URL.createObjectURL(file);
    $('#modal .ci-photo').innerHTML = ciPhotoHtml();
    const head = await file.slice(0, 256 * 1024).arrayBuffer().catch(() => null);
    const exif = head && PDB ? PDB.readExif(head) : {};
    ci.taken = exif.taken || '';
    if (exif.lat != null) {
      ci.lat = exif.lat; ci.lng = exif.lng;
      const t = trips.find((x) => x.id === ci.tripId);
      if (t) $('#ci-places').innerHTML = ciPlacesHtml(t);
    }
  }
  function ciLocate() {
    if (!navigator.geolocation) { toast('這個瀏覽器不能定位'); return; }
    toast('找附近的景點中…');
    navigator.geolocation.getCurrentPosition((pos) => {
      ci.lat = pos.coords.latitude; ci.lng = pos.coords.longitude;
      const t = trips.find((x) => x.id === ci.tripId);
      if (t) $('#ci-places').innerHTML = ciPlacesHtml(t);
      toast('已依你的位置排出附近景點');
    }, () => toast('沒辦法定位，請直接選或輸入地點'), { timeout: 10000 });
  }
  async function saveCheckin(button) {
    const t = trips.find((x) => x.id === ($('#ci-trip')?.value || ci.tripId));
    if (!t) return;
    button.disabled = true; button.textContent = '蓋章中…';
    const typed = $('#ci-place')?.value.trim();
    const place = typed || ci.place || t.city;
    const ongoing = isOngoing(t);
    const date = ongoing ? TODAY : ([ci.taken, LIB.find((p) => p.id === ci.photoId)?.taken].find((d) => d && d >= t.start && d <= t.end) || t.start);
    const c = {
      id: `ci-${uid()}`, date, place, key: typed && typed !== ci.place ? '' : ci.key, lat: ci.lat, lng: ci.lng, mood: ci.mood, caption: $('#ci-caption')?.value.trim() || '', photo: '',
    };
    if (ci.file) {
      const [rec] = await addPhotos([ci.file], { tripId: t.id, checkinId: c.id, caption: c.caption, quiet: true });
      if (rec) c.photo = rec.id;
    } else if (ci.photoId) {
      const p = LIB.find((x) => x.id === ci.photoId);
      if (p) { c.photo = p.id; await updatePhoto(p, { tripId: t.id, checkinId: c.id }); }
    }
    const before = unlockedKeys();
    t.checkins = [...(t.checkins || []), c];
    save();
    renderLibrary(); renderBadgeWall(); renderReview();
    const fresh = unlockedKeys().filter((k) => !before.includes(k));
    showCheckinDone(t, c, fresh);
  }
  const ciPhotoSrc = (t, c) => {
    const p = c?.photo && LIB.find((x) => x.id === c.photo);
    if (p) return libSrc(p, 'full');
    const [code, i] = (c?.key || '').split(':');
    const x = code ? sightsOf(code)[Number(i)] : null;
    return x?.img ? thumbAt(x.img.src, 960) : destPhoto(t.dest)?.src || '';
  };
  const stampBig = (t, c) => `<span class="ci-stamp" style="--ink:${inkOf(c.id)}"><small>${esc(country(t.n).name)}</small><b>${esc((c.place && [...c.place].length <= 5 ? c.place : t.city).slice(0, 5))}</b><small>${esc((c.date || t.start).replace(/-/g, '.'))}</small></span>`;
  function socialNext() {
    const s = stats('all');
    const b = BADGES.filter((x) => x.group === 'social').map((x) => ({ x, st: badgeState(x, s) })).filter((r) => !r.st.ok).sort((a, z) => z.st.pct - a.st.pct)[0];
    if (!b) return '';
    const left = b.st.goal - b.st.v;
    const what = { checkin1: `再打卡 ${left} 次`, checkin10: `再打卡 ${left} 次`, stamps5: `再到 ${left} 座城市打卡`, photo30: `再加 ${left} 張照片`, share3: `再分享 ${left} 次` }[b.x.key] || '';
    return `<button class="ci-next" data-badge="${b.x.key}">${medal(b.x, false, '', { pct: b.st.pct })}<span><small>下一枚徽章</small><b>${what}，解鎖「${esc(b.x.name)}」</b></span></button>`;
  }
  function showCheckinDone(t, c, fresh) {
    const here = (t.checkins || []).length;
    const total = allCheckins().length;
    openModal('打卡完成', `
      <div class="ci-done">
        <figure class="ci-shot">${ciPhotoSrc(t, c) ? `<img src="${esc(ciPhotoSrc(t, c))}" alt="" referrerpolicy="no-referrer">` : ''}${stampBig(t, c)}</figure>
        <h2 class="serif">蓋好章了</h2>
        <p class="muted">${esc(c.place)}・這是你在 ${esc(t.city)} 的第 ${here} 個印章，護照裡一共 ${total} 個。</p>
        ${fresh.map((key) => { const b = BADGES.find((x) => x.key === key); return `<button class="ci-next got" data-badge="${key}">${medal(b, true)}<span><small>解鎖新徽章</small><b>${esc(b.name)}</b><em>${esc(BADGE_LINES[key] || '')}</em></span></button>`; }).join('') || socialNext()}
        <div class="actions two"><button class="btn primary" data-share-ci="${t.id}:${c.id}">分享這張明信片</button><button class="btn" data-checkin="${t.id}">再打一個卡</button></div>
      </div>`);
    buzz();
    setTimeout(() => burst($('#modal .ci-stamp'), fresh.length ? 28 : 16), 420);
  }
  function openCheckinView(tripId, id) {
    const t = trips.find((x) => x.id === tripId);
    const c = t && (t.checkins || []).find((x) => x.id === id);
    if (!c) return;
    openModal(`${flag(country(t.n).code)} ${esc(c.place)}`, `
      <div class="ci-done">
        <figure class="ci-shot">${ciPhotoSrc(t, c) ? `<img src="${esc(ciPhotoSrc(t, c))}" alt="" referrerpolicy="no-referrer">` : ''}${stampBig(t, c)}</figure>
        <p class="muted">${esc(t.city)}・${esc((c.date || '').replace(/-/g, '.'))}${c.mood ? `・${esc(c.mood)}` : ''}</p>
        ${c.caption ? `<p class="badge-line">「${esc(c.caption)}」</p>` : ''}
        <div class="actions two"><button class="btn primary" data-share-ci="${t.id}:${c.id}">分享</button>${c.photo ? `<button class="btn" data-lib-photo="${c.photo}">看照片</button>` : ''}<button class="btn" data-trip="${t.id}">這趟旅行</button><button class="btn danger-text" data-ci-del="${t.id}:${c.id}">刪除這個打卡</button></div>
      </div>`);
  }

  // ---------- 分享工作室: pick a template, see it, send it anywhere
  const studio = { ctx: null, tpl: '', blob: null, url: '', run: 0 };
  function bumpShare() {
    const before = unlockedKeys();
    settings.shares = shareCount() + 1;
    save(); renderBadgeWall();
    const fresh = unlockedKeys().filter((k) => !before.includes(k));
    if (fresh.length) setTimeout(() => toast(`解鎖新徽章「${BADGES.find((b) => b.key === fresh[0]).name}」`), 900);
  }
  const tag = (s) => `#${String(s || '').replace(/[\s・·,，、()（）.。!！?？/]/g, '')}`;
  const ctxCheckin = (ctx) => {
    if (ctx.kind === 'photo') {
      const photo = LIB.find((x) => x.id === ctx.photoId);
      const t = trips.find((x) => x.id === photo?.tripId) || checkinTrip();
      return { t, c: (t?.checkins || []).find((x) => x.photo === photo?.id), photo };
    }
    const t = trips.find((x) => x.id === ctx.tripId);
    const c = (t?.checkins || []).find((x) => x.id === ctx.checkinId);
    const photo = (c?.photo && LIB.find((x) => x.id === c.photo)) || (!c && t ? tripPhotos(t.id).slice(-1)[0] : null);
    return { t, c, photo };
  };
  function shareTemplates(ctx) {
    if (ctx.kind === 'checkin' || ctx.kind === 'photo') return [['postcard', '明信片'], ['story', '限時動態'], ['passport', '護照印章'], ['footprint', '足跡地圖']];
    if (ctx.kind === 'badge') return [['badge', '徽章卡'], ['footprint', '足跡地圖'], ['passport', '護照印章']];
    return [['footprint', '足跡地圖'], ['passport', '護照印章']];
  }
  function shareText(ctx) {
    const brand = tag(CONFIG.brand);
    if (ctx.kind === 'badge') {
      const b = BADGES.find((x) => x.key === ctx.key);
      return `我解鎖了「${b.name}」徽章！${BADGE_LINES[b.key] || ''}\n#旅行徽章 ${brand}`;
    }
    if (ctx.kind === 'checkin' || ctx.kind === 'photo') {
      const { t, c } = ctxCheckin(ctx);
      if (!t) return brand;
      const where = c?.place && c.place !== t.city ? `${c.place}（${t.city}）` : t.city;
      return `在 ${where} 打卡${c?.mood ? `｜${c.mood}` : ''}${c?.caption ? `\n「${c.caption}」` : ''}\n${tag(t.city)} ${tag(`${country(t.n).name}旅行`)} ${brand}`;
    }
    const s = stats(ctx.year || 'all');
    return `${ctx.year && ctx.year !== 'all' ? `${ctx.year} 年` : '這兩年'}我去了 ${s.countries.size} 個國家、${s.cities.size} 座城市，飛了 ${fmt(s.km)} 公里。\n#旅行足跡 ${brand}`;
  }
  function shareLink(ctx) {
    const base = `${window.location.origin}${window.location.pathname}`;
    if (ctx.kind === 'badge') {
      const b = BADGES.find((x) => x.key === ctx.key);
      const at = badgeUnlocked(b, stats('all').list);
      return `${base}#badge=${b64url({ f: user?.name || '', k: b.key, d: at?.end || '', c: at?.city || '' })}`;
    }
    if (ctx.kind === 'checkin' || ctx.kind === 'photo') {
      const { t, c } = ctxCheckin(ctx);
      if (t) {
        return `${base}#checkin=${b64url({
          f: user?.name || '', c: t.city, n: t.n, s: t.dest || '', p: c?.place || t.city, k: c?.key || '', d: c?.date || t.start, m: c?.mood || '', t: (c?.caption || '').slice(0, 80),
        })}`;
      }
    }
    return albumLink(albumData(ctx.year && ctx.year !== 'all' ? Number(ctx.year) : CONFIG.years[CONFIG.years.length - 1]));
  }
  function yearColors(list) {
    const ys = {};
    list.forEach((t) => { ys[t.n] = ys[t.n] || new Set(); ys[t.n].add(tripYear(t)); });
    const css = getComputedStyle(document.documentElement);
    const col = (v, fb) => css.getPropertyValue(v).trim() || fb;
    const out = {};
    Object.entries(ys).forEach(([n, set]) => {
      if (set.size > 1) out[n] = col('--both', '#7c4dff');
      else out[n] = set.has(2025) ? col('--y25', '#0fa597') : col('--y26', '#f2711c');
    });
    return out;
  }
  const badgeSvg = (b) => {
    const body = b.tag ? PICS[b.tag] : (BADGE_PICS[b.key] || '').replace(/JET/g, JET);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="480" height="480"><defs>${$('.art-defs defs')?.innerHTML || ''}</defs>${body}</svg>`;
  };
  async function studioData(ctx, tpl) {
    const { brand } = CONFIG;
    const name = user?.name || '';
    const year = ctx.year || 'all';
    const range = year === 'all' ? CONFIG.years.join('–') : String(year);
    if (tpl === 'postcard' || tpl === 'story') {
      const { t, c, photo } = ctxCheckin(ctx);
      const p = photo ? await fullPhoto(photo) : null;
      const [code, i] = (c?.key || '').split(':');
      const sight = code ? sightsOf(code)[Number(i)] : null;
      const cs = allCheckins().slice().reverse();
      return {
        photo: p ? libSrc(p, 'full') : '', fallbackPhoto: sight?.img ? thumbAt(sight.img.src, 1280) : destPhoto(t.dest)?.src || '', city: t.city, place: c?.place && c.place !== t.city ? c.place : '',
        country: country(t.n).name, flag: flagSrc(country(t.n).code), date: (c?.date || p?.taken || t.start).replace(/-/g, '.'), caption: c?.caption || p?.caption || '', mood: c?.mood || '',
        name, brand, count: c ? cs.findIndex((x) => x.id === c.id) + 1 : 0, ink: c ? inkOf(c.id) : '#c8102e',
      };
    }
    if (tpl === 'passport') {
      const list = tripsIn(year);
      const cs = allCheckins(list).slice().reverse();
      // Check-ins first, then an entry stamp for every trip without one, so the page fills up like a real passport.
      const stamped = new Set(cs.map((c) => c.trip.id));
      const stamps = [
        ...cs.map((c) => ({ city: c.place && [...c.place].length <= 5 ? c.place : c.trip.city, country: country(c.trip.n).name, date: (c.date || '').replace(/-/g, '.') })),
        ...list.filter((t) => !isUpcoming(t) && !stamped.has(t.id)).map((t) => ({ city: t.city, country: country(t.n).name, date: t.start.replace(/-/g, '.') })),
      ];
      return {
        title: '入境紀錄', subtitle: `${name ? `${name}・` : ''}${range}`, stamps, summary: `${cs.length ? `${cs.length} 個打卡・` : ''}${list.filter((t) => !isUpcoming(t)).length} 趟旅行・${new Set(list.filter((t) => !isUpcoming(t)).map((t) => t.n)).size} 個國家`, brand,
      };
    }
    if (tpl === 'footprint') {
      const s = stats(year);
      return {
        title: year === 'all' ? '我的旅行足跡' : `我的 ${year} 足跡`, subtitle: `${name ? `${name}・` : ''}${range}`, visited: yearColors(s.past), home: [home().lng, home().lat],
        routes: s.past.filter((t) => t.lng != null).map((t) => ({ from: [home().lng, home().lat], to: [t.lng, t.lat] })),
        stats: [[s.countries.size, '國家・地區'], [s.cities.size, '城市'], [fmt(s.km), '飛行公里'], [s.days, '旅行天數']],
        legend: year === 'all' ? [['#0fa597', '2025'], ['#f2711c', '2026'], ['#7c4dff', '兩年都去']] : [], brand,
      };
    }
    const b = BADGES.find((x) => x.key === ctx.key);
    const s = stats('all');
    const at = badgeUnlocked(b, s.list);
    return {
      picSvg: badgeSvg(b), m1: b.color[0], m2: b.color[1], name: b.name, line: BADGE_LINES[b.key] || '', sub: at ? `${at.end.replace(/-/g, '.')}・在 ${at.city} 解鎖` : '',
      progress: `已收集 ${BADGES.filter((x) => badgeState(x, s).ok).length} / ${BADGES.length} 枚徽章`, brand,
    };
  }
  const TARGETS = [
    ['native', '分享到…', '#1d1b17'], ['ig', 'IG 限動', 'linear-gradient(45deg,#f9a03f,#d92e7f 55%,#6a36d9)'], ['line', 'LINE', '#06c755'], ['fb', 'Facebook', '#1877f2'],
    ['threads', 'Threads', '#111'], ['x', 'X', '#111'], ['dl', '存圖片', '#6b655a'], ['copy', '複製文字', '#6b655a'], ['link', '複製連結', '#6b655a'],
  ];
  const TARGET_MARK = {
    native: '<svg viewBox="0 0 24 24"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>', ig: 'IG', line: 'LINE', fb: 'f', threads: '@', x: 'X',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/></svg>', copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  };
  function openStudio(ctx) {
    if ((ctx.kind === 'checkin' || ctx.kind === 'photo') && !ctxCheckin(ctx).t) { toast('先記錄一趟旅行，再把照片做成分享圖'); return; }
    studio.ctx = ctx;
    [[studio.tpl]] = shareTemplates(ctx);
    openModal('分享', `
      <div class="studio">
        <div class="studio-preview" id="studio-preview"><span class="studio-wait">製作中…</span></div>
        <div class="seg seg-full" id="studio-tpl" role="tablist" aria-label="圖片樣式">${shareTemplates(ctx).map(([k, l]) => `<button data-tpl="${k}" class="${k === studio.tpl ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="share-targets">${TARGETS.filter(([k]) => k !== 'native' || navigator.share).map(([k, l, bg], i) => `<button data-st="${k}" style="--d:${i * 35}ms"><span class="st-mark" style="background:${bg}">${TARGET_MARK[k]}</span>${l}</button>`).join('')}</div>
        <div class="field"><label for="studio-text">貼文文字（分享時會一起帶上，也可以自己改）</label><textarea class="input" id="studio-text" rows="3">${esc(shareText(ctx))}</textarea></div>
        <p class="small muted">分享到 IG、LINE 或 Facebook 都算一次分享，分享 3 次會解鎖「分享家」徽章。朋友點連結會看到你的打卡，也能開始記錄自己的旅行。</p>
      </div>`, { sheet: 'tall' });
    renderStudio();
  }
  async function renderStudio() {
    const box = $('#studio-preview');
    if (!box || !window.TravelStudio) return;
    studio.run += 1;
    const { run } = studio;
    box.classList.add('busy');
    box.dataset.tpl = studio.tpl;
    try {
      const cv = await window.TravelStudio[studio.tpl](await studioData(studio.ctx, studio.tpl));
      const blob = await window.TravelStudio.toBlob(cv);
      if (run !== studio.run) return;
      studio.blob = blob;
      if (studio.url) URL.revokeObjectURL(studio.url);
      studio.url = URL.createObjectURL(blob);
      box.innerHTML = `<img src="${studio.url}" alt="分享圖預覽">`;
    } catch {
      if (run === studio.run) box.innerHTML = '<span class="studio-wait">圖片做不出來，換一個樣式試試</span>';
    }
    box.classList.remove('busy');
  }
  async function studioShare(where, button) {
    if (where === 'ig' && studio.tpl !== 'story' && shareTemplates(studio.ctx).some(([k]) => k === 'story')) {
      studio.tpl = 'story';
      $$('#studio-tpl [data-tpl]').forEach((b) => b.classList.toggle('on', b.dataset.tpl === 'story'));
      await renderStudio();
    }
    if (!studio.blob && !['copy', 'link', 'line', 'fb', 'threads', 'x'].includes(where)) { toast('圖片還在製作，請稍等一下'); return; }
    const text = $('#studio-text')?.value || shareText(studio.ctx);
    const link = shareLink(studio.ctx);
    const file = studio.blob ? new File([studio.blob], `${CONFIG.brand}-${studio.tpl}.jpg`, { type: 'image/jpeg' }) : null;
    const pop = (url) => window.open(url, '_blank', 'noopener');
    const copy = async (value, done) => {
      try { await navigator.clipboard.writeText(value); toast(done); } catch { toast('這個瀏覽器不能自動複製，請長按文字框複製'); }
    };
    if (button && !REDUCED) button.animate([{ transform: 'scale(1)' }, { transform: 'scale(.9)' }, { transform: 'scale(1)' }], { duration: 260 });
    if (where === 'native' || where === 'ig') {
      if (file && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], text: `${text}\n${link}` }); bumpShare(); } catch { /* cancelled */ }
        return;
      }
      if (file) saveFile(file);
      if (where === 'ig') { copy(text, '圖片已存好、文字已複製：打開 Instagram →「限時動態」選這張'); bumpShare(); return; }
      if (navigator.share) { try { await navigator.share({ text, url: link }); bumpShare(); } catch { /* cancelled */ } }
      return;
    }
    const urls = {
      line: `https://line.me/R/share?text=${encodeURIComponent(`${text}\n${link}`)}`,
      fb: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
      threads: `https://www.threads.net/intent/post?text=${encodeURIComponent(`${text}\n${link}`)}`,
      x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`,
    };
    if (urls[where]) {
      if (where === 'fb') copy(text, '貼文文字已複製，在 Facebook 貼上就好');
      pop(urls[where]);
      bumpShare();
      return;
    }
    if (where === 'dl') { saveFile(file); toast('圖片已存好，可以發到任何社群'); bumpShare(); return; }
    if (where === 'copy') { copy(text, '貼文文字已複製'); return; }
    if (where === 'link') { copy(link, '連結已複製，貼給朋友就能看到'); bumpShare(); }
  }

  // ---------- links friends open: a check-in postcard or a badge, with a way to start their own
  function readSharedPost() {
    const m = window.location.hash.match(/^#(checkin|badge)=([\w-]+)/);
    if (!m) return null;
    try {
      const d = fromB64url(m[2]);
      return m[1] === 'checkin'
        ? {
          kind: 'checkin', f: String(d.f || '').slice(0, 20), c: String(d.c || '').slice(0, 30), n: String(d.n || ''), s: DEST[d.s] ? d.s : '', p: String(d.p || '').slice(0, 40), k: /^[A-Z]{2}:\d+$/.test(d.k || '') ? d.k : '',
          d: /^\d{4}-\d\d-\d\d$/.test(d.d || '') ? d.d : '', m: String(d.m || '').slice(0, 10), t: String(d.t || '').slice(0, 80),
        }
        : { kind: 'badge', f: String(d.f || '').slice(0, 20), k: BADGES.some((b) => b.key === d.k) ? d.k : '', d: /^\d{4}-\d\d-\d\d$/.test(d.d || '') ? d.d : '', c: String(d.c || '').slice(0, 30) };
    } catch { return null; }
  }
  function openSharedPost(d) {
    if (d.kind === 'badge') {
      const b = BADGES.find((x) => x.key === d.k);
      if (!b) return;
      openModal(`${esc(d.f || '朋友')}解鎖了徽章`, `
        <div class="ci-done shared">
          <div class="shared-medal">${medal(b, true, 'xl')}</div>
          <h2 class="serif">${esc(b.name)}</h2>
          ${BADGE_LINES[b.key] ? `<p class="badge-line">「${BADGE_LINES[b.key]}」</p>` : ''}
          <p class="muted">${esc(d.f || '朋友')}${d.c ? ` 在 ${esc(d.c)}` : ''}${d.d ? `・${d.d.replace(/-/g, '.')}` : ''} 解鎖・${esc(b.desc)}</p>
          <div class="actions"><button class="btn primary" data-shared-start>我也要收集徽章</button></div>
        </div>`);
      return;
    }
    const { code } = country(d.n);
    const [sc, si] = d.k.split(':');
    const sight = sc ? sightsOf(sc)[Number(si)] : null;
    const photo = sight?.img ? thumbAt(sight.img.src, 960) : (d.s && destPhoto(d.s)?.src) || '';
    const fake = { id: `${d.c}${d.d}`, place: d.p, date: d.d };
    openModal(`${esc(d.f || '朋友')}的打卡`, `
      <div class="ci-done shared">
        <figure class="ci-shot">${photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">` : ''}${stampBig({ n: d.n, city: d.c, start: d.d }, fake)}</figure>
        <span class="kicker plain muted">${flag(code)} ${esc(country(d.n).name || '')}・${esc(d.d.replace(/-/g, '.'))}</span>
        <h2 class="serif">${esc(d.p || d.c)}</h2>
        ${d.t || d.m ? `<p class="badge-line">「${esc([d.m, d.t].filter(Boolean).join('｜'))}」</p>` : ''}
        <div class="actions two">${d.s ? `<button class="btn" data-dest="${d.s}">看 ${esc(d.c)} 的景點與門票</button>` : ''}<button class="btn primary" data-shared-start>我也要記錄我的旅行</button></div>
      </div>`);
  }

  document.addEventListener('change', (e) => {
    const node = e.target;
    if ('libAdd' in node.dataset && node.files?.length) { addPhotos(node.files); node.value = ''; return; }
    if ('ciFile' in node.dataset && node.files?.length) { ciPickFile(node.files[0]); return; }
    if (node.id === 'ci-trip') { ci.tripId = node.value; const tr = trips.find((x) => x.id === node.value); if (tr) $('#ci-places').innerHTML = ciPlacesHtml(tr); return; }
    const p = LIB.find((x) => x.id === (node.dataset.lbCaption || node.dataset.lbTrip));
    if (p && node.dataset.lbCaption) { updatePhoto(p, { caption: node.value.trim().slice(0, 80) }); return; }
    if (p && node.dataset.lbTrip !== undefined) { updatePhoto(p, { tripId: node.value }).then(() => { renderLibrary(); toast('已移到這趟旅行'); }); }
  });
  // Photos dragged onto the library from a computer.
  ['dragenter', 'dragover'].forEach((type) => document.addEventListener(type, (e) => {
    const grid = e.target.closest?.('#lib-grid, #photos-title');
    if (!grid || !e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    $('#lib-grid').classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((type) => document.addEventListener(type, () => $('#lib-grid')?.classList.remove('drag')));
  document.addEventListener('drop', (e) => {
    if (!e.target.closest?.('#lib-grid, #photos-title') || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addPhotos(e.dataTransfer.files);
  });

  $('#plan-alt').addEventListener('submit', (e) => {
    const form = e.target.closest('[data-cal-add]');
    if (!form) return;
    e.preventDefault();
    const [id, day] = form.dataset.calAdd.split(':');
    const x = trips.find((v) => v.id === id);
    const text = form.querySelector('input').value.trim();
    if (!x || !text) return;
    ensurePlan(x);
    const m = text.match(/^(\d{1,2})[:：](\d{2})\s*(.+)$/);
    const item = m ? newItem(m[3], `${m[1].padStart(2, '0')}:${m[2]}`) : newItem(text, '');
    x.plan.days[Number(day)].push(item);
    x.plan.days[Number(day)].sort(byTime);
    save(); renderCover();
    renderPlanAlt(planTrip());
    toast(`已加到 Day ${Number(day) + 1}`);
  });
  window.addEventListener('afterprint', () => document.documentElement.classList.remove('print-plan'));

  // ---------- the check-in button that follows you on 首頁 and 足跡
  function renderFab() {
    const fab = $('#ci-fab');
    if (fab) fab.hidden = !user || !['map', 'trips'].includes(currentTab);
  }

  // ---------- delegated actions
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, li[data-trip], [data-trip]');
    if (!t) return;
    const ds = t.dataset;
    if (ds.planView) { planView = ds.planView; store.set('planView', planView); renderPlanner(); return; }
    if (ds.ptOpen) {
      const [id, day] = ds.ptOpen.split(':');
      modal.close();
      planView = 'timeline'; store.set('planView', planView); openItems.add(id);
      renderPlanner();
      setTimeout(() => ($(`#plan-days [data-id="${id}"]`) || $(`#day-${day}`))?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' }), 60);
      return;
    }
    if (ds.planDay) {
      const [id, day] = ds.planDay.split(':');
      planView = 'timeline'; store.set('planView', planView);
      openPlanner(id, Number(day));
      if (currentTab === 'plan') setTimeout(() => $(`#day-${day}`)?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }), 60);
      return;
    }
    const planT = (id) => { const x = trips.find((v) => v.id === id); if (x) ensurePlan(x); return x; };
    if (ds.ptCopy) {
      const x = planT(ds.ptCopy);
      if (x) navigator.clipboard?.writeText(planText(x)).then(() => toast('行程文字已複製，可以貼到 LINE 群組'), () => toast('這個瀏覽器不能自動複製'));
      return;
    }
    if (ds.ptCsv) { const x = planT(ds.ptCsv); if (x) { saveFile(new File([planCsv(x)], `${x.city}-行程表.csv`, { type: 'text/csv' })); toast('已下載，可以用 Excel 或 Google 試算表打開'); } return; }
    if ('ptPrint' in ds) { document.documentElement.classList.add('print-plan'); setTimeout(() => window.print(), 50); return; }
    if (ds.ics) { const x = planT(ds.ics); if (x) openIcs(x); return; }
    if (ds.icsDl) {
      const x = planT(ds.icsDl);
      if (x) { saveFile(new File([tripIcs(x)], `${x.city}-行程.ics`, { type: 'text/calendar' })); toast('已下載行事曆檔，打開它就會加入行事曆'); }
      return;
    }
    if (ds.calNav) {
      const [y, m] = calMonth.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(ds.calNav), 1);
      calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const inMonth = sortTrips(trips).find((x) => x.start.slice(0, 7) === calMonth);
      calDay = inMonth ? inMonth.start : `${calMonth}-01`;
      renderPlanAlt(planTrip());
      return;
    }
    if ('calToday' in ds) { calMonth = TODAY.slice(0, 7); calDay = TODAY; renderPlanAlt(planTrip()); return; }
    if (ds.calJump) { calMonth = ds.calJump.slice(0, 7); calDay = ds.calJump; renderPlanAlt(planTrip()); return; }
    if (ds.calDay) {
      if (ds.calDay.slice(0, 7) !== calMonth) { calMonth = ds.calDay.slice(0, 7); calDay = ds.calDay; renderPlanAlt(planTrip()); } else setCalDay(ds.calDay);
      return;
    }
    if (ds.calTrip) {
      const x = trips.find((v) => v.id === ds.calTrip);
      if (!x) return;
      planTripId = x.id;
      if ($('#plan-switch')) $('#plan-switch').value = x.id;
      const start = x.start.slice(0, 7) === calMonth ? x.start : `${calMonth}-01`;
      setCalDay(start < x.start ? x.start : start);
      return;
    }
    if (ds.tripOn) {
      openTripForm();
      const [from, to] = [$('#f-start'), $('#f-end')];
      if (from && to) { from.value = ds.tripOn; to.value = addDays(ds.tripOn, 4); from.dispatchEvent(new Event('change', { bubbles: true })); }
      return;
    }
    if (ds.checkin !== undefined) { openCheckin({ tripId: ds.checkin || undefined }); return; }
    if (ds.ciSight) {
      const [code, i] = ds.ciSight.split(':');
      const x = sightsOf(code)[Number(i)];
      const trip = trips.find((v) => isOngoing(v) && country(v.n).code === code) || sortTrips(trips.filter((v) => country(v.n).code === code)).reverse()[0];
      openCheckin({ tripId: trip?.id, place: x?.n || '', key: ds.ciSight });
      return;
    }
    if (ds.ciPhoto) { const p = LIB.find((x) => x.id === ds.ciPhoto); openCheckin({ tripId: p?.tripId, photoId: ds.ciPhoto }); return; }
    if (ds.ciPlace !== undefined) {
      ci.place = ds.ciPlace; ci.key = ds.ciKey || '';
      $$('#ci-places [data-ci-place]').forEach((b) => b.classList.toggle('on', b === t));
      $('#ci-place').value = ds.ciPlace;
      return;
    }
    if (ds.ciMood) { ci.mood = ci.mood === ds.ciMood ? '' : ds.ciMood; $$('[data-ci-mood]').forEach((b) => b.classList.toggle('on', b.dataset.ciMood === ci.mood)); return; }
    if ('ciGps' in ds) { ciLocate(); return; }
    if ('ciSave' in ds) { saveCheckin(t); return; }
    if (ds.ciOpen) { const [tripId, id] = ds.ciOpen.split(':'); openCheckinView(tripId, id); return; }
    if (ds.ciDel) {
      const [tripId, id] = ds.ciDel.split(':');
      askConfirm('刪除這個打卡？', '印章會拿掉，照片會留在照片庫。', '刪除', () => {
        const trip = trips.find((x) => x.id === tripId);
        if (trip) trip.checkins = (trip.checkins || []).filter((c) => c.id !== id);
        LIB.filter((p) => p.checkinId === id).forEach((p) => updatePhoto(p, { checkinId: '' }));
        save(); renderLibrary(); renderBadgeWall();
      });
      return;
    }
    if (ds.libPhoto) {
      if ($('#lib-grid')?.classList.contains('selecting') && t.closest('#lib-grid')) {
        if (libSel.has(ds.libPhoto)) libSel.delete(ds.libPhoto); else libSel.add(ds.libPhoto);
        renderLibrary();
        return;
      }
      openPhoto(ds.libPhoto);
      return;
    }
    if (ds.libFilter) { libFilter = ds.libFilter; libShown = 60; renderLibrary(); return; }
    if ('libMore' in ds) { libShown += 90; renderLibrary(); return; }
    if ('libSelect' in ds) { libSelecting = !libSelecting; libSel.clear(); renderLibrary(); return; }
    if (ds.libAct) { libAction(ds.libAct); return; }
    if (ds.libDl) {
      const p = LIB.find((x) => x.id === ds.libDl);
      if (p) fullPhoto(p).then(() => saveFile(new File([p.full || p.thumb], `travel-${p.taken || 'photo'}.jpg`, { type: 'image/jpeg' })));
      return;
    }
    if (ds.libDel) {
      askConfirm('刪除這張照片？', '會從這支手機和雲端備份一起刪掉。', '刪除', async () => { await deletePhoto(ds.libDel); renderLibrary(); renderBadgeWall(); });
      return;
    }
    if (ds.sharePhoto) { openStudio({ kind: 'photo', photoId: ds.sharePhoto }); return; }
    if (ds.shareCi) { const [tripId, checkinId] = ds.shareCi.split(':'); openStudio({ kind: 'checkin', tripId, checkinId }); return; }
    if (ds.shareTrip) { openStudio({ kind: 'checkin', tripId: ds.shareTrip }); return; }
    if (ds.shareBadge) { openStudio({ kind: 'badge', key: ds.shareBadge }); return; }
    if (ds.shareYear) { openStudio({ kind: 'year', year: ds.shareYear }); return; }
    if (ds.tpl) { studio.tpl = ds.tpl; $$('#studio-tpl [data-tpl]').forEach((b) => b.classList.toggle('on', b === t)); renderStudio(); return; }
    if (ds.st) { studioShare(ds.st, t); return; }
    if ('sharedStart' in ds) { modal.close(); window.history.replaceState(null, '', window.location.pathname); if (user) openCheckin(); return; }
    if ('flip' in ds) { t.closest('.tcard').classList.toggle('flipped'); return; }
    if (ds.badge) { openBadge(ds.badge, ds.by || 'all'); return; }
    if (ds.tickets) { openTickets(ds.tickets); return; }
    if (ds.review) { go('trips'); setTimeout(() => $('#review')?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }), 380); return; }
    if (ds.yearPick) { $(`#year-seg [data-year="${ds.yearPick}"]`)?.click(); return; }
    if (ds.recTag) { recState.tags = [ds.recTag]; go('recs'); renderRecs(); return; }
    if (ds.sightMap) { const [code, i] = ds.sightMap.split(':'); showSightOnMap(code, Number(i)); return; }
    if (ds.sight) { const [code, i] = ds.sight.split(':'); openSight(code, Number(i)); return; }
    if ('mcClose' in ds) { closeMapCountry(); return; }
    if (ds.badgeWall) { openBadgeWall(ds.badgeWall); return; }
    if (ds.log) { toggleLog(ds.log, ds.kind, ds.name); return; }
    if (ds.yearCard) { openShare(ds.yearCard); return; }
    if (ds.cardDl) { saveTravelCard(ds.cardDl, t); return; }
    if (ds.countryN) { openCountry(ds.countryN); return; }
    if ('cards' in ds) { go('trips'); setTimeout(() => $('#cards-title')?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }), 380); return; }
    if (ds.plan !== undefined) { openPlan(ds.plan, ds.for ? { forCountry: ds.for } : {}); return; }
    if ('random' in ds) { openRandom(); return; }
    if ('syncNow' in ds) { pushNow(); return; }
    if ('installApp' in ds) { installApp(); return; }
    if ('installDismiss' in ds) { store.set('installDismissed', true); renderInstall(); return; }
    if ('lineLogin' in ds) { lineLogin(); return; }
    if (ds.album) { openAlbum(Number(ds.album)); return; }
    if (ds.countryCode) { openCountry(COUNTRIES[ds.countryCode].n); return; }
    if (ds.claim) { claimCard(ds.claim); return; }
    if (ds.share) { openGiftShare(ds.share); return; }
    if (ds.install) { openInstall(ds.install); return; }
    if (ds.activate) { activateCard(ds.activate); return; }
    if (ds.cardOpen) { openCardDetail(ds.cardOpen); return; }
    if (ds.guide) { openGuide(ds.guide); return; }
    if (ds.esimTab) { esimTab = ds.esimTab; renderWallet(); animateIn($('#wallet')); return; }
    if (ds.scroll) {
      if (modal.open) modal.close();
      go('esim');
      setTimeout(() => $(`#${ds.scroll}`)?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }), 380);
      return;
    }
    if (ds.ai) { openAi(ds.ai); return; }
    if (ds.wish) {
      wish = wish.includes(ds.wish) ? wish.filter((x) => x !== ds.wish) : [...wish, ds.wish];
      save();
      $$(`[data-wish="${ds.wish}"]`).forEach((b) => { const on = wish.includes(ds.wish); b.textContent = on ? '♥' : '♡'; b.setAttribute('aria-pressed', on); });
      toast(wish.includes(ds.wish) ? '已加入願望清單' : '已從願望清單移除');
      return;
    }
    if (ds.show) { const d = DEST[ds.show]; showOnMap(d.lng, d.lat); return; }
    if (ds.near) { const tr = trips.find((x) => x.id === ds.near); if (tr) nearFrom(tr.lat, tr.lng, tr.city, `trip:${tr.id}`); return; }
    if (ds.dest) { const d = DEST[ds.dest]; nearFrom(d.lat, d.lng, d.name, `dest:${d.id}`); return; }
    if (ds.origin) { popChip = `[data-origin="${CSS.escape(ds.origin)}"]`; setOrigin(ds.origin); return; }
    if (ds.tag) { popChip = `[data-tag="${ds.tag}"]`; recState.tags = recState.tags.includes(ds.tag) ? recState.tags.filter((x) => x !== ds.tag) : [...recState.tags, ds.tag]; renderRecs(); return; }
    if (ds.region) { esimRegion = ds.region; $('#esim-search').value = ''; renderEsim(); return; }
    if ('esimNear' in ds) { esimNear = !esimNear; renderEsim(); return; }
    if (ds.openPlan) { if (modal.open) modal.close(); openPlanner(ds.openPlan, ds.day != null ? Number(ds.day) : null); return; }
    if (ds.tripDest) { openTripForm(null, null, ds.tripDest); return; }
    if (ds.edit) { if (modal.open) modal.close(); openTripForm(ds.edit); return; }
    if (ds.tripNew) { openTripForm(null, ds.tripNew); return; }
    if (ds.trip) openTrip(ds.trip);
  });

  // ---------- render all
  function renderAll() {
    setTimeout(moveInk, 0);
    renderInstall(); renderOnline();
    document.title = CONFIG.brand;
    $$('[data-brand]').forEach((n) => { n.textContent = CONFIG.brand; });
    $$('#year-seg button').forEach((b) => b.classList.toggle('on', b.dataset.year === settings.year));
    renderCover(); renderHero(); renderStats(); renderMapRecs(); renderReview(); renderRecs(); renderEsim(); renderTrips(); renderCards(); renderBadgeWall(); renderQuickArt(); renderLibrary(); renderFab();
    if (currentTab === 'plan') renderPlanner();
    drawMap();
    animateIn($(`[data-view="${currentTab}"]`));
  }

  async function loadConfig() {
    try {
      const res = await fetch('api/status');
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return;
      const data = await res.json();
      Object.assign(CONFIG, {
        ai: Boolean(data.ai), brand: data.brand || CONFIG.brand, esimUrl: data.esimUrl || CONFIG.esimUrl, guideVideo: data.guideVideo || '', liff: data.liff || '',
      });
    } catch { /* static preview without the API */ }
  }

  applyTheme();
  migrateOrders();
  pendingGift = readGift();
  const sharedAlbum = readSharedAlbum();
  const sharedPost = readSharedPost();
  $('#ci-fab .ci-fab-art').innerHTML = pic('camera');
  window.addEventListener('hashchange', () => { const g = readGift(); if (g) { pendingGift = g; if (user) openGift(g); } });
  Promise.all([loadConfig(), loadPhotos(), loadLibrary()]).finally(() => {
    if (user) showApp(); else showLogin();
    if (sharedAlbum) openAlbum(sharedAlbum.year, sharedAlbum);
    if (sharedPost) openSharedPost(sharedPost);
    // Inside the LINE app, coming back from LINE login, or on a later visit: sign in without another tap.
    if (CONFIG.liff && !sharedAlbum) {
      // Every visit with an active LINE login pulls, so changes made on another phone show up here.
      loadLiff().then((liff) => { if (liff?.isLoggedIn() && (!user || user.line || liff.isInClient())) lineLogin(); });
    }
  });
}());
