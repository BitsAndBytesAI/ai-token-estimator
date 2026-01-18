/**
 * SentencePiece ModelProto decoder
 * Parses .model files (protobuf format)
 */

import {
  readTag,
  readLengthDelimited,
  readVarint,
  readInt32Varint,
  readFloat,
  readString,
  readBytes,
  skipField,
  WIRE_VARINT,
  WIRE_LENGTH_DELIMITED,
  WIRE_32BIT,
} from './wire.js';
import type {
  ModelProto,
  SentencePiece,
  TrainerSpec,
  NormalizerSpec,
  SelfTestData,
} from './schema.js';
import {
  SentencePieceType,
  ModelType,
  createDefaultTrainerSpec,
  createDefaultNormalizerSpec,
} from './schema.js';

/**
 * Parse a SentencePiece .model file
 */
export function parseModelProto(buffer: Uint8Array): ModelProto {
  const model: ModelProto = { pieces: [] };
  let offset = 0;

  while (offset < buffer.length) {
    const tag = readTag(buffer, offset);
    offset += tag.bytesRead;

    switch (tag.fieldNumber) {
      case 1: {
        // pieces (repeated SentencePiece)
        const { data, bytesRead } = readLengthDelimited(buffer, offset);
        model.pieces.push(parseSentencePiece(data));
        offset += bytesRead;
        break;
      }
      case 2: {
        // trainer_spec
        const { data, bytesRead } = readLengthDelimited(buffer, offset);
        model.trainerSpec = parseTrainerSpec(data);
        offset += bytesRead;
        break;
      }
      case 3: {
        // normalizer_spec
        const { data, bytesRead } = readLengthDelimited(buffer, offset);
        model.normalizerSpec = parseNormalizerSpec(data);
        offset += bytesRead;
        break;
      }
      case 4: {
        // self_test_data
        const { data, bytesRead } = readLengthDelimited(buffer, offset);
        model.selfTestData = parseSelfTestData(data);
        offset += bytesRead;
        break;
      }
      case 5: {
        // denormalizer_spec
        const { data, bytesRead } = readLengthDelimited(buffer, offset);
        model.denormalizerSpec = parseNormalizerSpec(data);
        offset += bytesRead;
        break;
      }
      default:
        // Skip unknown fields
        offset += skipField(buffer, offset, tag.wireType);
    }
  }

  // Apply defaults if specs weren't present
  if (!model.trainerSpec) {
    model.trainerSpec = createDefaultTrainerSpec();
    model.trainerSpec.vocabSize = model.pieces.length;
  }
  if (!model.normalizerSpec) {
    model.normalizerSpec = createDefaultNormalizerSpec();
  }

  return model;
}

function parseSentencePiece(buffer: Uint8Array): SentencePiece {
  const piece: SentencePiece = { piece: '', score: 0, type: SentencePieceType.NORMAL };
  let offset = 0;

  while (offset < buffer.length) {
    const tag = readTag(buffer, offset);
    offset += tag.bytesRead;

    switch (tag.fieldNumber) {
      case 1: {
        // piece (string)
        const { value, bytesRead } = readString(buffer, offset);
        piece.piece = value;
        offset += bytesRead;
        break;
      }
      case 2: {
        // score (float)
        if (tag.wireType === WIRE_32BIT) {
          piece.score = readFloat(buffer, offset);
          offset += 4;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 3: {
        // type (enum as varint)
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          piece.type = value as SentencePieceType;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      default:
        offset += skipField(buffer, offset, tag.wireType);
    }
  }

  return piece;
}

function parseTrainerSpec(buffer: Uint8Array): TrainerSpec {
  const spec = createDefaultTrainerSpec();
  let offset = 0;

  while (offset < buffer.length) {
    const tag = readTag(buffer, offset);
    offset += tag.bytesRead;

    switch (tag.fieldNumber) {
      case 1: {
        // input (repeated string) - skip, not needed for inference
        offset += skipField(buffer, offset, tag.wireType);
        break;
      }
      case 2: {
        // input_format (string) - skip
        offset += skipField(buffer, offset, tag.wireType);
        break;
      }
      case 3: {
        // model_prefix (string) - skip
        offset += skipField(buffer, offset, tag.wireType);
        break;
      }
      case 4: {
        // model_type
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          spec.modelType = value as ModelType;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 5: {
        // vocab_size
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          spec.vocabSize = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 35: {
        // byte_fallback
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          spec.byteFallback = value !== 0;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 25: {
        // split_digits
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          spec.splitDigits = value !== 0;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 22: {
        // split_by_whitespace
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          spec.splitByWhitespace = value !== 0;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 21: {
        // split_by_unicode_script
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          spec.splitByUnicodeScript = value !== 0;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 31: {
        // treat_whitespace_as_suffix
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          spec.treatWhitespaceAsSuffix = value !== 0;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 40: {
        // unk_id (int32, can be -1 for unset)
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readInt32Varint(buffer, offset);
          spec.unkId = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 41: {
        // bos_id (int32, can be -1 for unset)
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readInt32Varint(buffer, offset);
          spec.bosId = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 42: {
        // eos_id (int32, can be -1 for unset)
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readInt32Varint(buffer, offset);
          spec.eosId = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 43: {
        // pad_id (int32, can be -1 for unset)
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readInt32Varint(buffer, offset);
          spec.padId = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 44: {
        // unk_piece
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const { value, bytesRead } = readString(buffer, offset);
          spec.unkPiece = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 45: {
        // bos_piece
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const { value, bytesRead } = readString(buffer, offset);
          spec.bosPiece = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 46: {
        // eos_piece
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const { value, bytesRead } = readString(buffer, offset);
          spec.eosPiece = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 47: {
        // pad_piece
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const { value, bytesRead } = readString(buffer, offset);
          spec.padPiece = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 20: {
        // max_sentencepiece_length
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          spec.maxSentencepieceLength = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      default:
        offset += skipField(buffer, offset, tag.wireType);
    }
  }

  return spec;
}

function parseNormalizerSpec(buffer: Uint8Array): NormalizerSpec {
  const spec = createDefaultNormalizerSpec();
  let offset = 0;

  while (offset < buffer.length) {
    const tag = readTag(buffer, offset);
    offset += tag.bytesRead;

    switch (tag.fieldNumber) {
      case 1: {
        // name
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const { value, bytesRead } = readString(buffer, offset);
          spec.name = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 2: {
        // precompiled_charsmap
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const { value, bytesRead } = readBytes(buffer, offset);
          spec.precompiledCharsmap = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 3: {
        // add_dummy_prefix
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          spec.addDummyPrefix = value !== 0;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 4: {
        // remove_extra_whitespaces
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          spec.removeExtraWhitespaces = value !== 0;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 5: {
        // escape_whitespaces
        if (tag.wireType === WIRE_VARINT) {
          const { value, bytesRead } = readVarint(buffer, offset);
          spec.escapeWhitespaces = value !== 0;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 6: {
        // normalization_rule_tsv
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const { value, bytesRead } = readString(buffer, offset);
          spec.normalizationRuleTsv = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      default:
        offset += skipField(buffer, offset, tag.wireType);
    }
  }

  return spec;
}

function parseSelfTestData(buffer: Uint8Array): SelfTestData {
  const data: SelfTestData = { samples: [] };
  let offset = 0;

  while (offset < buffer.length) {
    const tag = readTag(buffer, offset);
    offset += tag.bytesRead;

    switch (tag.fieldNumber) {
      case 1: {
        // samples (repeated SelfTestSample)
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const { data: sampleData, bytesRead } = readLengthDelimited(buffer, offset);
          data.samples.push(parseSelfTestSample(sampleData));
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      default:
        offset += skipField(buffer, offset, tag.wireType);
    }
  }

  return data;
}

function parseSelfTestSample(buffer: Uint8Array): { input: string; expected: string } {
  let input = '';
  let expected = '';
  let offset = 0;

  while (offset < buffer.length) {
    const tag = readTag(buffer, offset);
    offset += tag.bytesRead;

    switch (tag.fieldNumber) {
      case 1: {
        // input
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const { value, bytesRead } = readString(buffer, offset);
          input = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      case 2: {
        // expected
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const { value, bytesRead } = readString(buffer, offset);
          expected = value;
          offset += bytesRead;
        } else {
          offset += skipField(buffer, offset, tag.wireType);
        }
        break;
      }
      default:
        offset += skipField(buffer, offset, tag.wireType);
    }
  }

  return { input, expected };
}
