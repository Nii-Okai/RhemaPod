/**
 * Shared TS types for the `rpa-crypto` local Expo module (plan W4.5 / GATE M9).
 * See `mobile/lib/crypto/rpa1Format.ts` for the full RPA1 format spec this module
 * implements natively, and `ios/RpaCryptoModule.swift` / `android/.../RpaCryptoModule.kt`
 * for the two platform implementations these types describe the JS-visible surface of.
 */

/**
 * Every failure mode the native implementations can report, mirrored exactly on both
 * platforms (see each `RpaError`/`RpaException` call site). `E_RPA1_UNKNOWN` is a JS-side
 * fallback only — never thrown natively — for a rejection that didn't carry a recognized
 * `code` (e.g. an out-of-memory kill, or a future native error path this wrapper doesn't
 * know about yet), so a caller's `switch` on `code` is always exhaustive without a
 * native/JS version-skew crash.
 */
export type RpaErrorCode =
  | 'E_RPA1_BAD_MAGIC'
  | 'E_RPA1_UNSUPPORTED_VERSION'
  | 'E_RPA1_UNSUPPORTED_ALGORITHM'
  | 'E_RPA1_TRUNCATED'
  | 'E_RPA1_KEY_MISMATCH'
  | 'E_RPA1_AUTH_FAILED'
  | 'E_RPA1_IO'
  | 'E_RPA1_UNKNOWN';

export interface RpaEncryptResult {
  /** Hex-encoded 8-byte key id — a short hash of the install key used, for bookkeeping only. */
  keyIdHex: string;
  chunkSize: number;
  totalChunks: number;
  plaintextSize: number;
}

export interface RpaDecryptResult {
  plaintextSize: number;
}

export interface RpaHeaderInfo {
  version: number;
  algorithmId: number;
  keyIdHex: string;
  chunkSize: number;
}
