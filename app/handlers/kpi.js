import { t } from '../../locales/index.js';
import parseKpi from '../../utils/parse-kpi.js';
import { createKpiBubble } from '../messages/index.js';
import { COMMAND_BOT_KPI } from '../commands/index.js';
import Context from '../context.js';
import { updateHistory } from '../history/index.js';

const stripCommand = (text) => [COMMAND_BOT_KPI.text, ...COMMAND_BOT_KPI.aliases]
  .reduce((acc, word) => (acc.toLowerCase().startsWith(word.toLowerCase()) ? acc.slice(word.length) : acc), text)
  .replace(/^[\s:：]+/, '')
  .trim();

/**
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_BOT_KPI);

/**
 * Turns typed numbers into a KPI Flex card (大數字彈出 + 升跌變化).
 * @param {Context} context
 * @returns {Context}
 */
const exec = (context) => check(context) && (
  (() => {
    updateHistory(context.id, (history) => history.erase());
    const { title, metrics } = parseKpi(stripCommand(context.trimmedText));
    if (!metrics.length) {
      context.pushText(t('__COMMAND_BOT_KPI_USAGE'));
      return context;
    }
    const altText = `${title ? `${title}｜` : ''}${metrics.map((m) => `${m.label} ${m.value}`).join('、')}`;
    context.pushFlex(altText, createKpiBubble({ title, metrics }));
    return context;
  })()
);

export {
  stripCommand,
};

export default exec;
