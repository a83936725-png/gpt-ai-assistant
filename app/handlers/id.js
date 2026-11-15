import { t } from '../../locales/index.js';
import { COMMAND_SYS_ID } from '../commands/index.js';
import Context from '../context.js';

/**
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_SYS_ID);

/**
 * Replies with the IDs an admin needs for APP_ALLOWED_USER_IDS / APP_ALLOWED_GROUP_IDS.
 * Works even where the bot is not allowed yet.
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const exec = (context) => check(context) && (
  async () => {
    context.pushText(t('__COMMAND_SYS_ID_REPLY')(context.userId, context.event.isGroup ? context.groupId : null));
    return context;
  }
)();

export default exec;
