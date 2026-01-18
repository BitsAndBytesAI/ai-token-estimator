/**
 * Unigram Encoder with Trie-Based Viterbi
 *
 * Implements the Unigram language model algorithm for tokenization.
 * Uses a trie for O(maxLen) prefix-based candidate lookup per position.
 *
 * Algorithm:
 * 1. Match USER_DEFINED tokens atomically before segmentation (NOT CONTROL tokens)
 * 2. Use Viterbi DP to find the highest-scoring segmentation
 * 3. Support byte fallback for unknown characters
 * 4. Collapse unknown runs into a single UNK token (matching Python sentencepiece)
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

    // Collect special tokens for atomic matching (USER_DEFINED + HF added_tokens only)
    // NOTE: CONTROL tokens (<pad>, <s>, </s>, etc.) are NOT matched atomically in real
    // sentencepiece - they are tokenized as ordinary text (e.g., "<pad>" → ["▁<", "pad", ">"])
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
        // CONTROL tokens (<pad>, <s>, </s>, etc.) are NEVER matched from input text.
        // In real sentencepiece, they can only be added programmatically via
        // add_bos_id/add_eos_id etc. Do NOT add them to the trie.
        // The text "<s>" should be tokenized as ['▁<', 's', '>'], not as [<s>_id]
      } else if (type === SentencePieceType.USER_DEFINED) {
        // USER_DEFINED tokens ARE matched atomically (user-specified special tokens)
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
        // Tie-break: on equal scores, prefer later start position (larger prevIdx)
        // This produces "longer earlier piece" segmentations matching most Python cases.
        // Use epsilon comparison for floating-point score equality.
        const scoreDiff = newScore - best[endIdx].score;
        if (scoreDiff > 1e-9 || (Math.abs(scoreDiff) <= 1e-9 && i > best[endIdx].prevIdx)) {
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
            // Same tie-break rule: prefer larger prevIdx on equal scores
            const scoreDiff = newScore - best[i + 1].score;
            if (scoreDiff > 1e-9 || (Math.abs(scoreDiff) <= 1e-9 && i > best[i + 1].prevIdx)) {
              // Store as special marker; we'll expand during backtrack
              best[i + 1] = { score: newScore, prevIdx: i, tokenId: -2 }; // -2 = byte fallback
            }
            continue; // Successfully handled
          }
        }

        // UNK fallback: find the maximal unknown span and emit a single UNK
        // This matches Python sentencepiece behavior where consecutive unknown
        // characters are collapsed into a single UNK token
        let endUnk = i + 1;
        while (endUnk < n) {
          // Check if there are any vocabulary matches at this position
          const nextCandidates = this.trie.findPrefixes(codePoints, endUnk);
          if (nextCandidates.length > 0) break;

          // Check if byte fallback can handle this character
          if (this.byteFallback) {
            const nextByteTokens = this.getByteTokensForChar(codePoints[endUnk]);
            if (nextByteTokens) break;
          }

          // Continue the unknown span
          endUnk++;
        }

        // Emit single UNK for the entire unknown span
        const newScore = best[i].score + this.unkScore;
        // Same tie-break rule: prefer larger prevIdx on equal scores
        const scoreDiff = newScore - best[endUnk].score;
        if (scoreDiff > 1e-9 || (Math.abs(scoreDiff) <= 1e-9 && i > best[endUnk].prevIdx)) {
          best[endUnk] = { score: newScore, prevIdx: i, tokenId: this.unkId };
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
