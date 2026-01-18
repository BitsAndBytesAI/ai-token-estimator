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
  trie: CharMapTrie;
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


// Maximum charmap size to parse
// Large charmaps (like T5's 237KB) use a double-array trie format that requires
// specialized parsing. For now, we skip them and fall back to NFKC.
// This affects ~9 test cases (ZWJ emoji sequences).
const MAX_CHARMAP_SIZE = 50000;

/**
 * Parse the precompiled_charsmap binary format
 *
 * The format is:
 * - Bytes 0-3: little-endian uint32, offset to trie data
 * - Bytes 4 to trieOffset: string table (null-terminated UTF-8 strings)
 * - Bytes trieOffset to end: trie structure
 *
 * Trie structure (each node):
 * - 3 bytes: number of children (little-endian uint24)
 * - For each child:
 *   - 3 bytes: code point (little-endian uint24)
 *   - 3 bytes: child node offset from start of trie data (little-endian uint24)
 * - If this node has a replacement:
 *   - 3 bytes: string table offset (little-endian uint24), or 0xFFFFFF if no replacement
 *
 * NOTE: Large charmaps (>50KB) use a more complex double-array trie format.
 * We skip these and fall back to NFKC normalization.
 */
export function parsePrecompiledCharsmap(data: Uint8Array): PrecompiledCharmap {
  if (data.length < 4) {
    return { trie: new CharMapTrie() };
  }

  // Skip very large charmaps - they use a double-array trie format
  // that's too complex to parse efficiently. Fall back to NFKC.
  if (data.length > MAX_CHARMAP_SIZE) {
    return { trie: new CharMapTrie() };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Read trie offset (first 4 bytes, little-endian)
  const trieOffset = view.getUint32(0, true);

  if (trieOffset >= data.length) {
    return { trie: new CharMapTrie() };
  }

  // Parse string table (bytes 4 to trieOffset)
  const stringTable = parseStringTable(data.subarray(4, trieOffset));

  // Parse trie (bytes trieOffset to end)
  const trieData = data.subarray(trieOffset);
  const trie = parseTrieNode(trieData, 0, stringTable);

  return { trie };
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
  if (!charmap.trie.children.size) {
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
