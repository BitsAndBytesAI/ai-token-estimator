/**
 * Tests for generator-based APIs.
 */

import { describe, it, expect } from 'vitest';
import {
  encode,
  encodeGenerator,
  decode,
  decodeGenerator,
  decodeAsyncGenerator,
  encodeChat,
  encodeChatGenerator,
} from '../src/index.js';
import type { ChatMessage } from '../src/types.js';

describe('encodeGenerator', () => {
  it('flattened output equals encode()', () => {
    const text = 'Hello, world! This is a test.';
    const options = { model: 'gpt-4o' };

    const chunks = [...encodeGenerator(text, options)];
    const flattened = chunks.flat();

    expect(flattened).toEqual(encode(text, options));
  });

  it('return value equals total token count', () => {
    const text = 'Hello, world!';
    const options = { model: 'gpt-4o' };

    const gen = encodeGenerator(text, options);
    let result = gen.next();
    while (!result.done) {
      result = gen.next();
    }

    expect(result.value).toBe(encode(text, options).length);
  });

  it('handles special tokens with allowSpecial: all', () => {
    const text = 'Hello <|im_start|> world';
    const options = {
      encoding: 'o200k_base' as const,
      allowSpecial: 'all' as const,
    };

    const chunks = [...encodeGenerator(text, options)];
    const flattened = chunks.flat();

    expect(flattened).toEqual(encode(text, options));
    expect(flattened).toContain(200264); // im_start token
  });

  it('handles empty string (returns 0)', () => {
    const gen = encodeGenerator('', { model: 'gpt-4o' });
    const result = gen.next();

    expect(result.done).toBe(true);
    expect(result.value).toBe(0);
  });

  it('throws on disallowed special tokens', () => {
    // Text with disallowed special token
    const text = 'Hello world <|im_start|>';

    // Should throw when special token is encountered
    // Note: splitOnSpecialTokens is called eagerly, so this throws on first .next()
    expect(() => {
      const gen = encodeGenerator(text, { encoding: 'o200k_base' });
      gen.next();
    }).toThrow(/special token/i);
  });

  it('early termination works for large text without special tokens', () => {
    // Large text - we can stop early
    const text = 'Hello world. '.repeat(1000);

    const gen = encodeGenerator(text, { encoding: 'o200k_base' });
    const first = gen.next();

    // First chunk should succeed
    expect(first.done).toBe(false);
    expect(first.value).toEqual(expect.any(Array));

    // We can choose to stop here without consuming the whole input
    // (demonstrating early termination capability)
  });

  it('handles multi-byte UTF-8 characters', () => {
    const text = '你好世界🌍 Hello';
    const options = { model: 'gpt-4o' };

    const chunks = [...encodeGenerator(text, options)];
    const flattened = chunks.flat();

    expect(flattened).toEqual(encode(text, options));
  });

  it('works with different encodings', () => {
    const text = 'Test text for encoding';

    for (const encoding of ['cl100k_base', 'o200k_base'] as const) {
      const chunks = [...encodeGenerator(text, { encoding })];
      const flattened = chunks.flat();
      expect(flattened).toEqual(encode(text, { encoding }));
    }
  });
});

describe('encodeChatGenerator', () => {
  it('flattened output equals encodeChat()', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello!' },
    ];
    const options = { model: 'gpt-4o' };

    const chunks = [...encodeChatGenerator(messages, options)];
    const flattened = chunks.flat();

    expect(flattened).toEqual(encodeChat(messages, options));
  });

  it('respects primeAssistant: false', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];

    const withPriming = [...encodeChatGenerator(messages, { model: 'gpt-4o' })].flat();
    const withoutPriming = [
      ...encodeChatGenerator(messages, { model: 'gpt-4o', primeAssistant: false }),
    ].flat();

    expect(withPriming).toEqual(encodeChat(messages, { model: 'gpt-4o' }));
    expect(withoutPriming).toEqual(
      encodeChat(messages, { model: 'gpt-4o', primeAssistant: false })
    );
    expect(withPriming.length).toBeGreaterThan(withoutPriming.length);
  });

  it('accepts iterable messages', () => {
    function* messageGen(): Generator<ChatMessage> {
      yield { role: 'user', content: 'Hello' };
      yield { role: 'assistant', content: 'Hi!' };
    }

    const fromArray = encodeChat(
      [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ],
      { model: 'gpt-4o' }
    );
    const fromGenerator = [...encodeChatGenerator(messageGen(), { model: 'gpt-4o' })].flat();

    expect(fromGenerator).toEqual(fromArray);
  });

  it('return value equals total token count', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi!' },
    ];
    const options = { model: 'gpt-4o' };

    const gen = encodeChatGenerator(messages, options);
    let result = gen.next();
    while (!result.done) {
      result = gen.next();
    }

    expect(result.value).toBe(encodeChat(messages, options).length);
  });

  it('handles messages with function_call', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What is the weather?' },
      {
        role: 'assistant',
        content: null,
        function_call: { name: 'get_weather', arguments: '{"location": "NYC"}' },
      },
    ];
    const options = { model: 'gpt-4o' };

    const chunks = [...encodeChatGenerator(messages, options)];
    const flattened = chunks.flat();

    expect(flattened).toEqual(encodeChat(messages, options));
  });

  it('handles messages with name field', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hi', name: 'john' },
      { role: 'assistant', content: 'Hello!' },
    ];
    const options = { model: 'gpt-4o' };

    const chunks = [...encodeChatGenerator(messages, options)];
    const flattened = chunks.flat();

    expect(flattened).toEqual(encodeChat(messages, options));
  });
});

describe('decodeGenerator', () => {
  it('joined output equals decode()', () => {
    const text = 'Hello, world!';
    const tokens = encode(text, { model: 'gpt-4o' });

    const chunks = [...decodeGenerator(tokens, { model: 'gpt-4o' })];
    const joined = chunks.join('');

    expect(joined).toBe(decode(tokens, { model: 'gpt-4o' }));
    expect(joined).toBe(text);
  });

  it('handles multi-byte UTF-8 correctly', () => {
    const text = '你好世界🌍';
    const tokens = encode(text, { model: 'gpt-4o' });

    const chunks = [...decodeGenerator(tokens, { model: 'gpt-4o' })];
    const joined = chunks.join('');

    expect(joined).toBe(text);
  });

  it('may yield empty strings (buffering incomplete UTF-8)', () => {
    // This is expected behavior - not an error
    const text = '🎉';
    const tokens = encode(text, { model: 'gpt-4o' });

    const chunks = [...decodeGenerator(tokens, { model: 'gpt-4o' })];

    // Some chunks may be empty strings - that's OK
    expect(chunks.join('')).toBe(text);
  });

  it('handles empty input', () => {
    const chunks = [...decodeGenerator([], { model: 'gpt-4o' })];
    expect(chunks.join('')).toBe('');
  });

  it('handles special tokens', () => {
    const text = 'Hello <|im_start|> world';
    const tokens = encode(text, { encoding: 'o200k_base', allowSpecial: 'all' });

    const chunks = [...decodeGenerator(tokens, { encoding: 'o200k_base' })];
    const joined = chunks.join('');

    expect(joined).toBe(text);
  });

  it('works with different encodings', () => {
    const text = 'Test text for decoding';

    for (const encoding of ['cl100k_base', 'o200k_base'] as const) {
      const tokens = encode(text, { encoding });
      const chunks = [...decodeGenerator(tokens, { encoding })];
      expect(chunks.join('')).toBe(text);
    }
  });
});

describe('decodeAsyncGenerator', () => {
  it('joined output equals decode() for single tokens', async () => {
    const text = 'Hello!';
    const tokens = encode(text, { model: 'gpt-4o' });

    async function* tokenStream() {
      for (const t of tokens) {
        yield t;
      }
    }

    const chunks: string[] = [];
    for await (const chunk of decodeAsyncGenerator(tokenStream(), { model: 'gpt-4o' })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe(decode(tokens, { model: 'gpt-4o' }));
    expect(chunks.join('')).toBe(text);
  });

  it('joined output equals decode() for token array chunks', async () => {
    const text = 'Hello, world!';
    const tokens = encode(text, { model: 'gpt-4o' });

    async function* chunkStream() {
      yield tokens.slice(0, 2);
      yield tokens.slice(2);
    }

    const chunks: string[] = [];
    for await (const chunk of decodeAsyncGenerator(chunkStream(), { model: 'gpt-4o' })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe(text);
  });

  it('handles mixed number and number[] yields', async () => {
    const text = 'Hi!';
    const tokens = encode(text, { model: 'gpt-4o' });

    async function* mixedStream(): AsyncGenerator<number | number[]> {
      yield tokens[0]; // single number
      yield tokens.slice(1); // array
    }

    const chunks: string[] = [];
    for await (const chunk of decodeAsyncGenerator(mixedStream(), { model: 'gpt-4o' })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe(text);
  });

  it('handles multi-byte UTF-8 correctly', async () => {
    const text = '你好🌍';
    const tokens = encode(text, { model: 'gpt-4o' });

    async function* tokenStream() {
      for (const t of tokens) {
        yield t;
      }
    }

    const chunks: string[] = [];
    for await (const chunk of decodeAsyncGenerator(tokenStream(), { model: 'gpt-4o' })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe(text);
  });

  it('handles empty input', async () => {
    async function* emptyStream(): AsyncGenerator<number> {
      // yields nothing
    }

    const chunks: string[] = [];
    for await (const chunk of decodeAsyncGenerator(emptyStream(), { model: 'gpt-4o' })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('');
  });
});
