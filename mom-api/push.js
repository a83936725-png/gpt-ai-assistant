/* 手機通知: Web Push for members who turn it on (and, optionally, a LINE message from the brand's official account).
 *
 *   GET  /config                → push: the VAPID public key (null when off), lineNotify: true when LINE messages can go
 *   POST /push/subscribe        {sub: {endpoint, keys: {p256dh, auth}}, topics: {gb, family, remind}}  this phone gets
 *                               notifications (or new topics); members only, at most 5 phones each (the oldest makes
 *                               room); only real push services (Google, Mozilla, Apple, Microsoft) are accepted
 *   POST /push/unsubscribe      {endpoint}
 *   POST /push/test             {endpoint}   「通知設定好了」 to that phone
 *   POST /push/schedule         {endpoint, jobs: [{kind, at, daily}]}  this phone's coming reminders (they replace the
 *                               ones before). kind is feed / appt / chicken and the words are fixed here: what an
 *                               appointment is about, or anything else from her records, never leaves the phone.
 *                               A daily one repeats while the phone has checked in within the last 7 days.
 *   GET|POST /push/run          sends the reminders that are due. Authorization: Bearer MOM_CRON_SECRET (or
 *                               CRON_SECRET, which Vercel Cron sends); 404 without a secret. It also runs, at most
 *                               once a minute, when an open app checks in (/presence), so reminders still go out
 *                               on a host without a minute-by-minute scheduler while anyone is using the app.
 *   POST /push/line             {on}  LINE-login members: group-buy and family news also as a LINE message
 *                               (MOM_LINE_MESSAGING_TOKEN; she must have added the official account as a friend)
 * Group-buy (and family) news: notify(uids, topic, {title, body, url, tag}) from the other parts.
 *
 * Storage: push:d:<uid> phone id → {sub, topics, at, syncAt, jobs}   push:e:<phone id> → uid (one owner per phone)
 *          push:q  zset `${uid}|${phone id}|${kind}|${daily ? 1 : 0}|${at}` → at
 * Env: MOM_VAPID_PUBLIC, MOM_VAPID_PRIVATE (npx web-push generate-vapid-keys), MOM_VAPID_SUBJECT (mailto:… or https://…),
 *      MOM_CRON_SECRET or CRON_SECRET, MOM_LINE_MESSAGING_TOKEN, MOM_PUBLIC_URL (links in LINE messages). */
import crypto from 'crypto';
import webpush from 'web-push';

const MAX_DEVICES = 5;
const MAX_JOBS = 24;
const AHEAD_MS = 8 * 86400e3;
const STALE_MS = 7 * 86400e3;
const LATE_MS = 3 * 3600e3; // a reminder more than 3 hours late is dropped, not sent
const DAY_MS = 86400e3;
export const TOPICS = ['gb', 'family', 'remind'];
export const REMINDERS = {
  feed: { title: '餵奶提醒', body: '差不多是寶寶喝奶的時間了', url: '#/home' },
  appt: { title: '預約提醒', body: '今天或明天有預約，打開 App 看看', url: '#/home' },
  chicken: { title: '滴雞精時光', body: '休息一下，溫熱一杯給自己 💜', url: '#/home' },
};
// the push services browsers use; nothing else is ever called with a subscription's address
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
export const pushHost = (endpoint) => {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch (e) { return false; }
};
const B64 = /^[A-Za-z0-9_-]+={0,2}$/;
export function cleanSub(s) {
  if (!s || typeof s !== 'object' || typeof s.endpoint !== 'string' || s.endpoint.length > 800 || !pushHost(s.endpoint)) return null;
  const k = s.keys || {};
  if (typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || !B64.test(k.p256dh) || !B64.test(k.auth) || k.p256dh.length > 200 || k.auth.length > 100) return null;
  return { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}
const cleanTopics = (t) => Object.fromEntries(TOPICS.map((k) => [k, !!(t && t[k])]));
const phoneId = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 20);

export function mountPush(router, {
  store, now, over, wrap, currentUser, env, metrics, http, sender = null,
}) {
  const pub = String(env.MOM_VAPID_PUBLIC || '');
  const priv = String(env.MOM_VAPID_PRIVATE || '');
  const subject = String(env.MOM_VAPID_SUBJECT || '');
  const on = !!(pub && priv && /^(mailto:|https:\/\/)/.test(subject));
  if ((pub || priv) && !on && env.NODE_ENV !== 'test') console.warn('[mom-api] Web Push needs MOM_VAPID_PUBLIC, MOM_VAPID_PRIVATE and MOM_VAPID_SUBJECT (mailto: or https://); it is off.');
  const lineToken = String(env.MOM_LINE_MESSAGING_TOKEN || '');
  const lineOn = !!lineToken;
  const cronSecret = String(env.MOM_CRON_SECRET || env.CRON_SECRET || '');
  const appUrl = String(env.MOM_PUBLIC_URL || '').replace(/\/?$/, '/');
  const send = sender || ((sub, body) => webpush.sendNotification(sub, body, {
    TTL: 6 * 3600, urgency: 'high', timeout: 5000, vapidDetails: { subject, publicKey: pub, privateKey: priv },
  }));
  const devKey = (uid) => `push:d:${uid}`;
  const fail = (res, status, error) => res.status(status).json({ error });

  async function dropDevice(uid, id, dev) {
    const d = dev || await store.hgetJson(devKey(uid), id, now());
    if (!d) return false;
    await Promise.all((d.jobs || []).map((m) => store.zrem('push:q', m)));
    await store.hdel(devKey(uid), id);
    if ((await store.getJson(`push:e:${id}`)) === uid) await store.del(`push:e:${id}`);
    await metrics.total('push', -1);
    return true;
  }
  async function deliver(uid, id, dev, payload) {
    try {
      await send(dev.sub, JSON.stringify(payload));
      await metrics.count('push_sent');
      return 'sent';
    } catch (e) {
      const code = e && (e.statusCode || e.status);
      if (code === 404 || code === 410) { await dropDevice(uid, id, dev); return 'gone'; } // the phone unsubscribed
      if (env.NODE_ENV !== 'test') console.warn('[mom-api] push failed:', code || (e && e.message));
      return 'failed';
    }
  }
  async function linePush(u, p) {
    const to = String(u.account || '').replace(/^line:/, '');
    if (!/^U[0-9a-f]{32}$/.test(to)) return false;
    const link = env.MOM_PUBLIC_URL ? `\n${appUrl}${p.url || ''}` : '';
    try {
      await http.post('https://api.line.me/v2/bot/message/push', { to, messages: [{ type: 'text', text: `${p.title}\n${p.body}${link}`.slice(0, 1000) }] }, { headers: { Authorization: `Bearer ${lineToken}` }, timeout: 5000 });
      await metrics.count('push_sent');
      return true;
    } catch (e) {
      if (env.NODE_ENV !== 'test') console.warn('[mom-api] LINE message failed:', e && e.response ? e.response.status : e && e.message);
      return false;
    }
  }
  // news for members (group-buy progress, family): every phone of theirs that wants this topic, and LINE when asked
  async function notify(uids, topic, payload) {
    if (!TOPICS.includes(topic)) return 0;
    const t = now(); let n = 0;
    await Promise.all([...new Set(uids)].filter(Boolean).map(async (uid) => {
      if (on) {
        const all = await store.hgetAllJson(devKey(uid), t);
        await Promise.all(Object.entries(all).filter(([, d]) => d && d.topics && d.topics[topic]).map(async ([id, d]) => {
          if ((await deliver(uid, id, d, { ...payload, kind: topic })) === 'sent') n += 1;
        }));
      }
      if (lineOn && topic !== 'remind') {
        const u = await store.getUser(uid);
        if (u && u.provider === 'line' && u.lineNotify && await linePush(u, payload)) n += 1;
      }
    }));
    return n;
  }

  // the reminders that are due
  let lastTry = 0;
  async function run(t = now()) {
    if (!on) return { sent: 0 };
    if (!(await store.claimOnce('push-run', 50, t))) return { sent: 0, busy: true };
    let sent = 0; let dropped = 0;
    try {
      const due = await store.zrange('push:q', -Infinity, t, 300);
      for (const { member, score } of due) { // eslint-disable-line no-restricted-syntax
        await store.zrem('push:q', member); // eslint-disable-line no-await-in-loop
        const [uid, id, kind, daily] = member.split('|');
        const dev = await store.hgetJson(devKey(uid), id, t); // eslint-disable-line no-await-in-loop
        if (dev) {
          dev.jobs = (dev.jobs || []).filter((m) => m !== member);
          let gone = false;
          if (dev.topics && dev.topics.remind && REMINDERS[kind]) {
            if (t - score <= LATE_MS) {
              const r = await deliver(uid, id, dev, { ...REMINDERS[kind], tag: `remind-${kind}`, kind: 'remind' }); // eslint-disable-line no-await-in-loop
              if (r === 'sent') sent += 1;
              gone = r === 'gone';
            } else dropped += 1;
          }
          if (!gone) {
            if (daily === '1' && t - (dev.syncAt || 0) < STALE_MS) { // tomorrow at the same time
              let next = score + DAY_MS; while (next <= t) next += DAY_MS;
              const m2 = [uid, id, kind, '1', next].join('|');
              await store.zset('push:q', m2, next); // eslint-disable-line no-await-in-loop
              dev.jobs.push(m2);
            }
            await store.hsetJson(devKey(uid), id, dev, 0, t); // eslint-disable-line no-await-in-loop
          }
        }
      }
    } finally { await store.clearFlag('push-run'); }
    return { sent, dropped };
  }
  const maybeRun = () => {
    const t = now();
    if (!on || t - lastTry < 60e3) return null;
    lastTry = t;
    return run(t).catch(() => null);
  };

  const member = async (req, res, { needPush = true } = {}) => {
    if (needPush && !on) { fail(res, 404, 'push_off'); return null; }
    const user = await currentUser(req);
    if (!user) { fail(res, 401, 'unauthorized'); return null; }
    if (await over('push', user.id, [60, 600])) { fail(res, 429, 'too_many'); return null; }
    return user;
  };
  const myPhone = async (user, endpoint) => {
    if (typeof endpoint !== 'string' || !pushHost(endpoint)) return null;
    const id = phoneId(endpoint);
    const dev = await store.hgetJson(devKey(user.id), id, now());
    return dev ? { id, dev } : null;
  };

  router.post('/push/subscribe', wrap(async (req, res) => {
    const user = await member(req, res); if (!user) return;
    const sub = cleanSub(req.body && req.body.sub);
    if (!sub) { fail(res, 400, 'bad_sub'); return; }
    const t = now();
    const id = phoneId(sub.endpoint);
    // one owner per phone: after a log-out and a log-in as someone else, the phone is hers now
    const owner = await store.getJson(`push:e:${id}`);
    if (owner && owner !== user.id) await dropDevice(owner, id);
    const all = await store.hgetAllJson(devKey(user.id), t);
    const old = all[id];
    if (!old && Object.keys(all).length >= MAX_DEVICES) {
      const [oldest] = Object.entries(all).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
      await dropDevice(user.id, oldest[0], oldest[1]);
    }
    const dev = {
      sub, topics: cleanTopics(req.body.topics), at: (old && old.at) || t, syncAt: t, jobs: (old && old.jobs) || [],
    };
    await store.hsetJson(devKey(user.id), id, dev, 0, t);
    await store.setJson(`push:e:${id}`, user.id);
    if (!old) { await metrics.count('push_sub'); await metrics.total('push', 1); }
    res.json({ ok: true, topics: dev.topics });
  }));

  router.post('/push/unsubscribe', wrap(async (req, res) => {
    const user = await member(req, res); if (!user) return;
    const p = await myPhone(user, req.body && req.body.endpoint);
    if (p) await dropDevice(user.id, p.id, p.dev);
    res.json({ ok: true });
  }));

  router.post('/push/test', wrap(async (req, res) => {
    const user = await member(req, res); if (!user) return;
    if (await over('push-test', user.id, [5, 600])) { fail(res, 429, 'too_many'); return; }
    const p = await myPhone(user, req.body && req.body.endpoint);
    if (!p) { fail(res, 404, 'no_device'); return; }
    const r = await deliver(user.id, p.id, p.dev, {
      title: '通知設定好了 💜', body: '團購進度和提醒，之後都會像這樣通知你', url: '#/reminders', tag: 'test', kind: 'test',
    });
    res.status(r === 'sent' ? 200 : 502).json({ ok: r === 'sent', result: r });
  }));

  router.post('/push/schedule', wrap(async (req, res) => {
    const user = await member(req, res); if (!user) return;
    const p = await myPhone(user, req.body && req.body.endpoint);
    if (!p) { fail(res, 404, 'no_device'); return; }
    const t = now();
    const jobs = Array.isArray(req.body.jobs) ? req.body.jobs.slice(0, MAX_JOBS) : [];
    const members = [];
    jobs.forEach((j) => {
      const at = Math.round(Number(j && j.at));
      if (!j || !REMINDERS[j.kind] || !Number.isFinite(at) || at < t - 60e3 || at > t + AHEAD_MS) return;
      const m = [user.id, p.id, j.kind, j.daily ? '1' : '0', at].join('|');
      if (!members.includes(m)) members.push(m);
    });
    await Promise.all((p.dev.jobs || []).map((m) => store.zrem('push:q', m)));
    await Promise.all(members.map((m) => store.zset('push:q', m, Number(m.split('|')[4]))));
    await store.hsetJson(devKey(user.id), p.id, { ...p.dev, jobs: members, syncAt: t }, 0, t);
    res.json({ ok: true, jobs: members.length });
  }));

  router.post('/push/line', wrap(async (req, res) => {
    const user = await member(req, res, { needPush: false }); if (!user) return;
    if (!lineOn) { fail(res, 404, 'line_off'); return; }
    if (user.provider !== 'line') { fail(res, 400, 'not_line'); return; }
    await store.updateUser(user.id, { lineNotify: !!(req.body && req.body.on) });
    res.json({ ok: true, on: !!(req.body && req.body.on) });
  }));

  const cron = wrap(async (req, res) => {
    if (!cronSecret) { fail(res, 404, 'not_found'); return; }
    const given = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '') || String(req.get('x-cron-secret') || '');
    const a = crypto.createHash('sha256').update(given).digest(); const b = crypto.createHash('sha256').update(cronSecret).digest();
    if (!given || !crypto.timingSafeEqual(a, b)) { fail(res, 401, 'unauthorized'); return; }
    res.json({ ok: true, ...(await run()) });
  });
  router.get('/push/run', cron);
  router.post('/push/run', cron);

  return {
    on,
    lineOn,
    publicKey: () => (on ? pub : null),
    notify,
    run,
    maybeRun,
    // 刪除帳號: every phone and its reminders
    async forget(user) {
      const all = await store.hgetAllJson(devKey(user.id), now());
      for (const [id, d] of Object.entries(all)) await dropDevice(user.id, id, d); // eslint-disable-line no-restricted-syntax, no-await-in-loop
      await store.del(devKey(user.id));
    },
    // 下載我的會員資料: which phones get what (not the phones' push addresses)
    async exportFor(user) {
      const all = await store.hgetAllJson(devKey(user.id), now());
      return {
        phones: Object.values(all).map((d) => ({ since: new Date(d.at).toISOString(), topics: d.topics, reminders: (d.jobs || []).length })),
        line: !!user.lineNotify,
      };
    },
  };
}
