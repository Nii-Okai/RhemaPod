import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import { focusManager, onlineManager } from '@tanstack/react-query';

/**
 * TanStack Query only knows about connectivity and focus through browser events, which
 * React Native never fires — so before this, `refetchOnReconnect` did nothing and nothing
 * refreshed when the app came back to the foreground. This feeds it the two native
 * signals instead: `expo-network` for online/offline (same reading as `useIsOnline`:
 * `isInternetReachable === false` counts as offline) and `AppState` for focus.
 *
 * `queryClient.ts` keeps `networkMode: 'always'`, so knowing it's offline never *pauses*
 * a request — screens keep their existing offline errors and cached data exactly as
 * before; what changes is that stale queries refetch on reconnect and on foreground, and
 * `retryPolicy` stops retrying network failures while offline.
 *
 * Idempotent; every native call is best-effort, so a missing module never breaks the app.
 */
let installed = false;

export function installQueryLifecycle(): void {
  if (installed) return;
  installed = true;

  onlineManager.setEventListener((setOnline) => {
    const toOnline = (state: { isConnected?: boolean; isInternetReachable?: boolean }) =>
      state.isConnected !== false && state.isInternetReachable !== false;
    try {
      Promise.resolve(Network.getNetworkStateAsync())
        .then((state) => {
          if (state) setOnline(toOnline(state));
        })
        .catch(() => {});
      const subscription = Network.addNetworkStateListener((state) => setOnline(toOnline(state)));
      return () => subscription?.remove();
    } catch {
      return undefined;
    }
  });

  focusManager.setEventListener((handleFocus) => {
    try {
      const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
        handleFocus(status === 'active');
      });
      return () => subscription.remove();
    } catch {
      return undefined;
    }
  });
}
