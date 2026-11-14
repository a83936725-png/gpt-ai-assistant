import crypto from 'crypto';
import config from '../config/index.js';

// Images kept in memory when Vercel Blob is not configured (Docker or any long-running server).
const IMAGE_TTL_MS = 60 * 60 * 1000;
const MAX_STORED_IMAGES = 50;
const images = new Map();

let publicOrigin = null;

/**
 * Remembers the public origin that LINE used to reach this server, so in-memory images
 * can be served from the same address when IMAGE_PUBLIC_URL is not set.
 * @param {string} origin
 */
const setPublicOrigin = (origin) => {
  publicOrigin = origin;
};

const detectContentType = (buffer) => {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  return 'image/jpeg';
};

const pruneImages = (now) => {
  images.forEach((image, name) => {
    if (image.expiresAt <= now) images.delete(name);
  });
  while (images.size >= MAX_STORED_IMAGES) {
    images.delete(images.keys().next().value);
  }
};

/**
 * @param {string} name
 * @returns {{ buffer: Buffer, contentType: string } | null}
 */
const getStoredImage = (name) => {
  const image = images.get(name);
  if (!image || image.expiresAt <= Date.now()) return null;
  return image;
};

/**
 * Stores a generated image and returns an HTTPS URL that LINE can download.
 * @param {Object} param
 * @param {Buffer} param.buffer
 * @returns {Promise<string>}
 */
const uploadImage = async ({
  buffer,
}) => {
  const contentType = detectContentType(buffer);
  const name = `${crypto.randomUUID()}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
  if (config.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const { url } = await put(`images/${name}`, buffer, {
      access: 'public',
      contentType,
      token: config.BLOB_READ_WRITE_TOKEN,
    });
    return url;
  }
  const origin = config.IMAGE_PUBLIC_URL || publicOrigin;
  if (!origin) {
    throw new Error('Cannot host the generated image. Connect a Vercel Blob store (BLOB_READ_WRITE_TOKEN) or set IMAGE_PUBLIC_URL.');
  }
  const now = Date.now();
  pruneImages(now);
  images.set(name, { buffer, contentType, expiresAt: now + IMAGE_TTL_MS });
  return `${origin.replace(/\/+$/, '')}/images/${name}`;
};

export {
  getStoredImage,
  setPublicOrigin,
  uploadImage,
};
