import type { ModelConfig } from './types.js';

/**
 * Default model configurations.
 *
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Last updated: 2025-12-25
 *
 * Sources:
 * - OpenAI: https://openai.com/api/pricing/
 * - Anthropic: https://www.anthropic.com/pricing
 * - Google: https://ai.google.dev/gemini-api/docs/pricing
 *
 * This file is automatically updated weekly by GitHub Actions.
 */

export const LAST_UPDATED = '2025-12-25';

const models: Record<string, ModelConfig> = {
  // ===================
  // OpenAI Models
  // ===================
  // OpenAI uses ~4 chars per token for English text

  'gpt-4.1': {
    charsPerToken: 4,
    inputCostPerMillion: 3,
  },
  'gpt-4.1-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.8,
  },
  'gpt-4.1-nano': {
    charsPerToken: 4,
    inputCostPerMillion: 0.2,
  },
  'gpt-4o': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
  },
  'gpt-4o-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.15,
  },
  'gpt-5-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.25,
  },
  'gpt-5.2': {
    charsPerToken: 4,
    inputCostPerMillion: 1.75,
  },
  'gpt-5.2-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 21,
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
  'o1-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 150,
  },
  'o3': {
    charsPerToken: 4,
    inputCostPerMillion: 2,
  },
  'o4-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 4,
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
  const config = DEFAULT_MODELS[model];
  if (!config) {
    const available = Object.keys(DEFAULT_MODELS).join(', ');
    throw new Error(
      `Unknown model: "${model}". Available models: ${available}`
    );
  }
  return config;
}

/**
 * Get list of all available model IDs.
 * @returns Array of model ID strings
 */
export function getAvailableModels(): string[] {
  return Object.keys(DEFAULT_MODELS);
}
