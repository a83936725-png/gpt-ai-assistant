import { createHmac, timingSafeEqual } from 'crypto';
import express from 'express';
import config from '../config/index.js';
import { fetchMe, isTokenError } from '../services/instagram.js';
import {
  checkRules, getRules, handleWebhook,
} from './autoreply.js';
import { canNotify, notify } from './notify.js';
import { dataDeletionPage, privacyPage, statusPage } from './pages.js';
import { getTokenInfo, refreshToken } from './token.js';

// Routes, all under /instagram:
//   GET/POST /webhook        the Callback URL to paste in Meta (GET answers Meta's verification)
//   GET      /privacy        privacy policy URL for the app's basic settings
//   GET      /data-deletion  data deletion instructions URL for the app's basic settings
//   GET      /status?key=…   a setup checklist (key = INSTAGRAM_VERIFY_TOKEN)
//   GET      /cron           daily token refresh and LINE report (called by Vercel Cron)

const router = express.Router();

const publicUrl = (req, path) => {
  const protocol = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return `${protocol}://${req.get('host')}${req.baseUrl}${path}`;
};

const sameSecret = (a, b) => {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
};

// Meta signs every delivery with the Instagram app secret (X-Hub-Signature-256: sha256=<hex>).
const isSignedByMeta = (req) => {
  const header = req.get('x-hub-signature-256') || '';
  if (!config.INSTAGRAM_APP_SECRET || !header.startsWith('sha256=') || typeof req.rawBody !== 'string') return false;
  const expected = createHmac('sha256', config.INSTAGRAM_APP_SECRET).update(req.rawBody).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
};

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && config.INSTAGRAM_VERIFY_TOKEN && sameSecret(token, config.INSTAGRAM_VERIFY_TOKEN)) {
    res.status(200).type('text/plain').send(String(challenge ?? ''));
    return;
  }
  res.sendStatus(403);
});

router.post('/webhook', async (req, res) => {
  if (!isSignedByMeta(req)) {
    res.sendStatus(403);
    return;
  }
  const results = await handleWebhook(req.body);
  if (config.APP_DEBUG) console.info('[instagram]', JSON.stringify(results));
  res.sendStatus(200);
});

router.get('/privacy', (req, res) => {
  res.type('html').send(privacyPage());
});

router.get('/data-deletion', (req, res) => {
  res.type('html').send(dataDeletionPage());
});

const formatDate = (time) => (time ? new Date(time).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) : null);
const daysLeft = (time) => (time ? Math.floor((time - Date.now()) / (24 * 60 * 60 * 1000)) : null);

const checkToken = async () => {
  try {
    const { data } = await fetchMe();
    return { ok: true, username: data.username };
  } catch (err) {
    return { ok: false, expired: isTokenError(err), message: err.message };
  }
};

router.get('/status', async (req, res) => {
  if (!config.INSTAGRAM_VERIFY_TOKEN || !sameSecret(req.query.key, config.INSTAGRAM_VERIFY_TOKEN)) {
    res.status(403).type('html').send(statusPage('IG 自動回覆狀態', [
      { ok: Boolean(config.INSTAGRAM_VERIFY_TOKEN), label: '請在網址後面加上 ?key=門鈴暗號③（INSTAGRAM_VERIFY_TOKEN）' },
    ]));
    return;
  }
  const { settings, rules } = getRules();
  const info = await getTokenInfo({ fresh: true });
  const token = info?.token ? await checkToken() : { ok: false, message: '還沒設定' };
  const problems = checkRules();
  const left = daysLeft(info?.expiresAt);
  const rows = [
    { ok: Boolean(config.INSTAGRAM_ACCESS_TOKEN), label: '① IG 權杖 INSTAGRAM_ACCESS_TOKEN', detail: config.INSTAGRAM_ACCESS_TOKEN ? '已設定' : '還沒設定' },
    { ok: token.ok, label: '① 權杖能不能用', detail: token.ok ? `可以，連到 @${token.username}${left !== null ? `，約 ${left} 天後到期（${formatDate(info.expiresAt)}，每週會自動延長）` : ''}` : token.message },
    { ok: Boolean(config.INSTAGRAM_APP_SECRET), label: '② IG 密鑰 INSTAGRAM_APP_SECRET', detail: config.INSTAGRAM_APP_SECRET ? '已設定' : '還沒設定：沒有它，所有 IG 通知都會被擋掉' },
    { ok: true, label: '③ 門鈴暗號 INSTAGRAM_VERIFY_TOKEN', detail: '已設定（你剛剛用它打開了這一頁）' },
    { ok: true, label: '⑤ Webhook 網址（貼到 Meta 的「回呼網址」）', detail: publicUrl(req, '/webhook') },
    { ok: true, label: '隱私政策網址', detail: publicUrl(req, '/privacy') },
    { ok: true, label: '資料刪除網址', detail: publicUrl(req, '/data-deletion') },
    { ok: settings.enabled, label: '總開關', detail: settings.enabled ? '開著' : '關著（instagram/rules.js 的 enabled）' },
    { ok: problems.length === 0, label: `規則 ${rules.length} 條`, detail: rules.map((r) => `${r.id}：${(r.keywords || []).join('、')}`).join(' ／ ') },
    { ok: true, label: '測試名單', detail: (settings.testUsernames || []).length ? `只有 ${settings.testUsernames.join('、')} 會觸發（測試中）` : '空的：所有人留言都會觸發' },
    {
      ok: canNotify(), optional: true, label: 'LINE 通知（選用）', detail: canNotify() ? `會通知 ${config.INSTAGRAM_NOTIFY_LINE_IDS.length} 個 LINE 帳號` : '沒設定 INSTAGRAM_NOTIFY_LINE_IDS，出問題時不會傳 LINE',
    },
    {
      ok: Boolean(config.INSTAGRAM_BLOB_TOKEN), optional: true, label: '權杖自動延長的保存位置（選用）', detail: config.INSTAGRAM_BLOB_TOKEN ? `已設定（目前用的是${info?.source === 'stored' ? '自動延長後' : 'Vercel 裡'}的權杖）` : '沒設定 Blob：每 50 天要手動換一次權杖',
    },
  ];
  const notes = [...problems];
  if (!token.ok && token.expired) notes.push('權杖失效了：到 Meta 開發者後台重新產生權杖，貼到 Vercel 的 INSTAGRAM_ACCESS_TOKEN 後重新部署。');
  if (left !== null && left < 10) notes.push(`權杖只剩 ${left} 天，請盡快換新的。`);
  res.type('html').send(statusPage('IG 自動回覆狀態', rows, notes));
});

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set.
const isCron = (req) => (config.CRON_SECRET
  ? sameSecret(req.get('authorization'), `Bearer ${config.CRON_SECRET}`)
  : /vercel-cron/i.test(req.get('user-agent') || ''));

router.get('/cron', async (req, res) => {
  if (!isCron(req)) {
    res.sendStatus(401);
    return;
  }
  if (!config.INSTAGRAM_ACCESS_TOKEN) {
    res.json({ skipped: 'not configured' });
    return;
  }
  const lines = [];
  let urgent = false;
  const token = await checkToken();
  if (!token.ok) {
    urgent = true;
    lines.push(token.expired
      ? '❌ 權杖（密碼①）失效了，自動回覆已經停止。請到 Meta 開發者後台重新產生權杖，貼到 Vercel 的 INSTAGRAM_ACCESS_TOKEN 後重新部署。'
      : `❌ 連不上 Instagram：${token.message}`);
  } else {
    lines.push(`✅ 權杖正常，連到 @${token.username}`);
    try {
      const result = await refreshToken();
      const left = daysLeft(result.expiresAt);
      if (result.refreshed && result.changed && !result.stored) {
        urgent = true;
        lines.push('⚠️ 權杖延長了，但沒有地方保存新的權杖。請設定 INSTAGRAM_BLOB_READ_WRITE_TOKEN，或在 50 天內手動換一次權杖。');
      } else if (result.refreshed) {
        lines.push(`🔄 權杖已自動延長${left !== null ? `，還有 ${left} 天` : ''}`);
      } else if (left !== null) {
        lines.push(`🔑 權杖還有 ${left} 天`);
      }
      if (left !== null && left < 10) urgent = true;
    } catch (err) {
      lines.push(`⚠️ 權杖延長失敗：${err.message}`);
      const info = await getTokenInfo();
      if (isTokenError(err) || (info?.expiresAt && daysLeft(info.expiresAt) < 10)) urgent = true;
    }
  }
  const problems = checkRules();
  if (problems.length) {
    urgent = true;
    lines.push(...problems.map((problem) => `⚠️ ${problem}`));
  }
  const { settings } = getRules();
  if (!settings.enabled) lines.push('⏸ 總開關是關的');
  if ((settings.testUsernames || []).length) lines.push(`🧪 測試模式：只有 ${settings.testUsernames.join('、')} 會觸發`);
  const report = `IG 自動回覆每日報告\n${lines.join('\n')}`;
  const notified = (urgent || config.INSTAGRAM_DAILY_REPORT) ? await notify(report) : false;
  res.json({ urgent, notified, report });
});

export default router;
