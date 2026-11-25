/* 問答搜尋 — 離線常見問答（App.FAQ）＋ 全 App 內容搜尋（好孕島知識、孕產路線圖、工具）。
 *   screen 'search'           params: { q?: 預填關鍵字, faq?: 直接打開某則問答（分享連結用） }
 *   App.search.open(q?)       從任何地方打開搜尋（可帶關鍵字）
 *   App.search.openFaq(id)    打開問答 sheet
 *   App.search.query(q)       搜尋（回傳分組結果，測試用）
 * 搜尋方式：全形/半形、大小寫、標點、簡繁常用字統一；中文以「詞」＋「雙字詞」比對問題、標籤、答案，
 * 標籤完整命中與目前階段加權。關鍵字高亮一律用 DOM 節點組成（不把使用者輸入放進 innerHTML）。
 * 內容為一般衛教，不能取代醫師診斷。 */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;

  const DISCLAIMER = '內容為一般衛教資訊，不能取代醫師診斷；寶寶或你身體不舒服時，請直接就醫。';
  const STAGE_LABEL = { prep: '備孕', preg: '懷孕', baby: '育兒', all: '通用' };
  const ALL_STAGES = ['prep', 'preg', 'baby'];
  const HISTORY_MAX = 8;

  /* =========================================================
   * Normalisation: NFKC (全形→半形) + lower case + 簡→繁常用字 + 異體字統一，去掉空白與標點
   * ========================================================= */
  const S2T_PAIRS = '发發烧燒胀脹气氣宝寶婴嬰儿兒吗嗎么麼办辦医醫药藥疗療带帶肠腸喂餵觉覺头頭湿濕黄黃热熱凉涼冻凍脏髒呕嘔闹鬧换換脐臍'
    + '温溫长長齿齒过過鸡雞鱼魚虾蝦饭飯汤湯动動宫宮缩縮产產阵陣恶惡忧憂郁鬱绪緒叶葉检檢怀懷验驗试試妈媽车車轮輪状狀费費钱錢种種'
    + '选選择擇质質时時间間这這个個们們会會还還没沒关關应應该該后後里裡为為样樣体體运運袜襪痒癢挤擠储儲鲜鮮喷噴雾霧机機痉痙挛攣'
    + '惊驚呛嗆门門诊診话話电電线線专專补補贴貼险險护護伤傷缝縫阴陰预預备備断斷养養营營计計数數减減肤膚红紅晕暈严嚴紧緊号號着著'
    + '两兩条條脑腦软軟颜顏绿綠饿餓饱飽见見酱醬疮瘡疱皰'
    // 台灣常見異體／同義寫法統一
    + '臺台裏裡揹背痠酸漲脹祕秘週周伽珈妳你';
  const FOLD_MAP = new Map();
  (function () {
    const a = Array.from(S2T_PAIRS);
    for (let i = 0; i + 1 < a.length; i += 2) FOLD_MAP.set(a[i], a[i + 1]);
  }());
  const DROP_RE = /[\s\p{P}\p{S}]/u;
  const charCache = new Map();
  function foldChar(ch) {
    let out = charCache.get(ch);
    if (out !== undefined) return out;
    out = '';
    for (const c of ch.normalize('NFKC').toLowerCase()) {
      if (DROP_RE.test(c)) continue;
      out += FOLD_MAP.get(c) || c;
    }
    charCache.set(ch, out);
    return out;
  }
  function fold(str) {
    let out = '';
    for (const ch of String(str ?? '')) out += foldChar(ch);
    return out;
  }
  // light fold keeps punctuation (used for urgent-keyword regexes like "38.5度")
  const lightFold = (str) => Array.from(String(str ?? '').normalize('NFKC').toLowerCase()).map((c) => FOLD_MAP.get(c) || c).join('');

  /* =========================================================
   * Query analysis
   * ========================================================= */
  const CJK_RE = /[㐀-鿿豈-﫿]/;
  const RUN_RE = /[㐀-鿿豈-﫿]+|[a-z0-9]+/g;
  // 口語問句裡的虛詞：拿掉後再切詞（標籤比對仍用完整句子）
  const FILLERS = ['怎麼辦', '怎麼樣', '怎麼', '怎樣', '如何', '為什麼', '為何', '什麼', '可不可以', '可以', '能不能', '會不會', '是不是',
    '要不要', '正常嗎', '有沒有', '還是', '請問', '想問', '一下', '應該', '哪一種', '哪種', '哪個', '哪裡', '嗎', '呢', '吧', '啊', '呀',
    '喔', '哦', '的', '了', '和', '跟', '與', '及', '或'].map(fold).sort((a, b) => b.length - a.length);
  const KIND_W = { char: 0.45, bi: 1, word: 1.2, phrase: 1.6 };

  function analyze(q) {
    const raw = fold(q);
    const terms = new Map();
    const add = (t, kind) => { if (t && !terms.has(t)) terms.set(t, kind); };
    String(q ?? '').split(/[\s\p{P}\p{S}]+/u).map(fold).filter(Boolean).forEach((seg) => {
      let s = seg;
      FILLERS.forEach((f) => { s = s.split(f).join(' '); });
      s.split(' ').filter(Boolean).forEach((part) => {
        (part.match(RUN_RE) || []).forEach((run) => {
          if (CJK_RE.test(run[0])) {
            if (run.length === 1) add(run, 'char');
            else if (run.length === 2) add(run, 'bi');
            else {
              for (let i = 0; i < run.length - 1; i += 1) add(run.slice(i, i + 2), 'bi');
              add(run, 'phrase');
            }
          } else add(run, run.length === 1 ? 'char' : 'word');
        });
      });
    });
    let list = [...terms.entries()].map(([t, kind]) => ({ t, kind }));
    if (list.length && list.every((x) => x.kind === 'char') && raw.length >= 2) {
      // e.g. "5-1-1" or "吐 奶": also try the whole thing as one phrase; digits alone are too noisy
      if (/^[a-z0-9]+$/.test(raw)) list = [];
      list.push({ t: raw, kind: 'phrase' });
    }
    if (!list.every((x) => x.kind === 'char')) list = list.filter((x) => x.kind !== 'char');
    if (!list.length && raw.length >= 1) list = [{ t: raw, kind: raw.length === 1 ? 'char' : 'phrase' }];
    return { raw, terms: list, onlyChars: list.every((x) => x.kind === 'char') };
  }

  /* =========================================================
   * Index: FAQ ＋ 好孕島知識卡 ＋ 孕產路線圖 ＋ 工具
   * ========================================================= */
  const ISLAND_STAGE = { prep: ['prep'], preg: ['preg'], birth: ['preg'], postpartum: ['baby'], baby: ['baby'], welfare: ALL_STAGES };
  const PHASE_STAGE = { early: ['preg'], mid: ['preg'], late: ['preg'], term: ['preg'], birth: ['preg', 'baby'], pp: ['baby'] };
  const TOOL_TAGS = {
    growth: ['身高', '體重', '頭圍', '百分位', '長多大'],
    milestones: ['翻身', '爬', '走路', '發展'],
    prevention: ['疫苗', '打針', '預防針', '健檢', '兒童健檢', '預防接種'],
    stats: ['報告', '統計', '給醫師看'],
    milk: ['母乳', '母乳保存', '冷凍', '冷藏', '母乳袋', '庫存'],
    kick: ['胎動', '數胎動'],
    contraction: ['宮縮', '陣痛', '產兆', '5-1-1'],
    pregweight: ['孕期體重', '增重'],
    prenatal: ['產檢', '超音波', '公費產檢'],
    hospitalbag: ['待產包', '住院'],
    confinement: ['月子中心', '月中', '坐月子中心', '入住'],
    cycle: ['月經', '排卵', '經期', '排卵期'],
    prepcheck: ['孕前檢查', '備孕'],
    pregnancy: ['孕週', '寶寶多大'],
    journey: ['路線圖', '注意事項', '警訊'],
    postpartum: ['惡露', '坐月子', '傷口', '產後', '新生兒觀察'],
  };
  const EXTRA_DEST = [
    { id: 'log', title: '寶寶紀錄', icon: '📝', desc: '餵奶、尿布、睡眠、體溫一鍵記錄', screen: 'log', stages: ['baby'], tags: ['餵奶', '尿布', '睡眠', '體溫', '紀錄', '便便', '洗澡'] },
    { id: 'island', title: '好孕島', icon: '🏝️', desc: '一站一站學孕產知識、蓋章', screen: 'island', stages: ALL_STAGES, tags: ['知識', '小測驗', '蓋章'] },
    // 雙向邀請禮: 「用我的邀請碼」 → where to type it, and where to invite
    { id: 'invite', title: '邀請好友', icon: '💌', desc: '邀請碼、雙向邀請禮、好孕點數、分享卡', screen: 'invite', stages: ALL_STAGES, tags: ['邀請', '邀請碼', '邀請禮', '見面禮', '好孕點數', '點數', '推薦'] },
  ];

  let INDEX = null;
  function mkDoc(type, { title, tags = [], body = '', stages, ...rest }) {
    const tg = tags.map(fold).filter(Boolean);
    const t = fold(title); const g = tg.join('|'); const b = fold(body);
    return { type, title, body, stages, tagsF: tg, t, g, b, all: `${t}|${g}|${b}`, ...rest };
  }
  function buildIndex() {
    const docs = [];
    (App.FAQ || []).forEach((f) => docs.push(mkDoc('faq', {
      title: f.q, tags: f.tags || [], body: f.a, stages: f.stage === 'all' ? ALL_STAGES : [f.stage], faq: f, age: f.ageMonths,
    })));
    const I = App.ISLAND;
    if (I && I.SPOTS) {
      I.SPOTS.forEach((spot) => {
        const stages = ISLAND_STAGE[spot.stage] || ALL_STAGES;
        docs.push(mkDoc('island', { title: spot.name, tags: [spot.name], body: `${spot.intro} ${(spot.checks || []).join('、')}`, stages, spot, card: null }));
        (spot.cards || []).forEach((cd) => docs.push(mkDoc('island', { title: cd.t, tags: [spot.name], body: cd.d, stages, spot, card: cd })));
      });
    }
    const J = App.JOURNEY;
    if (J && J.PHASES) {
      J.PHASES.forEach((p) => {
        const stages = PHASE_STAGE[p.id] || ALL_STAGES;
        const base = { stages, phase: p, screen: 'journey' };
        (p.todo || []).forEach((x) => docs.push(mkDoc('journey', { title: x.text, tags: [p.title, '該做的事'], ...base, kind: 'todo' })));
        (p.watch || []).forEach((x) => docs.push(mkDoc('journey', { title: x, tags: [p.title, '注意事項', '警訊', '就醫'], ...base, kind: 'watch' })));
        (p.tips || []).forEach((x) => docs.push(mkDoc('journey', { title: x, tags: [p.title, '小提醒'], ...base, kind: 'tip' })));
      });
      (J.NEWBORN || []).forEach((x) => docs.push(mkDoc('journey', {
        title: x.text, tags: ['新生兒', '新生兒觀察'], stages: ['baby'], phase: { title: '新生兒觀察', icon: '👶' }, screen: App.screens.postpartum ? 'postpartum' : 'journey', kind: 'newborn',
      })));
    }
    // one entry per destination screen; tools that share a screen (e.g. 孕產路線圖 for 孕期／育兒) merge their stages
    const byScreen = new Map();
    (App.tools || []).filter((t) => t.id !== 'search').slice().sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
      .concat(EXTRA_DEST)
      .forEach((t) => {
        const screen = t.screen || t.id;
        if (!App.screens[screen]) return;
        const cur = byScreen.get(screen);
        if (cur) { (t.stages || ALL_STAGES).forEach((st) => { if (!cur.stages.includes(st)) cur.stages.push(st); }); return; }
        byScreen.set(screen, { t, stages: (t.stages || ALL_STAGES).slice() });
      });
    byScreen.forEach(({ t, stages }, screen) => docs.push(mkDoc('tool', {
      title: t.title, tags: [t.group || '', ...(TOOL_TAGS[screen] || TOOL_TAGS[t.id] || []), ...(t.tags || [])], body: t.desc || '', stages, tool: t,
    })));
    // 常見好物：每一項都能搜（汽座、奶瓶、學步車…）
    const GD = App.GOODS;
    if (GD && App.screens.goods) {
      GD.ITEMS.forEach((it) => {
        const cat = GD.CATS.find((c) => c.id === it.cat) || { name: '', stages: ALL_STAGES };
        docs.push(mkDoc('goods', {
          title: it.name, tags: ['好物', cat.name, ...(it.tags || [])], body: [...(it.tips || []), it.why || '', it.safety || ''].join(' '),
          stages: cat.stages, item: it, catName: cat.name,
        }));
      });
    }
    return docs;
  }
  const index = () => { if (!INDEX) INDEX = buildIndex(); return INDEX; };

  /* =========================================================
   * Search + scoring
   * ========================================================= */
  function babyMonths() {
    const b = store.baby();
    if (!b || !b.birthday || !store.inStage(['baby'])) return null;
    try { return C.babyAge(b.birthday).months; } catch (e) { return null; }
  }

  function query(q) {
    const A = analyze(q);
    const empty = { q, terms: [], groups: { faq: [], island: [], journey: [], tool: [], goods: [] }, total: 0 };
    if (!A.terms.length) return empty;
    const docs = index();
    const N = docs.length;
    const terms = A.terms.map((x) => {
      let df = 0;
      docs.forEach((d) => { if (d.all.includes(x.t)) df += 1; });
      return { ...x, df, w: Math.log(1 + N / (df + 0.5)) * KIND_W[x.kind] };
    });
    const cover = terms.filter((x) => x.kind !== 'phrase');
    const totalW = cover.reduce((a, x) => a + x.w, 0) || 1;
    const stages = store.stages();
    const ageM = babyMonths();
    const hits = [];
    docs.forEach((d) => {
      let ts = 0; let mw = 0; let strong = false;
      terms.forEach((x) => {
        const f = d.t.includes(x.t) ? 3 : d.g.includes(x.t) ? 2.5 : d.b.includes(x.t) ? 1 : 0;
        if (!f) return;
        ts += f * x.w;
        if (x.kind !== 'phrase') mw += x.w;
        if (x.kind !== 'char') strong = true;
      });
      let tagB = 0; const hitTags = [];
      if (A.raw.length >= 2) {
        d.tagsF.forEach((tg) => {
          if (tg.length >= 2 && A.raw.includes(tg)) { tagB += 2 + tg.length * 1.2 + (tg === A.raw ? 6 : 0); hitTags.push(tg); }
        });
      }
      tagB = Math.min(tagB, 24);
      let phB = 0;
      if (A.raw.length >= 2) phB = d.t.includes(A.raw) ? 8 : d.g.includes(A.raw) ? 5 : d.b.includes(A.raw) ? 3 : 0;
      if (!ts && !tagB && !phB) return;
      if (!strong && !tagB && !phB && !A.onlyChars) return;
      let score = ts * (0.3 + mw / totalW) + tagB + phB;
      const inSt = d.stages.some((s) => stages.includes(s));
      score *= d.stages.length >= 3 ? 1.1 : inSt ? 1.3 : 0.8;
      if (d.age && ageM !== null) score *= ageM >= d.age[0] && ageM <= d.age[1] ? 1.12 : 0.9;
      hits.push({ d, score, hitTags });
    });
    if (!hits.length) return empty;
    hits.sort((a, b) => b.score - a.score);
    const top = hits[0].score;
    const floor = Math.max(1.2, top * 0.2);
    const groups = { faq: [], island: [], journey: [], tool: [], goods: [] };
    const perSpot = {};
    const seenText = new Set();
    hits.forEach((x) => {
      if (x.score < floor) return;
      const g = groups[x.d.type];
      if (g.length && x.score < g[0].score * 0.3) return;
      if (x.d.type === 'island') {
        const k = x.d.spot.id;
        perSpot[k] = (perSpot[k] || 0) + 1;
        if (perSpot[k] > 2) return;
      }
      if (x.d.type === 'journey') { if (seenText.has(x.d.t)) return; seenText.add(x.d.t); }
      g.push(x);
    });
    const hl = new Set(terms.filter((x) => A.onlyChars || x.kind !== 'char').map((x) => x.t));
    hits.forEach((x) => x.hitTags.forEach((t) => hl.add(t)));
    const total = Object.values(groups).reduce((a, g) => a + g.length, 0);
    return { q, terms: [...hl], groups, total };
  }

  /* =========================================================
   * Safe highlighting (DOM nodes only)
   * ========================================================= */
  function hl(text, terms) {
    const src = String(text ?? '');
    if (!src || !terms || !terms.length) return src;
    let folded = '';
    const map = [];
    let i = 0;
    for (const ch of src) {
      const f = foldChar(ch);
      for (let k = 0; k < f.length; k += 1) map.push([i, i + ch.length]);
      folded += f;
      i += ch.length;
    }
    const ranges = [];
    terms.forEach((t) => {
      if (!t) return;
      let p = folded.indexOf(t);
      while (p !== -1) {
        ranges.push([map[p][0], map[p + t.length - 1][1]]);
        p = folded.indexOf(t, p + t.length);
      }
    });
    if (!ranges.length) return src;
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    ranges.forEach((r) => {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r.slice());
    });
    const frag = document.createDocumentFragment();
    let pos = 0;
    merged.forEach(([s, e]) => {
      if (s > pos) frag.append(document.createTextNode(src.slice(pos, s)));
      frag.append(h('mark', { class: 'sr-hl' }, src.slice(s, e)));
      pos = e;
    });
    if (pos < src.length) frag.append(document.createTextNode(src.slice(pos)));
    return frag;
  }
  const sentences = (t) => (String(t).match(/[^。！？!?]+[。！？!?]?/g) || [String(t)]).map((s) => s.trim()).filter(Boolean);
  function bestSentence(text, terms) {
    const ss = sentences(text);
    let best = ss[0] || ''; let bs = 0;
    ss.forEach((s) => {
      const f = fold(s);
      const sc = (terms || []).reduce((a, t) => a + (f.includes(t) ? t.length : 0), 0);
      if (sc > bs) { bs = sc; best = s; }
    });
    return best;
  }

  /* =========================================================
   * Urgent-sounding queries
   * ========================================================= */
  const URGENT_RULES = [
    { re: /發燒|高燒|燒到|燒不退|3[89](\.\d)?\s*(度|°)|4[0-2](\.\d)?\s*(度|°)/, text: '未滿 3 個月寶寶體溫 38°C 以上，請立即就醫；任何年齡發燒合併叫不醒、抽搐、呼吸困難，請撥 119。' },
    { re: /抽搐|痙攣|翻白眼|全身僵硬/, text: '抽搐時讓孩子側躺、不要塞東西進嘴巴；第一次發作、超過 5 分鐘或抽完叫不醒，請撥 119。' },
    { re: /呼吸|喘|發紫|窒息|噎到|嗆到/, text: '呼吸困難、胸口凹陷、嘴唇發紫，或噎到無法哭也無法咳，請立即撥 119。' },
    { re: /出血|流血|血塊|大量.{0,2}血/, text: '懷孕或產後大量出血（像月經或更多、有血塊），或合併頭暈、劇烈腹痛，請立即就醫或撥 119。' },
    { re: /破水|羊水/, text: '疑似破水，不論有沒有宮縮都要直接去醫院；羊水是綠色或感覺有東西掉出來，請撥 119。' },
    { re: /昏迷|叫不醒|昏倒|意識不清|沒反應/, text: '叫不醒、意識不清或沒有反應，請立即撥 119。' },
    { re: /胎動.{0,3}(少|減|沒|不動|停)|寶寶不動/, text: '胎動明顯減少或感覺不到，請立即到產檢醫院檢查，不要等到隔天。' },
  ];
  const CRISIS_RE = /自殺|想死|不想活|活不下去|輕生|傷害自己|傷害寶寶|結束生命/;
  function urgency(q) {
    const s = lightFold(q);
    return { rules: URGENT_RULES.filter((r) => r.re.test(s)), crisis: CRISIS_RE.test(s) };
  }
  const tel = (num, label, cls = 'btn btn-ghost') => h('a', { class: `${cls} sr-call`, href: `tel:${num.replace(/-/g, '')}` }, label);
  function urgentCard(rules) {
    return ui.card({ class: 'sr-urgent', role: 'note', 'aria-label': '緊急狀況提醒' },
      h('div', { class: 'sr-urgent-title' }, '⚠️ 緊急狀況請直接就醫'),
      h('ul', { class: 'sr-urgent-list' }, rules.map((r) => h('li', null, r.text))),
      h('div', { class: 'sr-urgent-actions' },
        tel('119', '📞 撥打 119', 'btn btn-danger'),
        tel('0800-870-870', '孕產婦關懷專線')),
      h('p', { class: 'small sr-urgent-foot' }, '不確定要不要就醫？可以先打電話問產檢醫院、小兒科診所，或撥 0800-870-870（免付費）。'));
  }
  function crisisCard() {
    return ui.card({ class: 'sr-crisis', role: 'note', 'aria-label': '心理支持專線' },
      h('div', { class: 'sr-urgent-title' }, '你不是一個人'),
      h('p', null, '現在很辛苦的話，請馬上找人說說話，也請身邊的人陪著你。有立即危險請撥 119。'),
      h('div', { class: 'sr-urgent-actions' },
        tel('1925', '📞 安心專線 1925（24 小時）', 'btn btn-primary'),
        tel('0800-870-870', '孕產婦關懷專線 0800-870-870'),
        tel('119', '緊急救護 119')));
  }

  /* =========================================================
   * State: history + feedback (created lazily on the store)
   * ========================================================= */
  const history = () => (Array.isArray(store.state.searchHistory) ? store.state.searchHistory : []);
  function remember(q) {
    const v = String(q ?? '').trim().slice(0, 40);
    if (!v) return;
    if (history()[0] === v) return;
    store.update((s) => {
      const list = (Array.isArray(s.searchHistory) ? s.searchHistory : []).filter((x) => x !== v);
      list.unshift(v);
      s.searchHistory = list.slice(0, HISTORY_MAX);
    });
  }
  function clearHistory() {
    store.update((s) => { s.searchHistory = []; });
    renderResults();
    ui.toast('已清除搜尋紀錄');
  }
  const feedbackOf = (id) => ((store.state.faqFeedback || {})[id]) || null;
  function vote(id, v) {
    store.update((s) => {
      s.faqFeedback = s.faqFeedback && typeof s.faqFeedback === 'object' ? s.faqFeedback : {};
      const r = s.faqFeedback[id] = s.faqFeedback[id] || { up: 0, down: 0 };
      if (r.last === v) return;
      if (r.last) r[r.last] = Math.max(0, (r[r.last] || 0) - 1);
      r[v] = (r[v] || 0) + 1;
      r.last = v;
      r.at = new Date().toISOString();
    });
  }

  /* =========================================================
   * FAQ answer sheet
   * ========================================================= */
  const FAQ_BY_ID = () => { const m = {}; (App.FAQ || []).forEach((f) => { m[f.id] = f; }); return m; };
  const stageTag = (st) => h('span', { class: 'tag primary' }, STAGE_LABEL[st] || st);
  const levelTag = (lv) => (lv ? h('span', { class: `tag ${lv === 'urgent' ? 'danger' : 'warn'}` }, lv === 'urgent' ? '⚠️ 需就醫' : '留意') : null);
  const shareLine = (s) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);
  const KICKER = { baby: '育兒問答', preg: '孕期問答', prep: '備孕問答', all: '育兒問答' };

  function levelBanner(lv) {
    if (lv === 'urgent') {
      return h('div', { class: 'sr-banner sr-banner-urgent', role: 'note' },
        h('div', { class: 'grow' },
          h('strong', null, '⚠️ 這題提到需要立即就醫的警訊'),
          h('p', null, '符合下面描述的狀況時，請直接就醫；情況緊急請撥 119。')),
        tel('119', '撥 119', 'btn btn-danger btn-sm'));
    }
    return h('div', { class: 'sr-banner sr-banner-soon', role: 'note' },
      h('div', { class: 'grow' },
        h('strong', null, '⚠️ 留意就醫警訊'),
        h('p', null, '出現文中提到的警訊時，請盡快就醫，或先打電話詢問醫師。')));
  }

  function feedbackBlock(f) {
    const box = h('div', { class: 'sr-fb' });
    const draw = () => {
      box.innerHTML = '';
      const cur = (feedbackOf(f.id) || {}).last;
      const b = (v, emoji, label) => h('button', {
        type: 'button', class: `btn btn-ghost sr-fb-btn${cur === v ? ' active' : ''}`, 'aria-pressed': String(cur === v),
        onclick: () => { vote(f.id, v); draw(); },
      }, h('span', { 'aria-hidden': 'true' }, emoji), label);
      box.append(
        h('div', { class: 'sr-fb-q', id: `sr-fb-${f.id}` }, '這有幫助嗎？'),
        h('div', { class: 'sr-fb-row', role: 'group', 'aria-labelledby': `sr-fb-${f.id}` }, b('up', '👍', '有幫助'), b('down', '👎', '沒幫助')));
      // native append() prints null as the text "null", so only append the thank-you line when there is one
      if (cur) box.append(h('p', { class: 'small muted sr-fb-thanks', role: 'status' }, cur === 'up' ? '謝謝回饋' : '謝謝回饋！可以換個說法再搜尋，或直接詢問醫師。'));
    };
    draw();
    return box;
  }

  function relatedOf(f) {
    const mine = new Set((f.tags || []).map(fold));
    const stages = store.stages();
    return (App.FAQ || []).filter((x) => x.id !== f.id)
      .map((x) => {
        const shared = (x.tags || []).map(fold).filter((t) => mine.has(t)).length;
        const st = x.stage === f.stage || x.stage === 'all' || stages.includes(x.stage) ? 0.5 : 0;
        return { x, s: shared ? shared + st : 0 };
      })
      .filter((r) => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map((r) => r.x);
  }

  let faqSheet = null;
  function openFaq(id, { terms = [] } = {}) {
    const f = FAQ_BY_ID()[id];
    if (!f) { ui.toast('找不到這則問答'); return null; }
    if (faqSheet) { faqSheet.close(); faqSheet = null; }
    const go = (fn) => () => { if (sh) sh.close(); setTimeout(fn, 230); };
    const body = h('div', { class: 'sr-faq' });
    const age = f.ageMonths ? h('span', { class: 'tag' }, `${f.ageMonths[0]}–${f.ageMonths[1]} 個月`) : null;
    body.append(h('div', { class: 'row gap-sm wrap sr-faq-tags' }, stageTag(f.stage), age, levelTag(f.level)));
    if (f.level) body.append(levelBanner(f.level));
    const cite = App.src ? App.src.collector() : null;
    const ss = sentences(f.a);
    body.append(h('ul', { class: 'sr-ans' }, ss.map((s, i) => h('li', null, hl(s, terms), i === ss.length - 1 && cite ? cite.mark(`faq:${f.id}`) : null))));
    if (cite) { const foot = cite.footer(); if (foot) body.append(foot); }

    const links = (f.see || []).filter((x) => (x.faq ? FAQ_BY_ID()[x.faq] : x.screen && App.screens[x.screen]));
    if (links.length) {
      body.append(h('h3', { class: 'sr-h' }, '延伸閱讀・相關功能'));
      body.append(h('div', { class: 'list sr-see' }, links.map((x) => h('button', {
        type: 'button', class: 'list-item sr-item',
        onclick: x.faq ? go(() => openFaq(x.faq)) : go(() => App.navigate(x.screen, x.params)),
      },
      h('span', { class: 'li-icon', 'aria-hidden': 'true' }, x.faq ? '💬' : x.screen === 'island' ? '🏝️' : '➡️'),
      h('span', { class: 'li-body' }, h('span', { class: 'li-title sr-title' }, x.label)),
      h('span', { class: 'ic faint', html: ui.ICONS.chevron, 'aria-hidden': 'true' })))));
    }
    const rel = relatedOf(f).filter((x) => !links.some((l) => l.faq === x.id));
    if (rel.length) {
      body.append(h('h3', { class: 'sr-h' }, '相關問題'));
      body.append(h('div', { class: 'list sr-see' }, rel.map((x) => h('button', { type: 'button', class: 'list-item sr-item', onclick: go(() => openFaq(x.id)) },
        h('span', { class: 'li-icon', 'aria-hidden': 'true' }, '💬'),
        h('span', { class: 'li-body' }, h('span', { class: 'li-title sr-title' }, x.q)),
        levelTag(x.level),
        h('span', { class: 'ic faint', html: ui.ICONS.chevron, 'aria-hidden': 'true' })))));
    }
    body.append(feedbackBlock(f));
    if (App.share && typeof App.share.button === 'function') {
      const ss = sentences(f.a);
      body.append(h('div', { class: 'sr-share' }, App.share.button(() => ({
        sheetTitle: '分享這則問答',
        title: f.q,
        text: `${f.q}\n${ss.slice(0, 2).join('')}`,
        path: 'search',
        params: { faq: f.id },
        campaign: `faq-${f.id}`,
        emoji: f.level === 'urgent' ? '⚠️' : '💬',
        kicker: KICKER[f.stage] || '育兒問答',
        lines: ss.slice(0, 4).map(shareLine),
      }), { label: '分享這則問答', cls: 'btn btn-sm btn-ghost btn-block' })));
    }
    body.append(h('p', { class: 'disclaimer' }, DISCLAIMER));
    const sh = ui.sheet({ title: f.q, body, onClose: () => { if (faqSheet === sh) faqSheet = null; } });
    sh.el.classList.add('sr-sheet');
    sh.el.dataset.faq = f.id;
    faqSheet = sh;
    return sh;
  }

  /* =========================================================
   * Screen
   * ========================================================= */
  const ST = { q: '', expanded: {}, browseAll: false, pkey: null };
  let els = null;
  let timer = null;
  // 使用統計: a search is counted once she stops typing (1.5 s), or taps a suggestion; the words never leave the phone
  let countT = null; let counted = '';
  const countSearch = (q) => { q = String(q || '').trim(); if (q && q !== counted && App.count) { counted = q; App.count('search'); } };

  function suggestions() {
    const S = App.FAQ_SUGGEST || {};
    const out = [];
    store.stages().forEach((st) => (S[st] || []).forEach((x) => { if (!out.includes(x)) out.push(x); }));
    return out.slice(0, 12);
  }
  const chip = (label, onclick, extra = {}) => h('button', { type: 'button', class: 'chip sr-chip', onclick, ...extra }, label);

  function setQuery(q, { save = false, focus = false } = {}) {
    ST.q = String(q ?? '');
    ST.expanded = {};
    countSearch(ST.q);
    if (els) {
      els.input.value = ST.q;
      els.clear.hidden = !ST.q;
      renderResults();
      if (window.scrollY > 0) window.scrollTo(0, 0);
      if (focus) els.input.focus({ preventScroll: true });
    }
    if (save) remember(ST.q);
  }

  // tag (e.g. 需就醫) sits under the title so long questions keep the full width on small phones
  function resultItem({ icon, title, sub, meta, tag, onclick, terms, data }) {
    return h('button', { type: 'button', class: 'list-item sr-item', onclick, dataset: data || null },
      h('span', { class: 'li-icon', 'aria-hidden': 'true' }, icon),
      h('span', { class: 'li-body' },
        h('span', { class: 'li-title sr-title' }, hl(title, terms)),
        sub ? h('span', { class: 'li-sub sr-snip' }, hl(sub, terms)) : null,
        tag || meta ? h('span', { class: 'sr-meta' }, tag || null, meta ? h('span', null, meta) : null) : null),
      h('span', { class: 'ic faint sr-chev', html: ui.ICONS.chevron, 'aria-hidden': 'true' }));
  }

  function group(key, title, items, limit, renderItem) {
    if (!items.length) return null;
    const all = !!ST.expanded[key];
    const shown = all ? items : items.slice(0, limit);
    return h('section', { class: 'sr-group', dataset: { group: key }, 'aria-label': title },
      h('h2', { class: 'section-title sr-group-title' }, h('span', null, title), h('span', { class: 'sr-count' }, `${items.length} 筆`)),
      h('div', { class: 'list' }, shown.map(renderItem)),
      items.length > shown.length ? h('button', {
        type: 'button', class: 'btn btn-ghost btn-block sr-more', onclick: () => { ST.expanded[key] = true; renderResults(); },
      }, `看更多（還有 ${items.length - shown.length} 筆）`) : null);
  }

  const openAndRemember = (fn) => () => { remember(ST.q); fn(); };

  function renderHome(box) {
    const hist = history();
    if (hist.length) {
      box.append(h('section', { class: 'sr-block sr-history', 'aria-label': '最近搜尋' },
        h('div', { class: 'section-title' }, h('span', null, '最近搜尋'),
          h('button', { type: 'button', class: 'sr-clear-hist', onclick: clearHistory }, '清除')),
        h('div', { class: 'chips' }, hist.map((x) => chip(x, () => setQuery(x, { save: true }), { 'aria-label': `再次搜尋：${x}` })))));
    }
    box.append(h('section', { class: 'sr-block sr-suggest', 'aria-label': '大家常問' },
      h('div', { class: 'section-title' }, h('span', null, '大家常問')),
      h('div', { class: 'chips' }, suggestions().map((x) => chip(x, () => setQuery(x, { save: true }))))));

    const stages = store.stages();
    const list = (App.FAQ || []).filter((f) => f.stage === 'all' || stages.includes(f.stage));
    const shown = ST.browseAll ? list : list.slice(0, 6);
    box.append(h('section', { class: 'sr-group', 'aria-label': '這個階段的常見問答' },
      h('h2', { class: 'section-title sr-group-title' }, h('span', null, `${stages.map((s) => STAGE_LABEL[s]).join('・')}常見問答`), h('span', { class: 'sr-count' }, `${list.length} 題`)),
      h('div', { class: 'list' }, shown.map((f) => resultItem({
        icon: f.level === 'urgent' ? '⚠️' : '💬', title: f.q, tag: levelTag(f.level), onclick: () => openFaq(f.id), data: { faq: f.id },
      }))),
      list.length > shown.length ? h('button', { type: 'button', class: 'btn btn-ghost btn-block sr-more', onclick: () => { ST.browseAll = true; renderResults(); } }, `看全部 ${list.length} 題`) : null));
  }

  function renderSearch(box, q) {
    const R = query(q);
    const U = urgency(q);
    if (U.crisis) box.append(crisisCard());
    if (U.rules.length) box.append(urgentCard(U.rules));
    const { groups, terms } = R;
    const parts = [
      group('faq', '常見問答', groups.faq, 6, (x) => resultItem({
        icon: x.d.faq.level === 'urgent' ? '⚠️' : '💬', title: x.d.faq.q, sub: bestSentence(x.d.faq.a, terms), terms,
        tag: levelTag(x.d.faq.level), data: { faq: x.d.faq.id },
        onclick: openAndRemember(() => openFaq(x.d.faq.id, { terms })),
      })),
      group('island', '好孕島知識', groups.island, 4, (x) => resultItem({
        icon: x.d.spot.emoji, title: x.d.card ? x.d.card.t : x.d.spot.name, sub: x.d.card ? bestSentence(x.d.card.d, terms) : x.d.spot.intro, terms,
        meta: `🏝️ ${x.d.spot.name}`, data: { spot: x.d.spot.id },
        onclick: openAndRemember(() => {
          if (App.island && App.island.openSpot) App.island.openSpot(x.d.spot.id);
          else App.navigate('island', { spot: x.d.spot.id });
        }),
      })),
      group('journey', '孕產路線圖', groups.journey, 4, (x) => resultItem({
        icon: x.d.kind === 'watch' ? '⚠️' : x.d.phase.icon || '🗺️', title: x.d.title, terms,
        meta: `${x.d.phase.title}・${{ todo: '該做的事', watch: '注意事項', tip: '小提醒', newborn: '每天觀察' }[x.d.kind]}`,
        onclick: openAndRemember(() => App.navigate(x.d.screen)),
      })),
      group('goods', '常見好物', groups.goods, 3, (x) => resultItem({
        icon: x.d.item.emoji, title: x.d.item.name, sub: x.d.item.need === 'skip' ? x.d.item.why : bestSentence((x.d.item.tips || []).join(' '), terms), terms,
        meta: `🛍️ ${x.d.catName}・${(App.GOODS.NEED[x.d.item.need] || {}).label || ''}`, data: { goods: x.d.item.id },
        onclick: openAndRemember(() => App.navigate('goods', { item: x.d.item.id })),
      })),
      group('tool', '工具', groups.tool, 4, (x) => resultItem({
        icon: x.d.tool.icon || '✨', title: x.d.tool.title, sub: x.d.tool.desc, terms, data: { tool: x.d.tool.screen || x.d.tool.id },
        onclick: openAndRemember(() => App.navigate(x.d.tool.screen || x.d.tool.id, x.d.tool.params)),
      })),
    ].filter(Boolean);
    if (parts.length) { box.append(...parts); return R.total; }

    box.append(h('div', { class: 'sr-empty' },
      ui.pic('search', 112, 'empty-pic'),
      h('p', { class: 'bold' }, `找不到「${q.trim()}」的答案`),
      h('p', { class: 'small muted' }, '試試換個說法，或用更短的關鍵字，例如：'),
      h('div', { class: 'chips sr-empty-chips' }, suggestions().slice(0, 6).map((x) => chip(x, () => setQuery(x, { save: true })))),
      h('p', { class: 'small sr-empty-help' }, '寶寶或你身體不舒服時，請直接詢問醫師；孕產、哺乳、育兒問題也可以撥 ',
        h('a', { href: 'tel:0800870870' }, '孕產婦關懷專線 0800-870-870'), '（免付費）。')));
    return 0;
  }

  function renderResults() {
    if (!els) return;
    const box = els.results;
    box.innerHTML = '';
    const q = ST.q.trim();
    if (!q) { renderHome(box); els.status.textContent = ''; }
    else {
      const n = renderSearch(box, q);
      els.status.textContent = n ? `找到 ${n} 筆結果` : '沒有找到結果';
    }
    box.append(h('p', { class: 'disclaimer' }, DISCLAIMER));
  }

  function render(el, params) {
    const p = params || {};
    const pkey = p.q || p.faq ? JSON.stringify([p.q || '', p.faq || '']) : '';
    let deepFaq = null;
    if (pkey && pkey !== ST.pkey) {
      ST.pkey = pkey;
      if (typeof p.q === 'string') { ST.q = p.q.slice(0, 60); ST.expanded = {}; }
      if (p.faq) deepFaq = String(p.faq);
    }
    const input = h('input', {
      id: 'sr-input', class: 'sr-input', type: 'search', inputmode: 'search', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off',
      spellcheck: 'false', maxlength: '60', placeholder: '例如：脹氣、發燒、背巾、孕吐…', value: ST.q, 'aria-describedby': 'sr-status',
    });
    const clear = h('button', { type: 'button', class: 'sr-clear', 'aria-label': '清除搜尋文字', html: ui.ICONS.close });
    clear.hidden = !ST.q;
    const form = h('form', { class: 'sr-box', role: 'search', action: '#', onsubmit: (e) => { e.preventDefault(); clearTimeout(timer); renderResults(); remember(ST.q); input.blur(); } },
      h('label', { class: 'sr-label', for: 'sr-input' }, '搜尋育兒、孕產問題'),
      h('div', { class: 'sr-field' },
        h('span', { class: 'sr-ic', 'aria-hidden': 'true', html: ui.ICONS.search || '' }),
        input, clear));
    const status = h('p', { class: 'sr-status', id: 'sr-status', role: 'status' });
    const results = h('div', { class: 'sr-results', 'aria-live': 'off' });
    el.append(form, status, results);
    els = { input, clear, results, status };

    input.addEventListener('input', () => {
      ST.q = input.value;
      ST.expanded = {};
      clear.hidden = !input.value;
      clearTimeout(timer);
      timer = setTimeout(() => { renderResults(); if (window.scrollY > 0) window.scrollTo(0, 0); }, 120);
      clearTimeout(countT);
      countT = setTimeout(() => countSearch(input.value), 1500);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value && !document.body.classList.contains('has-sheet')) { e.preventDefault(); setQuery('', { focus: true }); }
    });
    clear.addEventListener('click', () => setQuery('', { focus: true }));

    renderResults();
    if (deepFaq) setTimeout(() => openFaq(deepFaq), 120);
    else if (!ST.q) requestAnimationFrame(() => { if (els && els.input === input) input.focus({ preventScroll: true }); });
  }

  App.screen('search', {
    title: '問答搜尋',
    liveUpdate: false,
    render,
    onLeave() { clearTimeout(timer); els = null; },
  });

  App.tool({
    id: 'search', title: '問答搜尋', icon: '🔎', desc: '寶寶脹氣、發燒、孕吐…快速找答案', stages: ['prep', 'preg', 'baby'], screen: 'search', order: 1, group: '問答',
  });

  App.search = {
    open(q) {
      const v = typeof q === 'string' ? q : '';
      if (els && document.body.dataset.screen === 'search') { setQuery(v, { save: !!v, focus: !v }); return; }
      ST.q = v; ST.expanded = {}; ST.pkey = null;
      App.navigate('search', v ? { q: v } : undefined);
    },
    openFaq,
    query,
    fold,
    analyze,
    rebuild() { INDEX = null; },
  };
}());
