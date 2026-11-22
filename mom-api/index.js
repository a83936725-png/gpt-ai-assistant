/* Member API for the 易家做媽媽 web app, mounted at /mom-app/api by api/index.js (before the global JSON parser).
 *
 *   GET  /config                 enabled login providers + storage kind
 *   POST /auth/register          {account (Email or 09xxxxxxxx), password, nickname?, invitedBy?, code?}
 *   POST /auth/code, /auth/verify/send, /auth/verify, /auth/reset   驗證碼 and 忘記密碼 — see verify.js (a sign-up
 *                                needs the code whenever that kind of account can be verified)
 *   POST /auth/login             {account, password}
 *   POST /auth/logout-all        revoke every session of this account
 *   GET  /auth/line/start?nonce  → LINE Login (needs LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET)
 *   GET  /auth/line/callback     → back to the app with {token, nonce}
 *   GET  /me, POST /me           profile (+ how many friends joined with my invite code, and my own invite status);
 *                                POST also records consent to the privacy policy and the marketing choice
 *   POST /invite/claim {code?}   雙向邀請禮: the welcome gift for a friend who joined, and her inviter is counted —
 *                                see invite.js
 *   GET  /me/export              everything stored about me (個資法 §3: a copy of my data)
 *   POST /auth/delete {password} delete my account (§3: deletion); password accounts must re-enter the password
 *   POST /presence {sid}         heartbeat from an open app
 *   GET  /stats                  {online (last 2 min), registered, todaySignups}
 *   /social/*, /wall/*           島上的媽媽 (preset reactions) and 祝福牆 — see social.js
 *   /circle/*                    同週好孕圈 (weekly question, mood, cheers) — see circle.js
 *   /groupbuy/*                  團購揪團 stage 1: teams for the brand's group-buys, a discount code once full — see
 *                                groupbuy.js (no payment, no address)
 *   GET /admin/stats             品牌數據 for the brand's dashboard (X-Admin-Key = MOM_ADMIN_KEY): daily counts only,
 *                                never who — see metrics.js
 *
 * Health records and pregnancy stage are NOT sent here; they stay on the user's device.
 * Sign-up needs the current privacy policy version in `consent` (個資法 §7: the collector must be able to show
 * consent); the version and time are kept with the account. Marketing is a separate, optional choice (§20).
 * Env: MOM_AUTH_SECRET (≥32 chars, required on Vercel/production; shorter ones are ignored), KV_REST_API_URL +
 *      KV_REST_API_TOKEN (Vercel KV) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, MOM_PUBLIC_URL (required
 *      for LINE login in production), MOM_ALLOWED_ORIGINS, MOM_TRUST_PROXY (number of proxies in front, e.g. 1 behind
 *      nginx / a load balancer; leave unset when the server faces the internet directly or runs on Vercel). */
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { storeFromEnv } from './store.js';
import { mountSocial } from './social.js';
import { mountCircle } from './circle.js';
import { mountInvite, inviteInfo, normCode } from './invite.js';
import { mountGroupbuy } from './groupbuy.js';
import { makeMetrics, mountAdmin, dayStart as twDayStart } from './metrics.js';
import { makeSender, makeVerify } from './verify.js';
import { POLICY_VERSION } from './policy.js';
import {
  hashPassword, verifyPassword, needsRehash, isCommonPassword, DUMMY_HASH, makeSigner, normaliseAccount, cleanText, newId, randomCode, hashKey, ipBucket,
} from './auth.js';

const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;
const TRUSTED_DEVICE_SEC = 60 * 60 * 24 * 90;
const TAIPEI_OFFSET_MS = 8 * 3600e3;
const STATS_CACHE_MS = 15 * 1000;
const LIMITS = {
  loginIp: [30, 600], // 30 attempts / 10 min per network
  loginPair: [10, 600], // 10 attempts / 10 min for one account from one network: the hard stop for password guessing
  // one account from anywhere: a higher bar, and never applied to a network that has logged in to it before, so
  // nobody can lock the owner out by failing on purpose (they would only lock out unknown networks)
  loginAccount: [50, 600],
  registerIp: [10, 3600], // 10 sign-ups / hour per network (invalid input does not count)
  referralDay: [30, 86400], // at most 30 counted referrals / day per invite code (counted when the friend claims her gift)
  referralIp: [3, 86400], // …and at most 3 of them from the same network
  presenceNew: [6, 600], // a network may bring at most 6 new "online" sessions every 10 min (a family's phones)
  presenceSid: [30, 600], // heartbeats per session (the app sends one a minute)
  meUser: [60, 600], // profile updates per account
  lineIp: [30, 600],
};

export function createMomRouter({
  store = storeFromEnv(), env = process.env, http = axios, now = () => Date.now(),
} = {}) {
  const router = express.Router();
  const prodLike = env.NODE_ENV === 'production' || !!env.VERCEL;
  // a short secret is never used, in any environment: one captured token is enough to guess it offline and then mint
  // sessions for anyone. Without a real secret in production, every serverless instance would mint its own and
  // sessions would break at random, so login is switched off there; elsewhere a random one is used (reset on restart).
  const weak = !!env.MOM_AUTH_SECRET && env.MOM_AUTH_SECRET.length < 32;
  let secret = weak ? '' : env.MOM_AUTH_SECRET;
  const authOn = !(prodLike && !secret);
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    if (env.NODE_ENV !== 'test') console.warn(`[mom-api] MOM_AUTH_SECRET is ${weak ? 'too short (needs 32+ characters) and is ignored' : 'not set'}; ${authOn ? 'sessions reset when the server restarts' : 'login is disabled until it is set'}.`);
  }
  const tokens = makeSigner(secret);
  // LINE sends people back to MOM_PUBLIC_URL; in production it must be set (otherwise the Host header would decide)
  const lineOn = authOn && !!(env.LINE_LOGIN_CHANNEL_ID && env.LINE_LOGIN_CHANNEL_SECRET) && !(prodLike && !env.MOM_PUBLIC_URL);
  if (authOn && env.LINE_LOGIN_CHANNEL_ID && !lineOn && env.NODE_ENV !== 'test') console.warn('[mom-api] LINE login needs MOM_PUBLIC_URL in production; it is switched off.');
  // behind a proxy / load balancer, MOM_TRUST_PROXY = how many proxies add themselves to X-Forwarded-For
  const proxyHops = Math.max(0, Math.min(5, parseInt(env.MOM_TRUST_PROXY, 10) || 0));
  const allowed = String(env.MOM_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowed.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(express.json({ limit: '20kb' }));
  // any problem reading the body (too big, bad JSON, unknown encoding, broken gzip…) → a short JSON error;
  // never Express's default page, which shows a stack trace with server paths
  router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err && err.type === 'entity.too.large') { res.status(413).json({ error: 'too_large' }); return; }
    if (err && err.type === 'entity.parse.failed') { res.status(400).json({ error: 'bad_json' }); return; }
    const status = err && err.status >= 400 && err.status < 500 ? err.status : 400;
    res.status(status).json({ error: 'bad_request' });
  });

  // client network: Vercel sets x-real-ip; behind MOM_TRUST_PROXY proxies, the address they saw (counted from the
  // right of X-Forwarded-For, the part a client cannot forge); otherwise the socket. IPv6 is grouped by /64.
  const clientIp = (req) => {
    let ip = env.VERCEL && req.get('x-real-ip');
    if (!ip && proxyHops) {
      const chain = String(req.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
      ip = chain[chain.length - proxyHops];
    }
    return ipBucket(ip || (req.socket && req.socket.remoteAddress) || req.ip || '');
  };
  // rate-limit and trusted-network keys hold network addresses: they are hashed with the server secret, so the
  // stored keys can't be turned back into addresses (an unkeyed hash of an IPv4 address can be brute-forced)
  const keyed = (s) => crypto.createHmac('sha256', `${secret}:keys`).update(String(s)).digest('hex').slice(0, 32);
  const over = async (name, id, [max, windowSec]) => (await store.hit(`${name}:${keyed(id)}`, windowSec, now())) > max;
  // 驗證碼: Email (Resend), SMS (Twilio) or the brand's own webhook; without one, nothing asks for a code
  const metrics = makeMetrics({ store, now }); // 品牌數據: counts per day, never who
  const verify = makeVerify({
    store, now, over, clientIp, keyed, secret, sender: makeSender(env, http, prodLike),
  });

  const hint = (u) => {
    const [type, value] = String(u.account).split(/:(.+)/);
    if (type === 'email') { const [name, domain] = value.split('@'); return `${name.slice(0, 1)}***@${domain}`; }
    if (type === 'phone') return `${value.slice(0, 4)}***${value.slice(-3)}`;
    return 'LINE';
  };
  const publicUser = (u, extra = {}) => ({
    id: u.id,
    nickname: u.nickname,
    provider: u.provider,
    code: u.code,
    createdAt: u.createdAt,
    accountHint: hint(u),
    consent: (u.consent && u.consent.version) || null,
    marketing: !!(u.marketing && u.marketing.on),
    verified: u.provider === 'line' || !!u.verifiedAt, // owns the Email / phone (LINE accounts: LINE checked)
    invite: inviteInfo(u, now()),
    ...extra,
  });
  // tv (token version) lets 「登出所有裝置」 revoke every issued session; it is kept apart from the user record
  // (store.getTokenVersion) so a profile update in flight can never write an old version back
  const session = async (u) => tokens.issue({ uid: u.id, typ: 's', tv: await store.getTokenVersion(u.id, u.tv || 0) }, SESSION_TTL_SEC);
  const currentUser = async (req) => {
    const header = req.get('authorization') || '';
    const data = tokens.verify(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!data || data.typ !== 's') return null;
    const user = await store.getUser(data.uid);
    if (!user || (await store.getTokenVersion(user.id, user.tv || 0)) !== (data.tv || 0)) return null;
    return user;
  };
  // invite codes are always generated by the server, so nobody can pre-claim a code someone else already shared
  async function uniqueCode() {
    for (let i = 0; i < 8; i += 1) { const r = randomCode(); if (!(await store.codeTaken(r))) return r; } // eslint-disable-line no-await-in-loop
    return `${randomCode()}${randomCode()}`;
  }
  async function createUser({
    account, provider, nickname, passwordHash = null, invitedBy, consent = false, marketing = false, verified = false,
  }) {
    const t = now();
    const user = {
      id: newId(),
      account,
      provider,
      nickname: cleanText(nickname) || '媽媽',
      passwordHash,
      code: await uniqueCode(),
      invitedBy: null,
      tv: 0,
      createdAt: t,
      // LINE sign-ups agree in the app right after (the app asks before anything else); null until then
      consent: consent ? { version: POLICY_VERSION, at: t } : null,
      marketing: { on: !!marketing, at: t },
      verifiedAt: verified ? t : null, // proved with a code that the Email / phone is hers
    };
    if (invitedBy) {
      const inviter = await store.getUserByCode(normCode(invitedBy));
      // her inviter is counted later, when she has agreed to the policy and set the app up (POST /invite/claim),
      // within the daily caps per code and per (code, network). (A real fix needs a verified email / phone — see
      // docs/GROWTH.md.)
      if (inviter) { user.invitedBy = inviter.code; user.refPending = true; }
    }
    if (!(await store.createUser(user))) return null;
    await metrics.count('signup');
    await metrics.count(`signup_${provider}`);
    if (user.marketing.on) await metrics.total('marketing', 1);
    return user;
  }
  const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((e) => {
    console.error('[mom-api]', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'server_error' });
  });
  let statsCache = null; // /stats is cached briefly to save database calls; a new sign-up clears it
  let groupbuy = null; // set when the group-buy routes are mounted (below): its teams are part of my data
  const forgetHooks = []; // more of my data to remove with my account (notifications, family)
  const statsHooks = []; // more numbers for 品牌數據 (notifications, family)
  const needAuth = (res) => { if (!authOn) { res.status(503).json({ error: 'not_configured' }); return true; } return false; };

  router.get('/config', (req, res) => res.json({
    providers: { password: authOn, line: lineOn },
    storage: store.kind,
    social: true,
    policy: POLICY_VERSION,
    verify: authOn ? verify.config() : { email: false, phone: false }, // which kinds of account confirm a code
  }));

  router.post('/auth/register', wrap(async (req, res) => {
    if (needAuth(res)) return;
    const {
      account: raw, password, nickname, invitedBy, consent, marketing, code,
    } = req.body || {};
    // input is checked first, so mistakes (and junk) never use up a network's sign-up allowance
    const acc = normaliseAccount(raw);
    if (!acc) { res.status(400).json({ error: 'bad_account' }); return; }
    // the person ticked 「我已閱讀並同意」 for the policy that is current now
    if (consent !== POLICY_VERSION) { res.status(400).json({ error: consent ? 'policy_changed' : 'need_consent', policy: POLICY_VERSION }); return; }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) { res.status(400).json({ error: 'weak_password' }); return; }
    if (isCommonPassword(password)) { res.status(400).json({ error: 'common_password' }); return; }
    const ip = clientIp(req);
    if (await over('reg', ip, LIMITS.registerIp)) { res.status(429).json({ error: 'too_many' }); return; }
    // with a way to send codes, the address is proved first: nobody can take someone else's Email / phone, and
    // nobody can learn whether an address already has an account (one that has is never sent a code, and a guessed
    // code fails there just as it does for a new address)
    const mustVerify = verify.can(acc.type);
    if (mustVerify) {
      if (!code) { res.status(400).json({ error: 'need_code' }); return; }
      const r = await verify.check('register', acc.account, code, ip);
      if (r !== 'ok') { res.status(400).json({ error: r }); return; }
    }
    if (await store.getUserByAccount(acc.account)) { res.status(409).json({ error: 'exists' }); return; }
    const user = await createUser({
      account: acc.account, provider: acc.type, nickname, passwordHash: await hashPassword(password), invitedBy, consent: true, marketing: marketing === true, verified: mustVerify,
    });
    if (!user) { res.status(409).json({ error: 'exists' }); return; }
    statsCache = null;
    await store.setFlag(`trust:${keyed(`${acc.account}|${ip}`)}`, TRUSTED_DEVICE_SEC, now());
    res.status(201).json({ token: await session(user), user: publicUser(user, { referrals: 0 }) });
  }));

  router.post('/auth/login', wrap(async (req, res) => {
    if (needAuth(res)) return;
    const acc = normaliseAccount(req.body && req.body.account);
    const ip = clientIp(req);
    const trustKey = acc ? `trust:${keyed(`${acc.account}|${ip}`)}` : '';
    if (await over('login-ip', ip, LIMITS.loginIp)
      || (acc && await over('login-pair', `${acc.account}|${ip}`, LIMITS.loginPair))
      || (acc && await over('login-acct', acc.account, LIMITS.loginAccount) && !(await store.hasFlag(trustKey, now())))) {
      res.status(429).json({ error: 'too_many' }); return;
    }
    const user = acc ? await store.getUserByAccount(acc.account) : null;
    const password = String((req.body && req.body.password) || '').slice(0, 128);
    // always run scrypt so a missing account takes as long as a wrong password
    const okPw = await verifyPassword(password, (user && user.passwordHash) || DUMMY_HASH);
    if (!user || !user.passwordHash || !okPw) { res.status(401).json({ error: 'invalid' }); return; }
    const patch = { lastLoginAt: now() };
    if (needsRehash(user.passwordHash)) patch.passwordHash = await hashPassword(password); // upgrade an older, weaker hash
    await store.updateUser(user.id, patch);
    await store.setFlag(trustKey, TRUSTED_DEVICE_SEC, now()); // this network may log in even while strangers fail
    await metrics.count('login');
    res.json({ token: await session(user), user: publicUser(user, { referrals: await store.countReferrals(user.code) }) });
  }));

  router.post('/auth/logout-all', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
    await store.bumpTokenVersion(user.id, user.tv || 0);
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
    if (await over('me', user.id, LIMITS.meUser)) { res.status(429).json({ error: 'too_many' }); return; }
    const body = req.body || {};
    const patch = {};
    if (body.nickname !== undefined) patch.nickname = cleanText(body.nickname) || user.nickname;
    if (body.consent !== undefined) {
      if (body.consent !== POLICY_VERSION) { res.status(400).json({ error: 'policy_changed', policy: POLICY_VERSION }); return; }
      patch.consent = { version: POLICY_VERSION, at: now() };
    }
    if (typeof body.marketing === 'boolean') patch.marketing = { on: body.marketing, at: now() }; // turning it off is free and instant (§20)
    const was = !!(user.marketing && user.marketing.on); // read before the update (a store may hand back the same object)
    const updated = await store.updateUser(user.id, patch);
    if (typeof body.marketing === 'boolean' && body.marketing !== was) await metrics.total('marketing', body.marketing ? 1 : -1);
    res.json({ user: publicUser(updated, { referrals: await store.countReferrals(updated.code) }) });
  }));

  // 個資法 §3: a copy of everything kept about me (never the password hash)
  router.get('/me/export', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (await over('me', user.id, LIMITS.meUser)) { res.status(429).json({ error: 'too_many' }); return; }
    const [type, value] = String(user.account).split(/:(.+)/);
    const iso = (t) => (t ? new Date(t).toISOString() : null);
    res.set('Content-Disposition', 'attachment; filename="my-account-data.json"');
    res.json({
      exportedAt: iso(now()),
      account: { type, value },
      provider: user.provider,
      nickname: user.nickname,
      inviteCode: user.code,
      invitedBy: user.invitedBy,
      welcomeGiftAt: iso(user.giftAt),
      verifiedAt: iso(user.verifiedAt),
      createdAt: iso(user.createdAt),
      lastLoginAt: iso(user.lastLoginAt),
      consent: user.consent ? { version: user.consent.version, at: iso(user.consent.at) } : null,
      marketing: user.marketing ? { on: !!user.marketing.on, at: iso(user.marketing.at) } : { on: false, at: null },
      referrals: await store.countReferrals(user.code),
      groupBuys: groupbuy ? await groupbuy.exportFor(user) : [],
      note: '懷孕、寶寶與健康紀錄只存在你的手機，伺服器沒有這些資料。',
    });
  }));

  // 個資法 §3: delete my account. Password accounts confirm with the password (a stolen phone that is still logged in
  // must not be able to erase the account); LINE accounts confirm in the app.
  router.post('/auth/delete', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (await over('delete', user.id, LIMITS.loginPair)) { res.status(429).json({ error: 'too_many' }); return; }
    if (user.passwordHash) {
      const pw = String((req.body && req.body.password) || '').slice(0, 128);
      if (!(await verifyPassword(pw, user.passwordHash))) { res.status(401).json({ error: 'invalid' }); return; }
    }
    if (groupbuy) await groupbuy.forget(user); // first: if this fails, the account is still there to try again
    for (const fn of forgetHooks) await fn(user); // eslint-disable-line no-restricted-syntax, no-await-in-loop
    await store.deleteUser(user);
    statsCache = null;
    await metrics.count('deleted');
    if (user.marketing && user.marketing.on) await metrics.total('marketing', -1);
    res.json({ ok: true });
  }));

  router.post('/presence', wrap(async (req, res) => {
    const sid = String((req.body && req.body.sid) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    if (sid.length < 8) { res.status(400).json({ error: 'bad_sid' }); return; }
    // one network can only bring a few new "online" sessions (a family's phones), and each session only beats
    // about once a minute, so the online count can't be inflated with made-up ids
    if (await over('presence-sid', sid, LIMITS.presenceSid)) { res.status(429).json({ error: 'too_many' }); return; }
    const fresh = !(await store.hasPresence(sid));
    if (fresh && await over('presence-new', clientIp(req), LIMITS.presenceNew)) { res.status(429).json({ error: 'too_many' }); return; }
    await store.touchPresence(sid, now());
    if (fresh) await metrics.count('open'); // the app was opened (or came back after an hour)
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
      typ: 'line', n: nonce, ref: cleanText(req.query.ref, 16), j: newId(), // j: single use (see the callback)
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
    if (await over('line-cb', clientIp(req), LIMITS.lineIp)) { backToApp(req, res, { error: 'too_many' }); return; }
    const st = tokens.verify(req.query.state);
    if (!st || st.typ !== 'line' || !st.n) { backToApp(req, res, { error: 'state' }); return; }
    // each state works once: replaying it (with made-up codes) would make us call LINE again and again with our secret
    if (!st.j || !(await store.claimOnce(`line-state:${st.j}`, 600, now()))) { backToApp(req, res, { error: 'state' }); return; }
    if (!req.query.code) { backToApp(req, res, { error: 'denied', nonce: st.n }); return; }
    try {
      const form = new URLSearchParams({
        grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: callbackUrl(req), client_id: env.LINE_LOGIN_CHANNEL_ID, client_secret: env.LINE_LOGIN_CHANNEL_SECRET,
      });
      const { data: tok } = await http.post('https://api.line.me/oauth2/v2.1/token', form.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 });
      const { data: profile } = await http.get('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${tok.access_token}` }, timeout: 8000 });
      if (!profile || !/^U[0-9a-f]{32}$/.test(String(profile.userId))) throw new Error('unexpected LINE user id');
      const account = `line:${profile.userId}`;
      let user = await store.getUserByAccount(account);
      if (!user) {
        user = (await createUser({
          account, provider: 'line', nickname: profile.displayName, invitedBy: st.ref,
        })) || await store.getUserByAccount(account);
      }
      await store.updateUser(user.id, { lastLoginAt: now() });
      backToApp(req, res, { token: await session(user), nonce: st.n });
    } catch (e) {
      console.error('[mom-api] LINE login failed:', e.message);
      backToApp(req, res, { error: 'line_error', nonce: st.n });
    }
  }));

  verify.mount(router, {
    wrap,
    currentUser,
    publicUserOut: async (u) => publicUser(u, { referrals: await store.countReferrals(u.code) }),
    getUserByAccount: (a) => store.getUserByAccount(a),
    setPassword: {
      check: async (pw) => {
        if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) return 'weak_password';
        return isCommonPassword(pw) ? 'common_password' : null;
      },
      // 忘記密碼: the new password, every other device logged out, and logged in here (the code proved the address)
      apply: async (user, pw, req) => {
        await store.updateUser(user.id, { passwordHash: await hashPassword(pw), verifiedAt: user.verifiedAt || now() });
        await store.bumpTokenVersion(user.id, user.tv || 0);
        const fresh = await store.getUser(user.id);
        await store.setFlag(`trust:${keyed(`${fresh.account}|${clientIp(req)}`)}`, TRUSTED_DEVICE_SEC, now());
        return { token: await session(fresh), user: publicUser(fresh, { referrals: await store.countReferrals(fresh.code) }) };
      },
    },
  });
  mountSocial(router, {
    store, now, secret, over, clientIp, wrap, metrics,
  });
  mountCircle(router, {
    store, now, secret, over, clientIp, wrap, metrics,
  });
  mountInvite(router, {
    store,
    now,
    over,
    clientIp,
    wrap,
    currentUser,
    userOut: async (u) => publicUser(u, { referrals: await store.countReferrals(u.code) }),
    referralLimits: { ip: LIMITS.referralIp, day: LIMITS.referralDay },
    needVerify: verify.needVerify,
    metrics,
  });
  groupbuy = mountGroupbuy(router, {
    store, now, over, clientIp, wrap, currentUser, env, needVerify: verify.needVerify, metrics,
  });
  mountAdmin(router, {
    store,
    now,
    over,
    clientIp,
    keyed,
    wrap,
    env,
    metrics,
    // the numbers for the brand: members, sign-ups per day (from the members list, so also before this version),
    // what was done each day, the group-buys, and what the other parts add
    build: async ({
      t, days, totals, len,
    }) => {
      const today = twDayStart(t);
      const starts = [...days.map((d, i) => today - (len - 1 - i) * 86400e3), today + 86400e3];
      const since = await Promise.all(starts.map((x) => store.countSignupsSince(x)));
      // the day's count from this version on is exact (deleted accounts included); the members list fills in the days before
      days.forEach((d, i) => { d.signup = Math.max(d.signup, since[i] - since[i + 1], 0); }); // eslint-disable-line no-param-reassign
      const [members, online, groupbuys] = await Promise.all([store.countUsers(), store.countOnline(t - ONLINE_WINDOW_MS), groupbuy ? groupbuy.stats() : []]);
      const extra = {};
      for (const fn of statsHooks) Object.assign(extra, await fn(t)); // eslint-disable-line no-restricted-syntax, no-await-in-loop
      return {
        storage: store.kind, members, online, totals, rows: days, groupbuys, ...extra,
      };
    },
  });

  return router;
}

export default createMomRouter;
