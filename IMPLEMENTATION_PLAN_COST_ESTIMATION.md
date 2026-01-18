# Implementation Plan: Finish Built-in Cost Estimation (`estimateCost`)

## Executive Summary

This plan extends ai-token-estimator's cost estimation capabilities to achieve parity with gpt-tokenizer's `estimateCost` feature. The current implementation only supports input token costs; this plan adds output token costs, cached token pricing, batch API pricing, and an explicit `estimateCost()` API with structured cost breakdowns.

**Key design principles:**
- New pricing fields are **optional** — no forced repo-wide pricing regeneration
- **Throw** when caller requests a cost component that can't be priced (fail-fast)
- Keep sync + async estimators **aligned** with shared types
- **No hardcoded pricing formulas** — extract explicit rates from providers
- **No rounding in API** — only round in display/docs

---

## Current State

### What We Have
| Capability | Status |
|------------|--------|
| Input token cost estimation | ✅ via `estimate()` and `estimateAsync()` |
| Exact OpenAI tokenization | ✅ BPE encoder/decoder |
| Chat completion token counting | ✅ `countChatCompletionTokens()` |
| Model pricing table | ✅ 80+ models, auto-updated weekly |
| Provider-backed counting (Anthropic, Gemini) | ✅ |

### What's Missing
| Capability | Status |
|------------|--------|
| Output token cost estimation | ❌ |
| Cached token pricing | ❌ |
| Batch API pricing | ❌ |
| Explicit `estimateCost()` API | ❌ |
| Structured cost breakdown response | ❌ |

---

## Target State

### Target Data Model

```typescript
// src/types.ts
export interface ModelConfig {
  charsPerToken: number;

  // Input pricing (required - always available)
  inputCostPerMillion: number;

  // Output pricing (optional - extracted when available)
  outputCostPerMillion?: number;

  // Cached pricing (optional - primarily OpenAI)
  cachedInputCostPerMillion?: number;

  // Batch pricing (optional - primarily OpenAI)
  batchInputCostPerMillion?: number;
  batchOutputCostPerMillion?: number;
}
```

**Key**: All new fields are **optional**. This avoids forcing a "must update all 80+ models" hard dependency while still providing correct behavior for models that have the data.

### Target API

```typescript
// src/cost.ts

export interface EstimateCostInput {
  model: string;
  inputTokens: number;
  outputTokens?: number;           // If > 0, requires outputCostPerMillion
  cachedInputTokens?: number;      // Must be <= inputTokens
  mode?: 'standard' | 'batch';     // 'batch' requires batch rates or throws
}

export interface CostEstimate {
  model: string;
  mode: 'standard' | 'batch';

  // Token counts echoed back
  tokens: {
    input: number;              // Total input (includes cached)
    cachedInput: number;        // Subset of input priced at cached rate
    nonCachedInput: number;     // input - cachedInput
    output: number;
  };

  // Cost breakdown in USD (no rounding applied)
  costs: {
    input: number;              // Non-cached input cost
    cachedInput: number;        // Cached input cost
    output: number;             // Output cost
    total: number;              // Sum of all costs
  };

  // Per-million rates used (for transparency)
  rates: {
    inputPerMillion: number;
    outputPerMillion?: number;
    cachedInputPerMillion?: number;
    batchInputPerMillion?: number;
    batchOutputPerMillion?: number;
  };
}

/**
 * Estimate cost from explicit token counts.
 *
 * @throws {Error} if model is unknown
 * @throws {Error} if outputTokens > 0 but outputCostPerMillion is missing
 * @throws {Error} if cachedInputTokens > inputTokens
 * @throws {Error} if mode='batch' but batch rates are missing
 * @throws {Error} if any token count is negative or non-finite
 */
export function estimateCost(options: EstimateCostInput): CostEstimate;

/**
 * Sync helper: estimate cost from text (uses countTokens internally).
 * Uses OpenAI exact tokenization when available, else heuristic.
 *
 * Precedence rules:
 * - outputTokens takes precedence over outputText
 * - If both omitted, outputTokens defaults to 0
 * - If outputText provided, tokens are counted using countTokens (same as input)
 */
export function estimateCostFromText(options: {
  model: string;
  inputText: string;
  outputText?: string;           // Auto-count output tokens from text
  outputTokens?: number;         // Manual override (takes precedence over outputText)
  cachedInputTokens?: number;
  mode?: 'standard' | 'batch';
}): CostEstimate;

/**
 * Async helper: estimate cost from text using provider-backed tokenization.
 * Uses provider APIs (Anthropic, Gemini) when available for exact counts.
 *
 * Precedence rules:
 * - outputTokens takes precedence over outputText
 * - If both omitted, outputTokens defaults to 0
 * - If outputText provided, tokens are counted using the same tokenizer mode as input
 */
export function estimateCostFromTextAsync(options: {
  model: string;
  inputText: string;
  outputText?: string;           // Auto-count output tokens from text
  outputTokens?: number;         // Manual override (takes precedence over outputText)
  cachedInputTokens?: number;
  mode?: 'standard' | 'batch';
} & Omit<EstimateAsyncInput, 'text' | 'model'>  // Forward all provider options from EstimateAsyncInput
): Promise<CostEstimate>;

/**
 * Quick total cost helper.
 *
 * @throws {Error} if output pricing is missing when outputTokens > 0
 */
export function getTotalCost(model: string, inputTokens: number, outputTokens?: number): number;
```

### Extended Estimate Types (Sync + Async Alignment)

```typescript
// src/types.ts

export interface EstimateInput {
  text: string;
  model: string;
  rounding?: 'ceil' | 'round' | 'floor';
  tokenizer?: 'heuristic' | 'openai_exact' | 'auto';

  // NEW: Optional cost estimation inputs
  outputTokens?: number;
  cachedInputTokens?: number;
  mode?: 'standard' | 'batch';
}

export interface EstimateOutput {
  // Existing fields (unchanged)
  model: string;
  characterCount: number;
  estimatedTokens: number;
  estimatedInputCost: number;
  charsPerToken: number;
  tokenizerMode?: TokenizerModeAsync;  // Shared type for sync+async
  encodingUsed?: string;

  // NEW: Extended cost fields
  outputTokens?: number;
  estimatedOutputCost?: number;      // Only present if outputTokens provided
  estimatedCachedInputCost?: number; // Only present if cachedInputTokens provided
  estimatedTotalCost: number;        // Always present (input + output + cached)
}

// EstimateAsyncInput and EstimateAsyncOutput follow the same pattern
```

---

## Implementation Phases

### Phase 1: Extend Pricing Data Model

**Goal**: Add optional pricing fields to ModelConfig and update extraction script.

**Files to modify**:
- `src/types.ts` - Extend ModelConfig interface (optional fields)
- `scripts/update-pricing.ts` - Extract additional pricing when available

**Tasks**:

1.1. **Extend ModelConfig interface in src/types.ts with optional fields**
```typescript
export interface ModelConfig {
  charsPerToken: number;
  inputCostPerMillion: number;
  outputCostPerMillion?: number;
  cachedInputCostPerMillion?: number;
  batchInputCostPerMillion?: number;
  batchOutputCostPerMillion?: number;
}
```

1.2. **Update pricing extraction script**
- Extract explicit numeric rates for input/output/cached/batch per model
- Only include rates that are explicitly stated on provider pages
- **Do NOT derive rates** (e.g., don't assume "cached = 50% of input")
- Leave rates `undefined` if they can't be reliably obtained
- Add internal comments for any rates that are derived (if ever needed)

1.3. **Incrementally update pricing data**
- Start with OpenAI models (most complete pricing info)
- Add output pricing for Anthropic, Google as available
- Existing models without new fields continue to work unchanged

**Acceptance criteria**:
- [ ] ModelConfig interface has optional new fields
- [ ] Pricing extraction extracts output rates where explicitly available
- [ ] All existing tests pass (backward compatible)
- [ ] No forced regeneration of all pricing data

---

### Phase 2: Implement `estimateCost()` API

**Goal**: Create the explicit cost estimation API with proper validation.

**Files to create/modify**:
- `src/cost.ts` - NEW: Cost estimation functions
- `src/index.ts` - Export new functions
- `tests/cost.test.ts` - NEW: Unit tests

**Tasks**:

2.1. **Create `src/cost.ts` with validation**
```typescript
import { getModelConfig } from './models.js';
import { countTokens } from './token-counter.js';

function validateTokenCount(value: number | undefined, name: string): number {
  const n = value ?? 0;
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`${name} must be a non-negative integer, got: ${n}`);
  }
  return n;
}

export function estimateCost(options: EstimateCostInput): CostEstimate {
  const { model, mode = 'standard' } = options;

  // Validate token counts
  const inputTokens = validateTokenCount(options.inputTokens, 'inputTokens');
  const outputTokens = validateTokenCount(options.outputTokens, 'outputTokens');
  const cachedInputTokens = validateTokenCount(options.cachedInputTokens, 'cachedInputTokens');

  // Validate cachedInputTokens <= inputTokens
  if (cachedInputTokens > inputTokens) {
    throw new Error(
      `cachedInputTokens (${cachedInputTokens}) cannot exceed inputTokens (${inputTokens})`
    );
  }

  // Get model config
  const config = getModelConfig(model);
  if (!config) {
    throw new Error(`Unknown model: ${model}`);
  }

  // Validate output pricing availability
  if (outputTokens > 0 && config.outputCostPerMillion === undefined) {
    throw new Error(
      `Output pricing not available for model "${model}". ` +
      `Cannot estimate cost for ${outputTokens} output tokens.`
    );
  }

  // Validate batch mode availability
  if (mode === 'batch') {
    if (cachedInputTokens > 0) {
      throw new Error(
        `Batch mode does not support cached tokens. ` +
        `Got cachedInputTokens: ${cachedInputTokens}. Use mode: 'standard' for cached pricing.`
      );
    }
    if (config.batchInputCostPerMillion === undefined) {
      throw new Error(
        `Batch input pricing not available for model "${model}". ` +
        `Use mode: 'standard' or choose a model with batch pricing.`
      );
    }
    if (outputTokens > 0 && config.batchOutputCostPerMillion === undefined) {
      throw new Error(
        `Batch output pricing not available for model "${model}". ` +
        `Cannot estimate batch cost for ${outputTokens} output tokens.`
      );
    }
  }

  const nonCachedInputTokens = inputTokens - cachedInputTokens;

  // Calculate costs based on mode
  if (mode === 'batch') {
    const inputCost = (inputTokens * config.batchInputCostPerMillion!) / 1_000_000;
    const outputCost = outputTokens > 0
      ? (outputTokens * config.batchOutputCostPerMillion!) / 1_000_000
      : 0;

    return {
      model,
      mode: 'batch',
      tokens: {
        input: inputTokens,
        cachedInput: 0,  // Batch mode doesn't use cached pricing
        nonCachedInput: inputTokens,
        output: outputTokens,
      },
      costs: {
        input: inputCost,
        cachedInput: 0,
        output: outputCost,
        total: inputCost + outputCost,
      },
      rates: {
        inputPerMillion: config.inputCostPerMillion,
        outputPerMillion: config.outputCostPerMillion,
        batchInputPerMillion: config.batchInputCostPerMillion,
        batchOutputPerMillion: config.batchOutputCostPerMillion,
      },
    };
  }

  // Standard mode - validate cached pricing availability
  if (cachedInputTokens > 0 && config.cachedInputCostPerMillion === undefined) {
    throw new Error(
      `Cached input pricing not available for model "${model}". ` +
      `Cannot estimate cost for ${cachedInputTokens} cached input tokens.`
    );
  }

  const inputCost = (nonCachedInputTokens * config.inputCostPerMillion) / 1_000_000;

  const cachedInputCost = cachedInputTokens > 0
    ? (cachedInputTokens * config.cachedInputCostPerMillion!) / 1_000_000
    : 0;

  const outputCost = outputTokens > 0
    ? (outputTokens * config.outputCostPerMillion!) / 1_000_000
    : 0;

  return {
    model,
    mode: 'standard',
    tokens: {
      input: inputTokens,
      cachedInput: cachedInputTokens,
      nonCachedInput: nonCachedInputTokens,
      output: outputTokens,
    },
    costs: {
      input: inputCost,
      cachedInput: cachedInputCost,
      output: outputCost,
      total: inputCost + cachedInputCost + outputCost,
    },
    rates: {
      inputPerMillion: config.inputCostPerMillion,
      outputPerMillion: config.outputCostPerMillion,
      cachedInputPerMillion: config.cachedInputCostPerMillion,
    },
  };
}
```

2.2. **Implement sync and async text helpers**
```typescript
import { countTokens } from './token-counter.js';
import { estimateAsync } from './estimator-async.js';
import type { EstimateAsyncInput } from './types.js';

export function estimateCostFromText(options: {
  model: string;
  inputText: string;
  outputText?: string;
  outputTokens?: number;
  cachedInputTokens?: number;
  mode?: 'standard' | 'batch';
}): CostEstimate {
  const { model, inputText, outputText, outputTokens: manualOutputTokens, ...rest } = options;

  // Count input tokens
  const inputTokens = countTokens({ text: inputText, model }).tokens;

  // Precedence: outputTokens > outputText > 0
  let outputTokens = manualOutputTokens;
  if (manualOutputTokens === undefined && outputText !== undefined) {
    // Use same token-counting mode as input (countTokens)
    outputTokens = countTokens({ text: outputText, model }).tokens;
  }
  // If both omitted, outputTokens remains undefined (defaults to 0 in estimateCost)

  return estimateCost({ model, inputTokens, outputTokens, ...rest });
}

// Accept all EstimateAsyncInput options (minus 'text') to forward provider config
type EstimateCostFromTextAsyncOptions = {
  model: string;
  inputText: string;
  outputText?: string;
  outputTokens?: number;
  cachedInputTokens?: number;
  mode?: 'standard' | 'batch';
} & Omit<EstimateAsyncInput, 'text' | 'model'>;

export async function estimateCostFromTextAsync(
  options: EstimateCostFromTextAsyncOptions
): Promise<CostEstimate> {
  const {
    inputText,
    outputText,
    outputTokens: manualOutputTokens,
    cachedInputTokens,
    mode,
    ...providerOptions  // Includes model + all EstimateAsyncInput options
  } = options;
  const { model } = providerOptions;

  // Count input tokens using provider-backed tokenization
  const inputResult = await estimateAsync({ text: inputText, ...providerOptions });
  const inputTokens = inputResult.estimatedTokens;

  // Precedence: outputTokens > outputText > 0
  let outputTokens = manualOutputTokens;
  if (manualOutputTokens === undefined && outputText !== undefined) {
    // Use same tokenizer mode as input (provider options forwarded)
    const outputResult = await estimateAsync({ text: outputText, ...providerOptions });
    outputTokens = outputResult.estimatedTokens;
  }
  // If both omitted, outputTokens remains undefined (defaults to 0 in estimateCost)

  return estimateCost({ model, inputTokens, outputTokens, cachedInputTokens, mode });
}

export function getTotalCost(model: string, inputTokens: number, outputTokens: number = 0): number {
  const estimate = estimateCost({ model, inputTokens, outputTokens });
  return estimate.costs.total;
}
```

2.3. **Export from index.ts**
```typescript
export {
  estimateCost,
  estimateCostFromText,
  estimateCostFromTextAsync,
  getTotalCost,
  type EstimateCostInput,
  type CostEstimate,
} from './cost.js';
```

**Acceptance criteria**:
- [ ] `estimateCost()` validates all inputs and throws helpful errors
- [ ] Throws when outputTokens > 0 but output rate missing
- [ ] Throws when cachedInputTokens > inputTokens
- [ ] Throws when cachedInputTokens > 0 but cached rate missing (fail-fast)
- [ ] Throws when mode='batch' but batch rates missing
- [ ] Throws when mode='batch' and cachedInputTokens > 0
- [ ] Sync text helper uses `countTokens({ text, model }).tokens`
- [ ] Async text helper forwards all provider options to `estimateAsync()`
- [ ] Both text helpers support `outputText` for auto-counting output tokens
- [ ] All new functions exported from package

---

### Phase 3: Extend `estimate()` and `estimateAsync()`

**Goal**: Keep sync + async estimators aligned with shared types.

**Files to modify**:
- `src/types.ts` - Extend input/output interfaces
- `src/estimator.ts` - Update estimate() implementation
- `src/estimator-async.ts` - Update estimateAsync() implementation

**Tasks**:

3.1. **Extend shared types**
```typescript
// Add to EstimateInput and EstimateAsyncInput
outputTokens?: number;
cachedInputTokens?: number;
mode?: 'standard' | 'batch';

// Add to EstimateOutput and EstimateAsyncOutput
outputTokens?: number;
estimatedOutputCost?: number;
estimatedCachedInputCost?: number;
estimatedTotalCost: number;  // Always present
```

3.2. **Update implementations**
- Call `estimateCost()` internally when new fields are provided
- Maintain backward compatibility — existing callers unchanged
- `estimatedTotalCost` defaults to `estimatedInputCost` when no output/cached

**Acceptance criteria**:
- [ ] Backward compatible — existing tests pass unchanged
- [ ] New fields work in both sync and async versions
- [ ] `estimatedTotalCost` always present in response

---

### Phase 4: Testing

**Goal**: Comprehensive test coverage with proper assertions.

**Files to create/modify**:
- `tests/cost.test.ts` - NEW: Unit tests for cost estimation

**Testing best practices**:
- Use `toBeCloseTo()` for floating-point comparisons (avoid flaky tests)
- Or compare integer micros: `Math.round(cost * 1e9)`
- Test all error cases with descriptive messages

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateCost, estimateCostFromText } from '../src/cost.js';
import * as models from '../src/models.js';

describe('estimateCost', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('input-only cost', () => {
    it('calculates input cost correctly', () => {
      const result = estimateCost({ model: 'gpt-4o', inputTokens: 1_000_000 });
      expect(result.costs.input).toBeCloseTo(2.50, 6);
      expect(result.costs.total).toBeCloseTo(2.50, 6);
    });
  });

  describe('input + output cost', () => {
    it('calculates both costs when output rate available', () => {
      const result = estimateCost({
        model: 'gpt-4o',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(result.costs.input).toBeCloseTo(2.50, 6);
      expect(result.costs.output).toBeCloseTo(10.00, 6);
      expect(result.costs.total).toBeCloseTo(12.50, 6);
    });

    it('throws when output rate missing', () => {
      // Mock getModelConfig to return a model without output pricing
      vi.spyOn(models, 'getModelConfig').mockReturnValueOnce({
        charsPerToken: 4,
        inputCostPerMillion: 1.0,
        // outputCostPerMillion intentionally omitted
      });

      expect(() => estimateCost({
        model: 'test-model-no-output',
        inputTokens: 1000,
        outputTokens: 500,
      })).toThrow(/Output pricing not available/);
    });
  });

  describe('cached input pricing', () => {
    it('prices cached portion at cached rate', () => {
      const result = estimateCost({
        model: 'gpt-4o',
        inputTokens: 1_000_000,
        cachedInputTokens: 500_000,
      });
      // 500k non-cached at $2.50/M = $1.25
      // 500k cached at $1.25/M = $0.625
      expect(result.costs.input).toBeCloseTo(1.25, 6);
      expect(result.costs.cachedInput).toBeCloseTo(0.625, 6);
      expect(result.costs.total).toBeCloseTo(1.875, 6);
    });

    it('throws when cachedInputTokens > inputTokens', () => {
      expect(() => estimateCost({
        model: 'gpt-4o',
        inputTokens: 100,
        cachedInputTokens: 200,
      })).toThrow(/cannot exceed inputTokens/);
    });

    it('throws when cached rate missing (fail-fast)', () => {
      expect(() => estimateCost({
        model: 'claude-3-5-sonnet',  // No cached pricing
        inputTokens: 1000,
        cachedInputTokens: 500,
      })).toThrow(/Cached input pricing not available/);
    });
  });

  describe('batch mode', () => {
    it('uses batch rates when mode=batch', () => {
      const result = estimateCost({
        model: 'gpt-4o',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        mode: 'batch',
      });
      expect(result.mode).toBe('batch');
      expect(result.costs.input).toBeCloseTo(1.25, 6);  // 50% of standard
      expect(result.costs.output).toBeCloseTo(5.00, 6); // 50% of standard
    });

    it('throws when batch rates missing', () => {
      expect(() => estimateCost({
        model: 'claude-3-5-sonnet',  // No batch pricing
        inputTokens: 1000,
        mode: 'batch',
      })).toThrow(/Batch input pricing not available/);
    });

    it('throws when cached tokens used with batch mode', () => {
      expect(() => estimateCost({
        model: 'gpt-4o',
        inputTokens: 1000,
        cachedInputTokens: 500,
        mode: 'batch',
      })).toThrow(/Batch mode does not support cached tokens/);
    });
  });

  describe('validation', () => {
    it('throws for unknown model', () => {
      expect(() => estimateCost({ model: 'unknown', inputTokens: 100 }))
        .toThrow(/Unknown model/);
    });

    it('throws for negative token counts', () => {
      expect(() => estimateCost({ model: 'gpt-4o', inputTokens: -100 }))
        .toThrow(/non-negative integer/);
    });

    it('throws for non-integer token counts', () => {
      expect(() => estimateCost({ model: 'gpt-4o', inputTokens: 100.5 }))
        .toThrow(/non-negative integer/);
    });
  });
});

describe('estimateCostFromText', () => {
  it('counts input tokens from text', () => {
    const result = estimateCostFromText({
      model: 'gpt-4o',
      inputText: 'Hello, world!',
    });
    expect(result.tokens.input).toBeGreaterThan(0);
    expect(result.costs.total).toBeGreaterThan(0);
  });

  it('counts output tokens from outputText when provided', () => {
    const result = estimateCostFromText({
      model: 'gpt-4o',
      inputText: 'What is 2+2?',
      outputText: 'The answer is 4.',
    });
    expect(result.tokens.output).toBeGreaterThan(0);
    expect(result.costs.output).toBeGreaterThan(0);
  });

  it('uses manual outputTokens over outputText (precedence)', () => {
    const result = estimateCostFromText({
      model: 'gpt-4o',
      inputText: 'Hello',
      outputText: 'This is a very long response that would have many tokens',
      outputTokens: 10,  // Manual override takes precedence
    });
    expect(result.tokens.output).toBe(10);
  });

  it('defaults outputTokens to 0 when both outputText and outputTokens omitted', () => {
    const result = estimateCostFromText({
      model: 'gpt-4o',
      inputText: 'Hello, world!',
      // outputText omitted
      // outputTokens omitted
    });
    expect(result.tokens.output).toBe(0);
    expect(result.costs.output).toBe(0);
  });
});

describe('batch mode invariants', () => {
  it('always returns tokens.cachedInput = 0 in batch mode', () => {
    const result = estimateCost({
      model: 'gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
      mode: 'batch',
    });
    expect(result.tokens.cachedInput).toBe(0);
    expect(result.costs.cachedInput).toBe(0);
  });
});
```

**Acceptance criteria**:
- [ ] Tests use `toBeCloseTo()` for float comparisons
- [ ] All error cases tested with message assertions
- [ ] >95% code coverage for `src/cost.ts`

---

### Phase 5: Documentation

**Goal**: Document the new API with examples.

**Files to modify**:
- `README.md` - Add cost estimation section

```markdown
## Cost Estimation

### Quick Total Cost
```typescript
import { getTotalCost } from 'ai-token-estimator';

const cost = getTotalCost('gpt-4o', 1000, 500);
console.log(`Total cost: $${cost.toFixed(6)}`);
```

### Detailed Cost Breakdown
```typescript
import { estimateCost } from 'ai-token-estimator';

const estimate = estimateCost({
  model: 'gpt-4o',
  inputTokens: 1000,
  outputTokens: 500,
  cachedInputTokens: 200,
});

console.log(`Input cost: $${estimate.costs.input.toFixed(6)}`);
console.log(`Cached input cost: $${estimate.costs.cachedInput.toFixed(6)}`);
console.log(`Output cost: $${estimate.costs.output.toFixed(6)}`);
console.log(`Total: $${estimate.costs.total.toFixed(6)}`);
```

### Batch API Pricing
```typescript
const batchEstimate = estimateCost({
  model: 'gpt-4o',
  inputTokens: 10000,
  outputTokens: 5000,
  mode: 'batch',
});

console.log(`Batch total: $${batchEstimate.costs.total.toFixed(6)}`);
```

### Cost from Text (Auto Token Counting)
```typescript
import { estimateCostFromText } from 'ai-token-estimator';

// Auto-count both input and output tokens from text
const estimate = estimateCostFromText({
  model: 'gpt-4o',
  inputText: 'What is the capital of France?',
  outputText: 'The capital of France is Paris.',
});

console.log(`Input tokens: ${estimate.tokens.input}`);
console.log(`Output tokens: ${estimate.tokens.output}`);
console.log(`Total cost: $${estimate.costs.total.toFixed(6)}`);
```

### Async with Provider-Backed Counting
```typescript
import { estimateCostFromTextAsync } from 'ai-token-estimator';

// Use Anthropic's API for exact token counts
const estimate = await estimateCostFromTextAsync({
  model: 'claude-3-5-sonnet',
  inputText: longPrompt,
  outputText: modelResponse,
  tokenizer: 'anthropic_count_tokens',
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
});

// Use Gemini's API for exact token counts
const geminiEstimate = await estimateCostFromTextAsync({
  model: 'gemini-1.5-pro',
  inputText: longPrompt,
  outputText: modelResponse,
  tokenizer: 'gemini_count_tokens',
  gemini: { apiKey: process.env.GEMINI_API_KEY },
});

// Use local Gemma model for token counting (modelPath, not apiKey)
const gemmaEstimate = await estimateCostFromTextAsync({
  model: 'gemma-7b',
  inputText: longPrompt,
  outputText: modelResponse,
  tokenizer: 'gemma_sentencepiece',
  gemma: { modelPath: '/path/to/gemma/tokenizer.model' },
});
```

### Error Handling
```typescript
try {
  estimateCost({
    model: 'claude-3-5-sonnet',
    inputTokens: 1000,
    mode: 'batch',  // Anthropic doesn't have batch pricing
  });
} catch (error) {
  console.log(error.message);
  // "Batch input pricing not available for model "claude-3-5-sonnet"..."
}

try {
  estimateCost({
    model: 'claude-3-5-sonnet',
    inputTokens: 1000,
    cachedInputTokens: 500,  // Anthropic doesn't have cached pricing
  });
} catch (error) {
  console.log(error.message);
  // "Cached input pricing not available for model "claude-3-5-sonnet"..."
}
```
```

---

## Design Decisions

### 1. Missing output pricing → Throw when outputTokens > 0

**Rationale**: Fail-fast is safer than silently returning incorrect costs. Users explicitly requesting output cost estimation should know immediately if it's not supported.

### 2. Cached tokens are subset of input

**Calculation**:
- `nonCachedInput = inputTokens - cachedInputTokens`
- `inputCost = nonCachedInput * inputRate`
- `cachedInputCost = cachedInputTokens * cachedRate`

**Validation**: Throw if `cachedInputTokens > inputTokens`.

### 3. Batch mode is primary path when requested

**Behavior**: When `mode: 'batch'`:
- Use batch rates exclusively
- Throw if batch rates unavailable (no silent fallback)
- Standard rates still included in `rates` object for comparison
- **Reject cachedInputTokens early**: If `cachedInputTokens > 0`, throw immediately (batch doesn't support cached pricing)
- **tokens.cachedInput always 0**: In the returned `CostEstimate`, `tokens.cachedInput` is always 0 for batch mode
- **costs.cachedInput always 0**: No cached input cost is calculated in batch mode

### 4. No rounding in API

**Rationale**: Rounding should be a display concern, not a data concern. API returns full precision; callers can round as needed (e.g., `toFixed(6)` for display).

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Provider pricing format changes | Medium | Medium | Weekly auto-update + manual review |
| Missing output pricing for some models | Expected | Low | Throw with helpful error message |
| Cached/batch pricing only for OpenAI | Expected | Low | Document as provider-specific |
| Breaking existing API | None | High | All changes are additive |

---

## Success Metrics

1. **Feature completeness**: All gpt-tokenizer `estimateCost` capabilities
2. **Test coverage**: >95% for new code
3. **Error messages**: Actionable and specific
4. **Backward compatibility**: All existing tests pass unchanged

---

## Appendix: Provider Pricing Reference (Jan 2026)

### OpenAI gpt-4o
| Category | Per 1M Tokens | Available |
|----------|---------------|-----------|
| Input | $2.50 | ✅ |
| Output | $10.00 | ✅ |
| Cached Input | $1.25 | ✅ |
| Batch Input | $1.25 | ✅ |
| Batch Output | $5.00 | ✅ |

### Anthropic claude-3-5-sonnet
| Category | Per 1M Tokens | Available |
|----------|---------------|-----------|
| Input | $3.00 | ✅ |
| Output | $15.00 | ✅ |
| Cached Input | — | ❌ |
| Batch | — | ❌ |

### Google gemini-1.5-pro
| Category | Per 1M Tokens | Available |
|----------|---------------|-----------|
| Input | $1.25 | ✅ |
| Output | $5.00 | ✅ |
| Cached Input | — | ❌ (different model) |
| Batch | — | ❌ |

*Note: Prices subject to change. Only explicitly published rates are extracted.*
