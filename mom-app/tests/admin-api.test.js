/* 品牌數據 (GET /admin/stats): the brand's dashboard numbers — daily counts of what members do, never who — behind
 * MOM_ADMIN_KEY, on both stores. */
import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import express from 'express';
import axios from 'axios';
import { createMomRouter } from '../../mom-api/index.js';
import { MemoryStore, RedisRestStore } from '../../mom-api/store.js';
import { dayKey, dayStart, makeMetrics } from '../../mom-api/metrics.js';
import { weekKey } from '../../mom-api/circle.js';
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
const HOUR = 3600e3; const DAY = 24 * HOUR;
const START = Date.UTC(2026, 10, 20, 4, 0, 0); // 2026-11-20 12:00 in Taipei
const KEY = 'brand-dashboard-key-0123456789';
const CAMPAIGNS = [{
  id: 'gb-test', title: '易家滴雞精 10 入', price: 1980, size: 3, hours: 48, ends: '2026-11-30', code: 'TEAM-OK-1',
}];

describe('days in Taiwan time', () => {
  test('a day is the Taiwan calendar day; it starts at 00:00 Taipei', () => {
    expect(dayKey(Date.UTC(2026, 10, 19, 16, 0, 0))).toBe('2026-11-20'); // 00:00 on 11/20 in Taipei
    expect(dayKey(Date.UTC(2026, 10, 19, 15, 59, 59))).toBe('2026-11-19');
    expect(dayStart(START)).toBe(Date.UTC(2026, 10, 19, 16, 0, 0));
  });
  test('only known events are counted, and a broken database never breaks the action', async () => {
    let clock = START;
    const store = new MemoryStore();
    const m = makeMetrics({ store, now: () => clock });
    await m.count('signup'); await m.count('signup'); await m.count('made-up');
    clock += DAY;
    await m.count('open', 3);
    const d = await m.days(3, clock);
    expect(d.map((x) => x.day)).toEqual(['2026-11-19', '2026-11-20', '2026-11-21']);
    expect(d.map((x) => x.signup)).toEqual([0, 2, 0]);
    expect(d.map((x) => x.open)).toEqual([0, 0, 3]);
    expect(d[1]['made-up']).toBeUndefined();
    await m.total('marketing', 2); await m.total('marketing', -1);
    expect(await m.totals()).toEqual({ marketing: 1 });
    const broken = makeMetrics({ store: { hincrBy: async () => { throw new Error('down'); } }, now: () => clock });
    await expect(broken.count('signup')).resolves.toBeUndefined();
    await expect(broken.total('marketing', 1)).resolves.toBeUndefined();
  });
});

describe('the dashboard is off without a long enough key', () => {
  test('no MOM_ADMIN_KEY, or a short one: the route does not exist', async () => {
    for (const env of [{}, { MOM_ADMIN_KEY: 'short-key' }]) { // eslint-disable-line no-restricted-syntax
      const { server, base } = await serve(createMomRouter({ store: new MemoryStore(), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 'a'.repeat(40), ...env } })); // eslint-disable-line no-await-in-loop
      const r = await api.get(`${base}/admin/stats`, { headers: { 'X-Admin-Key': env.MOM_ADMIN_KEY || 'x' } }); // eslint-disable-line no-await-in-loop
      expect(r.status).toBe(404);
      await close(server); // eslint-disable-line no-await-in-loop
    }
  });
});

function flows(label, makeStore) {
  describe(`品牌數據 (${label})`, () => {
    let srv; let base; let clock = START; let n = 0; let store;
    const reg = async (extra = {}) => {
      n += 1;
      const ip = `10.9.${n}.1`;
      const r = await api.post(`${base}/auth/register`, {
        consent: POLICY, account: `ad${n}@example.com`, password: 'baby-sleeps-9', nickname: `媽媽${n}`, ...extra,
      }, { headers: { 'X-Forwarded-For': ip } });
      expect(r.status).toBe(201);
      return { token: r.data.token, user: r.data.user, ip };
    };
    const as = (u) => ({ headers: { Authorization: `Bearer ${u.token}`, 'X-Forwarded-For': u.ip } });
    const stats = (key = KEY, ip = '10.200.0.1', q = '') => api.get(`${base}/admin/stats${q}`, { headers: { 'X-Admin-Key': key, 'X-Forwarded-For': ip } });
    const today = async () => { clock += 31e3; const r = await stats(); return { r, row: r.data.rows[r.data.rows.length - 1] }; }; // past the 30 s cache
    beforeAll(async () => {
      store = makeStore();
      ({ server: srv, base } = await serve(createMomRouter({
        store,
        now: () => clock,
        env: {
          NODE_ENV: 'test', MOM_AUTH_SECRET: 'g'.repeat(40), MOM_TRUST_PROXY: '1', MOM_GROUPBUYS: JSON.stringify(CAMPAIGNS), MOM_ADMIN_KEY: KEY,
        },
      })));
    });
    afterAll(() => close(srv));

    test('the right key gets the numbers; no key or a wrong one does not', async () => {
      expect((await api.get(`${base}/admin/stats`)).status).toBe(401);
      expect((await stats('wrong-key-wrong-key-wrong-key')).status).toBe(401);
      const r = await stats();
      expect(r.status).toBe(200);
      expect(r.data).toMatchObject({
        days: 30, members: 0, online: 0, totals: {}, groupbuys: [{ id: 'gb-test', title: '易家滴雞精 10 入', teams: 0, people: 0, done: 0, active: true }],
      });
      expect(r.data.rows).toHaveLength(30);
      expect(r.data.rows[29].day).toBe('2026-11-20');
      expect(r.data.rows[0].day).toBe('2026-10-22');
      expect(r.headers['cache-control']).toBe('no-store');
      expect((await stats(KEY, '10.200.0.1', '?days=7')).data.rows).toHaveLength(7);
      expect((await stats(KEY, '10.200.0.1', '?days=500')).data.rows).toHaveLength(90);
      expect((await stats(KEY, '10.200.0.1', '?days=1')).data.rows).toHaveLength(7);
    });

    test('ten wrong keys from one network block it for an hour (even with the right key); others are not affected', async () => {
      for (let i = 0; i < 11; i += 1) await stats(`guess-${i}-xxxxxxxxxxxxxxxxxxxxxxx`, '10.66.0.1'); // eslint-disable-line no-await-in-loop
      expect((await stats(KEY, '10.66.0.1')).status).toBe(429);
      expect((await stats(KEY, '10.67.0.1')).status).toBe(200);
      if (label === 'memory') { // (the test Redis keeps real time for expiry)
        clock += HOUR + 1000;
        expect((await stats(KEY, '10.66.0.1')).status).toBe(200);
      }
    });

    test('sign-ups by kind, logins, app opens and the marketing yes count', async () => {
      const a = await reg({ marketing: true });
      await reg();
      let { r, row } = await today();
      expect(r.data.members).toBe(2);
      expect(row).toMatchObject({ signup: 2, signup_email: 2 });
      expect(r.data.totals.marketing).toBe(1);
      await api.post(`${base}/auth/login`, { account: 'ad1@example.com', password: 'baby-sleeps-9' }, { headers: { 'X-Forwarded-For': a.ip } });
      await api.post(`${base}/presence`, { sid: 'session-aaaa-1' }, { headers: { 'X-Forwarded-For': a.ip } });
      await api.post(`${base}/presence`, { sid: 'session-aaaa-1' }, { headers: { 'X-Forwarded-For': a.ip } }); // the same open app
      await api.post(`${base}/presence`, { sid: 'session-bbbb-2' }, { headers: { 'X-Forwarded-For': a.ip } });
      ({ r, row } = await today());
      expect(row).toMatchObject({ login: 1, open: 2 });
      expect(r.data.online).toBe(2);
      // saying no (and yes again) to marketing moves the count; the same answer twice does not
      await api.post(`${base}/me`, { marketing: false }, as(a));
      await api.post(`${base}/me`, { marketing: false }, as(a));
      expect((await today()).r.data.totals.marketing).toBe(0);
      await api.post(`${base}/me`, { marketing: true }, as(a));
      expect((await today()).r.data.totals.marketing).toBe(1);
      // deleting the account: counted, and her marketing yes goes with her
      expect((await api.post(`${base}/auth/delete`, { password: 'baby-sleeps-9' }, as(a))).data.ok).toBe(true);
      ({ r, row } = await today());
      expect(row.deleted).toBe(1);
      expect(r.data.totals.marketing).toBe(0);
      expect(r.data.members).toBe(1);
    });

    test('sign-ups per day come from the members list (every day in the range, also before this version)', async () => {
      clock += DAY; // the next day
      await reg(); await reg(); await reg();
      const { r } = await today();
      const rows = r.data.rows.slice(-2);
      expect(rows.map((x) => x.day)).toEqual(['2026-11-20', '2026-11-21']);
      expect(rows.map((x) => x.signup)).toEqual([2, 3]); // the deleted account was still a sign-up that day
    });

    test('group-buys: started, joined, full — per day and per campaign', async () => {
      const a = await reg(); const b = await reg(); const c = await reg();
      const team = (await api.post(`${base}/groupbuy/start`, { campaign: 'gb-test' }, as(a))).data.team;
      await api.post(`${base}/groupbuy/team/${team.id}/join`, {}, as(b));
      await api.post(`${base}/groupbuy/team/${team.id}/join`, {}, as(c));
      const { r, row } = await today();
      expect(row).toMatchObject({ gb_start: 1, gb_join: 2, gb_done: 1 });
      expect(r.data.groupbuys[0]).toMatchObject({ teams: 1, people: 3, done: 1, size: 3 });
    });

    test('blessing walls, wishes and waves are counted', async () => {
      const mk = await api.post(`${base}/wall`, { occasion: 'month', baby: '小湯圓', mom: '小美' }, { headers: { 'X-Forwarded-For': '10.50.0.1' } });
      expect(mk.status).toBe(201);
      await api.post(`${base}/wall/${mk.data.id}/wish`, { name: '阿嬤', text: '滿月快樂！' }, { headers: { 'X-Forwarded-For': '10.50.0.2' } });
      const { row } = await today();
      expect(row).toMatchObject({ wall_new: 1, wall_wish: 1 });
    });

    test('使用統計 from the app (POST /count): only the known names, at most 200 each, a limit per network', async () => {
      const send = (n, ip = '10.70.0.1') => api.post(`${base}/count`, { n }, { headers: { 'X-Forwarded-For': ip } });
      expect((await send(null)).status).toBe(400);
      expect((await send(['active_d'])).status).toBe(400);
      const before = (await today()).row;
      const r = await send({
        active_d: 1, active_w: 1, active_m: 1, first_open: 1, ob_baby: 1, log_diaper: 3, checkin: 2, share_line: 1, brand_view: 2, brand_shop: 1, hacked: 99, signup: 5, log_breast: 9999, search: -4,
      });
      expect(r.status).toBe(200);
      const { row } = await today();
      expect(row).toMatchObject({
        active_d: 1, active_w: 1, active_m: 1, first_open: 1, ob_baby: 1, log_diaper: 3, checkin: 2, share_line: 1, brand_view: 2, brand_shop: 1, log_breast: 200, search: 0,
      });
      expect(row.hacked).toBeUndefined();
      expect(row.signup).toBe(before.signup); // only the app's own names: a batch cannot add sign-ups
      for (let i = 0; i < 60; i += 1) await send({ search: 1 }, '10.71.0.1'); // eslint-disable-line no-await-in-loop
      expect((await send({ search: 1 }, '10.71.0.1')).status).toBe(429);
      expect((await send({ search: 1 }, '10.72.0.1')).status).toBe(200);
    });

    test('同週好孕圈 in the dashboard: 備孕, the due months and the babies\' ages — counts only', async () => {
      const join = (n, cohort) => api.post(`${base}/circle/sync`, { key: `circle-key-${String(n).padStart(4, '0')}-abcdefgh`, cohort }, { headers: { 'X-Forwarded-For': `10.80.${n}.1` } });
      const due = weekKey(clock + 15 * 7 * DAY); // due in about 15 weeks
      const tw = new Date(clock + 8 * HOUR);
      const born = (back) => { const m = tw.getUTCFullYear() * 12 + tw.getUTCMonth() - back; return `b:${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`; };
      for (const [i, c] of [[1, 'prep'], [2, `p:${due}`], [3, `p:${due}`], [4, born(1)], [5, born(14)]]) expect((await join(i, c)).status).toBe(200); // eslint-disable-line no-await-in-loop
      const { r } = await today();
      const c = r.data.circles;
      expect(c).toMatchObject({ prep: 1, preg: 2, babies: 2, total: 5 });
      expect(c.due.find((x) => x.n === 2)).toBeTruthy();
      expect(c.baby.find((x) => x.label === '0–3 個月').n).toBe(1);
      expect(c.baby.find((x) => x.label === '1–2 歲').n).toBe(1);
      expect(JSON.stringify(r.data)).not.toMatch(/circle-key/);
    });

    test('only counts: no names, accounts, invite codes, team ids or the group-buy code', async () => {
      const { r } = await today();
      const s = JSON.stringify(r.data);
      expect(s).not.toMatch(/媽媽\d|@example\.com|TEAM-OK-1|小湯圓|阿嬤/);
      const users = await Promise.all([...Array(3)].map((_, i) => store.getUserByAccount(`email:ad${i + 3}@example.com`)));
      users.filter(Boolean).forEach((u) => { expect(s).not.toContain(u.code); expect(s).not.toContain(u.id); });
      r.data.rows.forEach((x) => Object.entries(x).forEach(([k, v]) => { if (k !== 'day') expect(typeof v).toBe('number'); }));
    });
  });
}
flows('memory', () => new MemoryStore());
flows('Redis REST', () => new RedisRestStore({ url: 'https://kv.example', token: 't', http: fakeRedis() }));
