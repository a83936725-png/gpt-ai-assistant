import config from '../../config/index.js';
import Context from '../context.js';

/**
 * Expo reception practice: an AI plays a mum visiting the booth and staff practise the reception
 * script, then get a score. The practice itself (the mum's persona, the scoring rubric and the
 * conversation) lives on the private expo SOP site; this handler only relays staff messages there,
 * so none of the internal sales material is in this public repository.
 */

export const TRAINER_COMMANDS = Object.freeze({
  練習接待: 'start',
  結束練習: 'end',
  繼續練習: 'resume',
  放棄練習: 'quit',
});

const ACTIVE_MS = 2 * 60 * 60 * 1000;
const TIMEOUT_MS = 55 * 1000;

/**
 * Staff who are in a practice right now, so their next messages go to the practice instead of the
 * other handlers. Kept per process; after a restart staff type 「繼續練習」 to pick it up again,
 * because the practice itself is stored on the expo SOP site.
 * @type {Map<string, number>}
 */
const active = new Map();

const isActive = (userId) => {
  const until = active.get(userId);
  if (!until) return false;
  if (until < Date.now()) {
    active.delete(userId);
    return false;
  }
  return true;
};

const setActive = (userId, on) => {
  if (on) active.set(userId, Date.now() + ACTIVE_MS);
  else active.delete(userId);
};

/**
 * The message as typed: without the 「。」 the bot adds to other prompts, and without trailing
 * punctuation, so 「結束練習！」 still counts as the command.
 * @param {Context} context
 * @returns {string}
 */
const typedText = (context) => context.event.text.replaceAll('　', ' ').trim();
const commandOf = (text) => TRAINER_COMMANDS[text.replace(/[。！？!?.\s]+$/, '')];

const isEnabled = () => Boolean(config.TRAINER_RPC_URL && config.TRAINER_SECRET);

/**
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => isEnabled()
  && context.event.isText
  && !context.event.isGroup
  && config.TRAINER_USER_IDS.includes(context.userId)
  && Boolean(commandOf(typedText(context)) || isActive(context.userId));

/**
 * @param {Object} param
 * @param {string} param.op start, say, end, resume or quit.
 * @param {string} param.userId
 * @param {string} param.text
 * @returns {Promise<{active: boolean, text: string}>}
 */
const callTrainer = async ({ op, userId, text }) => {
  const res = await fetch(config.TRAINER_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn: 'api_trainerLine', args: [config.TRAINER_SECRET, op, userId, text] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json();
  if (!body.ok) {
    const err = new Error(body.error || 'Trainer request failed');
    err.code = body.code || 'error';
    throw err;
  }
  return body.result;
};

/**
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const exec = (context) => check(context) && (
  async () => {
    const text = typedText(context);
    const op = commandOf(text) || 'say';
    try {
      const result = await callTrainer({ op, userId: context.userId, text: op === 'say' ? text : '' });
      setActive(context.userId, result.active);
      context.pushText(result.text);
    } catch (err) {
      if (err.code === 'no_session') setActive(context.userId, false);
      console.error(`Trainer failed: ${err.message}`);
      // The expo site's errors are written for staff; network problems get a generic hint.
      context.pushText(err.code ? err.message : '練習服務暫時連不上，請稍後再試，或輸入「繼續練習」接著練。');
    }
    return context;
  }
)();

export {
  isActive,
  setActive,
};

export default exec;
