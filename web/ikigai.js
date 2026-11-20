import express from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import config from '../config/index.js';
import analyzeIkigai, { IkigaiInputError, IKIGAI_CIRCLES } from '../utils/analyze-ikigai.js';
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

router.post('/analyze', async (req, res) => {
  if (!config.IKIGAI_AI_ENABLED) {
    res.status(403).json({ error: 'AI 分析未開啟' });
    return;
  }
  if (isRateLimited(getClientIp(req))) {
    res.status(429).json({ error: '分析次數太多，請一小時後再試' });
    return;
  }
  try {
    const text = IKIGAI_CIRCLES
      .flatMap(({ key }) => (Array.isArray(req.body?.[key]) ? req.body[key] : []))
      .concat(req.body?.note || [])
      .filter((item) => typeof item === 'string')
      .join('\n')
      .slice(0, 4000);
    if (await moderateContent({ text })) {
      res.status(400).json({ error: '內容未通過安全檢查，請修改後再試' });
      return;
    }
    const { text: result } = await analyzeIkigai(req.body);
    res.json({ text: result });
  } catch (err) {
    if (err instanceof IkigaiInputError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err.message);
    res.status(500).json({ error: 'AI 分析失敗，請稍後再試' });
  }
});

export {
  isRateLimited,
  resetRateLimit,
};

export default router;
