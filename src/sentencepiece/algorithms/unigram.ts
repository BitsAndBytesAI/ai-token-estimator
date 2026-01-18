/**
 * Unigram Encoder with Trie-Based Viterbi
 *
 * Implements the Unigram language model algorithm for tokenization.
 * Uses a trie for O(maxLen) prefix-based candidate lookup per position.
 *
 * Algorithm:
 * 1. Match special/control tokens atomically before segmentation
 * 2. Use Viterbi DP to find the highest-scoring segmentation
 * 3. Support byte fallback for unknown characters
 */

import type { SentencePiece, TrainerSpec } from '../protobuf/schema.js';
import { SentencePieceType } from '../protobuf/schema.js';
import {
  AddedTokenMatcher,
  type AddedToken,
  type TextNormalizer,
} from './added-tokens.js';

/**
 * Trie node for vocabulary lookup
 */
class VocabTrie {
  children: Map<string, VocabTrie> = new Map(); // keyed by code point
  pieceId?: number;
  score?: number;

  insert(piece: string, id: number, score: number): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node: VocabTrie = this;
    for (const char of piece) {
      let child = node.children.get(char);
      if (!child) {
        child = new VocabTrie();
        node.children.set(char, child);
      }
      node = child;
    }
    node.pieceId = id;
    node.score = score;
  }

  /**
   * Find all pieces that are prefixes of text starting at given code point index
   */
  findPrefixes(codePoints: string[], start: number): Array<{ id: number; score: number; length: number }> {
    const results: Array<{ id: number; score: number; length: number }> = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node: VocabTrie = this;

    for (let i = start; i < codePoints.length; i++) {
      const char = codePoints[i];
      const child = node.children.get(char);
      if (!child) break;
      node = child;

      if (node.pieceId !== undefined && node.score !== undefined) {
        results.push({ id: node.pieceId, score: node.score, length: i - start + 1 });
      }
    }

    return results;
  }
}

export interface UnigramEncoderOptions {
  trainerSpec?: TrainerSpec;
  addedTokens?: AddedToken[];
  normalizer?: TextNormalizer;
}

/**
 * Unigram Encoder
 *
 * Uses Viterbi dynamic programming to find the maximum likelihood segmentation.
 */
// Default representation for UNK token in decoded output (matches Python sentencepiece)
// Python sentencepiece outputs ⁇ surrounded by spaces for the <unk> token
const DEFAULT_UNK_SURFACE = ' \u2047 '; // ⁇ (DOUBLE QUESTION MARK) with surrounding spaces

export class UnigramEncoder {
  private readonly trie: VocabTrie;
  private readonly vocabReverse: Map<number, string>; // id → piece
  private readonly byteFallback: boolean;
  private readonly byteScores: Map<number, { id: number; score: number }>;
  private readonly unkId: number;
  private readonly unkScore: number;
  private readonly unkSurface: string; // What to output for UNK during decode
  private readonly specialTokenMatcher: AddedTokenMatcher;
  private readonly addedTokensById: Map<number, AddedToken>;

  constructor(pieces: SentencePiece[], options: UnigramEncoderOptions = {}) {
    this.trie = new VocabTrie();
    this.vocabReverse = new Map();
    this.byteScores = new Map();
    this.byteFallback = options.trainerSpec?.byteFallback ?? false;
    this.unkId = options.trainerSpec?.unkId ?? 0;
    this.unkSurface = DEFAULT_UNK_SURFACE;

    let unkScore = -Infinity;
    this.addedTokensById = new Map((options.addedTokens ?? []).map((t) => [t.id, t]));

    // Collect special tokens for atomic matching (CONTROL + USER_DEFINED + HF added_tokens)
    const specialTokens: AddedToken[] = [...(options.addedTokens ?? [])];

    for (let id = 0; id < pieces.length; id++) {
      const { piece, score, type } = pieces[id];
      this.vocabReverse.set(id, piece);

      if (type === SentencePieceType.UNKNOWN) {
        unkScore = score;
      } else if (type === SentencePieceType.BYTE) {
        const match = piece.match(/^<0x([0-9A-Fa-f]{2})>$/);
        if (match) {
          this.byteScores.set(parseInt(match[1], 16), { id, score });
        }
      } else if (type === SentencePieceType.CONTROL) {
        // Match atomically, don't add to trie
        specialTokens.push({ id, content: piece, special: true });
      } else if (type === SentencePieceType.USER_DEFINED) {
        // Match atomically, don't add to trie
        specialTokens.push({ id, content: piece, special: true });
      } else if (type === SentencePieceType.NORMAL) {
        // Add to trie for Viterbi
        this.trie.insert(piece, id, score);
      }
      // UNUSED pieces are skipped
    }

    this.unkScore = unkScore;

    // Build special token matcher for atomic matching before Viterbi
    this.specialTokenMatcher = new AddedTokenMatcher(specialTokens, {
      normalizer: options.normalizer,
    });
  }

  /**
   * Encode text to token IDs
   */
  encode(text: string): number[] {
    if (text.length === 0) return [];

    // Step 0: Match special/control tokens atomically BEFORE Viterbi
    // This ensures tokens like <s>, </s>, <unk>, and user-defined tokens
    // are never broken by the segmentation algorithm
    if (this.specialTokenMatcher.hasTokens) {
      const segments = this.specialTokenMatcher.split(text);
      const result: number[] = [];

      for (const segment of segments) {
        if (segment.type === 'added') {
          result.push(segment.id);
        } else {
          result.push(...this.encodeText(segment.text));
        }
      }

      return result;
    }

    return this.encodeText(text);
  }

  private encodeText(text: string): number[] {
    if (text.length === 0) return [];

    // Convert to array of code points for correct Unicode handling
    const codePoints = [...text];
    const n = codePoints.length;

    // Viterbi DP: best[i] = best segmentation ending at code point i
    const best: Array<{ score: number; prevIdx: number; tokenId: number }> = new Array(n + 1)
      .fill(null)
      .map(() => ({ score: -Infinity, prevIdx: -1, tokenId: -1 }));
    best[0] = { score: 0, prevIdx: -1, tokenId: -1 };

    // Forward pass
    for (let i = 0; i < n; i++) {
      if (best[i].score === -Infinity) continue;

      // Use trie to find all vocabulary pieces starting at position i
      const candidates = this.trie.findPrefixes(codePoints, i);

      for (const { id, score, length } of candidates) {
        const newScore = best[i].score + score;
        const endIdx = i + length;
        if (newScore > best[endIdx].score) {
          best[endIdx] = { score: newScore, prevIdx: i, tokenId: id };
        }
      }

      // Handle unknown characters when no candidates found
      if (candidates.length === 0) {
        const char = codePoints[i];

        // Try byte fallback first (if enabled)
        if (this.byteFallback) {
          const byteTokens = this.getByteTokensForChar(char);
          if (byteTokens) {
            const newScore = best[i].score + byteTokens.totalScore;
            if (newScore > best[i + 1].score) {
              // Store as special marker; we'll expand during backtrack
              best[i + 1] = { score: newScore, prevIdx: i, tokenId: -2 }; // -2 = byte fallback
            }
            continue; // Successfully handled
          }
        }

        // Fallback to UNK token (CRITICAL: ensures path always exists)
        const newScore = best[i].score + this.unkScore;
        if (newScore > best[i + 1].score) {
          best[i + 1] = { score: newScore, prevIdx: i, tokenId: this.unkId };
        }
      }
    }

    // Backward pass: reconstruct best path
    const tokens: number[] = [];
    let pos = n;

    while (pos > 0) {
      const { prevIdx, tokenId } = best[pos];

      if (tokenId === -2) {
        // Byte fallback: expand the single code point to byte tokens
        const char = codePoints[prevIdx];
        const byteTokens = this.getByteTokensForChar(char);
        if (byteTokens) {
          tokens.unshift(...byteTokens.ids);
        }
      } else if (tokenId >= 0) {
        tokens.unshift(tokenId);
      }

      pos = prevIdx;
    }

    return tokens;
  }

  private getByteTokensForChar(char: string): { ids: number[]; totalScore: number } | null {
    const bytes = new TextEncoder().encode(char);
    const ids: number[] = [];
    let totalScore = 0;

    for (const byte of bytes) {
      const byteInfo = this.byteScores.get(byte);
      if (!byteInfo) return null;
      ids.push(byteInfo.id);
      totalScore += byteInfo.score;
    }

    return { ids, totalScore };
  }

  /**
   * Decode token IDs to text
   */
  decode(tokens: number[]): string {
    const pieces: string[] = [];

    for (const id of tokens) {
      // Check added tokens first
      const added = this.addedTokensById.get(id);
      if (added) {
        pieces.push(added.content);
        continue;
      }

      // Handle UNK token specially - output ⁇ instead of <unk>
      if (id === this.unkId) {
        pieces.push(this.unkSurface);
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
    // Find all byte token patterns and decode them
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

    // Merge consecutive bytes and decode as UTF-8
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
            // Invalid UTF-8 sequence, output replacement character
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
    return this.vocabReverse.size;
  }
}
