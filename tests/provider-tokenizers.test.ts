import { describe, expect, it, vi } from 'vitest';
import { estimateAsync } from '../src/estimator-async.js';

describe('provider tokenizers', () => {
  it('anthropic_count_tokens uses /v1/messages/count_tokens', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toContain('https://api.anthropic.com/v1/messages/count_tokens');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('test-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      const res = {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ input_tokens: 14 }),
      };
      return res as unknown as Response;
    });

    const out = await estimateAsync({
      text: 'Hello, Claude',
      model: 'claude-sonnet-4-5',
      tokenizer: 'anthropic_count_tokens',
      fetch: fetchMock as unknown as typeof fetch,
      anthropic: { apiKey: 'test-key' },
    });

    expect(out.estimatedTokens).toBe(14);
    expect(out.tokenizerMode).toBe('anthropic_count_tokens');
  });

  it('gemini_count_tokens calls models/:countTokens', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:countTokens');
      expect(String(url)).toContain('key=test-key');
      expect(init?.method).toBe('POST');
      const res = {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ totalTokens: 10 }),
      };
      return res as unknown as Response;
    });

    const out = await estimateAsync({
      text: 'hello',
      model: 'gemini-2.0-flash',
      tokenizer: 'gemini_count_tokens',
      fetch: fetchMock as unknown as typeof fetch,
      gemini: { apiKey: 'test-key' },
    });

    expect(out.estimatedTokens).toBe(10);
    expect(out.tokenizerMode).toBe('gemini_count_tokens');
  });
});
