/* 家人共用紀錄 on the member API: families, invites, members, and the encrypted records (opaque to the server) pushed
 * and pulled in order, with deletions, limits and everything going with the account. Both stores. */
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
const DAY = 86400e3;
const START = Date.UTC(2026, 10, 20, 4, 0, 0);
const VAPID = { MOM_VAPID_PUBLIC: 'BPublicKeyForTests_abcdefghijklmnopqrstuvwxyz0123456789-_', MOM_VAPID_PRIVATE: 'private-key-for-tests', MOM_VAPID_SUBJECT: 'mailto:push@example.com' };
const enc = (s) => Buffer.from(`enc:${s}`).toString('base64url'); // stands in for AES-GCM ciphertext
const rid = (n) => `rid${String(n).padStart(17, '0')}`;

function flows(label, makeStore) {
  describe(`家人共用紀錄 (${label})`, () => {
    let srv; let base; let clock = START; let n = 0; let store;
    const sent = [];
    const reg = async () => {
      n += 1;
      const ip = `10.41.${n}.1`;
      const r = await api.post(`${base}/auth/register`, {
        consent: POLICY, account: `fa${n}@example.com`, password: 'baby-sleeps-9', nickname: `家人${n}`,
      }, { headers: { 'X-Forwarded-For': ip } });
      expect(r.status).toBe(201);
      return { token: r.data.token, user: r.data.user, ip };
    };
    const as = (u) => ({ headers: { Authorization: `Bearer ${u.token}`, 'X-Forwarded-For': u.ip } });
    const create = (u, name = '媽媽') => api.post(`${base}/family/create`, { label: enc(name), check: enc('check') }, as(u));
    const join = (u, f, t, name = '爸爸') => api.post(`${base}/family/join`, { f, t, label: enc(name) }, as(u));
    const push = (u, changes) => api.post(`${base}/family/push`, { changes }, as(u));
    const pull = (u, since = 0, limit) => api.get(`${base}/family/pull?since=${since}${limit ? `&limit=${limit}` : ''}`, as(u));
    beforeAll(async () => {
      store = makeStore();
      ({ server: srv, base } = await serve(createMomRouter({
        store,
        now: () => clock,
        pushSender: async (s, body) => { sent.push({ endpoint: s.endpoint, ...JSON.parse(body) }); },
        env: {
          NODE_ENV: 'test', MOM_AUTH_SECRET: 'f'.repeat(40), MOM_TRUST_PROXY: '1', MOM_ADMIN_KEY: 'admin-key-for-family-tests-01', ...VAPID,
        },
      })));
    });
    afterAll(() => close(srv));

    test('a family: members only, my name encrypted, one family each', async () => {
      const a = await reg();
      expect((await api.post(`${base}/family/create`, { label: enc('x'), check: enc('c') })).status).toBe(401);
      expect((await api.post(`${base}/family/create`, { label: '<b>媽媽</b>', check: enc('c') }, as(a))).data.error).toBe('bad_request');
      const r = await create(a);
      expect(r.status).toBe(201);
      expect(r.data.family).toMatchObject({ owner: true, seq: 0, check: enc('check') });
      expect(r.data.family.members).toEqual([expect.objectContaining({ role: 'owner', label: enc('媽媽'), me: true })]);
      expect(r.data.invite.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(r.data.invite.until).toBe(clock + 7 * DAY);
      expect((await create(a)).data.error).toBe('in_family');
      const g = await api.get(`${base}/family`, as(a));
      expect(g.data.family.id).toBe(r.data.family.id);
      expect(JSON.stringify(g.data)).not.toContain(a.user.id); // members are told apart by a family-only id
      const lonely = await reg();
      expect((await api.get(`${base}/family`, as(lonely))).data.family).toBeNull();
    });

    test('an invite: a preview for the joiner (owner name and the key check, encrypted), then join', async () => {
      const a = await reg(); const b = await reg();
      // the owner turned on family news on her phone
      await api.post(`${base}/push/subscribe`, { sub: { endpoint: `https://fcm.googleapis.com/fcm/send/fam-${label.length}`, keys: { p256dh: 'BKey_x', auth: 'auth-x' } }, topics: { family: true } }, as(a));
      const { family, invite } = (await create(a, '小美')).data;
      expect((await api.get(`${base}/family/preview?f=${family.id}&t=wrong-token`, as(b))).status).toBe(404);
      const pv = await api.get(`${base}/family/preview?f=${family.id}&t=${invite.token}`, as(b));
      expect(pv.data).toEqual({
        members: 1, ownerLabel: enc('小美'), check: enc('check'), full: false, already: false, inOther: false,
      });
      const before = sent.length;
      const j = await join(b, family.id, invite.token, '阿弘');
      expect(j.status).toBe(200);
      expect(j.data.family.members.map((m) => [m.role, m.me])).toEqual([['owner', false], ['member', true]]);
      expect(sent.slice(before)).toEqual([expect.objectContaining({ title: '有家人加入了 💜', url: '#/family', kind: 'family' })]);
      expect((await join(b, family.id, invite.token)).status).toBe(200); // again: nothing changes
      const c = await reg();
      await create(c);
      expect((await join(c, family.id, invite.token)).data.error).toBe('in_family');
    });

    test('invites end after 7 days; a fresh one works; at most 8 members', async () => {
      const a = await reg();
      const { family, invite } = (await create(a)).data;
      clock += 7 * DAY + 1000;
      const late = await reg();
      expect((await join(late, family.id, invite.token)).data.error).toBe('bad_invite');
      const fresh = (await api.post(`${base}/family/invite`, {}, as(a))).data.invite;
      expect((await join(late, family.id, fresh.token)).status).toBe(200);
      for (let i = 0; i < 6; i += 1) { const u = await reg(); expect((await join(u, family.id, fresh.token)).status).toBe(200); } // eslint-disable-line no-await-in-loop
      const ninth = await reg();
      expect((await join(ninth, family.id, fresh.token)).data.error).toBe('full');
      expect((await api.get(`${base}/family/preview?f=${family.id}&t=${fresh.token}`, as(ninth))).data.full).toBe(true);
    });

    test('records: pushed in order, pulled since a number; an update replaces, a deletion is remembered', async () => {
      const a = await reg(); const b = await reg();
      const { family, invite } = (await create(a)).data;
      await join(b, family.id, invite.token);
      expect((await push(a, [{ r: rid(1), d: enc('feed 1') }, { r: rid(2), d: enc('diaper') }, { r: rid(3), d: enc('sleep') }])).data.seq).toBe(3);
      let p = await pull(b);
      expect(p.data).toEqual({
        changes: [{ r: rid(1), s: 1, d: enc('feed 1') }, { r: rid(2), s: 2, d: enc('diaper') }, { r: rid(3), s: 3, d: enc('sleep') }], seq: 3, more: false,
      });
      expect((await push(b, [{ r: rid(1), d: enc('feed 1 edited') }, { r: rid(2), x: true }])).data.seq).toBe(5);
      p = await pull(a, 3);
      expect(p.data.changes).toEqual([{ r: rid(1), s: 4, d: enc('feed 1 edited') }, { r: rid(2), s: 5, x: true }]);
      p = await pull(b); // from the start: only the latest of each, the deletion as a deletion
      expect(p.data.changes).toEqual([{ r: rid(3), s: 3, d: enc('sleep') }, { r: rid(1), s: 4, d: enc('feed 1 edited') }, { r: rid(2), s: 5, x: true }]);
      p = await pull(b, 0, 2);
      expect(p.data.more).toBe(true);
      expect(p.data.changes.map((c) => c.s)).toEqual([3, 4]);
      expect((await pull(b, 5)).data).toEqual({ changes: [], seq: 5, more: false });
    });

    test('bad changes are refused whole: ids, sizes, duplicates, more than 200', async () => {
      const a = await reg();
      await create(a);
      expect((await push(a, [{ r: 'short', d: enc('x') }])).data.error).toBe('bad_change');
      expect((await push(a, [{ r: rid(1), d: 'not base64!' }])).data.error).toBe('bad_change');
      expect((await push(a, [{ r: rid(1), d: 'a'.repeat(16001) }])).data.error).toBe('bad_change');
      expect((await push(a, [{ r: rid(1), d: enc('x') }, { r: rid(1), d: enc('y') }])).data.error).toBe('bad_change');
      expect((await push(a, [{ r: rid(1) }])).data.error).toBe('bad_change');
      expect((await push(a, Array.from({ length: 201 }, (_, i) => ({ r: rid(i), d: enc('x') })))).status).toBe(413);
      expect((await pull(a)).data.changes).toEqual([]);
      const outsider = await reg();
      expect((await push(outsider, [{ r: rid(1), d: enc('x') }])).data.error).toBe('no_family');
      expect((await pull(outsider)).data.error).toBe('no_family');
    });

    test('the owner removes a member (the old invite stops working); a member leaves; the owner leaving ends it', async () => {
      const a = await reg(); const b = await reg(); const c = await reg();
      const { family, invite } = (await create(a)).data;
      await join(b, family.id, invite.token); await join(c, family.id, invite.token);
      await push(a, [{ r: rid(9), d: enc('bath') }]);
      const bMid = (await api.get(`${base}/family`, as(b))).data.family.members.find((m) => m.me).mid;
      expect((await api.post(`${base}/family/remove`, { member: bMid }, as(c))).data.error).toBe('not_owner');
      expect((await api.post(`${base}/family/remove`, { member: bMid }, as(a))).status).toBe(200);
      expect((await pull(b)).data.error).toBe('no_family');
      const again = await reg();
      expect((await join(again, family.id, invite.token)).data.error).toBe('bad_invite');
      expect((await api.post(`${base}/family/leave`, {}, as(c))).data.result).toBe('left');
      expect((await api.get(`${base}/family`, as(a))).data.family.members).toHaveLength(1);
      // the owner leaves: the family and its records are gone
      const d = await reg();
      const fresh = (await api.post(`${base}/family/invite`, {}, as(a))).data.invite;
      await join(d, family.id, fresh.token);
      expect((await api.post(`${base}/family/leave`, {}, as(a))).data.result).toBe('ended');
      expect((await pull(d)).data.error).toBe('no_family');
      expect(await store.hlen(`fam:r:${family.id}`, clock)).toBe(0);
      expect((await api.get(`${base}/family`, as(d))).data.family).toBeNull();
    });

    test('deleting the owner\'s account ends the family; the copy of my data says which family and role', async () => {
      const a = await reg(); const b = await reg();
      const { family, invite } = (await create(a)).data;
      await join(b, family.id, invite.token);
      const ex = await api.get(`${base}/me/export`, as(b));
      expect(ex.data.family).toMatchObject({ family: family.id, role: 'member' });
      expect((await api.post(`${base}/auth/delete`, { password: 'baby-sleeps-9' }, as(a))).data.ok).toBe(true);
      expect((await api.get(`${base}/family`, as(b))).data.family).toBeNull();
    });

    test('the dashboard counts new families and joins (never who)', async () => {
      clock += 31e3;
      const st = await api.get(`${base}/admin/stats?days=30`, { headers: { 'X-Admin-Key': 'admin-key-for-family-tests-01', 'X-Forwarded-For': '10.41.250.1' } });
      const sum = (k) => st.data.rows.reduce((acc, r) => acc + r[k], 0);
      expect(sum('family_new')).toBeGreaterThanOrEqual(8);
      expect(sum('family_join')).toBeGreaterThanOrEqual(10);
      expect(st.data.totals.families).toBeGreaterThan(0);
    });
  });
}
flows('memory', () => new MemoryStore());
flows('Redis REST', () => new RedisRestStore({ url: 'https://kv.example', token: 't', http: fakeRedis() }));
