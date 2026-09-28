import { AsyncStorage as SQLiteAsyncStorage } from 'expo-sqlite/kv-store';

/**
 * The Downloads screen's Wi-Fi-only toggle (design spec §1l, plan W4.5) — a device-only
 * preference, not per-download state (that lives in `lib/downloads/db.ts`'s dedicated
 * database file). Persisted the same way `playbackPreferences.ts` persists its own
 * settings: `expo-sqlite/kv-store`, the same store `lib/query/persister.ts` already uses
 * for the query cache, under its own distinct key so none of the three ever collide.
 *
 * Defaults to `true` (Wi-Fi-only ON) — this app's audio downloads can be tens of
 * megabytes, and a free sermon app has no business defaulting to spending a user's
 * cellular data without them opting in.
 */
const STORAGE_KEY = 'rhemapod-download-preferences';

export interface DownloadPreferences {
  wifiOnly: boolean;
}

export const DEFAULT_DOWNLOAD_PREFERENCES: DownloadPreferences = {
  wifiOnly: true,
};

function parse(raw: string | null): DownloadPreferences {
  if (!raw) return { ...DEFAULT_DOWNLOAD_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as Partial<DownloadPreferences>;
    return {
      wifiOnly: typeof parsed.wifiOnly === 'boolean' ? parsed.wifiOnly : DEFAULT_DOWNLOAD_PREFERENCES.wifiOnly,
    };
  } catch {
    return { ...DEFAULT_DOWNLOAD_PREFERENCES };
  }
}

export async function loadDownloadPreferences(): Promise<DownloadPreferences> {
  const raw = await SQLiteAsyncStorage.getItem(STORAGE_KEY);
  return parse(raw);
}

export async function saveDownloadPreferences(next: DownloadPreferences): Promise<void> {
  await SQLiteAsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
