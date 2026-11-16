import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  loadNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
  type ReminderTime,
} from '../settings/notificationPreferences';
import {
  hasNotificationPermission,
  requestNotificationPermission,
  setDailyRhemaReminder,
  syncPushRegistration,
} from './push';

export type ToggleOutcome = 'ok' | 'denied' | 'unavailable' | 'failed';

export interface UseNotificationPreferencesResult {
  /** What the toggles show: a choice only counts as on while the OS allows notifications. */
  preferences: NotificationPreferences;
  isSaving: boolean;
  setNewSermons: (enabled: boolean) => Promise<ToggleOutcome>;
  setDailyRhema: (enabled: boolean) => Promise<ToggleOutcome>;
  /** Moves the reminder to a new time; re-arms it straight away if it is on. */
  setDailyRhemaTime: (time: ReminderTime) => Promise<ToggleOutcome>;
}

/**
 * The You screen's notification toggles. Turning one on asks the OS for permission the
 * first time (so the system prompt appears right after a tap that explains it); if the
 * listener declines, the toggle stays off and the caller can point them to Settings.
 */
function switchesOff(dailyRhemaTime: ReminderTime): NotificationPreferences {
  return { newSermons: false, dailyRhema: false, dailyRhemaTime: { ...dailyRhemaTime } };
}

export function useNotificationPreferences(): UseNotificationPreferencesResult {
  // Off until we know the OS allows notifications, so a switch never shows on when nothing can arrive.
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => switchesOff(DEFAULT_NOTIFICATION_PREFERENCES.dailyRhemaTime));
  const [isSaving, setIsSaving] = useState(false);
  const mounted = useRef(true);
  // A tap that lands before the saved settings have loaded wins over them.
  const touched = useRef(false);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const [stored, allowed] = await Promise.all([loadNotificationPreferences(), hasNotificationPermission()]);
      if (!mounted.current || touched.current) return;
      // Without OS permission both toggles show off, but the chosen time is kept.
      setPreferences(allowed ? stored : switchesOff(stored.dailyRhemaTime));
    })().catch(() => undefined);
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback(
    async (patch: Partial<NotificationPreferences>, enabling: boolean): Promise<ToggleOutcome> => {
      touched.current = true;
      const previous = preferences;
      if (enabling) {
        const permission = await requestNotificationPermission();
        if (permission !== 'granted') return permission;
      }
      const next = { ...previous, ...patch };
      setPreferences(next);
      setIsSaving(true);
      try {
        await saveNotificationPreferences(next);
        if ('dailyRhema' in patch || ('dailyRhemaTime' in patch && next.dailyRhema)) {
          await setDailyRhemaReminder(next.dailyRhema, next.dailyRhemaTime);
        }
        if ('newSermons' in patch) await syncPushRegistration(next);
        return 'ok';
      } catch {
        if (mounted.current) setPreferences(previous);
        return 'failed';
      } finally {
        if (mounted.current) setIsSaving(false);
      }
    },
    [preferences],
  );

  const setNewSermons = useCallback((enabled: boolean) => apply({ newSermons: enabled }, enabled), [apply]);
  const setDailyRhema = useCallback((enabled: boolean) => apply({ dailyRhema: enabled }, enabled), [apply]);

  const setDailyRhemaTime = useCallback(
    (time: ReminderTime) => apply({ dailyRhemaTime: { hour: time.hour, minute: time.minute } }, false),
    [apply],
  );

  return { preferences, isSaving, setNewSermons, setDailyRhema, setDailyRhemaTime };
}
