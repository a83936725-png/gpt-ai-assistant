import './trainer.env.js';
import {
  afterAll, beforeAll, beforeEach, expect, test,
} from '@jest/globals';
import {
  createEvents, MOCK_USER_01, MOCK_USER_02, TIMEOUT,
} from './utils.js';

let handleEvents;
let setActive;
const realFetch = global.fetch;
let calls = [];
let respond;

beforeAll(async () => {
  ({ handleEvents } = await import('../app/index.js'));
  ({ setActive } = await import('../app/handlers/trainer.js'));
  const { KnowledgeBase, parseDocument, setKnowledgeBase } = await import('../app/knowledge/index.js');
  setKnowledgeBase(new KnowledgeBase(parseDocument('運送.md', '# 運送\n\n## 運費\n冷凍宅配運費 160 元。')));
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, ...body });
    return { json: async () => respond(body) };
  };
});

afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  setActive(MOCK_USER_01, false);
  respond = ({ args: [, op, , text] }) => ({
    ok: true,
    result: { active: !['end', 'quit'].includes(op), text: `${op}:${text}` },
  });
});

const replies = async (text, userId = MOCK_USER_01, groupId = undefined) => {
  const results = await handleEvents(createEvents([text], groupId, userId));
  return results.flatMap(({ messages }) => messages.map((message) => message.text));
};

test('starts a practice for staff and relays what they say', async () => {
  expect(await replies('練習接待')).toEqual(['start:']);
  expect(calls[0]).toEqual({
    url: 'https://expo.test/api/rpc', fn: 'api_trainerLine', args: ['test-secret', 'start', MOCK_USER_01, '', 'user'],
  });
  expect(await replies('媽咪辛苦了，先坐一下')).toEqual(['say:媽咪辛苦了，先坐一下']);
  expect(await replies('結束練習！')).toEqual(['end:']);
  expect(calls.map(({ args }) => args[1])).toEqual(['start', 'say', 'end']);
}, TIMEOUT);

test('after the practice ends, messages go back to customer service', async () => {
  await replies('練習接待');
  await replies('結束練習');
  calls = [];
  await replies('運費多少？');
  expect(calls).toEqual([]);
}, TIMEOUT);

test('starting can name the scenario, and 「開始練習」 also starts', async () => {
  expect(await replies('練習接待 中期 猶豫')).toEqual(['start:中期 猶豫']);
  await replies('結束練習');
  calls = [];
  expect(await replies('開始練習')).toEqual(['start:']);
  expect(calls[0].args[1]).toBe('start');
}, TIMEOUT);

test('a sentence that only begins with the command is not a command', async () => {
  await replies('練習接待');
  calls = [];
  expect(await replies('練習接待的時候要先倒原味嗎')).toEqual(['say:練習接待的時候要先倒原味嗎']);
}, TIMEOUT);

test('「繼續練習」 picks the practice up again after the bot restarts', async () => {
  await replies('繼續練習');
  expect(calls[0].args[1]).toBe('resume');
  expect(await replies('我懂，可以先從入門組開始')).toEqual(['say:我懂，可以先從入門組開始']);
}, TIMEOUT);

test('「快問快答」 starts the free drill, and 「下一題」 asks for the next card', async () => {
  expect(await replies('快問快答')).toEqual(['drill:']);
  expect(await replies('我懂，一包不到 100 塊')).toEqual(['say:我懂，一包不到 100 塊']);
  expect(await replies('下一題！')).toEqual(['next:']);
  expect(await replies('結束練習')).toEqual(['end:']);
  expect(calls.map(({ args }) => args[1])).toEqual(['drill', 'say', 'next', 'end']);
  calls = [];
  expect(await replies('快問快答 換個說法')).toEqual(['drill:換個說法']);
  expect(calls[0].args).toEqual(['test-secret', 'drill', MOCK_USER_01, '換個說法', 'user']);
}, TIMEOUT);

test('customers who send the drill words are not sent to the drill', async () => {
  await replies('快問快答', MOCK_USER_02);
  await replies('下一題', MOCK_USER_02);
  expect(calls).toEqual([]);
}, TIMEOUT);

test('only staff on TRAINER_USER_IDS can practise, and not in groups', async () => {
  await replies('練習接待', MOCK_USER_02);
  await replies('練習接待', MOCK_USER_01, '000001');
  expect(calls).toEqual([]);
}, TIMEOUT);

test('shows the expo site\'s message and stops when the practice has expired', async () => {
  await replies('練習接待');
  respond = () => ({ ok: false, error: '這次練習已經結束或過期了，請重新開始', code: 'no_session' });
  expect(await replies('還在嗎')).toEqual(['這次練習已經結束或過期了，請重新開始']);
  calls = [];
  await replies('運費多少？');
  expect(calls).toEqual([]);
}, TIMEOUT);

test('asks staff to try again when the expo site cannot be reached', async () => {
  await replies('練習接待');
  respond = () => { throw new Error('network down'); };
  const [reply] = await replies('媽咪好');
  expect(reply).toContain('繼續練習');
}, TIMEOUT);
