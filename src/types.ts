/**
 * Configuration for a specific LLM model.
 */
export interface ModelConfig {
  /** Characters per token ratio for this model */
  charsPerToken: number;
  /** Cost in USD per 1 million input tokens */
  inputCostPerMillion: number;
}

export type TokenizerMode =
  | 'heuristic'
  | 'openai_exact'
  | 'auto'

/**
 * Tokenizer modes supported by `estimateAsync(...)`.
 *
 * This is intentionally separate from `TokenizerMode` to avoid breaking
 * TypeScript users who exhaustively switch on the legacy `TokenizerMode` union.
 */
export type TokenizerModeAsync =
  | TokenizerMode
  | 'anthropic_count_tokens'
  | 'gemini_count_tokens'
  | 'gemma_sentencepiece';

/**
 * Input parameters for the estimate function.
 */
export interface EstimateInput {
  /** The text to estimate tokens for */
  text: string;
  /** The model ID (must exist in default config) */
  model: string;
  /** Rounding strategy for token count (default: 'ceil') */
  rounding?: 'ceil' | 'round' | 'floor';
  /**
   * Token counting strategy.
   * - `heuristic` (default): use chars-per-token ratios
   * - `openai_exact`: use OpenAI BPE tokenization (throws if non-OpenAI model)
   * - `auto`: use OpenAI BPE for OpenAI models, otherwise heuristic
   */
  tokenizer?: TokenizerMode;
}

export interface EstimateAsyncInput extends Omit<EstimateInput, 'tokenizer'> {
  /**
   * Token counting strategy for async estimation.
   * Includes provider-backed modes that require network access or local model files.
   */
  tokenizer?: TokenizerModeAsync;

  /**
   * Optional fetch implementation (useful for tests, edge runtimes, or custom fetch).
   * Defaults to globalThis.fetch.
   */
  fetch?: typeof fetch;

  /**
   * If true, provider-backed tokenizer modes will fall back to heuristic token estimation
   * when the provider API is throttled/unavailable or the API key is invalid.
   *
   * This never stores API keys; it only affects error handling.
   *
   * Default: false (throw on provider errors)
   */
  fallbackToHeuristicOnError?: boolean;

  /**
   * Configuration for Anthropic token counting.
   * Only used when tokenizer === 'anthropic_count_tokens'.
   */
  anthropic?: {
    apiKey?: string;
    baseUrl?: string;
    version?: string;
    system?: string;
  };

  /**
   * Configuration for Gemini token counting (Google AI Studio / Generative Language API).
   * Only used when tokenizer === 'gemini_count_tokens'.
   */
  gemini?: {
    apiKey?: string;
    baseUrl?: string;
  };

  /**
   * Configuration for local Gemma SentencePiece tokenization.
   * Only used when tokenizer === 'gemma_sentencepiece'.
   */
  gemma?: {
    /** Filesystem path to a SentencePiece model file (e.g. Gemma tokenizer.model). */
    modelPath?: string;
  };
}

/**
 * Output from the estimate function.
 */
export interface EstimateOutput {
  /** The model used for estimation */
  model: string;
  /** Number of Unicode code points in the input */
  characterCount: number;
  /** Estimated token count (integer, rounded per rounding strategy) */
  estimatedTokens: number;
  /** Estimated input cost in USD */
  estimatedInputCost: number;
  /** The chars-per-token ratio used */
  charsPerToken: number;
  /** Which tokenizer strategy was used */
  tokenizerMode?: TokenizerModeAsync;
  /** OpenAI encoding used when tokenizerMode is `openai_exact` */
  encodingUsed?: string;
}
