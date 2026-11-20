/* 驗證碼 (used by index.js): an Email / phone sign-up first proves it owns the address, 忘記密碼 resets a password
 * with a code, and an older account can verify itself.
 *   POST /auth/code {account, purpose: 'register', consent}   a sign-up code, before the account exists (an address
 *                                                               that already has one gets a 「已經註冊過」 notice instead)
 *   POST /auth/code {account, purpose: 'reset'}                a reset code (only an account with a password is sent one)
 *   POST /auth/verify/send                 (logged in) a code to my own Email / phone
 *   POST /auth/verify {code}               (logged in) confirm it
 *   POST /auth/reset {account, code, password}   new password: logged in here, every other device logged out
 *   /auth/register takes {code} whenever that kind of account (Email / phone) can be verified.
 * Nobody can test whether someone's Email / phone uses a pregnancy app: for an address with or without an account,
 * /auth/code gives the same answer, uses up the same limits and takes about as long, and a guessed code fails the same
 * way (an address that is sent nothing still gets a code stored that nobody is told).
 * Sending: RESEND_API_KEY + MOM_MAIL_FROM (Email via Resend); TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM or
 * TWILIO_MESSAGING_SERVICE_SID (SMS via Twilio); or MOM_CODE_WEBHOOK_URL (+ MOM_CODE_WEBHOOK_SECRET to sign it) for
 * any other service (三竹、every8d… through the brand's own system). Without any of them, sign-up works as before and
 * nothing asks for a code. MOM_CODE_ECHO=1 (refused in production) puts the code in the answer, for tests and trials.
 * Codes: 6 digits, kept only as a keyed hash, 10 minutes, 5 tries; a new code at most once a minute per address and
 * purpose (sign-up, reset, verify), 6 an hour per address in all, 20 an hour per network. */
import crypto from 'crypto';
import { normaliseAccount, safeEqual } from './auth.js';
import { POLICY_VERSION } from './policy.js';

const CODE_TTL = 600;
const MAX_TRIES = 5;
const LIMITS = {
  addrMinute: [1, 60],
  addrHour: [6, 3600],
  ip: [20, 3600],
  check: [20, 600], // code checks per address and network (the code itself also has 5 tries)
};
const split = (account) => { const [type, value] = String(account).split(/:(.+)/); return { type, value }; };
export const e164 = (phone) => `+886${String(phone).replace(/^0/, '')}`; // 0912345678 → +886912345678

// how codes leave the server; `http` is axios (or a fake in tests)
export function makeSender(env, http, prodLike, appName = '易家做媽媽') {
  const echo = env.MOM_CODE_ECHO === '1' && !prodLike;
  const hook = env.MOM_CODE_WEBHOOK_URL && /^https:\/\//.test(env.MOM_CODE_WEBHOOK_URL) ? env.MOM_CODE_WEBHOOK_URL : '';
  const resend = env.RESEND_API_KEY && env.MOM_MAIL_FROM;
  const twilio = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID);
  const TEXT = {
    reset: (code) => `【${appName}】重設密碼的驗證碼：${code}，10 分鐘內有效。如果不是你本人操作，請忽略，你的密碼不會改變。`,
    exists: () => `【${appName}】這個 Email／手機已經註冊過了，請直接登入；忘記密碼可以在登入頁用驗證碼重設。如果不是你本人操作，請忽略。`,
  };
  const text = (code, purpose) => (TEXT[purpose] ? TEXT[purpose](code) : `【${appName}】驗證碼：${code}，10 分鐘內有效。請不要把驗證碼告訴任何人。`);
  async function send(account, code, purpose) {
    const { type, value } = split(account);
    const msg = text(code, purpose);
    if (hook) {
      const body = JSON.stringify({
        channel: type === 'email' ? 'email' : 'sms', to: type === 'phone' ? e164(value) : value, code, purpose, text: msg,
      });
      const sig = env.MOM_CODE_WEBHOOK_SECRET ? crypto.createHmac('sha256', env.MOM_CODE_WEBHOOK_SECRET).update(body).digest('hex') : '';
      await http.post(hook, body, { headers: { 'Content-Type': 'application/json', ...(sig ? { 'X-Mom-Signature': `sha256=${sig}` } : {}) }, timeout: 8000 });
      return;
    }
    if (type === 'email' && resend) {
      await http.post('https://api.resend.com/emails', {
        from: env.MOM_MAIL_FROM, to: [value], subject: code ? `${appName} 驗證碼 ${code}` : `${appName} 帳號通知`, text: msg,
      }, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 8000 });
      return;
    }
    if (type === 'phone' && twilio) {
      const form = new URLSearchParams({ To: e164(value), Body: msg });
      if (env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID); else form.set('From', env.TWILIO_FROM);
      await http.post(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`, form.toString(), {
        auth: { username: env.TWILIO_ACCOUNT_SID, password: env.TWILIO_AUTH_TOKEN }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000,
      });
      return;
    }
    if (!echo) throw new Error('no sender for this kind of account');
  }
  return {
    email: !!(hook || resend || echo),
    phone: !!(hook || twilio || echo),
    echo,
    send,
  };
}

export function makeVerify({
  store, now, over, clientIp, keyed, secret, sender,
}) {
  const can = (type) => (type === 'email' ? sender.email : type === 'phone' ? sender.phone : false); // eslint-disable-line no-nested-ternary
  const key = (purpose, account) => `vc:${purpose}:${keyed(account)}`;
  const hash = (purpose, account, code) => crypto.createHmac('sha256', `${secret}:codes`).update(`${purpose}|${account}|${code}`).digest('hex');
  // an account that can prove its address but hasn't yet (LINE accounts are verified by LINE)
  const needVerify = (u) => !!u && u.provider !== 'line' && !u.verifiedAt && can(split(u.account).type);

  // the same allowances are used up whatever happens next, so they never tell whether an address has an account
  async function limited(purpose, account, ip) {
    if (await over('code-min', `${purpose}|${account}`, LIMITS.addrMinute)) return 'wait';
    if (await over('code-hour', account, LIMITS.addrHour) || await over('code-ip', ip, LIMITS.ip)) return 'too_many';
    return '';
  }
  // a fresh code replaces the previous one. It is stored even when nobody is sent it (the address already has an
  // account, or has none to reset), so a guessed code fails there exactly as it does anywhere else.
  async function issue(purpose, account) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const t = now();
    await store.setJson(key(purpose, account), { h: hash(purpose, account, code), tries: 0, exp: t + CODE_TTL * 1000 }, CODE_TTL, t);
    return code;
  }
  // 'ok' (the code is used up) | 'bad_code' | 'code_expired' | 'code_too_many'
  async function check(purpose, account, code, ip) {
    if (await over('code-check', `${account}|${ip}`, LIMITS.check)) return 'code_too_many';
    const t = now();
    const rec = await store.getJson(key(purpose, account), t);
    if (!rec || rec.exp <= t) return 'code_expired';
    if (rec.tries >= MAX_TRIES) return 'code_too_many';
    if (!safeEqual(rec.h, hash(purpose, account, String(code || '').replace(/\D/g, '').slice(0, 6)))) {
      rec.tries += 1;
      await store.setJson(key(purpose, account), rec, Math.max(1, Math.ceil((rec.exp - t) / 1000)), t);
      return rec.tries >= MAX_TRIES ? 'code_too_many' : 'bad_code';
    }
    await store.del(key(purpose, account));
    return 'ok';
  }
  // how long a message takes to go out (a moving average): an answer that sends nothing waits about as long
  let sendMs = sender.echo ? 0 : 400;
  const pause = () => new Promise((r) => { setTimeout(r, Math.min(3000, sendMs * (0.75 + Math.random() * 0.5))); });
  // false when it could not be sent (nobody has that code; it simply runs out)
  async function deliver(account, code, purpose) {
    const t0 = Date.now();
    try { await sender.send(account, code, purpose); return true; } catch (e) {
      console.error(`[mom-api] sending ${code ? 'a code' : 'a notice'} failed:`, e.message);
      return false;
    } finally { sendMs = sendMs * 0.8 + (Date.now() - t0) * 0.2; }
  }
  async function sendCode(res, purpose, account, ip) {
    const limit = await limited(purpose, account, ip);
    if (limit) { res.status(429).json({ error: limit }); return; }
    const code = await issue(purpose, account);
    if (!(await deliver(account, code, purpose))) { res.status(502).json({ error: 'send_failed' }); return; }
    res.json({ ok: true, ttl: CODE_TTL, ...(sender.echo ? { devCode: code } : {}) });
  }

  function mount(router, {
    wrap, currentUser, publicUserOut, getUserByAccount, setPassword,
  }) {
    router.post('/auth/code', wrap(async (req, res) => {
      const body = req.body || {};
      const acc = normaliseAccount(body.account);
      if (!acc) { res.status(400).json({ error: 'bad_account' }); return; }
      if (!can(acc.type)) { res.status(404).json({ error: 'verify_off' }); return; }
      const { purpose } = body;
      if (purpose !== 'register' && purpose !== 'reset') { res.status(400).json({ error: 'bad_request' }); return; }
      if (purpose === 'register' && body.consent !== POLICY_VERSION) { res.status(400).json({ error: body.consent ? 'policy_changed' : 'need_consent', policy: POLICY_VERSION }); return; }
      const limit = await limited(purpose, acc.account, clientIp(req));
      if (limit) { res.status(429).json({ error: limit }); return; }
      const u = await getUserByAccount(acc.account);
      const code = await issue(purpose, acc.account);
      if (purpose === 'register') {
        // an address that already has an account is told so instead of getting a code: both wait for a message to go
        // out, and both fail the same way when it can't
        if (!(await deliver(acc.account, u ? null : code, u ? 'exists' : 'register'))) { res.status(502).json({ error: 'send_failed' }); return; }
        res.json({ ok: true, ttl: CODE_TTL, ...(sender.echo && !u ? { devCode: code } : {}) });
        return;
      }
      // 忘記密碼: only an account with a password is sent a code; any other address gets nothing, after about as long
      const real = !!(u && u.passwordHash);
      if (real) await deliver(acc.account, code, 'reset'); else await pause();
      res.json({ ok: true, ttl: CODE_TTL, ...(sender.echo && real ? { devCode: code } : {}) });
    }));

    router.post('/auth/verify/send', wrap(async (req, res) => {
      const user = await currentUser(req);
      if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
      if (!needVerify(user)) { res.json({ ok: true, already: true }); return; }
      await sendCode(res, 'verify', user.account, clientIp(req));
    }));

    router.post('/auth/verify', wrap(async (req, res) => {
      const user = await currentUser(req);
      if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
      if (!needVerify(user)) { res.json({ user: await publicUserOut(user) }); return; }
      const r = await check('verify', user.account, req.body && req.body.code, clientIp(req));
      if (r !== 'ok') { res.status(400).json({ error: r }); return; }
      const updated = await store.updateUser(user.id, { verifiedAt: now() });
      res.json({ user: await publicUserOut(updated) });
    }));

    router.post('/auth/reset', wrap(async (req, res) => {
      const body = req.body || {};
      const acc = normaliseAccount(body.account);
      if (!acc || !can(acc.type)) { res.status(400).json({ error: 'bad_account' }); return; }
      const pwErr = await setPassword.check(body.password);
      if (pwErr) { res.status(400).json({ error: pwErr }); return; }
      const r = await check('reset', acc.account, body.code, clientIp(req));
      if (r !== 'ok') { res.status(400).json({ error: r }); return; }
      const user = await getUserByAccount(acc.account);
      if (!user || !user.passwordHash) { res.status(400).json({ error: 'code_expired' }); return; }
      res.json(await setPassword.apply(user, body.password, req));
    }));
  }

  return {
    can, needVerify, check, mount, config: () => ({ email: sender.email, phone: sender.phone }),
  };
}
