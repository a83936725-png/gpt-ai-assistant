import config from '../config/index.js';
import { push } from '../services/line.js';

// Alerts go to the LINE IDs in INSTAGRAM_NOTIFY_LINE_IDS through this bot's own official account
// (send 「我的ID」 to the bot to get yours). The same alert is sent at most once an hour.
const THROTTLE_MS = 60 * 60 * 1000;
const sent = new Map();

const canNotify = () => config.INSTAGRAM_NOTIFY_LINE_IDS.length > 0 && Boolean(config.LINE_CHANNEL_ACCESS_TOKEN);

const notify = async (text, { key = null } = {}) => {
  if (!canNotify()) return false;
  if (key) {
    const last = sent.get(key);
    if (last && Date.now() - last < THROTTLE_MS) return false;
    sent.set(key, Date.now());
  }
  const messages = [{ type: 'text', text: String(text).slice(0, 4900) }];
  await Promise.all(config.INSTAGRAM_NOTIFY_LINE_IDS.map((to) => push({ to, messages }).catch((err) => {
    console.error(`[instagram] LINE notification failed: ${err.message}`);
  })));
  return true;
};

const resetNotify = () => sent.clear();

export {
  canNotify,
  notify,
  resetNotify,
};
