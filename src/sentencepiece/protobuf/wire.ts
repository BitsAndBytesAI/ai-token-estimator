/**
 * Low-level protobuf wire format parser
 * Implements the minimal subset needed for SentencePiece ModelProto parsing
 */

// Wire types
export const WIRE_VARINT = 0;
export const WIRE_64BIT = 1;
export const WIRE_LENGTH_DELIMITED = 2;
export const WIRE_32BIT = 5;

/**
 * Read unsigned varint (LEB128)
 */
export function readVarint(buf: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < buf.length) {
    const byte = buf[offset + bytesRead];
    bytesRead++;
    // For values that fit in 32 bits, use bitwise OR
    // For larger values, we need to handle them differently
    if (shift < 28) {
      value |= (byte & 0x7f) << shift;
    } else if (shift < 35) {
      // For the 5th byte, only low 4 bits can fit in 32-bit int
      value |= (byte & 0x0f) << shift;
    }
    // Bytes beyond 35 bits are ignored for 32-bit values
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 63) {
      throw new Error('Varint too long');
    }
  }

  // Handle negative numbers encoded as large unsigned values (zigzag-style)
  // by converting to unsigned 32-bit
  return { value: value >>> 0, bytesRead };
}

/**
 * Read signed varint (zigzag decoded)
 */
export function readSignedVarint(buf: Uint8Array, offset: number): { value: number; bytesRead: number } {
  const { value: unsigned, bytesRead } = readVarint(buf, offset);
  const value = (unsigned >>> 1) ^ -(unsigned & 1);
  return { value, bytesRead };
}

/**
 * Read int32 varint (standard protobuf encoding, not zigzag)
 * Negative values are encoded as 10-byte varints
 */
export function readInt32Varint(buf: Uint8Array, offset: number): { value: number; bytesRead: number } {
  const { value, bytesRead } = readVarint(buf, offset);
  // Convert unsigned to signed int32
  return { value: value | 0, bytesRead };
}

/**
 * Read field tag (field number + wire type)
 */
export function readTag(buf: Uint8Array, offset: number): { fieldNumber: number; wireType: number; bytesRead: number } {
  const { value, bytesRead } = readVarint(buf, offset);
  return {
    fieldNumber: value >>> 3,
    wireType: value & 0x7,
    bytesRead,
  };
}

/**
 * Read length-delimited field (returns sub-buffer)
 * @throws Error if the length would exceed the buffer bounds
 */
export function readLengthDelimited(buf: Uint8Array, offset: number): { data: Uint8Array; bytesRead: number } {
  const { value: length, bytesRead: lenBytes } = readVarint(buf, offset);
  const dataStart = offset + lenBytes;
  const dataEnd = dataStart + length;

  // Bounds check: ensure the length-delimited data doesn't exceed buffer
  if (dataEnd > buf.length) {
    throw new Error(
      `Length-delimited field exceeds buffer bounds: offset=${offset}, length=${length}, bufferLength=${buf.length}`
    );
  }

  const data = buf.subarray(dataStart, dataEnd);
  return { data, bytesRead: lenBytes + length };
}

/**
 * Read float (32-bit IEEE 754, little-endian)
 * @throws Error if there aren't enough bytes in the buffer
 */
export function readFloat(buf: Uint8Array, offset: number): number {
  if (offset + 4 > buf.length) {
    throw new Error(`Buffer underflow reading float: offset=${offset}, bufferLength=${buf.length}`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  return view.getFloat32(0, true); // little-endian
}

/**
 * Read double (64-bit IEEE 754, little-endian)
 * @throws Error if there aren't enough bytes in the buffer
 */
export function readDouble(buf: Uint8Array, offset: number): number {
  if (offset + 8 > buf.length) {
    throw new Error(`Buffer underflow reading double: offset=${offset}, bufferLength=${buf.length}`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
  return view.getFloat64(0, true); // little-endian
}

/**
 * Read fixed32 (32-bit unsigned integer, little-endian)
 * @throws Error if there aren't enough bytes in the buffer
 */
export function readFixed32(buf: Uint8Array, offset: number): number {
  if (offset + 4 > buf.length) {
    throw new Error(`Buffer underflow reading fixed32: offset=${offset}, bufferLength=${buf.length}`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  return view.getUint32(0, true); // little-endian
}

/**
 * Read fixed64 as bigint (64-bit unsigned integer, little-endian)
 * @throws Error if there aren't enough bytes in the buffer
 */
export function readFixed64(buf: Uint8Array, offset: number): bigint {
  if (offset + 8 > buf.length) {
    throw new Error(`Buffer underflow reading fixed64: offset=${offset}, bufferLength=${buf.length}`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
  const lo = view.getUint32(0, true);
  const hi = view.getUint32(4, true);
  return BigInt(lo) | (BigInt(hi) << 32n);
}

/**
 * Read string (UTF-8 encoded, length-delimited)
 */
export function readString(buf: Uint8Array, offset: number): { value: string; bytesRead: number } {
  const { data, bytesRead } = readLengthDelimited(buf, offset);
  const value = new TextDecoder().decode(data);
  return { value, bytesRead };
}

/**
 * Read bytes (length-delimited, returns Uint8Array)
 */
export function readBytes(buf: Uint8Array, offset: number): { value: Uint8Array; bytesRead: number } {
  const { data, bytesRead } = readLengthDelimited(buf, offset);
  // Return a copy to avoid issues with the underlying buffer
  const value = new Uint8Array(data.length);
  value.set(data);
  return { value, bytesRead };
}

/**
 * Skip a field based on wire type
 * @throws Error if there aren't enough bytes in the buffer
 */
export function skipField(buf: Uint8Array, offset: number, wireType: number): number {
  switch (wireType) {
    case WIRE_VARINT: {
      const { bytesRead } = readVarint(buf, offset);
      return bytesRead;
    }
    case WIRE_64BIT:
      if (offset + 8 > buf.length) {
        throw new Error(`Buffer underflow skipping 64-bit field: offset=${offset}, bufferLength=${buf.length}`);
      }
      return 8;
    case WIRE_LENGTH_DELIMITED: {
      const { bytesRead } = readLengthDelimited(buf, offset);
      return bytesRead;
    }
    case WIRE_32BIT:
      if (offset + 4 > buf.length) {
        throw new Error(`Buffer underflow skipping 32-bit field: offset=${offset}, bufferLength=${buf.length}`);
      }
      return 4;
    default:
      throw new Error(`Unknown wire type: ${wireType}`);
  }
}
