import {
  fetchMedia, fetchUserProfile, isTokenError, replyToComment, sendMessage, sendPrivateReply,
} from '../services/instagram.js';
import { findAccount } from './accounts.js';
import { notify } from './notify.js';
import {
  checkRules, isReady, loadRules, normalize, setRulesOverride,
} from './rules-store.js';

// The flow, like ManyChat's comment-to-DM, for every connected Instagram account:
// 1. someone comments a keyword → a public reply under the comment + a DM with a button
// 2. they tap the button → if the rule asks for a follow and they do not follow yet, a reminder with the same button
// 3. once they follow and tap again → the link
// Each webhook names the account it is for (entry.id); everything is sent with that account's token.

export const PAYLOAD_PREFIX = 'IGAR:';
const SEEN_MS = 60 * 60 * 1000;
const MAX_CACHE = 2000;

const seen = new Map();
const shortcodes = new Map();

const setRules = (value) => setRulesOverride(value);

const resetAutoreply = () => {
  seen.clear();
  shortcodes.clear();
  setRulesOverride(null);
};

const clip = (value, max) => Array.from(String(value ?? '')).slice(0, max).join('');
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const label = (account) => (account?.username ? `@${account.username}` : 'IG 帳號');

/**
 * A Reel or post URL (or a bare shortcode / media ID) → the part Instagram calls the shortcode.
 */
const toShortcode = (value) => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : raw;
};

// Meta resends a webhook when it is not sure it arrived: handle each comment and tap once.
const firstTime = (key, now = Date.now()) => {
  // eslint-disable-next-line no-restricted-syntax
  for (const [k, time] of seen) {
    if (now - time <= SEEN_MS && seen.size <= MAX_CACHE) break;
    seen.delete(k);
  }
  if (seen.has(key)) return false;
  seen.set(key, now);
  return true;
};

const getShortcode = async (account, mediaId) => {
  if (shortcodes.has(mediaId)) return shortcodes.get(mediaId);
  const { data } = await fetchMedia({ token: account.token, mediaId });
  const code = data.shortcode || toShortcode(data.permalink);
  if (shortcodes.size >= MAX_CACHE) shortcodes.delete(shortcodes.keys().next().value);
  shortcodes.set(mediaId, code);
  return code;
};

// A rule with no account works for every account; otherwise only for the one it names.
const forAccount = (rule, account) => {
  const target = String(rule.account ?? '').replace(/^@/, '').trim().toLowerCase();
  return !target || target === String(account.userId) || target === String(account.username ?? '').toLowerCase();
};

const matchesPost = async (rule, account, mediaId) => {
  const posts = (rule.posts || []).map(toShortcode).filter(Boolean);
  if (!posts.length) return true;
  if (!mediaId) return false;
  if (posts.includes(String(mediaId))) return true;
  return posts.includes(await getShortcode(account, String(mediaId)));
};

const findRule = async (rules, account, comment, mediaId) => {
  const body = normalize(comment);
  if (!body) return null;
  const candidates = rules.filter((rule) => isReady(rule) && forAccount(rule, account) && (rule.keywords || []).some((keyword) => {
    const word = normalize(keyword);
    return word && body.includes(word);
  }));
  // eslint-disable-next-line no-restricted-syntax
  for (const rule of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await matchesPost(rule, account, mediaId)) return rule;
  }
  return null;
};

const isTester = (settings, username) => {
  const names = (settings.testUsernames || []).map((name) => String(name).replace(/^@/, '').trim().toLowerCase()).filter(Boolean);
  return !names.length || names.includes(String(username ?? '').toLowerCase());
};

// The account's own public replies come back as comments too: never answer them.
const isSelf = (account, entryId, from) => {
  const id = String(from?.id ?? '');
  if (id && [String(entryId), account.userId, account.appScopedId].includes(id)) return true;
  return Boolean(account.username) && String(from?.username ?? '').toLowerCase() === account.username.toLowerCase();
};

const buttonMessage = (body, buttons) => ({
  attachment: {
    type: 'template',
    payload: { template_type: 'button', text: clip(body, 640), buttons },
  },
});

const askButton = (rule) => ({
  type: 'postback',
  title: clip(rule.buttonTitle || '給我連結', 20),
  payload: `${PAYLOAD_PREFIX}${rule.id}`,
});

const sendLink = async (account, userId, rule) => {
  const body = rule.linkText || '這是你的連結 🎁';
  try {
    await sendMessage({
      token: account.token,
      userId,
      message: buttonMessage(body, [{ type: 'web_url', url: rule.link, title: clip(rule.linkTitle || '打開連結', 20) }]),
    });
  } catch (err) {
    if (isTokenError(err)) throw err;
    // A plain text message still gets the link across if the button is refused.
    await sendMessage({ token: account.token, userId, message: { text: clip(`${body}\n${rule.link}`, 1000) } });
  }
};

// true / false, or null when Instagram will not say (the link is sent rather than leaving them stuck).
const checkFollow = async (account, userId) => {
  try {
    const { data } = await fetchUserProfile({ token: account.token, userId });
    return typeof data.is_user_follow_business === 'boolean' ? data.is_user_follow_business : null;
  } catch (err) {
    if (isTokenError(err)) throw err;
    console.error(`[instagram] ${label(account)} follow check failed: ${err.message}`);
    return null;
  }
};

const handleComment = async (entryId, value) => {
  const commentId = value?.id;
  if (!commentId) return { skipped: 'invalid' };
  if (!firstTime(`comment:${commentId}`)) return { skipped: 'duplicate' };
  const { settings, rules } = await loadRules();
  if (!settings.enabled) return { skipped: 'disabled' };
  const account = await findAccount(entryId);
  if (!account) {
    console.error(`[instagram] a comment came for account ${entryId}, which is not connected`);
    return { skipped: 'unknown-account' };
  }
  if (account.paused) return { skipped: 'paused' };
  if (isSelf(account, entryId, value.from)) return { skipped: 'self' };
  if (!isTester(settings, value.from?.username)) return { skipped: 'not-tester' };
  const rule = await findRule(rules, account, value.text, value.media?.id);
  if (!rule) return { skipped: 'no-match' };
  try {
    // The DM first: it carries the link, and Instagram allows only one private reply per comment.
    await sendPrivateReply({ token: account.token, commentId, message: buttonMessage(rule.dmText || '按下面的按鈕拿連結 👇', [askButton(rule)]) });
    const result = {
      account: account.username, rule: rule.id, dm: true, reply: false,
    };
    const replies = (rule.commentReplies || []).filter(Boolean);
    if (replies.length) {
      try {
        await replyToComment({ token: account.token, commentId, text: pick(replies) });
        result.reply = true;
      } catch (err) {
        if (isTokenError(err)) throw err;
        console.error(`[instagram] ${label(account)} public reply failed: ${err.message}`);
      }
    }
    return result;
  } catch (err) {
    err.account = account;
    throw err;
  }
};

const handleTap = async (entryId, userId, payload, eventId) => {
  if (!userId || !String(payload ?? '').startsWith(PAYLOAD_PREFIX)) return { skipped: 'not-ours' };
  if (eventId && !firstTime(`tap:${eventId}`)) return { skipped: 'duplicate' };
  const { settings, rules } = await loadRules();
  if (!settings.enabled) return { skipped: 'disabled' };
  const account = await findAccount(entryId);
  if (!account) return { skipped: 'unknown-account' };
  if (account.paused) return { skipped: 'paused' };
  try {
    const id = String(payload).slice(PAYLOAD_PREFIX.length);
    const rule = rules.find((r) => String(r.id) === id && forAccount(r, account) && isReady(r));
    if (!rule) {
      await sendMessage({ token: account.token, userId, message: { text: '這個活動已經結束囉，謝謝你的支持 🙏' } });
      return { account: account.username, skipped: 'unknown-rule' };
    }
    if (rule.requireFollow && await checkFollow(account, userId) === false) {
      await sendMessage({ token: account.token, userId, message: buttonMessage(rule.notFollowingText || '請先追蹤我們，再按一次按鈕 🙏', [askButton(rule)]) });
      return { account: account.username, rule: rule.id, follows: false };
    }
    await sendLink(account, userId, rule);
    return { account: account.username, rule: rule.id, link: true };
  } catch (err) {
    err.account = account;
    throw err;
  }
};

const reportError = async (err, where) => {
  const who = label(err.account);
  console.error(`[instagram] ${who} ${where}: ${err.message}`);
  const code = err.instagram?.code;
  const key = err.account?.userId || 'unknown';
  if (isTokenError(err)) {
    await notify(`⚠️ IG 自動回覆：${who} 的權杖失效或過期，這個帳號停止自動回覆了。\n請到 IG 自動回覆後台重新「用 Instagram 登入」這個帳號（或在 Meta 後台重新產生權杖）。`, { key: `token:${key}` });
  } else if (code === 10 || (code >= 200 && code < 300)) {
    await notify(`⚠️ IG 自動回覆：${who} 沒有權限：${err.message}\n請確認 App 已切成「上線」，而且這個帳號有勾選留言和訊息權限。`, { key: `permission:${key}:${code}` });
  }
};

/**
 * Handles one webhook delivery from Instagram. Never throws: Meta keeps resending deliveries
 * that are not answered with 200, so errors are logged and reported instead.
 */
const handleWebhook = async (body) => {
  if (body?.object !== 'instagram') return [];
  const tasks = [];
  (body.entry || []).forEach((entry) => {
    (entry.changes || []).forEach((change) => {
      if (change.field === 'comments') tasks.push(['comment', () => handleComment(entry.id, change.value)]);
    });
    (entry.messaging || []).forEach((event) => {
      if (event.message?.is_echo) return;
      const payload = event.postback?.payload || event.message?.quick_reply?.payload;
      if (payload) {
        tasks.push(['tap', () => handleTap(entry.id || event.recipient?.id, event.sender?.id, payload, event.postback?.mid || event.message?.mid)]);
      }
    });
  });
  return Promise.all(tasks.map(([where, task]) => task().catch(async (err) => {
    await reportError(err, where);
    return { error: err.message };
  })));
};

export {
  setRules,
  resetAutoreply,
  normalize,
  toShortcode,
  forAccount,
  handleComment,
  handleTap,
  handleWebhook,
  checkRules,
};
