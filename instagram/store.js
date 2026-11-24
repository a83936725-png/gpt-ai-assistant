import { get, put } from '@vercel/blob';
import config from '../config/index.js';

// Small JSON files in a private Vercel Blob store (INSTAGRAM_BLOB_READ_WRITE_TOKEN, or the IKIGAI
// one). Without a store, nothing can be saved from the admin page; tests use memory instead.
const memory = new Map();

const useBlob = () => Boolean(config.INSTAGRAM_BLOB_TOKEN);
const canSave = () => useBlob() || config.APP_ENV === 'test';

const readText = async (stream) => {
  const chunks = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const readJson = async (path) => {
  if (!useBlob()) return memory.has(path) ? JSON.parse(memory.get(path)) : null;
  const result = await get(path, { access: 'private', useCache: false, token: config.INSTAGRAM_BLOB_TOKEN });
  if (!result) return null;
  return JSON.parse(await readText(result.stream));
};

const writeJson = async (path, value) => {
  if (!useBlob()) {
    if (!canSave()) throw new Error('還沒設定私人 Blob（INSTAGRAM_BLOB_READ_WRITE_TOKEN），無法儲存');
    memory.set(path, JSON.stringify(value));
    return;
  }
  await put(path, JSON.stringify(value), {
    access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json', token: config.INSTAGRAM_BLOB_TOKEN,
  });
};

const resetStore = () => memory.clear();

export {
  canSave,
  readJson,
  writeJson,
  resetStore,
};
