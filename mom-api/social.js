/* Social features of the member API (mounted by index.js):
 *
 * 島上的媽媽 — moms who chose to show up on the islands see each other's chibi and can send a preset reaction
 *   (👋 wave, 💜 heart, 🌸 cheer, 🤗 hug). There is no free text between strangers, so there is nothing to moderate
 *   except the short display name, which other moms can report.
 *   POST /social/here   {key, island, av, name, look}  heartbeat → {me, inbox, people (on `look`), counts}
 *   GET  /social/counts                                how many moms are on each island right now (anonymous)
 *   POST /social/react  {key, to, kind}
 *   POST /social/leave  {key}                          stop showing me now
 *   POST /social/block  {key, nid}                     never show / ping me from this mom again (/social/unblock undoes it)
 *   POST /social/report {key, nid}                     3 reports hide that mom's name
 *   `key` is a random secret kept on the phone; others only ever see `nid`, derived from it with the server secret,
 *   so nobody can read someone else's reactions or speak for them.
 *   What leaves the phone: the chibi's colours and style (never the face photo), the island (= stage, coarse),
 *   an optional name of up to 10 characters. Nothing from the health records.
 *
 * 祝福牆 — a mom makes a wall for 滿月／百日／週歲 (or 好孕加油 while pregnant) and shares the link; family and friends
 *   leave a blessing without installing anything; it shows only after the mom approves it.
 *   POST /wall {occasion, baby, mom, av}  → {id, key}      GET  /wall/:id   (approved blessings only)
 *   POST /wall/:id/wish {name, text, sticker}               POST /wall/:id/admin {key}  (everything, for the owner)
 *   POST /wall/:id/moderate {key, wid, action}              POST /wall/:id/delete {key} */
import crypto from 'crypto';
import { cleanText, hashKey, safeEqual } from './auth.js';

export const ISLAND_IDS = ['prep', 'preg1', 'preg2', 'preg3', 'newborn', 'infant', 'crawl', 'y1', 'y2', 'y3', 'y4'];
export const REACTIONS = ['wave', 'heart', 'cheer', 'hug'];
export const OCCASIONS = ['preg', 'month', 'hundred', 'year'];
export const STICKERS = ['💜', '🎉', '🌸', '🍼', '🎂', '⭐', '🧸', '🌈'];
const HAIR_STYLES = ['long', 'pony', 'bun', 'bob', 'short', 'curly'];
const EYES = ['round', 'smile', 'lash'];
const POSES = ['preg', 'baby', 'plain'];
const HERE_MS = 2 * 60 * 1000; // "on the island" = a heartbeat in the last 2 minutes
const DAY = 86400;
const LIMITS = {
  here: [80, 600], // the app beats every 20–60 s, plus when the map moves to another island
  newIdentity: [6, 3600], // a network can bring at most 6 new island identities an hour
  react: [60, 600],
  manage: [60, 600], // block / report / leave
  wallNew: [6, DAY],
  wishIp: [20, 3600],
  wishWallIp: [6, 3600],
  wallAdmin: [120, 600],
  wallRead: [240, 600],
};
const WALL_TTL = 400 * DAY;
const MAX_WISHES = 300;

const b62 = (n) => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(n), (x) => A[x % A.length]).join('');
};
const okKey = (k) => (typeof k === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(k) ? k : '');
const okNid = (k) => (typeof k === 'string' && /^[A-Za-z0-9_-]{16}$/.test(k) ? k : '');
const hex = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toLowerCase() : fallback);

// links, e-mail, LINE ids and phone numbers are not allowed in names or blessings (spam, and nobody's contact
// details end up on a page that anyone with the link can read)
const scrub = (s) => String(s || '')
  .replace(/https?:\/\/\S*/gi, '')
  .replace(/\bwww\.\S*/gi, '')
  .replace(/\S+\.(com|net|org|tw|io|me|cc|co|ly|gl|xyz|top|info)\b(\/\S*)?/gi, '')
  .replace(/\S*@\S*/g, '')
  .replace(/line\s*id\s*[:：]?\s*\S+/gi, '')
  .replace(/\d[\d\s-]{4,}\d/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim();
export const cleanName = (s, max = 10) => cleanText(scrub(cleanText(s, 40)), max);
export const cleanWish = (s, max = 60) => cleanText(scrub(String(s || '').replace(/[\r\n\t]+/g, ' ').slice(0, 200)), max);

export function cleanAvatar(av) {
  const a = av && typeof av === 'object' ? av : {};
  return {
    skin: hex(a.skin, '#f6d2b8'),
    hair: hex(a.hair, '#3a2a24'),
    outfit: hex(a.outfit, '#8b57a8'),
    style: HAIR_STYLES.includes(a.style) ? a.style : 'long',
    eyes: EYES.includes(a.eyes) ? a.eyes : 'round',
    glasses: !!a.glasses,
    blush: a.blush !== false,
    pose: POSES.includes(a.pose) ? a.pose : 'plain',
  };
}

// one identity for everything social (島上的媽媽, 同週好孕圈): the phone's private key → a public id; a network can
// bring at most a few new identities an hour, so nobody can stuff a poll or a count with made-up moms
export function makeIdentity({
  store, secret, over, clientIp,
}) {
  const nidOf = (key) => crypto.createHmac('sha256', secret).update(`soc:${key}`).digest('base64').replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 16)
    .padEnd(16, 'x');
  // false when this network has brought too many new identities lately
  async function admit(req, nid, t) {
    if (await store.hasFlag(`socknown:${nid}`, t)) return true;
    if (await over('soc-new', clientIp(req), LIMITS.newIdentity)) return false;
    await store.setFlag(`socknown:${nid}`, 60 * DAY, t);
    return true;
  }
  return { nidOf, admit, okKey };
}

export function mountSocial(router, {
  store, now, secret, over, clientIp, wrap, metrics = { count: async () => {} },
}) {
  const { nidOf, admit } = makeIdentity({
    store, secret, over, clientIp,
  });
  let countsCache = null;
  async function counts(t) {
    if (countsCache && t - countsCache.at < 15000) return countsCache.counts;
    const n = await Promise.all(ISLAND_IDS.map((id) => store.zcountSince(`soc:isl:${id}`, t - HERE_MS)));
    const c = {}; ISLAND_IDS.forEach((id, i) => { if (n[i]) c[id] = n[i]; });
    countsCache = { at: t, counts: c };
    return c;
  }
  const publicPerson = (p) => ({
    nid: p.nid, island: p.island, av: p.av, name: p.name || '', hearts: p.hearts || 0,
  });

  /* ---------------- 島上的媽媽 ---------------- */
  router.get('/social/counts', wrap(async (req, res) => { res.json({ counts: await counts(now()) }); }));

  router.post('/social/here', wrap(async (req, res) => {
    const b = req.body || {};
    const key = okKey(b.key);
    if (!key) { res.status(400).json({ error: 'bad_key' }); return; }
    if (!ISLAND_IDS.includes(b.island)) { res.status(400).json({ error: 'bad_island' }); return; }
    const look = ISLAND_IDS.includes(b.look) ? b.look : b.island;
    if (await over('soc-here', key, LIMITS.here)) { res.status(429).json({ error: 'too_many' }); return; }
    const t = now();
    const nid = nidOf(key);
    const prev = await store.getJson(`soc:p:${nid}`, t);
    if (!prev && !(await admit(req, nid, t))) { res.status(429).json({ error: 'too_many' }); return; }
    const [hearts, reports] = await Promise.all([store.getNum(`soc:h:${nid}`, t), store.getNum(`soc:rep:${nid}`, t)]);
    const me = {
      nid, island: b.island, av: cleanAvatar(b.av), name: reports >= 3 ? '' : cleanName(b.name), hearts, ts: t,
    };
    if (prev && prev.island !== me.island) await store.zrem(`soc:isl:${prev.island}`, nid);
    await store.setJson(`soc:p:${nid}`, me, 600, t);
    await store.zset(`soc:isl:${me.island}`, nid, t);
    const [inbox, blocked, ids] = await Promise.all([
      store.drain(`soc:in:${nid}`, t),
      store.hgetAllJson(`soc:bl:${nid}`, t),
      store.zrecent(`soc:isl:${look}`, t - HERE_MS, 40),
    ]);
    const others = ids.filter((id) => id !== nid && !blocked[id]).slice(0, 24);
    const people = (await Promise.all(others.map((id) => store.getJson(`soc:p:${id}`, t)))).filter(Boolean).map(publicPerson);
    if (!prev || prev.island !== me.island) countsCache = null; // someone just arrived: the counts include them
    res.json({
      me: {
        nid, hearts, name: me.name, hidden: reports >= 3,
      },
      inbox: inbox.filter((m) => m && m.from && !blocked[m.from.nid]).slice(0, 30),
      people,
      counts: await counts(t),
    });
  }));

  // the caller must be on the islands (joined and online) to do anything to others
  const caller = async (req, res, limit) => {
    const key = okKey(req.body && req.body.key);
    if (!key) { res.status(400).json({ error: 'bad_key' }); return null; }
    const nid = nidOf(key);
    if (await over(`soc-${limit}`, nid, LIMITS[limit])) { res.status(429).json({ error: 'too_many' }); return null; }
    return { nid, me: await store.getJson(`soc:p:${nid}`, now()) };
  };

  router.post('/social/react', wrap(async (req, res) => {
    const c = await caller(req, res, 'react'); if (!c) return;
    const to = okNid(req.body.to); const { kind } = req.body;
    if (!to || to === c.nid || !REACTIONS.includes(kind)) { res.status(400).json({ error: 'bad_request' }); return; }
    if (!c.me) { res.status(403).json({ error: 'not_here' }); return; }
    const t = now();
    const target = await store.getJson(`soc:p:${to}`, t);
    if (!target) { res.status(404).json({ error: 'gone' }); return; }
    // one of each kind per pair per 30 minutes: friendly, never a flood of pings
    if (!(await store.claimOnce(`socr:${c.nid}:${to}:${kind}`, 1800, t))) { res.json({ ok: true, again: true }); return; }
    if (await store.hgetJson(`soc:bl:${to}`, c.nid, t)) { res.json({ ok: true }); return; } // blocked: silently dropped
    await store.pushCapped(`soc:in:${to}`, {
      kind,
      at: t,
      from: {
        nid: c.nid, name: c.me.name || '', island: c.me.island, av: c.me.av,
      },
    }, 30, 7 * DAY, t);
    if (kind === 'heart') await store.incrBy(`soc:h:${to}`, 1, 180 * DAY, t);
    await metrics.count('wave');
    res.json({ ok: true });
  }));

  router.post('/social/leave', wrap(async (req, res) => {
    const c = await caller(req, res, 'manage'); if (!c) return;
    if (c.me) await store.zrem(`soc:isl:${c.me.island}`, c.nid);
    await store.del(`soc:p:${c.nid}`);
    countsCache = null;
    res.json({ ok: true });
  }));

  router.post('/social/block', wrap(async (req, res) => {
    const c = await caller(req, res, 'manage'); if (!c) return;
    const nid = okNid(req.body.nid);
    if (!nid || nid === c.nid) { res.status(400).json({ error: 'bad_request' }); return; }
    if (await store.hlen(`soc:bl:${c.nid}`, now()) >= 500) { res.status(409).json({ error: 'full' }); return; }
    await store.hsetJson(`soc:bl:${c.nid}`, nid, 1, 365 * DAY, now());
    res.json({ ok: true });
  }));

  router.post('/social/unblock', wrap(async (req, res) => {
    const c = await caller(req, res, 'manage'); if (!c) return;
    const nid = okNid(req.body.nid);
    if (!nid) { res.status(400).json({ error: 'bad_request' }); return; }
    await store.hdel(`soc:bl:${c.nid}`, nid);
    res.json({ ok: true });
  }));

  router.post('/social/report', wrap(async (req, res) => {
    const c = await caller(req, res, 'manage'); if (!c) return;
    const nid = okNid(req.body.nid);
    if (!nid || nid === c.nid) { res.status(400).json({ error: 'bad_request' }); return; }
    if (!c.me) { res.status(403).json({ error: 'not_here' }); return; } // only moms on the islands can report
    const t = now();
    await store.hsetJson(`soc:bl:${c.nid}`, nid, 1, 365 * DAY, t); // reporting also blocks
    if (await store.claimOnce(`socrep:${nid}:${c.nid}`, 30 * DAY, t)) await store.incrBy(`soc:rep:${nid}`, 1, 30 * DAY, t);
    res.json({ ok: true });
  }));

  /* ---------------- 祝福牆 ---------------- */
  const okWall = (id) => (/^[A-Za-z0-9]{10}$/.test(String(id || '')) ? id : '');
  const publicWall = (w) => ({
    id: w.id, occasion: w.occasion, baby: w.baby, mom: w.mom, av: w.av, createdAt: w.createdAt,
  });
  const loadWall = async (req, res) => {
    const id = okWall(req.params.id);
    const w = id ? await store.getJson(`wall:${id}`, now()) : null;
    if (!w) { res.status(404).json({ error: 'no_wall' }); return null; }
    return w;
  };
  const owner = async (req, res) => {
    if (await over('wall-admin', clientIp(req), LIMITS.wallAdmin)) { res.status(429).json({ error: 'too_many' }); return null; }
    const w = await loadWall(req, res); if (!w) return null;
    const key = okKey(req.body && req.body.key);
    if (!key || !safeEqual(hashKey(`wall:${key}`), w.keyHash)) { res.status(403).json({ error: 'not_owner' }); return null; }
    return w;
  };
  const wishList = async (id, all) => {
    const m = await store.hgetAllJson(`wall:${id}:w`, now());
    return Object.values(m).filter((x) => all || x.ok).sort((a, b) => a.at - b.at);
  };

  router.post('/wall', wrap(async (req, res) => {
    const b = req.body || {};
    if (!OCCASIONS.includes(b.occasion)) { res.status(400).json({ error: 'bad_occasion' }); return; }
    if (await over('wall-new', clientIp(req), LIMITS.wallNew)) { res.status(429).json({ error: 'too_many' }); return; }
    const t = now();
    const key = b62(24);
    const w = {
      id: b62(10), occasion: b.occasion, baby: cleanName(b.baby) || '寶寶', mom: cleanName(b.mom), av: b.av ? cleanAvatar(b.av) : null, keyHash: hashKey(`wall:${key}`), createdAt: t,
    };
    await store.setJson(`wall:${w.id}`, w, WALL_TTL, t);
    await metrics.count('wall_new');
    res.status(201).json({ id: w.id, key, wall: publicWall(w) });
  }));

  router.get('/wall/:id', wrap(async (req, res) => {
    if (await over('wall-read', clientIp(req), LIMITS.wallRead)) { res.status(429).json({ error: 'too_many' }); return; }
    const w = await loadWall(req, res); if (!w) return;
    const wishes = (await wishList(w.id, false)).map(({ ok, ...x }) => x); // eslint-disable-line no-unused-vars
    res.json({ wall: publicWall(w), wishes });
  }));

  router.post('/wall/:id/wish', wrap(async (req, res) => {
    const w = await loadWall(req, res); if (!w) return;
    const b = req.body || {};
    const text = cleanWish(b.text);
    if (!text) { res.status(400).json({ error: 'empty' }); return; }
    const ip = clientIp(req);
    if (await over('wish-ip', ip, LIMITS.wishIp) || await over('wish-wall-ip', `${w.id}|${ip}`, LIMITS.wishWallIp)) { res.status(429).json({ error: 'too_many' }); return; }
    const t = now();
    if (await store.hlen(`wall:${w.id}:w`, t) >= MAX_WISHES) { res.status(409).json({ error: 'full' }); return; }
    const wish = {
      id: b62(8), name: cleanName(b.name) || '親友', text, sticker: STICKERS.includes(b.sticker) ? b.sticker : '💜', at: t, ok: false,
    };
    await store.hsetJson(`wall:${w.id}:w`, wish.id, wish, Math.max(60, Math.round((w.createdAt + WALL_TTL * 1000 - t) / 1000)), t);
    await metrics.count('wall_wish');
    res.status(201).json({ ok: true, wish: { ...wish, ok: undefined }, pending: true });
  }));

  router.post('/wall/:id/admin', wrap(async (req, res) => {
    const w = await owner(req, res); if (!w) return;
    res.json({ wall: publicWall(w), wishes: await wishList(w.id, true) });
  }));

  router.post('/wall/:id/moderate', wrap(async (req, res) => {
    const w = await owner(req, res); if (!w) return;
    const { action } = req.body;
    const t = now();
    const ttl = Math.max(60, Math.round((w.createdAt + WALL_TTL * 1000 - t) / 1000));
    if (action === 'approveAll') {
      const all = await wishList(w.id, true);
      await Promise.all(all.filter((x) => !x.ok).map((x) => store.hsetJson(`wall:${w.id}:w`, x.id, { ...x, ok: true }, ttl, t)));
    } else {
      const wid = String(req.body.wid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
      const wish = wid ? await store.hgetJson(`wall:${w.id}:w`, wid, t) : null;
      if (!wish) { res.status(404).json({ error: 'no_wish' }); return; }
      if (action === 'approve') await store.hsetJson(`wall:${w.id}:w`, wid, { ...wish, ok: true }, ttl, t);
      else if (action === 'hide') await store.hsetJson(`wall:${w.id}:w`, wid, { ...wish, ok: false }, ttl, t);
      else if (action === 'remove') await store.hdel(`wall:${w.id}:w`, wid);
      else { res.status(400).json({ error: 'bad_action' }); return; }
    }
    res.json({ wishes: await wishList(w.id, true) });
  }));

  router.post('/wall/:id/delete', wrap(async (req, res) => {
    const w = await owner(req, res); if (!w) return;
    await store.del(`wall:${w.id}`);
    await store.del(`wall:${w.id}:w`);
    res.json({ ok: true });
  }));
}
