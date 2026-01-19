# Implementation Plan: Browser-First Distribution with UMD Bundles

## Goal

Provide browser-ready UMD bundles for ai-token-estimator that can be used via unpkg/CDN, matching gpt-tokenizer's distribution pattern:

```html
<script src="https://unpkg.com/ai-token-estimator/dist/o200k_base.js"></script>
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

### 1. Per-Encoding UMD Bundles

Create separate UMD bundles for each encoding to avoid loading unnecessary vocabulary data:

| Bundle | Global Name | Primary Use Case |
|--------|-------------|------------------|
| `dist/o200k_base.js` | `AITokenEstimator_o200k_base` | GPT-4o, o1, o3, GPT-4.1 |
| `dist/cl100k_base.js` | `AITokenEstimator_cl100k_base` | GPT-4, GPT-3.5-turbo |
| `dist/p50k_base.js` | `AITokenEstimator_p50k_base` | Legacy models |
| `dist/p50k_edit.js` | `AITokenEstimator_p50k_edit` | Legacy edit models |
| `dist/r50k_base.js` | `AITokenEstimator_r50k_base` | Legacy GPT-2/3 |

Note: `o200k_harmony` is re-exported from `o200k_base` (same vocab, different special tokens).

### 2. Bundle Contents (Per-Encoding)

Each encoding bundle exports:
- `encode(text, options?)` - Encode text to tokens
- `decode(tokens, options?)` - Decode tokens to text
- `encodeChat(messages, options?)` - Encode chat messages (ChatML)
- `encodeGenerator(text, options?)` - Streaming encode
- `encodeChatGenerator(messages, options?)` - Streaming chat encode
- `decodeGenerator(tokens, options?)` - Streaming decode
- `isWithinTokenLimit(text, limit, options?)` - Fast limit check
- `countTokens(input)` - Simple token counter

**Excluded from browser bundles** (Node.js only):
- SentencePiece APIs (require file system for model loading)
- Provider APIs (require API keys/network)
- `estimateAsync` (uses provider APIs)
- Cost estimation (server-side concern)

### 3. Build Approach

Use **tsup** (already installed) with multiple entry points:

```bash
# Add to package.json scripts
"build:umd": "tsup src/browser/o200k_base.ts src/browser/cl100k_base.ts ... --format iife --globalName AITokenEstimator_${encoding}"
```

tsup supports IIFE format which is equivalent to UMD for browser usage.

### 4. Entry Point Structure

Create new browser-specific entry points:

```
src/
├── browser/
│   ├── o200k_base.ts      # Entry for o200k_base bundle
│   ├── cl100k_base.ts     # Entry for cl100k_base bundle
│   ├── p50k_base.ts       # Entry for p50k_base bundle
│   ├── p50k_edit.ts       # Entry for p50k_edit bundle
│   ├── r50k_base.ts       # Entry for r50k_base bundle
│   └── shared.ts          # Shared browser-safe exports
```

Each entry file:
1. Imports only the vocabulary for that encoding
2. Creates a pre-configured tokenizer
3. Exports browser-safe functions bound to that encoding

---

## Implementation Steps

### Phase 1: Create Browser Entry Points

#### 1.1 Create `src/browser/shared.ts`

Shared browser-safe utilities and types:

```typescript
// Re-export browser-safe types
export type { ChatMessage } from '../types.js';
export type { EncodeOptions, SpecialTokenHandling } from '../bpe/types.js';

// Re-export core tokenizer class and utilities
export { BPETokenizer } from '../bpe/core.js';
export { getSpecialTokenMap } from '../bpe/special-tokens.js';
export { getTokenSplitRegex } from '../encodings/regex.js';
```

#### 1.2 Create encoding-specific entry (example: `src/browser/o200k_base.ts`)

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

// encodeChat and encodeChatGenerator need to be implemented
// by inlining the chat encoding logic (to avoid importing all encodings)
// ... (see Phase 1.3)
```

#### 1.3 Inline Chat Encoding for Browser Bundles

The current `encodeChat` imports `getOpenAIEncoding` which pulls in all encodings. For browser bundles, we need a simplified version that works with a fixed encoding.

Create chat encoding helpers in each browser entry that use the pre-configured tokenizer directly.

### Phase 2: Configure Build

#### 2.1 Update `package.json` scripts

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts",
    "build:browser": "npm run build:browser:o200k && npm run build:browser:cl100k && npm run build:browser:p50k && npm run build:browser:p50k_edit && npm run build:browser:r50k",
    "build:browser:o200k": "tsup src/browser/o200k_base.ts --format iife --globalName AITokenEstimator_o200k_base --outDir dist --minify",
    "build:browser:cl100k": "tsup src/browser/cl100k_base.ts --format iife --globalName AITokenEstimator_cl100k_base --outDir dist --minify",
    "build:browser:p50k": "tsup src/browser/p50k_base.ts --format iife --globalName AITokenEstimator_p50k_base --outDir dist --minify",
    "build:browser:p50k_edit": "tsup src/browser/p50k_edit.ts --format iife --globalName AITokenEstimator_p50k_edit --outDir dist --minify",
    "build:browser:r50k": "tsup src/browser/r50k_base.ts --format iife --globalName AITokenEstimator_r50k_base --outDir dist --minify",
    "build:all": "npm run build && npm run build:browser"
  }
}
```

#### 2.2 Update `package.json` exports and unpkg field

```json
{
  "unpkg": "dist/o200k_base.js",
  "jsdelivr": "dist/o200k_base.js",
  "files": [
    "dist",
    "LICENSE",
    "README.md"
  ]
}
```

### Phase 3: Update Documentation

#### 3.1 Add Browser Usage section to README

```markdown
## Browser Usage (CDN)

Use ai-token-estimator directly in the browser via unpkg:

```html
<!-- For modern models (GPT-4o, o1, o3) -->
<script src="https://unpkg.com/ai-token-estimator/dist/o200k_base.js"></script>
<script>
  const { encode, decode, countTokens } = AITokenEstimator_o200k_base;

  const tokens = encode('Hello, world!');
  console.log('Token count:', tokens.length);
  console.log('Decoded:', decode(tokens));
</script>
```

### Available Bundles

| Bundle | Global Name | Models |
|--------|-------------|--------|
| `dist/o200k_base.js` | `AITokenEstimator_o200k_base` | GPT-4o, o1, o3, GPT-4.1 |
| `dist/cl100k_base.js` | `AITokenEstimator_cl100k_base` | GPT-4, GPT-3.5-turbo |
| `dist/p50k_base.js` | `AITokenEstimator_p50k_base` | text-davinci-003 |
| `dist/r50k_base.js` | `AITokenEstimator_r50k_base` | GPT-2, GPT-3 |

### Browser API

Each bundle exports:
- `encode(text, options?)` - Encode text to token IDs
- `decode(tokens)` - Decode token IDs to text
- `encodeChat(messages, options?)` - Encode chat messages
- `encodeGenerator(text, options?)` - Streaming encode
- `decodeGenerator(tokens)` - Streaming decode
- `isWithinTokenLimit(text, limit, options?)` - Check if text fits within limit
- `countTokens(text)` - Count tokens in text
```

### Phase 4: Testing

#### 4.1 Create browser bundle tests

Create `tests/browser-bundles.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// Test that browser entry points export expected functions
describe('browser bundle exports', () => {
  it('o200k_base exports all expected functions', async () => {
    const bundle = await import('../src/browser/o200k_base.js');
    expect(typeof bundle.encode).toBe('function');
    expect(typeof bundle.decode).toBe('function');
    expect(typeof bundle.encodeGenerator).toBe('function');
    expect(typeof bundle.decodeGenerator).toBe('function');
    expect(typeof bundle.isWithinTokenLimit).toBe('function');
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
});
```

#### 4.2 Create bundle size test

Verify bundles are reasonably sized (not accidentally including all vocabs):

```typescript
import { statSync } from 'fs';
import { describe, it, expect } from 'vitest';

describe('browser bundle sizes', () => {
  const MAX_BUNDLE_SIZE = 3 * 1024 * 1024; // 3MB max per bundle

  it('o200k_base bundle is reasonably sized', () => {
    const stats = statSync('dist/o200k_base.js');
    expect(stats.size).toBeLessThan(MAX_BUNDLE_SIZE);
  });

  // Similar tests for other bundles...
});
```

### Phase 5: Minification and Optimization

#### 5.1 Minify bundles

tsup supports minification via `--minify` flag (already in build scripts above).

#### 5.2 Consider source maps

Add `--sourcemap` for debugging:

```json
"build:browser:o200k": "tsup src/browser/o200k_base.ts --format iife --globalName AITokenEstimator_o200k_base --outDir dist --minify --sourcemap"
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/browser/o200k_base.ts` | Create | Browser entry for o200k_base encoding |
| `src/browser/cl100k_base.ts` | Create | Browser entry for cl100k_base encoding |
| `src/browser/p50k_base.ts` | Create | Browser entry for p50k_base encoding |
| `src/browser/p50k_edit.ts` | Create | Browser entry for p50k_edit encoding |
| `src/browser/r50k_base.ts` | Create | Browser entry for r50k_base encoding |
| `src/browser/chat-encoding.ts` | Create | Shared chat encoding logic for browser |
| `package.json` | Modify | Add build:browser scripts, unpkg field |
| `README.md` | Modify | Add Browser Usage section |
| `tests/browser-bundles.test.ts` | Create | Tests for browser bundles |
| `.changeset/browser-bundles.md` | Create | Changeset for minor version bump |

---

## Expected Bundle Sizes (Estimated)

| Bundle | Unminified | Minified | Gzipped |
|--------|------------|----------|---------|
| o200k_base.js | ~2.5MB | ~1.8MB | ~400KB |
| cl100k_base.js | ~1.0MB | ~700KB | ~200KB |
| p50k_base.js | ~500KB | ~350KB | ~100KB |
| p50k_edit.js | ~500KB | ~350KB | ~100KB |
| r50k_base.js | ~500KB | ~350KB | ~100KB |

Note: These are estimates. Actual sizes depend on vocabulary compression in the bundled output.

---

## Open Questions / Decisions Needed

1. **o200k_harmony**: Should it have its own bundle or be included in o200k_base?
   - Recommendation: Include in o200k_base since vocab is identical (just re-export with different default)

2. **Default bundle for unpkg field**: Which encoding should `unpkg: "dist/???.js"` point to?
   - Recommendation: `o200k_base` (most modern, used by GPT-4o)

3. **isChatWithinTokenLimit**: Include in browser bundles?
   - Recommendation: Yes, it's useful for browser apps

4. **Async generator (decodeAsyncGenerator)**: Include in browser bundles?
   - Recommendation: Yes, useful for streaming LLM responses in browser
