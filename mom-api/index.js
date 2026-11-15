/* Member API for the 易家做媽媽 web app, mounted at /mom-app/api by api/index.js (before the global JSON parser).
 *
 *   GET  /config                 enabled login providers + storage kind
 *   POST /auth/register          {account (Email or 09xxxxxxxx), password, nickname?, invitedBy?}
 *   POST /auth/login             {account, password}
 *   POST /auth/logout-all        revoke every session of this account
 *   GET  /auth/line/start?nonce  → LINE Login (needs LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET)
 *   GET  /auth/line/callback     → back to the app with {token, nonce}
 *   GET  /me, POST /me           profile (+ how many people registered with my invite code)
 *   POST /presence {sid}         heartbeat from an open app
 *   GET  /stats                  {online (last 2 min), registered, todaySignups}
 *
 * Health records and pregnancy stage are NOT sent here; they stay on the user's device.
 * Env: MOM_AUTH_SECRET (≥32 chars, required on Vercel/production), KV_REST_API_URL + KV_REST_API_TOKEN
 *      (Vercel KV) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, MOM_PUBLIC_URL, MOM_ALLOWED_ORIGINS. */
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { storeFromEnv } from './store.js';
import {
  hashPassword, verifyPassword, DUMMY_HASH, makeSigner, normaliseAccount, cleanText, newId, randomCode, hashKey,
} from './auth.js';

const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;
const TAIPEI_OFFSET_MS = 8 * 3600e3;
const STATS_CACHE_MS = 15 * 1000;
const LIMITS = {
  loginIp: [30, 600], // 30 attempts / 10 min per IP
  loginAccount: [10, 600], // 10 attempts / 10 min per account
  registerIp: [10, 3600], // 10 sign-ups / hour per IP
  referralDay: [30, 86400], // at most 30 counted referrals / day per invite code
  presenceIp: [40, 600], // ~4 open apps per network
  lineIp: [30, 600],
};

export function createMomRouter({
  store = storeFromEnv(), env = process.env, http = axios, now = () => Date.now(),
} = {}) {
  const router = express.Router();
  const prodLike = env.NODE_ENV === 'production' || !!env.VERCEL;
  let secret = env.MOM_AUTH_SECRET;
  // without a real secret in production, every serverless instance would mint its own and sessions would break at random
  const authOn = !(prodLike && (!secret || secret.length < 32));
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    if (env.NODE_ENV !== 'test') console.warn(`[mom-api] MOM_AUTH_SECRET is not set; ${authOn ? 'sessions reset when the server restarts' : 'login is disabled until it is set'}.`);
  }
  const tokens = makeSigner(secret);
  const lineOn = authOn && !!(env.LINE_LOGIN_CHANNEL_ID && env.LINE_LOGIN_CHANNEL_SECRET);
  const allowed = String(env.MOM_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowed.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(express.json({ limit: '20kb' }));
  // oversized or malformed JSON → short JSON error instead of a stack trace in the logs
  router.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') { res.status(413).json({ error: 'too_large' }); return; }
    if (err && err.type === 'entity.parse.failed') { res.status(400).json({ error: 'bad_json' }); return; }
    next(err);
  });

  // client IP: Vercel sets x-real-ip; elsewhere use the socket address (X-Forwarded-For is spoofable)
  const clientIp = (req) => String((env.VERCEL && req.get('x-real-ip')) || (req.socket && req.socket.remoteAddress) || req.ip || '');
  const over = async (name, id, [max, windowSec]) => (await store.hit(`${name}:${hashKey(id)}`, windowSec, now())) > max;

  const hint = (u) => {
    const [type, value] = String(u.account).split(/:(.+)/);
    if (type === 'email') { const [name, domain] = value.split('@'); return `${name.slice(0, 1)}***@${domain}`; }
    if (type === 'phone') return `${value.slice(0, 4)}***${value.slice(-3)}`;
    return 'LINE';
  };
  const publicUser = (u, extra = {}) => ({
    id: u.id, nickname: u.nickname, provider: u.provider, code: u.code, createdAt: u.createdAt, accountHint: hint(u), ...extra,
  });
  // tv (token version) lets 「登出所有裝置」 revoke every issued session
  const session = (u) => tokens.issue({ uid: u.id, typ: 's', tv: u.tv || 0 }, SESSION_TTL_SEC);
  const currentUser = async (req) => {
    const header = req.get('authorization') || '';
    const data = tokens.verify(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!data || data.typ !== 's') return null;
    const user = await store.getUser(data.uid);
    if (!user || (user.tv || 0) !== (data.tv || 0)) return null;
    return user;
  };
  // invite codes are always generated by the server, so nobody can pre-claim a code someone else already shared
  async function uniqueCode() {
    for (let i = 0; i < 8; i += 1) { const r = randomCode(); if (!(await store.codeTaken(r))) return r; } // eslint-disable-line no-await-in-loop
    return `${randomCode()}${randomCode()}`;
  }
  async function createUser({
    account, provider, nickname, passwordHash = null, invitedBy,
  }) {
    const user = {
      id: newId(), account, provider, nickname: cleanText(nickname) || '媽媽', passwordHash, code: await uniqueCode(), invitedBy: null, tv: 0, createdAt: now(),
    };
    if (invitedBy) {
      const inviter = await store.getUserByCode(String(invitedBy).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16));
      if (inviter) user.invitedBy = inviter.code;
    }
    if (!(await store.createUser(user))) return null;
    if (user.invitedBy && !(await over('ref', user.invitedBy, LIMITS.referralDay))) await store.addReferral(user.invitedBy);
    return user;
  }
  const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((e) => {
    console.error('[mom-api]', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'server_error' });
  });
  let statsCache = null; // /stats is cached briefly to save database calls; a new sign-up clears it
  const needAuth = (res) => { if (!authOn) { res.status(503).json({ error: 'not_configured' }); return true; } return false; };

  router.get('/config', (req, res) => res.json({ providers: { password: authOn, line: lineOn }, storage: store.kind }));

  router.post('/auth/register', wrap(async (req, res) => {
    if (needAuth(res)) return;
    if (await over('reg', clientIp(req), LIMITS.registerIp)) { res.status(429).json({ error: 'too_many' }); return; }
    const {
      account: raw, password, nickname, invitedBy,
    } = req.body || {};
    const acc = normaliseAccount(raw);
    if (!acc) { res.status(400).json({ error: 'bad_account' }); return; }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) { res.status(400).json({ error: 'weak_password' }); return; }
    if (await store.getUserByAccount(acc.account)) { res.status(409).json({ error: 'exists' }); return; }
    const user = await createUser({
      account: acc.account, provider: acc.type, nickname, passwordHash: await hashPassword(password), invitedBy,
    });
    if (!user) { res.status(409).json({ error: 'exists' }); return; }
    statsCache = null;
    res.status(201).json({ token: session(user), user: publicUser(user, { referrals: 0 }) });
  }));

  router.post('/auth/login', wrap(async (req, res) => {
    if (needAuth(res)) return;
    const acc = normaliseAccount(req.body && req.body.account);
    if (await over('login-ip', clientIp(req), LIMITS.loginIp) || (acc && await over('login-acct', acc.account, LIMITS.loginAccount))) {
      res.status(429).json({ error: 'too_many' }); return;
    }
    const user = acc ? await store.getUserByAccount(acc.account) : null;
    const password = String((req.body && req.body.password) || '').slice(0, 128);
    // always run scrypt so a missing account takes as long as a wrong password
    const okPw = await verifyPassword(password, (user && user.passwordHash) || DUMMY_HASH);
    if (!user || !user.passwordHash || !okPw) { res.status(401).json({ error: 'invalid' }); return; }
    await store.updateUser(user.id, { lastLoginAt: now() });
    res.json({ token: session(user), user: publicUser(user, { referrals: await store.countReferrals(user.code) }) });
  }));

  router.post('/auth/logout-all', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
    await store.updateUser(user.id, { tv: (user.tv || 0) + 1 });
    res.json({ ok: true });
  }));

  router.get('/me', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
    res.json({ user: publicUser(user, { referrals: await store.countReferrals(user.code) }) });
  }));

  router.post('/me', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
    const body = req.body || {};
    const patch = {};
    if (body.nickname !== undefined) patch.nickname = cleanText(body.nickname) || user.nickname;
    const updated = await store.updateUser(user.id, patch);
    res.json({ user: publicUser(updated, { referrals: await store.countReferrals(updated.code) }) });
  }));

  router.post('/presence', wrap(async (req, res) => {
    const sid = String((req.body && req.body.sid) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    if (sid.length < 8) { res.status(400).json({ error: 'bad_sid' }); return; }
    // caps how many "online" sessions one network can create, so the count can't be inflated with fake ids
    if (await over('presence', clientIp(req), LIMITS.presenceIp)) { res.status(429).json({ error: 'too_many' }); return; }
    await store.touchPresence(sid, now());
    res.json({ ok: true });
  }));

  router.get('/stats', wrap(async (req, res) => {
    const t = now();
    if (!statsCache || t - statsCache.at > STATS_CACHE_MS) {
      const dayStart = Math.floor((t + TAIPEI_OFFSET_MS) / 86400e3) * 86400e3 - TAIPEI_OFFSET_MS; // 台灣時間今天 00:00
      const [online, registered, todaySignups] = await Promise.all([
        store.countOnline(t - ONLINE_WINDOW_MS), store.countUsers(), store.countSignupsSince(dayStart),
      ]);
      statsCache = {
        online, registered, todaySignups, storage: store.kind, at: t,
      };
    }
    res.json(statsCache);
  }));

  /* ---- LINE Login ---- */
  const proto = (req) => String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  const appUrl = (req) => (env.MOM_PUBLIC_URL || `${proto(req)}://${req.get('host')}/mom-app/`).replace(/\/?$/, '/');
  const callbackUrl = (req) => `${appUrl(req)}api/auth/line/callback`;
  const backToApp = (req, res, data) => res.redirect(`${appUrl(req)}#/login?${encodeURIComponent(JSON.stringify(data))}`);

  router.get('/auth/line/start', wrap(async (req, res) => {
    if (!lineOn) { res.status(404).json({ error: 'line_disabled' }); return; }
    if (await over('line', clientIp(req), LIMITS.lineIp)) { res.status(429).json({ error: 'too_many' }); return; }
    // nonce is created in this browser (sessionStorage) and must come back unchanged, so a token can't be planted from another device
    const nonce = cleanText(req.query.nonce, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    if (nonce.length < 16) { res.status(400).json({ error: 'bad_nonce' }); return; }
    const state = tokens.issue({
      typ: 'line', n: nonce, ref: cleanText(req.query.ref, 16),
    }, 600);
    const u = new URL('https://access.line.me/oauth2/v2.1/authorize');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', env.LINE_LOGIN_CHANNEL_ID);
    u.searchParams.set('redirect_uri', callbackUrl(req));
    u.searchParams.set('state', state);
    u.searchParams.set('scope', 'profile openid');
    res.redirect(u.toString());
  }));

  router.get('/auth/line/callback', wrap(async (req, res) => {
    if (!lineOn) { backToApp(req, res, { error: 'line_disabled' }); return; }
    const st = tokens.verify(req.query.state);
    if (!st || st.typ !== 'line' || !st.n) { backToApp(req, res, { error: 'state' }); return; }
    if (!req.query.code) { backToApp(req, res, { error: 'denied', nonce: st.n }); return; }
    try {
      const form = new URLSearchParams({
        grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: callbackUrl(req), client_id: env.LINE_LOGIN_CHANNEL_ID, client_secret: env.LINE_LOGIN_CHANNEL_SECRET,
      });
      const { data: tok } = await http.post('https://api.line.me/oauth2/v2.1/token', form.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 });
      const { data: profile } = await http.get('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${tok.access_token}` }, timeout: 8000 });
      const account = `line:${profile.userId}`;
      let user = await store.getUserByAccount(account);
      if (!user) user = (await createUser({ account, provider: 'line', nickname: profile.displayName, invitedBy: st.ref })) || await store.getUserByAccount(account);
      await store.updateUser(user.id, { lastLoginAt: now() });
      backToApp(req, res, { token: session(user), nonce: st.n });
    } catch (e) {
      console.error('[mom-api] LINE login failed:', e.message);
      backToApp(req, res, { error: 'line_error', nonce: st.n });
    }
  }));

  return router;
}

export default createMomRouter;
