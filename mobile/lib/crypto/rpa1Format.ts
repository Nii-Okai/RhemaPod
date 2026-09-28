/**
 * RPA1 — the on-disk format for encrypted offline audio downloads (plan W4.5 / GATE M9).
 * Full spec ruling: `status.md`, architect entry 2026-09-26T12:08:20Z ("RPA1 chunked
 * AES-256-GCM"), locked by Isaac's GATE M9 crossing (2026-09-27T20:05:00Z) with no
 * changes from that writeup.
 *
 * This module is the byte-layout half of the spec ONLY: header encode/decode, the AAD
 * a chunk is bound to, per-chunk nonce derivation, and the chunk-boundary/final-chunk
 * rule. It is deliberately pure — no file I/O, no crypto primitive (no AES, no HKDF, no
 * SHA-256) — so it is trivially unit-testable in Jest with zero native-module mocking.
 *
 * The actual AES-256-GCM sealing/opening and the HKDF-SHA256 per-file key derivation
 * happen entirely inside the local native module (`modules/rpa-crypto`, CryptoKit on
 * iOS / `javax.crypto` on Android) — never in JS, and never over the RN bridge one
 * chunk at a time (that would mean either whole-file base64 round-trips or hundreds of
 * bridge crossings per file; the architect's writeup's whole reason for a *native*
 * module was file-to-file, constant-memory streaming). This file's byte-layout
 * functions exist so:
 *   (a) `lib/crypto/__tests__/rpa1ReferenceCodec.ts` (test-only, Node `crypto`-backed)
 *       can prove the *design* is watertight — round-trip correctness, corruption at
 *       any offset rejected, a missing/short final chunk rejected, wrong magic
 *       rejected — entirely in Jest, without a real device.
 *   (b) `modules/rpa-crypto`'s Swift/Kotlin implementations have one unambiguous,
 *       reviewable byte layout to match line-for-line (see doc comments there).
 * Neither app runtime code nor the native module's JS wrapper (`modules/rpa-crypto/index.ts`)
 * imports this file — the native module owns its own copy of these constants natively,
 * and the app never needs to construct or parse an RPA1 header in JS at all (see that
 * module's docstring for why: a single `decryptFile` call already reports the
 * distinguishing failure modes as typed error codes, so JS never needs to peek inside
 * the format to react to "key lost" vs "corrupt" vs "truncated").
 */

export const MAGIC = 'RPA1';
export const MAGIC_BYTES = new Uint8Array([0x52, 0x50, 0x41, 0x31]); // ASCII "RPA1"
export const FORMAT_VERSION = 1;
export const ALGORITHM_AES_256_GCM = 1;

export const MAGIC_LEN = 4;
export const VERSION_LEN = 1;
export const ALGORITHM_LEN = 1;
export const KEY_ID_LEN = 8;
export const CHUNK_SIZE_FIELD_LEN = 4; // big-endian uint32
export const FILE_SALT_LEN = 16;

export const HEADER_LEN =
  MAGIC_LEN + VERSION_LEN + ALGORITHM_LEN + KEY_ID_LEN + CHUNK_SIZE_FIELD_LEN + FILE_SALT_LEN; // 34

export const NONCE_LEN = 12;
export const TAG_LEN = 16;
/** Per-chunk on-disk overhead: nonce + tag, wrapping the (possibly zero-length) ciphertext. */
export const CHUNK_OVERHEAD = NONCE_LEN + TAG_LEN; // 28

/** Default plaintext chunk size — 256 KiB, per the architect's writeup. */
export const DEFAULT_CHUNK_SIZE = 256 * 1024;

export class RpaFormatError extends Error {
  readonly code:
    | 'E_RPA1_BAD_MAGIC'
    | 'E_RPA1_UNSUPPORTED_VERSION'
    | 'E_RPA1_UNSUPPORTED_ALGORITHM'
    | 'E_RPA1_TRUNCATED'
    | 'E_RPA1_KEY_MISMATCH'
    | 'E_RPA1_AUTH_FAILED';

  constructor(code: RpaFormatError['code'], message: string) {
    super(message);
    this.name = 'RpaFormatError';
    this.code = code;
  }
}

export interface RpaHeaderFields {
  version: number;
  algorithmId: number;
  /** 8 raw bytes — a short hash of the per-install key, so a reinstall/key-loss is detectable pre-decrypt. */
  keyId: Uint8Array;
  /** Plaintext bytes per chunk (the *last* chunk may be shorter — never longer). */
  chunkSize: number;
  /** 16 random bytes, unique per file — the HKDF salt and (combined with chunk index) the nonce source. */
  fileSalt: Uint8Array;
}

function writeUint32BE(value: number, out: Uint8Array, offset: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0
  );
}

/** Encodes the 34-byte RPA1 header. `keyId` must be exactly 8 bytes, `fileSalt` exactly 16. */
export function encodeHeader(fields: Omit<RpaHeaderFields, 'version' | 'algorithmId'>): Uint8Array {
  if (fields.keyId.length !== KEY_ID_LEN) {
    throw new RangeError(`keyId must be ${KEY_ID_LEN} bytes, got ${fields.keyId.length}`);
  }
  if (fields.fileSalt.length !== FILE_SALT_LEN) {
    throw new RangeError(`fileSalt must be ${FILE_SALT_LEN} bytes, got ${fields.fileSalt.length}`);
  }
  const out = new Uint8Array(HEADER_LEN);
  let offset = 0;
  out.set(MAGIC_BYTES, offset);
  offset += MAGIC_LEN;
  out[offset] = FORMAT_VERSION;
  offset += VERSION_LEN;
  out[offset] = ALGORITHM_AES_256_GCM;
  offset += ALGORITHM_LEN;
  out.set(fields.keyId, offset);
  offset += KEY_ID_LEN;
  writeUint32BE(fields.chunkSize, out, offset);
  offset += CHUNK_SIZE_FIELD_LEN;
  out.set(fields.fileSalt, offset);
  return out;
}

/**
 * Decodes and validates a 34-byte RPA1 header. Throws `RpaFormatError` with a specific
 * `code` for every distinguishable failure — this is what lets the download manager
 * turn "the file on disk doesn't match this format" into the right user-facing state
 * (corrupt vs. unsupported vs, at the key-id-comparison call site, key-loss) instead of
 * a single generic failure.
 */
export function decodeHeader(buf: Uint8Array): RpaHeaderFields {
  if (buf.length < HEADER_LEN) {
    throw new RpaFormatError('E_RPA1_TRUNCATED', `Header is ${buf.length} bytes, need ${HEADER_LEN}`);
  }
  let offset = 0;
  for (let i = 0; i < MAGIC_LEN; i++) {
    if (buf[offset + i] !== MAGIC_BYTES[i]) {
      throw new RpaFormatError('E_RPA1_BAD_MAGIC', 'Not an RPA1 file (bad magic bytes)');
    }
  }
  offset += MAGIC_LEN;
  const version = buf[offset];
  offset += VERSION_LEN;
  if (version !== FORMAT_VERSION) {
    throw new RpaFormatError('E_RPA1_UNSUPPORTED_VERSION', `Unsupported RPA1 version ${version}`);
  }
  const algorithmId = buf[offset];
  offset += ALGORITHM_LEN;
  if (algorithmId !== ALGORITHM_AES_256_GCM) {
    throw new RpaFormatError('E_RPA1_UNSUPPORTED_ALGORITHM', `Unsupported algorithm id ${algorithmId}`);
  }
  const keyId = buf.slice(offset, offset + KEY_ID_LEN);
  offset += KEY_ID_LEN;
  const chunkSize = readUint32BE(buf, offset);
  offset += CHUNK_SIZE_FIELD_LEN;
  const fileSalt = buf.slice(offset, offset + FILE_SALT_LEN);
  return { version, algorithmId, keyId, chunkSize, fileSalt };
}

/**
 * AAD for one chunk: binds the ciphertext to *this file's header* (so a chunk can
 * never be replayed against a different file's stream) plus its own position and
 * finality (so truncation, reordering and chunk-splicing all break authentication).
 * Mirrors Tink's streaming-AEAD construction, per the architect's writeup.
 *
 * `headerHash` is the 32-byte SHA-256 of the file's own 34-byte header.
 */
export function buildAad(headerHash: Uint8Array, chunkIndex: number, isFinal: boolean): Uint8Array {
  if (headerHash.length !== 32) {
    throw new RangeError(`headerHash must be 32 bytes (SHA-256), got ${headerHash.length}`);
  }
  const out = new Uint8Array(32 + 4 + 1);
  out.set(headerHash, 0);
  writeUint32BE(chunkIndex, out, 32);
  out[36] = isFinal ? 1 : 0;
  return out;
}

/**
 * Deterministic per-chunk nonce: 4-byte big-endian chunk index, then the file salt's
 * last 8 bytes. No separate nonce material needs to be generated or stored — the file
 * salt (already in the header, already unique per file and used for HKDF) plus the
 * chunk index is enough to guarantee (key, nonce) is never reused: the derived file key
 * is unique per file (HKDF over the salt), and the index is unique within one file.
 */
export function deriveNonce(fileSalt: Uint8Array, chunkIndex: number): Uint8Array {
  if (fileSalt.length !== FILE_SALT_LEN) {
    throw new RangeError(`fileSalt must be ${FILE_SALT_LEN} bytes, got ${fileSalt.length}`);
  }
  const out = new Uint8Array(NONCE_LEN);
  writeUint32BE(chunkIndex, out, 0);
  out.set(fileSalt.slice(FILE_SALT_LEN - 8), 4);
  return out;
}

/**
 * The chunk-boundary rule both the encoder and decoder must follow, stated once so
 * there is exactly one place a byte-layout ambiguity could hide.
 *
 * Encoding: read up to `chunkSize` plaintext bytes per iteration; the chunk read at
 * end-of-source (whether it came back full or short) is `isFinal`.
 *
 * Decoding, from `remainingBytes` (file bytes left after the header and any prior
 * chunks) and the header's `chunkSize`: a record is final exactly when
 * `remainingBytes <= chunkSize + CHUNK_OVERHEAD` (there provably cannot be a
 * subsequent record if this one consumes everything that's left even at full size).
 * Otherwise it's a full, non-final chunk of exactly `chunkSize` plaintext bytes.
 *
 * This single rule is what makes "last chunk happens to be exactly `chunkSize` bytes"
 * unambiguous in both directions — see `rpa1.test.ts`'s
 * "plaintext exactly N whole chunks" case.
 */
export function planNextChunk(
  remainingBytes: number,
  chunkSize: number,
): { isFinal: boolean; cipherLen: number } {
  const fullRecordSize = chunkSize + CHUNK_OVERHEAD;
  if (remainingBytes <= fullRecordSize) {
    const cipherLen = remainingBytes - CHUNK_OVERHEAD;
    if (cipherLen < 0) {
      throw new RpaFormatError(
        'E_RPA1_TRUNCATED',
        `Final record too short: ${remainingBytes} bytes left, need at least ${CHUNK_OVERHEAD}`,
      );
    }
    return { isFinal: true, cipherLen };
  }
  return { isFinal: false, cipherLen: chunkSize };
}
