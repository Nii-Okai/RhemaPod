import * as Network from 'expo-network';

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
