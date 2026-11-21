/* 外出好幫手 — 帶寶寶出門的小幫手（育兒階段）
 *   screen   outing   三個分頁（params.tab）：
 *                       bag    外出包：依寶寶「自己的紀錄」估算尿布、餵奶次數與奶量（不足時改用月齡建議）
 *                       plans  週末計畫：媽媽自己存的活動（可從分享連結新增、篩選、分享到 LINE）
 *                       find   找活動與設施：只放外部連結（HHZ.TW、Google 地圖搜尋），另開新分頁
 *   tool     outing   健康 → 工具
 *   homeCard outing   週五～週日，或 3 天內有計畫時才出現
 *
 * state.outing（在這裡懶建立，不改 store.js）：
 *   plans: [{ id, title, date:'YYYY-MM-DD', time:'HH:MM', place, url, indoor:'indoor'|'outdoor'|'',
 *             fee:'free'|'paid'|'', needSignup, signupBy:'YYYY-MM-DD', ageMin:months|null, ageMax:months|null,
 *             notes, createdAt, updatedAt }]
 *   bag:   { hours: 1|2|4|6|8|'night', nights, transport:'car'|'transit', weather:{hot,cold,rain}, visit (回診／打疫苗),
 *            checked:{ itemId:true }, custom:[{id,label}], doneAt }
 *
 * 不抓取任何網站、不內建任何真實活動或場館。 */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const D = () => App.OUTING;
  const { HOUR } = C;

  const SECTIONS = ['bag', 'plans', 'find'];
  const TABS = [
    { value: 'bag', label: '外出包' },
    { value: 'plans', label: '週末計畫' },
    { value: 'find', label: '找活動與設施' },
  ];
  const appName = () => (window.BRAND && window.BRAND.appName) || '易家做媽媽';

  /* ================= state ================= */
  function ensure(s = store.state) {
    if (!s.outing || typeof s.outing !== 'object') s.outing = {};
    const o = s.outing;
    if (!Array.isArray(o.plans)) o.plans = [];
    if (!o.bag || typeof o.bag !== 'object') o.bag = {};
    const b = o.bag;
    if (![1, 2, 4, 6, 8, 'night'].includes(b.hours)) b.hours = 4;
    b.nights = C.clamp(Number(b.nights) || 1, 1, 7);
    if (!['car', 'transit'].includes(b.transport)) b.transport = 'car';
    if (!b.weather || typeof b.weather !== 'object') b.weather = {};
    b.visit = b.visit === true;
    if (!b.checked || typeof b.checked !== 'object') b.checked = {};
    if (!Array.isArray(b.custom)) b.custom = [];
    return o;
  }
  ensure();
  const O = () => ensure(store.state);
  const save = (fn) => store.update((s) => fn(ensure(s)));

  /* ================= helpers ================= */
  const round10 = (v) => Math.round(v / 10) * 10;
  const ceilTo = (v, step) => Math.ceil(v / step) * step;
  const fmtH = (hrs) => `${Math.round(hrs * 10) / 10} 小時`;
  const babyMonths = (now = new Date()) => {
    const b = store.baby();
    const a = b && C.babyAge(b.birthday, now);
    return a && a.days >= 0 ? a.ageMonthsFloat : null;
  };
  const SRC = { rec: '依你最近的紀錄估算', age: '依月齡建議' };
  const SRC_SHORT = { rec: '依紀錄', age: '依月齡' };
  const srcTag = (src, short = false) => h('span', { class: `tag ot-src ${src === 'rec' ? 'ok' : ''}`, dataset: { src } }, (short ? SRC_SHORT : SRC)[src]);

  /* ================= what the baby's own records say ================= */
  function analyze(now = Date.now()) {
    const nowMs = now instanceof Date ? now.getTime() : now;
    const logs = store.babyLogs();
    const within = (hours, types) => logs.filter((l) => {
      const t = new Date(l.start).getTime();
      return types.includes(l.type) && t <= nowMs && nowMs - t < hours * HOUR;
    });
    const monthsRaw = babyMonths(new Date(nowMs));
    const months = monthsRaw == null ? 3 : monthsRaw;
    const age = D().byAge(months);

    // 尿布：最近 3 天的平均間隔（至少 4 筆）
    const diapers = within(72, ['diaper']);
    const diaperGap = diapers.length >= 4
      ? C.avgInterval(diapers.map((l) => l.start), { maxCount: 16, maxGapHours: 8 }) : null;

    // 餵奶間隔：與首頁「接下來」同一套預測（App.predict.feed），最近 48 小時至少 3 次才算「依紀錄」
    const feeds48 = within(48, ['breast', 'bottle']);
    const feedOwn = feeds48.length >= 3 ? C.avgInterval(feeds48.map((l) => l.start)) : null;
    const pred = feedOwn && App.predict && App.predict.feed ? App.predict.feed(nowMs) : null;
    const feedGap = feedOwn ? ((pred && pred.gap) || feedOwn) : C.defaultFeedGapHours(months) * HOUR;

    // 餵養方式：最近 7 天親餵／瓶餵（配方、母乳）比例
    const feeds7 = within(24 * 7, ['breast', 'bottle']);
    const breastN = feeds7.filter((l) => l.type === 'breast').length;
    const bottles7 = feeds7.filter((l) => l.type === 'bottle');
    const formulaN = bottles7.filter((l) => l.data && l.data.kind === 'formula').length;

    // 一次奶量：最近 14 天最新 10 次瓶餵的平均
    const mlList = within(24 * 14, ['bottle'])
      .sort((a, b) => new Date(b.start) - new Date(a.start))
      .map((l) => Number(l.data && l.data.ml)).filter((v) => v > 0).slice(0, 10);
    const mlOwn = mlList.length >= 2 ? round10(C.sum(mlList) / mlList.length) : null;

    // 副食品：最近 7 天、有記錄的日子平均一天幾餐
    const foods = within(24 * 7, ['food']);
    const foodDays = new Set(foods.map((l) => C.dateKey(new Date(l.start)))).size;
    const foodPerDay = foods.length >= 3 && foodDays ? foods.length / foodDays : null;

    const meds = within(24 * 14, ['med']);
    const medNames = [...new Set(meds.map((l) => String((l.data && l.data.name) || '').trim()).filter(Boolean))];
    const fever = within(24 * 14, ['temp']).some((l) => Number(l.data && l.data.c) >= 37.5);
    const pumps = within(24 * 7, ['pump']).length;

    return {
      months, monthsKnown: monthsRaw != null, age,
      diaperGap, diaperSamples: diapers.length,
      feedOwn, feedGap, feedSamples: feeds48.length,
      feeds7: feeds7.length, breastN, bottleN: bottles7.length, formulaN, bmN: bottles7.length - formulaN, mixKnown: feeds7.length >= 3,
      mlOwn, mlSamples: mlList.length, foodPerDay, medCount: meds.length, medNames, fever, pumps,
    };
  }

  /* ================= packing list ================= */
  function packList(opts = O().bag, now = Date.now()) {
    const A = analyze(now);
    const night = opts.hours === 'night';
    const nights = night ? C.clamp(Number(opts.nights) || 1, 1, 7) : 0;
    const H = night ? 24 * nights : Number(opts.hours) || 4;
    const awakeH = H <= 12 ? H : H / 2;
    const w = opts.weather || {};
    const car = opts.transport !== 'transit';
    const m = A.months;
    const items = [];
    const add = (group, id, label, extra = {}) => { items.push({ group, id, label, ...extra }); };
    const src = (own) => (own ? 'rec' : 'age');

    /* 尿布 = ceil(時數 ÷ 平均換尿布間隔) + 1 片備用 */
    const dGapH = A.diaperGap ? A.diaperGap / HOUR : A.age.diaperGapH;
    const diapers = Math.ceil(H / dGapH) + 1;
    add('diaper', 'diapers', '尿布', {
      qty: diapers, unit: '片', src: src(A.diaperGap), note: `${A.diaperGap ? '最近平均' : '一般'}約每 ${fmtH(dGapH)}換一次，多帶 1 片備用`,
    });
    add('diaper', 'wipes', '濕紙巾', { qty: H > 8 ? 2 : 1, unit: '包' });
    add('diaper', 'pad', '隔尿墊', { note: '外面的尿布台不一定乾淨' });
    add('diaper', 'bags', '塑膠袋', { qty: H > 4 ? 3 : 2, unit: '個', note: '裝髒尿布、髒衣服' });
    if (H >= 4) add('diaper', 'cream', '屁屁膏');

    /* 餵奶 = ceil(時數 ÷ 預測餵奶間隔)；天熱且 6 個月以下多備 1 次 */
    const fGapH = A.feedGap / HOUR;
    const hotExtra = w.hot && m < 6 ? 1 : 0;
    const feeds = Math.ceil(H / fGapH) + hotExtra;
    const ml = A.mlOwn || A.age.feedMl;
    const pBreast = A.mixKnown ? A.breastN / A.feeds7 : null;
    let method = 'unknown';
    if (A.mixKnown) method = pBreast >= 0.6 ? 'breast' : pBreast >= 0.15 ? 'mixed' : 'bottle';
    const breastFeeds = method === 'unknown' ? 0 : Math.round(feeds * pBreast);
    const bottleFeeds = feeds - breastFeeds;
    const formulaFeeds = method === 'unknown' || !A.bottleN ? 0 : Math.round(bottleFeeds * (A.formulaN / A.bottleN));
    const bmFeeds = method === 'unknown' ? 0 : bottleFeeds - formulaFeeds;
    const feedSrc = src(A.feedOwn);
    const volSrc = src(A.feedOwn && A.mlOwn);
    const hotNote = hotExtra ? '（天熱多備 1 次）' : '';

    if (method === 'unknown') {
      add('feed', 'bottles', '奶瓶', { qty: Math.min(feeds, 4), unit: '支', src: feedSrc, note: `預估餵 ${feeds} 次${hotNote}，約每 ${fmtH(fGapH)}一次` });
      add('feed', 'milk', '奶粉分裝或母乳', { qty: feeds, unit: '份', src: 'age', note: `每份約 ${ml} ml，依你的餵養方式準備` });
      add('feed', 'cover', '哺乳巾（親餵時）');
    } else {
      if (bottleFeeds > 0) {
        add('feed', 'bottles', '奶瓶', {
          qty: Math.min(bottleFeeds, 4), unit: '支', src: feedSrc,
          note: bottleFeeds > 4 ? `預估瓶餵 ${bottleFeeds} 次${hotNote}，可帶奶瓶刷到哺乳室清洗` : `預估瓶餵 ${bottleFeeds} 次${hotNote}，一次一支乾淨奶瓶`,
        });
      }
      if (formulaFeeds > 0) {
        add('feed', 'formula', '奶粉分裝', {
          qty: formulaFeeds, unit: '份', src: volSrc,
          note: `每份沖 ${ml} ml，約 ${Math.ceil(ml / 30)} 匙（以 1 匙配 30 ml 估算，請依奶粉罐標示）`,
        });
        add('feed', 'thermos', '保溫瓶熱開水', {
          qty: ceilTo(formulaFeeds * ml * 1.1, 50), unit: 'ml', src: volSrc, note: '依奶粉罐建議的水溫沖泡；不夠可到哺乳室補熱水',
        });
      }
      if (bmFeeds > 0) {
        const need = bmFeeds * ml;
        const avail = App.milk && App.milk.available ? App.milk.available() : 0;
        let note = '母乳庫存目前沒有紀錄';
        if (avail) note = avail >= need ? `母乳庫存有 ${avail} ml，先拿最早到期的` : `母乳庫存只有 ${avail} ml，不夠的可現擠或改用配方`;
        add('feed', 'breastmilk', '母乳', { qty: need, unit: 'ml', src: volSrc, note, avail });
        add('feed', 'cooler', '保冷袋＋保冷劑', { note: '母乳放保冷袋加保冷劑，一般建議 24 小時內喝完或放回冰箱' });
      }
      if (method !== 'bottle') {
        add('feed', 'cover', '哺乳巾', { src: 'rec', note: method === 'breast' ? '最近以親餵為主' : '最近親餵、瓶餵都有' });
        add('feed', 'nursingpads', '防溢乳墊', { qty: H > 6 ? 4 : 2, unit: '片' });
      }
      if (A.pumps >= 2 && H >= 4) add('feed', 'pump', '擠乳器＋母乳袋', { src: 'rec', note: '最近有擠奶紀錄，出門久可以照平常時間擠' });
    }
    if (m < 18) add('feed', 'burp', '紗布巾／口水巾', { qty: Math.min(4, Math.ceil(H / 3) + 1), unit: '條' });

    /* 副食品（6 個月以上） */
    if (m >= 6) {
      const perDay = A.foodPerDay || A.age.foodPerDay || 2;
      const meals = Math.max(1, Math.round((perDay * awakeH) / 12));
      add('food', 'meals', m >= 12 ? '副食品／點心' : '副食品', {
        qty: meals, unit: '份', src: src(A.foodPerDay),
        note: `${A.foodPerDay ? '最近' : '一般'}一天約 ${Math.round(perDay * 10) / 10} 餐；放保冷袋，打開後盡快吃完`,
      });
      add('food', 'spoon', '湯匙／餐具');
      add('food', 'bib', '圍兜');
      add('food', 'cup', '水杯／學習杯');
    }

    /* 衣物 */
    let sets = night ? nights + 1 : H <= 2 ? 1 : 2;
    if (m < 6 && H > 2) sets += 1;
    add('clothes', 'clothes', '替換衣物', { qty: sets, unit: '套', src: 'age', note: m < 6 ? '小月齡容易溢奶、漏尿，多帶一套' : '弄髒或流汗時替換' });
    if (m < 12) add('clothes', 'blanket', '包巾／小薄被', { note: '百貨、捷運冷氣強，也能當遮陽' });

    /* 天氣 */
    if (w.hot) {
      add('weather', 'hat', '遮陽帽');
      if (m < 6) add('weather', 'shade', '推車遮陽罩／薄長袖', { note: '6 個月以下以遮蔽、避開正午為主' });
      else {
        add('weather', 'sunscreen', '寶寶防曬乳', { note: '依產品說明使用，流汗後補擦' });
        add('weather', 'water', '多帶一瓶水', { note: '天熱容易流汗，少量多次補充' });
      }
      add('weather', 'fan', '小電扇');
    }
    if (w.cold) {
      add('weather', 'coat', '外套／防風衣');
      add('weather', 'beanie', '保暖帽');
      add('weather', 'socks', '襪子／手套');
      add('weather', 'windshield', '推車防風罩');
    }
    if (w.rain) {
      add('weather', 'raincover', '推車雨罩');
      add('weather', 'umbrella', '雨傘／雨衣');
      add('weather', 'sparesocks', '備用襪子＋鞋');
    }

    /* 證件與健康 */
    add('health', 'nhi', '寶寶健保卡');
    add('health', 'handbook', '兒童健康手冊', { note: '看診、打疫苗都用得到' });
    if (A.medCount) {
      add('health', 'meds', A.medNames.length ? `藥品：${A.medNames.slice(0, 3).join('、')}` : '寶寶最近在用的藥', {
        src: 'rec', note: '最近 14 天有用藥紀錄；依醫師處方，記得帶餵藥器',
      });
    }
    if (A.fever) add('health', 'thermo', '體溫計', { src: 'rec', note: '最近 14 天有體溫偏高的紀錄' });
    add('health', 'sanitizer', '乾洗手／酒精');
    if (opts.visit) { // 回診／打疫苗 (from 易家外出包懶人包)
      add('health', 'appt', '預約單／掛號號碼');
      add('health', 'records', '疫苗與用藥紀錄', { note: '也可以打開 App 的健康頁給醫師看' });
      add('health', 'questions', '想問醫師的問題', { note: '先寫在手機裡，看診時才不會忘' });
    }

    /* 移動 */
    if (car) {
      add('move', 'carseat', '汽車安全座椅', { note: '4 歲以下且 18 公斤以下幼童乘車需使用安全座椅' });
      add('move', 'stroller', '推車', { note: '放後車廂，下車就能用' });
      if (w.hot) add('move', 'sunshade', '車窗遮陽簾');
    } else {
      add('move', 'carrier', '背巾／揹帶', { note: '搭捷運、公車上下車比推車方便' });
      add('move', 'stroller', '輕便推車（可收折）', { note: '要走比較久時再帶' });
      add('move', 'card', '悠遊卡／一卡通');
    }

    /* 過夜 */
    if (night) {
      add('night', 'pajamas', '睡衣＋睡袋／包巾', { qty: nights, unit: '套' });
      add('night', 'bath', '沐浴用品＋毛巾');
      if (bottleFeeds > 0) add('night', 'brush', '奶瓶刷＋奶瓶清潔劑');
      add('night', 'lovey', '平常睡覺的安撫物', { note: '換地方睡比較安心' });
      add('night', 'nightlight', '小夜燈（選帶）');
    }

    /* 安撫與其他 */
    if (m < 12) add('other', 'pacifier', '安撫奶嘴（有用的話）');
    add('other', 'toy', m >= 4 ? '小玩具／固齒器' : '安撫巾');
    add('other', 'power', '行動電源');
    add('other', 'momsnack', '媽媽的水和點心', { note: '照顧寶寶，也別忘了自己' });

    (opts.custom || []).forEach((c) => add('custom', `c-${c.id}`, c.label, { custom: c.id }));

    const summary = [
      { id: 'diapers', icon: '🧷', label: '尿布', value: `${diapers} 片`, src: src(A.diaperGap) },
      { id: 'feeds', icon: '🍼', label: hotExtra ? '餵奶（含天熱 +1）' : '餵奶', value: `約 ${feeds} 次`, src: feedSrc },
      method === 'breast'
        ? { id: 'ml', icon: '🤱', label: '餵養方式', value: '親餵為主', src: 'rec' }
        : { id: 'ml', icon: '🥛', label: '每次奶量', value: `約 ${ml} ml`, src: src(A.mlOwn) },
    ];
    return {
      hours: H, night, nights, items, summary, basis: A,
      diapers, feeds, ml, method, breastFeeds, bottleFeeds, formulaFeeds, bmFeeds,
    };
  }

  function basisText(L) {
    const A = L.basis;
    const parts = [];
    if (A.diaperGap) parts.push(`尿布平均每 ${fmtH(A.diaperGap / HOUR)}`);
    if (A.feedOwn) parts.push(`餵奶平均每 ${fmtH(A.feedGap / HOUR)}`);
    if (A.mlOwn) parts.push(`瓶餵平均 ${A.mlOwn} ml`);
    if (A.mixKnown) parts.push(`7 天內親餵 ${A.breastN} 次、瓶餵 ${A.bottleN} 次`);
    return parts.length
      ? `最近的紀錄：${parts.join('・')}。`
      : '還沒有足夠的紀錄，先依月齡建議；多記幾天尿布和餵奶，估算會更貼近寶寶。';
  }

  const itemText = (i) => (i.qty ? `${i.label} ${i.qty} ${i.unit || ''}`.trim() : i.label);
  // 分享文字不放藥名（分享出去的頻道可能是公開的）
  const shareItemText = (i) => (i.id === 'meds' ? '寶寶的常用藥' : itemText(i));
  const durationLabel = (b) => (b.hours === 'night' ? `過夜 ${b.nights} 晚` : `${b.hours} 小時`);
  const lineUrl = (text) => `https://line.me/R/share?text=${encodeURIComponent(text)}`;
  const optsLabel = (b) => {
    const opts = [durationLabel(b), b.transport === 'transit' ? '大眾運輸' : '開車'];
    if (b.weather.hot) opts.push('炎熱');
    if (b.weather.cold) opts.push('寒冷');
    if (b.weather.rain) opts.push('下雨');
    if (b.visit) opts.push('回診／打疫苗');
    return opts.join('・');
  };

  // footer=false when App.share adds its own app link below the text
  function bagShareText(L, b = O().bag, { footer = true } = {}) {
    const baby = store.baby();
    const lines = [`🎒 ${baby ? `${baby.name}的` : ''}外出包清單（${optsLabel(b)}）`];
    D().GROUPS.forEach((g) => {
      const its = L.items.filter((i) => i.group === g.id);
      if (!its.length) return;
      lines.push('', `【${g.label}】`);
      its.forEach((i) => lines.push(`${b.checked[i.id] ? '☑' : '☐'} ${shareItemText(i)}`));
    });
    if (footer) lines.push('', `— ${appName()}・外出好幫手`);
    return lines.join('\n');
  }
  // payload for App.share.open (share sheet + branded card). The card shows only counts, never medical details.
  function bagSharePayload(L, b = O().bag) {
    const done = L.items.filter((i) => b.checked[i.id]).length;
    const feedLine = L.method === 'breast' ? `餵奶約 ${L.feeds} 次（親餵為主）` : `餵奶約 ${L.feeds} 次・每次約 ${L.ml} ml`;
    return {
      title: '外出包清單',
      text: bagShareText(L, b, { footer: false }),
      path: 'outing',
      params: { tab: 'bag' },
      campaign: 'outing-bag',
      emoji: '🎒',
      kicker: `外出好幫手・${optsLabel(b)}`,
      lines: [`尿布 ${L.diapers} 片`, feedLine, `共 ${L.items.length} 項，已打包 ${done} 項`],
      // 分享工作室: the summary first; each item (packed ✓, medicines never named) can be added
      items: [{ text: `尿布 ${L.diapers} 片` }, { text: feedLine }, { text: `共 ${L.items.length} 項，已打包 ${done} 項` },
        ...L.items.map((i) => ({ text: shareItemText(i), done: !!b.checked[i.id], extra: true }))],
      theme: 'purple',
      sheetTitle: '分享外出包清單',
    };
  }
  // App.share loads after this module, so look it up at render time.
  const hasShare = () => !!(App.share && typeof App.share.open === 'function');
  function shareControl(getPayload, getText, { label, cls, ariaLabel }) {
    if (hasShare()) {
      const btn = App.share.button ? App.share.button(getPayload, { label, cls })
        : h('button', { type: 'button', class: cls, onclick: () => App.share.open(getPayload()) }, label);
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-label', ariaLabel || label);
      btn.classList.add('ot-share');
      return btn;
    }
    return h('a', {
      class: `${cls} ot-line`, href: lineUrl(getText()), target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${ariaLabel || label}（開啟 LINE）`,
    }, ui.icon('line', 'ot-line-ic'), label);
  }

  /* ================= plans ================= */
  const todayKey = (now = new Date()) => C.dateKey(now);
  // 本週末：週一～五 → 這個週六、日；週六 → 今明兩天；週日 → 今天
  function weekendRange(now = new Date()) {
    const d = C.startOfDay(now);
    const dow = d.getDay();
    if (dow === 6) return [C.dateKey(d), C.dateKey(C.addDays(d, 1))];
    if (dow === 0) return [C.dateKey(d), C.dateKey(d)];
    const sat = C.addDays(d, 6 - dow);
    return [C.dateKey(sat), C.dateKey(C.addDays(sat, 1))];
  }
  const isThisWeekend = (p, now = new Date()) => {
    const [a, b] = weekendRange(now);
    return p.date >= a && p.date <= b;
  };
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  // 年齡上限是整歲時（如「2 歲」）以整歲計：2 歲 11 個月仍算 2 歲
  function ageFits(p, months) {
    if (months == null) return true;
    const min = num(p.ageMin);
    const max = num(p.ageMax);
    if (min != null && months < min) return false;
    if (max != null) {
      const ok = max >= 12 && max % 12 === 0 ? Math.floor(months / 12) <= max / 12 : months <= max;
      if (!ok) return false;
    }
    return true;
  }
  const ageText = (mo) => {
    const opt = D().AGE_OPTIONS.find((o) => o.value === mo);
    if (opt) return opt.label;
    return mo >= 12 ? `${Math.round((mo / 12) * 10) / 10} 歲` : `${mo} 個月`;
  };
  function ageLabel(p) {
    const min = num(p.ageMin);
    const max = num(p.ageMax);
    if (min == null && max == null) return '';
    if (min != null && max != null) return `${ageText(min)}–${ageText(max)}`;
    return min != null ? `${ageText(min)}以上` : `${ageText(max)}以下`;
  }
  const FILTERS = [
    { id: 'weekend', label: '本週末', test: (p, ctx) => isThisWeekend(p, ctx.now) },
    { id: 'indoor', label: '室內', test: (p) => p.indoor === 'indoor' },
    { id: 'free', label: '免費', test: (p) => p.fee === 'free' },
    { id: 'nosignup', label: '不需報名', test: (p) => !p.needSignup },
    { id: 'age', label: '適合寶寶月齡', test: (p, ctx) => ageFits(p, ctx.months) },
  ];
  function filterPlans(list, active = {}, now = new Date()) {
    const ctx = { now, months: babyMonths(now) };
    return list.filter((p) => FILTERS.every((f) => !active[f.id] || f.test(p, ctx)));
  }
  const sortKey = (p) => `${p.date} ${p.time || '99:99'}`;
  const upcoming = (now = new Date()) => O().plans.filter((p) => p.date >= todayKey(now)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const pastPlans = (now = new Date()) => O().plans.filter((p) => p.date < todayKey(now)).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

  function relDay(p, now = new Date()) {
    const d = C.diffDays(now, p.date);
    if (d === 0) return '今天';
    if (d === 1) return '明天';
    if (d === 2) return '後天';
    if (d < 0) return `${-d} 天前`;
    return `${d} 天後`;
  }
  function signupInfo(p, now = new Date()) {
    if (!p.needSignup) return null;
    if (!p.signupBy) return { text: '需報名', cls: 'warn' };
    const left = C.diffDays(now, p.signupBy);
    if (left < 0) return { text: '報名已截止', cls: 'danger' };
    if (left === 0) return { text: '今天報名截止', cls: 'danger' };
    if (left <= 3) return { text: `報名剩 ${left} 天`, cls: 'warn' };
    return { text: `${C.fmtDate(p.signupBy, false)} 前報名`, cls: '' };
  }

  // 只接受 http(s) 連結；分享文字裡夾帶的網址也抓得出來
  const BARE_DOMAIN = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
  function cleanUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    let cand = (s.match(/https?:\/\/[^\s<>"'「」『』（）()，。、！？；]+/i) || [])[0];
    if (!cand && BARE_DOMAIN.test(s)) cand = `https://${s}`;
    if (!cand) return '';
    try {
      const u = new URL(cand);
      return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : '';
    } catch (e) { return ''; }
  }
  function extractShared(text) {
    const raw = String(text || '');
    const url = cleanUrl(raw);
    let title = '';
    if (!BARE_DOMAIN.test(raw.trim())) {
      title = raw.replace(/https?:\/\/\S+/ig, ' ').split(/\n/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean)[0] || '';
    }
    return { url, title: title.slice(0, 60) };
  }

  const planTags = (p) => [
    p.indoor === 'indoor' ? '室內' : p.indoor === 'outdoor' ? '戶外' : '',
    p.fee === 'free' ? '免費' : p.fee === 'paid' ? '付費' : '',
    ageLabel(p) ? `適合 ${ageLabel(p)}` : '',
  ].filter(Boolean);
  function planShareText(p, { footer = true } = {}) {
    const lines = [`📅 ${p.title}`, `🗓 ${C.fmtDateLong(p.date)}${p.time ? ` ${p.time}` : ''}`];
    if (p.place) lines.push(`📍 ${p.place}`);
    const tags = planTags(p);
    if (tags.length) lines.push(`🏷 ${tags.join('・')}`);
    if (p.needSignup) lines.push(p.signupBy ? `✍️ ${C.fmtDate(p.signupBy)}前要報名` : '✍️ 需要事先報名');
    if (p.url) lines.push(`活動詳情：${p.url}`);
    if (footer) lines.push('', `— ${appName()}・週末計畫`);
    return lines.join('\n');
  }
  function planSharePayload(p) {
    return {
      title: p.title,
      text: planShareText(p, { footer: false }),
      path: 'outing',
      params: { tab: 'plans' },
      campaign: 'outing-plan',
      emoji: '📅',
      kicker: '週末計畫',
      lines: [
        `${C.fmtDate(p.date)}${p.time ? ` ${p.time}` : ''}`,
        p.place ? `📍 ${p.place}` : '',
        planTags(p).join('・'),
      ].filter(Boolean),
      theme: 'green',
      sheetTitle: '分享這個計畫',
    };
  }

  function shouldShowHome(now = new Date()) {
    const b = store.baby();
    if (!b) return false;
    const dow = now.getDay();
    const weekend = dow === 5 || dow === 6 || dow === 0;
    const next = upcoming(now)[0];
    if (next && C.diffDays(now, next.date) <= (weekend ? 7 : 3)) return true; // her own plans
    if (!weekend) return false;
    // 「週末想帶寶寶出門嗎？」 waits until 坐月子 is over (the first 30 days)
    return !(b.birthday && C.diffDays(b.birthday, now) < 30);
  }

  /* ================= UI state ================= */
  let section = 'bag';
  let filters = {};
  let refocus = null; // selector to focus after the next render (keeps keyboard / screen-reader position)
  const sectionOf = (params) => (params && SECTIONS.includes(params.tab) ? params.tab : section);
  function setSection(v) {
    section = v;
    try { history.replaceState(history.state, '', `#/outing?${encodeURIComponent(JSON.stringify({ tab: v }))}`); } catch (e) { /* ignore */ }
    App.refresh();
    window.scrollTo(0, 0);
  }
  const group = (label, control) => h('div', { class: 'field ot-group', role: 'group', 'aria-label': label },
    h('span', { class: 'field-label' }, label), control);

  /* ================= 外出包 ================= */
  function renderBag(el) {
    const baby = store.baby();
    if (!baby) {
      el.append(ui.empty('👶', '先新增寶寶資料，就能依寶寶的紀錄估算外出包。',
        h('button', { class: 'btn btn-primary', onclick: () => App.me && App.me.editBaby() }, '新增寶寶')));
      return;
    }
    const b = O().bag;
    const L = packList(b);
    const age = C.babyAge(baby.birthday);

    const hours = h('div', { class: 'ot-hours', role: 'radiogroup', 'aria-label': '外出多久' }, D().DURATIONS.map((d) => {
      const on = b.hours === d.value;
      return h('button', {
        type: 'button', role: 'radio', class: `ot-hour${on ? ' active' : ''}`, 'aria-checked': String(on), dataset: { hours: String(d.value) },
        onclick: () => { refocus = `[data-hours="${d.value}"]`; save((o) => { o.bag.hours = d.value; }); },
      }, d.label);
    }));
    const nights = h('div', { class: 'ot-nights' },
      h('button', {
        type: 'button', class: 'stepper-btn', 'aria-label': '少住一晚', disabled: b.nights <= 1, dataset: { nights: 'minus' },
        onclick: () => { refocus = '[data-nights="minus"]'; save((o) => { o.bag.nights = Math.max(1, o.bag.nights - 1); }); },
      }, '−'),
      h('span', { class: 'ot-nights-val num', 'aria-live': 'polite' }, `${b.nights} 晚`),
      h('button', {
        type: 'button', class: 'stepper-btn', 'aria-label': '多住一晚', disabled: b.nights >= 7, dataset: { nights: 'plus' },
        onclick: () => { refocus = '[data-nights="plus"]'; save((o) => { o.bag.nights = Math.min(7, o.bag.nights + 1); }); },
      }, '+'));
    const transport = ui.seg([{ value: 'car', label: '開車', icon: '🚗' }, { value: 'transit', label: '大眾運輸', icon: '🚇' }], b.transport,
      (v) => { refocus = `.ot-transport [aria-checked="true"]`; save((o) => { o.bag.transport = v; }); });
    transport.classList.add('ot-transport');
    transport.setAttribute('aria-label', '交通方式');
    const WX = [{ id: 'hot', label: '炎熱', icon: '☀️' }, { id: 'cold', label: '寒冷', icon: '🧣' }, { id: 'rain', label: '下雨', icon: '☂️' }];
    const wx = h('div', { class: 'chips ot-chips' }, WX.map((x) => h('button', {
      type: 'button', class: 'chip ot-chip', 'aria-pressed': String(!!b.weather[x.id]), dataset: { wx: x.id },
      onclick: () => {
        refocus = `[data-wx="${x.id}"]`;
        save((o) => {
          const on = !o.bag.weather[x.id];
          o.bag.weather[x.id] = on;
          if (on && x.id === 'hot') o.bag.weather.cold = false;
          if (on && x.id === 'cold') o.bag.weather.hot = false;
        });
      },
    }, h('span', { 'aria-hidden': 'true' }, x.icon), x.label)));
    const visit = h('div', { class: 'chips' }, h('button', {
      type: 'button', class: 'chip ot-visit', 'aria-pressed': String(!!b.visit),
      onclick: () => { refocus = '.ot-visit'; save((o) => { o.bag.visit = !o.bag.visit; }); },
    }, h('span', { 'aria-hidden': 'true' }, '🩺'), '回診／打疫苗'));

    el.append(ui.card({ class: 'ot-opts' },
      h('div', { class: 'card-title' }, `🎒 帶${baby.name}出門`),
      h('p', { class: 'small muted' }, `${age ? `${age.text}・` : ''}選好時間和狀況，清單會自動算好`),
      group('外出多久', hours),
      b.hours === 'night' ? group('住幾晚', nights) : null,
      group('交通', transport),
      group('天氣（可複選）', wx),
      group('這趟要', visit)));

    el.append(ui.card({ class: 'ot-est' },
      h('div', { class: 'card-title' }, '📏 估算結果', h('span', { class: 'tiny muted ot-est-h' }, durationLabel(b))),
      h('div', { class: 'ot-sum' }, L.summary.map((s) => h('div', { class: 'ot-sum-item', dataset: { sum: s.id } },
        h('div', { class: 'ot-sum-ico', 'aria-hidden': 'true' }, s.icon),
        h('div', { class: 'ot-sum-val num' }, s.value),
        h('div', { class: 'tiny muted' }, s.label),
        srcTag(s.src, true)))),
      h('p', { class: 'small muted ot-basis' }, basisText(L)),
      h('p', { class: 'tiny faint' }, '「依紀錄」＝依你最近的紀錄估算；「依月齡」＝紀錄不足時，依月齡建議。')));

    const ids = L.items.map((i) => i.id);
    const done = ids.filter((id) => b.checked[id]).length;
    el.append(h('div', { class: 'ot-progress' },
      h('div', { class: 'row between' },
        h('span', { class: 'bold' }, done === ids.length ? '全部打包好了 🎉' : '打包進度'),
        h('span', { class: 'bold num', dataset: { progress: `${done}/${ids.length}` } }, `${done}/${ids.length}`)),
      ui.progress(ids.length ? done / ids.length : 0)));

    D().GROUPS.forEach((g) => {
      const its = L.items.filter((i) => i.group === g.id);
      if (!its.length && g.id !== 'custom') return;
      const gd = its.filter((i) => b.checked[i.id]).length;
      el.append(h('div', { class: 'section-title' }, h('span', null, `${g.icon} ${g.label}`),
        its.length ? h('span', { class: 'small muted num' }, `${gd}/${its.length}`) : null));
      if (its.length) el.append(h('div', { class: 'list ot-list', dataset: { group: g.id } }, its.map(itemRow)));
      if (g.id === 'custom') el.append(customAdd());
    });

    el.append(h('div', { class: 'ot-actions' },
      h('button', { type: 'button', class: 'btn btn-primary btn-block ot-finish', onclick: () => finishCheck(L) }, '✅ 出門前檢查完畢'),
      h('div', { class: 'row gap' },
        shareControl(() => bagSharePayload(L, O().bag), () => bagShareText(L, b), {
          label: hasShare() ? '分享清單' : '分享到 LINE', cls: 'btn btn-ghost grow ot-bag-share', ariaLabel: hasShare() ? '分享清單（外出包）' : '分享到 LINE',
        }),
        h('button', { type: 'button', class: 'btn btn-ghost grow ot-reset', onclick: resetChecks }, '重設勾選')),
      b.doneAt ? h('p', { class: 'small muted center ot-done-at' }, `上次檢查完畢：${C.fmtDate(new Date(b.doneAt))} ${C.fmtTime(b.doneAt)}`) : null));
    el.append(h('p', { class: 'disclaimer' }, '數量是依寶寶最近的紀錄或月齡估算的參考值，請依寶寶當天狀況、天氣與行程調整。'));
  }

  function itemRow(it) {
    const on = !!O().bag.checked[it.id];
    const cb = h('input', {
      type: 'checkbox', checked: on,
      onchange: () => {
        refocus = `[data-item="${it.id}"] input`;
        save((o) => { if (cb.checked) o.bag.checked[it.id] = true; else delete o.bag.checked[it.id]; });
      },
    });
    return h('div', { class: `list-item ot-item${on ? ' done' : ''}`, dataset: { item: it.id } },
      h('label', { class: 'ot-item-main' }, cb,
        h('span', { class: 'li-body' },
          h('span', { class: 'li-title' }, it.label, it.qty ? h('b', { class: 'ot-qty num' }, ` ${it.qty} ${it.unit || ''}`) : null),
          it.note ? h('span', { class: 'li-sub' }, it.note) : null,
          it.src ? srcTag(it.src) : null)),
      it.custom ? h('button', {
        type: 'button', class: 'icon-btn ot-icon', 'aria-label': `刪除「${it.label}」`, html: ui.ICONS.trash,
        onclick: () => save((o) => { o.bag.custom = o.bag.custom.filter((c) => c.id !== it.custom); delete o.bag.checked[it.id]; }),
      }) : null);
  }

  function customAdd() {
    const input = h('input', { class: 'input grow', placeholder: '例如：寶寶的小毯子', 'aria-label': '自己要加的東西', maxlength: 40 });
    const add = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      refocus = '.ot-custom input';
      save((o) => { o.bag.custom.push({ id: C.uid(), label: v }); });
      ui.toast('已加入清單');
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return h('div', { class: 'row gap ot-custom' }, input, h('button', { type: 'button', class: 'btn btn-soft', onclick: add }, '加入'));
  }

  async function finishCheck(L) {
    const b = O().bag;
    const left = L.items.filter((i) => !b.checked[i.id]);
    if (left.length) {
      const names = left.slice(0, 3).map((i) => i.label).join('、') + (left.length > 3 ? '…' : '');
      const yes = await ui.confirm(`還有 ${left.length} 項沒勾（${names}），都帶了嗎？`, { ok: '都帶了', cancel: '再檢查一下' });
      if (!yes) return;
    }
    save((o) => { L.items.forEach((i) => { o.bag.checked[i.id] = true; }); o.bag.doneAt = new Date().toISOString(); });
    ui.toast('準備好了，出門順利！🎒');
  }
  async function resetChecks() {
    if (!(await ui.confirm('清除全部勾選，重新檢查？', { ok: '清除' }))) return;
    save((o) => { o.bag.checked = {}; o.bag.doneAt = null; });
    ui.toast('已重設，可以重新檢查');
  }

  /* ================= 週末計畫 ================= */
  function renderPlans(el) {
    const now = new Date();
    const all = O().plans;
    el.append(pasteCard());
    el.append(h('div', { class: 'chips ot-chips ot-filters', role: 'group', 'aria-label': '篩選計畫' }, FILTERS.map((f) => h('button', {
      type: 'button', class: 'chip ot-chip', 'aria-pressed': String(!!filters[f.id]), dataset: { filter: f.id },
      onclick: () => { filters = { ...filters, [f.id]: !filters[f.id] }; refocus = `[data-filter="${f.id}"]`; App.refresh(); },
    }, f.label))));
    const anyFilter = FILTERS.some((f) => filters[f.id]);
    const up = filterPlans(upcoming(now), filters, now);
    const old = filterPlans(pastPlans(now), filters, now).slice(0, 10);
    el.append(h('div', { class: 'section-title' }, h('span', null, `接下來（${up.length}）`),
      h('button', { type: 'button', class: 'ot-add', onclick: () => planSheet() }, '＋ 新增計畫')));
    if (!all.length) {
      el.append(ui.empty('📅', '還沒有週末計畫。在 HHZ.TW 等活動網站看到想去的活動，按「分享 → 複製連結」，回來貼在上面就能存起來；也可以按「＋ 新增計畫」自己輸入。',
        h('div', { class: 'row gap wrap ot-empty-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => planSheet() }, '＋ 新增計畫'),
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => setSection('find') }, '去找活動'))));
    } else if (!up.length) {
      el.append(ui.empty('🔍', anyFilter ? '沒有符合篩選條件的計畫，試試取消幾個條件。' : '接下來沒有計畫，到「找活動與設施」逛逛吧！'));
    } else {
      el.append(h('div', { class: 'ot-plans' }, up.map((p) => planCard(p, now))));
    }
    if (old.length) {
      el.append(h('div', { class: 'section-title' }, h('span', null, '已經過去'), h('span', { class: 'small muted' }, `最近 ${old.length} 筆`)));
      el.append(h('div', { class: 'ot-plans' }, old.map((p) => planCard(p, now, true))));
    }
  }

  function pasteCard() {
    const input = h('input', {
      class: 'input grow', type: 'text', inputmode: 'url', autocomplete: 'off', placeholder: '貼上活動連結或分享文字', 'aria-label': '活動連結',
    });
    const go = () => {
      const r = extractShared(input.value);
      if (!r.url) { ui.toast('找不到連結，請貼上 http 開頭的網址'); input.focus(); return; }
      input.value = '';
      planSheet(null, r);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const canClip = !!(navigator.clipboard && navigator.clipboard.readText);
    return ui.card({ class: 'soft ot-paste' },
      h('div', { class: 'card-title' }, '🔗 從連結新增'),
      h('p', { class: 'small muted' }, '在活動網站或 LINE 看到想去的活動，複製連結貼在這裡，存成自己的週末計畫。'),
      h('div', { class: 'row gap' }, input, h('button', { type: 'button', class: 'btn btn-primary ot-paste-go', onclick: go }, '新增')),
      canClip ? h('button', {
        type: 'button', class: 'link-btn small ot-clip',
        onclick: async () => {
          try { input.value = await navigator.clipboard.readText(); go(); } catch (e) { ui.toast('無法讀取剪貼簿，請長按輸入框貼上'); }
        },
      }, '📋 直接貼上剪貼簿的連結') : null);
  }

  function planCard(p, now, past = false) {
    const d = C.parseKey(p.date);
    const months = babyMonths(now);
    const tags = [];
    if (!past && isThisWeekend(p, now)) tags.push(['本週末', 'primary']);
    if (p.indoor) tags.push([p.indoor === 'indoor' ? '室內' : '戶外', '']);
    if (p.fee) tags.push([p.fee === 'free' ? '免費' : '付費', p.fee === 'free' ? 'ok' : '']);
    const su = past ? null : signupInfo(p, now);
    if (su) tags.push([su.text, su.cls]);
    const al = ageLabel(p);
    if (al) tags.push([`適合 ${al}`, ageFits(p, months) ? '' : 'warn']);
    return h('article', { class: `card ot-plan${past ? ' past' : ''}`, dataset: { plan: p.id } },
      h('div', { class: 'ot-date', 'aria-hidden': 'true' },
        h('span', { class: 'ot-date-m' }, `${d.getMonth() + 1}月`),
        h('b', { class: 'ot-date-d num' }, d.getDate()),
        h('span', { class: 'ot-date-w' }, `週${C.WEEKDAYS[d.getDay()]}`)),
      h('div', { class: 'ot-plan-body' },
        h('h3', { class: 'ot-plan-title' }, p.title),
        h('div', { class: 'small muted num' }, `${C.fmtDate(d)}・${relDay(p, now)}${p.time ? `・${p.time}` : ''}`),
        p.place ? h('a', {
          class: 'ot-place small', href: D().mapsSearch(p.place), target: '_blank', rel: 'noopener noreferrer',
        }, h('span', { 'aria-hidden': 'true' }, '📍 '), p.place, h('span', { class: 'ot-sr' }, '（在 Google 地圖開啟）')) : null,
        tags.length ? h('div', { class: 'ot-tags' }, tags.map(([t, cls]) => h('span', { class: `tag ${cls}` }, t))) : null,
        p.notes ? h('p', { class: 'small ot-notes' }, p.notes) : null,
        h('div', { class: 'ot-plan-actions' },
          p.url ? h('a', {
            class: 'btn btn-sm btn-soft ot-btn ot-open', href: p.url, target: '_blank', rel: 'noopener noreferrer',
          }, '查看活動詳情', h('span', { 'aria-hidden': 'true' }, ' ↗'), h('span', { class: 'ot-sr' }, '（外部網站，另開新分頁）')) : null,
          shareControl(() => planSharePayload(p), () => planShareText(p), {
            label: hasShare() ? '分享' : 'LINE', cls: 'btn btn-sm btn-ghost ot-btn ot-plan-share', ariaLabel: hasShare() ? `分享「${p.title}」` : `分享「${p.title}」到 LINE`,
          }),
          h('span', { class: 'grow' }),
          h('button', { type: 'button', class: 'icon-btn ot-icon ot-edit', 'aria-label': `編輯「${p.title}」`, html: ui.ICONS.edit, onclick: () => planSheet(p) }),
          h('button', { type: 'button', class: 'icon-btn ot-icon ot-del', 'aria-label': `刪除「${p.title}」`, html: ui.ICONS.trash, onclick: () => removePlan(p) }))));
  }

  async function removePlan(p) {
    if (!(await ui.confirm(`刪除「${p.title}」？`, { ok: '刪除', danger: true }))) return;
    const copy = JSON.parse(JSON.stringify(p));
    save((o) => { o.plans = o.plans.filter((x) => x.id !== p.id); });
    ui.toast('已刪除計畫', { action: '復原', onAction: () => save((o) => { if (!o.plans.some((x) => x.id === copy.id)) o.plans.push(copy); }) });
  }

  function planSheet(plan, preset = {}) {
    const isEdit = !!plan;
    const p = {
      title: '', date: weekendRange()[0], time: '', place: '', url: '', indoor: '', fee: '',
      needSignup: false, signupBy: '', ageMin: null, ageMax: null, notes: '', ...preset, ...(plan || {}),
    };
    const title = h('input', { value: p.title, placeholder: '例如：親子館手作課', maxlength: 60, required: true, name: 'title' });
    const date = h('input', { type: 'date', value: p.date, required: true, name: 'date' });
    const time = h('input', { type: 'time', value: p.time || '', name: 'time' });
    const place = h('input', { value: p.place || '', placeholder: '例如：○○親子館（選填）', maxlength: 80, name: 'place' });
    const url = h('input', { type: 'url', inputmode: 'url', value: p.url || '', placeholder: 'https://…（選填）', name: 'url' });
    const indoor = ui.seg([{ value: '', label: '未定' }, { value: 'indoor', label: '室內' }, { value: 'outdoor', label: '戶外' }], p.indoor || '', null, { small: true });
    indoor.classList.add('ot-seg-indoor');
    const fee = ui.seg([{ value: '', label: '未定' }, { value: 'free', label: '免費' }, { value: 'paid', label: '付費' }], p.fee || '', null, { small: true });
    fee.classList.add('ot-seg-fee');
    const signup = h('input', { type: 'checkbox', checked: !!p.needSignup, name: 'needSignup' });
    const signupBy = h('input', { type: 'date', value: p.signupBy || '', name: 'signupBy' });
    const signupField = ui.field('報名截止日', signupBy, '截止前 3 天，卡片上會提醒');
    signupField.hidden = !p.needSignup;
    signup.addEventListener('change', () => { signupField.hidden = !signup.checked; });
    const ageSel = (v, label, name) => h('select', { 'aria-label': label, name },
      D().AGE_OPTIONS.map((o) => h('option', { value: String(o.value), selected: String(v ?? '') === String(o.value) }, o.label)));
    const ageMin = ageSel(p.ageMin, '適合年齡：從', 'ageMin');
    const ageMax = ageSel(p.ageMax, '適合年齡：到', 'ageMax');
    const notes = h('textarea', { rows: 2, placeholder: '要帶的東西、集合地點…（選填）', maxlength: 300, name: 'notes' }, p.notes || '');

    const body = h('div', { class: 'ot-form' },
      ui.field('活動名稱', title),
      h('div', { class: 'grid-2' }, ui.field('日期', date), ui.field('時間', time)),
      ui.field('地點', place),
      ui.field('活動連結', url, '卡片上可以一鍵打開、分享給家人'),
      group('室內／戶外', indoor),
      group('費用', fee),
      h('label', { class: 'check-row ot-check' }, signup, h('span', null, '需要事先報名')),
      signupField,
      group('適合年齡', h('div', { class: 'ot-age-row' }, ageMin, h('span', { class: 'muted', 'aria-hidden': 'true' }, '到'), ageMax)),
      ui.field('備註', notes));

    const doSave = () => {
      const t = title.value.trim();
      if (!t) { ui.toast('請填活動名稱'); title.focus(); return; }
      if (!date.value) { ui.toast('請選日期'); date.focus(); return; }
      const rawUrl = url.value.trim();
      const cu = cleanUrl(rawUrl);
      if (rawUrl && !cu) { ui.toast('連結格式不正確，請用 http 開頭的網址'); url.focus(); return; }
      let aMin = ageMin.value === '' ? null : Number(ageMin.value);
      let aMax = ageMax.value === '' ? null : Number(ageMax.value);
      if (aMin != null && aMax != null && aMin > aMax) [aMin, aMax] = [aMax, aMin];
      const data = {
        title: t, date: date.value, time: time.value || '', place: place.value.trim(), url: cu,
        indoor: indoor.dataset.value || '', fee: fee.dataset.value || '',
        needSignup: signup.checked, signupBy: signup.checked ? signupBy.value : '',
        ageMin: aMin, ageMax: aMax, notes: notes.value.trim(), updatedAt: new Date().toISOString(),
      };
      save((o) => {
        if (isEdit) { const x = o.plans.find((y) => y.id === plan.id); if (x) Object.assign(x, data); }
        else o.plans.push({ id: C.uid(), createdAt: data.updatedAt, ...data });
      });
      sh.close();
      ui.toast(isEdit ? '已更新計畫' : '已加入週末計畫');
    };
    const sh = ui.sheet({
      title: isEdit ? '編輯計畫' : '新增週末計畫',
      body,
      footer: h('div', { class: 'row gap' },
        isEdit ? h('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': '刪除', onclick: () => { sh.close(); setTimeout(() => removePlan(plan), 240); } }, ui.icon('trash')) : null,
        h('button', { type: 'button', class: 'btn btn-primary grow ot-save', onclick: doSave }, isEdit ? '儲存' : '加入計畫')),
    });
    if (!p.title) setTimeout(() => { try { title.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 260);
    return sh;
  }

  /* ================= 找活動與設施 ================= */
  const linkRow = (l) => h('a', { class: 'list-item ot-link', href: l.url, target: '_blank', rel: 'noopener noreferrer', dataset: { link: l.id } },
    h('span', { class: 'li-icon', 'aria-hidden': 'true' }, l.icon),
    h('span', { class: 'li-body' }, h('span', { class: 'li-title' }, l.title), h('span', { class: 'li-sub' }, l.desc)),
    h('span', { class: 'ot-ext', 'aria-hidden': 'true' }, '↗'),
    h('span', { class: 'ot-sr' }, '（外部網站，另開新分頁）'));
  const standalone = () => {
    try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) { return false; }
  };

  function renderFind(el) {
    const [first, ...rest] = D().LINKS;
    el.append(h('div', { class: 'card soft ot-ext-note' },
      h('p', { class: 'small' }, '🔗 這裡的連結都會「另開新分頁」前往外部網站。活動時間、地點、名額請以各網站與主辦單位公告為準；本 App 只提供連結，與這些網站沒有合作關係。')));
    el.append(h('div', { class: 'section-title' }, '🗓️ 找親子活動'));
    el.append(h('div', { class: 'list' }, linkRow(first)));
    el.append(h('div', { class: 'ot-howto small muted' },
      h('span', null, '看到想去的活動 → 複製連結 → 回到「週末計畫」貼上，就能存起來、分享給家人。'),
      h('button', { type: 'button', class: 'link-btn ot-go-plans', onclick: () => setSection('plans') }, '前往週末計畫 ›')));
    el.append(h('div', { class: 'section-title' }, '📍 找附近設施（Google 地圖）'));
    el.append(h('div', { class: 'list' }, rest.map(linkRow)));
    el.append(h('p', { class: 'tiny faint ot-maps-note' }, '在 Google 地圖用你的位置搜尋，允許定位才會顯示附近結果。'));
    if (!standalone()) {
      el.append(ui.card({ class: 'ot-a2hs' },
        h('div', { class: 'card-title' }, '📲 加到手機桌面'),
        h('p', { class: 'small muted' }, `把「${appName()}」加到主畫面，外出包和週末計畫沒網路也能看。`),
        h('ul', { class: 'small tight' },
          h('li', null, 'iPhone（Safari）：點「分享」→「加入主畫面」'),
          h('li', null, 'Android（Chrome）：點右上「⋮」→「加到主畫面」'))));
    }
  }

  /* ================= screen ================= */
  App.screen('outing', {
    title: '外出好幫手',
    tab: 'health',
    actions: (params) => (sectionOf(params) === 'plans'
      ? [h('button', { class: 'icon-btn', 'aria-label': '新增計畫', html: ui.ICONS.plus, onclick: () => planSheet() })] : null),
    render(el, params) {
      ensure();
      section = sectionOf(params);
      const root = h('div', { class: 'ot-screen', dataset: { section } });
      el.append(root);
      const tabs = ui.seg(TABS, section, setSection);
      tabs.classList.add('ot-tabs');
      tabs.setAttribute('aria-label', '外出好幫手分頁');
      root.append(tabs);
      if (section === 'bag') renderBag(root);
      else if (section === 'plans') renderPlans(root);
      else renderFind(root);
      if (refocus) {
        const t = root.querySelector(refocus);
        refocus = null;
        if (t) { try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      }
    },
  });

  /* ================= home card ================= */
  App.homeCard('outing', {
    stages: ['baby'],
    order: 45,
    render(el) {
      const now = new Date();
      if (!shouldShowHome(now)) return;
      const next = upcoming(now).find((p) => C.diffDays(now, p.date) <= 7);
      const dow = now.getDay();
      const kicker = next ? relDay(next, now) : dow === 5 ? '明天週末' : '週末';
      const su = next && signupInfo(next, now);
      if (next) el.dataset.personal = '1'; // her own plan: never folded away (首頁 in 坐月子)
      el.append(ui.card({ class: 'ot-home' },
        h('div', { class: 'card-title' }, '🎒 外出好幫手', h('span', { class: 'tag primary' }, kicker)),
        next
          ? h('div', { class: 'ot-home-plan' },
            h('div', { class: 'bold' }, next.title),
            h('div', { class: 'small muted' }, `${C.fmtDate(next.date)}${next.time ? ` ${next.time}` : ''}${next.place ? `・${next.place}` : ''}`),
            su && su.cls ? h('span', { class: `tag ${su.cls}` }, su.text) : null)
          : h('p', { class: 'small muted' }, '週末想帶寶寶出門嗎？存下想去的活動，出門前依寶寶的紀錄算好要帶幾片尿布、餵幾次奶。'),
        h('div', { class: 'row gap mt' },
          h('button', { type: 'button', class: 'btn btn-primary grow', onclick: () => App.navigate('outing', { tab: 'bag' }) }, '準備外出包'),
          h('button', { type: 'button', class: 'btn btn-ghost grow', onclick: () => App.navigate('outing', { tab: next ? 'plans' : 'find' }) }, next ? '看計畫' : '找活動'))));
    },
  });

  App.tool({
    id: 'outing', title: '外出好幫手', icon: '🎒', desc: '外出包估算・週末計畫', stages: ['baby'], screen: 'outing', order: 65, group: '工具',
  });

  App.outing = {
    ensure, analyze, packList, basisText, bagShareText, planShareText, bagSharePayload, planSharePayload, lineUrl,
    weekendRange, isThisWeekend, ageFits, ageLabel, filterPlans, upcoming, pastPlans, shouldShowHome,
    cleanUrl, extractShared, planSheet, FILTERS,
  };
}());
