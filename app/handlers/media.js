import config from '../../config/index.js';
import { MOCK_TEXT_OK } from '../../constants/mock.js';
import { t } from '../../locales/index.js';
import { generateImage } from '../../utils/index.js';
import { COMMAND_BOT_ANIM, COMMAND_BOT_ICON } from '../commands/index.js';
import Context from '../context.js';
import { updateHistory } from '../history/index.js';

const stripCommand = (text, command) => [command.text, ...command.aliases]
  .reduce((acc, word) => (acc.toLowerCase().startsWith(word.toLowerCase()) ? acc.slice(word.length) : acc), text)
  .replace(/^[\s:：]+/, '')
  .replace(/[。.]$/, '')
  .trim();

/**
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_BOT_ICON) || context.hasCommand(COMMAND_BOT_ANIM);

/**
 * Generates an SVG icon (畫圖示) or GIF animation (畫動畫). Neither displays as a LINE
 * image message, so both reply with a download link to the hosted file.
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const exec = (context) => check(context) && (
  async () => {
    const isAnim = context.hasCommand(COMMAND_BOT_ANIM);
    const command = isAnim ? COMMAND_BOT_ANIM : COMMAND_BOT_ICON;
    const prompt = stripCommand(context.trimmedText, command);
    if (!prompt) {
      context.pushText(t(isAnim ? '__COMMAND_BOT_ANIM_USAGE' : '__COMMAND_BOT_ICON_USAGE'));
      return context;
    }
    try {
      const { url } = await generateImage({ prompt, outputFormat: isAnim ? 'gif' : 'svg' });
      updateHistory(context.id, (history) => history.write(config.BOT_NAME, MOCK_TEXT_OK));
      context.pushText(t(isAnim ? '__COMMAND_BOT_ANIM_REPLY' : '__COMMAND_BOT_ICON_REPLY')(url));
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export {
  stripCommand,
};

export default exec;
