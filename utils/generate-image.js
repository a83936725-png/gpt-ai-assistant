import config from '../config/index.js';
import { MOCK_TEXT_OK } from '../constants/mock.js';
import { createImage } from '../services/openai.js';
import { uploadImage } from './upload-image.js';

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
 * @returns {Promise<Image>}
 */
const generateImage = async ({
  prompt,
}) => {
  if (config.APP_ENV !== 'production') return new Image({ url: MOCK_TEXT_OK });
  const { data } = await createImage({ prompt });
  const [image] = data.data;
  if (image.url) return new Image({ url: image.url });
  // GPT Image models only return base64 data, but LINE needs an HTTPS URL.
  const url = await uploadImage({ buffer: Buffer.from(image.b64_json, 'base64') });
  return new Image({ url });
};

export default generateImage;
