import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  estimateCost,
  estimateCostFromText,
  estimateCostFromTextAsync,
  getTotalCost,
} from '../src/cost.js';
import * as models from '../src/models.js';
import * as estimatorAsync from '../src/estimator-async.js';
import type { ModelConfig } from '../src/types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/** Model with all pricing tiers (OpenAI-like) */
const FULL_PRICING_MODEL: ModelConfig = {
  charsPerToken: 4,
  inputCostPerMillion: 2.5,
  outputCostPerMillion: 10.0,
  cachedInputCostPerMillion: 1.25,
  batchInputCostPerMillion: 1.25,
  batchOutputCostPerMillion: 5.0,
};

/** Model with only input/output pricing (Anthropic-like) */
const INPUT_OUTPUT_ONLY_MODEL: ModelConfig = {
  charsPerToken: 3.5,
  inputCostPerMillion: 3.0,
  outputCostPerMillion: 15.0,
  // No cached or batch pricing
};

/** Model with input only (legacy) */
const INPUT_ONLY_MODEL: ModelConfig = {
  charsPerToken: 4,
  inputCostPerMillion: 1.0,
  // No output, cached, or batch pricing
};

// =============================================================================
// Test Helpers
// =============================================================================

function mockModelConfig(config: ModelConfig) {
  return vi.spyOn(models, 'getModelConfig').mockReturnValue(config);
}

// =============================================================================
// Tests
// =============================================================================

describe('estimateCost', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('input-only cost', () => {
    it('calculates input cost correctly', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      const result = estimateCost({ model: 'test-model', inputTokens: 1_000_000 });

      expect(result.costs.input).toBeCloseTo(2.5, 6);
      expect(result.costs.output).toBe(0);
      expect(result.costs.cachedInput).toBe(0);
      expect(result.costs.total).toBeCloseTo(2.5, 6);
    });

    it('handles zero tokens', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      const result = estimateCost({ model: 'test-model', inputTokens: 0 });

      expect(result.costs.input).toBe(0);
      expect(result.costs.total).toBe(0);
      expect(result.tokens.input).toBe(0);
    });

    it('echoes back token counts', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      const result = estimateCost({ model: 'test-model', inputTokens: 1000 });

      expect(result.tokens.input).toBe(1000);
      expect(result.tokens.cachedInput).toBe(0);
      expect(result.tokens.nonCachedInput).toBe(1000);
      expect(result.tokens.output).toBe(0);
    });

    it('includes rates in response', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      const result = estimateCost({ model: 'test-model', inputTokens: 1000 });

      expect(result.rates.inputPerMillion).toBe(2.5);
      expect(result.rates.outputPerMillion).toBe(10.0);
      expect(result.rates.cachedInputPerMillion).toBe(1.25);
    });

    it('defaults to standard mode', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      const result = estimateCost({ model: 'test-model', inputTokens: 1000 });

      expect(result.mode).toBe('standard');
    });
  });

  describe('input + output cost', () => {
    it('calculates both costs when output rate available', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      const result = estimateCost({
        model: 'test-model',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });

      expect(result.costs.input).toBeCloseTo(2.5, 6);
      expect(result.costs.output).toBeCloseTo(10.0, 6);
      expect(result.costs.total).toBeCloseTo(12.5, 6);
    });

    it('throws when output rate missing (fail-fast)', () => {
      mockModelConfig(INPUT_ONLY_MODEL);

      expect(() => estimateCost({
        model: 'test-model',
        inputTokens: 1000,
        outputTokens: 500,
      })).toThrow(/Output pricing not available/);
    });

    it('allows zero output tokens when output rate missing', () => {
      mockModelConfig(INPUT_ONLY_MODEL);

      // Should not throw - outputTokens defaults to 0
      const result = estimateCost({
        model: 'test-model',
        inputTokens: 1000,
      });

      expect(result.costs.output).toBe(0);
    });
  });

  describe('cached input pricing', () => {
    it('prices cached portion at cached rate', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      const result = estimateCost({
        model: 'test-model',
        inputTokens: 1_000_000,
        cachedInputTokens: 500_000,
      });

      // 500k non-cached at $2.50/M = $1.25
      // 500k cached at $1.25/M = $0.625
      expect(result.costs.input).toBeCloseTo(1.25, 6);
      expect(result.costs.cachedInput).toBeCloseTo(0.625, 6);
      expect(result.costs.total).toBeCloseTo(1.875, 6);
    });

    it('sets correct token counts', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      const result = estimateCost({
        model: 'test-model',
        inputTokens: 1000,
        cachedInputTokens: 400,
      });

      expect(result.tokens.input).toBe(1000);
      expect(result.tokens.cachedInput).toBe(400);
      expect(result.tokens.nonCachedInput).toBe(600);
    });

    it('throws when cachedInputTokens > inputTokens', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      expect(() => estimateCost({
        model: 'test-model',
        inputTokens: 100,
        cachedInputTokens: 200,
      })).toThrow(/cannot exceed inputTokens/);
    });

    it('throws when cached rate missing (fail-fast)', () => {
      mockModelConfig(INPUT_OUTPUT_ONLY_MODEL);

      expect(() => estimateCost({
        model: 'test-model',
        inputTokens: 1000,
        cachedInputTokens: 500,
      })).toThrow(/Cached input pricing not available/);
    });

    it('allows zero cached tokens when cached rate missing', () => {
      mockModelConfig(INPUT_OUTPUT_ONLY_MODEL);

      const result = estimateCost({
        model: 'test-model',
        inputTokens: 1000,
        cachedInputTokens: 0,
      });

      expect(result.costs.cachedInput).toBe(0);
    });
  });

  describe('batch mode', () => {
    it('uses batch rates when mode=batch', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      const result = estimateCost({
        model: 'test-model',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        mode: 'batch',
      });

      expect(result.mode).toBe('batch');
      expect(result.costs.input).toBeCloseTo(1.25, 6);  // batch rate
      expect(result.costs.output).toBeCloseTo(5.0, 6);  // batch rate
      expect(result.costs.total).toBeCloseTo(6.25, 6);
    });

    it('includes batch rates in response', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      const result = estimateCost({
        model: 'test-model',
        inputTokens: 1000,
        mode: 'batch',
      });

      expect(result.rates.batchInputPerMillion).toBe(1.25);
      expect(result.rates.batchOutputPerMillion).toBe(5.0);
    });

    it('throws when batch rates missing', () => {
      mockModelConfig(INPUT_OUTPUT_ONLY_MODEL);

      expect(() => estimateCost({
        model: 'test-model',
        inputTokens: 1000,
        mode: 'batch',
      })).toThrow(/Batch input pricing not available/);
    });

    it('throws when batch output rates missing for output tokens', () => {
      const partialBatchModel: ModelConfig = {
        ...INPUT_OUTPUT_ONLY_MODEL,
        batchInputCostPerMillion: 1.5,
        // No batchOutputCostPerMillion
      };
      mockModelConfig(partialBatchModel);

      expect(() => estimateCost({
        model: 'test-model',
        inputTokens: 1000,
        outputTokens: 500,
        mode: 'batch',
      })).toThrow(/Batch output pricing not available/);
    });

    it('throws when cached tokens used with batch mode', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      expect(() => estimateCost({
        model: 'test-model',
        inputTokens: 1000,
        cachedInputTokens: 500,
        mode: 'batch',
      })).toThrow(/Batch mode does not support cached tokens/);
    });

    it('always returns tokens.cachedInput = 0 in batch mode', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      const result = estimateCost({
        model: 'test-model',
        inputTokens: 1000,
        outputTokens: 500,
        mode: 'batch',
      });

      expect(result.tokens.cachedInput).toBe(0);
      expect(result.costs.cachedInput).toBe(0);
    });
  });

  describe('validation', () => {
    it('throws for unknown model with helpful message', () => {
      // Don't mock - let it use real getModelConfig
      expect(() => estimateCost({ model: 'unknown-model-xyz', inputTokens: 100 }))
        .toThrow(/Unknown model.*Available models:/s);
    });

    it('throws for negative token counts', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      expect(() => estimateCost({ model: 'test-model', inputTokens: -100 }))
        .toThrow(/non-negative integer/);
    });

    it('throws for non-integer token counts', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      expect(() => estimateCost({ model: 'test-model', inputTokens: 100.5 }))
        .toThrow(/non-negative integer/);
    });

    it('throws for NaN token counts', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      expect(() => estimateCost({ model: 'test-model', inputTokens: NaN }))
        .toThrow(/non-negative integer/);
    });

    it('throws for Infinity token counts', () => {
      mockModelConfig(FULL_PRICING_MODEL);

      expect(() => estimateCost({ model: 'test-model', inputTokens: Infinity }))
        .toThrow(/non-negative integer/);
    });
  });

  describe('real models', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('works with real gpt-4o model (input only)', () => {
      // No mock - use real model config
      const result = estimateCost({ model: 'gpt-4o', inputTokens: 1_000_000 });

      expect(result.model).toBe('gpt-4o');
      expect(result.costs.input).toBeCloseTo(2.5, 6);
      expect(result.costs.total).toBe(result.costs.input);
    });

    it('works with real gpt-4o model (input + output)', () => {
      // No mock - use real model config with output pricing
      const result = estimateCost({
        model: 'gpt-4o',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });

      expect(result.costs.input).toBeCloseTo(2.5, 6);
      expect(result.costs.output).toBeCloseTo(10.0, 6);
      expect(result.costs.total).toBeCloseTo(12.5, 6);
    });

    it('works with real gpt-4o model (cached input)', () => {
      // No mock - use real model config with cached pricing
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

    it('works with real gpt-4o model (batch mode)', () => {
      // No mock - use real model config with batch pricing
      const result = estimateCost({
        model: 'gpt-4o',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        mode: 'batch',
      });

      expect(result.mode).toBe('batch');
      expect(result.costs.input).toBeCloseTo(1.25, 6);  // batch rate
      expect(result.costs.output).toBeCloseTo(5.0, 6);  // batch rate
      expect(result.costs.total).toBeCloseTo(6.25, 6);
    });

    it('works with real claude model (input only)', () => {
      // No mock - use real model config
      const result = estimateCost({ model: 'claude-sonnet-4', inputTokens: 1_000_000 });

      expect(result.model).toBe('claude-sonnet-4');
      expect(result.costs.input).toBeGreaterThan(0);
    });

    it('throws for claude with output tokens (no output pricing yet)', () => {
      // Claude models don't have outputCostPerMillion in models.ts yet
      expect(() => estimateCost({
        model: 'claude-sonnet-4',
        inputTokens: 1000,
        outputTokens: 500,
      })).toThrow(/Output pricing not available/);
    });
  });
});

describe('estimateCostFromText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts input tokens from text', () => {
    mockModelConfig(FULL_PRICING_MODEL);

    const result = estimateCostFromText({
      model: 'test-model',
      inputText: 'Hello, world!',
    });

    expect(result.tokens.input).toBeGreaterThan(0);
    expect(result.costs.total).toBeGreaterThan(0);
  });

  it('counts output tokens from outputText when provided', () => {
    mockModelConfig(FULL_PRICING_MODEL);

    const result = estimateCostFromText({
      model: 'test-model',
      inputText: 'What is 2+2?',
      outputText: 'The answer is 4.',
    });

    expect(result.tokens.output).toBeGreaterThan(0);
    expect(result.costs.output).toBeGreaterThan(0);
  });

  it('uses manual outputTokens over outputText (precedence)', () => {
    mockModelConfig(FULL_PRICING_MODEL);

    const result = estimateCostFromText({
      model: 'test-model',
      inputText: 'Hello',
      outputText: 'This is a very long response that would have many tokens',
      outputTokens: 10,  // Manual override takes precedence
    });

    expect(result.tokens.output).toBe(10);
  });

  it('defaults outputTokens to 0 when both outputText and outputTokens omitted', () => {
    mockModelConfig(FULL_PRICING_MODEL);

    const result = estimateCostFromText({
      model: 'test-model',
      inputText: 'Hello, world!',
      // outputText omitted
      // outputTokens omitted
    });

    expect(result.tokens.output).toBe(0);
    expect(result.costs.output).toBe(0);
  });

  it('forwards cachedInputTokens', () => {
    mockModelConfig(FULL_PRICING_MODEL);

    const result = estimateCostFromText({
      model: 'test-model',
      inputText: 'Hello, world!',
      cachedInputTokens: 2,
    });

    expect(result.tokens.cachedInput).toBe(2);
    expect(result.costs.cachedInput).toBeGreaterThan(0);
  });

  it('forwards mode', () => {
    mockModelConfig(FULL_PRICING_MODEL);

    const result = estimateCostFromText({
      model: 'test-model',
      inputText: 'Hello, world!',
      mode: 'batch',
    });

    expect(result.mode).toBe('batch');
  });
});

describe('getTotalCost', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns total cost for input only', () => {
    mockModelConfig(FULL_PRICING_MODEL);

    const cost = getTotalCost('test-model', 1_000_000);

    expect(cost).toBeCloseTo(2.5, 6);
  });

  it('returns total cost for input and output', () => {
    mockModelConfig(FULL_PRICING_MODEL);

    const cost = getTotalCost('test-model', 1_000_000, 1_000_000);

    expect(cost).toBeCloseTo(12.5, 6);
  });

  it('defaults outputTokens to 0', () => {
    mockModelConfig(FULL_PRICING_MODEL);

    const cost = getTotalCost('test-model', 1000);

    // Should not throw even though outputCostPerMillion exists
    expect(cost).toBeGreaterThan(0);
  });
});

describe('batch mode invariants', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('always returns tokens.cachedInput = 0 in batch mode', () => {
    mockModelConfig(FULL_PRICING_MODEL);

    const result = estimateCost({
      model: 'test-model',
      inputTokens: 1000,
      outputTokens: 500,
      mode: 'batch',
    });

    expect(result.tokens.cachedInput).toBe(0);
    expect(result.costs.cachedInput).toBe(0);
  });
});

describe('estimateCostFromTextAsync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls estimateAsync with input text', async () => {
    mockModelConfig(FULL_PRICING_MODEL);
    const mockEstimateAsync = vi.spyOn(estimatorAsync, 'estimateAsync').mockResolvedValue({
      model: 'test-model',
      characterCount: 13,
      estimatedTokens: 100,
      estimatedInputCost: 0.00025,
      charsPerToken: 4,
      tokenizerMode: 'heuristic',
    });

    const result = await estimateCostFromTextAsync({
      model: 'test-model',
      inputText: 'Hello, world!',
    });

    expect(mockEstimateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hello, world!',
        model: 'test-model',
      })
    );
    expect(result.tokens.input).toBe(100);
  });

  it('forwards provider options to estimateAsync', async () => {
    mockModelConfig(FULL_PRICING_MODEL);
    const mockEstimateAsync = vi.spyOn(estimatorAsync, 'estimateAsync').mockResolvedValue({
      model: 'test-model',
      characterCount: 13,
      estimatedTokens: 100,
      estimatedInputCost: 0.00025,
      charsPerToken: 4,
      tokenizerMode: 'anthropic_count_tokens',
    });

    await estimateCostFromTextAsync({
      model: 'test-model',
      inputText: 'Hello, world!',
      tokenizer: 'anthropic_count_tokens',
      anthropic: { apiKey: 'test-key' },
      fallbackToHeuristicOnError: true,
    });

    expect(mockEstimateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hello, world!',
        model: 'test-model',
        tokenizer: 'anthropic_count_tokens',
        anthropic: { apiKey: 'test-key' },
        fallbackToHeuristicOnError: true,
      })
    );
  });

  it('counts output tokens from outputText using same provider options', async () => {
    mockModelConfig(FULL_PRICING_MODEL);
    const mockEstimateAsync = vi.spyOn(estimatorAsync, 'estimateAsync')
      .mockResolvedValueOnce({
        model: 'test-model',
        characterCount: 13,
        estimatedTokens: 100,
        estimatedInputCost: 0.00025,
        charsPerToken: 4,
        tokenizerMode: 'anthropic_count_tokens',
      })
      .mockResolvedValueOnce({
        model: 'test-model',
        characterCount: 20,
        estimatedTokens: 50,
        estimatedInputCost: 0.000125,
        charsPerToken: 4,
        tokenizerMode: 'anthropic_count_tokens',
      });

    const result = await estimateCostFromTextAsync({
      model: 'test-model',
      inputText: 'Hello, world!',
      outputText: 'This is the response',
      tokenizer: 'anthropic_count_tokens',
      anthropic: { apiKey: 'test-key' },
    });

    // Should have been called twice - once for input, once for output
    expect(mockEstimateAsync).toHaveBeenCalledTimes(2);

    // First call for input
    expect(mockEstimateAsync).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        text: 'Hello, world!',
        tokenizer: 'anthropic_count_tokens',
        anthropic: { apiKey: 'test-key' },
      })
    );

    // Second call for output (same provider options forwarded)
    expect(mockEstimateAsync).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        text: 'This is the response',
        tokenizer: 'anthropic_count_tokens',
        anthropic: { apiKey: 'test-key' },
      })
    );

    expect(result.tokens.input).toBe(100);
    expect(result.tokens.output).toBe(50);
  });

  it('uses manual outputTokens over outputText (precedence)', async () => {
    mockModelConfig(FULL_PRICING_MODEL);
    const mockEstimateAsync = vi.spyOn(estimatorAsync, 'estimateAsync').mockResolvedValue({
      model: 'test-model',
      characterCount: 13,
      estimatedTokens: 100,
      estimatedInputCost: 0.00025,
      charsPerToken: 4,
      tokenizerMode: 'heuristic',
    });

    const result = await estimateCostFromTextAsync({
      model: 'test-model',
      inputText: 'Hello',
      outputText: 'This is a very long response',
      outputTokens: 10,  // Manual override
    });

    // Should only call estimateAsync once (for input), not for output
    expect(mockEstimateAsync).toHaveBeenCalledTimes(1);
    expect(result.tokens.output).toBe(10);
  });

  it('defaults outputTokens to 0 when both omitted', async () => {
    mockModelConfig(FULL_PRICING_MODEL);
    vi.spyOn(estimatorAsync, 'estimateAsync').mockResolvedValue({
      model: 'test-model',
      characterCount: 13,
      estimatedTokens: 100,
      estimatedInputCost: 0.00025,
      charsPerToken: 4,
      tokenizerMode: 'heuristic',
    });

    const result = await estimateCostFromTextAsync({
      model: 'test-model',
      inputText: 'Hello, world!',
    });

    expect(result.tokens.output).toBe(0);
    expect(result.costs.output).toBe(0);
  });

  it('forwards cachedInputTokens and mode', async () => {
    mockModelConfig(FULL_PRICING_MODEL);
    vi.spyOn(estimatorAsync, 'estimateAsync').mockResolvedValue({
      model: 'test-model',
      characterCount: 13,
      estimatedTokens: 100,
      estimatedInputCost: 0.00025,
      charsPerToken: 4,
      tokenizerMode: 'heuristic',
    });

    const result = await estimateCostFromTextAsync({
      model: 'test-model',
      inputText: 'Hello, world!',
      mode: 'batch',
    });

    expect(result.mode).toBe('batch');
  });
});
