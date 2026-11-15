/* global __DEV__, console */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from '../api/typedClient';
import type { NotificationPreferences, ReminderTime } from '../settings/notificationPreferences';
import { setAppIconBadge } from './appBadge';

/**
 * Push and local notifications.
 *
 * - New sermons are pushed by the API through Expo's push service. This module asks the
 *   OS for permission (only when the listener turns a notification on), gets this
 *   install's Expo push token and registers it with `PUT /me/push-devices`.
 * - The Daily Rhema reminder is a local notification scheduled on the phone at the
 *   time the listener picked (07:00 unless they chose another), in the phone's own time
 *   zone, so it needs no server and works offline.
 */

export const DAILY_RHEMA_REMINDER_ID = 'daily-rhema-reminder';
const ANDROID_CHANNEL_ID = 'default';

let handlerSet = false;

/** How a notification shows while the app is open: as a banner, without sound. */
export function configureNotificationHandling(): void {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Sermons and reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export type PermissionResult = 'granted' | 'denied' | 'unavailable';

/** Asks the OS once; later calls return the stored answer without a prompt. */
export async function requestNotificationPermission(): Promise<PermissionResult> {
  if (!Device.isDevice) return 'unavailable';
  await ensureAndroidChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) return 'denied';
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted ? 'granted' : 'denied';
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

function projectId(): string | undefined {
  return (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
}

let cachedToken: string | null = null;

async function pushToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (!(await hasNotificationPermission())) return null;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
  cachedToken = data;
  return data;
}

/**
 * Registers this install with the API with its current new-sermons choice. Called on
 * sign-in and whenever the setting changes; a no-op without permission. Never throws:
 * a failed registration is retried on the next launch.
 */
export async function syncPushRegistration(prefs: NotificationPreferences): Promise<void> {
  try {
    // Android only shows a notification on a channel that exists. Where permission is
    // granted without a prompt (Android 12 and older), nothing else creates it, and a
    // push that arrives while the app is open is dropped.
    await ensureAndroidChannel();
    const token = await pushToken();
    if (!token) return;
    await api.put('/me/push-devices', {
      body: {
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        new_sermons: prefs.newSermons,
      },
    });
  } catch (err) {
    if (__DEV__) console.warn('[push] registration failed', err);
  }
}

/**
 * Sign-out: stop pushes to this phone for the account that is leaving, and drop the
 * daily reminder. Bounded to a few seconds so a slow network never holds up sign-out.
 */
export async function teardownNotificationsForSignOut(): Promise<void> {
  const work = (async () => {
    await setAppIconBadge(0);
    try {
      await Notifications.cancelScheduledNotificationAsync(DAILY_RHEMA_REMINDER_ID);
    } catch {
      // nothing scheduled
    }
    const token = cachedToken;
    if (!token) return;
    try {
      await api.post('/me/push-devices/remove', { body: { token } });
    } catch {
      // The next account to sign in on this phone re-points the token anyway.
    }
  })();
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

/** Turns the Daily Rhema reminder on (at `time`, local) or off. Re-arming replaces the old one. */
export async function setDailyRhemaReminder(enabled: boolean, time: ReminderTime): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(DAILY_RHEMA_REMINDER_ID).catch(() => undefined);
  if (!enabled) return;
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_RHEMA_REMINDER_ID,
    content: {
      title: 'Your Daily Rhema',
      body: 'A few quiet minutes with today’s word are ready for you.',
      data: { kind: 'daily_rhema' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: time.hour,
      minute: time.minute,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
}

/** Test seam. */
export function resetPushStateForTests(): void {
  cachedToken = null;
  handlerSet = false;
}
