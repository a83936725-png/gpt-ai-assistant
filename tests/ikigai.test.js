import {
  afterAll, beforeAll, beforeEach, expect, test,
} from '@jest/globals';
import app from '../api/index.js';
import config from '../config/index.js';
import { MOCK_TEXT_OK } from '../constants/mock.js';
import analyzeIkigai, {
  buildIkigaiMessages, IkigaiInputError, IKIGAI_MAX_ITEMS, normalizeIkigai,
} from '../utils/analyze-ikigai.js';
import { isRateLimited, resetRateLimit } from '../web/ikigai.js';

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
  love: [' 寫作 ', '寫作', '', '學習'],
  good: ['教學'],
  need: [],
  paid: ['課程講師', 42],
  note: '  目前是工程師  ',
};

test('normalizeIkigai trims, removes duplicates and non-strings', () => {
  const result = normalizeIkigai(SAMPLE);
  expect(result.love).toEqual(['寫作', '學習']);
  expect(result.good).toEqual(['教學']);
  expect(result.need).toEqual([]);
  expect(result.paid).toEqual(['課程講師']);
  expect(result.note).toEqual('目前是工程師');
});

test('normalizeIkigai needs at least two circles', () => {
  expect(() => normalizeIkigai({ love: ['寫作'] })).toThrow(IkigaiInputError);
  expect(() => normalizeIkigai(null)).toThrow(IkigaiInputError);
});

test('normalizeIkigai limits items per circle', () => {
  const many = Array.from({ length: IKIGAI_MAX_ITEMS + 1 }, (_, i) => `項目${i}`);
  expect(() => normalizeIkigai({ love: many, good: ['教學'] })).toThrow(IkigaiInputError);
});

test('buildIkigaiMessages lists every circle', () => {
  const [system, human] = buildIkigaiMessages(normalizeIkigai(SAMPLE));
  expect(system.role).toEqual('system');
  expect(human.content).toContain('【你熱愛的】寫作、學習');
  expect(human.content).toContain('【世界需要的】（未填）');
  expect(human.content).toContain('【補充說明】目前是工程師');
});

test('analyzeIkigai returns mock text outside production', async () => {
  const { text } = await analyzeIkigai(SAMPLE);
  expect(text).toEqual(MOCK_TEXT_OK);
});

test('isRateLimited blocks after the hourly limit', () => {
  for (let i = 0; i < config.IKIGAI_RATE_LIMIT; i += 1) {
    expect(isRateLimited('1.2.3.4')).toBe(false);
  }
  expect(isRateLimited('1.2.3.4')).toBe(true);
  expect(isRateLimited('5.6.7.8')).toBe(false);
});

test('GET /ikigai serves the page', async () => {
  const res = await fetch(`${base}/ikigai`);
  expect(res.status).toEqual(200);
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(await res.text()).toContain('<title>IKIGAI 生き甲斐</title>');
});

test('GET /ikigai/status reports AI availability', async () => {
  const res = await fetch(`${base}/ikigai/status`);
  expect(await res.json()).toEqual({ ai: true });
});

test('POST /ikigai/analyze returns the analysis', async () => {
  const res = await fetch(`${base}/ikigai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(SAMPLE),
  });
  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({ text: MOCK_TEXT_OK });
});

test('POST /ikigai/analyze rejects incomplete input', async () => {
  const res = await fetch(`${base}/ikigai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ love: ['寫作'] }),
  });
  expect(res.status).toEqual(400);
  expect((await res.json()).error).toContain('至少填寫兩個圈');
});
