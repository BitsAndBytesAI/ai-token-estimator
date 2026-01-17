/**
 * Core BPE (Byte Pair Encoding) tokenizer implementation.
 *
 * This implements the tiktoken-compatible BPE tokenization algorithm
 * used by OpenAI models.
 */

import type { TokenizerConfig, TokenVocabulary } from './types.js';

/**
 * Check if a byte array represents valid UTF-8.
 */
function isValidUtf8(arr: Uint8Array): boolean {
  let i = 0;
  while (i < arr.length) {
    const byte = arr[i];

    if (byte <= 0x7f) {
      // Single byte (ASCII)
      i++;
    } else if ((byte & 0xe0) === 0xc0) {
      // Two-byte sequence
      if (i + 1 >= arr.length) return false;
      if ((arr[i + 1] & 0xc0) !== 0x80) return false;
      // Check for overlong encoding
      if (byte < 0xc2) return false;
      i += 2;
    } else if ((byte & 0xf0) === 0xe0) {
      // Three-byte sequence
      if (i + 2 >= arr.length) return false;
      if ((arr[i + 1] & 0xc0) !== 0x80) return false;
      if ((arr[i + 2] & 0xc0) !== 0x80) return false;
      // Check for overlong encoding and surrogate range
      const codePoint =
        ((byte & 0x0f) << 12) |
        ((arr[i + 1] & 0x3f) << 6) |
        (arr[i + 2] & 0x3f);
      if (codePoint < 0x800) return false;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false;
      i += 3;
    } else if ((byte & 0xf8) === 0xf0) {
      // Four-byte sequence
      if (i + 3 >= arr.length) return false;
      if ((arr[i + 1] & 0xc0) !== 0x80) return false;
      if ((arr[i + 2] & 0xc0) !== 0x80) return false;
      if ((arr[i + 3] & 0xc0) !== 0x80) return false;
      // Check for overlong encoding and valid range
      const codePoint =
        ((byte & 0x07) << 18) |
        ((arr[i + 1] & 0x3f) << 12) |
        ((arr[i + 2] & 0x3f) << 6) |
        (arr[i + 3] & 0x3f);
      if (codePoint < 0x10000) return false;
      if (codePoint > 0x10ffff) return false;
      i += 4;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Try to convert bytes to a string, returning undefined if invalid UTF-8.
 */
function bytesToString(arr: Uint8Array): string | undefined {
  if (!isValidUtf8(arr)) return undefined;
  return new TextDecoder('utf-8', { fatal: true }).decode(arr);
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
 * Compare two byte arrays lexicographically.
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return a.length - b.length;
}

/**
 * BPE tokenizer for a specific encoding vocabulary.
 */
export class BPETokenizer {
  private readonly tokenSplitRegex: RegExp;
  private readonly specialTokenMap: Map<string, number>;
  private readonly specialTokenDecoder: Map<number, string>;
  private readonly specialTokenRegex: RegExp | null;

  // Encoder: token bytes (as latin1 string) → rank
  private readonly encoder: Map<string, number>;
  // Decoder: rank → token bytes
  private readonly decoder: Map<number, Uint8Array>;
  // Non-UTF8 tokens sorted for binary search
  private readonly nonUtf8Tokens: Array<{ bytes: Uint8Array; rank: number }>;

  // LRU cache for merge results
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

    // Build special token regex
    if (this.specialTokenMap.size > 0) {
      const escaped = Array.from(this.specialTokenMap.keys())
        .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      this.specialTokenRegex = new RegExp(escaped, 'g');
    } else {
      this.specialTokenRegex = null;
    }

    // Build encoder and decoder from vocabulary
    this.encoder = new Map();
    this.decoder = new Map();
    this.nonUtf8Tokens = [];

    this.buildVocabulary(config.vocabDecoder);
  }

  /**
   * Build the vocabulary maps from the raw vocabulary data.
   */
  private buildVocabulary(vocab: TokenVocabulary): void {
    for (let rank = 0; rank < vocab.length; rank++) {
      const entry = vocab[rank];
      let bytes: Uint8Array;

      if (typeof entry === 'string') {
        // UTF-8 valid token stored as string
        bytes = stringToBytes(entry);
        this.encoder.set(entry, rank);
      } else {
        // Non-UTF8 token stored as byte array
        bytes = new Uint8Array(entry);
        // Try to convert to string for encoder lookup
        const str = bytesToString(bytes);
        if (str !== undefined) {
          this.encoder.set(str, rank);
        } else {
          // Store for binary search
          this.nonUtf8Tokens.push({ bytes, rank });
        }
      }

      this.decoder.set(rank, bytes);
    }

    // Sort non-UTF8 tokens for binary search
    this.nonUtf8Tokens.sort((a, b) => compareBytes(a.bytes, b.bytes));
  }

  /**
   * Encode text into token IDs.
   */
  encodeText(text: string, allowedSpecial?: Set<string> | 'all'): number[] {
    if (!text) return [];

    const tokens: number[] = [];
    let remaining = text;

    // Process special tokens if regex exists
    if (this.specialTokenRegex && this.specialTokenMap.size > 0) {
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
      tokens.push(...this.encodeOrdinary(remaining));
    }

    return tokens;
  }

  /**
   * Split text on special tokens.
   */
  private splitOnSpecialTokens(
    text: string,
    allowedSpecial?: Set<string> | 'all'
  ): Array<{ text: string; isSpecial: boolean }> {
    const parts: Array<{ text: string; isSpecial: boolean }> = [];

    if (!this.specialTokenRegex) {
      return [{ text, isSpecial: false }];
    }

    // Reset regex state
    this.specialTokenRegex.lastIndex = 0;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = this.specialTokenRegex.exec(text)) !== null) {
      const specialToken = match[0];

      // Check if this special token is allowed
      const isAllowed =
        allowedSpecial === 'all' || allowedSpecial?.has(specialToken);

      if (!isAllowed) {
        // Default behavior: throw on special tokens
        throw new Error(
          `Encountered special token "${specialToken}" which is not allowed. ` +
            'Use allowedSpecial to permit encoding special tokens.'
        );
      }

      // Add text before the special token
      if (match.index > lastIndex) {
        parts.push({ text: text.slice(lastIndex, match.index), isSpecial: false });
      }

      // Add the special token
      parts.push({ text: specialToken, isSpecial: true });

      lastIndex = match.index + specialToken.length;
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
      // Check cache first
      const cached = this.tokenCache.get(piece);
      if (cached) {
        tokens.push(...cached);
        continue;
      }

      // Try direct lookup first (most tokens are single entries)
      const directRank = this.encoder.get(piece);
      if (directRank !== undefined) {
        tokens.push(directRank);
        this.addToCache(piece, [directRank]);
        continue;
      }

      // Need to do BPE merge
      const pieceBytes = this.textEncoder.encode(piece);
      const pieceTokens = this.mergeBytePairs(pieceBytes);
      tokens.push(...pieceTokens);
      this.addToCache(piece, pieceTokens);
    }

    return tokens;
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
    // Try string lookup first (most tokens are UTF-8 valid)
    const str = bytesToString(bytes);
    if (str !== undefined) {
      return this.encoder.get(str);
    }

    // Binary search for non-UTF8 tokens
    return this.searchNonUtf8Tokens(bytes);
  }

  /**
   * Binary search for non-UTF8 tokens.
   */
  private searchNonUtf8Tokens(bytes: Uint8Array): number | undefined {
    let left = 0;
    let right = this.nonUtf8Tokens.length - 1;

    while (left <= right) {
      const mid = (left + right) >>> 1;
      const cmp = compareBytes(this.nonUtf8Tokens[mid].bytes, bytes);

      if (cmp === 0) {
        return this.nonUtf8Tokens[mid].rank;
      } else if (cmp < 0) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return undefined;
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
   * Add an entry to the cache, evicting if necessary.
   */
  private addToCache(key: string, value: number[]): void {
    if (this.cacheCapacity <= 0) return;

    // Simple eviction: clear half the cache when full
    if (this.tokenCache.size >= this.cacheCapacity) {
      const entries = Array.from(this.tokenCache.keys());
      const toRemove = Math.floor(entries.length / 2);
      for (let i = 0; i < toRemove; i++) {
        this.tokenCache.delete(entries[i]);
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
