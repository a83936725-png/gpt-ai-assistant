import { get, put } from '@vercel/blob';
import { createHash } from 'crypto';
import config from '../config/index.js';
import { refreshAccessToken, setTokenResolver } from '../services/instagram.js';

// The token from the dashboard lasts 60 days. The daily cron refreshes it and, when a private
// Vercel Blob store is configured, keeps the refreshed token there so it survives redeploys.
const PATH = 'instagram/token.json';
const CACHE_MS = 10 * 60 * 1000;
const REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

let cached = null;
let cachedAt = 0;

const fingerprint = (token) => (token ? createHash('sha256').update(token).digest('hex').slice(0, 16) : null);

const readText = async (stream) => {
  const chunks = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const loadStored = async () => {
  if (!config.INSTAGRAM_BLOB_TOKEN) return null;
  try {
    const result = await get(PATH, { access: 'private', useCache: false, token: config.INSTAGRAM_BLOB_TOKEN });
    if (!result) return null;
    return JSON.parse(await readText(result.stream));
  } catch (err) {
    console.error(`[instagram] could not read the stored token: ${err.message}`);
    return null;
  }
};

const saveStored = async (record) => {
  await put(PATH, JSON.stringify(record), {
    access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json', token: config.INSTAGRAM_BLOB_TOKEN,
  });
};

/**
 * The token in use and where it came from. A stored token is only used while the token in
 * Vercel is the one it was refreshed from: pasting a new token in Vercel always takes over.
 */
const getTokenInfo = async ({ fresh = false } = {}) => {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  const envToken = config.INSTAGRAM_ACCESS_TOKEN;
  const stored = await loadStored();
  if (stored?.token && stored.from === fingerprint(envToken)) {
    cached = { ...stored, source: 'stored' };
  } else {
    cached = envToken ? { token: envToken, source: 'env' } : null;
  }
  cachedAt = Date.now();
  return cached;
};

const getAccessToken = async () => (await getTokenInfo())?.token || null;

const shouldRefresh = (info, now = Date.now()) => Boolean(info?.token) && (!info.refreshedAt || now - info.refreshedAt >= REFRESH_EVERY_MS);

/**
 * Asks Instagram for another 60 days. Returns what happened, for the daily report.
 */
const refreshToken = async ({ force = false } = {}) => {
  const info = await getTokenInfo({ fresh: true });
  if (!info?.token) return { refreshed: false, reason: 'no-token' };
  if (!force && !shouldRefresh(info)) return { refreshed: false, reason: 'recent', expiresAt: info.expiresAt || null };
  const { data } = await refreshAccessToken({ token: info.token });
  const now = Date.now();
  const record = {
    token: data.access_token,
    refreshedAt: now,
    expiresAt: data.expires_in ? now + Number(data.expires_in) * 1000 : null,
    from: fingerprint(config.INSTAGRAM_ACCESS_TOKEN),
  };
  const changed = record.token !== info.token;
  let stored = false;
  if (config.INSTAGRAM_BLOB_TOKEN) {
    await saveStored(record);
    stored = true;
  }
  cached = { ...record, source: stored ? 'stored' : 'env' };
  cachedAt = now;
  return {
    refreshed: true, changed, stored, expiresAt: record.expiresAt,
  };
};

const resetTokenCache = () => {
  cached = null;
  cachedAt = 0;
};

setTokenResolver(getAccessToken);

export {
  getTokenInfo,
  getAccessToken,
  refreshToken,
  shouldRefresh,
  resetTokenCache,
};
