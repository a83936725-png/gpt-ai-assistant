/* Storage for the mom-app member API.
 * - RedisRestStore: Vercel KV / Upstash Redis over REST (persistent, shared by all serverless instances)
 * - MemoryStore: in-process (local development and tests; resets on restart)
 * Keys are prefixed with "mom:" so they never collide with anything else in the same database. */
import axios from 'axios';

export class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.users = new Map(); // id -> user
    this.accounts = new Map(); // account -> id
    this.codes = new Map(); // referral code -> id
    this.presence = new Map(); // sid -> ts
    this.signups = []; // [ts]
    this.referrals = new Map(); // code -> count
    this.counters = new Map(); // key -> {n, reset}
    this.tv = new Map(); // user id -> token version (kept apart from the user record, see RedisRestStore)
    this.flags = new Map(); // key -> expiry ts
    this.kv = new Map(); this.hashes = new Map(); this.lists = new Map(); this.zsets = new Map(); this.exp = new Map(); // social features
  }

  async getTokenVersion(id, fallback = 0) { return this.tv.has(id) ? this.tv.get(id) : fallback; }

  async bumpTokenVersion(id, current = 0) { const v = (this.tv.has(id) ? this.tv.get(id) : current) + 1; this.tv.set(id, v); return v; }

  // short-lived marks: trusted device for an account, one-time LINE state
  async setFlag(key, ttlSec, now = Date.now()) {
    if (this.flags.size > 20000) this.flags.forEach((exp, k) => { if (exp <= now) this.flags.delete(k); });
    this.flags.set(key, now + ttlSec * 1000);
  }

  async hasFlag(key, now = Date.now()) { const exp = this.flags.get(key); return !!exp && exp > now; }

  // true only the first time a key is claimed within ttl
  async claimOnce(key, ttlSec, now = Date.now()) {
    if (await this.hasFlag(key, now)) return false;
    await this.setFlag(key, ttlSec, now);
    return true;
  }

  async hasPresence(sid) { return this.presence.has(sid); }

  // fixed-window counter shared by every request this process handles (Redis version is shared across instances)
  async hit(key, windowSec, now = Date.now()) {
    if (this.counters.size > 20000) this.counters.forEach((v, k) => { if (v.reset <= now) this.counters.delete(k); });
    const c = this.counters.get(key);
    if (!c || c.reset <= now) { this.counters.set(key, { n: 1, reset: now + windowSec * 1000 }); return 1; }
    c.n += 1;
    return c.n;
  }

  async getUser(id) { return this.users.get(id) || null; }

  async getUserByAccount(account) { const id = this.accounts.get(account); return id ? this.users.get(id) : null; }

  async getUserByCode(code) { const id = this.codes.get(code); return id ? this.users.get(id) : null; }

  async createUser(user) {
    if (this.accounts.has(user.account)) return false;
    this.users.set(user.id, user);
    this.accounts.set(user.account, user.id);
    if (user.code) this.codes.set(user.code, user.id);
    this.signups.push(user.createdAt);
    return true;
  }

  async updateUser(id, patch) {
    const u = this.users.get(id);
    if (!u) return null;
    Object.assign(u, patch);
    return u;
  }

  async codeTaken(code) { return this.codes.has(code); }

  async countUsers() { return this.users.size; }

  async countSignupsSince(ts) { return this.signups.filter((t) => t >= ts).length; }

  async touchPresence(sid, ts) { this.presence.set(sid, ts); }

  async countOnline(sinceTs) {
    let n = 0;
    this.presence.forEach((ts, sid) => { if (ts >= sinceTs) n += 1; else if (ts < sinceTs - 3600e3) this.presence.delete(sid); });
    return n;
  }

  async addReferral(code) { this.referrals.set(code, (this.referrals.get(code) || 0) + 1); }

  async countReferrals(code) { return this.referrals.get(code) || 0; }

  /* ---- small generic helpers for the social features (島上的媽媽, 祝福牆) ---- */
  gone(key, now = Date.now()) {
    const e = this.exp.get(key);
    if (e && e <= now) { this.exp.delete(key); this.kv.delete(key); this.hashes.delete(key); this.lists.delete(key); this.zsets.delete(key); return true; }
    return false;
  }

  expire(key, ttlSec, now = Date.now()) { if (ttlSec) this.exp.set(key, now + ttlSec * 1000); }

  async getJson(key, now = Date.now()) { if (this.gone(key, now)) return null; const v = this.kv.get(key); return v === undefined ? null : JSON.parse(v); }

  async setJson(key, value, ttlSec = 0, now = Date.now()) { this.kv.set(key, JSON.stringify(value)); if (ttlSec) this.expire(key, ttlSec, now); else this.exp.delete(key); }

  async del(key) { this.kv.delete(key); this.hashes.delete(key); this.lists.delete(key); this.zsets.delete(key); this.exp.delete(key); }

  async incrBy(key, by = 1, ttlSec = 0, now = Date.now()) {
    this.gone(key, now);
    const v = Number(this.kv.get(key) || 0) + by; this.kv.set(key, String(v));
    if (ttlSec) this.expire(key, ttlSec, now);
    return v;
  }

  async getNum(key, now = Date.now()) { if (this.gone(key, now)) return 0; return Number(this.kv.get(key) || 0); }

  async hsetJson(key, field, value, ttlSec = 0, now = Date.now()) {
    this.gone(key, now);
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    this.hashes.get(key).set(field, JSON.stringify(value));
    if (ttlSec) this.expire(key, ttlSec, now);
  }

  async hgetJson(key, field, now = Date.now()) { if (this.gone(key, now)) return null; const m = this.hashes.get(key); return m && m.has(field) ? JSON.parse(m.get(field)) : null; }

  async hgetAllJson(key, now = Date.now()) {
    if (this.gone(key, now)) return {};
    const out = {}; (this.hashes.get(key) || new Map()).forEach((v, k) => { out[k] = JSON.parse(v); });
    return out;
  }

  async hdel(key, field) { const m = this.hashes.get(key); if (m) m.delete(field); }

  async hlen(key, now = Date.now()) { if (this.gone(key, now)) return 0; return (this.hashes.get(key) || new Map()).size; }

  async pushCapped(key, value, max, ttlSec, now = Date.now()) {
    this.gone(key, now);
    const l = this.lists.get(key) || []; l.unshift(JSON.stringify(value)); l.length = Math.min(l.length, max);
    this.lists.set(key, l); this.expire(key, ttlSec, now);
  }

  async drain(key, now = Date.now()) { if (this.gone(key, now)) return []; const l = this.lists.get(key) || []; this.lists.delete(key); this.exp.delete(key); return l.map((v) => JSON.parse(v)); }

  async zset(key, member, score) { if (!this.zsets.has(key)) this.zsets.set(key, new Map()); this.zsets.get(key).set(member, score); }

  async zrem(key, member) { const m = this.zsets.get(key); if (m) m.delete(member); }

  // members scored ≥ since, newest first; older ones are dropped
  async zrecent(key, since, limit = 50) {
    const m = this.zsets.get(key); if (!m) return [];
    [...m].forEach(([k, sc]) => { if (sc < since) m.delete(k); });
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k);
  }

  async zcountSince(key, since) { const m = this.zsets.get(key); if (!m) return 0; let n = 0; m.forEach((sc) => { if (sc >= since) n += 1; }); return n; }
}

export class RedisRestStore {
  constructor({ url, token, http = axios }) {
    this.kind = 'redis';
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.http = http;
  }

  async cmd(...args) {
    const { data } = await this.http.post(this.url, args, { headers: { Authorization: `Bearer ${this.token}` }, timeout: 5000 });
    if (data && data.error) throw new Error(data.error);
    return data ? data.result : null;
  }

  async getUser(id) { const v = await this.cmd('GET', `mom:user:${id}`); return v ? JSON.parse(v) : null; }

  async getUserByAccount(account) { const id = await this.cmd('GET', `mom:acct:${account}`); return id ? this.getUser(id) : null; }

  async getUserByCode(code) { const id = await this.cmd('HGET', 'mom:codes', code); return id ? this.getUser(id) : null; }

  async createUser(user) {
    const ok = await this.cmd('SET', `mom:acct:${user.account}`, user.id, 'NX'); // atomic uniqueness
    if (ok !== 'OK') return false;
    await this.cmd('SET', `mom:user:${user.id}`, JSON.stringify(user));
    await this.cmd('SADD', 'mom:users', user.id);
    await this.cmd('ZADD', 'mom:signups', user.createdAt, user.id);
    if (user.code) await this.cmd('HSET', 'mom:codes', user.code, user.id);
    return true;
  }

  async updateUser(id, patch) {
    const u = await this.getUser(id);
    if (!u) return null;
    Object.assign(u, patch);
    await this.cmd('SET', `mom:user:${id}`, JSON.stringify(u));
    return u;
  }

  async codeTaken(code) { return !!(await this.cmd('HEXISTS', 'mom:codes', code)); }

  async countUsers() { return Number(await this.cmd('SCARD', 'mom:users')) || 0; }

  async countSignupsSince(ts) { return Number(await this.cmd('ZCOUNT', 'mom:signups', ts, '+inf')) || 0; }

  async touchPresence(sid, ts) { await this.cmd('ZADD', 'mom:presence', ts, sid); }

  async countOnline(sinceTs) {
    await this.cmd('ZREMRANGEBYSCORE', 'mom:presence', '-inf', sinceTs - 3600e3);
    return Number(await this.cmd('ZCOUNT', 'mom:presence', sinceTs, '+inf')) || 0;
  }

  async addReferral(code) { await this.cmd('HINCRBY', 'mom:referrals', code, 1); }

  // INCR and EXPIRE in one atomic step: if the expiry were set by a second call that failed, the counter would
  // never reset and that account or address would stay locked out for good
  async hit(key, windowSec) {
    return Number(await this.cmd('EVAL', "local n = redis.call('INCR', KEYS[1]) if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n", 1, `mom:rl:${key}`, windowSec));
  }

  // The token version lives in its own key and only ever goes up (INCR). updateUser rewrites the whole user record,
  // so if the version were a field of it, a request in flight could write the old version back and silently undo
  // 「登出所有裝置」. Users created before this keep their version in the record until the first bump copies it over.
  async getTokenVersion(id, fallback = 0) { const v = await this.cmd('GET', `mom:tv:${id}`); return v === null || v === undefined ? fallback : Number(v); }

  async bumpTokenVersion(id, current = 0) {
    await this.cmd('SET', `mom:tv:${id}`, String(current), 'NX');
    return Number(await this.cmd('INCR', `mom:tv:${id}`));
  }

  async setFlag(key, ttlSec) { await this.cmd('SET', `mom:flag:${key}`, '1', 'EX', ttlSec); }

  async hasFlag(key) { return !!(await this.cmd('EXISTS', `mom:flag:${key}`)); }

  async claimOnce(key, ttlSec) { return (await this.cmd('SET', `mom:flag:${key}`, '1', 'EX', ttlSec, 'NX')) === 'OK'; }

  async hasPresence(sid) { return (await this.cmd('ZSCORE', 'mom:presence', sid)) !== null; }

  async countReferrals(code) { return Number(await this.cmd('HGET', 'mom:referrals', code)) || 0; }

  /* ---- small generic helpers for the social features (島上的媽媽, 祝福牆); keys live under mom:x: ---- */
  async getJson(key) { const v = await this.cmd('GET', `mom:x:${key}`); return v ? JSON.parse(v) : null; }

  async setJson(key, value, ttlSec = 0) { if (ttlSec) await this.cmd('SET', `mom:x:${key}`, JSON.stringify(value), 'EX', ttlSec); else await this.cmd('SET', `mom:x:${key}`, JSON.stringify(value)); }

  async del(key) { await this.cmd('DEL', `mom:x:${key}`); }

  async incrBy(key, by = 1, ttlSec = 0) {
    const v = Number(await this.cmd('INCRBY', `mom:x:${key}`, by));
    if (ttlSec) await this.cmd('EXPIRE', `mom:x:${key}`, ttlSec);
    return v;
  }

  async getNum(key) { return Number(await this.cmd('GET', `mom:x:${key}`)) || 0; }

  async hsetJson(key, field, value, ttlSec = 0) {
    await this.cmd('HSET', `mom:x:${key}`, field, JSON.stringify(value));
    if (ttlSec) await this.cmd('EXPIRE', `mom:x:${key}`, ttlSec);
  }

  async hgetJson(key, field) { const v = await this.cmd('HGET', `mom:x:${key}`, field); return v ? JSON.parse(v) : null; }

  async hgetAllJson(key) {
    const flat = (await this.cmd('HGETALL', `mom:x:${key}`)) || [];
    const out = {};
    if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
    else Object.entries(flat).forEach(([k, v]) => { out[k] = JSON.parse(v); });
    return out;
  }

  async hdel(key, field) { await this.cmd('HDEL', `mom:x:${key}`, field); }

  async hlen(key) { return Number(await this.cmd('HLEN', `mom:x:${key}`)) || 0; }

  async pushCapped(key, value, max, ttlSec) {
    await this.cmd('EVAL', "redis.call('LPUSH', KEYS[1], ARGV[1]) redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1) redis.call('EXPIRE', KEYS[1], ARGV[3]) return 1", 1, `mom:x:${key}`, JSON.stringify(value), max, ttlSec);
  }

  // read and empty in one step, so a reaction is never shown twice or lost between two phones
  async drain(key) {
    const l = (await this.cmd('EVAL', "local v = redis.call('LRANGE', KEYS[1], 0, -1) redis.call('DEL', KEYS[1]) return v", 1, `mom:x:${key}`)) || [];
    return l.map((v) => JSON.parse(v));
  }

  async zset(key, member, score) { await this.cmd('ZADD', `mom:x:${key}`, score, member); }

  async zrem(key, member) { await this.cmd('ZREM', `mom:x:${key}`, member); }

  async zrecent(key, since, limit = 50) {
    await this.cmd('ZREMRANGEBYSCORE', `mom:x:${key}`, '-inf', `(${since}`);
    return (await this.cmd('ZREVRANGEBYSCORE', `mom:x:${key}`, '+inf', since, 'LIMIT', 0, limit)) || [];
  }

  async zcountSince(key, since) { return Number(await this.cmd('ZCOUNT', `mom:x:${key}`, since, '+inf')) || 0; }
}

export function storeFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisRestStore({ url, token });
  return new MemoryStore();
}
