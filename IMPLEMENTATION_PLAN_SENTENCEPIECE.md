# Implementation Plan: Remove sentencepiece-js Dependency

## Overview

Replace the `sentencepiece-js` WASM-based dependency with a pure TypeScript implementation that has **zero external dependencies**. This enables:
- Smaller bundle size (no WASM)
- Browser-native execution
- Full control over the tokenization logic
- Support for user-supplied models and optional downloads from default sources

## Requirements Summary

| Requirement | Details |
|------------|---------|
| Model loading | User-supplied `.model` files + optional download from default/custom sources |
| File formats | SentencePiece `.model` (protobuf) + HuggingFace `tokenizer.json` (Unigram + BPE with Metaspace) |
| Algorithms | BPE + Unigram (Viterbi) |
| Functionality | Encode (text → tokens) + Decode (tokens → text) |
| Dependencies | **None** (custom protobuf parser) |
| Testing | Python sentencepiece golden fixtures |

---

## Licensing & Distribution

### Policy: No Embedded Models by Default

**We do NOT embed any third-party `.model` bytes in the npm package.** This avoids:
- Redistribution licensing issues (Gemma, LLaMA have varying terms)
- Bundle size bloat (~4MB per model)
- Stale model versions

### Model Loading Options

1. **User-supplied model** (always available, works offline):
   ```typescript
   // Node.js
   const tokenizer = await loadSentencePieceTokenizer({ modelPath: './tokenizer.model' });

   // Browser/serverless
   const modelBytes = await fetch('/models/tokenizer.model').then(r => r.arrayBuffer());
   const tokenizer = getSentencePieceTokenizer({ modelData: modelBytes });
   ```

2. **Download helper** (convenience, fetches from default sources):
   ```typescript
   // Downloads from default source, verifies SHA-256, caches on disk
   const modelPath = await ensureSentencePieceModel({
     tokenizer: 'gemma',
     cacheDir: './models',  // or SENTENCEPIECE_MODEL_CACHE_DIR env var
   });
   const tokenizer = await loadSentencePieceTokenizer({ modelPath });
   ```

### Default Download Sources

These are the default URLs used by the download helper. Users can override with custom URLs or mirrors.

| Tokenizer | Default Source (HuggingFace) | SHA-256 |
|-----------|------------------------------|---------|
| `gemma` | `https://huggingface.co/google/gemma-2b/resolve/main/tokenizer.model` | (computed at release) |
| `llama2` | `https://huggingface.co/meta-llama/Llama-2-7b/resolve/main/tokenizer.model` | (computed at release) |

**Note**: HuggingFace is a distribution host, not the canonical source. URLs may change, models may be gated, or users may prefer alternative mirrors. Hash verification ensures integrity regardless of source.

### Configuration

```typescript
// Environment variables
SENTENCEPIECE_MODEL_CACHE_DIR  // Where downloads are cached (default: ~/.cache/sentencepiece)

// API options
interface DownloadOptions {
  tokenizer: 'gemma' | 'llama2';
  cacheDir?: string;           // Override cache directory
  allowDownload?: boolean;     // Default: false. Set true to enable network download.
  verifyHash?: boolean;        // Default: true. Verify SHA-256 after download.
  authToken?: string;          // HuggingFace token for gated models (or use HF_TOKEN env var)
  customUrl?: string;          // Override default URL (use your own mirror). Hash still verified.
}
```

---

## Critical Design Decisions

### 1. Unicode Handling Strategy

**Problem**: JavaScript strings use UTF-16, but SentencePiece operates on code points. Naive `string.length` and `slice()` break on surrogate pairs, emoji/ZWJ sequences, and combining marks.

**Decision**: Operate on **code point arrays** (`[...text]`) throughout for simplicity. This matches how SentencePiece conceptually works (code points, not bytes), and avoids the complexity of byte-offset mapping.

```typescript
// Canonical representation: array of code point strings
type CodePointArray = string[];  // Each element is a single code point (1-2 UTF-16 code units)

function toCodePoints(text: string): CodePointArray {
  return [...text];  // Correctly handles surrogate pairs
}

// All algorithms use CodePointArray:
// - Normalizer: operates on code points
// - BPE: builds linked list of code point strings
// - Unigram: trie keyed by code point strings, DP over code point indices
```

**Why code points over UTF-8 bytes**:
- Simpler implementation (no byte offset tracking)
- Matches SentencePiece's conceptual model
- Trie/vocab lookups use string keys naturally
- Byte fallback still works: encode single code point to UTF-8 bytes when needed

### 2. Model Naming Convention

**Problem**: "llama-3" is not SentencePiece. Model names should map to tokenizer artifacts, not LLM families.

**Solution**: Use tokenizer-centric naming with algorithm detection from `trainer_spec.model_type`.

```typescript
// Embedded tokenizer identifiers (map to actual tokenizer artifacts)
type EmbeddedTokenizer =
  | 'gemma'       // Gemma/Gemini tokenizer (BPE, 256K vocab)
  | 'llama2';     // LLaMA 2 tokenizer (BPE, 32K vocab)
  // Note: LLaMA 3 uses tiktoken-style BPE, NOT SentencePiece

// Algorithm is detected from parsed model, not assumed
function getAlgorithm(model: ModelProto): 'bpe' | 'unigram' {
  const modelType = model.trainerSpec?.modelType ?? ModelType.UNIGRAM;
  switch (modelType) {
    case ModelType.BPE: return 'bpe';
    case ModelType.UNIGRAM: return 'unigram';
    default: throw new Error(`Unsupported model type: ${modelType}`);
  }
}
```

### 3. tokenizer.json Scope Limitation

**Problem**: HF `tokenizer.json` is not "SentencePiece in JSON" - it can represent many pipelines (ByteLevel BPE, metaspace, normalizer chains, etc.). We need to distinguish SentencePiece-compatible configs from GPT-2/tiktoken-style BPE.

**Decision**: Support **Unigram** and **BPE with Metaspace** (SentencePiece-style).

```typescript
// Supported:
// 1. Unigram models (T5, ALBERT, XLNet, mBART, etc.)
//    - vocab is array of [piece, score] tuples
//    - Score-based Viterbi works directly
//
// 2. BPE with Metaspace pre-tokenizer (SentencePiece-style BPE)
//    - Uses ▁ for word boundaries like SentencePiece
//    - vocab is Record<piece, id>, scores derived from merge order

// NOT supported: ByteLevel BPE (GPT-2/tiktoken-style)
// - Uses byte-level encoding, not Metaspace
// - Requires different algorithm (use src/bpe/ instead)

function validateJsonConfig(config: HFTokenizerConfig): void {
  const modelType = config.model?.type;

  if (modelType === 'Unigram') {
    if (!Array.isArray(config.model.vocab)) {
      throw new UnsupportedTokenizerError('Unigram model missing vocab array');
    }
  } else if (modelType === 'BPE') {
    // Must have Metaspace for SentencePiece compatibility
    const preTokenizerType = getPreTokenizerType(config.pre_tokenizer);
    if (preTokenizerType !== 'Metaspace') {
      throw new UnsupportedTokenizerError(
        `Unsupported BPE tokenizer: pre_tokenizer is "${preTokenizerType}", expected "Metaspace". ` +
        'This appears to be a GPT-2/tiktoken-style BPE, not SentencePiece. ' +
        'Use the BPE tokenizer from src/bpe/ instead.'
      );
    }
  } else {
    throw new UnsupportedTokenizerError(
      `Unsupported model type: "${modelType}". Only "Unigram" and "BPE" (with Metaspace) are supported.`
    );
  }
}
```

**What we support**:
- **Unigram**: scores map directly to Viterbi
- **BPE+Metaspace**: SentencePiece-style, uses ▁ word boundaries

**What we reject** (with clear error):
- **ByteLevel BPE**: GPT-2/tiktoken-style, redirect to `src/bpe/`

### 4. TrainerSpec Behavior Support

**Parsed but actively used**:
| Field | Location | Implementation |
|-------|----------|----------------|
| `modelType` | Algorithm selection | Chooses BPE vs Unigram encoder |
| `byteFallback` | BPE/Unigram | Encode unknown chars as `<0xXX>` byte tokens |
| `unkId` | BPE/Unigram | Fallback token when no match and no byte fallback |
| `bosId`, `eosId`, `padId` | Decoder | Recognized as control tokens |
| `maxSentencepieceLength` | Unigram | Max piece length in trie lookup |

**Implemented TrainerSpec flags** (affect tokenization, must be supported):
| Field | Default | Notes |
|-------|---------|-------|
| `splitDigits` | false | Pre-tokenizes digits as individual chars |
| `treatWhitespaceAsSuffix` | false | Places ▁ at end of word instead of start |
| `splitByUnicodeScript` | true | Pre-tokenizes at script boundaries |
| `splitByWhitespace` | true | Pre-tokenizes at whitespace |

```typescript
// pre-tokenizer.ts - Implements TrainerSpec pre-tokenization options

export class PreTokenizer {
  private readonly splitByWhitespace: boolean;
  private readonly splitDigits: boolean;
  private readonly splitByUnicodeScript: boolean;
  private readonly treatWhitespaceAsSuffix: boolean;
  private readonly whitespaceReplacement: string;

  constructor(spec: TrainerSpec, normalizerSpec: NormalizerSpec) {
    this.splitByWhitespace = spec.splitByWhitespace ?? true;
    this.splitDigits = spec.splitDigits ?? false;
    this.splitByUnicodeScript = spec.splitByUnicodeScript ?? true;
    this.treatWhitespaceAsSuffix = spec.treatWhitespaceAsSuffix ?? false;
    this.whitespaceReplacement = normalizerSpec.whitespaceReplacement;
  }

  /**
   * Pre-tokenize text before BPE/Unigram encoding.
   * Returns array of "word" segments to be encoded independently.
   */
  preTokenize(text: string): string[] {
    // Split into whitespace/non-whitespace runs so we can preserve whitespace *counts*
    const runs = this.splitByWhitespace
      ? splitIntoRuns(text)
      : [{ type: 'text' as const, text }];

    // Refine text runs with optional script/digit splitting (whitespace runs are preserved)
    const refinedRuns: Array<{ type: 'space' | 'text'; text: string }> = [];

    for (const run of runs) {
      if (run.type === 'space') {
        refinedRuns.push(run);
        continue;
      }

      let parts = [run.text];
      if (this.splitByUnicodeScript) {
        parts = parts.flatMap(s => this.splitByScriptImpl(s));
      }
      if (this.splitDigits) {
        parts = parts.flatMap(s => this.splitDigitsImpl(s));
      }

      for (const part of parts) {
        if (part.length > 0) refinedRuns.push({ type: 'text', text: part });
      }
    }

    // Attach whitespace as prefix/suffix markers using whitespaceReplacement
    const segments: string[] = [];
    let pendingPrefix = '';

    for (const run of refinedRuns) {
      if (run.type === 'space') {
        const markers = whitespaceToReplacement(run.text, this.whitespaceReplacement);

        if (this.treatWhitespaceAsSuffix) {
          if (segments.length > 0) {
            segments[segments.length - 1] += markers;
          } else {
            // Leading whitespace cannot be a suffix; attach to the first word as a prefix
            pendingPrefix += markers;
          }
        } else {
          pendingPrefix += markers;
        }

        continue;
      }

      segments.push(pendingPrefix + run.text);
      pendingPrefix = '';
    }

    // Trailing whitespace in prefix mode becomes a standalone segment of markers
    if (!this.treatWhitespaceAsSuffix && pendingPrefix) {
      segments.push(pendingPrefix);
    }

    return segments.filter(s => s.length > 0);
  }

  private splitByScriptImpl(text: string): string[] {
    // Split at Unicode script boundaries (e.g., Latin → Han → Latin)
    // Uses generated script tables from UCD for correctness and speed.
    const result: string[] = [];
    let current = '';
    let currentScript: number | null = null;

    for (const char of text) {
      const script = getUnicodeScriptId(char);
      if (currentScript !== null && script !== currentScript && script !== SCRIPT_COMMON) {
        if (current) result.push(current);
        current = char;
        currentScript = script;
      } else {
        current += char;
        if (script !== SCRIPT_COMMON) currentScript = script;
      }
    }
    if (current) result.push(current);
    return result.length ? result : [text];
  }

  private splitDigitsImpl(text: string): string[] {
    // Split so each digit is separate: "abc123def" → ["abc", "1", "2", "3", "def"]
    const result: string[] = [];
    let current = '';

    for (const char of text) {
      if (/\d/.test(char)) {
        if (current) {
          result.push(current);
          current = '';
        }
        result.push(char);  // Each digit is its own segment
      } else {
        current += char;
      }
    }
    if (current) result.push(current);
    return result.length ? result : [text];
  }
}

type Run = { type: 'space' | 'text'; text: string };

function splitIntoRuns(text: string): Run[] {
  const runs: Run[] = [];
  for (const part of text.split(/(\s+)/u)) {
    if (!part) continue;
    runs.push(/^\s+$/u.test(part) ? { type: 'space', text: part } : { type: 'text', text: part });
  }
  return runs;
}

function whitespaceToReplacement(whitespace: string, replacement: string): string {
  // One replacement marker per whitespace code point (tabs/newlines count too)
  let out = '';
  for (const _ of whitespace) out += replacement;
  return out;
}

/**
 * Unicode script detection (production):
 * - Generated from UCD Scripts.txt at build time into `unicode-scripts.generated.ts`
 * - Uses binary search over code point ranges for speed
 */
declare const SCRIPT_COMMON: number;
declare function getUnicodeScriptId(char: string): number;
```

### 5. Denormalizer Handling

**Decision**: Implement `denormalizer_spec.precompiled_charsmap` execution for **full decode parity**.

- Denormalization is for converting tokenized output back to "raw" form
- Required for true `encode(decode(ids)) === ids` round-trip parity
- The denormalizer charmap is essentially the inverse of the normalizer charmap

Implementation note: `Normalizer.denormalize()` must apply `denormalizer_spec.precompiled_charsmap` (if present) for full decode parity. This behavior is part of the Phase 2 `Normalizer` implementation and should not be re-specified in separate snippets.

**Note**: The denormalizer charmap uses the same format as the normalizer charmap, just with different mappings. Most models have the same charmap for both, but some have explicit denormalizer_spec.

---

## New API Design

### Core Tokenizer Interface

```typescript
interface SentencePieceTokenizer {
  encode(text: string): number[];
  decode(tokens: number[]): string;
  readonly vocabSize: number;
  readonly algorithm: 'bpe' | 'unigram';
}
```

### Sync API (in-memory models)

```typescript
// Create tokenizer from in-memory data (browser/serverless friendly)
function getSentencePieceTokenizer(options: DataOptions): SentencePieceTokenizer;

interface DataOptions {
  modelData: Uint8Array | ArrayBuffer;
  format?: 'protobuf' | 'json';  // Default: 'protobuf', auto-detect by content
}

// Convenience functions
function encodeSentencePiece(text: string, options: DataOptions): number[];
function decodeSentencePiece(tokens: number[], options: DataOptions): string;
function countSentencePieceTokens(text: string, options: DataOptions): number;
```

### Async API (file loading - Node.js)

```typescript
// Load tokenizer from file
async function loadSentencePieceTokenizer(options: FileOptions): Promise<SentencePieceTokenizer>;

interface FileOptions {
  modelPath: string;             // Path to .model or tokenizer.json
  format?: 'protobuf' | 'json';  // Auto-detected from extension if omitted
}

// Convenience functions
async function encodeSentencePieceAsync(text: string, options: FileOptions): Promise<number[]>;
async function decodeSentencePieceAsync(tokens: number[], options: FileOptions): Promise<string>;
async function countSentencePieceTokensAsync(text: string, options: FileOptions): Promise<number>;
```

### Model Download Helper (Node.js)

```typescript
// Download model from official source with verification
async function ensureSentencePieceModel(options: DownloadOptions): Promise<string>;

interface DownloadOptions {
  tokenizer: 'gemma' | 'llama2';
  cacheDir?: string;           // Default: SENTENCEPIECE_MODEL_CACHE_DIR or ~/.cache/sentencepiece
  allowDownload?: boolean;     // Default: false. Set true to enable network download.
  verifyHash?: boolean;        // Default: true. Verify SHA-256 after download.
  authToken?: string;          // HuggingFace token for gated models (or use HF_TOKEN env var)
}

// Returns: absolute path to the cached .model file

// Environment variables (checked in order):
// - HF_TOKEN: HuggingFace auth token
// - HUGGINGFACE_HUB_TOKEN: Alternative HuggingFace token env var
// - SENTENCEPIECE_MODEL_CACHE_DIR: Custom cache directory
```

### Example Usage

```typescript
// === Primary: User-supplied model ===

// Node.js - load from file
const tokenizer = await loadSentencePieceTokenizer({
  modelPath: './models/tokenizer.model'
});
const tokens = tokenizer.encode("Hello world");
const text = tokenizer.decode(tokens);

// Browser - load from fetch
const modelBytes = await fetch('/models/tokenizer.model').then(r => r.arrayBuffer());
const tokenizer = getSentencePieceTokenizer({ modelData: modelBytes });
const tokens = tokenizer.encode("Hello world");

// === Convenience: Download from official source ===

// Check if model is already cached (default: no network)
const modelPath = await ensureSentencePieceModel({
  tokenizer: 'gemma',
  cacheDir: './models',
  // allowDownload defaults to false - will error if not cached
});
const tokenizer = await loadSentencePieceTokenizer({ modelPath });

// Explicitly enable download (one-time)
const modelPath = await ensureSentencePieceModel({
  tokenizer: 'gemma',
  cacheDir: './models',
  allowDownload: true,  // Enable network download
});

// For gated models (e.g., LLaMA), provide auth token
const modelPath = await ensureSentencePieceModel({
  tokenizer: 'llama2',
  allowDownload: true,
  authToken: process.env.HF_TOKEN,  // Or set HF_TOKEN env var
});

// Use a custom mirror (hash still verified for integrity)
const modelPath = await ensureSentencePieceModel({
  tokenizer: 'gemma',
  allowDownload: true,
  customUrl: 'https://my-internal-mirror.example.com/models/gemma-tokenizer.model',
});
```

---

## Architecture

```
src/sentencepiece/
├── index.ts                    # Public API exports
├── tokenizer.ts                # Main SentencePieceTokenizer class
├── algorithms/
│   ├── bpe.ts                  # BPE with priority queue + linked list
│   └── unigram.ts              # Unigram with trie-based Viterbi
├── normalizer/
│   ├── index.ts                # Normalizer orchestration
│   ├── precompiled.ts          # precompiled_charsmap execution
│   └── basic.ts                # NFKC + whitespace (fallback)
├── unicode.ts                  # Code point utilities
├── unicode-scripts.generated.ts # Generated Unicode script ranges (UCD Scripts.txt)
├── protobuf/
│   ├── wire.ts                 # Low-level wire format parser
│   ├── schema.ts               # SentencePiece protobuf schema types
│   └── decoder.ts              # ModelProto decoder
├── json/
│   ├── parser.ts               # HuggingFace tokenizer.json parser
│   ├── normalizer.ts           # tokenizer.json normalizer subset + compiler
│   └── validator.ts            # Config validation (scope enforcement)
├── download/
│   ├── index.ts                # Model download helper (Node.js only)
│   └── registry.ts             # Official model URLs + SHA-256 hashes
├── cache.ts                    # Parsed model caching
└── types.ts                    # TypeScript type definitions
```

**Note**: No embedded model files. Models are either user-supplied or downloaded at runtime.

---

## Phase 1: Protobuf Parser (~500-800 lines)

### 1.1 Wire Format Parser (`protobuf/wire.ts`)

```typescript
// Wire types
const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_32BIT = 5;

// Read unsigned varint (LEB128)
function readVarint(buf: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < buf.length) {
    const byte = buf[offset + bytesRead];
    bytesRead++;
    value |= (byte & 0x7F) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return { value, bytesRead };
}

// Read signed varint (zigzag decoded)
function readSignedVarint(buf: Uint8Array, offset: number): { value: number; bytesRead: number } {
  const { value: unsigned, bytesRead } = readVarint(buf, offset);
  const value = (unsigned >>> 1) ^ -(unsigned & 1);
  return { value, bytesRead };
}

// Read field tag
function readTag(buf: Uint8Array, offset: number): { fieldNumber: number; wireType: number; bytesRead: number } {
  const { value, bytesRead } = readVarint(buf, offset);
  return {
    fieldNumber: value >>> 3,
    wireType: value & 0x7,
    bytesRead,
  };
}

// Read length-delimited field
function readLengthDelimited(buf: Uint8Array, offset: number): { data: Uint8Array; bytesRead: number } {
  const { value: length, bytesRead: lenBytes } = readVarint(buf, offset);
  const data = buf.subarray(offset + lenBytes, offset + lenBytes + length);
  return { data, bytesRead: lenBytes + length };
}

// Read float (32-bit IEEE 754)
function readFloat(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  return view.getFloat32(0, true); // little-endian
}

// Read string (UTF-8)
function readString(buf: Uint8Array, offset: number): { value: string; bytesRead: number } {
  const { data, bytesRead } = readLengthDelimited(buf, offset);
  const value = new TextDecoder().decode(data);
  return { value, bytesRead };
}
```

### 1.2 Schema Types (`protobuf/schema.ts`)

```typescript
export interface ModelProto {
  pieces: SentencePiece[];
  trainerSpec?: TrainerSpec;
  normalizerSpec?: NormalizerSpec;
  selfTestData?: SelfTestData;
  denormalizerSpec?: NormalizerSpec;
}

export interface SentencePiece {
  piece: string;
  score: number;
  type: SentencePieceType;
}

export enum SentencePieceType {
  NORMAL = 1,
  UNKNOWN = 2,
  CONTROL = 3,
  USER_DEFINED = 4,
  UNUSED = 5,
  BYTE = 6,
}

export interface TrainerSpec {
  modelType: ModelType;
  vocabSize: number;
  byteFallback: boolean;
  splitDigits: boolean;
  treatWhitespaceAsSuffix: boolean;
  unkId: number;
  bosId: number;
  eosId: number;
  padId: number;
  unkPiece: string;
  bosPiece: string;
  eosPiece: string;
  padPiece: string;
  maxSentencepieceLength: number;
}

export enum ModelType {
  UNIGRAM = 1,
  BPE = 2,
  WORD = 3,
  CHAR = 4,
}

export interface NormalizerSpec {
  name: string;
  precompiledCharsmap: Uint8Array;  // CRITICAL: must be executed
  addDummyPrefix: boolean;
  removeExtraWhitespaces: boolean;
  escapeWhitespaces: boolean;
  whitespaceReplacement: string;    // Metaspace replacement char (default: '▁')
}

export interface SelfTestData {
  samples: Array<{ input: string; expected: string }>;
}
```

### 1.3 ModelProto Decoder (`protobuf/decoder.ts`)

```typescript
import { readTag, readLengthDelimited, readVarint, readFloat, readString } from './wire.js';
import type { ModelProto, SentencePiece, TrainerSpec, NormalizerSpec, SentencePieceType, ModelType } from './schema.js';

export function parseModelProto(buffer: Uint8Array): ModelProto {
  const model: ModelProto = { pieces: [] };
  let offset = 0;

  while (offset < buffer.length) {
    const tag = readTag(buffer, offset);
    offset += tag.bytesRead;

    switch (tag.fieldNumber) {
      case 1: { // pieces (repeated SentencePiece)
        const { data, bytesRead } = readLengthDelimited(buffer, offset);
        model.pieces.push(parseSentencePiece(data));
        offset += bytesRead;
        break;
      }
      case 2: { // trainer_spec
        const { data, bytesRead } = readLengthDelimited(buffer, offset);
        model.trainerSpec = parseTrainerSpec(data);
        offset += bytesRead;
        break;
      }
      case 3: { // normalizer_spec
        const { data, bytesRead } = readLengthDelimited(buffer, offset);
        model.normalizerSpec = parseNormalizerSpec(data);
        offset += bytesRead;
        break;
      }
      case 5: { // denormalizer_spec
        const { data, bytesRead } = readLengthDelimited(buffer, offset);
        model.denormalizerSpec = parseNormalizerSpec(data);
        offset += bytesRead;
        break;
      }
      default:
        // Skip unknown fields
        offset += skipField(buffer, offset, tag.wireType);
    }
  }

  return model;
}

function parseSentencePiece(buffer: Uint8Array): SentencePiece {
  const piece: SentencePiece = { piece: '', score: 0, type: 1 };
  let offset = 0;

  while (offset < buffer.length) {
    const tag = readTag(buffer, offset);
    offset += tag.bytesRead;

    switch (tag.fieldNumber) {
      case 1: { // piece
        const { value, bytesRead } = readString(buffer, offset);
        piece.piece = value;
        offset += bytesRead;
        break;
      }
      case 2: { // score
        piece.score = readFloat(buffer, offset);
        offset += 4;
        break;
      }
      case 3: { // type
        const { value, bytesRead } = readVarint(buffer, offset);
        piece.type = value as SentencePieceType;
        offset += bytesRead;
        break;
      }
      default:
        offset += skipField(buffer, offset, tag.wireType);
    }
  }

  return piece;
}

// Similar implementations for parseTrainerSpec, parseNormalizerSpec...
```

---

## Phase 2: Normalizer with precompiled_charsmap (~300-400 lines)

### 2.1 precompiled_charsmap Format

The `precompiled_charsmap` is a binary blob encoding character-to-character mappings used by the `nmt_nfkc` and similar normalizers. Without executing this, parity will fail for many models.

**Format** (reverse-engineered from `spm_precompiled`):
- Header: 4-byte trie offset
- Trie structure for prefix matching
- Replacement strings

Reference: [huggingface/spm_precompiled](https://github.com/huggingface/tokenizers/blob/main/tokenizers/src/normalizers/precompiled.rs)

```typescript
// normalizer/precompiled.ts

interface PrecompiledCharmap {
  trie: CharMapTrie;
  replacements: Map<number, string>;
}

class CharMapTrie {
  // Trie node for efficient prefix matching
  children: Map<number, CharMapTrie> = new Map();
  replacement?: string;

  lookup(codePoints: number[], start: number): { consumed: number; replacement: string } | null {
    let node: CharMapTrie = this;
    let lastMatch: { consumed: number; replacement: string } | null = null;

    for (let i = start; i < codePoints.length; i++) {
      const cp = codePoints[i];
      const child = node.children.get(cp);
      if (!child) break;
      node = child;
      if (node.replacement !== undefined) {
        lastMatch = { consumed: i - start + 1, replacement: node.replacement };
      }
    }

    return lastMatch;
  }
}

function parsePrecompiledCharsmap(data: Uint8Array): PrecompiledCharmap {
  // Parse the binary trie structure
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const trieOffset = view.getUint32(0, true);

  // Build trie from binary data
  const trie = new CharMapTrie();
  // ... parsing logic based on spm_precompiled format

  return { trie, replacements: new Map() };
}

function applyPrecompiledCharsmap(
  text: string,
  charmap: PrecompiledCharmap
): string {
  const codePoints = [...text].map(c => c.codePointAt(0)!);
  const result: string[] = [];
  let i = 0;

  while (i < codePoints.length) {
    const match = charmap.trie.lookup(codePoints, i);
    if (match) {
      result.push(match.replacement);
      i += match.consumed;
    } else {
      result.push(String.fromCodePoint(codePoints[i]));
      i++;
    }
  }

  return result.join('');
}
```

### 2.2 Full Normalizer (`normalizer/index.ts`)

```typescript
import { parsePrecompiledCharsmap, applyPrecompiledCharsmap } from './precompiled.js';
import type { NormalizerSpec } from '../protobuf/schema.js';

export class Normalizer {
  private readonly precompiledCharmap: PrecompiledCharmap | null;
  private readonly denormalizerCharmap: PrecompiledCharmap | null;
  private readonly addDummyPrefix: boolean;
  private readonly removeExtraWhitespaces: boolean;
  private readonly escapeWhitespaces: boolean;
  private readonly whitespaceReplacement: string;

  constructor(spec: NormalizerSpec, denormalizerSpec?: NormalizerSpec) {
    // Parse precompiled charmap if present (CRITICAL for parity)
    if (spec.precompiledCharsmap && spec.precompiledCharsmap.length > 0) {
      this.precompiledCharmap = parsePrecompiledCharsmap(spec.precompiledCharsmap);
    } else {
      this.precompiledCharmap = null;
    }

    // Parse denormalizer charmap if present (CRITICAL for decode parity)
    if (denormalizerSpec?.precompiledCharsmap && denormalizerSpec.precompiledCharsmap.length > 0) {
      this.denormalizerCharmap = parsePrecompiledCharsmap(denormalizerSpec.precompiledCharsmap);
    } else {
      this.denormalizerCharmap = null;
    }

    this.addDummyPrefix = spec.addDummyPrefix ?? true;
    this.removeExtraWhitespaces = spec.removeExtraWhitespaces ?? true;
    this.escapeWhitespaces = spec.escapeWhitespaces ?? true;
    // Metaspace replacement character (default: ▁ U+2581)
    this.whitespaceReplacement = spec.whitespaceReplacement ?? '\u2581';
  }

  normalize(text: string): string {
    let result = text;

    // 1. Apply precompiled charmap (if present)
    if (this.precompiledCharmap) {
      result = applyPrecompiledCharsmap(result, this.precompiledCharmap);
    } else {
      // Fallback: basic NFKC normalization
      result = result.normalize('NFKC');
    }

    // 2. Remove extra whitespaces
    if (this.removeExtraWhitespaces) {
      result = result.replace(/\s+/g, ' ').trim();
    }

    // 3. Add dummy prefix (space at start)
    if (this.addDummyPrefix && result.length > 0) {
      result = ' ' + result;
    }

    // 4. Escape whitespaces (replace ' ' with configured replacement)
    if (this.escapeWhitespaces) {
      result = result.replace(/ /g, this.whitespaceReplacement);
    }

    return result;
  }

  // Reverse normalization for decoding
  denormalize(text: string): string {
    let result = text;

    // Replace configured whitespace token with space
    result = result.replace(new RegExp(escapeRegExp(this.whitespaceReplacement), 'g'), ' ');

    // Remove dummy prefix
    if (this.addDummyPrefix && result.startsWith(' ')) {
      result = result.slice(1);
    }

    // Apply denormalizer charmap (if present)
    if (this.denormalizerCharmap) {
      result = applyPrecompiledCharsmap(result, this.denormalizerCharmap);
    }

    return result;
  }
}

// Helper to escape special regex characters in replacement string
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

---

## Phase 3: BPE Algorithm (~400-500 lines)

### 3.1 BPE Merge Ordering

**Critical**: SentencePiece BPE uses piece scores to determine merge order.

**Merge Priority Rules**:
1. **Lower score = higher priority** (merge first)
   - In SentencePiece BPE, scores are typically negative log probabilities or merge ranks
   - Lower score means "more common" or "earlier in merge order"
2. **Tie-breaker**: When scores are equal, prefer **lower piece ID** (earlier in vocab)
   - This ensures deterministic output
3. **Position tie-breaker**: If piece IDs are also equal (same merge), prefer **leftmost position**

```typescript
// Merge candidate comparison (for min-heap)
function compareMergeCandidates(a: MergeCandidate, b: MergeCandidate): number {
  // 1. Lower score = higher priority
  if (a.score !== b.score) return a.score - b.score;
  // 2. Lower piece ID = higher priority (deterministic tie-break)
  if (a.mergedPieceId !== b.mergedPieceId) return a.mergedPieceId - b.mergedPieceId;
  // 3. Leftmost position = higher priority
  return a.leftPosition - b.leftPosition;
}
```

### 3.2 Efficient BPE with Priority Queue + Linked List

**Solution**: Use SentencePiece's actual approach:
1. Score candidate merges using the **score of the merged piece itself**
2. Maintain candidates in a **priority queue** (min-heap by score + tie-breakers)
3. Use a **doubly-linked list** for O(1) merge operations

```typescript
// algorithms/bpe.ts

import type { SentencePiece, SentencePieceType, TrainerSpec } from '../protobuf/schema.js';

interface LinkedNode {
  piece: string;
  prev: LinkedNode | null;
  next: LinkedNode | null;
  deleted: boolean;
  position: number;  // Original position in sequence (for tie-breaking)
}

interface MergeCandidate {
  score: number;           // Score of the merged piece
  mergedPieceId: number;   // ID of the merged piece (for tie-breaking)
  leftPosition: number;    // Position of left node (for tie-breaking)
  left: LinkedNode;
  right: LinkedNode;
}

// Min-heap priority queue with proper comparison
class MergeHeap {
  private heap: MergeCandidate[] = [];

  push(candidate: MergeCandidate): void {
    this.heap.push(candidate);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): MergeCandidate | undefined {
    if (this.heap.length === 0) return undefined;
    const result = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return result;
  }

  get size(): number {
    return this.heap.length;
  }

  private compare(a: MergeCandidate, b: MergeCandidate): number {
    if (a.score !== b.score) return a.score - b.score;
    if (a.mergedPieceId !== b.mergedPieceId) return a.mergedPieceId - b.mergedPieceId;
    return a.leftPosition - b.leftPosition;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.compare(this.heap[parent], this.heap[idx]) <= 0) break;
      [this.heap[parent], this.heap[idx]] = [this.heap[idx], this.heap[parent]];
      idx = parent;
    }
  }

  private bubbleDown(idx: number): void {
    while (true) {
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      let smallest = idx;

      if (left < this.heap.length && this.compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < this.heap.length && this.compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === idx) break;

      [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
      idx = smallest;
    }
  }
}

export class BPEEncoder {
  private readonly vocab: Map<string, number>;         // piece → id
  private readonly vocabReverse: Map<number, string>;  // id → piece
  private readonly pieceScores: Map<string, number>;   // piece → score (for merge priority)
  private readonly byteFallback: boolean;
  private readonly byteTokenIds: Map<number, number>;  // byte value → token id
  private readonly unkId: number;

  constructor(pieces: SentencePiece[], trainerSpec?: TrainerSpec) {
    this.vocab = new Map();
    this.vocabReverse = new Map();
    this.pieceScores = new Map();
    this.byteTokenIds = new Map();
    this.byteFallback = trainerSpec?.byteFallback ?? false;
    this.unkId = trainerSpec?.unkId ?? 0;

    for (let id = 0; id < pieces.length; id++) {
      const { piece, score, type } = pieces[id];
      this.vocab.set(piece, id);
      this.vocabReverse.set(id, piece);
      this.pieceScores.set(piece, score);

      // Track byte fallback tokens
      if (type === 6) { // BYTE type
        const match = piece.match(/^<0x([0-9A-Fa-f]{2})>$/);
        if (match) {
          this.byteTokenIds.set(parseInt(match[1], 16), id);
        }
      }
    }
  }

  encode(text: string): number[] {
    if (text.length === 0) return [];

    // Build linked list of initial symbols
    const { head, nodes } = this.buildInitialList(text);
    if (!head) return [];

    // Build initial merge candidates
    const heap = new MergeHeap();
    this.addMergeCandidates(head, heap);

    // Process merges in priority order
    while (heap.size > 0) {
      const candidate = heap.pop()!;

      // Skip if either node was deleted
      if (candidate.left.deleted || candidate.right.deleted) continue;

      // Skip if nodes are no longer adjacent
      if (candidate.left.next !== candidate.right) continue;

      // Verify the merged piece still has the expected score
      const merged = candidate.left.piece + candidate.right.piece;
      const currentScore = this.pieceScores.get(merged);
      if (currentScore === undefined || currentScore !== candidate.score) continue;

      // Perform the merge
      candidate.left.piece = merged;
      candidate.left.next = candidate.right.next;
      if (candidate.right.next) {
        candidate.right.next.prev = candidate.left;
      }
      candidate.right.deleted = true;

      // Add new merge candidates for the merged node
      this.addMergeCandidatesForNode(candidate.left, heap);
    }

    // Convert linked list to token IDs
    return this.linkedListToTokenIds(head);
  }

  private buildInitialList(text: string): { head: LinkedNode | null; nodes: LinkedNode[] } {
    const nodes: LinkedNode[] = [];
    let head: LinkedNode | null = null;
    let prev: LinkedNode | null = null;

    // Iterate over code points
    for (const char of text) {
      let pieces: string[];

      if (this.vocab.has(char)) {
        pieces = [char];
      } else if (this.byteFallback) {
        // Split into byte tokens
        const bytes = new TextEncoder().encode(char);
        pieces = Array.from(bytes).map(b =>
          `<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`
        );
      } else {
        // Unknown token
        pieces = [this.vocabReverse.get(this.unkId) ?? '<unk>'];
      }

      for (const piece of pieces) {
        const node: LinkedNode = { piece, prev, next: null, deleted: false };
        if (prev) prev.next = node;
        if (!head) head = node;
        prev = node;
        nodes.push(node);
      }
    }

    return { head, nodes };
  }

  private addMergeCandidates(head: LinkedNode, heap: MergeHeap): void {
    let node = head;
    while (node && node.next) {
      this.addMergeCandidateForPair(node, node.next, heap);
      node = node.next;
    }
  }

  private addMergeCandidatesForNode(node: LinkedNode, heap: MergeHeap): void {
    // Add candidate with previous node
    if (node.prev && !node.prev.deleted) {
      this.addMergeCandidateForPair(node.prev, node, heap);
    }
    // Add candidate with next node
    if (node.next && !node.next.deleted) {
      this.addMergeCandidateForPair(node, node.next, heap);
    }
  }

  private addMergeCandidateForPair(left: LinkedNode, right: LinkedNode, heap: MergeHeap): void {
    const merged = left.piece + right.piece;
    const score = this.pieceScores.get(merged);
    if (score !== undefined) {
      heap.push({ score, left, right });
    }
  }

  private linkedListToTokenIds(head: LinkedNode | null): number[] {
    const ids: number[] = [];
    let node = head;

    while (node) {
      if (!node.deleted) {
        const id = this.vocab.get(node.piece);
        if (id !== undefined) {
          ids.push(id);
        } else {
          // Should not happen if encoding was correct
          ids.push(this.unkId);
        }
      }
      node = node.next;
    }

    return ids;
  }

  decode(tokens: number[]): string {
    const pieces: string[] = [];

    for (const id of tokens) {
      const piece = this.vocabReverse.get(id);
      if (piece === undefined) {
        throw new Error(`Unknown token ID: ${id}`);
      }
      pieces.push(piece);
    }

    // Join pieces
    let text = pieces.join('');

    // Decode byte tokens: <0xXX> → actual bytes
    text = this.decodeByteTokens(text);

    return text;
  }

  private decodeByteTokens(text: string): string {
    // Find all byte token patterns and decode them
    const bytePattern = /<0x([0-9A-Fa-f]{2})>/g;
    const parts: (string | number)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = bytePattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      parts.push(parseInt(match[1], 16));
      lastIndex = bytePattern.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    // Merge consecutive bytes and decode as UTF-8
    const result: string[] = [];
    let byteBuffer: number[] = [];

    for (const part of parts) {
      if (typeof part === 'number') {
        byteBuffer.push(part);
      } else {
        if (byteBuffer.length > 0) {
          result.push(new TextDecoder().decode(new Uint8Array(byteBuffer)));
          byteBuffer = [];
        }
        result.push(part);
      }
    }

    if (byteBuffer.length > 0) {
      result.push(new TextDecoder().decode(new Uint8Array(byteBuffer)));
    }

    return result.join('');
  }
}
```

### 3.3 JSON-BPE (Merges-Based) Algorithm

**Important**: HuggingFace `tokenizer.json` BPE is **NOT** the same as SentencePiece `.model` BPE.

| Aspect | SentencePiece BPE (.model) | JSON-BPE (tokenizer.json) |
|--------|---------------------------|---------------------------|
| Merge priority | Piece **score** (lower = merge first) | **Position in merges[]** array (earlier = merge first) |
| Data structure | `pieces[]` with scores | `vocab{}` + `merges[]` |
| Algorithm | Score-based priority queue | Merge-rule based iteration |

#### JSON-BPE Data Format

```typescript
// tokenizer.json BPE model structure
interface HFBPEModel {
  type: 'BPE';
  vocab: Record<string, number>;  // piece → token ID
  merges: string[];               // ["a b", "ab c", ...] - merge rules in priority order
  unk_token?: string;
  byte_fallback?: boolean;
  continuing_subword_prefix?: string;  // e.g., "##" for BERT-style, prepended to non-first tokens
  end_of_word_suffix?: string;         // e.g., "</w>" for GPT-style, appended to last token
}

// Example merges array (earlier = higher priority):
// ["Ġ t", "Ġt he", "Ġthe Ġ", "i n", "e r", ...]
// Meaning: "Ġ" + "t" → "Ġt" has highest priority

// Subword prefix/suffix examples:
// - BERT: continuing_subword_prefix="##" → "playing" = ["play", "##ing"]
// - Some models: end_of_word_suffix="</w>" → "word" = ["wor", "d</w>"]
//
// IMPORTANT: prefix/suffix are applied PER WORD, not globally!
// The Metaspace pre-tokenizer splits input into words first.
```

#### Added Tokens Matching (Required for Both BPE and Unigram)

Before model encoding, we must match "added tokens" (special tokens defined in `tokenizer.json`) as atomic units. These are matched via longest-match and never broken by the model encoder.

```typescript
// algorithms/added-tokens.ts

export interface AddedToken {
  id: number;
  content: string;
  special: boolean;
  lstrip?: boolean;        // Strip left whitespace before matching (include it in the token match)
  rstrip?: boolean;        // Strip right whitespace after matching (include it in the token match)
  single_word?: boolean;   // Only match as a complete word
  normalized?: boolean;    // Match against normalized text + normalized token content
}

export interface TextNormalizer {
  normalize(text: string): string;
}

export type AddedTokenSegment =
  | { type: 'added'; id: number }
  | { type: 'text'; text: string };

export class AddedTokenMatcher {
  /**
   * Matches follow HuggingFace Tokenizers semantics:
   * - Leftmost-longest match across the token set
   * - `single_word`, `lstrip`, `rstrip` enforced
   * - `normalized=true` tokens are matched on normalized text, with token content normalized too
   *
   * Implementation detail: We replicate HF's two-phase extraction:
   * 1) Extract `normalized=false` tokens from the original text
   * 2) Normalize remaining text segments, then extract `normalized=true` tokens from those segments
   */
  private readonly addedTokensById: Map<number, AddedToken>;
  private readonly normalizer?: TextNormalizer;
  private readonly rawTrie: TrieNode;
  private readonly normalizedTrie: TrieNode;
  private readonly hasNormalizedTokens: boolean;

  constructor(addedTokens: AddedToken[], options?: { normalizer?: TextNormalizer }) {
    this.normalizer = options?.normalizer;
    this.addedTokensById = new Map(addedTokens.map(t => [t.id, t]));

    const rawTokens = addedTokens.filter(t => !t.normalized);
    const normalizedTokens = addedTokens.filter(t => t.normalized);
    this.hasNormalizedTokens = normalizedTokens.length > 0;

    this.rawTrie = buildTrie(rawTokens, t => t.content);
    this.normalizedTrie = buildTrie(normalizedTokens, t => {
      const content = t.content;
      return this.normalizer ? this.normalizer.normalize(content) : content;
    });
  }

  getAddedTokenById(id: number): AddedToken | undefined {
    return this.addedTokensById.get(id);
  }

  /**
   * Returns segments in *encoding order*:
   * - `{ type: 'added', id }` for added tokens
   * - `{ type: 'text', text }` for text that should go through model encoding
   *
   * Note: Returned `{ type: 'text' }` segments are normalized (if a normalizer is provided),
   * because HF matches `normalized=true` tokens against the normalized view.
   */
  extractAndNormalize(text: string): AddedTokenSegment[] {
    // 1) Split on non-normalized tokens in the original text
    const firstPass = splitOnTrie(text, this.rawTrie);

    // If there are no normalized=true tokens, do not normalize the remaining text segments here.
    // This avoids accidentally changing the model input when a normalizer is provided for other reasons.
    if (!this.hasNormalizedTokens) {
      return firstPass;
    }

    // 2) Normalize the remaining text segments
    const normalizedSegments: AddedTokenSegment[] = firstPass.map(seg => {
      if (seg.type !== 'text') return seg;
      return { type: 'text', text: this.normalizer ? this.normalizer.normalize(seg.text) : seg.text };
    });

    // 3) Split on normalized tokens in the normalized segments
    const finalSegments: AddedTokenSegment[] = [];
    for (const seg of normalizedSegments) {
      if (seg.type !== 'text') {
        finalSegments.push(seg);
        continue;
      }
      finalSegments.push(...splitOnTrie(seg.text, this.normalizedTrie));
    }

    return finalSegments;
  }
}

type TrieNode = Map<string, TrieNode> & { __terminal__?: AddedToken };

function buildTrie(tokens: AddedToken[], getPattern: (t: AddedToken) => string): TrieNode {
  const root = new Map() as TrieNode;

  // Deterministic insertion order matters for tie-breaking when patterns are equal length.
  // Prefer lowest ID, then stable order.
  const sorted = [...tokens].sort((a, b) => a.id - b.id);

  for (const token of sorted) {
    const pattern = getPattern(token);
    if (!pattern) continue;

    let node: TrieNode = root;
    for (const ch of pattern) {
      const next = node.get(ch) ?? (new Map() as TrieNode);
      node.set(ch, next);
      node = next;
    }
    node.__terminal__ = token;
  }

  return root;
}

function splitOnTrie(text: string, trie: TrieNode): AddedTokenSegment[] {
  const out: AddedTokenSegment[] = [];
  let cursor = 0;
  let i = 0;

  while (i < text.length) {
    const match = findLongestMatchAt(text, i, trie);
    if (!match) {
      i++;
      continue;
    }

    // Enforce single_word (Unicode-aware approximation)
    if (match.token.single_word && !isSingleWordBoundary(text, match.start, match.end)) {
      i++;
      continue;
    }

    // Apply lstrip/rstrip by expanding match to include adjacent whitespace
    let start = match.start;
    let end = match.end;

    if (match.token.lstrip) {
      start = Math.max(cursor, spaceLeftmostAtEnd(text, cursor, start));
    }
    if (match.token.rstrip) {
      end = end + spaceRightmostAtStart(text, end);
    }

    if (cursor < start) {
      out.push({ type: 'text', text: text.slice(cursor, start) });
    }
    out.push({ type: 'added', id: match.token.id });
    cursor = end;
    i = end;
  }

  if (cursor < text.length) {
    out.push({ type: 'text', text: text.slice(cursor) });
  }

  return out;
}

function findLongestMatchAt(text: string, start: number, trie: TrieNode): { token: AddedToken; start: number; end: number } | null {
  let node: TrieNode | undefined = trie;
  let best: { token: AddedToken; end: number } | null = null;

  for (let i = start; i < text.length; i++) {
    node = node.get(text[i]);
    if (!node) break;
    if (node.__terminal__) {
      best = { token: node.__terminal__, end: i + 1 };
    }
  }

  return best ? { token: best.token, start, end: best.end } : null;
}

function isSingleWordBoundary(text: string, start: number, end: number): boolean {
  const before = start === 0 ? '' : text[start - 1];
  const after = end >= text.length ? '' : text[end];
  const startOk = start === 0 || !isWordChar(before);
  const endOk = end === text.length || !isWordChar(after);
  return startOk && endOk;
}

function isWordChar(ch: string): boolean {
  // HF uses Unicode-aware `\\w`. JS `\\w` is ASCII-only, so approximate via Unicode properties.
  return /[\p{L}\p{N}_]/u.test(ch);
}

function spaceLeftmostAtEnd(text: string, from: number, to: number): number {
  let i = to;
  while (i > from && /\s/u.test(text[i - 1])) i--;
  return i;
}

function spaceRightmostAtStart(text: string, start: number): number {
  let i = start;
  while (i < text.length && /\s/u.test(text[i])) i++;
  return i - start;
}
```

#### JSON-BPE Encoder Implementation

```typescript
// algorithms/json-bpe.ts

interface MergeRule {
  left: string;
  right: string;
  result: string;
  priority: number;  // Index in merges[] array (lower = higher priority)
}

export class JsonBPEEncoder {
  private readonly vocab: Map<string, number>;         // piece → id
  private readonly vocabReverse: Map<number, string>;  // id → piece
  private readonly mergeRules: Map<string, MergeRule>; // "left right" → rule
  private readonly normalizer: TextNormalizer | null;
  private readonly byteFallback: boolean;
  private readonly unkId: number;
  private readonly continuingSubwordPrefix: string | null;
  private readonly endOfWordSuffix: string | null;
  private readonly whitespaceReplacement: string;      // Metaspace replacement
  private readonly addPrefixSpace: boolean;            // Metaspace add_prefix_space
  private readonly addedTokenMatcher: AddedTokenMatcher | null;
  private readonly addedTokensById: Map<number, AddedToken>;

  constructor(
    vocab: Record<string, number>,
    merges: string[],
    options: {
      normalizer?: TextNormalizer;       // tokenizer.json normalizer pipeline (subset)
      byteFallback?: boolean;
      unkId?: number;
      continuingSubwordPrefix?: string;
      endOfWordSuffix?: string;
      whitespaceReplacement?: string;    // Metaspace replacement
      addPrefixSpace?: boolean;          // Metaspace add_prefix_space
      addedTokens?: AddedToken[];
    } = {}
  ) {
    this.vocab = new Map(Object.entries(vocab));
    this.vocabReverse = new Map(Object.entries(vocab).map(([k, v]) => [v, k]));
    this.normalizer = options.normalizer ?? null;
    this.byteFallback = options.byteFallback ?? false;
    this.unkId = options.unkId ?? 0;
    this.continuingSubwordPrefix = options.continuingSubwordPrefix ?? null;
    this.endOfWordSuffix = options.endOfWordSuffix ?? null;
    this.whitespaceReplacement = options.whitespaceReplacement ?? '\u2581';
    this.addPrefixSpace = options.addPrefixSpace ?? true;
    this.addedTokensById = new Map((options.addedTokens ?? []).map(t => [t.id, t]));
    this.addedTokenMatcher = options.addedTokens?.length
      ? new AddedTokenMatcher(options.addedTokens, { normalizer: this.normalizer ?? undefined })
      : null;

    // Parse merges into lookup map
    this.mergeRules = new Map();
    for (let i = 0; i < merges.length; i++) {
      const [left, right] = merges[i].split(' ');
      const result = left + right;
      this.mergeRules.set(merges[i], { left, right, result, priority: i });
    }
  }

  encode(text: string): number[] {
    if (text.length === 0) return [];

    // Step 0: Match added tokens first (if any) with HF semantics:
    // - normalized=false matches on raw text
    // - normalized=true matches on normalized view of the text
    if (this.addedTokenMatcher) {
      const segments = this.addedTokenMatcher.extractAndNormalize(text);
      const result: number[] = [];
      for (const segment of segments) {
        if (segment.type === 'added') {
          result.push(segment.id);
        } else {
          // segment.text is already normalized if a normalizer is configured
          result.push(...this.encodeText(segment.text));
        }
      }
      return result;
    }

    // No added tokens: still normalize if a normalizer exists
    const normalized = this.normalizer ? this.normalizer.normalize(text) : text;
    return this.encodeText(normalized);
  }

  private encodeText(text: string): number[] {
    if (text.length === 0) return [];

    // Step 1: Pre-tokenize with Metaspace (split into words)
    const words = this.preTokenize(text);

    // Step 2: For each word, run BPE and apply prefix/suffix
    const allTokenIds: number[] = [];
    for (const word of words) {
      const wordTokens = this.encodeWord(word);
      allTokenIds.push(...wordTokens);
    }

    return allTokenIds;
  }

  /**
   * Metaspace pre-tokenization (SentencePiece-style):
   * - Preserves whitespace *counts* (multiple spaces/newlines/tabs)
   * - Attaches whitespace runs as prefix markers on the following segment
   * - Optionally adds a prefix marker to the first segment (add_prefix_space)
   *
   * This is required for parity with many `tokenizer.json` BPE models that rely on tokens like "▁word"
   * and may also contain explicit pieces for repeated whitespace like "▁▁".
   */
  private preTokenize(text: string): string[] {
    const segments: string[] = [];
    let pendingPrefix = '';

    // add_prefix_space=true means: if the input doesn't start with whitespace,
    // act as if there was a single leading whitespace.
    if (this.addPrefixSpace && text.length > 0 && !/^\s/u.test(text)) {
      pendingPrefix += this.whitespaceReplacement;
    }

    for (const part of text.split(/(\s+)/u)) {
      if (!part) continue;

      if (/^\s+$/u.test(part)) {
        pendingPrefix += this.replacementMarkersForWhitespace(part);
        continue;
      }

      segments.push(pendingPrefix + part);
      pendingPrefix = '';
    }

    // Trailing whitespace becomes its own segment (allows encoding "▁▁" etc)
    if (pendingPrefix) {
      segments.push(pendingPrefix);
    }

    return segments.filter(s => s.length > 0);
  }

  private replacementMarkersForWhitespace(whitespace: string): string {
    let out = '';
    for (const _ of whitespace) out += this.whitespaceReplacement;
    return out;
  }

  /**
   * Encode a single word (already pre-tokenized with replacement prefix)
   */
  private encodeWord(word: string): number[] {
    // Step 1: Split into initial tokens (characters or byte fallback)
    let tokens = this.splitIntoInitialTokens(word);

    // Step 2: Iteratively apply merges until no more can be applied
    let changed = true;
    while (changed) {
      changed = false;
      let bestMerge: { index: number; rule: MergeRule } | null = null;

      // Find the highest-priority applicable merge
      for (let i = 0; i < tokens.length - 1; i++) {
        const pairKey = `${tokens[i]} ${tokens[i + 1]}`;
        const rule = this.mergeRules.get(pairKey);

        if (rule && (!bestMerge || rule.priority < bestMerge.rule.priority)) {
          bestMerge = { index: i, rule };
        }
      }

      // Apply the best merge if found
      if (bestMerge) {
        const { index, rule } = bestMerge;
        tokens = [
          ...tokens.slice(0, index),
          rule.result,
          ...tokens.slice(index + 2),
        ];
        changed = true;
      }
    }

    // Step 3: Apply subword prefix/suffix transformations (PER WORD)
    // Skip transforms for "whitespace-only" segments (e.g., trailing "▁▁") so we don't append </w>.
    if (!this.isWhitespaceOnlySegment(word)) {
      tokens = this.applySubwordTransforms(tokens);
    }

    // Step 4: Convert tokens to IDs
    return tokens.map(t => this.vocab.get(t) ?? this.unkId);
  }

  private isWhitespaceOnlySegment(segment: string): boolean {
    // True if the segment is solely repetition(s) of the Metaspace replacement string.
    // Note: replacement can be multi-character in tokenizer.json.
    if (!segment) return true;
    if (!this.whitespaceReplacement) return false;
    return segment.split(this.whitespaceReplacement).join('') === '';
  }

  /**
   * Apply prefix/suffix WITHIN a single word's tokens
   */
  private applySubwordTransforms(tokens: string[]): string[] {
    if (!this.continuingSubwordPrefix && !this.endOfWordSuffix) {
      return tokens;  // No transformations needed
    }

    return tokens.map((token, index) => {
      let transformed = token;

      // For tokens at index > 0 WITHIN THIS WORD: prepend continuing_subword_prefix
      if (this.continuingSubwordPrefix && index > 0) {
        transformed = this.continuingSubwordPrefix + transformed;
      }

      // For the last token WITHIN THIS WORD: append end_of_word_suffix
      if (this.endOfWordSuffix && index === tokens.length - 1) {
        transformed = transformed + this.endOfWordSuffix;
      }

      return transformed;
    });
  }

  private splitIntoInitialTokens(text: string): string[] {
    const tokens: string[] = [];

    for (const char of text) {
      if (this.vocab.has(char)) {
        tokens.push(char);
      } else if (this.byteFallback) {
        // Encode unknown char as byte tokens
        const bytes = new TextEncoder().encode(char);
        for (const byte of bytes) {
          const byteToken = `<0x${byte.toString(16).toUpperCase().padStart(2, '0')}>`;
          tokens.push(byteToken);
        }
      } else {
        // Use UNK token representation
        tokens.push(this.vocabReverse.get(this.unkId) ?? '<unk>');
      }
    }

    return tokens;
  }

  decode(tokenIds: number[]): string {
    const pieces: string[] = [];

    for (const id of tokenIds) {
      // Added tokens can have IDs outside the base vocab. Prefer them when present.
      const added = this.addedTokensById.get(id);
      if (added) {
        pieces.push(added.content);
        continue;
      }

      const piece = this.vocabReverse.get(id);
      if (piece === undefined) throw new Error(`Unknown token ID: ${id}`);
      pieces.push(piece);
    }

    let text = pieces.join('');
    text = this.decodeByteTokens(text);
    return text;
  }

  private decodeByteTokens(text: string): string {
    // Same as SentencePiece BPE decoder
    // ... (see BPEEncoder.decodeByteTokens)
  }
}
```

#### Performance Optimization: Merge Priority Index

The naive algorithm above is O(n² × m) where n = token count, m = merge count. For large vocabularies, use a priority-indexed approach:

```typescript
// Optimized: Pre-index merges by left token for faster lookup
private readonly mergesByLeft: Map<string, MergeRule[]>;  // left → rules sorted by priority

constructor(vocab: Record<string, number>, merges: string[]) {
  // ... base setup ...

  // Build left-token index
  this.mergesByLeft = new Map();
  for (const rule of this.mergeRules.values()) {
    const existing = this.mergesByLeft.get(rule.left) ?? [];
    existing.push(rule);
    this.mergesByLeft.set(rule.left, existing);
  }
  // Sort each list by priority
  for (const rules of this.mergesByLeft.values()) {
    rules.sort((a, b) => a.priority - b.priority);
  }
}

// Then in encode(): only check merges where left token matches
```

#### API Integration

```typescript
// The tokenizer factory detects JSON-BPE and uses the correct encoder:

function getSentencePieceTokenizer(options: DataOptions): SentencePieceTokenizer {
  const config = parseConfig(options);

  if (config.source === 'json' && config.modelType === 'BPE') {
    // JSON-BPE: use merges-based encoder
    return new JsonBPETokenizer(config.vocab, config.merges, {
      normalizer: config.normalizer,
      // Metaspace pre_tokenizer config
      whitespaceReplacement: config.metaspace?.replacement,
      addPrefixSpace: config.metaspace?.addPrefixSpace,
      // Added tokens (HF semantics)
      addedTokens: config.addedTokens,
      // Model options
      unkId: config.unkId,
      byteFallback: config.byteFallback,
      continuingSubwordPrefix: config.continuingSubwordPrefix,
      endOfWordSuffix: config.endOfWordSuffix,
    });
  } else if (config.modelType === 'BPE') {
    // SentencePiece BPE: use score-based encoder
    return new SentencePieceBPETokenizer(config.pieces, config.trainerSpec);
  } else {
    // Unigram
    return new UnigramTokenizer(config.pieces, config.trainerSpec, {
      normalizer: config.normalizer,
      metaspace: config.metaspace,
      addedTokens: config.addedTokens,
      unkId: config.unkId,
    });
  }
}
```

---

## Phase 4: Unigram Algorithm with Trie (~400-500 lines)

### 4.1 Trie-Based Candidate Lookup

**Problem**: The naive O(n × maxLen) loop checking each substring is slow.

**Solution**: Use a **trie** for O(maxLen) prefix-based candidate lookup per position.

```typescript
// algorithms/unigram.ts

import type { SentencePiece, TrainerSpec } from '../protobuf/schema.js';

// Trie node for vocabulary lookup
class VocabTrie {
  children: Map<string, VocabTrie> = new Map();  // keyed by code point
  pieceId?: number;
  score?: number;

  insert(piece: string, id: number, score: number): void {
    let node: VocabTrie = this;
    for (const char of piece) {
      let child = node.children.get(char);
      if (!child) {
        child = new VocabTrie();
        node.children.set(char, child);
      }
      node = child;
    }
    node.pieceId = id;
    node.score = score;
  }

  // Find all pieces that are prefixes of text starting at given code point index
  findPrefixes(codePoints: string[], start: number): Array<{ id: number; score: number; length: number }> {
    const results: Array<{ id: number; score: number; length: number }> = [];
    let node: VocabTrie = this;

    for (let i = start; i < codePoints.length; i++) {
      const char = codePoints[i];
      const child = node.children.get(char);
      if (!child) break;
      node = child;

      if (node.pieceId !== undefined && node.score !== undefined) {
        results.push({ id: node.pieceId, score: node.score, length: i - start + 1 });
      }
    }

    return results;
  }
}

export class UnigramEncoder {
  private readonly trie: VocabTrie;
  private readonly vocabReverse: Map<number, string>;
  private readonly byteFallback: boolean;
  private readonly byteScores: Map<number, { id: number; score: number }>;
  private readonly unkId: number;
  private readonly unkScore: number;
  private readonly specialTokenMatcher: AddedTokenMatcher;  // For CONTROL + USER_DEFINED
  private readonly addedTokensById: Map<number, AddedToken>;

  constructor(
    pieces: SentencePiece[],
    trainerSpec?: TrainerSpec,
    addedTokens?: AddedToken[],
    normalizer?: TextNormalizer
  ) {
    this.trie = new VocabTrie();
    this.vocabReverse = new Map();
    this.byteScores = new Map();
    this.byteFallback = trainerSpec?.byteFallback ?? false;
    this.unkId = trainerSpec?.unkId ?? 0;
    this.unkScore = -Infinity;
    this.addedTokensById = new Map((addedTokens ?? []).map(t => [t.id, t]));

    // Collect special tokens for atomic matching (CONTROL + USER_DEFINED + HF added_tokens)
    const specialTokens: AddedToken[] = [...(addedTokens ?? [])];

    for (let id = 0; id < pieces.length; id++) {
      const { piece, score, type } = pieces[id];
      this.vocabReverse.set(id, piece);

      if (type === 2) { // UNKNOWN
        this.unkScore = score;
      } else if (type === 6) { // BYTE
        const match = piece.match(/^<0x([0-9A-Fa-f]{2})>$/);
        if (match) {
          this.byteScores.set(parseInt(match[1], 16), { id, score });
        }
      } else if (type === 3) { // CONTROL - match atomically, don't add to trie
        specialTokens.push({ id, content: piece, special: true });
      } else if (type === 4) { // USER_DEFINED - match atomically, don't add to trie
        specialTokens.push({ id, content: piece, special: true });
      } else if (type === 1) { // NORMAL - add to trie for Viterbi
        this.trie.insert(piece, id, score);
      }
    }

    // Build special token matcher for atomic matching before Viterbi
    this.specialTokenMatcher = new AddedTokenMatcher(specialTokens, { normalizer });
  }

  encode(text: string): number[] {
    if (text.length === 0) return [];

    // Step 0: Match special/control tokens atomically BEFORE Viterbi
    // This ensures tokens like <s>, </s>, <unk>, and user-defined tokens
    // are never broken by the segmentation algorithm
    const segments = this.specialTokenMatcher.extractAndNormalize(text);
    const result: number[] = [];

    for (const segment of segments) {
      if (segment.type === 'added') {
        result.push(segment.id);
      } else {
        result.push(...this.encodeText(segment.text));
      }
    }

    return result;
  }

  private encodeText(text: string): number[] {
    if (text.length === 0) return [];

    // NOTE: For tokenizer.json Unigram models that use a Metaspace pre_tokenizer,
    // the caller (e.g., UnigramTokenizer wrapper) must apply Metaspace first so inputs
    // like "Hello" become "▁Hello" (or configured replacement), matching the vocab pieces.

    // Convert to array of code points for correct Unicode handling
    const codePoints = [...text];
    const n = codePoints.length;

    // Viterbi DP: best[i] = best segmentation ending at code point i
    const best: Array<{ score: number; prevIdx: number; tokenId: number }> =
      new Array(n + 1).fill(null).map(() => ({ score: -Infinity, prevIdx: -1, tokenId: -1 }));
    best[0] = { score: 0, prevIdx: -1, tokenId: -1 };

    // Forward pass
    for (let i = 0; i < n; i++) {
      if (best[i].score === -Infinity) continue;

      // Use trie to find all vocabulary pieces starting at position i
      const candidates = this.trie.findPrefixes(codePoints, i);

      for (const { id, score, length } of candidates) {
        const newScore = best[i].score + score;
        const endIdx = i + length;
        if (newScore > best[endIdx].score) {
          best[endIdx] = { score: newScore, prevIdx: i, tokenId: id };
        }
      }

      // Handle unknown characters when no candidates found
      if (candidates.length === 0) {
        const char = codePoints[i];

        // Try byte fallback first (if enabled)
        if (this.byteFallback) {
          const byteTokens = this.getByteTokensForChar(char);
          if (byteTokens) {
            const newScore = best[i].score + byteTokens.totalScore;
            if (newScore > best[i + 1].score) {
              // Store as special marker; we'll expand during backtrack
              best[i + 1] = { score: newScore, prevIdx: i, tokenId: -2 }; // -2 = byte fallback
            }
            continue;  // Successfully handled
          }
        }

        // Fallback to UNK token (CRITICAL: ensures path always exists)
        const newScore = best[i].score + this.unkScore;
        if (newScore > best[i + 1].score) {
          best[i + 1] = { score: newScore, prevIdx: i, tokenId: this.unkId };
        }
      }
    }

    // Backward pass: reconstruct best path
    const tokens: number[] = [];
    let pos = n;

    while (pos > 0) {
      const { prevIdx, tokenId } = best[pos];

      if (tokenId === -2) {
        // Byte fallback: expand the single code point to byte tokens
        const char = codePoints[prevIdx];
        const byteTokens = this.getByteTokensForChar(char);
        if (byteTokens) {
          tokens.unshift(...byteTokens.ids);
        }
      } else if (tokenId >= 0) {
        tokens.unshift(tokenId);
      }

      pos = prevIdx;
    }

    return tokens;
  }

  private getByteTokensForChar(char: string): { ids: number[]; totalScore: number } | null {
    const bytes = new TextEncoder().encode(char);
    const ids: number[] = [];
    let totalScore = 0;

    for (const byte of bytes) {
      const byteInfo = this.byteScores.get(byte);
      if (!byteInfo) return null;
      ids.push(byteInfo.id);
      totalScore += byteInfo.score;
    }

    return { ids, totalScore };
  }

  decode(tokens: number[]): string {
    // Same as BPE decoder
    const pieces: string[] = [];

    for (const id of tokens) {
      const added = this.addedTokensById.get(id);
      if (added) {
        pieces.push(added.content);
        continue;
      }

      const piece = this.vocabReverse.get(id);
      if (piece === undefined) throw new Error(`Unknown token ID: ${id}`);
      pieces.push(piece);
    }

    let text = pieces.join('');
    text = this.decodeByteTokens(text);
    return text;
  }

  private decodeByteTokens(text: string): string {
    // Same implementation as BPE
    // ... (see BPEEncoder.decodeByteTokens)
  }
}
```

---

## Phase 5: HuggingFace tokenizer.json Parser (~200-300 lines)

### 5.1 Strict Validation

```typescript
// json/validator.ts

import type { HFTokenizerConfig } from './types.js';

export class UnsupportedTokenizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedTokenizerError';
  }
}

export function validateJsonConfig(config: HFTokenizerConfig): void {
  const modelType = config.model?.type;

  if (!modelType) {
    throw new UnsupportedTokenizerError('Missing model.type in tokenizer.json');
  }

  if (modelType === 'BPE') {
    // Must have Metaspace for SentencePiece compatibility
    const preTokenizerType = getPreTokenizerType(config.pre_tokenizer);
    const decoderType = config.decoder?.type;

    if (preTokenizerType !== 'Metaspace') {
      throw new UnsupportedTokenizerError(
        `Unsupported BPE tokenizer: pre_tokenizer is "${preTokenizerType}", expected "Metaspace". ` +
        'This appears to be a GPT-2/tiktoken-style BPE, not SentencePiece. ' +
        'Use the BPE tokenizer from src/bpe/ instead.'
      );
    }

    if (decoderType !== 'Metaspace' && decoderType !== 'Sequence') {
      throw new UnsupportedTokenizerError(
        `Unsupported BPE tokenizer: decoder is "${decoderType}", expected "Metaspace" or "Sequence".`
      );
    }
  } else if (modelType === 'Unigram') {
    // Unigram models are generally compatible
    // Just validate required fields exist
    if (!config.model.vocab) {
      throw new UnsupportedTokenizerError('Unigram model missing vocab field');
    }
  } else {
    throw new UnsupportedTokenizerError(
      `Unsupported model type: "${modelType}". Only "BPE" (with Metaspace) and "Unigram" are supported.`
    );
  }
}

function getPreTokenizerType(preTokenizer: any): string | null {
  if (!preTokenizer) return null;
  if (preTokenizer.type === 'Sequence') {
    // Check if any element is Metaspace
    for (const elem of preTokenizer.pretokenizers ?? []) {
      if (elem.type === 'Metaspace') return 'Metaspace';
    }
  }
  return preTokenizer.type;
}
```

### 5.2 Parser Implementation

```typescript
// json/parser.ts

import { validateJsonConfig, UnsupportedTokenizerError } from './validator.js';
import type { ModelProto, SentencePiece, TrainerSpec, NormalizerSpec, ModelType, SentencePieceType } from '../protobuf/schema.js';

interface HFTokenizerConfig {
  version?: string;
  model: {
    type: 'BPE' | 'Unigram' | string;
    vocab?: Record<string, number> | Array<[string, number]>;
    merges?: string[];
    unk_token?: string;
    byte_fallback?: boolean;
    continuing_subword_prefix?: string;  // BPE: prepended to non-first tokens
    end_of_word_suffix?: string;         // BPE: appended to last token
  };
  normalizer?: any;
  pre_tokenizer?: any;
  decoder?: any;
  added_tokens?: Array<{
    id: number;
    content: string;
    special: boolean;
    lstrip?: boolean;       // Strip left whitespace before matching
    rstrip?: boolean;       // Strip right whitespace after matching
    single_word?: boolean;  // Only match as complete word
    normalized?: boolean;   // Whether to normalize before matching
  }>;
}

// Extended result type for JSON parsing (includes merges for JSON-BPE)
export interface ParsedJsonTokenizer {
  modelType: 'unigram' | 'json-bpe';
  normalizer: TextNormalizer | null;  // tokenizer.json normalizer pipeline (subset)
  metaspace: { replacement: string; addPrefixSpace: boolean } | null; // tokenizer.json Metaspace pre_tokenizer (if present)
  addedTokens: AddedToken[];  // REQUIRED: matched atomically before model encoding

  // For Unigram
  pieces?: SentencePiece[];
  trainerSpec?: TrainerSpec;

  // For JSON-BPE (merges-based)
  vocab?: Record<string, number>;
  merges?: string[];
  unkId: number;              // RESOLVED from vocab/unk_token (used by Unigram + JSON-BPE)
  byteFallback?: boolean;
  continuingSubwordPrefix?: string;  // e.g., "##" for BERT-style
  endOfWordSuffix?: string;          // e.g., "</w>" for GPT-style
}

export function parseHFTokenizerJson(json: string | HFTokenizerConfig): ParsedJsonTokenizer {
  const config: HFTokenizerConfig = typeof json === 'string' ? JSON.parse(json) : json;

  // Validate configuration is within supported scope
  validateJsonConfig(config);

  const normalizer = buildHFNormalizer(config.normalizer);
  const metaspace = extractMetaspaceSpec(config.pre_tokenizer);
  if (config.model.type === 'BPE' && !metaspace) {
    throw new Error('BPE tokenizer.json requires Metaspace pre_tokenizer (validator should have enforced this)');
  }

  // Parse added_tokens (required for both BPE and Unigram)
  const addedTokens: AddedToken[] = (config.added_tokens ?? []).map(t => ({
    id: t.id,
    content: t.content,
    special: t.special,
    lstrip: t.lstrip,
    rstrip: t.rstrip,
    single_word: t.single_word,
    normalized: t.normalized,
  }));

  if (config.model.type === 'Unigram') {
    // Unigram: convert to SentencePiece pieces format
    const pieces: SentencePiece[] = [];
    const vocab = config.model.vocab as Array<[string, number]>;

    for (const [piece, score] of vocab) {
      pieces.push({
        piece,
        score,
        type: determinePieceType(piece, config),
      });
    }

    // Resolve unkId from vocab
    const unkToken = config.model.unk_token ?? '<unk>';
    const unkEntry = vocab.find(([p]) => p === unkToken);
    if (!unkEntry && config.model.unk_token) {
      throw new Error(`unk_token "${config.model.unk_token}" not found in Unigram vocab`);
    }
    const unkId = unkEntry ? vocab.indexOf(unkEntry) : 0;

    const trainerSpec = buildTrainerSpec(config, pieces.length, 1 /* UNIGRAM */);
    trainerSpec.unkId = unkId;
    trainerSpec.unkPiece = unkToken;

    return {
      modelType: 'unigram',
      normalizer,
      metaspace,
      addedTokens,
      pieces,
      trainerSpec,
      unkId,
    };

  } else if (config.model.type === 'BPE') {
    // JSON-BPE: preserve vocab and merges for merges-based encoder
    // Do NOT convert to pieces[] with scores - that's for SentencePiece BPE
    const vocab = config.model.vocab as Record<string, number>;

    // Resolve unkId from vocab (CRITICAL: must exist if unk_token is specified)
    const unkToken = config.model.unk_token ?? '<unk>';
    const unkId = vocab[unkToken];
    if (unkId === undefined && config.model.unk_token) {
      throw new Error(
        `unk_token "${config.model.unk_token}" not found in vocab. ` +
        `This would cause encode failures for unknown characters.`
      );
    }

    return {
      modelType: 'json-bpe',
      normalizer,
      metaspace,
      addedTokens,
      vocab,
      merges: config.model.merges ?? [],
      unkId: unkId ?? 0,
      byteFallback: config.model.byte_fallback ?? false,
      continuingSubwordPrefix: config.model.continuing_subword_prefix,
      endOfWordSuffix: config.model.end_of_word_suffix,
    };
  }

  throw new UnsupportedTokenizerError(`Unexpected model type: ${config.model.type}`);
}

// Helper functions

function determinePieceType(piece: string, config: HFTokenizerConfig): SentencePieceType {
  if (/^<0x[0-9A-Fa-f]{2}>$/.test(piece)) return 6; // BYTE
  if (piece === (config.model.unk_token ?? '<unk>')) return 2; // UNKNOWN
  if (piece.startsWith('<') && piece.endsWith('>')) return 3; // CONTROL
  return 1; // NORMAL
}

function buildTrainerSpec(config: HFTokenizerConfig, vocabSize: number, modelType: number): TrainerSpec {
  return {
    modelType,
    vocabSize,
    byteFallback: config.model.byte_fallback ?? false,
    splitDigits: false,
    treatWhitespaceAsSuffix: false,
    unkId: 0,  // Resolved by parser for tokenizer.json (see parseHFTokenizerJson)
    bosId: -1, eosId: -1, padId: -1,
    unkPiece: config.model.unk_token ?? '<unk>',
    bosPiece: '<s>', eosPiece: '</s>', padPiece: '<pad>',
    maxSentencepieceLength: 16,
  };
}

function extractMetaspaceSpec(preTokenizer: any): { replacement: string; addPrefixSpace: boolean } | null {
  if (!preTokenizer) return null;

  const metaspace =
    preTokenizer.type === 'Metaspace'
      ? preTokenizer
      : preTokenizer.type === 'Sequence'
        ? preTokenizer.pretokenizers?.find((p: any) => p.type === 'Metaspace')
        : null;

  if (!metaspace) return null;
  return {
    replacement: metaspace.replacement ?? '\u2581',
    addPrefixSpace: metaspace.add_prefix_space ?? true,
  };
}

function buildHFNormalizer(normalizer: any): TextNormalizer | null {
  if (!normalizer) return null;

  // NOTE: This is the tokenizer.json normalizer pipeline, NOT SentencePiece normalizer_spec.
  // MVP (full parity for common HF tokenizers) supports:
  // - Sequence
  // - Lowercase
  // - NFKC
  // - Strip
  // - Replace (Pattern.String + Pattern.Regex)
  //
  // Throw on unsupported normalizers to avoid silent mismatches.

  if (normalizer.type === 'Sequence') {
    const parts = normalizer.normalizers ?? [];
    const compiled = parts.map((n: any) => buildHFNormalizer(n)).filter(Boolean) as TextNormalizer[];
    return {
      normalize(text: string): string {
        let out = text;
        for (const part of compiled) out = part.normalize(out);
        return out;
      },
    };
  }

  if (normalizer.type === 'Lowercase') {
    return { normalize: (t: string) => t.toLowerCase() };
  }

  if (normalizer.type === 'NFKC') {
    return { normalize: (t: string) => t.normalize('NFKC') };
  }

  if (normalizer.type === 'Strip') {
    const left = normalizer.left ?? true;
    const right = normalizer.right ?? true;
    return {
      normalize(text: string): string {
        let out = text;
        if (left) out = out.replace(/^\s+/u, '');
        if (right) out = out.replace(/\s+$/u, '');
        return out;
      },
    };
  }

  if (normalizer.type === 'Replace') {
    const compiled = compileHFReplacePattern(normalizer.pattern);
    const content = normalizer.content ?? '';

    if (compiled.type === 'string') {
      // Literal substring replacement (NOT a regex). Use split/join for broad compatibility.
      return { normalize: (t: string) => t.split(compiled.value).join(content) };
    }

    // Regex replacement.
    // NOTE: HuggingFace tokenizers uses Rust `regex` semantics. For MVP we:
    // - Support patterns representable in both Rust regex and JS RegExp (Unicode mode).
    // - Translate/validate common constructs so behavior matches for typical tokenizer.json files.
    // - Throw on unsupported patterns (rather than silently produce wrong tokenization).
    const jsReplacement = translateRustReplacementToJs(content);
    return { normalize: (t: string) => t.replace(compiled.value, jsReplacement) };
  }

  throw new UnsupportedTokenizerError(
    `Unsupported tokenizer.json normalizer: "${normalizer.type}". ` +
    'Add support in buildHFNormalizer() or provide a supported tokenizer.json.'
  );
}

type HFPattern =
  | { String: string }
  | { Regex: string }
  | string; // Some configs may serialize bare strings; treat as String literal.

type CompiledReplacePattern =
  | { type: 'string'; value: string }
  | { type: 'regex'; value: RegExp };

function compileHFReplacePattern(pattern: HFPattern): CompiledReplacePattern {
  if (typeof pattern === 'string') return { type: 'string', value: pattern };
  if (pattern && typeof pattern === 'object' && typeof (pattern as any).String === 'string') {
    return { type: 'string', value: (pattern as any).String };
  }
  if (pattern && typeof pattern === 'object' && typeof (pattern as any).Regex === 'string') {
    const raw = (pattern as any).Regex;
    return { type: 'regex', value: compileHFRustRegexToJs(raw) };
  }
  throw new UnsupportedTokenizerError('Replace normalizer missing supported pattern (String or Regex)');
}

function compileHFRustRegexToJs(raw: string): RegExp {
  // MVP regex feature support:
  // - Pattern form: { Regex: string }
  // - No lookaround, no backreferences (Rust regex doesn't support them either)
  // - Optional leading flag group: (?i), (?m), (?s) (combined allowed: (?im))
  // - Unicode-aware \\w/\\d rewrites for parity with Rust regex defaults
  //
  // Anything outside this subset must throw to prevent silent mismatches.

  if (raw.includes('(?=') || raw.includes('(?!') || raw.includes('(?<=') || raw.includes('(?<!')) {
    throw new UnsupportedTokenizerError('Unsupported Regex pattern: lookaround is not supported');
  }
  if (/\\[1-9]/.test(raw) || /\\k<[^>]+>/.test(raw)) {
    throw new UnsupportedTokenizerError('Unsupported Regex pattern: backreferences are not supported');
  }

  // Named capture group syntax: Rust uses (?P<name>...), JS uses (?<name>...)
  let pattern = raw.replace(/\(\?P</g, '(?<');

  // Extract a leading flag group like (?im) or (?i)
  let flags = 'gu';
  const leadingFlags = pattern.match(/^\(\?([ims]+)\)/);
  if (leadingFlags) {
    const f = leadingFlags[1];
    if (f.includes('i')) flags += 'i';
    if (f.includes('m')) flags += 'm';
    if (f.includes('s')) flags += 's';
    pattern = pattern.slice(leadingFlags[0].length);
  }

  // Rust regex uses Unicode character classes for \\w/\\d by default; JS does not.
  pattern = pattern
    .replace(/\\w/g, '[\\p{L}\\p{N}_]')
    .replace(/\\W/g, '[^\\p{L}\\p{N}_]')
    .replace(/\\d/g, '\\\\p{Nd}')
    .replace(/\\D/g, '\\\\P{Nd}');

  try {
    return new RegExp(pattern, flags);
  } catch (err: any) {
    throw new UnsupportedTokenizerError(
      `Invalid/unsupported Regex pattern for Replace normalizer: ${String(err?.message ?? err)}`
    );
  }
}

function translateRustReplacementToJs(replacement: string): string {
  // Rust regex replacement supports `$name` for named capture groups.
  // JS uses `$<name>`. Translate for parity.
  //
  // This is intentionally conservative:
  // - Leaves `$1..$99` intact (compatible)
  // - Leaves `$$` intact (both treat as literal `$`)
  return replacement.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, '$<$1>');
}
```

---

## Phase 6: Model Download Helper (~250-300 lines)

### 6.1 Model Registry

```typescript
// download/registry.ts

export interface ModelInfo {
  url: string;
  sha256: string;
  filename: string;
  algorithm: 'bpe' | 'unigram';
  vocabSize: number;
}

// Official model sources with pre-computed SHA-256 hashes
// NOTE: SHA-256 hashes are computed during release and committed before publishing.
// Empty hash ('') means verification is skipped - fill before release!
export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  gemma: {
    url: 'https://huggingface.co/google/gemma-2b/resolve/main/tokenizer.model',
    sha256: '', // TODO: Compute before release: shasum -a 256 tokenizer.model
    filename: 'gemma-tokenizer.model',
    algorithm: 'bpe',
    vocabSize: 256128,
    // Gemma is public, no auth required
  },
  llama2: {
    url: 'https://huggingface.co/meta-llama/Llama-2-7b/resolve/main/tokenizer.model',
    sha256: '', // TODO: Compute before release
    filename: 'llama2-tokenizer.model',
    algorithm: 'bpe',
    vocabSize: 32000,
    // LLaMA 2 is GATED - requires HuggingFace auth token
  },
};

export type KnownTokenizer = keyof typeof MODEL_REGISTRY;
```

### 6.2 Download Helper Implementation

```typescript
// download/index.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { MODEL_REGISTRY, type KnownTokenizer, type ModelInfo } from './registry.js';

export interface DownloadOptions {
  tokenizer: KnownTokenizer;
  cacheDir?: string;           // Default: SENTENCEPIECE_MODEL_CACHE_DIR or ~/.cache/sentencepiece
  allowDownload?: boolean;     // Default: false. Set true to enable network download.
  verifyHash?: boolean;        // Default: true. Verify SHA-256 after download.
  authToken?: string;          // HuggingFace token for gated models (or use HF_TOKEN env var)
  customUrl?: string;          // Override default URL (use your own mirror). Hash still verified.
}

/**
 * Ensures a SentencePiece model is available locally.
 * Downloads from official source if not cached.
 *
 * @returns Absolute path to the cached .model file
 */
export async function ensureSentencePieceModel(options: DownloadOptions): Promise<string> {
  const { tokenizer, allowDownload = false, verifyHash = true } = options;

  const info = MODEL_REGISTRY[tokenizer];
  if (!info) {
    throw new Error(
      `Unknown tokenizer: "${tokenizer}". ` +
      `Available: ${Object.keys(MODEL_REGISTRY).join(', ')}`
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
        return modelPath;  // Cache hit, verified
      }
    } else {
      return modelPath;  // Cache hit, no verification
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
  const authToken = options.authToken
    ?? process.env.HF_TOKEN
    ?? process.env.HUGGINGFACE_HUB_TOKEN;

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
```

### 6.3 Parsed Model Caching

```typescript
// cache.ts

import type { ModelProto } from './protobuf/schema.js';

// In-memory cache for parsed models (avoids re-parsing on every call)
const parsedModelCache = new Map<string, ModelProto>();

export function getCachedModel(key: string): ModelProto | undefined {
  return parsedModelCache.get(key);
}

export function setCachedModel(key: string, model: ModelProto): void {
  parsedModelCache.set(key, model);
}

export function clearModelCache(): void {
  parsedModelCache.clear();
}

// Generate cache key from model bytes (first 1KB hash for uniqueness)
export function getModelCacheKey(bytes: Uint8Array): string {
  // Simple hash of first 1KB for cache key
  const sample = bytes.slice(0, 1024);
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash + sample[i]) | 0;
  }
  return `model_${hash.toString(16)}_${bytes.length}`;
}
```

---

## Phase 7: Testing (~500-700 lines)

### 7.1 Test Setup - Model Download

Tests require actual model files. **Models are NOT shipped in the repo** - they're downloaded once during test setup.

```typescript
// tests/setup.ts (vitest setup file)

import { ensureSentencePieceModel } from '../src/sentencepiece/download/index.js';
import * as path from 'node:path';

const TEST_MODELS_DIR = path.join(__dirname, '.models');

// Download models before tests run (one-time)
export async function setup() {
  console.log('Downloading test models (if not cached)...');

  await Promise.all([
    ensureSentencePieceModel({
      tokenizer: 'gemma',
      cacheDir: TEST_MODELS_DIR,
      allowDownload: true,  // Enable download for test setup
    }),
    ensureSentencePieceModel({
      tokenizer: 'llama2',
      cacheDir: TEST_MODELS_DIR,
      allowDownload: true,
      // Note: LLaMA 2 requires HF_TOKEN env var for gated access
    }),
  ]);

  console.log('Test models ready.');
}

// Export paths for tests to use
export const TEST_MODEL_PATHS = {
  gemma: path.join(TEST_MODELS_DIR, 'gemma-tokenizer.model'),
  llama2: path.join(TEST_MODELS_DIR, 'llama2-tokenizer.model'),
};
```

### 7.2 Golden Fixture Generation

**Run locally** with downloaded models to generate fixtures (fixtures ARE committed to repo):

```python
# scripts/fixtures/generate_sentencepiece_fixtures.py

import sentencepiece as spm
import json
import sys

def generate_fixtures(model_path: str, output_path: str, model_name: str):
    sp = spm.SentencePieceProcessor()
    sp.Load(model_path)

    # Comprehensive test cases
    test_cases = [
        # Basic
        "Hello, world!",
        "The quick brown fox jumps over the lazy dog.",

        # Unicode - various scripts
        "日本語テスト",
        "Привет мир",
        "مرحبا بالعالم",
        "שלום עולם",
        "Γειά σου κόσμε",

        # Emoji and ZWJ sequences (CRITICAL for Unicode handling)
        "🎉",
        "🚀💻🎯",
        "👨‍👩‍👧‍👦",  # Family ZWJ sequence
        "🏳️‍🌈",      # Flag ZWJ sequence
        "👩🏽‍💻",      # Skin tone + profession

        # Combining characters
        "café",        # é as single code point
        "cafe\u0301",  # e + combining acute
        "나는 한국어",

        # Edge cases
        "",
        " ",
        "   ",
        "\n",
        "\t",
        "\n\t\r",

        # Whitespace handling
        "word1  word2   word3",
        " leading",
        "trailing ",
        "  both  ",

        # Long text
        "a" * 100,
        "hello " * 50,

        # Numbers and punctuation
        "12345",
        "3.14159",
        "1,234,567.89",

        # Special characters that might be in control tokens
        "<s>",
        "</s>",
        "<unk>",
        "<pad>",
        "<s>text</s>",

        # Mixed content
        "Hello 世界! 🌍 Привет",
        "Code: def foo(): pass",
        "Email: test@example.com",
        "URL: https://example.com/path?query=1",

        # Potential normalization edge cases
        "ﬁ",           # fi ligature (NFKC normalizes to "fi")
        "①②③",         # Circled numbers
        "Ａ",           # Fullwidth A
        "\u00A0",      # Non-breaking space
        "…",           # Ellipsis
    ]

    fixtures = {
        "model_name": model_name,
        "model_path": model_path,
        "vocab_size": sp.GetPieceSize(),
        "encode_fixtures": [],
        "decode_fixtures": [],
        "roundtrip_fixtures": [],
    }

    for text in test_cases:
        try:
            ids = sp.EncodeAsIds(text)
            pieces = sp.EncodeAsPieces(text)
            decoded = sp.DecodeIds(ids)

            fixtures["encode_fixtures"].append({
                "input": text,
                "expected_ids": ids,
                "expected_pieces": pieces,
            })

            fixtures["decode_fixtures"].append({
                "input_ids": ids,
                "expected": decoded,
            })

            # Verify roundtrip
            fixtures["roundtrip_fixtures"].append({
                "original": text,
                "encoded": ids,
                "decoded": decoded,
                "roundtrip_ok": (decoded == text) or (text == "" and decoded == ""),
            })
        except Exception as e:
            print(f"Warning: Failed to process '{repr(text)}': {e}", file=sys.stderr)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(fixtures, f, indent=2, ensure_ascii=False)

    print(f"Generated {len(fixtures['encode_fixtures'])} fixtures to {output_path}")

if __name__ == "__main__":
    # NOTE: Run after downloading models via ensureSentencePieceModel()
    # or manually downloading from official sources
    generate_fixtures(
        "tests/.models/gemma-tokenizer.model",
        "tests/fixtures/gemma-golden.json",
        "gemma"
    )
    generate_fixtures(
        "tests/.models/llama2-tokenizer.model",
        "tests/fixtures/llama2-golden.json",
        "llama2"
    )
```

### 7.3 Test Structure

```typescript
// tests/sentencepiece.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  getSentencePieceTokenizer,
  loadSentencePieceTokenizer,
} from '../src/sentencepiece/index.js';
import { parseModelProto } from '../src/sentencepiece/protobuf/decoder.js';
import { TEST_MODEL_PATHS } from './setup.js';
import gemmaFixtures from './fixtures/gemma-golden.json';
import llama2Fixtures from './fixtures/llama2-golden.json';

describe('SentencePiece Tokenizer', () => {
  // Load models once for all tests
  let gemmaTokenizer: ReturnType<typeof getSentencePieceTokenizer>;
  let llama2Tokenizer: ReturnType<typeof getSentencePieceTokenizer>;

  beforeAll(async () => {
    const gemmaBytes = await fs.readFile(TEST_MODEL_PATHS.gemma);
    const llama2Bytes = await fs.readFile(TEST_MODEL_PATHS.llama2);

    gemmaTokenizer = getSentencePieceTokenizer({ modelData: gemmaBytes });
    llama2Tokenizer = getSentencePieceTokenizer({ modelData: llama2Bytes });
  });

  describe('Protobuf Parser', () => {
    it('parses Gemma model structure correctly', () => {
      expect(gemmaTokenizer.vocabSize).toBe(256128);
      expect(gemmaTokenizer.algorithm).toBe('bpe');
    });

    it('parses LLaMA 2 model structure correctly', () => {
      expect(llama2Tokenizer.vocabSize).toBe(32000);
      expect(llama2Tokenizer.algorithm).toBe('bpe');
    });

    it('handles malformed protobuf gracefully', () => {
      expect(() => parseModelProto(new Uint8Array([0, 1, 2, 3]))).toThrow();
    });
  });

  describe('Gemma Encoding Parity', () => {
    for (const fixture of gemmaFixtures.encode_fixtures) {
      it(`encodes: ${JSON.stringify(fixture.input).slice(0, 50)}`, () => {
        const tokens = gemmaTokenizer.encode(fixture.input);
        expect(tokens).toEqual(fixture.expected_ids);
      });
    }
  });

  describe('Gemma Decoding Parity', () => {
    for (const fixture of gemmaFixtures.decode_fixtures) {
      it(`decodes: [${fixture.input_ids.slice(0, 5).join(', ')}...]`, () => {
        const text = gemmaTokenizer.decode(fixture.input_ids);
        expect(text).toBe(fixture.expected);
      });
    }
  });

  describe('LLaMA 2 Encoding Parity', () => {
    for (const fixture of llama2Fixtures.encode_fixtures) {
      it(`encodes: ${JSON.stringify(fixture.input).slice(0, 50)}`, () => {
        const tokens = llama2Tokenizer.encode(fixture.input);
        expect(tokens).toEqual(fixture.expected_ids);
      });
    }
  });

  describe('Unicode Handling', () => {
    it('handles surrogate pairs correctly', () => {
      const text = '👨‍👩‍👧‍👦'; // Family emoji (ZWJ sequence)
      const tokens = gemmaTokenizer.encode(text);
      const decoded = gemmaTokenizer.decode(tokens);
      // Decoded might normalize, but should represent same visual
      expect(decoded.length).toBeGreaterThan(0);
    });

    it('handles combining characters correctly', () => {
      const text1 = 'café';        // é as single code point
      const text2 = 'cafe\u0301';  // e + combining acute
      const tokens1 = gemmaTokenizer.encode(text1);
      const tokens2 = gemmaTokenizer.encode(text2);
      // After normalization, these should produce the same tokens
      // (if the model uses NFKC normalization)
    });
  });

  describe('Normalization', () => {
    it('applies precompiled charmap when present', () => {
      // Test that normalization matches Python sentencepiece
      const text = 'ﬁ'; // fi ligature
      const tokens = gemmaTokenizer.encode(text);
      // Compare with fixture
    });
  });

  describe('tokenizer.json Support', () => {
    it('rejects unsupported BPE configurations', () => {
      const gpt2StyleConfig = JSON.stringify({
        model: { type: 'BPE', vocab: {} },
        pre_tokenizer: { type: 'ByteLevel' }, // Not Metaspace
      });
      expect(() =>
        getSentencePieceTokenizer({ modelData: new TextEncoder().encode(gpt2StyleConfig), format: 'json' })
      ).toThrow('Unsupported');
    });
  });

  describe('Error Handling', () => {
    it('throws on unknown token ID during decode', () => {
      expect(() => gemmaTokenizer.decode([999999999]))
        .toThrow('Unknown token ID');
    });
  });
});

describe('Model Download Helper', () => {
  it('downloads and caches models', async () => {
    const { ensureSentencePieceModel } = await import('../src/sentencepiece/download/index.js');

    // Should return cached path (already downloaded in setup)
    const path = await ensureSentencePieceModel({
      tokenizer: 'gemma',
      cacheDir: TEST_MODEL_PATHS.gemma.replace('/gemma-tokenizer.model', ''),
      allowDownload: false, // Should already be cached
    });

    expect(path).toBe(TEST_MODEL_PATHS.gemma);
  });

  it('throws when model not cached and download disabled', async () => {
    const { ensureSentencePieceModel } = await import('../src/sentencepiece/download/index.js');

    await expect(
      ensureSentencePieceModel({
        tokenizer: 'gemma',
        cacheDir: '/nonexistent/path',
        allowDownload: false,
      })
    ).rejects.toThrow('not found in cache');
  });
});
```

---

## Implementation Order

### Phase 1: Core Infrastructure
1. [ ] Protobuf wire format parser (`protobuf/wire.ts`)
2. [ ] ModelProto/SentencePiece decoder (`protobuf/decoder.ts`)
3. [ ] Unicode utilities + script tables (`unicode.ts`)
4. [ ] Generate `unicode-scripts.generated.ts` from UCD (commit output)
5. [ ] Basic tests with manually downloaded .model files

### Phase 2: Normalizer **CRITICAL**
5. [ ] Parse precompiled_charsmap format
6. [ ] Implement trie-based charmap execution
7. [ ] Basic normalization (NFKC fallback, whitespace)
8. [ ] Normalizer tests with Python fixtures

### Phase 3: BPE Algorithms
9. [ ] Priority queue implementation (min-heap)
10. [ ] Linked list for token sequence
11. [ ] SentencePiece BPE encoder (score-based, for .model files)
12. [ ] JSON-BPE encoder (merges-based, for tokenizer.json)
13. [ ] BPE decoder with byte token handling (shared)
14. [ ] BPE parity tests (both variants)

### Phase 4: Unigram Algorithm
14. [ ] Vocabulary trie implementation
15. [ ] Viterbi DP with trie lookup + UNK fallback
16. [ ] Unigram decoder
17. [ ] Unigram parity tests

### Phase 5: JSON Support (Unigram + BPE with Metaspace)
18. [ ] Config validator (reject ByteLevel BPE, accept Metaspace BPE + Unigram)
19. [ ] JSON parser for Unigram + BPE with Metaspace
20. [ ] JSON format tests

### Phase 6: Model Download Helper (Node.js)
21. [ ] Model registry (`download/registry.ts`)
22. [ ] Download with SHA-256 verification (`download/index.ts`)
23. [ ] Parsed model caching (`cache.ts`)
24. [ ] Download helper tests

### Phase 7: Public API & Integration
25. [ ] Sync API (`getSentencePieceTokenizer`)
26. [ ] Async API (`loadSentencePieceTokenizer`)
27. [ ] Integration with estimator-async.ts
28. [ ] Remove sentencepiece-js from package.json

### Phase 8: Polish
29. [ ] Generate golden fixtures (Python)
30. [ ] Full parity test suite
31. [ ] Documentation
32. [ ] Final testing & PR

---

## Estimated Lines of Code

| Component | Lines |
|-----------|-------|
| Protobuf parser | 400-500 |
| Normalizer (incl. precompiled charmap) | 400-500 |
| Code point utilities | 50-100 |
| SentencePiece BPE (score-based, heap + linked list) | 400-500 |
| JSON-BPE (merges-based) | 200-250 |
| Unigram algorithm (trie + Viterbi) | 400-500 |
| JSON parser + validator (Unigram + BPE/Metaspace) | 250-300 |
| Model download helper + cache | 200-250 |
| Types & public API | 200-250 |
| Tests | 700-900 |
| **Total** | **3,200-4,050** |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| precompiled_charsmap format undocumented | Reference HuggingFace spm_precompiled implementation |
| Unicode edge cases (ZWJ, combining) | Comprehensive test fixtures from Python sentencepiece |
| BPE merge order incorrect | Test against Python sentencepiece with many inputs |
| JSON scope creep | Strict validation that throws on unsupported configs |
| Model download fails (rate limiting, network) | SHA-256 verification, clear error messages, manual download option |
| Model URLs change | Version-pin URLs, document fallback procedure |
| CI requires network access | Cache models in CI, or skip download tests in offline mode |
| Performance regression | Benchmark against sentencepiece-js (WASM) |

---

## Success Criteria

1. **Zero dependencies** - No npm packages for tokenization
2. **No embedded models** - npm package ships zero third-party model bytes
3. **Download helper works** - `ensureSentencePieceModel()` downloads from default sources with SHA-256 verification
4. **100% parity** - All golden fixtures pass (encode + decode)
5. **Correct Unicode handling** - ZWJ sequences, combining marks work
6. **precompiled_charsmap works** - nmt_nfkc-based models tokenize correctly
7. **Clear scope** - JSON parser throws helpful errors for unsupported configs
8. **Reasonable performance** - Within 2x of sentencepiece-js for typical inputs
9. **Async/sync API** - Both available as appropriate

---

## Release Checklist

### Pre-Release: SHA-256 Hash Verification

**CI must fail if any registry SHA-256 hash is empty.**

```typescript
// scripts/verify-registry-hashes.ts (run in CI before publish)

import { MODEL_REGISTRY } from '../src/sentencepiece/download/registry.js';

let hasErrors = false;

for (const [name, info] of Object.entries(MODEL_REGISTRY)) {
  if (!info.sha256 || info.sha256.length !== 64) {
    console.error(`ERROR: Missing or invalid SHA-256 for "${name}"`);
    console.error(`  Expected: 64-character hex string`);
    console.error(`  Got: "${info.sha256 || '(empty)'}"`);
    console.error(`  To fix: Download model and run: shasum -a 256 ${info.filename}`);
    hasErrors = true;
  }
}

if (hasErrors) {
  console.error('\nRegistry hash verification FAILED. Fix before release.');
  process.exit(1);
}

console.log('✓ All registry hashes present and valid.');
```

**Required package.json changes** (to be applied during implementation):

```diff
// package.json scripts section
{
  "scripts": {
+   "verify:hashes": "tsx scripts/verify-registry-hashes.ts",
-   "prepublishOnly": "npm run lint && npm run test && npm run build && npm run test:dist",
+   "prepublishOnly": "npm run lint && npm run test && npm run build && npm run test:dist && npm run verify:hashes",
  }
}
```

### Computing Hashes for Release

```bash
# Download models and compute hashes
curl -L "https://huggingface.co/google/gemma-2b/resolve/main/tokenizer.model" -o gemma-tokenizer.model
shasum -a 256 gemma-tokenizer.model
# Output: abc123...def456  gemma-tokenizer.model

# For gated models (requires HF token)
curl -L -H "Authorization: Bearer $HF_TOKEN" \
  "https://huggingface.co/meta-llama/Llama-2-7b/resolve/main/tokenizer.model" \
  -o llama2-tokenizer.model
shasum -a 256 llama2-tokenizer.model
```

---

## Testing Strategy: Offline/CI Mode

### Problem

Tests currently download models at setup time, which:
- Requires network access in CI
- Is non-deterministic (network failures, rate limiting)
- Slows down test runs

### Solution: Explicit Network Mode

```typescript
// tests/setup.ts

const ALLOW_NETWORK = process.env.ALLOW_NETWORK === '1';
const CI_MODEL_CACHE = process.env.CI_MODEL_CACHE;  // Pre-populated cache path

export async function setup() {
  if (CI_MODEL_CACHE) {
    // CI mode: use pre-cached models (no network)
    console.log(`Using pre-cached models from: ${CI_MODEL_CACHE}`);
    return;
  }

  if (!ALLOW_NETWORK) {
    console.log('Skipping model download (ALLOW_NETWORK not set)');
    console.log('Set ALLOW_NETWORK=1 to download models, or CI_MODEL_CACHE=/path to use cached models');
    return;
  }

  // Development mode: download if needed
  console.log('Downloading test models (ALLOW_NETWORK=1)...');
  await downloadTestModels();
}
```

### Test Categories

```typescript
// Tests are split into categories:

// 1. Unit tests (no models needed) - always run
describe('Protobuf Parser', () => { /* ... */ });
describe('Normalizer', () => { /* ... */ });
describe('BPE Algorithm', () => { /* ... */ });

// 2. Integration tests (need models) - use helper for clean skip
const describeWithModels = modelsAvailable() ? describe : describe.skip;

describeWithModels('Gemma Parity', () => { /* ... */ });
describeWithModels('LLaMA 2 Parity', () => { /* ... */ });

function modelsAvailable(): boolean {
  // Check if models are cached locally
  try {
    return fs.existsSync(TEST_MODEL_PATHS.gemma) && fs.existsSync(TEST_MODEL_PATHS.llama2);
  } catch {
    return false;
  }
}
```

### CI Configuration

**Note**: Vitest uses different CLI patterns than Jest. Use `--exclude` or separate config files.

```yaml
# .github/workflows/test.yml

jobs:
  test-unit:
    # Fast: no models, no network
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test -- --exclude='**/*.parity.test.ts'

  test-parity:
    # Full: with models (cached)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Cache test models
        uses: actions/cache@v4
        with:
          path: tests/.models
          key: sentencepiece-models-v1-${{ hashFiles('src/sentencepiece/download/registry.ts') }}
      - run: npm ci
      - run: ALLOW_NETWORK=1 npm test
        env:
          HF_TOKEN: ${{ secrets.HF_TOKEN }}  # For gated models
```

**Alternative**: Use separate vitest config files for different test types:

```typescript
// vitest.config.ts (default - unit tests only)
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.parity.test.ts'],
  },
});

// vitest.parity.config.ts (parity tests)
export default defineConfig({
  test: {
    include: ['tests/**/*.parity.test.ts'],
  },
});
```

Then run: `npm test` for unit tests, `npx vitest -c vitest.parity.config.ts` for parity tests.

### Local Development

```bash
# First time: download models
ALLOW_NETWORK=1 npm test

# Subsequent runs: use cached models (no network)
npm test

# Explicitly skip parity tests
npm test -- --testPathIgnorePatterns=parity
```
