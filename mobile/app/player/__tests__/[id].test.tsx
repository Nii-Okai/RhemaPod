import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import PlayerScreen from '../[id]';
import { api } from '../../../lib/api/typedClient';
import { usePlatformOS } from '../../../components/navigation/platform';
import { createTestQueryClient } from '../../../lib/query/testUtils';
// Imported from the mock file's own relative path (not the bare `'expo-video'`
// specifier) purely so `tsc` — which doesn't know about Jest's manual-mock
// substitution — can see this member really exists; Jest resolves both this path and
// every `'expo-video'` import in the app code under test to the exact same file, so
// `__lastMockPlayer` is the same live binding either way.
import { __enterFullscreen, __exitFullscreen, __lastMockPlayer } from '../../../__mocks__/expo-video';
import { useIsOnline } from '../../../lib/hooks/useIsOnline';
import { useDownloads } from '../../../lib/downloads/useDownloads';
import type { DownloadRecord } from '../../../lib/downloads/types';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../../components/navigation/platform', () => ({
  usePlatformOS: jest.fn(() => 'ios'),
}));

jest.mock('expo-video');
jest.mock('@expo/vector-icons');

// The comments panel reads connectivity through this one hook; mocking it (rather than
// `expo-network`, which has no native module under Jest) lets a test flip the device offline.
jest.mock('../../../lib/hooks/useIsOnline', () => ({ useIsOnline: jest.fn(() => true) }));
const mockedUseIsOnline = useIsOnline as jest.Mock;

// Explicit factory (not a bare automock) — an automock still has to `require()` the real
// module first, which pulls in `downloadManager.ts` -> `modules/rpa-crypto`'s real native
// module resolution (unavailable under Jest). `useDownloads` itself is a reconfigurable
// `jest.fn()` (same pattern as `_detail/__tests__/DownloadButton.test.tsx`) so the
// "download button" describe block below can drive each state (queued/downloading/ready/
// failed) rather than only the harmless empty default other tests rely on.
jest.mock('../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));

const mockedUseDownloads = useDownloads as jest.Mock;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'sermon-1' }),
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('expo-sqlite/kv-store', () => ({
  AsyncStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

const mockedGet = api.get as jest.Mock;
const mockedUsePlatformOS = usePlatformOS as jest.Mock;

const baseDetail = {
  id: 'sermon-1',
  title: 'Anchored in the Storm',
  description: 'A word for the weary.',
  thumbnail_url: 'https://cdn.example.com/art.jpg',
  duration_seconds: 1862,
  category_id: 'c1',
  category_name: 'Teaching',
  speaker_id: 'sp1',
  speaker_name: 'Ada Nwosu',
  series_id: null,
  series_title: null,
  episode_number: null,
  tier: 'free',
  locked: false,
  tags: ['grief', 'hope'],
  media_refs: [
    { id: 'm1', type: 'video', quality: '720p', s3_key: 'x', hls_manifest_key: 'y' },
    { id: 'm2', type: 'audio', quality: 'aac', s3_key: 'z', hls_manifest_key: null },
  ],
  published_at: '2026-09-04T12:00:00Z',
  status: 'published',
  created_at: '2026-09-01T00:00:00Z',
};

const profile = {
  id: 'user-1',
  email: 'ada@example.com',
  full_name: 'Ada Nwosu',
  role: 'member',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  activated_at: '2024-01-02T00:00:00Z',
  comments_terms_accepted_at: '2026-10-01T00:00:00Z',
};

const baseStream = {
  sermon_id: 'sermon-1',
  expires_in: 21600,
  variants: [{ type: 'video', quality: '720p', url: 'https://stream.example.com/signed.m3u8' }],
};

function mockReads({
  detail = baseDetail,
  progress = null,
  stream = baseStream,
  comments = [],
}: {
  detail?: unknown;
  progress?: unknown;
  stream?: unknown;
  comments?: unknown[];
} = {}) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/catalog/sermons/{sermon_id}') return Promise.resolve(detail);
    if (path === '/sermons/{sermon_id}/progress') return Promise.resolve(progress);
    if (path === '/sermons/{sermon_id}/stream') return Promise.resolve(stream);
    if (path === '/sermons/{sermon_id}/comments') {
      return Promise.resolve({ items: comments, total: comments.length, limit: 25, offset: 0 });
    }
    if (path === '/auth/me') return Promise.resolve(profile);
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderPlayer() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <PlayerScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockBack.mockClear();
  mockedUseIsOnline.mockReturnValue(true);
  __enterFullscreen.mockClear();
  __exitFullscreen.mockClear();
  mockedUsePlatformOS.mockReturnValue('ios');
  mockedUseDownloads.mockReset();
  mockedUseDownloads.mockReturnValue({
    downloads: [],
    isLoading: false,
    wifiOnly: true,
    isSavingWifiOnly: false,
    setWifiOnly: jest.fn(),
    download: jest.fn(),
    retry: jest.fn(),
    remove: jest.fn(),
    find: jest.fn(() => undefined),
  });
});

describe('PlayerScreen — loading', () => {
  it('shows a loading state before detail/stream/progress all resolve', () => {
    mockedGet.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText } = renderPlayer();
    expect(getByLabelText('Loading sermon')).toBeTruthy();
  });
});

describe('PlayerScreen — detail fetch error', () => {
  it('shows an error state with a working retry', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));
    const { findByText } = renderPlayer();

    await findByText('Something went wrong loading this sermon.');

    mockReads();
    fireEvent.press(await findByText('Try again'));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/catalog/sermons/{sermon_id}', expect.anything()));
  });
});

describe('PlayerScreen — not playable (deep-link guard)', () => {
  it('shows a friendly message instead of crashing when media_refs is empty', async () => {
    mockReads({ detail: { ...baseDetail, media_refs: [] } });
    const { findByText } = renderPlayer();
    await findByText("This sermon isn't available yet.");
  });
});

describe('PlayerScreen — stream fetch error', () => {
  it('shows an error state scoped to the playback link, with retry', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/catalog/sermons/{sermon_id}') return Promise.resolve(baseDetail);
      if (path === '/sermons/{sermon_id}/progress') return Promise.resolve(null);
      if (path === '/sermons/{sermon_id}/stream') return Promise.reject(new Error('boom'));
      throw new Error(`unexpected path: ${path}`);
    });
    const { findByText } = renderPlayer();
    await findByText("Couldn't load this sermon's playback link.");
  });
});

describe('PlayerScreen — no playable variant', () => {
  it('shows a message when the stream response has no usable variant', async () => {
    mockReads({ stream: { ...baseStream, variants: [] } });
    const { findByText } = renderPlayer();
    await findByText('No playable audio or video was found for this sermon.');
  });
});

describe('PlayerScreen — fresh playback', () => {
  it('creates the player with the signed URL and metadata, autoplaying once ready', async () => {
    mockReads();
    const { findByTestId } = renderPlayer();

    await findByTestId('video-view');
    const player = __lastMockPlayer!;
    expect(player).toBeTruthy();

    await act(async () => {
      player.__simulateReady(1862);
    });

    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));
    expect(player.currentTime).toBe(0); // fresh — nothing to seek to
  });

  it('shows the buffering overlay while status is loading, hides it once ready', async () => {
    mockReads();
    const { findByLabelText, queryByLabelText } = renderPlayer();

    await findByLabelText('Buffering');

    const player = __lastMockPlayer!;
    await act(async () => {
      player.__simulateReady(1862);
    });

    await waitFor(() => expect(queryByLabelText('Buffering')).toBeNull());
  });

  it('flushes progress on pause via the real progress-flush wiring, not per tick', async () => {
    mockReads();
    const { findByTestId, getByLabelText } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;

    await act(async () => {
      player.__simulateReady(1862);
    });
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));

    await act(async () => {
      player.__simulateTimeUpdate(42);
    });

    const postCallsBeforePause = (api.post as jest.Mock).mock.calls.length;
    fireEvent.press(getByLabelText('Pause'));

    await waitFor(() =>
      expect((api.post as jest.Mock).mock.calls.length).toBeGreaterThan(postCallsBeforePause),
    );
    expect(api.post).toHaveBeenCalledWith(
      '/sermons/{sermon_id}/progress',
      expect.objectContaining({ body: expect.objectContaining({ position_seconds: 42 }) }),
    );
  });
});

describe('PlayerScreen — resume', () => {
  it('seeks to the resumed position before playing', async () => {
    mockReads({ progress: { sermon_id: 'sermon-1', position_seconds: 600, completed: false, play_count: 2, watched_seconds: 600, last_played_at: '2026-09-10T00:00:00Z' } });
    const { findByTestId } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;

    await act(async () => {
      player.__simulateReady(1862);
    });

    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));
    expect(player.currentTime).toBe(600);
  });

  it('treats a completed sermon as Fresh (starts from zero, not the old completed position)', async () => {
    mockReads({ progress: { sermon_id: 'sermon-1', position_seconds: 1862, completed: true, play_count: 3, watched_seconds: 1862, last_played_at: '2026-09-10T00:00:00Z' } });
    const { findByTestId } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;

    await act(async () => {
      player.__simulateReady(1862);
    });

    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));
    expect(player.currentTime).toBe(0);
  });
});

describe('PlayerScreen — speed control', () => {
  it('cycles the mock player\'s playbackRate on tap', async () => {
    mockReads();
    const { findByTestId, getByLabelText } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;

    fireEvent.press(getByLabelText('Playback speed, 1×'));
    await waitFor(() => expect(player.playbackRate).toBe(1.25));
  });
});

describe('PlayerScreen — back control', () => {
  it('fires router.back() from the header', async () => {
    mockReads();
    const { findByTestId, getByLabelText } = renderPlayer();
    // Wait for the resolved screen: the loading state has its own (soon unmounted) header.
    await findByTestId('video-view');
    fireEvent.press(getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerScreen — header', () => {
  it('shows the sermon title beside the back control', async () => {
    mockReads();
    const { findByText } = renderPlayer();
    expect(await findByText('Anchored in the Storm')).toBeTruthy();
  });
});

describe('PlayerScreen — 10 second skip', () => {
  it('rewinds and skips forward by 10 seconds from the overlay', async () => {
    mockReads();
    const { findByTestId, getByLabelText } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;
    await act(async () => {
      player.__simulateReady(1862);
    });
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));

    fireEvent.press(getByLabelText('Skip forward 10 seconds'));
    expect(player.seekBy).toHaveBeenLastCalledWith(10);
    fireEvent.press(getByLabelText('Rewind 10 seconds'));
    expect(player.seekBy).toHaveBeenLastCalledWith(-10);
  });

  it('seeks by 10 from the seek bar\'s accessibility actions too', async () => {
    mockReads();
    const { findByTestId, getByLabelText } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;
    await act(async () => {
      player.__simulateReady(1862); // the seek bar is inert until a duration is known
    });

    fireEvent(getByLabelText('Seek'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(player.seekBy).toHaveBeenLastCalledWith(10);
  });
});

describe('PlayerScreen — overlay', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('auto-hides 3s after playback starts and comes back on a tap of the video', async () => {
    jest.useFakeTimers();
    mockReads();
    const { findByTestId, getByLabelText, queryByLabelText } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;
    await act(async () => {
      player.__simulateReady(1862);
    });
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));
    expect(getByLabelText('Hide playback controls')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(3100); // the 3s auto-hide fires, the fade-out starts
    });
    await act(async () => {
      jest.advanceTimersByTime(300); // the fade-out finishes and the controls unmount
    });
    expect(getByLabelText('Show playback controls')).toBeTruthy();
    expect(queryByLabelText('Skip forward 10 seconds')).toBeNull();

    fireEvent.press(getByLabelText('Show playback controls'));
    expect(getByLabelText('Hide playback controls')).toBeTruthy();
  });

  it('does not auto-hide while paused', async () => {
    jest.useFakeTimers();
    mockReads();
    const { findByTestId, getByLabelText } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;
    await act(async () => {
      player.__simulateReady(1862);
    });
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));
    fireEvent.press(getByLabelText('Pause'));

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(getByLabelText('Hide playback controls')).toBeTruthy();
    expect(getByLabelText('Play')).toBeTruthy();
  });
});

describe('PlayerScreen — replay', () => {
  it('resumes playback, not just seeks to 0 — player.replay() alone does not play', async () => {
    mockReads();
    const { findByTestId, getByLabelText } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;
    await act(async () => {
      player.__simulateReady(1862);
    });
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));

    await act(async () => {
      player.__simulatePlayToEnd();
    });
    expect(getByLabelText('Replay')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByLabelText('Replay'));
    });
    expect(player.replay).toHaveBeenCalledTimes(1);
    // The real bug: `player.replay()` only seeks to 0 (its own doc comment says so) — without
    // this second call, pressing Replay silently leaves the sermon paused at frame 0.
    expect(player.play).toHaveBeenCalledTimes(2);
  });
});

describe('PlayerScreen — fullscreen', () => {
  it('asks the video view for native fullscreen', async () => {
    mockReads();
    const { findByTestId, getByLabelText } = renderPlayer();
    await findByTestId('video-view');
    await act(async () => {
      fireEvent.press(getByLabelText('Enter full screen'));
    });
    expect(__enterFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerScreen — comments', () => {
  it('renders the comments panel beside the player', async () => {
    mockReads({
      comments: [
        {
          id: 'c1',
          sermon_id: 'sermon-1',
          author_display_name: 'Pat Q.',
          body: 'Blessed by this.',
          created_at: '2026-10-01T00:00:00Z',
          is_mine: false,
          status: 'VISIBLE',
          hidden_label: null,
        },
      ],
    });
    const { findByText, getByTestId } = renderPlayer();
    expect(await findByText('Blessed by this.')).toBeTruthy();
    expect(await findByText('1 comment')).toBeTruthy();
    expect(getByTestId('video-view')).toBeTruthy();
  });

  it('shows "Comments unavailable offline" and never blocks playback', async () => {
    mockedUseIsOnline.mockReturnValue(false);
    mockReads();
    const { findByTestId, findByText, getByLabelText, queryByText } = renderPlayer();

    expect(await findByText('Comments unavailable offline')).toBeTruthy();
    expect(queryByText('Write a comment')).toBeNull();
    expect(mockedGet).not.toHaveBeenCalledWith('/sermons/{sermon_id}/comments', expect.anything());

    // Playback is untouched: the video mounts, starts when ready, and the controls work.
    await findByTestId('video-view');
    const player = __lastMockPlayer!;
    await act(async () => {
      player.__simulateReady(1862);
    });
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));
    fireEvent.press(getByLabelText('Pause'));
    expect(player.pause).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerScreen — download button', () => {
  // Same `DownloadButton` component sermon-detail wires (`_detail/DownloadButton.tsx`),
  // composed here against the Player screen's own sermon identity (the route param /
  // `detail.id` the rest of this screen already plays from) — this proves it's the
  // *currently playing* sermon driving the button, not a second, independently-derived id.
  function record(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
    return {
      sermonId: 'sermon-1',
      title: 'Anchored in the Storm',
      state: 'ready',
      progress: 1,
      bytesTotal: 1000,
      failureReason: null,
      failureMessage: null,
      keyIdHex: '00',
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  it('shows a Download control for the playing sermon when nothing is queued yet, and starts a download on press', async () => {
    mockReads();
    const download = jest.fn();
    mockedUseDownloads.mockReturnValue({
      downloads: [],
      isLoading: false,
      wifiOnly: true,
      isSavingWifiOnly: false,
      setWifiOnly: jest.fn(),
      download,
      retry: jest.fn(),
      remove: jest.fn(),
      find: jest.fn((id: string) => (id === 'sermon-1' ? undefined : record())),
    });

    const { findByText } = renderPlayer();
    fireEvent.press(await findByText('Download for offline'));
    expect(download).toHaveBeenCalledWith('sermon-1', 'Anchored in the Storm');
  });

  it('shows a queued state for the playing sermon', async () => {
    mockReads();
    mockedUseDownloads.mockReturnValue({
      downloads: [],
      isLoading: false,
      wifiOnly: true,
      isSavingWifiOnly: false,
      setWifiOnly: jest.fn(),
      download: jest.fn(),
      retry: jest.fn(),
      remove: jest.fn(),
      find: jest.fn((id: string) => (id === 'sermon-1' ? record({ state: 'queued', progress: 0 }) : undefined)),
    });

    const { findByText } = renderPlayer();
    await findByText('Queued for download');
  });

  it('shows download progress for the playing sermon', async () => {
    mockReads();
    mockedUseDownloads.mockReturnValue({
      downloads: [],
      isLoading: false,
      wifiOnly: true,
      isSavingWifiOnly: false,
      setWifiOnly: jest.fn(),
      download: jest.fn(),
      retry: jest.fn(),
      remove: jest.fn(),
      find: jest.fn((id: string) =>
        id === 'sermon-1' ? record({ state: 'downloading', progress: 0.65 }) : undefined,
      ),
    });

    const { findByText } = renderPlayer();
    await findByText('Downloading… 65%');
  });

  it('shows a Downloaded state with a working delete, scoped to the playing sermon', async () => {
    mockReads();
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue({
      downloads: [],
      isLoading: false,
      wifiOnly: true,
      isSavingWifiOnly: false,
      setWifiOnly: jest.fn(),
      download: jest.fn(),
      retry: jest.fn(),
      remove,
      find: jest.fn((id: string) => (id === 'sermon-1' ? record({ state: 'ready' }) : undefined)),
    });

    const { findByText, getByLabelText } = renderPlayer();
    await findByText('Downloaded for offline');
    fireEvent.press(getByLabelText('Delete downloaded Anchored in the Storm'));
    expect(remove).toHaveBeenCalledWith('sermon-1');
  });

  it('shows the real failure reason with a working Retry for the playing sermon', async () => {
    mockReads();
    const retry = jest.fn();
    mockedUseDownloads.mockReturnValue({
      downloads: [],
      isLoading: false,
      wifiOnly: true,
      isSavingWifiOnly: false,
      setWifiOnly: jest.fn(),
      download: jest.fn(),
      retry,
      remove: jest.fn(),
      find: jest.fn((id: string) =>
        id === 'sermon-1'
          ? record({
              state: 'failed',
              failureReason: 'no_audio',
              failureMessage: "This sermon doesn't have an audio version available to download.",
            })
          : undefined,
      ),
    });

    const { findByText } = renderPlayer();
    await findByText("This sermon doesn't have an audio version available to download.");
    fireEvent.press(await findByText('Retry'));
    expect(retry).toHaveBeenCalledWith('sermon-1');
  });

  it('renders no download affordance when the playing sermon has no audio rendition', async () => {
    mockReads({ detail: { ...baseDetail, media_refs: [baseDetail.media_refs[0]] } });
    const { queryByText } = renderPlayer();
    await waitFor(() => expect(queryByText('Download for offline')).toBeNull());
  });
});
