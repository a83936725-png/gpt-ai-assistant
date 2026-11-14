import { expect, test } from '@jest/globals';
import { getStoredImage, setPublicOrigin, uploadImage } from '../utils/upload-image.js';

test('uploadImage serves the image from this server when Vercel Blob is not configured', async () => {
  setPublicOrigin('https://bot.example.com');
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const url = await uploadImage({ buffer });
  expect(url).toMatch(/^https:\/\/bot\.example\.com\/images\/[0-9a-f-]+\.jpg$/);
  const name = url.split('/').pop();
  const image = getStoredImage(name);
  expect(image.contentType).toBe('image/jpeg');
  expect(image.buffer.equals(buffer)).toBe(true);
});

test('getStoredImage returns null for unknown images', () => {
  expect(getStoredImage('missing.jpg')).toBeNull();
});
