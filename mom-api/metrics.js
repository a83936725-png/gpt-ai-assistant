/* 品牌數據: what members do in the app, counted per day (台灣日期) — never who did it.
 *
 *   m:d:<YYYY-MM-DD>   counts for that day (kept 400 days): signup, signup_email / _phone / _line, login, open (the app
 *                      was opened or came back after a while), invite (a friend's join was counted for her inviter),
 *                      gift, gb_start / gb_join / gb_done, wall_new / wall_wish, circle_join / circle_vote, wave,
 *                      deleted, push_sub / push_sent, family_new / family_join, monthly … (see EVENTS)
 *   m:tot              running totals that can go down: marketing (members who said yes to marketing messages,
 *                      counted from this version on), push (phones that get notifications), families
 *
 *   GET /admin/stats?days=7..90   for the brand's own dashboard (#/admin in the app). Needs the header
 *                      X-Admin-Key = MOM_ADMIN_KEY (at least 24 characters). Without that variable the route does not
 *                      exist (404). Wrong keys: 10 per network per hour, then that network is blocked for an hour.
 *                      The answer holds counts only: no names, accounts, codes or addresses.
 * A count never gets in the way of what the member was doing: if the database hiccups, the count is skipped. */
import crypto from 'crypto';

const DAY_MS = 86400e3;
const TW_MS = 8 * 3600e3;
const KEEP_SEC = 400 * 86400;
const CACHE_MS = 30 * 1000;
export const EVENTS = [
  'signup', 'signup_email', 'signup_phone', 'signup_line', 'login', 'open', 'invite', 'gift',
  'gb_start', 'gb_join', 'gb_done', 'wall_new', 'wall_wish', 'circle_join', 'circle_vote', 'wave', 'deleted',
  'push_sub', 'push_sent', 'family_new', 'family_join',
];
// 台灣日期 of a moment, and the start (00:00 台灣時間) of that day
export const dayKey = (t) => new Date(t + TW_MS).toISOString().slice(0, 10);
export const dayStart = (t) => Math.floor((t + TW_MS) / DAY_MS) * DAY_MS - TW_MS;

export const NO_METRICS = { count: async () => {}, total: async () => {} };

export function makeMetrics({ store, now = () => Date.now() }) {
  const known = new Set(EVENTS);
  async function count(name, by = 1) {
    if (!known.has(name)) return;
    const t = now();
    try { await store.hincrBy(`m:d:${dayKey(t)}`, name, by, KEEP_SEC, t); } catch (e) { /* skipped */ }
  }
  async function total(name, by) {
    try { await store.hincrBy('m:tot', name, by, 0, now()); } catch (e) { /* skipped */ }
  }
  const n = (v) => Math.max(0, Math.round(Number(v) || 0));
  // the last `days` days, oldest first: {day, <event>: count…}
  async function days(len, t = now()) {
    const keys = Array.from({ length: len }, (_, i) => dayKey(t - (len - 1 - i) * DAY_MS));
    const rows = await Promise.all(keys.map((k) => store.hgetAllJson(`m:d:${k}`, t)));
    return keys.map((day, i) => {
      const r = rows[i] || {};
      const out = { day };
      EVENTS.forEach((e) => { out[e] = n(r[e]); });
      return out;
    });
  }
  async function totals() {
    const r = (await store.hgetAllJson('m:tot', now())) || {};
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, n(v)]));
  }
  return {
    count, total, days, totals,
  };
}

// the admin key: compared in constant time, a few wrong tries per network, then a pause
export function mountAdmin(router, {
  store, now, over, clientIp, keyed, wrap, env, metrics, build,
}) {
  const key = String(env.MOM_ADMIN_KEY || '');
  const on = key.length >= 24;
  if (env.MOM_ADMIN_KEY && !on && env.NODE_ENV !== 'test') console.warn('[mom-api] MOM_ADMIN_KEY needs at least 24 characters; the brand dashboard is off.');
  const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const good = (given) => crypto.timingSafeEqual(digest(given), digest(key));
  let cache = null;

  router.get('/admin/stats', wrap(async (req, res) => {
    if (!on) { res.status(404).json({ error: 'not_found' }); return; }
    const t = now();
    const ip = clientIp(req);
    const block = `admin-block:${keyed(ip)}`;
    if (await store.hasFlag(block, t)) { res.status(429).json({ error: 'too_many' }); return; }
    const given = String(req.get('x-admin-key') || '').slice(0, 200);
    if (!given || !good(given)) {
      if (await over('admin-bad', ip, [10, 3600])) await store.setFlag(block, 3600, t);
      res.status(401).json({ error: 'bad_key' }); return;
    }
    const len = Math.max(7, Math.min(90, parseInt(req.query.days, 10) || 30));
    if (!cache || cache.len !== len || t - cache.at > CACHE_MS) {
      const [days, totals] = await Promise.all([metrics.days(len, t), metrics.totals()]);
      const built = await build({
        t, days, totals, len,
      });
      cache = { len, at: t, body: { at: t, days: len, ...built } };
    }
    res.json(cache.body);
  }));
  return { on };
}
