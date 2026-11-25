import config from '../config/index.js';
import { MOCK_TEXT_OK } from '../constants/mock.js';
import { createChatCompletion, ROLE_HUMAN, ROLE_SYSTEM } from '../services/openai.js';
import { describeIkigaiError } from './analyze-ikigai.js';

// Same keys as ELEMENTS in web/travel-data.js.
export const TRAVEL_TAGS = Object.freeze({
  food: '美食',
  culture: '文化古蹟',
  nature: '自然風景',
  island: '海島',
  city: '城市漫遊',
  shopping: '購物',
  onsen: '溫泉',
  snow: '雪景滑雪',
  family: '親子',
  night: '夜生活',
  art: '藝術設計',
  adventure: '戶外冒險',
});

export const TRAVEL_MAX_DAYS = 14;

export class TravelInputError extends Error {}

const clean = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const cleanList = (value, max, length) => (Array.isArray(value)
  ? [...new Set(value.map((item) => clean(item, length)).filter(Boolean))].slice(0, max)
  : []);
const tagList = (value) => (Array.isArray(value) ? [...new Set(value.filter((key) => TRAVEL_TAGS[key]))].slice(0, 6) : []);

/**
 * Cleans the itinerary request from the travel page. Every field is short and structured,
 * so the prompt cannot carry long free text.
 * @param {Object} body
 */
export const normalizeAdviceInput = (body) => {
  if (!body || typeof body !== 'object') throw new TravelInputError('請提供行程資料');
  const destination = clean(body.destination, 40);
  if (!destination) throw new TravelInputError('請提供目的地');
  const days = Number.parseInt(body.days, 10);
  if (!Number.isInteger(days) || days < 1 || days > TRAVEL_MAX_DAYS) {
    throw new TravelInputError(`天數需在 1 到 ${TRAVEL_MAX_DAYS} 天之間`);
  }
  const month = Number.parseInt(body.month, 10);
  return {
    destination,
    country: clean(body.country, 20),
    days,
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null,
    tags: tagList(body.tags),
    likes: tagList(body.likes),
    visited: cleanList(body.visited, 20, 30),
    spots: cleanList(body.spots, 8, 60),
    home: clean(body.home, 20) || '台北',
  };
};

const labels = (keys) => keys.map((key) => TRAVEL_TAGS[key]).join('、');

/**
 * @param {ReturnType<typeof normalizeAdviceInput>} input
 */
export const buildAdviceMessages = (input) => {
  const lines = [
    `目的地：${input.destination}${input.country ? `（${input.country}）` : ''}`,
    `天數：${input.days} 天，從${input.home}出發${input.month ? `，${input.month} 月出發` : ''}`,
  ];
  if (input.tags.length) lines.push(`這個地方的特色：${labels(input.tags)}`);
  if (input.likes.length) lines.push(`旅人過去最常玩的元素：${labels(input.likes)}`);
  if (input.visited.length) lines.push(`2025–2026 去過：${input.visited.join('、')}`);
  if (input.spots.length) lines.push(`可參考的景點與門票：${input.spots.join('、')}`);
  return [
    {
      role: ROLE_SYSTEM,
      content: [
        '你是熟悉亞洲與歐美自由行的旅遊規劃師，也懂出國上網（eSIM）。',
        '請一律使用繁體中文（台灣用語），用 Markdown 標題與條列，總長度約 600 到 900 字。',
        '依天數逐日安排（上午、下午、晚上），同一天的景點要在同一區域，避免來回奔波。',
        '提到需要門票的景點時寫出大約門票並提醒「以官方公告為準」；不確定的價格不要寫。',
        '最後附上「行前清單」：eSIM 安裝時機、交通票卡、當季注意事項。',
        '依旅人過去的喜好調整步調與內容，但不要捏造旅人沒提過的經歷。',
      ].join('\n'),
    },
    { role: ROLE_HUMAN, content: lines.join('\n') },
  ];
};

export const describeTravelError = (err) => {
  const reason = describeIkigaiError(err);
  if (reason.code === 'timeout') reason.error = 'AI 回應逾時。請稍後再試，或把 TRAVEL_TIMEOUT 調高、TRAVEL_MAX_TOKENS 調低';
  if (reason.code === 'unknown') reason.error = 'AI 行程建議失敗，原因不明，請查看 Vercel Logs';
  return reason;
};

/**
 * Asks the chat model for a day-by-day itinerary.
 * @param {Object} body Raw request body from the travel page.
 * @returns {Promise<{ text: string, input: ReturnType<typeof normalizeAdviceInput> }>}
 */
const adviseTrip = async (body) => {
  const input = normalizeAdviceInput(body);
  if (config.APP_ENV !== 'production') return { text: MOCK_TEXT_OK, input };
  const { data } = await createChatCompletion({
    messages: buildAdviceMessages(input),
    maxTokens: Math.max(config.OPENAI_COMPLETION_MAX_TOKENS, config.TRAVEL_MAX_TOKENS),
    timeout: config.TRAVEL_TIMEOUT,
  });
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const err = new Error('Empty completion');
    err.code = 'empty_response';
    throw err;
  }
  return { text, input };
};

export default adviseTrip;
