import config from '../../config/index.js';
import { formatGlossary } from '../../constants/ui-glossary.js';
import { t } from '../../locales/index.js';
import { ROLE_AI, ROLE_HUMAN } from '../../services/openai.js';
import { generateCompletion } from '../../utils/index.js';
import { COMMAND_BOT_UI } from '../commands/index.js';
import Context from '../context.js';
import { updateHistory } from '../history/index.js';
import { Prompt } from '../prompt/index.js';

// A UI prompt lists many component names, so it gets more room than a chat reply.
const UI_PROMPT_MAX_TOKENS = 1200;

/**
 * @param {Context} context
 * @returns {string}
 */
const getRequest = (context) => [COMMAND_BOT_UI.text, ...COMMAND_BOT_UI.aliases]
  .reduce((text, word) => (text.toLowerCase().startsWith(word.toLowerCase()) ? text.slice(word.length) : text), context.trimmedText)
  .replace(/^[\s:：]+/, '')
  .replace(/[。.]$/, '')
  .trim();

/**
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_BOT_UI);

/**
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const exec = (context) => check(context) && (
  async () => {
    const request = getRequest(context);
    if (!request) {
      context.pushText(t('__COMMAND_BOT_UI_USAGE'));
      return context;
    }
    try {
      const prompt = (new Prompt()).write(ROLE_HUMAN, t('__COMMAND_BOT_UI_PROMPT')(formatGlossary(), request));
      const { text } = await generateCompletion({ prompt, maxTokens: UI_PROMPT_MAX_TOKENS });
      updateHistory(context.id, (history) => history.write(config.BOT_NAME, text));
      context.pushText(text);
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export {
  getRequest,
};

export default exec;
