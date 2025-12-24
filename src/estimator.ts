import { getModelConfig } from './models.js';
import type { EstimateInput, EstimateOutput } from './types.js';

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
  const { text, model, rounding = 'ceil' } = input;
  const config = getModelConfig(model);

  const characterCount = countCodePoints(text);
  const rawTokens = characterCount / config.charsPerToken;

  // Apply rounding strategy
  let estimatedTokens: number;
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

  const estimatedInputCost =
    (estimatedTokens * config.inputCostPerMillion) / 1_000_000;

  return {
    model,
    characterCount,
    estimatedTokens,
    estimatedInputCost,
    charsPerToken: config.charsPerToken,
  };
}
