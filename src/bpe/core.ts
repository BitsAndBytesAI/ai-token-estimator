/**
 * Core BPE (Byte Pair Encoding) tokenizer implementation.
 *
 * This implements the tiktoken-compatible BPE tokenization algorithm
 * used by OpenAI models.
 */

import type { TokenizerConfig, TokenVocabulary } from './types.js';

/**
 * Convert bytes to a latin-1 string (each byte becomes a char code).
 * This matches how the vocabulary stores token bytes.
 */
function bytesToLatin1(arr: Uint8Array): string {
  let str = '';
  for (let i = 0; i < arr.length; i++) {
    str += String.fromCharCode(arr[i]);
  }
  return str;
}

/**
 * Convert a string to bytes using latin1 encoding (preserves byte values).
 */
function stringToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}

/**
 * BPE tokenizer for a specific encoding vocabulary.
 */
export class BPETokenizer {
  private readonly tokenSplitRegex: RegExp;
  private readonly specialTokenMap: Map<string, number>;
  private readonly specialTokenDecoder: Map<number, string>;

  // Encoder: token bytes (as latin1 string) → rank
  private readonly encoder: Map<string, number>;
  // Decoder: rank → token bytes
  private readonly decoder: Map<number, Uint8Array>;

  // LRU cache for BPE merge results (Map iteration order tracks recency)
  private readonly tokenCache: Map<string, number[]>;
  private cacheCapacity: number;

  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder('utf-8', { fatal: false });

  constructor(config: TokenizerConfig) {
    this.tokenSplitRegex = config.tokenSplitRegex;
    this.specialTokenMap = config.specialTokenMap ?? new Map();
    this.cacheCapacity = config.cacheCapacity ?? 100_000;
    this.tokenCache = new Map();

    // Build reverse special token map
    this.specialTokenDecoder = new Map();
    for (const [token, rank] of this.specialTokenMap) {
      this.specialTokenDecoder.set(rank, token);
    }

    // Build encoder and decoder from vocabulary
    this.encoder = new Map();
    this.decoder = new Map();

    this.buildVocabulary(config.vocabDecoder);
  }

  /**
   * Build the vocabulary maps from the raw vocabulary data.
   */
  private buildVocabulary(vocab: TokenVocabulary): void {
    for (let rank = 0; rank < vocab.length; rank++) {
      const entry = vocab[rank];
      let bytes: Uint8Array;
      let key: string;

      if (typeof entry === 'string') {
        // Token stored as latin-1 string (each char is a byte)
        bytes = stringToBytes(entry);
        key = entry;
      } else {
        // Token stored as byte array
        bytes = new Uint8Array(entry);
        key = bytesToLatin1(bytes);
      }

      this.encoder.set(key, rank);
      this.decoder.set(rank, bytes);
    }
  }

  /**
   * Encode text into token IDs.
   *
   * @param text - The text to encode
   * @param allowedSpecial - Controls special token handling:
   *   - 'skip': Skip special token detection entirely (encode as regular text)
   *   - 'all': Allow all special tokens
   *   - Set<string>: Allow only the specified special tokens
   *   - undefined: Throw on any special token (default)
   */
  encodeText(text: string, allowedSpecial?: Set<string> | 'all' | 'skip'): number[] {
    if (!text) return [];

    // Skip special token handling if requested (treat special tokens as regular text)
    if (allowedSpecial === 'skip') {
      return this.encodeOrdinary(text);
    }

    const tokens: number[] = [];

    // Process special tokens if any are defined
    if (this.specialTokenMap.size > 0) {
      const parts = this.splitOnSpecialTokens(text, allowedSpecial);

      for (const part of parts) {
        if (part.isSpecial) {
          const tokenId = this.specialTokenMap.get(part.text);
          if (tokenId !== undefined) {
            tokens.push(tokenId);
          }
        } else {
          tokens.push(...this.encodeOrdinary(part.text));
        }
      }
    } else {
      tokens.push(...this.encodeOrdinary(text));
    }

    return tokens;
  }

  /**
   * Split text on special tokens using deterministic scan.
   * All special tokens follow the pattern <|...|>, so we scan for these delimiters
   * instead of using a giant regex alternation (which scales poorly for o200k_harmony).
   */
  private splitOnSpecialTokens(
    text: string,
    allowedSpecial?: Set<string> | 'all'
  ): Array<{ text: string; isSpecial: boolean }> {
    const parts: Array<{ text: string; isSpecial: boolean }> = [];
    let lastIndex = 0;
    let searchFrom = 0;

    while (searchFrom < text.length) {
      // Find the next potential special token start
      const startDelim = text.indexOf('<|', searchFrom);
      if (startDelim === -1) {
        break;
      }

      // Find the closing delimiter
      const endDelim = text.indexOf('|>', startDelim + 2);
      if (endDelim === -1) {
        // No closing delimiter, no more special tokens possible
        break;
      }

      // Extract the potential special token (including delimiters)
      const potentialToken = text.slice(startDelim, endDelim + 2);

      // Check if this is actually a special token in our map
      if (this.specialTokenMap.has(potentialToken)) {
        // Check if this special token is allowed
        const isAllowed =
          allowedSpecial === 'all' || allowedSpecial?.has(potentialToken);

        if (!isAllowed) {
          throw new Error(
            `Encountered special token "${potentialToken}" which is not allowed. ` +
              'Use allowedSpecial to permit encoding special tokens.'
          );
        }

        // Add text before the special token
        if (startDelim > lastIndex) {
          parts.push({ text: text.slice(lastIndex, startDelim), isSpecial: false });
        }

        // Add the special token
        parts.push({ text: potentialToken, isSpecial: true });

        lastIndex = endDelim + 2;
        searchFrom = lastIndex;
      } else {
        // Not a special token, continue searching after this '<|'
        // Safe to skip by 2 since '<|' is 2 chars and next '<|' can't overlap
        searchFrom = startDelim + 2;
      }
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex), isSpecial: false });
    }

    return parts;
  }

  /**
   * Encode text without special token handling.
   */
  private encodeOrdinary(text: string): number[] {
    if (!text) return [];

    const tokens: number[] = [];

    // Reset regex state and match all pieces
    this.tokenSplitRegex.lastIndex = 0;
    const matches = text.match(this.tokenSplitRegex);

    if (!matches) return tokens;

    for (const piece of matches) {
      // Check cache first (with LRU touch)
      const cached = this.getFromCache(piece);
      if (cached) {
        tokens.push(...cached);
        continue;
      }

      // Convert to UTF-8 bytes then to latin-1 key for vocab lookup
      const pieceBytes = this.textEncoder.encode(piece);
      const key = bytesToLatin1(pieceBytes);

      // Try direct lookup first (most tokens are single entries)
      // This avoids O(n²) BPE merges for common whole-piece tokens
      const directRank = this.encoder.get(key);
      if (directRank !== undefined) {
        tokens.push(directRank);
        this.addToCache(piece, [directRank]);
        continue;
      }

      // Need to do BPE merge
      const pieceTokens = this.mergeBytePairs(pieceBytes);
      tokens.push(...pieceTokens);
      this.addToCache(piece, pieceTokens);
    }

    return tokens;
  }

  /**
   * Encode text with a token limit, returning early if the limit is exceeded.
   * This is optimized for fast token-limit validation without full tokenization.
   *
   * @param text - The text to encode
   * @param limit - Maximum number of tokens allowed
   * @param allowedSpecial - Controls special token handling (same as encodeText)
   * @returns Object with count and exceeded flag
   */
  encodeTextWithLimit(
    text: string,
    limit: number,
    allowedSpecial?: Set<string> | 'all' | 'skip'
  ): { count: number; exceeded: boolean } {
    if (!text) return { count: 0, exceeded: false };
    if (limit < 0) return { count: 0, exceeded: true };

    // Skip special token handling if requested (treat special tokens as regular text)
    if (allowedSpecial === 'skip') {
      return this.encodeOrdinaryWithLimit(text, limit);
    }

    let count = 0;

    // Process special tokens if any are defined
    if (this.specialTokenMap.size > 0) {
      const parts = this.splitOnSpecialTokens(text, allowedSpecial);

      for (const part of parts) {
        if (part.isSpecial) {
          count += 1; // Special tokens are always 1 token
          if (count > limit) return { count, exceeded: true };
        } else {
          const result = this.encodeOrdinaryWithLimit(part.text, limit - count);
          count += result.count;
          if (result.exceeded) {
            return { count, exceeded: true };
          }
        }
      }
    } else {
      return this.encodeOrdinaryWithLimit(text, limit);
    }

    return { count, exceeded: false };
  }

  /**
   * Incremental encoding with early exit.
   * CRITICAL: Uses RegExp.exec() loop instead of text.match() to avoid
   * allocating all pieces upfront. This enables true early exit.
   */
  private encodeOrdinaryWithLimit(
    text: string,
    limit: number
  ): { count: number; exceeded: boolean } {
    if (!text) return { count: 0, exceeded: false };
    if (limit < 0) return { count: 0, exceeded: true };

    let count = 0;

    // CRITICAL: Clone regex per call to avoid reentrancy issues.
    // RegExp.lastIndex is mutable state; concurrent calls would corrupt it.
    // Also ensure /g flag is present for exec() to work correctly.
    const regex = new RegExp(
      this.tokenSplitRegex.source,
      this.tokenSplitRegex.flags.includes('g')
        ? this.tokenSplitRegex.flags
        : this.tokenSplitRegex.flags + 'g'
    );

    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const piece = match[0];

      // Guard against zero-length matches to prevent infinite loops
      if (piece.length === 0) {
        regex.lastIndex++;
        continue;
      }

      // Check cache first (with LRU touch)
      const cached = this.getFromCache(piece);
      if (cached) {
        count += cached.length;
        if (count > limit) return { count, exceeded: true };
        continue;
      }

      // Convert to UTF-8 bytes then to latin-1 key for vocab lookup
      const pieceBytes = this.textEncoder.encode(piece);
      const key = bytesToLatin1(pieceBytes);

      // Try direct lookup first (most tokens are single entries)
      const directRank = this.encoder.get(key);
      if (directRank !== undefined) {
        count += 1;
        this.addToCache(piece, [directRank]);
        if (count > limit) return { count, exceeded: true };
        continue;
      }

      // BPE merge (can't early-exit within a piece, but pieces are small)
      const pieceTokens = this.mergeBytePairs(pieceBytes);
      count += pieceTokens.length;
      this.addToCache(piece, pieceTokens);
      if (count > limit) return { count, exceeded: true };
    }

    return { count, exceeded: false };
  }

  /**
   * Core BPE merge algorithm.
   */
  private mergeBytePairs(piece: Uint8Array): number[] {
    if (piece.length === 0) return [];

    if (piece.length === 1) {
      return [this.getByteRankOrThrow(piece)];
    }

    // 'starts' holds the start indices of each partition
    const starts: number[] = [];
    // 'ranks' holds the BPE ranks of each partition pair
    const ranks: number[] = [];

    // Helper to get the rank of a byte pair
    const getRank = (
      startIndex: number,
      pairStart = starts[startIndex],
      pairEnd = starts[startIndex + 2]
    ): number => {
      if (pairEnd === undefined) return Number.POSITIVE_INFINITY;
      const key = piece.subarray(pairStart, pairEnd);
      const rank = this.lookupByteRank(key);
      return rank ?? Number.POSITIVE_INFINITY;
    };

    // Initialize with all byte boundaries
    for (let i = 0; i <= piece.length; i++) {
      starts.push(i);
      if (i < piece.length - 1) {
        ranks.push(getRank(i, i, i + 2));
      } else {
        ranks.push(Number.POSITIVE_INFINITY);
      }
    }

    // Iteratively merge byte pairs until no more merges possible
    while (starts.length > 1) {
      let lowestRank = Number.POSITIVE_INFINITY;
      let lowestIndex = -1;

      // Find the partition with the minimum rank
      for (let i = 0; i < ranks.length - 1; i++) {
        const rank = ranks[i];
        if (rank < lowestRank) {
          lowestRank = rank;
          lowestIndex = i;
        }
      }

      if (lowestRank === Number.POSITIVE_INFINITY || lowestIndex === -1) {
        break;
      }

      // Merge the pair by removing the partition boundary
      starts.splice(lowestIndex + 1, 1);
      ranks.splice(lowestIndex, 1);

      // Update ranks for affected pairs
      ranks[lowestIndex] = getRank(lowestIndex);
      if (lowestIndex > 0) {
        ranks[lowestIndex - 1] = getRank(lowestIndex - 1);
      }
    }

    // Convert final partitions to token IDs
    const output: number[] = [];
    for (let i = 0; i < starts.length - 1; i++) {
      const tokenBytes = piece.subarray(starts[i], starts[i + 1]);
      output.push(this.getByteRankOrThrow(tokenBytes));
    }

    return output;
  }

  /**
   * Look up the rank for a byte sequence.
   */
  private lookupByteRank(bytes: Uint8Array): number | undefined {
    // Convert to latin-1 string (matches how vocab stores tokens)
    const str = bytesToLatin1(bytes);
    return this.encoder.get(str);
  }

  /**
   * Look up the rank for a byte sequence, throwing if not found.
   */
  private getByteRankOrThrow(bytes: Uint8Array): number {
    const rank = this.lookupByteRank(bytes);
    if (rank === undefined) {
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      throw new Error(`Token not found in vocabulary: [${hex}]`);
    }
    return rank;
  }

  /**
   * Get from cache with LRU touch (moves entry to most-recently-used position).
   */
  private getFromCache(key: string): number[] | undefined {
    const value = this.tokenCache.get(key);
    if (value !== undefined) {
      // Touch: delete and re-add to move to end (most recently used)
      this.tokenCache.delete(key);
      this.tokenCache.set(key, value);
    }
    return value;
  }

  /**
   * Add an entry to the cache, evicting LRU entries if necessary.
   */
  private addToCache(key: string, value: number[]): void {
    if (this.cacheCapacity <= 0) return;

    // Evict LRU entries (first in iteration order = oldest)
    if (this.tokenCache.size >= this.cacheCapacity) {
      const toRemove = Math.max(1, Math.floor(this.cacheCapacity / 2));
      let removed = 0;
      for (const k of this.tokenCache.keys()) {
        if (removed >= toRemove) break;
        this.tokenCache.delete(k);
        removed++;
      }
    }

    this.tokenCache.set(key, value);
  }

  /**
   * Decode token IDs back to text.
   */
  decodeTokens(tokens: Iterable<number>): string {
    const bytes: number[] = [];

    for (const token of tokens) {
      // Check special tokens first
      const specialToken = this.specialTokenDecoder.get(token);
      if (specialToken !== undefined) {
        const specialBytes = this.textEncoder.encode(specialToken);
        bytes.push(...specialBytes);
        continue;
      }

      // Regular token
      const tokenBytes = this.decoder.get(token);
      if (tokenBytes) {
        bytes.push(...tokenBytes);
      } else {
        throw new Error(
          `Invalid token ID: ${token}. Token not found in vocabulary or special tokens.`
        );
      }
    }

    return this.textDecoder.decode(new Uint8Array(bytes));
  }

  /**
   * Set the cache capacity.
   */
  setCacheCapacity(size: number): void {
    this.cacheCapacity = size;
    if (size <= 0) {
      this.tokenCache.clear();
    }
  }

  /**
   * Clear the token cache.
   */
  clearCache(): void {
    this.tokenCache.clear();
  }
}
