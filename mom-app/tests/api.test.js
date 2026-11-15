import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import express from 'express';
import axios from 'axios';
import { createMomRouter } from '../../mom-api/index.js';
import { MemoryStore, RedisRestStore } from '../../mom-api/store.js';
import {
  normaliseAccount, verifyPassword, hashPassword, makeSigner, safeEqual,
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
    get: async (url, opts) => { lineCalls.push(['get', url, opts.headers.Authorization]); return { data: { userId: 'U123', displayName: 'LINE 媽咪' } }; },
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
    expect((await api.post(`${base}/auth/register`, { account: 'nope', password: '12345678' })).status).toBe(400);
    expect((await api.post(`${base}/auth/register`, { account: 'a@b.co', password: 'short' })).status).toBe(400);
  });
  test('register, duplicate, login; the server picks the invite code', async () => {
    const r = await api.post(`${base}/auth/register`, {
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
    expect((await api.post(`${base}/auth/register`, { account: 'ALICE@example.com', password: 'password-123' })).status).toBe(409);
    expect((await api.post(`${base}/auth/login`, { account: 'alice@example.com', password: 'wrong-pass' })).status).toBe(401);
    expect((await api.post(`${base}/auth/login`, { account: 'nobody@example.com', password: 'wrong-pass' })).status).toBe(401);
    const ok = await api.post(`${base}/auth/login`, { account: 'alice@example.com', password: 'password-123' });
    expect(ok.status).toBe(200);
  });
  test('referral: registering with an invite code counts for the inviter', async () => {
    const r = await api.post(`${base}/auth/register`, { account: '0912345678', password: 'password-456', invitedBy: alice.user.code.toLowerCase() });
    expect(r.status).toBe(201);
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
    const { server, base } = await serve(createMomRouter({ store: new MemoryStore(), env: { NODE_ENV: 'test', VERCEL: '1' } }));
    expect((await api.get(`${base}/config`)).data.providers).toEqual({ password: false, line: false });
    expect((await api.post(`${base}/auth/register`, { account: 'p@example.com', password: 'password-1' })).status).toBe(503);
    expect((await api.get(`${base}/stats`)).status).toBe(200); // counts still work
    await new Promise((r) => server.close(r));
  });
});

/* Same flows through the Redis REST store (Vercel KV / Upstash) using a tiny in-test Redis emulator. */
function fakeRedis() {
  const kv = new Map(); const sets = new Map(); const zsets = new Map(); const hashes = new Map();
  const z = (k) => { if (!zsets.has(k)) zsets.set(k, new Map()); return zsets.get(k); };
  const hm = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };
  const num = (v) => (v === '+inf' ? Infinity : v === '-inf' ? -Infinity : Number(v));
  const run = ([cmd, ...a]) => {
    switch (cmd) {
      case 'GET': return kv.has(a[0]) ? kv.get(a[0]) : null;
      case 'SET': if (a[2] === 'NX' && kv.has(a[0])) return null; kv.set(a[0], a[1]); return 'OK';
      case 'INCR': { const v = Number(kv.get(a[0]) || 0) + 1; kv.set(a[0], String(v)); return v; }
      case 'EXPIRE': return 1;
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
  return { post: async (url, args, opts) => { expect(opts.headers.Authorization).toBe('Bearer kv-token'); return { data: { result: run(args) } }; } };
}

describe('member API on the Redis REST store', () => {
  let srv; let base;
  beforeAll(async () => {
    ({ server: srv, base } = await serve(createMomRouter({ store: new RedisRestStore({ url: 'https://kv.example', token: 'kv-token', http: fakeRedis() }), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 's' } })));
  });
  afterAll(() => new Promise((r) => srv.close(r)));
  test('register, duplicate, referral, login, stats, shared rate limits', async () => {
    const a = await api.post(`${base}/auth/register`, { account: 'kv@example.com', password: 'password-1' });
    expect(a.status).toBe(201);
    expect((await api.post(`${base}/auth/register`, { account: 'kv@example.com', password: 'password-1' })).status).toBe(409);
    expect((await api.post(`${base}/auth/register`, { account: '0922333444', password: 'password-2', invitedBy: a.data.user.code })).status).toBe(201);
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
