import {
  afterEach, expect, test,
} from '@jest/globals';
import { handleEvents, removePrompt } from '../app/index.js';
import {
  COMMAND_BOT_ANIM, COMMAND_BOT_DRAW, COMMAND_BOT_ICON, COMMAND_BOT_KPI,
} from '../app/commands/index.js';
import { createKpiBubble } from '../app/messages/index.js';
import { buildImageBody } from '../services/openai.js';
import parseKpi from '../utils/parse-kpi.js';
import { t } from '../locales/index.js';
import {
  createEvents, MOCK_TEXT_OK, MOCK_USER_01, TIMEOUT,
} from './utils.js';

afterEach(() => {
  removePrompt(MOCK_USER_01);
});

const texts = (results) => results.map(({ messages }) => messages.map((m) => m.text));
const altTexts = (results) => results.map(({ messages }) => messages.map((m) => m.altText));

test('parseKpi reads title and metrics, with or without spaces', () => {
  expect(parseKpi('本月成績｜訂單 1200 +15%｜粉絲 8400 +3%｜評分 4.6')).toEqual({
    title: '本月成績',
    metrics: [
      { label: '訂單', value: '1200', delta: '+15%' },
      { label: '粉絲', value: '8400', delta: '+3%' },
      { label: '評分', value: '4.6', delta: '' },
    ],
  });
  expect(parseKpi('訂單1200+15%').metrics[0]).toEqual({ label: '訂單', value: '1200', delta: '+15%' });
  expect(parseKpi('沒有數字的一句話')).toEqual({ title: '沒有數字的一句話', metrics: [] });
});

test('createKpiBubble caps at six metrics and colours deltas', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ label: `m${i}`, value: String(i), delta: '+1' }));
  const bubble = createKpiBubble({ title: 'T', metrics: many });
  // 1 title text + 6 metric boxes
  expect(bubble.body.contents).toHaveLength(7);
  const up = createKpiBubble({ metrics: [{ label: 'a', value: '1', delta: '+5%' }] });
  const down = createKpiBubble({ metrics: [{ label: 'a', value: '1', delta: '-5%' }] });
  const upColor = up.body.contents[0].contents[1].contents[1].color;
  const downColor = down.body.contents[0].contents[1].contents[1].color;
  expect(upColor).toBe('#2E8B57');
  expect(downColor).toBe('#C0392B');
});

test('buildImageBody sets svg/gif formats without compression', () => {
  const svg = buildImageBody({
    model: 'gpt-image-2.6-flare', prompt: 'x', size: '1024x1024', quality: 'low', n: 1, outputFormat: 'svg',
  });
  expect(svg.output_format).toBe('svg');
  expect(svg.output_compression).toBeUndefined();

  const gif = buildImageBody({
    model: 'gpt-image-2.6-flare', prompt: 'x', size: '1024x1024', quality: 'low', n: 1, outputFormat: 'gif', frameCount: 6, frameDurationMs: 200,
  });
  expect(gif.output_format).toBe('gif');
  expect(gif.frame_count).toBe(6);
  expect(gif.frame_duration_ms).toBe(200);
  expect(gif.output_compression).toBeUndefined();

  const jpeg = buildImageBody({
    model: 'gpt-image-2.6-flare', prompt: 'x', size: '1024x1024', quality: 'low', n: 1,
  });
  expect(jpeg.output_format).toBe('jpeg');
  expect(jpeg.output_compression).toBe(80);
});

test('畫圖示 replies with a link and is not caught by the draw command', async () => {
  const results = await handleEvents(createEvents([`${COMMAND_BOT_ICON.text} 購物車`]));
  expect(texts(results)).toEqual([[t('__COMMAND_BOT_ICON_REPLY')(MOCK_TEXT_OK)]]);
  expect(COMMAND_BOT_DRAW.aliases).toContain('畫');
}, TIMEOUT);

test('畫動畫 replies with a link', async () => {
  const results = await handleEvents(createEvents([`${COMMAND_BOT_ANIM.text} 星星閃爍`]));
  expect(texts(results)).toEqual([[t('__COMMAND_BOT_ANIM_REPLY')(MOCK_TEXT_OK)]]);
}, TIMEOUT);

test('畫圖示 without a description shows usage', async () => {
  const results = await handleEvents(createEvents([COMMAND_BOT_ICON.text]));
  expect(texts(results)).toEqual([[t('__COMMAND_BOT_ICON_USAGE')]]);
}, TIMEOUT);

test('數據卡 builds a Flex message', async () => {
  const results = await handleEvents(createEvents([`${COMMAND_BOT_KPI.text} 本月｜訂單 1200 +15%`]));
  expect(altTexts(results)).toEqual([['本月｜訂單 1200']]);
}, TIMEOUT);

test('數據卡 without numbers shows usage', async () => {
  const results = await handleEvents(createEvents([`${COMMAND_BOT_KPI.text} 哈囉`]));
  expect(texts(results)).toEqual([[t('__COMMAND_BOT_KPI_USAGE')]]);
}, TIMEOUT);
