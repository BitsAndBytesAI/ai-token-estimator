/**
 * BPE tokenizer public API.
 *
 * Provides encode/decode functionality compatible with OpenAI's tiktoken.
 */

import { BPETokenizer } from './core.js';
import { getSpecialTokenMap } from './special-tokens.js';
import { getTokenSplitRegex } from '../encodings/regex.js';
import { resolveModelEncoding, DEFAULT_ENCODING } from '../mappings/model-to-encoding.js';
import {
  R50K_BASE_VOCAB,
  P50K_BASE_VOCAB,
  P50K_EDIT_VOCAB,
  CL100K_BASE_VOCAB,
  O200K_BASE_VOCAB,
  O200K_HARMONY_VOCAB,
} from '../encodings/generated/index.js';
import type {
  OpenAIEncoding,
  EncodingApi,
  TokenizerConfig,
  TokenVocabulary,
} from './types.js';

// Re-export types
export type {
  OpenAIEncoding,
  SpecialTokenHandling,
  EncodeOptions,
  DecodeOptions,
  EncodingApi,
} from './types.js';

// Re-export special tokens
export { SPECIAL_TOKEN_SET, ALL_SPECIAL_TOKEN_STRINGS } from './special-tokens.js';

// Re-export model utilities
export { resolveModelEncoding, isKnownModel, DEFAULT_ENCODING } from '../mappings/model-to-encoding.js';
export { isChatModel, isAnthropicModel, isGoogleModel } from '../mappings/chat-models.js';

/**
 * Static vocabulary map - no filesystem loading needed.
 * This ensures the tokenizer works correctly in bundled/dist builds.
 */
const VOCAB_BY_ENCODING: Record<OpenAIEncoding, TokenVocabulary> = {
  r50k_base: R50K_BASE_VOCAB,
  p50k_base: P50K_BASE_VOCAB,
  p50k_edit: P50K_EDIT_VOCAB,
  cl100k_base: CL100K_BASE_VOCAB,
  o200k_base: O200K_BASE_VOCAB,
  o200k_harmony: O200K_HARMONY_VOCAB,
};

/**
 * Cache for loaded tokenizers.
 */
const tokenizerCache = new Map<OpenAIEncoding, BPETokenizer>();

/**
 * Get vocabulary for an encoding (sync, from static imports).
 */
function getVocabulary(encoding: OpenAIEncoding): TokenVocabulary {
  const vocab = VOCAB_BY_ENCODING[encoding];
  if (!vocab) {
    throw new Error(`Unknown encoding: ${encoding}`);
  }
  return vocab;
}

/**
 * Create a tokenizer for an encoding.
 */
function createTokenizer(encoding: OpenAIEncoding, vocab: TokenVocabulary): BPETokenizer {
  const config: TokenizerConfig = {
    vocabDecoder: vocab,
    specialTokenMap: getSpecialTokenMap(encoding),
    tokenSplitRegex: getTokenSplitRegex(encoding),
  };

  return new BPETokenizer(config);
}

/**
 * Get a tokenizer for an encoding (async version for backwards compatibility).
 */
export async function getTokenizerAsync(encoding: OpenAIEncoding): Promise<EncodingApi> {
  let tokenizer = tokenizerCache.get(encoding);

  if (!tokenizer) {
    const vocab = getVocabulary(encoding);
    tokenizer = createTokenizer(encoding, vocab);
    tokenizerCache.set(encoding, tokenizer);
  }

  return {
    encode: (text: string, allowedSpecial?: Set<string> | 'all' | 'skip') =>
      tokenizer!.encodeText(text, allowedSpecial),
    decode: (tokens: Iterable<number>) => tokenizer!.decodeTokens(tokens),
  };
}

/**
 * Get the tokenizer for an encoding (sync).
 */
export function getTokenizer(encoding: OpenAIEncoding): EncodingApi {
  let tokenizer = tokenizerCache.get(encoding);

  if (!tokenizer) {
    const vocab = getVocabulary(encoding);
    tokenizer = createTokenizer(encoding, vocab);
    tokenizerCache.set(encoding, tokenizer);
  }

  return {
    encode: (text: string, allowedSpecial?: Set<string> | 'all' | 'skip') =>
      tokenizer!.encodeText(text, allowedSpecial),
    decode: (tokens: Iterable<number>) => tokenizer!.decodeTokens(tokens),
  };
}

/**
 * Preload a tokenizer for sync access later.
 * Note: With static imports, this is now essentially a no-op that just
 * ensures the tokenizer is cached. Kept for API compatibility.
 */
export async function preloadTokenizer(encoding: OpenAIEncoding): Promise<void> {
  if (!tokenizerCache.has(encoding)) {
    const vocab = getVocabulary(encoding);
    const tokenizer = createTokenizer(encoding, vocab);
    tokenizerCache.set(encoding, tokenizer);
  }
}

/**
 * Check if a tokenizer is loaded.
 */
export function isTokenizerLoaded(encoding: OpenAIEncoding): boolean {
  return tokenizerCache.has(encoding);
}

/**
 * Clear the tokenizer cache.
 */
export function clearTokenizerCache(): void {
  tokenizerCache.clear();
}

/**
 * Resolve the encoding for a model or encoding selector.
 */
export function resolveEncoding(options?: {
  encoding?: OpenAIEncoding;
  model?: string;
}): OpenAIEncoding {
  if (options?.encoding) {
    return options.encoding;
  }

  if (options?.model) {
    return resolveModelEncoding(options.model);
  }

  return DEFAULT_ENCODING;
}
