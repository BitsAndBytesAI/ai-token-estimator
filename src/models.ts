import type { ModelConfig } from './types.js';

/**
 * Default model configurations.
 *
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Last updated: 2026-04-06
 *
 * Sources:
 * - OpenAI: https://platform.openai.com/docs/pricing
 * - Anthropic: https://www.anthropic.com/pricing
 * - Google: https://ai.google.dev/gemini-api/docs/pricing
 *
 * This file is automatically updated weekly by GitHub Actions.
 */

export const LAST_UPDATED = '2026-04-06';

const models: Record<string, ModelConfig> = {
  // ===================
  // OpenAI Models
  // ===================
  // OpenAI uses ~4 chars per token for English text

  'babbage-002': {
    charsPerToken: 4,
    inputCostPerMillion: 0.4,
    outputCostPerMillion: 0.4,
    batchInputCostPerMillion: 0.8,
    batchOutputCostPerMillion: 0.9,
  },
  'chatgpt-4o-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
  },
  'chatgpt-image-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
    cachedInputCostPerMillion: 0.63,
    batchInputCostPerMillion: 2.5,
    batchOutputCostPerMillion: 5,
  },
  'codex-mini-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 1.5,
    outputCostPerMillion: 6,
  },
  'computer-use-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 1.5,
    outputCostPerMillion: 6,
  },
  'davinci-002': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
    outputCostPerMillion: 2,
    batchInputCostPerMillion: 6,
    batchOutputCostPerMillion: 6,
  },
  'gpt-3.5-0301': {
    charsPerToken: 4,
    inputCostPerMillion: 1.5,
    outputCostPerMillion: 2,
  },
  'gpt-3.5-turbo': {
    charsPerToken: 4,
    inputCostPerMillion: 0.5,
    outputCostPerMillion: 1.5,
    batchInputCostPerMillion: 1.5,
    batchOutputCostPerMillion: 3,
  },
  'gpt-3.5-turbo-0125': {
    charsPerToken: 4,
    inputCostPerMillion: 0.5,
    outputCostPerMillion: 1.5,
  },
  'gpt-3.5-turbo-0613': {
    charsPerToken: 4,
    inputCostPerMillion: 1.5,
    outputCostPerMillion: 2,
  },
  'gpt-3.5-turbo-1106': {
    charsPerToken: 4,
    inputCostPerMillion: 1,
    outputCostPerMillion: 2,
  },
  'gpt-3.5-turbo-16k-0613': {
    charsPerToken: 4,
    inputCostPerMillion: 3,
    outputCostPerMillion: 4,
  },
  'gpt-3.5-turbo-instruct': {
    charsPerToken: 4,
    inputCostPerMillion: 1.5,
    outputCostPerMillion: 2,
  },
  'gpt-4-0125-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 10,
    outputCostPerMillion: 30,
  },
  'gpt-4-0314': {
    charsPerToken: 4,
    inputCostPerMillion: 30,
    outputCostPerMillion: 60,
  },
  'gpt-4-0613': {
    charsPerToken: 4,
    inputCostPerMillion: 30,
    outputCostPerMillion: 60,
  },
  'gpt-4-1106-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 10,
    outputCostPerMillion: 30,
  },
  'gpt-4-1106-vision-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 10,
    outputCostPerMillion: 30,
  },
  'gpt-4-32k': {
    charsPerToken: 4,
    inputCostPerMillion: 60,
    outputCostPerMillion: 120,
  },
  'gpt-4-turbo-2024-04-09': {
    charsPerToken: 4,
    inputCostPerMillion: 10,
    outputCostPerMillion: 30,
  },
  'gpt-4.1': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
    outputCostPerMillion: 8,
  },
  'gpt-4.1-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.4,
    outputCostPerMillion: 1.6,
  },
  'gpt-4.1-nano': {
    charsPerToken: 4,
    inputCostPerMillion: 0.1,
    outputCostPerMillion: 0.4,
  },
  'gpt-4o': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 10,
    cachedInputCostPerMillion: 1.25,
    batchInputCostPerMillion: 1.25,
    batchOutputCostPerMillion: 5,
  },
  'gpt-4o-2024-05-13': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
    outputCostPerMillion: 15,
  },
  'gpt-4o-audio-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 10,
  },
  'gpt-4o-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
    cachedInputCostPerMillion: 0.075,
    batchInputCostPerMillion: 0.075,
    batchOutputCostPerMillion: 0.3,
  },
  'gpt-4o-mini-audio-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
  },
  'gpt-4o-mini-realtime-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 0.6,
    outputCostPerMillion: 2.4,
  },
  'gpt-4o-mini-search-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
  },
  'gpt-4o-realtime-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
    outputCostPerMillion: 20,
  },
  'gpt-4o-search-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 10,
  },
  'gpt-5': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
    cachedInputCostPerMillion: 0.0625,
    batchInputCostPerMillion: 0.625,
    batchOutputCostPerMillion: 5,
  },
  'gpt-5-chat-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
  },
  'gpt-5-codex': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
  },
  'gpt-5-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.25,
    outputCostPerMillion: 2,
    cachedInputCostPerMillion: 0.0125,
    batchInputCostPerMillion: 0.125,
    batchOutputCostPerMillion: 1,
  },
  'gpt-5-nano': {
    charsPerToken: 4,
    inputCostPerMillion: 0.05,
    outputCostPerMillion: 0.4,
    cachedInputCostPerMillion: 0.0025,
    batchInputCostPerMillion: 0.025,
    batchOutputCostPerMillion: 0.2,
  },
  'gpt-5-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 15,
    outputCostPerMillion: 120,
  },
  'gpt-5-search-api': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
  },
  'gpt-5.1': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
    cachedInputCostPerMillion: 0.0625,
    batchInputCostPerMillion: 0.625,
    batchOutputCostPerMillion: 5,
  },
  'gpt-5.1-chat-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
  },
  'gpt-5.1-codex': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
  },
  'gpt-5.1-codex-max': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
  },
  'gpt-5.1-codex-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.25,
    outputCostPerMillion: 2,
  },
  'gpt-5.2': {
    charsPerToken: 4,
    inputCostPerMillion: 1.75,
    outputCostPerMillion: 14,
    cachedInputCostPerMillion: 0.0875,
    batchInputCostPerMillion: 0.875,
    batchOutputCostPerMillion: 7,
  },
  'gpt-5.2-chat-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 1.75,
    outputCostPerMillion: 14,
  },
  'gpt-5.2-codex': {
    charsPerToken: 4,
    inputCostPerMillion: 1.75,
    outputCostPerMillion: 14,
  },
  'gpt-5.2-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 21,
    outputCostPerMillion: 168,
  },
  'gpt-5.3-chat-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 1.75,
    outputCostPerMillion: 14,
    cachedInputCostPerMillion: 0.175,
    batchOutputCostPerMillion: 14,
  },
  'gpt-5.3-codex': {
    charsPerToken: 4,
    inputCostPerMillion: 1.75,
    outputCostPerMillion: 14,
    cachedInputCostPerMillion: 0.175,
    batchOutputCostPerMillion: 14,
  },
  'gpt-5.4': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 15,
    cachedInputCostPerMillion: 0.25,
    batchInputCostPerMillion: 0.13,
    batchOutputCostPerMillion: 7.5,
  },
  'gpt-5.4-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.75,
    outputCostPerMillion: 4.5,
    cachedInputCostPerMillion: 0.075,
    batchInputCostPerMillion: 0.0375,
    batchOutputCostPerMillion: 2.25,
  },
  'gpt-5.4-nano': {
    charsPerToken: 4,
    inputCostPerMillion: 0.2,
    outputCostPerMillion: 1.25,
    cachedInputCostPerMillion: 0.02,
    batchInputCostPerMillion: 0.01,
    batchOutputCostPerMillion: 0.625,
  },
  'gpt-5.4-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 30,
    outputCostPerMillion: 180,
    batchInputCostPerMillion: 15,
    batchOutputCostPerMillion: 90,
  },
  'gpt-audio': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 10,
  },
  'gpt-audio-1.5': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 10,
  },
  'gpt-audio-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.6,
    outputCostPerMillion: 2.4,
  },
  'gpt-image-1': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
    cachedInputCostPerMillion: 1.25,
    batchInputCostPerMillion: 5,
    batchOutputCostPerMillion: 20,
  },
  'gpt-image-1-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
    cachedInputCostPerMillion: 0.2,
    batchInputCostPerMillion: 2,
    batchOutputCostPerMillion: 4,
  },
  'gpt-image-1.5': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
    cachedInputCostPerMillion: 0.63,
    batchInputCostPerMillion: 2.5,
    batchOutputCostPerMillion: 5,
  },
  'gpt-realtime': {
    charsPerToken: 4,
    inputCostPerMillion: 4,
    outputCostPerMillion: 16,
  },
  'gpt-realtime-1.5': {
    charsPerToken: 4,
    inputCostPerMillion: 4,
    outputCostPerMillion: 16,
  },
  'gpt-realtime-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.6,
    outputCostPerMillion: 2.4,
  },
  'o1': {
    charsPerToken: 4,
    inputCostPerMillion: 15,
    outputCostPerMillion: 60,
  },
  'o1-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 1.1,
    outputCostPerMillion: 4.4,
  },
  'o1-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 150,
    outputCostPerMillion: 600,
  },
  'o3': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
    outputCostPerMillion: 8,
  },
  'o3-deep-research': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
    outputCostPerMillion: 20,
  },
  'o3-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 1.1,
    outputCostPerMillion: 4.4,
  },
  'o3-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 20,
    outputCostPerMillion: 80,
  },
  'o4-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 1.1,
    outputCostPerMillion: 4.4,
  },
  'o4-mini-deep-research': {
    charsPerToken: 4,
    inputCostPerMillion: 1,
    outputCostPerMillion: 4,
  },

  // ===================
  // Anthropic Models
  // ===================
  // Anthropic uses ~3.5 chars per token for English text

  'claude-haiku-3': {
    charsPerToken: 3.5,
    inputCostPerMillion: 0.25,
  },
  'claude-haiku-3.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 0.8,
  },
  'claude-haiku-4.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 1,
    outputCostPerMillion: 5,
  },
  'claude-opus-3': {
    charsPerToken: 3.5,
    inputCostPerMillion: 15,
  },
  'claude-opus-4': {
    charsPerToken: 3.5,
    inputCostPerMillion: 15,
  },
  'claude-opus-4.1': {
    charsPerToken: 3.5,
    inputCostPerMillion: 15,
  },
  'claude-opus-4.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 5,
  },
  'claude-opus-4.6': {
    charsPerToken: 3.5,
    inputCostPerMillion: 5,
    outputCostPerMillion: 25,
  },
  'claude-sonnet-4': {
    charsPerToken: 3.5,
    inputCostPerMillion: 3,
  },
  'claude-sonnet-4.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
  },
  'claude-sonnet-4.6': {
    charsPerToken: 3.5,
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
  },

  // ===================
  // Google Gemini Models
  // ===================
  // Gemini uses similar tokenization to OpenAI (~4 chars per token)

  'gemini-2.0-flash': {
    charsPerToken: 4,
    inputCostPerMillion: 0.1,
    outputCostPerMillion: 0.4,
  },
  'gemini-2.0-flash-lite': {
    charsPerToken: 4,
    inputCostPerMillion: 0.075,
    outputCostPerMillion: 0.3,
  },
  'gemini-2.5-computer-use-preview-10-2025': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
  },
  'gemini-2.5-flash': {
    charsPerToken: 4,
    inputCostPerMillion: 0.3,
    outputCostPerMillion: 2.5,
  },
  'gemini-2.5-flash-lite': {
    charsPerToken: 4,
    inputCostPerMillion: 0.1,
    outputCostPerMillion: 0.4,
  },
  'gemini-2.5-flash-lite-preview-09-2025': {
    charsPerToken: 4,
    inputCostPerMillion: 0.1,
  },
  'gemini-2.5-flash-native-audio-preview-12-2025': {
    charsPerToken: 4,
    inputCostPerMillion: 0.5,
    outputCostPerMillion: 2,
  },
  'gemini-2.5-flash-preview-09-2025': {
    charsPerToken: 4,
    inputCostPerMillion: 0.3,
    outputCostPerMillion: 2.5,
  },
  'gemini-2.5-flash-preview-tts': {
    charsPerToken: 4,
    inputCostPerMillion: 0.5,
    outputCostPerMillion: 10,
  },
  'gemini-2.5-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
  },
  'gemini-2.5-pro-preview-tts': {
    charsPerToken: 4,
    inputCostPerMillion: 1,
    outputCostPerMillion: 20,
  },
  'gemini-3-flash': {
    charsPerToken: 4,
    inputCostPerMillion: 0.5,
    outputCostPerMillion: 3,
  },
  'gemini-3-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
    outputCostPerMillion: 12,
  },
  'gemini-3.1-flash-lite': {
    charsPerToken: 4,
    inputCostPerMillion: 0.25,
    outputCostPerMillion: 1.5,
  },
  'gemini-3.1-flash-live': {
    charsPerToken: 4,
    inputCostPerMillion: 0.75,
    outputCostPerMillion: 4.5,
  },
  'gemini-3.1-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
    outputCostPerMillion: 12,
  },
};

// Deep freeze to prevent runtime mutation
Object.values(models).forEach((config) => Object.freeze(config));
export const DEFAULT_MODELS: Readonly<Record<string, Readonly<ModelConfig>>> =
  Object.freeze(models);

/**
 * Get configuration for a specific model.
 * @param model - The model ID to look up
 * @returns The model configuration
 * @throws Error if model is not found
 */
export function getModelConfig(model: string): ModelConfig {
  const direct = DEFAULT_MODELS[model];
  if (direct) return direct;

  const normalized = (() => {
    if (!model.startsWith('claude-')) return model;
    // Normalize common Anthropic model id variants:
    // - Strip dated suffixes like `-20251101` (Anthropic frequently versions model IDs).
    // - Accept `-3-5`/`-4-5` style and map to our internal `-3.5`/`-4.5` IDs.
    const withoutDate = model.replace(/-\d{8}$/, '');
    return withoutDate.replace(/-(\d+)-(\d+)$/, (_m, major, minor) => `-${major}.${minor}`);
  })();

  const aliased = DEFAULT_MODELS[normalized];
  if (!aliased) {
    const available = Object.keys(DEFAULT_MODELS).join(', ');
    throw new Error(
      `Unknown model: "${model}". Available models: ${available}`
    );
  }
  return aliased;
}

/**
 * Get list of all available model IDs.
 * @returns Array of model ID strings
 */
export function getAvailableModels(): string[] {
  return Object.keys(DEFAULT_MODELS);
}
