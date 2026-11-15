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
  }

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

  async hit(key, windowSec) {
    const n = Number(await this.cmd('INCR', `mom:rl:${key}`));
    if (n === 1) await this.cmd('EXPIRE', `mom:rl:${key}`, windowSec);
    return n;
  }

  async countReferrals(code) { return Number(await this.cmd('HGET', 'mom:referrals', code)) || 0; }
}

export function storeFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisRestStore({ url, token });
  return new MemoryStore();
}
