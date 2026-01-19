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
 *
 * Token bytes are stored as latin-1 encoded strings, where each character
 * code (0-255) represents one byte. This matches tiktoken's internal format.
 *
 * - string: latin-1 byte string (charCodeAt(i) gives byte value at position i)
 * - number[]: byte array (legacy format, converted to latin-1 string on load)
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
 * Result from encodeTextWithLimit.
 */
export interface EncodeWithLimitResult {
  /** Number of tokens counted */
  count: number;
  /** Whether the limit was exceeded */
  exceeded: boolean;
}

/**
 * Encoding API returned by getTokenizer().
 */
export interface EncodingApi {
  encode: (text: string, allowedSpecial?: Set<string> | 'all' | 'skip') => number[];
  decode: (tokens: Iterable<number>) => string;
  /**
   * Encode with early exit when token limit is exceeded.
   * Returns count and whether the limit was exceeded.
   */
  encodeTextWithLimit: (
    text: string,
    limit: number,
    allowedSpecial?: Set<string> | 'all' | 'skip'
  ) => EncodeWithLimitResult;

  // Generator methods

  /**
   * Generator version of encode. Yields token arrays per regex-matched piece.
   * Returns total token count.
   */
  encodeGenerator: (
    text: string,
    allowedSpecial?: Set<string> | 'all' | 'skip'
  ) => Generator<number[], number, undefined>;

  /**
   * Generator version of decode. Yields text chunks.
   * May yield empty strings when buffering incomplete UTF-8 sequences.
   */
  decodeGenerator: (tokens: Iterable<number>) => Generator<string, void, void>;

  /**
   * Async generator version of decode.
   * Accepts single tokens or token arrays for flexibility with streaming APIs.
   */
  decodeAsyncGenerator: (
    tokens: AsyncIterable<number | number[]>
  ) => AsyncGenerator<string, void, void>;
}
