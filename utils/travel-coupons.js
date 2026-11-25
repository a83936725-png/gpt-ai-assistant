import { get, put } from '@vercel/blob';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import config from '../config/index.js';

// 分享回饋券: 9 折 eSIM coupons earned by sharing. A code holds its issue day, a random part and the discount,
// signed with TRAVEL_COUPON_SECRET so nobody can make one up; used codes are recorded so each works once.
// Without a secret in production, coupons are off.
const memory = new Set();
const useBlob = () => Boolean(config.TRAVEL_BLOB_TOKEN);
const token = () => config.TRAVEL_BLOB_TOKEN;

export const COUPON = { pct: 10, max: 300, days: 60 };
const EPOCH = Date.UTC(2024, 0, 1);
const DAY = 86400000;

/** status 400 not a real code, 409 already used, 410 expired, 503 coupons are off */
export class CouponError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const secret = () => config.TRAVEL_COUPON_SECRET || (config.APP_ENV === 'production' ? '' : 'travel-coupon-dev-secret');
export const couponsEnabled = () => Boolean(secret());

const sign = (payload) => createHmac('sha256', secret()).update(payload).digest().subarray(0, 4);
const dayOf = (now) => Math.floor((now - EPOCH) / DAY);
const dateOf = (day) => new Date(EPOCH + day * DAY).toISOString().slice(0, 10);
// 11 bytes (7 payload + 4 signature) as 18 base-36 characters, e.g. SHARE-0A1B2C-3D4E5F-6G7H8J.
const toCode = (buf) => `SHARE-${BigInt(`0x${buf.toString('hex')}`).toString(36).toUpperCase().padStart(18, '0')
  .match(/.{6}/g)
  .join('-')}`;
const fromCode = (code) => {
  const raw = String(code || '').toUpperCase().replace(/^SHARE-?/, '').replace(/[^0-9A-Z]/g, '');
  if (raw.length !== 18) return null;
  const n = [...raw].reduce((acc, ch) => acc * 36n + BigInt(parseInt(ch, 36)), 0n);
  const hex = n.toString(16).padStart(22, '0');
  return hex.length === 22 ? Buffer.from(hex, 'hex') : null;
};

export const issueCoupon = (now = Date.now()) => {
  if (!couponsEnabled()) throw new CouponError('分享回饋券還沒開放', 503);
  const day = dayOf(now);
  const payload = Buffer.alloc(7);
  payload.writeUInt16BE(day, 0);
  randomBytes(4).copy(payload, 2);
  payload.writeUInt8(COUPON.pct, 6);
  return {
    code: toCode(Buffer.concat([payload, sign(payload)])), pct: COUPON.pct, max: COUPON.max, until: dateOf(day + COUPON.days),
  };
};

/** The coupon a code stands for, or null when it was not issued here. */
export const readCoupon = (code, now = Date.now()) => {
  if (!couponsEnabled()) return null;
  const buf = fromCode(code);
  if (!buf) return null;
  const payload = buf.subarray(0, 7);
  if (!timingSafeEqual(buf.subarray(7), sign(payload))) return null;
  const until = dateOf(payload.readUInt16BE(0) + COUPON.days);
  return {
    code: toCode(buf), pct: payload.readUInt8(6), max: COUPON.max, until, expired: dateOf(dayOf(now)) > until,
  };
};

const usedPath = (code) => `travel/coupons/used/${code}.json`;
const isUsed = async (code) => {
  if (!useBlob()) return memory.has(code);
  return Boolean(await get(usedPath(code), { access: 'private', useCache: false, token: token() }));
};

export const verifyCoupon = async (code, now = Date.now()) => {
  if (!couponsEnabled()) throw new CouponError('分享回饋券還沒開放', 503);
  const c = readCoupon(code, now);
  if (!c) throw new CouponError('這個折扣碼不正確', 400);
  if (c.expired) throw new CouponError('這張券已經過期了', 410);
  if (await isUsed(c.code)) throw new CouponError('這張券已經用過了', 409);
  return c;
};

/** Marks a code used for an order. The payment backend should call this when the payment succeeds. */
export const redeemCoupon = async (code, orderNo, now = Date.now()) => {
  const c = await verifyCoupon(code, now);
  if (!useBlob()) memory.add(c.code);
  else {
    await put(usedPath(c.code), JSON.stringify({ orderNo: String(orderNo || '').slice(0, 40), at: now }), {
      access: 'private', allowOverwrite: false, addRandomSuffix: false, contentType: 'application/json', token: token(),
    });
  }
  return { ok: true, ...c };
};

export const resetCoupons = () => memory.clear();
