import { expect, test } from '@jest/globals';
import { buildChatCompletionBody, buildImageBody } from '../services/openai.js';

const messages = [{ role: 'user', content: 'hi' }];

test('chat body for OpenAI uses max_completion_tokens and keeps temperature with reasoning effort none', () => {
  const body = buildChatCompletionBody({
    model: 'gpt-6-luna',
    messages,
    temperature: 1,
    maxTokens: 500,
    frequencyPenalty: 0,
    presencePenalty: 0,
    reasoningEffort: 'none',
    isOpenAI: true,
  });
  expect(body).toEqual({
    model: 'gpt-6-luna',
    messages,
    reasoning_effort: 'none',
    temperature: 1,
    max_completion_tokens: 500,
  });
});

test('chat body drops temperature when the model reasons', () => {
  const body = buildChatCompletionBody({
    model: 'gpt-6-luna',
    messages,
    temperature: 1,
    maxTokens: 500,
    reasoningEffort: 'low',
    isOpenAI: true,
  });
  expect(body.temperature).toBeUndefined();
  expect(body.reasoning_effort).toBe('low');
});

test('chat body for OpenAI-compatible providers uses max_tokens and no reasoning effort', () => {
  const body = buildChatCompletionBody({
    model: 'qwen/qwen3-32b',
    messages,
    temperature: 0.7,
    maxTokens: 500,
    frequencyPenalty: 0,
    presencePenalty: 0.6,
    reasoningEffort: null,
    isOpenAI: false,
  });
  expect(body).toEqual({
    model: 'qwen/qwen3-32b',
    messages,
    temperature: 0.7,
    max_tokens: 500,
    presence_penalty: 0.6,
  });
});

test('image body maps retired DALL·E settings to GPT Image values', () => {
  const body = buildImageBody({
    model: 'gpt-image-2.6-flare',
    prompt: 'a cat',
    size: '256x256',
    quality: 'standard',
    complexity: 'low',
    n: 1,
  });
  expect(body).toEqual({
    model: 'gpt-image-2.6-flare',
    prompt: 'a cat',
    n: 1,
    size: '1024x1024',
    quality: 'low',
    output_format: 'jpeg',
    output_compression: 80,
    complexity: 'low',
  });
});

test('image body only sends complexity to models that support it', () => {
  const body = buildImageBody({
    model: 'gpt-image-2.5-flare',
    prompt: 'a cat',
    size: '1024x1024',
    quality: 'medium',
    complexity: 'low',
    n: 1,
  });
  expect(body.complexity).toBeUndefined();
});
