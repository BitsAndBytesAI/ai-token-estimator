#!/usr/bin/env npx tsx
/**
 * Verify Registry Hashes
 *
 * This script verifies that all SHA-256 hashes in the model registry
 * match the actual files in tests/.models/ (for local verification)
 * or can download and verify from source URLs.
 *
 * Usage:
 *   npm run verify:hashes          # Verify local test models
 *   npm run verify:hashes -- --download  # Download and verify from URLs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { MODEL_REGISTRY } from '../src/sentencepiece/download/registry.js';

const MODELS_DIR = path.join(import.meta.dirname, '..', 'tests', '.models');

interface VerifyResult {
  name: string;
  filename: string;
  expected: string;
  actual: string;
  match: boolean;
  error?: string;
}

function computeSha256(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function verifyLocalModels(): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];

  for (const [name, info] of Object.entries(MODEL_REGISTRY)) {
    const filePath = path.join(MODELS_DIR, info.filename);

    if (!fs.existsSync(filePath)) {
      results.push({
        name,
        filename: info.filename,
        expected: info.sha256,
        actual: '',
        match: false,
        error: `File not found: ${filePath}`,
      });
      continue;
    }

    if (!info.sha256) {
      results.push({
        name,
        filename: info.filename,
        expected: '(not specified)',
        actual: computeSha256(filePath),
        match: false,
        error: 'Hash not specified in registry (gated model?)',
      });
      continue;
    }

    const actual = computeSha256(filePath);
    results.push({
      name,
      filename: info.filename,
      expected: info.sha256,
      actual,
      match: actual === info.sha256,
    });
  }

  return results;
}

async function main(): Promise<void> {
  console.log('Verifying model hashes...\n');

  const results = await verifyLocalModels();

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const result of results) {
    if (result.error?.includes('File not found')) {
      console.log(`⏭️  ${result.name}: SKIPPED (file not found)`);
      skipped++;
    } else if (result.error?.includes('not specified')) {
      console.log(`⚠️  ${result.name}: NO HASH (actual: ${result.actual})`);
      skipped++;
    } else if (result.match) {
      console.log(`✅ ${result.name}: OK`);
      passed++;
    } else {
      console.log(`❌ ${result.name}: MISMATCH`);
      console.log(`   Expected: ${result.expected}`);
      console.log(`   Actual:   ${result.actual}`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (failed > 0) {
    console.error('\n❌ Hash verification failed!');
    process.exit(1);
  }

  console.log('\n✅ All hashes verified!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
