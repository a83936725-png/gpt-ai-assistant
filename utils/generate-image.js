import config from '../config/index.js';
import { MOCK_TEXT_OK } from '../constants/mock.js';
import { createImage } from '../services/openai.js';
import { uploadImage } from './upload-image.js';

const CONTENT_TYPE_BY_FORMAT = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
};

class Image {
  url;

  constructor({
    url,
  }) {
    this.url = url;
  }
}

/**
 * @param {Object} param
 * @param {string} param.prompt
 * @param {string} [param.outputFormat] 'jpeg' (default, sent as a LINE image) or 'svg' / 'gif'
 *   (hosted and returned as a download link).
 * @returns {Promise<Image>}
 */
const generateImage = async ({
  prompt,
  outputFormat,
}) => {
  if (config.APP_ENV !== 'production') return new Image({ url: MOCK_TEXT_OK });
  const { data } = await createImage({ prompt, outputFormat });
  const [image] = data.data;
  if (image.url) return new Image({ url: image.url });
  // GPT Image models only return base64 data, but LINE needs an HTTPS URL.
  const url = await uploadImage({
    buffer: Buffer.from(image.b64_json, 'base64'),
    contentType: outputFormat ? CONTENT_TYPE_BY_FORMAT[outputFormat] : undefined,
  });
  return new Image({ url });
};

export default generateImage;
