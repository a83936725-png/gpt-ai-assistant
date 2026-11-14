import config from '../../config/index.js';
import { t } from '../../locales/index.js';
import { ROLE_HUMAN } from '../../services/openai.js';
import { generateCompletion } from '../../utils/index.js';
import { COMMAND_BOT_POST } from '../commands/index.js';
import Context from '../context.js';
import { getHistory, updateHistory } from '../history/index.js';
import { Prompt } from '../prompt/index.js';

/**
 * @param {Context} context
 * @returns {string}
 */
const getTopic = (context) => [COMMAND_BOT_POST.text, ...COMMAND_BOT_POST.aliases]
  .reduce((text, word) => (text.toLowerCase().startsWith(word.toLowerCase()) ? text.slice(word.length) : text), context.trimmedText)
  .replace(/^[\s:：]+/, '')
  .replace(/[。.]$/, '')
  .trim();

/**
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_BOT_POST);

/**
 * Writes a social post about the topic after the command, or about the recent chat when no topic is given.
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const exec = (context) => check(context) && (
  async () => {
    let topic = getTopic(context);
    if (!topic) {
      // The command itself is the last history entry; use what was said before it.
      const history = getHistory(context.id);
      topic = history.messages
        .slice(0, -1)
        .filter(({ content }) => typeof content === 'string')
        .map((record) => record.toString())
        .join('\n');
    }
    if (!topic) {
      context.pushText(t('__COMMAND_BOT_POST_USAGE'));
      return context;
    }
    try {
      const prompt = (new Prompt()).write(ROLE_HUMAN, t('__COMMAND_BOT_POST_PROMPT')(topic));
      const { text } = await generateCompletion({ prompt });
      updateHistory(context.id, (history) => history.write(config.BOT_NAME, text));
      context.pushText(text);
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export {
  getTopic,
};

export default exec;
