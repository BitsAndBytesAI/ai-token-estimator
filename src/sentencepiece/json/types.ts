/**
 * HuggingFace tokenizer.json Type Definitions
 */

/**
 * HuggingFace tokenizer.json config structure
 */
export interface HFTokenizerConfig {
  version?: string;
  model: HFModel;
  normalizer?: HFNormalizer;
  pre_tokenizer?: HFPreTokenizer;
  decoder?: HFDecoder;
  added_tokens?: HFAddedToken[];
}

export interface HFModel {
  type: string;
  vocab?: Record<string, number> | Array<[string, number]>;
  merges?: string[];
  unk_token?: string;
  byte_fallback?: boolean;
  continuing_subword_prefix?: string;
  end_of_word_suffix?: string;
}

export interface HFNormalizer {
  type: string;
  normalizers?: HFNormalizer[];
  left?: boolean;
  right?: boolean;
  pattern?: HFPattern;
  content?: string;
}

export type HFPattern = { String: string } | { Regex: string } | string;

export interface HFPreTokenizer {
  type: string;
  pretokenizers?: HFPreTokenizer[];
  replacement?: string;
  add_prefix_space?: boolean;
}

export interface HFDecoder {
  type: string;
  decoders?: HFDecoder[];
  replacement?: string;
  add_prefix_space?: boolean;
}

export interface HFAddedToken {
  id: number;
  content: string;
  special: boolean;
  lstrip?: boolean;
  rstrip?: boolean;
  single_word?: boolean;
  normalized?: boolean;
}
