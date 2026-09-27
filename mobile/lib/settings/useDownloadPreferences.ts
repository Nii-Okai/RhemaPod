import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_DOWNLOAD_PREFERENCES,
  loadDownloadPreferences,
  saveDownloadPreferences,
  type DownloadPreferences,
} from './downloadPreferences';

export interface UseDownloadPreferencesResult {
  preferences: DownloadPreferences;
  isLoading: boolean;
  isSaving: boolean;
  setWifiOnly: (enabled: boolean) => Promise<void>;
}

/**
 * Optimistic-update + revert-on-failure for the Downloads screen's Wi-Fi-only toggle —
 * same shape as `usePlaybackPreferences.ts` (W4.6's own "optimistic toggles revert on
 * failure" verification bullet applies here too, even though this toggle ships in W4.5).
 */
export function useDownloadPreferences(): UseDownloadPreferencesResult {
  const [preferences, setPreferences] = useState<DownloadPreferences>(DEFAULT_DOWNLOAD_PREFERENCES);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    loadDownloadPreferences()
      .then((loaded) => {
        if (mounted.current) setPreferences(loaded);
      })
      .finally(() => {
        if (mounted.current) setIsLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const setWifiOnly = useCallback(
    async (enabled: boolean) => {
      const previous = preferences;
      const next = { ...previous, wifiOnly: enabled };
      setPreferences(next);
      setIsSaving(true);
      try {
        await saveDownloadPreferences(next);
      } catch (err) {
        setPreferences(previous);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [preferences],
  );

  return { preferences, isLoading, isSaving, setWifiOnly };
}
