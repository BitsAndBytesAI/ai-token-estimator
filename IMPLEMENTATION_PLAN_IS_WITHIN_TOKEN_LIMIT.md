# Implementation Plan: `isWithinTokenLimit`

## Overview

Add a fast token-limit check function that returns early when exceeding the limit, avoiding full tokenization when only validation is needed.

### gpt-tokenizer API Reference

```typescript
isWithinTokenLimit(
  input: string | Iterable<ChatMessage>,
  tokenLimit: number,
  encodeOptions?: EncodeOptions,
): false | number
```

Returns:
- `false` if token count exceeds the limit
- The actual token count (number) if within limit

## Design Decisions

### 1. API Signature

**Two separate functions (not overloads):**

```typescript
// Plain text check
function isWithinTokenLimit(
  text: string,
  tokenLimit: number,
  options?: IsWithinTokenLimitOptions
): false | number;

// Chat messages check (object-style, matches countChatCompletionTokens)
function isChatWithinTokenLimit(input: IsChatWithinTokenLimitInput): false | number;

interface IsWithinTokenLimitOptions {
  model?: string;                    // Model for encoding selection
  encoding?: OpenAIEncoding;         // Explicit encoding override
  allowSpecial?: SpecialTokenHandling;
}

interface IsChatWithinTokenLimitInput {
  messages: ChatMessage[];
  model: string;
  tokenLimit: number;
  encoding?: OpenAIEncoding;
  functions?: FunctionDefinition[];
  function_call?: FunctionCallOption;
}
```

**Rationale:**
- Separate functions keep types clean, avoid awkward overload unions
- Chat function uses object-style input matching `countChatCompletionTokens`
- Explicit `model` requirement for chat (no ambiguity)
- Returns `false | number` for gpt-tokenizer compatibility

### 2. Early Exit Strategy

**Option A: Generator-based (gpt-tokenizer approach)**
```typescript
*encodeGenerator(text): Generator<number[], number>
// Yields token batches, allowing early exit mid-stream
```

**Option B: Chunked encoding (simpler)**
```typescript
// Split text into chunks, encode each, check running total
for (const chunk of splitIntoChunks(text, CHUNK_SIZE)) {
  count += encode(chunk).length;
  if (count > limit) return false;
}
```

**Option C: Modified BPE with incremental regex matching**
```typescript
// Add limit check directly in BPE tokenizer with incremental piece extraction
encodeWithLimit(text, limit): { count: number; exceeded: boolean }
```

**Recommendation: Option C (Modified BPE with incremental regex)**

Reasons:
1. **Best performance**: No intermediate array allocations
2. **Accurate cutoff**: Stops at exact token boundary
3. **Simple API**: Single call, no generator complexity

**CRITICAL: Must use `RegExp.exec()` loop, NOT `text.match()`**

The current `encodeOrdinary()` uses `text.match(this.tokenSplitRegex)` which allocates ALL pieces upfront, defeating early-exit. The new implementation MUST use an incremental loop:

```typescript
// BAD - allocates all pieces upfront
const matches = text.match(this.tokenSplitRegex); // ❌ Defeats early-exit!

// GOOD - incremental extraction, can stop immediately
this.tokenSplitRegex.lastIndex = 0;
let match: RegExpExecArray | null;
while ((match = this.tokenSplitRegex.exec(text)) !== null) {
  const piece = match[0];
  // ... encode piece, check limit, return early if exceeded
}
```

**Regex Robustness Requirements:**

1. **Clone regex per call** to avoid reentrancy issues (RegExp.lastIndex is mutable state):
   ```typescript
   // Clone with /g flag ensured
   const regex = new RegExp(
     this.tokenSplitRegex.source,
     this.tokenSplitRegex.flags.includes('g')
       ? this.tokenSplitRegex.flags
       : this.tokenSplitRegex.flags + 'g'
   );
   ```

2. **Guard against zero-length matches** to prevent infinite loops:
   ```typescript
   while ((match = regex.exec(text)) !== null) {
     if (match[0].length === 0) {
       regex.lastIndex++; // Prevent infinite loop on zero-length match
       continue;
     }
     // ... process piece
   }
   ```

### 3. Implementation Approach

#### Phase 1: Core `isWithinTokenLimit` for plain text

1. **Add `encodeWithLimit` to BPETokenizer class** (`src/bpe/core.ts`)
   ```typescript
   encodeTextWithLimit(
     text: string,
     limit: number,
     allowedSpecial?: Set<string> | 'all' | 'skip'
   ): { tokens: number[]; count: number; exceeded: boolean }
   ```
   - Modify `encodeOrdinary` loop to check count after each piece
   - Return early with `exceeded: true` when count > limit
   - Return partial tokens array (up to limit) for debugging if needed

2. **Add public `isWithinTokenLimit` function** (`src/openai-bpe.ts`)
   ```typescript
   export function isWithinTokenLimit(
     text: string,
     tokenLimit: number,
     options?: IsWithinTokenLimitOptions
   ): false | number
   ```

3. **Export from index.ts**

#### Phase 2: Chat messages support

1. **Add `isWithinTokenLimitChat` internal function** (`src/chat-completion-tokens.ts`)
   - Uses existing `countChatCompletionTokens` logic
   - BUT: needs incremental approach for early exit
   - **Challenge**: Chat overhead (function definitions, message overhead) must be calculated first

2. **Early exit opportunities for chat:**
   - Function definitions overhead can be pre-calculated (one-time cost)
   - Message-by-message: stop after any message pushes total over limit
   - Within a message: stop mid-content if content alone exceeds remaining budget

3. **Chat overload in main function**
   ```typescript
   export function isWithinTokenLimit(
     input: string | ChatMessage[],
     tokenLimit: number,
     options?: IsWithinTokenLimitOptions | IsWithinTokenLimitChatOptions
   ): false | number
   ```

#### Phase 3: Async variant (optional, lower priority)

```typescript
export async function isWithinTokenLimitAsync(
  input: string | ChatMessage[],
  tokenLimit: number,
  options?: IsWithinTokenLimitAsyncOptions
): Promise<false | number>
```

- Support provider-backed tokenizers (anthropic_count_tokens, gemini_count_tokens)
- **Challenge**: Provider APIs don't support early-exit, so this would just be a wrapper
- **Decision**: Defer to later iteration unless user demand

## Implementation Details

### BPETokenizer.encodeTextWithLimit

```typescript
// In src/bpe/core.ts

encodeTextWithLimit(
  text: string,
  limit: number,
  allowedSpecial?: Set<string> | 'all' | 'skip'
): { count: number; exceeded: boolean } {
  if (!text) return { count: 0, exceeded: false };
  if (limit < 0) return { count: 0, exceeded: true };

  if (allowedSpecial === 'skip') {
    return this.encodeOrdinaryWithLimit(text, limit);
  }

  let count = 0;

  if (this.specialTokenMap.size > 0) {
    const parts = this.splitOnSpecialTokens(text, allowedSpecial);

    for (const part of parts) {
      if (part.isSpecial) {
        count += 1; // Special tokens are always 1 token
        if (count > limit) return { count, exceeded: true };
      } else {
        const result = this.encodeOrdinaryWithLimit(part.text, limit - count);
        count += result.count;
        if (result.exceeded) {
          return { count, exceeded: true };
        }
      }
    }
  } else {
    return this.encodeOrdinaryWithLimit(text, limit);
  }

  return { count, exceeded: false };
}

/**
 * Incremental encoding with early exit.
 * CRITICAL: Uses RegExp.exec() loop instead of text.match() to avoid
 * allocating all pieces upfront. This enables true early exit.
 */
private encodeOrdinaryWithLimit(
  text: string,
  limit: number
): { count: number; exceeded: boolean } {
  if (!text) return { count: 0, exceeded: false };
  if (limit < 0) return { count: 0, exceeded: true };

  let count = 0;

  // CRITICAL: Clone regex per call to avoid reentrancy issues.
  // RegExp.lastIndex is mutable state; concurrent calls would corrupt it.
  // Also ensure /g flag is present for exec() to work correctly.
  const regex = new RegExp(
    this.tokenSplitRegex.source,
    this.tokenSplitRegex.flags.includes('g')
      ? this.tokenSplitRegex.flags
      : this.tokenSplitRegex.flags + 'g'
  );

  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const piece = match[0];

    // Guard against zero-length matches to prevent infinite loops
    if (piece.length === 0) {
      regex.lastIndex++;
      continue;
    }

    // Check cache first
    const cached = this.getFromCache(piece);
    if (cached) {
      count += cached.length;
      if (count > limit) return { count, exceeded: true };
      continue;
    }

    // Convert to bytes and encode
    const pieceBytes = this.textEncoder.encode(piece);
    const key = bytesToLatin1(pieceBytes);

    // Direct lookup
    const directRank = this.encoder.get(key);
    if (directRank !== undefined) {
      count += 1;
      this.addToCache(piece, [directRank]);
      if (count > limit) return { count, exceeded: true };
      continue;
    }

    // BPE merge (can't early-exit within a piece, but pieces are small)
    const pieceTokens = this.mergeBytePairs(pieceBytes);
    count += pieceTokens.length;
    this.addToCache(piece, pieceTokens);
    if (count > limit) return { count, exceeded: true };
  }

  return { count, exceeded: false };
}
```

### Public API

```typescript
// In src/openai-bpe.ts

export interface IsWithinTokenLimitOptions {
  encoding?: OpenAIEncoding;
  model?: string;
  allowSpecial?: SpecialTokenHandling;
}

/**
 * Validate tokenLimit is a non-negative finite integer.
 */
function validateTokenLimit(tokenLimit: number): void {
  if (!Number.isFinite(tokenLimit)) {
    throw new Error('tokenLimit must be a finite number');
  }
  if (!Number.isInteger(tokenLimit)) {
    throw new Error('tokenLimit must be an integer');
  }
  if (tokenLimit < 0) {
    throw new Error('tokenLimit must be non-negative');
  }
}

/**
 * Reject known non-OpenAI models.
 * Must be called BEFORE resolveEncoding() since that defaults to o200k_base for unknown models.
 */
function rejectNonOpenAIModel(model: string | undefined): void {
  if (!model) return;
  if (model.startsWith('claude-')) {
    throw new Error(
      `Model "${model}" is an Anthropic model. isWithinTokenLimit only supports OpenAI models. ` +
      'Use the Anthropic API\'s count_tokens endpoint via estimateAsync() instead.'
    );
  }
  if (model.startsWith('gemini-')) {
    throw new Error(
      `Model "${model}" is a Google model. isWithinTokenLimit only supports OpenAI models. ` +
      'Use the Gemini API\'s countTokens endpoint via estimateAsync() instead.'
    );
  }
}

/**
 * Check if text is within a token limit, with early exit optimization.
 *
 * @param text - The text to check
 * @param tokenLimit - Maximum allowed tokens (must be non-negative finite integer)
 * @param options - Encoding options
 * @returns false if exceeded, or the actual token count if within limit
 * @throws Error if tokenLimit is invalid (NaN, Infinity, negative, non-integer)
 * @throws Error if model is a known non-OpenAI model (claude-*, gemini-*)
 */
export function isWithinTokenLimit(
  text: string,
  tokenLimit: number,
  options?: IsWithinTokenLimitOptions
): false | number {
  validateTokenLimit(tokenLimit);
  rejectNonOpenAIModel(options?.model);

  const encoding = resolveEncoding(options);
  const api = getTokenizer(encoding);
  const allowedSpecial = resolveAllowedSpecial(options?.allowSpecial);

  const result = api.encodeTextWithLimit(text, tokenLimit, allowedSpecial);

  return result.exceeded ? false : result.count;
}
```

### Chat Messages Variant

```typescript
// In src/chat-completion-tokens.ts

export interface IsChatWithinTokenLimitInput {
  messages: ChatMessage[];
  model: string;
  tokenLimit: number;
  encoding?: OpenAIEncoding;
  functions?: FunctionDefinition[];
  function_call?: FunctionCallOption;
}

/**
 * Check if chat messages are within a token limit, with early exit optimization.
 *
 * Uses object-style input to match countChatCompletionTokens API.
 */
export function isChatWithinTokenLimit(input: IsChatWithinTokenLimitInput): false | number {
  const { messages, model, tokenLimit, encoding, functions, function_call } = input;

  // Strict tokenLimit validation (same as isWithinTokenLimit)
  if (!Number.isFinite(tokenLimit)) {
    throw new Error('tokenLimit must be a finite number');
  }
  if (!Number.isInteger(tokenLimit)) {
    throw new Error('tokenLimit must be an integer');
  }
  if (tokenLimit < 0) {
    throw new Error('tokenLimit must be non-negative');
  }

  // Validate inputs (reuse existing validation)
  validateNoToolsApi({ messages, model, functions, function_call });
  validateMessages(messages);
  validateOpenAIModel(model, encoding);

  const resolvedEncoding = encoding ?? getOpenAIEncoding({ model });
  const api = getTokenizer(resolvedEncoding);

  // Start with fixed overhead
  let count = COMPLETION_REQUEST_TOKEN_OVERHEAD;
  let remainingBudget = tokenLimit - count;

  if (remainingBudget < 0) return false;

  const hasFunctions = Boolean(functions?.length);

  // Pre-scan: check if any message is a system message (for deduction calculation)
  // We need to know this upfront to correctly calculate function overhead
  const hasSystemMessage = messages.some(m => m.role === 'system');

  // Calculate function overhead WITH early exit (pass remaining budget!)
  if (hasFunctions && functions) {
    const formatted = formatFunctionDefinitions(functions);
    const funcResult = api.encodeTextWithLimit(formatted, remainingBudget, 'skip');
    if (funcResult.exceeded) return false;

    let funcOverhead = funcResult.count + FUNCTION_DEFINITION_TOKEN_OVERHEAD;

    // Apply SYSTEM_FUNCTION_TOKEN_DEDUCTION immediately if we have system message
    // This prevents false negatives from deducting at the end
    if (hasSystemMessage) {
      funcOverhead -= SYSTEM_FUNCTION_TOKEN_DEDUCTION;
    }

    count += funcOverhead;
    remainingBudget = tokenLimit - count;
    if (remainingBudget < 0) return false;
  }

  // Function call overhead (with early exit)
  if (function_call && function_call !== 'auto') {
    if (function_call === 'none') {
      count += FUNCTION_CALL_NONE_TOKEN_OVERHEAD;
    } else if (typeof function_call === 'object') {
      const fcNameResult = api.encodeTextWithLimit(
        function_call.name,
        tokenLimit - count,
        'skip'
      );
      if (fcNameResult.exceeded) return false;
      count += fcNameResult.count + FUNCTION_CALL_NAME_TOKEN_OVERHEAD;
    }
    remainingBudget = tokenLimit - count;
    if (remainingBudget < 0) return false;
  }

  // Process messages with early exit
  let systemPadded = false;

  for (const message of messages) {
    let overhead = MESSAGE_TOKEN_OVERHEAD;

    // Role tokens
    const roleResult = api.encodeTextWithLimit(message.role, tokenLimit - count, 'skip');
    if (roleResult.exceeded) return false;
    count += roleResult.count;

    // Content
    let content = message.content ?? '';
    if (hasFunctions && message.role === 'system' && !systemPadded) {
      if (content && !content.endsWith('\n')) {
        content = content + '\n';
      }
      systemPadded = true;
    }

    if (content) {
      const contentResult = api.encodeTextWithLimit(content, tokenLimit - count, 'skip');
      if (contentResult.exceeded) return false;
      count += contentResult.count;
    }

    // Name
    if (message.name) {
      const nameResult = api.encodeTextWithLimit(message.name, tokenLimit - count, 'skip');
      if (nameResult.exceeded) return false;
      count += nameResult.count;
      overhead += MESSAGE_NAME_TOKEN_OVERHEAD;
    }

    // Function call in message
    if (message.function_call) {
      if (message.function_call.name) {
        const fcNameResult = api.encodeTextWithLimit(
          message.function_call.name, tokenLimit - count, 'skip'
        );
        if (fcNameResult.exceeded) return false;
        count += fcNameResult.count;
      }
      if (message.function_call.arguments) {
        const fcArgsResult = api.encodeTextWithLimit(
          message.function_call.arguments, tokenLimit - count, 'skip'
        );
        if (fcArgsResult.exceeded) return false;
        count += fcArgsResult.count;
      }
      overhead += FUNCTION_CALL_METADATA_TOKEN_OVERHEAD;
    }

    // Function role discount
    if (message.role === 'function') {
      overhead -= FUNCTION_ROLE_TOKEN_DISCOUNT;
    }

    count += overhead;
    if (count > tokenLimit) return false;
  }

  // Note: SYSTEM_FUNCTION_TOKEN_DEDUCTION already applied above when computing funcOverhead
  // This prevents false negatives from deducting only at the end

  return count;
}
```

## Test Plan

### Unit Tests (`tests/is-within-token-limit.test.ts`)

**Principle: Correctness only, no timing-based assertions (those go in benchmarks)**

```typescript
describe('isWithinTokenLimit - plain text', () => {
  it('returns token count when within limit', () => {
    const text = 'Hello';
    const exactCount = encode(text, { model: 'gpt-4o' }).length;
    expect(isWithinTokenLimit(text, 10, { model: 'gpt-4o' })).toBe(exactCount);
  });

  it('returns false when exceeds limit', () => {
    const text = 'Hello world this is a test';
    expect(isWithinTokenLimit(text, 1, { model: 'gpt-4o' })).toBe(false);
  });

  it('returns 0 for empty string', () => {
    expect(isWithinTokenLimit('', 10, { model: 'gpt-4o' })).toBe(0);
  });

  it('returns false for tokenLimit 0 with non-empty text', () => {
    expect(isWithinTokenLimit('a', 0, { model: 'gpt-4o' })).toBe(false);
  });

  it('handles exact limit match (returns count, not false)', () => {
    const text = 'Hello';
    const exactCount = encode(text, { model: 'gpt-4o' }).length;
    expect(isWithinTokenLimit(text, exactCount, { model: 'gpt-4o' })).toBe(exactCount);
  });

  it('returns false when 1 over limit', () => {
    const text = 'Hello';
    const exactCount = encode(text, { model: 'gpt-4o' }).length;
    expect(isWithinTokenLimit(text, exactCount - 1, { model: 'gpt-4o' })).toBe(false);
  });

  it('throws for negative tokenLimit', () => {
    expect(() => isWithinTokenLimit('test', -1, { model: 'gpt-4o' })).toThrow(/non-negative/);
  });

  it('throws for NaN tokenLimit', () => {
    expect(() => isWithinTokenLimit('test', NaN, { model: 'gpt-4o' })).toThrow(/finite/);
  });

  it('throws for Infinity tokenLimit', () => {
    expect(() => isWithinTokenLimit('test', Infinity, { model: 'gpt-4o' })).toThrow(/finite/);
  });

  it('throws for non-integer tokenLimit', () => {
    expect(() => isWithinTokenLimit('test', 3.5, { model: 'gpt-4o' })).toThrow(/integer/);
  });

  it('works with explicit encoding override', () => {
    const text = 'Hello';
    const exactCount = encode(text, { encoding: 'cl100k_base' }).length;
    expect(isWithinTokenLimit(text, 10, { encoding: 'cl100k_base' })).toBe(exactCount);
  });

  it('throws for non-OpenAI model (claude-*)', () => {
    expect(() => isWithinTokenLimit('test', 10, { model: 'claude-sonnet-4' })).toThrow();
  });

  it('throws for non-OpenAI model (gemini-*)', () => {
    expect(() => isWithinTokenLimit('test', 10, { model: 'gemini-2.0-flash' })).toThrow();
  });

  it('handles special tokens with allowSpecial: none', () => {
    // <|endoftext|> should be encoded as regular text
    const text = 'Hello <|endoftext|> world';
    const result = isWithinTokenLimit(text, 100, { model: 'gpt-4o', allowSpecial: 'none' });
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  describe('parity with encode().length', () => {
    const testCases = [
      'Hello, world!',
      'The quick brown fox jumps over the lazy dog.',
      '👍👎👏',  // emoji
      'café résumé naïve',  // accented
      'function foo() { return 42; }',  // code
      '  multiple   spaces  ',
      '\n\nNewlines\n\n',
    ];

    testCases.forEach((text) => {
      it(`matches encode().length for: "${text.slice(0, 30)}..."`, () => {
        const exactCount = encode(text, { model: 'gpt-4o' }).length;
        const result = isWithinTokenLimit(text, 1000, { model: 'gpt-4o' });
        expect(result).toBe(exactCount);
      });
    });
  });
});

describe('isChatWithinTokenLimit', () => {
  it('returns token count when within limit', () => {
    const result = isChatWithinTokenLimit({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'gpt-4o',
      tokenLimit: 100,
    });
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  it('returns false when exceeds limit', () => {
    const result = isChatWithinTokenLimit({
      messages: [{ role: 'user', content: 'a'.repeat(10000) }],
      model: 'gpt-4o',
      tokenLimit: 10,
    });
    expect(result).toBe(false);
  });

  it('throws for negative tokenLimit', () => {
    expect(() => isChatWithinTokenLimit({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'gpt-4o',
      tokenLimit: -1,
    })).toThrow();
  });

  describe('parity with countChatCompletionTokens', () => {
    it('matches for simple messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is 2+2?' },
      ];

      const exactCount = countChatCompletionTokens({ messages, model: 'gpt-4o' }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with functions', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the weather?' },
      ];
      const functions = [{
        name: 'get_weather',
        description: 'Get weather for a location',
        parameters: {
          type: 'object' as const,
          properties: {
            location: { type: 'string', description: 'City name' }
          }
        }
      }];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
        functions,
      }).totalTokens;

      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with function_call: none', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
      const functions = [{ name: 'test', parameters: { type: 'object' as const } }];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
        functions,
        function_call: 'none',
      }).totalTokens;

      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
        function_call: 'none',
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with function_call: { name: "..." }', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
      const functions = [{ name: 'get_weather', parameters: { type: 'object' as const } }];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
        functions,
        function_call: { name: 'get_weather' },
      }).totalTokens;

      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
        function_call: { name: 'get_weather' },
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with message.name (adds MESSAGE_NAME_TOKEN_OVERHEAD)', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello', name: 'alice' },
      ];

      const exactCount = countChatCompletionTokens({ messages, model: 'gpt-4o' }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with role: function (applies FUNCTION_ROLE_TOKEN_DISCOUNT)', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'What is the weather?' },
        { role: 'assistant', content: null, function_call: { name: 'get_weather', arguments: '{}' } },
        { role: 'function', content: '{"temp": 72}', name: 'get_weather' },
      ];
      const functions = [{ name: 'get_weather', parameters: { type: 'object' as const } }];

      const exactCount = countChatCompletionTokens({ messages, model: 'gpt-4o', functions }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with assistant function_call in message', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'What is the weather?' },
        { role: 'assistant', content: null, function_call: { name: 'get_weather', arguments: '{"location":"Paris"}' } },
      ];
      const functions = [{ name: 'get_weather', parameters: { type: 'object' as const } }];

      const exactCount = countChatCompletionTokens({ messages, model: 'gpt-4o', functions }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches system padding edge case (functions + system without trailing newline)', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful' }, // no trailing \n
        { role: 'user', content: 'Hello' },
      ];
      const functions = [{ name: 'test', parameters: { type: 'object' as const } }];

      const exactCount = countChatCompletionTokens({ messages, model: 'gpt-4o', functions }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
      });

      expect(limitResult).toBe(exactCount);
    });
  });
});
```

### Benchmark Script (`benchmark/is-within-token-limit.ts`)

Performance testing moved to benchmark/ directory (not unit tests) to avoid CI flakiness and keep it separate from normal build/test tooling:

```typescript
// benchmark/is-within-token-limit.ts
import { encode, isWithinTokenLimit } from '../src/index.js';

const sizes = [100, 1_000, 10_000, 100_000];
const limits = [10, 100, 1_000];

console.log('isWithinTokenLimit Performance Benchmark');
console.log('========================================\n');

for (const size of sizes) {
  const text = 'word '.repeat(size);
  console.log(`Text size: ${size * 5} chars (~${size} tokens)`);

  // Full encode baseline
  const fullStart = performance.now();
  const fullCount = encode(text, { model: 'gpt-4o' }).length;
  const fullTime = performance.now() - fullStart;
  console.log(`  Full encode: ${fullTime.toFixed(2)}ms (${fullCount} tokens)`);

  for (const limit of limits) {
    const limitStart = performance.now();
    const result = isWithinTokenLimit(text, limit, { model: 'gpt-4o' });
    const limitTime = performance.now() - limitStart;
    const speedup = fullTime / limitTime;
    console.log(`  Limit ${limit}: ${limitTime.toFixed(2)}ms (${result === false ? 'exceeded' : result} tokens) - ${speedup.toFixed(1)}x faster`);
  }
  console.log();
}
```

## Design Decisions (Resolved)

1. **Non-OpenAI models**: **Throw** (consistent with `countChatCompletionTokens`)
   - API contract (`false | number`) implies exact count when within limit
   - Heuristic fallback would silently change semantics
   - Allow `encoding` override for unknown/new OpenAI models
   - Reject known non-OpenAI prefixes (`claude-*`, `gemini-*`)

2. **Return type**: **`false | number`** (match gpt-tokenizer for compatibility)

3. **Chat variant**: **Separate function** (`isChatWithinTokenLimit`)
   - Cleaner types, no awkward overload unions
   - Object-style input matches `countChatCompletionTokens` API
   - Explicit `model` requirement

4. **Async variant**: **Defer**
   - Provider endpoints don't support early-exit
   - Can't deliver the headline performance win
   - Add as convenience wrapper in later iteration if needed

## File Changes Summary

| File | Change |
|------|--------|
| `src/bpe/core.ts` | Add `encodeTextWithLimit` and `encodeOrdinaryWithLimit` methods (incremental regex, cloned per call) |
| `src/openai-bpe.ts` | Add `isWithinTokenLimit` function, `IsWithinTokenLimitOptions` type, validation helpers |
| `src/chat-completion-tokens.ts` | Add `isChatWithinTokenLimit` function and `IsChatWithinTokenLimitInput` type |
| `src/index.ts` | Export new functions and types |
| `tests/is-within-token-limit.test.ts` | New test file (correctness tests, parity checks, validation tests) |
| `benchmark/is-within-token-limit.ts` | New benchmark script (performance measurement, separate from tests) |
| `README.md` | Document new API |
| `.changeset/*.md` | Changeset for minor version bump |

## Implementation Phases

| Phase | Scope | Files |
|-------|-------|-------|
| Phase 1 | Add `encodeTextWithLimit` to BPE core (incremental regex, cloned per call, zero-length guard) | `src/bpe/core.ts` |
| Phase 2 | Add `isWithinTokenLimit` for plain text (validation, non-OpenAI rejection) | `src/openai-bpe.ts`, `src/index.ts` |
| Phase 3 | Add `isChatWithinTokenLimit` for chat messages (pre-scan deduction, early exit on all components) | `src/chat-completion-tokens.ts`, `src/index.ts` |
| Phase 4 | Tests (correctness + parity), benchmark (separate dir), docs | `tests/`, `benchmark/`, `README.md` |

## Changeset

```markdown
---
'ai-token-estimator': minor
---

feat: add isWithinTokenLimit for fast token limit validation

- `isWithinTokenLimit(text, limit, options)`: Check if text is within token limit with early exit optimization
- `isChatWithinTokenLimit({ messages, model, tokenLimit, ... })`: Check if chat messages are within limit
- Returns `false` if exceeded, or the actual token count if within limit
- Uses incremental regex matching for true early-exit (avoids upfront allocation)
- Significantly faster than full tokenization when limit is exceeded early
```
