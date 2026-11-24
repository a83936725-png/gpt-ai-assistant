import {
  createHmac, randomBytes, timingSafeEqual,
} from 'crypto';
import express from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import config from '../config/index.js';
import {
  exchangeCode, exchangeLongLivedToken, fetchMe, isTokenError, WEBHOOK_FIELDS,
} from '../services/instagram.js';
import {
  addAccount, describe, fetchSubscription, loadAccounts, refreshAccount, removeAccount, requireAccount, setPaused, subscribe,
} from './accounts.js';
import { forAccount, handleWebhook } from './autoreply.js';
import { canNotify, notify } from './notify.js';
import { dataDeletionPage, privacyPage, statusPage } from './pages.js';
import { checkRules, loadRules, saveRules } from './rules-store.js';
import { canSave } from './store.js';

// Routes, all under /instagram:
//   GET/POST /webhook          the Callback URL to paste in Meta (GET answers Meta's verification)
//   GET      /privacy          privacy policy URL for the app's basic settings
//   GET      /data-deletion    data deletion instructions URL for the app's basic settings
//   GET      /admin            the admin page: accounts, rules, settings (INSTAGRAM_ADMIN_PASSWORD)
//   GET      /oauth/callback   where "log in with Instagram" comes back to
//   GET      /status?key=…     a read-only checklist (key = INSTAGRAM_VERIFY_TOKEN)
//   GET      /cron             daily token check and refresh, LINE report (called by Vercel Cron)

const router = express.Router();
const ADMIN_PATH = path.join(process.cwd(), 'web', 'instagram-admin.html');
const DAY_MS = 24 * 60 * 60 * 1000;
const STATE_MS = 15 * 60 * 1000;
const SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments'];

let adminPage;
const getAdminPage = () => {
  if (!adminPage || config.APP_ENV !== 'production') adminPage = readFileSync(ADMIN_PATH, 'utf8');
  return adminPage;
};

const publicUrl = (req, suffix) => {
  const protocol = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return `${protocol}://${req.get('host')}${req.baseUrl}${suffix}`;
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
const daysLeft = (time) => (time ? Math.floor((time - Date.now()) / DAY_MS) : null);

// Asks Instagram, for one account, whether its token works and which webhooks it gets.
const checkAccount = async (account) => {
  if (account.error) return { ok: false, expired: account.errorCode === 190, message: account.error };
  try {
    const { data } = await fetchMe({ token: account.token });
    let subscribed = null;
    try {
      subscribed = await fetchSubscription(account);
    } catch (err) {
      subscribed = null;
    }
    return { ok: true, username: data.username, subscribed };
  } catch (err) {
    return { ok: false, expired: isTokenError(err), message: err.message };
  }
};

const missingFields = (subscribed) => (Array.isArray(subscribed) ? WEBHOOK_FIELDS.filter((field) => !subscribed.includes(field)) : []);

// Rules naming an account that is not connected never fire: say so.
const accountProblems = (rules, accounts) => rules
  .filter((rule) => String(rule.account ?? '').trim())
  .filter((rule) => !accounts.some((account) => forAccount(rule, account)))
  .map((rule) => `規則（${rule.id}）指定的帳號 @${String(rule.account).replace(/^@/, '')} 還沒連結，這條規則不會觸發`);

const accountName = (account, check = {}) => {
  const username = check.username || account.username;
  if (username) return `@${username}`;
  return account.envKey ? `Vercel 的 ${account.envKey}` : '未知帳號';
};

router.get('/status', async (req, res) => {
  if (!config.INSTAGRAM_VERIFY_TOKEN || !sameSecret(req.query.key, config.INSTAGRAM_VERIFY_TOKEN)) {
    res.status(403).type('html').send(statusPage('IG 自動回覆狀態', [
      { ok: Boolean(config.INSTAGRAM_VERIFY_TOKEN), label: '請在網址後面加上 ?key=門鈴暗號③（INSTAGRAM_VERIFY_TOKEN）' },
    ]));
    return;
  }
  const { settings, rules, source } = await loadRules({ fresh: true });
  const accounts = await loadAccounts({ fresh: true });
  const checks = await Promise.all(accounts.map(checkAccount));
  const problems = [...checkRules({ rules }), ...accountProblems(rules, accounts)];
  const notes = [...problems];
  const rows = [
    { ok: accounts.length > 0, label: `連結的 IG 帳號：${accounts.length} 個`, detail: accounts.length ? '' : '到後台用 Instagram 登入，或在 Vercel 設定 INSTAGRAM_ACCESS_TOKEN' },
    ...accounts.map((account, index) => {
      const check = checks[index];
      const name = accountName(account, check);
      const left = daysLeft(account.expiresAt);
      const missing = missingFields(check.subscribed);
      if (!check.ok && check.expired) notes.push(`${name} 的權杖失效了：到後台重新用 Instagram 登入，或重新產生權杖。`);
      if (check.ok && missing.length) notes.push(`${name} 沒有訂閱 ${missing.join('、')} 通知：到後台按「重新訂閱通知」。`);
      if (left !== null && left < 10) notes.push(`${name} 的權杖只剩 ${left} 天。`);
      const parts = [
        check.ok ? '權杖正常' : `權杖有問題：${check.message}`,
        account.paused ? '已暫停' : null,
        left !== null ? `約 ${left} 天後到期（${formatDate(account.expiresAt)}，每週自動延長）` : null,
        account.source === 'env' ? `來自 Vercel 的 ${account.envKey}` : '在後台連結',
      ].filter(Boolean);
      return { ok: check.ok && !missing.length, label: name, detail: parts.join('，') };
    }),
    { ok: Boolean(config.INSTAGRAM_APP_SECRET), label: '② IG 密鑰 INSTAGRAM_APP_SECRET', detail: config.INSTAGRAM_APP_SECRET ? '已設定' : '還沒設定：沒有它，所有 IG 通知都會被擋掉' },
    { ok: true, label: '③ 門鈴暗號 INSTAGRAM_VERIFY_TOKEN', detail: '已設定（你剛剛用它打開了這一頁）' },
    { ok: true, label: '⑤ Webhook 網址（貼到 Meta 的「回呼網址」）', detail: publicUrl(req, '/webhook') },
    { ok: true, label: '隱私政策網址', detail: publicUrl(req, '/privacy') },
    { ok: true, label: '資料刪除網址', detail: publicUrl(req, '/data-deletion') },
    { ok: settings.enabled, label: '總開關', detail: settings.enabled ? '開著' : '關著' },
    { ok: problems.length === 0, label: `規則 ${rules.length} 條（${source === 'admin' ? '後台設定' : 'instagram/rules.js'}）`, detail: rules.map((r) => `${r.id}${r.account ? `（@${r.account}）` : ''}：${(r.keywords || []).join('、')}`).join(' ／ ') },
    { ok: true, label: '測試名單', detail: (settings.testUsernames || []).length ? `只有 ${settings.testUsernames.join('、')} 會觸發（測試中）` : '空的：所有人留言都會觸發' },
    {
      ok: Boolean(config.INSTAGRAM_ADMIN_PASSWORD), optional: true, label: '後台（選用）', detail: config.INSTAGRAM_ADMIN_PASSWORD ? publicUrl(req, '/admin') : '沒設定 INSTAGRAM_ADMIN_PASSWORD，後台打不開',
    },
    {
      ok: canNotify(), optional: true, label: 'LINE 通知（選用）', detail: canNotify() ? `會通知 ${config.INSTAGRAM_NOTIFY_LINE_IDS.length} 個 LINE 帳號` : '沒設定 INSTAGRAM_NOTIFY_LINE_IDS，出問題時不會傳 LINE',
    },
    {
      ok: canSave(), optional: true, label: '私人儲存空間（選用）', detail: canSave() ? '已設定：後台的修改和延長後的權杖都存得起來' : '沒設定 Blob：後台不能修改，權杖每 50 天要手動換',
    },
  ];
  res.type('html').send(statusPage('IG 自動回覆狀態', rows, notes));
});

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set.
const isCron = (req) => (config.CRON_SECRET
  ? sameSecret(req.get('authorization'), `Bearer ${config.CRON_SECRET}`)
  : /vercel-cron/i.test(req.get('user-agent') || ''));

const cronAccount = async (account) => {
  const lines = [];
  let urgent = false;
  const check = await checkAccount(account);
  const name = accountName(account, check);
  if (!check.ok) {
    lines.push(check.expired
      ? `❌ ${name}：權杖失效了，這個帳號停止自動回覆。請到後台重新用 Instagram 登入，或重新產生權杖。`
      : `❌ ${name}：連不上 Instagram：${check.message}`);
    return { lines, urgent: true };
  }
  const missing = missingFields(check.subscribed);
  if (missing.length) {
    urgent = true;
    lines.push(`⚠️ ${name}：沒有訂閱 ${missing.join('、')} 通知，請到後台按「重新訂閱通知」`);
  }
  try {
    const result = await refreshAccount(account);
    const left = daysLeft(result.expiresAt);
    if (result.refreshed && result.changed && !result.stored) {
      urgent = true;
      lines.push(`⚠️ ${name}：權杖延長了，但沒有地方保存。請設定 INSTAGRAM_BLOB_READ_WRITE_TOKEN，或在 50 天內手動換權杖。`);
    } else {
      lines.push(`✅ ${name}${account.paused ? '（暫停中）' : ''}：正常${left !== null ? `，權杖還有 ${left} 天${result.refreshed ? '（剛自動延長）' : ''}` : ''}`);
    }
    if (left !== null && left < 10) urgent = true;
  } catch (err) {
    lines.push(`⚠️ ${name}：權杖延長失敗：${err.message}`);
    if (isTokenError(err) || (account.expiresAt && daysLeft(account.expiresAt) < 10)) urgent = true;
  }
  return { lines, urgent };
};

router.get('/cron', async (req, res) => {
  if (!isCron(req)) {
    res.sendStatus(401);
    return;
  }
  const accounts = await loadAccounts({ fresh: true });
  if (!accounts.length) {
    res.json({ skipped: 'no accounts' });
    return;
  }
  const results = await Promise.all(accounts.map(cronAccount));
  const lines = results.flatMap((r) => r.lines);
  let urgent = results.some((r) => r.urgent);
  const { settings, rules } = await loadRules({ fresh: true });
  const problems = [...checkRules({ rules }), ...accountProblems(rules, accounts)];
  if (problems.length) {
    urgent = true;
    lines.push(...problems.map((problem) => `⚠️ ${problem}`));
  }
  if (!settings.enabled) lines.push('⏸ 總開關是關的');
  if ((settings.testUsernames || []).length) lines.push(`🧪 測試模式：只有 ${settings.testUsernames.join('、')} 會觸發`);
  const report = `IG 自動回覆每日報告（${accounts.length} 個帳號）\n${lines.join('\n')}`;
  const notified = (urgent || config.INSTAGRAM_DAILY_REPORT) ? await notify(report) : false;
  res.json({ urgent, notified, report });
});

// --- Admin page ---------------------------------------------------------------------------

router.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.type('html').send(getAdminPage());
});

const requireAdmin = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!config.INSTAGRAM_ADMIN_PASSWORD) {
    res.status(503).json({ code: 'admin_disabled', error: '後台還沒設定密碼：請在 Vercel 加上 INSTAGRAM_ADMIN_PASSWORD 後重新部署' });
    return;
  }
  if (!sameSecret(req.get('x-admin-password') || '', config.INSTAGRAM_ADMIN_PASSWORD)) {
    res.status(401).json({ code: 'unauthorized', error: '密碼不對' });
    return;
  }
  next();
};

const adminRoute = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error(`[instagram] admin: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
};

const adminState = async (req) => {
  const [accounts, {
    settings, rules, source, updatedAt,
  }] = await Promise.all([loadAccounts({ fresh: true }), loadRules({ fresh: true })]);
  const checks = await Promise.all(accounts.map(checkAccount));
  return {
    canSave: canSave(),
    loginReady: Boolean(config.INSTAGRAM_APP_ID && config.INSTAGRAM_APP_SECRET),
    appSecretSet: Boolean(config.INSTAGRAM_APP_SECRET),
    verifyTokenSet: Boolean(config.INSTAGRAM_VERIFY_TOKEN),
    notify: { enabled: canNotify(), count: config.INSTAGRAM_NOTIFY_LINE_IDS.length, daily: config.INSTAGRAM_DAILY_REPORT },
    urls: {
      webhook: publicUrl(req, '/webhook'),
      privacy: publicUrl(req, '/privacy'),
      deletion: publicUrl(req, '/data-deletion'),
      redirect: publicUrl(req, '/oauth/callback'),
    },
    webhookFields: WEBHOOK_FIELDS,
    accounts: accounts.map((account, index) => ({
      ...describe(account),
      username: checks[index].username || account.username,
      ok: checks[index].ok,
      expired: Boolean(checks[index].expired),
      message: checks[index].message || null,
      subscribed: checks[index].subscribed,
      missing: missingFields(checks[index].subscribed),
    })),
    settings,
    rules,
    rulesSource: source,
    rulesUpdatedAt: updatedAt || null,
    problems: [...checkRules({ rules }), ...accountProblems(rules, accounts)],
  };
};

router.get('/admin/api/state', requireAdmin, adminRoute(async (req, res) => {
  res.json(await adminState(req));
}));

router.put('/admin/api/rules', requireAdmin, adminRoute(async (req, res) => {
  const saved = await saveRules(req.body || {});
  res.json({ ok: true, problems: saved.problems, updatedAt: saved.updatedAt });
}));

router.post('/admin/api/accounts', requireAdmin, adminRoute(async (req, res) => {
  const result = await addAccount({ token: req.body?.token, source: 'paste' });
  res.json({
    ok: true, username: result.account.username, subscribed: result.subscribed, subscribeError: result.subscribeError,
  });
}));

router.post('/admin/api/accounts/:id/pause', requireAdmin, adminRoute(async (req, res) => {
  await setPaused(req.params.id, Boolean(req.body?.paused));
  res.json({ ok: true });
}));

router.post('/admin/api/accounts/:id/subscribe', requireAdmin, adminRoute(async (req, res) => {
  const account = await requireAccount(req.params.id);
  await subscribe(account);
  res.json({ ok: true, fields: await fetchSubscription(account).catch(() => WEBHOOK_FIELDS) });
}));

router.post('/admin/api/accounts/:id/refresh', requireAdmin, adminRoute(async (req, res) => {
  const account = await requireAccount(req.params.id);
  const result = await refreshAccount(account, { force: true });
  res.json({ ok: true, expiresAt: result.expiresAt, stored: result.stored });
}));

router.delete('/admin/api/accounts/:id', requireAdmin, adminRoute(async (req, res) => {
  await removeAccount(req.params.id);
  res.json({ ok: true });
}));

// --- Log in with Instagram (Business Login) ---------------------------------------------------

const sign = (value) => createHmac('sha256', `${config.INSTAGRAM_APP_SECRET}:login`).update(value).digest('base64url');

const makeState = (now = Date.now()) => {
  const value = `${now}.${randomBytes(9).toString('base64url')}`;
  return `${value}.${sign(value)}`;
};

const checkState = (state, now = Date.now()) => {
  const [time, nonce, signature] = String(state ?? '').split('.');
  if (!time || !nonce || !signature || !sameSecret(signature, sign(`${time}.${nonce}`))) return false;
  return now - Number(time) >= 0 && now - Number(time) < STATE_MS;
};

router.post('/admin/api/connect', requireAdmin, adminRoute(async (req, res) => {
  if (!config.INSTAGRAM_APP_ID || !config.INSTAGRAM_APP_SECRET) throw new Error('要先在 Vercel 設定 INSTAGRAM_APP_ID 和 INSTAGRAM_APP_SECRET');
  if (!canSave()) throw new Error('還沒設定私人 Blob（INSTAGRAM_BLOB_READ_WRITE_TOKEN），連結的帳號存不起來');
  const params = new URLSearchParams({
    enable_fb_login: '0',
    force_reauth: 'true',
    client_id: config.INSTAGRAM_APP_ID,
    redirect_uri: publicUrl(req, '/oauth/callback'),
    response_type: 'code',
    scope: SCOPES.join(','),
    state: makeState(),
  });
  res.json({ url: `https://www.instagram.com/oauth/authorize?${params.toString()}` });
}));

const backToAdmin = (req, res, params) => {
  res.redirect(`${req.baseUrl}/admin?${new URLSearchParams(params).toString()}`);
};

router.get('/oauth/callback', async (req, res) => {
  if (req.query.error) {
    backToAdmin(req, res, { error: String(req.query.error_description || req.query.error_reason || '登入被取消了') });
    return;
  }
  if (!config.INSTAGRAM_APP_SECRET || !checkState(req.query.state)) {
    backToAdmin(req, res, { error: '登入連結過期了，請回到後台再按一次「用 Instagram 登入」' });
    return;
  }
  try {
    const code = String(req.query.code ?? '').replace(/#_$/, '');
    const { data: short } = await exchangeCode({ code, redirectUri: publicUrl(req, '/oauth/callback') });
    const shortToken = short.access_token || short.data?.[0]?.access_token;
    if (!shortToken) throw new Error('Instagram 沒有給權杖');
    const { data: long } = await exchangeLongLivedToken({ token: shortToken });
    const result = await addAccount({ token: long.access_token, source: 'login', expiresIn: long.expires_in });
    backToAdmin(req, res, result.subscribed
      ? { connected: result.account.username }
      : { connected: result.account.username, warning: `帳號連結了，但訂閱通知失敗：${result.subscribeError}` });
  } catch (err) {
    console.error(`[instagram] login failed: ${err.message}`);
    backToAdmin(req, res, { error: `連結失敗：${err.message}` });
  }
});

export { makeState, checkState };
export default router;
