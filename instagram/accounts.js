import { createHash } from 'crypto';
import config from '../config/index.js';
import {
  fetchMe, fetchSubscribedApps, refreshAccessToken, subscribeApp, WEBHOOK_FIELDS,
} from '../services/instagram.js';
import { canSave, readJson, writeJson } from './store.js';

// The Instagram accounts this server answers for. They come from two places:
// - Vercel: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_ACCESS_TOKEN_2, … (one token per account)
// - the admin page: "log in with Instagram" or a pasted token, kept in private Blob storage
// Webhooks say which account they are for (entry.id), so each reply goes out with that account's token.

const PATH = 'instagram/accounts.json';
const CACHE_MS = 10 * 60 * 1000;
const RELOAD_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_EVERY_MS = 7 * DAY_MS;

let cache = null;
let cachedAt = 0;
let reloadedAt = 0;

const fingerprint = (token) => (token ? createHash('sha256').update(String(token)).digest('hex').slice(0, 16) : null);

const loadStored = async () => {
  try {
    return (await readJson(PATH))?.accounts || [];
  } catch (err) {
    console.error(`[instagram] could not read accounts: ${err.message}`);
    return [];
  }
};

const saveStored = async (accounts) => {
  await writeJson(PATH, { accounts, updatedAt: Date.now() });
};

const identify = async (token) => {
  const { data } = await fetchMe({ token });
  return {
    userId: String(data.user_id ?? data.id ?? ''),
    appScopedId: String(data.id ?? ''),
    username: String(data.username ?? ''),
  };
};

/**
 * Every account, with its token. A token kept by the admin page or refreshed by the cron wins
 * over the one in Vercel only while the Vercel token is the one it came from: pasting a new
 * token in Vercel always takes over.
 */
const loadAccounts = async ({ fresh = false } = {}) => {
  if (!fresh && cache && Date.now() - cachedAt < CACHE_MS) return cache;
  const stored = await loadStored();
  const accounts = [];
  await Promise.all(config.INSTAGRAM_ACCESS_TOKENS.map(async ({ key, token }, index) => {
    const from = fingerprint(token);
    const kept = stored.find((a) => a.source === 'env' && a.envKey === key && a.from === from);
    if (kept) {
      accounts[index] = { ...kept };
      return;
    }
    try {
      const who = await identify(token);
      const old = stored.find((a) => a.userId === who.userId);
      accounts[index] = {
        ...who, token, source: 'env', envKey: key, from, paused: Boolean(old?.paused),
      };
    } catch (err) {
      accounts[index] = {
        userId: null, username: '', token, source: 'env', envKey: key, from, paused: false, error: err.message, errorCode: err.instagram?.code ?? null,
      };
    }
  }));
  const fromEnv = accounts.filter(Boolean);
  stored.filter((a) => a.source !== 'env' && !fromEnv.some((e) => e.userId && e.userId === a.userId)).forEach((a) => fromEnv.push({ ...a }));
  cache = fromEnv;
  cachedAt = Date.now();
  return cache;
};

const matches = (account, id) => Boolean(id) && (String(id) === account.userId || String(id) === account.appScopedId);

/**
 * The account a webhook is for. A webhook from an account added a moment ago on another
 * server instance triggers one reload a minute at most.
 */
const findAccount = async (id) => {
  let account = (await loadAccounts()).find((a) => matches(a, id));
  if (!account && Date.now() - reloadedAt > RELOAD_MS) {
    reloadedAt = Date.now();
    account = (await loadAccounts({ fresh: true })).find((a) => matches(a, id));
  }
  return account || null;
};

const toStored = (account) => {
  const {
    error, errorCode, ...rest
  } = account;
  return rest;
};

// All accounts share one file, so changes are written one at a time: the daily cron refreshes
// every account at once and must not overwrite one refreshed token with another.
let queue = Promise.resolve();
const oneAtATime = (task) => {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
};

// Writes one account into storage, replacing the copy with the same user ID.
const upsert = (account) => oneAtATime(async () => {
  const stored = await loadStored();
  const next = stored.filter((a) => a.userId !== account.userId);
  next.push(toStored(account));
  await saveStored(next);
  cache = null;
});

const subscribe = async (account) => {
  await subscribeApp({ token: account.token });
  return WEBHOOK_FIELDS;
};

// The webhook fields Meta has on file for this account (empty means: Meta sends nothing).
const fetchSubscription = async (account) => {
  const { data } = await fetchSubscribedApps({ token: account.token });
  const apps = data?.data || [];
  return [...new Set(apps.flatMap((app) => app.subscribed_fields || []))];
};

/**
 * Adds or replaces an account from a token (pasted, or from "log in with Instagram"), and
 * subscribes it to webhooks right away so there is no switch to flip in the Meta dashboard.
 */
const addAccount = async ({ token, source, expiresIn = null }) => {
  if (!canSave()) throw new Error('還沒設定私人 Blob（INSTAGRAM_BLOB_READ_WRITE_TOKEN），新增的帳號存不起來');
  const value = String(token ?? '').trim();
  if (!value) throw new Error('請貼上權杖');
  const who = await identify(value);
  const old = (await loadAccounts({ fresh: true })).find((a) => a.userId === who.userId);
  if (old?.source === 'env') throw new Error(`@${who.username} 已經用 Vercel 的 ${old.envKey} 連結了。要換權杖請改 Vercel，或先刪掉那個變數。`);
  const now = Date.now();
  const account = {
    ...who,
    token: value,
    source,
    paused: Boolean(old?.paused),
    addedAt: old?.addedAt || now,
    // A token from login is brand new. A pasted one may be older: extend it within a day
    // (Instagram only refreshes tokens that are at least 24 hours old).
    refreshedAt: expiresIn ? now : now - REFRESH_EVERY_MS + DAY_MS,
    expiresAt: expiresIn ? now + Number(expiresIn) * 1000 : null,
  };
  await upsert(account);
  let subscribed = true;
  let subscribeError = null;
  try {
    await subscribe(account);
  } catch (err) {
    subscribed = false;
    subscribeError = err.message;
  }
  return {
    account, subscribed, subscribeError,
  };
};

const requireAccount = async (userId) => {
  const account = (await loadAccounts({ fresh: true })).find((a) => a.userId === String(userId));
  if (!account) throw new Error('找不到這個帳號');
  return account;
};

const setPaused = async (userId, paused) => {
  const account = await requireAccount(userId);
  await upsert({ ...account, paused: Boolean(paused) });
};

const removeAccount = async (userId) => {
  const account = await requireAccount(userId);
  if (account.source === 'env') throw new Error(`這個帳號是用 Vercel 的 ${account.envKey} 連結的，請到 Vercel 刪掉那個變數再重新部署`);
  await oneAtATime(async () => {
    const stored = await loadStored();
    await saveStored(stored.filter((a) => a.userId !== account.userId));
    cache = null;
  });
};

const shouldRefresh = (account, now = Date.now()) => Boolean(account?.token) && !account.error && (!account.refreshedAt || now - account.refreshedAt >= REFRESH_EVERY_MS);

/**
 * Asks Instagram for another 60 days for one account and keeps the new token.
 */
const refreshAccount = async (account, { force = false } = {}) => {
  if (!force && !shouldRefresh(account)) return { refreshed: false, expiresAt: account.expiresAt || null };
  const { data } = await refreshAccessToken({ token: account.token });
  const now = Date.now();
  const next = {
    ...account,
    token: data.access_token || account.token,
    refreshedAt: now,
    expiresAt: data.expires_in ? now + Number(data.expires_in) * 1000 : null,
  };
  const changed = next.token !== account.token;
  let stored = false;
  if (canSave()) {
    await upsert(next);
    stored = true;
  }
  return {
    refreshed: true, changed, stored, expiresAt: next.expiresAt,
  };
};

const resetAccounts = () => {
  cache = null;
  cachedAt = 0;
  reloadedAt = 0;
};

// What the admin page may see: never the token.
const describe = (account) => ({
  userId: account.userId,
  username: account.username,
  source: account.source,
  envKey: account.envKey || null,
  paused: Boolean(account.paused),
  addedAt: account.addedAt || null,
  refreshedAt: account.refreshedAt || null,
  expiresAt: account.expiresAt || null,
  error: account.error || null,
});

export {
  fingerprint,
  loadAccounts,
  findAccount,
  addAccount,
  setPaused,
  removeAccount,
  subscribe,
  fetchSubscription,
  shouldRefresh,
  refreshAccount,
  requireAccount,
  resetAccounts,
  describe,
};
