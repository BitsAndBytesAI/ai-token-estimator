import type { ModelConfig } from './types.js';

/**
 * Default model configurations.
 *
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Last updated: 2025-12-24
 *
 * Sources:
 * - OpenAI: https://openai.com/api/pricing/
 * - Anthropic: https://www.anthropic.com/pricing
 * - Google: https://ai.google.dev/gemini-api/docs/pricing
 *
 * This file is automatically updated weekly by GitHub Actions.
 */

export const LAST_UPDATED = '2025-12-24';

const models: Record<string, ModelConfig> = {
  // ===================
  // OpenAI Models
  // ===================
  // OpenAI uses ~4 chars per token for English text

  // GPT-5 series (Flagship)
  'gpt-5.2': {
    charsPerToken: 4,
    inputCostPerMillion: 1.75,
  },
  'gpt-5.2-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 21.0,
  },
  'gpt-5-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.25,
  },

  // GPT-4.1 series
  'gpt-4.1': {
    charsPerToken: 4,
    inputCostPerMillion: 3.0,
  },
  'gpt-4.1-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.8,
  },
  'gpt-4.1-nano': {
    charsPerToken: 4,
    inputCostPerMillion: 0.2,
  },

  // GPT-4o series
  'gpt-4o': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
  },
  'gpt-4o-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.15,
  },

  // OpenAI Reasoning models (o-series)
  'o3': {
    charsPerToken: 4,
    inputCostPerMillion: 2.0, // Estimated based on similar tier
  },
  'o4-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 4.0,
  },
  'o1': {
    charsPerToken: 4,
    inputCostPerMillion: 15.0,
  },
  'o1-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 150.0, // High-end reasoning
  },

  // ===================
  // Anthropic Models
  // ===================
  // Anthropic uses ~3.5 chars per token for English text

  // Claude 4.5 series (Latest)
  'claude-opus-4.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 5.0,
  },
  'claude-sonnet-4.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 3.0,
  },
  'claude-haiku-4.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 1.0,
  },

  // Claude 4 series
  'claude-opus-4': {
    charsPerToken: 3.5,
    inputCostPerMillion: 15.0,
  },
  'claude-opus-4.1': {
    charsPerToken: 3.5,
    inputCostPerMillion: 15.0,
  },
  'claude-sonnet-4': {
    charsPerToken: 3.5,
    inputCostPerMillion: 3.0,
  },

  // Claude 3 series (Legacy)
  'claude-opus-3': {
    charsPerToken: 3.5,
    inputCostPerMillion: 15.0,
  },
  'claude-haiku-3': {
    charsPerToken: 3.5,
    inputCostPerMillion: 0.25,
  },
  'claude-haiku-3.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 0.8,
  },

  // ===================
  // Google Gemini Models
  // ===================
  // Gemini uses similar tokenization to OpenAI (~4 chars per token)

  // Gemini 3 series (Latest)
  'gemini-3-pro': {
    charsPerToken: 4,
    inputCostPerMillion: 2.0,
  },
  'gemini-3-flash': {
    charsPerToken: 4,
    inputCostPerMillion: 0.5,
  },

  // Gemini 2.5 series
  'gemini-2.5-pro': {
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

  // Gemini 2.0 series
  'gemini-2.0-flash': {
    charsPerToken: 4,
    inputCostPerMillion: 0.1,
  },
  'gemini-2.0-flash-lite': {
    charsPerToken: 4,
    inputCostPerMillion: 0.075,
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
