import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import express from 'express';
import axios from 'axios';
import { createMomRouter } from '../../mom-api/index.js';
import { MemoryStore, RedisRestStore } from '../../mom-api/store.js';
import { cleanName, cleanWish, cleanAvatar } from '../../mom-api/social.js';

const api = axios.create({ validateStatus: () => true });
async function serve(router) {
  const app = express();
  app.set('trust proxy', false);
  app.use('/mom-app/api', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}/mom-app/api` };
}
const close = (s) => new Promise((r) => s.close(r));
const KEY = (n) => `test-key-${String(n).padStart(4, '0')}-abcdefgh`;
const AV = {
  skin: '#eec2a0', hair: '#251916', outfit: '#8b57a8', style: 'pony', eyes: 'lash', glasses: true, blush: false, pose: 'preg',
};

/* a tiny Redis emulator: just the commands the store uses */
function fakeRedis() {
  const kv = new Map(); const sets = new Map(); const zsets = new Map(); const hashes = new Map(); const lists = new Map(); const ttl = new Map();
  const z = (k) => { if (!zsets.has(k)) zsets.set(k, new Map()); return zsets.get(k); };
  const hm = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };
  const bound = (v) => {
    const s = String(v);
    if (s === '+inf') return [Infinity, false];
    if (s === '-inf') return [-Infinity, false];
    if (s.startsWith('(')) return [Number(s.slice(1)), true];
    return [Number(s), false];
  };
  const inRange = (sc, lo, hi) => {
    const [l, lx] = bound(lo); const [h, hx] = bound(hi);
    return (lx ? sc > l : sc >= l) && (hx ? sc < h : sc <= h);
  };
  const run = ([cmd, ...a]) => {
    switch (cmd) {
      case 'GET': return kv.has(a[0]) ? kv.get(a[0]) : null;
      case 'SET': {
        const opts = a.slice(2).map(String);
        if (opts.includes('NX') && kv.has(a[0])) return null;
        kv.set(a[0], String(a[1]));
        const ex = opts.indexOf('EX'); if (ex >= 0) ttl.set(a[0], Number(opts[ex + 1]));
        return 'OK';
      }
      case 'DEL': kv.delete(a[0]); hashes.delete(a[0]); lists.delete(a[0]); zsets.delete(a[0]); return 1;
      case 'INCR': { const v = Number(kv.get(a[0]) || 0) + 1; kv.set(a[0], String(v)); return v; }
      case 'INCRBY': { const v = Number(kv.get(a[0]) || 0) + Number(a[1]); kv.set(a[0], String(v)); return v; }
      case 'EXPIRE': ttl.set(a[0], Number(a[1])); return 1;
      case 'EXISTS': return kv.has(a[0]) ? 1 : 0;
      case 'TTL': return ttl.has(a[0]) ? ttl.get(a[0]) : -1;
      case 'EVAL': {
        const [script, , key, ...args] = a;
        if (script.includes("redis.call('INCR'")) { const v = Number(kv.get(key) || 0) + 1; kv.set(key, String(v)); if (!ttl.has(key)) ttl.set(key, Number(args[0])); return v; }
        if (script.includes("redis.call('LPUSH'")) {
          const l = lists.get(key) || []; l.unshift(String(args[0])); l.length = Math.min(l.length, Number(args[1])); lists.set(key, l); ttl.set(key, Number(args[2])); return 1;
        }
        if (script.includes("redis.call('LRANGE'")) { const l = lists.get(key) || []; lists.delete(key); return l; }
        throw new Error(`unexpected script ${script}`);
      }
      case 'SADD': { if (!sets.has(a[0])) sets.set(a[0], new Set()); sets.get(a[0]).add(a[1]); return 1; }
      case 'SCARD': return sets.has(a[0]) ? sets.get(a[0]).size : 0;
      case 'ZADD': z(a[0]).set(String(a[2]), Number(a[1])); return 1;
      case 'ZREM': return z(a[0]).delete(String(a[1])) ? 1 : 0;
      case 'ZSCORE': return z(a[0]).has(a[1]) ? String(z(a[0]).get(a[1])) : null;
      case 'ZCOUNT': return [...z(a[0]).values()].filter((s) => inRange(s, a[1], a[2])).length;
      case 'ZREMRANGEBYSCORE': { const m = z(a[0]); let n = 0; [...m].forEach(([k, s]) => { if (inRange(s, a[1], a[2])) { m.delete(k); n += 1; } }); return n; }
      case 'ZREVRANGEBYSCORE': {
        const lim = a.indexOf('LIMIT');
        const rows = [...z(a[0])].filter(([, s]) => inRange(s, a[2], a[1])).sort((x, y) => y[1] - x[1]).map(([k]) => k);
        return lim >= 0 ? rows.slice(Number(a[lim + 1]), Number(a[lim + 1]) + Number(a[lim + 2])) : rows;
      }
      case 'HSET': hm(a[0]).set(String(a[1]), String(a[2])); return 1;
      case 'HGET': return hm(a[0]).has(a[1]) ? String(hm(a[0]).get(a[1])) : null;
      case 'HGETALL': return [...hm(a[0])].flat();
      case 'HDEL': return hm(a[0]).delete(String(a[1])) ? 1 : 0;
      case 'HLEN': return hm(a[0]).size;
      case 'HEXISTS': return hm(a[0]).has(a[1]) ? 1 : 0;
      case 'HINCRBY': { const v = Number(hm(a[0]).get(a[1]) || 0) + Number(a[2]); hm(a[0]).set(a[1], v); return v; }
      default: throw new Error(`unsupported ${cmd}`);
    }
  };
  return { kv, ttl, lists, post: async (url, args) => ({ data: { result: run(args) } }) };
}

describe('text and avatar cleaning', () => {
  test('names and blessings lose links, e-mail, LINE ids and phone numbers', () => {
    expect(cleanName('小美 https://spam.example/x')).toBe('小美');
    expect(cleanName('買便宜奶粉 0912-345-678')).toBe('買便宜奶粉');
    expect(cleanName('<b>阿嬤</b>')).toBe('b阿嬤/b');
    expect(cleanName('一二三四五六七八九十十一')).toHaveLength(10);
    expect(cleanWish('滿月快樂！加 line id: abc123 領好禮')).toBe('滿月快樂！加 領好禮');
    expect(cleanWish('寶寶好可愛 www.spam.tw 看這裡')).toBe('寶寶好可愛 看這裡');
    expect(cleanWish('Happy.Cool 寶寶')).toBe('Happy.Cool 寶寶'); // not a link
    expect(cleanWish('mail me a@b.com')).toBe('mail me');
    expect(cleanWish('第一行\n第二行')).toBe('第一行 第二行');
    expect(cleanWish('   ')).toBe('');
  });
  test('only the chibi\'s colours and style are kept: never a face photo or anything else', () => {
    const av = cleanAvatar({
      ...AV, mode: 'photo', face: 'data:image/jpeg;base64,AAAA', skin: 'red;background:url(x)', extra: 1,
    });
    expect(av).toEqual({ ...AV, skin: '#f6d2b8' });
    expect(JSON.stringify(av)).not.toContain('data:');
    expect(cleanAvatar(null).style).toBe('long');
  });
});

function socialFlows(label, makeStore) {
  describe(`島上的媽媽 (${label})`, () => {
    let clock = Date.UTC(2026, 10, 19, 4, 0, 0);
    let srv; let base;
    beforeAll(async () => {
      ({ server: srv, base } = await serve(createMomRouter({ store: makeStore(), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 'x'.repeat(40) }, now: () => clock })));
    });
    afterAll(() => close(srv));
    const here = (n, body = {}) => api.post(`${base}/social/here`, {
      key: KEY(n), island: 'preg2', av: AV, name: `媽咪${n}`, ...body,
    });

    test('input is checked', async () => {
      expect((await api.post(`${base}/social/here`, { key: 'short', island: 'preg2' })).status).toBe(400);
      expect((await api.post(`${base}/social/here`, { key: KEY(1), island: 'mars' })).status).toBe(400);
      expect((await api.get(`${base}/config`)).data.social).toBe(true);
    });

    let nid1; let nid2; let nid3;
    test('moms on the same island see each other (chibi + name), counts are anonymous', async () => {
      const a = await here(1);
      expect(a.status).toBe(200);
      nid1 = a.data.me.nid;
      expect(nid1).toMatch(/^[A-Za-z0-9]{16}$/);
      expect(a.data.people).toEqual([]);
      const b = await here(2, { name: '小美 0912345678', av: { ...AV, face: 'data:image/png;base64,AAA', mode: 'photo' } });
      nid2 = b.data.me.nid;
      expect(b.data.people).toHaveLength(1);
      expect(b.data.people[0]).toEqual({
        nid: nid1, island: 'preg2', av: AV, name: '媽咪1', hearts: 0,
      });
      expect(JSON.stringify(b.data)).not.toContain(KEY(1)); // the secret key never leaves the server
      const a2 = await here(1);
      expect(a2.data.people[0].name).toBe('小美'); // the phone number was dropped
      expect(JSON.stringify(a2.data.people)).not.toContain('data:image');
      expect(a2.data.counts).toEqual({ preg2: 2 });
      const c = await here(3, { island: 'newborn', name: '' });
      nid3 = c.data.me.nid;
      expect(c.data.people).toEqual([]); // looking at their own island
      const look = await here(3, { island: 'newborn', look: 'preg2' });
      expect(look.data.people.map((p) => p.nid).sort()).toEqual([nid1, nid2].sort());
      expect((await api.get(`${base}/social/counts`)).data.counts).toEqual({ preg2: 2, newborn: 1 });
    });

    test('preset reactions arrive once in the other mom\'s inbox; hearts add up', async () => {
      expect((await api.post(`${base}/social/react`, { key: KEY(1), to: nid2, kind: 'wave' })).data.ok).toBe(true);
      expect((await api.post(`${base}/social/react`, { key: KEY(1), to: nid2, kind: 'heart' })).data.ok).toBe(true);
      const again = await api.post(`${base}/social/react`, { key: KEY(1), to: nid2, kind: 'wave' });
      expect(again.data).toEqual({ ok: true, again: true }); // no second ping within 30 minutes
      const b = await here(2);
      expect(b.data.inbox.map((m) => m.kind).sort()).toEqual(['heart', 'wave']);
      expect(b.data.inbox[0].from).toMatchObject({ nid: nid1, name: '媽咪1', island: 'preg2' });
      expect(b.data.me.hearts).toBe(1);
      expect((await here(2)).data.inbox).toEqual([]); // read once
      expect((await here(1)).data.people.find((p) => p.nid === nid2).hearts).toBe(1);
    });

    test('reactions: only preset kinds, not to yourself, only while on the islands, only to someone there', async () => {
      expect((await api.post(`${base}/social/react`, { key: KEY(1), to: nid2, kind: 'text:hello' })).status).toBe(400);
      expect((await api.post(`${base}/social/react`, { key: KEY(1), to: nid1, kind: 'wave' })).status).toBe(400);
      expect((await api.post(`${base}/social/react`, { key: KEY(99), to: nid1, kind: 'wave' })).status).toBe(403);
      expect((await api.post(`${base}/social/react`, { key: KEY(1), to: 'AAAAAAAAAAAAAAAA', kind: 'wave' })).status).toBe(404);
    });

    test('block: that mom disappears and her reactions are dropped without telling her', async () => {
      expect((await api.post(`${base}/social/block`, { key: KEY(2), nid: nid1 })).data.ok).toBe(true);
      expect((await api.post(`${base}/social/react`, { key: KEY(1), to: nid2, kind: 'hug' })).data.ok).toBe(true);
      const b = await here(2);
      expect(b.data.inbox).toEqual([]);
      expect(b.data.people.map((p) => p.nid)).not.toContain(nid1);
      await api.post(`${base}/social/unblock`, { key: KEY(2), nid: nid1 });
      expect((await here(2)).data.people.map((p) => p.nid)).toContain(nid1);
      await api.post(`${base}/social/block`, { key: KEY(2), nid: nid1 });
    });

    test('three reports hide a name', async () => {
      await here(4); await here(5);
      for (const n of [3, 4, 5]) {
        if (n === 3) await here(3, { island: 'newborn' }); // eslint-disable-line no-await-in-loop
        expect((await api.post(`${base}/social/report`, { key: KEY(n), nid: nid1 })).data.ok).toBe(true); // eslint-disable-line no-await-in-loop
      }
      await api.post(`${base}/social/report`, { key: KEY(5), nid: nid1 }); // the same mom twice counts once
      const a = await here(1, { name: '亂取的名字' });
      expect(a.data.me.hidden).toBe(true);
      expect(a.data.me.name).toBe('');
      expect((await here(6)).data.people.find((p) => p.nid === nid1).name).toBe('');
      expect((await api.post(`${base}/social/report`, { key: KEY(77), nid: nid1 })).status).toBe(403); // not on the islands
    });

    test('moving island, leaving, and going quiet all take a mom off the island', async () => {
      await here(2, { island: 'preg3' });
      expect((await here(6)).data.people.map((p) => p.nid)).not.toContain(nid2);
      await api.post(`${base}/social/leave`, { key: KEY(4) });
      const six = await here(6);
      expect(six.data.people.map((p) => p.nid)).not.toContain(nid3);
      expect(six.data.people).toHaveLength(2); // 1 and 5 (4 left)
      clock += 3 * 60 * 1000; // nobody else beat for 3 minutes
      expect((await here(6)).data.people).toEqual([]);
      expect((await api.get(`${base}/social/counts`)).data.counts).toEqual({ preg2: 1 });
    });

    test('one network can only bring a few new identities an hour', async () => {
      const codes = [];
      for (let n = 200; n < 210; n += 1) codes.push((await here(n)).status); // eslint-disable-line no-await-in-loop
      expect(codes).toContain(429);
      expect((await here(6)).status).toBe(200); // a known mom keeps going
    });
  });

  describe(`祝福牆 (${label})`, () => {
    let srv; let base;
    beforeAll(async () => {
      ({ server: srv, base } = await serve(createMomRouter({ store: makeStore(), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 'y'.repeat(40) } })));
    });
    afterAll(() => close(srv));

    test('make a wall, friends write, the mom approves; nothing shows before that', async () => {
      expect((await api.post(`${base}/wall`, { occasion: 'party' })).status).toBe(400);
      const mk = await api.post(`${base}/wall`, {
        occasion: 'month', baby: '小湯圓', mom: '小美', av: { ...AV, face: 'data:x' },
      });
      expect(mk.status).toBe(201);
      const { id, key } = mk.data;
      expect(id).toMatch(/^[A-Za-z0-9]{10}$/);
      expect(key.length).toBeGreaterThanOrEqual(24);
      const pub = await api.get(`${base}/wall/${id}`);
      expect(pub.data.wall).toMatchObject({ occasion: 'month', baby: '小湯圓', mom: '小美' });
      expect(JSON.stringify(pub.data)).not.toMatch(/keyHash|data:x/);
      expect(pub.data.wishes).toEqual([]);
      expect((await api.post(`${base}/wall/${id}/wish`, { name: '阿嬤', text: '   ' })).status).toBe(400);
      const w1 = await api.post(`${base}/wall/${id}/wish`, { name: '阿嬤', text: '滿月快樂！頭好壯壯 https://spam.example', sticker: '🎉' });
      expect(w1.status).toBe(201);
      expect(w1.data.pending).toBe(true);
      expect(w1.data.wish.text).toBe('滿月快樂！頭好壯壯');
      const w2 = await api.post(`${base}/wall/${id}/wish`, { name: '', text: '恭喜！', sticker: '💣' });
      expect(w2.data.wish).toMatchObject({ name: '親友', sticker: '💜' });
      expect((await api.get(`${base}/wall/${id}`)).data.wishes).toEqual([]); // waiting for the mom
      expect((await api.post(`${base}/wall/${id}/admin`, { key: 'wrong-key-wrong-key-wrong' })).status).toBe(403);
      const adm = await api.post(`${base}/wall/${id}/admin`, { key });
      expect(adm.data.wishes.map((x) => x.ok)).toEqual([false, false]);
      const ok1 = await api.post(`${base}/wall/${id}/moderate`, { key, wid: w1.data.wish.id, action: 'approve' });
      expect(ok1.data.wishes.find((x) => x.id === w1.data.wish.id).ok).toBe(true);
      const shown = (await api.get(`${base}/wall/${id}`)).data.wishes;
      expect(shown).toHaveLength(1);
      expect(shown[0]).toMatchObject({ name: '阿嬤', text: '滿月快樂！頭好壯壯', sticker: '🎉' });
      expect(shown[0].ok).toBeUndefined();
      await api.post(`${base}/wall/${id}/moderate`, { key, wid: w2.data.wish.id, action: 'remove' });
      await api.post(`${base}/wall/${id}/wish`, { name: '同事', text: '恭喜恭喜' });
      await api.post(`${base}/wall/${id}/moderate`, { key, action: 'approveAll' });
      expect((await api.get(`${base}/wall/${id}`)).data.wishes.map((x) => x.name)).toEqual(['阿嬤', '同事']);
      expect((await api.post(`${base}/wall/${id}/moderate`, { key, wid: 'nope', action: 'approve' })).status).toBe(404);
      expect((await api.post(`${base}/wall/${id}/moderate`, { key, wid: w1.data.wish.id, action: 'burn' })).status).toBe(400);
      expect((await api.post(`${base}/wall/${id}/delete`, { key: 'x'.repeat(24) })).status).toBe(403);
      expect((await api.post(`${base}/wall/${id}/delete`, { key })).data.ok).toBe(true);
      expect((await api.get(`${base}/wall/${id}`)).status).toBe(404);
      expect((await api.get(`${base}/wall/../config`)).status).not.toBe(500);
    });

    test('one network can only write a few blessings on a wall; a wall can only be made a few times a day', async () => {
      const { id } = (await api.post(`${base}/wall`, { occasion: 'hundred' })).data;
      const codes = [];
      for (let i = 0; i < 8; i += 1) codes.push((await api.post(`${base}/wall/${id}/wish`, { text: `祝福 ${i}` })).status); // eslint-disable-line no-await-in-loop
      expect(codes.slice(0, 6).every((c) => c === 201)).toBe(true);
      expect(codes[7]).toBe(429);
      const made = [];
      for (let i = 0; i < 6; i += 1) made.push((await api.post(`${base}/wall`, { occasion: 'year' })).status); // eslint-disable-line no-await-in-loop
      expect(made).toContain(429);
    });
  });
}

socialFlows('memory', () => new MemoryStore());
socialFlows('Redis REST', () => new RedisRestStore({ url: 'https://kv.example', token: 't', http: fakeRedis() }));

describe('Redis store details', () => {
  test('inbox is read and emptied in one step; list keeps its cap and expiry', async () => {
    const r = fakeRedis();
    const store = new RedisRestStore({ url: 'https://kv.example', token: 't', http: r });
    for (let i = 0; i < 35; i += 1) await store.pushCapped('in:a', { i }, 30, 600); // eslint-disable-line no-await-in-loop
    expect(r.ttl.get('mom:x:in:a')).toBe(600);
    const got = await store.drain('in:a');
    expect(got).toHaveLength(30);
    expect(got[0]).toEqual({ i: 34 });
    expect(await store.drain('in:a')).toEqual([]);
  });
});
