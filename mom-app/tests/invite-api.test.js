/* 雙向邀請禮 on the member API: the friend's welcome gift and her inviter's count, on both stores. */
import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import express from 'express';
import axios from 'axios';
import { createMomRouter } from '../../mom-api/index.js';
import { MemoryStore, RedisRestStore } from '../../mom-api/store.js';
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
const DAY = 86400e3;

function flows(label, makeStore) {
  describe(`雙向邀請禮 (${label})`, () => {
    let srv; let base; let store; let clock = Date.UTC(2026, 10, 20, 4, 0, 0);
    let n = 0;
    const register = async (extra = {}) => {
      n += 1;
      const r = await api.post(`${base}/auth/register`, {
        consent: POLICY, account: `mom${n}@example.com`, password: 'baby-sleeps-9', ...extra,
      }, { headers: { 'X-Forwarded-For': `10.9.${n}.1` } }); // each mom on her own network (sign-ups are capped per network)
      expect(r.status).toBe(201);
      clock += 1000; // every account is a little newer than the one before
      return r.data;
    };
    const claim = (tok, body = {}) => api.post(`${base}/invite/claim`, body, auth(tok));
    const referrals = async (tok) => (await api.get(`${base}/me`, auth(tok))).data.user.referrals;
    beforeAll(async () => {
      store = makeStore();
      ({ server: srv, base } = await serve(createMomRouter({ store, env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 'i'.repeat(40), MOM_TRUST_PROXY: '1' }, now: () => clock })));
    });
    afterAll(() => close(srv));

    test('logged out → 401', async () => {
      expect((await api.post(`${base}/invite/claim`, {})).status).toBe(401);
    });

    test('joined with a link: the gift once, the inviter counted once', async () => {
      const host = await register();
      const friend = await register({ invitedBy: host.user.code });
      expect(friend.user.invite).toEqual({ by: host.user.code, gift: false, open: true });
      expect(await referrals(host.token)).toBe(0);
      const first = await claim(friend.token);
      expect(first.data).toMatchObject({ gift: true, counted: true });
      expect(first.data.user).toMatchObject({ invite: { by: host.user.code, gift: true, open: false }, referrals: 0 });
      const again = await claim(friend.token);
      expect(again.data).toMatchObject({ gift: false, already: true, counted: false });
      expect(await referrals(host.token)).toBe(1);
      // the export shows when her welcome gift was given
      const exp = (await api.get(`${base}/me/export`, auth(friend.token))).data;
      expect(exp.invitedBy).toBe(host.user.code);
      expect(exp.welcomeGiftAt).toBe(new Date(clock).toISOString()); // the clock hasn't moved since she claimed
      expect(JSON.stringify(exp)).not.toContain('refPending');
    });

    test('two claims at the same moment give one gift and one count', async () => {
      const host = await register();
      const friend = await register({ invitedBy: host.user.code });
      const both = await Promise.all([claim(friend.token), claim(friend.token)]);
      expect(both.map((r) => r.data.gift).sort()).toEqual([false, true]);
      expect(await referrals(host.token)).toBe(1);
    });

    test('joined without the link: she can type a friend’s code (not her own, not a newer account’s)', async () => {
      const host = await register();
      const friend = await register();
      const later = await register(); // made after her
      expect(friend.user.invite).toEqual({ by: null, gift: false, open: true });
      expect((await claim(friend.token)).data.error).toBe('no_code');
      expect((await claim(friend.token, { code: friend.user.code })).data.error).toBe('own_code');
      expect((await claim(friend.token, { code: later.user.code })).data.error).toBe('bad_code'); // no inviting each other
      expect((await claim(friend.token, { code: 'ZZZZZZ' })).data.error).toBe('bad_code');
      const ok = await claim(friend.token, { code: ` ${host.user.code.toLowerCase()} ` });
      expect(ok.data).toMatchObject({ gift: true, counted: true });
      expect(ok.data.user.invite.by).toBe(host.user.code);
      // her inviter never changes afterwards
      expect((await claim(friend.token, { code: later.user.code })).data.already).toBe(true);
      expect((await api.get(`${base}/me`, auth(friend.token))).data.user.invite.by).toBe(host.user.code);
      expect(await referrals(host.token)).toBe(1);
      expect(await referrals(later.token)).toBe(0);
    });

    test('only after agreeing to the current policy', async () => {
      const host = await register();
      const friend = await register({ invitedBy: host.user.code });
      await store.updateUser(friend.user.id, { consent: { version: '2000-01-01', at: clock } }); // agreed to an old one
      expect((await claim(friend.token)).data.error).toBe('need_consent');
      expect(await referrals(host.token)).toBe(0);
      await api.post(`${base}/me`, { consent: POLICY }, auth(friend.token));
      expect((await claim(friend.token)).data.gift).toBe(true);
      expect(await referrals(host.token)).toBe(1);
    });

    test('a welcome gift is for a new account: 14 days to claim it', async () => {
      const host = await register();
      const friend = await register({ invitedBy: host.user.code });
      clock += 15 * DAY;
      expect((await api.get(`${base}/me`, auth(friend.token))).data.user.invite).toEqual({ by: host.user.code, gift: false, open: false });
      expect((await claim(friend.token)).data.error).toBe('too_late');
      expect(await referrals(host.token)).toBe(0);
    });

    test('an inviter who deleted her account: the friend still gets her gift, nobody is counted', async () => {
      const host = await register();
      const friend = await register({ invitedBy: host.user.code });
      expect((await api.post(`${base}/auth/delete`, { password: 'baby-sleeps-9' }, auth(host.token))).data.ok).toBe(true);
      expect((await claim(friend.token)).data).toMatchObject({ gift: true, counted: false });
    });

    test('accounts counted at sign-up before this version are not counted twice', async () => {
      const host = await register();
      const friend = await register();
      await store.updateUser(friend.user.id, { invitedBy: host.user.code }); // the old way: no refPending, already counted
      await store.addReferral(host.user.code);
      expect((await claim(friend.token)).data).toMatchObject({ gift: true, counted: false });
      expect(await referrals(host.token)).toBe(1);
    });

    test('typing codes is rate limited', async () => {
      const friend = await register();
      let last;
      for (let i = 0; i < 21; i += 1) last = await claim(friend.token, { code: `NOPE${i}` }); // eslint-disable-line no-await-in-loop
      expect(last.status).toBe(429);
    });
  });
}

flows('memory', () => new MemoryStore());
flows('Redis REST', () => new RedisRestStore({ url: 'https://kv.example', token: 't', http: fakeRedis() }));
