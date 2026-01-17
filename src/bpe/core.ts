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
  private readonly specialTokenRegex: RegExp | null;

  // Encoder: token bytes (as latin1 string) → rank
  private readonly encoder: Map<string, number>;
  // Decoder: rank → token bytes
  private readonly decoder: Map<number, Uint8Array>;

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
      tokens.push(...this.encodeOrdinary(text));
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
