import { useEffect, useState } from 'react';
import * as Network from 'expo-network';

/**
 * Whether the device currently has a usable connection. Optimistic until the first read
 * resolves (an unknown state is treated as online, so a slow native call never flashes an
 * offline message). `isInternetReachable === false` counts as offline even when a network
 * interface is up (captive portals, dead Wi-Fi).
 */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let active = true;
    const toOnline = (state: { isConnected?: boolean; isInternetReachable?: boolean }) =>
      state.isConnected !== false && state.isInternetReachable !== false;

    Network.getNetworkStateAsync()
      .then((state) => {
        if (active) setOnline(toOnline(state));
      })
      .catch(() => {});
    const subscription = Network.addNetworkStateListener((state) => setOnline(toOnline(state)));

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return online;
}
