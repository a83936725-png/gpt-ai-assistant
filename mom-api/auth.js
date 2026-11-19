/* Password hashing, signed tokens and input checks for the mom-app member API. */
import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);
// OWASP minimum for scrypt at 16 MiB of memory: N=2^14, r=8, p=5 (5× the work of the first version, same memory, so
// many logins at once don't run a serverless function out of memory). Older hashes (p=1) still verify and are
// upgraded at the next successful login (needsRehash).
const SCRYPT = { N: 16384, r: 8, p: 5 };
const LEGACY = { N: 16384, r: 8, p: 1 };
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// constant-time compare that never throws (inputs may be attacker-controlled, any length / encoding)
export function safeEqual(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// async scrypt so hashing never blocks the event loop the LINE bot shares
// stored as scrypt5$salt$hash (current) or scrypt$salt$hash (first version, p=1)
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt5$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  const params = alg === 'scrypt5' ? SCRYPT : alg === 'scrypt' ? LEGACY : null;
  if (!params || !salt || !hash) return false;
  const expected = fromB64url(hash);
  const actual = await scrypt(String(password), fromB64url(salt), expected.length, params);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
export const needsRehash = (stored) => String(stored || '').split('$')[0] !== 'scrypt5';

// used when the account doesn't exist, so login takes the same time either way (no account enumeration)
export const DUMMY_HASH = 'scrypt5$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// the passwords people pick most often (8+ characters); refused at sign-up because they fall to the first guesses
const COMMON = new Set(['12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '88888888', '66666666',
  '12341234', '11223344', '12344321', '1qaz2wsx', '1q2w3e4r', 'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'zxcvbnm1',
  'password', 'password1', 'password123', 'passw0rd', 'iloveyou', 'abcd1234', 'abc12345', 'a1234567', 'aa123456',
  'a12345678', 'qaz12345', 'asd12345', 'zxc12345', '1234qwer', 'qwer1234', 'asdf1234', 'admin123', 'welcome1',
  'sunshine', 'princess', 'baseball', 'football', 'superman', 'whatever', 'trustno1', 'starwars', '5201314520', '52013140',
  '5201314a', 'woaini520', 'woaini1314', 'iloveyou1']);
export const isCommonPassword = (pw) => COMMON.has(String(pw).toLowerCase());

// token = base64url(payload).base64url(HMAC-SHA256(payload))
export function makeSigner(secret) {
  const sign = (data) => b64url(crypto.createHmac('sha256', secret).update(data).digest());
  return {
    issue(payload, ttlSec) {
      const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
      return `${body}.${sign(body)}`;
    },
    verify(token) {
      const [body, sig] = String(token || '').split('.');
      if (!body || !sig) return null;
      if (!safeEqual(sign(body), sig)) return null;
      try {
        const data = JSON.parse(fromB64url(body).toString('utf8'));
        if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
        return data;
      } catch (e) { return null; }
    },
  };
}

// account = email or Taiwan mobile (09xxxxxxxx); normalised to lower-case / digits
export function normaliseAccount(raw) {
  const s = String(raw || '').trim();
  if (/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(s)) return { account: `email:${s.toLowerCase()}`, type: 'email' };
  const digits = s.replace(/[\s-]/g, '').replace(/^\+886/, '0');
  if (/^09\d{8}$/.test(digits)) return { account: `phone:${digits}`, type: 'phone' };
  return null;
}

export const cleanText = (s, max = 20) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
export const newId = () => b64url(crypto.randomBytes(12));
export const randomCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(6), (b) => A[b % A.length]).join('');
};
export const hashKey = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24);

// rate-limit bucket for an address: IPv4 as is; IPv6 by its /64 network (one home or phone gets a whole /64,
// so per-address buckets would let a single device use millions of fresh buckets)
export function ipBucket(ip) {
  let a = String(ip || '').trim().toLowerCase();
  if (a.startsWith('::ffff:') && a.includes('.')) return a.slice(7); // IPv4 written as IPv6
  if (!a.includes(':')) return a;
  a = a.split('%')[0];
  const [head, tail = ''] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = a.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${full.slice(0, 4).map((x) => (x || '0').replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
