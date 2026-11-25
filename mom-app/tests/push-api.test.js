/* 手機通知 (Web Push, optional LINE messages) on the member API: phones subscribe (members only, real push services
 * only, at most 5), reminders are scheduled with fixed words and sent by the runner (cron or an open app checking in),
 * group-buy progress goes to the others in the team, and everything goes with the account. Both stores. */
import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import express from 'express';
import axios from 'axios';
import { createMomRouter } from '../../mom-api/index.js';
import { MemoryStore, RedisRestStore } from '../../mom-api/store.js';
import { cleanSub, mountPush, pushHost } from '../../mom-api/push.js';
import { makeMetrics } from '../../mom-api/metrics.js';
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
const MIN = 60e3; const HOUR = 3600e3; const DAY = 24 * HOUR;
const START = Date.UTC(2026, 10, 20, 4, 0, 0); // 2026-11-20 12:00 in Taipei
const VAPID = { MOM_VAPID_PUBLIC: 'BPublicKeyForTests_abcdefghijklmnopqrstuvwxyz0123456789-_', MOM_VAPID_PRIVATE: 'private-key-for-tests', MOM_VAPID_SUBJECT: 'mailto:push@example.com' };
const CAMPAIGNS = [{
  id: 'gb-test', title: '易家滴雞精 10 入', price: 1980, size: 3, hours: 48, ends: '2026-11-30', code: 'TEAM-OK-1',
}];
let seq = 0;
const sub = (host = 'fcm.googleapis.com') => { seq += 1; return { endpoint: `https://${host}/fcm/send/device-${seq}`, keys: { p256dh: `BKey${seq}_p256dh-xyz`, auth: `auth${seq}-abc` } }; };

describe('subscriptions', () => {
  test('only the push services browsers use are accepted, over https, with sane keys', () => {
    expect(pushHost('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(pushHost('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(pushHost('https://web.push.apple.com/QGx')).toBe(true);
    expect(pushHost('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    expect(pushHost('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(pushHost('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(pushHost('https://evil.example/fcm.googleapis.com')).toBe(false);
    expect(pushHost('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(pushHost('https://169.254.169.254/latest')).toBe(false);
    expect(pushHost('https://localhost/x')).toBe(false);
    expect(cleanSub({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'abc', auth: 'de' } })).toEqual({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'abc', auth: 'de' } });
    expect(cleanSub({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: '<script>', auth: 'de' } })).toBeNull();
    expect(cleanSub({ endpoint: 'https://fcm.googleapis.com/x' })).toBeNull();
    expect(cleanSub(null)).toBeNull();
  });

  test('LINE messages: only for LINE members who asked, never for reminders, with a link to the app', async () => {
    const posted = [];
    const http = { post: async (url, body, opts) => { posted.push({ url, body, auth: opts.headers.Authorization }); return { data: {} }; } };
    const store = new MemoryStore();
    await store.createUser({ id: 'u-line', account: `line:U${'a'.repeat(32)}`, provider: 'line', code: 'AAA111', lineNotify: true, createdAt: START });
    await store.createUser({ id: 'u-line-off', account: `line:U${'b'.repeat(32)}`, provider: 'line', code: 'BBB222', createdAt: START });
    await store.createUser({ id: 'u-mail', account: 'email:a@example.com', provider: 'email', code: 'CCC333', lineNotify: true, createdAt: START });
    const push = mountPush(express.Router(), {
      store, now: () => START, over: async () => false, wrap: (f) => f, currentUser: async () => null, metrics: makeMetrics({ store, now: () => START }), http,
      env: { NODE_ENV: 'test', MOM_LINE_MESSAGING_TOKEN: 'line-token', MOM_PUBLIC_URL: 'https://mom.example/mom-app' },
    });
    expect(push.on).toBe(false); // no VAPID keys: no Web Push, LINE still works
    expect(push.lineOn).toBe(true);
    const n = await push.notify(['u-line', 'u-line-off', 'u-mail'], 'gb', { title: '成團了！🎉', body: '「易家滴雞精」成團了', url: '#/groupbuy' });
    expect(n).toBe(1);
    expect(posted).toEqual([{
      url: 'https://api.line.me/v2/bot/message/push',
      body: { to: `U${'a'.repeat(32)}`, messages: [{ type: 'text', text: '成團了！🎉\n「易家滴雞精」成團了\nhttps://mom.example/mom-app/#/groupbuy' }] },
      auth: 'Bearer line-token',
    }]);
    expect(await push.notify(['u-line'], 'remind', { title: 'x', body: 'y' })).toBe(0);
    expect(await push.notify(['u-line'], 'made-up', { title: 'x', body: 'y' })).toBe(0);
    expect(posted).toHaveLength(1);
  });
});

function flows(label, makeStore) {
  describe(`手機通知 (${label})`, () => {
    let srv; let base; let clock = START; let n = 0; let store;
    const sent = []; const fails = new Map(); // endpoint → status code to fail with
    const pushSender = async (s, body) => {
      if (fails.has(s.endpoint)) { const e = new Error('push failed'); e.statusCode = fails.get(s.endpoint); throw e; }
      sent.push({ endpoint: s.endpoint, ...JSON.parse(body) });
    };
    const reg = async () => {
      n += 1;
      const ip = `10.31.${n}.1`;
      const r = await api.post(`${base}/auth/register`, {
        consent: POLICY, account: `pu${n}@example.com`, password: 'baby-sleeps-9', nickname: `媽媽${n}`,
      }, { headers: { 'X-Forwarded-For': ip } });
      expect(r.status).toBe(201);
      return { token: r.data.token, user: r.data.user, ip };
    };
    const as = (u) => ({ headers: { Authorization: `Bearer ${u.token}`, 'X-Forwarded-For': u.ip } });
    const subscribe = (u, s, topics = { gb: true, family: true, remind: true }) => api.post(`${base}/push/subscribe`, { sub: s, topics }, as(u));
    const cron = (secret = 'cron-secret-for-tests') => api.get(`${base}/push/run`, { headers: { Authorization: `Bearer ${secret}` } });
    const devices = async (u) => store.hgetAllJson(`push:d:${u.user.id}`, clock);
    beforeAll(async () => {
      store = makeStore();
      ({ server: srv, base } = await serve(createMomRouter({
        store,
        now: () => clock,
        pushSender,
        env: {
          NODE_ENV: 'test', MOM_AUTH_SECRET: 'p'.repeat(40), MOM_TRUST_PROXY: '1', MOM_GROUPBUYS: JSON.stringify(CAMPAIGNS), MOM_CRON_SECRET: 'cron-secret-for-tests', MOM_ADMIN_KEY: 'admin-key-for-push-tests-0123', ...VAPID,
        },
      })));
    });
    afterAll(() => close(srv));

    test('the app learns the public key from /config', async () => {
      const r = await api.get(`${base}/config`);
      expect(r.data.push).toBe(VAPID.MOM_VAPID_PUBLIC);
      expect(r.data.lineNotify).toBe(false);
    });

    test('subscribing: members only, real push services only, topics cleaned', async () => {
      const a = await reg();
      expect((await api.post(`${base}/push/subscribe`, { sub: sub() })).status).toBe(401);
      expect((await subscribe(a, { endpoint: 'https://evil.example/x', keys: { p256dh: 'a', auth: 'b' } })).data.error).toBe('bad_sub');
      expect((await subscribe(a, { endpoint: 'http://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } })).data.error).toBe('bad_sub');
      const r = await api.post(`${base}/push/subscribe`, { sub: sub(), topics: { gb: 1, remind: 'yes', hack: true } }, as(a));
      expect(r.data).toEqual({ ok: true, topics: { gb: true, family: false, remind: true } });
      expect(Object.keys(await devices(a))).toHaveLength(1);
    });

    test('at most 5 phones: the oldest makes room; a phone has one owner', async () => {
      const a = await reg(); const b = await reg();
      const subs = [];
      for (let i = 0; i < 6; i += 1) { subs.push(sub()); clock += 1000; await subscribe(a, subs[i]); } // eslint-disable-line no-await-in-loop
      const left = Object.values(await devices(a)).map((d) => d.sub.endpoint);
      expect(left).toHaveLength(5);
      expect(left).not.toContain(subs[0].endpoint);
      await subscribe(b, subs[5]); // she logged out, her friend logged in on the same phone
      expect(Object.values(await devices(a)).map((d) => d.sub.endpoint)).not.toContain(subs[5].endpoint);
      expect(Object.values(await devices(b)).map((d) => d.sub.endpoint)).toEqual([subs[5].endpoint]);
    });

    test('a test notification; a phone that unsubscribed (410) is removed', async () => {
      const a = await reg(); const s = sub();
      await subscribe(a, s);
      const r = await api.post(`${base}/push/test`, { endpoint: s.endpoint }, as(a));
      expect(r.data).toEqual({ ok: true, result: 'sent' });
      expect(sent[sent.length - 1]).toMatchObject({ endpoint: s.endpoint, title: '通知設定好了 💜', url: '#/reminders' });
      fails.set(s.endpoint, 410);
      expect((await api.post(`${base}/push/test`, { endpoint: s.endpoint }, as(a))).data.result).toBe('gone');
      expect(await devices(a)).toEqual({});
      fails.delete(s.endpoint);
      expect((await api.post(`${base}/push/test`, { endpoint: s.endpoint }, as(a))).status).toBe(404);
    });

    test('reminders: fixed words (never what the appointment is), on time, daily ones repeat, late ones are dropped', async () => {
      const a = await reg(); const s = sub();
      await subscribe(a, s);
      const t0 = clock;
      const r = await api.post(`${base}/push/schedule`, {
        endpoint: s.endpoint,
        jobs: [
          { kind: 'feed', at: clock + 10 * MIN }, { kind: 'chicken', at: clock + 20 * MIN, daily: true }, { kind: 'appt', at: clock + 30 * MIN, title: '產檢：第 8 次' },
          { kind: 'hack', at: clock + MIN }, { kind: 'feed', at: clock + 30 * DAY }, { kind: 'feed', at: clock - HOUR },
        ],
      }, as(a));
      expect(r.data).toEqual({ ok: true, jobs: 3 });
      const before = sent.length;
      expect((await cron()).data).toMatchObject({ ok: true, sent: 0 }); // nothing due yet
      clock += 11 * MIN;
      expect((await cron()).data.sent).toBe(1);
      expect(sent.slice(before)).toEqual([{ endpoint: s.endpoint, title: '餵奶提醒', body: '差不多是寶寶喝奶的時間了', url: '#/home', tag: 'remind-feed', kind: 'remind' }]);
      clock += 20 * MIN;
      expect((await cron()).data.sent).toBe(2);
      const words = JSON.stringify(sent.slice(before));
      expect(words).toContain('滴雞精時光');
      expect(words).toContain('今天或明天有預約');
      expect(words).not.toContain('產檢');
      // the daily one comes back tomorrow at the same time
      const jobs = Object.values(await devices(a))[0].jobs;
      expect(jobs).toHaveLength(1);
      expect(Number(jobs[0].split('|')[4])).toBe(t0 + 20 * MIN + DAY);
      // she does not open the app for a week: a daily reminder late by more than 3 hours is dropped and stops repeating
      clock = t0 + 20 * MIN + 8 * DAY;
      expect((await cron()).data).toMatchObject({ sent: 0, dropped: 1 });
      expect(Object.values(await devices(a))[0].jobs).toEqual([]);
    });

    test('scheduling again replaces the phone\'s reminders; a phone without 「提醒」 gets none', async () => {
      const a = await reg(); const s = sub();
      await subscribe(a, s, { gb: true, remind: false });
      await api.post(`${base}/push/schedule`, { endpoint: s.endpoint, jobs: [{ kind: 'feed', at: clock + MIN }, { kind: 'appt', at: clock + 2 * MIN }] }, as(a));
      await api.post(`${base}/push/schedule`, { endpoint: s.endpoint, jobs: [{ kind: 'feed', at: clock + 3 * MIN }] }, as(a));
      expect(Object.values(await devices(a))[0].jobs).toHaveLength(1);
      const before = sent.length;
      clock += 5 * MIN;
      await cron();
      expect(sent.length).toBe(before);
    });

    test('the runner: a secret is needed; an open app checking in also sends what is due', async () => {
      expect((await cron('wrong')).status).toBe(401);
      expect((await api.get(`${base}/push/run`)).status).toBe(401);
      expect((await api.post(`${base}/push/run`, {}, { headers: { 'x-cron-secret': 'cron-secret-for-tests' } })).status).toBe(200);
      const a = await reg(); const s = sub();
      await subscribe(a, s);
      await api.post(`${base}/push/schedule`, { endpoint: s.endpoint, jobs: [{ kind: 'chicken', at: clock + MIN }] }, as(a));
      clock += 2 * MIN;
      const before = sent.length;
      await api.post(`${base}/presence`, { sid: `push-presence-${label.length}` }, { headers: { 'X-Forwarded-For': '10.31.200.1' } });
      expect(sent.slice(before).map((x) => x.title)).toEqual(['滴雞精時光']);
    });

    test('group-buy news goes to the others in the team (not the one joining), by what happened', async () => {
      const a = await reg(); const b = await reg(); const c = await reg();
      const [sa, sb, sc] = [sub(), sub(), sub()];
      await subscribe(a, sa); await subscribe(b, sb); await subscribe(c, sc, { gb: false, remind: true });
      const team = (await api.post(`${base}/groupbuy/start`, { campaign: 'gb-test' }, as(a))).data.team;
      let before = sent.length;
      await api.post(`${base}/groupbuy/team/${team.id}/join`, {}, as(b));
      let got = sent.slice(before);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ endpoint: sa.endpoint, title: '差 1 人就成團！', body: '「易家滴雞精 10 入」現在 2/3 人，再找 1 位朋友就成團', tag: `gb-${team.id}`, kind: 'gb' });
      expect(got[0].url).toBe(`#/groupbuy?${encodeURIComponent(JSON.stringify({ team: team.id }))}`);
      before = sent.length;
      await api.post(`${base}/groupbuy/team/${team.id}/join`, {}, as(c)); // full
      got = sent.slice(before);
      expect(got.map((x) => x.endpoint).sort()).toEqual([sa.endpoint, sb.endpoint].sort());
      expect(got.every((x) => x.title === '成團了！🎉' && !x.body.includes('TEAM-OK-1'))).toBe(true); // the code itself only in the app
    });

    test('LINE messages are off without the token; the 下載我的資料 copy lists phones, not their push addresses', async () => {
      const a = await reg(); const s = sub();
      expect((await api.post(`${base}/push/line`, { on: true }, as(a))).data.error).toBe('line_off');
      await subscribe(a, s);
      const ex = await api.get(`${base}/me/export`, as(a));
      expect(ex.data.notifications.phones).toHaveLength(1);
      expect(ex.data.notifications.phones[0].topics).toEqual({ gb: true, family: true, remind: true });
      expect(JSON.stringify(ex.data)).not.toContain(s.endpoint);
      expect(JSON.stringify(ex.data)).not.toContain(s.keys.auth);
    });

    test('deleting the account removes every phone and its reminders; the dashboard counts phones and sends', async () => {
      const a = await reg(); const s = sub();
      await subscribe(a, s);
      await api.post(`${base}/push/schedule`, { endpoint: s.endpoint, jobs: [{ kind: 'feed', at: clock + HOUR }] }, as(a));
      const jobs = Object.values(await devices(a))[0].jobs;
      expect((await api.post(`${base}/auth/delete`, { password: 'baby-sleeps-9' }, as(a))).data.ok).toBe(true);
      expect(await devices(a)).toEqual({});
      expect(await store.zscore('push:q', jobs[0])).toBeNull();
      clock += 31e3;
      const st = await api.get(`${base}/admin/stats?days=30`, { headers: { 'X-Admin-Key': 'admin-key-for-push-tests-0123', 'X-Forwarded-For': '10.31.250.1' } });
      expect(st.data.push).toEqual({ on: true, line: false });
      const sums = st.data.rows.reduce((acc, r) => ({ sub: acc.sub + r.push_sub, sent: acc.sent + r.push_sent }), { sub: 0, sent: 0 });
      expect(sums.sub).toBeGreaterThanOrEqual(10);
      expect(sums.sent).toBeGreaterThanOrEqual(8);
      expect(st.data.totals.push).toBeGreaterThan(0);
    });

    test('without VAPID keys push is off: no key in /config, the routes answer 404', async () => {
      const s2 = makeStore();
      const { server, base: b2 } = await serve(createMomRouter({ store: s2, now: () => clock, env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 'q'.repeat(40) } }));
      expect((await api.get(`${b2}/config`)).data.push).toBeNull();
      const r = await api.post(`${b2}/auth/register`, { consent: POLICY, account: 'off@example.com', password: 'baby-sleeps-9' }, { headers: { 'X-Forwarded-For': '10.32.0.1' } });
      expect((await api.post(`${b2}/push/subscribe`, { sub: sub() }, { headers: { Authorization: `Bearer ${r.data.token}` } })).status).toBe(404);
      expect((await api.get(`${b2}/push/run`)).status).toBe(404);
      await close(server);
    });
  });
}
flows('memory', () => new MemoryStore());
flows('Redis REST', () => new RedisRestStore({ url: 'https://kv.example', token: 't', http: fakeRedis() }));
