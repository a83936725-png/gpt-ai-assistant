import express from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import config from '../config/index.js';
import analyzeIkigai, {
  describeIkigaiError, IkigaiInputError, IKIGAI_CIRCLES, normalizeIkigai, normalizePlanInput, planIkigai,
} from '../utils/analyze-ikigai.js';
import moderateContent from '../utils/moderate-content.js';

// Resolved from the project root so it works on Vercel (see includeFiles in vercel.json), in Docker and in Jest.
const PAGE_PATH = path.join(process.cwd(), 'web', 'ikigai.html');
const WINDOW_MS = 60 * 60 * 1000;

let page;
const getPage = () => {
  if (!page || config.APP_ENV !== 'production') page = readFileSync(PAGE_PATH, 'utf8');
  return page;
};

// Best-effort limit per client IP. Serverless instances do not share memory, so this only slows down abuse.
const hits = new Map();
const isRateLimited = (ip, now = Date.now()) => {
  const recent = (hits.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= config.IKIGAI_RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
  return false;
};

const resetRateLimit = () => hits.clear();

const getClientIp = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const router = express.Router();

router.use((req, res, next) => {
  if (!config.IKIGAI_ENABLED) {
    res.sendStatus(404);
    return;
  }
  next();
});

router.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(getPage());
});

router.get('/status', (req, res) => {
  res.json({ ai: config.IKIGAI_AI_ENABLED && Boolean(config.OPENAI_COMPLETION_API_KEY || config.APP_ENV !== 'production') });
});

// Shared by the analysis and plan routes: switch, validation, hourly limit, moderation, error reasons.
const aiRoute = (validate, run) => async (req, res) => {
  if (!config.IKIGAI_AI_ENABLED) {
    res.status(403).json({ code: 'disabled', error: 'AI 分析未開啟（IKIGAI_AI_ENABLED=false）' });
    return;
  }
  let input;
  try {
    input = validate(req.body);
  } catch (err) {
    if (!(err instanceof IkigaiInputError)) throw err;
    res.status(400).json({ code: 'invalid_input', error: err.message });
    return;
  }
  // Checked after validation so incomplete forms do not use up the hourly allowance.
  if (isRateLimited(getClientIp(req))) {
    res.status(429).json({ code: 'too_many_requests', error: `分析次數太多（每小時上限 ${config.IKIGAI_RATE_LIMIT} 次），請一小時後再試` });
    return;
  }
  let stage = 'moderation';
  try {
    const text = IKIGAI_CIRCLES
      .flatMap(({ key }) => input[key])
      .concat(input.note || [], input.direction || [])
      .join('\n');
    if (await moderateContent({ text })) {
      res.status(400).json({ code: 'flagged', error: '內容未通過安全檢查，請修改後再試' });
      return;
    }
    stage = 'completion';
    res.json(await run(input));
  } catch (err) {
    const reason = describeIkigaiError(err);
    if (stage === 'moderation') {
      // Model-specific reasons name the chat model, which is not the one moderation uses.
      const shared = ['timeout', 'network', 'invalid_api_key', 'insufficient_quota'].includes(reason.code);
      const status = err.response?.status ? `（狀態碼 ${err.response.status}）` : '';
      reason.error = `安全檢查失敗：${shared ? reason.error : `OpenAI moderation 回傳錯誤${status}`}。可先把 OPENAI_MODERATION_ENABLED 設為 false`;
    }
    console.error(`[ikigai] ${req.path} ${stage} ${reason.code}: ${err.response?.status || err.code || ''} ${err.message}`);
    res.status(502).json(reason);
  }
};

router.post('/analyze', aiRoute(normalizeIkigai, async (input) => {
  const { text } = await analyzeIkigai(input);
  return { text };
}));

router.post('/plan', aiRoute(normalizePlanInput, (input) => planIkigai(input)));

export {
  isRateLimited,
  resetRateLimit,
};

export default router;
