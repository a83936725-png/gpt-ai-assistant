import {
  del, get, list, put,
} from '@vercel/blob';
import config from '../config/index.js';
import { IKIGAI_CIRCLES, IkigaiInputError } from './analyze-ikigai.js';

const KEYS = IKIGAI_CIRCLES.map(({ key }) => key);
const PREFIX = 'ikigai/records/';
const HORIZONS = ['d30', 'd90', 'y1'];

// Records live in a private Vercel Blob store when IKIGAI_BLOB_READ_WRITE_TOKEN is set,
// otherwise in memory (local development and tests).
const memory = new Map();
const useBlob = () => Boolean(config.IKIGAI_BLOB_TOKEN);

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const score = (v) => Math.min(5, Math.max(1, Math.round(Number(v)) || 3));
const isId = (id) => typeof id === 'string' && /^[a-z0-9]{12,40}$/.test(id);
const readText = async (stream) => {
  const chunks = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * Validates what the page sends. Only records the visitor agreed to share are accepted.
 * @param {Object} body
 * @param {{ country?: string, city?: string, userAgent?: string }} meta Added by the server.
 */
export const sanitizeRecord = (body, meta = {}) => {
  if (!body || typeof body !== 'object') throw new IkigaiInputError('沒有資料');
  if (!isId(body.id)) throw new IkigaiInputError('資料編號不正確');
  const p = body.profile || {};
  if (p.consent !== true) throw new IkigaiInputError('需要先同意提供資料');
  const profile = {
    name: str(p.name, 40),
    contact: str(p.contact, 80),
    email: str(p.email, 120),
    consentAt: num(p.consentAt),
  };
  if (!profile.name) throw new IkigaiInputError('請填寫姓名');
  if (!profile.contact && !profile.email) throw new IkigaiInputError('請至少留一種聯絡方式');
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 80)
    .map((it) => ({ text: str(it?.text, 60), c: Object.fromEntries(KEYS.map((k) => [k, Boolean(it?.c?.[k])])) }))
    .filter((it) => it.text && KEYS.some((k) => it.c[k]));
  const plan = body.plan && typeof body.plan === 'object' ? body.plan : {};
  const dirs = (Array.isArray(plan.dirs) ? plan.dirs : []).slice(0, 3)
    .map((d) => ({ title: str(d?.title, 60), main: Boolean(d?.main), s: Object.fromEntries(KEYS.map((k) => [k, score(d?.s?.[k])])) }))
    .filter((d) => d.title);
  const insights = body.insights && typeof body.insights === 'object' ? body.insights : {};
  return {
    id: body.id,
    version: 1,
    startedAt: num(body.startedAt),
    updatedAt: Date.now(),
    profile,
    step: str(body.step, 20),
    items,
    note: text(body.note, 300),
    plan: {
      dirs,
      goals: Object.fromEntries(HORIZONS.map((h) => [h, str(plan.goals?.[h], 200)])),
      actions: (Array.isArray(plan.actions) ? plan.actions : []).slice(0, 30)
        .map((a) => ({ text: str(a?.text, 80), h: HORIZONS.includes(a?.h) ? a.h : 'd30', done: Boolean(a?.done) }))
        .filter((a) => a.text),
    },
    insights: {
      careers: (Array.isArray(insights.careers) ? insights.careers : []).slice(0, 6)
        .map((c) => ({ name: str(c?.name, 40), circles: (Array.isArray(c?.circles) ? c.circles : []).filter((k) => KEYS.includes(k)) }))
        .filter((c) => c.name),
      paths: (Array.isArray(insights.paths) ? insights.paths : []).slice(0, 3)
        .map((x) => ({ title: str(x?.title, 20), career: str(x?.career, 40) })).filter((x) => x.career),
      skills: (Array.isArray(insights.skills) ? insights.skills : []).slice(0, 8).map((s) => str(s, 40)).filter(Boolean),
      weakest: KEYS.includes(insights.weakest) ? insights.weakest : '',
    },
    ai: text(body.ai, 8000),
    referredBy: isId(body.referredBy) && body.referredBy !== body.id ? body.referredBy : '',
    source: str(body.source, 20),
    events: (Array.isArray(body.events) ? body.events : []).slice(-300)
      .map((e) => ({ t: num(e?.t), type: str(e?.type, 30), detail: str(e?.detail, 80) }))
      .filter((e) => e.t && e.type),
    meta: {
      country: str(meta.country, 8),
      city: str(meta.city, 60),
      userAgent: str(meta.userAgent, 200),
    },
  };
};

const pathOf = (id) => `${PREFIX}${id}.json`;

export const saveRecord = async (record) => {
  if (!useBlob()) {
    memory.set(record.id, record);
    return;
  }
  await put(pathOf(record.id), JSON.stringify(record), {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
    token: config.IKIGAI_BLOB_TOKEN,
  });
};

export const getRecord = async (id) => {
  if (!isId(id)) return null;
  if (!useBlob()) return memory.get(id) || null;
  const result = await get(pathOf(id), { access: 'private', useCache: false, token: config.IKIGAI_BLOB_TOKEN });
  if (!result) return null;
  return JSON.parse(await readText(result.stream));
};

export const listRecords = async () => {
  if (!useBlob()) return [...memory.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const blobs = [];
  let cursor;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await list({
      prefix: PREFIX, cursor, limit: 1000, token: config.IKIGAI_BLOB_TOKEN,
    });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && blobs.length < 5000);
  const records = [];
  for (let i = 0; i < blobs.length; i += 20) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await Promise.all(blobs.slice(i, i + 20).map(async (b) => {
      try {
        const result = await get(b.pathname, { access: 'private', useCache: false, token: config.IKIGAI_BLOB_TOKEN });
        return result ? JSON.parse(await readText(result.stream)) : null;
      } catch (err) {
        console.error(`[ikigai] read ${b.pathname}: ${err.message}`);
        return null;
      }
    }));
    records.push(...batch.filter(Boolean));
  }
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
};

export const deleteRecord = async (id) => {
  if (!isId(id)) return;
  if (!useBlob()) {
    memory.delete(id);
    return;
  }
  await del(pathOf(id), { token: config.IKIGAI_BLOB_TOKEN });
};

export const clearMemoryRecords = () => memory.clear();

const STEP_LABELS = {
  intro: '介紹', love: '熱愛', good: '擅長', need: '世界需要', paid: '報酬', match: '交集對照', result: '結果', plan: '生涯規劃',
};

/** One row per record for the admin list and the CSV export. */
export const summarize = (r) => {
  const inCircle = (k) => r.items.filter((it) => it.c[k]).map((it) => it.text);
  const center = r.items.filter((it) => KEYS.every((k) => it.c[k])).map((it) => it.text);
  const main = r.plan.dirs.find((d) => d.main) || r.plan.dirs[0];
  return {
    id: r.id,
    startedAt: r.startedAt,
    updatedAt: r.updatedAt,
    name: r.profile.name,
    contact: r.profile.contact,
    email: r.profile.email,
    step: STEP_LABELS[r.step] || r.step,
    counts: Object.fromEntries(KEYS.map((k) => [k, inCircle(k).length])),
    circles: Object.fromEntries(KEYS.map((k) => [k, inCircle(k)])),
    center,
    careers: r.insights.careers.map((c) => c.name),
    mainDirection: main ? main.title : '',
    goals: r.plan.goals,
    actionsDone: r.plan.actions.filter((a) => a.done).length,
    actionsTotal: r.plan.actions.length,
    hasAnalysis: Boolean(r.ai),
    note: r.note,
    location: [r.meta.city, r.meta.country].filter(Boolean).join(', '),
    referredBy: r.referredBy || '',
    source: r.source || '',
    device: r.meta.userAgent,
  };
};

const BOM = String.fromCharCode(0xfeff);
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const fmt = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '');

export const toCsv = (records, { referrals = new Map(), names = new Map() } = {}) => {
  const head = ['建立時間 (UTC)', '更新時間 (UTC)', '姓名', '手機/LINE', 'Email', '目前步驟', '熱愛', '擅長', '世界需要', '報酬',
    'IKIGAI 中心', '建議職業', '主要方向', '30 天目標', '90 天目標', '1 年目標', '行動完成', '補充說明', '推薦人', '來源', '帶來人數', '地區', '裝置'];
  const rows = records.map(summarize).map((s) => [
    fmt(s.startedAt), fmt(s.updatedAt), s.name, s.contact, s.email, s.step,
    s.circles.love.join('、'), s.circles.good.join('、'), s.circles.need.join('、'), s.circles.paid.join('、'),
    s.center.join('、'), s.careers.join('、'), s.mainDirection, s.goals.d30, s.goals.d90, s.goals.y1,
    `${s.actionsDone}/${s.actionsTotal}`, s.note, names.get(s.referredBy) || (s.referredBy ? '（已刪除）' : ''), s.source,
    referrals.get(s.id) || 0, s.location, s.device,
  ]);
  // The byte order mark lets Excel open the file as UTF-8.
  return `${BOM}${[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
};
