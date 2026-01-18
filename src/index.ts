export { estimate } from './estimator.js';
export { estimateAsync } from './estimator-async.js';
export {
  getModelConfig,
  getAvailableModels,
  DEFAULT_MODELS,
  LAST_UPDATED,
} from './models.js';
export { encode, decode, getOpenAIEncoding } from './openai-bpe.js';
export { countTokens } from './token-counter.js';
export { countChatCompletionTokens } from './chat-completion-tokens.js';
export { countAnthropicInputTokens } from './providers/anthropic.js';
export { countGeminiTokens } from './providers/gemini.js';
export { countGemmaSentencePieceTokens } from './providers/gemma-sentencepiece.js';

// SentencePiece tokenizer (pure TypeScript implementation)
export {
  getSentencePieceTokenizer,
  loadSentencePieceTokenizer,
  encodeSentencePiece,
  decodeSentencePiece,
  countSentencePieceTokens,
  encodeSentencePieceAsync,
  decodeSentencePieceAsync,
  countSentencePieceTokensAsync,
  ensureSentencePieceModel,
  clearModelCache,
  parseModelProto,
} from './sentencepiece/index.js';
export type {
  EstimateInput,
  EstimateAsyncInput,
  EstimateOutput,
  ModelConfig,
  TokenizerMode,
  TokenizerModeAsync,
  ChatMessage,
  FunctionDefinition,
  FunctionParameters,
  FunctionParameterProperty,
  FunctionCallOption,
  ChatCompletionTokenCountInput,
  ChatCompletionTokenCountOutput,
} from './types.js';
export type { EncodeOptions, OpenAIEncoding, SpecialTokenHandling } from './openai-bpe.js';
export type { TokenCountInput, TokenCountOutput } from './token-counter.js';
export type { AnthropicCountTokensParams } from './providers/anthropic.js';
export type { GeminiCountTokensParams } from './providers/gemini.js';
export type { GemmaSentencePieceCountTokensParams } from './providers/gemma-sentencepiece.js';

// SentencePiece types
export type {
  SentencePieceTokenizer,
  DataOptions,
  FileOptions,
  DownloadOptions,
  KnownTokenizer,
  ModelInfo,
  ModelProto,
  SentencePiece,
  TrainerSpec,
  NormalizerSpec,
} from './sentencepiece/index.js';
