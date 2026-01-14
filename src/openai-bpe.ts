import { createRequire } from 'node:module';

import { ALL_SPECIAL_TOKENS } from 'gpt-tokenizer/constants';
import { DEFAULT_ENCODING, modelToEncodingMap } from 'gpt-tokenizer/mapping';

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

type EncodingApi = {
  encode: (text: string, options?: GptTokenizerEncodeOptions) => number[];
  decode: (tokens: Iterable<number>) => string;
};

// `__filename` exists in CJS output, but not in ESM.
// `import.meta.url` exists in ESM output, but is not available in CJS.
// Use whichever is available at runtime.
declare const __filename: string | undefined;
const requireBase =
  typeof __filename === 'string' && __filename.length > 0
    ? __filename
    : import.meta.url;
const NODE_REQUIRE = createRequire(requireBase);

const ENCODING_MODULES: Record<OpenAIEncoding, string> = {
  r50k_base: 'gpt-tokenizer/cjs/encoding/r50k_base',
  p50k_base: 'gpt-tokenizer/cjs/encoding/p50k_base',
  p50k_edit: 'gpt-tokenizer/cjs/encoding/p50k_edit',
  cl100k_base: 'gpt-tokenizer/cjs/encoding/cl100k_base',
  o200k_base: 'gpt-tokenizer/cjs/encoding/o200k_base',
  o200k_harmony: 'gpt-tokenizer/cjs/encoding/o200k_harmony',
};

const encodingApiCache = new Map<OpenAIEncoding, EncodingApi>();

function getEncodingApi(encoding: OpenAIEncoding): EncodingApi {
  const cached = encodingApiCache.get(encoding);
  if (cached) return cached;

  const modulePath = ENCODING_MODULES[encoding];
  const mod = NODE_REQUIRE(modulePath) as { encode: EncodingApi['encode']; decode: EncodingApi['decode'] };

  const api: EncodingApi = { encode: mod.encode, decode: mod.decode };
  encodingApiCache.set(encoding, api);
  return api;
}

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

/**
 * Resolve the OpenAI encoding that will be used for a given model/encoding selector.
 */
export function getOpenAIEncoding(
  selector?: Pick<EncodeOptions, 'encoding' | 'model'>
): OpenAIEncoding {
  return resolveEncoding(selector);
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
  const api = getEncodingApi(encoding);
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
  const api = getEncodingApi(encoding);
  return api.decode(tokens);
}
