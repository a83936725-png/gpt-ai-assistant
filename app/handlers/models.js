import config from '../../config/index.js';
import { MOCK_TEXT_OK } from '../../constants/mock.js';
import { t } from '../../locales/index.js';
import checkModels from '../../utils/check-models.js';
import { COMMAND_SYS_MODELS } from '../commands/index.js';
import Context from '../context.js';
import { updateHistory } from '../history/index.js';

const STATUS_ICONS = {
  ok: '✅',
  shutdown_soon: '⚠️',
  shut_down: '❌',
  not_found: '❌',
  unknown: '❔',
};

/**
 * @param {Array<{ feature: string, model: string, status: string, shutdownDate: string|null, daysLeft: number|null }>} results
 * @returns {string}
 */
const formatModelReport = (results) => results
  .map(({
    feature, model, status, shutdownDate, daysLeft,
  }) => `${STATUS_ICONS[status]} ${t('__COMMAND_SYS_MODELS_FEATURE')(feature)}（${model}）：${t('__COMMAND_SYS_MODELS_STATUS')(status, shutdownDate, daysLeft)}`)
  .join('\n');

/**
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_SYS_MODELS);

/**
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const exec = (context) => check(context) && (
  async () => {
    updateHistory(context.id, (history) => history.erase());
    if (config.APP_ENV !== 'production') {
      context.pushText(MOCK_TEXT_OK);
      return context;
    }
    try {
      context.pushText(formatModelReport(await checkModels()));
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export {
  formatModelReport,
};

export default exec;
