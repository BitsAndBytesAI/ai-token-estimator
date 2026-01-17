/**
 * OpenAI BPE tokenization API.
 *
 * Provides encode/decode functions for OpenAI models using our native
 * BPE implementation (tiktoken-compatible).
 */

import {
  getTokenizer,
  resolveEncoding,
  SPECIAL_TOKEN_SET,
} from './bpe/index.js';
import type { OpenAIEncoding, SpecialTokenHandling } from './bpe/types.js';

// Re-export types for backwards compatibility
export type { OpenAIEncoding, SpecialTokenHandling } from './bpe/types.js';

export interface EncodeOptions {
  /**
   * Explicit OpenAI encoding override.
   * When provided, this takes precedence over `model`.
   */
  encoding?: OpenAIEncoding;
  /**
   * OpenAI model ID used to select the appropriate encoding.
   */
  model?: string;
  /**
   * How special tokens are handled.
   * - `none_raise` (default): throw if special tokens appear
   * - `none`: treat special tokens as regular text
   * - `all`: allow special tokens and encode them as special token IDs
   */
  allowSpecial?: SpecialTokenHandling;
}

/**
 * Resolve the OpenAI encoding that will be used for a given model/encoding selector.
 */
export function getOpenAIEncoding(
  selector?: Pick<EncodeOptions, 'encoding' | 'model'>
): OpenAIEncoding {
  return resolveEncoding(selector);
}

/**
 * Convert our SpecialTokenHandling to the format expected by BPETokenizer.
 */
function resolveAllowedSpecial(
  allowSpecial: SpecialTokenHandling | undefined
): Set<string> | 'all' | undefined {
  const mode = allowSpecial ?? 'none_raise';

  switch (mode) {
    case 'all':
      // Allow all special tokens
      return SPECIAL_TOKEN_SET;
    case 'none':
      // Treat special tokens as regular text (empty allowed set, no throw)
      // Return undefined to skip special token handling entirely
      return new Set();
    case 'none_raise':
    default:
      // Throw on special tokens (default behavior)
      // Return undefined to use default behavior in tokenizer
      return undefined;
  }
}

/**
 * Encode text into OpenAI token IDs using tiktoken-compatible BPE encoding.
 *
 * This is exact tokenization for OpenAI models (unlike heuristic estimators).
 */
export function encode(text: string, options?: EncodeOptions): number[] {
  const encoding = resolveEncoding(options);
  const api = getTokenizer(encoding);
  const allowedSpecial = resolveAllowedSpecial(options?.allowSpecial);
  return api.encode(text, allowedSpecial);
}

/**
 * Decode OpenAI token IDs into text using tiktoken-compatible BPE encoding.
 */
export function decode(
  tokens: Iterable<number>,
  options?: Pick<EncodeOptions, 'encoding' | 'model'>
): string {
  const encoding = resolveEncoding(options);
  const api = getTokenizer(encoding);
  return api.decode(tokens);
}
