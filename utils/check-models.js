import config from '../config/index.js';
import { retrieveModel } from '../services/openai.js';

export const MODEL_STATUS_OK = 'ok';
export const MODEL_STATUS_SHUTDOWN_SOON = 'shutdown_soon';
export const MODEL_STATUS_SHUT_DOWN = 'shut_down';
export const MODEL_STATUS_NOT_FOUND = 'not_found';
export const MODEL_STATUS_UNKNOWN = 'unknown';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {Object} param
 * @param {string|null} param.shutdownDate e.g. "2027-01-14"
 * @param {Date} param.now
 * @param {number} param.warningDays
 * @returns {{ status: string, daysLeft: number|null }}
 */
const classifyShutdown = ({
  shutdownDate,
  now,
  warningDays,
}) => {
  if (!shutdownDate) return { status: MODEL_STATUS_OK, daysLeft: null };
  const daysLeft = Math.ceil((Date.parse(`${shutdownDate}T00:00:00Z`) - now.getTime()) / DAY_MS);
  if (daysLeft <= 0) return { status: MODEL_STATUS_SHUT_DOWN, daysLeft };
  if (daysLeft <= warningDays) return { status: MODEL_STATUS_SHUTDOWN_SOON, daysLeft };
  return { status: MODEL_STATUS_OK, daysLeft };
};

/**
 * The models this bot is configured to use, with the feature each one powers.
 * Chat and vision run on the completion provider, which may not be OpenAI.
 */
const getConfiguredModels = () => [
  { feature: 'chat', model: config.OPENAI_COMPLETION_MODEL, isCompletion: true },
  { feature: 'vision', model: config.OPENAI_VISION_MODEL, isCompletion: true },
  { feature: 'image', model: config.OPENAI_IMAGE_GENERATION_MODEL, isCompletion: false },
  { feature: 'transcription', model: config.OPENAI_TRANSCRIPTION_MODEL, isCompletion: false },
];

/**
 * Looks up each configured model and its announced shutdown date.
 * @param {Object} [param]
 * @param {Date} [param.now]
 * @returns {Promise<Array<{ feature: string, model: string, status: string, shutdownDate: string|null, daysLeft: number|null }>>}
 */
const checkModels = async ({
  now = new Date(),
} = {}) => {
  const models = getConfiguredModels();
  return Promise.all(models.map(async ({ feature, model, isCompletion }) => {
    try {
      const { data } = await retrieveModel({ model, isCompletion });
      const shutdownDate = data.shutdown_date || null;
      return {
        feature, model, shutdownDate, ...classifyShutdown({ shutdownDate, now, warningDays: config.APP_MODEL_WARNING_DAYS }),
      };
    } catch (err) {
      const status = err.response?.status === 404 ? MODEL_STATUS_NOT_FOUND : MODEL_STATUS_UNKNOWN;
      return {
        feature, model, shutdownDate: null, daysLeft: null, status,
      };
    }
  }));
};

export {
  classifyShutdown,
  getConfiguredModels,
};

export default checkModels;
