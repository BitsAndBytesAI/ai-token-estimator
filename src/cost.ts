import { getModelConfig } from './models.js';
import { countTokens } from './token-counter.js';
import { estimateAsync } from './estimator-async.js';
import type { EstimateAsyncInput, ModelConfig } from './types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Input parameters for estimateCost().
 */
export interface EstimateCostInput {
  /** The model ID */
  model: string;
  /** Total input tokens (includes cached) */
  inputTokens: number;
  /** Output tokens (if > 0, requires outputCostPerMillion) */
  outputTokens?: number;
  /** Cached input tokens (must be <= inputTokens) */
  cachedInputTokens?: number;
  /** Pricing mode: 'standard' or 'batch' */
  mode?: 'standard' | 'batch';
}

/**
 * Structured cost estimate result.
 */
export interface CostEstimate {
  /** The model used */
  model: string;
  /** The pricing mode used */
  mode: 'standard' | 'batch';

  /** Token counts echoed back */
  tokens: {
    /** Total input tokens (includes cached) */
    input: number;
    /** Cached input tokens (subset of input priced at cached rate) */
    cachedInput: number;
    /** Non-cached input tokens (input - cachedInput) */
    nonCachedInput: number;
    /** Output tokens */
    output: number;
  };

  /** Cost breakdown in USD (no rounding applied) */
  costs: {
    /** Non-cached input cost */
    input: number;
    /** Cached input cost */
    cachedInput: number;
    /** Output cost */
    output: number;
    /** Sum of all costs */
    total: number;
  };

  /** Per-million rates used (for transparency) */
  rates: {
    inputPerMillion: number;
    outputPerMillion?: number;
    cachedInputPerMillion?: number;
    batchInputPerMillion?: number;
    batchOutputPerMillion?: number;
  };
}

/**
 * Options for estimateCostFromText (sync).
 */
export interface EstimateCostFromTextOptions {
  /** The model ID */
  model: string;
  /** Input text to count tokens for */
  inputText: string;
  /** Output text to count tokens for (auto-counts output tokens) */
  outputText?: string;
  /** Manual output token count (takes precedence over outputText) */
  outputTokens?: number;
  /** Cached input tokens */
  cachedInputTokens?: number;
  /** Pricing mode */
  mode?: 'standard' | 'batch';
}

/**
 * Options for estimateCostFromTextAsync.
 * Forwards all EstimateAsyncInput options (minus 'text') for provider-backed counting.
 */
export type EstimateCostFromTextAsyncOptions = {
  /** The model ID */
  model: string;
  /** Input text to count tokens for */
  inputText: string;
  /** Output text to count tokens for (auto-counts output tokens) */
  outputText?: string;
  /** Manual output token count (takes precedence over outputText) */
  outputTokens?: number;
  /** Cached input tokens */
  cachedInputTokens?: number;
  /** Pricing mode */
  mode?: 'standard' | 'batch';
} & Omit<EstimateAsyncInput, 'text' | 'model'>;

// =============================================================================
// Validation Helpers
// =============================================================================

function validateTokenCount(value: number | undefined, name: string): number {
  const n = value ?? 0;
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`${name} must be a non-negative integer, got: ${n}`);
  }
  return n;
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Estimate cost from explicit token counts.
 *
 * @throws {Error} if model is unknown
 * @throws {Error} if outputTokens > 0 but outputCostPerMillion is missing
 * @throws {Error} if cachedInputTokens > inputTokens
 * @throws {Error} if cachedInputTokens > 0 but cachedInputCostPerMillion is missing
 * @throws {Error} if mode='batch' but batch rates are missing
 * @throws {Error} if mode='batch' and cachedInputTokens > 0
 * @throws {Error} if any token count is negative or non-finite
 */
export function estimateCost(options: EstimateCostInput): CostEstimate {
  const { model, mode = 'standard' } = options;

  // Validate token counts
  const inputTokens = validateTokenCount(options.inputTokens, 'inputTokens');
  const outputTokens = validateTokenCount(options.outputTokens, 'outputTokens');
  const cachedInputTokens = validateTokenCount(options.cachedInputTokens, 'cachedInputTokens');

  // Validate cachedInputTokens <= inputTokens
  if (cachedInputTokens > inputTokens) {
    throw new Error(
      `cachedInputTokens (${cachedInputTokens}) cannot exceed inputTokens (${inputTokens})`
    );
  }

  // Get model config (let getModelConfig's helpful error message bubble up)
  const config = getModelConfig(model);

  // Validate output pricing availability
  if (outputTokens > 0 && config.outputCostPerMillion === undefined) {
    throw new Error(
      `Output pricing not available for model "${model}". ` +
      `Cannot estimate cost for ${outputTokens} output tokens.`
    );
  }

  // Validate batch mode availability
  if (mode === 'batch') {
    if (cachedInputTokens > 0) {
      throw new Error(
        `Batch mode does not support cached tokens. ` +
        `Got cachedInputTokens: ${cachedInputTokens}. Use mode: 'standard' for cached pricing.`
      );
    }
    if (config.batchInputCostPerMillion === undefined) {
      throw new Error(
        `Batch input pricing not available for model "${model}". ` +
        `Use mode: 'standard' or choose a model with batch pricing.`
      );
    }
    if (outputTokens > 0 && config.batchOutputCostPerMillion === undefined) {
      throw new Error(
        `Batch output pricing not available for model "${model}". ` +
        `Cannot estimate batch cost for ${outputTokens} output tokens.`
      );
    }
  }

  const nonCachedInputTokens = inputTokens - cachedInputTokens;

  // Calculate costs based on mode
  if (mode === 'batch') {
    const inputCost = (inputTokens * config.batchInputCostPerMillion!) / 1_000_000;
    const outputCost = outputTokens > 0
      ? (outputTokens * config.batchOutputCostPerMillion!) / 1_000_000
      : 0;

    return {
      model,
      mode: 'batch',
      tokens: {
        input: inputTokens,
        cachedInput: 0,  // Batch mode doesn't use cached pricing
        nonCachedInput: inputTokens,
        output: outputTokens,
      },
      costs: {
        input: inputCost,
        cachedInput: 0,
        output: outputCost,
        total: inputCost + outputCost,
      },
      rates: {
        inputPerMillion: config.inputCostPerMillion,
        outputPerMillion: config.outputCostPerMillion,
        batchInputPerMillion: config.batchInputCostPerMillion,
        batchOutputPerMillion: config.batchOutputCostPerMillion,
      },
    };
  }

  // Standard mode - validate cached pricing availability
  if (cachedInputTokens > 0 && config.cachedInputCostPerMillion === undefined) {
    throw new Error(
      `Cached input pricing not available for model "${model}". ` +
      `Cannot estimate cost for ${cachedInputTokens} cached input tokens.`
    );
  }

  const inputCost = (nonCachedInputTokens * config.inputCostPerMillion) / 1_000_000;

  const cachedInputCost = cachedInputTokens > 0
    ? (cachedInputTokens * config.cachedInputCostPerMillion!) / 1_000_000
    : 0;

  const outputCost = outputTokens > 0
    ? (outputTokens * config.outputCostPerMillion!) / 1_000_000
    : 0;

  return {
    model,
    mode: 'standard',
    tokens: {
      input: inputTokens,
      cachedInput: cachedInputTokens,
      nonCachedInput: nonCachedInputTokens,
      output: outputTokens,
    },
    costs: {
      input: inputCost,
      cachedInput: cachedInputCost,
      output: outputCost,
      total: inputCost + cachedInputCost + outputCost,
    },
    rates: {
      inputPerMillion: config.inputCostPerMillion,
      outputPerMillion: config.outputCostPerMillion,
      cachedInputPerMillion: config.cachedInputCostPerMillion,
    },
  };
}

/**
 * Sync helper: estimate cost from text (uses countTokens internally).
 * Uses OpenAI exact tokenization when available, else heuristic.
 *
 * Precedence rules:
 * - outputTokens takes precedence over outputText
 * - If both omitted, outputTokens defaults to 0
 * - If outputText provided, tokens are counted using countTokens (same as input)
 */
export function estimateCostFromText(options: EstimateCostFromTextOptions): CostEstimate {
  const { model, inputText, outputText, outputTokens: manualOutputTokens, ...rest } = options;

  // Count input tokens
  const inputTokens = countTokens({ text: inputText, model }).tokens;

  // Precedence: outputTokens > outputText > 0
  let outputTokens = manualOutputTokens;
  if (manualOutputTokens === undefined && outputText !== undefined) {
    // Use same token-counting mode as input (countTokens)
    outputTokens = countTokens({ text: outputText, model }).tokens;
  }
  // If both omitted, outputTokens remains undefined (defaults to 0 in estimateCost)

  return estimateCost({ model, inputTokens, outputTokens, ...rest });
}

/**
 * Async helper: estimate cost from text using provider-backed tokenization.
 * Uses provider APIs (Anthropic, Gemini) when available for exact counts.
 *
 * Precedence rules:
 * - outputTokens takes precedence over outputText
 * - If both omitted, outputTokens defaults to 0
 * - If outputText provided, tokens are counted using the same tokenizer mode as input
 */
export async function estimateCostFromTextAsync(
  options: EstimateCostFromTextAsyncOptions
): Promise<CostEstimate> {
  const {
    inputText,
    outputText,
    outputTokens: manualOutputTokens,
    cachedInputTokens,
    mode,
    ...providerOptions  // Includes model + all EstimateAsyncInput options
  } = options;
  const { model } = providerOptions;

  // Count input tokens using provider-backed tokenization
  const inputResult = await estimateAsync({ text: inputText, ...providerOptions });
  const inputTokens = inputResult.estimatedTokens;

  // Precedence: outputTokens > outputText > 0
  let outputTokens = manualOutputTokens;
  if (manualOutputTokens === undefined && outputText !== undefined) {
    // Use same tokenizer mode as input (provider options forwarded)
    const outputResult = await estimateAsync({ text: outputText, ...providerOptions });
    outputTokens = outputResult.estimatedTokens;
  }
  // If both omitted, outputTokens remains undefined (defaults to 0 in estimateCost)

  return estimateCost({ model, inputTokens, outputTokens, cachedInputTokens, mode });
}

/**
 * Quick total cost helper.
 *
 * @throws {Error} if output pricing is missing when outputTokens > 0
 */
export function getTotalCost(model: string, inputTokens: number, outputTokens: number = 0): number {
  const estimate = estimateCost({ model, inputTokens, outputTokens });
  return estimate.costs.total;
}
