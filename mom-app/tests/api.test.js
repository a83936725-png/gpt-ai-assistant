import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import express from 'express';
import axios from 'axios';
import { createMomRouter } from '../../mom-api/index.js';
import { MemoryStore } from '../../mom-api/store.js';
import { normaliseAccount, verifyPassword, hashPassword } from '../../mom-api/auth.js';

let server;
let base;
let clock = Date.UTC(2026, 10, 15, 4, 0, 0); // 12:00 in Taipei
const lineCalls = [];
const fakeHttp = {
  post: async (url, body) => { lineCalls.push(['post', url, body]); return { data: { access_token: 'line-access' } }; },
  get: async (url, opts) => { lineCalls.push(['get', url, opts.headers.Authorization]); return { data: { userId: 'U123', displayName: 'LINE 媽咪' } }; },
};
const api = axios.create({ validateStatus: () => true, maxRedirects: 0 });

beforeAll(async () => {
  const app = express();
  app.use('/mom-app/api', createMomRouter({
    store: new MemoryStore(),
    env: {
      NODE_ENV: 'test', MOM_AUTH_SECRET: 'test-secret', LINE_LOGIN_CHANNEL_ID: '1650000000', LINE_LOGIN_CHANNEL_SECRET: 'line-secret',
    },
    http: fakeHttp,
    now: () => clock,
  }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/mom-app/api`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('auth helpers', () => {
  test('accounts: email and Taiwan mobile', () => {
    expect(normaliseAccount('Mom@Example.com').account).toBe('email:mom@example.com');
    expect(normaliseAccount('0912-345-678').account).toBe('phone:0912345678');
    expect(normaliseAccount('+886912345678').account).toBe('phone:0912345678');
    expect(normaliseAccount('hello')).toBeNull();
  });
  test('password hash verifies only the right password', () => {
    const stored = hashPassword('good-password');
    expect(verifyPassword('good-password', stored)).toBe(true);
    expect(verifyPassword('bad-password', stored)).toBe(false);
  });
});

describe('member API', () => {
  let alice;
  test('config lists providers', async () => {
    const r = await api.get(`${base}/config`);
    expect(r.data.providers).toEqual({ password: true, line: true });
  });
  test('register validates input', async () => {
    expect((await api.post(`${base}/auth/register`, { account: 'nope', password: '12345678' })).status).toBe(400);
    expect((await api.post(`${base}/auth/register`, { account: 'a@b.co', password: 'short' })).status).toBe(400);
  });
  test('register, duplicate, login', async () => {
    const r = await api.post(`${base}/auth/register`, {
      account: 'alice@example.com', password: 'password-123', nickname: '小美<script>', code: 'ALICE1', stage: 'preg',
    });
    expect(r.status).toBe(201);
    expect(r.data.user.nickname).toBe('小美script');
    expect(r.data.user.code).toBe('ALICE1');
    expect(r.data.user.accountHint).toBe('a***@example.com');
    expect(r.data.user.passwordHash).toBeUndefined();
    alice = r.data;
    expect((await api.post(`${base}/auth/register`, { account: 'ALICE@example.com', password: 'password-123' })).status).toBe(409);
    expect((await api.post(`${base}/auth/login`, { account: 'alice@example.com', password: 'wrong-pass' })).status).toBe(401);
    const ok = await api.post(`${base}/auth/login`, { account: 'alice@example.com', password: 'password-123' });
    expect(ok.status).toBe(200);
    expect(ok.data.token).toBeTruthy();
  });
  test('referral: registering with an invite code counts for the inviter', async () => {
    const r = await api.post(`${base}/auth/register`, {
      account: '0912345678', password: 'password-456', invitedBy: 'alice1', code: 'ALICE1',
    });
    expect(r.status).toBe(201);
    expect(r.data.user.code).not.toBe('ALICE1'); // code was taken, a new one is assigned
    const me = await api.get(`${base}/me`, { headers: { Authorization: `Bearer ${alice.token}` } });
    expect(me.data.user.referrals).toBe(1);
  });
  test('me requires a valid token; tampered tokens fail', async () => {
    expect((await api.get(`${base}/me`)).status).toBe(401);
    const bad = `${alice.token.slice(0, -2)}xx`;
    expect((await api.get(`${base}/me`, { headers: { Authorization: `Bearer ${bad}` } })).status).toBe(401);
    const upd = await api.post(`${base}/me`, { nickname: '小美媽', stage: 'baby' }, { headers: { Authorization: `Bearer ${alice.token}` } });
    expect(upd.data.user.nickname).toBe('小美媽');
    expect(upd.data.user.stage).toBe('baby');
  });
  test('stats: online counts recent heartbeats, registered counts users', async () => {
    await api.post(`${base}/presence`, { sid: 'tab-aaaaaaaa' });
    await api.post(`${base}/presence`, { sid: 'tab-bbbbbbbb' });
    clock += 90 * 1000;
    await api.post(`${base}/presence`, { sid: 'tab-cccccccc' });
    let s = await api.get(`${base}/stats`);
    expect(s.data).toMatchObject({ online: 3, registered: 2, todaySignups: 2 });
    clock += 60 * 1000; // first two heartbeats are now older than 2 minutes
    s = await api.get(`${base}/stats`);
    expect(s.data.online).toBe(1);
    expect((await api.post(`${base}/presence`, { sid: 'x' })).status).toBe(400);
  });
  test('LINE login: start redirects to LINE, callback signs the user in', async () => {
    const start = await api.get(`${base}/auth/line/start?ref=ALICE1`);
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.location);
    expect(loc.origin).toBe('https://access.line.me');
    expect(loc.searchParams.get('client_id')).toBe('1650000000');
    const state = loc.searchParams.get('state');
    const cb = await api.get(`${base}/auth/line/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(302);
    const hash = decodeURIComponent(cb.headers.location.split('#/login?')[1]);
    const { token } = JSON.parse(hash);
    expect(token).toBeTruthy();
    expect(lineCalls[0][1]).toBe('https://api.line.me/oauth2/v2.1/token');
    const me = await api.get(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(me.data.user).toMatchObject({ provider: 'line', nickname: 'LINE 媽咪', accountHint: 'LINE' });
    const alice = await api.post(`${base}/auth/login`, { account: 'alice@example.com', password: 'password-123' });
    expect(alice.data.user.referrals).toBe(2); // the LINE sign-up came through Alice's link
    const forged = await api.get(`${base}/auth/line/callback?code=abc&state=forged`);
    expect(forged.headers.location).toContain(encodeURIComponent('"error":"state"'));
  });
  test('auth endpoints are rate limited', async () => {
    let last;
    for (let i = 0; i < 25; i += 1) last = await api.post(`${base}/auth/login`, { account: 'x@y.co', password: 'whatever-1' }); // eslint-disable-line no-await-in-loop
    expect(last.status).toBe(429);
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
  let srv; let url;
  beforeAll(async () => {
    const { RedisRestStore } = await import('../../mom-api/store.js');
    const app = express();
    app.use('/api', createMomRouter({ store: new RedisRestStore({ url: 'https://kv.example', token: 'kv-token', http: fakeRedis() }), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 's' } }));
    await new Promise((r) => { srv = app.listen(0, r); });
    url = `http://127.0.0.1:${srv.address().port}/api`;
  });
  afterAll(() => new Promise((r) => srv.close(r)));
  test('register, duplicate, referral, login, stats', async () => {
    const a = await api.post(`${url}/auth/register`, { account: 'kv@example.com', password: 'password-1', code: 'KVMOM1' });
    expect(a.status).toBe(201);
    expect((await api.post(`${url}/auth/register`, { account: 'kv@example.com', password: 'password-1' })).status).toBe(409);
    expect((await api.post(`${url}/auth/register`, { account: '0922333444', password: 'password-2', invitedBy: 'KVMOM1' })).status).toBe(201);
    const login = await api.post(`${url}/auth/login`, { account: 'kv@example.com', password: 'password-1' });
    expect(login.data.user.referrals).toBe(1);
    await api.post(`${url}/presence`, { sid: 'kv-tab-0001' });
    const s = await api.get(`${url}/stats`);
    expect(s.data).toMatchObject({ online: 1, registered: 2, storage: 'redis' });
  });
});
