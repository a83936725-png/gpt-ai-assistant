import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import express from 'express';
import axios from 'axios';
import { createMomRouter } from '../../mom-api/index.js';
import { MemoryStore, RedisRestStore } from '../../mom-api/store.js';
import { weekKey, cohortInfo, pollFor } from '../../mom-api/circle.js';
import { POLLS, MOODS } from '../../mom-api/circle-polls.js';
import { fakeRedis } from './fake-redis.js';

const api = axios.create({ validateStatus: () => true });
async function serve(router) {
  const app = express();
  app.use('/mom-app/api', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}/mom-app/api` };
}
const close = (s) => new Promise((r) => s.close(r));
const KEY = (n) => `circle-key-${String(n).padStart(4, '0')}-abcdefgh`;
const THU = Date.UTC(2026, 10, 19, 4, 0, 0); // Thursday 2026-11-19, 12:00 in Taipei (ISO week 47)

describe('circle helpers', () => {
  test('weeks run Monday–Sunday in Taiwan time', () => {
    expect(weekKey(THU)).toBe('2026-W47');
    expect(weekKey(Date.UTC(2026, 10, 15, 16, 30))).toBe('2026-W47'); // Mon 00:30 in Taipei
    expect(weekKey(Date.UTC(2026, 10, 15, 15, 30))).toBe('2026-W46'); // Sun 23:30 in Taipei
    expect(weekKey(Date.UTC(2027, 0, 1, 4))).toBe('2026-W53');
  });
  test('a cohort knows where it is now; nonsense and far-off cohorts are refused', () => {
    expect(cohortInfo('p:2027-W12', THU)).toEqual({ kind: 'preg', at: 21 }); // due 2027-03-25
    expect(cohortInfo('b:2026-10', THU)).toEqual({ kind: 'baby', at: 1 });
    expect(cohortInfo('b:2020-01', THU)).toEqual({ kind: 'baby', at: 82 });
    expect(cohortInfo('prep', THU)).toEqual({ kind: 'prep', at: 0 });
    ['p:2029-W10', 'p:2025-W01', 'b:2027-02', 'b:2018-01', 'p:2027-W60', 'b:2026-13', 'everyone', '', null, { a: 1 }].forEach((c) => expect(cohortInfo(c, THU)).toBeNull());
  });
  test('everyone in a circle gets the same question all week; it fits the stage', () => {
    const p = pollFor({ kind: 'preg', at: 21 }, THU);
    expect(p.range[0] <= 21 && p.range[1] >= 21).toBe(true);
    expect(pollFor({ kind: 'preg', at: 21 }, THU + 3 * 86400e3).instance).toBe(p.instance); // Sunday: same question
    expect(p.instance).toMatch(/@2026-W47$/);
    const later = pollFor({ kind: 'preg', at: 21 }, THU + 7 * 86400e3);
    expect(later.instance).toMatch(/@2026-W48$/);
    expect(pollFor({ kind: 'baby', at: 1 }, THU).kind).toBe('baby');
    expect(pollFor({ kind: 'prep', at: 0 }, THU).kind).toBe('prep');
  });
  test('the questions are light: 2–4 options each, unique ids, every stage covered week by week', () => {
    const ids = new Set(POLLS.map((p) => p.id));
    expect(ids.size).toBe(POLLS.length);
    POLLS.forEach((p) => { expect(p.options.length).toBeGreaterThanOrEqual(2); expect(p.options.length).toBeLessThanOrEqual(4); });
    for (let w = 4; w <= 42; w += 1) expect(POLLS.some((p) => p.kind === 'preg' && w >= p.range[0] && w <= p.range[1])).toBe(true);
    for (let m = 0; m <= 84; m += 1) expect(POLLS.some((p) => p.kind === 'baby' && m >= p.range[0] && m <= p.range[1])).toBe(true);
    expect(POLLS.map((p) => `${p.q}${p.options.join('')}`).join('')).not.toMatch(/(?<!其)[他她]/); // the baby is never 他／她 (「其他」 is fine)
    expect(MOODS).toHaveLength(6);
  });
});

function flows(label, makeStore) {
  describe(`同週好孕圈 (${label})`, () => {
    let clock = THU;
    let srv; let base;
    beforeAll(async () => {
      ({ server: srv, base } = await serve(createMomRouter({ store: makeStore(), env: { NODE_ENV: 'test', MOM_AUTH_SECRET: 'c'.repeat(40) }, now: () => clock })));
    });
    afterAll(() => close(srv));
    const C = 'p:2027-W12';
    const post = (path, n, body = {}) => api.post(`${base}/circle/${path}`, { key: KEY(n), cohort: C, ...body });

    test('input is checked', async () => {
      expect((await api.post(`${base}/circle/sync`, { key: 'short', cohort: C })).status).toBe(400);
      expect((await post('sync', 1, { cohort: 'p:2030-W01' })).data.error).toBe('bad_cohort');
      expect((await post('vote', 1, { poll: 'x', option: 0 })).data.error).toBe('not_member'); // join first
    });

    let poll;
    test('joining: the circle counts its members; another circle is separate', async () => {
      const a = await post('sync', 1);
      expect(a.status).toBe(200);
      expect(a.data.members).toBe(1);
      poll = a.data.poll;
      expect(poll.instance).toMatch(/@2026-W47$/);
      expect(poll.counts).toBeNull();
      expect(poll.mine).toBeNull();
      await post('sync', 2); const c = await post('sync', 3);
      expect(c.data.members).toBe(3);
      const other = await post('sync', 4, { cohort: 'b:2026-10' });
      expect(other.data.members).toBe(1);
      expect(other.data.poll.instance).not.toBe(poll.instance);
      expect(JSON.stringify(c.data)).not.toMatch(/circle-key|nid/); // nobody's id or key is ever sent back
    });

    test('voting: anonymous totals, shown only once 3 moms answered; changing your mind is still one vote', async () => {
      expect((await post('vote', 1, { poll: 'nausea@2026-W01', option: 0 })).status).toBe(409); // not this week's question
      expect((await post('vote', 1, { poll: poll.instance, option: 9 })).status).toBe(400);
      let r = await post('vote', 1, { poll: poll.instance, option: 0 });
      expect(r.data.poll).toMatchObject({ mine: 0, total: 1, counts: null });
      r = await post('vote', 2, { poll: poll.instance, option: 1 });
      expect(r.data.poll).toMatchObject({ mine: 1, total: 2, counts: null });
      r = await post('vote', 3, { poll: poll.instance, option: 1 });
      expect(r.data.poll.total).toBe(3);
      expect(r.data.poll.counts.slice(0, 2)).toEqual([1, 2]);
      r = await post('vote', 1, { poll: poll.instance, option: 1 });
      expect(r.data.poll.total).toBe(3);
      expect(r.data.poll.counts.slice(0, 2)).toEqual([0, 3]);
      r = await post('vote', 1, { poll: poll.instance, option: 1 });
      expect(r.data.poll.total).toBe(3); // the same answer again changes nothing
      expect((await post('sync', 2)).data.poll.mine).toBe(1);
    });

    test('mood of the week: a tally, so nobody feels alone in being tired', async () => {
      expect((await post('mood', 1, { mood: 'angry' })).status).toBe(400);
      await post('mood', 1, { mood: 'tired' });
      let r = await post('mood', 2, { mood: 'tired' });
      expect(r.data.mood).toMatchObject({ total: 2, counts: null, mine: 'tired' });
      r = await post('mood', 3, { mood: 'happy' });
      expect(r.data.mood.counts).toMatchObject({ tired: 2, happy: 1, good: 0 });
      r = await post('mood', 3, { mood: 'tired' });
      expect(r.data.mood.counts).toMatchObject({ tired: 3, happy: 0 });
    });

    test('cheering the circle: once a day each', async () => {
      let r = await post('cheer', 1);
      expect(r.data.cheers).toEqual({ week: 1, today: true });
      r = await post('cheer', 1);
      expect(r.data.cheers.week).toBe(1);
      r = await post('cheer', 2);
      expect(r.data.cheers.week).toBe(2);
      expect((await post('sync', 3)).data.cheers).toEqual({ week: 2, today: false });
      clock += 86400e3; // Friday
      r = await post('cheer', 1);
      expect(r.data.cheers.week).toBe(3);
    });

    test('a new week: a new question and a fresh mood tally', async () => {
      clock = THU + 7 * 86400e3;
      const r = await post('sync', 1);
      expect(r.data.poll.instance).toMatch(/@2026-W48$/);
      expect(r.data.poll).toMatchObject({ total: 0, mine: null });
      expect(r.data.mood).toMatchObject({ total: 0, mine: null });
      expect(r.data.cheers.week).toBe(0);
    });

    test('leaving, and members who have not been back for 2 weeks, are not counted', async () => {
      await post('leave', 3);
      expect((await post('sync', 1)).data.members).toBe(2);
      expect((await post('vote', 3, { poll: 'x', option: 0 })).data.error).toBe('not_member');
      clock += 15 * 86400e3;
      expect((await post('sync', 1)).data.members).toBe(1);
    });

    test('one network can only bring a few new identities an hour (shared with 島上的媽媽)', async () => {
      const codes = [];
      for (let n = 100; n < 110; n += 1) codes.push((await post('sync', n)).status); // eslint-disable-line no-await-in-loop
      expect(codes).toContain(429);
      expect((await post('sync', 1)).status).toBe(200);
    });
  });
}

flows('memory', () => new MemoryStore());
flows('Redis REST', () => new RedisRestStore({ url: 'https://kv.example', token: 't', http: fakeRedis() }));
