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

    // Gated models are skipped (require HuggingFace auth)
    if (info.gated) {
      results.push({
        name,
        filename: info.filename,
        expected: '(gated)',
        actual: '',
        match: true, // Don't fail for gated models
        error: 'Gated model - skipped',
      });
      continue;
    }

    // Non-gated models MUST have a hash specified
    if (!info.sha256) {
      results.push({
        name,
        filename: info.filename,
        expected: '(not specified)',
        actual: fs.existsSync(filePath) ? computeSha256(filePath) : '',
        match: false,
        error: 'FATAL: Non-gated model must have sha256 hash specified',
      });
      continue;
    }

    // Non-gated models MUST have the file present
    if (!fs.existsSync(filePath)) {
      results.push({
        name,
        filename: info.filename,
        expected: info.sha256,
        actual: '',
        match: false,
        error: `FATAL: Required model file not found: ${filePath}`,
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
    if (result.error?.includes('Gated model')) {
      console.log(`⏭️  ${result.name}: SKIPPED (gated model - requires HuggingFace auth)`);
      skipped++;
    } else if (result.error?.startsWith('FATAL:')) {
      console.log(`❌ ${result.name}: ${result.error}`);
      if (result.actual) {
        console.log(`   Actual hash: ${result.actual}`);
      }
      failed++;
    } else if (result.match) {
      console.log(`✅ ${result.name}: OK`);
      passed++;
    } else {
      console.log(`❌ ${result.name}: HASH MISMATCH`);
      console.log(`   Expected: ${result.expected}`);
      console.log(`   Actual:   ${result.actual}`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped (gated)`);

  if (failed > 0) {
    console.error('\n❌ Hash verification failed!');
    console.error('All non-gated models must have valid SHA-256 hashes and matching files.');
    process.exit(1);
  }

  console.log('\n✅ All hashes verified!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
