import { AsyncStorage as SQLiteAsyncStorage } from 'expo-sqlite/kv-store';

/**
 * Device-local set of read-notification sermon ids, keyed per user id (same store/
 * per-user-key convention as `commentsNotice.ts`'s own one-time-notice flag) — there is
 * no server-side read/unread concept for new releases.
 *
 * Per-item, not one "last seen" timestamp (Isaac's ask, session 2026-10-11: "the
 * counter should respect read and unread items" — a single batch timestamp marked
 * everything on the list as seen the instant the screen opened, whether or not any
 * specific item was actually looked at; this tracks which sermons were individually
 * opened instead). Capped at `MAX_STORED_IDS`, trimming the oldest entries first — New
 * Releases is itself a small, server-capped shelf, so the live set of ids worth
 * remembering never grows large; this is just a hard ceiling against unbounded growth.
 */
const keyFor = (userId: string) => `rhemapod-notifications-read:${userId}`;
const MAX_STORED_IDS = 200;

export async function getReadNotificationIds(userId: string): Promise<Set<string>> {
  try {
    const raw = await SQLiteAsyncStorage.getItem(keyFor(userId));
    if (!raw) return new Set();
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids.filter((id): id is string => typeof id === 'string')) : new Set();
  } catch {
    // Unreadable/corrupt storage must not block the screen — worst case every item
    // reads as unread again until the next successful write.
    return new Set();
  }
}

export async function markNotificationRead(userId: string, sermonId: string): Promise<void> {
  await markNotificationsRead(userId, [sermonId]);
}

/** Marks several at once — the Signature screen's "Mark all read". One read, one write. */
export async function markNotificationsRead(userId: string, sermonIds: string[]): Promise<void> {
  try {
    const current = await getReadNotificationIds(userId);
    for (const id of sermonIds) current.add(id);
    const trimmed = Array.from(current).slice(-MAX_STORED_IDS);
    await SQLiteAsyncStorage.setItem(keyFor(userId), JSON.stringify(trimmed));
  } catch {
    // Best-effort, same reasoning as above.
  }
}
