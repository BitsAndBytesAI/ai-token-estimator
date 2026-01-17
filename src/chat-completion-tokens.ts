/**
 * Chat completion token counting for OpenAI's legacy functions API.
 *
 * Achieves exact token count parity for normal text inputs.
 * Note: special token handling treats special-token-like strings
 * as regular text (does not throw).
 */

import {
  isChatModel,
  isAnthropicModel,
  isGoogleModel,
} from './mappings/chat-models.js';
import { isKnownModel } from './mappings/model-to-encoding.js';
import {
  MESSAGE_TOKEN_OVERHEAD,
  MESSAGE_NAME_TOKEN_OVERHEAD,
  FUNCTION_ROLE_TOKEN_DISCOUNT,
  COMPLETION_REQUEST_TOKEN_OVERHEAD,
  FUNCTION_CALL_METADATA_TOKEN_OVERHEAD,
  FUNCTION_CALL_NAME_TOKEN_OVERHEAD,
  FUNCTION_CALL_NONE_TOKEN_OVERHEAD,
  FUNCTION_DEFINITION_TOKEN_OVERHEAD,
  SYSTEM_FUNCTION_TOKEN_DEDUCTION,
} from './chat-token-constants.js';
import { formatFunctionDefinitions } from './function-formatting.js';
import { encode, getOpenAIEncoding } from './openai-bpe.js';
import type { OpenAIEncoding } from './openai-bpe.js';
import type {
  ChatMessage,
  ChatCompletionTokenCountInput,
  ChatCompletionTokenCountOutput,
} from './types.js';

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate that the input doesn't use tools API features.
 */
function validateNoToolsApi(input: ChatCompletionTokenCountInput): void {
  const inputAny = input as unknown as Record<string, unknown>;
  if ('tools' in inputAny && inputAny.tools !== undefined) {
    throw new Error(
      'Tools API is not yet supported. Use the legacy functions API, ' +
        'or see package documentation for tools API roadmap.'
    );
  }
  if ('tool_choice' in inputAny && inputAny.tool_choice !== undefined) {
    throw new Error(
      'tool_choice is not yet supported. Use function_call with the legacy functions API.'
    );
  }
}

/** Valid roles for legacy functions API */
const VALID_ROLES = new Set(['system', 'user', 'assistant', 'function']);

/**
 * Validate that messages don't contain unsupported content types or roles.
 */
function validateMessages(messages: ChatMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgAny = msg as unknown as Record<string, unknown>;

    // Validate role is one of the supported types
    if (!VALID_ROLES.has(msg.role)) {
      throw new Error(
        `messages[${i}].role: Invalid role "${msg.role}". ` +
          'Supported roles are: system, user, assistant, function.'
      );
    }

    // Validate content is string | null | undefined
    const content = msg.content;
    if (content !== undefined && content !== null && typeof content !== 'string') {
      if (Array.isArray(content)) {
        throw new Error(
          `messages[${i}].content: Multimodal content (arrays) is not supported. ` +
            'Only text content (string) is supported.'
        );
      }
      throw new Error(
        `messages[${i}].content: Expected string | null | undefined, ` +
          `got ${typeof content}. Only text content is supported.`
      );
    }

    // Check for tool_calls or tool_call_id (only if defined, not just present)
    if ('tool_calls' in msgAny && msgAny.tool_calls !== undefined) {
      throw new Error(
        `messages[${i}]: tool_calls is not yet supported. Use the legacy functions API.`
      );
    }
    if ('tool_call_id' in msgAny && msgAny.tool_call_id !== undefined) {
      throw new Error(
        `messages[${i}]: tool_call_id is not yet supported. Use the legacy functions API.`
      );
    }
  }
}

/**
 * Validate that the model is a supported OpenAI chat model.
 * Even with encoding override, rejects known non-OpenAI and non-chat models.
 */
function validateOpenAIModel(
  model: string,
  encodingOverride?: OpenAIEncoding
): void {
  // Always reject known non-OpenAI models (even with encoding override)
  if (isAnthropicModel(model)) {
    throw new Error(
      `Model "${model}" is an Anthropic model. Use the Anthropic API's ` +
        'count_tokens endpoint via estimateAsync() for accurate token counts.'
    );
  }
  if (isGoogleModel(model)) {
    throw new Error(
      `Model "${model}" is a Google model. Use the Gemini API's ` +
        'countTokens endpoint via estimateAsync() for accurate token counts.'
    );
  }

  // Always reject known non-chat OpenAI models (even with encoding override)
  if (isKnownModel(model) && !isChatModel(model)) {
    throw new Error(
      `Model "${model}" is not a chat completion model. ` +
        'This function only supports chat models (e.g., gpt-4o, gpt-3.5-turbo).'
    );
  }

  // If encoding override provided, allow unrecognized models
  if (encodingOverride) {
    return;
  }

  // Without encoding override, require model to be a known chat model
  if (!isChatModel(model)) {
    throw new Error(
      `Model "${model}" is not recognized. ` +
        'If this is a new OpenAI model, provide the encoding option explicitly ' +
        '(e.g., encoding: "o200k_base").'
    );
  }
}

// =============================================================================
// Internal Helpers
// =============================================================================

interface MessageTokenResult {
  stringTokens: number;
  overhead: number;
  total: number;
}

/**
 * Count tokens for a single message.
 */
function countMessageTokensInternal(
  message: ChatMessage,
  countStringTokens: (text: string) => number
): MessageTokenResult {
  let stringTokens = 0;
  let overhead = MESSAGE_TOKEN_OVERHEAD;

  // Role
  if (message.role) {
    stringTokens += countStringTokens(message.role);
  }

  // Content
  if (message.content) {
    stringTokens += countStringTokens(message.content);
  }

  // Name
  if (message.name) {
    stringTokens += countStringTokens(message.name);
    overhead += MESSAGE_NAME_TOKEN_OVERHEAD;
  }

  // Function call (in assistant message)
  if (message.function_call) {
    if (message.function_call.name) {
      stringTokens += countStringTokens(message.function_call.name);
    }
    if (message.function_call.arguments) {
      stringTokens += countStringTokens(message.function_call.arguments);
    }
    overhead += FUNCTION_CALL_METADATA_TOKEN_OVERHEAD;
  }

  // Function role discount
  if (message.role === 'function') {
    overhead -= FUNCTION_ROLE_TOKEN_DISCOUNT;
  }

  return {
    stringTokens,
    overhead,
    total: stringTokens + overhead,
  };
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Count tokens for an OpenAI chat completion request with legacy functions API.
 *
 * Achieves exact token count parity with OpenAI's actual API usage.
 *
 * @throws {Error} If model is not an OpenAI model (unless encoding override provided)
 * @throws {Error} If tools, tool_choice, tool_calls, or tool_call_id are present
 * @throws {Error} If any message has non-string content (arrays, numbers, objects)
 *
 * @example
 * ```typescript
 * const result = countChatCompletionTokens({
 *   messages: [
 *     { role: 'system', content: 'You are a helpful assistant.' },
 *     { role: 'user', content: 'Hello!' }
 *   ],
 *   model: 'gpt-4o',
 *   functions: [{
 *     name: 'get_weather',
 *     description: 'Get weather for a location',
 *     parameters: {
 *       type: 'object',
 *       properties: {
 *         location: { type: 'string', description: 'City name' }
 *       }
 *     }
 *   }]
 * });
 *
 * console.log(result.totalTokens);
 * ```
 */
export function countChatCompletionTokens(
  input: ChatCompletionTokenCountInput
): ChatCompletionTokenCountOutput {
  const { messages, model, functions, function_call, includeBreakdown } = input;
  const encodingOverride = input.encoding;

  // 1. Validate: reject unsupported features
  validateNoToolsApi(input);
  validateMessages(messages);
  validateOpenAIModel(model, encodingOverride);

  // 2. Resolve encoding and create token counter
  const resolvedEncoding: OpenAIEncoding =
    encodingOverride ?? getOpenAIEncoding({ model });
  const countStringTokens = (text: string): number => {
    if (!text) return 0;
    return encode(text, { encoding: resolvedEncoding, allowSpecial: 'none' })
      .length;
  };

  // 3. Determine if functions are present
  const hasFunctions = Boolean(functions && functions.length > 0);

  // 4. Count message tokens
  let messageTokens = 0;
  let hasSystemMessage = false;
  let systemPadded = false;
  const breakdown: NonNullable<ChatCompletionTokenCountOutput['messageBreakdown']> =
    [];

  for (const message of messages) {
    // Handle system message padding when functions present
    let contentToCount = message.content ?? '';
    if (hasFunctions && message.role === 'system' && !systemPadded) {
      if (contentToCount && !contentToCount.endsWith('\n')) {
        contentToCount = contentToCount + '\n';
      }
      systemPadded = true;
    }
    if (message.role === 'system') {
      hasSystemMessage = true;
    }

    // Count tokens for this message
    const msgTokens = countMessageTokensInternal(
      { ...message, content: contentToCount },
      countStringTokens
    );
    messageTokens += msgTokens.total;

    if (includeBreakdown) {
      breakdown.push({
        role: message.role,
        stringTokens: msgTokens.stringTokens,
        overheadTokens: msgTokens.overhead,
        totalTokens: msgTokens.total,
      });
    }
  }

  // 5. Completion request overhead (reply priming) - kept separate
  const completionOverheadTokens = COMPLETION_REQUEST_TOKEN_OVERHEAD;

  // 6. Count function definition tokens
  let functionTokens = 0;
  if (hasFunctions && functions) {
    const formatted = formatFunctionDefinitions(functions);
    functionTokens =
      countStringTokens(formatted) + FUNCTION_DEFINITION_TOKEN_OVERHEAD;

    // Deduct tokens if system message present with functions
    if (hasSystemMessage) {
      functionTokens -= SYSTEM_FUNCTION_TOKEN_DEDUCTION;
    }
  }

  // 7. Count function_call control tokens
  let functionCallTokens = 0;
  if (function_call && function_call !== 'auto') {
    if (function_call === 'none') {
      functionCallTokens = FUNCTION_CALL_NONE_TOKEN_OVERHEAD;
    } else if (typeof function_call === 'object' && function_call.name) {
      functionCallTokens =
        countStringTokens(function_call.name) +
        FUNCTION_CALL_NAME_TOKEN_OVERHEAD;
    }
  }

  // 8. Calculate total
  const totalTokens =
    messageTokens +
    completionOverheadTokens +
    functionTokens +
    functionCallTokens;

  const result: ChatCompletionTokenCountOutput = {
    totalTokens,
    messageTokens,
    completionOverheadTokens,
    functionTokens,
    functionCallTokens,
    exact: true,
    encoding: resolvedEncoding,
  };

  if (includeBreakdown) {
    result.messageBreakdown = breakdown;
  }

  return result;
}
