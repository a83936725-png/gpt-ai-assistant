import {
  fetchMe, fetchMedia, fetchUserProfile, isTokenError, replyToComment, sendMessage, sendPrivateReply,
} from '../services/instagram.js';
import { notify } from './notify.js';
import { rules as defaultRules, settings as defaultSettings } from './rules.js';

// The flow, like ManyChat's comment-to-DM:
// 1. someone comments a keyword → a public reply under the comment + a DM with a button
// 2. they tap the button → if the rule asks for a follow and they do not follow yet, a reminder with the same button
// 3. once they follow and tap again → the link

export const PAYLOAD_PREFIX = 'IGAR:';
const SEEN_MS = 60 * 60 * 1000;
const MAX_CACHE = 2000;

let current = { settings: defaultSettings, rules: defaultRules };
const seen = new Map();
const shortcodes = new Map();
let self = null;

const setRules = ({ settings = defaultSettings, rules = defaultRules } = {}) => {
  current = { settings, rules };
};
const getRules = () => current;

const resetAutoreply = () => {
  seen.clear();
  shortcodes.clear();
  self = null;
  setRules();
};

const normalize = (text) => String(text ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const clip = (text, max) => Array.from(String(text ?? '')).slice(0, max).join('');
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * A Reel or post URL (or a bare shortcode / media ID) → the part Instagram calls the shortcode.
 */
const toShortcode = (value) => {
  const text = String(value ?? '').trim();
  const match = text.match(/instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : text;
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

const getShortcode = async (mediaId) => {
  if (shortcodes.has(mediaId)) return shortcodes.get(mediaId);
  const { data } = await fetchMedia({ mediaId });
  const code = data.shortcode || toShortcode(data.permalink);
  if (shortcodes.size >= MAX_CACHE) shortcodes.delete(shortcodes.keys().next().value);
  shortcodes.set(mediaId, code);
  return code;
};

const matchesPost = async (rule, mediaId) => {
  const posts = (rule.posts || []).map(toShortcode).filter(Boolean);
  if (!posts.length) return true;
  if (!mediaId) return false;
  if (posts.includes(String(mediaId))) return true;
  return posts.includes(await getShortcode(String(mediaId)));
};

// A rule still pointing at the sample link (or no link at all) never fires, so nobody gets a
// placeholder before the owner has filled in rules.js.
const isReady = (rule) => /^https?:\/\//.test(String(rule.link ?? '')) && !/^https?:\/\/(www\.)?example\.com/.test(String(rule.link));

const findRule = async (text, mediaId) => {
  const body = normalize(text);
  if (!body) return null;
  const candidates = current.rules.filter(isReady).filter((rule) => (rule.keywords || []).some((keyword) => {
    const word = normalize(keyword);
    return word && body.includes(word);
  }));
  // eslint-disable-next-line no-restricted-syntax
  for (const rule of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await matchesPost(rule, mediaId)) return rule;
  }
  return null;
};

const isTester = (username) => {
  const list = (current.settings.testUsernames || []).map((name) => String(name).replace(/^@/, '').trim().toLowerCase()).filter(Boolean);
  return !list.length || list.includes(String(username ?? '').toLowerCase());
};

const getSelf = async () => {
  if (!self) {
    const { data } = await fetchMe();
    self = { id: String(data.user_id ?? ''), appScopedId: String(data.id ?? ''), username: String(data.username ?? '').toLowerCase() };
  }
  return self;
};

// The account's own public replies come back as comments too: never answer them.
const isSelf = async (entryId, from) => {
  const id = String(from?.id ?? '');
  if (id && id === String(entryId)) return true;
  try {
    const me = await getSelf();
    return (id && (id === me.id || id === me.appScopedId)) || (Boolean(me.username) && String(from?.username ?? '').toLowerCase() === me.username);
  } catch (err) {
    if (isTokenError(err)) throw err;
    return false;
  }
};

const buttonMessage = (text, buttons) => ({
  attachment: {
    type: 'template',
    payload: { template_type: 'button', text: clip(text, 640), buttons },
  },
});

const askButton = (rule) => ({
  type: 'postback',
  title: clip(rule.buttonTitle || '給我連結', 20),
  payload: `${PAYLOAD_PREFIX}${rule.id}`,
});

const sendLink = async (userId, rule) => {
  const text = rule.linkText || '這是你的連結 🎁';
  try {
    await sendMessage({
      userId,
      message: buttonMessage(text, [{ type: 'web_url', url: rule.link, title: clip(rule.linkTitle || '打開連結', 20) }]),
    });
  } catch (err) {
    if (isTokenError(err)) throw err;
    // A plain text message still gets the link across if the button is refused.
    await sendMessage({ userId, message: { text: clip(`${text}\n${rule.link}`, 1000) } });
  }
};

// true / false, or null when Instagram will not say (the link is sent rather than leaving them stuck).
const checkFollow = async (userId) => {
  try {
    const { data } = await fetchUserProfile({ userId });
    return typeof data.is_user_follow_business === 'boolean' ? data.is_user_follow_business : null;
  } catch (err) {
    if (isTokenError(err)) throw err;
    console.error(`[instagram] follow check failed: ${err.message}`);
    return null;
  }
};

const handleComment = async (entryId, value) => {
  const commentId = value?.id;
  if (!commentId) return { skipped: 'invalid' };
  if (!firstTime(`comment:${commentId}`)) return { skipped: 'duplicate' };
  if (!current.settings.enabled) return { skipped: 'disabled' };
  if (await isSelf(entryId, value.from)) return { skipped: 'self' };
  if (!isTester(value.from?.username)) return { skipped: 'not-tester' };
  const rule = await findRule(value.text, value.media?.id);
  if (!rule) return { skipped: 'no-match' };
  // The DM first: it carries the link, and Instagram allows only one private reply per comment.
  await sendPrivateReply({ commentId, message: buttonMessage(rule.dmText || '按下面的按鈕拿連結 👇', [askButton(rule)]) });
  const result = { rule: rule.id, dm: true, reply: false };
  const replies = (rule.commentReplies || []).filter(Boolean);
  if (replies.length) {
    try {
      await replyToComment({ commentId, text: pick(replies) });
      result.reply = true;
    } catch (err) {
      if (isTokenError(err)) throw err;
      console.error(`[instagram] public reply failed: ${err.message}`);
    }
  }
  return result;
};

const handleTap = async (userId, payload, eventId) => {
  if (!userId || !String(payload ?? '').startsWith(PAYLOAD_PREFIX)) return { skipped: 'not-ours' };
  if (eventId && !firstTime(`tap:${eventId}`)) return { skipped: 'duplicate' };
  if (!current.settings.enabled) return { skipped: 'disabled' };
  const id = String(payload).slice(PAYLOAD_PREFIX.length);
  const rule = current.rules.find((r) => String(r.id) === id);
  if (!rule) {
    await sendMessage({ userId, message: { text: '這個活動已經結束囉，謝謝你的支持 🙏' } });
    return { skipped: 'unknown-rule' };
  }
  if (rule.requireFollow && await checkFollow(userId) === false) {
    await sendMessage({ userId, message: buttonMessage(rule.notFollowingText || '請先追蹤我們，再按一次按鈕 🙏', [askButton(rule)]) });
    return { rule: rule.id, follows: false };
  }
  await sendLink(userId, rule);
  return { rule: rule.id, link: true };
};

const reportError = async (err, where) => {
  console.error(`[instagram] ${where}: ${err.message}`);
  const code = err.instagram?.code;
  if (isTokenError(err)) {
    await notify('⚠️ IG 自動回覆停了：存取權杖（密碼①）失效或過期。\n請到 Meta 開發者後台重新「產生權杖」，貼到 Vercel 的 INSTAGRAM_ACCESS_TOKEN，再重新部署。', { key: 'token' });
  } else if (code === 10 || (code >= 200 && code < 300)) {
    await notify(`⚠️ IG 自動回覆沒有權限：${err.message}\n請確認 App 已切成「上線」，而且權杖有勾選留言和訊息權限。`, { key: `permission:${code}` });
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
      if (payload) tasks.push(['tap', () => handleTap(event.sender?.id, payload, event.postback?.mid || event.message?.mid)]);
    });
  });
  return Promise.all(tasks.map(([where, task]) => task().catch(async (err) => {
    await reportError(err, where);
    return { error: err.message };
  })));
};

/**
 * Problems in rules.js that would stop a rule from working, in words the owner can act on.
 */
const checkRules = ({ rules } = current) => {
  const problems = [];
  const ids = new Set();
  rules.forEach((rule, index) => {
    const name = `第 ${index + 1} 條規則（${rule.id || '沒有 id'}）`;
    if (!rule.id) problems.push(`${name}：缺少 id`);
    else if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(rule.id))) problems.push(`${name}：id 只能用英文、數字、- 或 _`);
    if (ids.has(String(rule.id))) problems.push(`${name}：id 和前面的規則重複`);
    ids.add(String(rule.id));
    if (!(rule.keywords || []).some((k) => normalize(k))) problems.push(`${name}：沒有關鍵字`);
    if (!/^https?:\/\//.test(String(rule.link ?? ''))) problems.push(`${name}：link 要是 http:// 或 https:// 開頭的網址`);
    if (/^https?:\/\/(www\.)?example\.com/.test(String(rule.link ?? ''))) problems.push(`${name}：link 還是範例網址，換成你的連結之前這條規則不會觸發`);
    if (Array.from(String(rule.buttonTitle ?? '')).length > 20) problems.push(`${name}：buttonTitle 超過 20 個字`);
    if (Array.from(String(rule.linkTitle ?? '')).length > 20) problems.push(`${name}：linkTitle 超過 20 個字`);
  });
  return problems;
};

export {
  setRules,
  getRules,
  resetAutoreply,
  normalize,
  toShortcode,
  findRule,
  handleComment,
  handleTap,
  handleWebhook,
  checkRules,
};
