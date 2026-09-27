import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePlaybackPreferences } from '../usePlaybackPreferences';
import { DEFAULT_PLAYBACK_PREFERENCES } from '../playbackPreferences';

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

describe('usePlaybackPreferences', () => {
  beforeEach(() => {
    mockedStorage().__reset();
  });

  it('loads the persisted defaults on mount', async () => {
    const { result } = renderHook(() => usePlaybackPreferences());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.preferences).toEqual(DEFAULT_PLAYBACK_PREFERENCES);
  });

  it('applies a new default speed optimistically and persists it', async () => {
    const { result } = renderHook(() => usePlaybackPreferences());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let settled: Promise<void>;
    act(() => {
      settled = result.current.setDefaultSpeed(1.5);
    });
    // Optimistic — the new value is visible before the persistence write resolves.
    expect(result.current.preferences.defaultSpeed).toBe(1.5);

    await act(async () => {
      await settled;
    });
    expect(mockedStorage().setItem).toHaveBeenCalledWith(
      'rhemapod-playback-preferences',
      JSON.stringify({ ...DEFAULT_PLAYBACK_PREFERENCES, defaultSpeed: 1.5 }),
    );
  });

  it('toggles autoplay-next-in-series optimistically and persists it', async () => {
    const { result } = renderHook(() => usePlaybackPreferences());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.setAutoplayNextInSeries(false);
    });

    expect(result.current.preferences.autoplayNextInSeries).toBe(false);
  });

  it('reverts the toggle to its previous value when the persistence write fails', async () => {
    const { result } = renderHook(() => usePlaybackPreferences());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.preferences.autoplayNextInSeries).toBe(true);

    mockedStorage().setItem.mockRejectedValueOnce(new Error('disk full'));

    await act(async () => {
      await expect(result.current.setAutoplayNextInSeries(false)).rejects.toThrow('disk full');
    });

    // Reverted, not left on the optimistic (failed) value.
    expect(result.current.preferences.autoplayNextInSeries).toBe(true);
    expect(result.current.isSaving).toBe(false);
  });

  it('reverts default speed to its previous value when the persistence write fails', async () => {
    const { result } = renderHook(() => usePlaybackPreferences());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockedStorage().setItem.mockRejectedValueOnce(new Error('disk full'));

    await act(async () => {
      await expect(result.current.setDefaultSpeed(2)).rejects.toThrow('disk full');
    });

    expect(result.current.preferences.defaultSpeed).toBe(DEFAULT_PLAYBACK_PREFERENCES.defaultSpeed);
  });
});
