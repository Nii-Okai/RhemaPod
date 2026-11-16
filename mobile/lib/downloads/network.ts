import * as Network from 'expo-network';
import { loadDownloadPreferences } from '../settings/downloadPreferences';

/**
 * Wi-Fi-only gating (design spec §1l, plan W4.5) — a download only starts/resumes when
 * either the toggle is off, or the device is actually on Wi-Fi. `WIFI` is the only
 * `NetworkStateType` that counts; `CELLULAR` never does regardless of `isConnected`, and
 * an unreachable/unknown state is treated as "not Wi-Fi" (the safer default — never spend
 * cellular data on an ambiguous read).
 */
export async function isOnWifi(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync();
  return state.type === Network.NetworkStateType.WIFI && state.isConnected === true;
}

export async function canStartDownload(wifiOnlyEnabled: boolean): Promise<boolean> {
  if (!wifiOnlyEnabled) return true;
  return isOnWifi();
}

/**
 * The composed Wi-Fi gate (reads the user's own preference, then checks it) — lives here,
 * not in `downloadManager.ts`, specifically so `lib/mediaCache/fill.ts` can import it
 * without a module-graph edge back into the Downloads manager (that edge was a real
 * circular import: `downloadManager -> mediaCache/dropSermon -> mediaCache/fill ->
 * downloadManager`, flagged at S8/S9 review). `downloadManager.ts` now imports this same
 * function instead of defining its own copy.
 */
export async function realCanStartDownload(): Promise<boolean> {
  const prefs = await loadDownloadPreferences();
  return canStartDownload(prefs.wifiOnly);
}
