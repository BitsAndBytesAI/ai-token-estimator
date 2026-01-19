/**
 * Performance benchmark for isWithinTokenLimit.
 *
 * This demonstrates the early-exit optimization - when a token limit is
 * exceeded early in the text, isWithinTokenLimit returns much faster than
 * full tokenization via encode().
 *
 * Usage: npx tsx benchmark/is-within-token-limit.ts
 */

import { encode, isWithinTokenLimit } from '../src/index.js';

const sizes = [100, 1_000, 10_000, 100_000];
const limits = [10, 100, 1_000];

console.log('isWithinTokenLimit Performance Benchmark');
console.log('========================================\n');

for (const size of sizes) {
  const text = 'word '.repeat(size);
  console.log(`Text size: ${(size * 5).toLocaleString()} chars (~${size.toLocaleString()} tokens)`);

  // Full encode baseline
  const fullStart = performance.now();
  const fullCount = encode(text, { model: 'gpt-4o' }).length;
  const fullTime = performance.now() - fullStart;
  console.log(`  Full encode: ${fullTime.toFixed(2)}ms (${fullCount.toLocaleString()} tokens)`);

  for (const limit of limits) {
    const limitStart = performance.now();
    const result = isWithinTokenLimit(text, limit, { model: 'gpt-4o' });
    const limitTime = performance.now() - limitStart;
    const speedup = fullTime / limitTime;
    const resultStr = result === false ? 'exceeded' : result.toLocaleString();
    console.log(
      `  Limit ${limit.toLocaleString().padStart(5)}: ${limitTime.toFixed(2).padStart(8)}ms ` +
      `(${resultStr.padStart(10)}) - ${speedup.toFixed(1).padStart(6)}x faster`
    );
  }
  console.log();
}

// Warmup note
console.log('Note: First run may be slower due to JIT compilation.');
console.log('Run multiple times for consistent results.');
