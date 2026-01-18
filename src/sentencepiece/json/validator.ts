/**
 * HuggingFace tokenizer.json Validator
 *
 * Validates that a tokenizer.json config is within the supported scope:
 * - Unigram models
 * - BPE with Metaspace pre-tokenizer (SentencePiece-style)
 *
 * Rejects configurations that would require different algorithms:
 * - ByteLevel BPE (GPT-2/tiktoken-style)
 * - Other unsupported model types
 */

import type { HFTokenizerConfig, HFPreTokenizer } from './types.js';

/**
 * Error thrown when a tokenizer.json config is not supported
 */
export class UnsupportedTokenizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedTokenizerError';
  }
}

/**
 * Validate that a tokenizer.json config is within supported scope
 */
export function validateJsonConfig(config: HFTokenizerConfig): void {
  const modelType = config.model?.type;

  if (!modelType) {
    throw new UnsupportedTokenizerError('Missing model.type in tokenizer.json');
  }

  if (modelType === 'BPE') {
    // Must have Metaspace for SentencePiece compatibility
    const preTokenizerType = getPreTokenizerType(config.pre_tokenizer);
    const decoderType = config.decoder?.type;

    if (preTokenizerType !== 'Metaspace') {
      throw new UnsupportedTokenizerError(
        `Unsupported BPE tokenizer: pre_tokenizer is "${preTokenizerType}", expected "Metaspace". ` +
          'This appears to be a GPT-2/tiktoken-style BPE, not SentencePiece. ' +
          'Use the BPE tokenizer from src/bpe/ instead.'
      );
    }

    if (decoderType !== 'Metaspace' && decoderType !== 'Sequence') {
      throw new UnsupportedTokenizerError(
        `Unsupported BPE tokenizer: decoder is "${decoderType}", expected "Metaspace" or "Sequence".`
      );
    }
  } else if (modelType === 'Unigram') {
    // Unigram models are generally compatible
    // Just validate required fields exist
    if (!config.model.vocab) {
      throw new UnsupportedTokenizerError('Unigram model missing vocab field');
    }
  } else {
    throw new UnsupportedTokenizerError(
      `Unsupported model type: "${modelType}". Only "BPE" (with Metaspace) and "Unigram" are supported.`
    );
  }
}

/**
 * Extract the effective pre-tokenizer type
 */
function getPreTokenizerType(preTokenizer: HFPreTokenizer | undefined): string | null {
  if (!preTokenizer) return null;
  if (preTokenizer.type === 'Sequence') {
    // Check if any element is Metaspace
    for (const elem of preTokenizer.pretokenizers ?? []) {
      if (elem.type === 'Metaspace') return 'Metaspace';
    }
  }
  return preTokenizer.type;
}
