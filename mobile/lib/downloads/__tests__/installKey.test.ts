import * as SecureStore from 'expo-secure-store';
import { __resetPendingCreateForTests, getOrCreateInstallKey, peekInstallKey } from '../installKey';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../../../modules/rpa-crypto', () => ({
  __esModule: true,
  generateInstallKeyBase64: jest.fn(),
}));

const mockedSecureStore = SecureStore as unknown as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
};

function mockedRpaCrypto() {
  return jest.requireMock('../../../modules/rpa-crypto') as { generateInstallKeyBase64: jest.Mock };
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetPendingCreateForTests();
});

describe('getOrCreateInstallKey', () => {
  it('returns the existing key without generating a new one when SecureStore already has one', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce('existing-base64-key');

    const key = await getOrCreateInstallKey();

    expect(key).toBe('existing-base64-key');
    expect(mockedRpaCrypto().generateInstallKeyBase64).not.toHaveBeenCalled();
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('generates and persists a new key when none exists (first download, or key loss/reinstall)', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce(null);
    mockedRpaCrypto().generateInstallKeyBase64.mockResolvedValueOnce('fresh-base64-key');

    const key = await getOrCreateInstallKey();

    expect(key).toBe('fresh-base64-key');
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      'rhemapod.downloadInstallKeyBase64',
      'fresh-base64-key',
      { requireAuthentication: false, keychainAccessible: 'afterFirstUnlock' },
    );
  });

  it('reads with requireAuthentication: false and AFTER_FIRST_UNLOCK, matching the refresh-token posture (L12: must work from a background download)', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce('k');
    await getOrCreateInstallKey();
    expect(mockedSecureStore.getItemAsync).toHaveBeenCalledWith('rhemapod.downloadInstallKeyBase64', {
      requireAuthentication: false,
      keychainAccessible: 'afterFirstUnlock',
    });
  });

  it('propagates a SecureStore failure rather than silently generating a throwaway key', async () => {
    mockedSecureStore.getItemAsync.mockRejectedValueOnce(new Error('Keychain unavailable'));
    await expect(getOrCreateInstallKey()).rejects.toThrow('Keychain unavailable');
  });

  /**
   * Regression test for a real race `reviewer-gilfoyle` found: two concurrent
   * first-ever-download calls (both seeing no key persisted yet) used to each generate
   * their own key and race on the `setItemAsync` write — whichever landed second silently
   * won, orphaning any file already encrypted under the first (now-unrecoverable) key.
   * `Promise.all` here starts both calls without awaiting either individually first, which
   * is what actually exercises the race window (both `getItemAsync` reads resolve to
   * `null` before either has had a chance to generate/persist anything).
   */
  it('two concurrent calls with no key persisted yet share exactly one generate-and-persist, never racing on the write', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);
    mockedRpaCrypto().generateInstallKeyBase64.mockResolvedValueOnce('the-one-shared-key');

    const [keyA, keyB] = await Promise.all([getOrCreateInstallKey(), getOrCreateInstallKey()]);

    expect(keyA).toBe('the-one-shared-key');
    expect(keyB).toBe('the-one-shared-key');
    expect(mockedRpaCrypto().generateInstallKeyBase64).toHaveBeenCalledTimes(1);
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it('a later, non-concurrent call after the shared create resolves re-reads SecureStore fresh rather than reusing a stale memo', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce(null); // first call: no key yet
    mockedRpaCrypto().generateInstallKeyBase64.mockResolvedValueOnce('generated-key');
    await getOrCreateInstallKey();

    mockedSecureStore.getItemAsync.mockResolvedValueOnce('generated-key'); // second call: now persisted
    const second = await getOrCreateInstallKey();

    expect(second).toBe('generated-key');
    expect(mockedRpaCrypto().generateInstallKeyBase64).toHaveBeenCalledTimes(1); // not called again
  });

  it('clears the in-flight memo even when the shared create fails, so a later call can retry instead of hanging forever', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);
    mockedRpaCrypto().generateInstallKeyBase64.mockRejectedValueOnce(new Error('CSPRNG failed'));

    await expect(getOrCreateInstallKey()).rejects.toThrow('CSPRNG failed');

    mockedRpaCrypto().generateInstallKeyBase64.mockResolvedValueOnce('retry-succeeded-key');
    await expect(getOrCreateInstallKey()).resolves.toBe('retry-succeeded-key');
  });
});

describe('peekInstallKey', () => {
  it('returns null without generating anything when no key exists', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce(null);
    await expect(peekInstallKey()).resolves.toBeNull();
    expect(mockedRpaCrypto().generateInstallKeyBase64).not.toHaveBeenCalled();
  });
});
