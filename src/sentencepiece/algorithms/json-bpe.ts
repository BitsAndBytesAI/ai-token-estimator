/**
 * JSON-BPE Encoder
 *
 * Merges-based BPE for HuggingFace tokenizer.json files.
 * This is different from SentencePiece BPE:
 * - Uses merge order (position in merges[] array) instead of piece scores
 * - Applies merges per-word after Metaspace pre-tokenization
 * - Supports continuing_subword_prefix and end_of_word_suffix
 */

import { AddedTokenMatcher, type AddedToken, type TextNormalizer } from './added-tokens.js';

interface MergeRule {
  left: string;
  right: string;
  result: string;
  priority: number; // Index in merges[] array (lower = higher priority)
}

export interface JsonBPEEncoderOptions {
  normalizer?: TextNormalizer;
  byteFallback?: boolean;
  unkId?: number;
  continuingSubwordPrefix?: string;
  endOfWordSuffix?: string;
  whitespaceReplacement?: string;
  addPrefixSpace?: boolean;
  addedTokens?: AddedToken[];
}

/**
 * JSON-BPE Encoder (merges-based)
 */
export class JsonBPEEncoder {
  private readonly vocab: Map<string, number>; // piece → id
  private readonly vocabReverse: Map<number, string>; // id → piece
  private readonly mergeRules: Map<string, MergeRule>; // "left right" → rule
  private readonly normalizer: TextNormalizer | null;
  private readonly byteFallback: boolean;
  private readonly unkId: number;
  private readonly continuingSubwordPrefix: string | null;
  private readonly endOfWordSuffix: string | null;
  private readonly whitespaceReplacement: string;
  private readonly addPrefixSpace: boolean;
  private readonly addedTokenMatcher: AddedTokenMatcher | null;
  private readonly addedTokensById: Map<number, AddedToken>;

  constructor(vocab: Record<string, number>, merges: string[], options: JsonBPEEncoderOptions = {}) {
    this.vocab = new Map(Object.entries(vocab));
    this.vocabReverse = new Map(Object.entries(vocab).map(([k, v]) => [v, k]));
    this.normalizer = options.normalizer ?? null;
    this.byteFallback = options.byteFallback ?? false;
    this.unkId = options.unkId ?? 0;
    this.continuingSubwordPrefix = options.continuingSubwordPrefix ?? null;
    this.endOfWordSuffix = options.endOfWordSuffix ?? null;
    this.whitespaceReplacement = options.whitespaceReplacement ?? '\u2581';
    this.addPrefixSpace = options.addPrefixSpace ?? true;
    this.addedTokensById = new Map((options.addedTokens ?? []).map((t) => [t.id, t]));
    this.addedTokenMatcher = options.addedTokens?.length
      ? new AddedTokenMatcher(options.addedTokens, { normalizer: this.normalizer ?? undefined })
      : null;

    // Parse merges into lookup map
    this.mergeRules = new Map();
    for (let i = 0; i < merges.length; i++) {
      const parts = merges[i].split(' ');
      if (parts.length !== 2) continue;
      const [left, right] = parts;
      const result = left + right;
      this.mergeRules.set(merges[i], { left, right, result, priority: i });
    }
  }

  /**
   * Encode text to token IDs
   */
  encode(text: string): number[] {
    if (text.length === 0) return [];

    // Step 0: Match added tokens first with HF semantics
    if (this.addedTokenMatcher) {
      const segments = this.addedTokenMatcher.extractAndNormalize(text);
      const result: number[] = [];
      for (const segment of segments) {
        if (segment.type === 'added') {
          result.push(segment.id);
        } else {
          // segment.text is already normalized if normalizer is configured
          result.push(...this.encodeText(segment.text));
        }
      }
      return result;
    }

    // No added tokens: still normalize if a normalizer exists
    const normalized = this.normalizer ? this.normalizer.normalize(text) : text;
    return this.encodeText(normalized);
  }

  private encodeText(text: string): number[] {
    if (text.length === 0) return [];

    // Step 1: Pre-tokenize with Metaspace (split into words)
    const words = this.preTokenize(text);

    // Step 2: For each word, run BPE and apply prefix/suffix
    const allTokenIds: number[] = [];
    for (const word of words) {
      const wordTokens = this.encodeWord(word);
      allTokenIds.push(...wordTokens);
    }

    return allTokenIds;
  }

  /**
   * Metaspace pre-tokenization (SentencePiece-style):
   * - Preserves whitespace counts (multiple spaces/newlines/tabs)
   * - Attaches whitespace runs as prefix markers on the following segment
   * - Optionally adds a prefix marker to the first segment (add_prefix_space)
   */
  private preTokenize(text: string): string[] {
    const segments: string[] = [];
    let pendingPrefix = '';

    // add_prefix_space=true: if input doesn't start with whitespace, add one
    if (this.addPrefixSpace && text.length > 0 && !/^\s/u.test(text)) {
      pendingPrefix += this.whitespaceReplacement;
    }

    for (const part of text.split(/(\s+)/u)) {
      if (!part) continue;

      if (/^\s+$/u.test(part)) {
        pendingPrefix += this.replacementMarkersForWhitespace(part);
        continue;
      }

      segments.push(pendingPrefix + part);
      pendingPrefix = '';
    }

    // Trailing whitespace becomes its own segment
    if (pendingPrefix) {
      segments.push(pendingPrefix);
    }

    return segments.filter((s) => s.length > 0);
  }

  private replacementMarkersForWhitespace(whitespace: string): string {
    let out = '';
    for (const _ of whitespace) out += this.whitespaceReplacement;
    return out;
  }

  /**
   * Encode a single word (already pre-tokenized with replacement prefix)
   */
  private encodeWord(word: string): number[] {
    // Step 1: Split into initial tokens (characters or byte fallback)
    let tokens = this.splitIntoInitialTokens(word);
    if (tokens.length === 0) return [];

    // Step 2: Iteratively apply merges until no more can be applied
    let changed = true;
    while (changed) {
      changed = false;
      let bestMerge: { index: number; rule: MergeRule } | null = null;

      // Find the highest-priority applicable merge
      for (let i = 0; i < tokens.length - 1; i++) {
        const pairKey = `${tokens[i]} ${tokens[i + 1]}`;
        const rule = this.mergeRules.get(pairKey);

        if (rule && (!bestMerge || rule.priority < bestMerge.rule.priority)) {
          bestMerge = { index: i, rule };
        }
      }

      // Apply the best merge if found
      if (bestMerge) {
        const { index, rule } = bestMerge;
        tokens = [...tokens.slice(0, index), rule.result, ...tokens.slice(index + 2)];
        changed = true;
      }
    }

    // Step 3: Apply subword prefix/suffix transformations (PER WORD)
    // Skip transforms for whitespace-only segments
    if (!this.isWhitespaceOnlySegment(word)) {
      tokens = this.applySubwordTransforms(tokens);
    }

    // Step 4: Convert tokens to IDs
    return tokens.map((t) => this.vocab.get(t) ?? this.unkId);
  }

  private isWhitespaceOnlySegment(segment: string): boolean {
    if (!segment) return true;
    if (!this.whitespaceReplacement) return false;
    return segment.split(this.whitespaceReplacement).join('') === '';
  }

  /**
   * Apply prefix/suffix WITHIN a single word's tokens
   */
  private applySubwordTransforms(tokens: string[]): string[] {
    if (!this.continuingSubwordPrefix && !this.endOfWordSuffix) {
      return tokens;
    }

    return tokens.map((token, index) => {
      let transformed = token;

      // For tokens at index > 0 WITHIN THIS WORD: prepend continuing_subword_prefix
      if (this.continuingSubwordPrefix && index > 0) {
        transformed = this.continuingSubwordPrefix + transformed;
      }

      // For the last token WITHIN THIS WORD: append end_of_word_suffix
      if (this.endOfWordSuffix && index === tokens.length - 1) {
        transformed = transformed + this.endOfWordSuffix;
      }

      return transformed;
    });
  }

  private splitIntoInitialTokens(text: string): string[] {
    const tokens: string[] = [];

    for (const char of text) {
      if (this.vocab.has(char)) {
        tokens.push(char);
      } else if (this.byteFallback) {
        // Encode unknown char as byte tokens
        const bytes = new TextEncoder().encode(char);
        for (const byte of bytes) {
          const byteToken = `<0x${byte.toString(16).toUpperCase().padStart(2, '0')}>`;
          tokens.push(byteToken);
        }
      } else {
        // Use UNK token representation
        tokens.push(this.vocabReverse.get(this.unkId) ?? '<unk>');
      }
    }

    return tokens;
  }

  /**
   * Decode token IDs to text
   */
  decode(tokenIds: number[]): string {
    const pieces: string[] = [];

    for (const id of tokenIds) {
      // Added tokens can have IDs outside base vocab
      const added = this.addedTokensById.get(id);
      if (added) {
        pieces.push(added.content);
        continue;
      }

      const piece = this.vocabReverse.get(id);
      if (piece === undefined) {
        throw new Error(`Unknown token ID: ${id}`);
      }
      pieces.push(piece);
    }

    let text = pieces.join('');
    text = this.decodeByteTokens(text);
    return text;
  }

  private decodeByteTokens(text: string): string {
    const bytePattern = /<0x([0-9A-Fa-f]{2})>/g;
    const parts: (string | number)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = bytePattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      parts.push(parseInt(match[1], 16));
      lastIndex = bytePattern.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    const result: string[] = [];
    let byteBuffer: number[] = [];

    for (const part of parts) {
      if (typeof part === 'number') {
        byteBuffer.push(part);
      } else {
        if (byteBuffer.length > 0) {
          try {
            result.push(new TextDecoder().decode(new Uint8Array(byteBuffer)));
          } catch {
            result.push('\uFFFD');
          }
          byteBuffer = [];
        }
        result.push(part);
      }
    }

    if (byteBuffer.length > 0) {
      try {
        result.push(new TextDecoder().decode(new Uint8Array(byteBuffer)));
      } catch {
        result.push('\uFFFD');
      }
    }

    return result.join('');
  }

  get vocabSize(): number {
    return this.vocab.size;
  }
}
