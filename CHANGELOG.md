# ai-token-estimator

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
