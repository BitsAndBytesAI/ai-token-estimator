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

  it('anthropic_count_tokens falls back to heuristic when throttled (429) and fallbackToHeuristicOnError is true', async () => {
    const text = 'Hello, Claude';
    const model = 'claude-sonnet-4-5';
    const baseline = await estimateAsync({ text, model, tokenizer: 'heuristic' });

    const fetchMock = vi.fn(async () => {
      const res = {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: 'rate_limited' } }),
      };
      return res as unknown as Response;
    });

    const out = await estimateAsync({
      text,
      model,
      tokenizer: 'anthropic_count_tokens',
      fetch: fetchMock as unknown as typeof fetch,
      anthropic: { apiKey: 'test-key' },
      fallbackToHeuristicOnError: true,
    });

    expect(out.tokenizerMode).toBe('heuristic');
    expect(out.estimatedTokens).toBe(baseline.estimatedTokens);
  });

  it('anthropic_count_tokens throws on provider error when fallbackToHeuristicOnError is false', async () => {
    const fetchMock = vi.fn(async () => {
      const res = {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'invalid_api_key' } }),
      };
      return res as unknown as Response;
    });

    await expect(
      estimateAsync({
        text: 'Hello, Claude',
        model: 'claude-sonnet-4-5',
        tokenizer: 'anthropic_count_tokens',
        fetch: fetchMock as unknown as typeof fetch,
        anthropic: { apiKey: 'bad-key' },
      }),
    ).rejects.toThrow(/Anthropic count_tokens failed/i);
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

  it('gemini_count_tokens falls back to heuristic when throttled (429) and fallbackToHeuristicOnError is true', async () => {
    const text = 'hello';
    const model = 'gemini-2.0-flash';
    const baseline = await estimateAsync({ text, model, tokenizer: 'heuristic' });

    const fetchMock = vi.fn(async () => {
      const res = {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: 'rate_limited' } }),
      };
      return res as unknown as Response;
    });

    const out = await estimateAsync({
      text,
      model,
      tokenizer: 'gemini_count_tokens',
      fetch: fetchMock as unknown as typeof fetch,
      gemini: { apiKey: 'test-key' },
      fallbackToHeuristicOnError: true,
    });

    expect(out.tokenizerMode).toBe('heuristic');
    expect(out.estimatedTokens).toBe(baseline.estimatedTokens);
  });

  it('gemini_count_tokens throws on provider error when fallbackToHeuristicOnError is false', async () => {
    const fetchMock = vi.fn(async () => {
      const res = {
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: { message: 'forbidden' } }),
      };
      return res as unknown as Response;
    });

    await expect(
      estimateAsync({
        text: 'hello',
        model: 'gemini-2.0-flash',
        tokenizer: 'gemini_count_tokens',
        fetch: fetchMock as unknown as typeof fetch,
        gemini: { apiKey: 'bad-key' },
      }),
    ).rejects.toThrow(/Gemini countTokens failed/i);
  });
});

describe('estimateAsync - extended cost fields', () => {
  it('returns estimatedTotalCost equal to estimatedInputCost when no cost inputs', async () => {
    const result = await estimateAsync({ text: 'Hello, world!', model: 'gpt-4o' });
    expect(result.estimatedTotalCost).toBe(result.estimatedInputCost);
    expect(result.estimatedOutputCost).toBeUndefined();
    expect(result.estimatedCachedInputCost).toBeUndefined();
  });

  it('calculates output cost when outputTokens provided', async () => {
    const result = await estimateAsync({
      text: 'Hello',
      model: 'gpt-4o',
      outputTokens: 1_000_000,
    });

    expect(result.outputTokens).toBe(1_000_000);
    expect(result.estimatedOutputCost).toBeCloseTo(10.0, 6); // $10/M output
    expect(result.estimatedTotalCost).toBeCloseTo(result.estimatedInputCost + 10.0, 6);
  });

  it('calculates cached input cost when cachedInputTokens provided', async () => {
    const result = await estimateAsync({
      text: 'a'.repeat(40),
      model: 'gpt-4o',
      cachedInputTokens: 5,
    });

    expect(result.estimatedCachedInputCost).toBeGreaterThan(0);
  });

  it('uses batch rates when mode=batch', async () => {
    const standardResult = await estimateAsync({
      text: 'a'.repeat(40),
      model: 'gpt-4o',
    });

    const batchResult = await estimateAsync({
      text: 'a'.repeat(40),
      model: 'gpt-4o',
      mode: 'batch',
    });

    // Batch input rate is $1.25/M vs standard $2.50/M, so batch should be cheaper
    expect(batchResult.estimatedTotalCost).toBeLessThan(standardResult.estimatedInputCost);
  });

  it('falls back to input-only cost when pricing unavailable', async () => {
    // Claude doesn't have output pricing in models.ts, so outputTokens should gracefully fail
    const result = await estimateAsync({
      text: 'Hello, world!',
      model: 'claude-sonnet-4',
      outputTokens: 100,
    });

    // Should fall back to input-only cost when estimateCost throws
    expect(result.estimatedTotalCost).toBe(result.estimatedInputCost);
    expect(result.estimatedOutputCost).toBeUndefined();
  });
});
