/**
 * SentencePiece Tokenizer
 *
 * Pure TypeScript implementation of SentencePiece tokenization.
 * Supports both .model files (protobuf) and tokenizer.json files.
 *
 * @example
 * ```typescript
 * // Sync API (browser/serverless)
 * const tokenizer = getSentencePieceTokenizer({ modelData: bytes });
 * const tokens = tokenizer.encode("Hello world");
 * const text = tokenizer.decode(tokens);
 *
 * // Async API (Node.js)
 * const tokenizer = await loadSentencePieceTokenizer({ modelPath: './model.model' });
 * const tokens = tokenizer.encode("Hello world");
 * ```
 */

// === Main API ===
export {
  getSentencePieceTokenizer,
  encodeSentencePiece,
  decodeSentencePiece,
  countSentencePieceTokens,
  type SentencePieceTokenizer,
  type DataOptions,
} from './tokenizer.js';

export {
  loadSentencePieceTokenizer,
  encodeSentencePieceAsync,
  decodeSentencePieceAsync,
  countSentencePieceTokensAsync,
  type FileOptions,
} from './tokenizer-async.js';

// === Model Download Helper (Node.js only) ===
export {
  ensureSentencePieceModel,
  computeModelHash,
  computeModelFileHash,
  MODEL_REGISTRY,
  type DownloadOptions,
  type KnownTokenizer,
  type ModelInfo,
} from './download/index.js';

// === Cache Management ===
export { clearModelCache } from './cache.js';

// === Low-level APIs (for advanced use cases) ===

// Protobuf
export { parseModelProto } from './protobuf/decoder.js';
export {
  ModelType,
  SentencePieceType,
  type ModelProto,
  type SentencePiece,
  type TrainerSpec,
  type NormalizerSpec,
} from './protobuf/schema.js';

// Normalizer
export { Normalizer, SimpleNormalizer, type NormalizerOptions } from './normalizer/index.js';

// Algorithms
export {
  BPEEncoder,
  JsonBPEEncoder,
  UnigramEncoder,
  AddedTokenMatcher,
  type BPEEncoderOptions,
  type JsonBPEEncoderOptions,
  type UnigramEncoderOptions,
  type AddedToken,
  type TextNormalizer,
  type AddedTokenSegment,
} from './algorithms/index.js';

// JSON Parser
export {
  parseHFTokenizerJson,
  validateJsonConfig,
  buildHFNormalizer,
  UnsupportedTokenizerError,
  type ParsedJsonTokenizer,
  type HFTokenizerConfig,
} from './json/index.js';
