import {
  afterAll, beforeAll, beforeEach, expect, test,
} from '@jest/globals';
import app from '../api/index.js';
import config from '../config/index.js';
import { MOCK_TEXT_OK } from '../constants/mock.js';
import adviseTrip, {
  buildAdviceMessages, describeTravelError, normalizeAdviceInput, TravelInputError, TRAVEL_MAX_DAYS,
} from '../utils/travel-advice.js';
import { isRateLimited, resetRateLimit } from '../web/travel.js';
import {
  resetTravelData, sanitizeTravelData, TravelSyncError, verifyIdToken,
} from '../utils/travel-sync.js';

let server;
let base;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => { server.once('listening', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => { server.close(resolve); }));

beforeEach(() => {
  resetRateLimit();
});

const SAMPLE = {
  destination: '  京都 ',
  country: '日本',
  days: '4',
  month: 11,
  tags: ['culture', 'food', 'hack', 'culture'],
  likes: ['food'],
  visited: ['東京', '東京', '', 42, '首爾'],
  spots: ['清水寺（¥500）'],
};

test('normalizeAdviceInput trims, keeps known tags and removes duplicates', () => {
  const input = normalizeAdviceInput(SAMPLE);
  expect(input.destination).toBe('京都');
  expect(input.days).toBe(4);
  expect(input.month).toBe(11);
  expect(input.tags).toEqual(['culture', 'food']);
  expect(input.visited).toEqual(['東京', '首爾']);
  expect(input.home).toBe('台北');
});

test('normalizeAdviceInput rejects missing destination and bad day counts', () => {
  expect(() => normalizeAdviceInput({ days: 3 })).toThrow(TravelInputError);
  expect(() => normalizeAdviceInput({ destination: '京都', days: 0 })).toThrow(TravelInputError);
  expect(() => normalizeAdviceInput({ destination: '京都', days: TRAVEL_MAX_DAYS + 1 })).toThrow(TravelInputError);
  expect(() => normalizeAdviceInput(null)).toThrow(TravelInputError);
});

test('buildAdviceMessages names the destination, preferences and spots', () => {
  const [system, human] = buildAdviceMessages(normalizeAdviceInput(SAMPLE));
  expect(system.content).toContain('繁體中文');
  expect(human.content).toContain('京都（日本）');
  expect(human.content).toContain('文化古蹟、美食');
  expect(human.content).toContain('清水寺');
});

test('adviseTrip returns the mock text outside production', async () => {
  const { text } = await adviseTrip(SAMPLE);
  expect(text).toBe(MOCK_TEXT_OK);
});

test('describeTravelError points at the travel settings on timeout', () => {
  expect(describeTravelError({ code: 'ECONNABORTED' }).error).toContain('TRAVEL_TIMEOUT');
});

test('GET /travel redirects to the trailing-slash page', async () => {
  const res = await fetch(`${base}/travel?x=1`, { redirect: 'manual' });
  expect(res.status).toBe(301);
  expect(res.headers.get('location')).toBe('/travel/?x=1');
});

test('GET /travel/ serves the page and its scripts', async () => {
  const page = await fetch(`${base}/travel/`);
  expect(page.status).toBe(200);
  expect(page.headers.get('content-type')).toContain('text/html');
  expect(await page.text()).toContain('travel-app.js');
  const script = await fetch(`${base}/travel/vendor/Sortable.min.js`);
  expect(script.headers.get('content-type')).toContain('javascript');
  const map = await fetch(`${base}/travel/vendor/countries-50m.json`);
  expect((await map.json()).type).toBe('Topology');
  expect((await fetch(`${base}/travel/vendor/../../package.json`)).status).toBe(404);
});

test('GET /travel/api/status reports brand, eSIM link and AI availability', async () => {
  const res = await fetch(`${base}/travel/api/status`);
  const data = await res.json();
  expect(data.brand).toBe(config.TRAVEL_BRAND);
  expect(data.esimUrl).toBe(config.TRAVEL_ESIM_URL);
  expect(typeof data.ai).toBe('boolean');
});

const advise = (body) => fetch(`${base}/travel/api/advise`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('POST /travel/api/advise validates input and returns the itinerary', async () => {
  const bad = await advise({ destination: '' });
  expect(bad.status).toBe(400);
  expect((await bad.json()).code).toBe('invalid_input');
  const ok = await advise(SAMPLE);
  expect(ok.status).toBe(200);
  expect((await ok.json()).text).toBe(MOCK_TEXT_OK);
});

test('isRateLimited allows TRAVEL_RATE_LIMIT requests per IP per hour', () => {
  const now = Date.now();
  for (let i = 0; i < config.TRAVEL_RATE_LIMIT; i += 1) expect(isRateLimited('1.2.3.4', now)).toBe(false);
  expect(isRateLimited('1.2.3.4', now)).toBe(true);
  expect(isRateLimited('5.6.7.8', now)).toBe(false);
  expect(isRateLimited('1.2.3.4', now + 61 * 60 * 1000)).toBe(false);
});

test('GET /travel/travel-photos/:name serves only hashed photo names', async () => {
  expect((await fetch(`${base}/travel/travel-photos/..%2F..%2Fpackage.json`)).status).toBe(404);
  expect((await fetch(`${base}/travel/travel-photos/not-a-photo.webp`)).status).toBe(404);
  expect((await fetch(`${base}/travel/travel-photos/000000000000.webp`)).status).toBe(404);
});

const sync = (path, body) => fetch(`${base}/travel/api/sync/${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('verifyIdToken accepts test tokens outside production and rejects missing ones', async () => {
  expect(await verifyIdToken('test:U123')).toEqual({ sub: 'U123', name: '測試帳號' });
  await expect(verifyIdToken('')).rejects.toThrow(TravelSyncError);
  await expect(verifyIdToken(42)).rejects.toThrow(TravelSyncError);
});

test('sanitizeTravelData keeps the shape, drops unsafe keys and caps sizes', () => {
  const data = sanitizeTravelData({
    user: { name: '小安'.repeat(30) },
    trips: [{
      id: 't1', city: '京都', tags: ['food'], plan: { days: [[{ name: '清水寺' }]] }, 'bad key!': 1, constructor: 'x',
    }],
    wish: ['kyoto', 3],
    settings: { home: 'TPE' },
    updatedAt: 123,
  });
  expect(data.user.name).toHaveLength(20);
  expect(data.trips[0].plan.days[0][0].name).toBe('清水寺');
  expect(data.trips[0]['bad key!']).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(data.trips[0], 'constructor')).toBe(false);
  expect(data.wish).toEqual(['kyoto']);
  expect(data.updatedAt).toBe(123);
  expect(() => sanitizeTravelData(null)).toThrow(TravelSyncError);
  const huge = {
    trips: Array.from({ length: 300 }, (_, i) => ({
      id: `t${i}`, note: 'x'.repeat(600), more: 'y'.repeat(600), memo: 'z'.repeat(600),
    })),
  };
  expect(() => sanitizeTravelData(huge)).toThrow('資料太大');
});

test('POST /travel/api/sync saves a traveller\'s data and loads it back for the same LINE account', async () => {
  resetTravelData();
  const data = {
    user: { name: '小安' }, trips: [{ id: 't1', city: '京都' }], orders: [], updatedAt: 1000,
  };
  expect((await sync('pull', { idToken: 'test:U1' }).then((r) => r.json())).data).toBeNull();
  const pushed = await sync('push', { idToken: 'test:U1', data });
  expect(pushed.status).toBe(200);
  const pulled = await sync('pull', { idToken: 'test:U1' }).then((r) => r.json());
  expect(pulled.data.trips[0].city).toBe('京都');
  expect(pulled.data.updatedAt).toBe(1000);
  expect((await sync('pull', { idToken: 'test:U2' }).then((r) => r.json())).data).toBeNull();
  expect((await sync('pull', {})).status).toBe(401);
  expect((await sync('push', { idToken: 'test:U1', data: 'nope' })).status).toBe(413);
});

test('GET /travel/api/status reports the LIFF ID (null when LINE login is not set up)', async () => {
  const data = await fetch(`${base}/travel/api/status`).then((r) => r.json());
  expect(data.liff).toBe(config.TRAVEL_LIFF_ID);
});
