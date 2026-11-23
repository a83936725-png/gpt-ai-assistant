/* 團購揪團（第一階段：App 不收款、不收地址）
 * 品牌在伺服器設定團購（mom-api/groupbuy.js，MOM_GROUPBUYS）。媽媽「開一團」拿到團的連結，傳到媽媽群組；朋友打開連結
 * 「我要跟團」；在時間內湊滿人數就成團，每位團員拿到折扣碼，到品牌官網結帳（退換貨、發票依官網規定）。
 * 人數都是伺服器算的真實會員人數；折扣碼成團前不會送到手機；團的頁面只顯示團名、人數與剩下的時間，看不到誰跟了團。
 *   screen 'groupbuy'   限時團購：正在開團的商品（大倒數、幾團開過幾位媽媽參加）、開團、我的團、從連結打開的團
 *                       （還沒設定好 App 的朋友也能先看）；?c=<id> 直接看那一個團購
 *   好孕島 限時團購入口  好孕島左側一排小圖（像遊戲盤面邊上的活動圖示）：成團了／我的團（揪團中）／朋友揪的團（等你）／
 *                       還沒參加的團購（限時），每個都有每秒跳的倒數，點了直接看；‹ 收起來（今天）；放不下就只留 🛒 小頁籤
 *   首頁卡 'groupbuy'    成團了（看折扣碼）／我的團進度／朋友揪的團／有新的團購（範例團購不上首頁）
 *   範例團購             沒有會員服務時（例如網頁預覽版），載入範例資料、或品牌在 config.js 開了 groupbuyPreview：三個標
 *                       「範例」的團購，可以試開團、看倒數、模擬朋友跟團到成團；全部只在這支手機，不會送出，折扣碼也
 *                       不是真的。會員服務只是暫時連不上時不會出現
 *   App.groupbuy = { load, live, listItem, brandCard, pendingTeam, homeItem, islandRail, railItems, endOf, clock } */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const C = window.Core;
  const store = App.store;
  const B = () => window.BRAND || {};
  const enc = encodeURIComponent;

  const ensure = (s) => {
    s.groupbuy = s.groupbuy || {};
    const g = s.groupbuy;
    g.skip = g.skip || {}; // campaign id → day the home card was closed
    g.seen = g.seen || {}; // team id → day its code was first shown
    return g;
  };
  const money = (n) => `NT$${Number(n || 0).toLocaleString('zh-TW')}`;
  const teamName = (t) => `${t.leader || '媽媽'}的團`;
  function leftShort(ms) { // for a share card's number tile: 「1天23時」「5時20分」「12分」
    const d = Math.floor(Math.max(0, ms) / C.DAY); const hh = Math.floor((Math.max(0, ms) % C.DAY) / C.HOUR); const mm = Math.max(1, Math.floor((Math.max(0, ms) % C.HOUR) / C.MIN));
    if (d) return `${d}天${hh}時`;
    return hh ? `${hh}時${mm}分` : `${mm}分`;
  }
  function left(ms) { // 「2 天 4 小時」「3 小時 20 分」「12 分鐘」
    if (ms <= 0) return '時間到了';
    const d = Math.floor(ms / C.DAY); const hh = Math.floor((ms % C.DAY) / C.HOUR); const mm = Math.max(1, Math.floor((ms % C.HOUR) / C.MIN));
    if (d) return `${d} 天${hh ? ` ${hh} 小時` : ''}`;
    if (hh) return `${hh} 小時${mm ? ` ${mm} 分` : ''}`;
    return `${mm} 分鐘`;
  }
  // countdowns on screen tick by themselves (only while one is showing)
  setInterval(() => {
    document.querySelectorAll('[data-gb-until]').forEach((e) => { e.textContent = left(Number(e.dataset.gbUntil) - Date.now()); });
  }, 30 * 1000);

  /* ---------------- 限時: exact ends and countdowns ---------------- */
  const TW = 8 * C.HOUR; // 台灣時間
  const two = (n) => String(n).padStart(2, '0');
  // a group-buy's end as a moment: the server sends it; an older reply had only the day (until the end of that day)
  function endOf(c) {
    if (c && Number.isFinite(c.endsAt)) return c.endsAt;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String((c && c.ends) || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - TW + C.DAY : Date.now() + C.DAY;
  }
  // 「活動到 11/30」 for a whole day, 「活動到 11/23 20:00」 for a set time (Taiwan time)
  function endText(c) {
    const end = new Date(endOf(c) + TW);
    const atMidnight = !end.getUTCHours() && !end.getUTCMinutes();
    const last = atMidnight ? new Date(end.getTime() - 1) : end;
    return `活動到 ${last.getUTCMonth() + 1}/${last.getUTCDate()}${atMidnight ? '' : ` ${two(end.getUTCHours())}:${two(end.getUTCMinutes())}`}`;
  }
  // the countdown on a 首頁 tile: 「19:40:57」 under 3 days (hours go past 24, like 44:41:57), then 「剩 6 天」
  function clock(ms) {
    if (ms <= 0) return '00:00:00';
    if (ms >= 72 * C.HOUR) return `剩 ${Math.floor(ms / C.DAY)} 天`;
    const s = Math.floor(ms / 1000);
    return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  }
  // the 好孕島 column (0.9.4): calm words without seconds — 「剩 3 天」「剩 47 小時」「剩 29 分」. The island is for learning;
  // a game-style clock ticking every second there was one of the things pulling at her (the 正在開團 page keeps its clock)
  function calm(ms) {
    if (ms <= 0) return '時間到了';
    if (ms >= 72 * C.HOUR) return `剩 ${Math.floor(ms / C.DAY)} 天`;
    if (ms >= C.HOUR) return `剩 ${Math.floor(ms / C.HOUR)} 小時`;
    return `剩 ${Math.max(1, Math.floor(ms / C.MIN))} 分`;
  }
  const parts = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }; };
  // the big countdown: 天・時・分・秒 in boxes (天 only while a day or more is left)
  const BIG = [['d', '天'], ['h', '時'], ['m', '分'], ['s', '秒']];
  const bigBoxes = (p) => BIG.filter(([k]) => k !== 'd' || p.d).map(([k, l]) => h('span', { class: 'gb-big-u' }, h('b', { class: `num gb-big-${k}` }, k === 'd' ? String(p.d) : two(p[k])), h('i', null, l)));
  function paintBig(e, ms) {
    const p = parts(ms);
    if (!!p.d !== !!e.querySelector('.gb-big-d')) { e.replaceChildren(...bigBoxes(p)); return; }
    BIG.forEach(([k]) => { const b = e.querySelector(`.gb-big-${k}`); if (b) b.textContent = k === 'd' ? String(p.d) : two(p[k]); });
  }
  const bigCountdown = (end, label) => h('div', {
    class: 'gb-big', role: 'timer', 'aria-label': `${label}還剩 ${left(end - Date.now())}`, dataset: { gbEnd: String(end), gbFmt: 'big' },
  }, ...bigBoxes(parts(end - Date.now())));
  // every countdown on screen ticks each second; the last hour turns red; one that reaches zero asks again what is open
  let zeroAt = 0;
  setInterval(() => {
    const els = document.querySelectorAll('[data-gb-end]');
    if (!els.length) return;
    const now = Date.now();
    els.forEach((e) => {
      const ms = Number(e.dataset.gbEnd) - now;
      if (e.dataset.gbFmt === 'big') paintBig(e, ms); else e.textContent = e.dataset.gbFmt === 'calm' ? calm(ms) : clock(ms);
      e.classList.toggle('soon', ms > 0 && ms < C.HOUR);
      if (ms <= 0 && !e.dataset.gbZero) {
        e.dataset.gbZero = '1';
        if (now - zeroAt > 5000) { zeroAt = now; load(true); } // eslint-disable-line no-use-before-define
      }
    });
  }, 1000);

  /* ---------------- 範例團購: 範例資料 with no member service (the web preview) ---------------- */
  // Three sample group-buys, made fresh around the current time so the countdowns are always running; she can start a
  // team, watch it count down and 「模擬朋友跟團」 until it is full. Everything says 範例, nothing leaves the phone, and
  // the code is not a real one. With a member service (a real setup) these never appear.
  const sampleData = () => { const s = store.state; return s.sampleData === true || (s.sampleData === undefined && !!(s.starter && s.starter.demo)); };
  // the web preview: the brand's config turns the samples on for a site with no member service at all (never while a
  // real service is only unreachable for a moment)
  const preview = () => B().groupbuyPreview === true && !!(App.account && App.account.noService && App.account.noService());
  const isSample = () => sampleData() || preview();
  function sampleCampaigns(now) {
    const tw = new Date(now + TW);
    const day0 = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) - TW; // today 00:00 in Taiwan
    const at = (days, hour) => day0 + days * C.DAY + hour * C.HOUR;
    const base = { sample: true, desc: '範例：正式上線後，商品、價格和時間由品牌設定', image: '', shopUrl: '', codeNote: '' };
    return [
      { ...base, id: 'sample-gift', title: '月子禮盒（範例）', emoji: '🎁', price: 3280, listPrice: 3880, size: 5, hours: 24, endsAt: now < at(0, 20) ? at(0, 22) : at(1, 22), stats: { teams: 4, people: 13, done: 2 } },
      { ...base, id: 'sample-drip', title: '滴雞精 10 入（範例）', emoji: '🍲', price: 1980, listPrice: 2400, size: 3, hours: 48, endsAt: at(2, 20), stats: { teams: 9, people: 22, done: 5 } },
      { ...base, id: 'sample-set', title: '媽媽常備組（範例）', emoji: '🧺', price: 1280, listPrice: 1500, size: 4, hours: 72, endsAt: at(6, 24), stats: { teams: 2, people: 5, done: 0 } },
    ];
  }
  const sampleBox = () => { const g = ensure(store.state); g.sample = g.sample || { teams: {}, mine: {} }; return g.sample; };
  // her sample teams are hers (or ones she joined); another mom's sample team is seen from outside until she joins it
  function sampleView(t, now, outside = false) {
    const status = t.doneAt ? 'done' : (now >= t.endsAt ? 'failed' : 'open');
    const mine = !outside && t.mine !== false;
    return {
      ...t, status, member: !outside, mine, pub: mine ? !!t.pub : undefined, ...(status === 'done' && !outside ? { code: 'SAMPLE-0000', codeNote: '範例折扣碼，不能真的使用', shopUrl: '' } : {}),
    };
  }
  // 即時團購 in the samples: other moms' public teams (a new one comes when one's time is up) and what just happened
  const SAMPLE_OPEN = [ // [group-buy, team name, how many so far, time left]
    ['sample-gift', '阿芳', 4, 100 * C.MIN], ['sample-gift', '小雅', 2, 6 * C.HOUR + 5 * C.MIN],
    ['sample-drip', 'Yuki', 1, 5 * C.HOUR + 12 * C.MIN], ['sample-drip', '佩佩', 1, 30 * C.HOUR],
    ['sample-set', '婷婷', 2, 50 * C.HOUR],
  ];
  function sampleLive(now, box, camps) {
    box.live = box.live || {};
    SAMPLE_OPEN.forEach(([cid, name, count, dur], i) => {
      const c = camps.find((x) => x.id === cid);
      const cur = Object.values(box.live).find((t) => t.slot === i);
      if (!c || (cur && cur.endsAt > now)) return;
      if (cur) delete box.live[cur.id];
      const id = `sample-live-${i}-${Math.floor(now / 1000).toString(36)}`;
      box.live[id] = {
        id, slot: i, campaign: cid, leader: name, count, size: c.size, endsAt: Math.min(now + dur, c.endsAt), mine: false,
      };
    });
    if (!box.feed || now - box.feed.at > 6 * C.HOUR) {
      const ev = (kind, cid, leader, count, size, min) => ({
        kind, cid, leader, count, size, at: now - min * C.MIN,
      });
      box.feed = {
        at: now,
        items: [ev('join', 'sample-gift', '阿芳', 4, 5, 2), ev('done', 'sample-drip', '欣欣', 3, 3, 9), ev('start', 'sample-gift', '小雅', 1, 5, 16),
          ev('start', 'sample-drip', 'Yuki', 1, 3, 27), ev('start', 'sample-set', '婷婷', 1, 4, 44)],
      };
    }
    const out = {};
    camps.forEach((c) => {
      const list = Object.values(box.live).filter((t) => t.campaign === c.id && !t.joined && t.count < t.size && t.endsAt > now)
        .map((t) => ({
          id: t.id, leader: t.leader, count: t.count, size: t.size, endsAt: t.endsAt,
        }))
        .sort((a, b) => (a.size - a.count) - (b.size - b.count) || a.endsAt - b.endsAt);
      const recent = box.feed.items.filter((e) => e.cid === c.id && e.at > now - C.DAY).sort((a, b) => b.at - a.at).map((e) => ({
        kind: e.kind, leader: e.leader, count: e.count, size: e.size, at: e.at,
      }));
      out[c.id] = { teams: list, total: list.length, recent };
    });
    return out;
  }
  async function sampleCall(m, path, body = {}) {
    const now = Date.now();
    const box = sampleBox();
    const camps = sampleCampaigns(now);
    const campOf = (id) => camps.find((c) => c.id === id) || null;
    const fail = (status, code) => { const e = new Error(code); e.status = status; e.code = code; throw e; };
    const tm = /^groupbuy\/team\/([\w-]+)(?:\/(join|leave|public))?$/.exec(path);
    let out = null;
    if (m === 'GET' && path === 'groupbuy/live') out = { live: sampleLive(now, box, camps) };
    else if (m === 'GET' && path === 'groupbuy') {
      const mine = {};
      Object.entries(box.mine).forEach(([cid, id]) => { const t = box.teams[id]; if (t && campOf(cid) && sampleView(t, now).status !== 'failed') mine[cid] = sampleView(t, now); });
      out = { campaigns: camps, mine };
    } else if (m === 'POST' && path === 'groupbuy/start') {
      const c = campOf(body.campaign);
      if (!c) fail(404, 'no_campaign');
      const cur = box.teams[box.mine[c.id]];
      if (cur && sampleView(cur, now).status !== 'failed') fail(409, 'in_team');
      const t = {
        id: `sample-${C.uid()}`, campaign: c.id, leader: (String(body.name || '').trim() || store.state.profile.momName || '媽媽').slice(0, 10), count: 1, size: c.size, endsAt: Math.min(now + c.hours * C.HOUR, c.endsAt), doneAt: null, pub: body.public === true,
      };
      box.teams[t.id] = t; box.mine[c.id] = t.id;
      out = { team: sampleView(t, now) };
    } else if (tm) {
      const other = !box.teams[tm[1]] && box.live && box.live[tm[1]] && !box.live[tm[1]].joined ? box.live[tm[1]] : null; // another mom's
      const t = box.teams[tm[1]] || other;
      if (!t) fail(404, 'not_found');
      if (m === 'GET' && !tm[2]) out = { team: sampleView(t, now, !!other), campaign: campOf(t.campaign), active: !!campOf(t.campaign) };
      else if (m === 'POST' && tm[2] === 'join' && other) { // she joins another mom's sample team from 正在揪的團
        const cur = box.teams[box.mine[t.campaign]];
        if (cur && sampleView(cur, now).status !== 'failed') fail(409, 'in_team');
        if (t.count >= t.size || now >= t.endsAt) fail(409, 'closed');
        const mineNow = {
          ...t, mine: false, count: t.count + 1, doneAt: null,
        };
        if (mineNow.count >= mineNow.size) mineNow.doneAt = now;
        t.joined = true; box.teams[t.id] = mineNow; box.mine[t.campaign] = t.id;
        box.feed.items.push({
          kind: mineNow.doneAt ? 'done' : 'join', cid: t.campaign, leader: t.leader, count: mineNow.count, size: t.size, at: now,
        });
        out = { team: sampleView(mineNow, now), done: !!mineNow.doneAt };
      } else if (m === 'POST' && tm[2] === 'join') { // a team she is in: 「模擬朋友跟團」 adds one friend
        if (sampleView(t, now).status !== 'open') fail(409, 'closed');
        t.count = Math.min(t.size, t.count + 1);
        if (t.count >= t.size) t.doneAt = now;
        out = { team: sampleView(t, now), done: !!t.doneAt };
      } else if (m === 'POST' && tm[2] === 'public' && t.mine !== false && !other) {
        t.pub = body.public === true;
        out = { team: sampleView(t, now) };
      } else if (m === 'POST' && tm[2] === 'leave') {
        delete box.teams[t.id];
        if (box.mine[t.campaign] === t.id) delete box.mine[t.campaign];
        out = { ok: true };
      }
    }
    if (!out) fail(404, 'not_found');
    store.save();
    return JSON.parse(JSON.stringify(out));
  }

  /* ---------------- data from the member service ---------------- */
  let live = null; // {at, campaigns, mine, sample}
  let loading = null;
  const teams = new Map(); // team id → {at, team, campaign, active} or {at, gone: true}
  // what is open, if known and still about the same data (範例資料 loaded or cleared since → ask again, show nothing yet)
  const current = () => { if (!live || live.flag !== isSample()) { load(); return null; } return live; }; // eslint-disable-line no-use-before-define
  // the sample ones while 範例資料 is on and no member service answers; otherwise the member service
  const sampleOn = async () => isSample() && !(await App.account.config());
  const call = async (m, p, b) => ((await sampleOn()) ? sampleCall(m, p, b) : App.account.call(m, p, b));
  // logged in; or, with the sample group-buys, she is a sample member already
  function user() {
    return (store.state.auth && store.state.auth.user) || (live && live.sample ? { id: 'sample', nickname: store.state.profile.momName || '', sample: true } : null);
  }
  function load(force = false) {
    if (!App.account) return Promise.resolve(null);
    // asked again after a minute, or at once when 範例資料 was loaded or cleared
    if (!force && live && Date.now() - live.at < 60 * 1000 && live.flag === isSample()) return Promise.resolve(live);
    if (!loading) {
      loading = (async () => {
        const before = JSON.stringify(live && { c: live.campaigns, m: live.mine });
        try {
          const cfg = await App.account.config();
          const sample = !cfg && isSample();
          const r = cfg || sample ? await call('GET', 'groupbuy') : null;
          live = {
            at: Date.now(), campaigns: (r && r.campaigns) || [], mine: (r && r.mine) || {}, sample, flag: isSample(),
          };
        } catch (e) {
          live = {
            at: Date.now(), campaigns: (live && live.campaigns) || [], mine: (live && live.mine) || {}, sample: !!(live && live.sample), flag: isSample(),
          };
        }
        loading = null;
        // something changed: the screens that show it are drawn again
        if (JSON.stringify({ c: live.campaigns, m: live.mine }) !== before) {
          const scr = document.body.dataset.screen;
          if (scr === 'home' && App.homeRefresh) App.homeRefresh();
          else if (scr === 'island') syncRail(); // eslint-disable-line no-use-before-define
          else if (['groupbuy', 'me', 'brand'].includes(scr)) App.refresh();
        }
        return live;
      })();
    }
    return loading;
  }
  /* ---------------- 即時團購: other moms' public teams still open, and what just happened ---------------- */
  let liveTeams = null; // { at, byC: { [group-buy id]: { teams, total, recent } } }
  let liveLoading = null;
  function loadLive(force = false) {
    if (!App.account) return Promise.resolve(null);
    if (!force && liveTeams && Date.now() - liveTeams.at < 12 * 1000) return Promise.resolve(liveTeams);
    if (!liveLoading) {
      liveLoading = (async () => {
        const before = JSON.stringify(liveTeams && liveTeams.byC);
        try {
          const cfg = await App.account.config();
          const r = cfg || isSample() ? await call('GET', 'groupbuy/live') : null;
          liveTeams = { at: Date.now(), byC: (r && r.live) || {} };
        } catch (e) { liveTeams = { at: Date.now(), byC: (liveTeams && liveTeams.byC) || {} }; }
        liveLoading = null;
        if (JSON.stringify(liveTeams.byC) !== before) paintLive(); // eslint-disable-line no-use-before-define
        return liveTeams;
      })();
    }
    return liveLoading;
  }
  // while 正在開團 or 好孕島 is on screen, the list is asked for again every 15 seconds
  setInterval(() => {
    const scr = document.body.dataset.screen;
    if (document.visibilityState === 'visible' && (scr === 'island' || (scr === 'groupbuy' && document.querySelector('.gb-deal')))) loadLive(true);
  }, 15 * 1000);
  async function loadTeam(id, force = false) {
    const c = teams.get(id);
    if (c && !force && Date.now() - c.at < 20 * 1000) return c;
    try {
      const r = await call('GET', `groupbuy/team/${enc(id)}`);
      const v = { at: Date.now(), team: r.team, campaign: r.campaign, active: r.active };
      teams.set(id, v);
      return v;
    } catch (e) {
      const v = { at: Date.now(), gone: e.status === 404, error: e.code || 'offline' };
      teams.set(id, v);
      return v;
    }
  }
  const campaignOf = (id) => (live && live.campaigns.find((c) => c.id === id)) || null;
  const myTeam = (cid) => (live && live.mine[cid]) || null;
  // after logging in from a friend's team link, come back to that team
  const pendingTeam = () => {
    const p = ensure(store.state).pending;
    return p && p.team && Date.now() - new Date(p.at).getTime() < 3 * C.DAY ? p.team : null;
  };
  // (once: a later login goes to 首頁 as usual, where the team still has its card until she joins)
  App.afterLogin = () => {
    const t = pendingTeam(); const p = ensure(store.state).pending;
    if (!t || p.back) return null;
    p.back = true; store.save();
    return { id: 'groupbuy', params: { team: t } };
  };
  setTimeout(() => load(), 1200);

  /* ---------------- actions ---------------- */
  const ERR = {
    unauthorized: '請先登入會員',
    need_consent: '請先同意隱私權政策與使用條款',
    need_verify: '請先驗證你的 Email／手機',
    no_campaign: '這個團購已經結束了',
    in_team: '你已經在這個團購的另一團了',
    full: '這一團剛好滿了，可以自己開一團',
    closed: '這一團時間到了',
    busy: '處理中，請稍候',
    too_many: '操作太多次了，請稍後再試',
    too_many_here: '同一個網路跟這一團的人數已經到上限了',
    leader_stays: '已經有朋友跟團，開團的人不能退出',
    not_found: '找不到這一團，可能已經取消了',
  };
  const errText = (e) => ERR[e.code] || '目前連不到會員服務，請稍後再試';
  function needLogin(teamId) {
    if (teamId) store.update((s) => { ensure(s).pending = { team: teamId, at: new Date().toISOString() }; });
    if (App.account.openRegister) App.account.openRegister(); else App.navigate('login');
  }
  function startSheet(c) {
    const u = user();
    if (!u) { needLogin(null); return; }
    const name = h('input', {
      type: 'text', class: 'input', maxlength: 10, value: (u.nickname || store.state.profile.momName || '').slice(0, 10), 'aria-label': '團名',
    });
    const err = h('p', { class: 'login-err', hidden: true, role: 'alert' });
    const go = h('button', {
      class: 'btn btn-primary btn-block gb-start-go',
      onclick: async () => {
        go.disabled = true; err.hidden = true;
        try {
          const r = await call('POST', 'groupbuy/start', { campaign: c.id, name: name.value, public: pub.checked });
          sheet.close();
          await load(true);
          teams.set(r.team.id, { at: Date.now(), team: r.team, campaign: c, active: true });
          App.navigate('groupbuy', { team: r.team.id });
          ui.celebrate({ emojis: ['🛒', '🎉', '💜', '✨'] });
          if (live && live.sample) ui.toast('開團成功（範例）！可以按「模擬朋友跟團」看成團');
          else { ui.toast('開團成功！把連結傳給朋友'); setTimeout(() => invite(r.team, c), 450); }
        } catch (e) {
          go.disabled = false;
          if (e.code === 'in_team' && e.status === 409) { sheet.close(); await load(true); const t = myTeam(c.id); if (t) App.navigate('groupbuy', { team: t.id }); return; }
          if (e.code === 'need_consent' && App.account.ensureConsent) { sheet.close(); App.account.ensureConsent(user()); return; }
          if (e.code === 'need_verify' && App.account.verifySheet) { sheet.close(); App.account.verifySheet('參加團購前，先驗證你的 Email／手機。'); return; }
          err.textContent = errText(e); err.hidden = false;
        }
      },
    }, '開團');
    // in 正在開團 other moms can join it right there (only its name, how many and the time left); the brand sets the default
    const pub = h('input', { type: 'checkbox', class: 'gb-pub-check', checked: B().groupbuyPublicDefault !== false });
    // a team never runs past the group-buy's end
    const capped = Date.now() + c.hours * C.HOUR > endOf(c);
    const step = (ico, b, sub) => h('li', null, h('span', { class: 'gb-os-ico', 'aria-hidden': 'true' }, ico), h('b', null, b), h('span', { class: 'tiny muted' }, sub));
    const sheet = ui.sheet({
      title: '開一團',
      body: h('div', { class: 'stack-sm gb-open' },
        h('div', { class: 'row gap gb-open-head' }, pic(c),
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, c.title, demoTag(c)), priceRow(c))),
        h('ol', { class: 'gb-open-steps' },
          step('🛒', '開團', '現在'),
          step('💬', '邀朋友', `${capped ? '活動結束前' : `${c.hours} 小時內`}湊 ${c.size} 人`),
          step('🎉', '成團', '每人拿折扣碼')),
        ui.field('團名', name, '朋友打開連結會看到「○○的團」和人數，看不到你的帳號或電話'),
        h('label', { class: 'gb-pub' }, pub, h('span', { class: 'small' }, h('b', null, '公開這一團'), '：其他媽媽在「正在開團」看得到，可以直接跟團（只顯示團名、人數和剩下的時間；之後也能改）')),
        h('p', { class: 'small muted' }, `${c.size} 人成團，開團後 ${c.hours} 小時內要湊齊${capped ? `（這個團購${endText(c)}，這一團最晚也到那時）` : ''}；成團後每個人都拿到折扣碼，到官網結帳。`),
        live && live.sample ? h('p', { class: 'tiny muted' }, '這是範例團購：開團只存在這支手機，不會送出。') : null,
        err),
      footer: go,
    });
  }
  async function join(team, btn) {
    if (!user()) { needLogin(team.id); return false; }
    btn.disabled = true;
    try {
      const r = await call('POST', `groupbuy/team/${enc(team.id)}/join`, {});
      store.update((s) => { delete ensure(s).pending; }); // joined: nothing left to come back to
      // (joined from 正在揪的團, the team page has not been opened yet: it needs its group-buy too)
      const prev = teams.get(team.id) || {};
      teams.set(team.id, {
        ...prev, at: Date.now(), team: r.team, campaign: prev.campaign || campaignOf(r.team.campaign), active: prev.active !== undefined ? prev.active : true,
      });
      await load(true);
      if (r.done) { ui.celebrate({ emojis: ['🎉', '🛒', '💜', '✨'], big: true }); ui.toast('🎉 成團了！折扣碼在下面'); } else ui.toast(`跟團成功！還差 ${r.team.size - r.team.count} 人`);
      loadLive(true); // eslint-disable-line no-use-before-define
      App.refresh();
      return true;
    } catch (e) {
      btn.disabled = false;
      if (e.code === 'need_consent' && App.account.ensureConsent) { App.account.ensureConsent(user()); return false; }
      if (e.code === 'need_verify' && App.account.verifySheet) { App.account.verifySheet('參加團購前，先驗證你的 Email／手機。'); return false; }
      ui.toast(errText(e));
      if (['full', 'closed', 'in_team'].includes(e.code)) { teams.delete(team.id); await load(true); loadLive(true); App.refresh(); } // eslint-disable-line no-use-before-define
      return false;
    }
  }
  async function leave(team) {
    if (!(await ui.confirm(`退出「${teamName(team)}」？`, { ok: '退出' }))) return;
    try {
      await call('POST', `groupbuy/team/${enc(team.id)}/leave`, {});
      teams.delete(team.id);
      await load(true);
      ui.toast('已退出這一團');
      App.navigate('groupbuy');
    } catch (e) { ui.toast(errText(e)); }
  }
  const linkFor = (team, channel) => App.share.link({ path: 'groupbuy', params: { team: team.id }, channel, campaign: 'groupbuy' });
  function inviteText(team, c) {
    const need = Math.max(0, team.size - team.count);
    return `${teamName(team)}揪團中：${c.title}\n團購價 ${money(c.price)}${c.listPrice ? `（原價 ${money(c.listPrice)}）` : ''}・${c.size} 人成團${need ? `，還差 ${need} 人` : ''}\n湊齊後每個人都拿到折扣碼，到官網結帳 🛒`;
  }
  const sampleNoShare = () => { if (!(live && live.sample)) return false; ui.toast('這是範例團購，正式上線後才能邀請朋友'); return true; };
  function invite(team, c) {
    if (sampleNoShare()) return;
    App.share.open({
      sheetTitle: '邀請朋友跟團',
      title: `${teamName(team)}揪團中`,
      text: inviteText(team, c),
      path: 'groupbuy',
      params: { team: team.id },
      campaign: 'groupbuy',
      spec: {
        emoji: c.emoji || '🛒',
        kicker: `團購揪團・${teamName(team)}`,
        title: c.title,
        subtitle: `團購價 ${money(c.price)}${c.listPrice ? `（原價 ${money(c.listPrice)}）` : ''}`,
        stats: [{ v: `${team.count}/${team.size}`, l: '已跟團' }, { v: leftShort(team.endsAt - Date.now()), l: '剩下' }],
        lines: ['掃 QR 或點連結就能跟團', '湊齊後每個人都拿到折扣碼', '到官網結帳，App 不收款'],
        theme: 'peach',
      },
    });
  }
  function lineInvite(team, c) {
    if (sampleNoShare()) return;
    window.open(`https://line.me/R/share?text=${enc(`${inviteText(team, c)}\n${linkFor(team, 'line')}`)}`, '_blank', 'noopener');
    App.share.record('line', 'groupbuy');
  }

  /* ---------------- pieces ---------------- */
  const pic = (c, emoji) => (c.image ? h('img', { class: 'gb-img', src: c.image, alt: '', loading: 'lazy' }) : h('span', { class: 'gb-emoji', 'aria-hidden': 'true' }, emoji || c.emoji || '🛒'));
  const priceRow = (c) => h('div', { class: 'gb-price' },
    h('span', { class: 'gb-price-now' }, h('span', { class: 'tiny' }, '團購價 '), money(c.price)),
    c.listPrice ? h('span', { class: 'gb-price-was' }, '原價 ', h('s', null, money(c.listPrice))) : null);
  const endDay = (c) => C.fmtDate(c.ends);
  function progressBlock(team) {
    const need = Math.max(0, team.size - team.count);
    return h('div', { class: 'gb-progress' },
      h('div', { class: 'row between' },
        h('b', { class: 'gb-count' }, `已 ${team.count}／${team.size} 人`),
        team.status === 'open' ? h('span', { class: 'small muted' }, need ? `還差 ${need} 人就成團` : '人數到了') : null),
      ui.progress(team.count / team.size),
      team.status === 'open' ? h('div', { class: 'gb-team-clock' }, h('div', { class: 'small muted' }, '這一團還剩'), bigCountdown(team.endsAt, '這一團')) : null);
  }
  function codeBox(team, c) {
    const copy = h('button', {
      class: 'btn btn-soft gb-copy',
      onclick: async () => { const okc = await App.share.copyText(team.code); ui.toast(okc ? '已複製折扣碼' : '複製失敗，請長按折扣碼'); },
    }, '複製折扣碼');
    return h('div', { class: 'gb-code-box' },
      h('div', { class: 'small' }, '你的折扣碼'),
      h('div', { class: 'gb-code num', 'aria-label': `折扣碼 ${team.code.split('').join(' ')}` }, team.code),
      team.codeNote ? h('div', { class: 'tiny muted' }, team.codeNote) : null,
      h('div', { class: 'row gap-sm wrap mt' }, copy,
        team.shopUrl || c.shopUrl ? h('a', { class: 'btn btn-primary grow gb-shop', href: team.shopUrl || c.shopUrl, target: '_blank', rel: 'noopener' }, '到官網結帳') : null),
      h('p', { class: 'tiny muted' }, '結帳、出貨、退換貨與發票都在官網，依官網規定。'));
  }
  const fine = () => h('p', { class: 'disclaimer' }, '團購在品牌官網結帳：App 不收款、不收地址。人數是真實的會員人數；團的頁面只顯示團名、人數和剩下的時間。折扣碼只給成團的團員，使用規則以官網為準。');
  const demoTag = (c) => (c.demo ? h('span', { class: 'tag warn' }, '測試環境') : c.sample ? h('span', { class: 'tag' }, '範例') : null);

  /* ---------------- 即時: 正在揪的團 and what just happened ---------------- */
  // other moms' public teams in this group-buy (not her own), the closest to full first; 跟團 right there
  function openRow(t, c, inOne) {
    const need = t.size - t.count;
    return h('div', { class: 'gb-open-row' },
      h('button', {
        type: 'button', class: 'gb-open-main', onclick: () => App.navigate('groupbuy', { team: t.id }),
        'aria-label': `${teamName(t)}，已 ${t.count}／${t.size} 人，還差 ${need} 人，還剩 ${left(t.endsAt - Date.now())}`,
      },
      h('span', { class: 'gb-open-top' }, h('b', { class: 'gb-open-name' }, teamName(t)),
        need === 1 ? h('span', { class: 'gb-need1', 'aria-hidden': 'true' }, '差 1 人') : h('span', { class: 'small muted', 'aria-hidden': 'true' }, `還差 ${need} 人`)),
      h('span', { class: 'gb-open-bar', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.round((t.count / t.size) * 100)}%` } })),
      h('span', { class: 'gb-open-sub small muted', 'aria-hidden': 'true' }, `${t.count}／${t.size} 人・剩 `, h('span', { class: 'num', dataset: { gbEnd: String(t.endsAt) } }, clock(t.endsAt - Date.now())))),
      inOne ? null : h('button', {
        type: 'button', class: 'btn btn-primary btn-sm gb-open-join', 'aria-label': `跟${teamName(t)}`,
        onclick: async (e) => { if (await join(t, e.currentTarget)) App.navigate('groupbuy', { team: t.id }); },
      }, '跟團'));
  }
  function fillOpen(box) {
    const c = campaignOf(box.dataset.c);
    const L = c && liveTeams && liveTeams.byC[c.id];
    const mine = c && myTeam(c.id);
    const list = L ? L.teams.filter((t) => !mine || t.id !== mine.id) : [];
    box.replaceChildren();
    box.hidden = !list.length;
    if (!list.length) return;
    const all = box.dataset.all === '1';
    box.append(...[ // (a DOM append would write out a null)
      h('div', { class: 'gb-open-head' }, h('span', { class: 'gb-live-dot', 'aria-hidden': 'true' }), h('b', null, '正在揪的團'),
        h('span', { class: 'tiny muted' }, `${list.length} 團・人數即時更新${c.sample ? '（範例）' : ''}`)),
      ...(all ? list : list.slice(0, 3)).map((t) => openRow(t, c, !!mine)),
      list.length > 3 ? h('button', {
        type: 'button', class: 'link-btn small gb-open-more', onclick: () => { box.dataset.all = all ? '' : '1'; fillOpen(box); },
      }, all ? '收起' : `看全部 ${list.length} 團`) : null,
    ].filter(Boolean));
  }
  const openBox = (c) => { const box = h('div', { class: 'gb-open', dataset: { c: c.id } }); fillOpen(box); return box; };
  // what just happened, across the group-buys, newest first: one line at a time
  function feedItems() {
    if (!liveTeams || !live) return [];
    const out = [];
    live.campaigns.forEach((c) => { const L = liveTeams.byC[c.id]; if (L) L.recent.forEach((e) => out.push({ ...e, c })); });
    return out.sort((a, b) => b.at - a.at).slice(0, 8);
  }
  const feedText = (e) => `${e.kind === 'done' ? `${e.leader}的團成團了 🎉` : e.kind === 'join' ? `有人跟了${e.leader}的團（${e.count}／${e.size}）` : `${e.leader}開了一團`}・${e.c.title}・${C.ago(new Date(e.at).toISOString())}`;
  let feedAt = 0;
  function fillFeed(box) {
    const items = feedItems();
    box.hidden = !items.length;
    if (!items.length) { box.replaceChildren(); return; }
    box.replaceChildren(h('span', { class: 'gb-feed-tag' }, h('span', { class: 'gb-live-dot', 'aria-hidden': 'true' }), '即時'),
      h('span', { class: 'gb-feed-text' }, feedText(items[feedAt % items.length])));
  }
  // the next line every 4 seconds, counted from when the line was put up (a shared clock running since the app opened
  // sometimes swapped the newest line away a moment after the page appeared)
  let feedTimer = 0;
  const restartFeed = () => {
    clearInterval(feedTimer);
    feedTimer = setInterval(() => {
      const boxes = document.querySelectorAll('.gb-feed:not([hidden])');
      if (!boxes.length) return;
      feedAt += 1;
      boxes.forEach((b) => { const items = feedItems(); const tx = b.querySelector('.gb-feed-text'); if (tx && items.length) tx.textContent = feedText(items[feedAt % items.length]); });
    }, 4000);
  };
  restartFeed();
  // new numbers in: only those parts change (the page keeps its place); something new happened → that line first
  function paintLive() {
    feedAt = 0; restartFeed();
    document.querySelectorAll('.gb-open[data-c]').forEach(fillOpen);
    document.querySelectorAll('.gb-feed').forEach(fillFeed);
    if (document.body.dataset.screen === 'island') syncRail(); // eslint-disable-line no-use-before-define
  }

  /* ---------------- screen ---------------- */
  // 「正在開團」: every group-buy open now, the one ending soonest first, each with its own big countdown
  function statLine(c) {
    const st = c.stats;
    const from = Number.isFinite(B().groupbuyStatsFrom) ? B().groupbuyStatsFrom : 3; // real totals, shown once they are not tiny
    if (!st || st.people < from) return null;
    return h('div', { class: 'gb-stats small' }, h('span', { class: 'gb-live-dot', 'aria-hidden': 'true' }),
      h('span', null, `${st.teams} 團開過・${st.people} 位媽媽參加${st.done ? `・${st.done} 團已成團` : ''}`),
      c.sample ? h('span', { class: 'tiny muted' }, '（範例數字）') : null);
  }
  function dealCard(c, focus) {
    const mine = myTeam(c.id);
    const end = endOf(c);
    const save = c.listPrice ? c.listPrice - c.price : 0;
    return ui.card({ class: `gb-card gb-deal${focus ? ' focus' : ''}`, id: `gb-c-${c.id}`, dataset: { c: c.id } },
      h('div', { class: 'row gap gb-card-top' }, pic(c),
        h('div', { class: 'grow' }, h('div', { class: 'card-title' }, c.title, demoTag(c)), c.desc ? h('div', { class: 'small muted' }, c.desc) : null)),
      h('div', { class: 'gb-deal-price' }, priceRow(c), save > 0 ? h('span', { class: 'gb-save' }, `省 ${money(save)}`) : null),
      h('div', { class: 'gb-deal-clock' }, h('div', { class: 'small muted' }, '距離團購結束'), bigCountdown(end, '這個團購')),
      h('div', { class: 'small muted gb-meta' }, `${c.size} 人成團・開團後 ${c.hours} 小時內湊齊・${endText(c)}`),
      statLine(c),
      openBox(c),
      mine ? h('button', { class: 'gb-mine', onclick: () => App.navigate('groupbuy', { team: mine.id }) },
        h('span', { class: 'grow' }, h('b', null, mine.status === 'done' ? '🎉 你的團成團了' : `${teamName(mine)}・已 ${mine.count}／${mine.size} 人`),
          h('span', { class: 'small muted' }, mine.status === 'done' ? '看折扣碼' : [live && live.sample ? '看我的團' : '邀請朋友跟團', '・剩 ', h('span', { class: 'num', dataset: { gbEnd: String(mine.endsAt) } }, clock(mine.endsAt - Date.now()))])),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))
        : h('button', { class: 'btn btn-primary btn-block gb-start', onclick: () => startSheet(c) }, user() ? '🛒 我要開一團' : '🛒 登入後開一團'));
  }
  // under the hero: what just happened (a new line every few seconds)
  const feedBox = () => { feedAt = 0; restartFeed(); const box = h('div', { class: 'gb-feed', hidden: true }); fillFeed(box); return box; };
  function renderList(el, params = {}) {
    el.append(ui.card({ class: 'card-hero gb-hero' },
      h('div', { class: 'gb-hero-top small' }, h('span', { class: 'gb-live-dot', 'aria-hidden': 'true' }), '限時團購・一起買比較划算'),
      h('div', { class: 'big-num' }, '正在開團'),
      h('p', { class: 'small' }, '開一團、把連結傳到媽媽群組，時間內湊滿人數就成團，每個人都拿到折扣碼，到官網結帳。')));
    if (!current()) { el.append(h('p', { class: 'center muted mt', role: 'status' }, '載入中…')); return; }
    loadLive();
    el.append(feedBox());
    if (!live.campaigns.length) {
      el.append(ui.empty('groupbuy', '目前沒有進行中的團購。有新的團購時，會出現在這裡和首頁。'));
      el.append(fine());
      return;
    }
    if (live.sample) {
      el.append(h('div', { class: 'gb-sample-note small' }, h('b', null, '這些是範例團購'),
        '：看看倒數和開團的樣子，可以試開團、模擬朋友跟團。正式上線後，商品、價格和時間由品牌設定，開團和跟團都是真的會員。'));
    }
    const focus = params.c && live.campaigns.some((c) => c.id === params.c) ? params.c : null;
    [...live.campaigns].sort((a, b) => endOf(a) - endOf(b)).forEach((c) => el.append(dealCard(c, c.id === focus)));
    el.append(howTo(), fine());
    // from a 首頁 tile: that group-buy comes into view, with a short glow
    if (focus) {
      requestAnimationFrame(() => {
        const card = document.getElementById(`gb-c-${focus}`);
        if (card) card.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      });
    }
  }
  const howTo = () => ui.card({ class: 'soft gb-how pic-intro' }, ui.pic('groupbuy', 84),
    h('div', { class: 'grow' },
      h('div', { class: 'card-title' }, '怎麼揪團'),
      h('ol', { class: 'gb-steps small' },
        h('li', null, '開一團，或跟朋友的團'),
        h('li', null, '連結傳到 LINE 群組'),
        h('li', null, '湊滿人數，每人拿折扣碼'),
        h('li', null, '到官網結帳時輸入'))));

  // her own open team: shown in 正在開團 (other moms can join it there) or only through her link
  function pubSwitch(team) {
    return h('label', { class: 'gb-pub-row' },
      h('span', { class: 'grow' }, h('b', null, '公開在「正在開團」'), h('span', { class: 'small muted' }, '其他媽媽看得到團名、人數和剩下的時間，可以直接跟團')),
      h('input', {
        type: 'checkbox', class: 'switch', checked: !!team.pub, 'aria-label': '公開在正在開團',
        onchange: async (e) => {
          const want = e.target.checked; e.target.disabled = true;
          try {
            const r = await call('POST', `groupbuy/team/${enc(team.id)}/public`, { public: want });
            teams.set(team.id, { ...(teams.get(team.id) || {}), at: Date.now(), team: r.team });
            ui.toast(want ? '已公開：其他媽媽在「正在開團」看得到這一團' : '已取消公開：只有拿到連結的朋友看得到');
            loadLive(true);
          } catch (err) { e.target.checked = !want; ui.toast(errText(err)); }
          e.target.disabled = false;
        },
      }));
  }
  let viewing = null; // the team on screen
  let navSeen = -1; // App._navCount when it was drawn: a new visit (not a redraw) always asks the server again
  // the page is drawn again only when something changed, so asking never loops
  function refreshTeam(id) {
    const before = JSON.stringify((teams.get(id) || {}).team || null);
    return loadTeam(id, true).then((v) => {
      if (viewing === id && document.body.dataset.screen === 'groupbuy' && JSON.stringify(v.team || null) !== before) App.refresh();
    });
  }
  // while a team is open on screen, friends joining show up by themselves
  setInterval(() => { if (viewing && document.body.dataset.screen === 'groupbuy' && document.visibilityState === 'visible') refreshTeam(viewing); }, 15 * 1000);
  function renderTeam(el, id) {
    viewing = id;
    const cached = teams.get(id);
    const arrived = App._navCount !== navSeen;
    navSeen = App._navCount;
    if (!cached || arrived || Date.now() - cached.at > 15 * 1000) {
      if (!cached) el.append(h('p', { class: 'center muted mt-lg', role: 'status' }, '載入這一團…'));
      refreshTeam(id);
      if (!cached) return;
    }
    if (!cached.gone && !cached.error && !cached.campaign) { el.append(h('p', { class: 'center muted mt-lg', role: 'status' }, '載入這一團…')); refreshTeam(id); return; }
    if (cached.gone || cached.error) {
      el.append(ui.empty('groupbuy', cached.gone ? '找不到這一團，可能已經取消了。' : '目前連不到會員服務，請稍後再試。',
        h('button', { class: 'btn btn-primary', onclick: () => App.navigate('groupbuy') }, '看看其他團購')));
      return;
    }
    const { team, campaign: c } = cached;
    const u = user();
    const mine = myTeam(c.id);
    // remembered quietly (no redraw in the middle of drawing): the team to come back to after logging in, and that
    // this team's code has been seen (the 首頁 card then stops pointing at it)
    const g = ensure(store.state);
    if (!u && team.status === 'open' && (!g.pending || g.pending.team !== id)) { g.pending = { team: id, at: new Date().toISOString() }; store.save(); }
    if (team.status === 'done' && team.member && !g.seen[team.id]) { g.seen[team.id] = C.dateKey(); store.save(); }
    const head = ui.card({ class: 'gb-team' },
      h('div', { class: 'row gap gb-card-top' },
        h('span', { class: 'gb-emoji', 'aria-hidden': 'true' }, team.status === 'done' ? '🎉' : (c.emoji || '🛒')),
        h('div', { class: 'grow' }, h('div', { class: 'small muted' }, teamName(team), demoTag(c)), h('div', { class: 'card-title' }, c.title))),
      priceRow(c),
      progressBlock(team),
      // 步驟條: 開團 → 湊人數 → 成團 → 官網結帳 (a team that ran out of time has none)
      team.status === 'failed' ? null : h('div', { class: 'gb-steps-now' }, ui.steps(['開團', '湊人數', '成團', '官網結帳'], team.status === 'done' ? (team.member ? 3 : 2) : 1)));
    el.append(head);
    const actions = h('div', { class: 'gb-actions' });
    if (team.status === 'open' && team.member && live && live.sample) {
      // a sample team: see what happens when friends join, one at a time
      actions.append(h('button', {
        class: 'btn btn-soft btn-block gb-sim',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          const r = await call('POST', `groupbuy/team/${enc(team.id)}/join`, {});
          teams.set(team.id, { ...(teams.get(team.id) || {}), at: Date.now(), team: r.team });
          await load(true);
          if (r.done) { ui.celebrate({ emojis: ['🎉', '🛒', '💜', '✨'], big: true }); ui.toast('🎉 成團了！（範例）折扣碼在下面'); } else ui.toast(`有朋友跟團了（範例）！還差 ${r.team.size - r.team.count} 人`);
          App.refresh();
        },
      }, '範例：模擬一位朋友跟團'));
    }
    if (team.status === 'done') {
      if (team.member && team.code) actions.append(h('p', { class: 'gb-done' }, live && live.sample ? '🎉 成團了！（範例）' : '🎉 成團了！謝謝大家'), codeBox(team, c));
      else actions.append(h('p', { class: 'gb-done' }, '這一團已經成團了 🎉'), cached.active && !mine ? h('button', { class: 'btn btn-primary btn-block', onclick: () => startSheet(c) }, '🛒 自己開一團') : null);
    } else if (team.status === 'failed') {
      actions.append(h('p', { class: 'small' }, '時間到了，這一團沒有湊齊人數，不會有折扣碼。'),
        cached.active && !mine ? h('button', { class: 'btn btn-primary btn-block', onclick: () => startSheet(c) }, '🛒 再開一團') : null);
    } else if (team.member) {
      actions.append(
        h('button', { class: 'btn btn-line btn-block gb-line', onclick: () => lineInvite(team, c), html: `${ui.ICONS.line}<span>邀請朋友跟團</span>` }),
        h('button', { class: 'btn btn-soft btn-block gb-more', onclick: () => invite(team, c) }, '📤 其他方式（分享卡、IG…）'),
        team.mine ? pubSwitch(team) : null,
        !team.mine || team.count <= 1 ? h('button', { class: 'link-btn small gb-leave', onclick: () => leave(team) }, team.mine ? '取消這一團' : '退出這一團') : null);
      if (App.push && !(live && live.sample)) { const slot = h('div', { class: 'gb-push' }); actions.append(slot); App.push.offer(slot, { text: '有人加入、成團時通知我' }); }
    } else if (mine && mine.id !== team.id) {
      actions.append(h('p', { class: 'small' }, `你已經在「${teamName(mine)}」了（每個團購只能跟一團）。`),
        h('button', { class: 'btn btn-soft btn-block', onclick: () => App.navigate('groupbuy', { team: mine.id }) }, '看我的團'));
    } else if (!cached.active) {
      actions.append(h('p', { class: 'small' }, '這個團購已經結束了。'));
    } else {
      const btn = h('button', { class: 'btn btn-primary btn-block gb-join', onclick: () => join(team, btn) }, u ? `🛒 我要跟團（還差 ${team.size - team.count} 人）` : '🛒 登入後跟團');
      actions.append(btn, h('p', { class: 'tiny muted center' }, u ? '跟團不用付款；成團後拿到折扣碼，要不要買由你決定。' : '用 Email、手機或 LINE 註冊會員就能跟團，不用付款。'));
    }
    el.append(ui.card({ class: 'gb-act-card' }, actions));
    if (!store.state.onboarded) {
      el.append(ui.card({ class: 'soft' }, h('div', { class: 'small' }, `${B().appName || '易家做媽媽'}：從備孕、懷孕到育兒的紀錄 App，全部免費。`),
        h('button', { class: 'btn btn-soft btn-block mt', onclick: () => App.navigate('onboarding') }, '開始使用 App')));
    }
    el.append(howTo(), fine());
  }

  App.screen('groupbuy', {
    title: '團購揪團',
    tab: 'me',
    render(el, params) {
      if (App.account) App.account.refreshSoon();
      if (params && params.team) renderTeam(el, String(params.team));
      else { viewing = null; renderList(el, params || {}); load(); }
    },
    onLeave() { viewing = null; navSeen = -1; },
  });

  /* ---------------- 首頁 ---------------- */
  // one card, the most useful: a full team's code, my team, a friend's team from a link, a new group-buy
  function homeItem() {
    if (!current()) return null;
    const g = ensure(store.state);
    const mineList = Object.values(live.mine);
    const done = mineList.find((t) => t.status === 'done' && t.code && !g.seen[t.id]);
    if (done) return { team: done, kind: 'done' };
    const open = mineList.find((t) => t.status === 'open');
    if (open) return { team: open, kind: 'mine' };
    const p = pendingTeam();
    const pt = p && teams.get(p);
    if (pt && pt.team && pt.team.status === 'open' && !pt.team.member) return { team: pt.team, kind: 'friend', c: pt.campaign };
    if (p && !pt) loadTeam(p).then((v) => { if (v.team && App.homeRefresh) App.homeRefresh(); });
    const c = live.campaigns.find((x) => !g.skip[x.id] && !live.mine[x.id]);
    return c ? { kind: 'new', c } : null;
  }
  App.homeCard('groupbuy', {
    stages: ['prep', 'preg', 'baby'],
    order: 41,
    render(el) {
      const it = homeItem();
      if (!it || (it.kind === 'new' && it.c.sample)) return; // the sample group-buys stay on 好孕島 and the group-buy page
      const c = it.c || campaignOf(it.team.campaign);
      if (!c) return;
      if (it.kind !== 'new') el.dataset.personal = '1'; // her team, a friend's team, 成團了: never folded away (首頁 in 坐月子)
      let title; let sub; let btnText; let go;
      if (it.kind === 'done') { title = '🎉 你的團成團了！'; sub = `${c.title}・折扣碼準備好了`; btnText = '看折扣碼'; go = () => App.navigate('groupbuy', { team: it.team.id }); }
      else if (it.kind === 'mine') {
        title = `🛒 ${teamName(it.team)}・已 ${it.team.count}／${it.team.size} 人`;
        sub = [h('span', { class: 'nowrap' }, `還差 ${it.team.size - it.team.count} 人`), '・', h('span', { class: 'nowrap' }, `剩 ${left(it.team.endsAt - Date.now())}`)];
        btnText = '邀請朋友跟團'; go = () => App.navigate('groupbuy', { team: it.team.id });
      } else if (it.kind === 'friend') {
        title = `🛒 ${teamName(it.team)}等你跟團`; sub = `${c.title}・已 ${it.team.count}／${it.team.size} 人`; btnText = '看這一團'; go = () => App.navigate('groupbuy', { team: it.team.id });
      } else {
        title = `🛒 團購：${c.title}`; sub = [h('span', { class: 'nowrap' }, `團購價 ${money(c.price)}`), '・', h('span', { class: 'nowrap' }, `${c.size} 人成團`)]; btnText = '看團購'; go = () => App.navigate('groupbuy');
      }
      el.append(ui.card({ class: 'gb-home' },
        h('div', { class: 'row gap' },
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, title, demoTag(c)), h('div', { class: 'small muted' }, sub)),
          it.kind === 'new' ? h('button', {
            class: 'icon-btn gb-home-x', 'aria-label': '這個團購先不看',
            onclick: () => { store.update((s) => { ensure(s).skip[c.id] = C.dateKey(); }); ui.toast('不會再在首頁提醒這個團購，「我的 → 團購揪團」隨時看得到'); },
          }, '✕') : null),
        h('button', { class: 'btn btn-primary btn-block wk-mt-sm gb-home-go', onclick: go }, btnText)));
    },
  });

  /* ---------------- 好孕島: 限時團購 tiles ---------------- */
  // A short column down the left side of 好孕島, over the map like the signs at the edge of a game board: one tile for
  // each thing going on — 成團了 (her code is waiting), her team (揪團中, how many so far), a friend's team from a link
  // (等你), a group-buy she is not in yet (限時, the discount). Each has a countdown that ticks every second; a tap
  // opens it. ‹ tucks the column into the edge for the rest of the day; when there is no room (a phone on its side),
  // or it is tucked, only the small 🛒 tab is left, which opens the group-buy page.
  function railItems() {
    if (!current()) return [];
    const g = ensure(store.state);
    const out = []; const taken = new Set();
    Object.values(live.mine).forEach((t) => {
      const c = campaignOf(t.campaign);
      if (!c) return;
      taken.add(c.id);
      if (t.status === 'done' && t.code && !g.seen[t.id]) out.push({ kind: 'done', c, team: t, end: Infinity });
      else if (t.status === 'open') out.push({ kind: 'mine', c, team: t, end: t.endsAt });
    });
    const p = pendingTeam(); const pt = p && teams.get(p);
    if (pt && pt.team && pt.team.status === 'open' && !pt.team.member && pt.campaign && !taken.has(pt.campaign.id)) {
      taken.add(pt.campaign.id); out.push({ kind: 'friend', c: pt.campaign, team: pt.team, end: pt.team.endsAt });
    }
    live.campaigns.forEach((c) => {
      if (taken.has(c.id)) return;
      const L = liveTeams && liveTeams.byC[c.id];
      out.push({ kind: 'new', c, end: endOf(c), need1: !!(L && L.teams.some((t) => t.size - t.count === 1)) });
    });
    const rank = { done: 0, mine: 1, friend: 2, new: 3 };
    return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.end - b.end);
  }
  const RIBBON = {
    done: '成團了', mine: '揪團中', friend: '等你', new: '限時', need1: '差1人',
  };
  function railTile(it) {
    const { kind, c, team } = it;
    const ms = it.end - Date.now();
    const rib = it.need1 ? 'need1' : kind;
    const label = kind === 'done' ? `成團了：${c.title}，看折扣碼`
      : kind === 'mine' ? `我的團：${c.title}，已 ${team.count}／${team.size} 人，還剩 ${left(ms)}`
        : kind === 'friend' ? `${teamName(team)}等你跟團：${c.title}，還剩 ${left(ms)}`
          : `限時團購：${c.title}，團購價 ${money(c.price)}，還剩 ${left(ms)}${it.need1 ? '，有一團只差 1 人' : ''}`;
    return h('button', {
      type: 'button', class: `gbr-tile k-${kind}`, 'aria-label': label, dataset: { kind, c: c.id },
      onclick: () => App.navigate('groupbuy', team ? { team: team.id } : { c: c.id }),
    },
    h('span', { class: 'gbr-pic' },
      c.image ? h('img', { src: c.image, alt: '' }) : h('span', { class: 'gbr-emoji', 'aria-hidden': 'true' }, kind === 'done' ? '🎉' : (c.emoji || '🛒'))),
    h('span', { class: `gbr-rib${it.need1 ? ' hot' : ''}`, 'aria-hidden': 'true' }, RIBBON[rib]),
    kind === 'mine' || kind === 'friend' ? h('span', { class: 'gbr-badge', 'aria-hidden': 'true' }, `${team.count}/${team.size}`) : null,
    kind === 'done' ? h('span', { class: 'gbr-chip gold', 'aria-hidden': 'true' }, '看折扣碼')
      : h('span', { class: 'gbr-chip num', 'aria-hidden': 'true', dataset: { gbEnd: String(it.end), gbFmt: 'calm' } }, calm(ms)));
  }
  let railEl = null;
  // the column for a new 好孕島 screen (js/modules/island.js puts it on the map)
  function islandRail() {
    railEl = h('aside', { class: 'gb-rail', 'aria-label': '限時團購' });
    syncRail();
    load(); loadLive();
    return railEl;
  }
  function syncRail() {
    if (!railEl) return;
    const items = railItems();
    railEl.hidden = !items.length;
    if (!items.length) { railEl.replaceChildren(); return; }
    railEl.classList.toggle('tucked', ensure(store.state).railTuck === C.dateKey());
    const tuck = h('button', {
      type: 'button', class: 'gbr-tuck', 'aria-label': '先收起限時團購（今天）',
      onclick: () => { ensure(store.state).railTuck = C.dateKey(); store.save(); syncRail(); ui.toast('先收起來了，明天再出現；左邊的 🛒 隨時看得到'); },
    }, h('span', { 'aria-hidden': 'true' }, '‹'));
    const tab = h('button', {
      type: 'button', class: 'gbr-tab', 'aria-label': `限時團購：${items.length} 個，看正在開團`, onclick: () => App.navigate('groupbuy'),
    }, h('span', { class: 'gbr-tab-ico', 'aria-hidden': 'true' }, '🛒'), h('span', { class: 'gbr-tab-n', 'aria-hidden': 'true' }, String(items.length)),
    items.some((i) => i.kind !== 'new') ? h('span', { class: 'gbr-dot', 'aria-hidden': 'true' }) : null);
    // one tile — the most pressing (her team, a friend's, a 成團, else the one ending first); the 🛒 tab has the count and opens them all
    railEl.replaceChildren(tuck, ...items.slice(0, 1).map(railTile), tab);
    requestAnimationFrame(fitRail);
    setTimeout(fitRail, 450); // again once the screen has settled in
  }
  // as many tiles as fit above what sits at the lower left of the island (the 💜 chip, the island strip); no room for
  // even the 🛒 tab (a phone on its side) → nothing here, the group-buys are still in 我的
  function fitRail() {
    if (!railEl || railEl.hidden || !railEl.isConnected) return;
    const tiles = [...railEl.querySelectorAll('.gbr-tile')];
    // where the column starts on screen (read from its place on the map, so it works while it is hidden too)
    const top = railEl.parentElement.getBoundingClientRect().top + (parseFloat(getComputedStyle(railEl).top) || 0);
    const below = ['.isl-heart-badge', '.isl .isl-strip'].map((sel) => document.querySelector(sel))
      .map((e) => e && e.getBoundingClientRect()).filter((r) => r && r.height && r.left < 90 && r.top > top).map((r) => r.top);
    const room = (below.length ? Math.min(...below) : window.innerHeight) - top;
    let n = railEl.classList.contains('tucked') ? 0 : tiles.length;
    n = Math.max(0, Math.min(n, Math.floor((room - 52) / 74))); // 52: the ‹ above and the last chip; 74: a tile and its gap
    tiles.forEach((t, i) => { t.hidden = i >= n; });
    railEl.classList.toggle('peek', n === 0);
    railEl.classList.toggle('none', n === 0 && room < 66);
  }
  window.addEventListener('resize', () => fitRail());

  /* ---------------- 我的 and 品牌 ---------------- */
  function listItem() {
    if (!current()) return null;
    if (!live.campaigns.length && !Object.keys(live.mine).length) return null;
    const mineList = Object.values(live.mine);
    const sub = (mineList.length ? mineList.map((t) => (t.status === 'done' ? '🎉 成團了' : `${teamName(t)} ${t.count}／${t.size} 人`)).join('・') : `${live.campaigns.length} 個團購進行中`) + (live.sample ? '（範例）' : '');
    return h('a', { class: 'list-item', href: '#/groupbuy' }, h('span', { class: 'li-icon' }, '🛒'),
      h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '團購揪團'), h('div', { class: 'li-sub' }, sub)),
      h('span', { class: 'li-right', html: ui.ICONS.chevron }));
  }
  function brandCard() {
    if (!current()) return null;
    if (!live.campaigns.length) return null;
    const c = live.campaigns[0];
    return ui.card({ class: 'gb-brand' },
      h('div', { class: 'card-title' }, '團購揪團', demoTag(c)),
      h('p', { class: 'small' }, `${c.title}：團購價 ${money(c.price)}，${c.size} 人成團${live.campaigns.length > 1 ? `（還有 ${live.campaigns.length - 1} 個團購）` : ''}`),
      h('button', { class: 'btn btn-primary btn-block', onclick: () => App.navigate('groupbuy') }, '看團購'));
  }

  App.groupbuy = {
    load, live: () => live, listItem, brandCard, pendingTeam, left, homeItem, islandRail, railItems, endOf, clock,
  };
}());
