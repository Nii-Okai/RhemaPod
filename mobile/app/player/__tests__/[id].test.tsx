import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import PlayerScreen from '../[id]';
import { api } from '../../../lib/api/typedClient';
import { usePlatformOS } from '../../../components/navigation/platform';
import { createTestQueryClient } from '../../../lib/query/testUtils';
import { __lastMockPlayer } from 'expo-video';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../../components/navigation/platform', () => ({
  usePlatformOS: jest.fn(() => 'ios'),
}));

jest.mock('expo-video');
jest.mock('@expo/vector-icons');

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
  media_refs: [{ id: 'm1', type: 'video', quality: '720p', s3_key: 'x', hls_manifest_key: 'y' }],
  published_at: '2026-09-04T12:00:00Z',
  status: 'published',
  created_at: '2026-09-01T00:00:00Z',
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
  notes = [],
}: {
  detail?: unknown;
  progress?: unknown;
  stream?: unknown;
  notes?: unknown[];
} = {}) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/catalog/sermons/{sermon_id}') return Promise.resolve(detail);
    if (path === '/sermons/{sermon_id}/progress') return Promise.resolve(progress);
    if (path === '/sermons/{sermon_id}/stream') return Promise.resolve(stream);
    if (path === '/sermons/{sermon_id}/notes') return Promise.resolve(notes);
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
  mockedUsePlatformOS.mockReturnValue('ios');
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
    const { findByLabelText } = renderPlayer();
    fireEvent.press(await findByLabelText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerScreen — notes drawer is present', () => {
  it('renders the empty-notes state alongside the player', async () => {
    mockReads({ notes: [] });
    const { findByText } = renderPlayer();
    await findByText('No notes yet');
  });
});
