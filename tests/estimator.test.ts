import { describe, it, expect } from 'vitest';
import {
  estimate,
  getModelConfig,
  getAvailableModels,
  DEFAULT_MODELS,
} from '../src/index.js';

// Helper to get a model with 4 chars per token (OpenAI-like) for consistent tests
function getOpenAIModel(): string {
  const models = getAvailableModels();
  const openaiModel = models.find(
    (m) => m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')
  );
  if (!openaiModel) throw new Error('No OpenAI model found');
  return openaiModel;
}

// Helper to get a model with 3.5 chars per token (Anthropic-like)
function getAnthropicModel(): string {
  const models = getAvailableModels();
  const anthropicModel = models.find((m) => m.startsWith('claude-'));
  if (!anthropicModel) throw new Error('No Anthropic model found');
  return anthropicModel;
}

describe('estimate', () => {
  describe('basic functionality', () => {
    it('correctly estimates tokens for known character count', () => {
      const model = getOpenAIModel();
      // 8 characters / 4 chars per token = 2 tokens
      const result = estimate({ text: 'abcdefgh', model });
      expect(result.characterCount).toBe(8);
      expect(result.estimatedTokens).toBe(2);
    });

    it('correctly calculates cost', () => {
      const model = getOpenAIModel();
      const config = getModelConfig(model);
      // 1000 chars / 4 = 250 tokens
      // 250 tokens * cost / 1_000_000
      const result = estimate({ text: 'a'.repeat(1000), model });
      expect(result.estimatedTokens).toBe(250);
      const expectedCost = (250 * config.inputCostPerMillion) / 1_000_000;
      expect(result.estimatedInputCost).toBeCloseTo(expectedCost, 10);
    });

    it('returns zero tokens and cost for empty string', () => {
      const model = getOpenAIModel();
      const result = estimate({ text: '', model });
      expect(result.characterCount).toBe(0);
      expect(result.estimatedTokens).toBe(0);
      expect(result.estimatedInputCost).toBe(0);
    });

    it('includes model and charsPerToken in output', () => {
      const model = getAnthropicModel();
      const result = estimate({ text: 'test', model });
      expect(result.model).toBe(model);
      expect(result.charsPerToken).toBe(3.5);
    });
  });

  describe('rounding', () => {
    it('defaults to ceil rounding', () => {
      const model = getOpenAIModel();
      // 5 characters / 4 = 1.25, ceil = 2
      const result = estimate({ text: 'hello', model });
      expect(result.estimatedTokens).toBe(2);
    });

    it('respects floor rounding', () => {
      const model = getOpenAIModel();
      // 5 characters / 4 = 1.25, floor = 1
      const result = estimate({
        text: 'hello',
        model,
        rounding: 'floor',
      });
      expect(result.estimatedTokens).toBe(1);
    });

    it('respects round rounding', () => {
      const model = getOpenAIModel();
      // 5 characters / 4 = 1.25, round = 1
      const result = estimate({
        text: 'hello',
        model,
        rounding: 'round',
      });
      expect(result.estimatedTokens).toBe(1);

      // 7 characters / 4 = 1.75, round = 2
      const result2 = estimate({
        text: 'hello!!',
        model,
        rounding: 'round',
      });
      expect(result2.estimatedTokens).toBe(2);
    });

    it('handles exact division (no rounding needed)', () => {
      const model = getOpenAIModel();
      // 8 characters / 4 = 2.0 exactly
      const result = estimate({ text: 'abcdefgh', model });
      expect(result.estimatedTokens).toBe(2);
    });
  });

  describe('character counting', () => {
    it('counts ASCII text correctly', () => {
      const model = getOpenAIModel();
      const result = estimate({ text: 'Hello, world!', model });
      expect(result.characterCount).toBe(13);
    });

    it('counts non-ASCII (accented characters) correctly', () => {
      const model = getOpenAIModel();
      const result = estimate({ text: 'café', model });
      expect(result.characterCount).toBe(4);
    });

    it('counts emoji as single characters (not surrogate pairs)', () => {
      const model = getOpenAIModel();
      // Each emoji should be 1 code point, not 2 UTF-16 code units
      const result = estimate({ text: '👍', model });
      expect(result.characterCount).toBe(1);

      const result2 = estimate({ text: '👍👎👏', model });
      expect(result2.characterCount).toBe(3);
    });

    it('handles mixed content (code with emoji in comments)', () => {
      const model = getOpenAIModel();
      const code = `// This is great! 👍
function hello() {
  return "world";
}`;
      const result = estimate({ text: code, model });
      // Count manually: the emoji should be 1 char
      expect(result.characterCount).toBe(code.length - 1); // -1 because 👍 is 2 code units but 1 code point
    });

    it('counts whitespace-only input', () => {
      const model = getOpenAIModel();
      const result = estimate({ text: '   ', model });
      expect(result.characterCount).toBe(3);
    });

    it('counts single character input', () => {
      const model = getOpenAIModel();
      const result = estimate({ text: 'a', model });
      expect(result.characterCount).toBe(1);
      expect(result.estimatedTokens).toBe(1); // ceil(1/4) = 1
    });
  });

  describe('model handling', () => {
    it('all default models are accessible', () => {
      const models = getAvailableModels();
      expect(models.length).toBeGreaterThan(0);

      for (const model of models) {
        expect(() => estimate({ text: 'test', model })).not.toThrow();
      }
    });

    it('throws descriptive error for unknown model', () => {
      expect(() => estimate({ text: 'test', model: 'unknown-model' })).toThrow(
        /Unknown model: "unknown-model"/
      );
      expect(() => estimate({ text: 'test', model: 'unknown-model' })).toThrow(
        /Available models:/
      );
    });

    it('getAvailableModels returns models from all providers', () => {
      const models = getAvailableModels();
      // Should have at least one model from each provider
      expect(models.some((m) => m.startsWith('gpt-') || m.startsWith('o'))).toBe(true);
      expect(models.some((m) => m.startsWith('claude-'))).toBe(true);
      expect(models.some((m) => m.startsWith('gemini-'))).toBe(true);
    });
  });

  describe('performance', () => {
    it('handles large string (1MB+) without excessive time', () => {
      const model = getOpenAIModel();
      const largeText = 'a'.repeat(1_000_000); // 1 million characters
      const start = performance.now();
      const result = estimate({ text: largeText, model });
      const elapsed = performance.now() - start;

      expect(result.characterCount).toBe(1_000_000);
      expect(result.estimatedTokens).toBe(250_000);
      // Should complete in under 1 second (generous limit)
      expect(elapsed).toBeLessThan(1000);
    });
  });
});

describe('getModelConfig', () => {
  it('returns config for valid model', () => {
    const model = getOpenAIModel();
    const config = getModelConfig(model);
    expect(config.charsPerToken).toBe(4);
    expect(config.inputCostPerMillion).toBeGreaterThan(0);
  });

  it('throws for invalid model', () => {
    expect(() => getModelConfig('not-a-model')).toThrow(/Unknown model/);
  });
});

describe('DEFAULT_MODELS', () => {
  it('is frozen and cannot be mutated', () => {
    expect(Object.isFrozen(DEFAULT_MODELS)).toBe(true);

    // Attempting to modify should fail silently in non-strict or throw in strict
    expect(() => {
      (DEFAULT_MODELS as Record<string, unknown>)['new-model'] = {
        charsPerToken: 5,
        inputCostPerMillion: 10,
      };
    }).toThrow();
  });

  it('nested model configs are also frozen', () => {
    const model = getOpenAIModel();
    const config = DEFAULT_MODELS[model];
    expect(Object.isFrozen(config)).toBe(true);

    expect(() => {
      (config as Record<string, unknown>).charsPerToken = 999;
    }).toThrow();
  });
});
