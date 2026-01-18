/**
 * SentencePiece BPE Encoder
 *
 * Score-based BPE using priority queue (min-heap) + doubly-linked list.
 * This is the algorithm used by SentencePiece .model files.
 *
 * Merge Priority Rules:
 * 1. Lower score = higher priority (merge first)
 * 2. Tie-breaker: lower piece ID (earlier in vocab)
 * 3. Position tie-breaker: leftmost position
 *
 * NOTE: CONTROL tokens (<pad>, <s>, </s>, etc.) are NOT matched atomically.
 * They are tokenized as ordinary text, matching Python sentencepiece behavior.
 */

import type { SentencePiece, TrainerSpec } from '../protobuf/schema.js';
import { SentencePieceType } from '../protobuf/schema.js';
import { AddedTokenMatcher, type AddedToken } from './added-tokens.js';

interface LinkedNode {
  piece: string;
  prev: LinkedNode | null;
  next: LinkedNode | null;
  deleted: boolean;
  position: number; // Original position for tie-breaking
}

interface MergeCandidate {
  score: number;
  mergedPieceId: number;
  leftPosition: number;
  left: LinkedNode;
  right: LinkedNode;
}

/**
 * Min-heap priority queue for merge candidates
 */
class MergeHeap {
  private heap: MergeCandidate[] = [];

  push(candidate: MergeCandidate): void {
    this.heap.push(candidate);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): MergeCandidate | undefined {
    if (this.heap.length === 0) return undefined;
    const result = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return result;
  }

  get size(): number {
    return this.heap.length;
  }

  private compare(a: MergeCandidate, b: MergeCandidate): number {
    // 1. Lower score = higher priority
    if (a.score !== b.score) return a.score - b.score;
    // 2. Lower piece ID = higher priority
    if (a.mergedPieceId !== b.mergedPieceId) return a.mergedPieceId - b.mergedPieceId;
    // 3. Leftmost position = higher priority
    return a.leftPosition - b.leftPosition;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.compare(this.heap[parent], this.heap[idx]) <= 0) break;
      [this.heap[parent], this.heap[idx]] = [this.heap[idx], this.heap[parent]];
      idx = parent;
    }
  }

  private bubbleDown(idx: number): void {
    while (true) {
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      let smallest = idx;

      if (left < this.heap.length && this.compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < this.heap.length && this.compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === idx) break;

      [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
      idx = smallest;
    }
  }
}

export interface BPEEncoderOptions {
  trainerSpec?: TrainerSpec;
  addedTokens?: AddedToken[];
}

/**
 * SentencePiece BPE Encoder (score-based)
 */
export class BPEEncoder {
  private readonly vocab: Map<string, number>; // piece → id
  private readonly vocabReverse: Map<number, string>; // id → piece
  private readonly pieceScores: Map<string, number>; // piece → score
  private readonly byteFallback: boolean;
  private readonly byteTokenIds: Map<number, number>; // byte value → token id
  private readonly unkId: number;
  private readonly specialTokenMatcher: AddedTokenMatcher;
  private readonly addedTokensById: Map<number, AddedToken>;

  constructor(pieces: SentencePiece[], options: BPEEncoderOptions = {}) {
    this.vocab = new Map();
    this.vocabReverse = new Map();
    this.pieceScores = new Map();
    this.byteTokenIds = new Map();
    this.byteFallback = options.trainerSpec?.byteFallback ?? false;
    this.unkId = options.trainerSpec?.unkId ?? 0;

    // Collect special tokens for atomic matching (USER_DEFINED + HF added_tokens only)
    // NOTE: CONTROL tokens (<pad>, <s>, </s>, etc.) are NOT matched atomically in real
    // sentencepiece - they are tokenized as ordinary text
    const specialTokens: AddedToken[] = [...(options.addedTokens ?? [])];
    this.addedTokensById = new Map((options.addedTokens ?? []).map((t) => [t.id, t]));

    for (let id = 0; id < pieces.length; id++) {
      const { piece, score, type } = pieces[id];
      this.vocab.set(piece, id);
      this.vocabReverse.set(id, piece);
      this.pieceScores.set(piece, score);

      // Track byte fallback tokens
      if (type === SentencePieceType.BYTE) {
        const match = piece.match(/^<0x([0-9A-Fa-f]{2})>$/);
        if (match) {
          this.byteTokenIds.set(parseInt(match[1], 16), id);
        }
      }

      // Only USER_DEFINED tokens are matched atomically (not CONTROL tokens)
      if (type === SentencePieceType.USER_DEFINED) {
        specialTokens.push({ id, content: piece, special: true });
      }
    }

    this.specialTokenMatcher = new AddedTokenMatcher(specialTokens);
  }

  /**
   * Encode text to token IDs
   */
  encode(text: string): number[] {
    if (text.length === 0) return [];

    // First, match special/control tokens atomically
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

    // Build linked list of initial symbols
    const { head } = this.buildInitialList(text);
    if (!head) return [];

    // Build initial merge candidates
    const heap = new MergeHeap();
    this.addMergeCandidates(head, heap);

    // Process merges in priority order
    while (heap.size > 0) {
      const candidate = heap.pop()!;

      // Skip if either node was deleted
      if (candidate.left.deleted || candidate.right.deleted) continue;

      // Skip if nodes are no longer adjacent
      if (candidate.left.next !== candidate.right) continue;

      // Verify the merged piece still has the expected score
      const merged = candidate.left.piece + candidate.right.piece;
      const mergedId = this.vocab.get(merged);
      if (mergedId === undefined) continue;

      const currentScore = this.pieceScores.get(merged);
      if (currentScore === undefined || currentScore !== candidate.score) continue;

      // Perform the merge
      candidate.left.piece = merged;
      candidate.left.next = candidate.right.next;
      if (candidate.right.next) {
        candidate.right.next.prev = candidate.left;
      }
      candidate.right.deleted = true;

      // Add new merge candidates for the merged node
      this.addMergeCandidatesForNode(candidate.left, heap);
    }

    // Convert linked list to token IDs
    return this.linkedListToTokenIds(head);
  }

  private buildInitialList(text: string): { head: LinkedNode | null; nodes: LinkedNode[] } {
    const nodes: LinkedNode[] = [];
    let head: LinkedNode | null = null;
    let prev: LinkedNode | null = null;
    let position = 0;

    // Convert to array of code points for correct Unicode handling
    const codePoints = [...text];

    // Iterate over code points, collapsing consecutive unknowns into a single UNK
    let i = 0;
    while (i < codePoints.length) {
      const char = codePoints[i];
      let pieces: string[];

      if (this.vocab.has(char)) {
        pieces = [char];
        i++;
      } else if (this.byteFallback) {
        // Split into byte tokens
        const bytes = new TextEncoder().encode(char);
        pieces = Array.from(bytes).map(
          (b) => `<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`
        );
        i++;
      } else {
        // Unknown character - find the entire unknown span and emit a single UNK
        // This matches Python sentencepiece behavior
        let endUnk = i + 1;
        while (endUnk < codePoints.length) {
          const nextChar = codePoints[endUnk];
          if (this.vocab.has(nextChar)) break;
          if (this.byteFallback) break; // byte fallback would handle it
          endUnk++;
        }
        pieces = [this.vocabReverse.get(this.unkId) ?? '<unk>'];
        i = endUnk; // Skip the entire unknown span
      }

      for (const piece of pieces) {
        const node: LinkedNode = {
          piece,
          prev,
          next: null,
          deleted: false,
          position: position++,
        };
        if (prev) prev.next = node;
        if (!head) head = node;
        prev = node;
        nodes.push(node);
      }
    }

    return { head, nodes };
  }

  private addMergeCandidates(head: LinkedNode, heap: MergeHeap): void {
    let node: LinkedNode | null = head;
    while (node && node.next) {
      this.addMergeCandidateForPair(node, node.next, heap);
      node = node.next;
    }
  }

  private addMergeCandidatesForNode(node: LinkedNode, heap: MergeHeap): void {
    // Add candidate with previous node
    if (node.prev && !node.prev.deleted) {
      this.addMergeCandidateForPair(node.prev, node, heap);
    }
    // Add candidate with next node
    if (node.next && !node.next.deleted) {
      this.addMergeCandidateForPair(node, node.next, heap);
    }
  }

  private addMergeCandidateForPair(left: LinkedNode, right: LinkedNode, heap: MergeHeap): void {
    const merged = left.piece + right.piece;
    const mergedId = this.vocab.get(merged);
    if (mergedId === undefined) return;

    const score = this.pieceScores.get(merged);
    if (score === undefined) return;

    heap.push({
      score,
      mergedPieceId: mergedId,
      leftPosition: left.position,
      left,
      right,
    });
  }

  private linkedListToTokenIds(head: LinkedNode | null): number[] {
    const ids: number[] = [];
    let node = head;

    while (node) {
      if (!node.deleted) {
        const id = this.vocab.get(node.piece);
        if (id !== undefined) {
          ids.push(id);
        } else {
          ids.push(this.unkId);
        }
      }
      node = node.next;
    }

    return ids;
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

      const piece = this.vocabReverse.get(id);
      if (piece === undefined) {
        throw new Error(`Unknown token ID: ${id}`);
      }
      pieces.push(piece);
    }

    // Join pieces and decode byte tokens
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
    return this.vocab.size;
  }
}
