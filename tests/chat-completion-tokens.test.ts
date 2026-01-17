import { describe, it, expect } from 'vitest';
import { countChatCompletionTokens } from '../src/index.js';
import type {
  ChatMessage,
  ChatCompletionTokenCountInput,
} from '../src/index.js';

// =============================================================================
// Validation / Error Tests
// =============================================================================

describe('countChatCompletionTokens - validation', () => {
  const model = 'gpt-4o';
  const validMessages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

  it('throws for tools array', () => {
    const input = {
      messages: validMessages,
      model,
      tools: [{ type: 'function', function: { name: 'foo' } }],
    } as unknown as ChatCompletionTokenCountInput;

    expect(() => countChatCompletionTokens(input)).toThrow(
      'Tools API is not yet supported'
    );
  });

  it('throws for tool_choice', () => {
    const input = {
      messages: validMessages,
      model,
      tool_choice: 'auto',
    } as unknown as ChatCompletionTokenCountInput;

    expect(() => countChatCompletionTokens(input)).toThrow(
      'tool_choice is not yet supported'
    );
  });

  it('throws for message with tool_calls', () => {
    const input = {
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: '1', type: 'function', function: { name: 'foo' } }],
        },
      ],
      model,
    } as unknown as ChatCompletionTokenCountInput;

    expect(() => countChatCompletionTokens(input)).toThrow(
      'messages[0]: tool_calls is not yet supported'
    );
  });

  it('throws for message with tool_call_id', () => {
    const input = {
      messages: [{ role: 'assistant', content: '{}', tool_call_id: '1' }],
      model,
    } as unknown as ChatCompletionTokenCountInput;

    expect(() => countChatCompletionTokens(input)).toThrow(
      'messages[0]: tool_call_id is not yet supported'
    );
  });

  it('throws for invalid role', () => {
    const input = {
      messages: [{ role: 'tool', content: '{}' }],
      model,
    } as unknown as ChatCompletionTokenCountInput;

    expect(() => countChatCompletionTokens(input)).toThrow(
      'messages[0].role: Invalid role "tool"'
    );
  });

  it('throws for array content (multimodal)', () => {
    const input = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      ],
      model,
    } as unknown as ChatCompletionTokenCountInput;

    expect(() => countChatCompletionTokens(input)).toThrow(
      'messages[0].content: Multimodal content (arrays) is not supported'
    );
  });

  it('throws for number content', () => {
    const input = {
      messages: [{ role: 'user', content: 123 }],
      model,
    } as unknown as ChatCompletionTokenCountInput;

    expect(() => countChatCompletionTokens(input)).toThrow(
      'messages[0].content: Expected string | null | undefined, got number'
    );
  });

  it('throws for object content', () => {
    const input = {
      messages: [{ role: 'user', content: { text: 'hello' } }],
      model,
    } as unknown as ChatCompletionTokenCountInput;

    expect(() => countChatCompletionTokens(input)).toThrow(
      'messages[0].content: Expected string | null | undefined, got object'
    );
  });

  it('throws for Claude model', () => {
    expect(() =>
      countChatCompletionTokens({
        messages: validMessages,
        model: 'claude-3-opus-20240229',
      })
    ).toThrow('is an Anthropic model');
  });

  it('throws for Gemini model', () => {
    expect(() =>
      countChatCompletionTokens({
        messages: validMessages,
        model: 'gemini-1.5-pro',
      })
    ).toThrow('is a Google model');
  });

  it('throws for unknown model', () => {
    expect(() =>
      countChatCompletionTokens({
        messages: validMessages,
        model: 'llama-3.1-70b',
      })
    ).toThrow('is not recognized');
  });

  it('throws for non-chat model', () => {
    expect(() =>
      countChatCompletionTokens({
        messages: validMessages,
        model: 'davinci-002',
      })
    ).toThrow('is not a chat completion model');
  });

  it('allows unknown model with encoding override', () => {
    const result = countChatCompletionTokens({
      messages: validMessages,
      model: 'some-future-openai-model',
      encoding: 'o200k_base',
    });
    expect(result.exact).toBe(true);
    expect(result.encoding).toBe('o200k_base');
  });

  it('rejects Claude model even with encoding override', () => {
    expect(() =>
      countChatCompletionTokens({
        messages: validMessages,
        model: 'claude-3-opus-20240229',
        encoding: 'o200k_base',
      })
    ).toThrow('is an Anthropic model');
  });

  it('rejects Gemini model even with encoding override', () => {
    expect(() =>
      countChatCompletionTokens({
        messages: validMessages,
        model: 'gemini-1.5-pro',
        encoding: 'o200k_base',
      })
    ).toThrow('is a Google model');
  });

  it('rejects non-chat model even with encoding override', () => {
    expect(() =>
      countChatCompletionTokens({
        messages: validMessages,
        model: 'davinci-002',
        encoding: 'o200k_base',
      })
    ).toThrow('is not a chat completion model');
  });
});

// =============================================================================
// Options Tests
// =============================================================================

describe('countChatCompletionTokens - options', () => {
  const model = 'gpt-4o';

  it('does not include breakdown by default', () => {
    const result = countChatCompletionTokens({
      messages: [{ role: 'user', content: 'hello' }],
      model,
    });
    expect(result.messageBreakdown).toBeUndefined();
  });

  it('includes breakdown when includeBreakdown: true', () => {
    const result = countChatCompletionTokens({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hello' },
      ],
      model,
      includeBreakdown: true,
    });

    expect(result.messageBreakdown).toBeDefined();
    expect(result.messageBreakdown).toHaveLength(2);
    expect(result.messageBreakdown![0].role).toBe('system');
    expect(result.messageBreakdown![1].role).toBe('user');

    // Verify breakdown totals match messageTokens
    const breakdownTotal = result.messageBreakdown!.reduce(
      (sum, m) => sum + m.totalTokens,
      0
    );
    expect(breakdownTotal).toBe(result.messageTokens);
  });

  it('separates completionOverheadTokens from messageTokens', () => {
    const result = countChatCompletionTokens({
      messages: [{ role: 'user', content: 'hello' }],
      model,
    });

    expect(result.completionOverheadTokens).toBe(3); // COMPLETION_REQUEST_TOKEN_OVERHEAD
    expect(result.totalTokens).toBe(
      result.messageTokens +
        result.completionOverheadTokens +
        result.functionTokens +
        result.functionCallTokens
    );
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('countChatCompletionTokens - edge cases', () => {
  const model = 'gpt-4o';

  it('handles empty messages array', () => {
    const result = countChatCompletionTokens({
      messages: [],
      model,
    });
    expect(result.messageTokens).toBe(0);
    expect(result.completionOverheadTokens).toBe(3);
    expect(result.totalTokens).toBe(3);
  });

  it('handles null content', () => {
    const result = countChatCompletionTokens({
      messages: [{ role: 'assistant', content: null }],
      model,
    });
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('handles undefined content with function_call', () => {
    const result = countChatCompletionTokens({
      messages: [
        {
          role: 'assistant',
          function_call: { name: 'test', arguments: '{}' },
        },
      ],
      model,
    });
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('handles unicode/emoji in messages', () => {
    const result = countChatCompletionTokens({
      messages: [{ role: 'user', content: 'Hello 👋 世界 🌍' }],
      model,
    });
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.exact).toBe(true);
  });

  it('handles special-token-like strings without throwing', () => {
    // These look like special tokens but should be treated as regular text
    const result = countChatCompletionTokens({
      messages: [
        { role: 'user', content: '<|endoftext|> <|im_start|> <|im_end|>' },
      ],
      model,
    });
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.exact).toBe(true);
  });

  it('returns correct encoding for different models', () => {
    const gpt4o = countChatCompletionTokens({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'gpt-4o',
    });
    expect(gpt4o.encoding).toBe('o200k_base');

    const gpt35 = countChatCompletionTokens({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'gpt-3.5-turbo',
    });
    expect(gpt35.encoding).toBe('cl100k_base');
  });
});
