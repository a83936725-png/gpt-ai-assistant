import express from 'express';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import config from '../config/index.js';
import adviseTrip, { describeTravelError, normalizeAdviceInput, TravelInputError } from '../utils/travel-advice.js';
import {
  loadTravelData, saveTravelData, sanitizeTravelData, TravelSyncError, verifyIdToken,
} from '../utils/travel-sync.js';

// Resolved from the project root so it works on Vercel (see includeFiles in vercel.json), in Docker and in Jest.
const WEB_DIR = path.join(process.cwd(), 'web');
const WINDOW_MS = 60 * 60 * 1000;

// Only these files are served, so the router never reads arbitrary paths.
const FILES = {
  '': { file: 'travel.html', type: 'text/html; charset=utf-8', maxAge: 300 },
  'travel-app.js': { file: 'travel-app.js', type: 'application/javascript; charset=utf-8', maxAge: 300 },
  'travel-data.js': { file: 'travel-data.js', type: 'application/javascript; charset=utf-8', maxAge: 300 },
  'travel-photos.json': { file: 'travel-photos.json', type: 'application/json; charset=utf-8', maxAge: 3600 },
  'manifest.webmanifest': { file: 'travel-manifest.webmanifest', type: 'application/manifest+json; charset=utf-8', maxAge: 3600 },
  // The service worker must not be cached, so a new version reaches installed apps at once.
  'sw.js': { file: 'travel-sw.js', type: 'application/javascript; charset=utf-8', maxAge: 0 },
  'vendor/d3.min.js': { file: 'vendor/d3.min.js', type: 'application/javascript; charset=utf-8', maxAge: 86400 },
  'vendor/topojson-client.min.js': { file: 'vendor/topojson-client.min.js', type: 'application/javascript; charset=utf-8', maxAge: 86400 },
  'vendor/Sortable.min.js': { file: 'vendor/Sortable.min.js', type: 'application/javascript; charset=utf-8', maxAge: 86400 },
  'vendor/countries-50m.json': { file: 'vendor/countries-50m.json', type: 'application/json; charset=utf-8', maxAge: 86400 },
};

const cache = new Map();
const read = (file) => {
  if (!cache.has(file) || config.APP_ENV !== 'production') cache.set(file, readFileSync(path.join(WEB_DIR, file)));
  return cache.get(file);
};

// Best-effort limit per client IP. Serverless instances do not share memory, so this only slows down abuse.
const hits = new Map();
const isRateLimited = (ip, now = Date.now()) => {
  const recent = (hits.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= config.TRAVEL_RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
  return false;
};
// Syncing happens as people use the page, so it gets a separate, larger allowance.
const syncs = new Map();
const isSyncLimited = (ip, now = Date.now()) => {
  const recent = (syncs.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  recent.push(now);
  syncs.set(ip, recent);
  if (syncs.size > 5000) syncs.delete(syncs.keys().next().value);
  return recent.length > 600;
};
const resetRateLimit = () => { hits.clear(); syncs.clear(); };

const getClientIp = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
const aiAvailable = () => config.TRAVEL_AI_ENABLED && Boolean(config.OPENAI_COMPLETION_API_KEY || config.APP_ENV !== 'production');

const router = express.Router();

router.use((req, res, next) => {
  if (!config.TRAVEL_ENABLED) {
    res.sendStatus(404);
    return;
  }
  next();
});

const sendFile = (key) => (req, res) => {
  const entry = FILES[key];
  res.set('Content-Type', entry.type);
  res.set('Cache-Control', `public, max-age=${entry.maxAge}`);
  res.send(read(entry.file));
};

// The page loads its scripts with relative paths, so it must be served from /travel/.
router.get('/', (req, res, next) => {
  const [pathname, query] = req.originalUrl.split('?');
  if (!pathname.endsWith('/')) {
    res.redirect(301, `${pathname}/${query ? `?${query}` : ''}`);
    return;
  }
  next();
}, sendFile(''));

Object.keys(FILES).filter(Boolean).forEach((key) => router.get(`/${key}`, sendFile(key)));

// App icons (home screen, manifest).
router.get('/travel-icons/:name', (req, res) => {
  const { name } = req.params;
  if (!/^(icon-192|icon-512|maskable-512|apple-touch-icon)\.png$/.test(name)) {
    res.sendStatus(404);
    return;
  }
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=604800');
  res.send(readFileSync(path.join(WEB_DIR, 'travel-icons', name)));
});

// Local copies of the attraction photos (scripts/travel-photos-download.js). Names are hashes, so the
// pattern below is the whole allowlist.
router.get('/travel-photos/:name', (req, res) => {
  const { name } = req.params;
  const match = /^[a-f0-9]{12}\.(webp|jpg)$/.exec(name);
  const file = match && path.join(WEB_DIR, 'travel-photos', name);
  if (!file || !existsSync(file)) {
    res.sendStatus(404);
    return;
  }
  res.set('Content-Type', match[1] === 'webp' ? 'image/webp' : 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.send(readFileSync(file));
});

router.get('/api/status', (req, res) => {
  res.json({
    ai: aiAvailable(), brand: config.TRAVEL_BRAND, esimUrl: config.TRAVEL_ESIM_URL, guideVideo: config.TRAVEL_GUIDE_VIDEO_URL, liff: config.TRAVEL_LIFF_ID,
  });
});

router.post('/api/advise', async (req, res) => {
  if (!config.TRAVEL_AI_ENABLED) {
    res.status(403).json({ code: 'disabled', error: 'AI 行程建議未開啟（TRAVEL_AI_ENABLED=false）' });
    return;
  }
  try {
    // Validate first so incomplete requests do not use up the hourly allowance.
    normalizeAdviceInput(req.body);
    if (isRateLimited(getClientIp(req))) {
      res.status(429).json({ code: 'too_many_requests', error: `行程建議次數太多（每小時上限 ${config.TRAVEL_RATE_LIMIT} 次），請一小時後再試` });
      return;
    }
    const result = await adviseTrip(req.body);
    res.json({ text: result.text });
  } catch (err) {
    if (err instanceof TravelInputError) {
      res.status(400).json({ code: 'invalid_input', error: err.message });
      return;
    }
    const reason = describeTravelError(err);
    console.error(JSON.stringify({ type: 'travel_advise_error', code: reason.code, message: err.message }));
    res.status(502).json(reason);
  }
});

// LINE login + cloud sync: the page sends its LIFF ID token with every call.
const syncRoute = (handler) => async (req, res) => {
  if (isSyncLimited(getClientIp(req))) {
    res.status(429).json({ code: 'too_many_requests', error: '同步次數太多，請稍後再試' });
    return;
  }
  try {
    const account = await verifyIdToken(req.body?.idToken);
    res.json(await handler(account, req.body));
  } catch (err) {
    if (err instanceof TravelSyncError) {
      res.status(err.status).json({ code: err.status === 401 ? 'unauthorized' : 'invalid_data', error: err.message });
      return;
    }
    console.error(JSON.stringify({ type: 'travel_sync_error', message: err.message }));
    res.status(502).json({ code: 'sync_failed', error: '同步失敗，資料先保留在這支手機，稍後會再試' });
  }
};

router.post('/api/sync/pull', syncRoute(async (account) => ({ name: account.name, data: await loadTravelData(account.sub) })));
router.post('/api/sync/push', syncRoute(async (account, body) => {
  const saved = await saveTravelData(account.sub, sanitizeTravelData(body.data));
  return { ok: true, savedAt: saved.savedAt };
}));

export { isRateLimited, resetRateLimit };

export default router;
