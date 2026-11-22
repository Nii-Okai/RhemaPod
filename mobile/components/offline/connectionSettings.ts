import { Linking, Platform } from 'react-native';

/**
 * Opens the phone's settings so someone can reconnect. Android goes straight to its
 * "Network & internet" page (Wi-Fi, mobile data, airplane mode); iOS only lets an app open
 * its own page in Settings (which has the app's Mobile Data switch), so that is where it
 * lands there. Falls back to the app's settings page if the Android intent is refused.
 */
export async function openConnectionSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Linking.sendIntent('android.settings.WIRELESS_SETTINGS');
      return;
    } catch {
      // Some Android builds block the intent; the app's own page still works.
    }
  }
  try {
    await Linking.openSettings();
  } catch {
    // Nothing else to try; the offline page still explains the steps.
  }
}
