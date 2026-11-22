/* 旅圖 eSIM：前端邏輯。資料存在瀏覽器 localStorage（示範版），地圖用 d3 + world-atlas。 */
(function main() {
  const {
    ELEMENTS, REGIONS, RATES, COUNTRIES, DESTS, PACKS, HOMES, WIKI,
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
  const flag = (code) => (code && code.length === 2
    ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '🌐');
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
  const DEST = Object.fromEntries(DESTS.map((d) => [d.id, d]));
  const el = (key) => ELEMENTS[key] || { label: key, icon: '•' };
  const TAG_COLORS = {
    food: ['#ff8a3d', '#e2453c'], culture: ['#b5651d', '#7a3b12'], nature: ['#2fb36d', '#11704a'], island: ['#19b5d8', '#1463ff'],
    city: ['#6a5cff', '#2b2e8f'], shopping: ['#ff5fa2', '#b0306f'], onsen: ['#ff7e6b', '#a8435a'], snow: ['#6fb7ff', '#3a5bd9'],
    family: ['#ffb020', '#ef6c00'], night: ['#5b3cc4', '#1b1446'], art: ['#e05297', '#6c2bd9'], adventure: ['#3aa45a', '#0f5e6e'],
  };
  const DEST_EMOJI = {
    food: '🍜', culture: '⛩️', nature: '🏔️', island: '🏝️', city: '🏙️', shopping: '🛍️', onsen: '♨️', snow: '🏂', family: '🎡', night: '🌃', art: '🎨', adventure: '🪂',
  };

  let world = null;
  const country = (n) => NUM[n] || { name: world?.byId.get(n)?.properties?.name || '未知地區', code: '', region: '', base: 0 };

  // ---------- state
  let user = store.get('user', null);
  let trips = store.get('trips', []);
  let orders = store.get('orders', []);
  let wish = store.get('wish', []);
  const settings = {
    year: 'all', home: 'TPE', theme: '', usage: { maps: 2, social: 1.5, video: 0.5, share: 0 }, ...store.get('settings', {}),
  };
  const recState = {
    origin: null, tags: [], month: new Date().getMonth() + 1, hours: 0, fee: 'any', unvisited: false, gps: null,
  };
  const home = () => HOMES[settings.home] || HOMES.TPE;
  const save = () => {
    store.set('user', user); store.set('trips', trips); store.set('orders', orders); store.set('wish', wish); store.set('settings', settings);
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

  function stats(year) {
    const list = tripsIn(year);
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
    };
  }

  const BADGES = [
    { icon: '🌏', name: '亞洲通', desc: '去 4 個亞洲國家/地區', progress: (s) => [s.byRegion.asia || 0, 4] },
    { icon: '✈️', name: '跨洲旅人', desc: '足跡跨 2 個洲', progress: (s) => [s.regions.size, 2] },
    { icon: '🍜', name: '美食獵人', desc: '3 趟美食之旅', progress: (s) => [s.elements.food || 0, 3] },
    { icon: '🏝️', name: '海島控', desc: '2 趟海島旅行', progress: (s) => [s.elements.island || 0, 2] },
    { icon: '⛩️', name: '文化探索家', desc: '2 趟文化之旅', progress: (s) => [s.elements.culture || 0, 2] },
    { icon: '📶', name: 'eSIM 達人', desc: '用 eSIM 出國 4 次', progress: (s) => [s.esimCount, 4] },
    { icon: '🛫', name: '萬里旅人', desc: '飛行 2 萬公里', progress: (s) => [Math.round(s.km), 20000] },
    { icon: '🗓️', name: '一個月在路上', desc: '旅行 30 天', progress: (s) => [s.days, 30] },
  ];

  const travelerType = (s) => {
    const top = s.topElements.slice(0, 2).map(([k]) => el(k).label);
    if (!top.length) return '還在等第一趟旅行的旅人';
    return `「${top.join(' × ')}」型旅人`;
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

  // ---------- eSIM pricing
  const DAILY = { 1: { label: '每日 1GB', k: 1 }, 2: { label: '每日 2GB', k: 1.55 }, unl: { label: '每日吃到飽*', k: 2.3 } };
  const TOTAL = { 3: { label: '3GB／7 天', k: 3.2, days: 7 }, 5: { label: '5GB／15 天', k: 4.6, days: 15 }, 10: { label: '10GB／30 天', k: 7.5, days: 30 }, 20: { label: '20GB／30 天', k: 12, days: 30 } };
  const target = (key) => (PACKS[key] ? { ...PACKS[key], key, pack: true } : { ...COUNTRIES[key], key, icon: flag(key) });
  const nice = (v) => Math.max(49, Math.ceil(v / 10) * 10 - 1);
  const planPrice = (key, plan) => {
    const { base } = target(key);
    if (plan.kind === 'daily') return nice(base * plan.days * DAILY[plan.size].k);
    return nice(base * TOTAL[plan.size].k);
  };
  const planLabel = (key, plan) => `${target(key).name} ${plan.kind === 'daily' ? `${plan.days} 天 ${DAILY[plan.size].label}` : TOTAL[plan.size].label}`;
  const usagePerDay = () => {
    const u = settings.usage;
    return u.maps * 0.03 + u.social * 0.3 + u.video * 0.7 + u.share * 0.8;
  };
  const sizeForUsage = () => { const g = usagePerDay(); if (g <= 0.8) return '1'; if (g <= 1.7) return '2'; return 'unl'; };

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
    return {
      journey: next, key, plan: { kind: 'daily', size: sizeForUsage(), days: Math.min(30, days) },
    };
  };
  const orderStatus = (o) => {
    const linked = trips.filter((t) => o.tripIds?.includes(t.id));
    if (!linked.length) return o.installed ? ['active', '已安裝'] : ['pending', '待安裝'];
    const { start } = linked[0]; const { end } = linked[linked.length - 1];
    if (end < TODAY) return ['done', '已使用完畢'];
    if (start <= TODAY) return ['active', '使用中'];
    return o.installed ? ['active', '已安裝・待出發'] : ['pending', '待安裝'];
  };

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
      const plan = { kind: 'daily', size: '2', days };
      orders.push({
        id: `o-${j[0].id}`, key, plan, title: planLabel(key, plan), price: planPrice(key, plan), tripIds: j.map((t) => t.id), installed: false, total: days * 2, at: j[0].start,
      });
    });
    save();
  }

  // ---------- login
  function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#avatar').textContent = (user?.name || '旅').slice(0, 1);
    renderAll();
    if (!world) loadWorld();
  }
  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-name').value = user?.name || '';
  }
  $('#login-demo').addEventListener('click', () => {
    user = { name: $('#login-name').value.trim() || '旅人', since: TODAY };
    loadDemo();
    showApp();
    toast(`歡迎回來，${user.name}！已載入 2025–2026 足跡`);
  });
  $('#login-new').addEventListener('click', () => {
    user = { name: $('#login-name').value.trim() || '旅人', since: TODAY };
    trips = []; orders = []; save();
    showApp();
  });
  $('#logout').addEventListener('click', () => { user = null; save(); showLogin(); });
  $('#load-demo').addEventListener('click', () => {
    // eslint-disable-next-line no-alert
    if (trips.length && !window.confirm('載入範例會取代目前的行程，確定嗎？')) return;
    loadDemo(); renderAll(); toast('已載入範例足跡');
  });

  // ---------- tabs (with smooth view transitions)
  let currentTab = 'map';
  function go(tab) {
    if (tab === currentTab) return;
    const swap = () => {
      currentTab = tab;
      $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      $$('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== tab; });
      window.scrollTo({ top: 0 });
      if (tab === 'map') requestAnimationFrame(drawMap);
      if (tab === 'plan') renderPlanner();
      animateIn($(`[data-view="${tab}"]`));
    };
    if (document.startViewTransition && !REDUCED) document.startViewTransition(swap); else swap();
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
    return `<div><b>${y}</b>：去了 ${s.countries.size} 個國家、${s.cities.size} 座城市、${s.days} 天${soon}${top ? `｜最愛元素 ${el(top[0]).icon} ${el(top[0]).label}` : ''}</div>`;
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
        <div style="flex:1;min-width:180px"><b>下一站：${esc(next.city)}</b><div class="small">${md(next.start)}–${md(next.end)}・${isOngoing(next) ? '旅行中' : `還有 ${d} 天`}・eSIM：${esimState}</div></div>
        ${order ? '<button class="btn sm" data-goto="esim">查看 eSIM</button>' : `<button class="btn sm" data-plan="${pick?.key || ''}">買 eSIM</button>`}
        <button class="btn sm" data-near="${next.id}">附近還能去哪</button></div>`;
    }
    $('#hero').innerHTML = trips.length ? `
      <h2>嗨 ${name}，歡迎回來 👋</h2>
      <p style="margin:4px 0 0;opacity:.92">你是${travelerType(all)}，2025–2026 已點亮 ${all.countries.size} 個國家。</p>
      <div class="yr">${CONFIG.years.map(yearLine).join('')}</div>${nextHtml}` : `
      <h2>嗨 ${name}，開始點亮你的世界地圖 ✨</h2>
      <p style="margin:6px 0 12px;opacity:.92">新增去過的旅行，或匯入 Google 地圖時間軸，自動找出 2025、2026 去過的國家。</p>
      <div class="row"><button class="btn" data-goto="trips">＋ 新增第一趟</button><button class="btn" id="hero-demo">看範例足跡</button></div>`;
    $('#hero-demo')?.addEventListener('click', () => { loadDemo(); renderAll(); });
  }

  function renderStats() {
    const s = stats(settings.year);
    const coverage = (s.countries.size / 195) * 100;
    const items = [
      [count(s.countries.size), '國家・地區'], [count(s.cities.size), '城市'], [count(s.days), '旅行天數'],
      [count(s.km), '飛行公里'], [count(s.gb, 1), 'eSIM 用量 GB'], [count(coverage, 1), '世界探索度 %'],
    ];
    $('#stats').innerHTML = items.map(([v, l]) => `<div class="card stat">${v}<span>${l}</span></div>`).join('');
    animateIn($('#stats'));
  }

  // ---------- map
  let svg; let zoom; let projection; let mapSize = [0, 0];
  async function loadWorld() {
    try {
      const res = await fetch('vendor/countries-50m.json');
      const topo = await res.json();
      const fc = topojson.feature(topo, topo.objects.countries);
      const features = fc.features.filter((f) => f.id !== '010'); // 南極洲
      world = { features, byId: new Map(features.map((f) => [f.id, f])), bounds: features.map((f) => d3.geoBounds(f)) };
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
  const landClass = (n, v) => {
    if (!v) return n === home().n ? 'land home' : 'land';
    if (v.years.size > 1) return 'land vboth';
    if (v.years.has(2025)) return 'land v25';
    if (v.years.has(2026)) return 'land v26';
    return v.soon ? 'land vsoon' : 'land';
  };
  const tripClass = (t) => (isUpcoming(t) ? 'soon' : `y${tripYear(t)}`);
  function drawMap() {
    if (!world || currentTab !== 'map') return;
    const wrap = $('#map');
    const w = wrap.clientWidth || 800;
    const h = Math.round(Math.max(260, Math.min(560, w * 0.56)));
    mapSize = [w, h];
    const visits = visitMap(settings.year);
    const list = tripsIn(settings.year);
    projection = d3.geoNaturalEarth1().fitExtent([[6, 6], [w - 6, h - 6]], { type: 'Sphere' });
    const path = d3.geoPath(projection);
    wrap.innerHTML = '';
    svg = d3.select(wrap).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', '世界旅遊足跡地圖');
    const g = svg.append('g');
    g.append('path').datum({ type: 'Sphere' }).attr('class', 'ocean').attr('d', path);
    g.append('path').datum(d3.geoGraticule10()).attr('class', 'grat').attr('d', path);
    g.append('g').selectAll('path').data(world.features).join('path')
      .attr('class', (f) => landClass(f.id, visits.get(f.id)))
      .attr('d', path)
      .on('click', (e, f) => openCountry(f.id))
      .append('title').text((f) => country(f.id).name);
    const arcs = g.append('g');
    journeys(list).forEach((j) => {
      const pts = [[home().lng, home().lat], ...j.map((t) => [t.lng, t.lat]), [home().lng, home().lat]];
      for (let i = 0; i < pts.length - 1; i += 1) {
        const t = j[Math.min(i, j.length - 1)];
        arcs.append('path').attr('class', `arc ${tripClass(t)}`).attr('d', path({ type: 'LineString', coordinates: [pts[i], pts[i + 1]] }));
      }
    });
    const pins = g.append('g');
    const hp = projection([home().lng, home().lat]);
    pins.append('circle').attr('class', 'pin home').attr('cx', hp[0]).attr('cy', hp[1]).attr('r', 3.5).append('title').text(`出發：${home().name}`);
    list.forEach((t) => {
      const p = projection([t.lng, t.lat]);
      pins.append('circle').attr('class', `pin ${tripClass(t)}`).attr('cx', p[0]).attr('cy', p[1]).attr('r', 4)
        .on('click', () => openTrip(t.id))
        .append('title').text(`${t.city} ${md(t.start)}–${md(t.end)}`);
    });
    g.append('g').attr('class', 'focus-layer');
    zoom = d3.zoom().scaleExtent([1, 12]).translateExtent([[0, 0], [w, h]]).on('zoom', (e) => {
      g.attr('transform', e.transform);
      g.selectAll('.pin').attr('r', (d, i, nodes) => (nodes[i].classList.contains('focus') ? 6 : 4) / Math.sqrt(e.transform.k));
    });
    svg.call(zoom).on('dblclick.zoom', null);
    renderLegend(visits);
  }
  function renderLegend(visits) {
    let c25 = 0; let c26 = 0; let both = 0; let soon = 0;
    visits.forEach((v) => {
      if (v.years.size > 1) both += 1; else if (v.years.has(2025)) c25 += 1; else if (v.years.has(2026)) c26 += 1; else if (v.soon) soon += 1;
    });
    const items = [];
    if (settings.year !== '2026') items.push(`<span><i style="background:var(--y25)"></i>2025 去過 ${c25}</span>`);
    if (settings.year !== '2025') items.push(`<span><i style="background:var(--y26)"></i>2026 去過 ${c26}</span>`);
    if (settings.year === 'all') items.push(`<span><i style="background:var(--both)"></i>兩年都去 ${both}</span>`);
    items.push(`<span><i style="background:var(--soon-fill);outline:1.5px dashed var(--soon)"></i>即將出發 ${soon}</span>`);
    items.push('<span class="spacer"></span><span>點國家看詳情・雙指或滾輪縮放</span>');
    $('#legend').innerHTML = items.join('');
  }
  function focusPoint(lng, lat, k = 5) {
    if (!svg || !projection) return;
    const [x, y] = projection([lng, lat]);
    const layer = svg.select('.focus-layer');
    layer.selectAll('*').remove();
    layer.append('circle').attr('class', 'pin focus').attr('cx', x).attr('cy', y).attr('r', 6 / Math.sqrt(k));
    const t = d3.zoomIdentity.translate(mapSize[0] / 2, mapSize[1] / 2).scale(k).translate(-x, -y);
    svg.transition().duration(REDUCED ? 0 : 900).ease(d3.easeCubicInOut).call(zoom.transform, t);
  }
  $('#zoom-in').addEventListener('click', () => svg && svg.transition().duration(300).call(zoom.scaleBy, 1.6));
  $('#zoom-out').addEventListener('click', () => svg && svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.6));
  $('#zoom-reset').addEventListener('click', () => svg && svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity));
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawMap, 200); });
  function showOnMap(lng, lat) {
    go('map');
    setTimeout(() => focusPoint(lng, lat), REDUCED ? 50 : 350);
  }

  // ---------- modal
  const modal = $('#modal');
  function openModal(title, html) {
    $('#modal-title').innerHTML = title;
    $('#modal-body').innerHTML = html;
    if (!modal.open) modal.showModal();
    $('#modal-body').scrollTop = 0;
  }
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) modal.close(); });

  function openCountry(n) {
    const c = country(n);
    const visits = sortTrips(trips.filter((t) => t.n === n));
    const dests = DESTS.filter((d) => COUNTRIES[d.c]?.n === n);
    const tags = {};
    visits.forEach((t) => t.tags.forEach((k) => { tags[k] = (tags[k] || 0) + 1; }));
    openModal(`${flag(c.code)} ${esc(c.name)}`, `
      ${visits.length ? `<div><b>你去過 ${visits.length} 次</b><ul class="timeline" style="margin-top:8px">${visits.map((t) => `<li data-trip="${t.id}"><span class="flag">${isUpcoming(t) ? '🧳' : '📍'}</span><div><b>${esc(t.city)}</b><div class="small muted">${t.start} – ${t.end}・${t.tags.map((k) => el(k).icon).join(' ')}</div></div></li>`).join('')}</ul></div>` : '<p class="muted">還沒去過，加入你的下一站吧！</p>'}
      ${Object.keys(tags).length ? `<div class="row">${Object.entries(tags).map(([k, v]) => `<span class="chip">${el(k).icon} ${el(k).label} ×${v}</span>`).join('')}</div>` : ''}
      ${c.note ? `<div class="notice">ℹ️ ${esc(c.note)}</div>` : ''}
      ${c.cur ? `<div class="small muted">貨幣 ${esc(c.cur)}・插座 ${esc(c.plug)}</div>` : ''}
      ${dests.length ? `<div><b>推薦城市</b><div class="row" style="margin-top:6px">${dests.map((d) => `<button class="chip" data-dest="${d.id}">${DEST_EMOJI[d.tags[0]]} ${esc(d.name)}</button>`).join('')}</div></div>` : ''}
      <div class="actions">
        ${c.base ? `<button class="btn primary" data-plan="${c.code}">📶 ${esc(c.name)} eSIM</button>` : ''}
        ${c.site ? `<a class="btn" href="${c.site}" target="_blank" rel="noopener">官方觀光網 ↗</a>` : ''}
        <a class="btn" href="${gmaps(`${c.name} 景點`)}" target="_blank" rel="noopener">Google 地圖 ↗</a>
        <button class="btn" data-trip-new="${n}">＋ 記錄一趟</button>
      </div>`);
  }
  function openTrip(id) {
    const t = trips.find((x) => x.id === id);
    if (!t) return;
    const c = country(t.n);
    const d = t.dest && DEST[t.dest];
    openModal(`${flag(c.code)} ${esc(t.city)}`, `
      <div class="muted">${t.start} – ${t.end}（${daysBetween(t.start, t.end)} 天）・${esc(c.name)}</div>
      <div class="row">${t.tags.map((k) => `<span class="chip">${el(k).icon} ${el(k).label}</span>`).join('')}</div>
      ${Number(t.gb) ? `<div class="small">📶 eSIM 用了 ${t.gb} GB</div>` : ''}
      ${t.note ? `<p>${esc(t.note)}</p>` : ''}
      ${d ? spotsHtml(d) : ''}
      <div class="actions">
        <button class="btn primary" data-near="${t.id}">🧭 附近還能去哪</button>
        <a class="btn" href="${gmaps(`${t.city} ${c.name}`)}" target="_blank" rel="noopener">Google 地圖 ↗</a>
        <button class="btn" data-open-plan="${t.id}">🗓️ 行程表</button>
        <button class="btn" data-edit="${t.id}">編輯</button>
      </div>`);
  }

  // ---------- recommendations
  function originOptions() {
    const opts = [];
    if (recState.gps) opts.push({ key: 'gps', label: '📍 目前位置', ...recState.gps });
    else opts.push({ key: 'gps', label: '📍 用目前位置' });
    opts.push({ key: 'home', label: `🏠 ${home().name}`, lat: home().lat, lng: home().lng, name: home().name });
    const next = upcomingTrips()[0];
    if (next) opts.push({ key: `trip:${next.id}`, label: `🧳 下一站 ${next.city}`, lat: next.lat, lng: next.lng, name: next.city });
    sortTrips(trips.filter((t) => t.end < TODAY)).reverse().slice(0, 4).forEach((t) => {
      opts.push({ key: `trip:${t.id}`, label: `🕘 ${t.city}`, lat: t.lat, lng: t.lng, name: t.city });
    });
    const extra = recState.origin && !opts.find((o) => o.key === recState.origin.key) ? [recState.origin] : [];
    return [...opts, ...extra];
  }
  function defaultOrigin() {
    const opts = originOptions();
    return opts.find((o) => o.key.startsWith('trip:') && o.label.startsWith('🧳')) || opts.find((o) => o.key === 'home');
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
      const why = [];
      let score = Math.max(0, 1 - dist / 4000) * 40;
      if (dist < 600) why.push(`離${origin.name}只有 ${fmtKm(dist)}，很適合順遊`);
      else if (dist < 2500) why.push(`離${origin.name} ${fmtKm(dist)}，短程就到`);
      const matched = d.tags.filter((t) => pref[t] >= 0.5);
      score += (d.tags.reduce((s, t) => s + (pref[t] || 0), 0) / d.tags.length) * 30;
      if (matched.length) why.push(`符合你常玩的 ${matched.slice(0, 2).map((k) => el(k).label).join('、')}`);
      if (opts.tags.length) score += 8;
      if (d.months.includes(Number(opts.month))) { score += 14; why.push(`${opts.month} 月是最佳旅遊季節`); }
      const { n } = COUNTRIES[d.c];
      if (!visitedCities.has(d.id)) {
        score += 6;
        if (!visitedCountries.has(n)) { score += 4; why.push(`解鎖新國家 ${flag(d.c)} ${COUNTRIES[d.c].name}`); }
      } else why.push('你去過，換個季節再訪');
      const free = freeCount(d);
      if (free) why.push(`${free} 個景點免門票`);
      return {
        d, dist, score: Math.round(Math.min(99, score + 10)), why: why.slice(0, 3),
      };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  function spotsHtml(d) {
    const c = COUNTRIES[d.c];
    return `<div class="grid" style="gap:6px">${d.spots.map((s) => {
      const twd = toTwd(s);
      return `<div class="spot"><a href="${gmaps(`${s.name} ${d.name}`)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>
        <span class="chip ${s.fee === 0 ? 'free' : 'fee'}">${s.fee === 0 ? '免費' : esc(ticketText(s))}</span>
        <small>${s.fee ? `成人門票 ≈ NT$${fmt(twd)}${s.note ? `・${esc(s.note)}` : ''}` : esc(s.note || '不需門票')}</small></div>`;
    }).join('')}</div>
    <div class="ticket-sum"><span>🎟️ 門票合計（成人）</span><b>≈ NT$${fmt(ticketTotal(d))}</b></div>
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
          <div class="cover" style="background:linear-gradient(135deg,${c1},${c2})">
            <span class="score">配對 ${r.score}%</span>
            <div><div class="small" style="opacity:.9">${flag(d.c)} ${c.name}・${r.dist ? fmtKm(r.dist) : ''}</div><h3>${esc(d.name)}</h3></div>
            <span class="emoji" aria-hidden="true">${DEST_EMOJI[d.tags[0]]}</span>
          </div>
          <div class="body">
            <div class="small">${esc(d.blurb)}</div>
            <div class="row">${d.tags.slice(0, 4).map((k) => `<span class="chip">${el(k).icon} ${el(k).label}</span>`).join('')}</div>
            <ul class="why">${r.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
            <div class="ticket-sum"><span>🎟️ ${d.spots.length} 個景點・${freeCount(d)} 個免費</span><b>≈ NT$${fmt(ticketTotal(d))}</b></div>
            <div class="small muted">✈️ 台北直飛約 ${d.hours} 小時・最佳 ${d.months.length === 12 ? '全年' : `${d.months.slice(0, 4).join('、')} 月`}</div>
            <div class="actions">
              <button class="btn sm primary" data-flip>景點與門票 ↻</button>
              <button class="btn sm" data-ai="${d.id}">✨ AI 行程</button>
              <button class="btn sm" data-wish="${d.id}" aria-pressed="${wished}">${wished ? '♥' : '♡'}</button>
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
            <button class="btn sm" data-show="${d.id}">🗺️ 地圖上看</button>
            <button class="btn sm primary" data-plan="${d.c}">📶 ${c.name} eSIM</button>
          </div>
        </div>
      </div>
    </article>`;
  }

  function renderRecs() {
    if (!recState.origin) recState.origin = defaultOrigin();
    const opts = originOptions();
    $('#origin-chips').innerHTML = opts.map((o) => `<button class="chip ${recState.origin?.key === o.key ? 'on' : ''}" data-origin="${esc(o.key)}">${esc(o.label)}</button>`).join('');
    $('#tag-chips').innerHTML = Object.entries(ELEMENTS).map(([k, v]) => `<button class="chip ${recState.tags.includes(k) ? 'on' : ''}" data-tag="${k}">${v.icon} ${v.label}</button>`).join('');
    const list = recState.origin?.lat != null ? recommend(recState.origin) : [];
    $('#recs-count').textContent = list.length ? `從 ${recState.origin.name} 出發・${list.length} 個推薦` : '';
    $('#recs').innerHTML = list.length ? list.map(travelCard).join('') : '<div class="card muted">沒有符合條件的推薦，試著放寬篩選條件。</div>';
    animateIn($('#recs'));
  }
  function renderMapRecs() {
    const origin = defaultOrigin();
    const list = recommend(origin, {
      tags: [], month: recState.month, hours: 0, fee: 'any', unvisited: true,
    }, 6);
    $('#map-recs').innerHTML = list.map(travelCard).join('');
  }
  (function initRecControls() {
    $('#rec-month').innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1} 月</option>`).join('');
    $('#rec-month').value = recState.month;
    $('#rec-month').addEventListener('change', (e) => { recState.month = Number(e.target.value); renderRecs(); });
    $('#rec-hours').addEventListener('change', (e) => { recState.hours = Number(e.target.value); renderRecs(); });
    $('#rec-fee').addEventListener('change', (e) => { recState.fee = e.target.value; renderRecs(); });
    $('#rec-new').addEventListener('change', (e) => { recState.unvisited = e.target.checked; renderRecs(); });
  }());
  function setOrigin(key) {
    if (key === 'gps') {
      if (!navigator.geolocation) { toast('這個瀏覽器不支援定位'); return; }
      toast('取得目前位置中…');
      navigator.geolocation.getCurrentPosition((pos) => {
        recState.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, name: '目前位置' };
        recState.origin = { key: 'gps', label: '📍 目前位置', ...recState.gps };
        renderRecs();
      }, () => toast('無法取得位置，請允許定位或改選其他出發點'), { timeout: 10000 });
      return;
    }
    recState.origin = originOptions().find((o) => o.key === key) || recState.origin;
    renderRecs();
  }
  function nearFrom(lat, lng, name, key) {
    recState.origin = {
      key, label: `📌 ${name}`, lat, lng, name,
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
    const pick = { kind: 'daily', size: sizeForUsage(), days };
    openModal(`✨ ${flag(d.c)} ${esc(d.name)} ${days} 天行程`, `
      <div class="row"><label class="small muted" for="ai-days">天數</label><select class="input" id="ai-days" style="width:auto">${[2, 3, 4, 5, 6, 7, 8, 10].map((n) => `<option ${n === days ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <span class="spacer"></span>${CONFIG.ai ? '<button class="btn sm primary" id="ai-run">請 AI 客製</button>' : ''}</div>
      <div id="ai-out"><ul class="steps" style="gap:10px">${localPlan(d, days)}</ul></div>
      <div class="notice">🧳 行前清單：出發前一天在 Wi-Fi 下安裝 eSIM、抵達後把行動數據切到旅遊 eSIM 並開啟數據漫遊・貨幣 ${c.cur}・插座 ${esc(c.plug)}${c.note ? `・${esc(c.note)}` : ''}</div>
      ${spotsHtml(d)}
      <div class="actions">
        <button class="btn primary" data-plan="${d.c}">📶 ${esc(planLabel(d.c, pick))}・NT$${fmt(planPrice(d.c, pick))}</button>
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

  // ---------- eSIM store
  let planState = null;
  function openPlan(key, preset) {
    if (!key) { go('esim'); return; }
    const t = target(key);
    const pick = smartPick();
    planState = {
      key, kind: 'daily', size: sizeForUsage(), days: 5, ...(pick?.key === key ? pick.plan : {}), ...preset,
    };
    const covers = t.pack ? t.countries.map((c) => `${flag(c)} ${COUNTRIES[c].name}`).join('、') : '';
    openModal(`${t.icon} ${esc(t.name)} eSIM`, `
      <div class="seg" id="kind-seg"><button data-kind="daily">每日方案</button><button data-kind="total">總量方案</button></div>
      <div id="plan-opts"></div>
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <div><div class="small muted" id="plan-label"></div><div class="price">NT$<span id="plan-price"></span></div></div>
        <div class="small muted" style="text-align:right">流量試算：每天約 ${usagePerDay().toFixed(1)} GB<br>建議 ${DAILY[sizeForUsage()].label}</div>
      </div>
      <ul class="small" style="margin:0;padding-left:18px;display:grid;gap:4px">
        <li>✅ 熱點分享・4G／5G（依當地網路）</li>
        <li>✅ 抵達後連上當地網路才開始計算天數，購買後 180 天內啟用</li>
        ${t.pack ? `<li>✅ 適用：${covers}</li>` : `<li>✅ 常見合作網路：${esc(t.ops)}（以官網為準）</li>`}
        <li class="muted">* 吃到飽方案每日高速流量用完後降速</li>
      </ul>
      <div class="actions">
        <button class="btn primary" id="plan-add">加入我的 eSIM（示範）</button>
        <a class="btn accent" href="${CONFIG.esimUrl}" target="_blank" rel="noopener">到官網購買 ↗</a>
      </div>
      <p class="notice">示意價格，正式價格與方案內容以官網為準。示範版不會扣款。</p>`);
    $$('#kind-seg button').forEach((b) => b.addEventListener('click', () => {
      planState.kind = b.dataset.kind;
      planState.size = planState.kind === 'daily' ? sizeForUsage() : '5';
      renderPlan();
    }));
    $('#plan-add').addEventListener('click', addOrder);
    renderPlan();
  }
  function renderPlan() {
    const p = planState;
    $$('#kind-seg button').forEach((b) => b.classList.toggle('on', b.dataset.kind === p.kind));
    if (p.kind === 'daily') {
      if (!DAILY[p.size]) p.size = '2';
      $('#plan-opts').innerHTML = `<div class="grid" style="grid-template-columns:repeat(3,1fr);gap:8px">${Object.entries(DAILY).map(([k, v]) => `<button class="plan-opt ${p.size === k ? 'on' : ''}" data-size="${k}"><b>${v.label}</b><div class="small muted">NT$${fmt(planPrice(p.key, { ...p, size: k }))}</div></button>`).join('')}</div>
        <div class="row" style="margin-top:10px"><span>天數</span><span class="spacer"></span><button class="btn sm" data-days="-1">－</button><b style="min-width:52px;text-align:center">${p.days} 天</b><button class="btn sm" data-days="1">＋</button></div>`;
    } else {
      if (!TOTAL[p.size]) p.size = '5';
      $('#plan-opts').innerHTML = `<div class="grid" style="grid-template-columns:repeat(2,1fr);gap:8px">${Object.entries(TOTAL).map(([k, v]) => `<button class="plan-opt ${String(p.size) === k ? 'on' : ''}" data-size="${k}"><b>${v.label}</b><div class="small muted">NT$${fmt(planPrice(p.key, { kind: 'total', size: k }))}</div></button>`).join('')}</div>`;
    }
    $$('#plan-opts [data-size]').forEach((b) => b.addEventListener('click', () => { p.size = b.dataset.size; renderPlan(); }));
    $$('#plan-opts [data-days]').forEach((b) => b.addEventListener('click', () => { p.days = Math.max(1, Math.min(30, p.days + Number(b.dataset.days))); renderPlan(); }));
    $('#plan-label').textContent = planLabel(p.key, p);
    $('#plan-price').textContent = fmt(planPrice(p.key, p));
  }
  function addOrder() {
    const p = planState;
    const plan = { kind: p.kind, size: p.size, days: p.kind === 'daily' ? p.days : TOTAL[p.size].days };
    const pick = smartPick();
    const tripIds = pick?.key === p.key ? pick.journey.map((t) => t.id) : [];
    orders.push({
      id: `o-${uid()}`, key: p.key, plan, title: planLabel(p.key, plan), price: planPrice(p.key, plan), tripIds, installed: false,
      total: p.kind === 'daily' ? (DAILY[p.size].k > 2 ? 99 : Number(p.size)) * p.days : Number(p.size), at: TODAY,
    });
    save();
    modal.close();
    renderEsim(); renderHero(); renderCover();
    if (currentTab === 'plan') renderPlanner();
    toast('已加入我的 eSIM（示範，未扣款）');
  }
  function renderWallet() {
    const list = [...orders].sort((a, b) => b.at.localeCompare(a.at));
    $('#wallet').innerHTML = list.length ? list.map((o) => {
      const [cls, label] = orderStatus(o);
      const linked = trips.filter((t) => o.tripIds?.includes(t.id));
      const used = sum(linked, (t) => Number(t.gb));
      const pct = o.total ? Math.min(100, (used / o.total) * 100) : 0;
      return `<div class="card trip"><div class="flag">${target(o.key).icon}</div><div class="grow">
        <div class="row"><b>${esc(o.title)}</b><span class="status ${cls}">${label}</span></div>
        <div class="small muted">${linked.length ? linked.map(tripLabel).join(' → ') : `購買於 ${o.at}`}・NT$${fmt(o.price)}</div>
        ${cls === 'done' && used ? `<div class="usage" style="margin-top:6px"><div style="width:${pct}%"></div></div><div class="small muted">用了 ${used.toFixed(1)} GB</div>` : ''}
        ${cls === 'pending' ? '<div class="small" style="margin-top:4px">📩 QR Code 會在付款完成後寄到 Email，建議出發前一天在 Wi-Fi 下安裝</div>' : ''}
      </div>${cls === 'pending' ? `<button class="btn sm" data-installed="${o.id}">已安裝</button>` : ''}</div>`;
    }).join('') : '<div class="card muted">還沒有 eSIM。新增行程後會自動推薦適合的方案。</div>';
  }
  let esimRegion = 'hot';
  function renderEsim() {
    $('#esim-site').href = CONFIG.esimUrl;
    const pick = smartPick();
    $('#smart-pick').innerHTML = pick ? `<div class="next-trip"><div style="font-size:28px">🎯</div><div style="flex:1;min-width:200px">
      <b>為你的下一趟推薦：${esc(planLabel(pick.key, pick.plan))}</b>
      <div class="small">${pick.journey.map(tripLabel).join(' → ')}・${md(pick.journey[0].start)} 出發${pick.journey.length > 1 ? `・跨 ${pick.journey.length} 地一張搞定` : ''}・依你的流量習慣（每天約 ${usagePerDay().toFixed(1)} GB）</div></div>
      <button class="btn sm" data-plan="${pick.key}">NT$${fmt(planPrice(pick.key, pick.plan))} 查看</button></div>` : '';
    renderWallet();
    const regions = [['hot', '🔥 熱門'], ['asia', '亞洲'], ['europe', '歐洲'], ['america', '美洲'], ['oceania', '大洋洲'], ['mideast', '中東'], ['packs', '🌐 多國方案']];
    $('#esim-regions').innerHTML = regions.map(([k, v]) => `<button class="chip ${esimRegion === k ? 'on' : ''}" data-region="${k}">${v}</button>`).join('');
    const q = $('#esim-search').value.trim();
    const hot = ['JP', 'KR', 'TH', 'VN', 'SG', 'HK', 'US', 'FR', 'GB', 'AU'];
    let items;
    if (esimRegion === 'packs' && !q) {
      items = Object.keys(PACKS).map((k) => ({ key: k, ...PACKS[k], sub: `${PACKS[k].countries.length} 國` }));
    } else {
      const inRegion = (code, c) => (esimRegion === 'hot' ? hot.includes(code) : c.region === esimRegion);
      const matches = (code, c) => (q ? c.name.includes(q) || code.toLowerCase() === q.toLowerCase() : inRegion(code, c));
      items = Object.entries(COUNTRIES).filter(([code, c]) => c.base && matches(code, c))
        .map(([code, c]) => ({
          key: code, icon: flag(code), name: c.name, sub: REGIONS[c.region],
        }));
      if (q) items.push(...Object.keys(PACKS).filter((k) => PACKS[k].name.includes(q)).map((k) => ({ key: k, ...PACKS[k], sub: '多國' })));
    }
    $('#esim-grid').innerHTML = items.length ? items.map((it) => `<button class="country" data-plan="${it.key}"><span class="flag">${it.icon}</span><span><b>${esc(it.name)}</b><small>${esc(it.sub)}・NT$${fmt(planPrice(it.key, { kind: 'daily', size: '1', days: 1 }))} 起/天</small></span></button>`).join('')
      : '<p class="muted">找不到這個國家，試試多國方案或全球通用。</p>';
    renderCalc();
  }
  $('#esim-search').addEventListener('input', () => renderEsim());
  function renderCalc() {
    const u = settings.usage;
    const rows = [['maps', '🗺️ 地圖導航', '小時/天', 6], ['social', '📸 社群滑手機', '小時/天', 6], ['video', '🎬 看影片', '小時/天', 4], ['share', '👨‍👩‍👧 熱點分享給', '人', 4]];
    $('#calc').innerHTML = `${rows.map(([k, label, unit, max]) => `<div><div class="row"><span>${label}</span><span class="spacer"></span><b>${u[k]} ${unit}</b></div>
      <input type="range" min="0" max="${max}" step="0.5" value="${u[k]}" data-usage="${k}" aria-label="${label}"></div>`).join('')}
      <div class="ticket-sum"><span>每天約 <b>${usagePerDay().toFixed(1)} GB</b></span><b>建議 ${DAILY[sizeForUsage()].label}</b></div>`;
    $$('#calc [data-usage]').forEach((r) => r.addEventListener('change', (e) => {
      settings.usage[e.target.dataset.usage] = Number(e.target.value); save(); renderEsim();
    }));
  }
  const STEPS = {
    ios: ['付款後收到 QR Code（Email／App 內都看得到）', '出發前一天連上 Wi-Fi：設定 → 行動服務 → 加入 eSIM → 使用 QR Code 掃描', '把新的 eSIM 標籤取名為「旅遊」，主要號碼保留台灣門號', '抵達後：行動數據選「旅遊」，並在旅遊 eSIM 開啟「數據漫遊」', '台灣門號關閉數據漫遊，簡訊與電話照常可收'],
    android: ['付款後收到 QR Code（Email／App 內都看得到）', '出發前一天連上 Wi-Fi：設定 → 網路和網際網路 → SIM 卡 → 新增 eSIM／下載 SIM', '掃描 QR Code，將 eSIM 命名為「旅遊」', '抵達後：行動數據改用旅遊 eSIM，並開啟「漫遊」', '台灣門號關閉漫遊，保留簡訊與通話'],
  };
  function renderSteps(os) {
    $$('#os-seg button').forEach((b) => b.classList.toggle('on', b.dataset.os === os));
    $('#steps').innerHTML = STEPS[os].map((s) => `<li>${esc(s)}</li>`).join('');
  }
  $$('#os-seg button').forEach((b) => b.addEventListener('click', () => renderSteps(b.dataset.os)));
  const FAQ = [
    ['什麼時候開始計算天數？', '大多數方案在抵達目的地、eSIM 第一次連上當地網路時才開始計算，提早安裝不會浪費天數。'],
    ['可以保留台灣門號收簡訊嗎？', '可以。eSIM 只負責上網，台灣實體卡照常收簡訊與來電（關閉台灣門號的數據漫遊即可避免漫遊費）。'],
    ['可以分享熱點嗎？', '可以，一人購買就能分享給同行家人朋友，記得選流量大一點的方案。'],
    ['QR Code 可以重複掃嗎？', '多數 eSIM 只能安裝一次，刪除後無法再裝回，請不要隨意刪除。'],
    ['手機有鎖嗎？', '電信綁約機若有鎖網路，需先解鎖才能使用其他 eSIM。中國大陸與港澳版 iPhone 多數不支援 eSIM。'],
    ['用不完可以退嗎？', '已安裝或已啟用的 eSIM 通常無法退款，未安裝的依官網退款規則辦理。'],
  ];
  $('#faq').innerHTML = FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
  $('#device-check').addEventListener('click', checkDevice);
  $('#device').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkDevice(); });
  function checkDevice() {
    const v = $('#device').value.trim().toLowerCase().replace(/\s+/g, ' ');
    const out = $('#device-result');
    if (!v) { out.textContent = ''; return; }
    const ok = [
      /iphone ?(xs|xr|1[1-9]|se ?\(?[23]|se ?20(20|22)|air|1[6-9]e?)/, /pixel ?([3-9]|1\d|fold)/, /galaxy ?(s ?2[0-9]|z ?(fold|flip)|note ?20|a ?5[4-9])/,
      /(s2[0-9]|z fold|z flip)/, /ipad (pro|air|mini)/, /(sony|xperia) ?(1|5|10)/, /(oppo ?find ?x[3-9]|vivo ?x(90|100|200))/,
    ].some((re) => re.test(v));
    const no = /iphone ?([4-8]|x\b|se ?\(?1)|中國|大陸|港版/.test(v);
    if (no) out.innerHTML = '<span style="color:var(--danger)">❌ 這個型號（或版本）可能不支援 eSIM。</span>';
    else if (ok) out.innerHTML = '<span style="color:var(--good)">✅ 一般支援 eSIM。</span> 綁約機請確認已解鎖。';
    else out.innerHTML = '🤔 無法確定，請在撥號畫面輸入 *#06#，有出現 EID 就支援。';
  }

  // ---------- trips list & form
  function renderTrips() {
    $('#home-select').innerHTML = Object.entries(HOMES).map(([k, h]) => `<option value="${k}" ${settings.home === k ? 'selected' : ''}>${h.name}</option>`).join('');
    $('#theme-select').value = settings.theme;
    const byYear = {};
    sortTrips(trips).reverse().forEach((t) => { (byYear[tripYear(t)] ||= []).push(t); });
    const years = Object.keys(byYear).sort().reverse();
    $('#trip-list').innerHTML = years.length ? years.map((y) => `<div class="section-title"><h3>${y}</h3><span class="muted small">${byYear[y].length} 趟</span></div>
      <div class="grid">${byYear[y].map((t) => `<div class="trip"><div class="flag">${flag(country(t.n).code)}</div><div class="grow">
        <div class="row"><b>${esc(t.city)}</b><span class="muted small">${esc(country(t.n).name)}</span>${isUpcoming(t) ? '<span class="status pending">即將出發</span>' : ''}${isOngoing(t) ? '<span class="status active">旅行中</span>' : ''}</div>
        <div class="small muted">${t.start} – ${t.end}・${daysBetween(t.start, t.end)} 天${Number(t.gb) ? `・📶 ${t.gb} GB` : ''}${t.src === 'import' ? '・來自時間軸' : ''}</div>
        <div class="tags">${t.tags.map((k) => `${el(k).icon}${el(k).label}`).join('　')}</div></div>
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
      return ds.length ? `<optgroup label="${flag(code)} ${c.name}">${ds.map((d) => `<option value="${d.id}" ${t.dest === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}</optgroup>` : '';
    }).join('');
    const custom = !t.dest && (t.city || presetN);
    openModal(id ? '編輯行程' : '新增行程', `
      <div class="field"><label for="f-dest">目的地</label><select class="input" id="f-dest"><option value="">— 選擇城市 —</option>${destOptions}<option value="custom" ${custom ? 'selected' : ''}>其他城市（自行輸入）</option></select></div>
      <div class="row" id="f-custom" ${custom ? '' : 'hidden'}>
        <div class="field" style="flex:1"><label for="f-country">國家</label><select class="input" id="f-country">${Object.entries(COUNTRIES).filter(([c]) => c !== 'TW').map(([code, c]) => `<option value="${c.n}" ${t.n === c.n ? 'selected' : ''}>${flag(code)} ${c.name}</option>`).join('')}${t.n && !NUM[t.n] ? `<option value="${t.n}" selected>${esc(country(t.n).name)}</option>` : ''}</select></div>
        <div class="field" style="flex:1"><label for="f-city">城市</label><input class="input" id="f-city" maxlength="30" value="${esc(t.dest ? '' : t.city)}"></div>
      </div>
      <div class="row"><div class="field" style="flex:1"><label for="f-start">出發</label><input type="date" class="input" id="f-start" value="${t.start}"></div>
        <div class="field" style="flex:1"><label for="f-end">回程</label><input type="date" class="input" id="f-end" value="${t.end}"></div></div>
      <div class="field"><label>旅行元素</label><div class="row" id="f-tags">${Object.entries(ELEMENTS).map(([k, v]) => `<button type="button" class="chip ${t.tags.includes(k) ? 'on' : ''}" data-ftag="${k}">${v.icon} ${v.label}</button>`).join('')}</div></div>
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
      // eslint-disable-next-line no-alert
      if (!window.confirm('確定刪除這趟行程？')) return;
      trips = trips.filter((x) => x.id !== id);
      orders.forEach((o) => { o.tripIds = (o.tripIds || []).filter((x) => x !== id); });
      save(); modal.close(); renderAll();
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
        <div class="row"><h2>${y}</h2><span class="muted small">${travelerType(s)}</span><span class="spacer"></span><button class="btn sm" data-share="${y}">🪪 旅遊卡</button></div>
        <div class="grid stats" style="grid-template-columns:repeat(4,1fr)">
          <div class="stat">${count(s.countries.size)}<span>國家</span></div><div class="stat">${count(s.cities.size)}<span>城市</span></div>
          <div class="stat">${count(s.days)}<span>天</span></div><div class="stat">${count(s.km)}<span>公里</span></div></div>
        <div><b class="small">旅行月份</b><div class="months" style="margin-top:6px">${Array.from({ length: 12 }, (_, i) => `<span class="${s.months.has(i + 1) ? 'on' : ''}" style="${s.months.has(i + 1) ? `background:${color}` : ''}">${i + 1}</span>`).join('')}</div></div>
        <div><b class="small">旅行元素</b><div class="grid" style="gap:6px;margin-top:6px">${s.topElements.length ? s.topElements.slice(0, 6).map(([k, v]) => `<div class="bar"><span>${el(k).icon} ${el(k).label}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%;background:${color}"></div></div><span>${v}</span></div>`).join('') : '<span class="muted small">還沒有資料</span>'}</div></div>
        <div><b class="small">徽章</b><div class="badges" style="margin-top:6px">${BADGES.map((b) => { const [v, goal] = b.progress(s); const ok = v >= goal; return `<div class="badge ${ok ? '' : 'locked'}" title="${b.desc}"><b>${b.icon}</b>${b.name}<div class="muted" style="font-size:11px">${ok ? '已解鎖' : `${fmt(Math.min(v, goal))}/${fmt(goal)}`}</div></div>`; }).join('')}</div></div>
        <div><b class="small">足跡</b><ul class="timeline" style="margin-top:6px">${s.list.length ? s.list.map((t) => `<li data-trip="${t.id}"><span class="flag">${flag(country(t.n).code)}</span><div style="flex:1"><b>${esc(t.city)}</b> <span class="small muted">${md(t.start)}–${md(t.end)}</span><div class="small">${t.tags.map((k) => el(k).icon).join(' ')}${Number(t.gb) ? `・📶 ${t.gb}GB` : ''}${isUpcoming(t) ? '・即將出發' : ''}</div></div></li>`).join('') : '<li class="muted small">還沒有紀錄</li>'}</ul></div>
      </div>`;
    });
    const a = stats('2025'); const b = stats('2026');
    const diff = b.countries.size - a.countries.size;
    $('#review').innerHTML = cards.join('') + (a.past.length && b.past.length ? `<div class="card" style="grid-column:1/-1"><b>2026 vs 2025：</b>${diff >= 0 ? `多去了 ${diff}` : `少去了 ${-diff}`} 個國家，旅行天數 ${b.days - a.days >= 0 ? '+' : ''}${b.days - a.days} 天，飛行里程 ${b.km - a.km >= 0 ? '+' : ''}${fmt(b.km - a.km)} 公里。</div>` : '');
  }
  function shareCanvas(year) {
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
    x.font = `600 40px ${font}`; x.fillText(`${CONFIG.brand}・旅遊卡`, 80, 120);
    x.font = `800 150px ${font}`; x.fillText(String(year), 80, 300);
    x.font = `700 54px ${font}`; x.fillText(`${user?.name || '旅人'} 的旅行足跡`, 80, 390);
    x.font = `500 38px ${font}`; x.fillText(travelerType(s), 80, 450);
    const nums = [[s.countries.size, '國家'], [s.cities.size, '城市'], [s.days, '天'], [fmt(s.km), '公里']];
    nums.forEach(([v, l], i) => {
      const cx = 80 + i * 240;
      x.fillStyle = 'rgba(255,255,255,.16)'; roundRect(x, cx, 510, 210, 190, 28); x.fill();
      x.fillStyle = '#fff'; x.font = `800 72px ${font}`; x.fillText(String(v), cx + 28, 610);
      x.font = `500 32px ${font}`; x.fillText(l, cx + 28, 665);
    });
    x.font = `700 40px ${font}`; x.fillText('去過的地方', 80, 790);
    x.font = `400 64px ${font}`;
    const flags = [...new Set(s.past.map((t) => flag(country(t.n).code)))].join(' ');
    x.fillText(flags || '—', 80, 880);
    x.font = `500 34px ${font}`;
    const cities = s.past.map((t) => t.city).join('・');
    wrapText(x, cities || '還沒有紀錄', 80, 950, W - 160, 48);
    x.font = `700 40px ${font}`; x.fillText('旅行元素', 80, 1110);
    x.font = `500 38px ${font}`;
    x.fillText(s.topElements.slice(0, 4).map(([k]) => `${el(k).icon} ${el(k).label}`).join('   ') || '—', 80, 1170);
    x.globalAlpha = 0.8; x.font = `500 28px ${font}`; x.fillText(`📶 eSIM ${s.gb.toFixed(1)} GB・${window.location.host || CONFIG.brand}`, 80, 1270);
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
  function openShare(year = new Date().getFullYear() >= 2026 ? 2026 : 2025) {
    const cv = shareCanvas(Number(year));
    openModal(`🪪 ${year} 旅遊卡`, `<div class="seg" id="share-seg">${CONFIG.years.map((y) => `<button data-sy="${y}" class="${Number(year) === y ? 'on' : ''}">${y}</button>`).join('')}</div><div id="share-holder"></div>
      <div class="actions"><button class="btn primary" id="share-dl">下載圖片</button>${navigator.share ? '<button class="btn" id="share-native">分享</button>' : ''}</div>
      <p class="small muted">尺寸 1080×1350，適合 IG／Threads 貼文。</p>`);
    $('#share-holder').appendChild(cv);
    $$('#share-seg button').forEach((b) => b.addEventListener('click', () => openShare(b.dataset.sy)));
    $('#share-dl').addEventListener('click', () => {
      const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `travel-card-${year}.png`; a.click();
    });
    $('#share-native')?.addEventListener('click', () => cv.toBlob(async (blob) => {
      try {
        const file = new File([blob], `travel-card-${year}.png`, { type: 'image/png' });
        await navigator.share({ files: [file], title: `${year} 旅遊卡` });
      } catch { /* cancelled */ }
    }));
  }
  $('#share-card').addEventListener('click', () => openShare());

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
    wikiPhoto(title).then((p) => {
      if (!p) { if (node.classList.contains('photo')) { node.classList.add('empty'); node.innerHTML = '<span>沒有找到照片，點「照片」看更多</span>'; } return; }
      const img = new Image();
      img.onload = () => {
        if (node.classList.contains('photo')) {
          node.style.backgroundImage = `url("${p.src}")`;
          node.innerHTML = p.page ? `<a href="${p.page}" target="_blank" rel="noopener">照片：Wikipedia</a>` : '';
        } else {
          node.style.setProperty('--cover-img', `url("${p.src}")`);
          node.classList.add('loaded');
          const credit = node.querySelector('.credit');
          if (credit && p.page) { credit.href = p.page; credit.hidden = false; }
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
    return `<header class="mag-cover ${planner ? 'plan-cover' : ''}" data-cover="${esc(WIKI[t.dest] || t.city)}" style="--cover-fallback:linear-gradient(160deg,${c1} 0%,${c2} 45%,#0b1430 100%)">
      ${coverArt(t.lng, t.lat)}
      <div class="masthead"><span>${esc(CONFIG.brand)}</span><span>VOL.${vol.getFullYear()} · NO.${pad(vol.getMonth() + 1)}</span></div>
      <div class="content">
        <span class="kicker">${flag(c.code)} ${esc(c.name)}・${season(t.start)}季・${tripStatus(t)}</span>
        <h1 class="cover-title serif">${esc(t.city)}</h1>
        <p class="cover-lede">${esc(d?.blurb || t.note || `${n} 天的${c.name}之旅`)}</p>
        <div class="cover-meta"><span>${md(t.start)} – ${md(t.end)}・${n} 天</span>${items.length ? `<span>${items.length} 個行程</span>` : ''}${tickets ? `<span>🎟️ ${tickets} 張門票</span>` : ''}<span>📶 ${order ? orderStatus(order)[1] : '尚未購買 eSIM'}</span></div>
        ${planner ? '' : `<div class="row" style="margin-top:6px"><button class="btn" data-open-plan="${t.id}">打開行程表 →</button><button class="btn glass" data-near="${t.id}">附近還能去哪</button></div>`}
      </div>
      <a class="credit" target="_blank" rel="noopener" hidden>照片：Wikipedia</a>
    </header>`;
  }
  function renderCover() {
    const t = coverTrip();
    if (!t) {
      const pick = recommend({ ...home(), name: home().name }, { tags: [], month: recState.month, hours: 5, fee: 'any', unvisited: false }, 1)[0];
      const d = pick?.d;
      $('#cover').innerHTML = d ? `<header class="mag-cover" data-cover="${esc(WIKI[d.id] || d.name)}" style="--cover-fallback:linear-gradient(160deg,${(TAG_COLORS[d.tags[0]] || [])[0]} 0%,${(TAG_COLORS[d.tags[0]] || [])[1]} 45%,#0b1430 100%)">
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
    $('#strip-title').innerHTML = `<span class="kicker muted">Itinerary</span><h2 class="serif">${esc(t.city)} ${t.plan.days.length} 日行程</h2><span class="spacer"></span><button class="btn sm" data-open-plan="${t.id}">編輯行程表 →</button>`;
    $('#day-strip').innerHTML = t.plan.days.map((items, i) => `<button class="day-card" data-open-plan="${t.id}" data-day="${i}">
      <span class="kicker muted">Day</span><span class="dn">${pad(i + 1)}</span><span class="small muted">${dayLabel(t, i)}</span>
      <ol>${items.slice(0, 3).map((it) => `<li>${esc(it.name)}</li>`).join('') || '<li>尚未安排</li>'}</ol>${items.length > 3 ? `<span class="small muted">還有 ${items.length - 3} 項</span>` : ''}</button>`).join('');
  }

  // ---------- planner (行程表)
  let planTripId = null;
  const openItems = new Set();
  let sortables = [];
  const KIND_ICON = { spot: '📍', food: '🍽️', move: '🚆', custom: '📝' };
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
        <button class="item-name" data-toggle="${it.id}" aria-expanded="${open}">${KIND_ICON[it.kind] || '📍'} ${esc(it.name)}</button>
        ${fee}
      </div>
      ${open ? `<div class="item-detail">
        ${it.kind === 'move' ? '' : `<div class="photo" data-photo="${esc(it.kind === 'food' ? (WIKI[t.dest] || t.city) : spotTitle(it.name))}">載入照片中…</div>`}
        <div class="links">
          <a class="btn sm" href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent(place)}" target="_blank" rel="noopener">📷 照片</a>
          <a class="btn sm" href="https://www.youtube.com/results?search_query=${encodeURIComponent(`${place} 旅遊`)}" target="_blank" rel="noopener">▶️ 影片</a>
          <a class="btn sm" href="${gmaps(place)}" target="_blank" rel="noopener">🗺️ 地圖</a>
          ${it.fee ? `<a class="btn sm primary" href="${gsearch(`${spotTitle(it.name)} 門票 官方 預約`)}" target="_blank" rel="noopener">🎟️ 訂票</a>` : ''}
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
    const order = orders.find((o) => o.tripIds?.includes(t.id));
    const esim = order ? order.price * (b.people || 1) : 0;
    const manual = ['flight', 'hotel', 'transport', 'food', 'shopping', 'other'].reduce((s, k) => s + (Number(b[k]) || 0), 0);
    return { tickets, esim, order, total: manual + tickets + esim };
  }
  function autoTodos(t) {
    const c = country(t.n);
    const list = [];
    const order = orders.find((o) => o.tripIds?.includes(t.id));
    if (!order) list.push({ key: 'esim-buy', text: `購買 ${c.name} eSIM`, action: `<button class="btn sm" data-plan="${coverFor([c.code])}">選方案</button>` });
    else if (!order.installed) list.push({ key: 'esim-install', text: '出發前一天在 Wi-Fi 下安裝 eSIM', action: `<button class="btn sm" data-installed="${order.id}">已安裝</button>` });
    if (c.note) list.push({ key: 'entry', text: c.note });
    t.plan.days.flat().filter((it) => it.fee).forEach((it) => list.push({ key: `tk-${it.id}`, text: `預訂門票：${it.name}（${ticketText(it)}）` }));
    return list;
  }
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
    const switcher = sortTrips(trips).reverse().map((x) => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${isUpcoming(x) || isOngoing(x) ? '🧳' : '🕘'} ${esc(x.city)}・${x.start}</option>`).join('');
    $('#plan-cover').innerHTML = `<div class="row" style="margin-bottom:12px"><span class="kicker muted" style="width:auto">Planner</span><h2>行程表</h2><span class="spacer"></span>
      <select class="input" id="plan-switch" style="width:auto;max-width:60vw" aria-label="切換行程">${switcher}</select><button class="btn sm" data-edit="${t.id}">行程資訊</button></div>${coverHtml(t, true)}`;
    applyPhoto($('#plan-cover .mag-cover'), $('#plan-cover .mag-cover').dataset.cover);
    $('#plan-switch').addEventListener('change', (e) => { planTripId = e.target.value; openItems.clear(); renderPlanner(); });

    const empty = poolFor(t).length ? t.plan.days.filter((d) => !d.length).length : 0;
    $('#plan-days').innerHTML = `<div class="row" style="margin-bottom:12px"><span class="small muted">拖曳 ⋮⋮ 調整順序或移到別天；點名稱看照片、影片、地圖與訂票。</span><span class="spacer"></span>${empty ? `<button class="btn sm" data-fill="1">用景點庫補 ${empty} 個空白天</button>` : ''}</div>
      ${t.plan.days.map((items, i) => `<section class="day" id="day-${i}">
        <div class="day-head"><span class="dn serif">Day ${i + 1}</span><span class="date">${dayLabel(t, i)}</span><span class="spacer"></span><span class="small muted">${items.length} 項${sum(items, toTwd) ? `・門票 ≈ NT$${fmt(sum(items, toTwd))}` : ''}</span></div>
        <ul class="items" data-day="${i}">${items.map((it) => itemHtml(t, it, i)).join('')}</ul>
        <form class="add-item" data-add="${i}"><input class="input" maxlength="40" placeholder="新增行程，例如：午餐 一蘭拉麵" aria-label="Day ${i + 1} 新增行程"><button class="btn sm">新增</button></form>
      </section>`).join('')}`;

    const b = t.plan.budget;
    const { tickets, esim, order, total } = budgetOf(t);
    const pool = poolFor(t);
    const autos = autoTodos(t);
    const doneCount = autos.filter((a) => t.plan.done[a.key]).length + t.plan.todos.filter((x) => x.done).length;
    const todoTotal = autos.length + t.plan.todos.length;
    const fields = [['flight', '✈️ 機票'], ['hotel', '🏨 住宿'], ['transport', '🚆 當地交通'], ['food', '🍜 餐飲'], ['shopping', '🛍️ 購物'], ['other', '📦 其他']];
    const pct = b.cap ? Math.min(100, (total / b.cap) * 100) : 0;
    $('#plan-side').innerHTML = `
      <div class="card"><div class="row"><h3>💰 預算</h3><span class="spacer"></span><label class="small muted" for="bp">人數</label><input class="input" id="bp" type="number" min="1" max="20" value="${b.people}" data-budget="people" style="width:64px;min-height:32px;padding:4px 8px"></div>
        <div class="grid" style="gap:6px;margin-top:10px">
          ${fields.map(([k, label]) => `<div class="budget-row"><label for="b-${k}">${label}</label><input class="input" id="b-${k}" type="number" min="0" step="100" inputmode="numeric" value="${b[k] || ''}" placeholder="0" data-budget="${k}"></div>`).join('')}
          <div class="budget-row"><span>🎟️ 門票（自動）</span><span class="auto">NT$${fmt(tickets)}</span></div>
          <div class="budget-row"><span>📶 eSIM（自動）</span><span class="auto">${order ? `NT$${fmt(esim)}` : `<button class="btn sm" data-plan="${coverFor([country(t.n).code])}">選方案</button>`}</span></div>
        </div>
        <div class="ticket-sum" style="margin-top:10px"><span>合計${b.people > 1 ? `（每人 NT$${fmt(total / b.people)}）` : ''}</span><b>NT$${fmt(total)}</b></div>
        <div class="budget-row" style="margin-top:8px"><label for="b-cap" class="small muted">預算上限</label><input class="input" id="b-cap" type="number" min="0" step="1000" value="${b.cap || ''}" placeholder="不設定" data-budget="cap"></div>
        ${b.cap ? `<div class="usage" style="margin-top:8px"><div style="width:${pct}%;background:${total > b.cap ? 'var(--danger)' : 'var(--brand-2)'}"></div></div><div class="small muted">${total > b.cap ? `超出 NT$${fmt(total - b.cap)}` : `還剩 NT$${fmt(b.cap - total)}`}</div>` : ''}
      </div>
      <div class="card"><div class="row"><h3>✅ 待辦</h3><span class="spacer"></span><span class="small muted">${doneCount}/${todoTotal}</span></div>
        <div style="margin-top:6px">
          ${autos.map((a) => `<label class="todo ${t.plan.done[a.key] ? 'done' : ''}"><input type="checkbox" data-auto="${esc(a.key)}" ${t.plan.done[a.key] ? 'checked' : ''}><span style="flex:1">${esc(a.text)} <span class="auto-tag">自動</span></span>${a.action || ''}</label>`).join('')}
          ${t.plan.todos.map((x) => `<label class="todo ${x.done ? 'done' : ''}"><input type="checkbox" data-todo="${x.id}" ${x.done ? 'checked' : ''}><span style="flex:1">${esc(x.text)}</span><button class="btn sm ghost" data-todo-del="${x.id}" aria-label="刪除">✕</button></label>`).join('')}
        </div>
        <form class="row" id="todo-add" style="margin-top:8px"><input class="input" maxlength="60" placeholder="新增待辦" style="flex:1" aria-label="新增待辦"><button class="btn sm">新增</button></form>
      </div>
      <div class="card"><h3>📌 景點庫</h3><p class="small muted" style="margin:4px 0 8px">拖曳到左邊任一天${pool.some((p) => p.side) ? '，含 400 公里內可順遊的城市' : ''}</p>
        <ul class="pool" id="pool">${pool.map((p, i) => `<li data-pool="${i}"><span>${p.side ? '🧭' : '📍'}</span><span style="flex:1">${esc(p.name)}${p.side ? `<span class="small muted">・${esc(p.city)}</span>` : ''}</span><span class="chip ${p.fee === 0 ? 'free' : 'fee'}">${p.fee === 0 ? '免費' : esc(ticketText(p))}</span></li>`).join('') || '<li style="cursor:default">景點都排進去了 🎉</li>'}</ul>
      </div>`;

    const sync = () => setTimeout(() => syncFromDom(t, pool), 0);
    $$('#plan-days .items').forEach((ul) => sortables.push(Sortable.create(ul, {
      group: 'plan', handle: '.handle', animation: REDUCED ? 0 : 180, ghostClass: 'drag-ghost', chosenClass: 'drag-chosen', forceFallback: true, fallbackTolerance: 4, onEnd: sync,
    })));
    if ($('#pool [data-pool]')) {
      sortables.push(Sortable.create($('#pool'), {
        group: { name: 'plan', pull: 'clone', put: false }, sort: false, animation: REDUCED ? 0 : 180, ghostClass: 'drag-ghost', forceFallback: true, fallbackTolerance: 4,
        onEnd: (e) => { if (e.to !== e.from) sync(); },
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

  // ---------- delegated actions
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, li[data-trip], [data-trip]');
    if (!t) return;
    const ds = t.dataset;
    if ('flip' in ds) { t.closest('.tcard').classList.toggle('flipped'); return; }
    if (ds.plan !== undefined) { if (modal.open) modal.close(); openPlan(ds.plan); return; }
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
    if (ds.origin) { setOrigin(ds.origin); return; }
    if (ds.tag) { recState.tags = recState.tags.includes(ds.tag) ? recState.tags.filter((x) => x !== ds.tag) : [...recState.tags, ds.tag]; renderRecs(); return; }
    if (ds.region) { esimRegion = ds.region; $('#esim-search').value = ''; renderEsim(); return; }
    if (ds.installed) { const o = orders.find((x) => x.id === ds.installed); if (o) { o.installed = true; save(); renderEsim(); renderHero(); renderCover(); if (currentTab === 'plan') renderPlanner(); toast('已標記為已安裝'); } return; }
    if (ds.openPlan) { if (modal.open) modal.close(); openPlanner(ds.openPlan, ds.day != null ? Number(ds.day) : null); return; }
    if (ds.tripDest) { openTripForm(null, null, ds.tripDest); return; }
    if (ds.edit) { if (modal.open) modal.close(); openTripForm(ds.edit); return; }
    if (ds.tripNew) { openTripForm(null, ds.tripNew); return; }
    if (ds.share) { openShare(ds.share); return; }
    if (ds.trip) openTrip(ds.trip);
  });

  // ---------- render all
  function renderAll() {
    document.title = CONFIG.brand;
    $$('[data-brand]').forEach((n) => { n.textContent = CONFIG.brand; });
    $$('#year-seg button').forEach((b) => b.classList.toggle('on', b.dataset.year === settings.year));
    renderCover(); renderHero(); renderStats(); renderMapRecs(); renderReview(); renderRecs(); renderEsim(); renderTrips();
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
        ai: Boolean(data.ai), brand: data.brand || CONFIG.brand, esimUrl: data.esimUrl || CONFIG.esimUrl,
      });
    } catch { /* static preview without the API */ }
  }

  applyTheme();
  renderSteps('ios');
  loadConfig().finally(() => { if (user) showApp(); else showLogin(); });
}());
