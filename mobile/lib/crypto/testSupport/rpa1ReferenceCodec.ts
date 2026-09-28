/**
 * Test-only reference implementation of RPA1 (see `../rpa1Format.ts`'s docstring for
 * why this exists and what it does and doesn't prove). Uses Node's built-in `crypto`
 * (available under Jest's `testEnvironment: 'node'`, see `jest.config.js`) for the
 * primitives `rpa1Format.ts` deliberately doesn't provide: SHA-256, HKDF-SHA256 and
 * AES-256-GCM seal/open. This file is NEVER imported by app runtime code or by
 * `modules/rpa-crypto` — it exists solely so `rpa1.test.ts` can exercise the full
 * encode -> encrypt -> corrupt -> decrypt -> reject pipeline in CI, without a device.
 *
 * (Lives under `testSupport/`, not `__tests__/`, so Jest's `__tests__/**` glob never
 * tries to collect it as a test file in its own right — it has no `it()`/`describe()`
 * blocks, only helpers `rpa1.test.ts` imports.)
 *
 * The real, shipped implementation of this exact algorithm is
 * `modules/rpa-crypto/ios/RpaCryptoModule.swift` (CryptoKit) and
 * `modules/rpa-crypto/android/.../RpaCryptoModule.kt` (`javax.crypto`) — both written
 * to mirror this file's logic step-for-step (see their doc comments), but neither is
 * executable in this sandbox (no Xcode project wiring `ExpoModulesCore`, no Gradle
 * toolchain here — see the mobile-developer status entry for the exact verification
 * gap). Treat this file's test coverage as proof the *design* is sound, not as proof
 * the native binaries are bug-free.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import {
  DEFAULT_CHUNK_SIZE,
  HEADER_LEN,
  KEY_ID_LEN,
  NONCE_LEN,
  RpaFormatError,
  TAG_LEN,
  buildAad,
  decodeHeader,
  deriveNonce,
  encodeHeader,
  planNextChunk,
} from '../rpa1Format';

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(data).digest());
}

/** HKDF-SHA256 (RFC 5869), extract-then-expand, `length` capped at 32 (one HMAC block) — all this format needs. */
function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array {
  if (length > 32) throw new RangeError('This reference codec only supports length <= 32');
  const prk = hmacSha256(salt, ikm);
  const infoBytes = new TextEncoder().encode(info);
  const t1 = hmacSha256(prk, new Uint8Array([...infoBytes, 0x01]));
  return t1.slice(0, length);
}

export function computeKeyId(installKey: Uint8Array): Uint8Array {
  return sha256(installKey).slice(0, KEY_ID_LEN);
}

function deriveFileKey(installKey: Uint8Array, fileSalt: Uint8Array): Uint8Array {
  return hkdfSha256(installKey, fileSalt, 'RPA1-file-key', 32);
}

export interface EncryptResult {
  header: Uint8Array;
  chunkSize: number;
}

/** Encrypts `plaintext` into a full RPA1 byte buffer (header + chunk records). */
export function encryptToRpa1(
  plaintext: Uint8Array,
  installKey: Uint8Array,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Uint8Array {
  const fileSalt = randomBytes(16);
  const keyId = computeKeyId(installKey);
  const header = encodeHeader({ keyId, chunkSize, fileSalt });
  const headerHash = sha256(header);
  const fileKey = deriveFileKey(installKey, fileSalt);

  const records: Uint8Array[] = [header];
  let offset = 0;
  let chunkIndex = 0;
  // Encoder rule (rpa1Format.ts docstring): read up to chunkSize bytes per iteration;
  // the chunk read at end-of-source is final, whether full or short (or empty).
  while (true) {
    const remainingPlaintext = plaintext.length - offset;
    const isFinal = remainingPlaintext <= chunkSize;
    const take = isFinal ? remainingPlaintext : chunkSize;
    const chunkPlaintext = plaintext.slice(offset, offset + take);
    offset += take;

    const nonce = deriveNonce(fileSalt, chunkIndex);
    const aad = buildAad(headerHash, chunkIndex, isFinal);
    const cipher = createCipheriv('aes-256-gcm', fileKey, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(chunkPlaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    records.push(nonce, new Uint8Array(ciphertext), new Uint8Array(tag));

    chunkIndex += 1;
    if (isFinal) break;
  }

  return concatUint8Arrays(records);
}

/**
 * Decrypts an RPA1 buffer, mirroring `rpa1Format.ts`'s `planNextChunk` boundary rule
 * exactly. Throws `RpaFormatError` with the specific `code` for every failure mode the
 * spec calls out: bad magic, unsupported version/algorithm, key mismatch (before ever
 * attempting a decrypt — a wrong key can't even reach GCM), truncation (structural,
 * detected without decrypting anything), and auth failure (GCM tag mismatch — covers
 * both tampering and a truncation that lands mid-chunk rather than at a clean
 * boundary).
 */
export function decryptRpa1(fileBytes: Uint8Array, installKey: Uint8Array): Uint8Array {
  if (fileBytes.length < HEADER_LEN) {
    throw new RpaFormatError('E_RPA1_TRUNCATED', `File is ${fileBytes.length} bytes, need at least the header`);
  }
  const header = fileBytes.slice(0, HEADER_LEN);
  const fields = decodeHeader(header); // throws E_RPA1_BAD_MAGIC / E_RPA1_UNSUPPORTED_*
  const headerHash = sha256(header);

  const expectedKeyId = computeKeyId(installKey);
  if (!timingSafeEqual(fields.keyId, expectedKeyId)) {
    throw new RpaFormatError(
      'E_RPA1_KEY_MISMATCH',
      'This file was encrypted with a different install key (reinstall or key loss)',
    );
  }

  const fileKey = deriveFileKey(installKey, fields.fileSalt);

  const plaintextParts: Uint8Array[] = [];
  let offset = HEADER_LEN;
  let chunkIndex = 0;
  let sawFinal = false;

  while (offset < fileBytes.length) {
    const remaining = fileBytes.length - offset;
    const { isFinal, cipherLen } = planNextChunk(remaining, fields.chunkSize); // throws E_RPA1_TRUNCATED
    const recordLen = NONCE_LEN + cipherLen + TAG_LEN;
    if (offset + recordLen > fileBytes.length) {
      throw new RpaFormatError('E_RPA1_TRUNCATED', 'Chunk record runs past end of file');
    }
    const nonce = fileBytes.slice(offset, offset + NONCE_LEN);
    const ciphertext = fileBytes.slice(offset + NONCE_LEN, offset + NONCE_LEN + cipherLen);
    const tag = fileBytes.slice(offset + NONCE_LEN + cipherLen, offset + recordLen);
    const aad = buildAad(headerHash, chunkIndex, isFinal);

    try {
      const decipher = createDecipheriv('aes-256-gcm', fileKey, nonce);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      plaintextParts.push(new Uint8Array(plaintext));
    } catch {
      // Node throws a generic Error on a bad auth tag ("Unsupported state or unable to
      // authenticate data") — normalize to the format's own typed error.
      throw new RpaFormatError('E_RPA1_AUTH_FAILED', `GCM authentication failed at chunk ${chunkIndex}`);
    }

    offset += recordLen;
    chunkIndex += 1;
    sawFinal = isFinal;
  }

  if (!sawFinal) {
    // Reached EOF without ever consuming a chunk marked final — the file ends exactly
    // on a non-final chunk boundary, i.e. the true final chunk is missing entirely.
    throw new RpaFormatError('E_RPA1_TRUNCATED', 'File ends before a final chunk was written');
  }

  return concatUint8Arrays(plaintextParts);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
