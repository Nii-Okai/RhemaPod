import { useCallback, useEffect, useRef, useState } from 'react';
import * as Network from 'expo-network';
import { ACTIVE_STATES, type DownloadRecord } from './types';
import { downloadManager, type DownloadManager } from './downloadManager';
import { useDownloadPreferences } from '../settings/useDownloadPreferences';

/**
 * App-facing surface over `downloadManager` (plan W4.5) — the Downloads tab and the
 * sermon-detail Download control both use this, not `downloadManager` directly, so the
 * startup sweep, the Wi-Fi-reconnect resume, and the list-refresh polling only need to be
 * wired up once.
 *
 * No event emitter/observable store backs the manager (it's a thin async wrapper over
 * SQLite) — this hook polls `listDownloads()` on an interval instead, and only while at
 * least one download is `queued`/`downloading`. A `ready`/`failed`-only list needs no
 * polling (nothing is changing on its own), so the interval clears itself the moment the
 * last active download settles. This is a deliberate, disclosed simplification for v1,
 * not a hidden gap — see the status entry.
 */
const POLL_INTERVAL_MS = 750;

export interface UseDownloadsResult {
  downloads: DownloadRecord[];
  isLoading: boolean;
  wifiOnly: boolean;
  isSavingWifiOnly: boolean;
  setWifiOnly: (enabled: boolean) => Promise<void>;
  download: (sermonId: string, title: string) => Promise<void>;
  retry: (sermonId: string) => Promise<void>;
  remove: (sermonId: string) => Promise<void>;
  find: (sermonId: string) => DownloadRecord | undefined;
}

let startupSweepPromise: Promise<void> | null = null;

/** Runs the startup sweep exactly once per app session, however many screens mount this hook. */
function ensureStartupSweep(manager: DownloadManager): Promise<void> {
  if (!startupSweepPromise) {
    startupSweepPromise = manager.startupSweep();
  }
  return startupSweepPromise;
}

/** Test-only: lets a test re-trigger the startup sweep in a fresh "app session". Never called by app code. */
export function __resetStartupSweepForTests(): void {
  startupSweepPromise = null;
}

export function useDownloads(manager: DownloadManager = downloadManager): UseDownloadsResult {
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);
  const { preferences, isSaving: isSavingWifiOnly, setWifiOnly: setWifiOnlyPreference } = useDownloadPreferences();

  const refresh = useCallback(async () => {
    const list = await manager.listDownloads();
    if (mounted.current) setDownloads(list);
  }, [manager]);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      await ensureStartupSweep(manager);
      await refresh();
      if (mounted.current) setIsLoading(false);
    })();
    return () => {
      mounted.current = false;
    };
  }, [manager, refresh]);

  // Poll while anything is actively transferring — see the file docstring.
  useEffect(() => {
    const hasActive = downloads.some((d) => (ACTIVE_STATES as readonly string[]).includes(d.state));
    if (!hasActive) return undefined;
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [downloads, refresh]);

  // Resume queued downloads once the Wi-Fi-only toggle is turned off, or the device
  // reconnects to Wi-Fi while it's still on.
  useEffect(() => {
    if (!preferences.wifiOnly) {
      void manager.resumeQueuedDownloads().then(refresh);
    }
  }, [preferences.wifiOnly, manager, refresh]);

  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      if (state.type === Network.NetworkStateType.WIFI && state.isConnected) {
        void manager.resumeQueuedDownloads().then(refresh);
      }
    });
    return () => subscription.remove();
  }, [manager, refresh]);

  const download = useCallback(
    async (sermonId: string, title: string) => {
      await manager.enqueueDownload(sermonId, title);
      await refresh();
    },
    [manager, refresh],
  );

  const retry = useCallback(
    async (sermonId: string) => {
      await manager.retryDownload(sermonId);
      await refresh();
    },
    [manager, refresh],
  );

  const remove = useCallback(
    async (sermonId: string) => {
      await manager.deleteDownload(sermonId);
      await refresh();
    },
    [manager, refresh],
  );

  const setWifiOnly = useCallback(
    async (enabled: boolean) => {
      await setWifiOnlyPreference(enabled);
    },
    [setWifiOnlyPreference],
  );

  const find = useCallback((sermonId: string) => downloads.find((d) => d.sermonId === sermonId), [downloads]);

  return {
    downloads,
    isLoading,
    wifiOnly: preferences.wifiOnly,
    isSavingWifiOnly,
    setWifiOnly,
    download,
    retry,
    remove,
    find,
  };
}
