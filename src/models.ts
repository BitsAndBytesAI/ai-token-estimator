import type { ModelConfig } from './types.js';

/**
 * Default model configurations.
 *
 * Pricing last verified: 2025-12-24
 * Sources:
 * - OpenAI: https://openai.com/api/pricing/
 * - Anthropic: https://www.anthropic.com/pricing
 *
 * To update: modify this file and publish a new package version.
 */
const models: Record<string, ModelConfig> = {
  // OpenAI models (4 chars per token)
  'gpt-4o': {
    charsPerToken: 4,
    inputCostPerMillion: 2.5,
  },
  'gpt-4o-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.15,
  },
  'gpt-4.1': {
    charsPerToken: 4,
    inputCostPerMillion: 3.0,
  },
  'gpt-4.1-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.4,
  },
  // Anthropic models (3.5 chars per token)
  'claude-opus-4.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 5.0,
  },
  'claude-sonnet-4': {
    charsPerToken: 3.5,
    inputCostPerMillion: 3.0,
  },
  'claude-haiku-3.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 0.8,
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
