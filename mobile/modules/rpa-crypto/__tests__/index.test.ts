/**
 * Unit coverage for the JS-side error-normalization wrapper only (`../index.ts`). The
 * native Swift/Kotlin implementations are NOT exercised here or anywhere in this test
 * suite — no Xcode/Gradle toolchain is available in this sandbox (see the
 * mobile-developer status entry). `../../../lib/crypto/__tests__/rpa1.test.ts` proves the
 * *design* is correct via a Node-`crypto`-backed reference codec; this file proves the
 * *native binding's JS wrapper* correctly turns any shape of native rejection into a
 * typed, exhaustively-switchable `RpaCryptoError`.
 *
 * The mock factory below declares its `jest.fn()`s inline rather than closing over an
 * outer `const` (the outer-`const`-plus-`jest.mock` pattern is a well-known Jest
 * footgun: `jest.mock`'s factory runs the first time the path is required, which — once
 * anything requires it indirectly through another module, as `../index` does through
 * `./src/RpaCryptoModule` — happens before a later `const` in this file has been
 * initialized, silently capturing `undefined`). `lib/query/__tests__/persister.test.tsx`
 * already established this project's convention for the fix: build the mock's state
 * fully inside the factory, and reach it back via `jest.requireMock` when a test needs
 * to configure or assert on it.
 */
import { RpaCryptoError, decryptFile, encryptFile, excludeFromBackup, generateInstallKeyBase64, readHeaderInfo } from '../index';

jest.mock('../src/RpaCryptoModule', () => ({
  __esModule: true,
  default: {
    generateInstallKeyBase64: jest.fn(),
    encryptFile: jest.fn(),
    decryptFile: jest.fn(),
    readHeaderInfo: jest.fn(),
    excludeFromBackup: jest.fn(),
  },
}));

function mockNative() {
  return jest.requireMock('../src/RpaCryptoModule').default as {
    generateInstallKeyBase64: jest.Mock;
    encryptFile: jest.Mock;
    decryptFile: jest.Mock;
    readHeaderInfo: jest.Mock;
    excludeFromBackup: jest.Mock;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('rpa-crypto JS wrapper', () => {
  it('passes through a successful encryptFile call and result shape', async () => {
    mockNative().encryptFile.mockResolvedValueOnce({
      keyIdHex: 'aabbccdd',
      chunkSize: 262144,
      totalChunks: 3,
      plaintextSize: 700000,
    });

    const result = await encryptFile('file:///src', 'file:///dst', 'a-base64-key');

    expect(mockNative().encryptFile).toHaveBeenCalledWith('file:///src', 'file:///dst', 'a-base64-key', 262144);
    expect(result).toEqual({ keyIdHex: 'aabbccdd', chunkSize: 262144, totalChunks: 3, plaintextSize: 700000 });
  });

  it('forwards a caller-supplied chunk size instead of the default', async () => {
    mockNative().encryptFile.mockResolvedValueOnce({ keyIdHex: '00', chunkSize: 64, totalChunks: 1, plaintextSize: 10 });
    await encryptFile('a', 'b', 'key', 64);
    expect(mockNative().encryptFile).toHaveBeenCalledWith('a', 'b', 'key', 64);
  });

  it('wraps a rejection carrying a recognized native `code` into RpaCryptoError', async () => {
    const nativeErr = Object.assign(new Error('This file was encrypted with a different install key'), {
      code: 'E_RPA1_KEY_MISMATCH',
    });
    mockNative().decryptFile.mockRejectedValueOnce(nativeErr);

    await expect(decryptFile('a', 'b', 'key')).rejects.toMatchObject({
      name: 'RpaCryptoError',
      code: 'E_RPA1_KEY_MISMATCH',
    });
  });

  it('every documented native error code round-trips through the wrapper unchanged', async () => {
    const codes = [
      'E_RPA1_BAD_MAGIC',
      'E_RPA1_UNSUPPORTED_VERSION',
      'E_RPA1_UNSUPPORTED_ALGORITHM',
      'E_RPA1_TRUNCATED',
      'E_RPA1_KEY_MISMATCH',
      'E_RPA1_AUTH_FAILED',
      'E_RPA1_IO',
    ] as const;

    for (const code of codes) {
      mockNative().decryptFile.mockRejectedValueOnce(Object.assign(new Error('x'), { code }));
      await expect(decryptFile('a', 'b', 'key')).rejects.toMatchObject({ code });
    }
  });

  it('maps an unrecognized or missing code to E_RPA1_UNKNOWN rather than leaking the raw shape', async () => {
    mockNative().readHeaderInfo.mockRejectedValueOnce(new Error('some other native crash'));
    await expect(readHeaderInfo('a')).rejects.toMatchObject({
      name: 'RpaCryptoError',
      code: 'E_RPA1_UNKNOWN',
    });

    mockNative().readHeaderInfo.mockRejectedValueOnce(Object.assign(new Error('weird'), { code: 'NOT_A_REAL_CODE' }));
    await expect(readHeaderInfo('a')).rejects.toMatchObject({ code: 'E_RPA1_UNKNOWN' });
  });

  /**
   * Regression test for a real bug `reviewer-gilfoyle` found (traced through
   * `node_modules/expo-modules-core/ios/Core/Functions/{Async,Concurrent}FunctionDefinition.swift`):
   * the iOS native module's private `RpaError` type did not actually subclass
   * `ExpoModulesCore.Exception` (it only conformed to `Error`/`CustomNSError`), and those
   * catch blocks only recognize `catch let error as Exception` — a non-`Exception` throw
   * falls through to the generic branch and gets wrapped in `UnexpectedException` instead,
   * which does NOT forward the original `E_RPA1_*` code. `UnexpectedException` doesn't
   * override `Exception.code`, so it falls back to `Exception`'s own default —
   * `errorCodeFromString(name)` on the class name "UnexpectedException" — which strips the
   * trailing "Exception", inserts underscores before capitals, and uppercases:
   * `errorCodeFromString.swift`'s own documented transform, confirmed by reading that file
   * directly, not guessed. That yields exactly `"ERR_UNEXPECTED"`.
   *
   * The bug is now fixed natively (`RpaError` subclasses `Exception` for real, mirroring
   * `RpaException : CodedException` on Android) — this test doesn't exercise the fix
   * itself (there is no Swift toolchain in this sandbox to compile and run it against),
   * it proves the *wrapper* would have degraded safely even before that fix, and continues
   * to after it, against any native rejection shaped like the real pre-fix bug: a real
   * `code`, just the wrong one, never a thrown-away/ignored code and never an unhandled
   * exception reaching app code.
   */
  it('degrades safely (never crashes, never silently claims the wrong RpaErrorCode) against the exact shape the pre-fix iOS bridge bug produced for every native throw ("ERR_UNEXPECTED", not the real E_RPA1_* code)', async () => {
    const nativeUnexpectedExceptionShape = Object.assign(
      new Error('This file was encrypted with a different install key (reinstall or key loss)'),
      { code: 'ERR_UNEXPECTED' },
    );
    mockNative().decryptFile.mockRejectedValueOnce(nativeUnexpectedExceptionShape);

    const rejection = await decryptFile('a', 'b', 'key').catch((err: unknown) => err);
    expect(rejection).toBeInstanceOf(RpaCryptoError);
    expect((rejection as RpaCryptoError).code).toBe('E_RPA1_UNKNOWN');
    // Never silently reports the intended E_RPA1_KEY_MISMATCH when the bridge didn't
    // actually deliver it — that would be worse than "unknown": a confidently wrong
    // diagnosis (e.g. `downloadManager.ts` would treat this as generic corruption, not
    // key loss, and tell the user to re-download rather than the specific "your key
    // changed" message — still recoverable, never a crash, just the wrong message, which
    // is exactly what the native-side fix corrects).
    expect((rejection as RpaCryptoError).code).not.toBe('E_RPA1_KEY_MISMATCH');
  });

  it('propagates a plain string thrown by native code without crashing the wrapper', async () => {
    mockNative().generateInstallKeyBase64.mockRejectedValueOnce('a raw string rejection');
    await expect(generateInstallKeyBase64()).rejects.toBeInstanceOf(RpaCryptoError);
  });

  it('excludeFromBackup resolves the native boolean result on success', async () => {
    mockNative().excludeFromBackup.mockResolvedValueOnce(true);
    await expect(excludeFromBackup('file:///a')).resolves.toBe(true);
  });
});
