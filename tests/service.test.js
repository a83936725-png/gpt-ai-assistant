import {
  afterEach, describe, expect, test,
} from '@jest/globals';
import { handleServiceContext } from '../app/app.js';
import Context from '../app/context.js';
import { getConversation, interpretReply, removeConversation } from '../app/handlers/service.js';
import {
  KnowledgeBase, loadSections, parseDocument, setKnowledgeBase, tokenize,
} from '../app/knowledge/index.js';
import { t } from '../locales/index.js';
import {
  createEvents, MOCK_TEXT_OK, MOCK_USER_01, TIMEOUT,
} from './utils.js';

const PRODUCT = `# 保濕精華

## 價格與規格
容量 30ml，售價 NT$ 1,200。

## 使用方式
早晚洗臉後取 2～3 滴。
`;

const SHIPPING = `# 運送與付款

## 運費
滿 NT$ 1,000 免運費，未滿收 NT$ 80。

## 付款方式
可用信用卡、LINE Pay、貨到付款。
`;

const sampleBase = () => new KnowledgeBase([
  ...parseDocument('保濕精華.md', PRODUCT),
  ...parseDocument('運送與付款.md', SHIPPING),
]);

/**
 * @param {string} text
 * @param {string} [groupId]
 * @returns {Promise<Context>}
 */
const ask = async (text, groupId) => {
  const [event] = createEvents([text], groupId);
  const context = await new Context(event).initialize();
  return handleServiceContext(context);
};

const replyTexts = (context) => context.messages.map(({ text }) => text);

afterEach(() => {
  setKnowledgeBase();
  removeConversation(MOCK_USER_01);
});

describe('knowledge base', () => {
  test('splits a document into its ## sections under the # title', () => {
    const sections = parseDocument('保濕精華.md', PRODUCT);
    expect(sections.map(({ title, heading }) => [title, heading])).toEqual([
      ['保濕精華', '價格與規格'],
      ['保濕精華', '使用方式'],
    ]);
    expect(sections[0].text).toBe('容量 30ml，售價 NT$ 1,200。');
  });

  test('keeps text before the first ## heading', () => {
    const sections = parseDocument('notes.md', 'Intro line\n\n## A\nBody');
    expect(sections.map(({ title, heading, text }) => [title, heading, text])).toEqual([
      ['notes', '', 'Intro line'],
      ['notes', 'A', 'Body'],
    ]);
  });

  test('skips README and files starting with _ in the knowledge directory', () => {
    const sources = loadSections().map(({ source }) => source);
    expect(sources).not.toContain('README.md');
    expect(sources.some((source) => source.startsWith('_'))).toBe(false);
  });

  test('tokenizes Chinese into character pairs and keeps Latin words whole', () => {
    const tokens = tokenize('運費 LINE Pay');
    expect(tokens.has('運費')).toBe(true);
    expect(tokens.has('line')).toBe(true);
    expect(tokens.has('pay')).toBe(true);
  });

  test('includes everything when it fits in the budget', () => {
    const base = sampleBase();
    expect(base.select('運費', 100000)).toHaveLength(4);
  });

  test('picks the best-matching sections when the budget is tight', () => {
    const base = sampleBase();
    const [section] = base.select('請問運費怎麼算？', 60);
    expect(section.heading).toBe('運費');
  });
});

describe('reply interpretation', () => {
  test('turns the no-answer mark into the hand-off message', () => {
    expect(interpretReply('[NO_ANSWER]')).toEqual({ isAnswered: false, text: t('__SERVICE_FALLBACK') });
    expect(interpretReply('')).toEqual({ isAnswered: false, text: t('__SERVICE_FALLBACK') });
  });

  test('strips Markdown that LINE would show as raw symbols', () => {
    expect(interpretReply('## 運費\n**滿千免運**\n- 未滿收 80 元')).toEqual({
      isAnswered: true,
      text: '運費\n滿千免運\n・未滿收 80 元',
    });
  });
});

describe('service mode', () => {
  test('answers one-to-one questions and remembers the turn', async () => {
    setKnowledgeBase(sampleBase());
    const context = await ask('運費多少？');
    expect(replyTexts(context)).toEqual([MOCK_TEXT_OK]);
    expect(getConversation(MOCK_USER_01).map(({ content }) => content)).toEqual(['運費多少？', MOCK_TEXT_OK]);
  }, TIMEOUT);

  test('hands off to a person when the knowledge base is empty', async () => {
    setKnowledgeBase(new KnowledgeBase([]));
    const context = await ask('你們有門市嗎？');
    expect(replyTexts(context)).toEqual([t('__SERVICE_FALLBACK')]);
  }, TIMEOUT);

  test('stays silent in groups', async () => {
    setKnowledgeBase(sampleBase());
    const context = await ask('運費多少？', '000001');
    expect(context.messages).toEqual([]);
  }, TIMEOUT);

  test('still tells testers their ID', async () => {
    const context = await ask('我的ID');
    expect(replyTexts(context)).toEqual([t('__COMMAND_SYS_ID_REPLY')(MOCK_USER_01, null)]);
  }, TIMEOUT);

  test('forgets the conversation on request', async () => {
    setKnowledgeBase(sampleBase());
    await ask('運費多少？');
    const context = await ask('忘記');
    expect(replyTexts(context)).toEqual([t('__COMMAND_BOT_FORGET_REPLY')]);
    expect(getConversation(MOCK_USER_01)).toEqual([]);
  }, TIMEOUT);
});
