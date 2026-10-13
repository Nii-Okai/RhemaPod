import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Platform } from 'react-native';
import RNShare from 'react-native-share';
import SeriesDetailScreen from '../[id]';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';
import { useDownloads } from '../../../lib/downloads/useDownloads';

jest.mock('@expo/vector-icons');

// `react-native-share` resolves its real native module (`RNShare`) at import time —
// unavailable under Jest, same gap as every other native module this app mocks. This
// screen's own Share-button coverage only needs the call to go somewhere; the actual
// composed-message/thumbnail-download logic is `lib/share/__tests__/shareContent.test.ts`'s.
jest.mock('react-native-share', () => ({ __esModule: true, default: { open: jest.fn() } }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// `DownloadPillButton` (rendered under the Play CTA) pulls in the real download stack
// (SQLite, the native crypto module) if left unmocked — this screen's own tests care
// about CTA/episode/navigation behaviour, not the download state machine itself, which
// `DownloadPillButton.test.tsx` already covers directly.
jest.mock('../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));
const mockedUseDownloads = useDownloads as jest.Mock;

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockDismissAll = jest.fn();
let mockParams: Record<string, string | undefined> = { id: 's1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, dismissAll: mockDismissAll }),
  useLocalSearchParams: () => mockParams,
}));

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPut = api.put as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const seriesDetail = {
  id: 's1',
  title: 'Anchored',
  description: 'A study of trust in the storm.',
  thumbnail_url: 'https://cdn.example.com/anchored.jpg',
  category_id: 'c1',
  category_name: 'Faith',
  status: 'published',
  tier: 'free',
  episode_count: 3,
  like_count: 0,
  liked_by_me: false,
};

function episode(overrides: Record<string, unknown>) {
  return {
    id: 'ep',
    title: 'Episode',
    description: null,
    thumbnail_url: null,
    duration_seconds: 1800,
    speaker_id: null,
    speaker_name: null,
    category_id: null,
    category_name: null,
    series_id: 's1',
    series_title: 'Anchored',
    episode_number: 1,
    tier: 'free',
    locked: false,
    media_type: 'audio',
    ...overrides,
  };
}

const episodes = [
  episode({ id: 'e1', title: 'Part One', episode_number: 1, duration_seconds: 2538, speaker_name: 'Ada Nwosu' }),
  episode({ id: 'e2', title: 'Part Two', episode_number: 2, duration_seconds: 1800 }),
  episode({ id: 'e3', title: 'Bonus Q&A', episode_number: null, duration_seconds: 900 }),
];

const history = [
  { sermon_id: 'e1', position_seconds: 2538, watched_seconds: 2538, completed: true, play_count: 1, last_played_at: '2026-09-01T00:00:00Z' },
  { sermon_id: 'e2', position_seconds: 600, watched_seconds: 600, completed: false, play_count: 1, last_played_at: '2026-09-02T00:00:00Z' },
];

const relatedSearchResults = {
  query: null,
  total: 2,
  limit: 20,
  offset: 0,
  series: [],
  series_total: 0,
  speakers: [],
  speakers_total: 0,
  results: [
    episode({ id: 'e1', title: 'Part One', series_id: 's1', category_id: 'c1' }),
    episode({ id: 'other-sermon', title: 'Standing Firm', series_id: 's2', speaker_name: 'Pastor Grace', category_id: 'c1' }),
  ],
};

function mockHappyPath() {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/series/{series_id}') return Promise.resolve(seriesDetail);
    if (path === '/series/{series_id}/episodes') return Promise.resolve(episodes);
    if (path === '/me/history') return Promise.resolve(history);
    if (path === '/search') return Promise.resolve(relatedSearchResults);
    // No "My List" playlist yet — `useAddToDefaultLibrary`'s own "create on first add".
    if (path === '/playlists') return Promise.resolve([]);
    throw new Error(`Unexpected path: ${path}`);
  });
}

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SeriesDetailScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPut.mockReset();
  mockedDelete.mockReset();
  mockPush.mockClear();
  mockBack.mockClear();
  mockDismissAll.mockClear();
  mockParams = { id: 's1' };
  Platform.OS = 'ios';
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

describe('SeriesDetailScreen — populated', () => {
  it('renders title, meta line, tier tag, and synopsis', async () => {
    mockHappyPath();
    const { findByText, getByText } = renderScreen();

    await findByText('Anchored');
    expect(getByText('3 episodes · Faith')).toBeTruthy();
    expect(getByText('Free')).toBeTruthy();
    expect(getByText('A study of trust in the storm.')).toBeTruthy();
  });

  it('renders every episode, with no visible episode-number badge', async () => {
    mockHappyPath();
    const { findByText, getByText, queryByText } = renderScreen();
    await findByText('Part One');
    expect(getByText('Part Two')).toBeTruthy();
    expect(getByText('Bonus Q&A')).toBeTruthy();
    expect(queryByText('01')).toBeNull();
    expect(queryByText('02')).toBeNull();
    expect(queryByText('00')).toBeNull();
  });

  it('renders each episode\'s own duration, not a watch-status label', async () => {
    mockHappyPath();
    const { findByText, getByText, queryByText } = renderScreen();
    await findByText('Part One');
    expect(getByText('42:18')).toBeTruthy();
    expect(getByText('30:00')).toBeTruthy();
    expect(getByText('15:00')).toBeTruthy();
    expect(queryByText('watched')).toBeNull();
    expect(queryByText('new')).toBeNull();
    expect(mockedGet.mock.calls.filter(([path]) => path === '/me/history')).toHaveLength(1);
  });

  it('scopes the /me/history call to this series (Decision 6) instead of the app-wide capped read', async () => {
    mockHappyPath();
    const { findByText } = renderScreen();
    await findByText('Part One');
    expect(mockedGet).toHaveBeenCalledWith(
      '/me/history',
      expect.objectContaining({ params: { query: { series_id: 's1' } } }),
    );
  });

  it('shows Resume, targeting the in-progress episode with remaining time, and navigates to it on press', async () => {
    mockHappyPath();
    const { findByLabelText } = renderScreen();

    const cta = await findByLabelText('Resume, 20:00 remaining');
    expect(cta).toBeTruthy();

    fireEvent.press(cta);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/sermon/related/[id]',
      params: { id: 'e2', related: '1' },
    });
  });

  it('navigates to /sermon/related/[id] on episode row tap, with the back-chevron param (Isaac\'s ask, session 2026-10-01)', async () => {
    mockHappyPath();
    const { findByText, getByText } = renderScreen();
    await findByText('Part One');
    fireEvent.press(getByText('Part One'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/sermon/related/[id]',
      params: { id: 'e1', related: '1' },
    });
  });

  it('gives every episode row a number/title/speaker accessibility label (even with no visible number badge), numbered and unnumbered alike', async () => {
    mockHappyPath();
    const { findByLabelText } = renderScreen();
    expect(await findByLabelText('Episode 01, Part One, Ada Nwosu')).toBeTruthy();
    expect(await findByLabelText('Bonus Q&A')).toBeTruthy();
  });

  it('fires router.dismissAll() when the close control is pressed — closes every page, not just one level', async () => {
    mockHappyPath();
    const { findByLabelText } = renderScreen();
    fireEvent.press(await findByLabelText('Close'));
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('renders a disabled cast control rather than a fake working one', async () => {
    mockHappyPath();
    const { findByLabelText } = renderScreen();
    const cast = await findByLabelText('Cast');
    expect(cast.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });
});

describe('SeriesDetailScreen — tabs', () => {
  it('shows episodes by default and switches to Related on press, showing other sermons (no title/duration text) not this series\' own episodes', async () => {
    mockHappyPath();
    const { findByText, getByText, getByTestId, queryByText, findByLabelText } = renderScreen();
    await findByText('Part One');

    fireEvent.press(getByText('Related'));

    await findByLabelText('Standing Firm');
    expect(queryByText('Part One')).toBeNull();
    expect(queryByText('Standing Firm')).toBeNull();
    expect(getByTestId('detail-tab-related').props.accessibilityState).toEqual({ selected: true });
    expect(mockedGet).toHaveBeenCalledWith('/search', expect.anything());
  });

  it('navigates to /sermon/[id] when a related sermon is pressed', async () => {
    mockHappyPath();
    const { findByText, getByText, findByLabelText } = renderScreen();
    await findByText('Part One');

    fireEvent.press(getByText('Related'));

    fireEvent.press(await findByLabelText('Standing Firm'));
    // Pushes the *second* route (`sermon/related/[id]`, not plain `sermon/[id]`) so the
    // regular horizontal push applies — see `app/sermon/related/[id].tsx`'s own doc
    // comment. `related: '1'` still rides along so the screen itself shows a back
    // chevron alongside Cast/Close.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/sermon/related/[id]',
      params: { id: 'other-sermon', related: '1' },
    });
  });
});

describe('SeriesDetailScreen — Play CTA (no watch history)', () => {
  it('shows Play, targeting the first episode', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/series/{series_id}') return Promise.resolve(seriesDetail);
      if (path === '/series/{series_id}/episodes') return Promise.resolve(episodes);
      if (path === '/me/history') return Promise.resolve([]);
      throw new Error(`Unexpected path: ${path}`);
    });
    const { findByLabelText } = renderScreen();

    const cta = await findByLabelText('Play Part One');
    fireEvent.press(cta);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/sermon/related/[id]',
      params: { id: 'e1', related: '1' },
    });
  });
});

describe('SeriesDetailScreen — Download pill', () => {
  it('downloads every episode in the series, not just the Play/Resume CTA episode (Isaac\'s ask, session 2026-10-08)', async () => {
    mockHappyPath();
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
      find: jest.fn(() => undefined),
    });
    const { findByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Download all episodes'));

    expect(download).toHaveBeenCalledWith('e1', 'Part One', 'audio', null, null);
    expect(download).toHaveBeenCalledWith('e2', 'Part Two', 'audio', null, null);
    expect(download).toHaveBeenCalledWith('e3', 'Bonus Q&A', 'audio', null, null);
    expect(download).toHaveBeenCalledTimes(3);
  });
});

describe('SeriesDetailScreen — Download all (action row)', () => {
  it('shows the episode count in its label and queues every episode on press', async () => {
    mockHappyPath();
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
      find: jest.fn(() => undefined),
    });
    const { findByLabelText, getByText } = renderScreen();

    const button = await findByLabelText('Download all 3 episodes');
    expect(getByText('Download\n3 Episodes')).toBeTruthy();

    fireEvent.press(button);

    expect(download).toHaveBeenCalledWith('e1', 'Part One', 'audio', null, null);
    expect(download).toHaveBeenCalledWith('e2', 'Part Two', 'audio', null, null);
    expect(download).toHaveBeenCalledWith('e3', 'Bonus Q&A', 'audio', null, null);
    expect(download).toHaveBeenCalledTimes(3);
  });

  it('does not render when the series has no episodes', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/series/{series_id}') return Promise.resolve(seriesDetail);
      if (path === '/series/{series_id}/episodes') return Promise.resolve([]);
      if (path === '/me/history') return Promise.resolve([]);
      throw new Error(`Unexpected path: ${path}`);
    });
    const { findByText, queryByLabelText } = renderScreen();

    await findByText('No episodes yet. Check back once this series has published episodes.');
    expect(queryByLabelText(/Download all/)).toBeNull();
  });
});

describe('SeriesDetailScreen — My List', () => {
  it('adds every episode to a "My List" playlist, creating it on the first-ever add', async () => {
    mockHappyPath();
    mockedPost.mockImplementation((path: string) => {
      if (path === '/playlists') return Promise.resolve({ id: 'p1', name: 'My List', item_count: 0 });
      if (path === '/playlists/{playlist_id}/items') return Promise.resolve({ id: 'p1', name: 'My List', item_count: 1, items: [] });
      throw new Error(`Unexpected path: ${path}`);
    });
    const { findByLabelText } = renderScreen();

    const addButton = await findByLabelText('Add to My List');
    expect(addButton.props.accessibilityState).toEqual({ selected: false });

    fireEvent.press(addButton);

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/playlists', { body: { name: 'My List', description: null, is_public: true } }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/playlists/{playlist_id}/items', {
        params: { path: { playlist_id: 'p1' } },
        body: { sermon_id: 'e1' },
      }),
    );
    // All three episodes, in order — not just the first.
    expect(mockedPost).toHaveBeenCalledWith('/playlists/{playlist_id}/items', {
      params: { path: { playlist_id: 'p1' } },
      body: { sermon_id: 'e2' },
    });
    expect(mockedPost).toHaveBeenCalledWith('/playlists/{playlist_id}/items', {
      params: { path: { playlist_id: 'p1' } },
      body: { sermon_id: 'e3' },
    });
    // Exactly one playlist created, not one per episode.
    expect(mockedPost.mock.calls.filter((call) => call[0] === '/playlists')).toHaveLength(1);
  });

  it('shows "Remove from My List" once every episode has been added, and removes all of them on press', async () => {
    const itemsFor = (list: typeof episodes) =>
      list.map((ep, index) => ({ id: `item-${index}`, position: index, added_at: '2026-10-11T00:00:00Z', sermon: ep }));
    mockedGet.mockImplementation((path: string) => {
      if (path === '/series/{series_id}') return Promise.resolve(seriesDetail);
      if (path === '/series/{series_id}/episodes') return Promise.resolve(episodes);
      if (path === '/me/history') return Promise.resolve(history);
      if (path === '/search') return Promise.resolve(relatedSearchResults);
      if (path === '/playlists') return Promise.resolve([{ id: 'p1', name: 'My List', item_count: 3 }]);
      if (path === '/playlists/{playlist_id}')
        return Promise.resolve({ id: 'p1', name: 'My List', item_count: 3, items: itemsFor(episodes) });
      throw new Error(`Unexpected path: ${path}`);
    });
    mockedDelete.mockResolvedValue({ id: 'p1', name: 'My List', item_count: 0, items: [] });
    const { findByLabelText } = renderScreen();

    const removeButton = await findByLabelText('Remove from My List');
    expect(removeButton.props.accessibilityState).toEqual({ selected: true });

    fireEvent.press(removeButton);

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith('/playlists/{playlist_id}/items/{item_id}', {
        params: { path: { playlist_id: 'p1', item_id: 'item-0' } },
      }),
    );
    // All three episodes removed, not just the first.
    expect(mockedDelete).toHaveBeenCalledWith('/playlists/{playlist_id}/items/{item_id}', {
      params: { path: { playlist_id: 'p1', item_id: 'item-1' } },
    });
    expect(mockedDelete).toHaveBeenCalledWith('/playlists/{playlist_id}/items/{item_id}', {
      params: { path: { playlist_id: 'p1', item_id: 'item-2' } },
    });
  });
});

describe('SeriesDetailScreen — Share', () => {
  it('shares the series title, description, and deep link via react-native-share', async () => {
    mockHappyPath();
    const openSpy = RNShare.open as jest.Mock;
    const { findByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Share this series'));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Anchored',
          message: expect.stringContaining('Anchored'),
        }),
      ),
    );
    const call = openSpy.mock.calls[0][0];
    expect(call.message).toContain('A study of trust in the storm.');
    expect(call.message).toContain('rhemapod://series/s1');
  });
});

describe('SeriesDetailScreen — Like', () => {
  it('shows the real like count and an unselected heart when the viewer has not liked it', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/series/{series_id}') return Promise.resolve({ ...seriesDetail, like_count: 5, liked_by_me: false });
      if (path === '/series/{series_id}/episodes') return Promise.resolve(episodes);
      if (path === '/me/history') return Promise.resolve(history);
      throw new Error(`Unexpected path: ${path}`);
    });
    const { findByText, getByLabelText } = renderScreen();

    await findByText('Anchored');
    expect(getByLabelText('Like, 5 likes')).toBeTruthy();
  });

  it('likes via PUT and updates the count/heart from the response, no refetch', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/series/{series_id}') return Promise.resolve({ ...seriesDetail, like_count: 5, liked_by_me: false });
      if (path === '/series/{series_id}/episodes') return Promise.resolve(episodes);
      if (path === '/me/history') return Promise.resolve(history);
      throw new Error(`Unexpected path: ${path}`);
    });
    mockedPut.mockResolvedValue({ liked: true, like_count: 6 });
    const { findByLabelText, getByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Like, 5 likes'));

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith('/series/{series_id}/like', { params: { path: { series_id: 's1' } } }),
    );
    await waitFor(() => expect(getByLabelText('Unlike, 6 likes')).toBeTruthy());
  });

  it('unlikes via DELETE when already liked', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/series/{series_id}') return Promise.resolve({ ...seriesDetail, like_count: 6, liked_by_me: true });
      if (path === '/series/{series_id}/episodes') return Promise.resolve(episodes);
      if (path === '/me/history') return Promise.resolve(history);
      throw new Error(`Unexpected path: ${path}`);
    });
    mockedDelete.mockResolvedValue({ liked: false, like_count: 5 });
    const { findByLabelText, getByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Unlike, 6 likes'));

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith('/series/{series_id}/like', { params: { path: { series_id: 's1' } } }),
    );
    await waitFor(() => expect(getByLabelText('Like, 5 likes')).toBeTruthy());
  });
});

describe('SeriesDetailScreen — loading', () => {
  it('shows a loading state before the series resolves', () => {
    mockedGet.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText } = renderScreen();
    expect(getByLabelText('Loading series')).toBeTruthy();
  });
});

describe('SeriesDetailScreen — empty', () => {
  it('shows an empty state when the series has no published episodes', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/series/{series_id}') return Promise.resolve(seriesDetail);
      if (path === '/series/{series_id}/episodes') return Promise.resolve([]);
      if (path === '/me/history') return Promise.resolve([]);
      throw new Error(`Unexpected path: ${path}`);
    });
    const { findByText } = renderScreen();
    await findByText('No episodes yet. Check back once this series has published episodes.');
  });
});

describe('SeriesDetailScreen — error', () => {
  it('shows an error state with a working retry', async () => {
    let detailShouldFail = true;
    mockedGet.mockImplementation((path: string) => {
      if (path === '/series/{series_id}') {
        return detailShouldFail ? Promise.reject(new Error('network down')) : Promise.resolve(seriesDetail);
      }
      if (path === '/series/{series_id}/episodes') return Promise.resolve(episodes);
      if (path === '/me/history') return Promise.resolve(history);
      throw new Error(`Unexpected path: ${path}`);
    });
    const { findByText, getByText } = renderScreen();
    await findByText('Something went wrong loading this series.');
    detailShouldFail = false;
    fireEvent.press(getByText('Try again'));
    await findByText('Anchored');
  });
});

describe('SeriesDetailScreen — history failure', () => {
  it('still renders every episode row (duration doesn\'t depend on history) and falls back to a plain Play CTA', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/series/{series_id}') return Promise.resolve(seriesDetail);
      if (path === '/series/{series_id}/episodes') return Promise.resolve(episodes);
      if (path === '/me/history') return Promise.reject(new Error('history down'));
      throw new Error(`Unexpected path: ${path}`);
    });
    const { findByLabelText } = renderScreen();

    // Episode rows no longer read `/me/history` at all (they show speaker, not watch
    // status) — a history failure only affects the CTA above them, which falls back
    // to plain Play on the first episode rather than blocking the whole screen.
    expect(await findByLabelText('Episode 01, Part One, Ada Nwosu')).toBeTruthy();
    expect(await findByLabelText('Bonus Q&A')).toBeTruthy();
    expect(await findByLabelText('Play Part One')).toBeTruthy();
  });
});

describe('SeriesDetailScreen — both chromes', () => {
  it.each(['ios', 'android'] as const)('renders correctly under Platform.OS=%s', async (os) => {
    Platform.OS = os;
    mockHappyPath();
    const { findByText } = renderScreen();
    await findByText('Anchored');
  });
});

// Pull-to-dismiss is the Stack screen's own native gesture now (`app/_layout.tsx`'s
// `gestureDirection: 'vertical'`), not a hand-rolled scroll/animation handler this
// screen owns — it has no component-level behavior left to unit test here. See
// `app/_layout.tsx`'s doc comment on `series/[id]`'s `Stack.Screen` for why.
