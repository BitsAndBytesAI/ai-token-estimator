/**
 * Async SentencePiece Tokenizer (Node.js)
 *
 * Provides async file-based API for loading tokenizers from disk.
 * This module uses Node.js fs APIs and is not browser-compatible.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getSentencePieceTokenizer, type SentencePieceTokenizer } from './tokenizer.js';

/**
 * Options for loading a tokenizer from a file
 */
export interface FileOptions {
  /** Path to .model or tokenizer.json file */
  modelPath: string;
  /** Format hint ('protobuf' or 'json', auto-detected from extension if omitted) */
  format?: 'protobuf' | 'json';
}

/**
 * Load a tokenizer from a file path
 *
 * This is the async API suitable for Node.js applications.
 *
 * @param options File loading options
 * @returns Promise resolving to a tokenizer instance
 */
export async function loadSentencePieceTokenizer(options: FileOptions): Promise<SentencePieceTokenizer> {
  const { modelPath, format } = options;

  // Read file
  const bytes = await fs.readFile(modelPath);
  const data = new Uint8Array(bytes);

  // Auto-detect format from extension if not specified
  const ext = path.extname(modelPath).toLowerCase();
  const detectedFormat = format ?? (ext === '.json' ? 'json' : 'protobuf');

  return getSentencePieceTokenizer({
    modelData: data,
    format: detectedFormat,
  });
}

// === Async convenience functions ===

/**
 * Encode text to token IDs (async, file-based)
 */
export async function encodeSentencePieceAsync(text: string, options: FileOptions): Promise<number[]> {
  const tokenizer = await loadSentencePieceTokenizer(options);
  return tokenizer.encode(text);
}

/**
 * Decode token IDs to text (async, file-based)
 */
export async function decodeSentencePieceAsync(tokens: number[], options: FileOptions): Promise<string> {
  const tokenizer = await loadSentencePieceTokenizer(options);
  return tokenizer.decode(tokens);
}

/**
 * Count tokens in text (async, file-based)
 */
export async function countSentencePieceTokensAsync(text: string, options: FileOptions): Promise<number> {
  const tokenizer = await loadSentencePieceTokenizer(options);
  return tokenizer.encode(text).length;
}
