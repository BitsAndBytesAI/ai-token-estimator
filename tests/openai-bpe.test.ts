import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decode, encode } from '../src/index.js';
import type { OpenAIEncoding } from '../src/index.js';

// Load tiktoken golden fixtures
const fixturesPath = join(__dirname, 'fixtures', 'tiktoken-golden.json');
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf-8'));

interface EncodeFixture {
  encoding: OpenAIEncoding;
  text: string;
  tokens: number[];
  tokenCount: number;
}

describe('OpenAI BPE tokenizer - tiktoken parity', () => {
  const encodeFixtures: EncodeFixture[] = fixtures.encodeFixtures;

  // Group fixtures by encoding for organized test output
  const byEncoding = new Map<string, EncodeFixture[]>();
  for (const fixture of encodeFixtures) {
    const list = byEncoding.get(fixture.encoding) || [];
    list.push(fixture);
    byEncoding.set(fixture.encoding, list);
  }

  for (const [encoding, encodingFixtures] of byEncoding) {
    describe(`encoding: ${encoding}`, () => {
      for (const fixture of encodingFixtures) {
        const displayText = fixture.text.length > 40
          ? fixture.text.slice(0, 40) + '...'
          : fixture.text;
        const escapedText = displayText.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');

        it(`encode("${escapedText}") => ${fixture.tokenCount} tokens`, () => {
          const tokens = encode(fixture.text, {
            encoding: fixture.encoding,
            allowSpecial: 'none',
          });
          expect(tokens).toEqual(fixture.tokens);
          expect(tokens.length).toBe(fixture.tokenCount);
        });

        it(`decode(encode("${escapedText}")) round-trips`, () => {
          const tokens = encode(fixture.text, {
            encoding: fixture.encoding,
            allowSpecial: 'none',
          });
          const decoded = decode(tokens, { encoding: fixture.encoding });
          expect(decoded).toBe(fixture.text);
        });
      }
    });
  }
});

describe('OpenAI BPE tokenizer - special token handling', () => {
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
    expect(tokens.length).toBeGreaterThan(0);
  });
});

describe('OpenAI BPE tokenizer - model mapping', () => {
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
});

describe('OpenAI BPE tokenizer - decode error handling', () => {
  it('throws on invalid/unknown token IDs', () => {
    // Use a token ID that's way out of range for any vocab
    expect(() => decode([999999999], { encoding: 'cl100k_base' })).toThrow(
      'Invalid token ID: 999999999'
    );
  });

  it('throws on negative token IDs', () => {
    expect(() => decode([-1], { encoding: 'o200k_base' })).toThrow(
      'Invalid token ID: -1'
    );
  });
});
