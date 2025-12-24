import { describe, it, expect } from 'vitest';
import {
  estimate,
  getModelConfig,
  getAvailableModels,
  DEFAULT_MODELS,
} from '../src/index.js';

describe('estimate', () => {
  describe('basic functionality', () => {
    it('correctly estimates tokens for known character count', () => {
      // 8 characters / 4 chars per token = 2 tokens
      const result = estimate({ text: 'abcdefgh', model: 'gpt-4o' });
      expect(result.characterCount).toBe(8);
      expect(result.estimatedTokens).toBe(2);
    });

    it('correctly calculates cost', () => {
      // 1000 chars / 4 = 250 tokens
      // 250 tokens * 2.50 / 1_000_000 = 0.000625
      const result = estimate({ text: 'a'.repeat(1000), model: 'gpt-4o' });
      expect(result.estimatedTokens).toBe(250);
      expect(result.estimatedInputCost).toBeCloseTo(0.000625, 10);
    });

    it('returns zero tokens and cost for empty string', () => {
      const result = estimate({ text: '', model: 'gpt-4o' });
      expect(result.characterCount).toBe(0);
      expect(result.estimatedTokens).toBe(0);
      expect(result.estimatedInputCost).toBe(0);
    });

    it('includes model and charsPerToken in output', () => {
      const result = estimate({ text: 'test', model: 'claude-opus-4.5' });
      expect(result.model).toBe('claude-opus-4.5');
      expect(result.charsPerToken).toBe(3.5);
    });
  });

  describe('rounding', () => {
    it('defaults to ceil rounding', () => {
      // 5 characters / 4 = 1.25, ceil = 2
      const result = estimate({ text: 'hello', model: 'gpt-4o' });
      expect(result.estimatedTokens).toBe(2);
    });

    it('respects floor rounding', () => {
      // 5 characters / 4 = 1.25, floor = 1
      const result = estimate({
        text: 'hello',
        model: 'gpt-4o',
        rounding: 'floor',
      });
      expect(result.estimatedTokens).toBe(1);
    });

    it('respects round rounding', () => {
      // 5 characters / 4 = 1.25, round = 1
      const result = estimate({
        text: 'hello',
        model: 'gpt-4o',
        rounding: 'round',
      });
      expect(result.estimatedTokens).toBe(1);

      // 7 characters / 4 = 1.75, round = 2
      const result2 = estimate({
        text: 'hello!!',
        model: 'gpt-4o',
        rounding: 'round',
      });
      expect(result2.estimatedTokens).toBe(2);
    });

    it('handles exact division (no rounding needed)', () => {
      // 8 characters / 4 = 2.0 exactly
      const result = estimate({ text: 'abcdefgh', model: 'gpt-4o' });
      expect(result.estimatedTokens).toBe(2);
    });
  });

  describe('character counting', () => {
    it('counts ASCII text correctly', () => {
      const result = estimate({ text: 'Hello, world!', model: 'gpt-4o' });
      expect(result.characterCount).toBe(13);
    });

    it('counts non-ASCII (accented characters) correctly', () => {
      const result = estimate({ text: 'café', model: 'gpt-4o' });
      expect(result.characterCount).toBe(4);
    });

    it('counts emoji as single characters (not surrogate pairs)', () => {
      // Each emoji should be 1 code point, not 2 UTF-16 code units
      const result = estimate({ text: '👍', model: 'gpt-4o' });
      expect(result.characterCount).toBe(1);

      const result2 = estimate({ text: '👍👎👏', model: 'gpt-4o' });
      expect(result2.characterCount).toBe(3);
    });

    it('handles mixed content (code with emoji in comments)', () => {
      const code = `// This is great! 👍
function hello() {
  return "world";
}`;
      const result = estimate({ text: code, model: 'gpt-4o' });
      // Count manually: the emoji should be 1 char
      expect(result.characterCount).toBe(code.length - 1); // -1 because 👍 is 2 code units but 1 code point
    });

    it('counts whitespace-only input', () => {
      const result = estimate({ text: '   ', model: 'gpt-4o' });
      expect(result.characterCount).toBe(3);
    });

    it('counts single character input', () => {
      const result = estimate({ text: 'a', model: 'gpt-4o' });
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

    it('getAvailableModels returns all model IDs', () => {
      const models = getAvailableModels();
      expect(models).toContain('gpt-4o');
      expect(models).toContain('claude-opus-4.5');
      expect(models).toContain('claude-sonnet-4');
    });
  });

  describe('performance', () => {
    it('handles large string (1MB+) without excessive time', () => {
      const largeText = 'a'.repeat(1_000_000); // 1 million characters
      const start = performance.now();
      const result = estimate({ text: largeText, model: 'gpt-4o' });
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
    const config = getModelConfig('gpt-4o');
    expect(config.charsPerToken).toBe(4);
    expect(config.inputCostPerMillion).toBe(2.5);
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
    const config = DEFAULT_MODELS['gpt-4o'];
    expect(Object.isFrozen(config)).toBe(true);

    expect(() => {
      (config as Record<string, unknown>).charsPerToken = 999;
    }).toThrow();
  });
});
