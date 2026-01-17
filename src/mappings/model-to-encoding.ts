/**
 * Model to encoding mappings.
 *
 * Based on OpenAI's tiktoken mapping strategy with prefix-based rules
 * for forward compatibility with new model revisions.
 */

import type { OpenAIEncoding } from '../bpe/types.js';

/**
 * Explicit model → encoding mapping for known models.
 */
export const MODEL_TO_ENCODING: Record<string, OpenAIEncoding> = {
  // o200k_base models
  'gpt-4o': 'o200k_base',
  'gpt-4o-mini': 'o200k_base',
  'o1': 'o200k_base',
  'o1-mini': 'o200k_base',
  'o1-preview': 'o200k_base',
  'o3': 'o200k_base',
  'o3-mini': 'o200k_base',

  // cl100k_base models
  'gpt-4': 'cl100k_base',
  'gpt-4-turbo': 'cl100k_base',
  'gpt-4-turbo-preview': 'cl100k_base',
  'gpt-4-vision-preview': 'cl100k_base',
  'gpt-3.5-turbo': 'cl100k_base',
  'gpt-3.5-turbo-instruct': 'cl100k_base',

  // Embedding models
  'text-embedding-ada-002': 'cl100k_base',
  'text-embedding-3-small': 'cl100k_base',
  'text-embedding-3-large': 'cl100k_base',

  // Base models
  'davinci-002': 'cl100k_base',
  'babbage-002': 'cl100k_base',

  // Legacy p50k_base models
  'text-davinci-003': 'p50k_base',
  'text-davinci-002': 'p50k_base',
  'code-davinci-002': 'p50k_base',

  // Legacy p50k_edit models
  'code-davinci-edit-001': 'p50k_edit',
  'text-davinci-edit-001': 'p50k_edit',

  // Legacy r50k_base models
  'text-davinci-001': 'r50k_base',
  'text-curie-001': 'r50k_base',
  'text-babbage-001': 'r50k_base',
  'text-ada-001': 'r50k_base',
  'davinci': 'r50k_base',
  'curie': 'r50k_base',
  'babbage': 'r50k_base',
  'ada': 'r50k_base',

  // Open-weight models
  'gpt-oss-20b': 'o200k_harmony',
  'gpt-oss-120b': 'o200k_harmony',
};

/**
 * Prefix-based model → encoding rules for forward compatibility.
 * Order matters: more specific prefixes should come first.
 */
export const MODEL_PREFIX_TO_ENCODING: ReadonlyArray<
  readonly [string, OpenAIEncoding]
> = [
  // o200k_base prefixes (newest models)
  ['o1-', 'o200k_base'],
  ['o3-', 'o200k_base'],
  ['o4-mini', 'o200k_base'],
  ['gpt-5', 'o200k_base'],
  ['gpt-4.5', 'o200k_base'],
  ['gpt-4.1', 'o200k_base'],
  ['gpt-4o-', 'o200k_base'],
  ['chatgpt-4o-', 'o200k_base'],

  // cl100k_base prefixes
  ['gpt-4-', 'cl100k_base'],
  ['gpt-3.5-turbo-', 'cl100k_base'],
  ['gpt-35-turbo-', 'cl100k_base'], // Azure naming

  // Fine-tune prefixes
  ['ft:gpt-4o', 'o200k_base'],
  ['ft:gpt-4', 'cl100k_base'],
  ['ft:gpt-3.5-turbo', 'cl100k_base'],
  ['ft:davinci-002', 'cl100k_base'],
  ['ft:babbage-002', 'cl100k_base'],

  // Open-weight prefixes
  ['gpt-oss-', 'o200k_harmony'],
];

/**
 * Default encoding for unknown models.
 */
export const DEFAULT_ENCODING: OpenAIEncoding = 'o200k_base';

/**
 * Resolve the encoding for a model.
 *
 * @param model - The model name
 * @returns The encoding to use
 */
export function resolveModelEncoding(model: string): OpenAIEncoding {
  // Check explicit mapping first
  const explicit = MODEL_TO_ENCODING[model];
  if (explicit) {
    return explicit;
  }

  // Check prefix rules
  for (const [prefix, encoding] of MODEL_PREFIX_TO_ENCODING) {
    if (model.startsWith(prefix)) {
      return encoding;
    }
  }

  // Fall back to default
  return DEFAULT_ENCODING;
}

/**
 * Check if a model is in the known model list.
 */
export function isKnownModel(model: string): boolean {
  if (model in MODEL_TO_ENCODING) {
    return true;
  }

  for (const [prefix] of MODEL_PREFIX_TO_ENCODING) {
    if (model.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}
