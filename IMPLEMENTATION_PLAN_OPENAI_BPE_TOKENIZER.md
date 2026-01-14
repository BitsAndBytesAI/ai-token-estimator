# Implementation Plan — OpenAI BPE Tokenizer (`encode` / `decode`)

Goal: add **exact OpenAI tokenization** (BPE, `tiktoken`-compatible) to `ai-token-estimator`, similar to `gpt-tokenizer`’s `encode`/`decode` functionality, while keeping existing estimation APIs intact.

This plan is written so another LLM can implement it end-to-end.

---

## Background / Motivation

`ai-token-estimator` currently estimates tokens using a `charsPerToken` heuristic. This is good for quick budgeting, but it fails when:
- users need exact token counts (especially for hard limits),
- model tokenization differs from the heuristic,
- downstream logic depends on real token counts for accurate costs.

`gpt-tokenizer` provides `tiktoken`-compatible BPE tokenization for OpenAI models via `encode` / `decode`. We want the same baseline capability in `ai-token-estimator`.

---

## Scope

### Phase 1 (Parity with `gpt-tokenizer`’s `encode`/`decode`)

Implement:
- `encode(text, options?) -> number[]` (token IDs)
- `decode(tokens, options?) -> string`
- Support **OpenAI encodings**:
  - `r50k_base`
  - `p50k_base`
  - `p50k_edit`
  - `cl100k_base`
  - `o200k_base`
  - `o200k_harmony`
- Add **model → encoding mapping** for OpenAI model IDs in `src/models.ts` (or a new mapping module), so consumers can pass `model` and we choose encoding automatically.
- Keep current `estimate()` behavior unchanged by default.

### Phase 2 (Make it better than `gpt-tokenizer` for our use-cases)

Enhance:
- **Auto mode token counting** across providers:
  - OpenAI: exact BPE
  - Anthropic/Google: keep heuristic (chars-per-token), but expose a unified API.
- **Lazy-load encodings** to reduce bundle size and cold-start time:
  - default import loads lightweight registry
  - encoding data loaded on first use (dynamic import)
- Add a new `countTokens()` helper that returns `{ tokens, exact: boolean, encoding?: string }`.
- Add `estimate()` option `tokenizer: 'heuristic' | 'openai_exact' | 'auto'` (default: `'heuristic'`) that can switch to exact OpenAI tokens when available without breaking existing callers.

---

## Non-goals (for this ticket)

- Chat-aware counting (`encodeChat`, message overhead) — separate feature item.
- Output token estimation — separate feature item.
- Batch/cached pricing categories — separate feature item.
- Implementing tokenizers for Anthropic/Google (no public BPE specs); we’ll keep heuristic there.

---

## Public API (Proposed)

### New exports (Phase 1)

Add to `src/index.ts` exports:

```ts
export type OpenAIEncoding =
  | 'r50k_base'
  | 'p50k_base'
  | 'p50k_edit'
  | 'cl100k_base'
  | 'o200k_base'
  | 'o200k_harmony';

export interface EncodeOptions {
  encoding?: OpenAIEncoding;
  model?: string; // OpenAI model id
  allowSpecial?: 'all' | 'none' | 'none_raise'; // align to tiktoken-style behavior
}

export function encode(text: string, options?: EncodeOptions): number[];
export function decode(tokens: Iterable<number>, options?: Pick<EncodeOptions, 'encoding' | 'model'>): string;
```

Notes:
- `encoding` wins over `model` if both are provided.
- If neither `encoding` nor `model` is provided, default to `o200k_base` (matching modern OpenAI models), but document this.

### New exports (Phase 2)

```ts
export function countTokens(input: { text: string; model: string }): {
  tokens: number;
  exact: boolean;
  encoding?: OpenAIEncoding;
};
```

And extend existing `estimate()` input:

```ts
estimate({ text, model, tokenizer?: 'heuristic' | 'openai_exact' | 'auto' })
```

Default stays `heuristic` to avoid behavior change.

---

## Data Model / Encodings

### Encoding assets

Each encoding needs:
- merge ranks (BPE vocab → token IDs)
- special tokens map (string → token ID)
- regex pattern used for splitting text into pieces (“pat_str” in `tiktoken`)

Implementation approach:

**Recommended (fastest path): vendor from `gpt-tokenizer` (MIT)**
- Copy the minimal encoding data + BPE implementation from `gpt-tokenizer`’s source.
- Preserve upstream license headers as-is where required by MIT.
- Keep the data format compatible with their compact representation to avoid bloating the package.

Alternative (higher effort): implement `tiktoken` encoding generation ourselves from OpenAI’s published `.tiktoken` files. Not recommended for MVP.

### Model → encoding mapping

Create `src/openai/model-encodings.ts`:
- `getOpenAIEncodingForModel(modelId: string): OpenAIEncoding | null`
- Uses a curated mapping aligned to OpenAI docs (and/or known conventions):
  - modern: `gpt-5*`, `gpt-4o*`, `gpt-4.1*`, `o*` → `o200k_base`
  - `gpt-4*`, `gpt-3.5*` → `cl100k_base`
  - legacy completions (davinci/babbage) → `p50k_base`/`r50k_base` as appropriate
  - harmony models → `o200k_harmony`

Also add an internal escape hatch:
- if model unknown: return `o200k_base` only in Phase 2 `auto` mode; Phase 1 should throw on unknown if caller asked for exact tokenization explicitly.

---

## Implementation Steps (Phase 1)

1. **Add new modules**
   - `src/openai/types.ts` — encoding + options types
   - `src/openai/model-encodings.ts` — model→encoding resolution
   - `src/openai/encodings/*` — encoding assets (vendored)
   - `src/openai/bpe.ts` — BPE encoder/decoder core (vendored/adapted)
   - `src/openai/tokenizer.ts` — public wrappers `encode`/`decode`

2. **Expose new functions**
   - Update `src/index.ts` to export `encode`, `decode`, and types.

3. **Handle special tokens**
   - Support `allowSpecial` behaviors:
     - `none`: treat special token strings as ordinary text
     - `none_raise`: throw if special token appears
     - `all`: allow emitting special token IDs
   - Keep default conservative (`none_raise`) to match common tokenizer defaults.

4. **Add tests**
   - Add fixtures for known strings and expected token IDs.
   - Validate parity with `gpt-tokenizer` for a small suite (copy expected outputs from their docs or compute once and lock).
   - Tests:
     - `encode(decode(tokens))` round-trip for ASCII, unicode, emoji, and code snippets
     - model→encoding mapping sanity (e.g., `gpt-5.1` → `o200k_base`)

5. **Build & packaging**
   - Ensure `tsup` bundles encoding assets correctly for both ESM/CJS outputs.
   - Avoid `fs` runtime reads; keep assets in TS modules or embedded data blobs.

6. **Docs**
   - Update `README.md` with a new section: “Exact OpenAI tokenization (BPE)”.
   - Explain limitations: only OpenAI exact; others remain heuristic.

---

## Implementation Steps (Phase 2)

1. **Lazy-load encodings**
   - Replace eager imports of encoding assets with dynamic imports:
     - `src/openai/encoding-registry.ts` exporting `loadEncoding(name)` that `import()`s `./encodings/<name>.js`.
   - Keep `encode` synchronous by:
     - providing **two entry points**:
       - `encode` (sync): only supports encodings that are pre-bundled/eager-loaded
       - `encodeAsync` (new): supports lazy loading
     - OR (preferable): keep `encode` sync but eager-load only `o200k_base` + `cl100k_base`, and lazy-load rarer legacy encodings via `encodeAsync`.

2. **Unified `countTokens` API**
   - Implement `countTokens({ text, model })`:
     - If model is OpenAI and encoding known: use exact tokenization, `exact=true`.
     - Else: fallback to heuristic tokens from current estimator, `exact=false`.

3. **Optional tokenizer mode for `estimate()`**
   - Extend `estimate()` input with `tokenizer`:
     - `'heuristic'` (default)
     - `'openai_exact'` (throws if model not supported)
     - `'auto'` (uses exact when possible else heuristic)
   - Store the chosen strategy in output for observability:
     - add `tokenizerMode` and `encodingUsed?` to estimate output (non-breaking by adding new fields).

4. **Benchmarks**
   - Add a small benchmark script under `benchmark/` (optional) to compare:
     - heuristic `estimate` vs exact `encode().length`
     - validate performance is acceptable for typical inputs

5. **Docs**
   - Document tradeoffs:
     - exact tokenization costs CPU and bundle size
     - auto mode may be slower but more accurate for OpenAI models

---

## Risks / Mitigations

- **Bundle size increase** from encoding data
  - Mitigation: lazy-load; only ship common encodings by default; provide per-encoding entrypoints if needed.
- **API breaking changes**
  - Mitigation: add new exports; keep `estimate()` default behavior unchanged.
- **Incorrect mapping for new OpenAI models**
  - Mitigation: centralize mapping and update with pricing pipeline; add tests for mapping for all OpenAI IDs in `src/models.ts`.

---

## Acceptance Criteria

Phase 1:
- `encode`/`decode` available from package root.
- Supports at least the encodings listed above.
- Correctly tokenizes `gpt-5.1` model text using `o200k_base` when `model` provided.
- Unit tests cover round-trip and a few known token vectors.

Phase 2:
- `countTokens()` exists and returns `exact` flag.
- `estimate()` supports `tokenizer` option and remains backward compatible.
- Lazy-load strategy documented and implemented (or explicit sync/async split).

