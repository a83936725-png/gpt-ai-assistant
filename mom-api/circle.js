/* 同週好孕圈 (mounted by index.js): moms in the same circle — the same due-date week, babies born in the same month,
 * or everyone 備孕 — answer one light question a week, share this week's mood, and cheer each other on.
 * Everything is anonymous: others only ever see totals, never who chose what; a result shows only once 3 moms answered.
 *   POST /circle/sync  {key, cohort}           join / heartbeat → {members, poll, mood, cheers}
 *   POST /circle/vote  {key, cohort, poll, option}
 *   POST /circle/mood  {key, cohort, mood}
 *   POST /circle/cheer {key, cohort}           once a day: 💜 for everyone in the circle
 *   POST /circle/leave {key, cohort}
 * cohort: 'p:2027-W10' (ISO week of the due date), 'b:2026-10' (baby's birth month) or 'prep'.
 * What leaves the phone: that cohort (a week or a month, never a date), the answers. Nothing from the health records. */
import { makeIdentity } from './social.js';
import { POLLS, MOODS } from './circle-polls.js';

const DAY_MS = 86400e3;
const TAIPEI_MS = 8 * 3600e3;
const ACTIVE_MS = 14 * DAY_MS; // a member = someone who opened the circle in the last two weeks
const WEEK_TTL = 21 * 86400; // tallies of a week are kept 3 weeks
const MIN_SHOWN = 3; // a result is shown once at least 3 moms answered (a single answer is never visible)
const LIMITS = {
  sync: [60, 600],
  act: [40, 600],
};

// ISO week ('2026-W47') of a moment, in Taiwan time
export function weekKey(t) {
  const d = new Date(Math.floor((t + TAIPEI_MS) / DAY_MS) * DAY_MS);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const w = Math.ceil(((d - Date.UTC(y, 0, 1)) / DAY_MS + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
const dayKey = (t) => new Date(t + TAIPEI_MS).toISOString().slice(0, 10);
const mondayOf = (y, w) => { const jan4 = Date.UTC(y, 0, 4); const dow = new Date(jan4).getUTCDay() || 7; return jan4 - (dow - 1) * DAY_MS + (w - 1) * 7 * DAY_MS; };

// where a cohort is now: pregnancy week, baby age in months, or 備孕; null when it is not a sensible cohort today
// (counted from this week's Monday, so a circle keeps the same question all week)
export function cohortInfo(cohort, t) {
  const day0 = Math.floor((t + TAIPEI_MS) / DAY_MS) * DAY_MS;
  const today = day0 - ((new Date(day0).getUTCDay() || 7) - 1) * DAY_MS;
  let m = /^p:(\d{4})-W(\d{2})$/.exec(String(cohort || ''));
  if (m) {
    const w = Number(m[2]); if (w < 1 || w > 53) return null;
    const edd = mondayOf(Number(m[1]), w) + 3 * DAY_MS; // the Thursday of the due-date week
    const weeks = Math.floor((280 - Math.round((edd - today) / DAY_MS)) / 7);
    return weeks >= 0 && weeks <= 44 ? { kind: 'preg', at: Math.min(42, Math.max(4, weeks)) } : null;
  }
  m = /^b:(\d{4})-(\d{2})$/.exec(String(cohort || ''));
  if (m) {
    const mo = Number(m[2]); if (mo < 1 || mo > 12) return null;
    const now = new Date(today);
    const months = (now.getUTCFullYear() - Number(m[1])) * 12 + (now.getUTCMonth() + 1 - mo);
    return months >= 0 && months <= 84 ? { kind: 'baby', at: months } : null;
  }
  return cohort === 'prep' ? { kind: 'prep', at: 0 } : null;
}

// this week's question for a cohort: everyone in it gets the same one; the next week brings the next one
export function pollFor(info, t) {
  const fits = POLLS.filter((p) => p.kind === info.kind && (!p.range || (info.at >= p.range[0] && info.at <= p.range[1])));
  const list = fits.length ? fits : POLLS.filter((p) => p.kind === info.kind);
  const wk = weekKey(t);
  const n = Number(wk.slice(-2)) + Number(wk.slice(0, 4)) * 53;
  const p = list[n % list.length];
  return { ...p, instance: `${p.id}@${wk}` };
}

export function mountCircle(router, {
  store, now, secret, over, clientIp, wrap, metrics = { count: async () => {} },
}) {
  const { nidOf, admit, okKey } = makeIdentity({
    store, secret, over, clientIp,
  });

  // who is asking, about which circle; answers 4xx itself when something is off
  async function who(req, res, limit) {
    const b = req.body || {};
    const key = okKey(b.key);
    if (!key) { res.status(400).json({ error: 'bad_key' }); return null; }
    const t = now();
    const info = cohortInfo(b.cohort, t);
    if (!info) { res.status(400).json({ error: 'bad_cohort' }); return null; }
    const nid = nidOf(key);
    if (await over(`circle-${limit}`, nid, LIMITS[limit])) { res.status(429).json({ error: 'too_many' }); return null; }
    return {
      b, t, nid, cohort: b.cohort, info, wk: weekKey(t),
    };
  }
  const tally = (raw, keys) => {
    const counts = keys.map((k) => Number(raw[k]) || 0);
    return { counts, total: counts.reduce((a, c) => a + c, 0) };
  };
  async function state(c) {
    const {
      cohort, nid, t, wk,
    } = c;
    const poll = pollFor(c.info, t);
    await store.ztrim(`circ:m:${cohort}`, t - ACTIVE_MS);
    const [members, votes, mine, moods, myMood, cheers, cheered] = await Promise.all([
      store.zcountSince(`circ:m:${cohort}`, t - ACTIVE_MS),
      store.hgetAllJson(`circ:c:${cohort}:${poll.instance}`, t),
      store.hgetJson(`circ:v:${cohort}:${poll.instance}`, nid, t),
      store.hgetAllJson(`circ:mc:${cohort}:${wk}`, t),
      store.hgetJson(`circ:mv:${cohort}:${wk}`, nid, t),
      store.getNum(`circ:ch:${cohort}:${wk}`, t),
      store.hasFlag(`circ:chd:${cohort}:${nid}:${dayKey(t)}`, t),
    ]);
    const pv = tally(votes, poll.options.map((o, i) => String(i)));
    const mv = tally(moods, MOODS);
    return {
      cohort,
      week: wk,
      members,
      poll: {
        id: poll.id, instance: poll.instance, q: poll.q, options: poll.options, spot: poll.spot || null, total: pv.total, counts: pv.total >= MIN_SHOWN ? pv.counts : null, mine: Number.isInteger(mine) ? mine : null,
      },
      mood: {
        total: mv.total, counts: mv.total >= MIN_SHOWN ? Object.fromEntries(MOODS.map((k, i) => [k, mv.counts[i]])) : null, mine: MOODS.includes(myMood) ? myMood : null,
      },
      cheers: { week: cheers, today: !!cheered },
      minShown: MIN_SHOWN,
    };
  }

  router.post('/circle/sync', wrap(async (req, res) => {
    const c = await who(req, res, 'sync'); if (!c) return;
    if (!(await admit(req, c.nid, c.t))) { res.status(429).json({ error: 'too_many' }); return; }
    const fresh = (await store.zscore(`circ:m:${c.cohort}`, c.nid)) === null;
    await store.zset(`circ:m:${c.cohort}`, c.nid, c.t);
    if (fresh) await metrics.count('circle_join');
    res.json(await state(c));
  }));

  // the rest only for members of that circle
  const member = async (c, res) => {
    const seen = await store.zscore(`circ:m:${c.cohort}`, c.nid);
    if (!(seen >= c.t - ACTIVE_MS)) { res.status(403).json({ error: 'not_member' }); return false; }
    return true;
  };

  router.post('/circle/vote', wrap(async (req, res) => {
    const c = await who(req, res, 'act'); if (!c) return;
    if (!(await member(c, res))) return;
    const poll = pollFor(c.info, c.t);
    // only this week's question, and one of its options
    if (c.b.poll !== poll.instance) { res.status(409).json({ error: 'old_poll', ...(await state(c)) }); return; }
    const opt = Number(c.b.option);
    if (!Number.isInteger(opt) || opt < 0 || opt >= poll.options.length) { res.status(400).json({ error: 'bad_option' }); return; }
    const vKey = `circ:v:${c.cohort}:${poll.instance}`; const cKey = `circ:c:${c.cohort}:${poll.instance}`;
    const prev = await store.hgetJson(vKey, c.nid, c.t);
    if (prev !== opt) {
      await store.hsetJson(vKey, c.nid, opt, WEEK_TTL, c.t);
      if (Number.isInteger(prev)) await store.hincrBy(cKey, String(prev), -1, WEEK_TTL, c.t); // changed her mind: still one vote
      await store.hincrBy(cKey, String(opt), 1, WEEK_TTL, c.t);
      if (!Number.isInteger(prev)) await metrics.count('circle_vote');
    }
    res.json(await state(c));
  }));

  router.post('/circle/mood', wrap(async (req, res) => {
    const c = await who(req, res, 'act'); if (!c) return;
    if (!(await member(c, res))) return;
    const { mood } = c.b;
    if (!MOODS.includes(mood)) { res.status(400).json({ error: 'bad_mood' }); return; }
    const vKey = `circ:mv:${c.cohort}:${c.wk}`; const cKey = `circ:mc:${c.cohort}:${c.wk}`;
    const prev = await store.hgetJson(vKey, c.nid, c.t);
    if (prev !== mood) {
      await store.hsetJson(vKey, c.nid, mood, WEEK_TTL, c.t);
      if (MOODS.includes(prev)) await store.hincrBy(cKey, prev, -1, WEEK_TTL, c.t);
      await store.hincrBy(cKey, mood, 1, WEEK_TTL, c.t);
    }
    res.json(await state(c));
  }));

  router.post('/circle/cheer', wrap(async (req, res) => {
    const c = await who(req, res, 'act'); if (!c) return;
    if (!(await member(c, res))) return;
    if (await store.claimOnce(`circ:chd:${c.cohort}:${c.nid}:${dayKey(c.t)}`, 86400, c.t)) await store.incrBy(`circ:ch:${c.cohort}:${c.wk}`, 1, WEEK_TTL, c.t);
    res.json(await state(c));
  }));

  router.post('/circle/leave', wrap(async (req, res) => {
    const c = await who(req, res, 'act'); if (!c) return;
    await store.zrem(`circ:m:${c.cohort}`, c.nid);
    res.json({ ok: true });
  }));
}
