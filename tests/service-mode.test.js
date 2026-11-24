import './service-mode.env.js';
import {
  beforeAll, expect, test,
} from '@jest/globals';
import {
  createEvents, MOCK_TEXT_OK, MOCK_USER_01, MOCK_USER_02, TIMEOUT,
} from './utils.js';

let handleEvents;
let t;

beforeAll(async () => {
  ({ handleEvents } = await import('../app/index.js'));
  ({ t } = await import('../locales/index.js'));
  const { KnowledgeBase, parseDocument, setKnowledgeBase } = await import('../app/knowledge/index.js');
  setKnowledgeBase(new KnowledgeBase(parseDocument('運送.md', '# 運送\n\n## 運費\n冷凍宅配運費 160 元。')));
});

const replies = async (text, userId) => {
  const results = await handleEvents(createEvents([text], undefined, userId));
  return results.flatMap(({ messages }) => messages.map((message) => message.text));
};

test('answers testers on the allowlist', async () => {
  expect(await replies('運費多少？', MOCK_USER_01)).toEqual([MOCK_TEXT_OK]);
}, TIMEOUT);

test('stays silent for customers who are not on the allowlist', async () => {
  expect(await replies('運費多少？', MOCK_USER_02)).toEqual([]);
}, TIMEOUT);

test('still tells anyone their ID so testers can be added', async () => {
  expect(await replies('我的ID', MOCK_USER_02)).toEqual([t('__COMMAND_SYS_ID_REPLY')(MOCK_USER_02, null)]);
}, TIMEOUT);
