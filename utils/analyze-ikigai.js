import config from '../config/index.js';
import { MOCK_TEXT_OK } from '../constants/mock.js';
import { createChatCompletion, ROLE_HUMAN, ROLE_SYSTEM } from '../services/openai.js';

export const IKIGAI_CIRCLES = Object.freeze([
  { key: 'love', label: '你熱愛的' },
  { key: 'good', label: '你擅長的' },
  { key: 'need', label: '世界需要的' },
  { key: 'paid', label: '可以獲得報酬的' },
]);

export const IKIGAI_MAX_ITEMS = 20;
export const IKIGAI_MAX_ITEM_LENGTH = 60;
export const IKIGAI_MAX_NOTE_LENGTH = 300;

export class IkigaiInputError extends Error {}

/**
 * Cleans the four lists sent by the web page: trims, drops empty and duplicate items, and caps sizes.
 * @param {Object} body
 * @returns {{ love: string[], good: string[], need: string[], paid: string[], note: string }}
 */
export const normalizeIkigai = (body) => {
  if (!body || typeof body !== 'object') throw new IkigaiInputError('請提供 IKIGAI 內容');
  const result = { note: '' };
  IKIGAI_CIRCLES.forEach(({ key, label }) => {
    const list = Array.isArray(body[key]) ? body[key] : [];
    const items = [...new Set(list
      .filter((item) => typeof item === 'string')
      .map((item) => item.replace(/\s+/g, ' ').trim().slice(0, IKIGAI_MAX_ITEM_LENGTH))
      .filter(Boolean))];
    if (items.length > IKIGAI_MAX_ITEMS) throw new IkigaiInputError(`「${label}」最多 ${IKIGAI_MAX_ITEMS} 項`);
    result[key] = items;
  });
  if (typeof body.note === 'string') result.note = body.note.trim().slice(0, IKIGAI_MAX_NOTE_LENGTH);
  const filled = IKIGAI_CIRCLES.filter(({ key }) => result[key].length > 0).length;
  if (filled < 2) throw new IkigaiInputError('至少填寫兩個圈，每圈一項以上，才能分析');
  return result;
};

/**
 * @param {ReturnType<typeof normalizeIkigai>} ikigai
 * @returns {Array<{ role: string, content: string }>}
 */
export const buildIkigaiMessages = (ikigai) => {
  const lists = IKIGAI_CIRCLES
    .map(({ key, label }) => `【${label}】${ikigai[key].length ? ikigai[key].join('、') : '（未填）'}`)
    .join('\n');
  const note = ikigai.note ? `\n【補充說明】${ikigai.note}` : '';
  return [
    {
      role: ROLE_SYSTEM,
      content: [
        '你是一位溫暖、務實的生涯教練，熟悉 IKIGAI（生き甲斐）四圈模型與台灣的就業市場。',
        '請一律使用繁體中文（台灣用語）回答，使用 Markdown 標題與條列，總長度約 800 到 1200 字。',
        '不要捏造使用者沒提到的經歷；推論時請說明依據來自哪個圈的哪一項。',
      ].join('\n'),
    },
    {
      role: ROLE_HUMAN,
      content: [
        '以下是我的 IKIGAI 四圈清單：',
        lists + note,
        '',
        '請依序回答：',
        '## 1. 四個交集',
        '分別寫出 熱情（熱愛×擅長）、使命（熱愛×世界需要）、天職（世界需要×報酬）、專業（擅長×報酬）各自的觀察，每項 1 到 2 句。',
        '## 2. 可能的 IKIGAI',
        '提出 2 到 3 個同時落在四圈的具體方向（職業、副業或專案），每個方向說明對應到哪些項目。',
        '## 3. 建議職業',
        '列出 5 個具體職稱，每個用 1 句話說明為什麼適合、對應到清單裡的哪些項目。',
        '## 4. 需要加強的能力',
        '列出 3 到 5 項要補強的能力，說明為什麼需要、可以怎麼練（課程、證照、作品或實習）。也指出哪個圈最薄弱。',
        '## 5. 職業規劃',
        '分成「第 1 個月」「第 2～3 個月」「第 4～6 個月」「6～12 個月」，各寫 1 到 2 個具體行動。',
      ].join('\n'),
    },
  ];
};

const NETWORK_ERROR_CODES = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ERR_NETWORK'];

/**
 * Turns a failed AI call into a reason the page can show. It never repeats the provider's raw message,
 * which can include part of the API key.
 * @param {Error & { code?: string, response?: { status: number, data?: Object } }} err
 * @returns {{ code: string, error: string }}
 */
export const describeIkigaiError = (err) => {
  const status = err?.response?.status;
  const detail = err?.response?.data?.error || {};
  const model = config.OPENAI_COMPLETION_MODEL;
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || /timeout/i.test(err?.message || '')) {
    return { code: 'timeout', error: 'AI 回應逾時。請稍後再試，或把 IKIGAI_TIMEOUT 調高、IKIGAI_MAX_TOKENS 調低' };
  }
  if (!status && NETWORK_ERROR_CODES.includes(err?.code)) {
    return { code: 'network', error: '伺服器連不到 AI 服務，請檢查 OPENAI_COMPLETION_BASE_URL（或 OPENAI_BASE_URL）' };
  }
  if (status === 401) {
    return { code: 'invalid_api_key', error: 'OpenAI API 金鑰無效或已失效，請檢查 OPENAI_API_KEY（或 OPENAI_COMPLETION_API_KEY）' };
  }
  if (status === 403) {
    return { code: 'forbidden', error: `這把 API 金鑰沒有權限使用模型「${model}」，或所在地區不支援` };
  }
  if (status === 404 || detail.code === 'model_not_found') {
    return { code: 'model_not_found', error: `找不到模型「${model}」，請檢查 OPENAI_COMPLETION_MODEL` };
  }
  if (status === 429 && (detail.code === 'insufficient_quota' || detail.type === 'insufficient_quota')) {
    return { code: 'insufficient_quota', error: 'OpenAI 額度用完了，請到 OpenAI 後台的 Billing 儲值或提高上限' };
  }
  if (status === 429) {
    return { code: 'rate_limited', error: 'OpenAI 目前請求太頻繁，請過一分鐘再試' };
  }
  if (status === 400) {
    const param = detail.param ? `（參數 ${detail.param}）` : '';
    return { code: 'bad_request', error: `OpenAI 拒絕了這次請求${param}，可能是模型「${model}」不支援目前的設定` };
  }
  if (status >= 500) {
    return { code: 'upstream_error', error: `AI 服務暫時異常（狀態碼 ${status}），請稍後再試` };
  }
  if (status) {
    return { code: 'upstream_error', error: `AI 服務回傳錯誤（狀態碼 ${status}）` };
  }
  if (err?.code === 'empty_response') {
    return { code: 'empty_response', error: 'AI 沒有回傳內容，請再試一次' };
  }
  if (err?.code === 'bad_format') {
    return { code: 'bad_format', error: 'AI 回覆的格式不正確，請再試一次' };
  }
  return { code: 'unknown', error: 'AI 分析失敗，原因不明，請查看 Vercel Logs' };
};

/**
 * Asks the chat model for an IKIGAI reading of the four lists.
 * @param {Object} body Raw request body from the web page.
 * @returns {Promise<{ text: string, ikigai: ReturnType<typeof normalizeIkigai> }>}
 */
const analyzeIkigai = async (body) => {
  const ikigai = normalizeIkigai(body);
  if (config.APP_ENV !== 'production') return { text: MOCK_TEXT_OK, ikigai };
  const { data } = await createChatCompletion({
    messages: buildIkigaiMessages(ikigai),
    maxTokens: Math.max(config.OPENAI_COMPLETION_MAX_TOKENS, config.IKIGAI_MAX_TOKENS),
    timeout: config.IKIGAI_TIMEOUT,
  });
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const err = new Error('Empty completion');
    err.code = 'empty_response';
    throw err;
  }
  return { text, ikigai };
};

export const PLAN_HORIZONS = Object.freeze(['d30', 'd90', 'y1']);
const PLAN_MAX_ACTIONS = 12;

/**
 * @param {Object} body Raw request body: the four lists plus `direction`.
 * @returns {ReturnType<typeof normalizeIkigai> & { direction: string }}
 */
export const normalizePlanInput = (body) => {
  const ikigai = normalizeIkigai(body);
  const direction = typeof body.direction === 'string' ? body.direction.replace(/\s+/g, ' ').trim().slice(0, IKIGAI_MAX_ITEM_LENGTH) : '';
  if (!direction) throw new IkigaiInputError('請先選一個生涯方向');
  return { ...ikigai, direction };
};

/**
 * @param {ReturnType<typeof normalizePlanInput>} input
 * @returns {Array<{ role: string, content: string }>}
 */
export const buildPlanMessages = (input) => {
  const lists = IKIGAI_CIRCLES
    .map(({ key, label }) => `【${label}】${input[key].length ? input[key].join('、') : '（未填）'}`)
    .join('\n');
  const note = input.note ? `\n【補充說明】${input.note}` : '';
  return [
    {
      role: ROLE_SYSTEM,
      content: [
        '你是一位務實的生涯教練，熟悉 IKIGAI（生き甲斐）四圈模型。',
        '一律使用繁體中文（台灣用語）。只輸出一個 JSON 物件，不要加任何說明文字或 Markdown。',
      ].join('\n'),
    },
    {
      role: ROLE_HUMAN,
      content: [
        '以下是我的 IKIGAI 四圈清單：',
        lists + note,
        '',
        `我選定的生涯方向：「${input.direction}」`,
        '',
        '請幫我排一份可以執行的計畫，輸出格式：',
        '{"goals":{"d30":"30 天內要達成的具體目標","d90":"90 天目標","y1":"1 年目標"},',
        ' "actions":[{"text":"具體行動，20 字以內，用動詞開頭","horizon":"d30"}]}',
        '規則：goals 每項一句話、可衡量；actions 共 6 到 9 項，horizon 只能是 d30、d90 或 y1，d30 至少 3 項；',
        '行動要能從我清單裡的熱愛、擅長的項目出發，補強最薄弱的圈。',
      ].join('\n'),
    },
  ];
};

/**
 * Pulls the first JSON object out of a model reply and keeps only well-formed goals and actions.
 * @param {string} text
 * @returns {{ goals: { d30: string, d90: string, y1: string }, actions: Array<{ text: string, horizon: string }> }}
 */
export const parsePlan = (text) => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let raw;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    raw = null;
  }
  const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const goals = Object.fromEntries(PLAN_HORIZONS.map((h) => [h, clean(raw?.goals?.[h], 200)]));
  const actions = (Array.isArray(raw?.actions) ? raw.actions : [])
    .map((a) => ({ text: clean(a?.text, 80), horizon: PLAN_HORIZONS.includes(a?.horizon) ? a.horizon : 'd30' }))
    .filter((a) => a.text)
    .slice(0, PLAN_MAX_ACTIONS);
  if (!actions.length && !PLAN_HORIZONS.some((h) => goals[h])) {
    const err = new Error('Plan reply is not JSON');
    err.code = 'bad_format';
    throw err;
  }
  return { goals, actions };
};

const mockPlan = (direction) => ({
  goals: {
    d30: `確認「${direction}」是不是自己真正想要的方向`,
    d90: `完成一個和「${direction}」有關的小作品並取得回饋`,
    y1: `讓「${direction}」開始帶來穩定收入`,
  },
  actions: [
    { text: '訪談 3 位已經在做這件事的人', horizon: 'd30' },
    { text: '每週寫一篇學習筆記', horizon: 'd30' },
    { text: '列出需要補強的 3 項能力', horizon: 'd30' },
    { text: '完成第一個作品並公開', horizon: 'd90' },
    { text: '找到第一位付費對象', horizon: 'y1' },
  ],
});

/**
 * Asks the chat model for 30-day, 90-day and 1-year goals plus actions for one career direction.
 * @param {Object} body Raw request body from the web page.
 */
export const planIkigai = async (body) => {
  const input = normalizePlanInput(body);
  if (config.APP_ENV !== 'production') return mockPlan(input.direction);
  const { data } = await createChatCompletion({
    messages: buildPlanMessages(input),
    maxTokens: Math.max(config.OPENAI_COMPLETION_MAX_TOKENS, config.IKIGAI_MAX_TOKENS),
    timeout: config.IKIGAI_TIMEOUT,
  });
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const err = new Error('Empty completion');
    err.code = 'empty_response';
    throw err;
  }
  return parsePlan(text);
};

export default analyzeIkigai;
