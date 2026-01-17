/**
 * BPE tokenizer public API.
 *
 * Provides encode/decode functionality compatible with OpenAI's tiktoken.
 */

import { createRequire } from 'node:module';
import { BPETokenizer } from './core.js';
import { getSpecialTokenMap } from './special-tokens.js';
import { getTokenSplitRegex } from '../encodings/regex.js';
import { resolveModelEncoding, DEFAULT_ENCODING } from '../mappings/model-to-encoding.js';
import type {
  OpenAIEncoding,
  EncodingApi,
  TokenizerConfig,
  TokenVocabulary,
} from './types.js';

// Setup require for sync loading
// __filename exists in CJS, import.meta.url exists in ESM
declare const __filename: string | undefined;
const requireBase =
  typeof __filename === 'string' && __filename.length > 0
    ? __filename
    : import.meta.url;
const nodeRequire = createRequire(requireBase);

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
 * Cache for loaded tokenizers.
 */
const tokenizerCache = new Map<OpenAIEncoding, BPETokenizer>();

/**
 * Lazily load vocabulary for an encoding.
 */
async function loadVocabulary(encoding: OpenAIEncoding): Promise<TokenVocabulary> {
  switch (encoding) {
    case 'r50k_base': {
      const { VOCAB } = await import('../encodings/generated/r50k_base.js');
      return VOCAB;
    }
    case 'p50k_base': {
      const { VOCAB } = await import('../encodings/generated/p50k_base.js');
      return VOCAB;
    }
    case 'p50k_edit': {
      const { VOCAB } = await import('../encodings/generated/p50k_edit.js');
      return VOCAB;
    }
    case 'cl100k_base': {
      const { VOCAB } = await import('../encodings/generated/cl100k_base.js');
      return VOCAB;
    }
    case 'o200k_base': {
      const { VOCAB } = await import('../encodings/generated/o200k_base.js');
      return VOCAB;
    }
    case 'o200k_harmony': {
      const { VOCAB } = await import('../encodings/generated/o200k_harmony.js');
      return VOCAB;
    }
    default: {
      const _exhaustive: never = encoding;
      throw new Error(`Unknown encoding: ${_exhaustive}`);
    }
  }
}

/**
 * Module paths for each encoding vocabulary.
 */
const ENCODING_MODULES: Record<OpenAIEncoding, string> = {
  r50k_base: '../encodings/generated/r50k_base.js',
  p50k_base: '../encodings/generated/p50k_base.js',
  p50k_edit: '../encodings/generated/p50k_edit.js',
  cl100k_base: '../encodings/generated/cl100k_base.js',
  o200k_base: '../encodings/generated/o200k_base.js',
  o200k_harmony: '../encodings/generated/o200k_harmony.js',
};

/**
 * Synchronously load vocabulary for an encoding.
 * Uses createRequire for sync imports in both CJS and ESM.
 */
function loadVocabularySync(encoding: OpenAIEncoding): TokenVocabulary {
  const modulePath = ENCODING_MODULES[encoding];
  if (!modulePath) {
    throw new Error(`Unknown encoding: ${encoding}`);
  }

  const mod = nodeRequire(modulePath) as { VOCAB: TokenVocabulary };
  return mod.VOCAB;
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
 * Get a tokenizer for an encoding (async, lazy loading).
 */
export async function getTokenizerAsync(encoding: OpenAIEncoding): Promise<EncodingApi> {
  let tokenizer = tokenizerCache.get(encoding);

  if (!tokenizer) {
    const vocab = await loadVocabulary(encoding);
    tokenizer = createTokenizer(encoding, vocab);
    tokenizerCache.set(encoding, tokenizer);
  }

  return {
    encode: (text: string, allowedSpecial?: Set<string> | 'all') =>
      tokenizer!.encodeText(text, allowedSpecial),
    decode: (tokens: Iterable<number>) => tokenizer!.decodeTokens(tokens),
  };
}

/**
 * Get the tokenizer for an encoding (sync, lazy-loads on first use).
 */
export function getTokenizer(encoding: OpenAIEncoding): EncodingApi {
  let tokenizer = tokenizerCache.get(encoding);

  if (!tokenizer) {
    const vocab = loadVocabularySync(encoding);
    tokenizer = createTokenizer(encoding, vocab);
    tokenizerCache.set(encoding, tokenizer);
  }

  return {
    encode: (text: string, allowedSpecial?: Set<string> | 'all') =>
      tokenizer!.encodeText(text, allowedSpecial),
    decode: (tokens: Iterable<number>) => tokenizer!.decodeTokens(tokens),
  };
}

/**
 * Preload a tokenizer for sync access later.
 */
export async function preloadTokenizer(encoding: OpenAIEncoding): Promise<void> {
  if (!tokenizerCache.has(encoding)) {
    const vocab = await loadVocabulary(encoding);
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
