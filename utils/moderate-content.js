import config from '../config/index.js';
import { createModeration } from '../services/openai.js';

/**
 * Checks a message with OpenAI's free moderation model when OPENAI_MODERATION_ENABLED is true.
 * @param {Object} param
 * @param {string} [param.text]
 * @param {string} [param.imageUrl]
 * @returns {Promise<boolean>} true when the content is flagged.
 */
const moderateContent = async ({
  text,
  imageUrl,
}) => {
  if (!config.OPENAI_MODERATION_ENABLED || config.APP_ENV !== 'production') return false;
  if (!text && !imageUrl) return false;
  const { data } = await createModeration({ text, imageUrl });
  return data.results.some(({ flagged }) => flagged);
};

export default moderateContent;
