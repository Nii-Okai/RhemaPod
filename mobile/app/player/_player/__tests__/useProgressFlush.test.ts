import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { api } from '../../../../lib/api/typedClient';
import { useProgressFlush } from '../useProgressFlush';
import { wrapWithQueryClient } from '../../../../lib/query/testUtils';

jest.mock('../../../../lib/api/typedClient', () => ({
  api: { post: jest.fn() },
}));

const mockedPost = api.post as jest.Mock;

const INTERVAL_MS = 20_000;

beforeEach(() => {
  mockedPost.mockReset();
  mockedPost.mockResolvedValue({
    sermon_id: 's1',
    position_seconds: 0,
    watched_seconds: 0,
    completed: false,
    play_count: 1,
    last_played_at: '2026-01-01T00:00:00Z',
  });
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * Plan L16's own required verification: "a test proving progress writes are
 * throttled, not per-tick". A real player's `timeUpdate` event fires many times a
 * second — `reportPosition` must be safe to call that often without each call
 * reaching the network.
 */
describe('useProgressFlush — throttling', () => {
  it('never POSTs from reportPosition alone, no matter how many ticks arrive', () => {
    const { result } = renderHook(() => useProgressFlush('s1', 0, { intervalMs: INTERVAL_MS }), {
      wrapper: wrapWithQueryClient(),
    });

    act(() => {
      for (let i = 0; i < 500; i += 1) {
        result.current.reportPosition(i);
      }
    });

    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('flushes once per interval while playing, not once per reportPosition call', async () => {
    const { result } = renderHook(() => useProgressFlush('s1', 0, { intervalMs: INTERVAL_MS }), {
      wrapper: wrapWithQueryClient(),
    });

    act(() => {
      result.current.reportPlaying(true);
    });

    // A tick every 250ms for two full intervals — 160 calls, only 2 flushes expected.
    act(() => {
      for (let i = 1; i <= 160; i += 1) {
        result.current.reportPosition(i * 0.25);
        jest.advanceTimersByTime(250);
      }
    });

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(2));
    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      '/sermons/{sermon_id}/progress',
      expect.objectContaining({
        params: { path: { sermon_id: 's1' } },
        body: expect.objectContaining({ position_seconds: 20 }),
      }),
    );
  });

  it('reports the position delta since the last flush, clamped at the server ceiling', async () => {
    const { result } = renderHook(() => useProgressFlush('s1', 0, { intervalMs: INTERVAL_MS }), {
      wrapper: wrapWithQueryClient(),
    });

    act(() => {
      result.current.reportPosition(9999);
      result.current.flushNow();
    });

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith(
      '/sermons/{sermon_id}/progress',
      expect.objectContaining({ body: expect.objectContaining({ position_seconds: 9999, watched_delta: 3600 }) }),
    );
  });

  it('does not flush on the initial mount (playing starts false, not a pause)', () => {
    renderHook(() => useProgressFlush('s1', 42, { intervalMs: INTERVAL_MS }), {
      wrapper: wrapWithQueryClient(),
    });

    expect(mockedPost).not.toHaveBeenCalled();
  });
});

describe('useProgressFlush — event-triggered flushes', () => {
  it('flushes immediately on pause (playing -> not playing)', async () => {
    const { result } = renderHook(() => useProgressFlush('s1', 0, { intervalMs: INTERVAL_MS }), {
      wrapper: wrapWithQueryClient(),
    });

    act(() => {
      result.current.reportPlaying(true);
      result.current.reportPosition(12);
    });
    expect(mockedPost).not.toHaveBeenCalled();

    act(() => {
      result.current.reportPlaying(false);
    });

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith(
      '/sermons/{sermon_id}/progress',
      expect.objectContaining({ body: expect.objectContaining({ position_seconds: 12 }) }),
    );
  });

  it('flushes immediately with completed: true on playToEnd', async () => {
    const { result } = renderHook(() => useProgressFlush('s1', 0, { intervalMs: INTERVAL_MS }), {
      wrapper: wrapWithQueryClient(),
    });

    act(() => {
      result.current.reportPosition(120);
      result.current.reportCompleted();
    });

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith(
      '/sermons/{sermon_id}/progress',
      expect.objectContaining({ body: expect.objectContaining({ position_seconds: 120, completed: true }) }),
    );
  });

  it('flushes immediately when the app backgrounds mid-playback', async () => {
    // `AppState.addEventListener` is already a `jest.fn()` from RN's own jest preset
    // (`react-native/jest/setup.js`) — one shared instance for the whole file, its call
    // history accumulating across every earlier test's hook mount. Clear it first so
    // "the 'change' registration" below is unambiguously this test's own hook, not a
    // stale listener from an earlier test that never turned playback on.
    const addEventListenerMock = AppState.addEventListener as jest.Mock;
    addEventListenerMock.mockClear();

    const { result } = renderHook(() => useProgressFlush('s1', 0, { intervalMs: INTERVAL_MS }), {
      wrapper: wrapWithQueryClient(),
    });

    act(() => {
      result.current.reportPlaying(true);
      result.current.reportPosition(30);
    });
    expect(mockedPost).not.toHaveBeenCalled();

    const changeListener = addEventListenerMock.mock.calls.find(([event]) => event === 'change')?.[1];
    expect(changeListener).toBeDefined();

    act(() => {
      changeListener?.('background');
    });

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith(
      '/sermons/{sermon_id}/progress',
      expect.objectContaining({ body: expect.objectContaining({ position_seconds: 30 }) }),
    );
  });

  it('flushes once on unmount even without an intervening pause/background event', async () => {
    const { result, unmount } = renderHook(() => useProgressFlush('s1', 0, { intervalMs: INTERVAL_MS }), {
      wrapper: wrapWithQueryClient(),
    });

    act(() => {
      result.current.reportPlaying(true);
      result.current.reportPosition(5);
    });
    expect(mockedPost).not.toHaveBeenCalled();

    unmount();

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
  });
});

describe('useProgressFlush — resume baseline', () => {
  it('seeds the last-flushed position from the resumed position, not zero', async () => {
    const { result } = renderHook(() => useProgressFlush('s1', 300, { intervalMs: INTERVAL_MS }), {
      wrapper: wrapWithQueryClient(),
    });

    // Playback resumes at 300s and moves forward a little before the first flush.
    act(() => {
      result.current.reportPosition(310);
      result.current.flushNow();
    });

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith(
      '/sermons/{sermon_id}/progress',
      expect.objectContaining({ body: expect.objectContaining({ position_seconds: 310, watched_delta: 10 }) }),
    );
  });
});
