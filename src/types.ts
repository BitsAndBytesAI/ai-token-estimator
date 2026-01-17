import type { OpenAIEncoding } from './openai-bpe.js';

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

// =============================================================================
// Chat Completion Token Counting Types
// =============================================================================

/**
 * A chat message in OpenAI legacy format (functions API).
 *
 * Note: This type intentionally excludes tool_calls, tool_call_id, and
 * array content. Those features require the tools API which has different
 * token counting logic and is not yet supported.
 */
export interface ChatMessage {
  /** The role of the message author */
  role: 'system' | 'user' | 'assistant' | 'function';
  /**
   * The content of the message (text only; array content not supported).
   * Optional because assistant messages with function_call may omit content.
   */
  content?: string | null;
  /** An optional name for the participant (for multi-user chats or function results) */
  name?: string;
  /** Function call made by the assistant (legacy API) */
  function_call?: {
    name: string;
    arguments: string;
  };
}

/**
 * JSON Schema subset for function parameters.
 */
export interface FunctionParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: FunctionParameterProperty;
  properties?: Record<string, FunctionParameterProperty>;
  required?: string[];
}

/**
 * Function parameters schema.
 */
export interface FunctionParameters {
  type: 'object';
  properties?: Record<string, FunctionParameterProperty>;
  required?: string[];
}

/**
 * A function definition for legacy function calling.
 */
export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters?: FunctionParameters;
}

/**
 * Function call control options (legacy API).
 */
export type FunctionCallOption = 'auto' | 'none' | { name: string };

/**
 * Input for counting chat completion tokens.
 *
 * Supports the legacy functions API only. For tools API support,
 * see the roadmap in the package documentation.
 */
export interface ChatCompletionTokenCountInput {
  /** The list of messages in the conversation */
  messages: ChatMessage[];
  /**
   * The model to use for token counting.
   * Must be a chat-capable OpenAI model.
   * If using a new chat model not yet recognized, provide `encoding` instead.
   */
  model: string;
  /**
   * Explicit encoding override. When provided, allows unrecognized models
   * but still rejects known non-OpenAI models (claude-*, gemini-*) and
   * known non-chat OpenAI models (e.g., davinci-002).
   */
  encoding?: OpenAIEncoding;
  /** Function definitions (legacy API) */
  functions?: FunctionDefinition[];
  /** Function call control (legacy API) */
  function_call?: FunctionCallOption;
  /** Include per-message token breakdown in output */
  includeBreakdown?: boolean;
}

/**
 * Output from counting chat completion tokens.
 */
export interface ChatCompletionTokenCountOutput {
  /** Total token count for the request */
  totalTokens: number;
  /**
   * Tokens from messages (sum of per-message tokens).
   * Does NOT include completionOverheadTokens.
   */
  messageTokens: number;
  /**
   * Tokens added for completion request overhead (reply priming).
   * This is the COMPLETION_REQUEST_TOKEN_OVERHEAD constant (3 tokens).
   * Kept separate from messageTokens for clarity.
   */
  completionOverheadTokens: number;
  /** Tokens from function definitions */
  functionTokens: number;
  /** Tokens from function_call setting */
  functionCallTokens: number;
  /** Whether exact tokenization was used (always true for supported inputs) */
  exact: true;
  /** The encoding used */
  encoding: OpenAIEncoding;
  /**
   * Breakdown by message (only if includeBreakdown: true).
   *
   * Note on field semantics:
   * - `stringTokens`: tokens from encoding role, content, name, function_call fields
   * - `overheadTokens`: fixed overhead (MESSAGE_TOKEN_OVERHEAD, NAME_TOKEN_OVERHEAD, etc.)
   *   including the function-role discount when applicable
   *
   * The completionOverheadTokens (reply priming) is NOT included in this breakdown
   * as it applies to the request as a whole, not individual messages.
   */
  messageBreakdown?: Array<{
    role: string;
    stringTokens: number;
    overheadTokens: number;
    totalTokens: number;
  }>;
}
