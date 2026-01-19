# Implementation Plan: Browser-First Distribution with IIFE Global Bundles

## Goal

Provide browser-ready IIFE global bundles for ai-token-estimator that can be used via unpkg/CDN:

```html
<script src="https://unpkg.com/ai-token-estimator/dist/browser/o200k_base.js"></script>
<script>
  const { encode, decode } = AITokenEstimator_o200k_base;
</script>
```

## Current State

- **Build tool**: tsup (outputs ESM + CJS)
- **Entry point**: Single `src/index.ts` that exports everything
- **Vocabulary data**: Static imports in `src/bpe/index.ts` - ALL encodings bundled together (~4.4MB source)
- **Browser compatibility**: Core BPE is browser-safe, but SentencePiece has Node.js-only download helpers

## Design Decisions

### 1. Per-Encoding IIFE Global Bundles

Create separate IIFE bundles for each encoding to avoid loading unnecessary vocabulary data.
Output to `dist/browser/` to avoid collision with Node.js build artifacts (`dist/index.js`, etc.).

| Bundle | Global Name | Primary Use Case |
|--------|-------------|------------------|
| `dist/browser/o200k_base.js` | `AITokenEstimator_o200k_base` | GPT-4o, o1, o3, GPT-4.1 |
| `dist/browser/o200k_harmony.js` | `AITokenEstimator_o200k_harmony` | Harmony models (different special tokens) |
| `dist/browser/cl100k_base.js` | `AITokenEstimator_cl100k_base` | GPT-4, GPT-3.5-turbo |
| `dist/browser/p50k_base.js` | `AITokenEstimator_p50k_base` | Legacy models |
| `dist/browser/p50k_edit.js` | `AITokenEstimator_p50k_edit` | Legacy edit models |
| `dist/browser/r50k_base.js` | `AITokenEstimator_r50k_base` | Legacy GPT-2/3 |

Note: `o200k_harmony` gets its own bundle because it has different special tokens than `o200k_base`,
even though they share the same vocabulary. The `o200k_harmony` entry imports vocab from `o200k_base`.

### 2. Bundle Contents (Per-Encoding)

Each encoding bundle exports:
- `encode(text, options?)` - Encode text to tokens
- `decode(tokens)` - Decode tokens to text
- `encodeChat(messages, options?)` - Encode chat messages (ChatML)
- `encodeGenerator(text, options?)` - Streaming encode
- `encodeChatGenerator(messages, options?)` - Streaming chat encode
- `decodeGenerator(tokens)` - Streaming decode
- `decodeAsyncGenerator(tokens)` - Async streaming decode (for LLM response streams)
- `isWithinTokenLimit(text, limit, options?)` - Fast limit check
- `isChatWithinTokenLimit(input)` - Fast chat limit check (object-style: `{ messages, tokenLimit, primeAssistant? }`)
- `countTokens(text: string): number` - Count tokens in text (encoding-fixed)

**Excluded from browser bundles** (Node.js only):
- SentencePiece APIs (require file system for model loading)
- Provider APIs (require API keys/network)
- `estimateAsync` (uses provider APIs)
- Cost estimation (server-side concern)

### 3. Build Approach

Use **tsup** (already installed) with IIFE format. IIFE (Immediately Invoked Function Expression)
creates a global-script bundle that assigns exports to a global variable. This is suitable for
`<script>` tag usage but is NOT true UMD (no AMD/CJS detection).

### 4. Entry Point Structure

Create new browser-specific entry points:

```
src/
├── browser/
│   ├── o200k_base.ts      # Entry for o200k_base bundle
│   ├── o200k_harmony.ts   # Entry for o200k_harmony bundle (imports vocab from o200k_base)
│   ├── cl100k_base.ts     # Entry for cl100k_base bundle
│   ├── p50k_base.ts       # Entry for p50k_base bundle
│   ├── p50k_edit.ts       # Entry for p50k_edit bundle
│   ├── r50k_base.ts       # Entry for r50k_base bundle
│   └── chat-encoding.ts   # Shared chat encoding logic for browser
```

Each entry file:
1. Imports only the vocabulary for that encoding
2. Creates a pre-configured tokenizer with correct special tokens
3. Exports browser-safe functions bound to that encoding

### 5. No Package-Level unpkg/jsdelivr Fields

Do NOT set `unpkg` or `jsdelivr` fields in package.json to point to a single encoding bundle.
This would be surprising for consumers/tools that rely on those fields expecting the main entry.
Instead, document explicit CDN URLs for each bundle in the README.

---

## Implementation Steps

### Phase 1: Create Browser Entry Points

#### 1.1 Create encoding-specific entry (example: `src/browser/o200k_base.ts`)

```typescript
import { BPETokenizer } from '../bpe/core.js';
import { getSpecialTokenMap } from '../bpe/special-tokens.js';
import { getTokenSplitRegex } from '../encodings/regex.js';
// Note: The generated module exports VOCAB, not O200K_BASE_VOCAB
import { VOCAB } from '../encodings/generated/o200k_base.js';
import { createChatEncoder } from './chat-encoding.js';
import type { ChatMessage } from '../types.js';
import type { SpecialTokenHandling } from '../bpe/types.js';

const ENCODING = 'o200k_base' as const;

// Lazily initialized tokenizer
let tokenizer: BPETokenizer | null = null;
let chatEncoder: ReturnType<typeof createChatEncoder> | null = null;

function getTokenizer(): BPETokenizer {
  if (!tokenizer) {
    tokenizer = new BPETokenizer({
      vocabDecoder: VOCAB,
      specialTokenMap: getSpecialTokenMap(ENCODING),
      tokenSplitRegex: getTokenSplitRegex(ENCODING),
    });
  }
  return tokenizer;
}

function getChatEncoder() {
  if (!chatEncoder) {
    chatEncoder = createChatEncoder(getTokenizer(), ENCODING);
  }
  return chatEncoder;
}

// Public API
export function encode(
  text: string,
  options?: { allowSpecial?: SpecialTokenHandling }
): number[] {
  return getTokenizer().encodeText(text, options?.allowSpecial);
}

export function decode(tokens: Iterable<number>): string {
  return getTokenizer().decodeTokens(tokens);
}

export function* encodeGenerator(
  text: string,
  options?: { allowSpecial?: SpecialTokenHandling }
): Generator<number[], number, undefined> {
  return yield* getTokenizer().encodeTextGenerator(text, options?.allowSpecial);
}

export function* decodeGenerator(
  tokens: Iterable<number>
): Generator<string, void, void> {
  yield* getTokenizer().decodeTokensGenerator(tokens);
}

export async function* decodeAsyncGenerator(
  tokens: AsyncIterable<number | number[]>
): AsyncGenerator<string, void, void> {
  yield* getTokenizer().decodeTokensAsyncGenerator(tokens);
}

export function isWithinTokenLimit(
  text: string,
  limit: number,
  options?: { allowSpecial?: SpecialTokenHandling }
): number | false {
  const result = getTokenizer().encodeTextWithLimit(text, limit, options?.allowSpecial);
  return result.exceeded ? false : result.count;
}

export function countTokens(text: string): number {
  return getTokenizer().encodeText(text).length;
}

// Chat encoding functions (delegate to chat encoder)
export function encodeChat(
  messages: ChatMessage[],
  options?: { primeAssistant?: boolean }
): number[] {
  return getChatEncoder().encodeChat(messages, options);
}

export function* encodeChatGenerator(
  messages: Iterable<ChatMessage>,
  options?: { primeAssistant?: boolean }
): Generator<number[], number, undefined> {
  return yield* getChatEncoder().encodeChatGenerator(messages, options);
}

/**
 * Check if chat messages fit within a token limit.
 * Object-style input to match main library API.
 */
export function isChatWithinTokenLimit(input: {
  messages: ChatMessage[];
  tokenLimit: number;
  primeAssistant?: boolean;
}): number | false {
  return getChatEncoder().isChatWithinTokenLimit(input);
}
```

#### 1.2 Create `src/browser/chat-encoding.ts`

Shared chat encoding logic that derives special token IDs from the encoding's specialTokenMap
(to avoid hardcoding numeric IDs that could drift):

```typescript
import type { BPETokenizer } from '../bpe/core.js';
import type { ChatMessage } from '../types.js';
import { getSpecialTokenMap } from '../bpe/special-tokens.js';
import type { OpenAIEncoding } from '../bpe/types.js';

/**
 * ChatML token names by encoding.
 * Maps encoding to the special token strings used for chat formatting.
 */
const CHAT_TOKEN_NAMES: Record<string, { start: string; end: string; sep: string }> = {
  cl100k_base: { start: '<|im_start|>', end: '<|im_end|>', sep: '<|im_sep|>' },
  o200k_base: { start: '<|im_start|>', end: '<|im_end|>', sep: '<|im_sep|>' },
  // o200k_harmony uses different token names
  o200k_harmony: { start: '<|start|>', end: '<|end|>', sep: '<|message|>' },
};

/**
 * Get ChatML token IDs for an encoding by looking them up in the special token map.
 * This ensures we don't hardcode numeric IDs that could drift.
 */
function getChatTokenIds(encoding: OpenAIEncoding): { imStart: number; imEnd: number; imSep: number } | null {
  const tokenNames = CHAT_TOKEN_NAMES[encoding];
  if (!tokenNames) return null;

  const specialTokenMap = getSpecialTokenMap(encoding);
  const imStart = specialTokenMap.get(tokenNames.start);
  const imEnd = specialTokenMap.get(tokenNames.end);
  const imSep = specialTokenMap.get(tokenNames.sep);

  if (imStart === undefined || imEnd === undefined || imSep === undefined) {
    return null;
  }

  return { imStart, imEnd, imSep };
}

export function createChatEncoder(tokenizer: BPETokenizer, encoding: OpenAIEncoding) {
  const chatTokens = getChatTokenIds(encoding);
  if (!chatTokens) {
    // Return stubs that throw for encodings without chat support
    const notSupported = () => {
      throw new Error(`Encoding "${encoding}" does not support chat format.`);
    };
    return {
      encodeChat: notSupported as () => number[],
      encodeChatGenerator: notSupported as () => Generator<number[], number, undefined>,
      isChatWithinTokenLimit: notSupported as () => number | false,
    };
  }

  const { imStart, imEnd, imSep } = chatTokens;

  /**
   * Get role string from message.
   */
  function getRoleString(message: ChatMessage): string {
    if (message.role === 'function' && message.name) {
      return message.name;
    } else if (message.name) {
      return `${message.role}:${message.name}`;
    }
    return message.role;
  }

  /**
   * Format function_call for encoding.
   */
  function formatFunctionCall(fc: { name: string; arguments: string }): string {
    const parts: string[] = [];
    if (fc.name) parts.push(fc.name);
    if (fc.arguments) parts.push(fc.arguments);
    return parts.join('\n');
  }

  return {
    encodeChat(messages: ChatMessage[], options?: { primeAssistant?: boolean }): number[] {
      const primeAssistant = options?.primeAssistant ?? true;
      const tokens: number[] = [];

      for (const message of messages) {
        tokens.push(imStart);
        tokens.push(...tokenizer.encodeText(getRoleString(message), 'skip'));
        tokens.push(imSep);

        if (message.content) {
          tokens.push(...tokenizer.encodeText(message.content, 'skip'));
        }

        if (message.function_call) {
          const fcContent = formatFunctionCall(message.function_call);
          tokens.push(...tokenizer.encodeText(fcContent, 'skip'));
        }

        tokens.push(imEnd);
      }

      if (primeAssistant) {
        tokens.push(imStart);
        tokens.push(...tokenizer.encodeText('assistant', 'skip'));
        tokens.push(imSep);
      }

      return tokens;
    },

    *encodeChatGenerator(
      messages: Iterable<ChatMessage>,
      options?: { primeAssistant?: boolean }
    ): Generator<number[], number, undefined> {
      const primeAssistant = options?.primeAssistant ?? true;
      let totalTokens = 0;

      for (const message of messages) {
        yield [imStart];
        totalTokens += 1;

        const roleTokens = tokenizer.encodeText(getRoleString(message), 'skip');
        yield roleTokens;
        totalTokens += roleTokens.length;

        yield [imSep];
        totalTokens += 1;

        if (message.content) {
          const gen = tokenizer.encodeTextGenerator(message.content, 'skip');
          let result = gen.next();
          while (!result.done) {
            yield result.value;
            totalTokens += result.value.length;
            result = gen.next();
          }
        }

        if (message.function_call) {
          const fcContent = formatFunctionCall(message.function_call);
          const fcTokens = tokenizer.encodeText(fcContent, 'skip');
          yield fcTokens;
          totalTokens += fcTokens.length;
        }

        yield [imEnd];
        totalTokens += 1;
      }

      if (primeAssistant) {
        yield [imStart];
        totalTokens += 1;
        const assistantTokens = tokenizer.encodeText('assistant', 'skip');
        yield assistantTokens;
        totalTokens += assistantTokens.length;
        yield [imSep];
        totalTokens += 1;
      }

      return totalTokens;
    },

    /**
     * Check if chat messages fit within a token limit.
     * Object-style input to match main library API.
     */
    isChatWithinTokenLimit(input: {
      messages: ChatMessage[];
      tokenLimit: number;
      primeAssistant?: boolean;
    }): number | false {
      const { messages, tokenLimit, primeAssistant = true } = input;
      let count = 0;

      for (const message of messages) {
        count += 1; // imStart
        count += tokenizer.encodeText(getRoleString(message), 'skip').length;
        count += 1; // imSep

        if (count > tokenLimit) return false;

        if (message.content) {
          const result = tokenizer.encodeTextWithLimit(
            message.content,
            tokenLimit - count,
            'skip'
          );
          count += result.count;
          if (result.exceeded) return false;
        }

        if (message.function_call) {
          const fcContent = formatFunctionCall(message.function_call);
          count += tokenizer.encodeText(fcContent, 'skip').length;
          if (count > tokenLimit) return false;
        }

        count += 1; // imEnd
        if (count > tokenLimit) return false;
      }

      if (primeAssistant) {
        count += 1; // imStart
        count += tokenizer.encodeText('assistant', 'skip').length;
        count += 1; // imSep
      }

      return count > tokenLimit ? false : count;
    },
  };
}
```

#### 1.3 Create `src/browser/o200k_harmony.ts`

Separate entry that imports vocab from o200k_base but uses different special tokens:

```typescript
import { BPETokenizer } from '../bpe/core.js';
import { getSpecialTokenMap } from '../bpe/special-tokens.js';
import { getTokenSplitRegex } from '../encodings/regex.js';
// Import vocab from o200k_base (same vocabulary)
import { VOCAB } from '../encodings/generated/o200k_base.js';
import { createChatEncoder } from './chat-encoding.js';
import type { ChatMessage } from '../types.js';
import type { SpecialTokenHandling } from '../bpe/types.js';

const ENCODING = 'o200k_harmony' as const;

let tokenizer: BPETokenizer | null = null;
let chatEncoder: ReturnType<typeof createChatEncoder> | null = null;

function getTokenizer(): BPETokenizer {
  if (!tokenizer) {
    tokenizer = new BPETokenizer({
      vocabDecoder: VOCAB,
      specialTokenMap: getSpecialTokenMap(ENCODING), // Different special tokens!
      tokenSplitRegex: getTokenSplitRegex(ENCODING),
    });
  }
  return tokenizer;
}

function getChatEncoder() {
  if (!chatEncoder) {
    chatEncoder = createChatEncoder(getTokenizer(), ENCODING);
  }
  return chatEncoder;
}

// ... same exports as o200k_base (encode, decode, encodeGenerator, etc.)
```

### Phase 2: Configure Build

#### 2.1 Update `package.json` scripts

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts",
    "build:browser:clean": "rm -rf dist/browser && mkdir -p dist/browser",
    "build:browser": "npm run build:browser:clean && npm run build:browser:o200k_base && npm run build:browser:o200k_harmony && npm run build:browser:cl100k && npm run build:browser:p50k && npm run build:browser:p50k_edit && npm run build:browser:r50k && npm run build:browser:verify",
    "build:browser:o200k_base": "tsup src/browser/o200k_base.ts --format iife --globalName AITokenEstimator_o200k_base --outDir dist/browser --minify",
    "build:browser:o200k_harmony": "tsup src/browser/o200k_harmony.ts --format iife --globalName AITokenEstimator_o200k_harmony --outDir dist/browser --minify",
    "build:browser:cl100k": "tsup src/browser/cl100k_base.ts --format iife --globalName AITokenEstimator_cl100k_base --outDir dist/browser --minify",
    "build:browser:p50k": "tsup src/browser/p50k_base.ts --format iife --globalName AITokenEstimator_p50k_base --outDir dist/browser --minify",
    "build:browser:p50k_edit": "tsup src/browser/p50k_edit.ts --format iife --globalName AITokenEstimator_p50k_edit --outDir dist/browser --minify",
    "build:browser:r50k": "tsup src/browser/r50k_base.ts --format iife --globalName AITokenEstimator_r50k_base --outDir dist/browser --minify",
    "build:browser:verify": "node scripts/verify-browser-bundles.mjs",
    "build:all": "npm run build && npm run build:browser",
    "test:browser-bundles": "npm run build:all && node scripts/test-browser-bundles.mjs",
    "prepublishOnly": "npm run lint && npm run test && npm run build:all && npm run test:dist && npm run test:browser-bundles && npm run verify:hashes"
  }
}
```

Key changes:
- `build:browser:clean` removes and recreates `dist/browser/` before building (prevents stale files)
- `build:browser:verify` runs after all bundles to verify expected output filenames exist
- Output to `dist/browser/` (not `dist/`)
- Separate `o200k_harmony` bundle
- `build:all` runs both Node and browser builds
- `test:browser-bundles` runs `build:all` first (so main API is available for parity tests)
- `prepublishOnly` includes browser builds and tests

#### 2.2 Create `scripts/verify-browser-bundles.mjs`

Verify that tsup produced the expected output filenames (tsup IIFE output naming can vary):

```javascript
import { existsSync, readdirSync, renameSync } from 'node:fs';

const EXPECTED_BUNDLES = [
  'o200k_base.js',
  'o200k_harmony.js',
  'cl100k_base.js',
  'p50k_base.js',
  'p50k_edit.js',
  'r50k_base.js',
];

const DIST_BROWSER = 'dist/browser';

// Check what files exist
const files = readdirSync(DIST_BROWSER);
console.log('Files in dist/browser:', files);

for (const expected of EXPECTED_BUNDLES) {
  const expectedPath = `${DIST_BROWSER}/${expected}`;

  if (existsSync(expectedPath)) {
    console.log(`✓ ${expected}`);
    continue;
  }

  // tsup may output as <name>.global.js or <name>.iife.js - try to find and rename
  const baseName = expected.replace('.js', '');
  const alternatives = [
    `${baseName}.global.js`,
    `${baseName}.iife.js`,
  ];

  let found = false;
  for (const alt of alternatives) {
    const altPath = `${DIST_BROWSER}/${alt}`;
    if (existsSync(altPath)) {
      console.log(`  Renaming ${alt} -> ${expected}`);
      renameSync(altPath, expectedPath);
      found = true;
      break;
    }
  }

  if (!found) {
    throw new Error(`Missing browser bundle: ${expected} (checked: ${alternatives.join(', ')})`);
  }

  console.log(`✓ ${expected}`);
}

console.log('\n✓ All browser bundles verified');
```

#### 2.3 Do NOT add unpkg/jsdelivr fields

Do not set package-level `unpkg` or `jsdelivr` fields. Document explicit CDN URLs instead.

### Phase 3: Update Documentation

#### 3.1 Add Browser Usage section to README

```markdown
## Browser Usage (CDN)

Use ai-token-estimator directly in the browser via unpkg or jsdelivr:

```html
<!-- For modern models (GPT-4o, o1, o3) -->
<script src="https://unpkg.com/ai-token-estimator/dist/browser/o200k_base.js"></script>
<script>
  const { encode, decode, countTokens } = AITokenEstimator_o200k_base;

  const tokens = encode('Hello, world!');
  console.log('Token count:', tokens.length);
  console.log('Decoded:', decode(tokens));
</script>
```

### Available Bundles

| CDN URL | Global Name | Models |
|---------|-------------|--------|
| `.../dist/browser/o200k_base.js` | `AITokenEstimator_o200k_base` | GPT-4o, o1, o3, GPT-4.1 |
| `.../dist/browser/o200k_harmony.js` | `AITokenEstimator_o200k_harmony` | Harmony models |
| `.../dist/browser/cl100k_base.js` | `AITokenEstimator_cl100k_base` | GPT-4, GPT-3.5-turbo |
| `.../dist/browser/p50k_base.js` | `AITokenEstimator_p50k_base` | text-davinci-003 |
| `.../dist/browser/r50k_base.js` | `AITokenEstimator_r50k_base` | GPT-2, GPT-3 |

### Browser API

Each bundle exports:
- `encode(text, options?)` - Encode text to token IDs
- `decode(tokens)` - Decode token IDs to text
- `encodeChat(messages, options?)` - Encode chat messages
- `encodeGenerator(text, options?)` - Streaming encode
- `encodeChatGenerator(messages, options?)` - Streaming chat encode
- `decodeGenerator(tokens)` - Streaming decode
- `decodeAsyncGenerator(tokens)` - Async streaming decode
- `isWithinTokenLimit(text, limit, options?)` - Check if text fits within limit
- `isChatWithinTokenLimit({ messages, tokenLimit, primeAssistant? })` - Check if chat fits within limit
- `countTokens(text)` - Count tokens in text (returns number)
```

### Phase 4: Testing

#### 4.1 Create source module tests (`tests/browser-bundles.test.ts`)

Test the TypeScript source modules for correctness:

```typescript
import { describe, it, expect } from 'vitest';

describe('browser entry point modules', () => {
  it('o200k_base exports all expected functions', async () => {
    const bundle = await import('../src/browser/o200k_base.js');
    expect(typeof bundle.encode).toBe('function');
    expect(typeof bundle.decode).toBe('function');
    expect(typeof bundle.encodeGenerator).toBe('function');
    expect(typeof bundle.decodeGenerator).toBe('function');
    expect(typeof bundle.decodeAsyncGenerator).toBe('function');
    expect(typeof bundle.isWithinTokenLimit).toBe('function');
    expect(typeof bundle.isChatWithinTokenLimit).toBe('function');
    expect(typeof bundle.countTokens).toBe('function');
    expect(typeof bundle.encodeChat).toBe('function');
    expect(typeof bundle.encodeChatGenerator).toBe('function');
  });

  it('encode/decode roundtrip works', async () => {
    const { encode, decode } = await import('../src/browser/o200k_base.js');
    const text = 'Hello, world!';
    const tokens = encode(text);
    expect(decode(tokens)).toBe(text);
  });

  it('matches main API output', async () => {
    const browser = await import('../src/browser/o200k_base.js');
    const main = await import('../src/index.js');

    const text = 'Test encoding parity';
    expect(browser.encode(text)).toEqual(main.encode(text, { encoding: 'o200k_base' }));
  });

  it('o200k_harmony has different special tokens than o200k_base', async () => {
    const base = await import('../src/browser/o200k_base.js');
    const harmony = await import('../src/browser/o200k_harmony.js');

    // Regular text should encode identically (same vocab)
    const text = 'Hello world';
    expect(harmony.encode(text)).toEqual(base.encode(text));

    // But special token handling differs (tested via encodeChat behavior)
  });
});
```

#### 4.2 Create IIFE bundle artifact tests (`scripts/test-browser-bundles.mjs`)

Test the actual built IIFE bundles using node:vm to simulate browser global loading.
Tests all exported APIs for parity with main library:

```javascript
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import {
  encode,
  decode,
  encodeGenerator,
  decodeGenerator,
  isWithinTokenLimit,
  encodeChat,
  encodeChatGenerator,
  isChatWithinTokenLimit,
} from '../dist/index.js';

const ENCODINGS = ['o200k_base', 'o200k_harmony', 'cl100k_base', 'p50k_base', 'p50k_edit', 'r50k_base'];

// Chat-capable encodings
const CHAT_ENCODINGS = new Set(['o200k_base', 'o200k_harmony', 'cl100k_base']);

for (const encoding of ENCODINGS) {
  console.log(`\nTesting ${encoding}...`);
  const bundlePath = `dist/browser/${encoding}.js`;
  const bundleCode = readFileSync(bundlePath, 'utf-8');

  // Create a fresh global context
  const context = { globalThis: {}, console };
  context.globalThis = context;
  createContext(context);

  // Run the IIFE bundle
  runInContext(bundleCode, context);

  // Access the global
  const globalName = `AITokenEstimator_${encoding}`;
  const bundle = context[globalName];

  if (!bundle) {
    throw new Error(`${bundlePath}: global ${globalName} not defined`);
  }

  // Test text
  const text = 'Hello, world! Testing browser bundle with some longer text for generators.';

  // 1. Test encode/decode parity
  const browserTokens = bundle.encode(text);
  const mainTokens = encode(text, { encoding });
  if (JSON.stringify(browserTokens) !== JSON.stringify(mainTokens)) {
    throw new Error(`${encoding}: encode() output mismatch`);
  }
  console.log(`  ✓ encode() parity`);

  const decoded = bundle.decode(browserTokens);
  if (decoded !== text) {
    throw new Error(`${encoding}: decode() roundtrip failed`);
  }
  console.log(`  ✓ decode() roundtrip`);

  // 2. Test countTokens
  const count = bundle.countTokens(text);
  if (count !== browserTokens.length) {
    throw new Error(`${encoding}: countTokens() mismatch`);
  }
  console.log(`  ✓ countTokens()`);

  // 3. Test encodeGenerator - flatten and compare
  const genChunks = [...bundle.encodeGenerator(text)];
  const genFlattened = genChunks.flat();
  if (JSON.stringify(genFlattened) !== JSON.stringify(mainTokens)) {
    throw new Error(`${encoding}: encodeGenerator() flattened output mismatch`);
  }
  console.log(`  ✓ encodeGenerator() flattened equals encode()`);

  // 4. Test decodeGenerator - join and compare
  const decodeChunks = [...bundle.decodeGenerator(browserTokens)];
  const decodeJoined = decodeChunks.join('');
  if (decodeJoined !== text) {
    throw new Error(`${encoding}: decodeGenerator() joined output mismatch`);
  }
  console.log(`  ✓ decodeGenerator() joined equals decode()`);

  // 5. Test decodeAsyncGenerator - async stream of token chunks
  {
    // Create async iterable that yields token arrays (simulating streaming LLM response)
    async function* tokenChunkStream() {
      // Split tokens into chunks to simulate streaming
      const chunkSize = Math.ceil(browserTokens.length / 3);
      for (let i = 0; i < browserTokens.length; i += chunkSize) {
        yield browserTokens.slice(i, i + chunkSize);
      }
    }

    const asyncDecodeChunks = [];
    for await (const chunk of bundle.decodeAsyncGenerator(tokenChunkStream())) {
      asyncDecodeChunks.push(chunk);
    }
    const asyncDecodeJoined = asyncDecodeChunks.join('');
    if (asyncDecodeJoined !== text) {
      throw new Error(`${encoding}: decodeAsyncGenerator() joined output mismatch`);
    }
    console.log(`  ✓ decodeAsyncGenerator() joined equals decode()`);
  }

  // 7. Test isWithinTokenLimit
  const withinLimit = bundle.isWithinTokenLimit(text, 1000);
  const mainWithinLimit = isWithinTokenLimit(text, 1000, { encoding });
  if (withinLimit !== mainWithinLimit) {
    throw new Error(`${encoding}: isWithinTokenLimit() mismatch`);
  }
  const exceedsLimit = bundle.isWithinTokenLimit(text, 1);
  if (exceedsLimit !== false) {
    throw new Error(`${encoding}: isWithinTokenLimit() should return false when exceeded`);
  }
  console.log(`  ✓ isWithinTokenLimit()`);

  // 8. Test chat functions (only for chat-capable encodings)
  if (CHAT_ENCODINGS.has(encoding)) {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello!' },
    ];

    // encodeChat parity
    const browserChatTokens = bundle.encodeChat(messages);
    const mainChatTokens = encodeChat(messages, { encoding });
    if (JSON.stringify(browserChatTokens) !== JSON.stringify(mainChatTokens)) {
      throw new Error(`${encoding}: encodeChat() output mismatch`);
    }
    console.log(`  ✓ encodeChat() parity`);

    // encodeChatGenerator - flatten and compare
    const chatGenChunks = [...bundle.encodeChatGenerator(messages)];
    const chatGenFlattened = chatGenChunks.flat();
    if (JSON.stringify(chatGenFlattened) !== JSON.stringify(mainChatTokens)) {
      throw new Error(`${encoding}: encodeChatGenerator() flattened output mismatch`);
    }
    console.log(`  ✓ encodeChatGenerator() flattened equals encodeChat()`);

    // isChatWithinTokenLimit (object-style input)
    const chatWithinLimit = bundle.isChatWithinTokenLimit({ messages, tokenLimit: 1000 });
    if (chatWithinLimit === false || chatWithinLimit !== browserChatTokens.length) {
      throw new Error(`${encoding}: isChatWithinTokenLimit() count mismatch`);
    }
    const chatExceedsLimit = bundle.isChatWithinTokenLimit({ messages, tokenLimit: 1 });
    if (chatExceedsLimit !== false) {
      throw new Error(`${encoding}: isChatWithinTokenLimit() should return false when exceeded`);
    }
    console.log(`  ✓ isChatWithinTokenLimit()`);
  }

  console.log(`  ✓ All tests passed for ${encoding}`);
}

console.log('\n✓ All browser bundle tests passed!');
```

#### 4.3 Create bundle size test

```typescript
import { statSync } from 'fs';
import { describe, it, expect } from 'vitest';

describe('browser bundle sizes', () => {
  const MAX_BUNDLE_SIZE = 3 * 1024 * 1024; // 3MB max per bundle

  const bundles = [
    'dist/browser/o200k_base.js',
    'dist/browser/o200k_harmony.js',
    'dist/browser/cl100k_base.js',
    'dist/browser/p50k_base.js',
    'dist/browser/p50k_edit.js',
    'dist/browser/r50k_base.js',
  ];

  for (const bundle of bundles) {
    it(`${bundle} is reasonably sized`, () => {
      const stats = statSync(bundle);
      expect(stats.size).toBeLessThan(MAX_BUNDLE_SIZE);
      console.log(`  ${bundle}: ${(stats.size / 1024).toFixed(1)} KB`);
    });
  }
});
```

### Phase 5: Minification and Source Maps

#### 5.1 Minify bundles

tsup supports minification via `--minify` flag (already in build scripts above).

#### 5.2 Add source maps for debugging

```json
"build:browser:o200k_base": "tsup src/browser/o200k_base.ts --format iife --globalName AITokenEstimator_o200k_base --outDir dist/browser --minify --sourcemap"
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/browser/o200k_base.ts` | Create | Browser entry for o200k_base encoding |
| `src/browser/o200k_harmony.ts` | Create | Browser entry for o200k_harmony encoding |
| `src/browser/cl100k_base.ts` | Create | Browser entry for cl100k_base encoding |
| `src/browser/p50k_base.ts` | Create | Browser entry for p50k_base encoding |
| `src/browser/p50k_edit.ts` | Create | Browser entry for p50k_edit encoding |
| `src/browser/r50k_base.ts` | Create | Browser entry for r50k_base encoding |
| `src/browser/chat-encoding.ts` | Create | Shared chat encoding logic for browser |
| `package.json` | Modify | Add build:browser scripts, update prepublishOnly |
| `README.md` | Modify | Add Browser Usage section |
| `tests/browser-bundles.test.ts` | Create | Tests for browser source modules |
| `scripts/verify-browser-bundles.mjs` | Create | Verify/rename bundle output filenames |
| `scripts/test-browser-bundles.mjs` | Create | Tests for built IIFE artifacts via node:vm |
| `.changeset/browser-bundles.md` | Create | Changeset for minor version bump |

---

## Expected Bundle Sizes (Estimated)

| Bundle | Minified | Gzipped |
|--------|----------|---------|
| o200k_base.js | ~1.8MB | ~400KB |
| o200k_harmony.js | ~1.8MB | ~400KB |
| cl100k_base.js | ~700KB | ~200KB |
| p50k_base.js | ~350KB | ~100KB |
| p50k_edit.js | ~350KB | ~100KB |
| r50k_base.js | ~350KB | ~100KB |

Note: These are estimates. Actual sizes depend on vocabulary compression in the bundled output.
