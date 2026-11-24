import express from 'express';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import config from '../config/index.js';
import adviseTrip, { describeTravelError, normalizeAdviceInput, TravelInputError } from '../utils/travel-advice.js';
import {
  loadTravelData, saveTravelData, sanitizeTravelData, TravelSyncError, verifyIdToken,
} from '../utils/travel-sync.js';
import {
  countPhotos, isJpeg, loadPhoto, PHOTO_ID, PHOTO_KINDS, PHOTO_MAX_COUNT, removePhoto, savePhoto,
} from '../utils/travel-photos.js';
import {
  closeGroup, createGroup, groupCheckin, GroupError, GROUP_ID, GROUP_MAX_BYTES, joinGroup, leaveGroup, readGroup,
} from '../utils/travel-groups.js';
import {
  CouponError, couponsEnabled, issueCoupon, redeemCoupon, verifyCoupon,
} from '../utils/travel-coupons.js';

// Resolved from the project root so it works on Vercel (see includeFiles in vercel.json), in Docker and in Jest.
const WEB_DIR = path.join(process.cwd(), 'web');
const WINDOW_MS = 60 * 60 * 1000;

// Only these files are served, so the router never reads arbitrary paths.
const FILES = {
  '': { file: 'travel.html', type: 'text/html; charset=utf-8', maxAge: 300 },
  'travel-app.js': { file: 'travel-app.js', type: 'application/javascript; charset=utf-8', maxAge: 300 },
  'travel-data.js': { file: 'travel-data.js', type: 'application/javascript; charset=utf-8', maxAge: 300 },
  'travel-geo.js': { file: 'travel-geo.js', type: 'application/javascript; charset=utf-8', maxAge: 3600 },
  'travel-map.js': { file: 'travel-map.js', type: 'application/javascript; charset=utf-8', maxAge: 300 },
  'travel-photo-db.js': { file: 'travel-photo-db.js', type: 'application/javascript; charset=utf-8', maxAge: 300 },
  'travel-studio.js': { file: 'travel-studio.js', type: 'application/javascript; charset=utf-8', maxAge: 300 },
  'travel-photos.json': { file: 'travel-photos.json', type: 'application/json; charset=utf-8', maxAge: 3600 },
  'travel-sights.json': { file: 'travel-sights.json', type: 'application/json; charset=utf-8', maxAge: 3600 },
  'manifest.webmanifest': { file: 'travel-manifest.webmanifest', type: 'application/manifest+json; charset=utf-8', maxAge: 3600 },
  // The service worker must not be cached, so a new version reaches installed apps at once.
  'sw.js': { file: 'travel-sw.js', type: 'application/javascript; charset=utf-8', maxAge: 0 },
  'vendor/d3.min.js': { file: 'vendor/d3.min.js', type: 'application/javascript; charset=utf-8', maxAge: 86400 },
  'vendor/topojson-client.min.js': { file: 'vendor/topojson-client.min.js', type: 'application/javascript; charset=utf-8', maxAge: 86400 },
  'vendor/Sortable.min.js': { file: 'vendor/Sortable.min.js', type: 'application/javascript; charset=utf-8', maxAge: 86400 },
  'vendor/countries-50m.json': { file: 'vendor/countries-50m.json', type: 'application/json; charset=utf-8', maxAge: 86400 },
  'vendor/countries-110m.json': { file: 'vendor/countries-110m.json', type: 'application/json; charset=utf-8', maxAge: 86400 },
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
// 分享回饋券: a few per IP a day, so a script cannot collect a pile of them.
const couponIssues = new Map();
const isCouponLimited = (ip, now = Date.now()) => {
  const recent = (couponIssues.get(ip) || []).filter((time) => now - time < 24 * WINDOW_MS);
  recent.push(now);
  couponIssues.set(ip, recent);
  if (couponIssues.size > 5000) couponIssues.delete(couponIssues.keys().next().value);
  return recent.length > 3;
};
const resetRateLimit = () => { hits.clear(); syncs.clear(); couponIssues.clear(); };

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

// Country flags (web/flags, from country-flag-icons, MIT). The name pattern is the allowlist.
router.get('/flags/:name', (req, res) => {
  const { name } = req.params;
  const file = /^[a-z]{2}\.svg$/.test(name) && path.join(WEB_DIR, 'flags', name);
  if (!file || !existsSync(file)) {
    res.sendStatus(404);
    return;
  }
  res.set('Content-Type', 'image/svg+xml');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.set('Cache-Control', 'public, max-age=2592000');
  res.send(readFileSync(file));
});

// Satellite imagery for the map (NASA Blue Marble, public domain; scripts/travel-earth.py).
router.get('/travel-earth/:name', (req, res) => {
  const { name } = req.params;
  if (!/^(earth|merc)-(2048|4096)\.webp$/.test(name)) {
    res.sendStatus(404);
    return;
  }
  res.set('Content-Type', 'image/webp');
  res.set('Cache-Control', 'public, max-age=2592000');
  res.send(readFileSync(path.join(WEB_DIR, 'travel-earth', name)));
});

router.get('/api/status', (req, res) => {
  res.json({
    ai: aiAvailable(), brand: config.TRAVEL_BRAND, esimUrl: config.TRAVEL_ESIM_URL, guideVideo: config.TRAVEL_GUIDE_VIDEO_URL, liff: config.TRAVEL_LIFF_ID, groups: true, coupons: couponsEnabled(),
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

// Photo backup: the page sends each photo as JPEG bytes, with its LINE ID token in a header.
const photoAccount = async (req, res) => {
  if (isSyncLimited(getClientIp(req))) {
    res.status(429).json({ code: 'too_many_requests', error: '上傳次數太多，請稍後再試' });
    return null;
  }
  try {
    return await verifyIdToken(req.get('x-line-token'));
  } catch (err) {
    if (err instanceof TravelSyncError) res.status(err.status).json({ code: 'unauthorized', error: err.message });
    else res.status(502).json({ code: 'photo_failed', error: '照片備份暫時失敗，稍後會再試' });
    return null;
  }
};
const photoParams = (req, res) => {
  const { id, kind = 'full' } = req.params;
  if (PHOTO_ID.test(id) && PHOTO_KINDS[kind]) return { id, kind };
  res.status(400).json({ code: 'invalid_photo', error: '照片編號不正確' });
  return null;
};
const photoFailed = (res, err) => {
  console.error(JSON.stringify({ type: 'travel_photo_error', message: err.message }));
  res.status(502).json({ code: 'photo_failed', error: '照片備份暫時失敗，稍後會再試' });
};

router.put('/api/photos/:id/:kind', express.raw({ type: 'image/jpeg', limit: '2mb' }), async (req, res) => {
  const p = photoParams(req, res);
  if (!p) return;
  const account = await photoAccount(req, res);
  if (!account) return;
  if (!isJpeg(req.body) || req.body.length > PHOTO_KINDS[p.kind]) {
    res.status(413).json({ code: 'invalid_photo', error: '只接受 JPEG 照片，而且不能太大' });
    return;
  }
  try {
    if (p.kind === 'full' && await countPhotos(account.sub) >= PHOTO_MAX_COUNT) {
      res.status(413).json({ code: 'too_many_photos', error: `雲端最多備份 ${PHOTO_MAX_COUNT} 張照片` });
      return;
    }
    await savePhoto(account.sub, p.id, p.kind, req.body);
    res.json({ ok: true });
  } catch (err) {
    photoFailed(res, err);
  }
});

router.get('/api/photos/:id/:kind', async (req, res) => {
  const p = photoParams(req, res);
  if (!p) return;
  const account = await photoAccount(req, res);
  if (!account) return;
  try {
    const buf = await loadPhoto(account.sub, p.id, p.kind);
    if (!buf) {
      res.status(404).json({ code: 'not_found', error: '雲端沒有這張照片' });
      return;
    }
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(buf);
  } catch (err) {
    photoFailed(res, err);
  }
});

router.delete('/api/photos/:id', async (req, res) => {
  const p = photoParams(req, res);
  if (!p) return;
  const account = await photoAccount(req, res);
  if (!account) return;
  try {
    await removePhoto(account.sub, p.id);
    res.json({ ok: true });
  } catch (err) {
    photoFailed(res, err);
  }
});

// 揪團: invitations friends open from a link, and the nicknames that signed up.
const groupRoute = (handler) => async (req, res) => {
  if (isSyncLimited(getClientIp(req))) {
    res.status(429).json({ code: 'too_many_requests', error: '操作太頻繁，請稍後再試' });
    return;
  }
  try {
    res.json(await handler(req));
  } catch (err) {
    if (err instanceof GroupError) {
      res.status(err.status).json({ code: 'group_error', error: err.message });
      return;
    }
    console.error(JSON.stringify({ type: 'travel_group_error', message: err.message }));
    res.status(502).json({ code: 'group_failed', error: '揪團暫時無法使用，請稍後再試' });
  }
};
const groupId = (req) => {
  if (!GROUP_ID.test(req.params.id)) throw new GroupError('找不到這個揪團', 404);
  return req.params.id;
};
router.post('/api/groups', groupRoute((req) => {
  if (Buffer.byteLength(JSON.stringify(req.body?.invite ?? {})) > GROUP_MAX_BYTES) throw new GroupError('揪團內容太長，請精簡行程', 413);
  return createGroup(req.body?.invite);
}));
router.get('/api/groups/:id', groupRoute((req) => readGroup(groupId(req))));
router.post('/api/groups/:id/join', groupRoute((req) => joinGroup(groupId(req), req.body || {})));
router.post('/api/groups/:id/leave', groupRoute((req) => leaveGroup(groupId(req), req.body?.who)));
router.post('/api/groups/:id/checkin', groupRoute((req) => groupCheckin(groupId(req), req.body || {})));
router.post('/api/groups/:id/close', groupRoute((req) => closeGroup(groupId(req), req.body?.key, req.body?.closed)));

// 分享回饋券: issued after a share, checked at checkout, and marked used with the order.
const couponRoute = (handler) => async (req, res) => {
  try {
    res.json(await handler(req));
  } catch (err) {
    if (err instanceof CouponError) {
      res.status(err.status).json({ code: 'coupon_error', error: err.message });
      return;
    }
    console.error(JSON.stringify({ type: 'travel_coupon_error', message: err.message }));
    res.status(502).json({ code: 'coupon_failed', error: '折扣券暫時無法使用，請稍後再試' });
  }
};
router.post('/api/coupons/issue', couponRoute((req) => {
  if (isCouponLimited(getClientIp(req))) throw new CouponError('今天領太多張了，明天再分享吧', 429);
  return issueCoupon();
}));
router.post('/api/coupons/verify', couponRoute((req) => verifyCoupon(req.body?.code)));
router.post('/api/coupons/redeem', couponRoute((req) => redeemCoupon(req.body?.code, req.body?.orderNo)));

export { isRateLimited, resetRateLimit };

export default router;
