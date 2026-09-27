import * as SecureStore from 'expo-secure-store';
import { generateInstallKeyBase64 } from '../../modules/rpa-crypto';

/**
 * The per-install AES-256 key (plan W4.5 / GATE M9) — 32 raw bytes, base64-encoded,
 * generated once by the native module's CSPRNG (`CryptoKit`/`javax.crypto`'s
 * `SecureRandom`) and persisted in the platform Keychain/Keystore. Every RPA1 file's
 * actual encryption key is HKDF-derived per-file from this one (see
 * `lib/crypto/rpa1Format.ts`), so this is the single secret whose loss (reinstall, user
 * wipes Keychain, `SecureStore` failure) must degrade every existing download to
 * `key_lost` — never a crash (see `downloadManager.ts`'s `preparePlaybackFile`).
 *
 * Same accessibility posture as `lib/auth/secureStore.ts`'s refresh token, and for the
 * same reason: `requireAuthentication: false` (a Keychain read must be able to succeed
 * from a background download/decrypt with no user present) and `keychainAccessible:
 * AFTER_FIRST_UNLOCK` (readable in the background once the device has been unlocked at
 * least once since boot — not `WHEN_UNLOCKED`, which would block a locked-device
 * background download exactly like L12 already ruled out for the refresh token).
 */
const INSTALL_KEY_STORAGE_KEY = 'rhemapod.downloadInstallKeyBase64';

const OPTIONS: SecureStore.SecureStoreOptions = {
  requireAuthentication: false,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/**
 * Memoizes the in-flight generate-and-persist step only — never the read-only fast path
 * above it — so two concurrent first-ever-download calls (both seeing no key yet) share
 * exactly one `generateInstallKeyBase64` + `setItemAsync` instead of each generating its
 * own key and racing on the write. `useDownloads.ts`'s `startupSweepPromise` is the same
 * pattern for the same reason (one shared in-flight op, not per-caller work), one level
 * up the stack. Cleared in `finally` (success or failure) so a later, non-concurrent call
 * always re-reads SecureStore fresh rather than trusting a stale memoized value forever.
 *
 * Found by `reviewer-gilfoyle`: without this, two downloads started back-to-back on a
 * fresh install could each generate a different key, both call `setItemAsync` with the
 * same storage key, and whichever write lands second silently wins — orphaning the file
 * encrypted under the first (now-unrecoverable, since `getOrCreateInstallKey` never
 * returns it again) key. Narrow window (first-download-ever only; once a key is
 * persisted, every later call short-circuits on the read above) but real, since this
 * branch explicitly supports concurrent downloads (`useDownloads.ts`'s
 * `resumeQueuedDownloads` has no concurrency cap).
 */
let pendingCreate: Promise<string> | null = null;

/**
 * Returns the existing install key, or generates and persists a new one if none is
 * found. A "none found" result covers both "first ever download on this install" and
 * "the Keychain/Keystore entry is gone" (reinstall, user cleared app data, or the OS
 * evicted it) — in the latter case, any download encrypted under the old key becomes
 * undecryptable (`E_RPA1_KEY_MISMATCH`), which `downloadManager.ts` treats as `key_lost`
 * and offers re-download, never a crash. This function does not know or care which case
 * it's in; it always returns *a* usable key.
 */
export async function getOrCreateInstallKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALL_KEY_STORAGE_KEY, OPTIONS);
  if (existing) return existing;

  if (!pendingCreate) {
    pendingCreate = (async () => {
      try {
        const generated = await generateInstallKeyBase64();
        await SecureStore.setItemAsync(INSTALL_KEY_STORAGE_KEY, generated, OPTIONS);
        return generated;
      } finally {
        pendingCreate = null;
      }
    })();
  }
  return pendingCreate;
}

/** Test-only: clears the in-flight-create memo between tests. Never called by app code. */
export function __resetPendingCreateForTests(): void {
  pendingCreate = null;
}

/**
 * Reads the install key without generating one — `null` if none exists yet. Used only
 * where "no key yet" and "a key exists" need to be told apart (there are none of these
 * call sites yet outside tests, but `getOrCreateInstallKey` covers every real caller);
 * kept as a separate export rather than inlined so a test can assert the pre-generation
 * state without relying on `getOrCreateInstallKey`'s side effect.
 */
export async function peekInstallKey(): Promise<string | null> {
  return SecureStore.getItemAsync(INSTALL_KEY_STORAGE_KEY, OPTIONS);
}
