import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PLAYBACK_PREFERENCES,
  loadPlaybackPreferences,
  savePlaybackPreferences,
  type PlaybackPreferences,
  type PlaybackSpeed,
} from './playbackPreferences';

export interface UsePlaybackPreferencesResult {
  preferences: PlaybackPreferences;
  isLoading: boolean;
  /** Non-null while a just-applied change is being persisted — surfaced so a screen can disable input mid-save if it wants to, not required. */
  isSaving: boolean;
  setDefaultSpeed: (speed: PlaybackSpeed) => Promise<void>;
  setAutoplayNextInSeries: (enabled: boolean) => Promise<void>;
}

/**
 * Optimistic-update + revert-on-failure for the Profile & Settings playback
 * section (design spec 1n / plan W4.6's own verification bullet: "optimistic
 * toggles revert on failure"). Every setter applies the new value to local
 * state immediately, persists it, and — only on a persistence failure —
 * rolls local state back to what it was before the call. There is no server
 * round-trip here (see `playbackPreferences.ts`'s own docstring for why);
 * the boundary that can fail and that tests mock is the local persistence
 * write, the real boundary this data actually crosses.
 */
export function usePlaybackPreferences(): UsePlaybackPreferencesResult {
  const [preferences, setPreferences] = useState<PlaybackPreferences>(DEFAULT_PLAYBACK_PREFERENCES);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    loadPlaybackPreferences()
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

  const applyAndPersist = useCallback(
    async (next: PlaybackPreferences, previous: PlaybackPreferences) => {
      setPreferences(next);
      setIsSaving(true);
      try {
        await savePlaybackPreferences(next);
      } catch (err) {
        // Revert — the write never landed, so local state must not claim otherwise.
        setPreferences(previous);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  const setDefaultSpeed = useCallback(
    (speed: PlaybackSpeed) => {
      const previous = preferences;
      return applyAndPersist({ ...previous, defaultSpeed: speed }, previous);
    },
    [preferences, applyAndPersist],
  );

  const setAutoplayNextInSeries = useCallback(
    (enabled: boolean) => {
      const previous = preferences;
      return applyAndPersist({ ...previous, autoplayNextInSeries: enabled }, previous);
    },
    [preferences, applyAndPersist],
  );

  return { preferences, isLoading, isSaving, setDefaultSpeed, setAutoplayNextInSeries };
}
