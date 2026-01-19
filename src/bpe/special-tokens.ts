/**
 * Special token definitions for each encoding.
 *
 * Based on OpenAI's tiktoken special token mappings.
 */

import type { OpenAIEncoding } from './types.js';

/**
 * Special token entries: [token string, token ID]
 */
type SpecialTokenEntry = readonly [string, number];

/**
 * Special tokens for r50k_base encoding.
 */
const R50K_BASE_SPECIAL_TOKENS: readonly SpecialTokenEntry[] = [
  ['<|endoftext|>', 50256],
];

/**
 * Special tokens for p50k_base encoding.
 */
const P50K_BASE_SPECIAL_TOKENS: readonly SpecialTokenEntry[] = [
  ['<|endoftext|>', 50256],
];

/**
 * Special tokens for p50k_edit encoding.
 */
const P50K_EDIT_SPECIAL_TOKENS: readonly SpecialTokenEntry[] = [
  ['<|endoftext|>', 50256],
  ['<|fim_prefix|>', 50281],
  ['<|fim_middle|>', 50282],
  ['<|fim_suffix|>', 50283],
];

/**
 * Special tokens for cl100k_base encoding.
 */
const CL100K_BASE_SPECIAL_TOKENS: readonly SpecialTokenEntry[] = [
  ['<|endoftext|>', 100257],
  ['<|fim_prefix|>', 100258],
  ['<|fim_middle|>', 100259],
  ['<|fim_suffix|>', 100260],
  // ChatML tokens for chat completion
  ['<|im_start|>', 100264],
  ['<|im_end|>', 100265],
  ['<|im_sep|>', 100266],
  ['<|endofprompt|>', 100276],
];

/**
 * Special tokens for o200k_base encoding.
 */
const O200K_BASE_SPECIAL_TOKENS: readonly SpecialTokenEntry[] = [
  ['<|endoftext|>', 199999],
  // ChatML tokens for chat completion
  ['<|im_start|>', 200264],
  ['<|im_end|>', 200265],
  ['<|im_sep|>', 200266],
  ['<|endofprompt|>', 200018],
];

/**
 * Build o200k_harmony special tokens including reserved range.
 */
function buildO200kHarmonySpecialTokens(): readonly SpecialTokenEntry[] {
  const tokens: SpecialTokenEntry[] = [
    ['<|startoftext|>', 199998],
    ['<|endoftext|>', 199999],
    ['<|reserved_200000|>', 200000],
    ['<|reserved_200001|>', 200001],
    ['<|return|>', 200002],
    ['<|constrain|>', 200003],
    ['<|reserved_200004|>', 200004],
    ['<|channel|>', 200005],
    ['<|start|>', 200006],
    ['<|end|>', 200007],
    ['<|message|>', 200008],
    ['<|reserved_200009|>', 200009],
    ['<|reserved_200010|>', 200010],
    ['<|reserved_200011|>', 200011],
    ['<|call|>', 200012],
  ];

  // Add reserved tokens 200013 through 200017
  for (let i = 200013; i <= 200017; i++) {
    tokens.push([`<|reserved_${i}|>`, i]);
  }

  // Add endofprompt
  tokens.push(['<|endofprompt|>', 200018]);

  // Add reserved tokens 200019 through 201087
  for (let i = 200019; i <= 201087; i++) {
    tokens.push([`<|reserved_${i}|>`, i]);
  }

  return tokens;
}

const O200K_HARMONY_SPECIAL_TOKENS = buildO200kHarmonySpecialTokens();

/**
 * Special token mappings by encoding.
 */
export const SPECIAL_TOKENS: Record<
  OpenAIEncoding,
  readonly SpecialTokenEntry[]
> = {
  r50k_base: R50K_BASE_SPECIAL_TOKENS,
  p50k_base: P50K_BASE_SPECIAL_TOKENS,
  p50k_edit: P50K_EDIT_SPECIAL_TOKENS,
  cl100k_base: CL100K_BASE_SPECIAL_TOKENS,
  o200k_base: O200K_BASE_SPECIAL_TOKENS,
  o200k_harmony: O200K_HARMONY_SPECIAL_TOKENS,
};

/**
 * Get special token map for an encoding.
 */
export function getSpecialTokenMap(
  encoding: OpenAIEncoding
): Map<string, number> {
  const entries = SPECIAL_TOKENS[encoding];
  return new Map(entries);
}

/**
 * Sentinel value indicating all special tokens should be allowed.
 */
export const SPECIAL_TOKEN_SET = 'all' as const;

/**
 * Set of all known special token strings across all encodings.
 */
export const ALL_SPECIAL_TOKEN_STRINGS = new Set([
  '<|endoftext|>',
  '<|fim_prefix|>',
  '<|fim_middle|>',
  '<|fim_suffix|>',
  '<|endofprompt|>',
  '<|startoftext|>',
  '<|return|>',
  '<|constrain|>',
  '<|channel|>',
  '<|start|>',
  '<|end|>',
  '<|message|>',
  '<|call|>',
  // ChatML tokens
  '<|im_start|>',
  '<|im_end|>',
  '<|im_sep|>',
]);
