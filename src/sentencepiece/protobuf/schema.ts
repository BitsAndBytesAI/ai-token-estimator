/**
 * SentencePiece protobuf schema types
 * Based on sentencepiece_model.proto
 */

export interface ModelProto {
  pieces: SentencePiece[];
  trainerSpec?: TrainerSpec;
  normalizerSpec?: NormalizerSpec;
  selfTestData?: SelfTestData;
  denormalizerSpec?: NormalizerSpec;
}

export interface SentencePiece {
  piece: string;
  score: number;
  type: SentencePieceType;
}

export enum SentencePieceType {
  NORMAL = 1,
  UNKNOWN = 2,
  CONTROL = 3,
  USER_DEFINED = 4,
  UNUSED = 5,
  BYTE = 6,
}

export interface TrainerSpec {
  modelType: ModelType;
  vocabSize: number;
  byteFallback: boolean;
  splitDigits: boolean;
  splitByWhitespace: boolean;
  splitByUnicodeScript: boolean;
  treatWhitespaceAsSuffix: boolean;
  unkId: number;
  bosId: number;
  eosId: number;
  padId: number;
  unkPiece: string;
  bosPiece: string;
  eosPiece: string;
  padPiece: string;
  maxSentencepieceLength: number;
}

export enum ModelType {
  UNIGRAM = 1,
  BPE = 2,
  WORD = 3,
  CHAR = 4,
}

export interface NormalizerSpec {
  name: string;
  precompiledCharsmap: Uint8Array;
  addDummyPrefix: boolean;
  removeExtraWhitespaces: boolean;
  escapeWhitespaces: boolean;
  normalizationRuleTsv: string;
}

export interface SelfTestData {
  samples: Array<{ input: string; expected: string }>;
}

/**
 * Default values for TrainerSpec fields
 */
export function createDefaultTrainerSpec(): TrainerSpec {
  return {
    modelType: ModelType.UNIGRAM,
    vocabSize: 0,
    byteFallback: false,
    splitDigits: false,
    splitByWhitespace: true,
    splitByUnicodeScript: true,
    treatWhitespaceAsSuffix: false,
    unkId: 0,
    bosId: 1,
    eosId: 2,
    padId: -1,
    unkPiece: '<unk>',
    bosPiece: '<s>',
    eosPiece: '</s>',
    padPiece: '<pad>',
    maxSentencepieceLength: 16,
  };
}

/**
 * Default values for NormalizerSpec fields
 */
export function createDefaultNormalizerSpec(): NormalizerSpec {
  return {
    name: 'nmt_nfkc',
    precompiledCharsmap: new Uint8Array(0),
    addDummyPrefix: true,
    removeExtraWhitespaces: true,
    escapeWhitespaces: true,
    normalizationRuleTsv: '',
  };
}
