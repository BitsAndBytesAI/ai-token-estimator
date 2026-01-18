import { getModelConfig } from './models.js';
import { encode, getOpenAIEncoding } from './openai-bpe.js';
import { estimateCost } from './cost.js';
import type { EstimateAsyncInput, EstimateOutput, TokenizerModeAsync } from './types.js';
import { countAnthropicInputTokens } from './providers/anthropic.js';
import { countGeminiTokens } from './providers/gemini.js';
import { countGemmaSentencePieceTokens } from './providers/gemma-sentencepiece.js';

function countCodePoints(text: string): number {
  let count = 0;
  for (const _char of text) count++;
  return count;
}

function isNonOpenAIModel(model: string): boolean {
  return model.startsWith('claude-') || model.startsWith('gemini-');
}

type MaybeStatusError = Error & { status?: unknown };

function shouldFallbackToHeuristic(err: unknown): boolean {
  if (!err) return true;
  const maybe = err as Partial<MaybeStatusError>;
  const statusRaw = maybe.status;
  const status = typeof statusRaw === 'number' && Number.isFinite(statusRaw) ? statusRaw : null;
  if (!status) return true; // network errors, timeouts, parse issues
  if (status === 401 || status === 403 || status === 429) return true; // auth/rate-limit
  if (status >= 500 && status <= 599) return true; // provider unavailable
  return false;
}

export async function estimateAsync(input: EstimateAsyncInput): Promise<EstimateOutput> {
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
  const characterCount = countCodePoints(text);

  let estimatedTokens: number | undefined;
  let tokenizerModeUsed: TokenizerModeAsync = 'heuristic';
  let encodingUsed: string | undefined;

  if (tokenizer === 'anthropic_count_tokens') {
    try {
      estimatedTokens = await countAnthropicInputTokens({
        model,
        text,
        system: input.anthropic?.system,
        apiKey: input.anthropic?.apiKey,
        baseUrl: input.anthropic?.baseUrl,
        version: input.anthropic?.version,
        fetch: input.fetch,
      });
      tokenizerModeUsed = 'anthropic_count_tokens';
    } catch (error) {
      if (input.fallbackToHeuristicOnError && shouldFallbackToHeuristic(error)) {
        estimatedTokens = undefined;
        tokenizerModeUsed = 'heuristic';
      } else {
        throw error;
      }
    }
  } else if (tokenizer === 'gemini_count_tokens') {
    try {
      estimatedTokens = await countGeminiTokens({
        model,
        text,
        apiKey: input.gemini?.apiKey,
        baseUrl: input.gemini?.baseUrl,
        fetch: input.fetch,
      });
      tokenizerModeUsed = 'gemini_count_tokens';
    } catch (error) {
      if (input.fallbackToHeuristicOnError && shouldFallbackToHeuristic(error)) {
        estimatedTokens = undefined;
        tokenizerModeUsed = 'heuristic';
      } else {
        throw error;
      }
    }
  } else if (tokenizer === 'gemma_sentencepiece') {
    const modelPath = input.gemma?.modelPath;
    if (!modelPath) {
      throw new Error('gemma_sentencepiece tokenizer requires gemma.modelPath (path to tokenizer.model)');
    }
    estimatedTokens = await countGemmaSentencePieceTokens({ modelPath, text });
    tokenizerModeUsed = 'gemma_sentencepiece';
  } else {
    const shouldTryExact = tokenizer === 'openai_exact' || tokenizer === 'auto';

    if (shouldTryExact && !isNonOpenAIModel(model)) {
      try {
        estimatedTokens = encode(text, { model, allowSpecial: 'none' }).length;
        tokenizerModeUsed = 'openai_exact';
        encodingUsed = getOpenAIEncoding({ model });
      } catch (error) {
        if (tokenizer === 'openai_exact') throw error;
      }
    } else if (tokenizer === 'openai_exact' && isNonOpenAIModel(model)) {
      throw new Error(`Tokenizer mode "openai_exact" requested for non-OpenAI model: "${model}"`);
    }
  }

  if (estimatedTokens === undefined) {
    const rawTokens = characterCount / config.charsPerToken;
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

  const estimatedInputCost = (estimatedTokens * config.inputCostPerMillion) / 1_000_000;

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
      // Only fallback for missing output/cached pricing; rethrow for batch errors and invalid args
      const message = error instanceof Error ? error.message : '';
      const isMissingPricing = message.includes('pricing not available');
      const isBatchError = message.includes('Batch');
      if (isMissingPricing && !isBatchError) {
        // Missing output/cached pricing → fall back to input-only cost
        estimatedTotalCost = estimatedInputCost;
      } else {
        // Invalid arguments, batch errors, etc. → rethrow
        throw error;
      }
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
