/**
 * Model Download Helper
 *
 * Downloads SentencePiece models from official sources with verification.
 * Supports caching, SHA-256 verification, and HuggingFace authentication.
 *
 * NOTE: This module uses Node.js APIs (fs, path, crypto, os) and is not browser-compatible.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { MODEL_REGISTRY } from './registry.js';
import type { KnownTokenizer } from './registry.js';

export { MODEL_REGISTRY } from './registry.js';
export type { KnownTokenizer, ModelInfo } from './registry.js';

export interface DownloadOptions {
  /** Name of the tokenizer to download */
  tokenizer: KnownTokenizer;
  /** Directory to cache models (default: SENTENCEPIECE_MODEL_CACHE_DIR or ~/.cache/sentencepiece) */
  cacheDir?: string;
  /** Enable network download (default: false - fails if not cached) */
  allowDownload?: boolean;
  /** Verify SHA-256 hash after download (default: true) */
  verifyHash?: boolean;
  /** HuggingFace auth token for gated models (or use HF_TOKEN env var) */
  authToken?: string;
  /** Custom URL to download from (hash still verified) */
  customUrl?: string;
}

/**
 * Ensure a SentencePiece model is available locally.
 * Downloads from official source if not cached.
 *
 * @returns Absolute path to the cached .model file
 */
export async function ensureSentencePieceModel(options: DownloadOptions): Promise<string> {
  const { tokenizer, allowDownload = false, verifyHash = true } = options;

  const info = MODEL_REGISTRY[tokenizer];
  if (!info) {
    throw new Error(
      `Unknown tokenizer: "${tokenizer}". ` + `Available: ${Object.keys(MODEL_REGISTRY).join(', ')}`
    );
  }

  const cacheDir = resolveCacheDir(options.cacheDir);
  const modelPath = path.join(cacheDir, info.filename);

  // Check if already cached
  if (await fileExists(modelPath)) {
    if (verifyHash && info.sha256) {
      const hash = await computeFileHash(modelPath);
      if (hash !== info.sha256) {
        console.warn(`Cache corrupted for ${tokenizer}, re-downloading...`);
        await fs.unlink(modelPath);
      } else {
        return modelPath; // Cache hit, verified
      }
    } else {
      return modelPath; // Cache hit, no verification
    }
  }

  // Not cached - download required
  if (!allowDownload) {
    throw new Error(
      `Model "${tokenizer}" not found in cache at ${modelPath}.\n\n` +
        `To download automatically, set allowDownload: true.\n` +
        `To download manually:\n` +
        `  curl -L "${info.url}" -o "${modelPath}"\n\n` +
        `Note: Some models (e.g., LLaMA) require authentication. See:\n` +
        `  https://huggingface.co/meta-llama/Llama-2-7b`
    );
  }

  // Resolve auth token (explicit option > HF_TOKEN > HUGGINGFACE_HUB_TOKEN)
  const authToken = options.authToken ?? process.env.HF_TOKEN ?? process.env.HUGGINGFACE_HUB_TOKEN;

  // Determine URL (custom mirror or default)
  const downloadUrl = options.customUrl ?? info.url;
  const isCustomUrl = !!options.customUrl;

  // Download
  console.log(`Downloading ${tokenizer} tokenizer from ${downloadUrl}...`);
  if (isCustomUrl) {
    console.log(`(Using custom URL instead of default: ${info.url})`);
  }
  await fs.mkdir(cacheDir, { recursive: true });

  const headers: Record<string, string> = {};
  if (authToken && !isCustomUrl) {
    // Only send HF auth token to HuggingFace URLs
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(downloadUrl, { headers });

  // Handle auth errors with clear messaging
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Authentication required for ${tokenizer} model (HTTP ${response.status}).\n\n` +
        `This model is gated and requires a HuggingFace account with access.\n\n` +
        `To fix:\n` +
        `1. Create account at https://huggingface.co and accept model terms\n` +
        `2. Generate token at https://huggingface.co/settings/tokens\n` +
        `3. Either:\n` +
        `   - Set HF_TOKEN environment variable\n` +
        `   - Pass authToken option to ensureSentencePieceModel()\n\n` +
        `Manual download alternative:\n` +
        `  huggingface-cli download ${info.url.replace('https://huggingface.co/', '').replace('/resolve/main/', ' ')} --local-dir ${cacheDir}`
    );
  }

  if (!response.ok) {
    throw new Error(`Failed to download ${tokenizer}: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Verify hash before writing
  if (verifyHash && info.sha256) {
    const hash = computeHash(bytes);
    if (hash !== info.sha256) {
      throw new Error(
        `SHA-256 mismatch for ${tokenizer}!\n` +
          `Expected: ${info.sha256}\n` +
          `Got: ${hash}\n` +
          `The download may be corrupted or the model has been updated.`
      );
    }
  }

  // Write to cache
  await fs.writeFile(modelPath, bytes);
  console.log(`Downloaded ${tokenizer} tokenizer to ${modelPath}`);

  return modelPath;
}

/**
 * Compute SHA-256 hash of model data
 *
 * Useful for generating hashes for the registry.
 *
 * @param data Model data as Uint8Array
 * @returns Lowercase hex SHA-256 hash
 */
export function computeModelHash(data: Uint8Array): string {
  return computeHash(data);
}

/**
 * Compute SHA-256 hash of a model file
 *
 * @param filepath Path to model file
 * @returns Lowercase hex SHA-256 hash
 */
export async function computeModelFileHash(filepath: string): Promise<string> {
  return computeFileHash(filepath);
}

// Internal helpers

function resolveCacheDir(override?: string): string {
  if (override) return override;
  if (process.env.SENTENCEPIECE_MODEL_CACHE_DIR) {
    return process.env.SENTENCEPIECE_MODEL_CACHE_DIR;
  }
  return path.join(os.homedir(), '.cache', 'sentencepiece');
}

async function fileExists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

function computeHash(data: Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function computeFileHash(filepath: string): Promise<string> {
  const data = await fs.readFile(filepath);
  return computeHash(data);
}
