import { AsyncStorage as SQLiteAsyncStorage } from 'expo-sqlite/kv-store';

/**
 * Device-local flag for the first-launch onboarding carousel (`app/onboarding.tsx`).
 * Same store/try-catch-fails-open pattern as `commentsNotice.ts`/`notificationsSeen.ts`,
 * but deliberately a single flat key rather than per-user-keyed like those two — this
 * must gate `app/index.tsx`'s very first redirect, before any account is known at all,
 * so there is no user id to key on yet.
 */
const STORAGE_KEY = 'rhemapod-onboarding-seen';

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await SQLiteAsyncStorage.getItem(STORAGE_KEY)) === '1';
  } catch {
    // Unreadable storage must not block the app from ever reaching sign-in/home; worst
    // case onboarding shows again on a later launch.
    return false;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await SQLiteAsyncStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Best-effort, same reasoning as above.
  }
}

/**
 * Dev-only escape hatch (Isaac's ask, 2026-10-16) so onboarding can be replayed on a test
 * device without uninstalling/reinstalling the app. Only ever called from a `__DEV__`-gated
 * call site — see `sign-in.tsx`'s own dev-only row.
 */
export async function resetOnboardingSeen(): Promise<void> {
  try {
    await SQLiteAsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort, same reasoning as above.
  }
}
