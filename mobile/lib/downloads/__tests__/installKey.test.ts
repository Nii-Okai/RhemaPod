import * as SecureStore from 'expo-secure-store';
import { getOrCreateInstallKey, peekInstallKey } from '../installKey';

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
});

describe('peekInstallKey', () => {
  it('returns null without generating anything when no key exists', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce(null);
    await expect(peekInstallKey()).resolves.toBeNull();
    expect(mockedRpaCrypto().generateInstallKeyBase64).not.toHaveBeenCalled();
  });
});
