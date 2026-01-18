/**
 * Model Registry
 *
 * Official model sources with pre-computed SHA-256 hashes.
 * Hashes are computed during release and committed before publishing.
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
 * NOTE: SHA-256 hashes should be computed before release.
 * Empty hash ('') means verification is skipped - fill before release!
 */
export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  gemma: {
    url: 'https://huggingface.co/google/gemma-2b/resolve/main/tokenizer.model',
    sha256: '', // TODO: Compute before release: shasum -a 256 tokenizer.model
    filename: 'gemma-tokenizer.model',
    algorithm: 'bpe',
    vocabSize: 256128,
    gated: false, // Gemma is public, no auth required
  },
  llama2: {
    url: 'https://huggingface.co/meta-llama/Llama-2-7b/resolve/main/tokenizer.model',
    sha256: '', // TODO: Compute before release
    filename: 'llama2-tokenizer.model',
    algorithm: 'bpe',
    vocabSize: 32000,
    gated: true, // LLaMA 2 is GATED - requires HuggingFace auth token
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
