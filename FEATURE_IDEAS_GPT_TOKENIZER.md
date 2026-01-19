# gpt-tokenizer Feature List (Re-sorted by Status + Next Priorities)
#
# Source: `gpt-tokenizer` README on npm (`https://www.npmjs.com/package/gpt-tokenizer`).
#
# Listed below are **features `gpt-tokenizer` has** (not implementation proposals), re-sorted for this branch by:
# 1) what is already completed in `ai-token-estimator`, then
# 2) what we should build next for highest user impact.
#
# Status legend:
# - ✅ Completed in `ai-token-estimator`
# - 🟨 Partially completed (usable, but missing notable `gpt-tokenizer` parity)
# - ⏳ Planned / not implemented yet
#

## Completed (Ship/Marketing Now)

1. ✅ **BPE tokenizer encoder/decoder (tiktoken port)**: `encode`, `decode` (exact tokenization vs heuristic estimation).
2. ✅ **Chat completion token counting**: `countChatCompletionTokens` (chat overhead + legacy functions API).
3. ✅ **Built-in cost estimation**: `estimateCost`, `estimateCostFromText`, `estimateCostFromTextAsync`, `getTotalCost` - full parity with output/cached/batch pricing support.
4. ✅ **Explicit encoding support + model→encoding mapping**:
   - Encodings: `r50k_base`, `p50k_base`, `p50k_edit`, `cl100k_base`, `o200k_base`, `o200k_harmony`
   - Model→encoding mapping via `getOpenAIEncoding(...)`.
5. ✅ **Synchronous load + sync API** (sync tokenization + estimation APIs).
6. ✅ **Extended estimate() fields**: `outputTokens`, `cachedInputTokens`, `mode` inputs; `estimatedOutputCost`, `estimatedCachedInputCost`, `estimatedTotalCost` outputs.
7. ✅ **Chat-aware tokenization**: `encodeChat` (encode chat messages into ChatML prompt tokens with special delimiters).

## Next (Highest Impact to Build)

8. ⏳ **Fast token-limit check without full encode**: `isWithinTokenLimit` (early-exit counting; returns `false` when exceeded, else token count).

## Later (Valuable, but Lower ROI vs Above)

9. ⏳ **Generator-based APIs**: `encodeGenerator`, `encodeChatGenerator`, `decodeGenerator`.
10. ⏳ **Async stream decoding**: `decodeAsyncGenerator` / `decodeGenerator` with any iterable input.
11. ⏳ **Browser-first distribution options**:
    - Works in the browser out-of-the-box
    - UMD bundles per encoding via unpkg (e.g., `GPTTokenizer_o200k_base` global).
12. ⏳ **Performance/footprint focus (benchmarked)**:
    - Claims fastest encoding/decoding and low memory footprint
    - Notes internal perf optimizations (e.g., eliminating transitive arrays).
13. ⏳ **No global cache** (explicitly avoids accidental memory leaks).
14. ⏳ **Playground**: hosted interactive playground (`https://gpt-tokenizer.dev/`).
