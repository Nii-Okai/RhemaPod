import { AsyncStorage as SQLiteAsyncStorage } from 'expo-sqlite/kv-store';

/**
 * Device-local flag for the one-time "You'll appear as ..." notice (plan D6), keyed per
 * user id so a second account on the same device still sees it once. Same store as the
 * other local settings (`expo-sqlite/kv-store`); there is no server field for it.
 */
const keyFor = (userId: string) => `rhemapod-comments-notice-seen:${userId}`;

export async function hasSeenAppearAsNotice(userId: string): Promise<boolean> {
  try {
    return (await SQLiteAsyncStorage.getItem(keyFor(userId))) === '1';
  } catch {
    // Unreadable storage must not block commenting; worst case the notice shows again.
    return false;
  }
}

export async function markAppearAsNoticeSeen(userId: string): Promise<void> {
  try {
    await SQLiteAsyncStorage.setItem(keyFor(userId), '1');
  } catch {
    // Best-effort, same reasoning as above.
  }
}
