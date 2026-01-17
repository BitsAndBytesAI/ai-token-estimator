# Implementation Plan: Chat Completion Token Counting

## Overview

Add `countChatCompletionTokens()` function to accurately count tokens for OpenAI chat completion requests, including message overhead, function definitions, and function calls.

**Feature:** Chat completion token counting
**Priority:** #2 (Core Functionality - Highest Value)
**Branch:** `feat/chat-completion-token-counting`

---

## Supported Surface Area

### Exact Parity (v1 Scope)
| Feature | Status | Notes |
|---------|--------|-------|
| Messages (role, content, name) | **Exact** | gpt-tokenizer parity |
| Legacy `functions` array | **Exact** | gpt-tokenizer parity |
| Legacy `function_call` control | **Exact** | gpt-tokenizer parity |
| `function_call` in assistant message | **Exact** | gpt-tokenizer parity |
| `role: 'function'` messages | **Exact** | gpt-tokenizer parity |

### Unsupported (v1)
| Feature | Status | Reason |
|---------|--------|--------|
| `tools` array | **Unsupported** | Wire format differs from functions; requires separate research |
| `tool_choice` control | **Unsupported** | Different serialization than function_call |
| `tool_calls` in assistant message | **Unsupported** | Array format with IDs differs from function_call |
| `role: 'tool'` messages | **Unsupported** | Has tool_call_id field, different overhead |
| Multimodal content (vision/audio) | **Unsupported** | Content as array not supported |
| Responses API | **Unsupported** | Different API structure |

### Error Behavior
- Passing `tools`, `tool_choice`, or messages with `tool_calls`/`tool_call_id` → **throws error** with clear message
- Passing multimodal content (array) → **throws error** (detected via runtime check)
- Passing unknown model (not in gpt-tokenizer's `modelToEncodingMap`) → **throws error** listing supported models
- Passing non-OpenAI model (claude-*, gemini-*) → **throws error** suggesting provider-specific APIs

---

## Problem Statement

Currently, `ai-token-estimator` can count tokens for plain text using BPE tokenization, but it doesn't account for:

1. **Message overhead** - Each chat message has structural tokens (`<|im_start|>`, role, `<|im_end|>`)
2. **Function definitions** - Function schemas add significant token overhead
3. **Function calls in messages** - Assistant messages with function_call have metadata tokens

Users need accurate token counts for **legacy chat completion requests with functions** to budget API costs correctly.

---

## Research Summary

### Source: gpt-tokenizer Implementation (`functionCalling.js`)

This is the **source of truth** for our implementation. We will achieve exact parity with `computeChatCompletionTokenCount`.

**Token Overhead Constants:**
```typescript
MESSAGE_TOKEN_OVERHEAD = 3           // Per message
MESSAGE_NAME_TOKEN_OVERHEAD = 1      // When message has 'name' field
FUNCTION_ROLE_TOKEN_DISCOUNT = 2     // Discount for role='function' messages
FUNCTION_CALL_METADATA_TOKEN_OVERHEAD = 3  // For function_call in message
FUNCTION_DEFINITION_TOKEN_OVERHEAD = 9     // Added after formatting functions as TS namespace
COMPLETION_REQUEST_TOKEN_OVERHEAD = 3      // Reply priming
FUNCTION_CALL_NAME_TOKEN_OVERHEAD = 4      // For function_call: {name: "..."}
FUNCTION_CALL_NONE_TOKEN_OVERHEAD = 1      // For function_call: "none"
SYSTEM_FUNCTION_TOKEN_DEDUCTION = 4        // Deduct when system message + functions
```

**Key Logic (from gpt-tokenizer):**

1. **countMessageTokens(message, countStringTokens):**
   - `tokens(role) + tokens(content) + MESSAGE_TOKEN_OVERHEAD`
   - If message has `name`: add `tokens(name) + MESSAGE_NAME_TOKEN_OVERHEAD`
   - If message has `function_call`: add `tokens(name) + tokens(arguments) + FUNCTION_CALL_METADATA_TOKEN_OVERHEAD`
   - If role is `function`: subtract `FUNCTION_ROLE_TOKEN_DISCOUNT`

2. **formatFunctionDefinitions(functions):**
   - Converts functions to TypeScript namespace format
   - Example output:
     ```typescript
     namespace functions {

     // Description here
     type functionName = (_: {
     paramName: string,
     }) => any;

     } // namespace functions
     ```

3. **estimateTokensInFunctions(functions, countStringTokens):**
   - `tokens(formatFunctionDefinitions(functions)) + FUNCTION_DEFINITION_TOKEN_OVERHEAD`

4. **computeChatCompletionTokenCount(request, countStringTokens):**
   - Pad system message with newline if functions present (and not already padded)
   - Sum message tokens
   - Add `COMPLETION_REQUEST_TOKEN_OVERHEAD`
   - If functions: add function tokens, deduct `SYSTEM_FUNCTION_TOKEN_DEDUCTION` if system message exists
   - Handle function_call: 'none' (+1), 'auto' (+0), {name} (+tokens(name)+4)

### Note: OpenAI Cookbook Approach (NOT USED)

The OpenAI cookbook uses a different approach with model-dependent schema-walk constants (func_init, prop_init, etc.). We are **not** using this approach because:

1. It's designed for the modern tools API, not legacy functions
2. gpt-tokenizer has battle-tested parity with actual OpenAI counts
3. Mixing approaches would create inconsistency

If/when we add tools support, the cookbook approach may be relevant and should be researched separately.

---

## API Design

### New Types (`src/types.ts`)

```typescript
// Note: OpenAIEncoding is already defined in src/openai-bpe.ts:
// export type OpenAIEncoding = 'r50k_base' | 'p50k_base' | 'p50k_edit' | 'cl100k_base' | 'o200k_base' | 'o200k_harmony';

/**
 * A chat message in OpenAI legacy format (functions API).
 *
 * Note: This type intentionally excludes tool_calls, tool_call_id, and
 * array content. Those features require the tools API which has different
 * token counting logic and is not yet supported.
 */
export interface ChatMessage {
  /** The role of the message author */
  role: 'system' | 'user' | 'assistant' | 'function';
  /**
   * The content of the message (text only; array content not supported).
   * Optional because assistant messages with function_call may omit content.
   */
  content?: string | null;
  /** An optional name for the participant (for multi-user chats or function results) */
  name?: string;
  /** Function call made by the assistant (legacy API) */
  function_call?: {
    name: string;
    arguments: string;
  };
}

/**
 * JSON Schema subset for function parameters.
 */
export interface FunctionParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: FunctionParameterProperty;
  properties?: Record<string, FunctionParameterProperty>;
  required?: string[];
}

/**
 * Function parameters schema.
 */
export interface FunctionParameters {
  type: 'object';
  properties?: Record<string, FunctionParameterProperty>;
  required?: string[];
}

/**
 * A function definition for legacy function calling.
 */
export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters?: FunctionParameters;
}

/**
 * Function call control options (legacy API).
 */
export type FunctionCallOption =
  | 'auto'
  | 'none'
  | { name: string };

/**
 * Input for counting chat completion tokens.
 *
 * Supports the legacy functions API only. For tools API support,
 * see the roadmap in the package documentation.
 */
export interface ChatCompletionTokenCountInput {
  /** The list of messages in the conversation */
  messages: ChatMessage[];
  /**
   * The model to use for token counting.
   * Must be a recognized OpenAI model (in gpt-tokenizer's modelToEncodingMap).
   * If using a new model not yet in the map, provide `encoding` instead.
   */
  model: string;
  /**
   * Explicit encoding override. When provided, skips model validation and
   * uses this encoding directly. Useful for new OpenAI models not yet in
   * gpt-tokenizer's modelToEncodingMap.
   */
  encoding?: OpenAIEncoding;
  /** Function definitions (legacy API) */
  functions?: FunctionDefinition[];
  /** Function call control (legacy API) */
  function_call?: FunctionCallOption;
  /** Include per-message token breakdown in output */
  includeBreakdown?: boolean;
}

/**
 * Output from counting chat completion tokens.
 */
export interface ChatCompletionTokenCountOutput {
  /** Total token count for the request */
  totalTokens: number;
  /**
   * Tokens from messages (sum of per-message tokens).
   * Does NOT include completionOverheadTokens.
   */
  messageTokens: number;
  /**
   * Tokens added for completion request overhead (reply priming).
   * This is the COMPLETION_REQUEST_TOKEN_OVERHEAD constant (3 tokens).
   * Kept separate from messageTokens for clarity.
   */
  completionOverheadTokens: number;
  /** Tokens from function definitions */
  functionTokens: number;
  /** Tokens from function_call setting */
  functionCallTokens: number;
  /** Whether exact tokenization was used (always true for supported inputs) */
  exact: true;
  /** The encoding used (reuses existing OpenAIEncoding type for consistency) */
  encoding: OpenAIEncoding;
  /**
   * Breakdown by message (only if includeBreakdown: true).
   *
   * Note on field semantics:
   * - `stringTokens`: tokens from encoding role, content, name, function_call fields
   * - `overheadTokens`: fixed overhead (MESSAGE_TOKEN_OVERHEAD, NAME_TOKEN_OVERHEAD, etc.)
   *   including the function-role discount when applicable
   *
   * The completionOverheadTokens (reply priming) is NOT included in this breakdown
   * as it applies to the request as a whole, not individual messages.
   */
  messageBreakdown?: Array<{
    role: string;
    stringTokens: number;
    overheadTokens: number;
    totalTokens: number;
  }>;
}
```

### New Function

```typescript
/**
 * Count tokens for an OpenAI chat completion request with legacy functions API.
 *
 * Achieves exact parity with gpt-tokenizer's computeChatCompletionTokenCount.
 *
 * @throws {Error} If model is not an OpenAI model
 * @throws {Error} If tools, tool_choice, tool_calls, or tool_call_id are present
 * @throws {Error} If any message has array content (multimodal)
 *
 * @example
 * ```typescript
 * const result = countChatCompletionTokens({
 *   messages: [
 *     { role: 'system', content: 'You are a helpful assistant.' },
 *     { role: 'user', content: 'Hello!' }
 *   ],
 *   model: 'gpt-4o',
 *   functions: [{
 *     name: 'get_weather',
 *     description: 'Get weather for a location',
 *     parameters: {
 *       type: 'object',
 *       properties: {
 *         location: { type: 'string', description: 'City name' }
 *       }
 *     }
 *   }]
 * });
 *
 * console.log(result.totalTokens); // e.g., 45
 * ```
 */
export function countChatCompletionTokens(
  input: ChatCompletionTokenCountInput
): ChatCompletionTokenCountOutput;
```

---

## Implementation Details

### File Structure

```
src/
├── chat-completion-tokens.ts   # Main function + validation
├── chat-token-constants.ts     # Token overhead constants (from gpt-tokenizer)
├── function-formatting.ts      # TypeScript namespace formatter (port from gpt-tokenizer)
├── types.ts                    # Updated with new types
└── index.ts                    # Updated exports

tests/
└── chat-completion-tokens.test.ts  # Tests including gpt-tokenizer parity tests
```

### Constants (`src/chat-token-constants.ts`)

```typescript
/**
 * Token overhead constants from gpt-tokenizer.
 * These are the source of truth for legacy functions API counting.
 */

// Message overhead
export const MESSAGE_TOKEN_OVERHEAD = 3;
export const MESSAGE_NAME_TOKEN_OVERHEAD = 1;
export const FUNCTION_ROLE_TOKEN_DISCOUNT = 2;
export const COMPLETION_REQUEST_TOKEN_OVERHEAD = 3;

// Function call in message
export const FUNCTION_CALL_METADATA_TOKEN_OVERHEAD = 3;

// Function call control
export const FUNCTION_CALL_NAME_TOKEN_OVERHEAD = 4;
export const FUNCTION_CALL_NONE_TOKEN_OVERHEAD = 1;

// Function definitions
export const FUNCTION_DEFINITION_TOKEN_OVERHEAD = 9;

// System message adjustment
export const SYSTEM_FUNCTION_TOKEN_DEDUCTION = 4;
```

### Function Formatting (`src/function-formatting.ts`)

Port the exact logic from gpt-tokenizer's `formatFunctionDefinitions`, `formatObjectProperties`, and `formatFunctionType` functions. This produces a TypeScript namespace string that is then tokenized.

```typescript
/**
 * Format function definitions as TypeScript namespace.
 * Direct port from gpt-tokenizer for exact parity.
 */
export function formatFunctionDefinitions(functions: FunctionDefinition[]): string;

/**
 * Format object properties for TypeScript type definition.
 */
export function formatObjectProperties(
  obj: FunctionParameters,
  indent: number,
  formatType: (param: FunctionParameterProperty, indent: number) => string
): string;

/**
 * Format a parameter type for TypeScript.
 */
export function formatFunctionType(param: FunctionParameterProperty, indent: number): string;
```

### Main Function Logic

```typescript
export function countChatCompletionTokens(
  input: ChatCompletionTokenCountInput
): ChatCompletionTokenCountOutput {
  const { messages, model, functions, function_call, includeBreakdown } = input;
  const encodingOverride = input.encoding;

  // 1. Validate: reject unsupported features
  validateNoToolsApi(input);  // throws if tools/tool_choice present
  validateNoMultimodalContent(messages);  // throws if invalid content types
  validateOpenAIModel(model, encodingOverride);  // throws if unknown model (unless encoding override)

  // 2. Resolve encoding and create token counter
  const resolvedEncoding: OpenAIEncoding = encodingOverride ?? getOpenAIEncoding({ model });
  const countStringTokens = (text: string): number => {
    if (!text) return 0;
    return encode(text, { encoding: resolvedEncoding, allowSpecial: 'none' }).length;
  };

  // 3. Determine if functions are present
  const hasFunctions = Boolean(functions && functions.length > 0);

  // 4. Count message tokens
  let messageTokens = 0;
  let hasSystemMessage = false;
  let systemPadded = false;
  const breakdown: ChatCompletionTokenCountOutput['messageBreakdown'] = [];

  for (const message of messages) {
    // Handle system message padding when functions present
    let contentToCount = message.content ?? '';
    if (hasFunctions && message.role === 'system' && !systemPadded) {
      if (contentToCount && !contentToCount.endsWith('\n')) {
        contentToCount = contentToCount + '\n';
      }
      systemPadded = true;
    }
    if (message.role === 'system') {
      hasSystemMessage = true;
    }

    // Count tokens for this message
    const msgTokens = countMessageTokensInternal(
      { ...message, content: contentToCount },
      countStringTokens
    );
    messageTokens += msgTokens.total;

    if (includeBreakdown) {
      breakdown.push({
        role: message.role,
        stringTokens: msgTokens.stringTokens,
        overheadTokens: msgTokens.overhead,
        totalTokens: msgTokens.total,
      });
    }
  }

  // 5. Completion request overhead (reply priming) - kept separate
  const completionOverheadTokens = COMPLETION_REQUEST_TOKEN_OVERHEAD;

  // 6. Count function definition tokens
  let functionTokens = 0;
  if (hasFunctions && functions) {
    const formatted = formatFunctionDefinitions(functions);
    functionTokens = countStringTokens(formatted) + FUNCTION_DEFINITION_TOKEN_OVERHEAD;

    // Deduct tokens if system message present with functions
    if (hasSystemMessage) {
      functionTokens -= SYSTEM_FUNCTION_TOKEN_DEDUCTION;
    }
  }

  // 7. Count function_call control tokens
  let functionCallTokens = 0;
  if (function_call && function_call !== 'auto') {
    if (function_call === 'none') {
      functionCallTokens = FUNCTION_CALL_NONE_TOKEN_OVERHEAD;
    } else if (typeof function_call === 'object' && function_call.name) {
      functionCallTokens = countStringTokens(function_call.name) + FUNCTION_CALL_NAME_TOKEN_OVERHEAD;
    }
  }

  // 8. Calculate total
  const totalTokens = messageTokens + completionOverheadTokens + functionTokens + functionCallTokens;

  const result: ChatCompletionTokenCountOutput = {
    totalTokens,
    messageTokens,
    completionOverheadTokens,
    functionTokens,
    functionCallTokens,
    exact: true,
    encoding: resolvedEncoding,
  };

  if (includeBreakdown) {
    result.messageBreakdown = breakdown;
  }

  return result;
}

/**
 * Internal helper to count tokens for a single message.
 *
 * Returns:
 * - stringTokens: tokens from encoding the actual string fields (role, content, name, function_call)
 * - overhead: fixed token adjustments (MESSAGE_TOKEN_OVERHEAD, NAME_TOKEN_OVERHEAD, etc.)
 */
function countMessageTokensInternal(
  message: ChatMessage,
  countStringTokens: (text: string) => number
): { stringTokens: number; overhead: number; total: number } {
  let stringTokens = 0;
  let overhead = MESSAGE_TOKEN_OVERHEAD;

  // Role
  if (message.role) {
    stringTokens += countStringTokens(message.role);
  }

  // Content
  if (message.content) {
    stringTokens += countStringTokens(message.content);
  }

  // Name
  if (message.name) {
    stringTokens += countStringTokens(message.name);
    overhead += MESSAGE_NAME_TOKEN_OVERHEAD;
  }

  // Function call (in assistant message)
  if (message.function_call) {
    if (message.function_call.name) {
      stringTokens += countStringTokens(message.function_call.name);
    }
    if (message.function_call.arguments) {
      stringTokens += countStringTokens(message.function_call.arguments);
    }
    overhead += FUNCTION_CALL_METADATA_TOKEN_OVERHEAD;
  }

  // Function role discount
  if (message.role === 'function') {
    overhead -= FUNCTION_ROLE_TOKEN_DISCOUNT;
  }

  return {
    stringTokens,
    overhead,
    total: stringTokens + overhead,
  };
}
```

### Validation Functions

```typescript
import { modelToEncodingMap } from 'gpt-tokenizer/mapping';

/**
 * Validate that the input doesn't use tools API features.
 *
 * Implementation note: Uses type assertion to check for properties that
 * shouldn't exist per our types but may be passed by JS callers.
 */
function validateNoToolsApi(input: ChatCompletionTokenCountInput): void {
  const inputAny = input as Record<string, unknown>;
  if ('tools' in inputAny && inputAny.tools !== undefined) {
    throw new Error(
      'Tools API is not yet supported. Use the legacy functions API, ' +
      'or see package documentation for tools API roadmap.'
    );
  }
  if ('tool_choice' in inputAny && inputAny.tool_choice !== undefined) {
    throw new Error(
      'tool_choice is not yet supported. Use function_call with the legacy functions API.'
    );
  }
}

/**
 * Validate that messages don't contain unsupported content types.
 *
 * Implementation note: Uses type assertion for runtime checks on fields
 * that shouldn't exist per our types but may be passed by JS callers.
 */
function validateNoMultimodalContent(messages: ChatMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Validate content is string | null | undefined (reject arrays, numbers, objects, etc.)
    const content = msg.content;
    if (content !== undefined && content !== null && typeof content !== 'string') {
      if (Array.isArray(content)) {
        throw new Error(
          `messages[${i}].content: Multimodal content (arrays) is not supported. ` +
          'Only text content (string) is supported.'
        );
      }
      throw new Error(
        `messages[${i}].content: Expected string | null | undefined, ` +
        `got ${typeof content}. Only text content is supported.`
      );
    }

    // Check for tool_calls or tool_call_id (shouldn't exist per our types, but runtime safety)
    const msgAny = msg as Record<string, unknown>;
    if ('tool_calls' in msgAny) {
      throw new Error(
        `messages[${i}]: tool_calls is not yet supported. Use the legacy functions API.`
      );
    }
    if ('tool_call_id' in msgAny) {
      throw new Error(
        `messages[${i}]: tool_call_id is not yet supported. Use the legacy functions API.`
      );
    }
  }
}

/**
 * Validate that the model is a supported OpenAI model.
 *
 * Validation precedence:
 * 1. If `encoding` is provided, skip model validation entirely (user override)
 * 2. Reject known non-OpenAI prefixes (claude-*, gemini-*) with helpful message
 * 3. Verify model exists in gpt-tokenizer's modelToEncodingMap
 *
 * This ensures we only return exact: true for models where we can
 * actually provide exact token counts.
 */
function validateOpenAIModel(model: string, encodingOverride?: OpenAIEncoding): void {
  // If encoding override provided, skip model validation
  if (encodingOverride) {
    return;
  }

  // First, give helpful errors for known non-OpenAI models
  if (model.startsWith('claude-')) {
    throw new Error(
      `Model "${model}" is an Anthropic model. Use the Anthropic API's ` +
      'count_tokens endpoint via estimateAsync() for accurate token counts.'
    );
  }
  if (model.startsWith('gemini-')) {
    throw new Error(
      `Model "${model}" is a Google model. Use the Gemini API's ` +
      'countTokens endpoint via estimateAsync() for accurate token counts.'
    );
  }

  // Then, verify the model exists in gpt-tokenizer's supported models
  const supportedModels = modelToEncodingMap as Record<string, string>;
  if (!(model in supportedModels)) {
    throw new Error(
      `Model "${model}" is not recognized. ` +
      'If this is a new OpenAI model, provide the encoding option explicitly ' +
      '(e.g., encoding: "o200k_base"). See gpt-tokenizer docs for supported models.'
    );
  }
}
```

---

## Test Plan

### Test File: `tests/chat-completion-tokens.test.ts`

#### 1. gpt-tokenizer Parity Tests (Golden Tests)
Port all 30+ test cases from `gpt-tokenizer/fixtures/functionCallingTestCases.js`. For each test case:
- Use `model: 'gpt-4o'` (the golden token counts are tied to gpt-4o's cl100k_base encoding in gpt-tokenizer)
- Run through our `countChatCompletionTokens`
- Assert exact equality with expected token count
- These are the primary correctness tests

#### 2. Basic Message Tests
- Single user message
- Single system message
- Multiple messages (system + user + assistant)
- Message with `name` field
- Message with null content
- Message with empty string content

#### 3. Function Definition Tests
- Single function, no parameters
- Single function with parameters
- Function with description
- Function with enum parameters
- Nested object parameters
- Array parameters
- Multiple functions

#### 4. Function Call Control Tests
- `function_call: 'auto'` (no additional tokens)
- `function_call: 'none'` (+1 token)
- `function_call: { name: 'foo' }` (name tokens + 4)
- `function_call` undefined

#### 5. Function Call in Message Tests
- Assistant message with function_call
- Function role message (response)

#### 6. System Message + Functions Tests
- System message padding (newline added)
- System message already ending with newline
- Multiple system messages with functions
- SYSTEM_FUNCTION_TOKEN_DEDUCTION applied correctly

#### 7. Validation/Error Tests
- `tools` array provided → throws
- `tool_choice` provided → throws
- Message with `tool_calls` → throws
- Message with `tool_call_id` → throws
- Message with array content → throws with index in error
- Message with number content → throws with type in error
- Message with object content → throws with type in error
- Claude model → throws with helpful message
- Gemini model → throws with helpful message
- Unknown model (e.g., 'llama-3.1', 'random-string') → throws suggesting encoding override
- Unknown model + encoding override → works (skips model validation)
- Message with content omitted (undefined) + function_call → works correctly

#### 8. Options Tests
- `includeBreakdown: false` (default) → no messageBreakdown in output
- `includeBreakdown: true` → messageBreakdown included

#### 9. Edge Cases
- Empty messages array
- Unicode/emoji in messages
- Special-token-like strings in content (should not throw due to allowSpecial: 'none')
- Very long messages

---

## Implementation Steps

### Step 1: Add Types
- [ ] Add `ChatMessage`, `FunctionDefinition`, `FunctionParameters`, etc. to `src/types.ts`
- [ ] Add `ChatCompletionTokenCountInput` and `ChatCompletionTokenCountOutput`
- [ ] Export new types from `src/index.ts`

### Step 2: Add Constants
- [ ] Create `src/chat-token-constants.ts`
- [ ] Define all overhead constants matching gpt-tokenizer exactly

### Step 3: Port Function Formatting
- [ ] Create `src/function-formatting.ts`
- [ ] Port `formatFunctionDefinitions` from gpt-tokenizer
- [ ] Port `formatObjectProperties` from gpt-tokenizer
- [ ] Port `formatFunctionType` from gpt-tokenizer
- [ ] Add unit tests for formatting functions

### Step 4: Implement Main Function
- [ ] Create `src/chat-completion-tokens.ts`
- [ ] Implement validation functions
- [ ] Implement `countMessageTokensInternal`
- [ ] Implement `countChatCompletionTokens`
- [ ] Export from `src/index.ts`

### Step 5: Write Tests
- [ ] Create `tests/chat-completion-tokens.test.ts`
- [ ] Port all 30+ golden tests from gpt-tokenizer
- [ ] Add validation/error tests
- [ ] Add edge case tests
- [ ] Add options tests

### Step 6: Documentation
- [ ] Add JSDoc comments to all public APIs
- [ ] Update README.md with usage examples and limitations
- [ ] Document that tools API is not yet supported
- [ ] Update FEATURE_IDEAS_GPT_TOKENIZER.md

---

## Success Criteria

- [ ] All gpt-tokenizer golden tests pass with **exact** token counts (using `model: 'gpt-4o'`)
- [ ] Clear errors thrown for unsupported features (tools API, multimodal)
- [ ] Clear errors thrown for non-OpenAI models with helpful alternatives
- [ ] Clear errors thrown for unknown models, with suggestion to use `encoding` override
- [ ] `encoding` option allows bypassing model validation for new models
- [ ] `encoding` field in output uses `OpenAIEncoding` type (not `string`)
- [ ] TypeScript types are accurate and don't allow unsupported fields
- [ ] `ChatMessage.content` is optional to match real API usage
- [ ] Content validation rejects non-string types (arrays, numbers, objects) with clear errors
- [ ] `includeBreakdown` is opt-in
- [ ] `messageBreakdown` uses `stringTokens` (not `contentTokens`) for clarity
- [ ] `completionOverheadTokens` separated from `messageTokens` for clarity
- [ ] No console.log/warn calls from library code
- [ ] Documentation clearly states supported vs unsupported features

---

## Future Work (Out of Scope for v1)

### Tools API Support
When adding tools API support:
1. Research actual wire format differences between functions and tools
2. Research OpenAI cookbook's schema-walk approach for modern models
3. May need model-dependent constants (func_init=7 for gpt-4o vs 10 for gpt-4)
4. Add separate types: `ToolDefinition`, `ToolChoice`, `ToolCall`
5. Add comprehensive tests against actual OpenAI API responses

### Multimodal Content
When adding vision/audio support:
1. Research token counting for image_url content
2. Research token counting for audio content
3. May need to call OpenAI's API for accurate counts (like we do for Claude/Gemini)

---

## References

1. [gpt-tokenizer source code](https://github.com/niieani/gpt-tokenizer) - `functionCalling.ts` (source of truth)
2. [gpt-tokenizer test fixtures](https://github.com/niieani/gpt-tokenizer) - `functionCallingTestCases.ts`
3. [OpenAI Cookbook - Token Counting](https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb) - Reference for future tools API work
