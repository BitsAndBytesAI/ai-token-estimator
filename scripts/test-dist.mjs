#!/usr/bin/env node
/**
 * Smoke test for the dist build.
 * Verifies that encode/decode work correctly from the published package
 * for both ESM and CJS entry points.
 */

import { createRequire } from 'node:module';
import { encode, decode, getOpenAIEncoding } from '../dist/index.js';

// Test CJS require path
const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

const TESTS = [
  { text: 'hello', encoding: 'cl100k_base', expectedTokens: [15339] },
  { text: 'hello', encoding: 'o200k_base', expectedTokens: [24912] },
  { text: 'hello', encoding: 'r50k_base', expectedTokens: [31373] },
  { text: 'Hello, world!', encoding: 'o200k_base', expectedTokens: [13225, 11, 2375, 0] },
];

let passed = 0;
let failed = 0;

console.log('Running dist smoke tests...\n');
console.log('=== ESM (dist/index.js) ===\n');

for (const test of TESTS) {
  const tokens = encode(test.text, { encoding: test.encoding });
  const decoded = decode(tokens, { encoding: test.encoding });

  const tokensMatch = JSON.stringify(tokens) === JSON.stringify(test.expectedTokens);
  const roundTrips = decoded === test.text;

  if (tokensMatch && roundTrips) {
    console.log(`✓ ${test.encoding}: encode("${test.text}") = [${tokens}]`);
    passed++;
  } else {
    console.log(`✗ ${test.encoding}: encode("${test.text}")`);
    console.log(`  Expected: [${test.expectedTokens}]`);
    console.log(`  Got:      [${tokens}]`);
    console.log(`  Round-trip: ${roundTrips ? 'OK' : 'FAILED'}`);
    failed++;
  }
}

// Test getOpenAIEncoding
const gpt4oEncoding = getOpenAIEncoding({ model: 'gpt-4o' });
if (gpt4oEncoding === 'o200k_base') {
  console.log(`✓ getOpenAIEncoding({ model: 'gpt-4o' }) = 'o200k_base'`);
  passed++;
} else {
  console.log(`✗ getOpenAIEncoding({ model: 'gpt-4o' }) expected 'o200k_base', got '${gpt4oEncoding}'`);
  failed++;
}

// Test decode throws on invalid token
try {
  decode([999999999], { encoding: 'cl100k_base' });
  console.log('✗ decode() should throw on invalid token ID');
  failed++;
} catch (e) {
  if (e.message.includes('Invalid token ID')) {
    console.log('✓ decode() throws on invalid token ID');
    passed++;
  } else {
    console.log(`✗ decode() threw unexpected error: ${e.message}`);
    failed++;
  }
}

// === CJS Tests ===
console.log('\n=== CJS (dist/index.cjs) ===\n');

for (const test of TESTS) {
  const tokens = cjs.encode(test.text, { encoding: test.encoding });
  const decoded = cjs.decode(tokens, { encoding: test.encoding });

  const tokensMatch = JSON.stringify(tokens) === JSON.stringify(test.expectedTokens);
  const roundTrips = decoded === test.text;

  if (tokensMatch && roundTrips) {
    console.log(`✓ ${test.encoding}: encode("${test.text}") = [${tokens}]`);
    passed++;
  } else {
    console.log(`✗ ${test.encoding}: encode("${test.text}")`);
    console.log(`  Expected: [${test.expectedTokens}]`);
    console.log(`  Got:      [${tokens}]`);
    console.log(`  Round-trip: ${roundTrips ? 'OK' : 'FAILED'}`);
    failed++;
  }
}

// Test CJS getOpenAIEncoding
const cjsEncoding = cjs.getOpenAIEncoding({ model: 'gpt-4o' });
if (cjsEncoding === 'o200k_base') {
  console.log(`✓ getOpenAIEncoding({ model: 'gpt-4o' }) = 'o200k_base'`);
  passed++;
} else {
  console.log(`✗ getOpenAIEncoding({ model: 'gpt-4o' }) expected 'o200k_base', got '${cjsEncoding}'`);
  failed++;
}

// Test CJS decode throws on invalid token
try {
  cjs.decode([999999999], { encoding: 'cl100k_base' });
  console.log('✗ decode() should throw on invalid token ID');
  failed++;
} catch (e) {
  if (e.message.includes('Invalid token ID')) {
    console.log('✓ decode() throws on invalid token ID');
    passed++;
  } else {
    console.log(`✗ decode() threw unexpected error: ${e.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
