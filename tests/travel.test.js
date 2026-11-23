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
