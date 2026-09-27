import { DEFAULT_DOWNLOAD_PREFERENCES, loadDownloadPreferences, saveDownloadPreferences } from '../downloadPreferences';

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
      __setRaw: (key: string, value: string) => {
        store[key] = value;
      },
    },
  };
});

function mockedStorage() {
  return jest.requireMock('expo-sqlite/kv-store').AsyncStorage as {
    getItem: jest.Mock;
    setItem: jest.Mock;
    __reset: () => void;
    __setRaw: (key: string, value: string) => void;
  };
}

describe('downloadPreferences', () => {
  beforeEach(() => {
    mockedStorage().__reset();
  });

  it('defaults to Wi-Fi-only ON when nothing has been saved yet', async () => {
    const loaded = await loadDownloadPreferences();
    expect(loaded).toEqual(DEFAULT_DOWNLOAD_PREFERENCES);
    expect(loaded.wifiOnly).toBe(true);
  });

  it('round-trips a saved value', async () => {
    await saveDownloadPreferences({ wifiOnly: false });
    const loaded = await loadDownloadPreferences();
    expect(loaded).toEqual({ wifiOnly: false });
  });

  it('falls back to defaults on a corrupted payload rather than throwing', async () => {
    mockedStorage().__setRaw('rhemapod-download-preferences', 'not json');
    const loaded = await loadDownloadPreferences();
    expect(loaded).toEqual(DEFAULT_DOWNLOAD_PREFERENCES);
  });

  it('ignores a non-boolean persisted wifiOnly rather than trusting it verbatim', async () => {
    mockedStorage().__setRaw('rhemapod-download-preferences', JSON.stringify({ wifiOnly: 'yes please' }));
    const loaded = await loadDownloadPreferences();
    expect(loaded).toEqual(DEFAULT_DOWNLOAD_PREFERENCES);
  });

  it('propagates a storage write failure to the caller', async () => {
    mockedStorage().setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(saveDownloadPreferences({ wifiOnly: false })).rejects.toThrow('disk full');
  });

  it('uses its own storage key, never colliding with playback preferences or the query cache', async () => {
    await saveDownloadPreferences({ wifiOnly: false });
    expect(mockedStorage().setItem).toHaveBeenCalledWith('rhemapod-download-preferences', expect.any(String));
  });
});
