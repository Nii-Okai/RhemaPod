import { AsyncStorage as SQLiteAsyncStorage } from 'expo-sqlite/kv-store';

/**
 * The viewer's light/dark choice — device-only, same storage and shape as
 * `playbackPreferences.ts` (no server counterpart; a theme is a property of this device).
 * `system` follows the phone's own appearance setting and is the default.
 */
const STORAGE_KEY = 'rhemapod-theme-preference';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** A missing, corrupted or unknown value falls back to the default rather than throwing. */
export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const raw = await SQLiteAsyncStorage.getItem(STORAGE_KEY);
    return isThemePreference(raw) ? raw : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Throws through on a storage failure so the caller can revert its optimistic update. */
export async function saveThemePreference(next: ThemePreference): Promise<void> {
  await SQLiteAsyncStorage.setItem(STORAGE_KEY, next);
}
