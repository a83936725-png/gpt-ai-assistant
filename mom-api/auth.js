/* Password hashing, signed tokens and input checks for the mom-app member API. */
import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// constant-time compare that never throws (inputs may be attacker-controlled, any length / encoding)
export function safeEqual(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// async scrypt so hashing never blocks the event loop the LINE bot shares
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = fromB64url(hash);
  const actual = await scrypt(String(password), fromB64url(salt), expected.length, SCRYPT);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// used when the account doesn't exist, so login takes the same time either way (no account enumeration)
export const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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
