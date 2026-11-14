import axios from 'axios';
import FormData from 'form-data';
import config from '../config/index.js';
import { handleFulfilled, handleRejected, handleRequest } from './utils/index.js';

export const ROLE_SYSTEM = 'system';
export const ROLE_AI = 'assistant';
export const ROLE_HUMAN = 'user';

export const FINISH_REASON_STOP = 'stop';
export const FINISH_REASON_LENGTH = 'length';

export const IMAGE_SIZE_256 = '256x256';
export const IMAGE_SIZE_512 = '512x512';
export const IMAGE_SIZE_1024 = '1024x1024';

export const REASONING_EFFORT_NONE = 'none';

export const MODEL_GPT_6_LUNA = 'gpt-6-luna';
export const MODEL_GPT_TRANSCRIBE = 'gpt-transcribe';
export const MODEL_GPT_IMAGE_2_6_FLARE = 'gpt-image-2.6-flare';

// Sizes and quality values from the retired DALL·E models, mapped to what GPT Image models accept.
const LEGACY_IMAGE_SIZES = [IMAGE_SIZE_256, IMAGE_SIZE_512];
const LEGACY_IMAGE_QUALITIES = { standard: 'low', hd: 'high' };

const isOfficialOpenAI = (baseURL) => {
  try {
    return new URL(baseURL).hostname.endsWith('openai.com');
  } catch {
    return false;
  }
};

// Chat can run on another OpenAI-compatible provider (e.g. open-source models on OpenRouter or Ollama)
// while image generation and transcription stay on OpenAI.
const IS_OFFICIAL_OPENAI = isOfficialOpenAI(config.OPENAI_COMPLETION_BASE_URL);

const createClient = ({ baseURL, apiKey }) => {
  const instance = axios.create({
    baseURL,
    timeout: config.OPENAI_TIMEOUT,
    headers: {
      'Accept-Encoding': 'gzip, deflate, compress',
    },
  });
  instance.interceptors.request.use((c) => {
    c.headers.Authorization = `Bearer ${apiKey}`;
    return handleRequest(c);
  });
  instance.interceptors.response.use(handleFulfilled, (err) => {
    if (err.response?.data?.error?.message) {
      err.message = err.response.data.error.message;
    }
    return handleRejected(err);
  });
  return instance;
};

const client = createClient({
  baseURL: config.OPENAI_BASE_URL,
  apiKey: config.OPENAI_API_KEY,
});

const completionClient = createClient({
  baseURL: config.OPENAI_COMPLETION_BASE_URL,
  apiKey: config.OPENAI_COMPLETION_API_KEY,
});

const hasImage = ({ messages }) => (
  messages.some(({ content }) => (
    Array.isArray(content) && content.some((item) => item.image_url)
  ))
);

/**
 * Builds a Chat Completions body that works with current OpenAI models and with
 * OpenAI-compatible providers (OpenRouter, Ollama, Groq...).
 */
const buildChatCompletionBody = ({
  model,
  messages,
  temperature,
  maxTokens,
  frequencyPenalty,
  presencePenalty,
  reasoningEffort,
  isOpenAI,
}) => {
  const body = { model, messages };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  // Reasoning models reject temperature unless reasoning effort is "none".
  if (!reasoningEffort || reasoningEffort === REASONING_EFFORT_NONE) body.temperature = temperature;
  // OpenAI replaced max_tokens with max_completion_tokens; most compatible providers still read max_tokens.
  if (isOpenAI) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
  }
  if (frequencyPenalty) body.frequency_penalty = frequencyPenalty;
  if (presencePenalty) body.presence_penalty = presencePenalty;
  return body;
};

const createChatCompletion = ({
  model = config.OPENAI_COMPLETION_MODEL,
  messages,
  temperature = config.OPENAI_COMPLETION_TEMPERATURE,
  maxTokens = config.OPENAI_COMPLETION_MAX_TOKENS,
  frequencyPenalty = config.OPENAI_COMPLETION_FREQUENCY_PENALTY,
  presencePenalty = config.OPENAI_COMPLETION_PRESENCE_PENALTY,
}) => {
  const body = buildChatCompletionBody({
    model: hasImage({ messages }) ? config.OPENAI_VISION_MODEL : model,
    messages,
    temperature,
    maxTokens,
    frequencyPenalty,
    presencePenalty,
    // Fast, non-reasoning replies by default on OpenAI; other providers only get it when set explicitly.
    reasoningEffort: config.OPENAI_COMPLETION_REASONING_EFFORT
      || (IS_OFFICIAL_OPENAI ? REASONING_EFFORT_NONE : null),
    isOpenAI: IS_OFFICIAL_OPENAI,
  });
  return completionClient.post('/v1/chat/completions', body);
};

const isGptImageModel = (model) => model.startsWith('gpt-image');

// The complexity setting exists from GPT Image 2.6 onwards.
const supportsImageComplexity = (model) => {
  const [, major, minor] = model.match(/^gpt-image-(\d+)\.(\d+)/) || [];
  if (!major) return false;
  return Number(major) > 2 || (Number(major) === 2 && Number(minor) >= 6);
};

const buildImageBody = ({
  model,
  prompt,
  size,
  quality,
  complexity,
  n,
}) => {
  if (!isGptImageModel(model)) {
    return {
      model, prompt, size, quality, n,
    };
  }
  const body = {
    model,
    prompt,
    n,
    size: LEGACY_IMAGE_SIZES.includes(size) ? IMAGE_SIZE_1024 : size,
    quality: LEGACY_IMAGE_QUALITIES[quality] || quality,
    // JPEG keeps the file small enough for LINE's 1 MB preview image limit.
    output_format: 'jpeg',
    output_compression: 80,
  };
  if (complexity && supportsImageComplexity(model)) body.complexity = complexity;
  return body;
};

const createImage = ({
  model = config.OPENAI_IMAGE_GENERATION_MODEL,
  prompt,
  size = config.OPENAI_IMAGE_GENERATION_SIZE,
  quality = config.OPENAI_IMAGE_GENERATION_QUALITY,
  complexity = config.OPENAI_IMAGE_GENERATION_COMPLEXITY,
  n = 1,
}) => client.post('/v1/images/generations', buildImageBody({
  model, prompt, size, quality, complexity, n,
}), {
  timeout: config.OPENAI_IMAGE_GENERATION_TIMEOUT,
});

const createAudioTranscriptions = ({
  buffer,
  file,
  model = config.OPENAI_TRANSCRIPTION_MODEL,
}) => {
  const formData = new FormData();
  formData.append('file', buffer, file);
  formData.append('model', model);
  return client.post('/v1/audio/transcriptions', formData.getBuffer(), {
    headers: formData.getHeaders(),
  });
};

export {
  buildChatCompletionBody,
  buildImageBody,
  createAudioTranscriptions,
  createChatCompletion,
  createImage,
};
