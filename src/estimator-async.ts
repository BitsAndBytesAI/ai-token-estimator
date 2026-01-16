import { getModelConfig } from './models.js';
import { encode, getOpenAIEncoding } from './openai-bpe.js';
import type { EstimateAsyncInput, EstimateOutput, TokenizerMode } from './types.js';
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

export async function estimateAsync(input: EstimateAsyncInput): Promise<EstimateOutput> {
  const { text, model, rounding = 'ceil', tokenizer = 'heuristic' } = input;
  const config = getModelConfig(model);
  const characterCount = countCodePoints(text);

  let estimatedTokens: number | undefined;
  let tokenizerModeUsed: TokenizerMode = 'heuristic';
  let encodingUsed: string | undefined;

  if (tokenizer === 'anthropic_count_tokens') {
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
  } else if (tokenizer === 'gemini_count_tokens') {
    estimatedTokens = await countGeminiTokens({
      model,
      text,
      apiKey: input.gemini?.apiKey,
      baseUrl: input.gemini?.baseUrl,
      fetch: input.fetch,
    });
    tokenizerModeUsed = 'gemini_count_tokens';
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
  }

  const estimatedInputCost = (estimatedTokens * config.inputCostPerMillion) / 1_000_000;

  return {
    model,
    characterCount,
    estimatedTokens,
    estimatedInputCost,
    charsPerToken: config.charsPerToken,
    tokenizerMode: tokenizerModeUsed,
    encodingUsed,
  };
}

