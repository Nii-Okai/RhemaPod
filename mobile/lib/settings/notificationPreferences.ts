import { AsyncStorage as SQLiteAsyncStorage } from 'expo-sqlite/kv-store';

/**
 * What this phone should be notified about. Device-only, like the other preferences
 * here; the API also keeps `newSermons` per device so it knows whom to push.
 *
 * Both default to off: nothing is asked of the OS until the listener turns one on in
 * You > Notifications, so the system permission prompt only ever appears in answer to a
 * tap that explains it.
 */
const STORAGE_KEY = 'rhemapod-notification-preferences';

export interface NotificationPreferences {
  /** A push when a new sermon is published. */
  newSermons: boolean;
  /** A local reminder each morning for the Daily Rhema. */
  dailyRhema: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  newSermons: false,
  dailyRhema: false,
};

export function parseNotificationPreferences(raw: string | null): NotificationPreferences {
  if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      newSermons: typeof parsed.newSermons === 'boolean' ? parsed.newSermons : false,
      dailyRhema: typeof parsed.dailyRhema === 'boolean' ? parsed.dailyRhema : false,
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
}

export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  return parseNotificationPreferences(await SQLiteAsyncStorage.getItem(STORAGE_KEY));
}

export async function saveNotificationPreferences(next: NotificationPreferences): Promise<void> {
  await SQLiteAsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
