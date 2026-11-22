import crypto from 'crypto';
import express from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import config from '../config/index.js';
import analyzeIkigai, {
  describeIkigaiError, IkigaiInputError, IKIGAI_CIRCLES, normalizeIkigai, normalizePlanInput, planIkigai,
} from '../utils/analyze-ikigai.js';
import moderateContent from '../utils/moderate-content.js';
import {
  countReferrals, deleteRecord, getMailStatus, getRecord, listMailed, listRecords, sanitizeRecord, saveRecord,
  setMailStatus, summarize, toCsv,
} from '../utils/ikigai-records.js';
import { mailConfigured, sendMail } from '../utils/ikigai-mailer.js';
import buildReport from '../utils/ikigai-report.js';

// Resolved from the project root so it works on Vercel (see includeFiles in vercel.json), in Docker and in Jest.
const PAGE_PATH = path.join(process.cwd(), 'web', 'ikigai.html');
const ADMIN_PATH = path.join(process.cwd(), 'web', 'ikigai-admin.html');
const QR_PATH = path.join(process.cwd(), 'web', 'vendor', 'qrcode.js');
const WINDOW_MS = 60 * 60 * 1000;

let page;
const getPage = () => {
  if (!page || config.APP_ENV !== 'production') page = readFileSync(PAGE_PATH, 'utf8');
  return page;
};
let adminPage;
const getAdminPage = () => {
  if (!adminPage || config.APP_ENV !== 'production') adminPage = readFileSync(ADMIN_PATH, 'utf8');
  return adminPage;
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

// Saves happen as the visitor works, so they get a separate, larger allowance.
const saves = new Map();
const isSaveLimited = (ip, now = Date.now()) => {
  const recent = (saves.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  recent.push(now);
  saves.set(ip, recent);
  if (saves.size > 5000) saves.delete(saves.keys().next().value);
  return recent.length > 400;
};

const resetRateLimit = () => {
  hits.clear();
  saves.clear();
};

const getClientIp = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const router = express.Router();

router.use((req, res, next) => {
  if (!config.IKIGAI_ENABLED) {
    res.sendStatus(404);
    return;
  }
  next();
});

const sendPage = (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(getPage());
};

router.get('/', sendPage);

/**
 * Lets the site root show the IKIGAI page to people opening it in a browser,
 * so the address can be just the domain. Other clients keep the JSON status.
 */
const servesHome = (req) => config.IKIGAI_ENABLED && !config.APP_URL && req.accepts(['json', 'html']) === 'html';

// QR code generator (MIT, Kazuhiko Arase) used by the share cards.
let qrScript;
router.get('/qrcode.js', (req, res) => {
  if (!qrScript) qrScript = readFileSync(QR_PATH, 'utf8');
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(qrScript);
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

// ---------- client records ----------

router.post('/records', async (req, res) => {
  if (isSaveLimited(getClientIp(req))) {
    res.status(429).json({ code: 'too_many_requests' });
    return;
  }
  let record;
  try {
    record = sanitizeRecord(req.body, {
      country: req.get('x-vercel-ip-country') || '',
      city: decodeURIComponent(req.get('x-vercel-ip-city') || ''),
      userAgent: req.get('user-agent') || '',
    });
  } catch (err) {
    if (!(err instanceof IkigaiInputError)) throw err;
    res.status(400).json({ code: 'invalid_input', error: err.message });
    return;
  }
  try {
    await saveRecord(record);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ikigai] save record: ${err.message}`);
    res.status(502).json({ code: 'storage_error' });
  }
});

// How many friends a client has brought, for the invite progress bar on the page.
router.get('/referrals/:rid', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (isSaveLimited(getClientIp(req))) {
    res.status(429).json({ code: 'too_many_requests' });
    return;
  }
  try {
    const count = await countReferrals(req.params.rid);
    res.json({ count, goal: config.IKIGAI_REFERRAL_GOAL, reward: config.IKIGAI_REFERRAL_REWARD });
  } catch (err) {
    console.error(`[ikigai] referrals: ${err.message}`);
    res.status(502).json({ code: 'storage_error' });
  }
});

// ---------- report email ----------

const MAIL_GAP_MS = 10 * 60 * 1000;
const mails = new Map();
const isMailLimited = (ip, now = Date.now()) => {
  const recent = (mails.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  recent.push(now);
  mails.set(ip, recent);
  return recent.length > 10;
};
const siteUrlOf = (req) => {
  if (config.IKIGAI_SITE_URL) return config.IKIGAI_SITE_URL.replace(/\/+$/, '');
  const proto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
};

router.get('/mail-status', (req, res) => {
  res.json({ enabled: mailConfigured() });
});

// Emails the full report to the address the visitor saved. The content comes only from their stored record.
router.post('/report-email', async (req, res) => {
  if (!mailConfigured()) {
    res.status(503).json({ code: 'mail_disabled', error: '目前還不能寄送報告' });
    return;
  }
  if (isMailLimited(getClientIp(req))) {
    res.status(429).json({ code: 'too_many_requests', error: '寄送次數太多，請稍後再試' });
    return;
  }
  try {
    const record = await getRecord(req.body?.id);
    if (!record || !record.profile.email) {
      res.status(404).json({ code: 'not_found', error: '找不到你的資料，請先留下 Email' });
      return;
    }
    const status = await getMailStatus(record.id);
    if (status && Date.now() - status.lastSentAt < MAIL_GAP_MS) {
      res.status(429).json({ code: 'recently_sent', error: '報告剛寄出，10 分鐘後才能再寄一次' });
      return;
    }
    const { subject, html, text } = buildReport(record, { siteUrl: siteUrlOf(req) });
    await sendMail({
      to: record.profile.email, subject, html, text,
    });
    await setMailStatus(record.id, { to: record.profile.email, lastSentAt: Date.now(), count: (status?.count || 0) + 1 });
    res.json({ ok: true, to: record.profile.email });
  } catch (err) {
    console.error(`[ikigai] report email: ${err.response?.status || err.code || ''} ${err.message}`);
    res.status(502).json({ code: 'mail_error', error: '報告寄送失敗，請稍後再試' });
  }
});

// ---------- admin ----------

const sameSecret = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

router.get('/admin', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  res.send(getAdminPage());
});

const requireAdmin = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!config.IKIGAI_ADMIN_PASSWORD) {
    res.status(503).json({ code: 'admin_disabled', error: '後台尚未設定密碼（IKIGAI_ADMIN_PASSWORD）' });
    return;
  }
  if (!sameSecret(req.get('x-admin-password') || '', config.IKIGAI_ADMIN_PASSWORD)) {
    res.status(401).json({ code: 'unauthorized', error: '密碼不正確' });
    return;
  }
  next();
};

const adminRoute = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(`[ikigai] admin ${req.path}: ${err.message}`);
    res.status(502).json({ code: 'storage_error', error: '讀取資料失敗，請稍後再試' });
  }
};

router.get('/admin/api/records', requireAdmin, adminRoute(async (req, res) => {
  const [records, mailed] = await Promise.all([listRecords(), listMailed()]);
  const names = new Map(records.map((r) => [r.id, r.profile.name]));
  const referrals = new Map();
  records.forEach((r) => { if (r.referredBy) referrals.set(r.referredBy, (referrals.get(r.referredBy) || 0) + 1); });
  res.json({
    storage: config.IKIGAI_BLOB_TOKEN ? 'blob' : 'memory',
    mail: mailConfigured(),
    records: records.map((r) => ({
      ...summarize(r), referrals: referrals.get(r.id) || 0, referrerName: names.get(r.referredBy) || '', mailedAt: mailed.get(r.id) || null,
    })),
  });
}));

router.get('/admin/api/records/:id', requireAdmin, adminRoute(async (req, res) => {
  const record = await getRecord(req.params.id);
  if (!record) {
    res.status(404).json({ code: 'not_found', error: '找不到這筆資料' });
    return;
  }
  const [referrer, mail] = await Promise.all([
    record.referredBy ? getRecord(record.referredBy).catch(() => null) : null,
    getMailStatus(record.id).catch(() => null),
  ]);
  res.json({ record, mail, summary: { ...summarize(record), referrerName: referrer ? referrer.profile.name : '' } });
}));

router.delete('/admin/api/records/:id', requireAdmin, adminRoute(async (req, res) => {
  await deleteRecord(req.params.id);
  res.json({ ok: true });
}));

router.get('/admin/api/export.csv', requireAdmin, adminRoute(async (req, res) => {
  const records = await listRecords();
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="ikigai-clients-${new Date().toISOString().slice(0, 10)}.csv"`);
  const referrals = new Map();
  records.forEach((r) => { if (r.referredBy) referrals.set(r.referredBy, (referrals.get(r.referredBy) || 0) + 1); });
  const names = new Map(records.map((r) => [r.id, r.profile.name]));
  res.send(toCsv(records, { referrals, names }));
}));

export {
  sendPage,
  servesHome,
  isRateLimited,
  resetRateLimit,
};

export default router;
