/* 團購揪團, stage 1 (mounted by index.js): the brand runs a group-buy, a mom starts a team (or joins a friend's from
 * the link), and when the team is full in time every member gets the discount code for the brand's own online shop.
 * The app takes no payment and no address: checkout, returns and invoices stay with the shop.
 *
 *   GET  /groupbuy                     active campaigns (+ my team in each, when logged in)
 *   GET  /groupbuy/team/:id            a team: leader's display name, how many / how many needed, time left, status
 *                                      (+ the code, only for members of a full team)
 *   POST /groupbuy/start {campaign, name?}   start a team (logged in, agreed to the current policy)
 *   POST /groupbuy/team/:id/join       join it
 *   POST /groupbuy/team/:id/leave      leave before it is full (a leader can leave only while alone: the team closes)
 *
 * Campaigns come from MOM_GROUPBUYS (a JSON array, see docs/GROWTH.md); MOM_GROUPBUY_DEMO=1 adds a test campaign.
 * Every count is the real number of members; the code is never sent before the team is full, and only to members.
 * One team per person per campaign; a team has `hours` to fill (never past the campaign's last day). Kept: the team
 * (display name, members' account ids) until 60 days after the campaign ends; deleting an account removes it. */
import { POLICY_VERSION } from './policy.js';
import { cleanText, newId } from './auth.js';
import { cleanName } from './social.js';

const DAY_MS = 86400e3;
const TAIPEI_MS = 8 * 3600e3;
const KEEP_MS = 60 * DAY_MS; // after the campaign ends
const LIMITS = {
  start: [10, 86400], // teams a person can start in a day
  startIp: [20, 3600],
  join: [30, 600], // join / leave tries per person
  joinTeamIp: [3, 7 * 86400], // members of one team from the same network
  read: [240, 600],
};
const okTeam = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]{16}$/.test(s) ? s : '');
const dayMs = (key) => { // 'YYYY-MM-DD' → 00:00 that day in Taiwan, or NaN
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - TAIPEI_MS : NaN;
};
const taipeiKey = (t) => new Date(t + TAIPEI_MS).toISOString().slice(0, 10);
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const https = (u) => (/^https:\/\/[^\s"'<>]{4,300}$/.test(String(u || '')) ? String(u) : '');

// one campaign from the brand's settings, or null when something needed is missing or odd
export function cleanCampaign(c) {
  if (!c || typeof c !== 'object') return null;
  const id = String(c.id || '');
  const ends = dayMs(c.ends);
  const starts = c.starts ? dayMs(c.starts) : -Infinity;
  const price = int(c.price, 1, 1e6);
  const code = cleanText(c.code, 40);
  if (!/^[a-z0-9-]{3,32}$/.test(id) || !cleanText(c.title, 30) || !price || Number.isNaN(ends) || Number.isNaN(starts) || !/^[A-Za-z0-9_-]{3,40}$/.test(code)) return null;
  const listPrice = int(c.listPrice, price + 1, 1e6);
  return {
    id,
    title: cleanText(c.title, 30),
    desc: cleanText(c.desc, 80),
    emoji: cleanText(c.emoji, 4) || '🛒',
    image: https(c.image),
    price,
    listPrice,
    size: int(c.size, 2, 20) || 5,
    hours: int(c.hours, 1, 336) || 72,
    starts: Number.isFinite(starts) ? c.starts : null,
    ends: c.ends,
    shopUrl: https(c.shopUrl),
    codeNote: cleanText(c.codeNote, 60),
    demo: !!c.demo,
    code,
    startMs: starts,
    endMs: ends + DAY_MS, // the end of its last day
  };
}
export function loadCampaigns(env, t) {
  let list = [];
  try { list = env.MOM_GROUPBUYS ? JSON.parse(env.MOM_GROUPBUYS) : []; } catch (e) {
    if (env.NODE_ENV !== 'test') console.warn('[mom-api] MOM_GROUPBUYS is not valid JSON: no group-buys are shown.');
  }
  const out = (Array.isArray(list) ? list : []).map(cleanCampaign).filter(Boolean);
  if (env.MOM_GROUPBUY_DEMO === '1') {
    out.push(cleanCampaign({
      id: 'demo',
      title: '示範團購（測試用）',
      desc: '測試環境的示範活動，不是真的商品',
      emoji: '🧪',
      price: 999,
      listPrice: 1299,
      size: 3,
      hours: 72,
      ends: taipeiKey(t + 30 * DAY_MS),
      code: 'DEMO-0000',
      codeNote: '示範用的折扣碼，不能真的使用',
      demo: true,
    }));
  }
  return out;
}
// what anyone may see of a campaign (never the code)
const publicCampaign = ({
  code, startMs, endMs, ...c
}) => c;

export function mountGroupbuy(router, {
  store, now, over, clientIp, wrap, currentUser, env,
}) {
  const campaigns = loadCampaigns(env, now());
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const active = (c, t) => !!c && t >= c.startMs && t < c.endMs;
  const ttlSec = (c, t) => Math.max(86400, Math.ceil((c.endMs + KEEP_MS - t) / 1000));
  const fail = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });

  const status = (team, t) => {
    if (team.doneAt) return 'done';
    return t >= team.endsAt ? 'failed' : 'open';
  };
  async function teamView(team, t, user) {
    const c = byId.get(team.c);
    const count = await store.getNum(`gb:n:${team.id}`, t);
    const member = !!(user && await store.hgetJson(`gb:m:${team.id}`, user.id, t));
    const st = status(team, t);
    return {
      id: team.id,
      campaign: team.c,
      leader: team.leaderName,
      count: Math.min(count, c ? c.size : count),
      size: c ? c.size : count,
      endsAt: team.endsAt,
      doneAt: team.doneAt || null,
      status: st,
      member,
      mine: !!(user && team.leader === user.id),
      ...(st === 'done' && member && c ? { code: c.code, codeNote: c.codeNote, shopUrl: c.shopUrl } : {}),
    };
  }
  const getTeam = (id, t) => (okTeam(id) ? store.getJson(`gb:t:${id}`, t) : null);
  const agreed = (u) => !!(u.consent && u.consent.version === POLICY_VERSION);

  // her team in this campaign, if it still counts (a team that ran out of time, or was closed, frees her)
  async function currentTeam(cid, uid, t) {
    const id = await store.hgetJson(`gb:u:${uid}`, cid, t);
    if (!id) return null;
    const team = await getTeam(id, t);
    if (team && status(team, t) !== 'failed' && await store.hgetJson(`gb:m:${team.id}`, uid, t)) return team;
    await store.hdel(`gb:u:${uid}`, cid);
    return null;
  }
  // one person, one campaign, one change at a time (starting and joining at the same moment can't make two teams)
  async function withLock(cid, uid, t, fn) {
    const key = `gb-op:${cid}:${uid}`;
    if (!(await store.claimOnce(key, 15, t))) return null;
    try { return await fn(); } finally { await store.clearFlag(key); }
  }
  async function addMember(team, c, uid, t) {
    const ttl = ttlSec(c, t);
    await store.hsetJson(`gb:m:${team.id}`, uid, { at: t }, ttl, t);
    await store.hsetJson(`gb:u:${uid}`, c.id, team.id, ttl, t);
  }
  async function removeMember(team, uid, t) {
    await store.hdel(`gb:m:${team.id}`, uid);
    await store.incrBy(`gb:n:${team.id}`, -1, 0, t);
    await store.hdel(`gb:u:${uid}`, team.c);
  }
  async function closeTeam(team) {
    await store.del(`gb:t:${team.id}`); await store.del(`gb:n:${team.id}`); await store.del(`gb:m:${team.id}`);
  }

  router.get('/groupbuy', wrap(async (req, res) => {
    const t = now();
    const list = campaigns.filter((c) => active(c, t));
    const user = await currentUser(req);
    const mine = {};
    if (user) {
      for (const c of list) { // eslint-disable-line no-restricted-syntax
        const team = await currentTeam(c.id, user.id, t); // eslint-disable-line no-await-in-loop
        if (team) mine[c.id] = await teamView(team, t, user); // eslint-disable-line no-await-in-loop
      }
    }
    res.json({ campaigns: list.map(publicCampaign), mine });
  }));

  router.get('/groupbuy/team/:id', wrap(async (req, res) => {
    if (await over('gb-read', clientIp(req), LIMITS.read)) { fail(res, 429, 'too_many'); return; }
    const t = now();
    const team = await getTeam(req.params.id, t);
    const c = team && byId.get(team.c);
    if (!team || !c) { fail(res, 404, 'not_found'); return; }
    const user = await currentUser(req);
    res.json({ team: await teamView(team, t, user), campaign: publicCampaign(c), active: active(c, t) });
  }));

  router.post('/groupbuy/start', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { fail(res, 401, 'unauthorized'); return; }
    if (!agreed(user)) { fail(res, 403, 'need_consent'); return; }
    const t = now();
    const c = byId.get(String((req.body && req.body.campaign) || ''));
    if (!active(c, t)) { fail(res, 404, 'no_campaign'); return; }
    if (await over('gb-start', user.id, LIMITS.start) || await over('gb-start-ip', clientIp(req), LIMITS.startIp)) { fail(res, 429, 'too_many'); return; }
    const out = await withLock(c.id, user.id, t, async () => {
      const cur = await currentTeam(c.id, user.id, t);
      if (cur) return { status: 409, body: { error: 'in_team', team: await teamView(cur, t, user) } };
      const team = {
        id: newId(),
        c: c.id,
        leader: user.id,
        leaderName: cleanName((req.body && req.body.name) || user.nickname, 10) || '媽媽',
        createdAt: t,
        endsAt: Math.min(t + c.hours * 3600e3, c.endMs),
      };
      const ttl = ttlSec(c, t);
      await store.setJson(`gb:t:${team.id}`, team, ttl, t);
      await store.incrBy(`gb:n:${team.id}`, 1, ttl, t);
      await addMember(team, c, user.id, t);
      return { status: 201, body: { team: await teamView(team, t, user) } };
    });
    if (!out) { fail(res, 409, 'busy'); return; }
    res.status(out.status).json(out.body);
  }));

  router.post('/groupbuy/team/:id/join', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { fail(res, 401, 'unauthorized'); return; }
    if (!agreed(user)) { fail(res, 403, 'need_consent'); return; }
    if (await over('gb-join', user.id, LIMITS.join)) { fail(res, 429, 'too_many'); return; }
    const t = now();
    const team = await getTeam(req.params.id, t);
    const c = team && byId.get(team.c);
    if (!team || !c) { fail(res, 404, 'not_found'); return; }
    if (await store.hgetJson(`gb:m:${team.id}`, user.id, t)) { res.json({ team: await teamView(team, t, user) }); return; } // already in it
    const st = status(team, t);
    if (st !== 'open' || !active(c, t)) { fail(res, 409, st === 'done' ? 'full' : 'closed', { team: await teamView(team, t, user) }); return; }
    if (await over('gb-join-ip', `${team.id}|${clientIp(req)}`, LIMITS.joinTeamIp)) { fail(res, 429, 'too_many_here'); return; }
    const out = await withLock(c.id, user.id, t, async () => {
      const cur = await currentTeam(c.id, user.id, t);
      if (cur) return { status: 409, body: { error: 'in_team', team: await teamView(cur, t, user) } };
      // the count goes up in one step: exactly `size` people get in, even when several join at the same moment
      const n = await store.incrBy(`gb:n:${team.id}`, 1, ttlSec(c, t), t);
      if (n > c.size) {
        await store.incrBy(`gb:n:${team.id}`, -1, 0, t);
        return { status: 409, body: { error: 'full', team: await teamView(team, t, user) } };
      }
      await addMember(team, c, user.id, t);
      if (n === c.size) { team.doneAt = t; await store.setJson(`gb:t:${team.id}`, team, ttlSec(c, t), t); }
      return { status: 200, body: { team: await teamView(team, t, user), done: n === c.size } };
    });
    if (!out) { fail(res, 409, 'busy'); return; }
    res.status(out.status).json(out.body);
  }));

  router.post('/groupbuy/team/:id/leave', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { fail(res, 401, 'unauthorized'); return; }
    if (await over('gb-join', user.id, LIMITS.join)) { fail(res, 429, 'too_many'); return; }
    const t = now();
    const team = await getTeam(req.params.id, t);
    if (!team || !(await store.hgetJson(`gb:m:${team.id}`, user.id, t))) { fail(res, 404, 'not_member'); return; }
    if (status(team, t) !== 'open') { fail(res, 409, 'not_open'); return; }
    const count = await store.getNum(`gb:n:${team.id}`, t);
    if (team.leader === user.id && count > 1) { fail(res, 409, 'leader_stays'); return; }
    await removeMember(team, user.id, t);
    if (team.leader === user.id) await closeTeam(team);
    res.json({ ok: true });
  }));

  return {
    // 刪除帳號: she leaves every team. An open team she leads keeps going for the others under 「會員」; one she was
    // alone in is closed; a full team keeps its count (the others already have their code) without her account id.
    async forget(user) {
      const t = now();
      const teams = await store.hgetAllJson(`gb:u:${user.id}`, t);
      for (const [cid, id] of Object.entries(teams)) { // eslint-disable-line no-restricted-syntax
        const team = await getTeam(id, t); // eslint-disable-line no-await-in-loop
        if (team) {
          const open = status(team, t) === 'open';
          const count = await store.getNum(`gb:n:${team.id}`, t); // eslint-disable-line no-await-in-loop
          if (open) await removeMember(team, user.id, t); // eslint-disable-line no-await-in-loop
          else await store.hdel(`gb:m:${team.id}`, user.id); // eslint-disable-line no-await-in-loop
          if (team.leader === user.id) {
            if (open && count <= 1) await closeTeam(team); // eslint-disable-line no-await-in-loop
            else await store.setJson(`gb:t:${team.id}`, { ...team, leader: null, leaderName: '會員' }, ttlSec(byId.get(cid) || { endMs: t }, t), t); // eslint-disable-line no-await-in-loop
          }
        }
      }
      await store.del(`gb:u:${user.id}`);
    },
    // 下載我的會員資料: the teams she is in
    async exportFor(user) {
      const t = now();
      const teams = await store.hgetAllJson(`gb:u:${user.id}`, t);
      const out = [];
      for (const [cid, id] of Object.entries(teams)) { // eslint-disable-line no-restricted-syntax
        const team = await getTeam(id, t); // eslint-disable-line no-await-in-loop
        const m = team && await store.hgetJson(`gb:m:${team.id}`, user.id, t); // eslint-disable-line no-await-in-loop
        if (team && m) {
          out.push({
            campaign: cid, team: team.id, leader: team.leader === user.id, displayName: team.leader === user.id ? team.leaderName : undefined, joinedAt: new Date(m.at).toISOString(), status: status(team, t),
          });
        }
      }
      return out;
    },
    campaigns: () => campaigns.map(publicCampaign),
  };
}
