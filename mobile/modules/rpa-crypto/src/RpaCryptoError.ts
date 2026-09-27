import type { RpaErrorCode } from './RpaCrypto.types';

/**
 * Split out from `../index.ts` (which also imports the real native binding at module
 * scope) so that consumers who only need the *type* of error a failed crypto call throws
 * — e.g. `lib/downloads/downloadManager.ts`'s `catch` branches, or a test that wants to
 * construct one without ever touching `requireNativeModule('RpaCrypto')` — can import it
 * without pulling in (and, under Jest, needing to mock) the native module resolution.
 */
export class RpaCryptoError extends Error {
  readonly code: RpaErrorCode;

  constructor(code: RpaErrorCode, message: string) {
    super(message);
    this.name = 'RpaCryptoError';
    this.code = code;
  }
}
