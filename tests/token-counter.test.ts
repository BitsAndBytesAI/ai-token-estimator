import { describe, it, expect } from 'vitest';
import { countTokens } from '../src/index.js';

describe('countTokens', () => {
  it('returns exact token count for OpenAI models', () => {
    const result = countTokens({ text: 'Hello, world!', model: 'gpt-5.1' });
    expect(result.exact).toBe(true);
    expect(result.encoding).toBe('o200k_base');
    expect(result.tokens).toBeGreaterThan(0);
  });

  it('returns heuristic token count for non-OpenAI models', () => {
    const result = countTokens({
      text: 'Hello, world!',
      model: 'claude-sonnet-4',
    });
    expect(result.exact).toBe(false);
    expect(result.encoding).toBeUndefined();
    expect(result.tokens).toBeGreaterThan(0);
  });
});

