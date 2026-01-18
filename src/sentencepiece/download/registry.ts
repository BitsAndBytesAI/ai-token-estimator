/**
 * Model Registry
 *
 * Official model sources with pre-computed SHA-256 hashes.
 * Hashes are verified on download to ensure integrity.
 *
 * To verify hashes: npm run verify:hashes
 */

export interface ModelInfo {
  url: string;
  sha256: string;
  filename: string;
  algorithm: 'bpe' | 'unigram';
  vocabSize: number;
  gated: boolean;
}

/**
 * Registry of known tokenizer models
 *
 * SHA-256 hashes are computed from the canonical source files.
 * Run `npm run verify:hashes` to verify all hashes are correct.
 */
export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  // Tested models with known hashes
  't5-base': {
    url: 'https://huggingface.co/google-t5/t5-base/resolve/main/spiece.model',
    sha256: 'd60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86',
    filename: 't5-tokenizer.model',
    algorithm: 'unigram',
    vocabSize: 32100,
    gated: false,
  },
  'albert-base-v2': {
    url: 'https://huggingface.co/albert/albert-base-v2/resolve/main/spiece.model',
    sha256: 'fefb02b667a6c5c2fe27602d28e5fb3428f66ab89c7d6f388e7c8d44a02d0336',
    filename: 'albert-tokenizer.model',
    algorithm: 'unigram',
    vocabSize: 30000,
    gated: false,
  },
  'xlnet-base-cased': {
    url: 'https://huggingface.co/xlnet/xlnet-base-cased/resolve/main/spiece.model',
    sha256: '1f8c1c0bc2854d1af911a8550288c1258af5ba50277f3a5c829b98eb86fc5646',
    filename: 'xlnet-tokenizer.model',
    algorithm: 'unigram',
    vocabSize: 32000,
    gated: false,
  },
  gemma: {
    url: 'https://huggingface.co/google/gemma-2b/resolve/main/tokenizer.model',
    sha256: '', // Gated model - requires HuggingFace auth
    filename: 'gemma-tokenizer.model',
    algorithm: 'bpe',
    vocabSize: 256128,
    gated: true, // Requires HuggingFace auth to download
  },
  // Gated models (require HuggingFace auth)
  llama2: {
    url: 'https://huggingface.co/meta-llama/Llama-2-7b/resolve/main/tokenizer.model',
    sha256: '', // Gated model - hash verification skipped (requires manual auth)
    filename: 'llama2-tokenizer.model',
    algorithm: 'bpe',
    vocabSize: 32000,
    gated: true,
  },
};

export type KnownTokenizer = keyof typeof MODEL_REGISTRY;

/**
 * Check if a tokenizer name is a known tokenizer
 */
export function isKnownTokenizer(name: string): name is KnownTokenizer {
  return name in MODEL_REGISTRY;
}

/**
 * Get list of available tokenizers
 */
export function getAvailableTokenizers(): string[] {
  return Object.keys(MODEL_REGISTRY);
}
