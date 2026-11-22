/* A tiny Redis emulator for the member API tests: just the commands the store uses. Keys expire only when a test
 * clock is given (fakeRedis({ now: () => clock })); without one, nothing ever expires. */
export function fakeRedis({ now } = {}) {
  const kv = new Map(); const sets = new Map(); const zsets = new Map(); const hashes = new Map(); const lists = new Map(); const ttl = new Map();
  const expAt = new Map();
  const sweep = (k) => {
    if (now && expAt.has(k) && expAt.get(k) <= now()) { kv.delete(k); hashes.delete(k); lists.delete(k); zsets.delete(k); sets.delete(k); ttl.delete(k); expAt.delete(k); }
  };
  const setExp = (k, sec) => { ttl.set(k, sec); if (now) expAt.set(k, now() + sec * 1000); };
  const z = (k) => { if (!zsets.has(k)) zsets.set(k, new Map()); return zsets.get(k); };
  const hm = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };
  const bound = (v) => {
    const s = String(v);
    if (s === '+inf') return [Infinity, false];
    if (s === '-inf') return [-Infinity, false];
    if (s.startsWith('(')) return [Number(s.slice(1)), true];
    return [Number(s), false];
  };
  const inRange = (sc, lo, hi) => {
    const [l, lx] = bound(lo); const [h, hx] = bound(hi);
    return (lx ? sc > l : sc >= l) && (hx ? sc < h : sc <= h);
  };
  const run = ([cmd, ...a]) => {
    sweep(cmd === 'EVAL' ? a[2] : a[0]);
    switch (cmd) {
      case 'GET': return kv.has(a[0]) ? kv.get(a[0]) : null;
      case 'SET': {
        const opts = a.slice(2).map(String);
        if (opts.includes('NX') && kv.has(a[0])) return null;
        kv.set(a[0], String(a[1]));
        const ex = opts.indexOf('EX'); if (ex >= 0) setExp(a[0], Number(opts[ex + 1])); else { ttl.delete(a[0]); expAt.delete(a[0]); }
        return 'OK';
      }
      case 'DEL': kv.delete(a[0]); hashes.delete(a[0]); lists.delete(a[0]); zsets.delete(a[0]); ttl.delete(a[0]); expAt.delete(a[0]); return 1;
      case 'INCR': { const v = Number(kv.get(a[0]) || 0) + 1; kv.set(a[0], String(v)); return v; }
      case 'INCRBY': { const v = Number(kv.get(a[0]) || 0) + Number(a[1]); kv.set(a[0], String(v)); return v; }
      case 'EXPIRE': setExp(a[0], Number(a[1])); return 1;
      case 'EXISTS': return kv.has(a[0]) ? 1 : 0;
      case 'TTL': return ttl.has(a[0]) ? ttl.get(a[0]) : -1;
      case 'EVAL': {
        const [script, , key, ...args] = a;
        if (script.includes("redis.call('INCR'")) { const v = Number(kv.get(key) || 0) + 1; kv.set(key, String(v)); if (!ttl.has(key)) setExp(key, Number(args[0])); return v; }
        if (script.includes("redis.call('LPUSH'")) {
          const l = lists.get(key) || []; l.unshift(String(args[0])); l.length = Math.min(l.length, Number(args[1])); lists.set(key, l); setExp(key, Number(args[2])); return 1;
        }
        if (script.includes("redis.call('LRANGE'")) { const l = lists.get(key) || []; lists.delete(key); return l; }
        throw new Error(`unexpected script ${script}`);
      }
      case 'SADD': { if (!sets.has(a[0])) sets.set(a[0], new Set()); sets.get(a[0]).add(a[1]); return 1; }
      case 'SCARD': return sets.has(a[0]) ? sets.get(a[0]).size : 0;
      case 'SREM': return sets.has(a[0]) && sets.get(a[0]).delete(String(a[1])) ? 1 : 0;
      case 'ZADD': z(a[0]).set(String(a[2]), Number(a[1])); return 1;
      case 'ZREM': return z(a[0]).delete(String(a[1])) ? 1 : 0;
      case 'ZSCORE': return z(a[0]).has(String(a[1])) ? String(z(a[0]).get(String(a[1]))) : null;
      case 'ZCOUNT': return [...z(a[0]).values()].filter((s) => inRange(s, a[1], a[2])).length;
      case 'ZREMRANGEBYSCORE': { const m = z(a[0]); let n = 0; [...m].forEach(([k, s]) => { if (inRange(s, a[1], a[2])) { m.delete(k); n += 1; } }); return n; }
      case 'ZREVRANGEBYSCORE': {
        const lim = a.indexOf('LIMIT');
        const rows = [...z(a[0])].filter(([, s]) => inRange(s, a[2], a[1])).sort((x, y) => y[1] - x[1]).map(([k]) => k);
        return lim >= 0 ? rows.slice(Number(a[lim + 1]), Number(a[lim + 1]) + Number(a[lim + 2])) : rows;
      }
      case 'ZRANGEBYSCORE': {
        const lim = a.indexOf('LIMIT');
        const rows = [...z(a[0])].filter(([, s]) => inRange(s, a[1], a[2])).sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1));
        const cut = lim >= 0 ? rows.slice(Number(a[lim + 1]), Number(a[lim + 1]) + Number(a[lim + 2])) : rows;
        return a.includes('WITHSCORES') ? cut.flatMap(([k, s]) => [k, String(s)]) : cut.map(([k]) => k);
      }
      case 'HSET': hm(a[0]).set(String(a[1]), String(a[2])); return 1;
      case 'HGET': return hm(a[0]).has(a[1]) ? String(hm(a[0]).get(a[1])) : null;
      case 'HGETALL': return [...hm(a[0])].flat();
      case 'HDEL': return hm(a[0]).delete(String(a[1])) ? 1 : 0;
      case 'HLEN': return hm(a[0]).size;
      case 'HEXISTS': return hm(a[0]).has(a[1]) ? 1 : 0;
      case 'HINCRBY': { const v = Number(hm(a[0]).get(String(a[1])) || 0) + Number(a[2]); hm(a[0]).set(String(a[1]), String(v)); return v; }
      default: throw new Error(`unsupported ${cmd}`);
    }
  };
  return { kv, ttl, lists, post: async (url, args) => ({ data: { result: run(args) } }) };
}

