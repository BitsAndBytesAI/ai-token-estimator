# gpt-tokenizer Feature List (Ordered by User/Customer Value)
#
# Source: `gpt-tokenizer` README on npm (`https://www.npmjs.com/package/gpt-tokenizer`).
#
# Listed below are **features `gpt-tokenizer` has** (not implementation proposals), ordered from **highest user value** → **least impactful**
# for a token estimation / budgeting workflow.
#
# Status legend:
# - ✅ Completed in `ai-token-estimator`
# - ⏳ Planned / not implemented yet
#

## Core Functionality (Highest Value)

1. ✅ **BPE tokenizer encoder/decoder (tiktoken port)**: `encode`, `decode` (exact tokenization vs heuristic estimation).
2. ⏳ **Chat completion token counting**: `countChatCompletionTokens` (accounts for chat overhead + function/tool definitions/pinned calls).
3. ⏳ **Built-in cost estimation**: `estimateCost` (supports multiple pricing categories such as main API vs batch API and cached token categories when available).
4. ⏳ **Fast token-limit check without full encode**: `isWithinTokenLimit` (returns `false` when exceeded; otherwise returns token count).
5. ⏳ **Chat-aware tokenization**: `encodeChat` (tokenize chat payloads correctly for specific models).

## Developer Experience (High Value)

6. ⏳ **Synchronous load + sync API** (usable without `async/await` contexts).
7. ⏳ **Browser-first distribution options**:
   - Works in the browser out-of-the-box
   - UMD bundles per encoding via unpkg (e.g., `GPTTokenizer_o200k_base` global).
8. ⏳ **Explicit encoding support + model→encoding mapping**:
   - Encodings: `r50k_base`, `p50k_base`, `p50k_edit`, `cl100k_base`, `o200k_base`, `o200k_harmony`
   - Example notes: o-series models use `o200k_base`; `gpt-oss-*` uses `o200k_harmony`; `gpt-4*`/`gpt-3.5*` use `cl100k_base`.

## Advanced/Streaming Features (Medium Value)

9. ⏳ **Generator-based APIs**: `encodeGenerator`, `encodeChatGenerator`, `decodeGenerator`.
10. ⏳ **Async stream decoding**: `decodeAsyncGenerator` / `decodeGenerator` with any iterable input.
11. ⏳ **Performance/footprint focus (benchmarked)**:
    - Claims fastest encoding/decoding and low memory footprint
    - Notes internal perf optimizations (e.g., eliminating transitive arrays).

## Technical/Nice-to-Have (Lower Value)

12. ⏳ **No global cache** (explicitly avoids accidental memory leaks).
13. ⏳ **Playground**: hosted interactive playground (`https://gpt-tokenizer.dev/`).

