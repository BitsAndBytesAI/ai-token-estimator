/**
 * Configuration for a specific LLM model.
 */
export interface ModelConfig {
  /** Characters per token ratio for this model */
  charsPerToken: number;
  /** Cost in USD per 1 million input tokens */
  inputCostPerMillion: number;
}

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
}
