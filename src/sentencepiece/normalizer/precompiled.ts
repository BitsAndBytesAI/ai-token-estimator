/**
 * precompiled_charsmap parser and executor
 *
 * The precompiled_charsmap is a binary blob encoding character-to-character mappings
 * used by SentencePiece normalizers (nmt_nfkc, etc.).
 *
 * Format (reverse-engineered from HuggingFace spm_precompiled):
 * - First 4 bytes: little-endian uint32, offset to the trie data
 * - Bytes 4..trieOffset: normalized string table (null-separated UTF-8 strings)
 * - Bytes trieOffset..end: trie structure for prefix matching
 *
 * The trie encodes:
 * - For each input character sequence, a replacement string (index into string table)
 *
 * Reference: https://github.com/huggingface/tokenizers/blob/main/tokenizers/src/normalizers/precompiled.rs
 */

export interface PrecompiledCharmap {
  trie?: CharMapTrie;
  doubleArrayTrie?: DoubleArrayTrie;
}

/**
 * Trie node for efficient prefix matching in character normalization
 */
export class CharMapTrie {
  children: Map<number, CharMapTrie> = new Map(); // keyed by code point
  replacement?: string;

  /**
   * Look up the longest matching prefix starting at `start` in the code point array.
   * Returns the replacement string and number of code points consumed, or null if no match.
   */
  lookup(codePoints: number[], start: number): { consumed: number; replacement: string } | null {
    return lookupInTrie(this, codePoints, start);
  }

  /**
   * Insert a mapping into the trie
   */
  insert(codePoints: number[], replacement: string): void {
    insertIntoTrie(this, codePoints, replacement);
  }
}

/**
 * Helper function for trie lookup to avoid this-aliasing
 */
function lookupInTrie(
  root: CharMapTrie,
  codePoints: number[],
  start: number
): { consumed: number; replacement: string } | null {
  let node: CharMapTrie = root;
  let lastMatch: { consumed: number; replacement: string } | null = null;

  for (let i = start; i < codePoints.length; i++) {
    const cp = codePoints[i];
    const child = node.children.get(cp);
    if (!child) break;
    node = child;
    if (node.replacement !== undefined) {
      lastMatch = { consumed: i - start + 1, replacement: node.replacement };
    }
  }

  return lastMatch;
}

/**
 * Helper function for trie insertion to avoid this-aliasing
 */
function insertIntoTrie(root: CharMapTrie, codePoints: number[], replacement: string): void {
  let node: CharMapTrie = root;
  for (const cp of codePoints) {
    let child = node.children.get(cp);
    if (!child) {
      child = new CharMapTrie();
      node.children.set(cp, child);
    }
    node = child;
  }
  node.replacement = replacement;
}


/**
 * Double-array trie for efficient binary lookup in large charmaps.
 * Based on the SentencePiece Darts::DoubleArray format.
 *
 * Format (from SentencePiece DecodePrecompiledCharsMap):
 * - Bytes 0-3: trie_blob_size in BYTES (must be divisible by 1024)
 * - Bytes 4 to 4+trie_blob_size: double-array trie data
 * - Remaining bytes: normalized strings (null-separated)
 *
 * Each trie node (u32) encodes:
 * - Label: node & 0xFF - byte to match
 * - Offset: (node >> 10) << ((node & (1 << 9)) >> 6) - next node offset
 * - Has Leaf: (node >> 8) & 1 - indicates output exists
 * - Value: node & ((1 << 31) - 1) - string table offset (when leaf)
 *
 * Lookup uses XOR-based state transitions.
 */
export class DoubleArrayTrie {
  private readonly trie: Uint32Array;
  private readonly normalizedData: Uint8Array;
  private readonly trieLength: number;

  constructor(data: Uint8Array) {
    if (data.length < 8) {
      this.trie = new Uint32Array(0);
      this.normalizedData = new Uint8Array(0);
      this.trieLength = 0;
      return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // First 4 bytes: trie_blob_size in BYTES
    const trieBlobSize = view.getUint32(0, true);

    // Validation: trie_blob_size must be divisible by 1024 (per SentencePiece)
    if (trieBlobSize < 1024 || (trieBlobSize & 0x3ff) !== 0) {
      this.trie = new Uint32Array(0);
      this.normalizedData = new Uint8Array(0);
      this.trieLength = 0;
      return;
    }

    // Check bounds
    if (4 + trieBlobSize > data.length) {
      this.trie = new Uint32Array(0);
      this.normalizedData = new Uint8Array(0);
      this.trieLength = 0;
      return;
    }

    // Trie length is number of u32 entries
    this.trieLength = trieBlobSize / 4;

    // Create a view of the trie data (starts at byte 4)
    this.trie = new Uint32Array(data.buffer, data.byteOffset + 4, this.trieLength);

    // Normalized string data follows the trie
    this.normalizedData = data.subarray(4 + trieBlobSize);
  }

  /**
   * Check if the trie is valid
   */
  get isValid(): boolean {
    return this.trieLength > 0 && this.normalizedData.length > 0;
  }

  /**
   * Look up a UTF-8 byte sequence and return all prefix matches.
   * Returns array of {length, replacement} for each matching prefix.
   */
  commonPrefixSearch(utf8Bytes: Uint8Array): Array<{ length: number; replacement: string }> {
    return this.commonPrefixSearchAt(utf8Bytes, 0);
  }

  /**
   * Like commonPrefixSearch(), but starts matching at `start` without slicing.
   */
  commonPrefixSearchAt(utf8Bytes: Uint8Array, start: number): Array<{ length: number; replacement: string }> {
    const results: Array<{ length: number; replacement: string }> = [];

    if (!this.isValid || utf8Bytes.length === 0 || start >= utf8Bytes.length) {
      return results;
    }

    let nodePos = 0 >>> 0;

    // Get initial offset from first node
    const firstNode = this.trie[0];
    nodePos = (nodePos ^ this.getOffset(firstNode)) >>> 0;

    for (let i = start; i < utf8Bytes.length; i++) {
      const byte = utf8Bytes[i];

      // XOR with the byte value
      nodePos = (nodePos ^ byte) >>> 0;

      if (nodePos >= this.trieLength) {
        break;
      }

      const unit = this.trie[nodePos];

      // Check if the label matches the byte
      if (this.getLabel(unit) !== byte) {
        break;
      }

      // XOR with the offset for next iteration
      nodePos = (nodePos ^ this.getOffset(unit)) >>> 0;

      // Check if this node has a leaf (output)
      if (this.hasLeaf(unit)) {
        // Value is stored at the new nodePos (after XOR with offset)
        if (nodePos < this.trieLength) {
          const leafUnit = this.trie[nodePos];
          const value = this.getValue(leafUnit);
          const replacement = this.getStringAt(value);
          results.push({ length: i - start + 1, replacement });
        }
      }
    }

    return results;
  }

  /**
   * Transform a single character (as UTF-8 bytes) using the trie.
   * Returns the replacement string, or null if no transformation.
   */
  transform(utf8Bytes: Uint8Array): string | null {
    const matches = this.commonPrefixSearch(utf8Bytes);
    // Return the longest (last) match
    if (matches.length > 0) {
      return matches[matches.length - 1].replacement;
    }
    return null;
  }

  // Extract label from node (low 8 bits only for byte comparison)
  private getLabel(node: number): number {
    return node & 0xFF;
  }

  // Extract offset: (node >> 10) << ((node & (1 << 9)) >> 6)
  private getOffset(node: number): number {
    const shift = ((node & 0x200) >>> 6); // (node & (1 << 9)) >> 6
    return ((node >>> 10) << shift) >>> 0;
  }

  // Check has_leaf flag: (node >> 8) & 1 == 1
  private hasLeaf(node: number): boolean {
    return ((node >>> 8) & 1) === 1;
  }

  // Get value (string table offset): node & ((1 << 31) - 1)
  private getValue(node: number): number {
    return (node >>> 0) & 0x7FFFFFFF;
  }

  private getStringAt(offset: number): string {
    if (offset >= this.normalizedData.length) {
      return '';
    }

    // Find null terminator
    let end = offset;
    while (end < this.normalizedData.length && this.normalizedData[end] !== 0) {
      end++;
    }

    return new TextDecoder().decode(this.normalizedData.subarray(offset, end));
  }
}

/**
 * Parse the precompiled_charsmap binary format
 *
 * SentencePiece format (from DecodePrecompiledCharsMap):
 * - Bytes 0-3: trie_blob_size in BYTES (must be divisible by 1024)
 * - Bytes 4 to 4+trie_blob_size: double-array trie data
 * - Remaining bytes: normalized strings (null-separated UTF-8)
 *
 * The entire blob is passed to DoubleArrayTrie which handles the parsing.
 */
export function parsePrecompiledCharsmap(data: Uint8Array): PrecompiledCharmap {
  if (data.length < 8) {
    return { trie: new CharMapTrie() };
  }

  // Try to parse as double-array trie (SentencePiece format)
  const daTrie = new DoubleArrayTrie(data);
  if (daTrie.isValid) {
    return { doubleArrayTrie: daTrie };
  }

  // Fall back to HuggingFace spm_precompiled format (older tokenizers format)
  // - Bytes 0-3: u32 trie offset
  // - Bytes 4..offset: normalized string table (null-separated)
  // - Bytes offset..end: trie bytes
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const trieOffset = view.getUint32(0, true);
    if (trieOffset > 4 && trieOffset < data.length) {
      const stringTable = parseStringTable(data.subarray(4, trieOffset));
      const trieData = data.subarray(trieOffset);
      const trie = parseTrieNode(trieData, 0, stringTable);
      if (trie.children.size > 0) {
        return { trie };
      }
    }
  } catch {
    // ignore and fall through
  }

  // No usable trie found
  return { trie: new CharMapTrie() };
}

/**
 * Parse null-separated string table
 */
function parseStringTable(data: Uint8Array): Map<number, string> {
  const strings = new Map<number, string>();
  const decoder = new TextDecoder();
  let offset = 0;
  let start = 0;

  while (offset < data.length) {
    if (data[offset] === 0) {
      // End of string
      const str = decoder.decode(data.subarray(start, offset));
      strings.set(start, str);
      start = offset + 1;
    }
    offset++;
  }

  // Handle last string if not null-terminated
  if (start < data.length) {
    const str = decoder.decode(data.subarray(start));
    strings.set(start, str);
  }

  return strings;
}

/**
 * Parse trie from binary data using iterative approach to avoid stack overflow.
 *
 * The HuggingFace spm_precompiled format is:
 * For each node at offset:
 *   - 3 bytes: number of transitions (little-endian uint24)
 *   - For each transition:
 *     - 3 bytes: input code point (little-endian uint24)
 *     - 3 bytes: child offset OR string table offset if leaf
 *     - The high bit of the offset indicates if it's a leaf (replacement)
 */
function parseTrieNode(
  trieData: Uint8Array,
  rootOffset: number,
  stringTable: Map<number, string>
): CharMapTrie {
  const root = new CharMapTrie();

  if (rootOffset >= trieData.length) {
    return root;
  }

  // Use iterative BFS with index-based queue to avoid O(n²) from shift()
  type WorkItem = { node: CharMapTrie; offset: number };
  const workQueue: WorkItem[] = [{ node: root, offset: rootOffset }];
  let queueIndex = 0; // Use index instead of shift() for O(1) dequeue
  const visited = new Set<number>(); // Prevent infinite loops

  try {
    while (queueIndex < workQueue.length) {
      const { node, offset: nodeOffset } = workQueue[queueIndex++];

      // Prevent revisiting nodes (infinite loop protection)
      if (visited.has(nodeOffset)) {
        continue;
      }
      visited.add(nodeOffset);

      if (nodeOffset >= trieData.length || nodeOffset < 0) {
        continue;
      }

      const numTransitions = readUint24LE(trieData, nodeOffset);
      let pos = nodeOffset + 3;

      // Sanity check: don't process unreasonable number of transitions
      if (numTransitions > 1000000) {
        continue;
      }

      for (let i = 0; i < numTransitions && pos + 6 <= trieData.length; i++) {
        const codePoint = readUint24LE(trieData, pos);
        pos += 3;
        const offsetOrValue = readUint24LE(trieData, pos);
        pos += 3;

        // Check if high bit is set (indicates leaf/replacement)
        const isLeaf = (offsetOrValue & 0x800000) !== 0;
        const value = offsetOrValue & 0x7fffff;

        if (isLeaf) {
          // This is a replacement - value is string table offset
          const replacement = stringTable.get(value) ?? '';
          const child = new CharMapTrie();
          child.replacement = replacement;
          node.children.set(codePoint, child);
        } else {
          // This is a child node offset - add to work queue
          const child = new CharMapTrie();
          node.children.set(codePoint, child);
          workQueue.push({ node: child, offset: value });
        }
      }
    }
  } catch {
    // If parsing fails, return what we have so far
    return root;
  }

  return root;
}

/**
 * Read 3-byte little-endian unsigned integer
 */
function readUint24LE(data: Uint8Array, offset: number): number {
  if (offset + 3 > data.length) {
    throw new Error('Buffer underflow reading uint24');
  }
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

/**
 * Apply precompiled charmap to text
 */
export function applyPrecompiledCharsmap(text: string, charmap: PrecompiledCharmap): string {
  // Use double-array trie if available
  if (charmap.doubleArrayTrie?.isValid) {
    return applyDoubleArrayCharmap(text, charmap.doubleArrayTrie);
  }

  // Fall back to simple trie
  if (!charmap.trie || !charmap.trie.children.size) {
    // Empty trie, no transformations
    return text;
  }

  const codePoints = [...text].map((c) => c.codePointAt(0)!);
  const result: string[] = [];
  let i = 0;

  while (i < codePoints.length) {
    const match = charmap.trie.lookup(codePoints, i);
    if (match) {
      result.push(match.replacement);
      i += match.consumed;
    } else {
      result.push(String.fromCodePoint(codePoints[i]));
      i++;
    }
  }

  return result.join('');
}

/**
 * Apply double-array trie charmap to text.
 *
 * The trie operates on UTF-8 byte sequences, so we must process the entire
 * input as a byte stream with longest-match prefix search. This correctly
 * handles multi-byte sequences like decomposed Unicode (e.g., "n" + combining
 * tilde → "ñ").
 */
function applyDoubleArrayCharmap(text: string, trie: DoubleArrayTrie): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const replacementCache = new Map<string, Uint8Array>();
  const utf8Bytes = encoder.encode(text);
  const resultBytes: number[] = [];

  let pos = 0;
  while (pos < utf8Bytes.length) {
    // Try longest-match prefix search from current position
    const matches = trie.commonPrefixSearchAt(utf8Bytes, pos);

    if (matches.length > 0) {
      // Use the longest match (last in the array)
      const longest = matches[matches.length - 1];
      // Append the replacement (as UTF-8 bytes)
      let replacementBytes = replacementCache.get(longest.replacement);
      if (!replacementBytes) {
        replacementBytes = encoder.encode(longest.replacement);
        replacementCache.set(longest.replacement, replacementBytes);
      }
      for (const b of replacementBytes) {
        resultBytes.push(b);
      }
      pos += longest.length;
    } else {
      // No match - keep the original byte and advance by one byte
      resultBytes.push(utf8Bytes[pos]);
      pos++;
    }
  }

  return decoder.decode(new Uint8Array(resultBytes));
}
