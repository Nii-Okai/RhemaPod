import NativeRpaCrypto from './src/RpaCryptoModule';
import type { RpaDecryptResult, RpaEncryptResult, RpaErrorCode, RpaHeaderInfo } from './src/RpaCrypto.types';

export type { RpaDecryptResult, RpaEncryptResult, RpaErrorCode, RpaHeaderInfo };

/** Plaintext bytes per chunk, matching `lib/crypto/rpa1Format.ts`'s `DEFAULT_CHUNK_SIZE`. Not imported from there directly — this module owns no dependency on the app's `lib/`, only the reverse. */
export const DEFAULT_CHUNK_SIZE = 256 * 1024;

const KNOWN_CODES: readonly RpaErrorCode[] = [
  'E_RPA1_BAD_MAGIC',
  'E_RPA1_UNSUPPORTED_VERSION',
  'E_RPA1_UNSUPPORTED_ALGORITHM',
  'E_RPA1_TRUNCATED',
  'E_RPA1_KEY_MISMATCH',
  'E_RPA1_AUTH_FAILED',
  'E_RPA1_IO',
];

export class RpaCryptoError extends Error {
  readonly code: RpaErrorCode;

  constructor(code: RpaErrorCode, message: string) {
    super(message);
    this.name = 'RpaCryptoError';
    this.code = code;
  }
}

/**
 * Normalizes any rejection from the native side into `RpaCryptoError`. Expo Modules
 * attaches the thrown native error's `code` onto the JS rejection (`CodedException` on
 * Android, `CustomNSError`'s `errorUserInfo["code"]` on iOS — see both native files'
 * doc comments), but this is defensive about that contract rather than trusting it
 * blindly: an unrecognized or missing `code` still produces a typed, catchable error
 * (`E_RPA1_UNKNOWN`) instead of leaking a raw, differently-shaped native exception up
 * into app code that only knows how to switch on `RpaErrorCode`.
 */
function toRpaError(err: unknown): RpaCryptoError {
  if (err instanceof RpaCryptoError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const maybeCode = (err as { code?: unknown } | null)?.code;
  const code = typeof maybeCode === 'string' && (KNOWN_CODES as readonly string[]).includes(maybeCode)
    ? (maybeCode as RpaErrorCode)
    : 'E_RPA1_UNKNOWN';
  return new RpaCryptoError(code, message);
}

async function guarded<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    throw toRpaError(err);
  }
}

/** Generates a fresh 32-byte AES-256 key, base64-encoded, from the platform's CSPRNG. Callers persist it in `expo-secure-store` — this module never touches storage (see `lib/downloads/installKey.ts`). */
export function generateInstallKeyBase64(): Promise<string> {
  return guarded(() => NativeRpaCrypto.generateInstallKeyBase64());
}

/**
 * Streams `srcUri` (plaintext) to `dstUri` as an RPA1 file, chunked AES-256-GCM, using a
 * per-file key HKDF-derived from `installKeyBase64`. Writes to `dstUri + '.part'` first
 * and atomically renames on success — a crash or kill mid-encrypt leaves only a stray
 * `.part` file, never a half-written file at `dstUri` (see the native doc comments).
 */
export function encryptFile(
  srcUri: string,
  dstUri: string,
  installKeyBase64: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<RpaEncryptResult> {
  return guarded(() => NativeRpaCrypto.encryptFile(srcUri, dstUri, installKeyBase64, chunkSize));
}

/**
 * Streams `srcUri` (an RPA1 file) to `dstUri` (plaintext), verifying every chunk's GCM
 * tag against the header/index/final-flag AAD. Rejects with a specific `RpaCryptoError`
 * code for every distinguishable failure (bad magic, unsupported version/algorithm, key
 * mismatch — checked before any decrypt runs — truncation, or auth failure) instead of
 * ever handing back partial or garbage plaintext (`lib/downloads/downloadManager.ts`
 * relies on this to implement "half-written file never plays as garbage" and "key loss
 * degrades to re-download, never a crash").
 */
export function decryptFile(srcUri: string, dstUri: string, installKeyBase64: string): Promise<RpaDecryptResult> {
  return guarded(() => NativeRpaCrypto.decryptFile(srcUri, dstUri, installKeyBase64));
}

/** Reads just the 34-byte header, without decrypting anything — used as a cheap post-encrypt sanity check and for future format-version introspection. */
export function readHeaderInfo(uri: string): Promise<RpaHeaderInfo> {
  return guarded(() => NativeRpaCrypto.readHeaderInfo(uri));
}

/**
 * Best-effort backup exclusion (iOS `isExcludedFromBackupKey`; no-op returning `false` on
 * Android). Never throws for "not supported here" — only a genuine I/O error rejects, and
 * even then callers should treat this as advisory, not gate download success on it.
 */
export function excludeFromBackup(uri: string): Promise<boolean> {
  return guarded(() => NativeRpaCrypto.excludeFromBackup(uri));
}
