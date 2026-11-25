import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import express from 'express';
import axios from 'axios';
import { createMomRouter } from '../../mom-api/index.js';
import { MemoryStore, RedisRestStore } from '../../mom-api/store.js';
import { POLICY_VERSION as POLICY } from '../../mom-api/policy.js';
import {
  normaliseAccount, verifyPassword, hashPassword, makeSigner, safeEqual, ipBucket, isCommonPassword, needsRehash,
} from '../../mom-api/auth.js';

const api = axios.create({ validateStatus: () => true, maxRedirects: 0 });
const NONCE = 'nonce-0123456789abcdef';

async function serve(router) {
  const app = express();
  app.use('/mom-app/api', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}/mom-app/api` };
}

describe('auth helpers', () => {
  test('accounts: email and Taiwan mobile', () => {
    expect(normaliseAccount('Mom@Example.com').account).toBe('email:mom@example.com');
    expect(normaliseAccount('0912-345-678').account).toBe('phone:0912345678');
    expect(normaliseAccount('+886912345678').account).toBe('phone:0912345678');
    expect(normaliseAccount('hello')).toBeNull();
  });
  test('password hash verifies only the right password (async scrypt)', async () => {
    const stored = await hashPassword('good-password');
    expect(await verifyPassword('good-password', stored)).toBe(true);
    expect(await verifyPassword('bad-password', stored)).toBe(false);
  });
  test('token verify never throws on odd input (multi-byte signature, garbage)', () => {
    const t = makeSigner('k');
    const good = t.issue({ a: 1 }, 60);
    const [body, sig] = good.split('.');
    expect(t.verify(good).a).toBe(1);
    expect(t.verify(`${body}.${sig.slice(0, -1)}é`)).toBeNull(); // same length in chars, different in bytes
    expect(t.verify('x.y.z')).toBeNull();
    expect(t.verify(null)).toBeNull();
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('member API', () => {
  let clock = Date.UTC(2026, 10, 15, 4, 0, 0); // 12:00 in Taipei
  const lineCalls = [];
  const fakeHttp = {
    post: async (url, body) => { lineCalls.push(['post', url, body]); return { data: { access_token: 'line-access' } }; },
    get: async (url, opts) => { lineCalls.push(['get', url, opts.headers.Authorization]); return { data: { userId: `U${'0123456789abcdef'.repeat(2)}`, displayName: 'LINE 媽咪' } }; },
  };
  let srv; let base; let alice;
  const auth = (tok) => ({ headers: { Authorization: `Bearer ${tok}` } });
  beforeAll(async () => {
    ({ server: srv, base } = await serve(createMomRouter({
      store: new MemoryStore(),
      env: {
        NODE_ENV: 'test', MOM_AUTH_SECRET: 'test-secret', LINE_LOGIN_CHANNEL_ID: '1650000000', LINE_LOGIN_CHANNEL_SECRET: 'line-secret',
      },
      http: fakeHttp,
      now: () => clock,
    })));
  });
  afterAll(() => new Promise((r) => srv.close(r)));

  test('config lists providers', async () => {
    expect((await api.get(`${base}/config`)).data.providers).toEqual({ password: true, line: true });
  });
  test('register validates input', async () => {
    expect((await api.post(`${base}/auth/register`, { consent: POLICY, account: 'nope', password: '12345678' })).status).toBe(400);
    expect((await api.post(`${base}/auth/register`, { consent: POLICY, account: 'a@b.co', password: 'short' })).status).toBe(400);
  });
  test('register, duplicate, login; the server picks the invite code', async () => {
    const r = await api.post(`${base}/auth/register`, { consent: POLICY,
      account: 'alice@example.com', password: 'password-123', nickname: '小美<script>', code: 'ALICE1', stage: 'preg',
    });
    expect(r.status).toBe(201);
    expect(r.data.user.nickname).toBe('小美script');
    expect(r.data.user.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(r.data.user.code).not.toBe('ALICE1'); // client-chosen codes are ignored
    expect(r.data.user.stage).toBeUndefined(); // pregnancy stage is never stored
    expect(r.data.user.accountHint).toBe('a***@example.com');
    expect(r.data.user.passwordHash).toBeUndefined();
    alice = r.data;
    expect((await api.post(`${base}/auth/register`, { consent: POLICY, account: 'ALICE@example.com', password: 'password-123' })).status).toBe(409);
    expect((await api.post(`${base}/auth/login`, { account: 'alice@example.com', password: 'wrong-pass' })).status).toBe(401);
    expect((await api.post(`${base}/auth/login`, { account: 'nobody@example.com', password: 'wrong-pass' })).status).toBe(401);
    const ok = await api.post(`${base}/auth/login`, { account: 'alice@example.com', password: 'password-123' });
    expect(ok.status).toBe(200);
  });
  test('referral: the friend joins with an invite code; her inviter counts when she claims her welcome gift', async () => {
    const r = await api.post(`${base}/auth/register`, { consent: POLICY, account: '0912345678', password: 'password-456', invitedBy: alice.user.code.toLowerCase() });
    expect(r.status).toBe(201);
    expect(r.data.user.invite).toEqual({ by: alice.user.code, gift: false, open: true });
    expect((await api.get(`${base}/me`, auth(alice.token))).data.user.referrals).toBe(0); // not at sign-up any more
    const claim = await api.post(`${base}/invite/claim`, {}, auth(r.data.token));
    expect(claim.data).toMatchObject({ gift: true, counted: true });
    expect(claim.data.user.invite).toEqual({ by: alice.user.code, gift: true, open: false });
    expect((await api.get(`${base}/me`, auth(alice.token))).data.user.referrals).toBe(1);
  });
  test('me requires a valid token; tampered tokens fail', async () => {
    expect((await api.get(`${base}/me`)).status).toBe(401);
    expect((await api.get(`${base}/me`, auth(`${alice.token.slice(0, -2)}xx`))).status).toBe(401);
    expect((await api.get(`${base}/me`, auth(`${alice.token.slice(0, -1)}é`))).status).toBe(401);
    const upd = await api.post(`${base}/me`, { nickname: '小美媽' }, auth(alice.token));
    expect(upd.data.user.nickname).toBe('小美媽');
  });
  test('stats: online counts recent heartbeats, registered counts users', async () => {
    await api.post(`${base}/presence`, { sid: 'tab-aaaaaaaa' });
    await api.post(`${base}/presence`, { sid: 'tab-bbbbbbbb' });
    clock += 90 * 1000;
    await api.post(`${base}/presence`, { sid: 'tab-cccccccc' });
    let s = await api.get(`${base}/stats`);
    expect(s.data).toMatchObject({ online: 3, registered: 2, todaySignups: 2 });
    clock += 60 * 1000; // the first two heartbeats are now older than 2 minutes
    s = await api.get(`${base}/stats`);
    expect(s.data.online).toBe(1);
    expect((await api.post(`${base}/presence`, { sid: 'x' })).status).toBe(400);
  });
  test('LINE login: start needs a nonce, callback echoes it with the token', async () => {
    expect((await api.get(`${base}/auth/line/start?ref=X`)).status).toBe(400);
    const start = await api.get(`${base}/auth/line/start?ref=${alice.user.code}&nonce=${NONCE}`);
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.location);
    expect(loc.origin).toBe('https://access.line.me');
    expect(loc.searchParams.get('client_id')).toBe('1650000000');
    const cb = await api.get(`${base}/auth/line/callback?code=abc&state=${encodeURIComponent(loc.searchParams.get('state'))}`);
    expect(cb.status).toBe(302);
    const data = JSON.parse(decodeURIComponent(cb.headers.location.split('#/login?')[1]));
    expect(data.nonce).toBe(NONCE);
    expect(lineCalls[0][1]).toBe('https://api.line.me/oauth2/v2.1/token');
    const me = await api.get(`${base}/me`, auth(data.token));
    expect(me.data.user).toMatchObject({ provider: 'line', nickname: 'LINE 媽咪', accountHint: 'LINE' });
    // a new LINE account agrees to the policy in the app first; only then does the gift (and alice's count) happen
    expect((await api.post(`${base}/invite/claim`, {}, auth(data.token))).status).toBe(403);
    expect((await api.get(`${base}/me`, auth(alice.token))).data.user.referrals).toBe(1);
    await api.post(`${base}/me`, { consent: POLICY }, auth(data.token));
    expect((await api.post(`${base}/invite/claim`, {}, auth(data.token))).data).toMatchObject({ gift: true, counted: true });
    expect((await api.get(`${base}/me`, auth(alice.token))).data.user.referrals).toBe(2);
  });
  test('LINE callback: forged or malformed state is rejected without crashing', async () => {
    const forged = await api.get(`${base}/auth/line/callback?code=abc&state=forged`);
    expect(forged.headers.location).toContain(encodeURIComponent('"error":"state"'));
    const odd = `${'a'.repeat(20)}.${'b'.repeat(42)}%C3%A9`;
    const r = await api.get(`${base}/auth/line/callback?state=${odd}`);
    expect(r.status).toBe(302); // previously crashed the process
    expect((await api.get(`${base}/config`)).status).toBe(200); // server still alive
  });
  test('logout-all revokes every session', async () => {
    const t2 = (await api.post(`${base}/auth/login`, { account: 'alice@example.com', password: 'password-123' })).data.token;
    expect((await api.post(`${base}/auth/logout-all`, {}, auth(t2))).status).toBe(200);
    expect((await api.get(`${base}/me`, auth(t2))).status).toBe(401);
    expect((await api.get(`${base}/me`, auth(alice.token))).status).toBe(401);
  });
  test('login is limited per account', async () => {
    let last;
    for (let i = 0; i < 12; i += 1) last = await api.post(`${base}/auth/login`, { account: 'alice@example.com', password: `wrong-${i}-xx` }); // eslint-disable-line no-await-in-loop
    expect(last.status).toBe(429);
  });
  test('presence: one network cannot inflate the online count', async () => {
    let last;
    for (let i = 0; i < 45; i += 1) last = await api.post(`${base}/presence`, { sid: `fake-sid-${String(i).padStart(4, '0')}` }); // eslint-disable-line no-await-in-loop
    expect(last.status).toBe(429);
  });
  test('request bodies over 20 kb are refused', async () => {
    const r = await api.post(`${base}/presence`, { sid: 'tab-dddddddd', pad: 'x'.repeat(30 * 1024) });
    expect(r.status).toBe(413);
  });
});

describe('production safety', () => {
  test('without MOM_AUTH_SECRET in production, login is switched off (not half-working)', async () => {
    const kv = new MemoryStore(); kv.kind = 'redis'; // with its database connected (without one, see 「the live site without a database」)
    const { server, base } = await serve(createMomRouter({ store: kv, env: { NODE_ENV: 'test', VERCEL: '1' } }));
    expect((await api.get(`${base}/config`)).data.providers).toEqual({ password: false, line: false });
    expect((await api.post(`${base}/auth/register`, { consent: POLICY, account: 'p@example.com', password: 'password-1' })).status).toBe(503);
    expect((await api.get(`${base}/stats`)).status).toBe(200); // counts still work
    await new Promise((r) => server.close(r));
  });
});

/* Same flows through the Redis REST store (Vercel KV / Upstash) using a tiny in-test Redis emulator. */
function fakeRedis() {
  const kv = new Map(); const sets = new Map(); const zsets = new Map(); const hashes = new Map(); const ttl = new Map();
  const z = (k) => { if (!zsets.has(k)) zsets.set(k, new Map()); return zsets.get(k); };
  const hm = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };
  const num = (v) => (v === '+inf' ? Infinity : v === '-inf' ? -Infinity : Number(v));
  const run = ([cmd, ...a]) => {
    switch (cmd) {
      case 'GET': return kv.has(a[0]) ? kv.get(a[0]) : null;
      case 'SET': {
        const opts = a.slice(2).map(String);
        if (opts.includes('NX') && kv.has(a[0])) return null;
        kv.set(a[0], a[1]);
        const ex = opts.indexOf('EX'); if (ex >= 0) ttl.set(a[0], Number(opts[ex + 1]));
        return 'OK';
      }
      case 'INCR': { const v = Number(kv.get(a[0]) || 0) + 1; kv.set(a[0], String(v)); return v; }
      case 'EXPIRE': ttl.set(a[0], Number(a[1])); return 1;
      case 'EXISTS': return kv.has(a[0]) ? 1 : 0;
      case 'TTL': return ttl.has(a[0]) ? ttl.get(a[0]) : -1;
      case 'EVAL': { // only the rate limiter's script: INCR, then EXPIRE if there is no expiry yet
        expect(a[0]).toContain("redis.call('INCR'"); expect(a[0]).toContain("redis.call('EXPIRE'");
        const key = a[2]; const v = Number(kv.get(key) || 0) + 1; kv.set(key, String(v)); if (!ttl.has(key)) ttl.set(key, Number(a[3])); return v;
      }
      case 'ZSCORE': return z(a[0]).has(a[1]) ? String(z(a[0]).get(a[1])) : null;
      case 'SADD': { if (!sets.has(a[0])) sets.set(a[0], new Set()); sets.get(a[0]).add(a[1]); return 1; }
      case 'SCARD': return sets.has(a[0]) ? sets.get(a[0]).size : 0;
      case 'ZADD': z(a[0]).set(a[2], Number(a[1])); return 1;
      case 'ZCOUNT': return [...z(a[0]).values()].filter((s) => s >= num(a[1]) && s <= num(a[2])).length;
      case 'ZREMRANGEBYSCORE': { const m = z(a[0]); let n = 0; [...m].forEach(([k, s]) => { if (s >= num(a[1]) && s <= num(a[2])) { m.delete(k); n += 1; } }); return n; }
      case 'HSET': hm(a[0]).set(a[1], a[2]); return 1;
      case 'HGET': return hm(a[0]).has(a[1]) ? String(hm(a[0]).get(a[1])) : null;
      case 'HEXISTS': return hm(a[0]).has(a[1]) ? 1 : 0;
      case 'HINCRBY': { const v = Number(hm(a[0]).get(a[1]) || 0) + Number(a[2]); hm(a[0]).set(a[1], v); return v; }
      default: throw new Error(`unsupported ${cmd}`);
    }
  };
  return { kv, ttl, post: async (url, args, opts) => { expect(opts.headers.Authorization).toBe('Bearer kv-token'); return { data: { result: run(args) } }; } };
}

describe('member API on the Redis REST store', () => {
  let srv; let base;
  beforeAll(async () => {
    ({ server: srv, base } = await serve(createMomRouter({ store: new RedisRestStore({ url: 'https://kv.example', token: 'kv-token', http: fakeRedis() }), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 's' } })));
  });
  afterAll(() => new Promise((r) => srv.close(r)));
  test('register, duplicate, referral, login, stats, shared rate limits', async () => {
    const a = await api.post(`${base}/auth/register`, { consent: POLICY, account: 'kv@example.com', password: 'password-1' });
    expect(a.status).toBe(201);
    expect((await api.post(`${base}/auth/register`, { consent: POLICY, account: 'kv@example.com', password: 'password-1' })).status).toBe(409);
    const friend = await api.post(`${base}/auth/register`, { consent: POLICY, account: '0922333444', password: 'password-2', invitedBy: a.data.user.code });
    expect(friend.status).toBe(201);
    expect((await api.post(`${base}/invite/claim`, {}, { headers: { Authorization: `Bearer ${friend.data.token}` } })).data).toMatchObject({ gift: true, counted: true });
    const login = await api.post(`${base}/auth/login`, { account: 'kv@example.com', password: 'password-1' });
    expect(login.data.user.referrals).toBe(1);
    await api.post(`${base}/presence`, { sid: 'kv-tab-0001' });
    expect((await api.get(`${base}/stats`)).data).toMatchObject({ online: 1, registered: 2, storage: 'redis' });
    let last;
    for (let i = 0; i < 12; i += 1) last = await api.post(`${base}/auth/login`, { account: 'kv@example.com', password: `bad-${i}-pass` }); // eslint-disable-line no-await-in-loop
    expect(last.status).toBe(429);
  });
});

describe('malformed requests', () => {
  test('broken JSON → 400, no crash', async () => {
    const { server, base } = await serve(createMomRouter({ store: new MemoryStore(), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 's' } }));
    const r = await api.post(`${base}/auth/login`, '{"account":', { headers: { 'Content-Type': 'application/json' } });
    expect(r.status).toBe(400);
    expect(r.data.error).toBe('bad_json');
    await new Promise((res) => server.close(res));
  });
});

/* Fixes from the security review (2026-11): each test would fail on the first version of the API. */
describe('security hardening', () => {
  const STRONG = 'k'.repeat(40);
  const start = (opts = {}) => serve(createMomRouter({
    store: opts.store || new MemoryStore(), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: STRONG, ...opts.env }, http: opts.http, now: opts.now,
  }));
  const from = (ip) => ({ headers: { 'X-Forwarded-For': `9.9.9.9, ${ip}` } });
  const bearer = (tok) => ({ headers: { Authorization: `Bearer ${tok}` } });
  const close = (server) => new Promise((res) => server.close(res));

  test('helpers: IPv6 grouped by /64, common passwords, old hashes flagged for upgrade', () => {
    expect(ipBucket('2001:db8:1:2:aaaa::1')).toBe(ipBucket('2001:0db8:0001:0002:bbbb:cccc:dddd:2'));
    expect(ipBucket('2001:db8:1:3::1')).not.toBe(ipBucket('2001:db8:1:2::1'));
    expect(ipBucket('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(isCommonPassword('Password1')).toBe(true);
    expect(isCommonPassword('my-baby-2026')).toBe(false);
    expect(needsRehash('scrypt$a$b')).toBe(true);
  });

  test('a short MOM_AUTH_SECRET is never used for signing', async () => {
    const { server, base } = await serve(createMomRouter({ store: new MemoryStore(), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 'secret' } }));
    const r = await api.post(`${base}/auth/register`, { consent: POLICY, account: 'weak@example.com', password: 'baby-sleeps-9' });
    expect(r.status).toBe(201);
    expect(makeSigner('secret').verify(r.data.token)).toBeNull(); // not signed with the guessable key
    await close(server);
  });

  test('「登出所有裝置」 cannot be undone by a profile write that read the user before it (Redis store)', async () => {
    const store = new RedisRestStore({ url: 'https://kv.example', token: 'kv-token', http: fakeRedis() });
    const { server, base } = await start({ store });
    const reg = await api.post(`${base}/auth/register`, { consent: POLICY, account: 'race@example.com', password: 'baby-sleeps-9' });
    const stolen = reg.data.token;
    const stale = await store.getUser(reg.data.user.id); // a POST /me in flight read the record here…
    expect((await api.post(`${base}/auth/logout-all`, {}, bearer(stolen))).status).toBe(200);
    await store.updateUser(stale.id, { ...stale, nickname: '舊的' }); // …and writes it back after logout-all
    expect((await api.get(`${base}/me`, bearer(stolen))).status).toBe(401);
    const fresh = await api.post(`${base}/auth/login`, { account: 'race@example.com', password: 'baby-sleeps-9' });
    expect((await api.get(`${base}/me`, bearer(fresh.data.token))).status).toBe(200);
    await close(server);
  });

  test('nobody can lock the owner out by failing on purpose; guessing from one network still stops', async () => {
    const { server, base } = await start({ env: { MOM_TRUST_PROXY: '1' } });
    await api.post(`${base}/auth/register`, { consent: POLICY, account: 'owner@example.com', password: 'baby-sleeps-9' }, from('10.0.0.1'));
    let pair;
    for (let i = 0; i < 11; i += 1) pair = await api.post(`${base}/auth/login`, { account: 'owner@example.com', password: `wrong-${i}-xx` }, from('10.0.9.9')); // eslint-disable-line no-await-in-loop
    expect(pair.status).toBe(429); // 10 tries from one network, then stop
    for (let n = 0; n < 6; n += 1) { // 60 more wrong tries spread over many networks
      for (let i = 0; i < 10; i += 1) await api.post(`${base}/auth/login`, { account: 'owner@example.com', password: `wrong-${n}-${i}` }, from(`10.1.${n}.${i}`)); // eslint-disable-line no-await-in-loop
    }
    expect((await api.post(`${base}/auth/login`, { account: 'owner@example.com', password: 'baby-sleeps-9' }, from('10.0.0.1'))).status).toBe(200); // owner's usual network
    expect((await api.post(`${base}/auth/login`, { account: 'owner@example.com', password: 'baby-sleeps-9' }, from('10.7.7.7'))).status).toBe(429); // unknown network waits
    await close(server);
  }, 120000); // 70+ logins, each a real password hash

  test('behind a proxy each user has their own limits (MOM_TRUST_PROXY), and mistakes do not use up sign-ups', async () => {
    const { server, base } = await start({ env: { MOM_TRUST_PROXY: '1' } });
    for (let i = 0; i < 20; i += 1) await api.post(`${base}/auth/register`, { consent: POLICY, account: 'nope', password: '12345678' }, from('10.2.0.1')); // eslint-disable-line no-await-in-loop
    expect((await api.post(`${base}/auth/register`, { consent: POLICY, account: 'ok1@example.com', password: 'baby-sleeps-9' }, from('10.2.0.1'))).status).toBe(201);
    for (let i = 0; i < 10; i += 1) await api.post(`${base}/auth/register`, { consent: POLICY, account: `junk${i}@example.com`, password: 'baby-sleeps-9' }, from('10.2.0.2')); // eslint-disable-line no-await-in-loop
    expect((await api.post(`${base}/auth/register`, { consent: POLICY, account: 'junk-x@example.com', password: 'baby-sleeps-9' }, from('10.2.0.2'))).status).toBe(429);
    expect((await api.post(`${base}/auth/register`, { consent: POLICY, account: 'other@example.com', password: 'baby-sleeps-9' }, from('10.2.0.3'))).status).toBe(201); // another user is not blocked
    expect((await api.post(`${base}/auth/register`, { consent: POLICY, account: 'pw@example.com', password: 'password123' }, from('10.2.0.4'))).data.error).toBe('common_password');
    await close(server);
  });

  test('invites: one network counts at most 3 times per code per day', async () => {
    const { server, base } = await start({ env: { MOM_TRUST_PROXY: '1' } });
    const inviter = await api.post(`${base}/auth/register`, { consent: POLICY, account: 'host@example.com', password: 'baby-sleeps-9' }, from('10.3.0.1'));
    const join = async (account, ip) => {
      const f = await api.post(`${base}/auth/register`, { consent: POLICY, account, password: 'baby-sleeps-9', invitedBy: inviter.data.user.code }, from(ip));
      return (await api.post(`${base}/invite/claim`, {}, { headers: { ...bearer(f.data.token).headers, ...from(ip).headers } })).data;
    };
    const counted = [];
    for (let i = 0; i < 6; i += 1) counted.push((await join(`friend${i}@example.com`, '10.3.0.2')).counted); // eslint-disable-line no-await-in-loop
    expect(counted).toEqual([true, true, true, false, false, false]); // each still gets her own welcome gift
    expect((await join('real-friend@example.com', '10.3.0.3')).counted).toBe(true);
    expect((await api.get(`${base}/me`, bearer(inviter.data.token))).data.user.referrals).toBe(4);
    await close(server);
  });

  test('online count: a network adds at most 6 new sessions; open apps keep beating', async () => {
    const { server, base } = await start();
    const r = [];
    for (let i = 0; i < 8; i += 1) r.push((await api.post(`${base}/presence`, { sid: `phone-${i}-aaaa` })).status); // eslint-disable-line no-await-in-loop
    expect(r).toEqual([200, 200, 200, 200, 200, 200, 429, 429]);
    expect((await api.post(`${base}/presence`, { sid: 'phone-0-aaaa' })).status).toBe(200);
    expect((await api.get(`${base}/stats`)).data.online).toBe(6);
    await close(server);
  });

  test('odd request bodies get a short JSON error, never a stack trace with server paths', async () => {
    const { server, base } = await start();
    const r = await api.post(`${base}/presence`, '{}', { headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'bogus' }, transformRequest: [(d) => d] });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(r.data).toEqual({ error: 'bad_request' });
    await close(server);
  });

  test('an older (weaker) password hash is upgraded at the next login', async () => {
    const store = new MemoryStore();
    const { server, base } = await start({ store });
    await api.post(`${base}/auth/register`, { consent: POLICY, account: 'old@example.com', password: 'baby-sleeps-9' });
    const u = await store.getUserByAccount('email:old@example.com');
    const crypto = await import('crypto');
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync('baby-sleeps-9', salt, 32, { N: 16384, r: 8, p: 1 });
    const b64 = (x) => Buffer.from(x).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    u.passwordHash = ['scrypt', b64(salt), b64(hash)].join('$'); // as saved by the first version
    expect((await api.post(`${base}/auth/login`, { account: 'old@example.com', password: 'baby-sleeps-9' })).status).toBe(200);
    expect(u.passwordHash.startsWith('scrypt5$')).toBe(true);
    expect((await api.post(`${base}/auth/login`, { account: 'old@example.com', password: 'baby-sleeps-9' })).status).toBe(200);
    await close(server);
  });

  test('LINE: a state works once (no replay), and an unexpected LINE user id is refused', async () => {
    let calls = 0;
    let userId = `U${'ab'.repeat(16)}`;
    const http = { post: async () => { calls += 1; return { data: { access_token: 't' } }; }, get: async () => ({ data: { userId, displayName: 'L' } }) };
    const { server, base } = await start({ env: { LINE_LOGIN_CHANNEL_ID: '1650000000', LINE_LOGIN_CHANNEL_SECRET: 'x' }, http });
    const state = async () => new URL((await api.get(`${base}/auth/line/start?nonce=${NONCE}`)).headers.location).searchParams.get('state');
    const cb = async (st) => JSON.parse(decodeURIComponent((await api.get(`${base}/auth/line/callback?code=c&state=${encodeURIComponent(st)}`)).headers.location.split('#/login?')[1]));
    const st = await state();
    expect((await cb(st)).token).toBeTruthy();
    expect((await cb(st)).error).toBe('state');
    expect(calls).toBe(1); // the replay never reached LINE
    userId = 'U123../../admin';
    expect((await cb(await state())).error).toBe('line_error');
    await close(server);
  });

  test('Redis rate-limit counters always get their expiry in the same step (no permanent lock-out)', async () => {
    const redis = fakeRedis();
    const store = new RedisRestStore({ url: 'https://kv.example', token: 'kv-token', http: redis });
    expect(await store.hit('t:x', 600)).toBe(1);
    expect(await store.hit('t:x', 600)).toBe(2);
    expect(redis.ttl.get('mom:rl:t:x')).toBe(600);
  });
});

describe('the live site without a database (0.9.7)', () => {
  test('on a production host with memory storage: no 祝福牆／好孕圈／online counts (they would differ per server copy)', async () => {
    const { server, base } = await serve(createMomRouter({ store: new MemoryStore(), env: { VERCEL: '1' } }));
    try {
      const cfg = await api.get(`${base}/config`);
      expect(cfg.status).toBe(200);
      expect(cfg.data.storage).toBe('memory');
      expect(cfg.data.social).toBe(false);
      expect((await api.get(`${base}/stats`)).status).toBe(404);
    } finally { server.close(); }
  });
  test('…with a database (KV / Upstash), or in local development, they are on', async () => {
    const shared = new MemoryStore(); shared.kind = 'redis'; // stands in for KV / Upstash
    const a = await serve(createMomRouter({ store: shared, env: { VERCEL: '1' } }));
    const b = await serve(createMomRouter({ store: new MemoryStore(), env: {} }));
    try {
      expect((await api.get(`${a.base}/config`)).data.social).toBe(true);
      expect((await api.get(`${a.base}/stats`)).status).toBe(200);
      expect((await api.get(`${b.base}/config`)).data.social).toBe(true);
      expect((await api.get(`${b.base}/stats`)).status).toBe(200);
    } finally { a.server.close(); b.server.close(); }
  });
});
