/**
 * Type definitions for the BPE tokenizer.
 */

/**
 * OpenAI encoding types.
 */
export type OpenAIEncoding =
  | 'r50k_base'
  | 'p50k_base'
  | 'p50k_edit'
  | 'cl100k_base'
  | 'o200k_base'
  | 'o200k_harmony';

/**
 * How special tokens are handled during encoding.
 */
export type SpecialTokenHandling =
  /** Allow special tokens and encode them as special token IDs */
  | 'all'
  /** Treat special tokens as regular text */
  | 'none'
  /** Throw error if special token strings appear (default) */
  | 'none_raise';

/**
 * Vocabulary data: array where index = token rank, value = token bytes.
 * - string: UTF-8 valid token
 * - number[]: byte array for non-UTF8 tokens
 */
export type TokenVocabulary = readonly (string | readonly number[])[];

/**
 * Configuration for BPETokenizer.
 */
export interface TokenizerConfig {
  /** Vocabulary decoder: index = rank, value = token bytes */
  vocabDecoder: TokenVocabulary;
  /** Special tokens: string → rank */
  specialTokenMap?: Map<string, number>;
  /** Regex pattern to split text into pre-tokens */
  tokenSplitRegex: RegExp;
  /** LRU cache capacity (default: 100_000) */
  cacheCapacity?: number;
}

/**
 * Options for encoding text.
 */
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
 * Options for decoding tokens.
 */
export interface DecodeOptions {
  /**
   * Explicit OpenAI encoding override.
   */
  encoding?: OpenAIEncoding;
  /**
   * OpenAI model ID used to select the appropriate encoding.
   */
  model?: string;
}

/**
 * Encoding API returned by getTokenizer().
 */
export interface EncodingApi {
  encode: (text: string, allowedSpecial?: Set<string> | 'all') => number[];
  decode: (tokens: Iterable<number>) => string;
}
