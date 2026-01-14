import { ALL_SPECIAL_TOKENS } from 'gpt-tokenizer/constants';
import { DEFAULT_ENCODING, modelToEncodingMap } from 'gpt-tokenizer/mapping';

import {
  decode as decodeCl100kBase,
  encode as encodeCl100kBase,
} from 'gpt-tokenizer/encoding/cl100k_base';
import {
  decode as decodeO200kBase,
  encode as encodeO200kBase,
} from 'gpt-tokenizer/encoding/o200k_base';
import {
  decode as decodeO200kHarmony,
  encode as encodeO200kHarmony,
} from 'gpt-tokenizer/encoding/o200k_harmony';
import {
  decode as decodeP50kBase,
  encode as encodeP50kBase,
} from 'gpt-tokenizer/encoding/p50k_base';
import {
  decode as decodeP50kEdit,
  encode as encodeP50kEdit,
} from 'gpt-tokenizer/encoding/p50k_edit';
import {
  decode as decodeR50kBase,
  encode as encodeR50kBase,
} from 'gpt-tokenizer/encoding/r50k_base';

export type OpenAIEncoding =
  | 'r50k_base'
  | 'p50k_base'
  | 'p50k_edit'
  | 'cl100k_base'
  | 'o200k_base'
  | 'o200k_harmony';

export type SpecialTokenHandling = 'all' | 'none' | 'none_raise';

export interface EncodeOptions {
  /**
   * Explicit OpenAI encoding override.
   * When provided, this takes precedence over `model`.
   */
  encoding?: OpenAIEncoding;
  /**
   * OpenAI model ID used to select the appropriate encoding.
   */
  model?: string;
  /**
   * How special tokens are handled.
   * - `none_raise` (default): throw if special tokens appear
   * - `none`: treat special tokens as regular text
   * - `all`: allow special tokens and encode them as special token IDs
   */
  allowSpecial?: SpecialTokenHandling;
}

interface EncodingSelector {
  encoding?: OpenAIEncoding;
  model?: string;
}

type GptTokenizerEncodeOptions = {
  allowedSpecial?: Set<string> | typeof ALL_SPECIAL_TOKENS;
  disallowedSpecial?: Set<string> | typeof ALL_SPECIAL_TOKENS;
};

const ENCODING_APIS: Record<
  OpenAIEncoding,
  {
    encode: (text: string, options?: GptTokenizerEncodeOptions) => number[];
    decode: (tokens: Iterable<number>) => string;
  }
> = {
  r50k_base: { encode: encodeR50kBase, decode: decodeR50kBase },
  p50k_base: { encode: encodeP50kBase, decode: decodeP50kBase },
  p50k_edit: { encode: encodeP50kEdit, decode: decodeP50kEdit },
  cl100k_base: { encode: encodeCl100kBase, decode: decodeCl100kBase },
  o200k_base: { encode: encodeO200kBase, decode: decodeO200kBase },
  o200k_harmony: { encode: encodeO200kHarmony, decode: decodeO200kHarmony },
};

function resolveEncoding(selector: EncodingSelector | undefined): OpenAIEncoding {
  if (selector?.encoding) {
    return selector.encoding;
  }

  const model = selector?.model?.trim();
  if (model) {
    const mapped =
      (modelToEncodingMap as unknown as Record<string, OpenAIEncoding>)[model];
    if (mapped) {
      return mapped;
    }
  }

  return DEFAULT_ENCODING as OpenAIEncoding;
}

function toGptTokenizerEncodeOptions(
  allowSpecial: SpecialTokenHandling | undefined
): GptTokenizerEncodeOptions | undefined {
  const mode: SpecialTokenHandling = allowSpecial ?? 'none_raise';

  switch (mode) {
    case 'all':
      return {
        allowedSpecial: ALL_SPECIAL_TOKENS,
        disallowedSpecial: new Set(),
      };
    case 'none':
      return {
        allowedSpecial: new Set(),
        disallowedSpecial: new Set(),
      };
    case 'none_raise':
    default:
      // Default behavior (tiktoken-style): raise on any special token.
      // gpt-tokenizer defaults disallowedSpecial to ALL_SPECIAL_TOKENS, so we can omit,
      // but return it explicitly for clarity.
      return {
        disallowedSpecial: ALL_SPECIAL_TOKENS,
      };
  }
}

/**
 * Encode text into OpenAI token IDs using tiktoken-compatible BPE encoding.
 *
 * This is exact tokenization for OpenAI models (unlike heuristic estimators).
 */
export function encode(text: string, options?: EncodeOptions): number[] {
  const encoding = resolveEncoding(options);
  const api = ENCODING_APIS[encoding];
  const encodeOptions = toGptTokenizerEncodeOptions(options?.allowSpecial);
  return api.encode(text, encodeOptions);
}

/**
 * Decode OpenAI token IDs into text using tiktoken-compatible BPE encoding.
 */
export function decode(
  tokens: Iterable<number>,
  options?: Pick<EncodeOptions, 'encoding' | 'model'>
): string {
  const encoding = resolveEncoding(options);
  const api = ENCODING_APIS[encoding];
  return api.decode(tokens);
}

