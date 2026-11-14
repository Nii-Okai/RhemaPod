import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthContext';
import { getStatus } from '../auth/session';
import { stashPendingLink } from '../linking/pendingLink';
import { loadNotificationPreferences } from '../settings/notificationPreferences';
import { routeForNotification } from './notificationRoutes';
import {
  configureNotificationHandling,
  hasNotificationPermission,
  setDailyRhemaReminder,
  syncPushRegistration,
} from './push';

configureNotificationHandling();

/**
 * Lives once at the root. On sign-in it re-registers this phone's push token (tokens can
 * rotate) and re-arms the Daily Rhema reminder; and it opens whatever a tapped
 * notification points at, including the one that launched the app.
 */
export function NotificationBridge() {
  const { status } = useAuth();
  const router = useRouter();
  const handled = useRef<string | null>(null);
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (status !== 'signedIn') return;
    void (async () => {
      if (!(await hasNotificationPermission())) return;
      const prefs = await loadNotificationPreferences();
      await syncPushRegistration(prefs);
      if (prefs.dailyRhema) await setDailyRhemaReminder(true);
    })().catch(() => undefined);
  }, [status]);

  useEffect(() => {
    if (!lastResponse || lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const key = `${lastResponse.notification.request.identifier}:${lastResponse.notification.date}`;
    if (handled.current === key) return;
    handled.current = key;
    const route = routeForNotification(lastResponse.notification.request.content.data);
    if (!route) return;
    if (getStatus() === 'signedIn') {
      router.push(route as never);
    } else {
      // Opened signed out or mid-start-up: the auth guard replays it after sign-in.
      stashPendingLink(route);
    }
  }, [lastResponse, router]);

  return null;
}
