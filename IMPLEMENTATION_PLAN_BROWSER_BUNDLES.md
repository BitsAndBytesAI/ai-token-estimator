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
- `isChatWithinTokenLimit(messages, limit, options?)` - Fast chat limit check
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
import { O200K_BASE_VOCAB } from '../encodings/generated/o200k_base.js';
import type { ChatMessage } from '../types.js';
import type { SpecialTokenHandling } from '../bpe/types.js';

const ENCODING = 'o200k_base' as const;

// Lazily initialized tokenizer
let tokenizer: BPETokenizer | null = null;

function getTokenizer(): BPETokenizer {
  if (!tokenizer) {
    tokenizer = new BPETokenizer({
      vocabDecoder: O200K_BASE_VOCAB,
      specialTokenMap: getSpecialTokenMap(ENCODING),
      tokenSplitRegex: getTokenSplitRegex(ENCODING),
    });
  }
  return tokenizer;
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

// encodeChat, encodeChatGenerator, isChatWithinTokenLimit
// ... (see Phase 1.2)
```

#### 1.2 Create `src/browser/chat-encoding.ts`

Shared chat encoding logic that works with a pre-configured tokenizer (avoids importing all encodings):

```typescript
import type { BPETokenizer } from '../bpe/core.js';
import type { ChatMessage } from '../types.js';

// ChatML special token IDs by encoding
const CHAT_TOKENS: Record<string, { imStart: number; imEnd: number; imSep: number }> = {
  cl100k_base: { imStart: 100264, imEnd: 100265, imSep: 100266 },
  o200k_base: { imStart: 200264, imEnd: 200265, imSep: 200266 },
  o200k_harmony: { start: 200006, end: 200007, message: 200008 },
};

export function createChatEncoder(tokenizer: BPETokenizer, encoding: string) {
  const chatTokens = CHAT_TOKENS[encoding];
  if (!chatTokens) {
    throw new Error(`Encoding "${encoding}" does not support chat format.`);
  }

  return {
    encodeChat(messages: ChatMessage[], options?: { primeAssistant?: boolean }): number[] {
      // Implementation using tokenizer and chatTokens...
    },
    *encodeChatGenerator(messages: Iterable<ChatMessage>, options?: { primeAssistant?: boolean }) {
      // Generator implementation...
    },
    isChatWithinTokenLimit(messages: ChatMessage[], limit: number, options?: { primeAssistant?: boolean }): number | false {
      // Fast limit check implementation...
    }
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
import { O200K_BASE_VOCAB } from '../encodings/generated/o200k_base.js';

const ENCODING = 'o200k_harmony' as const;

let tokenizer: BPETokenizer | null = null;

function getTokenizer(): BPETokenizer {
  if (!tokenizer) {
    tokenizer = new BPETokenizer({
      vocabDecoder: O200K_BASE_VOCAB,
      specialTokenMap: getSpecialTokenMap(ENCODING), // Different special tokens!
      tokenSplitRegex: getTokenSplitRegex(ENCODING),
    });
  }
  return tokenizer;
}

// ... same exports as o200k_base
```

### Phase 2: Configure Build

#### 2.1 Update `package.json` scripts

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts",
    "build:browser": "npm run build:browser:o200k_base && npm run build:browser:o200k_harmony && npm run build:browser:cl100k && npm run build:browser:p50k && npm run build:browser:p50k_edit && npm run build:browser:r50k",
    "build:browser:o200k_base": "tsup src/browser/o200k_base.ts --format iife --globalName AITokenEstimator_o200k_base --outDir dist/browser --minify",
    "build:browser:o200k_harmony": "tsup src/browser/o200k_harmony.ts --format iife --globalName AITokenEstimator_o200k_harmony --outDir dist/browser --minify",
    "build:browser:cl100k": "tsup src/browser/cl100k_base.ts --format iife --globalName AITokenEstimator_cl100k_base --outDir dist/browser --minify",
    "build:browser:p50k": "tsup src/browser/p50k_base.ts --format iife --globalName AITokenEstimator_p50k_base --outDir dist/browser --minify",
    "build:browser:p50k_edit": "tsup src/browser/p50k_edit.ts --format iife --globalName AITokenEstimator_p50k_edit --outDir dist/browser --minify",
    "build:browser:r50k": "tsup src/browser/r50k_base.ts --format iife --globalName AITokenEstimator_r50k_base --outDir dist/browser --minify",
    "build:all": "npm run build && npm run build:browser",
    "test:browser-bundles": "npm run build:browser && node scripts/test-browser-bundles.mjs",
    "prepublishOnly": "npm run lint && npm run test && npm run build:all && npm run test:dist && npm run test:browser-bundles && npm run verify:hashes"
  }
}
```

Key changes:
- Output to `dist/browser/` (not `dist/`)
- Separate `o200k_harmony` bundle
- `build:all` runs both Node and browser builds
- `test:browser-bundles` tests the actual IIFE artifacts
- `prepublishOnly` includes browser builds and tests

#### 2.2 Do NOT add unpkg/jsdelivr fields

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
- `isChatWithinTokenLimit(messages, limit, options?)` - Check if chat fits within limit
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

Test the actual built IIFE bundles using node:vm to simulate browser global loading:

```javascript
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { encode } from '../dist/index.js';

const ENCODINGS = ['o200k_base', 'o200k_harmony', 'cl100k_base', 'p50k_base', 'p50k_edit', 'r50k_base'];

for (const encoding of ENCODINGS) {
  const bundlePath = `dist/browser/${encoding}.js`;
  const bundleCode = readFileSync(bundlePath, 'utf-8');

  // Create a fresh global context
  const context = { globalThis: {} };
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

  // Test encode/decode parity with main API
  const text = 'Hello, world! Testing browser bundle.';
  const browserTokens = bundle.encode(text);
  const mainTokens = encode(text, { encoding });

  if (JSON.stringify(browserTokens) !== JSON.stringify(mainTokens)) {
    throw new Error(`${bundlePath}: encode() output mismatch with main API`);
  }

  const decoded = bundle.decode(browserTokens);
  if (decoded !== text) {
    throw new Error(`${bundlePath}: decode() roundtrip failed`);
  }

  // Test countTokens
  const count = bundle.countTokens(text);
  if (count !== browserTokens.length) {
    throw new Error(`${bundlePath}: countTokens() mismatch`);
  }

  console.log(`✓ ${bundlePath} (${globalName})`);
}

console.log('\nAll browser bundle tests passed!');
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
