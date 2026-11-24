/**
 * Asks the customer service bot questions from the terminal, without LINE or a deploy.
 *
 *   npm run ask                         Chat interactively ("忘記" starts over, Ctrl+C quits)
 *   npm run ask -- "運費多少？" "那冷凍呢？"   Ask in order, as one conversation
 *   npm run ask -- --file questions.txt   One question per line; a blank line starts a new
 *                                         conversation; lines starting with # are skipped
 *
 * Needs OPENAI_API_KEY (and optionally BOT_NAME, OPENAI_COMPLETION_MODEL) in .env.
 */
import fs from 'fs';
import readline from 'readline';
import { answerQuestion, removeConversation } from '../app/handlers/service.js';
import { getKnowledgeBase } from '../app/knowledge/index.js';
import config from '../config/index.js';

const USER_ID = 'local-test';
const HANDOFF_LABEL = '［轉真人］';

/**
 * @param {string} question
 * @returns {Promise<string>}
 */
const ask = async (question) => {
  const { isAnswered, text } = await answerQuestion({ userId: USER_ID, question });
  return `${isAnswered ? '' : `${HANDOFF_LABEL} `}${text}`;
};

/**
 * @param {string} question
 */
const askAndPrint = async (question) => {
  console.log(`\n客人：${question}`);
  try {
    console.log(`機器人：${await ask(question)}`);
  } catch (err) {
    console.log(`錯誤：${err.response?.data?.error?.message || err.message}`);
  }
};

/**
 * @param {string} path
 * @returns {Array<Array<string>>} Conversations, each a list of questions.
 */
const readConversations = (path) => fs.readFileSync(path, 'utf8')
  .replace(/\r\n?/g, '\n')
  .split(/\n\s*\n/)
  .map((block) => block.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')))
  .filter((questions) => questions.length > 0);

const chat = () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\n客人：' });
  rl.prompt();
  rl.on('line', async (line) => {
    const question = line.trim();
    if (!question) {
      rl.prompt();
      return;
    }
    if (question === '忘記') {
      removeConversation(USER_ID);
      console.log('（已清除對話，重新開始）');
      rl.prompt();
      return;
    }
    rl.pause();
    try {
      console.log(`機器人：${await ask(question)}`);
    } catch (err) {
      console.log(`錯誤：${err.response?.data?.error?.message || err.message}`);
    }
    rl.resume();
    rl.prompt();
  });
  rl.on('close', () => process.exit(0));
};

const main = async () => {
  if (config.APP_ENV !== 'production') {
    console.error('NODE_ENV 不是 production，會只回傳測試用的假回答。請不要設定 NODE_ENV。');
    process.exit(1);
  }
  if (!config.OPENAI_COMPLETION_API_KEY) {
    console.error('缺少 OPENAI_API_KEY，請在 .env 設定。');
    process.exit(1);
  }
  const knowledgeBase = getKnowledgeBase();
  console.log(`知識庫：${new Set(knowledgeBase.sections.map(({ source }) => source)).size} 個檔案、${knowledgeBase.sections.length} 段；模型：${config.OPENAI_COMPLETION_MODEL}；客服名稱：${config.BOT_NAME}`);

  const args = process.argv.slice(2);
  if (args[0] === '--file') {
    const conversations = readConversations(args[1]);
    // eslint-disable-next-line no-restricted-syntax
    for (const [index, questions] of conversations.entries()) {
      console.log(`\n===== 對話 ${index + 1} =====`);
      removeConversation(USER_ID);
      // eslint-disable-next-line no-restricted-syntax
      for (const question of questions) {
        // Questions in one conversation depend on the previous answer, so they run in order.
        // eslint-disable-next-line no-await-in-loop
        await askAndPrint(question);
      }
    }
    return;
  }
  if (args.length > 0) {
    // eslint-disable-next-line no-restricted-syntax
    for (const question of args) {
      // eslint-disable-next-line no-await-in-loop
      await askAndPrint(question);
    }
    return;
  }
  chat();
};

main();
