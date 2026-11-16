import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import * as Network from 'expo-network';
import { ACTIVE_STATES, type DownloadMediaType, type DownloadRecord } from './types';
import { downloadManager, type DownloadManager } from './downloadManager';
import { useDownloadPreferences } from '../settings/useDownloadPreferences';
import { seedOfflineDetails } from './offlineDetails';

/**
 * App-facing surface over `downloadManager` (plan W4.5) — the Downloads tab, the
 * sermon-detail/series-detail Download pills, and every `EpisodeDownloadButton` all use
 * this, not `downloadManager` directly.
 *
 * Backed by one shared store per `DownloadManager` instance (session 2026-10-09 fix),
 * not per-hook-instance `useState` — a single `useSyncExternalStore` subscription per
 * component, not an independent poll loop each. The earlier per-instance version meant a
 * series page's bulk "download all" pill (driven by its own `useDownloads()` call) could
 * enqueue every episode while each episode row's *own*, separate `useDownloads()`
 * instance never found out: that instance's local list was still empty at the moment the
 * pill fired, so its own "is anything active" check never saw a reason to start polling,
 * and the row's icon sat on "not downloaded" forever even after the file finished. Every
 * component sharing one store means one instance's `download()`/poll tick updates what
 * every other instance (and `find()`) sees on its next render, regardless of which one
 * actually started the transfer.
 *
 * No event emitter/observable store backs the manager itself (it's a thin async wrapper
 * over SQLite) — the shared store still polls `listDownloads()` on an interval, and only
 * while at least one download is `queued`/`downloading`, stopping the moment the last
 * active download settles or the last subscriber unmounts. This is a deliberate,
 * disclosed simplification for v1, not a hidden gap — see the status entry.
 */
const POLL_INTERVAL_MS = 750;

export interface UseDownloadsResult {
  downloads: DownloadRecord[];
  isLoading: boolean;
  wifiOnly: boolean;
  isSavingWifiOnly: boolean;
  setWifiOnly: (enabled: boolean) => Promise<void>;
  download: (
    sermonId: string,
    title: string,
    mediaType: DownloadMediaType,
    thumbnailUrl?: string | null,
    category?: string | null,
  ) => Promise<void>;
  retry: (sermonId: string) => Promise<void>;
  remove: (sermonId: string) => Promise<void>;
  /** True while Wi-Fi-only is on and the device isn't on Wi-Fi — queued downloads are
   * waiting for Wi-Fi, not for their turn, and the UI says so. */
  waitingForWifi: boolean;
  find: (sermonId: string) => DownloadRecord | undefined;
}

interface DownloadsSnapshot {
  downloads: DownloadRecord[];
  isLoading: boolean;
}

interface SharedStore {
  snapshot: DownloadsSnapshot;
  listeners: Set<() => void>;
  pollTimer: ReturnType<typeof setInterval> | null;
  refreshing: Promise<void> | null;
  startupSweep: Promise<void> | null;
}

// Keyed by manager instance (not a single module-level singleton) so each test's own fake
// `DownloadManager` gets its own isolated store — only the app's one real `downloadManager`
// singleton is ever shared across components in practice.
const stores = new Map<DownloadManager, SharedStore>();

function getStore(manager: DownloadManager): SharedStore {
  let store = stores.get(manager);
  if (!store) {
    store = {
      snapshot: { downloads: [], isLoading: true },
      listeners: new Set(),
      pollTimer: null,
      refreshing: null,
      startupSweep: null,
    };
    stores.set(manager, store);
  }
  return store;
}

/** Test-only: drops every manager's shared store, so a fresh fake manager in the next test
 * starts from a clean slate rather than reusing another test's. Clears any still-running
 * poll timers first — a store dropped without doing so would leak a real `setInterval`
 * into the next test (and keep the Jest worker process alive after the suite finishes).
 * Never called by app code. */
export function __resetStartupSweepForTests(): void {
  for (const store of stores.values()) {
    if (store.pollTimer) clearInterval(store.pollTimer);
  }
  stores.clear();
}

function setSnapshot(store: SharedStore, snapshot: DownloadsSnapshot): void {
  store.snapshot = snapshot;
  for (const listener of store.listeners) listener();
}

function ensurePolling(manager: DownloadManager, store: SharedStore): void {
  const hasActive = store.snapshot.downloads.some((d) => (ACTIVE_STATES as readonly string[]).includes(d.state));
  if (hasActive && store.listeners.size > 0 && !store.pollTimer) {
    store.pollTimer = setInterval(() => {
      void refreshStore(manager, store);
    }, POLL_INTERVAL_MS);
  } else if ((!hasActive || store.listeners.size === 0) && store.pollTimer) {
    clearInterval(store.pollTimer);
    store.pollTimer = null;
  }
}

async function refreshStore(manager: DownloadManager, store: SharedStore): Promise<void> {
  if (!store.refreshing) {
    store.refreshing = (async () => {
      const list = await manager.listDownloads();
      setSnapshot(store, { downloads: list, isLoading: false });
      ensurePolling(manager, store);
      await seedOfflineDetails(manager, list).catch(() => {});
    })().finally(() => {
      store.refreshing = null;
    });
  }
  return store.refreshing;
}

function ensureStartupSweep(manager: DownloadManager, store: SharedStore): Promise<void> {
  if (!store.startupSweep) {
    store.startupSweep = manager.startupSweep();
    // The sweep leaves `queued` rows queued, so pick them up once per launch here. Without
    // this, an app opened already on Wi-Fi never sees the reconnect event below and its
    // queued downloads sit waiting until the network next changes.
    void store.startupSweep
      .then(() => manager.resumeQueuedDownloads())
      .then(() => refreshStore(manager, store))
      // Downloads made before details were saved get one now (online only; offline it
      // just fails quietly and runs again next launch).
      .then(() => manager.backfillDetailSnapshots())
      .then(() => refreshStore(manager, store))
      .catch(() => {});
  }
  return store.startupSweep;
}

/**
 * Writes a `queued` row into the shared snapshot immediately, ahead of the real
 * `enqueueDownload`/`retryDownload` call (Isaac's ask, session 2026-10-09 — pressing
 * Download showed nothing for the 3–4 seconds it took the real call to resolve, since
 * `downloadManager`'s `enqueueDownload` doesn't return until the *entire* transfer
 * finishes, not just the queue insert — long enough that a user would tap it again
 * thinking the first press missed). The real manager call's own, much faster internal
 * `upsertQueued` write lands well within one 750ms poll tick, so the next refresh
 * (started immediately below via `ensurePolling`) overwrites this placeholder with real
 * data before it's ever stale enough to matter — this only needs to bridge that opening
 * gap, not stay accurate on its own.
 */
function setOptimisticQueued(
  store: SharedStore,
  sermonId: string,
  title: string,
  mediaType: DownloadMediaType,
  thumbnailUrl: string | null = null,
  category: string | null = null,
): void {
  const now = Date.now();
  const existing = store.snapshot.downloads.find((d) => d.sermonId === sermonId);
  const optimistic: DownloadRecord = {
    sermonId,
    title,
    thumbnailUrl: thumbnailUrl ?? existing?.thumbnailUrl ?? null,
    thumbnailPath: existing?.thumbnailPath ?? null,
    category: category ?? existing?.category ?? null,
    mediaType,
    state: 'queued',
    progress: 0,
    bytesTotal: null,
    failureReason: null,
    failureMessage: null,
    keyIdHex: existing?.keyIdHex ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const downloads = existing
    ? store.snapshot.downloads.map((d) => (d.sermonId === sermonId ? optimistic : d))
    : [...store.snapshot.downloads, optimistic];
  setSnapshot(store, { downloads, isLoading: store.snapshot.isLoading });
}

export function useDownloads(manager: DownloadManager = downloadManager): UseDownloadsResult {
  const store = getStore(manager);
  const { preferences, isSaving: isSavingWifiOnly, setWifiOnly: setWifiOnlyPreference } = useDownloadPreferences();

  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      ensurePolling(manager, store);
      return () => {
        store.listeners.delete(listener);
        ensurePolling(manager, store);
      };
    },
    [manager, store],
  );
  const getSnapshot = useCallback(() => store.snapshot, [store]);
  const { downloads, isLoading } = useSyncExternalStore(subscribe, getSnapshot);
  // Optimistic until the first read lands, so nothing flashes "Waiting for Wi-Fi".
  const [onWifi, setOnWifi] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureStartupSweep(manager, store);
      if (cancelled) return;
      await refreshStore(manager, store);
    })();
    return () => {
      cancelled = true;
    };
  }, [manager, store]);

  // Resume queued downloads once the Wi-Fi-only toggle is turned off, or the device
  // reconnects to Wi-Fi while it's still on.
  useEffect(() => {
    if (!preferences.wifiOnly) {
      void manager.resumeQueuedDownloads().then(() => refreshStore(manager, store));
    }
  }, [preferences.wifiOnly, manager, store]);

  useEffect(() => {
    let active = true;
    Promise.resolve(Network.getNetworkStateAsync())
      .then((state) => {
        if (active && state) setOnWifi(state.type === Network.NetworkStateType.WIFI && state.isConnected === true);
      })
      .catch(() => {});
    const subscription = Network.addNetworkStateListener((state) => {
      setOnWifi(state.type === Network.NetworkStateType.WIFI && state.isConnected === true);
      if (state.type === Network.NetworkStateType.WIFI && state.isConnected) {
        void manager.resumeQueuedDownloads().then(() => refreshStore(manager, store));
      } else {
        // Left Wi-Fi: with Wi-Fi-only on, transfers in flight go back to `queued` rather
        // than carrying on over mobile data.
        void manager.pauseIfGateClosed().then(() => refreshStore(manager, store));
      }
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [manager, store]);

  const download = useCallback(
    async (sermonId: string, title: string, mediaType: DownloadMediaType, thumbnailUrl?: string | null, category?: string | null) => {
      if (!store.snapshot.downloads.some((d) => d.sermonId === sermonId)) {
        setOptimisticQueued(store, sermonId, title, mediaType, thumbnailUrl, category);
        ensurePolling(manager, store);
      }
      await manager.enqueueDownload(sermonId, title, mediaType, thumbnailUrl, category);
      await refreshStore(manager, store);
    },
    [manager, store],
  );

  const retry = useCallback(
    async (sermonId: string) => {
      const existing = store.snapshot.downloads.find((d) => d.sermonId === sermonId);
      if (existing) {
        setOptimisticQueued(store, sermonId, existing.title, existing.mediaType, existing.thumbnailUrl, existing.category);
        ensurePolling(manager, store);
      }
      await manager.retryDownload(sermonId);
      await refreshStore(manager, store);
    },
    [manager, store],
  );

  const remove = useCallback(
    async (sermonId: string) => {
      await manager.deleteDownload(sermonId);
      await refreshStore(manager, store);
    },
    [manager, store],
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
    waitingForWifi: preferences.wifiOnly && !onWifi,
  };
}
