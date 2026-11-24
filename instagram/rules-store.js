import { readJson, writeJson } from './store.js';
import { rules as fileRules, settings as fileSettings } from './rules.js';

// The rules in use: what was last saved on the admin page, or instagram/rules.js until then.
const PATH = 'instagram/rules.json';
const CACHE_MS = 5 * 60 * 1000;
const DEFAULT_SETTINGS = { enabled: true, testUsernames: [] };

let cache = null;
let cachedAt = 0;
let override = null;

const normalize = (text) => String(text ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

const isSampleLink = (link) => /^https?:\/\/(www\.)?example\.com/.test(String(link ?? ''));

// A rule without a real link (or still on the sample link) never fires, so nobody gets a
// placeholder before the owner has filled the rules in.
const isReady = (rule) => /^https?:\/\//.test(String(rule.link ?? '')) && !isSampleLink(rule.link);

const text = (value, max = 1000) => Array.from(String(value ?? '').trim()).slice(0, max).join('');
const list = (value, max = 1000) => (Array.isArray(value) ? value : String(value ?? '').split(/[\n,，]/))
  .map((item) => text(item, max)).filter(Boolean).slice(0, 50);

/**
 * Keeps only the fields a rule has, with the right types. Used for what the admin page sends.
 */
const sanitizeRule = (rule = {}) => ({
  id: text(rule.id, 40),
  account: text(rule.account, 100).replace(/^@/, ''),
  keywords: list(rule.keywords, 100),
  posts: list(rule.posts, 300),
  commentReplies: (Array.isArray(rule.commentReplies) ? rule.commentReplies : String(rule.commentReplies ?? '').split('\n'))
    .map((item) => text(item, 300)).filter(Boolean).slice(0, 20),
  dmText: text(rule.dmText, 640),
  buttonTitle: text(rule.buttonTitle, 40),
  requireFollow: Boolean(rule.requireFollow),
  notFollowingText: text(rule.notFollowingText, 640),
  linkText: text(rule.linkText, 640),
  linkTitle: text(rule.linkTitle, 40),
  link: text(rule.link, 1000),
});

const sanitizeSettings = (settings = {}) => ({
  enabled: settings.enabled !== false,
  testUsernames: list(settings.testUsernames, 100).map((name) => name.replace(/^@/, '')),
});

/**
 * Problems that would stop a rule from working, in words the owner can act on.
 */
const checkRules = ({ rules }) => {
  const problems = [];
  const ids = new Set();
  rules.forEach((rule, index) => {
    const name = `第 ${index + 1} 條規則（${rule.id || '沒有 id'}）`;
    if (!rule.id) problems.push(`${name}：缺少代號 id`);
    else if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(rule.id))) problems.push(`${name}：代號只能用英文、數字、- 或 _`);
    if (ids.has(String(rule.id))) problems.push(`${name}：代號和前面的規則重複`);
    ids.add(String(rule.id));
    if (!(rule.keywords || []).some((k) => normalize(k))) problems.push(`${name}：沒有關鍵字`);
    if (isSampleLink(rule.link)) problems.push(`${name}：連結還是範例網址，換成你的連結之前這條規則不會觸發`);
    else if (!/^https?:\/\//.test(String(rule.link ?? ''))) problems.push(`${name}：連結要是 http:// 或 https:// 開頭的網址`);
    if (Array.from(String(rule.buttonTitle ?? '')).length > 20) problems.push(`${name}：按鈕文字超過 20 個字`);
    if (Array.from(String(rule.linkTitle ?? '')).length > 20) problems.push(`${name}：連結按鈕文字超過 20 個字`);
  });
  return problems;
};

const fromFile = () => ({
  settings: { ...DEFAULT_SETTINGS, ...fileSettings }, rules: fileRules, source: 'file', updatedAt: null,
});

const loadRules = async ({ fresh = false } = {}) => {
  if (override) return override;
  if (!fresh && cache && Date.now() - cachedAt < CACHE_MS) return cache;
  try {
    const stored = await readJson(PATH);
    cache = stored?.rules
      ? {
        settings: { ...DEFAULT_SETTINGS, ...stored.settings }, rules: stored.rules, source: 'admin', updatedAt: stored.updatedAt || null,
      }
      : fromFile();
  } catch (err) {
    console.error(`[instagram] could not read rules: ${err.message}`);
    cache = cache || fromFile();
  }
  cachedAt = Date.now();
  return cache;
};

/**
 * Saves rules from the admin page. They take effect at once on this server instance and within
 * five minutes on the others.
 */
const saveRules = async ({ settings, rules }) => {
  const clean = {
    settings: sanitizeSettings(settings),
    rules: (Array.isArray(rules) ? rules : []).slice(0, 100).map(sanitizeRule),
  };
  const updatedAt = Date.now();
  await writeJson(PATH, { ...clean, updatedAt });
  cache = { ...clean, source: 'admin', updatedAt };
  cachedAt = Date.now();
  return { ...cache, problems: checkRules(clean) };
};

// Tests set rules directly; null goes back to storage and rules.js.
const setRulesOverride = (value) => {
  override = value ? { settings: { ...DEFAULT_SETTINGS, ...value.settings }, rules: value.rules, source: 'test' } : null;
  cache = null;
  cachedAt = 0;
};

export {
  normalize,
  isReady,
  sanitizeRule,
  sanitizeSettings,
  checkRules,
  loadRules,
  saveRules,
  setRulesOverride,
};
