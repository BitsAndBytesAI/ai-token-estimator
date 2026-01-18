/**
 * Parsed Model Cache
 *
 * In-memory cache for parsed models to avoid re-parsing on every call.
 */

import type { ModelProto } from './protobuf/schema.js';

// In-memory cache for parsed models
const parsedModelCache = new Map<string, ModelProto>();

/**
 * Get a cached parsed model
 */
export function getCachedModel(key: string): ModelProto | undefined {
  return parsedModelCache.get(key);
}

/**
 * Cache a parsed model
 */
export function setCachedModel(key: string, model: ModelProto): void {
  parsedModelCache.set(key, model);
}

/**
 * Clear the model cache
 */
export function clearModelCache(): void {
  parsedModelCache.clear();
}

/**
 * Generate a cache key from model bytes
 *
 * Uses FNV-1a hash of the FULL model bytes to avoid collisions.
 * This is critical for correctness - two different models must not
 * collide and reuse the wrong parsed model.
 */
export function getModelCacheKey(bytes: Uint8Array): string {
  // FNV-1a hash parameters (32-bit)
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET_BASIS = 0x811c9dc5;

  let hash = FNV_OFFSET_BASIS;

  // Hash ALL bytes, not just a sample
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    // Multiply by FNV prime (use Math.imul for proper 32-bit multiplication)
    hash = Math.imul(hash, FNV_PRIME);
  }

  // Convert to unsigned 32-bit and format as hex
  const hashHex = (hash >>> 0).toString(16).padStart(8, '0');
  return `model_${hashHex}_${bytes.length}`;
}
