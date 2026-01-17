/**
 * Token overhead constants from gpt-tokenizer.
 * These are the source of truth for legacy functions API counting.
 *
 * @see https://github.com/niieani/gpt-tokenizer/blob/main/src/functionCalling.ts
 */

/** Tokens added per message (for <|im_start|>, role separator, <|im_end|>) */
export const MESSAGE_TOKEN_OVERHEAD = 3;

/** Additional tokens when message has a 'name' field */
export const MESSAGE_NAME_TOKEN_OVERHEAD = 1;

/** Tokens subtracted for role='function' messages */
export const FUNCTION_ROLE_TOKEN_DISCOUNT = 2;

/** Tokens added for reply priming (<|im_start|>assistant<|im_sep|>) */
export const COMPLETION_REQUEST_TOKEN_OVERHEAD = 3;

/** Tokens added when message contains function_call */
export const FUNCTION_CALL_METADATA_TOKEN_OVERHEAD = 3;

/** Tokens added for function_call: { name: "..." } control */
export const FUNCTION_CALL_NAME_TOKEN_OVERHEAD = 4;

/** Tokens added for function_call: "none" control */
export const FUNCTION_CALL_NONE_TOKEN_OVERHEAD = 1;

/** Tokens added after formatting function definitions as TS namespace */
export const FUNCTION_DEFINITION_TOKEN_OVERHEAD = 9;

/** Tokens subtracted when system message present with functions */
export const SYSTEM_FUNCTION_TOKEN_DEDUCTION = 4;
