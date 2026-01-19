# Implementation Plan: `encodeChat`

## Overview

Add chat-aware tokenization that produces the actual token sequences OpenAI models expect for chat completions. Unlike `countChatCompletionTokens` (which only counts), `encodeChat` returns the exact token IDs including special message delimiter tokens.

### gpt-tokenizer API Reference

```typescript
encodeChat(
  chat: ChatMessage[],
  model?: string,
  encodeOptions?: EncodeOptions
): number[]

encodeChatGenerator(
  chat: ChatMessage[],
  model?: string,
  encodeOptions?: EncodeOptions
): Generator<number[], void, void>
```

Returns:
- `number[]`: Token IDs representing the full chat prompt
- Empty chats still contain minimum special tokens (assistant priming)

## Background: ChatML Format

OpenAI chat models use **ChatML** (Chat Markup Language) format internally. Each message is wrapped with special tokens:

```
<|im_start|>system<|im_sep|>You are helpful.<|im_end|>
<|im_start|>user<|im_sep|>Hello!<|im_end|>
<|im_start|>assistant<|im_sep|>
```

### Special Token IDs by Encoding

| Token | cl100k_base | o200k_base |
|-------|-------------|------------|
| `<|im_start|>` | 100264 | 200264 |
| `<|im_end|>` | 100265 | 200265 |
| `<|im_sep|>` | 100266 | 200266 |

**Note**: These tokens are already defined in `src/bpe/special-tokens.ts` for cl100k_base and o200k_base encodings.

## Design Decisions

### 1. API Signature

```typescript
// Main function
function encodeChat(
  messages: ChatMessage[],
  options?: EncodeChatOptions
): number[];

interface EncodeChatOptions {
  model?: string;              // Model for encoding selection (default: infer from encoding)
  encoding?: OpenAIEncoding;   // Explicit encoding override
  /**
   * Prime the output with the start of an assistant response.
   * When true (default), appends <|im_start|>assistant<|im_sep|> at the end.
   * Set to false to get just the messages without assistant priming.
   */
  primeAssistant?: boolean;    // Default: true
}
```

**Rationale:**
- Object-style options for extensibility
- `primeAssistant` matches gpt-tokenizer's `primeWithAssistantResponse`
- Consistent with our other APIs

### 2. Message Structure

Each message becomes:
```
<|im_start|>{role}<|im_sep|>{content}<|im_end|>
```

For messages with `name` field (non-function roles):
```
<|im_start|>{role}:{name}<|im_sep|>{content}<|im_end|>
```

**Special case for `role='function'`** (function result messages):
```
<|im_start|>{name}<|im_sep|>{content}<|im_end|>
```
The function name becomes the role string directly (not `function:{name}`). This matches the token counting behavior in `countChatCompletionTokens`.

### 3. Assistant Priming

By default, append assistant response primer:
```
<|im_start|>assistant<|im_sep|>
```

This is what the model expects when generating a response. Can be disabled via `primeAssistant: false`.

### 4. Empty Chat Handling

Empty messages array still returns assistant priming tokens (if `primeAssistant: true`):
```typescript
encodeChat([]) // Returns tokens for: <|im_start|>assistant<|im_sep|>
```

### 5. Scope: Legacy Functions API vs Tools API

**Phase 1 (this implementation):**
- Support basic roles: `system`, `user`, `assistant`
- Support `name` field
- Support `function` role (for function results)
- Support `function_call` in assistant messages
- **Do NOT** support `tools`, `tool_calls`, `tool_call_id` (throw error)

**Future Phase:**
- Tools API support (requires different token format)

### 6. Model Support

| Encoding | Models | Chat Support |
|----------|--------|--------------|
| `cl100k_base` | gpt-3.5-turbo, gpt-4, gpt-4-turbo | Yes |
| `o200k_base` | gpt-4o, gpt-4o-mini, o1, o3 | Yes |
| `o200k_harmony` | Future models | Yes (uses `<\|start\|>`, `<\|message\|>`, `<\|end\|>` instead) |
| `r50k_base`, `p50k_*` | Older completion models | No (throw error) |

## Implementation Details

### Phase 1: ChatML Special Tokens ✅

**Already complete.** The ChatML tokens (`<|im_start|>`, `<|im_end|>`, `<|im_sep|>`) are already defined in `src/bpe/special-tokens.ts` for both cl100k_base and o200k_base encodings.

### Phase 2: Create `encodeChat` Function

New file: `src/encode-chat.ts`

```typescript
import { encode, getOpenAIEncoding } from './openai-bpe.js';
import { getTokenizer, resolveEncoding } from './bpe/index.js';
import { isChatModel, isAnthropicModel, isGoogleModel } from './mappings/chat-models.js';
import type { OpenAIEncoding } from './bpe/types.js';
import type { ChatMessage } from './types.js';

export interface EncodeChatOptions {
  model?: string;
  encoding?: OpenAIEncoding;
  primeAssistant?: boolean;
}

// ChatML special token IDs by encoding
const CHAT_TOKENS: Record<string, { imStart: number; imEnd: number; imSep: number }> = {
  cl100k_base: { imStart: 100264, imEnd: 100265, imSep: 100266 },
  o200k_base: { imStart: 200264, imEnd: 200265, imSep: 200266 },
  // o200k_harmony uses different tokens (handled separately)
};

/**
 * Encode chat messages into token IDs using ChatML format.
 *
 * @param messages - Array of chat messages
 * @param options - Encoding options
 * @returns Token IDs representing the chat prompt
 *
 * @example
 * ```typescript
 * const tokens = encodeChat([
 *   { role: 'system', content: 'You are helpful.' },
 *   { role: 'user', content: 'Hello!' }
 * ], { model: 'gpt-4o' });
 * ```
 */
export function encodeChat(
  messages: ChatMessage[],
  options?: EncodeChatOptions
): number[] {
  const { model, encoding: encodingOverride, primeAssistant = true } = options ?? {};

  // Validate non-OpenAI models
  validateChatModel(model);

  // Resolve encoding
  const encoding = encodingOverride ?? (model ? getOpenAIEncoding({ model }) : 'o200k_base');

  // Get chat tokens for this encoding
  const chatTokens = getChatTokens(encoding);
  if (!chatTokens) {
    throw new Error(
      `Encoding "${encoding}" does not support chat format. ` +
      'Use cl100k_base or o200k_base for chat models.'
    );
  }

  const { imStart, imEnd, imSep } = chatTokens;
  const tokens: number[] = [];

  // Encode each message
  for (const message of messages) {
    validateMessage(message);

    // <|im_start|>
    tokens.push(imStart);

    // role string depends on message type:
    // - function role: use name directly (not "function:name")
    // - other roles with name: use "role:name"
    // - other roles without name: use "role"
    let roleStr: string;
    if (message.role === 'function' && message.name) {
      roleStr = message.name;
    } else if (message.name) {
      roleStr = `${message.role}:${message.name}`;
    } else {
      roleStr = message.role;
    }
    tokens.push(...encode(roleStr, { encoding, allowSpecial: 'none' }));

    // <|im_sep|>
    tokens.push(imSep);

    // content
    if (message.content) {
      tokens.push(...encode(message.content, { encoding, allowSpecial: 'none' }));
    }

    // function_call (for assistant messages)
    if (message.function_call) {
      // Format: function_call\nname\narguments
      const fcContent = formatFunctionCall(message.function_call);
      tokens.push(...encode(fcContent, { encoding, allowSpecial: 'none' }));
    }

    // <|im_end|>
    tokens.push(imEnd);
  }

  // Prime with assistant response start
  if (primeAssistant) {
    tokens.push(imStart);
    tokens.push(...encode('assistant', { encoding, allowSpecial: 'none' }));
    tokens.push(imSep);
  }

  return tokens;
}

function validateChatModel(model: string | undefined): void {
  if (!model) return;

  if (model.startsWith('claude-')) {
    throw new Error(
      `Model "${model}" is an Anthropic model. encodeChat only supports OpenAI models.`
    );
  }
  if (model.startsWith('gemini-')) {
    throw new Error(
      `Model "${model}" is a Google model. encodeChat only supports OpenAI models.`
    );
  }
}

function validateMessage(message: ChatMessage): void {
  const msgAny = message as Record<string, unknown>;

  // Reject tools API
  if ('tool_calls' in msgAny && msgAny.tool_calls !== undefined) {
    throw new Error('tool_calls is not supported. Use function_call with the legacy functions API.');
  }
  if ('tool_call_id' in msgAny && msgAny.tool_call_id !== undefined) {
    throw new Error('tool_call_id is not supported. Use the legacy functions API.');
  }

  // Validate content type
  if (message.content !== null &&
      message.content !== undefined &&
      typeof message.content !== 'string') {
    throw new Error('Multimodal content (arrays) is not supported. Only text content is supported.');
  }
}

function getChatTokens(encoding: OpenAIEncoding) {
  return CHAT_TOKENS[encoding] ?? null;
}

function formatFunctionCall(fc: { name?: string; arguments?: string }): string {
  // Match OpenAI's internal format
  const parts: string[] = [];
  if (fc.name) parts.push(fc.name);
  if (fc.arguments) parts.push(fc.arguments);
  return parts.join('\n');
}
```

### Phase 3: Handle o200k_harmony Format

The harmony format uses different special tokens:
- `<|start|>` (200006) instead of `<|im_start|>`
- `<|message|>` (200008) instead of `<|im_sep|>`
- `<|end|>` (200007) instead of `<|im_end|>`

```typescript
// Additional chat tokens for harmony format
const HARMONY_TOKENS = {
  start: 200006,
  end: 200007,
  message: 200008,
};

// In getChatTokens():
if (encoding === 'o200k_harmony') {
  return {
    imStart: HARMONY_TOKENS.start,
    imEnd: HARMONY_TOKENS.end,
    imSep: HARMONY_TOKENS.message,
  };
}
```

### Phase 4: Generator Version (Deferred)

```typescript
/**
 * Generator version of encodeChat for streaming/incremental processing.
 * Yields token chunks per message.
 */
export function* encodeChatGenerator(
  messages: ChatMessage[],
  options?: EncodeChatOptions
): Generator<number[], void, void> {
  // Similar to encodeChat but yields after each message
  for (const message of messages) {
    yield encodeMessage(message, encoding, chatTokens);
  }

  if (primeAssistant) {
    yield [imStart, ...roleTokens, imSep];
  }
}
```

**Decision**: Defer generator to later phase (item #9 on feature list).

### Phase 5: Exports and Types

Update `src/index.ts`:
```typescript
export { encodeChat } from './encode-chat.js';
export type { EncodeChatOptions } from './encode-chat.js';
```

## Test Plan

### Unit Tests (`tests/encode-chat.test.ts`)

```typescript
describe('encodeChat', () => {
  describe('basic functionality', () => {
    it('encodes empty chat with assistant priming', () => {
      const tokens = encodeChat([], { model: 'gpt-4o' });
      // Should be: <|im_start|> + "assistant" tokens + <|im_sep|>
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens[0]).toBe(200264); // <|im_start|>
    });

    it('encodes single user message', () => {
      const tokens = encodeChat([
        { role: 'user', content: 'Hello' }
      ], { model: 'gpt-4o' });

      // Should contain message tokens + assistant priming
      expect(tokens[0]).toBe(200264); // <|im_start|>
    });

    it('encodes multi-turn conversation', () => {
      const tokens = encodeChat([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'Bye' },
      ], { model: 'gpt-4o' });

      // Count special tokens (4 messages + assistant priming)
      const imStartCount = tokens.filter(t => t === 200264).length;
      expect(imStartCount).toBe(5); // 4 messages + 1 priming
    });

    it('respects primeAssistant: false', () => {
      const withPriming = encodeChat([
        { role: 'user', content: 'Hi' }
      ], { model: 'gpt-4o', primeAssistant: true });

      const withoutPriming = encodeChat([
        { role: 'user', content: 'Hi' }
      ], { model: 'gpt-4o', primeAssistant: false });

      expect(withPriming.length).toBeGreaterThan(withoutPriming.length);
    });
  });

  describe('message name handling', () => {
    it('includes name in role position for non-function roles', () => {
      const tokens = encodeChat([
        { role: 'user', content: 'Hi', name: 'alice' }
      ], { model: 'gpt-4o' });

      // Should encode "user:alice" not just "user"
      const decoded = decode(tokens, { encoding: 'o200k_base' });
      expect(decoded).toContain('user:alice');
    });

    it('uses name directly as role for function messages', () => {
      const tokens = encodeChat([
        { role: 'function', content: '{"temp": 72}', name: 'get_weather' }
      ], { model: 'gpt-4o' });

      // Should encode "get_weather" as role, NOT "function:get_weather"
      const decoded = decode(tokens, { encoding: 'o200k_base' });
      expect(decoded).toContain('get_weather');
      expect(decoded).not.toContain('function:');
    });
  });

  describe('function_call handling', () => {
    it('encodes assistant message with function_call', () => {
      const tokens = encodeChat([
        { role: 'assistant', content: null, function_call: { name: 'get_weather', arguments: '{}' } }
      ], { model: 'gpt-4o' });

      const decoded = decode(tokens, { encoding: 'o200k_base' });
      expect(decoded).toContain('get_weather');
    });
  });

  describe('encoding selection', () => {
    it('uses cl100k_base for gpt-4', () => {
      const tokens = encodeChat([
        { role: 'user', content: 'Hi' }
      ], { model: 'gpt-4' });

      expect(tokens[0]).toBe(100264); // cl100k <|im_start|>
    });

    it('uses o200k_base for gpt-4o', () => {
      const tokens = encodeChat([
        { role: 'user', content: 'Hi' }
      ], { model: 'gpt-4o' });

      expect(tokens[0]).toBe(200264); // o200k <|im_start|>
    });

    it('allows explicit encoding override', () => {
      const tokens = encodeChat([
        { role: 'user', content: 'Hi' }
      ], { encoding: 'cl100k_base' });

      expect(tokens[0]).toBe(100264);
    });
  });

  describe('validation', () => {
    it('throws for non-OpenAI models (claude-*)', () => {
      expect(() => encodeChat([], { model: 'claude-sonnet-4' })).toThrow(/Anthropic/);
    });

    it('throws for non-OpenAI models (gemini-*)', () => {
      expect(() => encodeChat([], { model: 'gemini-2.0-flash' })).toThrow(/Google/);
    });

    it('throws for non-chat encodings', () => {
      expect(() => encodeChat([], { encoding: 'r50k_base' })).toThrow(/does not support chat/);
    });

    it('throws for tool_calls', () => {
      expect(() => encodeChat([
        { role: 'assistant', content: null, tool_calls: [] } as any
      ], { model: 'gpt-4o' })).toThrow(/tool_calls/);
    });

    it('throws for multimodal content', () => {
      expect(() => encodeChat([
        { role: 'user', content: [{ type: 'text', text: 'Hi' }] } as any
      ], { model: 'gpt-4o' })).toThrow(/Multimodal/);
    });
  });

  describe('parity with countChatCompletionTokens', () => {
    it('token count matches countChatCompletionTokens (no functions)', () => {
      const messages = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello!' },
      ];

      const encoded = encodeChat(messages, { model: 'gpt-4o' });
      const counted = countChatCompletionTokens({ messages, model: 'gpt-4o' });

      // encodeChat includes assistant priming
      // countChatCompletionTokens includes COMPLETION_REQUEST_TOKEN_OVERHEAD (3)
      expect(encoded.length).toBe(counted.totalTokens);
    });
  });
});
```

### Parity Verification

Create test fixtures by comparing with gpt-tokenizer output:
1. Generate expected tokens using gpt-tokenizer
2. Verify our implementation matches exactly

## File Changes Summary

| File | Change |
|------|--------|
| `src/encode-chat.ts` | New file: `encodeChat` function |
| `src/index.ts` | Export `encodeChat` and `EncodeChatOptions` |
| `tests/encode-chat.test.ts` | New test file |
| `README.md` | Document `encodeChat` API |
| `.changeset/*.md` | Changeset for minor version bump |

## Implementation Phases

| Phase | Scope | Files |
|-------|-------|-------|
| Phase 1 | ✅ ChatML special tokens already exist | `src/bpe/special-tokens.ts` |
| Phase 2 | Implement `encodeChat` function | `src/encode-chat.ts` |
| Phase 3 | Handle o200k_harmony format | `src/encode-chat.ts` |
| Phase 4 | Tests and parity verification | `tests/encode-chat.test.ts` |
| Phase 5 | Exports, docs, changeset | `src/index.ts`, `README.md` |

## Open Questions

1. **Function definitions**: Should `encodeChat` support encoding function definitions inline? Or keep that separate in `countChatCompletionTokens`?
   - **Recommendation**: Keep separate. `encodeChat` focuses on message encoding. Function definitions are control plane, not content.

2. **Decode counterpart**: Should we implement `decodeChat` that parses tokens back into messages?
   - **Recommendation**: Defer. Lower value, more complexity.

3. **Harmony format verification**: We have the token IDs but no official docs. Need to verify behavior.
   - **Recommendation**: Mark o200k_harmony as experimental, add warning.

## Changeset

```markdown
---
'ai-token-estimator': minor
---

feat: add encodeChat for chat-aware tokenization

- `encodeChat(messages, options)`: Encode chat messages into token IDs using ChatML format
- Returns exact token sequences including special message delimiter tokens
- Supports cl100k_base (GPT-4) and o200k_base (GPT-4o) encodings
- Includes assistant response priming by default (configurable via `primeAssistant` option)
- Handles message `name` field and `function_call` in assistant messages
```

## References

- [OpenAI tiktoken issue #48](https://github.com/openai/tiktoken/issues/48) - ChatML special tokens
- [gpt-tokenizer source](https://github.com/niieani/gpt-tokenizer) - Reference implementation
- [OpenAI Cookbook: Counting tokens](https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb)
