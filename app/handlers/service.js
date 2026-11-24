import config from '../../config/index.js';
import { t } from '../../locales/index.js';
import { ROLE_AI, ROLE_HUMAN, ROLE_SYSTEM } from '../../services/openai.js';
import { generateCompletion } from '../../utils/index.js';
import { COMMAND_BOT_FORGET } from '../commands/index.js';
import Context from '../context.js';
import { getKnowledgeBase } from '../knowledge/index.js';
import Message from '../prompt/message.js';

/**
 * What the model writes when the knowledge base does not hold the answer.
 */
export const NO_ANSWER_MARK = '[NO_ANSWER]';

/**
 * Recent turns per customer, so follow-ups like "那它多少錢？" keep their subject.
 * @type {Map<string, Array<{role: string, content: string}>>}
 */
const conversations = new Map();

/**
 * @param {string} userId
 * @returns {Array<{role: string, content: string}>}
 */
const getConversation = (userId) => conversations.get(userId) || [];

/**
 * @param {string} userId
 * @param {Array<{role: string, content: string}>} turns
 */
const saveConversation = (userId, turns) => {
  const max = config.SERVICE_MAX_HISTORY_MESSAGES;
  conversations.set(userId, max > 0 ? turns.slice(-max) : []);
};

/**
 * @param {string} userId
 */
const removeConversation = (userId) => {
  conversations.delete(userId);
};

/**
 * LINE shows Markdown as raw symbols, so drop the common marks the model may still write.
 * @param {string} text
 * @returns {string}
 */
const toPlainText = (text) => text
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/__(.+?)__/g, '$1')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/^\s*[*-]\s+/gm, '・')
  .trim();

/**
 * @param {string} text The model's reply.
 * @returns {{isAnswered: boolean, text: string}}
 */
const interpretReply = (text = '') => {
  if (!text.trim() || text.includes(NO_ANSWER_MARK)) {
    return { isAnswered: false, text: config.SERVICE_FALLBACK_MESSAGE || t('__SERVICE_FALLBACK') };
  }
  return { isAnswered: true, text: toPlainText(text) };
};

/**
 * Logs a question the knowledge base could not answer, so it shows up in the server logs.
 * @param {Object} param
 * @param {string} param.userId
 * @param {string} [param.name]
 * @param {string} param.question
 */
const reportMiss = ({ userId, name, question }) => {
  console.info(JSON.stringify({
    type: 'knowledge_miss',
    userId,
    name,
    question,
    at: new Date().toISOString(),
  }));
};

/**
 * Answers one customer message from the knowledge base and remembers the turn. Shared by the LINE
 * handler and anything else that asks the knowledge base, such as the local test tool.
 * @param {Object} param
 * @param {string} param.userId Keeps each customer's recent turns apart.
 * @param {string} param.question
 * @returns {Promise<{isAnswered: boolean, text: string}>}
 */
const answerQuestion = async ({ userId, question }) => {
  const history = getConversation(userId);
  const knowledgeBase = getKnowledgeBase();
  let reply;
  if (knowledgeBase.isEmpty) {
    reply = interpretReply(NO_ANSWER_MARK);
  } else {
    // Recent customer turns help pick the right sections for follow-up questions.
    const query = [...history.filter(({ role }) => role === ROLE_HUMAN).map(({ content }) => content), question].join('\n');
    const knowledge = knowledgeBase.buildContext(query);
    const messages = [
      { role: ROLE_SYSTEM, content: t('__SERVICE_SYSTEM_PROMPT')(config.BOT_NAME, knowledge, NO_ANSWER_MARK) },
      ...history,
      { role: ROLE_HUMAN, content: question },
    ].map((message) => new Message(message));
    const { text } = await generateCompletion({ prompt: { messages } });
    reply = interpretReply(text);
  }
  saveConversation(userId, [
    ...history,
    { role: ROLE_HUMAN, content: question },
    { role: ROLE_AI, content: reply.text },
  ]);
  return reply;
};

/**
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => !context.event.isGroup;

/**
 * Customer service: answers one-to-one messages only from the knowledge base, and hands anything
 * it does not cover to a person instead of guessing.
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const exec = (context) => check(context) && (
  async () => {
    if (context.event.isImage) {
      context.pushText(t('__SERVICE_UNSUPPORTED_MEDIA'));
      return context;
    }
    if (context.hasCommand(COMMAND_BOT_FORGET)) {
      removeConversation(context.userId);
      context.pushText(t('__COMMAND_BOT_FORGET_REPLY'));
      return context;
    }
    const question = context.trimmedText;
    const who = { userId: context.userId, name: context.source?.name, question };
    try {
      const reply = await answerQuestion({ userId: context.userId, question });
      if (!reply.isAnswered) reportMiss(who);
      context.pushText(reply.text);
    } catch (err) {
      // Customers should not see API URLs or status codes; keep the details in the logs.
      context.error = err;
      console.error(`Service reply failed: ${err.message}`);
      reportMiss(who);
      context.pushText(t('__SERVICE_ERROR'));
    }
    return context;
  }
)();

export {
  answerQuestion,
  getConversation,
  interpretReply,
  removeConversation,
};

export default exec;
