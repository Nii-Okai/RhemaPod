import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * The number on the iPhone app icon. A new-sermon push sets it to 1 (the server can't
 * know the unread count: read state lives on this phone); the app replaces that with
 * the bell's real unread count whenever it changes, and clears it on sign-out.
 *
 * iOS only: Android launchers count the notifications in the shade themselves.
 * Best effort: a failure here must never break a screen.
 */
export async function setAppIconBadge(count: number): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(count)));
  } catch {
    // No badge permission or native module unavailable: nothing to do.
  }
}
