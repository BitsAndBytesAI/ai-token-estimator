/**
 * Chat-aware tokenization using ChatML format.
 *
 * Encodes chat messages into exact token IDs including special message
 * delimiter tokens (<|im_start|>, <|im_sep|>, <|im_end|>).
 */

import { encode, getOpenAIEncoding } from './openai-bpe.js';
import type { OpenAIEncoding } from './bpe/types.js';
import type { ChatMessage } from './types.js';

/**
 * Options for encodeChat.
 */
export interface EncodeChatOptions {
  /**
   * OpenAI model ID used to select the appropriate encoding.
   * Note: Non-OpenAI models (claude-*, gemini-*) are rejected.
   */
  model?: string;
  /**
   * Explicit OpenAI encoding override.
   * When provided, this takes precedence over `model`.
   */
  encoding?: OpenAIEncoding;
  /**
   * Prime the output with the start of an assistant response.
   * When true (default), appends <|im_start|>assistant<|im_sep|> at the end.
   * Set to false to get just the messages without assistant priming.
   */
  primeAssistant?: boolean;
}

/**
 * ChatML special token IDs by encoding.
 */
const CHAT_TOKENS: Record<
  string,
  { imStart: number; imEnd: number; imSep: number }
> = {
  cl100k_base: { imStart: 100264, imEnd: 100265, imSep: 100266 },
  o200k_base: { imStart: 200264, imEnd: 200265, imSep: 200266 },
};

/**
 * Harmony format tokens (o200k_harmony uses different special tokens).
 */
const HARMONY_TOKENS = {
  start: 200006,
  end: 200007,
  message: 200008,
};

/**
 * Encode chat messages into token IDs using ChatML format.
 *
 * Returns the exact token sequence that OpenAI models expect for chat
 * completions, including special delimiter tokens.
 *
 * @param messages - Array of chat messages
 * @param options - Encoding options
 * @returns Token IDs representing the chat prompt
 *
 * @example
 * ```typescript
 * const tokens = encodeChat([
 *   { role: 'system', content: 'You are helpful.' },
 *   { role: 'user', content: 'Hello!' }
 * ], { model: 'gpt-4o' });
 * ```
 */
export function encodeChat(
  messages: ChatMessage[],
  options?: EncodeChatOptions
): number[] {
  const { model, encoding: encodingOverride, primeAssistant = true } =
    options ?? {};

  // Validate non-OpenAI models
  validateChatModel(model);

  // Resolve encoding
  const encoding =
    encodingOverride ?? (model ? getOpenAIEncoding({ model }) : 'o200k_base');

  // Get chat tokens for this encoding
  const chatTokens = getChatTokens(encoding);
  if (!chatTokens) {
    throw new Error(
      `Encoding "${encoding}" does not support chat format. ` +
        'Use cl100k_base or o200k_base for chat models.'
    );
  }

  const { imStart, imEnd, imSep } = chatTokens;
  const tokens: number[] = [];

  // Encode each message
  for (const message of messages) {
    validateMessage(message);

    // <|im_start|>
    tokens.push(imStart);

    // Role string depends on message type:
    // - function role: use name directly (not "function:name")
    // - other roles with name: use "role:name"
    // - other roles without name: use "role"
    let roleStr: string;
    if (message.role === 'function' && message.name) {
      roleStr = message.name;
    } else if (message.name) {
      roleStr = `${message.role}:${message.name}`;
    } else {
      roleStr = message.role;
    }
    tokens.push(...encode(roleStr, { encoding, allowSpecial: 'none' }));

    // <|im_sep|>
    tokens.push(imSep);

    // content
    if (message.content) {
      tokens.push(
        ...encode(message.content, { encoding, allowSpecial: 'none' })
      );
    }

    // function_call (for assistant messages)
    if (message.function_call) {
      const fcContent = formatFunctionCall(message.function_call);
      tokens.push(...encode(fcContent, { encoding, allowSpecial: 'none' }));
    }

    // <|im_end|>
    tokens.push(imEnd);
  }

  // Prime with assistant response start
  if (primeAssistant) {
    tokens.push(imStart);
    tokens.push(...encode('assistant', { encoding, allowSpecial: 'none' }));
    tokens.push(imSep);
  }

  return tokens;
}

/**
 * Validate that the model is not a known non-OpenAI model.
 */
function validateChatModel(model: string | undefined): void {
  if (!model) return;

  if (model.startsWith('claude-')) {
    throw new Error(
      `Model "${model}" is an Anthropic model. encodeChat only supports OpenAI models.`
    );
  }
  if (model.startsWith('gemini-')) {
    throw new Error(
      `Model "${model}" is a Google model. encodeChat only supports OpenAI models.`
    );
  }
}

/**
 * Validate message for supported features.
 */
function validateMessage(message: ChatMessage): void {
  const msgAny = message as unknown as Record<string, unknown>;

  // Reject tools API
  if ('tool_calls' in msgAny && msgAny.tool_calls !== undefined) {
    throw new Error(
      'tool_calls is not supported. Use function_call with the legacy functions API.'
    );
  }
  if ('tool_call_id' in msgAny && msgAny.tool_call_id !== undefined) {
    throw new Error(
      'tool_call_id is not supported. Use the legacy functions API.'
    );
  }

  // Validate content type
  if (
    message.content !== null &&
    message.content !== undefined &&
    typeof message.content !== 'string'
  ) {
    throw new Error(
      'Multimodal content (arrays) is not supported. Only text content is supported.'
    );
  }
}

/**
 * Get ChatML token IDs for an encoding.
 */
function getChatTokens(
  encoding: OpenAIEncoding
): { imStart: number; imEnd: number; imSep: number } | null {
  // o200k_harmony uses different token names
  if (encoding === 'o200k_harmony') {
    return {
      imStart: HARMONY_TOKENS.start,
      imEnd: HARMONY_TOKENS.end,
      imSep: HARMONY_TOKENS.message,
    };
  }

  return CHAT_TOKENS[encoding] ?? null;
}

/**
 * Format function_call for encoding.
 */
function formatFunctionCall(fc: { name: string; arguments: string }): string {
  // Match OpenAI's internal format: name followed by arguments
  const parts: string[] = [];
  if (fc.name) parts.push(fc.name);
  if (fc.arguments) parts.push(fc.arguments);
  return parts.join('\n');
}
