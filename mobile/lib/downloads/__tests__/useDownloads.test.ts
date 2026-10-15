import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { __resetStartupSweepForTests, useDownloads } from '../useDownloads';
import type { DownloadManager } from '../downloadManager';
import type { DownloadRecord } from '../types';

/**
 * `useDownloads.ts` imports the real `downloadManager` singleton from `./downloadManager`
 * for its default parameter, which imports `../../modules/rpa-crypto` at module scope —
 * unresolvable under Jest (see `downloadManager.test.ts`'s identical mock and its
 * docstring for why). Every test below passes its own fake manager explicitly, so the
 * real one is never actually used — this mock exists purely so requiring the module
 * doesn't throw at import time.
 */
jest.mock('../../../modules/rpa-crypto', () => ({
  __esModule: true,
  RpaCryptoError: class RpaCryptoError extends Error {},
  DEFAULT_CHUNK_SIZE: 262144,
  generateInstallKeyBase64: jest.fn(),
  encryptFile: jest.fn(),
  decryptFile: jest.fn(),
  readHeaderInfo: jest.fn(),
  excludeFromBackup: jest.fn(),
}));

jest.mock('expo-network', () => ({
  __esModule: true,
  NetworkStateType: { UNKNOWN: 'UNKNOWN', NONE: 'NONE', WIFI: 'WIFI', CELLULAR: 'CELLULAR' },
  getNetworkStateAsync: jest.fn(async () => ({ type: 'WIFI', isConnected: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-sqlite/kv-store', () => {
  let store: Record<string, string> = {};
  return {
    AsyncStorage: {
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      __reset: () => {
        store = {};
      },
    },
  };
});

function mockedKvStore() {
  return jest.requireMock('expo-sqlite/kv-store').AsyncStorage as { __reset: () => void };
}

function record(sermonId: string, overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    sermonId,
    title: 'Title',
    thumbnailUrl: null,
    thumbnailPath: null,
    category: null,
    mediaType: 'audio',
    state: 'ready',
    progress: 1,
    bytesTotal: 100,
    failureReason: null,
    failureMessage: null,
    keyIdHex: '00',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeFakeManager(initial: DownloadRecord[] = []): jest.Mocked<DownloadManager> {
  let rows = [...initial];
  return {
    enqueueDownload: jest.fn(async (sermonId: string, title: string, mediaType: DownloadRecord['mediaType']) => {
      rows = [...rows, record(sermonId, { title, mediaType, state: 'queued', progress: 0 })];
    }),
    retryDownload: jest.fn(async () => undefined),
    deleteDownload: jest.fn(async (sermonId: string) => {
      rows = rows.filter((r) => r.sermonId !== sermonId);
    }),
    listDownloads: jest.fn(async () => rows),
    getDownload: jest.fn(async (sermonId: string) => rows.find((r) => r.sermonId === sermonId) ?? null),
    resumeQueuedDownloads: jest.fn(async () => undefined),
    startupSweep: jest.fn(async () => undefined),
    preparePlaybackFile: jest.fn(async () => 'file:///playback-tmp/x'),
    cleanupPlaybackTempFile: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<DownloadManager>;
}

beforeEach(() => {
  __resetStartupSweepForTests();
  mockedKvStore().__reset();
  jest.clearAllMocks();
});

describe('useDownloads', () => {
  it('runs the startup sweep exactly once and then loads the current list', async () => {
    const manager = makeFakeManager([record('sermon-1')]);
    const { result } = renderHook(() => useDownloads(manager));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(manager.startupSweep).toHaveBeenCalledTimes(1);
    expect(result.current.downloads).toEqual([record('sermon-1')]);
  });

  it('does not re-run the startup sweep for a second hook instance in the same session', async () => {
    const manager = makeFakeManager([]);
    const first = renderHook(() => useDownloads(manager));
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));

    const second = renderHook(() => useDownloads(manager));
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));

    expect(manager.startupSweep).toHaveBeenCalledTimes(1);
  });

  it('download() enqueues and refreshes the list', async () => {
    const manager = makeFakeManager([]);
    const { result } = renderHook(() => useDownloads(manager));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.download('sermon-1', 'A Sermon', 'audio');
    });

    expect(manager.enqueueDownload).toHaveBeenCalledWith('sermon-1', 'A Sermon', 'audio', undefined, undefined);
    expect(result.current.find('sermon-1')).toMatchObject({ state: 'queued', title: 'A Sermon' });
  });

  it('download() shows a queued record immediately, without waiting for the manager call to resolve', async () => {
    // `enqueueDownload` doesn't resolve until the whole transfer finishes (real
    // `downloadManager` behaviour — see `useDownloads.ts`'s own doc comment on
    // `setOptimisticQueued`), so this fake never resolves at all: if `find()` only showed
    // `queued` *after* `download()`'s promise settled, this assertion would hang/timeout
    // instead of passing, proving the optimistic write happens up front.
    const manager = makeFakeManager([]);
    manager.enqueueDownload.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useDownloads(manager));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      void result.current.download('sermon-1', 'A Sermon', 'audio');
    });

    expect(result.current.find('sermon-1')).toMatchObject({ state: 'queued', progress: 0, title: 'A Sermon' });
  });

  it('retry() shows the record back in queued immediately, without waiting for the manager call to resolve', async () => {
    const manager = makeFakeManager([record('sermon-1', { state: 'failed', failureReason: 'network' })]);
    manager.retryDownload.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useDownloads(manager));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      void result.current.retry('sermon-1');
    });

    expect(result.current.find('sermon-1')).toMatchObject({ state: 'queued', progress: 0, failureReason: null });
  });

  it('retry()\'s optimistic queued placeholder carries the existing thumbnailPath forward, not just thumbnailUrl/category (session 2026-10-15 thumbnail fix: setOptimisticQueued must not blank out a local thumbnail copy a prior successful download already recorded)', async () => {
    const manager = makeFakeManager([
      record('sermon-1', {
        state: 'failed',
        failureReason: 'network',
        thumbnailUrl: 'https://cdn.example.com/signed/thumb.jpg',
        thumbnailPath: 'file:///downloads/sermon-1.thumb',
      }),
    ]);
    manager.retryDownload.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useDownloads(manager));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      void result.current.retry('sermon-1');
    });

    expect(result.current.find('sermon-1')).toMatchObject({
      state: 'queued',
      thumbnailPath: 'file:///downloads/sermon-1.thumb',
    });
  });

  it('retry() and remove() delegate to the manager and refresh', async () => {
    const manager = makeFakeManager([record('sermon-1', { state: 'failed', failureReason: 'network' })]);
    const { result } = renderHook(() => useDownloads(manager));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.retry('sermon-1');
    });
    expect(manager.retryDownload).toHaveBeenCalledWith('sermon-1');

    await act(async () => {
      await result.current.remove('sermon-1');
    });
    expect(manager.deleteDownload).toHaveBeenCalledWith('sermon-1');
    expect(result.current.find('sermon-1')).toBeUndefined();
  });

  it('defaults Wi-Fi-only to on, and turning it off triggers resumeQueuedDownloads', async () => {
    const manager = makeFakeManager([]);
    const { result } = renderHook(() => useDownloads(manager));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.wifiOnly).toBe(true);

    await act(async () => {
      await result.current.setWifiOnly(false);
    });

    expect(result.current.wifiOnly).toBe(false);
    await waitFor(() => expect(manager.resumeQueuedDownloads).toHaveBeenCalled());
  });

  it('polls the list while a download is active, and stops once everything has settled', async () => {
    jest.useFakeTimers();
    const manager = makeFakeManager([record('sermon-1', { state: 'downloading', progress: 0.1 })]);
    const { result } = renderHook(() => useDownloads(manager));

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    manager.listDownloads.mockResolvedValueOnce([record('sermon-1', { state: 'downloading', progress: 0.5 })]);
    await act(async () => {
      jest.advanceTimersByTime(800);
      await Promise.resolve();
    });
    expect(result.current.find('sermon-1')?.progress).toBe(0.5);

    manager.listDownloads.mockResolvedValue([record('sermon-1', { state: 'ready', progress: 1 })]);
    await act(async () => {
      jest.advanceTimersByTime(800);
      await Promise.resolve();
    });
    expect(result.current.find('sermon-1')?.state).toBe('ready');

    const callsAtSettled = manager.listDownloads.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    // No further polling once nothing is active.
    expect(manager.listDownloads.mock.calls.length).toBe(callsAtSettled);

    jest.useRealTimers();
  });

  it('resumes queued downloads when the device reconnects to Wi-Fi', async () => {
    let listener: ((event: { type: string; isConnected: boolean }) => void) | undefined;
    (Network.addNetworkStateListener as jest.Mock).mockImplementation((cb) => {
      listener = cb;
      return { remove: jest.fn() };
    });

    const manager = makeFakeManager([]);
    const { result } = renderHook(() => useDownloads(manager));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      listener?.({ type: 'WIFI', isConnected: true });
      await Promise.resolve();
    });

    expect(manager.resumeQueuedDownloads).toHaveBeenCalled();
  });
});
