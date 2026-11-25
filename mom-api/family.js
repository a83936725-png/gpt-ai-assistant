/* 家人共用紀錄: a family's phones share the baby's records, end-to-end encrypted.
 *
 * The records are encrypted on the phones (AES-GCM) with a family key that is made on the phone and travels only in
 * the invite link's fragment (after #, which browsers never send to a server). This server keeps ciphertext it cannot
 * read, in the order it arrived, and hands each member the changes since her last sync. It knows who is in which
 * family (member accounts) and how many records there are — never what they say, never the key.
 *
 *   POST /family/create   {label, check}        a new family with me as the owner (label: my name, encrypted;
 *                                               check: a known value encrypted, so a joiner can tell a broken key)
 *   GET  /family                                 my family: members (encrypted labels), seq, invite expiry
 *   POST /family/invite                          a fresh invite (7 days; any member) → {token}
 *   GET  /family/preview?f=&t=                   with a valid invite: how many members, the owner's label, check
 *   POST /family/join     {f, t, label}          join with an invite (at most 8 members; one family per member)
 *   POST /family/label    {label}                change my (encrypted) name
 *   POST /family/remove   {member}               the owner removes someone
 *   POST /family/leave                           leave; the owner leaving ends the family and deletes everything
 *   POST /family/push     {changes: [{r, d} | {r, x: true}]}   up to 200 records (or deletions) → {seq}
 *   GET  /family/pull?since=&limit=              the changes after `since`, oldest first → {changes, seq, more}
 *   POST /family/nudge    {kind: 'handoff'}       交接卡: the others get 「換你顧寶寶囉」 on their phones (fixed words; the
 *                                               card itself travels as an encrypted record)
 * Kept 400 days after the family was last used; ending the family or deleting the owner's account deletes it at once.
 *
 * Storage: fam:<f> {id, owner, createdAt, check, invite: {h, exp}}   fam:m:<f> uid → {mid, role, label, at}
 *          fam:u:<uid> → f   fam:s:<f> seq   fam:r:<f> rid → {s, d} | {s, x: 1}   fam:c:<f> zset rid → seq */
import crypto from 'crypto';

const TTL = 400 * 86400;
const INVITE_MS = 7 * 86400e3;
const MAX_MEMBERS = 8;
const MAX_PUSH = 200;
const MAX_RECORDS = 60000;
const MAX_D = 16000;
const LIMITS = {
  create: [5, 3600], join: [20, 3600], invite: [20, 3600], preview: [60, 600], push: [240, 600], pull: [600, 600], change: [30, 600], nudge: [20, 3600],
};
const RID = /^[A-Za-z0-9_-]{16,44}$/;
const B64 = /^[A-Za-z0-9_-]+$/;
const blob = (v, max) => (typeof v === 'string' && v.length <= max && B64.test(v) ? v : null);
const rnd = (n) => crypto.randomBytes(n).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function mountFamily(router, {
  store, now, over, wrap, currentUser, metrics, notify = async () => 0,
}) {
  const fail = (res, status, error) => res.status(status).json({ error });
  const midOf = (fid, uid) => sha(`${fid}|${uid}`).slice(0, 12);
  const agreed = (u) => !!(u && u.consent && u.consent.version);
  const member = async (req, res, limit) => {
    const user = await currentUser(req);
    if (!user) { fail(res, 401, 'unauthorized'); return null; }
    if (!agreed(user)) { fail(res, 403, 'need_consent'); return null; }
    if (limit && await over(`fam-${limit}`, user.id, LIMITS[limit])) { fail(res, 429, 'too_many'); return null; }
    return user;
  };
  const familyOf = async (uid, t) => {
    const fid = await store.getJson(`fam:u:${uid}`, t);
    if (!fid) return null;
    const fam = await store.getJson(`fam:${fid}`, t);
    const me = fam && await store.hgetJson(`fam:m:${fid}`, uid, t);
    return fam && me ? { fam, me } : null;
  };
  const view = async (fam, uid, t) => {
    const ms = await store.hgetAllJson(`fam:m:${fam.id}`, t);
    return {
      id: fam.id,
      owner: fam.owner === uid,
      seq: await store.getNum(`fam:s:${fam.id}`, t),
      check: fam.check,
      inviteUntil: fam.invite && fam.invite.exp > t ? fam.invite.exp : null,
      members: Object.entries(ms).map(([id, m]) => ({
        mid: m.mid, role: m.role, label: m.label, at: m.at, me: id === uid,
      })).sort((a, b) => a.at - b.at),
    };
  };
  const touch = async (fam, t) => { await store.setJson(`fam:${fam.id}`, { ...fam, lastAt: t }, TTL, t); };
  async function invite(fam, t) {
    const token = rnd(18);
    const next = { ...fam, invite: { h: sha(token), exp: t + INVITE_MS } };
    await store.setJson(`fam:${fam.id}`, next, TTL, t);
    return { token, until: next.invite.exp };
  }
  async function wipe(fam) {
    const ms = await store.hgetAllJson(`fam:m:${fam.id}`, now());
    await Promise.all(Object.keys(ms).map((uid) => store.del(`fam:u:${uid}`)));
    await Promise.all([`fam:${fam.id}`, `fam:m:${fam.id}`, `fam:s:${fam.id}`, `fam:r:${fam.id}`, `fam:c:${fam.id}`].map((k) => store.del(k)));
    await metrics.total('families', -1);
  }
  async function leave(user, t) {
    const f = await familyOf(user.id, t);
    if (!f) return false;
    if (f.fam.owner === user.id) { await wipe(f.fam); return 'ended'; }
    await store.hdel(`fam:m:${f.fam.id}`, user.id);
    await store.del(`fam:u:${user.id}`);
    return 'left';
  }
  const okInvite = (fam, token, t) => !!(fam && fam.invite && fam.invite.exp > t && typeof token === 'string' && token.length <= 64
    && crypto.timingSafeEqual(Buffer.from(sha(token)), Buffer.from(fam.invite.h)));

  router.post('/family/create', wrap(async (req, res) => {
    const user = await member(req, res, 'create'); if (!user) return;
    const t = now();
    if (await familyOf(user.id, t)) { fail(res, 409, 'in_family'); return; }
    const label = blob(req.body && req.body.label, 600); const check = blob(req.body && req.body.check, 600);
    if (!label || !check) { fail(res, 400, 'bad_request'); return; }
    const fid = rnd(12);
    const fam = {
      id: fid, owner: user.id, createdAt: t, lastAt: t, check,
    };
    await store.setJson(`fam:${fid}`, fam, TTL, t);
    await store.hsetJson(`fam:m:${fid}`, user.id, {
      mid: midOf(fid, user.id), role: 'owner', label, at: t,
    }, TTL, t);
    await store.setJson(`fam:u:${user.id}`, fid, TTL, t);
    const inv = await invite(fam, t);
    await metrics.count('family_new'); await metrics.total('families', 1);
    res.status(201).json({ family: await view({ ...fam, invite: { h: '', exp: inv.until } }, user.id, t), invite: inv });
  }));

  router.get('/family', wrap(async (req, res) => {
    const user = await member(req, res); if (!user) return;
    const t = now();
    const f = await familyOf(user.id, t);
    res.json({ family: f ? await view(f.fam, user.id, t) : null });
  }));

  router.post('/family/invite', wrap(async (req, res) => {
    const user = await member(req, res, 'invite'); if (!user) return;
    const t = now();
    const f = await familyOf(user.id, t);
    if (!f) { fail(res, 404, 'no_family'); return; }
    res.json({ invite: await invite(f.fam, t) });
  }));

  // what a joiner sees before joining (her own phone decrypts the owner's name and checks the key with `check`)
  router.get('/family/preview', wrap(async (req, res) => {
    const user = await member(req, res, 'preview'); if (!user) return;
    const t = now();
    const fid = String(req.query.f || '').slice(0, 40);
    const fam = /^[A-Za-z0-9_-]{8,40}$/.test(fid) ? await store.getJson(`fam:${fid}`, t) : null;
    if (!okInvite(fam, String(req.query.t || ''), t)) { fail(res, 404, 'bad_invite'); return; }
    const ms = await store.hgetAllJson(`fam:m:${fid}`, t);
    const owner = ms[fam.owner];
    const mine = await store.getJson(`fam:u:${user.id}`, t);
    res.json({
      members: Object.keys(ms).length, ownerLabel: owner ? owner.label : null, check: fam.check, full: Object.keys(ms).length >= MAX_MEMBERS, already: mine === fid, inOther: !!mine && mine !== fid,
    });
  }));

  router.post('/family/join', wrap(async (req, res) => {
    const user = await member(req, res, 'join'); if (!user) return;
    const t = now();
    const b = req.body || {};
    const fid = String(b.f || '').slice(0, 40);
    const fam = /^[A-Za-z0-9_-]{8,40}$/.test(fid) ? await store.getJson(`fam:${fid}`, t) : null;
    if (!okInvite(fam, b.t, t)) { fail(res, 404, 'bad_invite'); return; }
    const label = blob(b.label, 600);
    if (!label) { fail(res, 400, 'bad_request'); return; }
    const mine = await store.getJson(`fam:u:${user.id}`, t);
    if (mine === fid) { res.json({ family: await view(fam, user.id, t) }); return; }
    if (mine) { fail(res, 409, 'in_family'); return; }
    const ms = await store.hgetAllJson(`fam:m:${fid}`, t);
    if (Object.keys(ms).length >= MAX_MEMBERS) { fail(res, 409, 'full'); return; }
    await store.hsetJson(`fam:m:${fid}`, user.id, {
      mid: midOf(fid, user.id), role: 'member', label, at: t,
    }, TTL, t);
    await store.setJson(`fam:u:${user.id}`, fid, TTL, t);
    await touch(fam, t);
    await metrics.count('family_join');
    // the others hear about it (手機通知, when they asked for family news)
    try {
      await notify(Object.keys(ms), 'family', {
        title: '有家人加入了 💜', body: '你們的共用紀錄多了一位家人，一起記錄吧', url: '#/family', tag: `family-${fid}`,
      });
    } catch (e) { /* never in the way */ }
    res.json({ family: await view(fam, user.id, t) });
  }));

  router.post('/family/label', wrap(async (req, res) => {
    const user = await member(req, res, 'change'); if (!user) return;
    const t = now();
    const f = await familyOf(user.id, t);
    const label = blob(req.body && req.body.label, 600);
    if (!f) { fail(res, 404, 'no_family'); return; }
    if (!label) { fail(res, 400, 'bad_request'); return; }
    await store.hsetJson(`fam:m:${f.fam.id}`, user.id, { ...f.me, label }, TTL, t);
    res.json({ family: await view(f.fam, user.id, t) });
  }));

  router.post('/family/remove', wrap(async (req, res) => {
    const user = await member(req, res, 'change'); if (!user) return;
    const t = now();
    const f = await familyOf(user.id, t);
    if (!f) { fail(res, 404, 'no_family'); return; }
    if (f.fam.owner !== user.id) { fail(res, 403, 'not_owner'); return; }
    const ms = await store.hgetAllJson(`fam:m:${f.fam.id}`, t);
    const [uid] = Object.entries(ms).find(([, m]) => m.mid === String(req.body && req.body.member)) || [];
    if (!uid || uid === user.id) { fail(res, 404, 'no_member'); return; }
    await store.hdel(`fam:m:${f.fam.id}`, uid);
    await store.del(`fam:u:${uid}`);
    // a removed member could still have the old link: a new invite replaces it
    await invite(f.fam, t);
    res.json({ family: await view(await store.getJson(`fam:${f.fam.id}`, t), user.id, t) });
  }));

  router.post('/family/leave', wrap(async (req, res) => {
    const user = await member(req, res, 'change'); if (!user) return;
    const r = await leave(user, now());
    if (!r) { fail(res, 404, 'no_family'); return; }
    res.json({ ok: true, result: r });
  }));

  router.post('/family/push', wrap(async (req, res) => {
    const user = await member(req, res, 'push'); if (!user) return;
    const t = now();
    const f = await familyOf(user.id, t);
    if (!f) { fail(res, 404, 'no_family'); return; }
    const list = Array.isArray(req.body && req.body.changes) ? req.body.changes : [];
    if (!list.length) { res.json({ seq: await store.getNum(`fam:s:${f.fam.id}`, t) }); return; }
    if (list.length > MAX_PUSH) { fail(res, 413, 'too_many_changes'); return; }
    const seen = new Set(); const ok = [];
    for (const c of list) { // eslint-disable-line no-restricted-syntax
      const rid = c && typeof c.r === 'string' && RID.test(c.r) ? c.r : null;
      const d = c && c.x === true ? null : blob(c && c.d, MAX_D);
      if (!rid || (!d && c.x !== true) || seen.has(rid)) { fail(res, 400, 'bad_change'); return; }
      seen.add(rid); ok.push({ rid, d });
    }
    const fid = f.fam.id;
    if ((await store.hlen(`fam:r:${fid}`, t)) + ok.length > MAX_RECORDS) { fail(res, 507, 'family_full'); return; }
    const end = await store.incrBy(`fam:s:${fid}`, ok.length, TTL, t); // a block of numbers, in the order received
    const first = end - ok.length + 1;
    await store.hsetManyJson(`fam:r:${fid}`, ok.map((c, i) => [c.rid, c.d ? { s: first + i, d: c.d } : { s: first + i, x: 1 }]), TTL, t);
    await store.zsetMany(`fam:c:${fid}`, ok.map((c, i) => [c.rid, first + i]));
    await touch(f.fam, t);
    res.json({ seq: end });
  }));

  router.get('/family/pull', wrap(async (req, res) => {
    const user = await member(req, res, 'pull'); if (!user) return;
    const t = now();
    const f = await familyOf(user.id, t);
    if (!f) { fail(res, 404, 'no_family'); return; }
    const since = Math.max(0, parseInt(req.query.since, 10) || 0);
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 300));
    const fid = f.fam.id;
    const rows = await store.zrange(`fam:c:${fid}`, since + 1, Infinity, limit);
    const recs = await store.hmgetJson(`fam:r:${fid}`, rows.map((r) => r.member), t);
    const changes = rows.map((r, i) => {
      const v = recs[i] || {};
      return v.x ? { r: r.member, s: r.score, x: true } : { r: r.member, s: r.score, d: v.d };
    }).filter((c) => c.x || c.d);
    res.json({ changes, seq: await store.getNum(`fam:s:${fid}`, t), more: rows.length === limit });
  }));

  // 交接卡: tell the others it is their turn (the words are fixed here; what was handed over is in the encrypted records)
  router.post('/family/nudge', wrap(async (req, res) => {
    const user = await member(req, res, 'nudge'); if (!user) return;
    if (!req.body || req.body.kind !== 'handoff') { fail(res, 400, 'bad_request'); return; }
    const t = now();
    const f = await familyOf(user.id, t);
    if (!f) { fail(res, 404, 'no_family'); return; }
    const others = Object.keys(await store.hgetAllJson(`fam:m:${f.fam.id}`, t)).filter((uid) => uid !== user.id);
    let sent = 0;
    try {
      sent = await notify(others, 'family', {
        title: '換你顧寶寶囉 💜', body: '家人把交接卡傳給你了，打開 App 看看', url: '#/home', tag: `handoff-${f.fam.id}`,
      });
    } catch (e) { sent = 0; }
    await metrics.count('handoff');
    res.json({ ok: true, sent });
  }));

  return {
    // 刪除帳號: she leaves; an owner's family ends (its records are deleted)
    async forget(user) { await leave(user, now()); },
    async exportFor(user) {
      const f = await familyOf(user.id, now());
      return f ? {
        family: f.fam.id, role: f.me.role, joinedAt: new Date(f.me.at).toISOString(), note: '共用紀錄在伺服器上是加密的，只有家人手機上的金鑰能打開。',
      } : null;
    },
  };
}

export default mountFamily;
