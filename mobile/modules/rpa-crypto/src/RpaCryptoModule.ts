import { NativeModule, requireNativeModule } from 'expo';

/**
 * Raw native binding only — untyped-error, snake-of-promises surface exactly as the
 * Swift/Kotlin `AsyncFunction`s expose it. `../index.ts` is the module the rest of the
 * app imports; it wraps every one of these calls with `RpaCryptoError` mapping and the
 * app-facing (camelCase, already-native-matching) types in `./RpaCrypto.types`.
 */
declare class RpaCryptoNativeModule extends NativeModule<Record<string, never>> {
  generateInstallKeyBase64(): Promise<string>;

  encryptFile(
    srcUri: string,
    dstUri: string,
    installKeyBase64: string,
    chunkSize: number,
  ): Promise<{ keyIdHex: string; chunkSize: number; totalChunks: number; plaintextSize: number }>;

  decryptFile(
    srcUri: string,
    dstUri: string,
    installKeyBase64: string,
  ): Promise<{ plaintextSize: number }>;

  readHeaderInfo(
    uri: string,
  ): Promise<{ version: number; algorithmId: number; keyIdHex: string; chunkSize: number }>;

  /**
   * Best-effort: excludes the file at `uri` from iCloud/Finder (iOS) or equivalent (n/a on
   * Android, where FBE already covers at-rest device storage — see the architect's
   * writeup, status.md 2026-09-26T12:08:20Z, §1's "honest note on the premise"). Returns
   * `true` on success, `false` if the platform/OS declined but didn't throw. Never throws
   * for "unsupported on this platform" — only for a genuine I/O error reading the file.
   */
  excludeFromBackup(uri: string): Promise<boolean>;
}

export default requireNativeModule<RpaCryptoNativeModule>('RpaCrypto');
