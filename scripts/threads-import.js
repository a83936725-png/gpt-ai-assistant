/* eslint-disable no-console */
/**
 * Adds every post and reply from a Threads data export to data/esim-threads.json.
 *
 * 1. Threads app → 設定 → 帳號 → 下載你的資訊（或 Meta 帳號管理中心 → 你的資訊和權限 → 下載你的資訊），
 *    choose Threads and the JSON format, then unzip the file you receive.
 * 2. node scripts/threads-import.js <unzipped folder or .json files>
 *
 * The export layout changes from time to time, so this reads every JSON file it is given and keeps
 * any text that has a timestamp next to it. Items already in the database are skipped.
 */
import {
  existsSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'fs';
import path from 'path';

const DB = path.join(process.cwd(), 'data', 'esim-threads.json');
const TEXT_KEYS = ['title', 'text', 'caption', 'value'];
const TIME_KEYS = ['creation_timestamp', 'timestamp', 'taken_at'];

// Meta exports store UTF-8 text as Latin-1 escapes (e.g. "Ã¦Â\u0097Â¥"); turn it back into Chinese.
const fixText = (s) => (/[À-ÿ][\u0080-¿]/.test(s) ? Buffer.from(s, 'latin1').toString('utf8') : s);

const jsonFiles = (target) => {
  if (!existsSync(target)) throw new Error(`Not found: ${target}`);
  if (statSync(target).isDirectory()) return readdirSync(target).flatMap((f) => jsonFiles(path.join(target, f)));
  return target.endsWith('.json') ? [target] : [];
};

const collect = (node, out, depth = 0) => {
  if (!node || typeof node !== 'object' || depth > 20) return;
  if (Array.isArray(node)) { node.forEach((x) => collect(x, out, depth + 1)); return; }
  const textKey = TEXT_KEYS.find((k) => typeof node[k] === 'string' && node[k].trim().length > 1);
  const timeKey = TIME_KEYS.find((k) => typeof node[k] === 'number');
  if (textKey && timeKey) {
    const ms = node[timeKey] > 1e12 ? node[timeKey] : node[timeKey] * 1000;
    out.push({ text: fixText(node[textKey]).trim(), date: new Date(ms).toISOString().slice(0, 10), url: typeof node.uri === 'string' ? node.uri : undefined });
  }
  Object.values(node).forEach((v) => collect(v, out, depth + 1));
};

const main = () => {
  const targets = process.argv.slice(2);
  if (!targets.length) {
    console.log('Usage: node scripts/threads-import.js <unzipped export folder or .json files>');
    process.exit(1);
  }
  const db = JSON.parse(readFileSync(DB, 'utf8'));
  const known = new Set(db.items.map((x) => (x.answer || x.text || '').trim()));
  const found = [];
  targets.flatMap(jsonFiles).forEach((file) => collect(JSON.parse(readFileSync(file, 'utf8')), found));
  let added = 0;
  found.forEach((item, i) => {
    if (known.has(item.text)) return;
    known.add(item.text);
    db.items.push({
      id: `export-${item.date}-${i}`, type: 'export', date: item.date, url: item.url, topic: '', tags: [], text: item.text,
    });
    added += 1;
  });
  db.collected = new Date().toISOString().slice(0, 10);
  writeFileSync(DB, `${JSON.stringify(db, null, 2)}\n`);
  console.log(`Found ${found.length} posts and replies, added ${added} new ones to ${path.relative(process.cwd(), DB)}`);
};

main();
