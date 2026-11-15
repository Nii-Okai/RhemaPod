import { useSyncExternalStore } from 'react';
import { AsyncStorage as SQLiteAsyncStorage } from 'expo-sqlite/kv-store';

/**
 * Where the listener has dragged the mini player.
 *
 * One value shared by every mini player host (the tabs above the dock, and pushed screens
 * via `StackMiniPlayer`), so the card stays where it was put when a screen is pushed or
 * popped:
 *
 * - `null`: docked in its home spot (above the dock on the tabs, at the foot of a pushed
 *   screen). The tabs keep a band for it so it never covers content.
 * - a number: the card's top edge, in points from the top of the host (both hosts fill the
 *   window), anywhere between the status bar and its home spot.
 *
 * Remembered on the device across launches, in the same key-value store as the other
 * local settings. Reads and writes are best-effort: unreadable storage just means docked.
 */
const KEY = 'rhemapod-mini-player-top';

let top: number | null = null;
let loaded = false;
/** Set once the listener moves it this launch, so a slow storage read can't undo that. */
let touched = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    Promise.resolve(SQLiteAsyncStorage.getItem(KEY))
      .then((raw) => {
        const value = raw == null ? NaN : Number(raw);
        // A drag made since launch wins over the stored value.
        if (Number.isFinite(value) && !touched) {
          top = value;
          emit();
        }
      })
      .catch(() => {});
  } catch {
    // Unreadable storage: stay docked.
  }
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => top;

/** The card's saved top edge, or `null` while it is docked. */
export function useMiniPlayerTop(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setMiniPlayerTop(next: number | null) {
  const rounded = next === null ? null : Math.round(next);
  touched = true;
  if (rounded === top) return;
  top = rounded;
  emit();
  try {
    const write =
      rounded === null ? SQLiteAsyncStorage.removeItem(KEY) : SQLiteAsyncStorage.setItem(KEY, String(rounded));
    Promise.resolve(write).catch(() => {});
  } catch {
    // Best-effort: the position still holds for this launch.
  }
}

/** Test-only: forget the in-memory value so each test starts docked. */
export function resetMiniPlayerPositionForTests() {
  top = null;
  loaded = false;
  touched = false;
  listeners.clear();
}
