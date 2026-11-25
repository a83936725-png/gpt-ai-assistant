import { get, put } from '@vercel/blob';
import axios from 'axios';
import { createHash } from 'crypto';
import config from '../config/index.js';

// A traveller's trips, itineraries, eSIM orders and settings, keyed by their LINE account. Stored in a
// private Vercel Blob store when a token is set, otherwise in memory (local development and tests).
const memory = new Map();
const useBlob = () => Boolean(config.TRAVEL_BLOB_TOKEN);
export const TRAVEL_SYNC_MAX_BYTES = 400 * 1024;

/** status 401: the LINE login is missing or expired; 413: the data is too big or malformed. */
export class TravelSyncError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
const authError = (message) => new TravelSyncError(message, 401);
const dataError = (message) => new TravelSyncError(message, 413);

/** The LINE Login channel that issued the ID token: set directly, or the part of the LIFF ID before "-". */
export const lineChannelId = () => config.TRAVEL_LINE_CHANNEL_ID || (config.TRAVEL_LIFF_ID || '').split('-')[0] || null;

/**
 * Checks a LIFF ID token with LINE and returns the account it belongs to.
 * Outside production, "test:<id>" tokens are accepted so the sync can be tested without LINE.
 * @param {string} idToken
 * @returns {Promise<{ sub: string, name: string }>}
 */
export const verifyIdToken = async (idToken) => {
  if (typeof idToken !== 'string' || !idToken || idToken.length > 4096) throw authError('請重新用 LINE 登入');
  if (config.APP_ENV !== 'production' && idToken.startsWith('test:')) return { sub: idToken.slice(5, 69), name: '測試帳號' };
  const clientId = lineChannelId();
  if (!clientId) throw authError('伺服器還沒有設定 LINE 登入（TRAVEL_LIFF_ID）');
  try {
    const { data } = await axios.post('https://api.line.me/oauth2/v2.1/verify', new URLSearchParams({ id_token: idToken, client_id: clientId }), { timeout: 10000 });
    if (!data?.sub) throw authError('LINE 登入無效，請重新登入');
    return { sub: data.sub, name: typeof data.name === 'string' ? data.name.slice(0, 40) : '' };
  } catch (err) {
    if (err instanceof TravelSyncError) throw err;
    if (err.response?.status === 400) throw authError('LINE 登入已過期，請重新登入');
    throw err;
  }
};

// The data is the traveller's own and only goes back to them, so it is checked for shape and size
// rather than field by field: strings are trimmed, lists capped, and anything else dropped.
const clean = (value, depth = 0) => {
  if (depth > 8) return null;
  if (typeof value === 'string') return value.slice(0, 600);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 400).map((v) => clean(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    Object.entries(value).slice(0, 80).forEach(([k, v]) => {
      if (/^[\w-]{1,48}$/.test(k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') out[k] = clean(v, depth + 1);
    });
    return out;
  }
  return null;
};

/**
 * @param {Object} body The page's data: { user, trips, orders, cart, wish, photos, settings, updatedAt }.
 * photos holds only the details of each backed-up photo (trip, date, caption); the images are stored separately.
 */
export const sanitizeTravelData = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw dataError('資料格式不正確');
  const list = (v) => (Array.isArray(v) ? clean(v) : []);
  const data = {
    user: { name: typeof body.user?.name === 'string' ? body.user.name.slice(0, 20) : '' },
    trips: list(body.trips).slice(0, 300),
    orders: list(body.orders).slice(0, 200),
    cart: list(body.cart).slice(0, 30),
    wish: list(body.wish).filter((x) => typeof x === 'string').slice(0, 200),
    photos: list(body.photos).slice(0, 800),
    settings: clean(body.settings && typeof body.settings === 'object' ? body.settings : {}),
    updatedAt: Number.isFinite(Number(body.updatedAt)) ? Number(body.updatedAt) : Date.now(),
  };
  if (Buffer.byteLength(JSON.stringify(data)) > TRAVEL_SYNC_MAX_BYTES) throw dataError('資料太大，請刪掉一些行程再同步');
  return data;
};

const pathOf = (sub) => `travel/users/${createHash('sha256').update(sub).digest('hex').slice(0, 40)}.json`;

const readText = async (stream) => {
  const chunks = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

export const loadTravelData = async (sub) => {
  if (!useBlob()) return memory.get(sub) || null;
  const result = await get(pathOf(sub), { access: 'private', useCache: false, token: config.TRAVEL_BLOB_TOKEN });
  if (!result) return null;
  return JSON.parse(await readText(result.stream));
};

export const saveTravelData = async (sub, data) => {
  const record = { ...data, savedAt: Date.now() };
  if (!useBlob()) {
    memory.set(sub, record);
    return record;
  }
  await put(pathOf(sub), JSON.stringify(record), {
    access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json', token: config.TRAVEL_BLOB_TOKEN,
  });
  return record;
};

export const resetTravelData = () => memory.clear();
