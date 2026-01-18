/**
 * SentencePiece Tokenizer
 *
 * Main tokenizer class that orchestrates parsing, normalization, and encoding/decoding.
 * Supports both SentencePiece .model files (protobuf) and HuggingFace tokenizer.json files.
 */

import { parseModelProto } from './protobuf/decoder.js';
import { ModelType } from './protobuf/schema.js';
import type { ModelProto } from './protobuf/schema.js';
import { Normalizer } from './normalizer/index.js';
import { BPEEncoder, UnigramEncoder, JsonBPEEncoder } from './algorithms/index.js';
import { parseHFTokenizerJson, type ParsedJsonTokenizer } from './json/index.js';
import { getCachedModel, setCachedModel, getModelCacheKey } from './cache.js';

/**
 * Tokenizer interface
 */
export interface SentencePieceTokenizer {
  encode(text: string): number[];
  decode(tokens: number[]): string;
  readonly vocabSize: number;
  readonly algorithm: 'bpe' | 'unigram';
}

/**
 * Options for creating a tokenizer from in-memory data
 */
export interface DataOptions {
  /** Model data as Uint8Array or ArrayBuffer */
  modelData: Uint8Array | ArrayBuffer;
  /** Format hint ('protobuf' or 'json', auto-detected if omitted) */
  format?: 'protobuf' | 'json';
}

/**
 * Create a tokenizer from in-memory model data
 *
 * This is the sync API suitable for browser/serverless environments.
 */
export function getSentencePieceTokenizer(options: DataOptions): SentencePieceTokenizer {
  const bytes =
    options.modelData instanceof ArrayBuffer ? new Uint8Array(options.modelData) : options.modelData;

  // Auto-detect format if not specified
  const format = options.format ?? detectFormat(bytes);

  if (format === 'json') {
    const text = new TextDecoder().decode(bytes);
    const parsed = parseHFTokenizerJson(text);
    return createTokenizerFromJson(parsed);
  }

  // Protobuf format
  return createTokenizerFromProtobuf(bytes);
}

/**
 * Detect model format from content
 */
function detectFormat(bytes: Uint8Array): 'protobuf' | 'json' {
  // JSON files start with '{' or whitespace followed by '{'
  const start = bytes.slice(0, 100);
  const text = new TextDecoder().decode(start);
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return 'json';
  }
  return 'protobuf';
}

/**
 * Create tokenizer from protobuf model data
 */
function createTokenizerFromProtobuf(bytes: Uint8Array): SentencePieceTokenizer {
  // Check cache first
  const cacheKey = getModelCacheKey(bytes);
  let model = getCachedModel(cacheKey);

  if (!model) {
    model = parseModelProto(bytes);
    setCachedModel(cacheKey, model);
  }

  return createTokenizerFromModel(model);
}

/**
 * Create tokenizer from parsed ModelProto
 */
function createTokenizerFromModel(model: ModelProto): SentencePieceTokenizer {
  const { pieces, trainerSpec, normalizerSpec, denormalizerSpec } = model;

  // Create normalizer if spec is present
  const normalizer = normalizerSpec
    ? new Normalizer({
        normalizerSpec,
        denormalizerSpec,
      })
    : null;

  // Determine algorithm from trainer spec
  const modelType = trainerSpec?.modelType ?? ModelType.UNIGRAM;
  const algorithm: 'bpe' | 'unigram' = modelType === ModelType.BPE ? 'bpe' : 'unigram';

  if (algorithm === 'bpe') {
    const encoder = new BPEEncoder(pieces, { trainerSpec });

    return {
      encode(text: string): number[] {
        const normalized = normalizer ? normalizer.normalize(text) : text;
        return encoder.encode(normalized);
      },
      decode(tokens: number[]): string {
        const text = encoder.decode(tokens);
        return normalizer ? normalizer.denormalize(text) : text;
      },
      get vocabSize() {
        return encoder.vocabSize;
      },
      algorithm: 'bpe',
    };
  }

  // Unigram
  const encoder = new UnigramEncoder(pieces, { trainerSpec });

  // Get the whitespace prefix token ID for checking if we should strip dummy prefix
  const whitespacePrefix = normalizerSpec?.escapeWhitespaces ? '\u2581' : ' ';

  return {
    encode(text: string): number[] {
      const normalized = normalizer ? normalizer.normalize(text) : text;
      return encoder.encode(normalized);
    },
    decode(tokens: number[]): string {
      const rawText = encoder.decode(tokens);

      if (!normalizer) {
        return rawText;
      }

      // Python sentencepiece only strips leading space if first piece starts with ▁
      // Check if raw decoded text starts with ▁
      const startsWithPrefix = rawText.startsWith(whitespacePrefix);

      let result = normalizer.denormalize(rawText);

      // If the original didn't start with ▁, restore the leading space that was stripped
      if (!startsWithPrefix && normalizerSpec?.addDummyPrefix && !rawText.startsWith(whitespacePrefix)) {
        // The denormalizer stripped a leading space, but the original didn't have ▁
        // This can happen when UNK token outputs ` ⁇ ` with leading space
        // In this case Python keeps the leading space
        if (rawText.startsWith(' ') && !result.startsWith(' ')) {
          result = ' ' + result;
        }
      }

      return result;
    },
    get vocabSize() {
      return encoder.vocabSize;
    },
    algorithm: 'unigram',
  };
}

/**
 * Create tokenizer from parsed tokenizer.json
 */
function createTokenizerFromJson(parsed: ParsedJsonTokenizer): SentencePieceTokenizer {
  if (parsed.modelType === 'json-bpe') {
    const encoder = new JsonBPEEncoder(parsed.vocab!, parsed.merges!, {
      normalizer: parsed.normalizer ?? undefined,
      byteFallback: parsed.byteFallback,
      unkId: parsed.unkId,
      continuingSubwordPrefix: parsed.continuingSubwordPrefix,
      endOfWordSuffix: parsed.endOfWordSuffix,
      whitespaceReplacement: parsed.metaspace?.replacement,
      addPrefixSpace: parsed.metaspace?.addPrefixSpace,
      addedTokens: parsed.addedTokens,
    });

    return {
      encode(text: string): number[] {
        return encoder.encode(text);
      },
      decode(tokens: number[]): string {
        let text = encoder.decode(tokens);
        // Reverse metaspace replacement for output
        if (parsed.metaspace?.replacement) {
          const replacement = parsed.metaspace.replacement;
          text = text.split(replacement).join(' ');
          // Remove leading space if add_prefix_space was true
          if (parsed.metaspace.addPrefixSpace && text.startsWith(' ')) {
            text = text.slice(1);
          }
        }
        return text;
      },
      get vocabSize() {
        return encoder.vocabSize;
      },
      algorithm: 'bpe',
    };
  }

  // Unigram from JSON
  const encoder = new UnigramEncoder(parsed.pieces!, {
    trainerSpec: parsed.trainerSpec,
    addedTokens: parsed.addedTokens,
    normalizer: parsed.normalizer ?? undefined,
  });

  return {
    encode(text: string): number[] {
      // Apply normalizer and metaspace pre-tokenization if configured
      let input = text;
      if (parsed.normalizer) {
        input = parsed.normalizer.normalize(input);
      }
      if (parsed.metaspace) {
        // Metaspace pre-tokenization
        if (parsed.metaspace.addPrefixSpace && input.length > 0 && !/^\s/.test(input)) {
          input = ' ' + input;
        }
        input = input.split(' ').join(parsed.metaspace.replacement);
      }
      return encoder.encode(input);
    },
    decode(tokens: number[]): string {
      let text = encoder.decode(tokens);
      // Reverse metaspace replacement for output
      if (parsed.metaspace?.replacement) {
        const replacement = parsed.metaspace.replacement;
        text = text.split(replacement).join(' ');
        // Remove leading space if add_prefix_space was true
        if (parsed.metaspace.addPrefixSpace && text.startsWith(' ')) {
          text = text.slice(1);
        }
      }
      return text;
    },
    get vocabSize() {
      return encoder.vocabSize;
    },
    algorithm: 'unigram',
  };
}

// === Convenience functions ===

/**
 * Encode text to token IDs
 */
export function encodeSentencePiece(text: string, options: DataOptions): number[] {
  return getSentencePieceTokenizer(options).encode(text);
}

/**
 * Decode token IDs to text
 */
export function decodeSentencePiece(tokens: number[], options: DataOptions): string {
  return getSentencePieceTokenizer(options).decode(tokens);
}

/**
 * Count tokens in text
 */
export function countSentencePieceTokens(text: string, options: DataOptions): number {
  return getSentencePieceTokenizer(options).encode(text).length;
}
