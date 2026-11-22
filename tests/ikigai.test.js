import {
  afterAll, beforeAll, beforeEach, expect, test,
} from '@jest/globals';
import app from '../api/index.js';
import config from '../config/index.js';
import { MOCK_TEXT_OK } from '../constants/mock.js';
import analyzeIkigai, {
  buildIkigaiMessages, buildPlanMessages, describeIkigaiError, IkigaiInputError, IKIGAI_MAX_ITEMS,
  normalizeIkigai, normalizePlanInput, parsePlan, PLAN_HORIZONS,
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
  const data = await res.json();
  expect(data.code).toEqual('invalid_input');
  expect(data.error).toContain('至少填寫兩個圈');
});

test('POST /ikigai/analyze does not count incomplete input toward the hourly limit', async () => {
  const post = (body) => fetch(`${base}/ikigai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  for (let i = 0; i < config.IKIGAI_RATE_LIMIT + 2; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    expect((await post({ love: ['寫作'] })).status).toEqual(400);
  }
  expect((await post(SAMPLE)).status).toEqual(200);
});

const httpError = (status, error = {}) => Object.assign(new Error('provider message with sk-...abcd'), {
  response: { status, data: { error } },
});

test.each([
  [httpError(401), 'invalid_api_key', 'OPENAI_API_KEY'],
  [httpError(403), 'forbidden', config.OPENAI_COMPLETION_MODEL],
  [httpError(404), 'model_not_found', 'OPENAI_COMPLETION_MODEL'],
  [httpError(400, { code: 'model_not_found' }), 'model_not_found', 'OPENAI_COMPLETION_MODEL'],
  [httpError(429, { code: 'insufficient_quota' }), 'insufficient_quota', 'Billing'],
  [httpError(429, { type: 'insufficient_quota' }), 'insufficient_quota', 'Billing'],
  [httpError(429), 'rate_limited', '太頻繁'],
  [httpError(400, { param: 'temperature' }), 'bad_request', 'temperature'],
  [httpError(503), 'upstream_error', '503'],
  [Object.assign(new Error('timeout of 50000ms exceeded'), { code: 'ECONNABORTED' }), 'timeout', 'IKIGAI_TIMEOUT'],
  [Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }), 'network', 'OPENAI_COMPLETION_BASE_URL'],
  [Object.assign(new Error('Empty completion'), { code: 'empty_response' }), 'empty_response', '沒有回傳內容'],
  [new Error('boom'), 'unknown', 'Vercel Logs'],
])('describeIkigaiError maps %p to %s', (err, code, text) => {
  const reason = describeIkigaiError(err);
  expect(reason.code).toEqual(code);
  expect(reason.error).toContain(text);
  expect(reason.error).not.toContain('sk-');
});

test('parsePlan keeps valid goals and actions from a reply with extra text', () => {
  const reply = '好的，計畫如下：\n{"goals":{"d30":"寫 4 篇文章","d90":"開一門小課","y1":"穩定接案"},"actions":[{"text":"訪談 3 個人","horizon":"d30"},{"text":"架設作品集","horizon":"later"},{"text":"","horizon":"d90"}]}';
  const plan = parsePlan(reply);
  expect(plan.goals).toEqual({ d30: '寫 4 篇文章', d90: '開一門小課', y1: '穩定接案' });
  expect(plan.actions).toEqual([
    { text: '訪談 3 個人', horizon: 'd30' },
    { text: '架設作品集', horizon: 'd30' },
  ]);
});

test('parsePlan rejects a reply without a usable plan', () => {
  expect(() => parsePlan('抱歉，我無法回答')).toThrow(expect.objectContaining({ code: 'bad_format' }));
  expect(describeIkigaiError({ code: 'bad_format' }).code).toEqual('bad_format');
});

test('normalizePlanInput requires a direction', () => {
  expect(() => normalizePlanInput({ love: ['寫作'], good: ['教學'] })).toThrow(IkigaiInputError);
  expect(normalizePlanInput({ love: ['寫作'], good: ['教學'], direction: '  技術寫作  ' }).direction).toEqual('技術寫作');
});

test('buildPlanMessages names the direction and asks for JSON', () => {
  const [system, human] = buildPlanMessages(normalizePlanInput({ ...SAMPLE, direction: '技術寫作' }));
  expect(system.content).toContain('JSON');
  expect(human.content).toContain('「技術寫作」');
});

test('POST /ikigai/plan returns goals and actions', async () => {
  const res = await fetch(`${base}/ikigai/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...SAMPLE, direction: '技術寫作' }),
  });
  expect(res.status).toEqual(200);
  const data = await res.json();
  expect(Object.keys(data.goals)).toEqual(PLAN_HORIZONS);
  expect(data.actions.length).toBeGreaterThan(0);
  expect(data.goals.d30).toContain('技術寫作');
});

test('POST /ikigai/plan rejects a missing direction', async () => {
  const res = await fetch(`${base}/ikigai/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(SAMPLE),
  });
  expect(res.status).toEqual(400);
  expect((await res.json()).code).toEqual('invalid_input');
});

test('GET / shows the IKIGAI page to browsers', async () => {
  const res = await fetch(`${base}/`, { headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
  expect(res.status).toEqual(200);
  expect(await res.text()).toContain('<title>IKIGAI 生き甲斐</title>');
});

test('GET / keeps the JSON status for other clients', async () => {
  const res = await fetch(`${base}/`, { headers: { Accept: 'application/json' } });
  expect(res.headers.get('content-type')).toContain('application/json');
  expect((await res.json()).status).toEqual('OK');
});

test('buildIkigaiMessages asks for careers, skills and a staged plan', () => {
  const [, human] = buildIkigaiMessages(normalizeIkigai(SAMPLE));
  expect(human.content).toContain('## 3. 建議職業');
  expect(human.content).toContain('## 4. 需要加強的能力');
  expect(human.content).toContain('## 5. 職業規劃');
});
