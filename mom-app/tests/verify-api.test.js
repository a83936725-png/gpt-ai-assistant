/* 驗證碼與忘記密碼 on the member API: sign-up codes, password reset, verifying an older account, rewards that wait for
 * a verified account, and what is sent to Resend / Twilio / a webhook. */
import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import crypto from 'crypto';
import express from 'express';
import axios from 'axios';
import { createMomRouter } from '../../mom-api/index.js';
import { MemoryStore, RedisRestStore } from '../../mom-api/store.js';
import { makeSender, e164 } from '../../mom-api/verify.js';
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
const auth = (tok, ip) => ({ headers: { Authorization: `Bearer ${tok}`, ...(ip ? { 'X-Forwarded-For': ip } : {}) } });
const STRONG = 'v'.repeat(40);
const GB = JSON.stringify([{
  id: 'gb-v', title: '團', price: 100, size: 3, ends: '2026-12-31', code: 'V-1',
}]);

describe('without a way to send codes, nothing changes', () => {
  let srv; let base;
  beforeAll(async () => { ({ server: srv, base } = await serve(createMomRouter({ store: new MemoryStore(), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: STRONG } }))); });
  afterAll(() => close(srv));
  test('no code asked, accounts are simply not verified, rewards are not held back', async () => {
    expect((await api.get(`${base}/config`)).data.verify).toEqual({ email: false, phone: false });
    expect((await api.post(`${base}/auth/code`, { account: 'a@example.com', purpose: 'register', consent: POLICY })).data.error).toBe('verify_off');
    const host = await api.post(`${base}/auth/register`, { consent: POLICY, account: 'host@example.com', password: 'baby-sleeps-9' });
    expect(host.status).toBe(201);
    expect(host.data.user.verified).toBe(false);
    const friend = await api.post(`${base}/auth/register`, {
      consent: POLICY, account: 'friend@example.com', password: 'baby-sleeps-9', invitedBy: host.data.user.code,
    });
    expect((await api.post(`${base}/invite/claim`, {}, auth(friend.data.token))).data.gift).toBe(true);
  });
  test('the test echo is never available in production', () => {
    expect(makeSender({ MOM_CODE_ECHO: '1' }, null, true)).toMatchObject({ email: false, phone: false, echo: false });
    expect(makeSender({ MOM_CODE_ECHO: '1' }, null, false)).toMatchObject({ email: true, phone: true, echo: true });
    expect(makeSender({ MOM_CODE_WEBHOOK_URL: 'http://not-https.example/hook' }, null, false)).toMatchObject({ email: false, phone: false });
  });
});

function flows(label, makeStore) {
  describe(`驗證碼 (${label})`, () => {
    let srv; let base; let store; let clock = Date.UTC(2026, 10, 20, 4, 0, 0); let n = 0;
    const later = () => { clock += 61 * 1000; }; // a new code for the same address: at most one a minute
    const ip = () => { n += 1; return `10.6.${n}.1`; };
    const code = (body, net) => api.post(`${base}/auth/code`, body, { headers: { 'X-Forwarded-For': net } });
    const signUp = async (account, extra = {}) => {
      const net = ip();
      const c = await code({ account, purpose: 'register', consent: POLICY }, net);
      expect(c.data.devCode).toMatch(/^\d{6}$/);
      const r = await api.post(`${base}/auth/register`, {
        consent: POLICY, account, password: 'baby-sleeps-9', code: c.data.devCode, ...extra,
      }, { headers: { 'X-Forwarded-For': net } });
      expect(r.status).toBe(201);
      return { ...r.data, ip: net };
    };
    beforeAll(async () => {
      store = makeStore(() => clock);
      ({ server: srv, base } = await serve(createMomRouter({
        store,
        now: () => clock,
        env: {
          NODE_ENV: 'test', MOM_AUTH_SECRET: STRONG, MOM_TRUST_PROXY: '1', MOM_CODE_ECHO: '1', MOM_GROUPBUYS: GB,
        },
      })));
    });
    afterAll(() => close(srv));

    test('the app learns that Email and phone sign-ups confirm a code', async () => {
      expect((await api.get(`${base}/config`)).data.verify).toEqual({ email: true, phone: true });
    });

    test('sign-up: a code first (after agreeing), then the account, verified', async () => {
      const net = ip();
      expect((await code({ account: 'mia@example.com', purpose: 'register' }, net)).data.error).toBe('need_consent');
      expect((await api.post(`${base}/auth/register`, { consent: POLICY, account: 'mia@example.com', password: 'baby-sleeps-9' }, { headers: { 'X-Forwarded-For': net } })).data.error).toBe('need_code');
      const c = await code({ account: 'Mia@Example.com', purpose: 'register', consent: POLICY }, net);
      expect(c.data).toMatchObject({ ok: true, ttl: 600 });
      const wrong = String((Number(c.data.devCode) + 1) % 1000000).padStart(6, '0');
      expect((await api.post(`${base}/auth/register`, {
        consent: POLICY, account: 'mia@example.com', password: 'baby-sleeps-9', code: wrong,
      }, { headers: { 'X-Forwarded-For': net } })).data.error).toBe('bad_code');
      const r = await api.post(`${base}/auth/register`, {
        consent: POLICY, account: 'mia@example.com', password: 'baby-sleeps-9', code: ` ${c.data.devCode} `,
      }, { headers: { 'X-Forwarded-For': net } });
      expect(r.status).toBe(201);
      expect(r.data.user.verified).toBe(true);
      const signedAt = clock;
      // the address now has an account: asking again looks exactly the same (no code, a 「已經註冊過」 notice instead),
      // and no guessed code can tell either
      clock += 61 * 1000;
      const again = await code({ account: 'mia@example.com', purpose: 'register', consent: POLICY }, ip());
      expect(again.data).toEqual({ ok: true, ttl: 600 });
      expect((await api.post(`${base}/auth/register`, {
        consent: POLICY, account: 'mia@example.com', password: 'baby-sleeps-9', code: '123456',
      }, { headers: { 'X-Forwarded-For': ip() } })).data.error).toMatch(/^(bad_code|code_expired)$/);
      const exp = (await api.get(`${base}/me/export`, auth(r.data.token))).data;
      expect(exp.verifiedAt).toBe(new Date(signedAt).toISOString());
    });

    test('codes: one a minute, 10 minutes long, 5 tries', async () => {
      const net = ip();
      const first = await code({ account: '0912000001', purpose: 'register', consent: POLICY }, net);
      expect(first.data.devCode).toBeTruthy();
      expect((await code({ account: '0912000001', purpose: 'register', consent: POLICY }, net)).data.error).toBe('wait');
      clock += 61 * 1000;
      const second = await code({ account: '0912000001', purpose: 'register', consent: POLICY }, net);
      const reg = (c) => api.post(`${base}/auth/register`, {
        consent: POLICY, account: '0912000001', password: 'baby-sleeps-9', code: c,
      }, { headers: { 'X-Forwarded-For': net } });
      if (first.data.devCode !== second.data.devCode) expect((await reg(first.data.devCode)).data.error).toBe('bad_code'); // the old one no longer works
      clock += 11 * 60 * 1000;
      expect((await reg(second.data.devCode)).data.error).toBe('code_expired');
      const third = await code({ account: '0912000001', purpose: 'register', consent: POLICY }, net);
      const wrong = String((Number(third.data.devCode) + 1) % 1000000).padStart(6, '0');
      const tries = [];
      for (let i = 0; i < 5; i += 1) tries.push((await reg(wrong)).data.error); // eslint-disable-line no-await-in-loop
      expect(tries).toEqual(['bad_code', 'bad_code', 'bad_code', 'bad_code', 'code_too_many']);
      expect((await reg(third.data.devCode)).data.error).toBe('code_too_many'); // even the right one, now
    });

    test('忘記密碼: the same answer for unknown addresses; a code, a new password, other devices logged out', async () => {
      const a = await signUp('reset@example.com');
      later();
      const unknown = await code({ account: 'nobody@example.com', purpose: 'reset' }, ip());
      expect(unknown.data).toEqual({ ok: true, ttl: 600 }); // no code sent, nothing revealed
      const c = await code({ account: 'reset@example.com', purpose: 'reset' }, a.ip);
      expect(c.data.devCode).toMatch(/^\d{6}$/);
      expect((await api.post(`${base}/auth/reset`, { account: 'reset@example.com', code: c.data.devCode, password: 'password123' })).data.error).toBe('common_password');
      const r = await api.post(`${base}/auth/reset`, { account: 'reset@example.com', code: c.data.devCode, password: 'new-baby-sleeps-1' });
      expect(r.status).toBe(200);
      expect(r.data.user.nickname).toBeTruthy();
      expect((await api.get(`${base}/me`, auth(a.token))).status).toBe(401); // the old session is gone
      expect((await api.get(`${base}/me`, auth(r.data.token))).status).toBe(200);
      expect((await api.post(`${base}/auth/login`, { account: 'reset@example.com', password: 'baby-sleeps-9' })).status).toBe(401);
      expect((await api.post(`${base}/auth/login`, { account: 'reset@example.com', password: 'new-baby-sleeps-1' })).status).toBe(200);
      expect((await api.post(`${base}/auth/reset`, { account: 'reset@example.com', code: c.data.devCode, password: 'another-pass-22' })).data.error).toBe('code_expired'); // used once
    });

    test('an older account that never confirmed: rewards wait until it does', async () => {
      const host = await signUp('vhost@example.com');
      const old = await signUp('old@example.com', { invitedBy: host.user.code });
      await store.updateUser(old.user.id, { verifiedAt: null }); // made before codes existed
      later();
      expect((await api.get(`${base}/me`, auth(old.token))).data.user.verified).toBe(false);
      expect((await api.post(`${base}/invite/claim`, {}, auth(old.token, old.ip))).data.error).toBe('need_verify');
      expect((await api.post(`${base}/groupbuy/start`, { campaign: 'gb-v' }, auth(old.token, old.ip))).data.error).toBe('need_verify');
      const s = await api.post(`${base}/auth/verify/send`, {}, auth(old.token, old.ip));
      expect(s.data.devCode).toMatch(/^\d{6}$/);
      expect((await api.post(`${base}/auth/verify`, { code: '000000' === s.data.devCode ? '111111' : '000000' }, auth(old.token, old.ip))).data.error).toBe('bad_code');
      const v = await api.post(`${base}/auth/verify`, { code: s.data.devCode }, auth(old.token, old.ip));
      expect(v.data.user.verified).toBe(true);
      expect((await api.post(`${base}/invite/claim`, {}, auth(old.token, old.ip))).data.gift).toBe(true);
      expect((await api.post(`${base}/groupbuy/start`, { campaign: 'gb-v' }, auth(old.token, old.ip))).status).toBe(201);
      expect((await api.post(`${base}/auth/verify/send`, {}, auth(old.token, old.ip))).data.already).toBe(true);
    });
  });
}
flows('memory', () => new MemoryStore());
flows('Redis REST', (now) => new RedisRestStore({ url: 'https://kv.example', token: 't', http: fakeRedis({ now }) }));

describe('what leaves the server', () => {
  let t = Date.UTC(2026, 10, 20, 4, 0, 0);
  const run = async (env) => {
    const calls = [];
    const http = { post: async (url, body, opts) => { calls.push({ url, body, opts }); return { data: {} }; } };
    const { server, base } = await serve(createMomRouter({
      store: new MemoryStore(), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: STRONG, ...env }, http, now: () => t,
    }));
    return { server, base, calls };
  };
  test('Email through Resend: the address, the code, the API key as a Bearer token; no code in the answer', async () => {
    const { server, base, calls } = await run({ RESEND_API_KEY: 're_test', MOM_MAIL_FROM: '易家做媽媽 <no-reply@brand.example>' });
    expect((await api.get(`${base}/config`)).data.verify).toEqual({ email: true, phone: false });
    const r = await api.post(`${base}/auth/code`, { account: 'mia@example.com', purpose: 'register', consent: POLICY });
    expect(r.data).toEqual({ ok: true, ttl: 600 });
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].opts.headers.Authorization).toBe('Bearer re_test');
    expect(calls[0].body).toMatchObject({ from: '易家做媽媽 <no-reply@brand.example>', to: ['mia@example.com'] });
    expect(calls[0].body.text).toMatch(/驗證碼：\d{6}，10 分鐘內有效/);
    // a phone sign-up has no way to get a code here, so it goes on as before
    expect((await api.post(`${base}/auth/register`, { consent: POLICY, account: '0912345678', password: 'baby-sleeps-9' })).status).toBe(201);
    // the emailed code makes the account; asking again for that address sends a notice (no code), same answer
    const mailed = calls[0].body.text.match(/(\d{6})/)[1];
    expect((await api.post(`${base}/auth/register`, {
      consent: POLICY, account: 'mia@example.com', password: 'baby-sleeps-9', code: mailed,
    })).status).toBe(201);
    t += 61 * 1000; // one message a minute per address
    const again = await api.post(`${base}/auth/code`, { account: 'mia@example.com', purpose: 'register', consent: POLICY }, { headers: { 'X-Forwarded-For': '10.1.1.1' } });
    expect(again.data).toEqual({ ok: true, ttl: 600 });
    expect(calls[1].body.subject).toBe('易家做媽媽 帳號通知');
    expect(calls[1].body.text).toMatch(/已經註冊過了，請直接登入/);
    expect(calls[1].body.text).not.toMatch(/\d{6}/);
    await close(server);
  });
  test('SMS through Twilio: +886 number, form fields, the account SID and token as Basic auth', async () => {
    const { server, base, calls } = await run({ TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: 'YIJIA' });
    await api.post(`${base}/auth/code`, { account: '0912-345-678', purpose: 'register', consent: POLICY });
    expect(calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(calls[0].opts.auth).toEqual({ username: 'AC123', password: 'tok' });
    const form = new URLSearchParams(calls[0].body);
    expect(form.get('To')).toBe('+886912345678');
    expect(form.get('From')).toBe('YIJIA');
    expect(form.get('Body')).toMatch(/驗證碼：\d{6}/);
    expect(e164('0912345678')).toBe('+886912345678');
    await close(server);
  });
  test('any other service through a signed webhook', async () => {
    const { server, base, calls } = await run({ MOM_CODE_WEBHOOK_URL: 'https://brand.example/send-code', MOM_CODE_WEBHOOK_SECRET: 'hook-secret' });
    await api.post(`${base}/auth/code`, { account: '0912345678', purpose: 'register', consent: POLICY });
    const body = JSON.parse(calls[0].body);
    expect(body).toMatchObject({ channel: 'sms', to: '+886912345678', purpose: 'register' });
    expect(body.code).toMatch(/^\d{6}$/);
    const sig = crypto.createHmac('sha256', 'hook-secret').update(calls[0].body).digest('hex');
    expect(calls[0].opts.headers['X-Mom-Signature']).toBe(`sha256=${sig}`);
    await close(server);
  });
  test('a failed send says so (and leaves no code behind)', async () => {
    const http = { post: async () => { throw new Error('provider down'); } };
    const { server, base } = await serve(createMomRouter({ store: new MemoryStore(), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: STRONG, RESEND_API_KEY: 'k', MOM_MAIL_FROM: 'a@b.example' }, http }));
    const errs = console.error; console.error = () => {};
    const r = await api.post(`${base}/auth/code`, { account: 'mia@example.com', purpose: 'register', consent: POLICY });
    console.error = errs;
    expect(r.status).toBe(502);
    expect(r.data.error).toBe('send_failed');
    await close(server);
  });
});
