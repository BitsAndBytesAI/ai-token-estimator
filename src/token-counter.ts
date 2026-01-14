import { encode, getOpenAIEncoding } from './openai-bpe.js';
import { estimate } from './estimator.js';
import type { OpenAIEncoding } from './openai-bpe.js';

export interface TokenCountInput {
  text: string;
  model: string;
}

export interface TokenCountOutput {
  tokens: number;
  exact: boolean;
  encoding?: OpenAIEncoding;
}

function isNonOpenAIModel(model: string): boolean {
  return model.startsWith('claude-') || model.startsWith('gemini-');
}

/**
 * Count tokens for a given model.
 *
 * - OpenAI models: exact BPE tokenization
 * - Other providers: heuristic estimate (chars-per-token)
 */
export function countTokens(input: TokenCountInput): TokenCountOutput {
  const { text, model } = input;

  if (isNonOpenAIModel(model)) {
    return {
      tokens: estimate({ text, model }).estimatedTokens,
      exact: false,
    };
  }

  try {
    return {
      tokens: encode(text, { model, allowSpecial: 'none' }).length,
      exact: true,
      encoding: getOpenAIEncoding({ model }),
    };
  } catch {
    return {
      tokens: estimate({ text, model }).estimatedTokens,
      exact: false,
    };
  }
}

