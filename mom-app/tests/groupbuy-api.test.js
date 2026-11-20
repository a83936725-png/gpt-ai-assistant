/* 團購揪團 (stage 1) on the member API: campaigns, teams, the code only for a full team, on both stores. */
import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import express from 'express';
import axios from 'axios';
import { createMomRouter } from '../../mom-api/index.js';
import { MemoryStore, RedisRestStore } from '../../mom-api/store.js';
import { cleanCampaign, loadCampaigns } from '../../mom-api/groupbuy.js';
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
const CAMPAIGNS = [
  {
    id: 'gb-test', title: '易家滴雞精 10 入', desc: '常溫保存', price: 1980, listPrice: 2400, size: 3, hours: 48, ends: '2026-11-30', shopUrl: 'https://shop.example/gb', code: 'TEAM-OK-1', codeNote: '每位會員限用一次',
  },
  {
    id: 'gb-later', title: '下個月的團', price: 500, ends: '2026-12-31', starts: '2026-12-10', code: 'LATER-1',
  },
  { id: 'Bad Id', title: 'x', price: 1, ends: '2026-12-01', code: 'X-1' }, // dropped
  {
    id: 'gb-big', title: '大團', price: 100, size: 6, ends: '2026-11-30', code: 'BIG-1',
  },
];

describe('campaign settings', () => {
  test('a campaign needs an id, a title, a price, an end date and a code; odd values are cleaned', () => {
    const c = cleanCampaign({
      id: 'gb-1', title: '團', price: 100, listPrice: 50, size: 99, hours: 0, ends: '2026-12-01', code: 'ABC-1', shopUrl: 'http://not-https.example', image: 'javascript:alert(1)',
    });
    expect(c).toMatchObject({
      listPrice: null, size: 5, hours: 72, shopUrl: '', image: '', emoji: '🛒',
    }); // a 「原價」 lower than the price is not shown; sizes and hours outside the range fall back
    expect(cleanCampaign({ id: 'gb-1', title: '團', price: 100, ends: '2026-12-01' })).toBeNull(); // no code
    expect(cleanCampaign({ id: 'gb-1', title: '團', price: 100, ends: '12/01', code: 'A-1' })).toBeNull();
    expect(loadCampaigns({ MOM_GROUPBUYS: '{not json', NODE_ENV: 'test' }, START)).toEqual([]);
    const demo = loadCampaigns({ MOM_GROUPBUY_DEMO: '1' }, START);
    expect(demo).toHaveLength(1);
    expect(demo[0]).toMatchObject({ id: 'demo', demo: true, size: 3 });
  });
});

function flows(label, makeStore) {
  describe(`團購揪團 (${label})`, () => {
    let srv; let base; let clock = START; let n = 0; let store;
    const reg = async (ip) => {
      n += 1;
      const net = ip || `10.8.${n}.1`;
      const r = await api.post(`${base}/auth/register`, {
        consent: POLICY, account: `gb${n}@example.com`, password: 'baby-sleeps-9', nickname: `媽媽${n}`,
      }, { headers: { 'X-Forwarded-For': net } });
      expect(r.status).toBe(201);
      return { token: r.data.token, user: r.data.user, ip: net };
    };
    const as = (u) => ({ headers: { Authorization: `Bearer ${u.token}`, 'X-Forwarded-For': u.ip } });
    const start = (u, body = { campaign: 'gb-test' }) => api.post(`${base}/groupbuy/start`, body, as(u));
    const join = (u, id) => api.post(`${base}/groupbuy/team/${id}/join`, {}, as(u));
    const view = (id, u) => api.get(`${base}/groupbuy/team/${id}`, u ? as(u) : {});
    beforeAll(async () => {
      store = makeStore();
      ({ server: srv, base } = await serve(createMomRouter({
        store, now: () => clock, env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 'g'.repeat(40), MOM_TRUST_PROXY: '1', MOM_GROUPBUYS: JSON.stringify(CAMPAIGNS) },
      })));
    });
    afterAll(() => close(srv));

    test('only running campaigns are listed, never with the code', async () => {
      const r = await api.get(`${base}/groupbuy`);
      expect(r.data.campaigns.map((c) => c.id)).toEqual(['gb-test', 'gb-big']); // gb-later starts in December; 'Bad Id' was dropped
      expect(JSON.stringify(r.data)).not.toContain('TEAM-OK-1');
      expect(r.data.campaigns[0]).toMatchObject({
        title: '易家滴雞精 10 入', price: 1980, listPrice: 2400, size: 3, hours: 48, shopUrl: 'https://shop.example/gb', codeNote: '每位會員限用一次',
      });
    });

    test('starting a team: logged in, agreed to the policy, one team per campaign', async () => {
      expect((await api.post(`${base}/groupbuy/start`, { campaign: 'gb-test' })).status).toBe(401);
      const a = await reg();
      await store.updateUser(a.user.id, { consent: { version: '2000-01-01', at: clock } });
      expect((await start(a)).data.error).toBe('need_consent');
      await api.post(`${base}/me`, { consent: POLICY }, as(a));
      expect((await start(a, { campaign: 'gb-later' })).data.error).toBe('no_campaign');
      const r = await start(a, { campaign: 'gb-test', name: '小美 0912345678 https://spam.example' });
      expect(r.status).toBe(201);
      expect(r.data.team).toMatchObject({
        leader: '小美', count: 1, size: 3, status: 'open', member: true, mine: true, endsAt: clock + 48 * HOUR,
      });
      expect(r.data.team.code).toBeUndefined();
      const again = await start(a);
      expect(again.status).toBe(409);
      expect(again.data).toMatchObject({ error: 'in_team', team: { id: r.data.team.id } });
    });

    test('a team: anyone with the link sees it (no code); members join until it is full, then all get the code', async () => {
      const a = await reg(); const b = await reg(); const c = await reg(); const d = await reg();
      const team = (await start(a)).data.team;
      const pub = await view(team.id);
      expect(pub.data.team).toMatchObject({
        count: 1, size: 3, status: 'open', member: false,
      });
      expect(pub.data.team.leader).toMatch(/^媽媽\d+$/);
      expect(pub.data.campaign.title).toBe('易家滴雞精 10 入');
      const j1 = await join(b, team.id);
      expect(j1.data.team).toMatchObject({ count: 2, member: true, mine: false });
      expect((await join(b, team.id)).data.team.count).toBe(2); // joining twice changes nothing
      const j2 = await join(c, team.id);
      expect(j2.data).toMatchObject({ done: true, team: { status: 'done', count: 3, code: 'TEAM-OK-1', codeNote: '每位會員限用一次' } });
      expect((await view(team.id, a)).data.team.code).toBe('TEAM-OK-1'); // the leader too
      expect((await api.get(`${base}/groupbuy`, as(b))).data.mine['gb-test']).toMatchObject({ id: team.id, status: 'done', code: 'TEAM-OK-1' });
      expect((await view(team.id)).data.team.code).toBeUndefined(); // not without logging in
      expect((await view(team.id, d)).data.team.code).toBeUndefined(); // nor for someone outside the team
      const late = await join(d, team.id);
      expect(late.status).toBe(409);
      expect(late.data.error).toBe('full');
      // a member of a full team can't start or join another one in the same campaign
      expect((await start(b)).data.error).toBe('in_team');
    });

    test('the last place: several people joining at the same moment, exactly one gets it', async () => {
      const a = await reg(); const b = await reg();
      const team = (await start(a)).data.team;
      await join(b, team.id);
      const rush = await Promise.all([await reg(), await reg(), await reg()].map((u) => join(u, team.id)));
      expect(rush.filter((r) => r.status === 200).length).toBe(1);
      expect(rush.filter((r) => r.data.error === 'full').length).toBe(2);
      expect((await view(team.id)).data.team.count).toBe(3);
    });

    test('one person can’t end up in two teams by joining both at once', async () => {
      const a = await reg(); const b = await reg(); const x = await reg();
      const t1 = (await start(a)).data.team; const t2 = (await start(b)).data.team;
      const both = await Promise.all([join(x, t1.id), join(x, t2.id)]);
      expect(both.filter((r) => r.status === 200).length).toBe(1);
      expect((await view(t1.id)).data.team.count + (await view(t2.id)).data.team.count).toBe(3);
    });

    test('time is up: the team closes without the code, and its members can start again', async () => {
      const a = await reg(); const b = await reg(); const c = await reg();
      const team = (await start(a)).data.team;
      await join(b, team.id);
      clock += 49 * HOUR;
      const v = await view(team.id, a);
      expect(v.data.team).toMatchObject({ status: 'failed', count: 2 });
      expect(v.data.team.code).toBeUndefined();
      expect((await join(c, team.id)).data.error).toBe('closed');
      expect((await start(a)).status).toBe(201);
      expect((await start(b)).status).toBe(201);
    });

    test('a team never runs past the campaign’s last day (Taiwan time)', async () => {
      clock = Date.UTC(2026, 10, 29, 10, 0, 0); // 11/29 18:00 in Taipei: 30 hours left in the campaign
      const a = await reg();
      const team = (await start(a)).data.team;
      expect(team.endsAt).toBe(Date.UTC(2026, 10, 30, 16, 0, 0)); // 12/1 00:00 in Taipei
      clock = Date.UTC(2026, 10, 30, 16, 0, 1);
      expect((await api.get(`${base}/groupbuy`)).data.campaigns).toEqual([]);
      expect((await view(team.id)).data).toMatchObject({ active: false, team: { status: 'failed' } });
      clock = START + 3 * DAY;
    });

    test('leaving: a member before it is full; a leader only while alone (then the team closes)', async () => {
      const a = await reg(); const b = await reg(); const other = await reg();
      const team = (await start(a)).data.team;
      await join(b, team.id);
      expect((await api.post(`${base}/groupbuy/team/${team.id}/leave`, {}, as(a))).data.error).toBe('leader_stays');
      expect((await api.post(`${base}/groupbuy/team/${team.id}/leave`, {}, as(b))).data.ok).toBe(true);
      expect((await view(team.id)).data.team.count).toBe(1);
      const t2 = (await start(other)).data.team;
      expect((await join(b, t2.id)).status).toBe(200); // free to join another team
      expect((await api.post(`${base}/groupbuy/team/${team.id}/leave`, {}, as(a))).data.ok).toBe(true);
      expect((await view(team.id)).status).toBe(404);
    });

    test('one network can add at most 3 members to a team', async () => {
      const a = await reg();
      const team = (await start(a, { campaign: 'gb-big' })).data.team;
      const home = [await reg('10.9.9.9'), await reg('10.9.9.9'), await reg('10.9.9.9'), await reg('10.9.9.9')];
      const st = [];
      for (const u of home) st.push((await join(u, team.id)).data.error || 'ok'); // eslint-disable-line no-restricted-syntax, no-await-in-loop
      expect(st).toEqual(['ok', 'ok', 'ok', 'too_many_here']);
      expect((await join(await reg(), team.id)).status).toBe(200); // someone elsewhere still can
    });

    test('deleting an account: out of open teams, a leader’s team carries on as 「會員」, a full team keeps its count; the export lists teams', async () => {
      const a = await reg(); const b = await reg(); const c = await reg(); const d = await reg();
      const open = (await start(a)).data.team;
      await join(b, open.id);
      const exp = (await api.get(`${base}/me/export`, as(b))).data;
      expect(exp.groupBuys).toEqual([expect.objectContaining({ campaign: 'gb-test', team: open.id, leader: false, status: 'open' })]);
      expect((await api.get(`${base}/me/export`, as(a))).data.groupBuys[0]).toMatchObject({ leader: true, displayName: expect.stringMatching(/^媽媽/) });
      await api.post(`${base}/auth/delete`, { password: 'baby-sleeps-9' }, as(a)); // the leader leaves for good
      const after = (await view(open.id)).data.team;
      expect(after).toMatchObject({ leader: '會員', count: 1, status: 'open' });
      expect((await join(c, open.id)).status).toBe(200);
      expect((await join(d, open.id)).data.done).toBe(true);
      await api.post(`${base}/auth/delete`, { password: 'baby-sleeps-9' }, as(d));
      expect((await view(open.id, c)).data.team).toMatchObject({ status: 'done', count: 3, code: 'TEAM-OK-1' });
    });
  });
}

flows('memory', () => new MemoryStore());
flows('Redis REST', () => new RedisRestStore({ url: 'https://kv.example', token: 't', http: fakeRedis() }));
