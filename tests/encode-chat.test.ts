import { describe, it, expect } from 'vitest';
import {
  encodeChat,
  decode,
  countChatCompletionTokens,
  type ChatMessage,
} from '../src/index.js';

describe('encodeChat', () => {
  describe('basic functionality', () => {
    it('encodes empty chat with assistant priming', () => {
      const tokens = encodeChat([], { model: 'gpt-4o' });
      // Should be: <|im_start|> + "assistant" tokens + <|im_sep|>
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens[0]).toBe(200264); // <|im_start|>
      expect(tokens[tokens.length - 1]).toBe(200266); // <|im_sep|>
    });

    it('encodes empty chat without priming when primeAssistant: false', () => {
      const tokens = encodeChat([], { model: 'gpt-4o', primeAssistant: false });
      expect(tokens).toEqual([]);
    });

    it('encodes single user message', () => {
      const tokens = encodeChat(
        [{ role: 'user', content: 'Hello' }],
        { model: 'gpt-4o' }
      );

      // Should contain message tokens + assistant priming
      expect(tokens[0]).toBe(200264); // <|im_start|>
      expect(tokens.length).toBeGreaterThan(5);
    });

    it('encodes multi-turn conversation', () => {
      const tokens = encodeChat(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
          { role: 'user', content: 'Bye' },
        ],
        { model: 'gpt-4o' }
      );

      // Count special tokens (4 messages + assistant priming)
      const imStartCount = tokens.filter((t) => t === 200264).length;
      expect(imStartCount).toBe(5); // 4 messages + 1 priming
    });

    it('respects primeAssistant: false', () => {
      const withPriming = encodeChat(
        [{ role: 'user', content: 'Hi' }],
        { model: 'gpt-4o', primeAssistant: true }
      );

      const withoutPriming = encodeChat(
        [{ role: 'user', content: 'Hi' }],
        { model: 'gpt-4o', primeAssistant: false }
      );

      expect(withPriming.length).toBeGreaterThan(withoutPriming.length);
    });

    it('defaults primeAssistant to true', () => {
      const withDefault = encodeChat(
        [{ role: 'user', content: 'Hi' }],
        { model: 'gpt-4o' }
      );

      const withExplicitTrue = encodeChat(
        [{ role: 'user', content: 'Hi' }],
        { model: 'gpt-4o', primeAssistant: true }
      );

      expect(withDefault.length).toBe(withExplicitTrue.length);
    });
  });

  describe('message name handling', () => {
    it('includes name in role position for non-function roles', () => {
      const tokens = encodeChat(
        [{ role: 'user', content: 'Hi', name: 'alice' }],
        { model: 'gpt-4o', primeAssistant: false }
      );

      // Should encode "user:alice" not just "user"
      const decoded = decode(tokens, { encoding: 'o200k_base' });
      expect(decoded).toContain('user:alice');
    });

    it('uses name directly as role for function messages', () => {
      const tokens = encodeChat(
        [{ role: 'function', content: '{"temp": 72}', name: 'get_weather' }],
        { model: 'gpt-4o', primeAssistant: false }
      );

      // Should encode "get_weather" as role, NOT "function:get_weather"
      const decoded = decode(tokens, { encoding: 'o200k_base' });
      expect(decoded).toContain('get_weather');
      expect(decoded).not.toContain('function:');
    });
  });

  describe('function_call handling', () => {
    it('encodes assistant message with function_call', () => {
      const tokens = encodeChat(
        [
          {
            role: 'assistant',
            content: null,
            function_call: { name: 'get_weather', arguments: '{"location":"NYC"}' },
          },
        ],
        { model: 'gpt-4o', primeAssistant: false }
      );

      const decoded = decode(tokens, { encoding: 'o200k_base' });
      expect(decoded).toContain('get_weather');
      expect(decoded).toContain('location');
    });

    it('encodes assistant message with both content and function_call', () => {
      const tokens = encodeChat(
        [
          {
            role: 'assistant',
            content: 'Let me check the weather.',
            function_call: { name: 'get_weather', arguments: '{}' },
          },
        ],
        { model: 'gpt-4o', primeAssistant: false }
      );

      const decoded = decode(tokens, { encoding: 'o200k_base' });
      expect(decoded).toContain('Let me check the weather.');
      expect(decoded).toContain('get_weather');
    });
  });

  describe('encoding selection', () => {
    it('uses cl100k_base for gpt-4', () => {
      const tokens = encodeChat(
        [{ role: 'user', content: 'Hi' }],
        { model: 'gpt-4' }
      );

      expect(tokens[0]).toBe(100264); // cl100k <|im_start|>
    });

    it('uses cl100k_base for gpt-3.5-turbo', () => {
      const tokens = encodeChat(
        [{ role: 'user', content: 'Hi' }],
        { model: 'gpt-3.5-turbo' }
      );

      expect(tokens[0]).toBe(100264); // cl100k <|im_start|>
    });

    it('uses o200k_base for gpt-4o', () => {
      const tokens = encodeChat(
        [{ role: 'user', content: 'Hi' }],
        { model: 'gpt-4o' }
      );

      expect(tokens[0]).toBe(200264); // o200k <|im_start|>
    });

    it('uses o200k_base for gpt-4o-mini', () => {
      const tokens = encodeChat(
        [{ role: 'user', content: 'Hi' }],
        { model: 'gpt-4o-mini' }
      );

      expect(tokens[0]).toBe(200264); // o200k <|im_start|>
    });

    it('allows explicit encoding override', () => {
      const tokens = encodeChat(
        [{ role: 'user', content: 'Hi' }],
        { encoding: 'cl100k_base' }
      );

      expect(tokens[0]).toBe(100264);
    });

    it('encoding takes precedence over model', () => {
      // Model would use o200k, but encoding override forces cl100k
      const tokens = encodeChat(
        [{ role: 'user', content: 'Hi' }],
        { model: 'gpt-4o', encoding: 'cl100k_base' }
      );

      expect(tokens[0]).toBe(100264); // cl100k, not o200k
    });

    it('defaults to o200k_base when no model or encoding specified', () => {
      const tokens = encodeChat([{ role: 'user', content: 'Hi' }]);

      expect(tokens[0]).toBe(200264); // o200k <|im_start|>
    });
  });

  describe('o200k_harmony support', () => {
    it('uses harmony tokens for o200k_harmony encoding', () => {
      const tokens = encodeChat(
        [{ role: 'user', content: 'Hi' }],
        { encoding: 'o200k_harmony' }
      );

      // Harmony uses <|start|> (200006) instead of <|im_start|>
      expect(tokens[0]).toBe(200006); // <|start|>
    });
  });

  describe('validation', () => {
    it('throws for non-OpenAI models (claude-*)', () => {
      expect(() =>
        encodeChat([], { model: 'claude-sonnet-4' })
      ).toThrow(/Anthropic/);
    });

    it('throws for non-OpenAI models (gemini-*)', () => {
      expect(() =>
        encodeChat([], { model: 'gemini-2.0-flash' })
      ).toThrow(/Google/);
    });

    it('throws for non-chat encodings', () => {
      expect(() =>
        encodeChat([], { encoding: 'r50k_base' })
      ).toThrow(/does not support chat/);
    });

    it('throws for p50k_base encoding', () => {
      expect(() =>
        encodeChat([], { encoding: 'p50k_base' })
      ).toThrow(/does not support chat/);
    });

    it('throws for tool_calls', () => {
      const message = {
        role: 'assistant' as const,
        content: null,
        tool_calls: [],
      };
      expect(() =>
        encodeChat([message as unknown as ChatMessage], { model: 'gpt-4o' })
      ).toThrow(/tool_calls/);
    });

    it('throws for tool_call_id', () => {
      const message = {
        role: 'tool' as const,
        content: 'result',
        tool_call_id: 'call_123',
      };
      expect(() =>
        encodeChat([message as unknown as ChatMessage], { model: 'gpt-4o' })
      ).toThrow(/tool_call_id/);
    });

    it('throws for multimodal content', () => {
      const message = {
        role: 'user' as const,
        content: [{ type: 'text', text: 'Hi' }],
      };
      expect(() =>
        encodeChat([message as unknown as ChatMessage], { model: 'gpt-4o' })
      ).toThrow(/Multimodal/);
    });
  });

  describe('parity with countChatCompletionTokens', () => {
    it('token count matches countChatCompletionTokens for simple messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello!' },
      ];

      const encoded = encodeChat(messages, { model: 'gpt-4o' });
      const counted = countChatCompletionTokens({ messages, model: 'gpt-4o' });

      // Both include assistant priming (3 tokens)
      expect(encoded.length).toBe(counted.totalTokens);
    });

    it('token count matches for user with name', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello!', name: 'alice' },
      ];

      const encoded = encodeChat(messages, { model: 'gpt-4o' });
      const counted = countChatCompletionTokens({ messages, model: 'gpt-4o' });

      expect(encoded.length).toBe(counted.totalTokens);
    });

    it('token count matches for function role message', () => {
      const messages: ChatMessage[] = [
        { role: 'function', content: '{"temp": 72}', name: 'get_weather' },
      ];

      const encoded = encodeChat(messages, { model: 'gpt-4o' });
      const counted = countChatCompletionTokens({ messages, model: 'gpt-4o' });

      expect(encoded.length).toBe(counted.totalTokens);
    });

    it('function_call messages have expected overhead difference from countChatCompletionTokens', () => {
      // Note: countChatCompletionTokens includes FUNCTION_CALL_METADATA_TOKEN_OVERHEAD (3)
      // which represents API-level overhead, not actual ChatML tokens.
      // encodeChat produces the actual ChatML token sequence.
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: null,
          function_call: { name: 'get_weather', arguments: '{"location":"NYC"}' },
        },
      ];

      const encoded = encodeChat(messages, { model: 'gpt-4o' });
      const counted = countChatCompletionTokens({ messages, model: 'gpt-4o' });

      // encodeChat is 2 tokens less because:
      // - countChatCompletionTokens adds FUNCTION_CALL_METADATA_TOKEN_OVERHEAD (3)
      // - encodeChat adds 1 token for newline between name and arguments
      // Net difference: 3 - 1 = 2
      const FUNCTION_CALL_METADATA_OVERHEAD = 3;
      const NEWLINE_TOKEN = 1;
      expect(encoded.length).toBe(
        counted.totalTokens - FUNCTION_CALL_METADATA_OVERHEAD + NEWLINE_TOKEN
      );
    });

    it('token count matches for cl100k_base encoding', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the weather like today?' },
      ];

      const encoded = encodeChat(messages, { model: 'gpt-4' });
      const counted = countChatCompletionTokens({ messages, model: 'gpt-4' });

      expect(encoded.length).toBe(counted.totalTokens);
    });

    it('token count matches for complex multi-turn conversation', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '2+2 equals 4.' },
        { role: 'user', content: 'And 3+3?' },
        { role: 'assistant', content: '3+3 equals 6.' },
        { role: 'user', content: 'Thanks!' },
      ];

      const encoded = encodeChat(messages, { model: 'gpt-4o' });
      const counted = countChatCompletionTokens({ messages, model: 'gpt-4o' });

      expect(encoded.length).toBe(counted.totalTokens);
    });
  });

  describe('edge cases', () => {
    it('handles empty content string', () => {
      const tokens = encodeChat(
        [{ role: 'user', content: '' }],
        { model: 'gpt-4o', primeAssistant: false }
      );

      // Should still have special tokens even with empty content
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('handles null content', () => {
      const tokens = encodeChat(
        [{ role: 'assistant', content: null }],
        { model: 'gpt-4o', primeAssistant: false }
      );

      // Should still have special tokens even with null content
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('handles undefined content', () => {
      const tokens = encodeChat(
        [{ role: 'assistant' }],
        { model: 'gpt-4o', primeAssistant: false }
      );

      // Should still have special tokens even with undefined content
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('handles very long content', () => {
      const longContent = 'Hello '.repeat(1000);
      const tokens = encodeChat(
        [{ role: 'user', content: longContent }],
        { model: 'gpt-4o', primeAssistant: false }
      );

      expect(tokens.length).toBeGreaterThan(1000);
    });

    it('handles unicode content', () => {
      const tokens = encodeChat(
        [{ role: 'user', content: '你好世界 👋 مرحبا' }],
        { model: 'gpt-4o', primeAssistant: false }
      );

      expect(tokens.length).toBeGreaterThan(0);
    });

    it('handles newlines in content', () => {
      const tokens = encodeChat(
        [{ role: 'user', content: 'Line 1\nLine 2\nLine 3' }],
        { model: 'gpt-4o', primeAssistant: false }
      );

      const decoded = decode(tokens, { encoding: 'o200k_base' });
      expect(decoded).toContain('Line 1\nLine 2\nLine 3');
    });
  });
});
