import { describe, it, expect } from 'vitest';
import {
  encode,
  isWithinTokenLimit,
  isChatWithinTokenLimit,
  countChatCompletionTokens,
} from '../src/index.js';
import type { ChatMessage } from '../src/index.js';

// =============================================================================
// isWithinTokenLimit - plain text tests
// =============================================================================

describe('isWithinTokenLimit - plain text', () => {
  it('returns token count when within limit', () => {
    const text = 'Hello';
    const exactCount = encode(text, { model: 'gpt-4o' }).length;
    expect(isWithinTokenLimit(text, 10, { model: 'gpt-4o' })).toBe(exactCount);
  });

  it('returns false when exceeds limit', () => {
    const text = 'Hello world this is a test';
    expect(isWithinTokenLimit(text, 1, { model: 'gpt-4o' })).toBe(false);
  });

  it('returns 0 for empty string', () => {
    expect(isWithinTokenLimit('', 10, { model: 'gpt-4o' })).toBe(0);
  });

  it('returns false for tokenLimit 0 with non-empty text', () => {
    expect(isWithinTokenLimit('a', 0, { model: 'gpt-4o' })).toBe(false);
  });

  it('handles exact limit match (returns count, not false)', () => {
    const text = 'Hello';
    const exactCount = encode(text, { model: 'gpt-4o' }).length;
    expect(isWithinTokenLimit(text, exactCount, { model: 'gpt-4o' })).toBe(
      exactCount
    );
  });

  it('returns false when 1 over limit', () => {
    const text = 'Hello';
    const exactCount = encode(text, { model: 'gpt-4o' }).length;
    expect(isWithinTokenLimit(text, exactCount - 1, { model: 'gpt-4o' })).toBe(
      false
    );
  });

  it('throws for negative tokenLimit', () => {
    expect(() =>
      isWithinTokenLimit('test', -1, { model: 'gpt-4o' })
    ).toThrow(/non-negative/);
  });

  it('throws for NaN tokenLimit', () => {
    expect(() =>
      isWithinTokenLimit('test', NaN, { model: 'gpt-4o' })
    ).toThrow(/finite/);
  });

  it('throws for Infinity tokenLimit', () => {
    expect(() =>
      isWithinTokenLimit('test', Infinity, { model: 'gpt-4o' })
    ).toThrow(/finite/);
  });

  it('throws for negative Infinity tokenLimit', () => {
    expect(() =>
      isWithinTokenLimit('test', -Infinity, { model: 'gpt-4o' })
    ).toThrow(/finite/);
  });

  it('throws for non-integer tokenLimit', () => {
    expect(() =>
      isWithinTokenLimit('test', 3.5, { model: 'gpt-4o' })
    ).toThrow(/integer/);
  });

  it('works with explicit encoding override', () => {
    const text = 'Hello';
    const exactCount = encode(text, { encoding: 'cl100k_base' }).length;
    expect(isWithinTokenLimit(text, 10, { encoding: 'cl100k_base' })).toBe(
      exactCount
    );
  });

  it('throws for non-OpenAI model (claude-*)', () => {
    expect(() =>
      isWithinTokenLimit('test', 10, { model: 'claude-sonnet-4' })
    ).toThrow(/Anthropic/);
  });

  it('throws for non-OpenAI model (gemini-*)', () => {
    expect(() =>
      isWithinTokenLimit('test', 10, { model: 'gemini-2.0-flash' })
    ).toThrow(/Google/);
  });

  it('handles special tokens with allowSpecial: none', () => {
    // <|endoftext|> should be encoded as regular text
    const text = 'Hello <|endoftext|> world';
    const result = isWithinTokenLimit(text, 100, {
      model: 'gpt-4o',
      allowSpecial: 'none',
    });
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  describe('parity with encode().length', () => {
    const testCases = [
      'Hello, world!',
      'The quick brown fox jumps over the lazy dog.',
      'function foo() { return 42; }', // code
      '  multiple   spaces  ',
      '\n\nNewlines\n\n',
    ];

    for (const text of testCases) {
      it(`matches encode().length for: "${text.slice(0, 30)}..."`, () => {
        const exactCount = encode(text, { model: 'gpt-4o' }).length;
        const result = isWithinTokenLimit(text, 1000, { model: 'gpt-4o' });
        expect(result).toBe(exactCount);
      });
    }
  });
});

// =============================================================================
// isChatWithinTokenLimit - chat messages tests
// =============================================================================

describe('isChatWithinTokenLimit', () => {
  it('returns token count when within limit', () => {
    const result = isChatWithinTokenLimit({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'gpt-4o',
      tokenLimit: 100,
    });
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  it('returns false when exceeds limit', () => {
    const result = isChatWithinTokenLimit({
      messages: [{ role: 'user', content: 'a'.repeat(10000) }],
      model: 'gpt-4o',
      tokenLimit: 10,
    });
    expect(result).toBe(false);
  });

  it('throws for negative tokenLimit', () => {
    expect(() =>
      isChatWithinTokenLimit({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        tokenLimit: -1,
      })
    ).toThrow(/non-negative/);
  });

  it('throws for NaN tokenLimit', () => {
    expect(() =>
      isChatWithinTokenLimit({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        tokenLimit: NaN,
      })
    ).toThrow(/finite/);
  });

  it('throws for Infinity tokenLimit', () => {
    expect(() =>
      isChatWithinTokenLimit({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        tokenLimit: Infinity,
      })
    ).toThrow(/finite/);
  });

  it('throws for non-integer tokenLimit', () => {
    expect(() =>
      isChatWithinTokenLimit({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        tokenLimit: 10.5,
      })
    ).toThrow(/integer/);
  });

  describe('parity with countChatCompletionTokens', () => {
    it('matches for simple messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is 2+2?' },
      ];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
      }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with functions', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the weather?' },
      ];
      const functions = [
        {
          name: 'get_weather',
          description: 'Get weather for a location',
          parameters: {
            type: 'object' as const,
            properties: {
              location: { type: 'string', description: 'City name' },
            },
          },
        },
      ];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
        functions,
      }).totalTokens;

      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with function_call: none', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
      const functions = [
        { name: 'test', parameters: { type: 'object' as const } },
      ];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
        functions,
        function_call: 'none',
      }).totalTokens;

      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
        function_call: 'none',
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with function_call: { name: "..." }', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
      const functions = [
        { name: 'get_weather', parameters: { type: 'object' as const } },
      ];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
        functions,
        function_call: { name: 'get_weather' },
      }).totalTokens;

      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
        function_call: { name: 'get_weather' },
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with message.name (adds MESSAGE_NAME_TOKEN_OVERHEAD)', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello', name: 'alice' },
      ];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
      }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with role: function (applies FUNCTION_ROLE_TOKEN_DISCOUNT)', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: null,
          function_call: { name: 'get_weather', arguments: '{}' },
        },
        { role: 'function', content: '{"temp": 72}', name: 'get_weather' },
      ];
      const functions = [
        { name: 'get_weather', parameters: { type: 'object' as const } },
      ];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
        functions,
      }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with assistant function_call in message', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: null,
          function_call: {
            name: 'get_weather',
            arguments: '{"location":"Paris"}',
          },
        },
      ];
      const functions = [
        { name: 'get_weather', parameters: { type: 'object' as const } },
      ];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
        functions,
      }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches system padding edge case (functions + system without trailing newline)', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful' }, // no trailing \n
        { role: 'user', content: 'Hello' },
      ];
      const functions = [
        { name: 'test', parameters: { type: 'object' as const } },
      ];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
        functions,
      }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with no system message and functions (no deduction)', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'What is the weather?' },
      ];
      const functions = [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object' as const },
        },
      ];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
        functions,
      }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
        functions,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with empty messages array', () => {
      const messages: ChatMessage[] = [];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
      }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
      });

      expect(limitResult).toBe(exactCount);
    });

    it('matches with multi-turn conversation', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello! How can I help?' },
        { role: 'user', content: 'Tell me a joke' },
        { role: 'assistant', content: 'Why did the chicken cross the road?' },
        { role: 'user', content: 'Why?' },
        { role: 'assistant', content: 'To get to the other side!' },
      ];

      const exactCount = countChatCompletionTokens({
        messages,
        model: 'gpt-4o',
      }).totalTokens;
      const limitResult = isChatWithinTokenLimit({
        messages,
        model: 'gpt-4o',
        tokenLimit: 1000,
      });

      expect(limitResult).toBe(exactCount);
    });
  });
});
