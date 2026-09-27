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

  it('propagates a plain string thrown by native code without crashing the wrapper', async () => {
    mockNative().generateInstallKeyBase64.mockRejectedValueOnce('a raw string rejection');
    await expect(generateInstallKeyBase64()).rejects.toBeInstanceOf(RpaCryptoError);
  });

  it('excludeFromBackup resolves the native boolean result on success', async () => {
    mockNative().excludeFromBackup.mockResolvedValueOnce(true);
    await expect(excludeFromBackup('file:///a')).resolves.toBe(true);
  });
});
