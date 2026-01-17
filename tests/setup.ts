/**
 * Vitest setup file: preloads all tokenizers before tests run.
 *
 * This is necessary because the sync vocabulary loader uses `createRequire`
 * which can't load TypeScript files directly. By preloading via async imports
 * (which vitest handles), the tokenizers are cached for subsequent sync access.
 */

import { beforeAll } from 'vitest';
import { preloadTokenizer } from '../src/bpe/index.js';
import type { OpenAIEncoding } from '../src/bpe/types.js';

const ALL_ENCODINGS: OpenAIEncoding[] = [
  'r50k_base',
  'p50k_base',
  'p50k_edit',
  'cl100k_base',
  'o200k_base',
  'o200k_harmony',
];

beforeAll(async () => {
  await Promise.all(ALL_ENCODINGS.map((enc) => preloadTokenizer(enc)));
});
