/**
 * Token split regex patterns for each encoding.
 *
 * These patterns are used to pre-split text before BPE encoding.
 * Derived from OpenAI's tiktoken.
 */

import type { OpenAIEncoding } from '../bpe/types.js';

// r50k_base, p50k_base, p50k_edit (GPT-2 style)
export const R50K_TOKEN_SPLIT_REGEX =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

// cl100k_base (GPT-4, GPT-3.5-turbo)
const CONTRACTION_SUFFIX_PATTERN = String.raw`'(?:[sS]|[dD]|[mM]|[tT]|[lL][lL]|[vV][eE]|[rR][eE])`;

const CL100K_TOKEN_SPLIT_PATTERN = String.raw`${CONTRACTION_SUFFIX_PATTERN}|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]|\s+(?!\S)|\s+`;

export const CL100K_TOKEN_SPLIT_REGEX = new RegExp(
  CL100K_TOKEN_SPLIT_PATTERN,
  'gu'
);

// o200k_base, o200k_harmony (GPT-4o, o1, o3, gpt-5)
const OPTIONAL_CONTRACTION_SUFFIX = String.raw`(?:${CONTRACTION_SUFFIX_PATTERN})?`;

const O200K_TOKEN_SPLIT_PATTERN = String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+${OPTIONAL_CONTRACTION_SUFFIX}|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*${OPTIONAL_CONTRACTION_SUFFIX}|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n/]*|\s*[\r\n]+|\s+(?!\S)|\s+`;

export const O200K_TOKEN_SPLIT_REGEX = new RegExp(
  O200K_TOKEN_SPLIT_PATTERN,
  'gu'
);

/**
 * Get the token split regex for an encoding.
 */
export function getTokenSplitRegex(encoding: OpenAIEncoding): RegExp {
  switch (encoding) {
    case 'r50k_base':
    case 'p50k_base':
    case 'p50k_edit':
      return R50K_TOKEN_SPLIT_REGEX;
    case 'cl100k_base':
      return CL100K_TOKEN_SPLIT_REGEX;
    case 'o200k_base':
    case 'o200k_harmony':
      return O200K_TOKEN_SPLIT_REGEX;
    default: {
      const _exhaustive: never = encoding;
      throw new Error(`Unknown encoding: ${_exhaustive}`);
    }
  }
}
