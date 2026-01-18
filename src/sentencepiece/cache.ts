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
 * Uses a simple hash of the first 1KB for uniqueness + total length.
 */
export function getModelCacheKey(bytes: Uint8Array): string {
  // Simple hash of first 1KB for cache key
  const sample = bytes.slice(0, 1024);
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash + sample[i]) | 0;
  }
  return `model_${hash.toString(16)}_${bytes.length}`;
}
