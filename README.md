# ai-token-estimator

[![npm](https://img.shields.io/npm/v/ai-token-estimator.svg)](https://www.npmjs.com/package/ai-token-estimator)
[![CI](https://github.com/BitsAndBytesAI/ai-token-estimator/actions/workflows/ci.yml/badge.svg)](https://github.com/BitsAndBytesAI/ai-token-estimator/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/ai-token-estimator.svg)](https://github.com/BitsAndBytesAI/ai-token-estimator/blob/main/LICENSE)

The best way to estimate **tokens + input cost** for LLM calls — with **exact OpenAI tokenization** (tiktoken-compatible BPE), a pure TypeScript **SentencePiece tokenizer** (T5, ALBERT, XLNet, Gemma, LLaMA 2, and more), and optional provider-backed token counting for Anthropic + Gemini.

> **Zero external dependencies** — pure TypeScript implementation of both BPE and SentencePiece tokenizers.

## Features

- **Exact OpenAI tokenization** (tiktoken-compatible BPE): `encode()` / `decode()` / `openai_exact`
- **Chat-aware tokenization**: `encodeChat()` returns exact token IDs for chat messages using ChatML format
- **Fast token limit checking**: `isWithinTokenLimit()` / `isChatWithinTokenLimit()` with early-exit optimization (up to 1000x faster for large texts)
- **Generator-based streaming**: `encodeGenerator()` / `encodeChatGenerator()` / `decodeGenerator()` / `decodeAsyncGenerator()` for memory-efficient tokenization
- **OpenAI chat completion token counting** (legacy `functions` API): `countChatCompletionTokens()` with optional per-message breakdown
- **Pure TypeScript SentencePiece tokenizer** (no native dependencies):
  - Supports `.model` files (protobuf format)
  - Supports `tokenizer.json` files (HuggingFace format, validated configs)
  - Unigram + SentencePiece-style BPE, plus merges-based JSON-BPE (when represented in `tokenizer.json`)
  - Works in Node.js and browsers
- **Official provider token counting** (async):
  - Anthropic `POST /v1/messages/count_tokens` (`anthropic_count_tokens`)
  - Gemini `models/:countTokens` (`gemini_count_tokens`)
- **Fast local fallback** options:
  - Heuristic (`heuristic`, default)
  - Local SentencePiece tokenization for Gemma/LLaMA/T5 models
  - Automatic fallback to heuristic on provider failures (`fallbackToHeuristicOnError`)
- **Cost estimation** using a weekly auto-updated pricing/model list (GitHub Actions)
- TypeScript-first, ships ESM + CJS, zero runtime dependencies

## Installation

```bash
npm install ai-token-estimator
```

## Usage

```typescript
import { countTokens, estimate, getAvailableModels } from 'ai-token-estimator';

// Basic usage
const result = estimate({
  text: 'Hello, world! This is a test message.',
  model: 'gpt-4o'
});

console.log(result);
// {
//   model: 'gpt-4o',
//   characterCount: 38,
//   estimatedTokens: 10,
//   estimatedInputCost: 0.000025,
//   charsPerToken: 4
// }

// List available models
console.log(getAvailableModels());
// ['gpt-5.2', 'gpt-4o', 'claude-opus-4.5', 'gemini-3-pro', ...]

// Exact tokens for OpenAI, heuristic for others
console.log(countTokens({ text: 'Hello, world!', model: 'gpt-5.1' }));
// { tokens: 4, exact: true, encoding: 'o200k_base' }
```

## Quick Recipes

### Encode chat messages to tokens (ChatML format)

```ts
import { encodeChat, decode } from 'ai-token-estimator';

const tokens = encodeChat([
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello!' }
], { model: 'gpt-4o' });

console.log(tokens); // [200264, 9125, 200266, 2610, 525, 11190, 13, 200265, ...]
console.log(decode(tokens, { encoding: 'o200k_base' }));
// <|im_start|>system<|im_sep|>You are helpful.<|im_end|>...
```

### OpenAI chat completion tokens (legacy functions API)

```ts
import { countChatCompletionTokens } from 'ai-token-estimator';

const { totalTokens } = countChatCompletionTokens({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### Fast token limit checking (early exit)

```ts
import { isWithinTokenLimit, isChatWithinTokenLimit } from 'ai-token-estimator';

// Plain text - returns token count or false if exceeded
const count = isWithinTokenLimit(longText, 4096, { model: 'gpt-4o' });
if (count === false) console.log('Text exceeds limit');

// Chat messages - same early-exit optimization
const chatCount = isChatWithinTokenLimit({
  messages: [{ role: 'user', content: longText }],
  model: 'gpt-4o',
  tokenLimit: 4096,
});
```

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

### Local SentencePiece token counting

```ts
import { countSentencePieceTokensAsync } from 'ai-token-estimator';

const tokens = await countSentencePieceTokensAsync('Hello!', {
  modelPath: './path/to/spiece.model',
});
```

### Provider-backed counts (server-side)

```ts
import { estimateAsync } from 'ai-token-estimator';

const out = await estimateAsync({
  model: 'claude-sonnet-4.5',
  text: 'Hello!',
  tokenizer: 'anthropic_count_tokens',
});
```

## Exact OpenAI tokenization (BPE)

This package includes **exact tokenization for OpenAI models** using a built-in tiktoken-compatible BPE tokenizer.

Notes:
- Exact tokenization is **slower** than heuristic estimation; `estimate()` defaults to `'heuristic'` to keep existing behavior fast.
- For distribution/build compatibility, all OpenAI vocabularies are bundled (trade-off: larger bundle size).
- Pure TypeScript implementation: works in Node.js and browsers (no native deps, no WASM).

```ts
import { encode, decode } from 'ai-token-estimator';

const text = 'Hello, world!';
const tokens = encode(text, { model: 'gpt-5.1' }); // exact OpenAI token IDs
const roundTrip = decode(tokens, { model: 'gpt-5.1' });

console.log(tokens.length);
console.log(roundTrip); // "Hello, world!"
```

Supported encodings:
`r50k_base`, `p50k_base`, `p50k_edit`, `cl100k_base`, `o200k_base`, `o200k_harmony`

## SentencePiece Tokenizer (T5, ALBERT, XLNet, Gemma, LLaMA 2, etc.)

This package includes a **pure TypeScript SentencePiece tokenizer** with zero native dependencies. It supports models that use Unigram or SentencePiece-style BPE tokenization (plus validated `tokenizer.json` configurations), including T5, ALBERT, XLNet, Gemma, LLaMA 2, and many HuggingFace models.

### Basic Usage

```typescript
import {
  loadSentencePieceTokenizer,
  getSentencePieceTokenizer,
  encodeSentencePiece,
  decodeSentencePiece,
  countSentencePieceTokens
} from 'ai-token-estimator';

// Async API (Node.js) - load from file
const tokenizer = await loadSentencePieceTokenizer({
  modelPath: './path/to/tokenizer.model'
});

const tokens = tokenizer.encode('Hello, world!');
const text = tokenizer.decode(tokens);
console.log(tokens);        // [8774, 6, 296, 55]
console.log(text);          // "Hello, world!"
console.log(tokenizer.vocabSize);  // 32000
console.log(tokenizer.algorithm);  // "unigram" or "bpe"

// Sync API (browser/serverless) - from ArrayBuffer
const response = await fetch('/models/tokenizer.model');
const modelData = new Uint8Array(await response.arrayBuffer());
const tokenizer2 = getSentencePieceTokenizer({ modelData });
```

### Supported Model Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| **SentencePiece Protobuf** | `.model` | Native SentencePiece format (T5, ALBERT, XLNet, Gemma) |
| **HuggingFace JSON** | `tokenizer.json` | HuggingFace tokenizers format (many models) |

Notes:
- `tokenizer.json` support is intentionally scoped to validated configs (Unigram and merges-based BPE with Metaspace-style whitespace handling). If a tokenizer JSON uses ByteLevel/byte-fallback pipelines (GPT-2-style), this library will throw a helpful error.

```typescript
// Load .model file (protobuf)
const tokenizer = await loadSentencePieceTokenizer({
  modelPath: './t5-base/spiece.model'
});

// Load tokenizer.json (HuggingFace format)
const tokenizer = await loadSentencePieceTokenizer({
  modelPath: './my-hf-model/tokenizer.json',
  format: 'json'  // optional, auto-detected from extension
});
```

### Model Download Helper

For convenience, you can automatically download known models (opt-in network access):

```typescript
import { ensureSentencePieceModel, MODEL_REGISTRY } from 'ai-token-estimator';

// Download a known model (cached locally). No network calls unless allowDownload: true.
const modelPath = await ensureSentencePieceModel({
  tokenizer: 't5-base',
  allowDownload: true,
  cacheDir: './models', // optional; default: ~/.cache/sentencepiece (or SENTENCEPIECE_MODEL_CACHE_DIR)
});

const tokenizer = await loadSentencePieceTokenizer({ modelPath });

// Available pre-configured models (registry can be extended)
console.log(Object.keys(MODEL_REGISTRY));
// ['t5-base', 'albert-base-v2', 'xlnet-base-cased', 'gemma', 'llama2', ...]
```

Notes:
- Downloads are disabled by default (`allowDownload: false`) to avoid surprise network calls.
- Some registry entries may be gated and require HuggingFace authentication (`HF_TOKEN` / `HUGGINGFACE_HUB_TOKEN` or `authToken` option).

### Convenience Functions

```typescript
import {
  encodeSentencePieceAsync,
  decodeSentencePieceAsync,
  countSentencePieceTokensAsync
} from 'ai-token-estimator';

// One-liner encoding/decoding (loads model each time - use tokenizer instance for batch)
const tokens = await encodeSentencePieceAsync('Hello!', { modelPath: './model.model' });
const text = await decodeSentencePieceAsync(tokens, { modelPath: './model.model' });
const count = await countSentencePieceTokensAsync('Hello!', { modelPath: './model.model' });
```

### Algorithm Support

| Algorithm | Description | Models |
|-----------|-------------|--------|
| **Unigram** | Probabilistic subword segmentation | T5, ALBERT, XLNet, mT5 |
| **SentencePiece BPE** | Score-based BPE used in `.model` files | Gemma, LLaMA 2 (and other SP-BPE models) |
| **JSON-BPE (merges-based)** | BPE defined by `vocab` + `merges[]` in `tokenizer.json` | Some HuggingFace tokenizers (validated configs) |

The algorithm is automatically detected from the model file.

### Advanced: Working with Custom Models

```typescript
import { parseModelProto, UnigramEncoder, BPEEncoder } from 'ai-token-estimator';

// Low-level: parse model protobuf directly
const modelBytes = fs.readFileSync('./custom.model');
const model = parseModelProto(new Uint8Array(modelBytes));

console.log(model.pieces.length);           // vocabulary size
console.log(model.trainerSpec?.modelType);  // 1 = UNIGRAM, 2 = BPE
console.log(model.normalizerSpec?.name);    // e.g., 'nmt_nfkc'

// Create encoder directly
const encoder = new UnigramEncoder(model.pieces, {
  trainerSpec: model.trainerSpec
});
const tokens = encoder.encode('Hello, world!');
```

### Normalization

The tokenizer handles SentencePiece normalization automatically:

- **Dummy prefix**: Adds space before text (configurable)
- **Whitespace escaping**: Converts spaces to `▁` (U+2581)
- **NFKC normalization**: Unicode normalization
- **Extra whitespace removal**: Collapses multiple spaces

```typescript
// Access normalizer directly
import { Normalizer } from 'ai-token-estimator';

const normalizer = new Normalizer({
  normalizerSpec: model.normalizerSpec,
  denormalizerSpec: model.denormalizerSpec,
});

const normalized = normalizer.normalize('Hello  World');
// "▁Hello▁World" (with dummy prefix and escaped spaces)

const denormalized = normalizer.denormalize('▁Hello▁World');
// "Hello World"
```

### Browser Usage

The SentencePiece tokenizer works in browsers without any polyfills:

```typescript
// Fetch model and create tokenizer
async function loadTokenizer(modelUrl: string) {
  const response = await fetch(modelUrl);
  const modelData = new Uint8Array(await response.arrayBuffer());
  return getSentencePieceTokenizer({ modelData });
}

const tokenizer = await loadTokenizer('/models/t5.model');
const tokens = tokenizer.encode('Browser tokenization!');
```

### Caching

Model parsing is automatically cached for performance:

```typescript
import { clearModelCache } from 'ai-token-estimator';

// Clear cache if needed (e.g., for memory management)
clearModelCache();
```

## Using the exact tokenizer with `estimate()`

`estimate()` is heuristic by default (fast). If you want to use exact OpenAI token counting:

```ts
import { estimate } from 'ai-token-estimator';

const result = estimate({
  text: 'Hello, world!',
  model: 'gpt-5.1',
  tokenizer: 'openai_exact',
});

console.log(result.tokenizerMode); // "openai_exact"
console.log(result.encodingUsed);  // "o200k_base"
```

Or use `tokenizer: 'auto'` to use exact counting for OpenAI models and heuristic for everything else.

## Provider token counting (Claude / Gemini)

If you want **more accurate token counts** for Anthropic or Gemini models, you can call their official token counting endpoints
via `estimateAsync()`. This requires API keys, and therefore should be used **server-side** (never in the browser).

If you want these modes to **fail open** (fallback to heuristic estimation) when the provider API is throttled/unavailable or the API key is invalid,
set `fallbackToHeuristicOnError: true`.

### Anthropic: `POST /v1/messages/count_tokens`

- Env var: `ANTHROPIC_API_KEY`

```ts
import { estimateAsync } from 'ai-token-estimator';

const out = await estimateAsync({
  text: 'Hello, Claude',
  model: 'claude-sonnet-4.5',
  tokenizer: 'anthropic_count_tokens',
  fallbackToHeuristicOnError: true,
  anthropic: {
    // apiKey: '...' // optional; otherwise uses process.env.ANTHROPIC_API_KEY
    system: 'You are a helpful assistant',
  },
});

console.log(out.estimatedTokens);
```

### Gemini: `models/:countTokens` (Google AI Studio)

- Env var: `GEMINI_API_KEY`

```ts
import { estimateAsync } from 'ai-token-estimator';

const out = await estimateAsync({
  text: 'The quick brown fox jumps over the lazy dog.',
  model: 'gemini-2.0-flash',
  tokenizer: 'gemini_count_tokens',
  fallbackToHeuristicOnError: true,
  gemini: {
    // apiKey: '...' // optional; otherwise uses process.env.GEMINI_API_KEY
  },
});

console.log(out.estimatedTokens);
```

### Local Gemini option: Gemma SentencePiece

If you want a **local** tokenizer option for Gemini-like models, you can use a SentencePiece tokenizer model (e.g. Gemma's `tokenizer.model`) with our pure TypeScript SentencePiece implementation.

```ts
import { estimateAsync, countGemmaSentencePieceTokens } from 'ai-token-estimator';

// Via estimateAsync
const out = await estimateAsync({
  text: 'Hello!',
  model: 'gemini-2.0-flash',
  tokenizer: 'gemma_sentencepiece',
  gemma: {
    modelPath: '/path/to/tokenizer.model',
  },
});

console.log(out.estimatedTokens);

// Or use directly
const count = await countGemmaSentencePieceTokens({
  modelPath: '/path/to/tokenizer.model',
  text: 'Hello, world!'
});
```

Note:
- This is **not** an official Gemini tokenizer; treat it as an approximation unless you have verified equivalence for your models.
- Uses our pure TypeScript SentencePiece implementation (no native dependencies).

## API Reference

### `estimate(input: EstimateInput): EstimateOutput`

Estimates token count and cost for the given text and model.

**Parameters:**

```typescript
interface EstimateInput {
  text: string;           // The text to estimate tokens for
  model: string;          // Model ID (e.g., 'gpt-4o', 'claude-opus-4.5')
  rounding?: 'ceil' | 'round' | 'floor';  // Rounding strategy (default: 'ceil')
  tokenizer?: 'heuristic' | 'openai_exact' | 'auto'; // Token counting strategy (default: 'heuristic')

  // Extended cost estimation (optional)
  outputTokens?: number;        // Output tokens for cost calculation
  cachedInputTokens?: number;   // Cached input tokens (OpenAI only, must be <= estimatedTokens)
  mode?: 'standard' | 'batch';  // Pricing mode (default: 'standard')
}
```

Note:
- Provider-backed modes (`anthropic_count_tokens`, `gemini_count_tokens`, `gemma_sentencepiece`) are only supported in `estimateAsync()`.
- When `outputTokens`, `cachedInputTokens`, or `mode` is provided, the model must have the corresponding pricing available or an error is thrown.

**Returns:**

```typescript
interface EstimateOutput {
  model: string;           // The model used
  characterCount: number;  // Number of Unicode code points
  estimatedTokens: number; // Estimated token count (integer)
  estimatedInputCost: number; // Estimated input cost in USD
  charsPerToken: number;   // The ratio used for this model
  tokenizerMode?: 'heuristic' | 'openai_exact' | 'auto'; // Which strategy was used
  encodingUsed?: string;   // OpenAI encoding when using exact tokenization

  // Extended cost fields (when cost inputs are provided)
  outputTokens?: number;           // Echoed from input
  estimatedOutputCost?: number;    // Output token cost in USD
  estimatedCachedInputCost?: number; // Cached input cost in USD
  estimatedTotalCost: number;      // Total cost (input + output + cached)
}
```

### `estimateAsync(input: EstimateAsyncInput): Promise<EstimateOutput>`

Async estimator that supports provider token counting modes:
- `anthropic_count_tokens` (Anthropic token count endpoint)
- `gemini_count_tokens` (Gemini token count endpoint)
- `gemma_sentencepiece` (local SentencePiece tokenization using built-in pure TypeScript implementation)

API keys should be provided via env vars (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) or passed explicitly in the config objects.

If you pass `fallbackToHeuristicOnError: true`, provider-backed modes will fall back to heuristic estimation on:
- invalid/expired API key (401/403)
- rate limiting (429)
- provider errors (5xx) or network issues

### `countTokens(input: TokenCountInput): TokenCountOutput`

Counts tokens for a given model:
- OpenAI models: **exact** BPE tokenization
- Other providers: heuristic estimate

```ts
import { countTokens } from 'ai-token-estimator';

const result = countTokens({ text: 'Hello, world!', model: 'gpt-5.1' });
// { tokens: 4, exact: true, encoding: 'o200k_base' }
```

### `countChatCompletionTokens(input: ChatCompletionTokenCountInput): ChatCompletionTokenCountOutput`

Counts tokens for an **OpenAI chat completion request**, including messages, function definitions, and function_call controls. Achieves exact parity with OpenAI's actual token counting for normal text inputs.

**Important limitations:**
- **Legacy functions API only** — supports `functions` and `function_call` parameters
- **Tools API not supported** — throws if `tools`, `tool_choice`, `tool_calls`, or `tool_call_id` are present
- **Text content only** — throws for multimodal content (arrays, images)
- **Chat models only** — rejects non-chat models like `davinci-002`

```ts
import { countChatCompletionTokens } from 'ai-token-estimator';

const result = countChatCompletionTokens({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the weather in Paris?' }
  ],
  model: 'gpt-4o',
  functions: [{
    name: 'get_weather',
    description: 'Get weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' }
      },
      required: ['location']
    }
  }],
  function_call: 'auto',
  includeBreakdown: true  // optional: get per-message token breakdown
});

console.log(result);
// {
//   totalTokens: 75,
//   messageTokens: 25,
//   completionOverheadTokens: 3,
//   functionTokens: 42,
//   functionCallTokens: 0,
//   exact: true,
//   encoding: 'o200k_base',
//   messageBreakdown: [...]  // when includeBreakdown: true
// }
```

**Parameters:**

```typescript
interface ChatCompletionTokenCountInput {
  messages: ChatMessage[];           // Chat messages
  model: string;                     // OpenAI chat model (e.g., 'gpt-4o')
  encoding?: OpenAIEncoding;         // Override encoding for new models
  functions?: FunctionDefinition[];  // Legacy function definitions
  function_call?: 'auto' | 'none' | { name: string };  // Function calling control
  includeBreakdown?: boolean;        // Include per-message token breakdown
}
```

**Returns:**

```typescript
interface ChatCompletionTokenCountOutput {
  totalTokens: number;             // Total tokens in the request
  messageTokens: number;           // Tokens from messages (including overhead)
  completionOverheadTokens: number; // Reply priming tokens (always 3)
  functionTokens: number;          // Tokens from function definitions
  functionCallTokens: number;      // Tokens from function_call control
  exact: true;                     // Always exact for this function
  encoding: OpenAIEncoding;        // Encoding used
  messageBreakdown?: Array<{       // Per-message breakdown (if requested)
    role: string;
    stringTokens: number;
    overheadTokens: number;
    totalTokens: number;
  }>;
}
```

### `getAvailableModels(): string[]`

Returns an array of all supported model IDs.

### `encode(text: string, options?: EncodeOptions): number[]`

Encodes text into **OpenAI token IDs** using tiktoken-compatible BPE tokenization.

### `decode(tokens: Iterable<number>, options?: { encoding?: OpenAIEncoding; model?: string }): string`

Decodes OpenAI token IDs back into text using the selected encoding/model.

### `encodeChat(messages: ChatMessage[], options?: EncodeChatOptions): number[]`

Encodes chat messages into **exact token IDs** using ChatML format. Returns the ChatML message prompt tokens (messages + optional assistant priming), including special delimiter tokens (`<|im_start|>`, `<|im_sep|>`, `<|im_end|>`).

```ts
import { encodeChat, decode } from 'ai-token-estimator';

const tokens = encodeChat([
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello!' }
], { model: 'gpt-4o' });

// Tokens include ChatML structure:
// <|im_start|>system<|im_sep|>You are helpful.<|im_end|>
// <|im_start|>user<|im_sep|>Hello!<|im_end|>
// <|im_start|>assistant<|im_sep|>  (priming)
```

**Parameters:**

```typescript
interface EncodeChatOptions {
  model?: string;              // OpenAI model (e.g., 'gpt-4o')
  encoding?: OpenAIEncoding;   // Explicit encoding override
  primeAssistant?: boolean;    // Append assistant priming (default: true)
}
```

**Supported encodings:**
- `cl100k_base` (GPT-4, GPT-3.5-turbo)
- `o200k_base` (GPT-4o, GPT-4o-mini)
- `o200k_harmony` (experimental)

**Limitations:**
- **OpenAI models only** — throws for claude-*, gemini-*
- **Legacy functions API only** — throws for tool_calls, tool_call_id
- **Text content only** — throws for multimodal content (arrays)

**Note on function_call:** Messages with `function_call` are encoded with the function name and arguments as content. The token count differs from `countChatCompletionTokens()` because the latter includes `FUNCTION_CALL_METADATA_TOKEN_OVERHEAD` (3 tokens) for API accounting. The exact difference depends on whether both name and arguments are present (2 token difference due to newline separator) or only one field is present (3 token difference).

**Note on o200k_harmony:** Support for `o200k_harmony` encoding is experimental. The token structure may not match actual API behavior.

### `isWithinTokenLimit(text, tokenLimit, options?): false | number`

Checks if text is within a token limit with **early exit optimization**. Returns `false` if the limit is exceeded, or the actual token count if within limit.

This is significantly faster than full tokenization when the limit is exceeded early in the text (up to 1000x+ faster for large texts with small limits).

```typescript
import { isWithinTokenLimit } from 'ai-token-estimator';

// Returns token count if within limit
const count = isWithinTokenLimit('Hello, world!', 100, { model: 'gpt-4o' });
if (count !== false) {
  console.log(`Text has ${count} tokens`);
}

// Returns false if exceeds limit (with early exit)
const result = isWithinTokenLimit(longText, 10, { model: 'gpt-4o' });
if (result === false) {
  console.log('Text exceeds 10 tokens');
}
```

**Parameters:**

```typescript
interface IsWithinTokenLimitOptions {
  model?: string;              // OpenAI model (e.g., 'gpt-4o')
  encoding?: OpenAIEncoding;   // Explicit encoding override
  allowSpecial?: SpecialTokenHandling;  // How to handle special tokens
}
```

**Throws:**
- `Error` if `tokenLimit` is invalid (NaN, Infinity, negative, non-integer)
- `Error` if `model` is a known non-OpenAI model (claude-*, gemini-*)

### `isChatWithinTokenLimit(input): false | number`

Checks if chat messages are within a token limit with **early exit optimization**. Returns `false` if exceeded, or the actual token count if within limit.

Uses the same token counting logic as `countChatCompletionTokens()` but exits early when the limit is exceeded.

```typescript
import { isChatWithinTokenLimit } from 'ai-token-estimator';

const result = isChatWithinTokenLimit({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' }
  ],
  model: 'gpt-4o',
  tokenLimit: 100,
  functions: [{ name: 'get_weather', parameters: { type: 'object' } }],
});

if (result === false) {
  console.log('Messages exceed token limit');
} else {
  console.log(`Messages use ${result} tokens`);
}
```

**Parameters:**

```typescript
interface IsChatWithinTokenLimitInput {
  messages: ChatMessage[];
  model: string;
  tokenLimit: number;
  encoding?: OpenAIEncoding;
  functions?: FunctionDefinition[];
  function_call?: FunctionCallOption;
}
```

**Throws:**
- `Error` if `tokenLimit` is invalid (NaN, Infinity, negative, non-integer)
- `Error` if model is not an OpenAI model (unless encoding override provided)
- `Error` if tools, tool_choice, tool_calls, or tool_call_id are present
- `Error` if any message has non-string content

### Generator APIs

Generator-based APIs for memory-efficient streaming tokenization.

#### `encodeGenerator(text, options?): Generator<number[], number, undefined>`

Encode text yielding token chunks. Memory-efficient for large inputs.

- **Yields:** `number[]` — token IDs per regex-matched piece (word/punctuation)
- **Returns:** `number` — total token count when iteration completes

```typescript
import { encodeGenerator } from 'ai-token-estimator';

// Stream-encode large text
let tokenCount = 0;
for (const tokenChunk of encodeGenerator(hugeText, { model: 'gpt-4o' })) {
  tokenCount += tokenChunk.length;
}

// Or get total count from return value
const gen = encodeGenerator(text, { model: 'gpt-4o' });
let result = gen.next();
while (!result.done) result = gen.next();
console.log('Total tokens:', result.value);
```

#### `encodeChatGenerator(messages, options?): Generator<number[], number, undefined>`

Encode chat messages yielding token chunks per message component.

- **Yields:** `number[]` — token IDs per component (special tokens, role, content chunks, etc.)
- **Returns:** `number` — total token count

```typescript
import { encodeChatGenerator } from 'ai-token-estimator';

const messages = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello!' }
];

for (const tokenChunk of encodeChatGenerator(messages, { model: 'gpt-4o' })) {
  console.log('Chunk:', tokenChunk);
}
```

#### `decodeGenerator(tokens, options?): Generator<string, void, void>`

Decode tokens yielding text chunks. Uses TextDecoder streaming mode — may yield empty strings when buffering incomplete UTF-8 sequences.

```typescript
import { encode, decodeGenerator } from 'ai-token-estimator';

const tokens = encode('Hello, world!', { model: 'gpt-4o' });
for (const textChunk of decodeGenerator(tokens, { model: 'gpt-4o' })) {
  process.stdout.write(textChunk);
}
```

#### `decodeAsyncGenerator(tokens, options?): AsyncGenerator<string, void, void>`

Decode async token stream yielding text chunks. Accepts `AsyncIterable<number | number[]>` for flexibility with streaming APIs.

```typescript
import { decodeAsyncGenerator } from 'ai-token-estimator';

// Decode streaming LLM response
async function decodeLLMStream(tokenStream: AsyncIterable<number>) {
  for await (const text of decodeAsyncGenerator(tokenStream, { model: 'gpt-4o' })) {
    process.stdout.write(text);
  }
}
```

### `getModelConfig(model: string): ModelConfig`

Returns the configuration for a specific model. Throws if the model is not found.

```typescript
interface ModelConfig {
  charsPerToken: number;           // Characters per token ratio
  inputCostPerMillion: number;     // USD per 1M input tokens
  outputCostPerMillion?: number;   // USD per 1M output tokens (when available)
  cachedInputCostPerMillion?: number;  // USD per 1M cached input tokens (OpenAI)
  batchInputCostPerMillion?: number;   // USD per 1M batch input tokens (OpenAI)
  batchOutputCostPerMillion?: number;  // USD per 1M batch output tokens (OpenAI)
}
```

### `DEFAULT_MODELS`

Read-only object containing all model configurations. Frozen to prevent runtime mutation.

### Cost Estimation API

#### `estimateCost(options): CostEstimate`

Calculate cost from explicit token counts. Provides detailed cost breakdown for input, output, cached, and batch pricing.

```typescript
import { estimateCost } from 'ai-token-estimator';

const result = estimateCost({
  model: 'gpt-4o',
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  cachedInputTokens: 200_000,  // optional
  mode: 'standard',            // or 'batch'
});

console.log(result);
// {
//   model: 'gpt-4o',
//   mode: 'standard',
//   tokens: { input: 1000000, cachedInput: 200000, nonCachedInput: 800000, output: 500000 },
//   costs: { input: 2.0, cachedInput: 0.25, output: 5.0, total: 7.25 },
//   rates: { inputPerMillion: 2.5, outputPerMillion: 10.0, cachedInputPerMillion: 1.25, ... }
// }
```

Throws if:
- Model is unknown
- Token counts are negative or non-integer
- `cachedInputTokens > inputTokens`
- Required pricing is missing (output/cached/batch)
- `mode: 'batch'` with `cachedInputTokens > 0`

#### `estimateCostFromText(options): CostEstimate`

Sync version that counts input tokens from text. Uses heuristic/exact tokenization based on model.

```typescript
import { estimateCostFromText } from 'ai-token-estimator';

const result = estimateCostFromText({
  model: 'gpt-4o',
  inputText: 'Hello, world!',
  outputText: 'Hi there!',     // optional: auto-count output tokens
  outputTokens: 100,           // or: explicit output count (takes precedence)
  cachedInputTokens: 0,
  mode: 'standard',
});
```

#### `estimateCostFromTextAsync(options): Promise<CostEstimate>`

Async version that supports provider-backed tokenizers for accurate counts.

```typescript
import { estimateCostFromTextAsync } from 'ai-token-estimator';

const result = await estimateCostFromTextAsync({
  model: 'claude-sonnet-4',
  inputText: 'Hello, world!',
  outputText: 'Hi there!',
  tokenizer: 'anthropic_count_tokens',
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
});
```

#### `getTotalCost(model, inputTokens, outputTokens?): number`

Quick helper to get total cost for a model.

```typescript
import { getTotalCost } from 'ai-token-estimator';

const cost = getTotalCost('gpt-4o', 1_000_000, 500_000);
// 7.5 (USD)
```

### SentencePiece API

#### `loadSentencePieceTokenizer(options: FileOptions): Promise<SentencePieceTokenizer>`

Loads a SentencePiece tokenizer from a file path (Node.js async API).

```typescript
interface FileOptions {
  modelPath: string;              // Path to .model or tokenizer.json file
  format?: 'protobuf' | 'json';   // Auto-detected from extension if omitted
}

interface SentencePieceTokenizer {
  encode(text: string): number[];   // Encode text to token IDs
  decode(tokens: number[]): string; // Decode token IDs to text
  readonly vocabSize: number;       // Vocabulary size
  readonly algorithm: 'bpe' | 'unigram';  // Tokenization algorithm
}
```

#### `getSentencePieceTokenizer(options: DataOptions): SentencePieceTokenizer`

Creates a tokenizer from in-memory model data (sync API, browser-compatible).

```typescript
interface DataOptions {
  modelData: Uint8Array | ArrayBuffer;  // Model file bytes
  format?: 'protobuf' | 'json';         // Auto-detected if omitted
}
```

#### `ensureSentencePieceModel(options: DownloadOptions): Promise<string>`

Downloads a known tokenizer model from HuggingFace and returns the local path.

```typescript
type KnownTokenizer = keyof typeof MODEL_REGISTRY; // e.g. 't5-base', 'albert-base-v2', 'xlnet-base-cased', ...

interface DownloadOptions {
  tokenizer: KnownTokenizer;
  cacheDir?: string;         // Cache directory (default: ~/.cache/sentencepiece or SENTENCEPIECE_MODEL_CACHE_DIR)
  allowDownload?: boolean;   // Default: false (no surprise network calls)
  verifyHash?: boolean;      // Default: true (when registry hash is present)
  authToken?: string;        // HuggingFace auth token (or HF_TOKEN / HUGGINGFACE_HUB_TOKEN env vars)
  customUrl?: string;        // Optional mirror/override URL (hash still verified)
}
```

#### `encodeSentencePiece(text: string, options: DataOptions): number[]`

Encode text to tokens (sync, from in-memory model data).

#### `decodeSentencePiece(tokens: number[], options: DataOptions): string`

Decode tokens to text (sync, from in-memory model data).

#### `countSentencePieceTokens(text: string, options: DataOptions): number`

Count tokens in text (sync, from in-memory model data).

#### `encodeSentencePieceAsync(text: string, options: FileOptions): Promise<number[]>`

Encode text to tokens (async, from file path).

#### `decodeSentencePieceAsync(tokens: number[], options: FileOptions): Promise<string>`

Decode tokens to text (async, from file path).

#### `countSentencePieceTokensAsync(text: string, options: FileOptions): Promise<number>`

Count tokens in text (async, from file path).

#### `parseModelProto(buffer: Uint8Array): ModelProto`

Low-level: Parse a SentencePiece .model file (protobuf format).

```typescript
interface ModelProto {
  pieces: SentencePiece[];        // Vocabulary pieces
  trainerSpec?: TrainerSpec;      // Training configuration
  normalizerSpec?: NormalizerSpec; // Normalization settings
}

interface SentencePiece {
  piece: string;   // Token string
  score: number;   // Log probability score
  type: SentencePieceType;  // NORMAL, UNKNOWN, CONTROL, etc.
}
```

#### `clearModelCache(): void`

Clears the internal model parsing cache (useful for memory management).

## Rounding Options

By default, token counts are rounded up (`ceil`) for conservative budgeting. You can override this:

```typescript
// Round up (default) - conservative for budgeting
estimate({ text, model: 'gpt-4o', rounding: 'ceil' });

// Round down - optimistic estimate
estimate({ text, model: 'gpt-4o', rounding: 'floor' });

// Round to nearest - balanced estimate
estimate({ text, model: 'gpt-4o', rounding: 'round' });
```

## Character Counting

This package counts Unicode code points, not UTF-16 code units. This means:
- Emojis count as 1 character (not 2)
- Accented characters count correctly
- Most source code characters count as 1

## Benchmarks (repo only)

This repository includes a small benchmark script to compare heuristic vs exact OpenAI tokenization:

```bash
npm run benchmark:tokenizer
```

<!-- SUPPORTED_MODELS_START -->
## Supported Models

> **Auto-updated weekly** via GitHub Actions from provider pricing pages.

### OpenAI Models

| Model | Chars/Token | Input Cost (per 1M tokens) |
|-------|-------------|---------------------------|
| babbage-002 | 4 | $0.40 |
| chatgpt-4o-latest | 4 | $5.00 |
| chatgpt-image-latest | 4 | $5.00 |
| codex-mini-latest | 4 | $1.50 |
| computer-use-preview | 4 | $1.50 |
| davinci-002 | 4 | $2.00 |
| gpt-3.5-0301 | 4 | $1.50 |
| gpt-3.5-turbo | 4 | $0.50 |
| gpt-3.5-turbo-0125 | 4 | $0.50 |
| gpt-3.5-turbo-0613 | 4 | $1.50 |
| gpt-3.5-turbo-1106 | 4 | $1.00 |
| gpt-3.5-turbo-16k-0613 | 4 | $3.00 |
| gpt-3.5-turbo-instruct | 4 | $1.50 |
| gpt-4-0125-preview | 4 | $10.00 |
| gpt-4-0314 | 4 | $30.00 |
| gpt-4-0613 | 4 | $30.00 |
| gpt-4-1106-preview | 4 | $10.00 |
| gpt-4-1106-vision-preview | 4 | $10.00 |
| gpt-4-32k | 4 | $60.00 |
| gpt-4-turbo-2024-04-09 | 4 | $10.00 |
| gpt-4.1 | 4 | $2.00 |
| gpt-4.1-mini | 4 | $0.40 |
| gpt-4.1-nano | 4 | $0.10 |
| gpt-4o | 4 | $2.50 |
| gpt-4o-2024-05-13 | 4 | $5.00 |
| gpt-4o-audio-preview | 4 | $2.50 |
| gpt-4o-mini | 4 | $0.15 |
| gpt-4o-mini-audio-preview | 4 | $0.15 |
| gpt-4o-mini-realtime-preview | 4 | $0.60 |
| gpt-4o-mini-search-preview | 4 | $0.15 |
| gpt-4o-realtime-preview | 4 | $5.00 |
| gpt-4o-search-preview | 4 | $2.50 |
| gpt-5 | 4 | $1.25 |
| gpt-5-chat-latest | 4 | $1.25 |
| gpt-5-codex | 4 | $1.25 |
| gpt-5-mini | 4 | $0.25 |
| gpt-5-nano | 4 | $0.05 |
| gpt-5-pro | 4 | $15.00 |
| gpt-5-search-api | 4 | $1.25 |
| gpt-5.1 | 4 | $1.25 |
| gpt-5.1-chat-latest | 4 | $1.25 |
| gpt-5.1-codex | 4 | $1.25 |
| gpt-5.1-codex-max | 4 | $1.25 |
| gpt-5.1-codex-mini | 4 | $0.25 |
| gpt-5.2 | 4 | $1.75 |
| gpt-5.2-chat-latest | 4 | $1.75 |
| gpt-5.2-codex | 4 | $1.75 |
| gpt-5.2-pro | 4 | $21.00 |
| gpt-5.3-chat-latest | 4 | $1.75 |
| gpt-5.3-codex | 4 | $1.75 |
| gpt-5.4 | 4 | $2.50 |
| gpt-5.4-mini | 4 | $0.75 |
| gpt-5.4-nano | 4 | $0.20 |
| gpt-5.4-pro | 4 | $30.00 |
| gpt-audio | 4 | $2.50 |
| gpt-audio-1.5 | 4 | $2.50 |
| gpt-audio-mini | 4 | $0.60 |
| gpt-image-1 | 4 | $5.00 |
| gpt-image-1-mini | 4 | $2.00 |
| gpt-image-1.5 | 4 | $5.00 |
| gpt-realtime | 4 | $4.00 |
| gpt-realtime-1.5 | 4 | $4.00 |
| gpt-realtime-mini | 4 | $0.60 |
| o1 | 4 | $15.00 |
| o1-mini | 4 | $1.10 |
| o1-pro | 4 | $150.00 |
| o3 | 4 | $2.00 |
| o3-deep-research | 4 | $5.00 |
| o3-mini | 4 | $1.10 |
| o3-pro | 4 | $20.00 |
| o4-mini | 4 | $1.10 |
| o4-mini-deep-research | 4 | $1.00 |

### Anthropic Claude Models

| Model | Chars/Token | Input Cost (per 1M tokens) |
|-------|-------------|---------------------------|
| claude-haiku-3 | 3.5 | $0.25 |
| claude-haiku-3.5 | 3.5 | $0.80 |
| claude-haiku-4.5 | 3.5 | $1.00 |
| claude-opus-3 | 3.5 | $15.00 |
| claude-opus-4 | 3.5 | $15.00 |
| claude-opus-4.1 | 3.5 | $15.00 |
| claude-opus-4.5 | 3.5 | $5.00 |
| claude-opus-4.6 | 3.5 | $5.00 |
| claude-sonnet-4 | 3.5 | $3.00 |
| claude-sonnet-4.5 | 3.5 | $3.00 |
| claude-sonnet-4.6 | 3.5 | $3.00 |

### Google Gemini Models

| Model | Chars/Token | Input Cost (per 1M tokens) |
|-------|-------------|---------------------------|
| gemini-2.0-flash | 4 | $0.10 |
| gemini-2.0-flash-lite | 4 | $0.08 |
| gemini-2.5-computer-use-preview-10-2025 | 4 | $1.25 |
| gemini-2.5-flash | 4 | $0.30 |
| gemini-2.5-flash-lite | 4 | $0.10 |
| gemini-2.5-flash-lite-preview-09-2025 | 4 | $0.10 |
| gemini-2.5-flash-native-audio-preview-12-2025 | 4 | $0.50 |
| gemini-2.5-flash-preview-09-2025 | 4 | $0.30 |
| gemini-2.5-flash-preview-tts | 4 | $0.50 |
| gemini-2.5-pro | 4 | $1.25 |
| gemini-2.5-pro-preview-tts | 4 | $1.00 |
| gemini-3-flash | 4 | $0.50 |
| gemini-3-pro | 4 | $2.00 |
| gemini-3.1-flash-lite | 4 | $0.25 |
| gemini-3.1-flash-live | 4 | $0.75 |
| gemini-3.1-pro | 4 | $2.00 |

*Last updated: 2026-04-06*
<!-- SUPPORTED_MODELS_END -->

## Pricing Updates

Model pricing is automatically updated weekly via GitHub Actions. The update script fetches the latest prices directly from:
- [OpenAI Pricing](https://platform.openai.com/docs/pricing)
- [Anthropic Pricing](https://www.anthropic.com/pricing)
- [Google AI Pricing](https://ai.google.dev/gemini-api/docs/pricing)

You can check when prices were last updated:

```typescript
import { LAST_UPDATED } from 'ai-token-estimator';
console.log(LAST_UPDATED); // e.g. '2026-01-14'
```

## License

MIT
