import type { ModelConfig } from './types.js';

/**
 * Default model configurations.
 *
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Last updated: 2026-01-19
 *
 * Sources:
 * - OpenAI: https://platform.openai.com/docs/pricing
 * - Anthropic: https://www.anthropic.com/pricing
 * - Google: https://ai.google.dev/gemini-api/docs/pricing
 *
 * This file is automatically updated weekly by GitHub Actions.
 */

export const LAST_UPDATED = '2026-01-19';

const models: Record<string, ModelConfig> = {
  // ===================
  // OpenAI Models
  // ===================
  // OpenAI uses ~4 chars per token for English text

  'babbage-002': {
    charsPerToken: 4,
    inputCostPerMillion: 0.4,
  },
  'chatgpt-4o-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
  },
  'chatgpt-image-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
  },
  'codex-mini-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 1.5,
  },
  'computer-use-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 3,
  },
  'davinci-002': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
  },
  'gpt-3.5-0301': {
    charsPerToken: 4,
    inputCostPerMillion: 1.5,
  },
  'gpt-3.5-turbo': {
    charsPerToken: 4,
    inputCostPerMillion: 0.5,
  },
  'gpt-3.5-turbo-0125': {
    charsPerToken: 4,
    inputCostPerMillion: 0.5,
  },
  'gpt-3.5-turbo-0613': {
    charsPerToken: 4,
    inputCostPerMillion: 1.5,
  },
  'gpt-3.5-turbo-1106': {
    charsPerToken: 4,
    inputCostPerMillion: 1,
  },
  'gpt-3.5-turbo-16k-0613': {
    charsPerToken: 4,
    inputCostPerMillion: 3,
  },
  'gpt-3.5-turbo-instruct': {
    charsPerToken: 4,
    inputCostPerMillion: 1.5,
  },
  'gpt-4-0125-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 10,
  },
  'gpt-4-0314': {
    charsPerToken: 4,
    inputCostPerMillion: 30,
  },
  'gpt-4-0613': {
    charsPerToken: 4,
    inputCostPerMillion: 30,
  },
  'gpt-4-1106-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 10,
  },
  'gpt-4-1106-vision-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 10,
  },
  'gpt-4-32k': {
    charsPerToken: 4,
    inputCostPerMillion: 60,
  },
  'gpt-4-turbo-2024-04-09': {
    charsPerToken: 4,
    inputCostPerMillion: 10,
  },
  'gpt-4.1': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
  },
  'gpt-4.1-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.4,
  },
  'gpt-4.1-nano': {
    charsPerToken: 4,
    inputCostPerMillion: 0.1,
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
  },
  'gpt-4o-audio-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
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
  },
  'gpt-4o-mini-realtime-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 0.6,
  },
  'gpt-4o-mini-search-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 0.15,
  },
  'gpt-4o-realtime-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
  },
  'gpt-4o-search-preview': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
  },
  'gpt-5': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
  },
  'gpt-5-chat-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
  },
  'gpt-5-codex': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
  },
  'gpt-5-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.25,
  },
  'gpt-5-nano': {
    charsPerToken: 4,
    inputCostPerMillion: 0.05,
  },
  'gpt-5-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 15,
  },
  'gpt-5-search-api': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
  },
  'gpt-5.1': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
  },
  'gpt-5.1-chat-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
  },
  'gpt-5.1-codex': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
  },
  'gpt-5.1-codex-max': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
  },
  'gpt-5.1-codex-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.25,
  },
  'gpt-5.2': {
    charsPerToken: 4,
    inputCostPerMillion: 1.75,
  },
  'gpt-5.2-chat-latest': {
    charsPerToken: 4,
    inputCostPerMillion: 1.75,
  },
  'gpt-5.2-codex': {
    charsPerToken: 4,
    inputCostPerMillion: 1.75,
  },
  'gpt-5.2-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 21,
  },
  'gpt-audio': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
  },
  'gpt-audio-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.6,
  },
  'gpt-image-1': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
  },
  'gpt-image-1-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
  },
  'gpt-image-1.5': {
    charsPerToken: 4,
    inputCostPerMillion: 5,
  },
  'gpt-realtime': {
    charsPerToken: 4,
    inputCostPerMillion: 4,
  },
  'gpt-realtime-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.6,
  },
  'o1': {
    charsPerToken: 4,
    inputCostPerMillion: 15,
  },
  'o1-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 1.1,
  },
  'o1-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 150,
  },
  'o3': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
  },
  'o3-deep-research': {
    charsPerToken: 4,
    inputCostPerMillion: 10,
  },
  'o3-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 1.1,
  },
  'o3-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 20,
  },
  'o4-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 1.1,
  },
  'o4-mini-deep-research': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
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
  'claude-sonnet-4': {
    charsPerToken: 3.5,
    inputCostPerMillion: 3,
  },
  'claude-sonnet-4.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 3,
  },

  // ===================
  // Google Gemini Models
  // ===================
  // Gemini uses similar tokenization to OpenAI (~4 chars per token)

  'gemini-2.0-flash': {
    charsPerToken: 4,
    inputCostPerMillion: 0.1,
  },
  'gemini-2.0-flash-lite': {
    charsPerToken: 4,
    inputCostPerMillion: 0.075,
  },
  'gemini-2.5-computer-use-preview-10-2025': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
  },
  'gemini-2.5-flash': {
    charsPerToken: 4,
    inputCostPerMillion: 0.3,
  },
  'gemini-2.5-flash-lite': {
    charsPerToken: 4,
    inputCostPerMillion: 0.1,
  },
  'gemini-2.5-flash-lite-preview-09-2025': {
    charsPerToken: 4,
    inputCostPerMillion: 0.1,
  },
  'gemini-2.5-flash-native-audio-preview-12-2025': {
    charsPerToken: 4,
    inputCostPerMillion: 0.5,
  },
  'gemini-2.5-flash-preview-09-2025': {
    charsPerToken: 4,
    inputCostPerMillion: 0.3,
  },
  'gemini-2.5-flash-preview-tts': {
    charsPerToken: 4,
    inputCostPerMillion: 0.5,
  },
  'gemini-2.5-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 1.25,
  },
  'gemini-2.5-pro-preview-tts': {
    charsPerToken: 4,
    inputCostPerMillion: 1,
  },
  'gemini-3-flash': {
    charsPerToken: 4,
    inputCostPerMillion: 0.5,
  },
  'gemini-3-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
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
