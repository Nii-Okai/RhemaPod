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

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../../components/navigation/platform', () => ({
  usePlatformOS: jest.fn(() => 'ios'),
}));

jest.mock('expo-video');
jest.mock('@expo/vector-icons');

// `QueueList`'s per-item Share action pulls in `shareContent`, which pulls in the
// native `react-native-share` module — not present under Jest, same reasoning as the
// playlist screen's own test file already mocking this.
jest.mock('react-native-share', () => ({ __esModule: true, default: { open: jest.fn() } }));

// The comments panel reads connectivity through this one hook; mocking it (rather than
// `expo-network`, which has no native module under Jest) lets a test flip the device offline.
jest.mock('../../../lib/hooks/useIsOnline', () => ({ useIsOnline: jest.fn(() => true) }));
const mockedUseIsOnline = useIsOnline as jest.Mock;

// Explicit factory (not a bare automock) — an automock still has to `require()` the real
// module first, which pulls in `downloadManager.ts` -> `modules/rpa-crypto`'s real native
// module resolution (unavailable under Jest). `useDownloads` itself is a reconfigurable
// `jest.fn()` so a test can drive this screen's own offline-vs-streamed routing
// (`useDownloads().find(sermonId)` deciding whether to prefer the local file) rather than
// only the harmless empty default other tests rely on — there's no download-starting UI
// left on this screen itself (session 2026-10-09 — see the screen's own doc comment).
jest.mock('../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));
// This screen calls `useLocalPlayback` unconditionally too (see its own doc comment on
// the offline-vs-streamed split) — mocked to a harmless always-ready return so a test
// that puts a `ready` record into `find()` for 'sermon-1' to exercise that routing
// doesn't accidentally tip into the offline branch with no local file, which would
// otherwise render the "no playable audio or video" error instead of the player.
jest.mock('../../../lib/downloads/useLocalPlayback', () => ({
  useLocalPlayback: jest.fn(() => ({
    localUri: 'file:///downloads/sermon-1-local.mp4',
    isPreparing: false,
    error: null,
  })),
}));

const mockedUseDownloads = useDownloads as jest.Mock;
const mockDownload = jest.fn();

// Same reasoning as the `useDownloads`/`useLocalPlayback` mocks above: `useCachedSource`
// pulls in `fill.ts` -> `downloadManager.ts` -> `modules/rpa-crypto`'s real native module
// resolution. Mocked to the harmless "always a miss" default (`effectiveUrl: null`, which
// `variant.url = cacheSource.effectiveUrl ?? streamedVariant.url` falls back from) so
// every existing test here keeps exercising the plain stream URL unchanged; the cache's
// own hit/miss/exit-fill behavior is covered by `useCachedSource.test.ts` directly.
jest.mock('../../../lib/mediaCache/useCachedSource', () => ({
  useCachedSource: jest.fn(() => ({ isLoading: false, effectiveUrl: null, reportExit: jest.fn() })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockSetParams = jest.fn();
let mockParams: Record<string, string | undefined> = { id: 'sermon-1' };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, replace: mockReplace, setParams: mockSetParams }),
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
  media_type: 'audio',
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
  playlist = null,
}: {
  detail?: unknown;
  progress?: unknown;
  stream?: unknown;
  comments?: unknown[];
  playlist?: unknown;
} = {}) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/catalog/sermons/{sermon_id}') return Promise.resolve(detail);
    if (path === '/sermons/{sermon_id}/progress') return Promise.resolve(progress);
    if (path === '/sermons/{sermon_id}/stream') return Promise.resolve(stream);
    if (path === '/sermons/{sermon_id}/comments') {
      return Promise.resolve({ items: comments, total: comments.length, limit: 25, offset: 0 });
    }
    if (path === '/auth/me') return Promise.resolve(profile);
    if (path === '/playlists/{playlist_id}') return Promise.resolve(playlist);
    throw new Error(`unexpected path: ${path}`);
  });
}

function playlistItem(sermonId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `item-${sermonId}`,
    position: 0,
    added_at: '2026-10-10T00:00:00Z',
    sermon: { ...baseDetail, id: sermonId, title: `Title ${sermonId}`, ...overrides },
  };
}

function playlist(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Driving',
    description: null,
    is_public: false,
    cover_url: null,
    owner_name: 'Isaac N.A. Okai',
    item_count: 0,
    total_duration_seconds: 0,
    created_at: '2026-10-10T00:00:00Z',
    updated_at: null,
    items: [],
    ...overrides,
  };
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
  mockReplace.mockClear();
  mockSetParams.mockClear();
  mockDownload.mockClear();
  mockParams = { id: 'sermon-1' };
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
    download: mockDownload,
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

describe('PlayerScreen — not playable', () => {
  it('hands a sermon with no media to its detail page instead of the player', async () => {
    mockReads({ detail: { ...baseDetail, media_refs: [] } });
    renderPlayer();
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 'sermon-1' } }),
    );
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

describe('PlayerScreen — mute', () => {
  it('mutes and unmutes the player without pausing it', async () => {
    mockReads();
    const { findByTestId, getByLabelText, findByLabelText } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;

    fireEvent.press(getByLabelText('Mute'));
    expect(player.muted).toBe(true);
    fireEvent.press(await findByLabelText('Unmute'));
    expect(player.muted).toBe(false);
    expect(player.pause).not.toHaveBeenCalled();
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
    fireEvent.press(getByLabelText('Close player'));
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

describe('PlayerScreen — playlist queue', () => {
  it('advances to the next sermon in the queue on playToEnd, staying on this screen (setParams, not replace)', async () => {
    mockParams = { id: 'sermon-1', queue: 'sermon-1,sermon-2,sermon-3', queueIndex: '0' };
    mockReads();
    const { findByTestId, queryByLabelText } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;
    await act(async () => {
      player.__simulateReady(1862);
    });
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));

    await act(async () => {
      player.__simulatePlayToEnd();
    });

    expect(mockSetParams).toHaveBeenCalledWith({ id: 'sermon-2', queue: 'sermon-1,sermon-2,sermon-3', queueIndex: '1' });
    expect(mockReplace).not.toHaveBeenCalled();
    // Moved on by itself — never pins the single-sermon Replay control.
    expect(queryByLabelText('Replay')).toBeNull();
  });

  it('falls back to the ordinary Replay control at the end of the queue', async () => {
    mockParams = { id: 'sermon-3', queue: 'sermon-1,sermon-2,sermon-3', queueIndex: '2' };
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

    expect(mockSetParams).not.toHaveBeenCalled();
    expect(getByLabelText('Replay')).toBeTruthy();
  });

  it('wraps to the first item instead of stopping, when repeat is on', async () => {
    mockParams = {
      id: 'sermon-3',
      queue: 'sermon-1,sermon-2,sermon-3',
      queueIndex: '2',
      playlistId: 'p1',
      repeat: '1',
    };
    mockReads({ playlist: playlist({ items: [playlistItem('sermon-1'), playlistItem('sermon-2'), playlistItem('sermon-3')] }) });
    const { findByTestId } = renderPlayer();
    await findByTestId('video-view');
    const player = __lastMockPlayer!;
    await act(async () => {
      player.__simulateReady(1862);
    });
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));

    await act(async () => {
      player.__simulatePlayToEnd();
    });

    expect(mockSetParams).toHaveBeenCalledWith({
      id: 'sermon-1',
      queue: 'sermon-1,sermon-2,sermon-3',
      queueIndex: '0',
      playlistId: 'p1',
      repeat: '1',
    });
  });
});

describe('PlayerScreen — queue list', () => {
  function renderWithQueue(overrides: Partial<Record<string, string>> = {}) {
    mockParams = {
      id: 'sermon-1',
      queue: 'sermon-1,sermon-2',
      queueIndex: '0',
      playlistId: 'p1',
      ...overrides,
    };
    mockReads({
      playlist: playlist({ items: [playlistItem('sermon-1'), playlistItem('sermon-2')] }),
    });
    return renderPlayer();
  }

  it('shows the queue list (playlist name, position, owner, private lock) instead of comments', async () => {
    const { findByText } = renderWithQueue();

    expect(await findByText(/Driving/)).toBeTruthy();
    expect(await findByText('1/2')).toBeTruthy();
    expect(await findByText('Isaac N.A. Okai')).toBeTruthy();
    expect(await findByText('Title sermon-2')).toBeTruthy();
  });

  it('tapping another row jumps playback to it, staying on this screen (setParams, not replace)', async () => {
    const { findByLabelText } = renderWithQueue();

    fireEvent.press(await findByLabelText('Play Title sermon-2'));

    expect(mockSetParams).toHaveBeenCalledWith({ id: 'sermon-2', queue: 'sermon-1,sermon-2', queueIndex: '1', playlistId: 'p1' });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('toggling repeat updates the route param without a remount (setParams, not replace)', async () => {
    const { findByLabelText } = renderWithQueue();

    fireEvent.press(await findByLabelText('Repeat this queue'));

    expect(mockSetParams).toHaveBeenCalledWith({ repeat: '1' });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shuffle reorders only the not-yet-played tail, leaving the current item in place', async () => {
    const { findByLabelText } = renderWithQueue({ queue: 'sermon-1,sermon-2,sermon-3', queueIndex: '0' });

    fireEvent.press(await findByLabelText('Shuffle the rest of this queue'));

    expect(mockSetParams).toHaveBeenCalledTimes(1);
    const [{ queue: newQueue }] = mockSetParams.mock.calls[0];
    expect(newQueue.startsWith('sermon-1,')).toBe(true);
    expect(newQueue.split(',').sort()).toEqual(['sermon-1', 'sermon-2', 'sermon-3']);
  });

  it('a queue row\'s "..." menu downloads, removes from the playlist, or shares that item', async () => {
    const { findByLabelText, getByLabelText } = renderWithQueue();

    fireEvent.press(await findByLabelText('More options for Title sermon-2'));
    fireEvent.press(getByLabelText('Download'));

    expect(mockDownload).toHaveBeenCalledWith('sermon-2', 'Title sermon-2', 'audio', expect.any(String), 'Teaching');

    fireEvent.press(await findByLabelText('More options for Title sermon-2'));
    fireEvent.press(getByLabelText('Remove from playlist'));

    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith('/playlists/{playlist_id}/items/{item_id}', {
        params: { path: { playlist_id: 'p1', item_id: 'item-sermon-2' } },
      }),
    );
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
    const { findByText, findByLabelText, getByTestId } = renderPlayer();
    expect(await findByText('Blessed by this.')).toBeTruthy();
    expect(await findByLabelText('1 comment')).toBeTruthy();
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

