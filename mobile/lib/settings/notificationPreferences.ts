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
  /** A local reminder each day for the Daily Rhema. */
  dailyRhema: boolean;
  /** When that reminder fires, in the phone's own time zone. */
  dailyRhemaTime: ReminderTime;
}

/** A wall-clock time of day: `hour` 0–23, `minute` 0–59. */
export interface ReminderTime {
  hour: number;
  minute: number;
}

/** 07:00, the fixed time before listeners could choose; saved settings without a time get it. */
export const DEFAULT_DAILY_RHEMA_TIME: ReminderTime = { hour: 7, minute: 0 };

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  newSermons: false,
  dailyRhema: false,
  dailyRhemaTime: DEFAULT_DAILY_RHEMA_TIME,
};

function isWhole(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function parseReminderTime(raw: unknown): ReminderTime {
  const candidate = raw as Partial<ReminderTime> | null | undefined;
  if (candidate && isWhole(candidate.hour, 0, 23) && isWhole(candidate.minute, 0, 59)) {
    return { hour: candidate.hour, minute: candidate.minute };
  }
  return { ...DEFAULT_DAILY_RHEMA_TIME };
}

/** "7:00 AM", "12:30 PM", "9:05 PM". */
export function formatReminderTime({ hour, minute }: ReminderTime): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}

export function parseNotificationPreferences(raw: string | null): NotificationPreferences {
  if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES, dailyRhemaTime: { ...DEFAULT_DAILY_RHEMA_TIME } };
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      newSermons: typeof parsed.newSermons === 'boolean' ? parsed.newSermons : false,
      dailyRhema: typeof parsed.dailyRhema === 'boolean' ? parsed.dailyRhema : false,
      dailyRhemaTime: parseReminderTime(parsed.dailyRhemaTime),
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, dailyRhemaTime: { ...DEFAULT_DAILY_RHEMA_TIME } };
  }
}

export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  return parseNotificationPreferences(await SQLiteAsyncStorage.getItem(STORAGE_KEY));
}

export async function saveNotificationPreferences(next: NotificationPreferences): Promise<void> {
  await SQLiteAsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
