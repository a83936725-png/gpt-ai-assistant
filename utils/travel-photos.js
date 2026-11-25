import {
  del, get, list, put,
} from '@vercel/blob';
import { createHash } from 'crypto';
import config from '../config/index.js';

// A traveller's own photos (check-ins and album pages), backed up after LINE login so they come back on a
// new phone. Stored as private JPEGs in the same Vercel Blob store as their trips, under a folder named by a
// hash of their LINE account; in memory when no token is set (local development and tests).
const memory = new Map();
const useBlob = () => Boolean(config.TRAVEL_BLOB_TOKEN);
const token = () => config.TRAVEL_BLOB_TOKEN;

export const PHOTO_KINDS = { full: 1.8 * 1024 * 1024, thumb: 220 * 1024 };
export const PHOTO_MAX_COUNT = 800;
export const PHOTO_ID = /^[\w-]{6,48}$/;

const folder = (sub) => `travel/photos/${createHash('sha256').update(sub).digest('hex').slice(0, 40)}/`;
const pathOf = (sub, id, kind) => `${folder(sub)}${id}-${kind}.jpg`;

/** A JPEG starts with FF D8 FF; anything else is refused. */
export const isJpeg = (buf) => Buffer.isBuffer(buf) && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

export const countPhotos = async (sub) => {
  if (!useBlob()) return [...memory.keys()].filter((k) => k.startsWith(folder(sub)) && k.endsWith('-full.jpg')).length;
  const { blobs } = await list({ prefix: folder(sub), limit: 1000, token: token() });
  return blobs.filter((b) => b.pathname.endsWith('-full.jpg')).length;
};

export const savePhoto = async (sub, id, kind, buf) => {
  const p = pathOf(sub, id, kind);
  if (!useBlob()) {
    memory.set(p, buf);
    return;
  }
  await put(p, buf, {
    access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'image/jpeg', token: token(),
  });
};

export const loadPhoto = async (sub, id, kind) => {
  const p = pathOf(sub, id, kind);
  if (!useBlob()) return memory.get(p) || null;
  const result = await get(p, { access: 'private', useCache: false, token: token() });
  if (!result) return null;
  const chunks = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

export const removePhoto = async (sub, id) => {
  const paths = Object.keys(PHOTO_KINDS).map((kind) => pathOf(sub, id, kind));
  if (!useBlob()) {
    paths.forEach((p) => memory.delete(p));
    return;
  }
  await del(paths, { token: token() });
};

export const resetPhotos = () => memory.clear();
