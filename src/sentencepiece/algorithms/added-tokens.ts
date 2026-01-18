/**
 * Added Tokens Matcher
 *
 * Matches "added tokens" (special tokens defined in tokenizer.json or SentencePiece control tokens)
 * as atomic units before model encoding. Uses longest-match trie lookup.
 *
 * Features:
 * - Leftmost-longest match across the token set
 * - Respects HuggingFace fields: lstrip, rstrip, single_word, normalized
 */

export interface AddedToken {
  id: number;
  content: string;
  special: boolean;
  lstrip?: boolean;      // Strip left whitespace before matching (include it in the token match)
  rstrip?: boolean;      // Strip right whitespace after matching (include it in the token match)
  single_word?: boolean; // Only match as a complete word
  normalized?: boolean;  // Match against normalized text + normalized token content
}

export interface TextNormalizer {
  normalize(text: string): string;
}

export type AddedTokenSegment =
  | { type: 'added'; id: number }
  | { type: 'text'; text: string };

type TrieNode = Map<string, TrieNode> & { __terminal__?: AddedToken };

/**
 * Build a trie from added tokens for efficient longest-match lookup
 */
function buildTrie(tokens: AddedToken[], getPattern: (t: AddedToken) => string): TrieNode {
  const root = new Map() as TrieNode;

  // Deterministic insertion order: prefer lowest ID for equal-length matches
  const sorted = [...tokens].sort((a, b) => a.id - b.id);

  for (const token of sorted) {
    const pattern = getPattern(token);
    if (!pattern) continue;

    let node: TrieNode = root;
    for (const ch of pattern) {
      const next = (node.get(ch) ?? new Map()) as TrieNode;
      node.set(ch, next);
      node = next;
    }
    node.__terminal__ = token;
  }

  return root;
}

/**
 * Find the longest match starting at position `start`
 */
function findLongestMatchAt(
  text: string,
  start: number,
  trie: TrieNode
): { token: AddedToken; start: number; end: number } | null {
  let node: TrieNode | undefined = trie;
  let best: { token: AddedToken; end: number } | null = null;

  for (let i = start; i < text.length; i++) {
    node = node.get(text[i]) as TrieNode | undefined;
    if (!node) break;
    if (node.__terminal__) {
      best = { token: node.__terminal__, end: i + 1 };
    }
  }

  return best ? { token: best.token, start, end: best.end } : null;
}

/**
 * Check if a character is a "word" character (Unicode-aware)
 */
function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch);
}

/**
 * Check if match is at word boundaries (for single_word)
 */
function isSingleWordBoundary(text: string, start: number, end: number): boolean {
  const before = start === 0 ? '' : text[start - 1];
  const after = end >= text.length ? '' : text[end];
  const startOk = start === 0 || !isWordChar(before);
  const endOk = end === text.length || !isWordChar(after);
  return startOk && endOk;
}

/**
 * Find leftmost whitespace position before `to` (for lstrip)
 */
function spaceLeftmostAtEnd(text: string, from: number, to: number): number {
  let i = to;
  while (i > from && /\s/u.test(text[i - 1])) i--;
  return i;
}

/**
 * Count whitespace characters starting at `start` (for rstrip)
 */
function spaceRightmostAtStart(text: string, start: number): number {
  let i = start;
  while (i < text.length && /\s/u.test(text[i])) i++;
  return i - start;
}

/**
 * Split text on trie matches, respecting lstrip/rstrip/single_word
 */
function splitOnTrie(text: string, trie: TrieNode): AddedTokenSegment[] {
  const out: AddedTokenSegment[] = [];
  let cursor = 0;
  let i = 0;

  while (i < text.length) {
    const match = findLongestMatchAt(text, i, trie);
    if (!match) {
      i++;
      continue;
    }

    // Enforce single_word
    if (match.token.single_word && !isSingleWordBoundary(text, match.start, match.end)) {
      i++;
      continue;
    }

    // Apply lstrip/rstrip by expanding match to include adjacent whitespace
    let start = match.start;
    let end = match.end;

    if (match.token.lstrip) {
      start = Math.max(cursor, spaceLeftmostAtEnd(text, cursor, start));
    }
    if (match.token.rstrip) {
      end = end + spaceRightmostAtStart(text, end);
    }

    if (cursor < start) {
      out.push({ type: 'text', text: text.slice(cursor, start) });
    }
    out.push({ type: 'added', id: match.token.id });
    cursor = end;
    i = end;
  }

  if (cursor < text.length) {
    out.push({ type: 'text', text: text.slice(cursor) });
  }

  return out;
}

/**
 * Added Token Matcher
 *
 * Matches added tokens atomically before model encoding.
 * Supports HuggingFace tokenizer semantics:
 * - normalized=false tokens match on raw text
 * - normalized=true tokens match on normalized view
 */
export class AddedTokenMatcher {
  private readonly addedTokensById: Map<number, AddedToken>;
  private readonly normalizer?: TextNormalizer;
  private readonly rawTrie: TrieNode;
  private readonly normalizedTrie: TrieNode;
  private readonly hasNormalizedTokens: boolean;

  constructor(addedTokens: AddedToken[], options?: { normalizer?: TextNormalizer }) {
    this.normalizer = options?.normalizer;
    this.addedTokensById = new Map(addedTokens.map((t) => [t.id, t]));

    const rawTokens = addedTokens.filter((t) => !t.normalized);
    const normalizedTokens = addedTokens.filter((t) => t.normalized);
    this.hasNormalizedTokens = normalizedTokens.length > 0;

    this.rawTrie = buildTrie(rawTokens, (t) => t.content);
    this.normalizedTrie = buildTrie(normalizedTokens, (t) => {
      const content = t.content;
      return this.normalizer ? this.normalizer.normalize(content) : content;
    });
  }

  /**
   * Get an added token by ID
   */
  getAddedTokenById(id: number): AddedToken | undefined {
    return this.addedTokensById.get(id);
  }

  /**
   * Check if there are any added tokens
   */
  get hasTokens(): boolean {
    return this.addedTokensById.size > 0;
  }

  /**
   * Extract added tokens and return segments for encoding.
   *
   * Returns segments in encoding order:
   * - { type: 'added', id } for added tokens
   * - { type: 'text', text } for text that should go through model encoding
   *
   * Note: Returned text segments are normalized if a normalizer is provided
   * and there are normalized=true tokens.
   */
  extractAndNormalize(text: string): AddedTokenSegment[] {
    // 1) Split on non-normalized tokens in the original text
    const firstPass = splitOnTrie(text, this.rawTrie);

    // If there are no normalized=true tokens, don't normalize text segments
    if (!this.hasNormalizedTokens) {
      return firstPass;
    }

    // 2) Normalize the remaining text segments
    const normalizedSegments: AddedTokenSegment[] = firstPass.map((seg) => {
      if (seg.type !== 'text') return seg;
      return {
        type: 'text',
        text: this.normalizer ? this.normalizer.normalize(seg.text) : seg.text,
      };
    });

    // 3) Split on normalized tokens in the normalized segments
    const finalSegments: AddedTokenSegment[] = [];
    for (const seg of normalizedSegments) {
      if (seg.type !== 'text') {
        finalSegments.push(seg);
        continue;
      }
      finalSegments.push(...splitOnTrie(seg.text, this.normalizedTrie));
    }

    return finalSegments;
  }

  /**
   * Simple split without normalization (for SentencePiece .model files)
   */
  split(text: string): AddedTokenSegment[] {
    return splitOnTrie(text, this.rawTrie);
  }
}
