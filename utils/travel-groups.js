import { get, put } from '@vercel/blob';
import { createHash, randomBytes } from 'crypto';
import config from '../config/index.js';

// 揪團: an invitation to a trip (destination, date options, cost per person, the day-by-day plan) and the
// friends who signed up. Anyone with the link can read it and add their nickname, so it holds no more than
// the organiser chose to share. Stored in the travel Vercel Blob store, in memory without a token.
const memory = new Map();
const useBlob = () => Boolean(config.TRAVEL_BLOB_TOKEN);
const token = () => config.TRAVEL_BLOB_TOKEN;

export const GROUP_ID = /^[a-z0-9]{10}$/;
export const GROUP_MAX_MEMBERS = 60;
export const GROUP_MAX_BYTES = 24 * 1024;

/** status 400 bad input, 403 not the organiser, 404 no such group, 409 closed or full */
export class GroupError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v);
const int = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Keeps the invitation's known fields, trimmed and capped. */
export const cleanInvite = (inv) => {
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) throw new GroupError('揪團資料不正確', 400);
  const options = (Array.isArray(inv.o) ? inv.o : [])
    .filter((o) => Array.isArray(o) && isDate(o[0]) && isDate(o[1]) && o[0] <= o[1]).slice(0, 3).map(([a, b]) => [a, b]);
  const out = {
    v: 1,
    d: str(inv.d, 40),
    c: str(inv.c, 30),
    n: str(inv.n, 8),
    la: Number.isFinite(Number(inv.la)) && Math.abs(Number(inv.la)) <= 90 ? Number(inv.la) : null,
    lo: Number.isFinite(Number(inv.lo)) && Math.abs(Number(inv.lo)) <= 180 ? Number(inv.lo) : null,
    o: options,
    days: int(inv.days, 1, 30, 5),
    p: int(inv.p, 0, 2000000, 0),
    t: int(inv.t, 2, 30, 4),
    dl: isDate(inv.dl) ? inv.dl : '',
    m: str(inv.m, 300),
    h: str(inv.h, 20),
    tags: (Array.isArray(inv.tags) ? inv.tags : []).slice(0, 4).map((x) => str(x, 12)).filter(Boolean),
    pl: (Array.isArray(inv.pl) ? inv.pl : []).slice(0, 14)
      .map((day) => (Array.isArray(day) ? day.slice(0, 8).map((x) => str(x, 40)).filter(Boolean) : [])),
  };
  if (!out.c) throw new GroupError('請選擇目的地', 400);
  if (!out.o.length) throw new GroupError('請至少選一個日期', 400);
  return out;
};

const pathOf = (id) => `travel/groups/${id}.json`;
const readText = async (stream) => {
  const chunks = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};
const load = async (id) => {
  if (!useBlob()) return memory.get(id) || null;
  const result = await get(pathOf(id), { access: 'private', useCache: false, token: token() });
  return result ? JSON.parse(await readText(result.stream)) : null;
};
const store = async (id, group) => {
  if (!useBlob()) {
    memory.set(id, group);
    return;
  }
  await put(pathOf(id), JSON.stringify(group), {
    access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json', token: token(),
  });
};
const hashKey = (key) => createHash('sha256').update(String(key || '')).digest('hex');
// What anyone with the link sees: the invitation and the nicknames that joined (never their client ids).
const view = (g) => ({
  invite: g.invite,
  members: g.members.map(({
    name, opts, msg, at,
  }) => ({
    name, opts, msg, at,
  })),
  closed: g.closed,
  createdAt: g.createdAt,
});
const find = async (id) => {
  if (!GROUP_ID.test(id || '')) throw new GroupError('找不到這個揪團', 404);
  const g = await load(id);
  if (!g) throw new GroupError('找不到這個揪團', 404);
  return g;
};

export const createGroup = async (invite) => {
  const clean = cleanInvite(invite);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const id = Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join('');
  const key = randomBytes(16).toString('hex');
  const group = {
    invite: { ...clean, g: id }, members: [], closed: false, createdAt: Date.now(), keyHash: hashKey(key),
  };
  await store(id, group);
  return { id, key, group: view(group) };
};

export const readGroup = async (id) => view(await find(id));

/** Joining again with the same client id updates that entry (a changed nickname or date choice). */
export const joinGroup = async (id, body = {}) => {
  const who = typeof body.who === 'string' ? body.who : '';
  if (!/^[\w-]{8,40}$/.test(who)) throw new GroupError('報名資料不正確', 400);
  const name = str(body.name, 20);
  if (!name) throw new GroupError('請填你的暱稱', 400);
  const g = await find(id);
  if (g.closed) throw new GroupError('這個揪團已經截止報名', 409);
  const others = g.members.filter((m) => m.who !== who);
  if (others.length >= GROUP_MAX_MEMBERS) throw new GroupError('名額已滿', 409);
  const before = g.members.find((m) => m.who === who);
  const opts = [...new Set((Array.isArray(body.opts) ? body.opts : []).map(Number)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < g.invite.o.length))];
  g.members = [...others, {
    who, name, opts, msg: str(body.msg, 120), at: before?.at || Date.now(),
  }].sort((a, b) => a.at - b.at);
  await store(id, g);
  return view(g);
};

export const leaveGroup = async (id, who) => {
  const g = await find(id);
  g.members = g.members.filter((m) => m.who !== who);
  await store(id, g);
  return view(g);
};

/** Only the organiser, who holds the key returned at creation, can close or reopen sign-ups. */
export const closeGroup = async (id, key, closed) => {
  const g = await find(id);
  if (hashKey(key) !== g.keyHash) throw new GroupError('只有發起人可以修改', 403);
  g.closed = Boolean(closed);
  await store(id, g);
  return view(g);
};

export const resetGroups = () => memory.clear();
