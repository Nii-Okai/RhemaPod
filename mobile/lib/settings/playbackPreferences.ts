import { AsyncStorage as SQLiteAsyncStorage } from 'expo-sqlite/kv-store';

/**
 * Local, device-only playback preferences (design spec §3 Profile & Settings /
 * Player: "Sleep timer and playback-speed are client-only state (no backend
 * need)" — the same reasoning extends to autoplay-next-in-series, which has
 * no counterpart anywhere in `lib/api/schema.d.ts`). This deliberately does
 * not go through `lib/api/typedClient.ts` — there is no server endpoint to
 * call, per the plan's own carve-out, so there is nothing to add to the
 * public API contract for this.
 *
 * Persisted via `expo-sqlite/kv-store` (the same `AsyncStorage`-shaped,
 * SQLite-backed store `lib/query/persister.ts` already uses for the query
 * cache) rather than adding `@react-native-async-storage/async-storage` as a
 * second, redundant key-value dependency. A distinct storage key keeps this
 * module's data out of the query-cache persister's own key entirely.
 */
const STORAGE_KEY = 'rhemapod-playback-preferences';

/** One of the five speeds design spec 1d's transport control exposes elsewhere in the app. */
export const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export interface PlaybackPreferences {
  defaultSpeed: PlaybackSpeed;
  autoplayNextInSeries: boolean;
}

export const DEFAULT_PLAYBACK_PREFERENCES: PlaybackPreferences = {
  defaultSpeed: 1,
  autoplayNextInSeries: true,
};

function isPlaybackSpeed(value: unknown): value is PlaybackSpeed {
  return typeof value === 'number' && (PLAYBACK_SPEEDS as readonly number[]).includes(value);
}

/**
 * Defensive parse: a corrupted or pre-migration payload falls back to
 * defaults field-by-field rather than throwing and leaving the caller with
 * nothing to render.
 */
function parse(raw: string | null): PlaybackPreferences {
  if (!raw) return { ...DEFAULT_PLAYBACK_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as Partial<PlaybackPreferences>;
    return {
      defaultSpeed: isPlaybackSpeed(parsed.defaultSpeed) ? parsed.defaultSpeed : DEFAULT_PLAYBACK_PREFERENCES.defaultSpeed,
      autoplayNextInSeries:
        typeof parsed.autoplayNextInSeries === 'boolean'
          ? parsed.autoplayNextInSeries
          : DEFAULT_PLAYBACK_PREFERENCES.autoplayNextInSeries,
    };
  } catch {
    return { ...DEFAULT_PLAYBACK_PREFERENCES };
  }
}

export async function loadPlaybackPreferences(): Promise<PlaybackPreferences> {
  const raw = await SQLiteAsyncStorage.getItem(STORAGE_KEY);
  return parse(raw);
}

/**
 * Writes the full preferences object (callers pass the merged next state, not
 * a partial) — throws through to the caller on a storage failure so
 * `usePlaybackPreferences`'s optimistic-update/revert can react to it.
 */
export async function savePlaybackPreferences(next: PlaybackPreferences): Promise<void> {
  await SQLiteAsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
