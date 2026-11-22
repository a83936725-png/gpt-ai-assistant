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
  let planTripId = null;
  const country = (n) => NUM[n] || { name: world?.byId.get(n)?.properties?.name || '未知地區', code: '', region: '', base: 0 };

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
  const save = () => {
    store.set('user', user); store.set('trips', trips); store.set('orders', orders); store.set('wish', wish); store.set('settings', settings); store.set('cart', cart);
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

  // ---------- eSIM plans, pricing and card states
  const target = (key) => (PACKS[key] ? { ...PACKS[key], key, pack: true } : { ...COUNTRIES[key], key, icon: flag(key) });
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
  const creditHtml = (p) => (p ? `<a class="credit-mini" href="${esc(p.page)}" target="_blank" rel="noopener">📷 ${esc(p.author || 'Wikimedia Commons')}${p.license ? `・${esc(p.license)}` : ''}</a>` : '');
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

  // ---------- every country (探索世界), names in Traditional Chinese
  const REGION_NAMES = (() => { try { return new Intl.DisplayNames(['zh-TW'], { type: 'region' }); } catch { return null; } })();
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
    <div><span>✈️ 來回機票</span><b>NT$${fmt(c.flight)}</b></div><div><span>🏨 住宿・餐飲・交通</span><b>NT$${fmt(c.stay)}</b></div>
    <div><span>🎟️ 景點門票</span><b>NT$${fmt(c.tickets)}</b></div><div><span>📶 eSIM</span><b>NT$${fmt(c.esim)}</b></div>
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
    $('#cart-fab').hidden = true;
    $('#login-gift').hidden = !pendingGift;
    if (pendingGift) $('#login-gift').innerHTML = `🎁 <b>${esc(pendingGift.f)}</b> 送你一張 ${esc(target(pendingGift.k).name)} eSIM，登入後就能領取。`;
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
    const run = () => { loadDemo(); renderAll(); toast('已載入範例足跡'); };
    if (!trips.length) { run(); return; }
    askConfirm('載入範例足跡？', '範例會取代目前所有的行程、行程表與 eSIM 紀錄。想保留的話，先到「足跡」匯出備份。', '取代為範例', run);
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
      if (opts.budget && tripCost(d, 5).total > opts.budget) return null;
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
    return `<div class="gallery">${d.spots.map((x) => {
      const fee = `<span class="chip ${x.fee === 0 ? 'free' : 'fee'}">${x.fee === 0 ? '免費' : esc(ticketText(x))}</span>`;
      const sub = `<span class="row" style="gap:6px">${fee}<a class="small" href="${gmaps(`${x.name} ${d.name}`)}" target="_blank" rel="noopener">地圖 ↗</a></span>
        <small class="muted">${x.fee ? `成人門票 ≈ NT$${fmt(toTwd(x))}${x.note ? `・${esc(x.note)}` : ''}` : esc(x.note || '不需門票')}</small>`;
      return photoCard(spotPhoto(d.id, x.name), x.name, sub);
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
          <div class="cover ${destPhoto(d.id) ? 'has-photo' : ''}" style="background:linear-gradient(135deg,${c1},${c2})">
            ${imgHtml(destPhoto(d.id), d.name)}
            <span class="score">配對 ${r.score}%</span>
            <div><div class="small" style="opacity:.9">${flag(d.c)} ${c.name}・${r.dist ? fmtKm(r.dist) : ''}</div><h3>${esc(d.name)}</h3></div>
            ${destPhoto(d.id) ? '' : `<span class="emoji" aria-hidden="true">${DEST_EMOJI[d.tags[0]]}</span>`}
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
      tags: [], month: recState.month, hours: 0, fee: 'any', unvisited: true, budget: 0,
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
    $('#rec-budget').addEventListener('change', (e) => { recState.budget = Number(e.target.value); renderRecs(); });
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
    const pick = { ...pickForUsage(), days };
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

  // ---------- eSIM store: browse → plan → cart → checkout → my eSIM (claim → install → activate) → share
  const UA = navigator.userAgent || '';
  const IS_IOS = /iPhone|iPad|iPod/.test(UA);
  const IS_ANDROID = /Android/.test(UA);
  let esimRegion = 'hot';
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
          <div class="row" style="gap:6px"><b class="esim-name">${esc(t.name)}</b><span class="status ${S.cls}">${S.label}</span>${o.qty > 1 ? `<span class="chip sm">第 ${c.n} 張（共 ${o.qty} 張）</span>` : ''}${c.gift ? `<span class="chip sm">🎁 ${esc(c.from || '親友')}送的</span>` : ''}</div>
          <div class="small muted">${esc(planSpec(o.plan))}${ts.length ? `・${ts.map(tripLabel).join(' → ')}` : ''}</div>
          <div class="small muted">${c.installed ? `手機上的名稱：<b>${esc(labelOf(o, c))}</b>` : `購買日期 ${o.at}`}</div>
        </div>
        <button class="icon-btn" data-card-open="${o.id}:${c.id}" aria-label="詳細資訊">⋯</button>
      </div>
      ${st === 'shared' ? '<div class="banner good">👥 已分享給親友，等待領取</div>' : ''}
      ${['unclaimed', 'claimed', 'shared'].includes(st) ? `<div class="banner warn">⏰ ${esc(installAdvice(o))}</div>` : ''}
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
      : `<div class="empty"><div class="empty-icon">✈️</div><b>暫無資料</b><span class="muted small">${empty[esimTab]}</span><button class="btn primary" data-scroll="esim-shop">前往挑選方案</button></div>`;
  }
  function renderEsim() {
    $('#esim-site').href = CONFIG.esimUrl;
    renderWallet();
    const pick = smartPick();
    const bought = pick && pick.journey.some((t) => ordersFor(t.id).length);
    $('#smart-pick').innerHTML = pick && !bought ? `<div class="pick"><span class="flag-tile">${target(pick.key).icon}</span><div class="grow">
      <span class="kicker muted">為你的下一趟推薦</span><b>${esc(planLabel(pick.key, pick.plan))}</b>
      <div class="small muted">${pick.journey.map(tripLabel).join(' → ')}・${md(pick.journey[0].start)} 出發${pick.journey.length > 1 ? `・跨 ${pick.journey.length} 地一張搞定` : ''}</div></div>
      <button class="btn primary" data-plan="${pick.key}">NT$${fmt(planPrice(pick.key, pick.plan))}</button></div>` : '';
    $('#esim-regions').innerHTML = REGION_CHIPS.map(([k, v]) => `<button class="chip lg ${esimRegion === k ? 'on' : ''}" data-region="${k}">${v}</button>`).join('');
    const q = $('#esim-search').value.trim();
    let items;
    if (esimRegion === 'packs' && !q) {
      items = Object.keys(PACKS).map((k) => ({ key: k, icon: PACKS[k].icon, name: PACKS[k].name, sub: `${PACKS[k].countries.length} 國` }));
    } else {
      const codes = q ? ALL_CODES.filter((code) => countryName(code).includes(q) || code.toLowerCase() === q.toLowerCase()) : regionCodes(esimRegion);
      items = codes.map((code) => ({ key: packFor(code), code, icon: flag(code), name: countryName(code) }));
      if (q) items.push(...Object.keys(PACKS).filter((k) => PACKS[k].name.includes(q)).map((k) => ({ key: k, icon: PACKS[k].icon, name: PACKS[k].name })));
    }
    $('#esim-count').textContent = items.length ? `${items.length} 個國家・地區` : '';
    $('#esim-grid').innerHTML = items.length ? items.map((it) => `<button class="flag-btn" data-plan="${it.key}" ${it.code && it.code !== it.key ? `data-for="${it.code}"` : ''}><span class="flag-tile lg">${it.icon}</span><b>${esc(it.name)}</b><small>${it.code && it.code !== it.key ? `${esc(PACKS[it.key].name)}・` : ''}NT$${fmt(fromPrice(it.key))} 起</small></button>`).join('')
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
        <span class="icon-tile">${o.icon}</span>
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
      ${trip ? `<div class="banner info">🧳 已依你的行程帶入：${esc(trip.city)} ${md(trip.start)}–${md(orderTripsEnd(p.tripIds))}，共 ${p.days} 天</div>` : ''}
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
    fab.hidden = !user;
    const n = sum(cart, (k) => k.qty);
    $('#cart-count').textContent = n || '';
    $('#cart-count').hidden = !n;
  }
  function bumpFab() {
    if (!REDUCED) $('#cart-fab').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function openCart() {
    const total = sum(cart, (k) => planPrice(k.key, k.plan, k.qty));
    openModal('🛒 購物車', cart.length ? `
      <div class="grid" style="gap:10px">${cart.map((k) => `<div class="cart-row"><span class="flag-tile">${target(k.key).icon}</span><div class="grow"><b>${esc(target(k.key).name)}</b><div class="small muted">${esc(planSpec(k.plan))}</div><div class="small"><b>NT$${fmt(planPrice(k.key, k.plan, k.qty))}</b></div></div>
        <span class="stepper"><button data-cart-qty="${k.id}:-1" aria-label="少一張">－</button><b>${k.qty}</b><button data-cart-qty="${k.id}:1" aria-label="多一張">＋</button></span><button class="icon-btn" data-cart-del="${k.id}" aria-label="移除">✕</button></div>`).join('')}</div>
      <div class="sheet-bar"><div><small class="muted">共 ${sum(cart, (k) => k.qty)} 張</small><div class="price">NT$${fmt(total)}</div></div><span class="spacer"></span><button class="btn primary" data-checkout>前往結帳</button></div>`
      : `<div class="empty"><div class="empty-icon">🛒</div><b>購物車是空的</b><span class="small muted">${smartPick() ? '依你的下一趟行程，我們已經挑好方案。' : '先挑一個目的地吧。'}</span>${smartPick() ? `<button class="btn primary" data-plan="${smartPick().key}">看推薦方案</button>` : '<button class="btn primary" data-scroll="esim-shop">去挑方案</button>'}</div>`, { sheet: true });
  }
  function openCheckout() {
    const total = sum(cart, (k) => planPrice(k.key, k.plan, k.qty));
    const pays = [['card', '💳 信用卡'], ['apple', 'Apple Pay'], ['line', 'LINE Pay']];
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
      ${many ? `<div class="card soft"><b>👥 幫親友買？直接分享</b><p class="small muted" style="margin:6px 0 10px">把其中一張 eSIM 用 LINE 傳給同行的人，對方點連結就能領取並一鍵安裝。</p>${lineBtn('分享安裝資訊給好友', `data-share="${first.id}:${first.cards[first.cards.length - 1].id}"`)}</div>` : ''}
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
      ${st === 'shared' ? `<div class="card soft"><b>👥 已分享給親友，等待領取</b><p class="small muted" style="margin:6px 0 10px">連結 24 小時內有效。對方還沒收到的話，可以再送一次。</p>${lineBtn('再送一次分享連結', `data-share="${ref}"`)}</div>` : ''}
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
      openModal('安裝前請確認', `${warnings.map((w) => `<div class="banner warn">⚠️ ${esc(w)}</div>`).join('')}
        <div class="actions two">${o.qty > 1 && c.n > 1 && !c.gift && !c.installed ? lineBtn('改成分享給親友', `data-share="${ref}"`) : '<button class="btn" data-guide="install">看設定教學</button>'}<button class="btn" data-install-force="${ref}">我確定要安裝</button></div>`, { sheet: true });
      return;
    }
    const ideas = labelIdeas(o);
    const label = labelOf(o, c);
    // With real activation data (LPA) iOS 17.4+ opens its own eSIM setup from this link.
    const appleLink = c.lpa ? `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(c.lpa)}` : '';
    openModal(`安裝 ${esc(t.name)} eSIM`, `
      <div class="banner warn">⏰ ${esc(installAdvice(o))}</div>
      <div class="card soft"><b>1. 安裝前檢查</b>
        <ul class="pre-list"><li>✓ 已連上穩定的 Wi-Fi</li><li>✓ 手機支援 eSIM、沒有鎖網路 <button class="link" data-guide="device">怎麼確認</button></li><li>✓ 設定 → 行動服務 裡，沒有已經裝好的「${esc(label)}」</li><li>✓ 這張是自己要用的（要給別人請用「分享給親友」）</li></ul></div>
      <div class="card soft"><b>2. 先想好手機上的名稱</b><p class="small muted" style="margin:4px 0 8px">安裝時 iPhone 會問「行動方案標籤」，寫目的地＋日期，抵達後才知道要選哪一個，也不會重複安裝。</p>
        <div class="row">${ideas.map((x) => `<button class="chip lg ${x === label ? 'on' : ''}" data-label-pick="${esc(x)}" data-ref="${ref}">${esc(x)}</button>`).join('')}</div>
        <div class="row" style="margin-top:8px"><input class="input" id="label-input" maxlength="16" value="${esc(label)}" aria-label="自訂名稱" style="flex:1"><button class="btn" data-copy-label>複製</button></div></div>
      <div class="card soft"><b>3. 安裝</b>
        ${IS_ANDROID ? '' : `<p class="small muted" style="margin:4px 0 8px">iPhone（iOS 17.4 以上）點一下就會打開「啟用 eSIM」畫面，不用掃 QR Code。</p>
        ${appleLink ? `<a class="btn primary block" href="${appleLink}">一鍵安裝到 iPhone</a>` : '<button class="btn primary block" data-demo-install>一鍵安裝到 iPhone</button>'}`}
        <div class="qr-box">${c.lpa ? '' : '<span>付款完成後，這裡會顯示安裝 QR Code 與手動輸入代碼（Android 或另一支手機掃描）</span>'}</div>
        <button class="btn block" data-guide-card="${ref}" style="margin-top:10px">📖 看圖文教學（逐步畫面＋設定檢查表）</button></div>
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
    openModal('', `<div class="success"><div class="gift-icon" aria-hidden="true">🎁</div><h2>親友送你網卡！</h2><div class="small muted">${esc(g.f)} 分享了一張 eSIM 旅遊網卡給你</div></div>
      <div class="gift-card"><span class="flag-tile lg">${t.icon}</span><div class="grow"><b>${esc(t.name)}</b><div class="small muted">${esc(planSpec(g.p))}</div></div></div>
      <div class="banner warn"><b>重要提醒</b><br>天數從抵達當地、連上網路後才開始計算，建議依航線在出發當天或抵達後再安裝。領取後可以在「我的 eSIM」查看安裝步驟。</div>
      ${claimed ? '<button class="btn block" data-goto-esim>已領取，查看我的 eSIM</button>' : '<button class="btn primary block" data-claim-gift>🎁 確認領取 eSIM</button>'}`, { sheet: true });
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
      ${found.o && g.i === 0 ? `<div class="banner warn">⏰ ${esc(installAdvice(found.o))}</div>` : ''}
      <div class="guide-stage"><span class="kicker plain muted">${stageLabel}</span><div class="row"><h3>${g.i + 1}. ${esc(step.title)}</h3></div></div>
      <div class="guide-stage-body">${step.mock}</div>
      <div class="guide-nav"><button class="btn" data-gstep="-1" ${g.i === 0 ? 'disabled' : ''} aria-label="上一步">‹ 上一步</button>
        <div class="dots">${g.steps.map((x, i) => `<button class="${i === g.i ? 'on' : ''} ${x.stage}" data-gto="${i}" aria-label="第 ${i + 1} 步"></button>`).join('')}</div>
        <button class="btn primary" data-gstep="1" ${g.i === g.steps.length - 1 ? 'disabled' : ''} aria-label="下一步">下一步 ›</button></div>
      <button class="btn block" data-gplay>${g.timer ? '⏸ 暫停自動播放' : '▶ 自動播放教學'}</button>
      ${CONFIG.guideVideo ? `<a class="btn block" href="${esc(CONFIG.guideVideo)}" target="_blank" rel="noopener">🎬 看影片教學</a>` : ''}
      <div class="card soft"><div class="row"><b>三、設定總檢查表</b><span class="spacer"></span><span class="small muted">${doneChecks}/${checks.length}</span></div>
        <p class="small muted" style="margin:4px 0 8px">抵達後照著設定，每完成一項就點一下。</p>
        ${checks.map(([kind, text, state]) => `<button class="check-row ${g.checks[text] ? 'done' : ''}" data-gcheck="${esc(text)}"><span class="cbox">${g.checks[text] ? '✓' : ''}</span><span class="grow">${esc(text)}</span><i class="tg ${kind === 'off' ? '' : 'on'}"></i><span class="state ${kind}">${state}</span></button>`).join('')}
        ${doneChecks === checks.length ? '<div class="banner good" style="margin-top:8px">🎉 設定完成！打開瀏覽器或 LINE 確認可以上網。</div>' : ''}
      </div>
      <details class="faq" open><summary>⚠️ 注意事項</summary><ul class="small" style="margin:8px 0 0;padding-left:20px;display:grid;gap:4px">
        <li>台灣門號的「數據漫遊」請務必關閉，避免產生高額漫遊費。</li>
        <li>不要刪除已安裝的 eSIM：多數 QR Code 只能使用一次，刪掉就裝不回來。</li>
        <li>同一張 eSIM 不要在兩支手機安裝；要給同行的人，請用「分享給親友」。</li>
        <li>在台灣安裝後顯示「無服務」是正常的，抵達當地才會連上。</li></ul></details>
      <details class="faq"><summary>🛠️ 抵達後還是不能上網？</summary><ol class="small" style="margin:8px 0 0;padding-left:20px;display:grid;gap:4px">
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
        <div class="card soft"><b>✅ 方法一：查看 EID</b><p class="small" style="margin:6px 0 0">撥號畫面輸入 <b>*#06#</b>，出現「EID」條碼就代表支援。</p></div>
        <div class="card soft"><b>⚙️ 方法二：系統設定</b><p class="small" style="margin:6px 0 0"><span class="chip sm">iOS</span> 設定 → 行動服務 → 有「加入 eSIM」<br><span class="chip sm">Android</span> 設定 → 網路 → SIM 卡 → 有「新增 eSIM」</p></div>
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
      <div class="field"><label for="qz-key">1. 去哪裡？</label><select class="input" id="qz-key">${options.map((k) => `<option value="${k}" ${quiz.key === k ? 'selected' : ''}>${target(k).icon} ${target(k).name}</option>`).join('')}</select></div>
      <div class="field"><label>2. 玩幾天？</label><span class="stepper"><button data-qz-days="-1" aria-label="少一天">－</button><b>${quiz.days} 天</b><button data-qz-days="1" aria-label="多一天">＋</button></span></div>
      <div class="field"><label>3. 主要會用來做什麼？（可複選）</label><div class="use-grid">${Object.entries(USES).map(([k, u]) => `<button class="use ${quiz.uses.includes(k) ? 'on' : ''}" data-qz-use="${k}" aria-pressed="${quiz.uses.includes(k)}"><span>${u.icon}</span>${u.label}</button>`).join('')}</div></div>
      <div class="field"><label>幾個人一起旅行？</label><span class="stepper"><button data-qz-people="-1" aria-label="少一人">－</button><b>${quiz.people} 人</b><button data-qz-people="1" aria-label="多一人">＋</button></span></div>
      <div class="rec"><span class="kicker">推薦給你</span><div class="row"><span class="icon-tile">${opt.icon}</span><div class="grow"><b>${esc(planLabel(quiz.key, rec))}</b><div class="small">每天約 ${gb.toFixed(1)} GB・${esc(opt.persona)}${qtyNote}</div></div><b>NT$${fmt(planPrice(quiz.key, rec, qty))}</b></div>
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
    if (no) out.innerHTML = '<span style="color:var(--danger)">❌ 這個型號（或版本）可能不支援 eSIM。</span>';
    else if (ok) out.innerHTML = '<span style="color:var(--good)">✅ 一般支援 eSIM。</span> 綁約機請確認已解鎖。';
    else out.innerHTML = '🤔 無法確定，請撥 *#06#，有出現 EID 就支援。';
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
    else if (ds.albumStep) { const album = $('#album'); album.scrollBy({ left: album.clientWidth * Number(ds.albumStep), behavior: REDUCED ? 'auto' : 'smooth' }); } else if (ds.albumDel) {
      const [tripId, id] = ds.albumDel.split(':');
      store.set(albumKey(tripId), albumPhotos(tripId).filter((x) => x.id !== id));
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
        <div class="row"><h2>${y}</h2><span class="muted small">${travelerType(s)}</span><span class="spacer"></span><button class="btn sm" data-album="${y}">📖 紀念冊</button><button class="btn sm" data-share="${y}">🪪 旅遊卡</button></div>
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
    const local = node.dataset.photoKey ? photoOf(node.dataset.photoKey) : null;
    (local ? Promise.resolve(local) : wikiPhoto(title)).then((p) => {
      if (!p) { if (node.classList.contains('photo')) { node.classList.add('empty'); node.innerHTML = '<span>沒有找到照片，點「照片」看更多</span>'; } return; }
      const img = new Image();
      img.onload = () => {
        if (node.classList.contains('photo')) {
          node.style.backgroundImage = `url("${p.src}")`;
          node.innerHTML = p.page ? `<a href="${esc(p.page)}" target="_blank" rel="noopener">📷 ${esc(p.author || 'Wikipedia')}${p.license ? `・${esc(p.license)}` : ''}</a>` : '';
        } else {
          node.style.setProperty('--cover-img', `url("${p.src}")`);
          node.classList.add('loaded');
          const credit = node.querySelector('.credit');
          if (credit && p.page) { credit.href = p.page; credit.textContent = `📷 ${p.author || 'Wikipedia'}${p.license ? `・${p.license}` : ''}`; credit.hidden = false; }
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
    $('#strip-title').innerHTML = `<span class="kicker muted">Itinerary</span><h2 class="serif">${esc(t.city)} ${t.plan.days.length} 日行程</h2><span class="spacer"></span><button class="btn sm" data-open-plan="${t.id}">編輯行程表 →</button>`;
    $('#day-strip').innerHTML = t.plan.days.map((items, i) => `<button class="day-card" data-open-plan="${t.id}" data-day="${i}">
      <span class="kicker muted">Day</span><span class="dn">${pad(i + 1)}</span><span class="small muted">${dayLabel(t, i)}</span>
      <ol>${items.slice(0, 3).map((it) => `<li>${esc(it.name)}</li>`).join('') || '<li>尚未安排</li>'}</ol>${items.length > 3 ? `<span class="small muted">還有 ${items.length - 3} 項</span>` : ''}</button>`).join('');
  }

  // ---------- planner (行程表)
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
        ${it.kind === 'move' ? '' : `<div class="photo" data-photo="${esc(it.kind === 'food' ? (WIKI[t.dest] || t.city) : spotTitle(it.name))}" data-photo-key="${it.kind === 'food' ? `dest:${esc(t.dest || '')}` : `spot:${esc(t.dest || '')}:${esc(it.name)}`}">載入照片中…</div>`}
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
      ${budgetAdvice(t)}
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
    openModal(`${flag(code)} ${esc(name)}`, `
      <div class="country-hero ${hero ? '' : 'ph-missing'}">${imgHtml(hero, name)}<div class="country-hero-text"><span class="kicker">${esc(REGIONS[c.region] || '世界')}</span><h2 class="serif">${esc(name)}</h2>${c.cur ? `<span class="small">貨幣 ${esc(c.cur)}・插座 ${esc(c.plug)}</span>` : ''}</div>${creditHtml(hero)}</div>
      ${cul ? `<section><h3>🍜 必吃美食</h3><div class="gallery">${cul.food.map(([zh]) => photoCard(culturePhoto(code, zh), zh, `<a class="small" href="${gmaps(`${zh} ${name}`)}" target="_blank" rel="noopener">找附近的店 ↗</a>`)).join('')}</div></section>
      <section><h3>🎎 必體驗文化</h3><div class="gallery">${cul.culture.map(([zh]) => photoCard(culturePhoto(code, zh), zh, `<a class="small" href="${gsearch(`${zh} ${name} 體驗`)}" target="_blank" rel="noopener">怎麼體驗 ↗</a>`)).join('')}</div></section>
      <section><h3>🎁 伴手禮</h3><div class="row">${cul.buy.map((b) => `<span class="chip lg">${esc(b)}</span>`).join('')}</div></section>
      <div class="banner info"><b>💡 小提醒</b><br>${[...cul.tips, c.note].filter(Boolean).map(esc).join('<br>')}</div>`
    : `<p class="muted" style="margin:0">這個國家還沒有整理在地資料。</p><div class="row"><a class="btn" href="https://en.wikipedia.org/wiki/${encodeURIComponent(name)}" target="_blank" rel="noopener">認識這個國家 ↗</a><a class="btn" href="${gsearch(`${name} 必吃 必玩`)}" target="_blank" rel="noopener">必吃必玩 ↗</a></div>`}
      ${dests.length ? `<section><h3>📍 推薦城市</h3><div class="gallery">${dests.map((d) => `<button class="ph-card city" data-dest="${d.id}"><div class="ph ${destPhoto(d.id) ? '' : 'ph-missing'}">${imgHtml(destPhoto(d.id), d.name)}</div><figcaption><b>${esc(d.name)}</b><small class="muted">${esc(d.blurb)}</small></figcaption></button>`).join('')}</div></section>` : ''}
      ${visits.length ? `<section><h3>🧳 你去過 ${visits.length} 次</h3><ul class="timeline" style="margin-top:8px">${visits.map((t) => `<li data-trip="${t.id}"><span class="flag">${isUpcoming(t) ? '🧳' : '📍'}</span><div><b>${esc(t.city)}</b><div class="small muted">${t.start} – ${t.end}・${t.tags.map((k) => el(k).icon).join(' ')}</div></div></li>`).join('')}</ul></section>` : ''}
      <div class="actions two">
        <button class="btn primary" data-plan="${plan}" ${code && plan !== code ? `data-for="${code}"` : ''}>📶 ${esc(name)} eSIM</button>
        ${c.site ? `<a class="btn" href="${c.site}" target="_blank" rel="noopener">官方觀光網 ↗</a>` : `<a class="btn" href="${gmaps(`${name} 景點`)}" target="_blank" rel="noopener">Google 地圖 ↗</a>`}
        <button class="btn" data-trip-new="${n}">＋ 記錄一趟</button>
        ${dests[0] ? `<button class="btn" data-dest="${dests[0].id}">附近推薦</button>` : `<a class="btn" href="${gmaps(`${name} 景點`)}" target="_blank" rel="noopener">景點地圖 ↗</a>`}
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
    openModal('🎲 隨機出國', '<div id="rnd"></div>', { sheet: 'tall' });
    renderRandom();
  }
  function randomResult(d) {
    const cost = tripCost(d, rnd.days);
    const cul = CULTURE[d.c];
    const ph = destPhoto(d.id);
    return `<div class="rnd-result">
      <div class="country-hero ${ph ? '' : 'ph-missing'}">${imgHtml(ph, d.name)}<div class="country-hero-text"><span class="kicker">${flag(d.c)} ${esc(COUNTRIES[d.c].name)}・台北直飛約 ${d.hours} 小時</span><h2 class="serif">${esc(d.name)}</h2><span class="small">${esc(d.blurb)}</span></div>${creditHtml(ph)}</div>
      <div class="row">${d.months.includes(rnd.month) ? `<span class="chip free">${rnd.month} 月正是好季節</span>` : `<span class="chip">${rnd.month} 月非旺季，人少比較便宜</span>`}${d.tags.slice(0, 3).map((k) => `<span class="chip">${el(k).icon} ${el(k).label}</span>`).join('')}</div>
      <div><b class="small">${rnd.days} 天每人概估</b>${costRows(cost)}</div>
      ${cul ? `<div class="small"><b>必吃：</b>${cul.food.map(([x]) => esc(x)).join('、')}<br><b>必體驗：</b>${cul.culture.map(([x]) => esc(x)).join('、')}</div>` : ''}
      <div class="actions two"><button class="btn primary" data-trip-dest="${d.id}">＋ 排進我的行程</button><button class="btn" data-ai="${d.id}">✨ 建議行程</button><button class="btn" data-country-code="${d.c}">看在地文化</button><button class="btn" data-plan="${d.c}">📶 ${esc(COUNTRIES[d.c].name)} eSIM</button></div>
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
      <div class="field"><label>想要的元素（可不選）</label><div class="row">${Object.entries(ELEMENTS).slice(0, 8).map(([k, v]) => `<button class="chip ${rnd.tags.includes(k) ? 'on' : ''}" data-rtag="${k}">${v.icon} ${v.label}</button>`).join('')}</div></div>
      <div class="slot" id="slot">${result ? randomResult(result) : `<div class="slot-empty"><span>🎲</span><b>讓命運決定下一站</b><small class="muted">符合條件的地點有 ${list.length} 個</small></div>`}</div>
      <div class="sheet-bar"><span class="small muted">${list.length ? `${list.length} 個地點符合` : '沒有符合的地點，放寬預算或天數試試'}</span><span class="spacer"></span><button class="btn primary" data-rspin ${list.length ? '' : 'disabled'}>🎲 ${result ? '再轉一次' : '轉一下'}</button></div>`;
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
    if (!d) return '<div class="card"><h3>💡 預算回推</h3><p class="small muted" style="margin:6px 0 0">自訂城市沒有價格資料，無法概估。</p></div>';
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
    return `<div class="card"><h3>💡 預算回推</h3><p class="small muted" style="margin:4px 0 0">${esc(d.name)} ${days} 天・${people} 人的概估</p>
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
  function albumPhotos(tripId) { return store.get(albumKey(tripId), []); }
  function openAlbum(year) {
    const s = stats(year);
    const list = s.past;
    const name = esc(user?.name || '旅人');
    const coverPhotos = list.map((t) => destPhoto(t.dest)).filter(Boolean).slice(0, 4);
    const pages = [`<section class="album-page album-cover">
        <div class="collage n${coverPhotos.length}">${coverPhotos.map((p) => `<div class="album-photo">${imgHtml(p, '')}</div>`).join('')}</div>
        <div class="album-cover-text"><span class="kicker">Travel Memories</span><h2 class="serif">${year}</h2><p>${name} 的旅行紀念冊</p>
        <p class="small">${s.countries.size} 個國家・${s.cities.size} 座城市・${s.days} 天・${fmt(s.km)} 公里</p><div class="flags">${[...new Set(list.map((t) => flag(country(t.n).code)))].join(' ')}</div></div></section>`,
    ...list.map((t, i) => {
      const p = destPhoto(t.dest);
      const d = DEST[t.dest];
      const mine = albumPhotos(t.id);
      const spotsShown = d ? d.spots.map((x) => ({ x, ph: spotPhoto(d.id, x.name) })).filter((x) => x.ph).slice(0, 2) : [];
      return `<section class="album-page">
        <div class="album-hero album-photo ${p ? '' : 'ph-missing'}">${imgHtml(p, t.city)}<span class="album-no">No. ${pad(i + 1)}</span></div>
        <div class="album-body">
          <span class="kicker muted">${flag(country(t.n).code)} ${esc(country(t.n).name)}・${t.start.replace(/-/g, '.')} – ${t.end.slice(5).replace('-', '.')}</span>
          <h2 class="serif">${esc(t.city)}</h2>
          <div class="row">${t.tags.map((k) => `<span class="chip">${el(k).icon} ${el(k).label}</span>`).join('')}${Number(t.gb) ? `<span class="chip">📶 ${t.gb} GB</span>` : ''}</div>
          ${spotsShown.length ? `<div class="album-grid">${spotsShown.map(({ x, ph }) => `<figure class="album-photo">${imgHtml(ph, x.name)}<figcaption>${esc(x.name)}</figcaption></figure>`).join('')}</div>` : ''}
          <div class="album-grid mine">${mine.map((m) => `<figure class="album-photo">${`<img src="${m.src}" alt="我的照片">`}<button class="icon-btn" data-album-del="${t.id}:${m.id}" aria-label="刪除照片">✕</button></figure>`).join('')}
            <label class="album-add"><input type="file" accept="image/*" multiple hidden data-album-add="${t.id}"><span>＋</span>加入我的照片</label></div>
          <textarea class="input journal" rows="3" data-memo="${t.id}" placeholder="寫下這趟最難忘的一刻…">${esc(t.memo || '')}</textarea>
        </div></section>`;
    }),
    `<section class="album-page album-end"><span class="kicker muted">Year in Review</span><h2 class="serif">${year} 的旅行，謝謝自己</h2>
      <div class="grid stats" style="grid-template-columns:repeat(2,1fr)"><div class="stat"><b>${s.countries.size}</b><span>國家</span></div><div class="stat"><b>${s.days}</b><span>天</span></div><div class="stat"><b>${fmt(s.km)}</b><span>公里</span></div><div class="stat"><b>${s.gb.toFixed(1)}</b><span>GB 上網</span></div></div>
      <p>${esc(travelerType(s))}</p><div class="badges">${BADGES.filter((x) => { const [v, g] = x.progress(s); return v >= g; }).map((x) => `<div class="badge"><b>${x.icon}</b>${x.name}</div>`).join('') || '<span class="muted small">明年一起解鎖徽章！</span>'}</div>
      <button class="btn primary block" data-share="${year}">🪪 產生分享用旅遊卡</button></section>`];
    openModal(`📖 ${year} 旅行紀念冊`, list.length ? `<div class="album" id="album">${pages.join('')}</div>
      <div class="album-nav"><button class="btn sm" data-album-step="-1" aria-label="上一頁">‹</button><span class="small muted" id="album-page">1 / ${pages.length}</span><button class="btn sm" data-album-step="1" aria-label="下一頁">›</button></div>`
      : `<div class="empty"><div class="empty-icon">📖</div><b>${year} 還沒有旅行紀錄</b><span class="small muted">新增行程或匯入 Google 地圖時間軸，就能做出紀念冊。</span></div>`, { sheet: 'tall' });
    const album = $('#album');
    if (!album) return;
    album.addEventListener('scroll', () => {
      const i = Math.round(album.scrollLeft / album.clientWidth);
      $('#album-page').textContent = `${i + 1} / ${pages.length}`;
    }, { passive: true });
    openAlbum.year = year;
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
    const list = albumPhotos(tripId);
    const datas = await Promise.all([...files].slice(0, 6).map((f) => compressImage(f).catch(() => null)));
    datas.filter(Boolean).forEach((src) => list.push({ id: uid(), src }));
    try { localStorage.setItem(`tm:${albumKey(tripId)}`, JSON.stringify(list)); } catch { toast('這台裝置的空間滿了，請刪掉幾張照片再試'); return; }
    const page = Math.round($('#album').scrollLeft / $('#album').clientWidth);
    openAlbum(openAlbum.year);
    $('#album').scrollLeft = page * $('#album').clientWidth;
    toast('已加入紀念冊');
  }

  // ---------- delegated actions
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, li[data-trip], [data-trip]');
    if (!t) return;
    const ds = t.dataset;
    if ('flip' in ds) { t.closest('.tcard').classList.toggle('flipped'); return; }
    if (ds.plan !== undefined) { openPlan(ds.plan, ds.for ? { forCountry: ds.for } : {}); return; }
    if ('random' in ds) { openRandom(); return; }
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
    if (ds.origin) { setOrigin(ds.origin); return; }
    if (ds.tag) { recState.tags = recState.tags.includes(ds.tag) ? recState.tags.filter((x) => x !== ds.tag) : [...recState.tags, ds.tag]; renderRecs(); return; }
    if (ds.region) { esimRegion = ds.region; $('#esim-search').value = ''; renderEsim(); return; }
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
        ai: Boolean(data.ai), brand: data.brand || CONFIG.brand, esimUrl: data.esimUrl || CONFIG.esimUrl, guideVideo: data.guideVideo || '',
      });
    } catch { /* static preview without the API */ }
  }

  applyTheme();
  migrateOrders();
  pendingGift = readGift();
  window.addEventListener('hashchange', () => { const g = readGift(); if (g) { pendingGift = g; if (user) openGift(g); } });
  Promise.all([loadConfig(), loadPhotos()]).finally(() => { if (user) showApp(); else showLogin(); });
}());
