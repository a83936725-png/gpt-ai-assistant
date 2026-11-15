/* Member API for the 易家做媽媽 web app, mounted at /mom-app/api by api/index.js.
 *
 *   GET  /config                 enabled login providers + storage kind
 *   POST /auth/register          {account (Email or 09xxxxxxxx), password, nickname?, code?, invitedBy?, stage?}
 *   POST /auth/login             {account, password}
 *   GET  /auth/line/start        → LINE Login (needs LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET)
 *   GET  /auth/line/callback     → back to the app with a session token
 *   GET  /me, POST /me           profile (+ how many people registered with my invite code)
 *   POST /presence {sid}         heartbeat from an open app
 *   GET  /stats                  {online (last 2 min), registered, todaySignups}
 *
 * Health records are NOT sent here; they stay on the user's device.
 * Env: MOM_AUTH_SECRET (required in production), KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV)
 *      or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, MOM_PUBLIC_URL, MOM_ALLOWED_ORIGINS. */
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { storeFromEnv } from './store.js';
import {
  hashPassword, verifyPassword, makeSigner, normaliseAccount, cleanText, newId, randomCode,
} from './auth.js';

const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const SESSION_TTL_SEC = 60 * 60 * 24 * 90;
const TAIPEI_OFFSET_MS = 8 * 3600e3;

export function createMomRouter({
  store = storeFromEnv(), env = process.env, http = axios, now = () => Date.now(),
} = {}) {
  const router = express.Router();
  let secret = env.MOM_AUTH_SECRET;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    if (env.NODE_ENV !== 'test') console.warn('[mom-api] MOM_AUTH_SECRET is not set; sessions reset when the server restarts.');
  }
  const tokens = makeSigner(secret);
  const lineOn = !!(env.LINE_LOGIN_CHANNEL_ID && env.LINE_LOGIN_CHANNEL_SECRET);
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

  // per-IP sliding window (per server instance)
  const buckets = new Map();
  const limited = (req, name, max, windowMs) => {
    const ip = String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
    const key = `${name}:${ip}`;
    const t = now();
    const arr = (buckets.get(key) || []).filter((x) => x > t - windowMs);
    arr.push(t);
    buckets.set(key, arr);
    return arr.length > max;
  };

  const hint = (u) => {
    const [type, value] = String(u.account).split(/:(.+)/);
    if (type === 'email') { const [name, domain] = value.split('@'); return `${name.slice(0, 1)}***@${domain}`; }
    if (type === 'phone') return `${value.slice(0, 4)}***${value.slice(-3)}`;
    return 'LINE';
  };
  const publicUser = (u, extra = {}) => ({
    id: u.id, nickname: u.nickname, provider: u.provider, code: u.code, stage: u.stage || '', createdAt: u.createdAt, accountHint: hint(u), ...extra,
  });
  const session = (u) => tokens.issue({ uid: u.id, typ: 's' }, SESSION_TTL_SEC);
  const currentUser = async (req) => {
    const header = req.get('authorization') || '';
    const data = tokens.verify(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!data || data.typ !== 's') return null;
    return store.getUser(data.uid);
  };
  async function uniqueCode(preferred) {
    const c = String(preferred || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (c.length >= 4 && !(await store.codeTaken(c))) return c;
    for (let i = 0; i < 6; i += 1) { const r = randomCode(); if (!(await store.codeTaken(r))) return r; } // eslint-disable-line no-await-in-loop
    return `${randomCode()}${randomCode()}`;
  }
  async function createUser({
    account, provider, nickname, passwordHash = null, code, invitedBy, stage,
  }) {
    const user = {
      id: newId(), account, provider, nickname: cleanText(nickname) || '媽媽', passwordHash,
      code: await uniqueCode(code), invitedBy: null, stage: ['prep', 'preg', 'baby'].includes(stage) ? stage : '', createdAt: now(),
    };
    if (invitedBy) {
      const inviter = await store.getUserByCode(String(invitedBy).toUpperCase().replace(/[^A-Z0-9]/g, ''));
      if (inviter) user.invitedBy = inviter.code;
    }
    if (!(await store.createUser(user))) return null;
    if (user.invitedBy) await store.addReferral(user.invitedBy);
    return user;
  }
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error('[mom-api]', e.message); res.status(500).json({ error: 'server_error' }); });

  router.get('/config', (req, res) => res.json({ providers: { password: true, line: lineOn }, storage: store.kind }));

  router.post('/auth/register', wrap(async (req, res) => {
    if (limited(req, 'auth', 20, 10 * 60e3)) { res.status(429).json({ error: 'too_many' }); return; }
    const {
      account: raw, password, nickname, code, invitedBy, stage,
    } = req.body || {};
    const acc = normaliseAccount(raw);
    if (!acc) { res.status(400).json({ error: 'bad_account' }); return; }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) { res.status(400).json({ error: 'weak_password' }); return; }
    if (await store.getUserByAccount(acc.account)) { res.status(409).json({ error: 'exists' }); return; }
    const user = await createUser({
      account: acc.account, provider: acc.type, nickname, passwordHash: hashPassword(password), code, invitedBy, stage,
    });
    if (!user) { res.status(409).json({ error: 'exists' }); return; }
    res.status(201).json({ token: session(user), user: publicUser(user, { referrals: 0 }) });
  }));

  router.post('/auth/login', wrap(async (req, res) => {
    if (limited(req, 'auth', 20, 10 * 60e3)) { res.status(429).json({ error: 'too_many' }); return; }
    const acc = normaliseAccount(req.body && req.body.account);
    const user = acc ? await store.getUserByAccount(acc.account) : null;
    if (!user || !user.passwordHash || !verifyPassword(String((req.body && req.body.password) || ''), user.passwordHash)) {
      res.status(401).json({ error: 'invalid' }); return;
    }
    await store.updateUser(user.id, { lastLoginAt: now() });
    res.json({ token: session(user), user: publicUser(user, { referrals: await store.countReferrals(user.code) }) });
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
    if (['prep', 'preg', 'baby'].includes(body.stage)) patch.stage = body.stage;
    const updated = await store.updateUser(user.id, patch);
    res.json({ user: publicUser(updated, { referrals: await store.countReferrals(updated.code) }) });
  }));

  router.post('/presence', wrap(async (req, res) => {
    const sid = String((req.body && req.body.sid) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    if (sid.length < 8) { res.status(400).json({ error: 'bad_sid' }); return; }
    if (limited(req, 'presence', 240, 10 * 60e3)) { res.status(429).json({ error: 'too_many' }); return; }
    await store.touchPresence(sid, now());
    res.json({ ok: true });
  }));

  router.get('/stats', wrap(async (req, res) => {
    const t = now();
    const dayStart = Math.floor((t + TAIPEI_OFFSET_MS) / 86400e3) * 86400e3 - TAIPEI_OFFSET_MS; // 台灣時間今天 00:00
    const [online, registered, todaySignups] = await Promise.all([
      store.countOnline(t - ONLINE_WINDOW_MS), store.countUsers(), store.countSignupsSince(dayStart),
    ]);
    res.json({
      online, registered, todaySignups, storage: store.kind, at: t,
    });
  }));

  /* ---- LINE Login ---- */
  const proto = (req) => String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  const appUrl = (req) => (env.MOM_PUBLIC_URL || `${proto(req)}://${req.get('host')}/mom-app/`).replace(/\/?$/, '/');
  const callbackUrl = (req) => `${appUrl(req)}api/auth/line/callback`;
  const backToApp = (req, res, data) => res.redirect(`${appUrl(req)}#/login?${encodeURIComponent(JSON.stringify(data))}`);

  router.get('/auth/line/start', (req, res) => {
    if (!lineOn) { res.status(404).json({ error: 'line_disabled' }); return; }
    const state = tokens.issue({ typ: 'line', n: newId(), ref: cleanText(req.query.ref, 12) }, 600);
    const u = new URL('https://access.line.me/oauth2/v2.1/authorize');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', env.LINE_LOGIN_CHANNEL_ID);
    u.searchParams.set('redirect_uri', callbackUrl(req));
    u.searchParams.set('state', state);
    u.searchParams.set('scope', 'profile openid');
    res.redirect(u.toString());
  });

  router.get('/auth/line/callback', async (req, res) => {
    if (!lineOn) { backToApp(req, res, { error: 'line_disabled' }); return; }
    const st = tokens.verify(req.query.state);
    if (!st || st.typ !== 'line') { backToApp(req, res, { error: 'state' }); return; }
    if (!req.query.code) { backToApp(req, res, { error: 'denied' }); return; }
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
      backToApp(req, res, { token: session(user) });
    } catch (e) {
      console.error('[mom-api] LINE login failed:', e.message);
      backToApp(req, res, { error: 'line_error' });
    }
  });

  return router;
}

export default createMomRouter;
