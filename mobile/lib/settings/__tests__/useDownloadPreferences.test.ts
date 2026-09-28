import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useDownloadPreferences } from '../useDownloadPreferences';
import { DEFAULT_DOWNLOAD_PREFERENCES } from '../downloadPreferences';

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

function mockedStorage() {
  return jest.requireMock('expo-sqlite/kv-store').AsyncStorage as {
    getItem: jest.Mock;
    setItem: jest.Mock;
    __reset: () => void;
  };
}

describe('useDownloadPreferences', () => {
  beforeEach(() => {
    mockedStorage().__reset();
  });

  it('loads the persisted defaults (Wi-Fi-only ON) on mount', async () => {
    const { result } = renderHook(() => useDownloadPreferences());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.preferences).toEqual(DEFAULT_DOWNLOAD_PREFERENCES);
  });

  it('toggles Wi-Fi-only off optimistically and persists it', async () => {
    const { result } = renderHook(() => useDownloadPreferences());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let settled: Promise<void>;
    act(() => {
      settled = result.current.setWifiOnly(false);
    });
    // Optimistic — visible before the write resolves.
    expect(result.current.preferences.wifiOnly).toBe(false);

    await act(async () => {
      await settled;
    });
    expect(mockedStorage().setItem).toHaveBeenCalledWith('rhemapod-download-preferences', JSON.stringify({ wifiOnly: false }));
  });

  it('reverts to the previous value when the persistence write fails', async () => {
    const { result } = renderHook(() => useDownloadPreferences());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.preferences.wifiOnly).toBe(true);

    mockedStorage().setItem.mockRejectedValueOnce(new Error('disk full'));

    await act(async () => {
      await expect(result.current.setWifiOnly(false)).rejects.toThrow('disk full');
    });

    expect(result.current.preferences.wifiOnly).toBe(true);
    expect(result.current.isSaving).toBe(false);
  });
});
