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
 * Returns:
 * - 'skip': skip special token handling entirely (encode as regular text)
 * - 'all' or Set: allow these special tokens
 * - undefined: throw on special tokens (default)
 */
function resolveAllowedSpecial(
  allowSpecial: SpecialTokenHandling | undefined
): Set<string> | 'all' | 'skip' | undefined {
  const mode = allowSpecial ?? 'none_raise';

  switch (mode) {
    case 'all':
      // Allow all special tokens
      return SPECIAL_TOKEN_SET;
    case 'none':
      // Treat special tokens as regular text - skip detection entirely
      return 'skip';
    case 'none_raise':
    default:
      // Throw on special tokens (default behavior)
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

// =============================================================================
// isWithinTokenLimit API
// =============================================================================

/**
 * Options for isWithinTokenLimit.
 */
export interface IsWithinTokenLimitOptions {
  /**
   * Explicit OpenAI encoding override.
   * When provided, this takes precedence over `model`.
   */
  encoding?: OpenAIEncoding;
  /**
   * OpenAI model ID used to select the appropriate encoding.
   * Note: Non-OpenAI models (claude-*, gemini-*) are rejected.
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
 * Validate tokenLimit is a non-negative finite integer.
 */
function validateTokenLimit(tokenLimit: number): void {
  if (!Number.isFinite(tokenLimit)) {
    throw new Error('tokenLimit must be a finite number');
  }
  if (!Number.isInteger(tokenLimit)) {
    throw new Error('tokenLimit must be an integer');
  }
  if (tokenLimit < 0) {
    throw new Error('tokenLimit must be non-negative');
  }
}

/**
 * Reject known non-OpenAI models.
 * Must be called BEFORE resolveEncoding() since that defaults to o200k_base for unknown models.
 */
function rejectNonOpenAIModel(model: string | undefined): void {
  if (!model) return;
  if (model.startsWith('claude-')) {
    throw new Error(
      `Model "${model}" is an Anthropic model. isWithinTokenLimit only supports OpenAI models. ` +
        "Use the Anthropic API's count_tokens endpoint via estimateAsync() instead."
    );
  }
  if (model.startsWith('gemini-')) {
    throw new Error(
      `Model "${model}" is a Google model. isWithinTokenLimit only supports OpenAI models. ` +
        "Use the Gemini API's countTokens endpoint via estimateAsync() instead."
    );
  }
}

/**
 * Check if text is within a token limit, with early exit optimization.
 *
 * Returns `false` if the token count exceeds the limit, otherwise returns the
 * actual token count. This is significantly faster than full tokenization when
 * the limit is exceeded early in the text.
 *
 * @param text - The text to check
 * @param tokenLimit - Maximum allowed tokens (must be non-negative finite integer)
 * @param options - Encoding options
 * @returns `false` if exceeded, or the actual token count if within limit
 * @throws Error if tokenLimit is invalid (NaN, Infinity, negative, non-integer)
 * @throws Error if model is a known non-OpenAI model (claude-*, gemini-*)
 *
 * @example
 * ```typescript
 * // Returns token count if within limit
 * const count = isWithinTokenLimit('Hello, world!', 100, { model: 'gpt-4o' });
 * if (count !== false) {
 *   console.log(`Text has ${count} tokens`);
 * }
 *
 * // Returns false if exceeds limit
 * const result = isWithinTokenLimit(longText, 10, { model: 'gpt-4o' });
 * if (result === false) {
 *   console.log('Text exceeds 10 tokens');
 * }
 * ```
 */
export function isWithinTokenLimit(
  text: string,
  tokenLimit: number,
  options?: IsWithinTokenLimitOptions
): false | number {
  validateTokenLimit(tokenLimit);
  rejectNonOpenAIModel(options?.model);

  const encoding = resolveEncoding(options);
  const api = getTokenizer(encoding);
  const allowedSpecial = resolveAllowedSpecial(options?.allowSpecial);

  const result = api.encodeTextWithLimit(text, tokenLimit, allowedSpecial);

  return result.exceeded ? false : result.count;
}

// =============================================================================
// Generator APIs
// =============================================================================

/**
 * Encode text yielding token chunks. Memory-efficient for large inputs.
 *
 * Yields token arrays per regex-matched piece (word/punctuation), not per token.
 * Returns total token count when iteration completes.
 *
 * @param text - The text to encode
 * @param options - Encoding options
 * @returns Generator that yields token arrays per piece, returns total count
 *
 * @example
 * ```typescript
 * // Stream-encode large text
 * let tokenCount = 0;
 * for (const tokenChunk of encodeGenerator(hugeText, { model: 'gpt-4o' })) {
 *   tokenCount += tokenChunk.length;
 * }
 *
 * // Or get total count from return value
 * const gen = encodeGenerator(text, { model: 'gpt-4o' });
 * let result = gen.next();
 * while (!result.done) result = gen.next();
 * console.log('Total tokens:', result.value);
 * ```
 */
export function encodeGenerator(
  text: string,
  options?: EncodeOptions
): Generator<number[], number, undefined> {
  const encoding = resolveEncoding(options);
  const api = getTokenizer(encoding);
  const allowedSpecial = resolveAllowedSpecial(options?.allowSpecial);
  return api.encodeGenerator(text, allowedSpecial);
}

/**
 * Decode tokens yielding text chunks.
 * Uses TextDecoder streaming mode - may yield empty strings when buffering
 * incomplete UTF-8 sequences.
 *
 * @param tokens - Token IDs to decode
 * @param options - Decoding options
 * @returns Generator that yields text chunks
 *
 * @example
 * ```typescript
 * const tokens = encode('Hello, world!', { model: 'gpt-4o' });
 * for (const textChunk of decodeGenerator(tokens, { model: 'gpt-4o' })) {
 *   process.stdout.write(textChunk);
 * }
 * ```
 */
export function* decodeGenerator(
  tokens: Iterable<number>,
  options?: Pick<EncodeOptions, 'encoding' | 'model'>
): Generator<string, void, void> {
  const encoding = resolveEncoding(options);
  const api = getTokenizer(encoding);
  yield* api.decodeGenerator(tokens);
}

/**
 * Decode async token stream yielding text chunks.
 * Accepts single tokens or token arrays for flexibility with streaming APIs.
 *
 * Uses TextDecoder streaming mode - may yield empty strings when buffering
 * incomplete UTF-8 sequences.
 *
 * @param tokens - Async iterable of token IDs (numbers or number arrays)
 * @param options - Decoding options
 * @returns AsyncGenerator that yields text chunks
 *
 * @example
 * ```typescript
 * // Decode streaming LLM response
 * async function decodeLLMStream(tokenStream: AsyncIterable<number>) {
 *   for await (const text of decodeAsyncGenerator(tokenStream, { model: 'gpt-4o' })) {
 *     process.stdout.write(text);
 *   }
 * }
 * ```
 */
export async function* decodeAsyncGenerator(
  tokens: AsyncIterable<number | number[]>,
  options?: Pick<EncodeOptions, 'encoding' | 'model'>
): AsyncGenerator<string, void, void> {
  const encoding = resolveEncoding(options);
  const api = getTokenizer(encoding);
  yield* api.decodeAsyncGenerator(tokens);
}
