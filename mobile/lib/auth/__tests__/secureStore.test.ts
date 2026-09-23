/**
 * L12: refresh-token persistence must stay readable in the background while
 * the device is locked (silent token refresh, resumed background audio
 * downloads). Two independent SecureStore options control that; both are
 * asserted explicitly rather than trusting the library defaults, since
 * `expo-secure-store`'s own default for `keychainAccessible` (`WHEN_UNLOCKED`)
 * is the wrong one for this app.
 */
import * as SecureStore from 'expo-secure-store';
import { clearRefreshToken, loadRefreshToken, saveRefreshToken } from '../secureStore';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const mocked = SecureStore as unknown as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('secureStore refresh-token options', () => {
  it('never sets requireAuthentication and always sets AFTER_FIRST_UNLOCK on write', async () => {
    await saveRefreshToken('a-refresh-token');

    expect(mocked.setItemAsync).toHaveBeenCalledWith(
      'rhemapod.refreshToken',
      'a-refresh-token',
      { requireAuthentication: false, keychainAccessible: 'afterFirstUnlock' },
    );
  });

  it('reads and deletes with the same accessibility options as the write', async () => {
    await loadRefreshToken();
    await clearRefreshToken();

    expect(mocked.getItemAsync).toHaveBeenCalledWith('rhemapod.refreshToken', {
      requireAuthentication: false,
      keychainAccessible: 'afterFirstUnlock',
    });
    expect(mocked.deleteItemAsync).toHaveBeenCalledWith('rhemapod.refreshToken', {
      requireAuthentication: false,
      keychainAccessible: 'afterFirstUnlock',
    });
  });

  it('propagates a failure (e.g. Keychain unavailable) rather than swallowing it', async () => {
    mocked.setItemAsync.mockRejectedValueOnce(new Error('Keychain error'));
    await expect(saveRefreshToken('x')).rejects.toThrow('Keychain error');
  });
});
