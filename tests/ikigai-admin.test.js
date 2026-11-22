import './ikigai-admin.env.js';
import {
  afterAll, beforeAll, beforeEach, expect, test,
} from '@jest/globals';

let server;
let base;
let clearMemoryRecords;
let resetRateLimit;

beforeAll(async () => {
  const { default: app } = await import('../api/index.js');
  ({ clearMemoryRecords } = await import('../utils/ikigai-records.js'));
  ({ resetRateLimit } = await import('../web/ikigai.js'));
  server = app.listen(0);
  await new Promise((resolve) => { server.once('listening', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => { server.close(resolve); }));

beforeEach(() => {
  clearMemoryRecords();
  resetRateLimit();
});

const RECORD = {
  id: 'abc123def456ghi789',
  startedAt: 1795300000000,
  step: 'plan',
  profile: {
    name: ' 王小明 ', contact: '0912-345-678', email: 'ming@example.com', consent: true, consentAt: 1795300100000,
  },
  items: [
    {
      text: '寫作',
      c: {
        love: true, good: true, need: true, paid: true,
      },
    },
    {
      text: '教學',
      c: {
        love: false, good: true, need: true, paid: false,
      },
    },
    { text: '', c: { love: true } },
  ],
  note: '想轉職',
  plan: {
    dirs: [{
      title: '文案企劃',
      main: true,
      s: {
        love: 5, good: 4, need: 9, paid: 3,
      },
    }],
    goals: { d30: '寫 4 篇文章', d90: '', y1: '' },
    actions: [{ text: '訪談 3 個人', h: 'd30', done: true }, { text: '做作品集', h: 'd90', done: false }],
  },
  insights: {
    careers: [{ name: '文案企劃', circles: ['love', 'good'] }], paths: [], skills: ['SEO'], weakest: 'paid',
  },
  ai: '',
  events: [{ t: 1795300000000, type: '前往', detail: '熱愛' }],
};

const post = (body) => fetch(`${base}/ikigai/records`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const admin = (path, opts = {}) => fetch(`${base}/ikigai/admin/api/${path}`, {
  ...opts, headers: { 'x-admin-password': 'test-admin-pass', ...(opts.headers || {}) },
});

test('POST /ikigai/records needs consent, a name and a contact', async () => {
  expect((await post({ ...RECORD, profile: { ...RECORD.profile, consent: false } })).status).toEqual(400);
  expect((await post({ ...RECORD, profile: { ...RECORD.profile, name: '' } })).status).toEqual(400);
  expect((await post({ ...RECORD, profile: { ...RECORD.profile, contact: '', email: '' } })).status).toEqual(400);
  expect((await post({ ...RECORD, id: '../etc' })).status).toEqual(400);
});

test('saved records show up in the admin list, detail and CSV', async () => {
  expect((await post(RECORD)).status).toEqual(200);
  const list = await (await admin('records')).json();
  expect(list.records).toHaveLength(1);
  const [row] = list.records;
  expect(row.name).toEqual('王小明');
  expect(row.center).toEqual(['寫作']);
  expect(row.mainDirection).toEqual('文案企劃');
  expect(row.actionsDone).toEqual(1);

  const { record } = await (await admin(`records/${RECORD.id}`)).json();
  expect(record.items).toHaveLength(2);
  expect(record.plan.dirs[0].s.need).toEqual(5);
  expect(record.events[0].type).toEqual('前往');

  const bytes = Buffer.from(await (await admin('export.csv')).arrayBuffer());
  // UTF-8 byte order mark, so Excel reads the Chinese text correctly.
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csv = bytes.toString('utf8');
  expect(csv).toContain('"王小明"');
  expect(csv).toContain('"0912-345-678"');
});

test('saving again updates the same record', async () => {
  await post(RECORD);
  await post({ ...RECORD, step: 'result', note: '改了' });
  const list = await (await admin('records')).json();
  expect(list.records).toHaveLength(1);
  expect(list.records[0].note).toEqual('改了');
});

test('admin API rejects a wrong or missing password', async () => {
  expect((await fetch(`${base}/ikigai/admin/api/records`)).status).toEqual(401);
  expect((await admin('records', { headers: { 'x-admin-password': 'nope' } })).status).toEqual(401);
});

test('admin can delete a record', async () => {
  await post(RECORD);
  expect((await admin(`records/${RECORD.id}`, { method: 'DELETE' })).status).toEqual(200);
  expect((await admin(`records/${RECORD.id}`)).status).toEqual(404);
});

test('GET /ikigai/admin serves the admin page', async () => {
  const res = await fetch(`${base}/ikigai/admin`);
  expect(res.status).toEqual(200);
  expect(res.headers.get('cache-control')).toContain('no-store');
  expect(await res.text()).toContain('<title>IKIGAI 後台</title>');
});

test('referrals are counted and named in the admin list', async () => {
  await post(RECORD);
  await post({
    ...RECORD, id: 'friend000000000001', profile: { ...RECORD.profile, name: '朋友' }, referredBy: RECORD.id, source: 'card',
  });
  const { records } = await (await admin('records')).json();
  const inviter = records.find((r) => r.id === RECORD.id);
  const friend = records.find((r) => r.id === 'friend000000000001');
  expect(inviter.referrals).toEqual(1);
  expect(friend.referrerName).toEqual('王小明');
  expect(friend.source).toEqual('card');
  const csv = Buffer.from(await (await admin('export.csv')).arrayBuffer()).toString('utf8');
  expect(csv).toContain('"推薦人"');
});

test('a record cannot refer itself', async () => {
  await post({ ...RECORD, referredBy: RECORD.id });
  const { records } = await (await admin('records')).json();
  expect(records[0].referredBy).toEqual('');
});

test('GET /ikigai/qrcode.js serves the QR library', async () => {
  const res = await fetch(`${base}/ikigai/qrcode.js`);
  expect(res.status).toEqual(200);
  expect(await res.text()).toContain('QR Code Generator');
});

test('GET /ikigai/referrals/:rid counts friends who left their details', async () => {
  const before = await (await fetch(`${base}/ikigai/referrals/${RECORD.id}`)).json();
  expect(before).toEqual({ count: 0, goal: 3, reward: expect.any(String) });
  await post(RECORD);
  await post({
    ...RECORD, id: 'friend000000000001', profile: { ...RECORD.profile, name: '朋友一' }, referredBy: RECORD.id,
  });
  await post({
    ...RECORD, id: 'friend000000000001', profile: { ...RECORD.profile, name: '朋友一' }, referredBy: RECORD.id, step: 'plan',
  });
  await post({
    ...RECORD, id: 'friend000000000002', profile: { ...RECORD.profile, name: '朋友二' }, referredBy: RECORD.id,
  });
  expect((await (await fetch(`${base}/ikigai/referrals/${RECORD.id}`)).json()).count).toEqual(2);
  await admin('records/friend000000000002', { method: 'DELETE' });
  expect((await (await fetch(`${base}/ikigai/referrals/${RECORD.id}`)).json()).count).toEqual(1);
});
