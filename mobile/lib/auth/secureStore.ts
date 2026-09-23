import * as SecureStore from 'expo-secure-store';

/**
 * Persistence for the refresh token ONLY (plan L12). The access token must
 * never reach this module, or `AsyncStorage`, or anywhere else on disk — it
 * lives in memory only, in `lib/auth/session.ts`.
 *
 * Two options control locked-device access, and both matter for L12 —
 * "background downloads and token refresh must keep working while the
 * device is locked":
 *  - `requireAuthentication` is explicitly set to `false` (never `true`
 *    here) — `true` would force a biometric/passcode prompt on every read,
 *    which is a foreground-only, synchronous-user-present operation and
 *    cannot succeed from a background task.
 *  - `keychainAccessible` (iOS only; ignored on Android) defaults to
 *    `WHEN_UNLOCKED` in expo-secure-store itself, which blocks Keychain
 *    reads entirely while the device is locked — the opposite of what L12
 *    needs. Set explicitly to `AFTER_FIRST_UNLOCK`: readable in the
 *    background once the device has been unlocked at least once since boot,
 *    the standard accessibility class for apps that refresh tokens or
 *    resume downloads while locked (e.g. mail clients).
 */
const REFRESH_TOKEN_KEY = 'rhemapod.refreshToken';

const OPTIONS: SecureStore.SecureStoreOptions = {
  requireAuthentication: false,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export async function loadRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY, OPTIONS);
}

export async function saveRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, OPTIONS);
}

export async function clearRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, OPTIONS);
}
