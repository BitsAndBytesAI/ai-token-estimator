/**
 * HuggingFace tokenizer.json Parser
 *
 * Parses tokenizer.json files and converts them to a format usable by our encoders.
 *
 * Supported formats:
 * - Unigram models: Converted to SentencePiece pieces format
 * - BPE with Metaspace: Preserved as vocab + merges for JsonBPEEncoder
 */

import type { HFTokenizerConfig, HFPreTokenizer } from './types.js';
import type { SentencePiece, TrainerSpec } from '../protobuf/schema.js';
import { SentencePieceType, ModelType } from '../protobuf/schema.js';
import type { AddedToken, TextNormalizer } from '../algorithms/added-tokens.js';
import { validateJsonConfig, UnsupportedTokenizerError } from './validator.js';
import { buildHFNormalizer } from './normalizer.js';

/**
 * Parsed tokenizer.json result
 */
export interface ParsedJsonTokenizer {
  modelType: 'unigram' | 'json-bpe';
  normalizer: TextNormalizer | null;
  metaspace: { replacement: string; addPrefixSpace: boolean } | null;
  addedTokens: AddedToken[];

  // For Unigram
  pieces?: SentencePiece[];
  trainerSpec?: TrainerSpec;

  // For JSON-BPE (merges-based)
  vocab?: Record<string, number>;
  merges?: string[];
  unkId: number;
  byteFallback?: boolean;
  continuingSubwordPrefix?: string;
  endOfWordSuffix?: string;
}

/**
 * Parse a HuggingFace tokenizer.json file
 */
export function parseHFTokenizerJson(json: string | HFTokenizerConfig): ParsedJsonTokenizer {
  const config: HFTokenizerConfig = typeof json === 'string' ? JSON.parse(json) : json;

  // Validate configuration is within supported scope
  validateJsonConfig(config);

  const normalizer = buildHFNormalizer(config.normalizer);
  const metaspace = extractMetaspaceSpec(config.pre_tokenizer);

  if (config.model.type === 'BPE' && !metaspace) {
    throw new Error('BPE tokenizer.json requires Metaspace pre_tokenizer (validator should have enforced this)');
  }

  // Parse added_tokens (required for both BPE and Unigram)
  const addedTokens: AddedToken[] = (config.added_tokens ?? []).map((t) => ({
    id: t.id,
    content: t.content,
    special: t.special,
    lstrip: t.lstrip,
    rstrip: t.rstrip,
    single_word: t.single_word,
    normalized: t.normalized,
  }));

  if (config.model.type === 'Unigram') {
    // Unigram: convert to SentencePiece pieces format
    const pieces: SentencePiece[] = [];
    const vocab = config.model.vocab as Array<[string, number]>;

    for (const [piece, score] of vocab) {
      pieces.push({
        piece,
        score,
        type: determinePieceType(piece, config),
      });
    }

    // Resolve unkId from vocab
    const unkToken = config.model.unk_token ?? '<unk>';
    const unkEntry = vocab.find(([p]) => p === unkToken);
    if (!unkEntry && config.model.unk_token) {
      throw new Error(`unk_token "${config.model.unk_token}" not found in Unigram vocab`);
    }
    const unkId = unkEntry ? vocab.indexOf(unkEntry) : 0;

    const trainerSpec = buildTrainerSpec(config, pieces.length, ModelType.UNIGRAM);
    trainerSpec.unkId = unkId;
    trainerSpec.unkPiece = unkToken;

    return {
      modelType: 'unigram',
      normalizer,
      metaspace,
      addedTokens,
      pieces,
      trainerSpec,
      unkId,
    };
  } else if (config.model.type === 'BPE') {
    // JSON-BPE: preserve vocab and merges for merges-based encoder
    // Do NOT convert to pieces[] with scores - that's for SentencePiece BPE
    const vocab = config.model.vocab as Record<string, number>;

    // Resolve unkId from vocab (CRITICAL: must exist if unk_token is specified)
    const unkToken = config.model.unk_token ?? '<unk>';
    const unkId = vocab[unkToken];
    if (unkId === undefined && config.model.unk_token) {
      throw new Error(
        `unk_token "${config.model.unk_token}" not found in vocab. ` +
          `This would cause encode failures for unknown characters.`
      );
    }

    return {
      modelType: 'json-bpe',
      normalizer,
      metaspace,
      addedTokens,
      vocab,
      merges: config.model.merges ?? [],
      unkId: unkId ?? 0,
      byteFallback: config.model.byte_fallback ?? false,
      continuingSubwordPrefix: config.model.continuing_subword_prefix,
      endOfWordSuffix: config.model.end_of_word_suffix,
    };
  }

  throw new UnsupportedTokenizerError(`Unexpected model type: ${config.model.type}`);
}

/**
 * Determine the SentencePiece type for a piece
 */
function determinePieceType(piece: string, config: HFTokenizerConfig): SentencePieceType {
  if (/^<0x[0-9A-Fa-f]{2}>$/.test(piece)) return SentencePieceType.BYTE;
  if (piece === (config.model.unk_token ?? '<unk>')) return SentencePieceType.UNKNOWN;
  if (piece.startsWith('<') && piece.endsWith('>')) return SentencePieceType.CONTROL;
  return SentencePieceType.NORMAL;
}

/**
 * Build a TrainerSpec from tokenizer.json config
 */
function buildTrainerSpec(
  config: HFTokenizerConfig,
  vocabSize: number,
  modelType: ModelType
): TrainerSpec {
  return {
    modelType,
    vocabSize,
    byteFallback: config.model.byte_fallback ?? false,
    splitDigits: false,
    splitByWhitespace: true,
    splitByUnicodeScript: true,
    treatWhitespaceAsSuffix: false,
    unkId: 0, // Resolved by parser
    bosId: -1,
    eosId: -1,
    padId: -1,
    unkPiece: config.model.unk_token ?? '<unk>',
    bosPiece: '<s>',
    eosPiece: '</s>',
    padPiece: '<pad>',
    maxSentencepieceLength: 16,
  };
}

/**
 * Extract Metaspace pre-tokenizer config from tokenizer.json
 */
function extractMetaspaceSpec(
  preTokenizer: HFPreTokenizer | undefined
): { replacement: string; addPrefixSpace: boolean } | null {
  if (!preTokenizer) return null;

  const metaspace =
    preTokenizer.type === 'Metaspace'
      ? preTokenizer
      : preTokenizer.type === 'Sequence'
        ? preTokenizer.pretokenizers?.find((p) => p.type === 'Metaspace')
        : null;

  if (!metaspace) return null;
  return {
    replacement: metaspace.replacement ?? '\u2581',
    addPrefixSpace: metaspace.add_prefix_space ?? true,
  };
}
