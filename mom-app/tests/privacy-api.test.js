import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import express from 'express';
import axios from 'axios';
import { createMomRouter } from '../../mom-api/index.js';
import { MemoryStore, RedisRestStore } from '../../mom-api/store.js';
import { hashKey, ipBucket } from '../../mom-api/auth.js';
import { POLICY_VERSION as POLICY } from '../../mom-api/policy.js';
import { fakeRedis } from './fake-redis.js';

const api = axios.create({ validateStatus: () => true, maxRedirects: 0 });
async function serve(router) {
  const app = express();
  app.use('/mom-app/api', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}/mom-app/api` };
}
const close = (s) => new Promise((r) => s.close(r));
const auth = (tok) => ({ headers: { Authorization: `Bearer ${tok}` } });
const LINE_ENV = {
  NODE_ENV: 'test', MOM_AUTH_SECRET: 'p'.repeat(40), LINE_LOGIN_CHANNEL_ID: '1650000000', LINE_LOGIN_CHANNEL_SECRET: 'line-secret',
};
const fakeLine = {
  post: async () => ({ data: { access_token: 'line-access' } }),
  get: async () => ({ data: { userId: `U${'a'.repeat(32)}`, displayName: 'LINE 媽咪' } }),
};

function flows(label, makeStore) {
  describe(`個資：同意、下載、刪除 (${label})`, () => {
    let srv; let base; let store;
    beforeAll(async () => {
      store = makeStore();
      ({ server: srv, base } = await serve(createMomRouter({ store, env: LINE_ENV, http: fakeLine })));
    });
    afterAll(() => close(srv));

    test('the app learns which policy version is current', async () => {
      expect((await api.get(`${base}/config`)).data.policy).toBe(POLICY);
    });

    let tok;
    test('sign-up needs a tick for the current policy; marketing is a separate, optional choice', async () => {
      const no = await api.post(`${base}/auth/register`, { account: 'mia@example.com', password: 'baby-sleeps-9' });
      expect(no.status).toBe(400);
      expect(no.data).toMatchObject({ error: 'need_consent', policy: POLICY });
      const old = await api.post(`${base}/auth/register`, { account: 'mia@example.com', password: 'baby-sleeps-9', consent: '2020-01-01' });
      expect(old.data.error).toBe('policy_changed');
      const ok = await api.post(`${base}/auth/register`, { account: 'mia@example.com', password: 'baby-sleeps-9', consent: POLICY });
      expect(ok.status).toBe(201);
      expect(ok.data.user).toMatchObject({ consent: POLICY, marketing: false });
      tok = ok.data.token;
      const yes = await api.post(`${base}/auth/register`, { account: '0911222333', password: 'baby-sleeps-9', consent: POLICY, marketing: true });
      expect(yes.data.user.marketing).toBe(true);
      const sneaky = await api.post(`${base}/auth/register`, { account: '0911222444', password: 'baby-sleeps-9', consent: POLICY, marketing: 'yes' });
      expect(sneaky.data.user.marketing).toBe(false); // only a real yes counts
    });

    test('marketing can be turned off (and on) any time; a policy version that is not current is refused', async () => {
      let r = await api.post(`${base}/me`, { marketing: true }, auth(tok));
      expect(r.data.user.marketing).toBe(true);
      r = await api.post(`${base}/me`, { marketing: false }, auth(tok));
      expect(r.data.user.marketing).toBe(false);
      expect((await api.post(`${base}/me`, { consent: '2020-01-01' }, auth(tok))).data.error).toBe('policy_changed');
    });

    test('a copy of my data: everything kept about me, never the password hash', async () => {
      const r = await api.get(`${base}/me/export`, auth(tok));
      expect(r.status).toBe(200);
      expect(r.data).toMatchObject({ account: { type: 'email', value: 'mia@example.com' }, provider: 'email', consent: { version: POLICY }, marketing: { on: false } });
      expect(r.data.consent.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(JSON.stringify(r.data)).not.toMatch(/scrypt|passwordHash|"tv"/);
      expect((await api.get(`${base}/me/export`)).status).toBe(401);
    });

    test('LINE: a new account has no consent yet (the app asks first); agreeing records it', async () => {
      const nonce = 'nonce-0123456789abcdef';
      const start = await api.get(`${base}/auth/line/start?nonce=${nonce}`);
      const state = new URL(start.headers.location).searchParams.get('state');
      const cb = await api.get(`${base}/auth/line/callback?code=c&state=${encodeURIComponent(state)}`);
      const back = JSON.parse(decodeURIComponent(cb.headers.location.split('#/login?')[1]));
      const me = await api.get(`${base}/me`, auth(back.token));
      expect(me.data.user.consent).toBeNull();
      const agreed = await api.post(`${base}/me`, { consent: POLICY }, auth(back.token));
      expect(agreed.data.user.consent).toBe(POLICY);
      // LINE accounts have no password: deleting needs only the logged-in app
      expect((await api.post(`${base}/auth/delete`, {}, auth(back.token))).data.ok).toBe(true);
      expect((await api.get(`${base}/me`, auth(back.token))).status).toBe(401);
    });

    test('deleting my account: the password is asked again; afterwards nothing is left and the email is free again', async () => {
      const me = (await api.get(`${base}/me`, auth(tok))).data.user;
      expect((await api.post(`${base}/auth/delete`, { password: 'wrong-password' }, auth(tok))).status).toBe(401);
      expect((await api.post(`${base}/auth/delete`, { password: 'baby-sleeps-9' })).status).toBe(401); // not logged in
      expect((await api.post(`${base}/auth/delete`, { password: 'baby-sleeps-9' }, auth(tok))).data.ok).toBe(true);
      expect((await api.get(`${base}/me`, auth(tok))).status).toBe(401);
      expect((await api.post(`${base}/auth/login`, { account: 'mia@example.com', password: 'baby-sleeps-9' })).status).toBe(401);
      // her invite code no longer belongs to anyone
      const friend = await api.post(`${base}/auth/register`, { account: 'friend@example.com', password: 'baby-sleeps-9', consent: POLICY, invitedBy: me.code });
      expect(friend.status).toBe(201);
      expect(await store.countReferrals(me.code)).toBe(0);
      const again = await api.post(`${base}/auth/register`, { account: 'mia@example.com', password: 'baby-sleeps-9', consent: POLICY });
      expect(again.status).toBe(201);
      expect(again.data.user.code).not.toBe(me.code);
    });

    test('a stolen, logged-in phone cannot guess the password through 刪除帳號', async () => {
      const r = await api.post(`${base}/auth/register`, { account: 'guess@example.com', password: 'baby-sleeps-9', consent: POLICY });
      let last;
      for (let i = 0; i < 12; i += 1) last = await api.post(`${base}/auth/delete`, { password: `nope-${i}-pass` }, auth(r.data.token)); // eslint-disable-line no-await-in-loop
      expect(last.status).toBe(429);
    });
  });
}

flows('memory', () => new MemoryStore());
flows('Redis REST', () => new RedisRestStore({ url: 'https://kv.example', token: 't', http: fakeRedis() }));

describe('network addresses are not kept in a form that can be turned back', () => {
  test('rate-limit keys use a keyed hash, not a plain hash of the address', async () => {
    const store = new MemoryStore();
    const { server, base } = await serve(createMomRouter({ store, env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 'k'.repeat(40) } }));
    await api.post(`${base}/auth/login`, { account: 'x@example.com', password: 'whatever-1' });
    const keys = [...store.counters.keys()];
    expect(keys.length).toBeGreaterThan(0);
    const plain = ['127.0.0.1', '::ffff:127.0.0.1', '::1'].map((ip) => hashKey(ipBucket(ip)));
    expect(keys.some((k) => plain.some((h) => k.includes(h)))).toBe(false);
    await close(server);
  });
});
