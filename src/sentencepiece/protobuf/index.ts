/**
 * Protobuf parsing module for SentencePiece .model files
 */

export { parseModelProto } from './decoder.js';
export type {
  ModelProto,
  SentencePiece,
  TrainerSpec,
  NormalizerSpec,
  SelfTestData,
} from './schema.js';
export {
  SentencePieceType,
  ModelType,
  createDefaultTrainerSpec,
  createDefaultNormalizerSpec,
} from './schema.js';
