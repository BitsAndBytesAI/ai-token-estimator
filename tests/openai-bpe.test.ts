import { describe, it, expect } from 'vitest';
import { decode, encode } from '../src/index.js';

describe('OpenAI BPE tokenizer (encode/decode)', () => {
  it('round-trips ASCII text with explicit encoding', () => {
    const text = 'Hello, world!';
    const tokens = encode(text, { encoding: 'o200k_base' });
    expect(tokens.length).toBeGreaterThan(0);
    expect(decode(tokens, { encoding: 'o200k_base' })).toBe(text);
  });

  it('round-trips unicode + emoji', () => {
    const text = 'café 👍';
    const tokens = encode(text, { encoding: 'o200k_base' });
    expect(tokens.length).toBeGreaterThan(0);
    expect(decode(tokens, { encoding: 'o200k_base' })).toBe(text);
  });

  it('uses model mapping when model is provided (gpt-5.1 -> o200k_base)', () => {
    const text = 'test';
    const byModel = encode(text, { model: 'gpt-5.1' });
    const byEncoding = encode(text, { encoding: 'o200k_base' });
    expect(byModel).toEqual(byEncoding);
  });

  it('uses model mapping for older chat models (gpt-3.5-turbo -> cl100k_base)', () => {
    const text = 'test';
    const byModel = encode(text, { model: 'gpt-3.5-turbo' });
    const byEncoding = encode(text, { encoding: 'cl100k_base' });
    expect(byModel).toEqual(byEncoding);
  });

  it('defaults to raising on special tokens (none_raise)', () => {
    expect(() => encode('<|endoftext|>', { encoding: 'o200k_base' })).toThrow();
  });

  it('treats special tokens as normal text when allowSpecial=none', () => {
    const tokens = encode('<|endoftext|>', {
      encoding: 'o200k_base',
      allowSpecial: 'none',
    });
    expect(tokens.length).toBeGreaterThan(0);
    expect(decode(tokens, { encoding: 'o200k_base' })).toBe('<|endoftext|>');
  });

  it('allows special tokens when allowSpecial=all', () => {
    const tokens = encode('<|endoftext|>', {
      encoding: 'o200k_base',
      allowSpecial: 'all',
    });
    // Special tokens typically encode to a small number of token IDs.
    expect(tokens.length).toBeGreaterThan(0);
  });
});

