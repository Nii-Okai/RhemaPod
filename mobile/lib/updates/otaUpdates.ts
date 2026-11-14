/* global __DEV__ */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Over-the-air updates (EAS Update). See `mobile/docs/ota-updates.md` for how fixes are
 * published, staged and rolled back.
 *
 * The native side (`app.json` `updates`) checks for an update on every cold start and
 * downloads it in the background without delaying launch (`fallbackToCacheTimeout: 0`),
 * so a fix is running from the next cold start after it was downloaded. A sermon app
 * often stays alive in the background for days, though, so this also checks when the
 * app comes back to the foreground. It only downloads: it never reloads the app,
 * because that would cut off whatever is playing. The downloaded update is used on the
 * next cold start.
 *
 * If an update crashes on launch, expo-updates itself falls back to the previous
 * working update or the build's own bundle, so a bad update cannot lock users out.
 */

/** Don't check more often than this when the app keeps coming to the foreground. */
export const FOREGROUND_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Which bundle is running, to tag crash reports with. Exported for tests. */
export function updateContext(): Record<string, string> {
  return {
    'update.id': Updates.updateId ?? 'embedded',
    'update.channel': Updates.channel ?? 'none',
    'update.runtime_version': Updates.runtimeVersion ?? 'none',
    'update.embedded': String(Updates.isEmbeddedLaunch),
  };
}

/**
 * Checks for and downloads a newer update. Never throws: being offline or on a flaky
 * connection is normal, and the next check simply tries again. Exported for tests.
 */
export async function fetchPendingUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return false;
    const result = await Updates.fetchUpdateAsync();
    return result.isNew;
  } catch {
    return false;
  }
}

/** Downloads a waiting update when the app returns to the foreground (see above). */
export function useFetchUpdatesOnForeground(now: () => number = Date.now): void {
  // Launch already checked (native ON_LOAD), so the clock starts now.
  const lastCheck = useRef(now());
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (now() - lastCheck.current < FOREGROUND_CHECK_INTERVAL_MS) return;
      lastCheck.current = now();
      void fetchPendingUpdate();
    });
    return () => sub.remove();
  }, [now]);
}
