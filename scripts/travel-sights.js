/* eslint-disable no-await-in-loop, no-restricted-syntax, no-console */
/**
 * Builds web/travel-sights.json from scripts/travel-sights-list.js: for each famous sight, its photo
 * (Wikimedia Commons, with author and license), its coordinates and its Wikipedia page, looked up on
 * English Wikipedia 40 titles per request.
 *
 *   node scripts/travel-sights.js
 *
 * Non-free images are dropped (the sight keeps its name and place). Uses curl, which goes through the
 * proxy that Node's fetch ignores. Answers are kept in TRAVEL_SIGHTS_CACHE (default .travel-sights-cache.json)
 * so a run stopped by Wikipedia's rate limit picks up where it left off.
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import SIGHTS from './travel-sights-list.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'TravelSightsManifest/1.0 (one-off build script; low volume)';
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const CACHE = process.env.TRAVEL_SIGHTS_CACHE || path.join(ROOT, '.travel-sights-cache.json');
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  if (cache[url]) return cache[url];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const out = execFileSync('curl', ['-sS', '--fail-with-body', '-A', UA, url], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
      cache[url] = JSON.parse(out);
      writeFileSync(CACHE, JSON.stringify(cache));
      return cache[url];
    } catch (err) {
      const limited = /\b429\b/.test(err.message);
      console.warn(`retry ${attempt + 1}${limited ? ' (rate limited)' : ''}`);
      await sleep((limited ? 30000 : 5000) * (attempt + 1));
    }
  }
  throw new Error('Wikipedia did not answer; run again later to continue from the cache');
}

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const plain = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  .slice(0, 80);

async function main() {
  const titles = [...new Set(Object.values(SIGHTS).flat().map((s) => s[1]))];
  const pages = {};
  for (const part of chunks(titles, 40)) {
    const data = await api({
      action: 'query', redirects: '1', prop: 'coordinates|pageimages', piprop: 'name', titles: part.join('|'),
    });
    const alias = {};
    [...(data.query.normalized || []), ...(data.query.redirects || [])].forEach((r) => { alias[r.from] = r.to; });
    const byTitle = Object.fromEntries(data.query.pages.map((p) => [p.title, p]));
    part.forEach((t) => {
      let name = t;
      for (let i = 0; i < 3 && alias[name]; i += 1) name = alias[name];
      pages[t] = byTitle[name] || null;
    });
    process.stdout.write('.');
    await sleep(1500);
  }
  const files = [...new Set(Object.values(pages).map((p) => p?.pageimage).filter(Boolean))];
  const images = {};
  for (const part of chunks(files, 40)) {
    const data = await api({
      action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '960', titles: part.map((f) => `File:${f}`).join('|'),
    });
    const alias = {};
    (data.query.normalized || []).forEach((r) => { alias[r.to] = r.from; });
    data.query.pages.forEach((p) => {
      const info = p.imageinfo?.[0];
      const meta = info?.extmetadata || {};
      if (!info || meta.NonFree?.value === 'true') return;
      const file = (alias[p.title] || p.title).replace(/^File:/, '');
      images[file.replace(/ /g, '_')] = {
        src: info.thumburl || info.url, page: info.descriptionurl, author: plain(meta.Artist?.value), license: plain(meta.LicenseShortName?.value),
      };
    });
    process.stdout.write('+');
    await sleep(1500);
  }
  const missing = [];
  const out = {};
  Object.entries(SIGHTS).forEach(([code, list]) => {
    out[code] = list.map(([name, title, blurb]) => {
      const p = pages[title];
      if (!p || p.missing) missing.push(`${code} ${title}`);
      const c = p?.coordinates?.[0];
      const img = p?.pageimage ? images[p.pageimage.replace(/ /g, '_')] : null;
      return {
        n: name, b: blurb, t: p?.title || title, ...(c ? { lat: Math.round(c.lat * 1e4) / 1e4, lng: Math.round(c.lon * 1e4) / 1e4 } : {}), ...(img ? { img } : {}),
      };
    });
  });
  writeFileSync(path.join(ROOT, 'web/travel-sights.json'), `${JSON.stringify({ source: 'English Wikipedia and Wikimedia Commons', sights: out })}\n`);
  const all = Object.values(out).flat();
  console.log(`\n${all.length} sights in ${Object.keys(out).length} countries; ${all.filter((s) => s.img).length} with photos, ${all.filter((s) => s.lat != null).length} with coordinates`);
  if (missing.length) console.log(`No Wikipedia page: ${missing.join(', ')}`);
  console.log(`No photo: ${all.filter((s) => !s.img).map((s) => s.t).join(', ')}`);
  console.log(`No coordinates: ${all.filter((s) => s.lat == null).map((s) => s.t).join(', ')}`);
}

main();
