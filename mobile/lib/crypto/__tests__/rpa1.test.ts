import { randomBytes } from 'node:crypto';
import { CHUNK_OVERHEAD, HEADER_LEN, RpaFormatError, decodeHeader, encodeHeader, planNextChunk } from '../rpa1Format';
import { computeKeyId, decryptRpa1, encryptToRpa1 } from '../testSupport/rpa1ReferenceCodec';

const KEY_A = new Uint8Array(randomBytes(32));
const KEY_B = new Uint8Array(randomBytes(32));

function text(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('RPA1 header byte layout', () => {
  it('round-trips every field exactly', () => {
    const keyId = new Uint8Array(randomBytes(8));
    const fileSalt = new Uint8Array(randomBytes(16));
    const header = encodeHeader({ keyId, chunkSize: 262144, fileSalt });
    expect(header.length).toBe(HEADER_LEN);

    const decoded = decodeHeader(header);
    expect(decoded.version).toBe(1);
    expect(decoded.algorithmId).toBe(1);
    expect(Array.from(decoded.keyId)).toEqual(Array.from(keyId));
    expect(decoded.chunkSize).toBe(262144);
    expect(Array.from(decoded.fileSalt)).toEqual(Array.from(fileSalt));
  });

  it('rejects a buffer shorter than the header', () => {
    expect(() => decodeHeader(new Uint8Array(10))).toThrow(RpaFormatError);
    try {
      decodeHeader(new Uint8Array(10));
    } catch (err) {
      expect((err as RpaFormatError).code).toBe('E_RPA1_TRUNCATED');
    }
  });

  it('rejects wrong magic bytes', () => {
    const header = encodeHeader({ keyId: new Uint8Array(8), chunkSize: 1024, fileSalt: new Uint8Array(16) });
    header[0] = 0x00;
    expect(() => decodeHeader(header)).toThrow(expect.objectContaining({ code: 'E_RPA1_BAD_MAGIC' }));
  });

  it('rejects an unsupported version', () => {
    const header = encodeHeader({ keyId: new Uint8Array(8), chunkSize: 1024, fileSalt: new Uint8Array(16) });
    header[4] = 99;
    expect(() => decodeHeader(header)).toThrow(expect.objectContaining({ code: 'E_RPA1_UNSUPPORTED_VERSION' }));
  });

  it('rejects an unsupported algorithm id', () => {
    const header = encodeHeader({ keyId: new Uint8Array(8), chunkSize: 1024, fileSalt: new Uint8Array(16) });
    header[5] = 7;
    expect(() => decodeHeader(header)).toThrow(expect.objectContaining({ code: 'E_RPA1_UNSUPPORTED_ALGORITHM' }));
  });
});

describe('planNextChunk boundary rule', () => {
  const chunkSize = 100;
  const full = chunkSize + CHUNK_OVERHEAD;

  it('classifies more-than-one-record-left as non-final, full chunk', () => {
    const plan = planNextChunk(full + CHUNK_OVERHEAD, chunkSize);
    expect(plan.isFinal).toBe(false);
    expect(plan.cipherLen).toBe(chunkSize);
  });

  it('classifies exactly-one-full-record-left as final (exact chunk boundary)', () => {
    const plan = planNextChunk(full, chunkSize);
    expect(plan.isFinal).toBe(true);
    expect(plan.cipherLen).toBe(chunkSize);
  });

  it('classifies a short trailing record as final with the short length', () => {
    const plan = planNextChunk(CHUNK_OVERHEAD + 5, chunkSize);
    expect(plan.isFinal).toBe(true);
    expect(plan.cipherLen).toBe(5);
  });

  it('classifies a zero-length final chunk (empty plaintext) as final', () => {
    const plan = planNextChunk(CHUNK_OVERHEAD, chunkSize);
    expect(plan.isFinal).toBe(true);
    expect(plan.cipherLen).toBe(0);
  });

  it('throws E_RPA1_TRUNCATED when fewer bytes remain than nonce+tag alone', () => {
    expect(() => planNextChunk(CHUNK_OVERHEAD - 1, chunkSize)).toThrow(
      expect.objectContaining({ code: 'E_RPA1_TRUNCATED' }),
    );
  });
});

describe('RPA1 encrypt/decrypt round trip (reference codec)', () => {
  it('recovers the exact original bytes for ordinary content', () => {
    const plaintext = text('the quick brown fox jumps over the lazy dog, 42 times.');
    const encrypted = encryptToRpa1(plaintext, KEY_A, 16); // small chunk size to force many chunks
    const decrypted = decryptRpa1(encrypted, KEY_A);
    expect(Buffer.from(decrypted).toString()).toBe(Buffer.from(plaintext).toString());
  });

  it('recovers exact bytes for empty plaintext', () => {
    const encrypted = encryptToRpa1(new Uint8Array(0), KEY_A, 16);
    const decrypted = decryptRpa1(encrypted, KEY_A);
    expect(decrypted.length).toBe(0);
  });

  it('recovers exact bytes when plaintext is an exact multiple of the chunk size', () => {
    const plaintext = new Uint8Array(randomBytes(48)); // exactly 3 chunks of 16
    const encrypted = encryptToRpa1(plaintext, KEY_A, 16);
    const decrypted = decryptRpa1(encrypted, KEY_A);
    expect(Buffer.from(decrypted)).toEqual(Buffer.from(plaintext));
  });

  it('recovers exact bytes for a multi-chunk payload at the default chunk size', () => {
    const plaintext = new Uint8Array(randomBytes(3 * 1024 * 1024 + 777)); // 3MB+, odd remainder, 12+ chunks
    const encrypted = encryptToRpa1(plaintext, KEY_A);
    const decrypted = decryptRpa1(encrypted, KEY_A);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('the ciphertext is not the plaintext, and is high-entropy (proof it is real encryption, not a rename)', () => {
    // A realistic "half-decent compressed audio" stand-in: repetitive plaintext, which
    // would show through obviously if this were XOR/rename/base64 instead of AEAD.
    const plaintext = new Uint8Array(64 * 1024).fill(0x41); // 64KB of 'A'
    const encrypted = encryptToRpa1(plaintext, KEY_A);
    // No 64-byte run of the plaintext byte should survive into the ciphertext region.
    const cipherRegion = encrypted.slice(HEADER_LEN);
    let longestRun = 0;
    let run = 0;
    for (const byte of cipherRegion) {
      run = byte === 0x41 ? run + 1 : 0;
      longestRun = Math.max(longestRun, run);
    }
    expect(longestRun).toBeLessThan(16);
    expect(Buffer.from(encrypted).includes(Buffer.from(plaintext.slice(0, 4096)))).toBe(false);
  });
});

describe('RPA1 tamper / corruption detection — "half-written file never plays as garbage"', () => {
  it('rejects a file truncated mid-final-chunk', () => {
    const plaintext = new Uint8Array(randomBytes(1000));
    const encrypted = encryptToRpa1(plaintext, KEY_A, 64);
    const truncated = encrypted.slice(0, encrypted.length - 5); // drop the last 5 bytes of the tag
    expect(() => decryptRpa1(truncated, KEY_A)).toThrow(
      expect.objectContaining({ code: expect.stringMatching(/E_RPA1_(TRUNCATED|AUTH_FAILED)/) }),
    );
  });

  it('rejects a file with the true final chunk missing entirely (cut at a clean chunk boundary)', () => {
    const plaintext = new Uint8Array(randomBytes(200)); // 200 > 64, so >1 chunk at chunkSize 64
    const encrypted = encryptToRpa1(plaintext, KEY_A, 64);
    const firstRecordEnd = HEADER_LEN + (64 + CHUNK_OVERHEAD); // header + exactly one full non-final record
    const cutAtBoundary = encrypted.slice(0, firstRecordEnd);
    // The remaining-bytes count left after truncation (exactly one record's worth) is
    // structurally indistinguishable from "one short final record", so `planNextChunk`
    // reads it as final and the AAD's final-flag (0 at encrypt time, 1 as reconstructed
    // here) no longer matches what was authenticated — GCM's tag check catches it
    // instead of the structural check. Either code is an acceptable outcome: both mean
    // decryption is refused, never a silent partial/garbage result.
    expect(() => decryptRpa1(cutAtBoundary, KEY_A)).toThrow(
      expect.objectContaining({ code: expect.stringMatching(/^E_RPA1_(TRUNCATED|AUTH_FAILED)$/) }),
    );
  });

  it('rejects a file with only the header and nothing else', () => {
    const plaintext = new Uint8Array(randomBytes(100));
    const encrypted = encryptToRpa1(plaintext, KEY_A, 64);
    const headerOnly = encrypted.slice(0, HEADER_LEN);
    expect(() => decryptRpa1(headerOnly, KEY_A)).toThrow(
      expect.objectContaining({ code: 'E_RPA1_TRUNCATED' }),
    );
  });

  it('rejects a single flipped ciphertext byte anywhere in the stream (GCM auth failure)', () => {
    const plaintext = new Uint8Array(randomBytes(500));
    const encrypted = encryptToRpa1(plaintext, KEY_A, 64);
    const tampered = new Uint8Array(encrypted);
    tampered[HEADER_LEN + 20] ^= 0xff; // flip a byte inside the first chunk's ciphertext
    expect(() => decryptRpa1(tampered, KEY_A)).toThrow(expect.objectContaining({ code: 'E_RPA1_AUTH_FAILED' }));
  });

  it('rejects two valid files with their chunk records spliced together (no cross-file chunk replay)', () => {
    const fileOne = encryptToRpa1(text('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), KEY_A, 16);
    const fileTwo = encryptToRpa1(text('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), KEY_A, 16);
    // Graft file two's first chunk record onto file one's header.
    const firstRecordLen = 16 + CHUNK_OVERHEAD;
    const spliced = new Uint8Array(HEADER_LEN + firstRecordLen);
    spliced.set(fileOne.slice(0, HEADER_LEN), 0);
    spliced.set(fileTwo.slice(HEADER_LEN, HEADER_LEN + firstRecordLen), HEADER_LEN);
    expect(() => decryptRpa1(spliced, KEY_A)).toThrow(expect.objectContaining({ code: 'E_RPA1_AUTH_FAILED' }));
  });
});

describe('RPA1 key-loss detection — "degrades to re-download, never a crash"', () => {
  it('throws a distinguishable E_RPA1_KEY_MISMATCH when decrypting with the wrong install key', () => {
    const plaintext = new Uint8Array(randomBytes(300));
    const encrypted = encryptToRpa1(plaintext, KEY_A, 64);
    expect(() => decryptRpa1(encrypted, KEY_B)).toThrow(expect.objectContaining({ code: 'E_RPA1_KEY_MISMATCH' }));
  });

  it('key-id mismatch is detected before any GCM operation runs (cheap, no partial decrypt output)', () => {
    // A key mismatch must never partially succeed and hand back a mix of garbage and
    // real audio — assert the thrown error is exactly E_RPA1_KEY_MISMATCH, not
    // E_RPA1_AUTH_FAILED (which would mean it tried to decrypt with the wrong key
    // instead of refusing up front).
    const plaintext = new Uint8Array(randomBytes(10 * 1024));
    const encrypted = encryptToRpa1(plaintext, KEY_A);
    expect.assertions(2);
    try {
      decryptRpa1(encrypted, KEY_B);
    } catch (err) {
      expect(err).toBeInstanceOf(RpaFormatError);
      expect((err as RpaFormatError).code).toBe('E_RPA1_KEY_MISMATCH');
    }
  });

  it('computeKeyId is stable for the same key and differs across keys', () => {
    expect(Array.from(computeKeyId(KEY_A))).toEqual(Array.from(computeKeyId(KEY_A)));
    expect(Array.from(computeKeyId(KEY_A))).not.toEqual(Array.from(computeKeyId(KEY_B)));
  });
});
