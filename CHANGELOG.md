# ai-token-estimator

## 1.7.0

### Minor Changes

- 53bf3fd: Add generator-based APIs for memory-efficient streaming tokenization

  New functions:

  - `encodeGenerator(text, options)` - Yields token chunks during encoding
  - `encodeChatGenerator(messages, options)` - Yields token chunks for chat messages
  - `decodeGenerator(tokens, options)` - Yields text chunks during decoding
  - `decodeAsyncGenerator(tokens, options)` - Yields text chunks from async token streams

  These generators are useful for:

  - Processing large inputs without loading all tokens into memory
  - Streaming pipelines with other generators/transforms
  - Progress tracking during encoding
  - Decoding streaming LLM responses

## 1.6.0

### Minor Changes

- 951fb6a: feat: add encodeChat for chat-aware tokenization

  - `encodeChat(messages, options)`: Encode chat messages into token IDs using ChatML format
  - Returns exact token sequences including special message delimiter tokens (`<|im_start|>`, `<|im_sep|>`, `<|im_end|>`)
  - Supports cl100k_base (GPT-4, GPT-3.5-turbo) and o200k_base (GPT-4o, GPT-4o-mini) encodings
  - Experimental support for o200k_harmony encoding
  - Includes assistant response priming by default (configurable via `primeAssistant` option)
  - Handles message `name` field and `function_call` in assistant messages
  - Rejects non-OpenAI models (claude-_, gemini-_) and tools API features (tool_calls, tool_call_id)

## 1.5.0

### Minor Changes

- c89ddd4: feat: add isWithinTokenLimit for fast token limit validation

  - `isWithinTokenLimit(text, limit, options)`: Check if text is within token limit with early exit optimization
  - `isChatWithinTokenLimit({ messages, model, tokenLimit, ... })`: Check if chat messages are within limit
  - Returns `false` if exceeded, or the actual token count if within limit
  - Uses incremental regex matching for true early-exit (avoids upfront allocation)
  - Significantly faster than full tokenization when limit is exceeded early (up to 1000x+)

## 1.4.0

### Minor Changes

- bcbe087: Add built-in cost estimation API with output, cached, and batch pricing support

  New exports:

  - `estimateCost()` - Calculate cost from explicit token counts
  - `estimateCostFromText()` - Sync cost estimation with auto token counting
  - `estimateCostFromTextAsync()` - Async cost estimation with provider-backed tokenizers
  - `getTotalCost()` - Quick helper for total cost calculation

  Extended `estimate()` and `estimateAsync()`:

  - New inputs: `outputTokens`, `cachedInputTokens`, `mode` ('standard' | 'batch')
  - New outputs: `estimatedOutputCost`, `estimatedCachedInputCost`, `estimatedTotalCost`

  Extended `ModelConfig`:

  - New optional fields: `outputCostPerMillion`, `cachedInputCostPerMillion`, `batchInputCostPerMillion`, `batchOutputCostPerMillion`

  Updated pricing script to extract extended pricing fields from provider pages.

## 1.3.0

### Minor Changes

- 0e17221: Add a pure TypeScript SentencePiece tokenizer (Unigram + SentencePiece-style BPE + HF `tokenizer.json` JSON-BPE), removing the `sentencepiece`/`sentencepiece-js` dependency while keeping the public API compatible.

## 1.2.0

### Minor Changes

- 4691650: Add async provider token counting for Anthropic and Gemini plus optional local SentencePiece (Gemma) tokenizer.

## 1.1.0

### Minor Changes

- 8ed0abd: Add Phase 2 OpenAI tokenizer enhancements: `countTokens()` (exact for OpenAI, heuristic otherwise) and optional tokenizer modes for `estimate()` (`heuristic`/`openai_exact`/`auto`).

## 1.0.3

### Patch Changes

- 7aa869d: Update OpenAI pricing source and add missing OpenAI model IDs (including `gpt-5.1`) so token/cost estimation works for newer models.

## 1.0.2

### Patch Changes

- 5b83e15: Auto-update README model tables with weekly pricing updates

## 1.0.1

### Patch Changes

- a72a004: Update model pricing from provider websites

## 1.0.0

### Major Changes

- 6d9cae3: Initial release of ai-token-estimator

  Features:

  - Estimate token counts and costs for LLM API calls
  - Support for 28 models across OpenAI, Anthropic, and Google
  - Unicode code point counting (handles emojis correctly)
  - Configurable rounding (ceil/round/floor)
  - Deep-frozen model configs to prevent runtime mutation
  - TypeScript support with full type exports
  - ESM and CommonJS support
