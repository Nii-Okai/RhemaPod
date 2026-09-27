import {
  DEFAULT_PLAYBACK_PREFERENCES,
  loadPlaybackPreferences,
  savePlaybackPreferences,
} from '../playbackPreferences';

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

describe('playbackPreferences', () => {
  beforeEach(() => {
    mockedStorage().__reset();
  });

  it('returns the defaults when nothing has been saved yet', async () => {
    const loaded = await loadPlaybackPreferences();
    expect(loaded).toEqual(DEFAULT_PLAYBACK_PREFERENCES);
  });

  it('round-trips a saved value', async () => {
    await savePlaybackPreferences({ defaultSpeed: 1.5, autoplayNextInSeries: false });
    const loaded = await loadPlaybackPreferences();
    expect(loaded).toEqual({ defaultSpeed: 1.5, autoplayNextInSeries: false });
  });

  it('falls back to defaults field-by-field on a corrupted payload rather than throwing', async () => {
    mockedStorage().__setRaw('rhemapod-playback-preferences', 'not json');
    const loaded = await loadPlaybackPreferences();
    expect(loaded).toEqual(DEFAULT_PLAYBACK_PREFERENCES);
  });

  it('rejects an out-of-range persisted speed rather than trusting it verbatim', async () => {
    mockedStorage().__setRaw(
      'rhemapod-playback-preferences',
      JSON.stringify({ defaultSpeed: 99, autoplayNextInSeries: false }),
    );
    const loaded = await loadPlaybackPreferences();
    expect(loaded).toEqual({ defaultSpeed: DEFAULT_PLAYBACK_PREFERENCES.defaultSpeed, autoplayNextInSeries: false });
  });

  it('propagates a storage write failure to the caller', async () => {
    mockedStorage().setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(savePlaybackPreferences({ defaultSpeed: 2, autoplayNextInSeries: true })).rejects.toThrow(
      'disk full',
    );
  });
});
