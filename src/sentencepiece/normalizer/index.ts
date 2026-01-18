/**
 * SentencePiece Normalizer
 *
 * Handles text normalization before tokenization:
 * 1. Apply precompiled charmap (if present) or NFKC fallback
 * 2. Remove extra whitespaces
 * 3. Add dummy prefix
 * 4. Escape whitespaces (replace space with ▁)
 *
 * Also handles denormalization for decode():
 * 1. Replace ▁ with space
 * 2. Remove dummy prefix
 * 3. Apply denormalizer charmap (if present)
 */

import {
  parsePrecompiledCharsmap,
  applyPrecompiledCharsmap,
  type PrecompiledCharmap,
} from './precompiled.js';
import type { NormalizerSpec } from '../protobuf/schema.js';

const DEFAULT_WHITESPACE_REPLACEMENT = '\u2581'; // ▁ (Lower One Eighth Block)

/**
 * Helper to escape special regex characters
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface NormalizerOptions {
  /** Normalizer spec from ModelProto */
  normalizerSpec: NormalizerSpec;
  /** Denormalizer spec from ModelProto (optional, for decode parity) */
  denormalizerSpec?: NormalizerSpec;
  /** Override whitespace replacement character (default: ▁) */
  whitespaceReplacement?: string;
}

export class Normalizer {
  private readonly precompiledCharmap: PrecompiledCharmap | null;
  private readonly denormalizerCharmap: PrecompiledCharmap | null;
  private readonly addDummyPrefix: boolean;
  private readonly removeExtraWhitespaces: boolean;
  private readonly escapeWhitespaces: boolean;
  private readonly whitespaceReplacement: string;

  constructor(options: NormalizerOptions) {
    const { normalizerSpec, denormalizerSpec, whitespaceReplacement } = options;

    // Parse precompiled charmap if present (CRITICAL for parity)
    if (normalizerSpec.precompiledCharsmap && normalizerSpec.precompiledCharsmap.length > 0) {
      this.precompiledCharmap = parsePrecompiledCharsmap(normalizerSpec.precompiledCharsmap);
    } else {
      this.precompiledCharmap = null;
    }

    // Parse denormalizer charmap if present (for decode parity)
    if (denormalizerSpec?.precompiledCharsmap && denormalizerSpec.precompiledCharsmap.length > 0) {
      this.denormalizerCharmap = parsePrecompiledCharsmap(denormalizerSpec.precompiledCharsmap);
    } else {
      this.denormalizerCharmap = null;
    }

    this.addDummyPrefix = normalizerSpec.addDummyPrefix ?? true;
    this.removeExtraWhitespaces = normalizerSpec.removeExtraWhitespaces ?? true;
    this.escapeWhitespaces = normalizerSpec.escapeWhitespaces ?? true;
    this.whitespaceReplacement = whitespaceReplacement ?? DEFAULT_WHITESPACE_REPLACEMENT;
  }

  /**
   * Normalize text before tokenization
   */
  normalize(text: string): string {
    let result = text;

    // 1. Apply precompiled charmap (if present)
    if (this.precompiledCharmap && this.hasValidCharmap(this.precompiledCharmap)) {
      result = applyPrecompiledCharsmap(result, this.precompiledCharmap);
    } else {
      // Fallback: basic NFKC normalization
      result = result.normalize('NFKC');
    }

    // 2. Remove extra whitespaces (collapse multiple spaces, trim)
    if (this.removeExtraWhitespaces) {
      result = result.replace(/\s+/g, ' ').trim();
    }

    // 3. Add dummy prefix (space at start)
    if (this.addDummyPrefix && result.length > 0) {
      result = ' ' + result;
    }

    // 4. Escape whitespaces (replace ' ' with configured replacement)
    if (this.escapeWhitespaces) {
      result = result.split(' ').join(this.whitespaceReplacement);
    }

    return result;
  }

  /**
   * Denormalize text after decoding
   *
   * Python sentencepiece behavior:
   * - Replaces ▁ with space
   * - Strips the leading space (dummy prefix removal)
   */
  denormalize(text: string): string {
    let result = text;

    // 1. Replace whitespace token with space
    const pattern = new RegExp(escapeRegExp(this.whitespaceReplacement), 'g');
    result = result.replace(pattern, ' ');

    // 2. Remove dummy prefix (the leading space)
    // Python sentencepiece always strips the leading space during decode
    if (this.addDummyPrefix && result.startsWith(' ')) {
      result = result.slice(1);
    }

    // 3. Apply denormalizer charmap (if present)
    if (this.denormalizerCharmap && this.hasValidCharmap(this.denormalizerCharmap)) {
      result = applyPrecompiledCharsmap(result, this.denormalizerCharmap);
    }

    return result;
  }

  /**
   * Check if a charmap has valid content (either trie or doubleArrayTrie)
   */
  private hasValidCharmap(charmap: PrecompiledCharmap): boolean {
    // Check double-array trie first (used for large charmaps)
    if (charmap.doubleArrayTrie?.isValid) {
      return true;
    }
    // Fall back to simple trie
    if (charmap.trie && charmap.trie.children.size > 0) {
      return true;
    }
    return false;
  }

  /**
   * Get the whitespace replacement character
   */
  get replacement(): string {
    return this.whitespaceReplacement;
  }

  /**
   * Check if dummy prefix is enabled
   */
  get hasDummyPrefix(): boolean {
    return this.addDummyPrefix;
  }
}

/**
 * Simple normalizer that just does whitespace replacement
 * Used for tokenizer.json where normalization is handled separately
 */
export class SimpleNormalizer {
  private readonly whitespaceReplacement: string;
  private readonly addPrefixSpace: boolean;

  constructor(options: { whitespaceReplacement?: string; addPrefixSpace?: boolean } = {}) {
    this.whitespaceReplacement = options.whitespaceReplacement ?? DEFAULT_WHITESPACE_REPLACEMENT;
    this.addPrefixSpace = options.addPrefixSpace ?? true;
  }

  /**
   * Apply Metaspace-style normalization (for tokenizer.json)
   */
  normalize(text: string): string {
    let result = text;

    // Add prefix space if configured and text doesn't start with whitespace
    if (this.addPrefixSpace && result.length > 0 && !/^\s/.test(result)) {
      result = ' ' + result;
    }

    // Replace spaces with whitespace token
    result = result.split(' ').join(this.whitespaceReplacement);

    return result;
  }

  /**
   * Reverse the normalization
   */
  denormalize(text: string): string {
    const pattern = new RegExp(escapeRegExp(this.whitespaceReplacement), 'g');
    let result = text.replace(pattern, ' ');

    // Remove leading space if we added it
    if (this.addPrefixSpace && result.startsWith(' ')) {
      result = result.slice(1);
    }

    return result;
  }

  get replacement(): string {
    return this.whitespaceReplacement;
  }
}

export { parsePrecompiledCharsmap, applyPrecompiledCharsmap } from './precompiled.js';
