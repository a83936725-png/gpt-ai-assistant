import {
  afterEach, expect, test,
} from '@jest/globals';
import { handleEvents, removePrompt } from '../app/index.js';
import {
  COMMAND_BOT_DRAW, COMMAND_BOT_POST, COMMAND_BOT_UI, COMMAND_SYS_ID, COMMAND_SYS_MODELS,
} from '../app/commands/index.js';
import { getRequest } from '../app/handlers/ui.js';
import { getTopic } from '../app/handlers/post.js';
import { formatModelReport } from '../app/handlers/models.js';
import { UI_GLOSSARY, formatGlossary } from '../constants/ui-glossary.js';
import { t } from '../locales/index.js';
import isAllowed from '../utils/is-allowed.js';
import { classifyShutdown } from '../utils/check-models.js';
import {
  createEvents, MOCK_TEXT_OK, MOCK_USER_01, TIMEOUT,
} from './utils.js';

afterEach(() => {
  removePrompt(MOCK_USER_01);
});

const replyTexts = (results) => results.map(({ messages }) => messages.map(({ text }) => text));

test('畫介面 is not mistaken for the draw command', async () => {
  const results = await handleEvents(createEvents([`${COMMAND_BOT_UI.text} 咖啡店預約首頁`]));
  expect(replyTexts(results)).toEqual([[MOCK_TEXT_OK]]);
  expect(COMMAND_BOT_DRAW.aliases).toContain('畫');
}, TIMEOUT);

test('畫介面 without a request shows how to use it', async () => {
  const results = await handleEvents(createEvents([COMMAND_BOT_UI.text]));
  expect(replyTexts(results)).toEqual([[t('__COMMAND_BOT_UI_USAGE')]]);
}, TIMEOUT);

test('寫貼文 with a topic replies', async () => {
  const results = await handleEvents(createEvents([`${COMMAND_BOT_POST.text} 週末咖啡買一送一`]));
  expect(replyTexts(results)).toEqual([[MOCK_TEXT_OK]]);
}, TIMEOUT);

test('模型檢查 replies', async () => {
  const results = await handleEvents(createEvents([COMMAND_SYS_MODELS.text]));
  expect(replyTexts(results)).toEqual([[MOCK_TEXT_OK]]);
}, TIMEOUT);

test('我的ID replies with the user ID', async () => {
  const results = await handleEvents(createEvents([COMMAND_SYS_ID.text]));
  expect(replyTexts(results)).toEqual([[t('__COMMAND_SYS_ID_REPLY')(MOCK_USER_01, null)]]);
}, TIMEOUT);

test('getRequest and getTopic strip the command and trailing mark', () => {
  const context = { trimmedText: '畫介面：咖啡店預約首頁。' };
  expect(getRequest(context)).toBe('咖啡店預約首頁');
  expect(getTopic({ trimmedText: '/post weekend deal.' })).toBe('weekend deal');
});

test('isAllowed checks groups against the group list and chats against the user list', () => {
  const lists = { allowedUserIds: ['U1'], allowedGroupIds: ['C1'] };
  expect(isAllowed({ isGroup: false, userId: 'U1', ...lists })).toBe(true);
  expect(isAllowed({ isGroup: false, userId: 'U2', ...lists })).toBe(false);
  expect(isAllowed({
    isGroup: true, userId: 'U2', groupId: 'C1', ...lists,
  })).toBe(true);
  expect(isAllowed({
    isGroup: true, userId: 'U1', groupId: 'C2', ...lists,
  })).toBe(false);
  expect(isAllowed({ isGroup: true, userId: 'U9', groupId: 'C9' })).toBe(true);
});

test('classifyShutdown sorts models by days left', () => {
  const now = new Date('2026-11-14T00:00:00Z');
  expect(classifyShutdown({ shutdownDate: null, now, warningDays: 90 })).toEqual({ status: 'ok', daysLeft: null });
  expect(classifyShutdown({ shutdownDate: '2027-01-14', now, warningDays: 90 })).toEqual({ status: 'shutdown_soon', daysLeft: 61 });
  expect(classifyShutdown({ shutdownDate: '2027-06-01', now, warningDays: 90 }).status).toBe('ok');
  expect(classifyShutdown({ shutdownDate: '2026-10-23', now, warningDays: 90 }).status).toBe('shut_down');
});

test('formatModelReport writes one line per model', () => {
  const report = formatModelReport([
    {
      feature: 'chat', model: 'gpt-6-luna', status: 'ok', shutdownDate: null, daysLeft: null,
    },
    {
      feature: 'vision', model: 'gpt-4o', status: 'shutdown_soon', shutdownDate: '2027-01-14', daysLeft: 61,
    },
  ]);
  expect(report.split('\n')).toHaveLength(2);
  expect(report).toContain('gpt-4o');
  expect(report).toContain('2027-01-14');
});

test('glossary has 157 unique names across 6 groups', () => {
  const names = UI_GLOSSARY.flatMap(({ names: n }) => n);
  expect(UI_GLOSSARY).toHaveLength(6);
  expect(new Set(names).size).toBe(157);
  expect(formatGlossary().split('\n')).toHaveLength(6);
});
