/**
 * Chat model validation.
 *
 * Provides utilities to check if a model supports chat completions.
 */

/**
 * Prefixes for models that support chat completions.
 */
const CHAT_MODEL_PREFIXES = [
  'gpt-3.5-turbo',
  'gpt-35-turbo', // Azure naming
  'gpt-4',
  'gpt-4o',
  'gpt-4.1',
  'gpt-4.5',
  'gpt-5',
  'chatgpt-4o',
  'o1',
  'o3',
  'o4-mini',
  'gpt-oss',
] as const;

/**
 * Models that are explicitly NOT chat models (embedding, base, etc.)
 */
const NON_CHAT_MODELS = new Set([
  'text-embedding-ada-002',
  'text-embedding-3-small',
  'text-embedding-3-large',
  'davinci-002',
  'babbage-002',
  'text-davinci-003',
  'text-davinci-002',
  'text-davinci-001',
  'text-curie-001',
  'text-babbage-001',
  'text-ada-001',
  'code-davinci-002',
  'code-davinci-edit-001',
  'text-davinci-edit-001',
  'davinci',
  'curie',
  'babbage',
  'ada',
]);

/**
 * Check if a model supports chat completions.
 *
 * @param model - The model name
 * @returns true if the model is a chat model
 */
export function isChatModel(model: string): boolean {
  // Explicit non-chat models
  if (NON_CHAT_MODELS.has(model)) {
    return false;
  }

  // Check prefixes
  for (const prefix of CHAT_MODEL_PREFIXES) {
    if (model === prefix || model.startsWith(`${prefix}-`)) {
      return true;
    }
  }

  // Fine-tuned chat models
  if (model.startsWith('ft:')) {
    const baseModel = model.slice(3).split(':')[0];
    return isChatModel(baseModel);
  }

  return false;
}

/**
 * Check if a model is a known Anthropic model.
 */
export function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-');
}

/**
 * Check if a model is a known Google model.
 */
export function isGoogleModel(model: string): boolean {
  return model.startsWith('gemini-');
}
