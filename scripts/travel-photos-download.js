/* eslint-disable no-await-in-loop, no-restricted-syntax, no-console */
/**
 * Saves the photos listed in web/travel-photos.json into web/travel-photos/ as small WebP files,
 * so the travel page shows them without loading anything from Wikimedia.
 *
 *   node scripts/travel-photos.js            # find the photos (Wikipedia)
 *   node scripts/travel-photos-download.js   # save them locally (needs ffmpeg for WebP)
 *
 * Behind an HTTPS proxy, run it with NODE_USE_ENV_PROXY=1 so Node's fetch uses the proxy.
 *
 * Covers are saved 960px wide, attractions and food 500px. Files already saved are kept. Each entry
 * keeps its author, license and Commons page, and `remote` holds the original address.
 */
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync,
} from 'fs';
import path from 'path';

const ROOT = process.cwd();
const LIST = path.join(ROOT, 'web', 'travel-photos.json');
const DIR = path.join(ROOT, 'web', 'travel-photos');
const HEADERS = { 'User-Agent': 'TravelPhotoManifest/1.0 (one-off build script; low volume)' };
const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Wikimedia serves the same thumbnails from upload.wikimedia.org at standard widths.
const rendition = (url, width) => url
  .replace('://thumb.wikimedia.org/', '://upload.wikimedia.org/')
  .replace(/\/\d+px-/, `/${width}px-`);

class RateLimited extends Error {}

// Wikimedia answers 429 with Retry-After when a client asks too fast; wait as long as it says.
const fetchImage = async (url) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} for ${url}`);
    const wait = Math.min(180, Number(res.headers.get('retry-after')) || 30);
    console.log(`  Wikimedia asked to wait ${wait}s`);
    await sleep(wait * 1000);
  }
  throw new RateLimited(`Still refused after waiting: ${url}`);
};

const main = async () => {
  const data = JSON.parse(readFileSync(LIST, 'utf8'));
  mkdirSync(DIR, { recursive: true });
  const entries = Object.entries(data.photos);
  const used = new Set();
  let saved = 0;
  let refusedInARow = 0;
  const writeList = () => writeFileSync(LIST, `${JSON.stringify(data, null, 1)}\n`);
  for (let i = 0; i < entries.length; i += 1) {
    const [key, photo] = entries[i];
    const remote = photo.remote || photo.src;
    const width = key.startsWith('dest:') ? 960 : 500;
    const base = createHash('sha1').update(`${photo.file}@${width}`).digest('hex').slice(0, 12);
    const name = `${base}.${HAS_FFMPEG ? 'webp' : 'jpg'}`;
    const target = path.join(DIR, name);
    if (!existsSync(target)) {
      try {
        const buf = await fetchImage(rendition(remote, width));
        if (HAS_FFMPEG) {
          const tmp = path.join(DIR, `${base}.tmp`);
          writeFileSync(tmp, buf);
          const out = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-vf', `scale='min(${width},iw)':-2`, '-quality', '70', '-f', 'webp', target]);
          unlinkSync(tmp);
          if (out.status !== 0) throw new Error(`ffmpeg: ${out.stderr}`);
        } else writeFileSync(target, buf);
        saved += 1;
        await sleep(250);
        refusedInARow = 0;
      } catch (err) {
        console.log(`  skipped ${key}: ${err.message}`);
        if (err instanceof RateLimited) refusedInARow += 1;
      }
    }
    if (existsSync(target)) {
      used.add(name);
      data.photos[key] = { ...photo, remote, src: `travel-photos/${name}` };
    }
    if ((i + 1) % 10 === 0) { writeList(); console.log(`  ${i + 1}/${entries.length}`); }
    if (refusedInARow >= 3) {
      console.log('Wikimedia keeps refusing; stopping. Run this again later to continue where it left off.');
      break;
    }
  }
  // Remove files no longer listed (only after a complete run, so a stopped run keeps its progress).
  if (refusedInARow < 3) {
    const keep = new Set(Object.values(data.photos).map((p) => path.basename(p.src)));
    readdirSync(DIR).filter((f) => !keep.has(f)).forEach((f) => unlinkSync(path.join(DIR, f)));
  }
  writeList();
  console.log(`Saved ${saved} new photos; ${used.size} photos are now local in ${path.relative(ROOT, DIR)}`);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
