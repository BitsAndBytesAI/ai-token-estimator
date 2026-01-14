import { describe, it, expect } from 'vitest';
import { encode, estimate } from '../src/index.js';

describe('estimate tokenizer modes', () => {
  it('uses exact OpenAI tokens when tokenizer=openai_exact', () => {
    const text = 'Hello, world!';
    const exact = encode(text, { model: 'gpt-5.1', allowSpecial: 'none' }).length;

    const result = estimate({
      text,
      model: 'gpt-5.1',
      tokenizer: 'openai_exact',
    });

    expect(result.estimatedTokens).toBe(exact);
    expect(result.tokenizerMode).toBe('openai_exact');
    expect(result.encodingUsed).toBe('o200k_base');
  });

  it('uses exact OpenAI tokens when tokenizer=auto for OpenAI models', () => {
    const result = estimate({
      text: 'Hello, world!',
      model: 'gpt-5.1',
      tokenizer: 'auto',
    });
    expect(result.tokenizerMode).toBe('openai_exact');
  });

  it('throws when tokenizer=openai_exact for non-OpenAI models', () => {
    expect(() =>
      estimate({
        text: 'Hello, world!',
        model: 'claude-sonnet-4',
        tokenizer: 'openai_exact',
      })
    ).toThrow(/openai_exact/);
  });
});

