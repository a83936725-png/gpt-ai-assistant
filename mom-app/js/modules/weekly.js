/* 易家做媽媽 — 家族週報 (the family weekly report).
 * Every Sunday one card sums up the week for the family LINE group: how much the baby drank and slept, new skills,
 * growth, first foods… or, while pregnant, the week and what the baby is doing now. It is made on this phone from the
 * records (nothing is uploaded); the mom adds a line for the family, chooses the name and photo, and sends the picture
 * (or a text version) herself. Medical records (看診、體溫、用藥、疫苗、產檢內容) never go on it.
 *   screen 'weekly'   home card 'weekly' (Sunday for this week, Monday for the week that just ended)
 *   App.weekly = { weekOf, reportWeek, babyWeek, pregWeek, build, spec, text, draw, due } */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const WD = ['一', '二', '三', '四', '五', '六', '日'];
  const NOTE_MAX = 40; // characters (an emoji counts as one)

  const ensure = (s) => {
    s.weekly = s.weekly || {};
    const w = s.weekly;
    w.sent = w.sent || {}; // {weekKey: 'YYYY-MM-DD'} sent to the family that day
    w.notes = w.notes || {}; // {weekKey: '給家人的話'}
    w.skip = w.skip || {}; // {weekKey: date} 「這週先不要」 on 首頁
    return w;
  };
  const privacy = () => (store.state.share && store.state.share.privacy) || { showName: true, showPhoto: false };
  const cleanNote = (s) => Array.from(String(s || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, NOTE_MAX).join('');
  const num1 = (v) => String(Math.round(Number(v) * 10) / 10);
  const signed = (v, digits = 2) => { const r = Math.round(v * 10 ** digits) / 10 ** digits; return `${r > 0 ? '+' : r < 0 ? '-' : '±'}${Math.abs(r)}`; };
  const md = (key) => C.fmtDate(key, false); // 11/18

  /* ---------------- weeks: Monday to Sunday, local time ---------------- */
  const weekOf = (d = new Date()) => {
    const x = C.startOfDay(d instanceof Date ? d : C.parseKey(d));
    return C.dateKey(C.addDays(x, -((x.getDay() + 6) % 7)));
  };
  const weekEnd = (wk) => C.dateKey(C.addDays(wk, 6));
  const shiftWeek = (wk, n) => C.dateKey(C.addDays(wk, 7 * n));
  const rangeText = (wk) => `${C.fmtDate(wk)}～${C.fmtDate(weekEnd(wk))}`;
  // the week a report is about: on Sunday this week; Monday to Saturday the week that just ended
  const reportWeek = (now = new Date()) => (now.getDay() === 0 ? weekOf(now) : shiftWeek(weekOf(now), -1));

  /* ---------------- the baby's week ---------------- */
  function milestoneLabels() {
    const out = {};
    ((App.HEALTH && App.HEALTH.MILESTONES) || []).forEach((band) => band.items.forEach((it) => { out[it[0]] = it[2]; }));
    return out;
  }
  function babyWeek(b, wk, now = new Date()) {
    const end = weekEnd(wk);
    const todayKey = C.dateKey(now);
    const t0 = C.parseKey(wk).getTime();
    const t7 = C.addDays(wk, 7).getTime();
    const days = WD.map((wd, i) => {
      const date = C.addDays(wk, i);
      const key = C.dateKey(date);
      return {
        key, wd, date, today: key === todayKey, future: key > todayKey, before: !!b.birthday && key < b.birthday,
        milk: 0, bottles: 0, feeds: 0, sleepMs: 0, diapers: 0, wet: 0, dirty: 0, baths: 0, any: false,
      };
    });
    const byKey = Object.fromEntries(days.map((d) => [d.key, d]));
    const foodsBefore = new Set(); const foods = [];
    let longest = 0;
    store.babyLogs(b.id).forEach((l) => {
      const st = new Date(l.start).getTime();
      if (!Number.isFinite(st)) return;
      if (l.type === 'sleep') {
        // a sleep still being timed counts until now (and a timer forgotten for days, at most 16 hours)
        const en = l.end ? new Date(l.end).getTime() : Math.min(now.getTime(), st + 16 * C.HOUR);
        if (!(en > st) || en <= t0 || st >= t7) return;
        days.forEach((d) => { // a night's sleep is split between the two days it touches
          const ds = d.date.getTime(); const de = C.addDays(d.date, 1).getTime();
          const ov = Math.min(en, de) - Math.max(st, ds);
          if (ov > 0) { d.sleepMs += ov; d.any = true; }
        });
        if (l.end && st >= t0 && en - st > longest) longest = en - st;
        return;
      }
      const item = l.type === 'food' ? String((l.data && l.data.item) || '').trim() : '';
      if (st < t0) { if (item) foodsBefore.add(item); return; }
      const d = byKey[C.dateKey(new Date(st))];
      if (!d) return;
      d.any = true;
      if (l.type === 'bottle') { d.milk += Number(l.data && l.data.ml) || 0; d.bottles += 1; d.feeds += 1; } else if (l.type === 'breast') d.feeds += 1;
      else if (l.type === 'diaper') {
        const k = l.data && l.data.kind;
        d.diapers += 1; if (k !== 'dirty') d.wet += 1; if (k !== 'wet') d.dirty += 1;
      } else if (l.type === 'bath') d.baths += 1;
      else if (item) foods.push({ item, st });
    });
    const newFoods = [];
    foods.sort((x, y) => x.st - y.st).forEach((f) => { if (!foodsBefore.has(f.item) && !newFoods.includes(f.item)) newFoods.push(f.item); });

    const live = days.filter((d) => !d.future && !d.before);
    // an average is over whole days: today (not over yet) counts only when it is the only day there is
    const avgOf = (has, val) => {
      const all = live.filter(has); const whole = all.filter((d) => !d.today);
      const use = whole.length ? whole : all;
      return use.length ? C.sum(use, val) / use.length : null;
    };
    const tot = (f) => C.sum(live, f);
    const totals = {
      feeds: tot((d) => d.feeds), bottles: tot((d) => d.bottles), milk: tot((d) => d.milk), diapers: tot((d) => d.diapers), baths: tot((d) => d.baths),
    };
    const avg = {
      milk: avgOf((d) => d.bottles > 0, (d) => d.milk),
      feeds: avgOf((d) => d.feeds > 0, (d) => d.feeds),
      sleepH: avgOf((d) => d.sleepMs > 0, (d) => d.sleepMs / C.HOUR),
      diapers: avgOf((d) => d.diapers > 0, (d) => d.diapers),
    };
    // mostly bottles: the amount is what the family understands; mostly breastfed: how often
    const byBottle = totals.milk > 0 && totals.bottles * 2 >= totals.feeds;

    const labels = milestoneLabels();
    const ms = Object.entries(store.state.milestones[b.id] || {})
      .map(([key, d]) => ({ key, date: String(d || '').slice(0, 10), label: labels[key] }))
      .filter((m) => m.label && m.date >= wk && m.date <= end)
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

    // measured this week: the newest measurement, and how much it changed since the one before (or birth)
    const gs = store.state.growth.filter((g) => g.babyId === b.id && g.date).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    const inWk = gs.filter((g) => g.date >= wk && g.date <= end && (Number(g.weight) > 0 || Number(g.length) > 0));
    let growth = null;
    if (inWk.length) {
      const g = inWk[inWk.length - 1];
      const prev = (field, birthField) => {
        const p = gs.filter((x) => x.date < g.date && Number(x[field]) > 0).pop();
        if (p) return { v: Number(p[field]), birth: false };
        return Number(b[birthField]) > 0 && g.date > b.birthday ? { v: Number(b[birthField]), birth: true } : null;
      };
      growth = {
        date: g.date, weight: Number(g.weight) || null, length: Number(g.length) || null, pw: prev('weight', 'birthWeight'), pl: prev('length', 'birthLength'),
      };
    }

    // big days that fall in this week (and have come): birth, 滿月, 百日, 收涎, 度晬, later birthdays
    const custom = [];
    const todayOrPast = (d) => d >= wk && d <= end && d <= todayKey;
    if (b.birthday && todayOrPast(b.birthday)) custom.push({ date: b.birthday, emoji: '🍼', text: '出生了，歡迎來到這個世界！' });
    if (b.birthday) {
      ((App.share && App.share.CUSTOMS) || []).forEach((c) => {
        const d = C.dateKey(c.day ? C.addDays(b.birthday, c.day - 1) : C.addMonths(b.birthday, c.month));
        if (todayOrPast(d)) custom.push({ date: d, emoji: c.emoji, text: c.title });
      });
      for (let y = 2; y <= 6; y += 1) {
        const d = C.dateKey(C.addMonths(b.birthday, 12 * y));
        if (todayOrPast(d)) custom.push({ date: d, emoji: '🎂', text: `${y} 歲生日快樂！` });
      }
    }

    const refKey = end < todayKey ? end : todayKey; // the last day of the week, or today
    const age = b.birthday ? C.babyAge(b.birthday, C.parseKey(refKey)) : null;
    const pp = App.journey && App.journey.ppInfo ? App.journey.ppInfo(C.parseKey(refKey)) : null;
    const clog = store.state.chicken.log || {};
    const chicken = Object.keys(clog).filter((k) => k >= wk && k <= end && clog[k] > 0).length;
    return {
      kind: 'baby', b, wk, end, refKey, days, live, recDays: live.filter((d) => d.any).length, totals, avg, byBottle, longest, newFoods, ms, growth, custom, age, pp, chicken,
    };
  }

  /* ---------------- the pregnancy's week ---------------- */
  function pregWeek(wk, now = new Date()) {
    const lmp = App.preg && App.preg.pregLmp ? App.preg.pregLmp() : '';
    if (!lmp) return null;
    const end = weekEnd(wk);
    const todayKey = C.dateKey(now);
    const refKey = end < todayKey ? end : todayKey;
    const ga = C.gestAge(lmp, C.parseKey(refKey));
    if (ga.totalDays < 0 || ga.weeks > 44) return null;
    const info = App.preg.weekInfo(ga.weeks);
    const s = store.state; const P = s.preg || {}; const D = App.PREG_DATA || {};
    const inWk = (k) => { const d = String(k || '').slice(0, 10); return !!d && d >= wk && d <= end; };
    const kicks = (P.kicks || []).filter((k) => k.start && inWk(C.dateKey(new Date(k.start)))).length;
    const visits = Object.entries(P.prenatal || {}).filter(([, d]) => inWk(d))
      .map(([key]) => (D.PRENATAL || []).find((v) => v.key === key)).filter(Boolean).sort((x, y) => x.no - y.no);
    const clog = s.chicken.log || {};
    const chicken = Object.keys(clog).filter((k) => k >= wk && k <= end && clog[k] > 0).length;
    let bag = null;
    if (ga.weeks >= 30 && D.HOSPITAL_BAG) {
      const all = D.HOSPITAL_BAG.flatMap((g) => g.items);
      const done = all.filter((i) => (s.hospitalBag || {})[i.id]).length;
      if (done) bag = { done, total: all.length };
    }
    const diary = (P.diary || []).filter((p) => inWk(p.date)).length;
    return {
      kind: 'preg', wk, end, refKey, ga, info, kicks, visits, chicken, bag, diary,
    };
  }

  // whose week this phone reports: the baby's (育兒) or the pregnancy's (懷孕); 備孕 has no family report
  function kindNow() {
    if (store.stage === 'baby') return store.baby() ? 'baby' : null;
    if (store.stage === 'preg') return App.preg && App.preg.pregLmp && App.preg.pregLmp() ? 'preg' : null;
    return null;
  }
  const build = (kind, wk, b, now = new Date()) => (kind === 'baby' ? (b ? babyWeek(b, wk, now) : null) : pregWeek(wk, now));

  /* ---------------- what the card and the text say ---------------- */
  const METRICS = {
    milk: {
      label: '奶量', title: '每天喝奶（ml）', val: (d) => d.milk, has: (r) => r.totals.milk > 0, fmt: (v) => `${Math.round(v)}`, avg: (r) => r.avg.milk,
    },
    feeds: {
      label: '餵奶', title: '每天餵奶（次）', val: (d) => d.feeds, has: (r) => r.totals.feeds > 0, fmt: (v) => `${v}`, avg: (r) => r.avg.feeds,
    },
    sleep: {
      label: '睡眠', title: '每天睡眠（小時）', val: (d) => d.sleepMs / C.HOUR, has: (r) => r.live.some((d) => d.sleepMs > 0), fmt: num1, avg: (r) => r.avg.sleepH,
    },
    diaper: {
      label: '尿布', title: '每天尿布（片）', val: (d) => d.diapers, has: (r) => r.totals.diapers > 0, fmt: (v) => `${v}`, avg: (r) => r.avg.diapers,
    },
  };
  const metricsFor = (r) => (r.kind === 'baby' ? Object.keys(METRICS).filter((k) => METRICS[k].has(r)) : []);
  const defaultMetric = (r) => {
    const m = metricsFor(r);
    if (r.byBottle && m.includes('milk')) return 'milk';
    return m.includes('feeds') ? 'feeds' : m[0] || null;
  };

  // {v, u, l}: the big number, its unit, and what it is
  function tiles(r) {
    const t = [];
    if (r.kind === 'baby') {
      if (r.byBottle && r.avg.milk) t.push({ v: `${Math.round(r.avg.milk)}`, u: 'ml', l: '每天喝奶' });
      else if (r.avg.feeds) t.push({ v: num1(r.avg.feeds), u: '次', l: '每天餵奶' });
      if (r.avg.sleepH) t.push({ v: num1(r.avg.sleepH), u: '小時', l: '每天睡' });
      if (r.avg.diapers) t.push({ v: num1(r.avg.diapers), u: '片', l: '每天尿布' });
      if (t.length < 3 && r.age && r.age.days >= 0) t.push({ v: `${r.age.days + 1}`, u: '天', l: '出生第' });
      if (t.length < 3 && r.totals.baths) t.push({ v: `${r.totals.baths}`, u: '次', l: '洗澡' });
      return t.slice(0, 3);
    }
    const { ga } = r;
    t.push(ga.daysLeft > 0 ? { v: `${ga.daysLeft}`, u: '天', l: '後見面' } : { v: '💜', u: '', l: '隨時見面' });
    const tri = { v: `第 ${ga.trimester}`, u: '', l: '孕期' };
    t.push(r.kicks ? { v: `${r.kicks}`, u: '次', l: '數胎動' } : tri);
    if (r.chicken) t.push({ v: `${r.chicken}`, u: '天', l: '滴雞精時光' });
    else t.push(r.kicks ? tri : { v: `${Math.round(ga.progress * 100)}`, u: '%', l: '孕程' });
    return t;
  }

  // the week's highlights, most special first
  function highlights(r) {
    const out = [];
    if (r.kind === 'baby') {
      r.custom.forEach((c) => out.push(`${c.emoji} ${md(c.date)} ${c.text}`));
      if (r.ms.length <= 2) r.ms.forEach((m) => out.push(`⭐ 新技能：${m.label}`));
      else out.push(`⭐ 新技能：${r.ms[0].label}等 ${r.ms.length} 項`);
      if (r.growth) {
        const g = r.growth; const parts = [];
        if (g.weight) parts.push(`體重 ${Math.round(g.weight * 100) / 100} 公斤${g.pw ? `（${g.pw.birth ? '比出生' : '比上次'} ${signed(g.weight - g.pw.v)}）` : ''}`);
        if (g.length) parts.push(`身長 ${Math.round(g.length * 10) / 10} 公分`);
        out.push(`📏 ${parts.join('・')}`);
      }
      if (r.newFoods.length) out.push(`🥣 第一次吃：${r.newFoods.slice(0, 3).join('、')}${r.newFoods.length > 3 ? ' 等' : ''}`);
      if (r.longest >= 2 * C.HOUR) out.push(`🌙 最長一覺睡了 ${C.fmtDuration(r.longest)}`);
      if (r.totals.baths) out.push(`🛁 洗澡 ${r.totals.baths} 次`);
      if (r.pp && r.pp.day <= 42) out.push(`🍲 媽媽產後第 ${Math.ceil(r.pp.day / 7)} 週，好好休息中`);
      if (r.chicken >= 3) out.push(`💜 媽媽有 ${r.chicken} 天留了滴雞精時光給自己`);
      return out;
    }
    r.visits.forEach((v) => out.push(`🩺 完成第 ${v.no} 次產檢`));
    if (r.bag) out.push(r.bag.done >= r.bag.total ? '🎒 待產包準備好了！' : `🎒 待產包準備了 ${r.bag.done}／${r.bag.total} 項`);
    if (r.diary) out.push(`📔 寫了 ${r.diary} 頁產檢日記`);
    return out;
  }

  const momSign = () => `— ${store.state.profile.momName || '媽媽'}`;
  const babyName = (b) => (privacy().showName ? b.name || '寶寶' : '寶寶');

  // the card's content: {theme, kicker, hero:{photo, emoji, title, sub, sub2}, stats, chart, fact, lines, note, sign}
  function spec(r, { metric, note } = {}) {
    const out = {
      stats: tiles(r), lines: highlights(r), note: cleanNote(note), sign: momSign(), campaign: 'weekly', path: 'home',
    };
    if (r.kind === 'baby') {
      const { b } = r;
      const born = r.age && r.age.days >= 0;
      out.theme = 'peach';
      out.kicker = `📮 家族週報・${rangeText(r.wk)}`;
      out.hero = {
        photo: privacy().showPhoto && b.photo ? b.photo : null,
        emoji: b.avatar || '👶',
        title: `${babyName(b)} 這週`,
        sub: born ? r.age.text : '',
        sub2: born ? r.age.dayText : '',
      };
      const m = metric && METRICS[metric] && METRICS[metric].has(r) ? metric : defaultMetric(r);
      if (m) {
        const M = METRICS[m];
        out.chart = {
          title: M.title, avg: M.avg(r) == null ? '' : `平均 ${M.fmt(M.avg(r))}`,
          bars: r.days.map((d) => ({ label: d.wd, v: d.future || d.before ? null : M.val(d), today: d.today })), fmt: M.fmt,
        };
      }
      return out;
    }
    const { ga, info } = r;
    const wt = !info ? '' : info.wt < 1 ? '不到 1 g' : info.wt >= 1000 ? `${(info.wt / 1000).toFixed(1)} kg` : `${info.wt} g`;
    out.theme = 'purple';
    out.kicker = `📮 好孕週報・${rangeText(r.wk)}`;
    out.hero = {
      photo: null,
      emoji: info ? info.emoji : '🤰',
      title: `懷孕 ${ga.weeks} 週${ga.days ? ` ${ga.days} 天` : ''}`,
      sub: info ? `寶寶大約像${info.fruit}一樣大` : '',
      sub2: info ? `約 ${info.len} cm・${wt}` : '',
    };
    if (info) out.fact = `這週的寶寶：${info.baby}`;
    out.progress = { pct: C.clamp(ga.progress, 0, 1), label: `${Math.round(ga.progress * 100)}%` };
    return out;
  }

  // the same week as words, for LINE (grandparents read text first)
  function text(r, { note } = {}) {
    const L = [];
    const n = cleanNote(note);
    if (r.kind === 'baby') {
      const name = babyName(r.b);
      L.push(`【${name}這週】${rangeText(r.wk)}`);
      if (r.age && r.age.days >= 0) L.push(`👶 ${r.age.text}（${r.age.dayText}）`);
      if (r.byBottle && r.avg.milk) L.push(`🍼 每天喝奶約 ${Math.round(r.avg.milk)} ml${r.avg.feeds ? `，平均餵 ${num1(r.avg.feeds)} 次` : ''}`);
      else if (r.avg.feeds) L.push(`🤱 每天餵奶約 ${num1(r.avg.feeds)} 次`);
      if (r.avg.sleepH) L.push(`😴 每天睡約 ${num1(r.avg.sleepH)} 小時`);
      if (r.avg.diapers) L.push(`🧷 每天約 ${num1(r.avg.diapers)} 片尿布`);
      highlights(r).forEach((x) => L.push(x));
    } else {
      const { ga, info } = r;
      L.push(`【好孕週報】${rangeText(r.wk)}`);
      L.push(`🤰 懷孕 ${ga.weeks} 週${ga.days ? ` ${ga.days} 天` : ''}${ga.daysLeft > 0 ? `，還有 ${ga.daysLeft} 天見面` : '，隨時都可能見面了'}`);
      if (info) L.push(`${info.emoji} 寶寶大約像${info.fruit}一樣大（約 ${info.len} cm）`);
      if (info) L.push(`👶 這週的寶寶：${info.baby}`);
      if (r.kicks) L.push(`👣 數了 ${r.kicks} 次胎動`);
      highlights(r).forEach((x) => L.push(x));
    }
    if (n) L.push(`💬 ${n} ${momSign()}`);
    // a 祝福牆 opened lately: the family can leave a line there
    const w = App.social && App.social.soc ? (App.social.soc().walls || [])[0] : null;
    if (w && App.wall && w.createdAt && Date.now() - new Date(w.createdAt).getTime() < 60 * C.DAY) {
      L.push(`💌 ${App.wall.titleOf(w)}，來留句話：${App.share.link({ path: 'wish', params: { w: w.id }, channel: 'line', campaign: 'wish' })}`);
    }
    L.push(`— 用「${(window.BRAND && window.BRAND.appName) || '易家做媽媽'}」記錄：${App.share.link({ path: 'home', channel: 'line', campaign: 'weekly' })}`);
    return L.join('\n');
  }

  /* ---------------- the card (1080×1920, the same size as the other share cards) ---------------- */
  async function draw(sp) {
    const D = App.share.draw;
    const F = D.FONT;
    const W = 1080; const H = 1920;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const [c1, c2, soft] = D.THEMES[sp.theme] || D.THEMES.peach;
    await D.paintFrame(ctx, W, H, sp.theme);
    const top = 220; const px = 64; const pw = W - 128;
    const qs = 250; const fy = H - 64 - qs; // the QR footer
    const pad = 48; const ix = px + 56; const iw = pw - 112; const cx = W / 2;
    ctx.textBaseline = 'top';

    // what fits: the highlights shrink first, then the baby fact, then the chart
    const blocks = [{ id: 'kicker', h: 44 }, { id: 'hero', h: 176 }];
    if (sp.stats && sp.stats.length) blocks.push({ id: 'stats', h: 150 });
    if (sp.progress) blocks.push({ id: 'progress', h: 126 });
    if (sp.chart) blocks.push({ id: 'chart', h: 268 });
    let factLines = [];
    if (sp.fact) {
      ctx.font = `500 34px ${F}`; factLines = D.wrap(ctx, sp.fact, iw - 64).slice(0, 3);
      blocks.push({ id: 'fact', h: 36 + factLines.length * 48 });
    }
    let noteLines = [];
    if (sp.note) { ctx.font = `800 40px ${F}`; noteLines = D.wrap(ctx, `「${sp.note}」`, iw - 80).slice(0, 2); }
    const noteH = noteLines.length ? 40 + noteLines.length * 54 + 46 : 0;
    const ROW = 68; const ROW_GAP = 12; const GAP = 22;
    const lines = (sp.lines || []).slice(0, 6);
    let n = lines.length;
    const avail = fy - 46 - top - pad * 2;
    const parts = () => [...blocks.map((b) => b.h), n ? n * ROW + (n - 1) * ROW_GAP : 0, noteH].filter((x) => x > 0);
    const total = (gap = GAP) => { const p = parts(); return C.sum(p) + gap * (p.length - 1); };
    while (total() > avail && n > 1) n -= 1;
    ['fact', 'chart', 'progress'].forEach((id) => { if (total() > avail) { const i = blocks.findIndex((b) => b.id === id); if (i >= 0) blocks.splice(i, 1); } });
    while (total() > avail && n > 0) n -= 1;
    const count = parts().length;
    const gap = GAP + Math.min(26, Math.max(0, avail - total()) / Math.max(1, count - 1));
    const panelH = total(gap) + pad * 2;
    // a shorter card sits nearer the middle of the space between the header and the QR code
    const y0 = top + Math.min(90, Math.max(0, (fy - 46 - top - panelH) / 2));
    ctx.fillStyle = 'rgba(255,255,255,0.97)'; D.roundRect(ctx, px, y0, pw, panelH, 56); ctx.fill();

    let y = y0 + pad;
    const text = (s, x, yy, font, color, align = 'left', maxW = iw) => {
      ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(D.fitLine(ctx, String(s), maxW), x, yy);
    };
    for (const blk of blocks) { // eslint-disable-line no-restricted-syntax
      if (blk.id === 'kicker') text(sp.kicker, ix, y + 4, `700 34px ${F}`, c2);
      if (blk.id === 'hero') {
        const hr = sp.hero; const r = 84; const ccx = ix + r; const ccy = y + 88;
        ctx.fillStyle = soft; ctx.beginPath(); ctx.arc(ccx, ccy, r, 0, Math.PI * 2); ctx.fill();
        const photo = hr.photo ? await D.loadImg(hr.photo) : null; // eslint-disable-line no-await-in-loop
        if (photo) {
          const k = Math.max((2 * r - 12) / photo.naturalWidth, (2 * r - 12) / photo.naturalHeight);
          ctx.save(); ctx.beginPath(); ctx.arc(ccx, ccy, r - 6, 0, Math.PI * 2); ctx.clip();
          ctx.drawImage(photo, ccx - (photo.naturalWidth * k) / 2, ccy - (photo.naturalHeight * k) / 2, photo.naturalWidth * k, photo.naturalHeight * k);
          ctx.restore();
        } else {
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `96px ${F}`; ctx.fillStyle = '#2b2231';
          ctx.fillText(hr.emoji || '💜', ccx, ccy + 4); ctx.textBaseline = 'top';
        }
        const tx = ix + 2 * r + 32; const tw = iw - 2 * r - 32;
        text(hr.title, tx, y + 14, `900 64px ${F}`, '#2b2231', 'left', tw);
        if (hr.sub) text(hr.sub, tx, y + 96, `700 36px ${F}`, c1, 'left', tw);
        if (hr.sub2) text(hr.sub2, tx, y + 142, `500 30px ${F}`, '#7a6f80', 'left', tw);
      }
      if (blk.id === 'stats') {
        const k = Math.min(3, sp.stats.length); const g = 20; const sw = (iw - g * (k - 1)) / k;
        sp.stats.slice(0, 3).forEach((st, i) => {
          const sx = ix + i * (sw + g); const mid = sx + sw / 2;
          ctx.fillStyle = soft; D.roundRect(ctx, sx, y, sw, 150, 30); ctx.fill();
          // the number big, its unit smaller, centred together
          ctx.font = `900 56px ${F}`; const vw = ctx.measureText(String(st.v)).width;
          ctx.font = `700 30px ${F}`; const uw = st.u ? ctx.measureText(` ${st.u}`).width : 0;
          const scale = Math.min(1, (sw - 24) / (vw + uw));
          ctx.save(); ctx.translate(mid - ((vw + uw) * scale) / 2, y + 22); ctx.scale(scale, scale);
          ctx.textAlign = 'left'; ctx.fillStyle = c1; ctx.font = `900 56px ${F}`; ctx.fillText(String(st.v), 0, 0);
          if (st.u) { ctx.font = `700 30px ${F}`; ctx.fillText(` ${st.u}`, vw, 22); }
          ctx.restore();
          text(st.l, mid, y + 98, `500 28px ${F}`, '#5f5566', 'center', sw - 20);
        });
      }
      if (blk.id === 'chart') {
        const ch = sp.chart;
        text(ch.title, ix, y, `800 32px ${F}`, '#3d3442', 'left', iw - 220);
        if (ch.avg) text(ch.avg, ix + iw, y + 2, `700 30px ${F}`, c2, 'right', 220);
        const vals = ch.bars.map((bb) => bb.v).filter((v) => v != null);
        const max = Math.max(1, ...vals);
        const g = 16; const bw = (iw - g * 6) / 7; const base = y + 58 + 34 + 136; const maxH = 136;
        ch.bars.forEach((bb, i) => {
          const bx = ix + i * (bw + g); const mid = bx + bw / 2;
          if (bb.v == null) {
            ctx.fillStyle = '#ece6ee'; D.roundRect(ctx, bx, base - 10, bw, 10, 5); ctx.fill();
          } else {
            const bh = Math.max(10, (bb.v / max) * maxH);
            ctx.globalAlpha = bb.today ? 0.5 : 1; // today is not over yet
            ctx.fillStyle = bb.v ? c2 : '#e3dbe6'; D.roundRect(ctx, bx, base - bh, bw, bh, Math.min(16, bw / 2)); ctx.fill();
            ctx.globalAlpha = 1;
            text(ch.fmt(bb.v), mid, base - bh - 34, `700 26px ${F}`, c1, 'center', bw + 12);
          }
          text(bb.today ? '今天' : bb.label, mid, base + 12, `${bb.today ? 800 : 600} 28px ${F}`, bb.v == null ? '#b8aebd' : '#5f5566', 'center', bw + 12);
        });
      }
      if (blk.id === 'progress') { // the whole pregnancy as one bar: the three trimesters, and where she is now
        const pg = sp.progress;
        text('孕程', ix, y, `800 32px ${F}`, '#3d3442', 'left', iw - 200);
        text(pg.label, ix + iw, y + 2, `800 30px ${F}`, c2, 'right', 200);
        const by = y + 56; const bh = 26;
        ctx.fillStyle = soft; D.roundRect(ctx, ix, by, iw, bh, bh / 2); ctx.fill();
        ctx.fillStyle = c2; D.roundRect(ctx, ix, by, Math.max(bh, iw * pg.pct), bh, bh / 2); ctx.fill();
        ctx.fillStyle = '#fff'; [14 / 40, 28 / 40].forEach((f) => ctx.fillRect(ix + iw * f - 2, by, 4, bh));
        const mx = ix + Math.max(bh / 2, Math.min(iw - bh / 2, iw * pg.pct));
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx, by + bh / 2, 21, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = c1; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(mx, by + bh / 2, 18, 0, Math.PI * 2); ctx.stroke();
        [['第一孕期', 0, 14], ['第二孕期', 14, 28], ['第三孕期', 28, 40]].forEach(([t, a, z]) => {
          text(t, ix + (iw * (a + z)) / 80, by + bh + 14, `600 26px ${F}`, '#7a6f80', 'center', (iw * (z - a)) / 40);
        });
      }
      if (blk.id === 'fact') {
        ctx.fillStyle = soft; D.roundRect(ctx, ix, y, iw, blk.h, 28); ctx.fill();
        factLines.forEach((ln, i) => text(ln, ix + 32, y + 18 + i * 48, `500 34px ${F}`, '#3d3442', 'left', iw - 64));
      }
      y += blk.h + gap;
    }
    lines.slice(0, n).forEach((ln, i) => {
      ctx.fillStyle = soft; D.roundRect(ctx, ix, y, iw, ROW, 22); ctx.fill();
      // a long line gets a slightly smaller font before anything is cut off
      const size = [36, 34, 32, 30].find((px2) => { ctx.font = `600 ${px2}px ${F}`; return ctx.measureText(ln).width <= iw - 56; }) || 30;
      text(ln, ix + 28, y + 15 + (36 - size) / 2, `600 ${size}px ${F}`, '#3d3442', 'left', iw - 56);
      y += ROW + (i < n - 1 ? ROW_GAP : 0);
    });
    if (n) y += gap;
    if (noteH) {
      ctx.fillStyle = '#fff'; D.roundRect(ctx, ix, y, iw, noteH, 30); ctx.fill();
      ctx.strokeStyle = c2; ctx.lineWidth = 3; D.roundRect(ctx, ix + 1.5, y + 1.5, iw - 3, noteH - 3, 30); ctx.stroke();
      noteLines.forEach((ln, i) => text(ln, cx, y + 30 + i * 54, `800 40px ${F}`, c1, 'center', iw - 60));
      text(sp.sign, ix + iw - 32, y + noteH - 52, `500 30px ${F}`, '#7a6f80', 'right', iw - 64);
    }
    D.paintFooter(ctx, W, fy, qs, { path: sp.path || 'home', campaign: sp.campaign || 'weekly' });
    return new Promise((res) => cv.toBlob((bl) => res(bl), 'image/png'));
  }

  /* ---------------- sending ---------------- */
  function markSent(wk, channel, msg) {
    store.update((s) => { ensure(s).sent[wk] = C.dateKey(); });
    const pts = App.share ? App.share.record(channel, 'weekly') : 0;
    ui.toast(msg || `謝謝分享 💜${pts ? ` 好孕點數 +${pts}` : ''}`);
  }
  const lineUrl = (t) => `https://line.me/R/share?text=${encodeURIComponent(t)}`;
  // how: 'image' (the picture and the words through the phone's share sheet → LINE → the family group),
  //      'text' (only the words, straight to LINE), 'save' (keep the picture)
  async function send(how, { wk, words, blob, onSent }) {
    if (how === 'text') {
      window.open(lineUrl(words), '_blank', 'noopener');
      markSent(wk, 'line', '已開啟 LINE，選家族群組就可以傳出去 💜');
      if (onSent) onSent();
      return;
    }
    const pic = await blob();
    if (!pic) { ui.toast('週報圖片做不出來，請改用「只傳文字」'); return; }
    const name = `yijia-weekly-${wk}.png`; // an ASCII name: some systems drop a Chinese file name on download
    if (how === 'save') {
      const r = await App.share.saveImage(pic, name, '家族週報');
      if (r === 'downloaded') ui.toast('週報圖片已下載');
      return;
    }
    const file = typeof File === 'function' ? new File([pic], name, { type: 'image/png' }) : null;
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: words });
        markSent(wk, 'more');
        if (onSent) onSent();
      } catch (e) { if (!e || e.name !== 'AbortError') ui.toast('無法分享，請改用「只傳文字」或「存圖片」'); }
      return;
    }
    // a computer (no picture sharing): LINE gets the words, and the picture is downloaded to add in the chat
    App.share.downloadBlob(pic, name);
    window.open(lineUrl(words), '_blank', 'noopener');
    markSent(wk, 'line', '已開啟 LINE，週報圖片也下載好了，可以一起傳到群組');
    if (onSent) onSent();
  }

  /* ---------------- the screen ---------------- */
  const view = {
    wk: null, babyId: null, metric: null, link: null,
  }; // what is being looked at (kept while on the screen)
  const PRESETS = {
    baby: ['謝謝家人的幫忙 💜', '這週爸爸辛苦了！', '週末來看寶寶吧！', '寶寶想念大家 🥰'],
    preg: ['謝謝大家的關心 💜', '寶寶和我都很好！', '這週爸爸辛苦了！', '期待和寶寶見面 🥰'],
  };
  function bounds(kind, b, now = new Date()) {
    const maxWk = weekOf(now);
    let minWk = shiftWeek(maxWk, -52);
    const from = kind === 'baby' ? b.birthday : C.dateKey(C.addDays(App.preg.pregLmp(), 28)); // 4 weeks pregnant
    if (from && weekOf(from) > minWk) minWk = weekOf(from);
    if (minWk > maxWk) minWk = maxWk;
    return [minWk, maxWk];
  }
  const hasContent = (r) => !!r && (r.kind === 'preg' || r.recDays > 0 || highlights(r).length > 0);
  function defaultWeek(kind, b, now = new Date()) {
    const rw = reportWeek(now); const cur = weekOf(now);
    if (rw === cur) return cur;
    return hasContent(build(kind, rw, b, now)) ? rw : cur; // just started: this week so far
  }

  function renderScreen(el, params) {
    const stage = store.stage;
    if (stage === 'prep') {
      el.append(ui.empty('📮', '家族週報在懷孕和育兒的時候使用：每週一張卡，傳到家族群組。'));
      return;
    }
    if (stage === 'baby' && !store.baby()) {
      el.append(ui.empty('👶', '先新增寶寶資料，就可以做寶寶的家族週報。', h('button', { class: 'btn btn-primary', onclick: () => App.me && App.me.editBaby() }, '新增寶寶')));
      return;
    }
    if (stage === 'preg' && !kindNow()) {
      el.append(ui.empty('🤰', '先設定預產期，就可以做每週的好孕週報。', h('button', { class: 'btn btn-primary', onclick: () => App.preg.openDueDateSheet() }, '設定預產期')));
      return;
    }
    const kind = stage === 'baby' ? 'baby' : 'preg';
    const now = new Date();
    const { babies } = store.state;
    // a link to a week (or a baby) applies once; after that the arrows and the baby tabs decide
    const key = JSON.stringify([params.wk || '', params.baby || '']);
    if (key !== view.link) {
      view.link = key;
      if (params.wk && /^\d{4}-\d\d-\d\d$/.test(params.wk)) view.wk = weekOf(params.wk);
      if (params.baby) view.babyId = params.baby;
    }
    if (kind === 'baby' && !babies.some((x) => x.id === view.babyId)) view.babyId = store.baby().id;
    const b = kind === 'baby' ? babies.find((x) => x.id === view.babyId) : null;
    const [minWk, maxWk] = bounds(kind, b, now);
    let wk = view.wk || defaultWeek(kind, b, now);
    if (wk < minWk) wk = minWk;
    if (wk > maxWk) wk = maxWk;
    view.wk = wk;
    const r = build(kind, wk, b, now);
    if (!r) {
      el.append(ui.empty('📮', kind === 'baby' ? '寶寶出生後，就可以做家族週報。' : '這週還沒有可以做成週報的內容。'));
      return;
    }

    if (kind === 'baby' && babies.length > 1) {
      el.append(h('div', { class: 'mb' }, ui.seg(babies.map((x) => ({ value: x.id, label: x.name || '寶寶' })), view.babyId,
        (v) => { view.babyId = v; view.metric = null; App.refresh(); }, { small: true })));
    }
    const cur = weekOf(now);
    const label = wk === cur ? (now.getDay() === 0 ? '本週' : '本週（到今天）') : wk === shiftWeek(cur, -1) ? '上週' : '';
    el.append(h('div', { class: 'datenav wk-nav' },
      h('button', { class: 'icon-btn', 'aria-label': '前一週', html: ui.ICONS.left, disabled: wk <= minWk, onclick: () => { view.wk = shiftWeek(wk, -1); App.refresh(); } }),
      h('div', { class: 'datenav-mid' }, h('div', { class: 'bold' }, rangeText(wk)), h('div', { class: 'tiny muted' }, label || (kind === 'baby' ? '家族週報' : '好孕週報'))),
      h('button', { class: 'icon-btn', 'aria-label': '後一週', html: ui.ICONS.right, disabled: wk >= maxWk, onclick: () => { view.wk = shiftWeek(wk, 1); App.refresh(); } })));

    const w = ensure(store.state);
    let note = w.notes[wk] || '';
    const opts = () => ({ metric: view.metric, note });
    // the preview: drawn again (a moment later) whenever something on it changes
    const preview = h('div', { class: 'wk-preview' }, h('div', { class: 'wk-ph', role: 'status' }, '做週報中…'));
    let blobP = null; let seq = 0; let url = null;
    const pre = h('pre', { class: 'wk-text-pre' }, text(r, opts()));
    const paint = () => {
      seq += 1; const mine = seq;
      blobP = draw(spec(r, opts()));
      pre.textContent = text(r, opts());
      blobP.then((bl) => {
        if (mine !== seq || !bl || !preview.isConnected) return;
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(bl);
        preview.innerHTML = '';
        const alt = `${kind === 'baby' ? '家族週報' : '好孕週報'}卡片預覽（${rangeText(wk)}）`;
        // tap to see it full size (the preview is small on a small phone, so the send button stays in view)
        preview.append(h('button', {
          type: 'button', class: 'wk-zoom', 'aria-label': '放大看週報卡片',
          onclick: () => ui.sheet({ title: '週報卡片', body: h('img', { class: 'wk-img-full', src: url, alt }), wide: true }),
        }, h('img', { class: 'wk-img', src: url, alt })));
      });
    };
    let timer = null;
    const paintSoon = () => { clearTimeout(timer); timer = setTimeout(() => { timer = null; paint(); }, 280); };
    // sending right after typing: draw the card with the newest words first
    const latest = () => { if (timer || !blobP) { clearTimeout(timer); timer = null; paint(); } return blobP; };
    el.append(preview);

    const sentOn = w.sent[wk];
    const status = h('p', { class: 'wk-status small center', role: 'status' }, sentOn ? `✓ ${md(sentOn)} 已傳給家人` : '');
    const ctx = () => ({
      wk, words: text(r, opts()), blob: latest, onSent: () => { status.textContent = `✓ ${md(C.dateKey())} 已傳給家人`; },
    });
    el.append(h('div', { class: 'wk-actions' },
      h('button', { class: 'btn btn-line btn-block wk-send', onclick: () => send('image', ctx()), html: `${ui.ICONS.line}<span>傳到家族群組</span>` }),
      h('p', { class: 'tiny muted center wk-hint' }, '會打開分享選單：選 LINE，再選家族群組'),
      h('div', { class: 'grid-2' },
        h('button', { class: 'btn btn-soft wk-text-btn', onclick: () => send('text', ctx()) }, '💬 只傳文字'),
        h('button', { class: 'btn btn-soft wk-save', onclick: () => send('save', ctx()) }, '⬇️ 存圖片')),
      status));

    // 給家人的話
    const count = h('span', { class: 'tiny muted' }, `${Array.from(note).length}/${NOTE_MAX}`);
    const input = h('input', {
      type: 'text', class: 'input wk-note', value: note, maxlength: 80, enterkeyhint: 'done', 'aria-label': '給家人的話',
      placeholder: kind === 'baby' ? '例如：謝謝阿嬤這週來幫忙！' : '例如：寶寶和我都很好！',
    });
    const saveNote = (v) => {
      note = cleanNote(v);
      count.textContent = `${Array.from(note).length}/${NOTE_MAX}`;
      store.update((s) => { const x = ensure(s); if (note) x.notes[wk] = note; else delete x.notes[wk]; });
      paintSoon();
    };
    input.addEventListener('input', () => {
      const cps = Array.from(input.value);
      if (cps.length > NOTE_MAX) input.value = cps.slice(0, NOTE_MAX).join('');
      saveNote(input.value);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    el.append(ui.card({ class: 'mt wk-note-card' },
      h('div', { class: 'row between' }, h('div', { class: 'card-title' }, '💬 給家人的話'), count),
      input,
      h('div', { class: 'chips wk-mt-sm' }, PRESETS[kind].map((t) => h('button', {
        type: 'button', class: 'chip', onclick: () => { input.value = t; saveNote(t); },
      }, t))),
      h('p', { class: 'tiny faint wk-mt-sm' }, '選填，會放在週報卡片的最下面。')));

    // what goes on the card
    const optCard = ui.card({ class: 'mt wk-opts' }, h('div', { class: 'card-title' }, '🖼️ 卡片內容'));
    if (kind === 'baby') {
      const ms = metricsFor(r);
      const curM = view.metric && ms.includes(view.metric) ? view.metric : defaultMetric(r);
      if (ms.length > 1) {
        optCard.append(h('div', { class: 'small muted wk-opt-label' }, '每天的圖表'), ui.seg(ms.map((k) => ({ value: k, label: METRICS[k].label })), curM,
          (v) => { view.metric = v; paintSoon(); }, { small: true }));
      }
      const pv = privacy();
      const setPriv = (k, v) => { store.update((s) => { s.share = s.share || {}; s.share.privacy = { ...privacy(), [k]: v }; }); paintSoon(); };
      optCard.append(h('div', { class: 'wk-checks' },
        h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: pv.showName, onchange: (e) => setPriv('showName', e.target.checked) }), h('span', { class: 'small' }, '顯示寶寶名字')),
        b.photo ? h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: pv.showPhoto, onchange: (e) => setPriv('showPhoto', e.target.checked) }), h('span', { class: 'small' }, '放寶寶照片')) : null));
      if (r.recDays < 7 && r.live.length) {
        optCard.append(h('p', { class: 'tiny faint wk-mt-sm' }, r.recDays ? `這週有 ${r.recDays} 天有紀錄，每天平均以有紀錄的天數計算${r.days.some((d) => d.today) ? '（今天還沒過完，不算進平均）' : ''}。` : '這週還沒有餵奶、睡眠、尿布的紀錄，卡片會先放寶寶的年紀與大事。'));
      }
    } else {
      optCard.append(h('p', { class: 'small muted' }, '孕週、寶寶的大小與這週的變化，加上這週數胎動、產檢、待產包的進度。'));
    }
    el.append(optCard);

    el.append(h('details', { class: 'card mt wk-text' }, h('summary', { class: 'bold small' }, '📝 文字版（「只傳文字」會傳這段）'), pre));
    el.append(h('label', { class: 'check-row mt wk-remind' },
      h('input', { type: 'checkbox', checked: !w.off, onchange: (e) => { store.update((s) => { ensure(s).off = !e.target.checked; }); ui.toast(e.target.checked ? '每週日會在首頁提醒你做週報' : '不會再在首頁提醒，週報隨時可以在「健康」找到'); } }),
      h('span', { class: 'small' }, '每週日在首頁提醒我做週報')));
    el.append(h('p', { class: 'disclaimer' }, '週報在這支手機上產生，傳出去之前你都可以先看過；看診、體溫、用藥、疫苗和產檢的內容不會放上週報。卡片下方的 QR 是你的邀請連結。'));
    paint();
  }

  App.screen('weekly', {
    title: '家族週報',
    tab: 'health',
    liveUpdate: false, // typing the note must not redraw the screen under the keyboard
    render(el, params) { renderScreen(el, params || {}); },
    onLeave() { Object.assign(view, { wk: null, babyId: null, metric: null, link: null }); },
  });

  /* ---------------- 首頁: Sunday (this week) and Monday (the week that just ended) ---------------- */
  function enough(r) {
    if (r.kind === 'baby') return r.recDays >= 3 || r.ms.length > 0 || !!r.growth || r.custom.length > 0;
    const since = store.state.onboardedAt || store.state.createdAt;
    return !since || C.diffDays(since, C.parseKey(r.end)) >= 2; // in use for at least 3 days of that week
  }
  function due(now = new Date()) {
    const w = ensure(store.state);
    if (w.off || !store.state.onboarded) return null;
    if (now.getDay() !== 0 && now.getDay() !== 1) return null;
    const kind = kindNow();
    if (!kind) return null;
    const wk = reportWeek(now);
    if (w.sent[wk] || w.skip[wk]) return null;
    const r = build(kind, wk, kind === 'baby' ? store.baby() : null, now);
    return r && enough(r) ? { r, wk, kind } : null;
  }
  App.homeCard('weekly', {
    stages: ['preg', 'baby'],
    order: 11,
    render(el) {
      const d = due();
      if (!d) return;
      const { r, wk } = d;
      const when = wk === weekOf(new Date()) ? '這週' : '上週';
      // short enough for one line on a small phone; twins: whose week
      const title = r.kind === 'preg' ? `${when}的好孕週報做好了` : store.state.babies.length > 1 ? `${babyName(r.b)}${when}的週報做好了` : `${when}的家族週報做好了`;
      const t = tiles(r).filter((x) => x.l.startsWith('每天')).slice(0, 2).map((x, i) => `${i ? x.l.replace('每天', '') : x.l} ${x.v}\u00a0${x.u}`); // a number stays with its unit
      const parts = r.kind === 'baby'
        ? [...t, r.ms.length ? `新技能 ${r.ms.length} 項` : ''].filter(Boolean)
        : [`懷孕 ${r.ga.weeks} 週`, r.info ? `寶寶像${r.info.fruit}一樣大` : ''].filter(Boolean);
      // each item stays on one line; a narrow phone wraps between them
      const sub = parts.length ? parts.map((x, i) => [i ? '・' : null, h('span', { class: 'nowrap' }, x)]) : '這週的大事都整理好了';
      el.append(ui.card({ class: 'wk-home' },
        h('div', { class: 'row gap' },
          h('span', { class: 'wk-home-ico', 'aria-hidden': 'true' }, '📮'),
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, title), h('div', { class: 'small muted' }, sub)),
          h('button', {
            class: 'icon-btn wk-home-x', 'aria-label': '這週先不要',
            onclick: () => { store.update((s) => { ensure(s).skip[wk] = C.dateKey(); }); ui.toast('這週先不傳。週報隨時可以在「健康 → 家族週報」做'); },
          }, '✕')),
        h('button', { class: 'btn btn-primary btn-block wk-mt-sm wk-home-go', onclick: () => App.navigate('weekly', { wk }) }, '📮 看週報，傳給家人')));
    },
  });

  const TAGS = ['週報', '家族', '家人', '傳給家人', '群組', '阿公阿嬤', '爺爺奶奶', '每週'];
  App.tool({
    id: 'weekly', title: '家族週報', icon: '📮', desc: '每週一張卡，傳到家族群組', stages: ['baby'], screen: 'weekly', order: 31, group: '紀錄分析', tags: TAGS,
  });
  App.tool({
    id: 'weekly-preg', title: '家族週報', icon: '📮', desc: '孕週與寶寶的變化，每週傳給家人', stages: ['preg'], screen: 'weekly', order: 65, group: '孕期', tags: TAGS,
  });

  App.weekly = {
    weekOf, reportWeek, weekEnd, shiftWeek, rangeText, babyWeek, pregWeek, build, kindNow, spec, text, draw, due, tiles, highlights, ensure,
  };
}());
