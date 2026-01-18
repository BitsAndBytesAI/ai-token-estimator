/**
 * Gemma SentencePiece Token Counter
 *
 * Uses our pure TypeScript SentencePiece implementation.
 */

import { loadSentencePieceTokenizer } from '../sentencepiece/index.js';

export interface GemmaSentencePieceCountTokensParams {
  /** Filesystem path to a SentencePiece model file (e.g. Gemma `tokenizer.model`). */
  modelPath: string;
  text: string;
}

/**
 * Count tokens using a SentencePiece model file.
 *
 * @param params The model path and text to tokenize
 * @returns The number of tokens
 */
export async function countGemmaSentencePieceTokens(
  params: GemmaSentencePieceCountTokensParams
): Promise<number> {
  const tokenizer = await loadSentencePieceTokenizer({ modelPath: params.modelPath });
  const tokens = tokenizer.encode(params.text);
  return tokens.length;
}
