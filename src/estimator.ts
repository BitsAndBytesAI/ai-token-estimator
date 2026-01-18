import { getModelConfig } from './models.js';
import { encode, getOpenAIEncoding } from './openai-bpe.js';
import { estimateCost } from './cost.js';
import type { EstimateInput, EstimateOutput, TokenizerMode } from './types.js';

/**
 * Count Unicode code points in a string.
 * This correctly handles emojis and surrogate pairs.
 * Uses for...of loop to avoid array allocation for large inputs.
 */
function countCodePoints(text: string): number {
  let count = 0;
  for (const _char of text) {
    count++;
  }
  return count;
}

/**
 * Estimate token count and cost for the given text and model.
 *
 * @param input - The estimation input parameters
 * @returns The estimation output with token count and cost
 * @throws Error if the model is not found in the configuration
 *
 * @example
 * ```typescript
 * const result = estimate({
 *   text: 'Hello, world!',
 *   model: 'gpt-4o'
 * });
 * console.log(result.estimatedTokens); // 4
 * console.log(result.estimatedInputCost); // 0.00001
 * ```
 */
export function estimate(input: EstimateInput): EstimateOutput {
  const {
    text,
    model,
    rounding = 'ceil',
    tokenizer = 'heuristic',
    outputTokens,
    cachedInputTokens,
    mode,
  } = input;
  const config = getModelConfig(model);

  // Runtime guard for JS callers who may pass async-only tokenizer modes.
  // (TypeScript callers are prevented by the `TokenizerMode` type.)
  const tokenizerStr = tokenizer as string;
  if (
    tokenizerStr === 'anthropic_count_tokens' ||
    tokenizerStr === 'gemini_count_tokens' ||
    tokenizerStr === 'gemma_sentencepiece'
  ) {
    throw new Error(`Tokenizer mode "${tokenizerStr}" requires async execution. Use estimateAsync(...) instead.`);
  }

  const characterCount = countCodePoints(text);

  const isNonOpenAIModel =
    model.startsWith('claude-') || model.startsWith('gemini-');

  let estimatedTokens: number | undefined;
  let tokenizerModeUsed: TokenizerMode = 'heuristic';
  let encodingUsed: string | undefined;

  const shouldTryExact =
    tokenizer === 'openai_exact' || tokenizer === 'auto';

  if (shouldTryExact && !isNonOpenAIModel) {
    try {
      // Estimation should not fail if special-token-like strings exist.
      estimatedTokens = encode(text, { model, allowSpecial: 'none' }).length;
      tokenizerModeUsed = 'openai_exact';
      encodingUsed = getOpenAIEncoding({ model });
    } catch (error) {
      if (tokenizer === 'openai_exact') {
        throw error;
      }
      // auto mode falls back to heuristic below
    }
  } else if (tokenizer === 'openai_exact' && isNonOpenAIModel) {
    throw new Error(
      `Tokenizer mode "openai_exact" requested for non-OpenAI model: "${model}"`
    );
  }

  if (estimatedTokens === undefined) {
    const rawTokens = characterCount / config.charsPerToken;
    // Apply rounding strategy
    switch (rounding) {
      case 'floor':
        estimatedTokens = Math.floor(rawTokens);
        break;
      case 'round':
        estimatedTokens = Math.round(rawTokens);
        break;
      case 'ceil':
      default:
        estimatedTokens = Math.ceil(rawTokens);
    }
    tokenizerModeUsed = 'heuristic';
  }

  const estimatedInputCost =
    (estimatedTokens * config.inputCostPerMillion) / 1_000_000;

  // Calculate extended cost fields if cost inputs provided
  let estimatedOutputCost: number | undefined;
  let estimatedCachedInputCost: number | undefined;
  let estimatedTotalCost = estimatedInputCost;

  // Use estimateCost for detailed calculation if any cost-related input is provided
  const hasCostInputs = outputTokens !== undefined || cachedInputTokens !== undefined || mode !== undefined;

  if (hasCostInputs) {
    try {
      const costResult = estimateCost({
        model,
        inputTokens: estimatedTokens,
        outputTokens,
        cachedInputTokens,
        mode,
      });
      estimatedOutputCost = costResult.costs.output > 0 ? costResult.costs.output : undefined;
      estimatedCachedInputCost = costResult.costs.cachedInput > 0 ? costResult.costs.cachedInput : undefined;
      estimatedTotalCost = costResult.costs.total;
    } catch (error) {
      // When user explicitly provides cost inputs (outputTokens, cachedInputTokens, mode),
      // they expect accurate cost estimation - don't silently fall back to input-only cost.
      // Rethrow all estimateCost errors so callers know pricing is unavailable.
      throw error;
    }
  }

  return {
    model,
    characterCount,
    estimatedTokens,
    estimatedInputCost,
    charsPerToken: config.charsPerToken,
    tokenizerMode: tokenizerModeUsed,
    encodingUsed,
    outputTokens,
    estimatedOutputCost,
    estimatedCachedInputCost,
    estimatedTotalCost,
  };
}
