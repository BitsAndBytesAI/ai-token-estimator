# Implementation Plan: Generator-Based APIs

## Overview

Add generator-based APIs for streaming tokenization, matching `gpt-tokenizer` feature parity:
- `encodeGenerator(text, options)` - yields token chunks during encoding
- `encodeChatGenerator(messages, options)` - yields token chunks for chat messages
- `decodeGenerator(tokens)` - yields text chunks during decoding
- `decodeAsyncGenerator(asyncTokens)` - yields text chunks from async token streams

## Why Generators?

Generators provide memory-efficient streaming for:
1. **Large inputs**: Process gigabyte-scale text without loading all tokens into memory
2. **Streaming pipelines**: Chain with other generators/transforms
3. **Progress tracking**: Monitor encoding progress for long-running operations
4. **Early termination**: Consumer can stop iteration without encoding the full input
5. **Async decoding**: Decode tokens as they arrive from streaming LLM responses

## API Signatures (gpt-tokenizer parity)

```typescript
// Encode text, yielding token chunks
function encodeGenerator(
  text: string,
  options?: EncodeOptions
): Generator<number[], number, undefined>;
// Yields: arrays of token IDs per regex-matched piece
// Return value: total token count

// Encode chat messages, yielding token chunks
function encodeChatGenerator(
  messages: ChatMessage[] | Iterable<ChatMessage>,
  options?: EncodeChatOptions
): Generator<number[], number, undefined>;
// Yields: arrays of token IDs (per message component)
// Return value: total token count

// Decode tokens, yielding text chunks
function decodeGenerator(
  tokens: Iterable<number>,
  options?: DecodeOptions
): Generator<string, void, void>;
// Yields: text chunks (may yield empty strings when buffering incomplete UTF-8)

// Decode async token stream, yielding text chunks
function decodeAsyncGenerator(
  tokens: AsyncIterable<number | number[]>,
  options?: DecodeOptions
): AsyncGenerator<string, void, void>;
// Yields: text chunks as tokens arrive (may yield empty strings)
```

## Architecture: Generator Methods in BPETokenizer

**Key principle**: Generator logic lives in `BPETokenizer` (not in `openai-bpe.ts`), reusing the exact same special-token scanning, cache logic, and byte handling as existing `encodeText()` and `decodeTokens()` methods. The `EncodingApi` interface exposes these via wrapper methods, and `openai-bpe.ts` simply delegates after resolving encoding/options.

This avoids:
- Duplicating special-token splitting logic
- Exposing internal getters (`getTokenSplitRegex`, `encodePiece`, etc.)
- API drift between generator and non-generator paths

## Implementation Details

### 1. BPETokenizer Generator Methods (src/bpe/core.ts)

Add generator methods that share the exact same internal logic as their non-generator counterparts:

```typescript
/**
 * Generator version of encodeText. Yields token arrays per regex-matched piece.
 * Returns total token count.
 */
*encodeTextGenerator(
  text: string,
  allowedSpecial?: Set<string> | 'all' | 'skip'
): Generator<number[], number, undefined> {
  if (!text) return 0;

  let totalTokens = 0;

  // Skip special token handling if requested
  if (allowedSpecial === 'skip') {
    const gen = this.encodeOrdinaryGenerator(text);
    let result = gen.next();
    while (!result.done) {
      yield result.value;
      totalTokens += result.value.length;
      result = gen.next();
    }
    return totalTokens;
  }

  // Process special tokens (reuse exact same splitOnSpecialTokens logic)
  if (this.specialTokenMap.size > 0) {
    const parts = this.splitOnSpecialTokens(text, allowedSpecial);

    for (const part of parts) {
      if (part.isSpecial) {
        const tokenId = this.specialTokenMap.get(part.text)!;
        yield [tokenId];
        totalTokens += 1;
      } else {
        const gen = this.encodeOrdinaryGenerator(part.text);
        let result = gen.next();
        while (!result.done) {
          yield result.value;
          totalTokens += result.value.length;
          result = gen.next();
        }
      }
    }
  } else {
    const gen = this.encodeOrdinaryGenerator(text);
    let result = gen.next();
    while (!result.done) {
      yield result.value;
      totalTokens += result.value.length;
      result = gen.next();
    }
  }

  return totalTokens;
}

/**
 * Generator version of encodeOrdinary. Yields token arrays per regex piece.
 * Uses same cache logic as encodeOrdinary.
 */
private *encodeOrdinaryGenerator(text: string): Generator<number[], void, void> {
  if (!text) return;

  // Clone regex to avoid reentrancy issues (same as encodeOrdinaryWithLimit)
  const regex = new RegExp(
    this.tokenSplitRegex.source,
    this.tokenSplitRegex.flags.includes('g')
      ? this.tokenSplitRegex.flags
      : this.tokenSplitRegex.flags + 'g'
  );

  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const piece = match[0];

    if (piece.length === 0) {
      regex.lastIndex++;
      continue;
    }

    // Check cache first (with LRU touch) - same as encodeOrdinary
    const cached = this.getFromCache(piece);
    if (cached) {
      yield cached;
      continue;
    }

    // Convert to UTF-8 bytes then to latin-1 key for vocab lookup
    const pieceBytes = this.textEncoder.encode(piece);
    const key = bytesToLatin1(pieceBytes);

    // Try direct lookup first (most tokens are single entries)
    const directRank = this.encoder.get(key);
    if (directRank !== undefined) {
      const tokens = [directRank];
      this.addToCache(piece, tokens);
      yield tokens;
      continue;
    }

    // BPE merge
    const pieceTokens = this.mergeBytePairs(pieceBytes);
    this.addToCache(piece, pieceTokens);
    yield pieceTokens;
  }
}

/**
 * Generator version of decodeTokens. Yields text chunks.
 * Uses TextDecoder streaming mode to handle partial UTF-8 correctly.
 * May yield empty strings when buffering incomplete sequences.
 *
 * Streaming semantics:
 * - During iteration: decode(bytes, { stream: true }) - buffers incomplete UTF-8
 * - At end/flush: decode() with no stream flag (defaults to false) - emits buffered bytes
 */
*decodeTokensGenerator(tokens: Iterable<number>): Generator<string, void, void> {
  // Use streaming mode: decoder buffers incomplete UTF-8 sequences
  const streamingDecoder = new TextDecoder('utf-8', { fatal: false });

  for (const token of tokens) {
    // Check special tokens first
    const specialToken = this.specialTokenDecoder.get(token);
    if (specialToken !== undefined) {
      // Flush any pending bytes before special token (stream: false to emit buffered)
      const flushed = streamingDecoder.decode(new Uint8Array(0)); // no stream flag = flush
      if (flushed) yield flushed;

      // Special tokens are always complete UTF-8
      yield specialToken;
      continue;
    }

    // Regular token
    const tokenBytes = this.decoder.get(token);
    if (!tokenBytes) {
      throw new Error(
        `Invalid token ID: ${token}. Token not found in vocabulary or special tokens.`
      );
    }

    // Decode with stream:true - decoder buffers incomplete sequences
    const decoded = streamingDecoder.decode(tokenBytes, { stream: true });
    // May be empty string if bytes form incomplete UTF-8 sequence
    yield decoded;
  }

  // Flush any remaining buffered bytes (no stream flag = stream: false)
  const final = streamingDecoder.decode(); // emits buffered bytes
  if (final) yield final;
}

/**
 * Async generator version of decodeTokens.
 * Accepts AsyncIterable<number | number[]> for flexibility.
 *
 * Streaming semantics:
 * - During iteration: decode(bytes, { stream: true }) - buffers incomplete UTF-8
 * - At end/flush: decode() with no stream flag (defaults to false) - emits buffered bytes
 */
async *decodeTokensAsyncGenerator(
  tokens: AsyncIterable<number | number[]>
): AsyncGenerator<string, void, void> {
  const streamingDecoder = new TextDecoder('utf-8', { fatal: false });

  for await (const tokenOrChunk of tokens) {
    // Normalize to array
    const tokenArray = typeof tokenOrChunk === 'number' ? [tokenOrChunk] : tokenOrChunk;

    for (const token of tokenArray) {
      // Check special tokens first
      const specialToken = this.specialTokenDecoder.get(token);
      if (specialToken !== undefined) {
        // Flush any pending bytes before special token (no stream flag = flush)
        const flushed = streamingDecoder.decode(new Uint8Array(0));
        if (flushed) yield flushed;
        yield specialToken;
        continue;
      }

      // Regular token
      const tokenBytes = this.decoder.get(token);
      if (!tokenBytes) {
        throw new Error(
          `Invalid token ID: ${token}. Token not found in vocabulary or special tokens.`
        );
      }

      const decoded = streamingDecoder.decode(tokenBytes, { stream: true });
      yield decoded;
    }
  }

  // Flush remaining buffered bytes (no stream flag = stream: false)
  const final = streamingDecoder.decode();
  if (final) yield final;
}
```

### 2. EncodingApi Interface Updates (src/bpe/types.ts)

Extend `EncodingApi` to expose generator methods:

```typescript
export interface EncodingApi {
  encode: (text: string, allowedSpecial?: Set<string> | 'all' | 'skip') => number[];
  decode: (tokens: Iterable<number>) => string;
  encodeTextWithLimit: (
    text: string,
    limit: number,
    allowedSpecial?: Set<string> | 'all' | 'skip'
  ) => EncodeWithLimitResult;

  // Generator methods
  encodeGenerator: (
    text: string,
    allowedSpecial?: Set<string> | 'all' | 'skip'
  ) => Generator<number[], number, undefined>;
  decodeGenerator: (tokens: Iterable<number>) => Generator<string, void, void>;
  decodeAsyncGenerator: (
    tokens: AsyncIterable<number | number[]>
  ) => AsyncGenerator<string, void, void>;
}
```

### 3. EncodingApi Wrapper Updates (src/bpe/index.ts)

Update `getTokenizer()` to expose generator methods:

```typescript
export function getTokenizer(encoding: OpenAIEncoding): EncodingApi {
  let tokenizer = tokenizerCache.get(encoding);

  if (!tokenizer) {
    const vocab = getVocabulary(encoding);
    tokenizer = createTokenizer(encoding, vocab);
    tokenizerCache.set(encoding, tokenizer);
  }

  return {
    encode: (text: string, allowedSpecial?: Set<string> | 'all' | 'skip') =>
      tokenizer!.encodeText(text, allowedSpecial),
    decode: (tokens: Iterable<number>) => tokenizer!.decodeTokens(tokens),
    encodeTextWithLimit: (
      text: string,
      limit: number,
      allowedSpecial?: Set<string> | 'all' | 'skip'
    ) => tokenizer!.encodeTextWithLimit(text, limit, allowedSpecial),

    // Generator methods - delegate to BPETokenizer
    encodeGenerator: (text: string, allowedSpecial?: Set<string> | 'all' | 'skip') =>
      tokenizer!.encodeTextGenerator(text, allowedSpecial),
    decodeGenerator: (tokens: Iterable<number>) =>
      tokenizer!.decodeTokensGenerator(tokens),
    decodeAsyncGenerator: (tokens: AsyncIterable<number | number[]>) =>
      tokenizer!.decodeTokensAsyncGenerator(tokens),
  };
}
```

### 4. Public API Functions (src/openai-bpe.ts)

Simple delegation after resolving encoding/options:

```typescript
/**
 * Encode text yielding token chunks. Memory-efficient for large inputs.
 *
 * @returns Generator that yields token arrays per piece, returns total count
 */
export function encodeGenerator(
  text: string,
  options?: EncodeOptions
): Generator<number[], number, undefined> {
  const encoding = resolveEncoding(options);
  const api = getTokenizer(encoding);
  const allowedSpecial = resolveAllowedSpecial(options?.allowSpecial);
  return api.encodeGenerator(text, allowedSpecial);
}

/**
 * Decode tokens yielding text chunks.
 * Uses TextDecoder streaming mode - may yield empty strings when buffering
 * incomplete UTF-8 sequences.
 */
export function* decodeGenerator(
  tokens: Iterable<number>,
  options?: Pick<EncodeOptions, 'encoding' | 'model'>
): Generator<string, void, void> {
  const encoding = resolveEncoding(options);
  const api = getTokenizer(encoding);
  yield* api.decodeGenerator(tokens);
}

/**
 * Decode async token stream yielding text chunks.
 * Accepts single tokens or token arrays for flexibility with streaming APIs.
 */
export async function* decodeAsyncGenerator(
  tokens: AsyncIterable<number | number[]>,
  options?: Pick<EncodeOptions, 'encoding' | 'model'>
): AsyncGenerator<string, void, void> {
  const encoding = resolveEncoding(options);
  const api = getTokenizer(encoding);
  yield* api.decodeAsyncGenerator(tokens);
}
```

### 5. encodeChatGenerator (src/encode-chat.ts)

Yields tokens per message component, delegating content encoding to `encodeGenerator`:

```typescript
export function* encodeChatGenerator(
  messages: ChatMessage[] | Iterable<ChatMessage>,
  options?: EncodeChatOptions
): Generator<number[], number, undefined> {
  const { model, encoding: encodingOverride, primeAssistant = true } = options ?? {};

  validateChatModel(model, encodingOverride);
  const encoding = encodingOverride ?? (model ? getOpenAIEncoding({ model }) : 'o200k_base');

  if (encoding === 'o200k_harmony') {
    console.warn(
      '[ai-token-estimator] o200k_harmony support is experimental. ' +
        'Token structure may not match actual API behavior.'
    );
  }

  const chatTokens = getChatTokens(encoding);
  if (!chatTokens) {
    throw new Error(
      `Encoding "${encoding}" does not support chat format. ` +
        'Use cl100k_base or o200k_base for chat models.'
    );
  }

  const { imStart, imEnd, imSep } = chatTokens;
  let totalTokens = 0;

  for (const message of messages) {
    validateMessage(message);

    // <|im_start|>
    yield [imStart];
    totalTokens += 1;

    // Role
    const roleStr = getRoleString(message);
    const roleTokens = encode(roleStr, { encoding, allowSpecial: 'none' });
    yield roleTokens;
    totalTokens += roleTokens.length;

    // <|im_sep|>
    yield [imSep];
    totalTokens += 1;

    // Content - use generator for large content
    if (message.content) {
      const contentGen = encodeGenerator(message.content, { encoding, allowSpecial: 'none' });
      let result = contentGen.next();
      while (!result.done) {
        yield result.value;
        totalTokens += result.value.length;
        result = contentGen.next();
      }
    }

    // function_call
    if (message.function_call) {
      const fcContent = formatFunctionCall(message.function_call);
      const fcTokens = encode(fcContent, { encoding, allowSpecial: 'none' });
      yield fcTokens;
      totalTokens += fcTokens.length;
    }

    // <|im_end|>
    yield [imEnd];
    totalTokens += 1;
  }

  // Assistant priming
  if (primeAssistant) {
    yield [imStart];
    totalTokens += 1;
    const assistantTokens = encode('assistant', { encoding, allowSpecial: 'none' });
    yield assistantTokens;
    totalTokens += assistantTokens.length;
    yield [imSep];
    totalTokens += 1;
  }

  return totalTokens;
}

// Helper to extract role string (shared with encodeChat)
function getRoleString(message: ChatMessage): string {
  if (message.role === 'function' && message.name) {
    return message.name;
  } else if (message.name) {
    return `${message.role}:${message.name}`;
  }
  return message.role;
}
```

## Files to Modify

1. **src/bpe/core.ts** - Add generator methods to BPETokenizer:
   - `encodeTextGenerator(text, allowedSpecial)`
   - `encodeOrdinaryGenerator(text)` (private)
   - `decodeTokensGenerator(tokens)`
   - `decodeTokensAsyncGenerator(tokens)`

2. **src/bpe/types.ts** - Extend EncodingApi interface with generator methods

3. **src/bpe/index.ts** - Update getTokenizer() to expose generator methods

4. **src/openai-bpe.ts** - Add public generator functions (simple delegation)

5. **src/encode-chat.ts** - Add encodeChatGenerator()

6. **src/index.ts** - Export new functions

## Test Plan

### tests/generator-apis.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import {
  encode,
  encodeGenerator,
  decode,
  decodeGenerator,
  decodeAsyncGenerator,
  encodeChat,
  encodeChatGenerator,
} from '../src/index.js';

describe('encodeGenerator', () => {
  it('flattened output equals encode()', () => {
    const text = 'Hello, world! This is a test.';
    const options = { model: 'gpt-4o' };

    const chunks = [...encodeGenerator(text, options)];
    const flattened = chunks.flat();

    expect(flattened).toEqual(encode(text, options));
  });

  it('return value equals total token count', () => {
    const text = 'Hello, world!';
    const options = { model: 'gpt-4o' };

    const gen = encodeGenerator(text, options);
    let result = gen.next();
    while (!result.done) {
      result = gen.next();
    }

    expect(result.value).toBe(encode(text, options).length);
  });

  it('handles special tokens with allowSpecial: all', () => {
    const text = 'Hello <|im_start|> world';
    const options = { encoding: 'o200k_base' as const, allowSpecial: 'all' as const };

    const chunks = [...encodeGenerator(text, options)];
    const flattened = chunks.flat();

    expect(flattened).toEqual(encode(text, options));
    expect(flattened).toContain(200264); // im_start token
  });

  it('handles empty string (returns 0)', () => {
    const gen = encodeGenerator('', { model: 'gpt-4o' });
    const result = gen.next();

    expect(result.done).toBe(true);
    expect(result.value).toBe(0);
  });

  it('early termination does not throw for special token at end', () => {
    // Text with disallowed special token at the end
    const text = 'Hello world <|im_start|>';

    // Iterate only first chunk - should NOT throw
    const gen = encodeGenerator(text, { encoding: 'o200k_base' });
    const first = gen.next();

    expect(first.done).toBe(false);
    expect(first.value).toEqual(expect.any(Array));

    // But if we continue, it WILL throw on the special token
    expect(() => {
      let r = gen.next();
      while (!r.done) r = gen.next();
    }).toThrow(/special token/i);
  });
});

describe('encodeChatGenerator', () => {
  it('flattened output equals encodeChat()', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello!' },
    ];
    const options = { model: 'gpt-4o' };

    const chunks = [...encodeChatGenerator(messages, options)];
    const flattened = chunks.flat();

    expect(flattened).toEqual(encodeChat(messages, options));
  });

  it('respects primeAssistant: false', () => {
    const messages = [{ role: 'user', content: 'Hi' }];

    const withPriming = [...encodeChatGenerator(messages, { model: 'gpt-4o' })].flat();
    const withoutPriming = [...encodeChatGenerator(messages, { model: 'gpt-4o', primeAssistant: false })].flat();

    expect(withPriming).toEqual(encodeChat(messages, { model: 'gpt-4o' }));
    expect(withoutPriming).toEqual(encodeChat(messages, { model: 'gpt-4o', primeAssistant: false }));
    expect(withPriming.length).toBeGreaterThan(withoutPriming.length);
  });

  it('accepts iterable messages', () => {
    function* messageGen() {
      yield { role: 'user' as const, content: 'Hello' };
      yield { role: 'assistant' as const, content: 'Hi!' };
    }

    const fromArray = encodeChat(
      [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi!' }],
      { model: 'gpt-4o' }
    );
    const fromGenerator = [...encodeChatGenerator(messageGen(), { model: 'gpt-4o' })].flat();

    expect(fromGenerator).toEqual(fromArray);
  });
});

describe('decodeGenerator', () => {
  it('joined output equals decode()', () => {
    const text = 'Hello, world!';
    const tokens = encode(text, { model: 'gpt-4o' });

    const chunks = [...decodeGenerator(tokens, { model: 'gpt-4o' })];
    const joined = chunks.join('');

    expect(joined).toBe(decode(tokens, { model: 'gpt-4o' }));
    expect(joined).toBe(text);
  });

  it('handles multi-byte UTF-8 correctly', () => {
    const text = '你好世界🌍';
    const tokens = encode(text, { model: 'gpt-4o' });

    const chunks = [...decodeGenerator(tokens, { model: 'gpt-4o' })];
    const joined = chunks.join('');

    expect(joined).toBe(text);
  });

  it('may yield empty strings (buffering incomplete UTF-8)', () => {
    // This is expected behavior - not an error
    const text = '🎉';
    const tokens = encode(text, { model: 'gpt-4o' });

    const chunks = [...decodeGenerator(tokens, { model: 'gpt-4o' })];

    // Some chunks may be empty strings
    expect(chunks.join('')).toBe(text);
  });

  it('handles empty input', () => {
    const chunks = [...decodeGenerator([], { model: 'gpt-4o' })];
    expect(chunks.join('')).toBe('');
  });
});

describe('decodeAsyncGenerator', () => {
  it('joined output equals decode() for single tokens', async () => {
    const text = 'Hello!';
    const tokens = encode(text, { model: 'gpt-4o' });

    async function* tokenStream() {
      for (const t of tokens) {
        yield t;
      }
    }

    const chunks: string[] = [];
    for await (const chunk of decodeAsyncGenerator(tokenStream(), { model: 'gpt-4o' })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe(decode(tokens, { model: 'gpt-4o' }));
    expect(chunks.join('')).toBe(text);
  });

  it('joined output equals decode() for token array chunks', async () => {
    const text = 'Hello, world!';
    const tokens = encode(text, { model: 'gpt-4o' });

    async function* chunkStream() {
      yield tokens.slice(0, 2);
      yield tokens.slice(2);
    }

    const chunks: string[] = [];
    for await (const chunk of decodeAsyncGenerator(chunkStream(), { model: 'gpt-4o' })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe(text);
  });

  it('handles mixed number and number[] yields', async () => {
    const text = 'Hi!';
    const tokens = encode(text, { model: 'gpt-4o' });

    async function* mixedStream() {
      yield tokens[0]; // single number
      yield tokens.slice(1); // array
    }

    const chunks: string[] = [];
    for await (const chunk of decodeAsyncGenerator(mixedStream(), { model: 'gpt-4o' })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe(text);
  });
});
```

## README Updates

Add to Quick Recipes:

```markdown
### Generator-based streaming tokenization

```ts
import { encodeGenerator, decodeAsyncGenerator } from 'ai-token-estimator';

// Stream-encode large text (memory efficient)
let tokenCount = 0;
for (const tokenChunk of encodeGenerator(hugeText, { model: 'gpt-4o' })) {
  tokenCount += tokenChunk.length;
  // Process chunk...
}

// Decode streaming LLM response
async function decodeLLMStream(tokenStream: AsyncIterable<number>) {
  for await (const text of decodeAsyncGenerator(tokenStream, { model: 'gpt-4o' })) {
    process.stdout.write(text);
  }
}
```
```

Add to API Reference section (after decode):

```markdown
### Generator APIs

#### `encodeGenerator(text, options?): Generator<number[], number, undefined>`

Encode text yielding token chunks. Memory-efficient for large inputs.

- Yields: `number[]` - token IDs per regex-matched piece
- Returns: `number` - total token count

#### `encodeChatGenerator(messages, options?): Generator<number[], number, undefined>`

Encode chat messages yielding token chunks per message component.

#### `decodeGenerator(tokens, options?): Generator<string, void, void>`

Decode tokens yielding text chunks. Uses TextDecoder streaming mode - may yield empty strings when buffering incomplete UTF-8 sequences.

#### `decodeAsyncGenerator(tokens, options?): AsyncGenerator<string, void, void>`

Decode async token stream (e.g., streaming LLM responses). Accepts `AsyncIterable<number | number[]>`.

```ts
// Decode streaming response from OpenAI
for await (const text of decodeAsyncGenerator(tokenStream, { model: 'gpt-4o' })) {
  process.stdout.write(text);
}
```
```

## Implementation Checklist

- [ ] Add generator methods to BPETokenizer (src/bpe/core.ts)
  - [ ] `encodeTextGenerator(text, allowedSpecial)`
  - [ ] `encodeOrdinaryGenerator(text)` (private)
  - [ ] `decodeTokensGenerator(tokens)`
  - [ ] `decodeTokensAsyncGenerator(tokens)`
- [ ] Extend EncodingApi interface (src/bpe/types.ts)
- [ ] Update getTokenizer() wrapper (src/bpe/index.ts)
- [ ] Add public functions (src/openai-bpe.ts)
  - [ ] `encodeGenerator()`
  - [ ] `decodeGenerator()`
  - [ ] `decodeAsyncGenerator()`
- [ ] Add `encodeChatGenerator()` (src/encode-chat.ts)
- [ ] Export all functions (src/index.ts)
- [ ] Write unit tests (tests/generator-apis.test.ts)
- [ ] Update README with Quick Recipes and API Reference
- [ ] Create changeset

## Notes

1. **Architecture**: Generator logic lives in `BPETokenizer`, exposed via `EncodingApi`. This reuses exact same special-token scanning, cache logic, and byte handling - no duplication.

2. **Chunk granularity**: `encodeGenerator` yields per regex-matched piece (word/punctuation), not per token. This matches gpt-tokenizer and provides meaningful chunks.

3. **UTF-8 streaming semantics**: `decodeGenerator`/`decodeAsyncGenerator` use `TextDecoder` with proper streaming:
   - During iteration: `decode(bytes, { stream: true })` - buffers incomplete UTF-8 sequences, may yield empty strings
   - At flush points (before special tokens, at end): `decode()` with no stream flag (defaults to `false`) - emits any buffered bytes

   This is the correct TextDecoder streaming pattern per the WHATWG Encoding spec.

4. **Type signature for decodeAsyncGenerator**: Uses `AsyncIterable<number | number[]>` (single union type, not union of two AsyncIterable types) for clean normalization.

5. **Memory efficiency**: Generators don't allocate the full token array upfront, making them suitable for gigabyte-scale inputs.

6. **Early termination**: Consumer can stop iteration early. Special token errors only throw when that part of the input is actually processed (lazy evaluation).
