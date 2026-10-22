import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import PlayerScreen from '../../[id]';
import { api } from '../../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../../lib/query/testUtils';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { darkColors, lightColors } from '../../../../theme/colors';
import { loadThemePreference } from '../../../../lib/settings/themePreference';
// See the classic player test for why this is imported by its relative path.
import { __lastMockPlayer } from '../../../../__mocks__/expo-video';

jest.mock('../../../../lib/featureFlags', () => ({
  SIGNATURE_HOME_ENABLED: false,
  SIGNATURE_NOTIFICATIONS_ENABLED: false,
  SIGNATURE_PLAYER_ENABLED: true,
}));

jest.mock('../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../../../lib/settings/themePreference', () => ({
  DEFAULT_THEME_PREFERENCE: 'system',
  loadThemePreference: jest.fn(() => Promise.resolve('dark')),
  saveThemePreference: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-video');
jest.mock('@expo/vector-icons');
jest.mock('react-native-share', () => ({ __esModule: true, default: { open: jest.fn() } }));
jest.mock('../../../../lib/hooks/useIsOnline', () => ({ useIsOnline: jest.fn(() => true) }));

// Same native-module reasons as the classic player test.
const mockDownload = jest.fn();
jest.mock('../../../../lib/downloads/useDownloads', () => ({
  useDownloads: jest.fn(() => ({ isLoading: false, find: jest.fn(() => undefined), download: mockDownload })),
}));
jest.mock('../../../../lib/downloads/useLocalPlayback', () => ({
  useLocalPlayback: jest.fn(() => ({ localUri: null, isPreparing: false, error: null })),
}));
jest.mock('../../../../lib/mediaCache/useCachedSource', () => ({
  useCachedSource: jest.fn(() => ({ isLoading: false, effectiveUrl: null, reportExit: jest.fn() })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockBack = jest.fn();
const mockSetParams = jest.fn();
let mockParams: Record<string, string | undefined> = { id: 'sermon-1' };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, replace: jest.fn(), setParams: mockSetParams }),
}));

jest.mock('expo-sqlite/kv-store', () => ({
  AsyncStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

const mockedGet = api.get as jest.Mock;
const mockedPut = api.put as jest.Mock;
const mockedLoadTheme = loadThemePreference as jest.Mock;

const detail = {
  id: 'sermon-1',
  title: 'The Destiny of the Church',
  description: null,
  thumbnail_url: 'https://cdn.example.com/art.jpg',
  duration_seconds: 5400,
  category_id: 'c1',
  category_name: 'Prophetic',
  speaker_id: 'sp1',
  speaker_name: 'Prophet Prince Manasseh Atsu',
  series_id: 'se1',
  series_title: 'The Destiny of the Church',
  episode_number: 2,
  tier: 'free',
  locked: false,
  tags: [],
  media_type: 'video',
  media_refs: [{ id: 'm1', type: 'video', quality: '720p', s3_key: 'x', hls_manifest_key: 'y' }],
  published_at: '2026-10-18T12:00:00Z',
  status: 'published',
  created_at: '2026-10-01T00:00:00Z',
  like_count: 3,
  liked_by_me: false,
};

const comment = {
  id: 'c1',
  sermon_id: 'sermon-1',
  author_display_name: 'Michael A.',
  body: 'Watching this one a second time. Powerful word.',
  created_at: '2026-10-19T00:00:00Z',
  is_mine: false,
  status: 'VISIBLE',
  hidden_label: null,
};

const profile = {
  id: 'user-1',
  email: 'nii@example.com',
  full_name: 'Nii Okai',
  role: 'member',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  activated_at: '2024-01-02T00:00:00Z',
  comments_terms_accepted_at: '2026-10-01T00:00:00Z',
};

const queuePlaylist = {
  id: 'p1',
  name: 'Driving',
  description: null,
  is_public: false,
  cover_url: null,
  owner_name: 'Nii Okai',
  item_count: 2,
  total_duration_seconds: 0,
  created_at: '2026-10-10T00:00:00Z',
  updated_at: null,
  items: ['sermon-1', 'sermon-2'].map((id) => ({
    id: `item-${id}`,
    position: 0,
    added_at: '2026-10-10T00:00:00Z',
    sermon: { ...detail, id, title: `Title ${id}` },
  })),
};

function mockReads(overrides: { detail?: unknown } = {}) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/catalog/sermons/{sermon_id}') return Promise.resolve(overrides.detail ?? detail);
    if (path === '/sermons/{sermon_id}/progress') return Promise.resolve(null);
    if (path === '/sermons/{sermon_id}/stream') {
      return Promise.resolve({
        sermon_id: 'sermon-1',
        expires_in: 21600,
        variants: [{ type: 'video', quality: '720p', url: 'https://stream.example.com/signed.m3u8' }],
      });
    }
    if (path === '/sermons/{sermon_id}/comments') {
      return Promise.resolve({ items: [comment], total: 1, limit: 25, offset: 0 });
    }
    if (path === '/auth/me') return Promise.resolve(profile);
    if (path === '/playlists') return Promise.resolve([]);
    if (path === '/playlists/{playlist_id}') return Promise.resolve(queuePlaylist);
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderPlayer() {
  const client = createTestQueryClient();
  return render(
    <ThemeProvider lightModeAvailable>
      <QueryClientProvider client={client}>
        <PlayerScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPut.mockReset();
  mockBack.mockClear();
  mockSetParams.mockClear();
  mockDownload.mockClear();
  mockParams = { id: 'sermon-1' };
  mockedLoadTheme.mockResolvedValue('dark');
  mockReads();
});

describe('Signature player', () => {
  it('shows the series and part in the header, and closes from the chevron', async () => {
    const screen = renderPlayer();
    await screen.findByTestId('signature-player-header');
    expect(await screen.findByText('Part 2')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Close player'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows the title, speaker and category under the video, and keeps every control on the video', async () => {
    const screen = renderPlayer();
    await screen.findByTestId('video-view');
    expect(screen.getAllByText('The Destiny of the Church').length).toBe(2); // header + title
    expect(screen.getByText('Prophet Prince Manasseh Atsu · Prophetic')).toBeTruthy();

    const player = __lastMockPlayer!;
    await act(async () => {
      player.__simulateReady(5400);
    });
    // Nii, 2026-10-22: all player controls stay on the player itself.
    expect(screen.getAllByLabelText('Seek')).toHaveLength(1);
    expect(screen.getByLabelText('Playback speed, 1×')).toBeTruthy();
    expect(screen.getByLabelText('Sleep timer, off')).toBeTruthy();
    expect(screen.getByLabelText('Enter full screen')).toBeTruthy();
  });

  it('likes the sermon from its pill', async () => {
    mockedPut.mockResolvedValue({ liked: true, like_count: 4 });
    const screen = renderPlayer();
    fireEvent.press(await screen.findByLabelText('Like, 3 likes'));
    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith('/catalog/sermons/{sermon_id}/like', expect.anything()),
    );
    expect(await screen.findByLabelText('Unlike, 4 likes')).toBeTruthy();
  });

  it('downloads the sermon from its pill, beside Like, My List and Share', async () => {
    const screen = renderPlayer();
    fireEvent.press(await screen.findByLabelText('Download The Destiny of the Church'));
    expect(mockDownload).toHaveBeenCalledWith(
      'sermon-1',
      'The Destiny of the Church',
      'video',
      'https://cdn.example.com/art.jpg',
      'Prophetic',
    );
    expect(screen.getByLabelText('Add to My List')).toBeTruthy();
    expect(screen.getByLabelText('Share this sermon')).toBeTruthy();
  });

  it('cycles speed and opens the sleep timer from the video overlay', async () => {
    const screen = renderPlayer();
    fireEvent.press(await screen.findByLabelText('Playback speed, 1×'));
    expect(__lastMockPlayer!.playbackRate).toBe(1.25);
    expect(screen.getByLabelText('Playback speed, 1.25×')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Sleep timer, off'));
    expect(await screen.findByText('15 minutes')).toBeTruthy();
  });

  it('shows the comments card with its count and the latest comment', async () => {
    const screen = renderPlayer();
    expect(await screen.findByText('Watching this one a second time. Powerful word.')).toBeTruthy();
    expect(screen.getByText('Comments')).toBeTruthy();
    expect(screen.getByLabelText('1 comment')).toBeTruthy();
    // Queue and Comments only switch panels when there's a queue.
    expect(screen.queryByLabelText('Show queue')).toBeNull();
  });

  it('opens a playlist on its queue, and the toolbar switches to comments and back', async () => {
    mockParams = { id: 'sermon-1', queue: 'sermon-1,sermon-2', queueIndex: '0', playlistId: 'p1' };
    const screen = renderPlayer();
    expect(await screen.findByText('Title sermon-2')).toBeTruthy();
    expect(screen.queryByLabelText('1 comment')).toBeNull();

    fireEvent.press(screen.getByLabelText('Show comments'));
    expect(await screen.findByText('Watching this one a second time. Powerful word.')).toBeTruthy();
    expect(screen.queryByText('Title sermon-2')).toBeNull();

    fireEvent.press(screen.getByLabelText('Show queue'));
    expect(await screen.findByText('Title sermon-2')).toBeTruthy();
  });

  it('labels a sermon outside a series "Now playing"', async () => {
    mockReads({ detail: { ...detail, series_id: null, series_title: null, episode_number: null } });
    const screen = renderPlayer();
    expect(await screen.findByText('Now playing')).toBeTruthy();
    expect(screen.queryByText('Part 2')).toBeNull();
  });

  it.each([
    ['dark', darkColors],
    ['light', lightColors],
  ] as const)('draws the page in the %s theme', async (scheme, palette) => {
    mockedLoadTheme.mockResolvedValue(scheme);
    const screen = renderPlayer();
    await screen.findByText('Prophet Prince Manasseh Atsu · Prophetic');
    await waitFor(() =>
      expect(StyleSheet.flatten(screen.getByTestId('signature-player-header').props.style).backgroundColor).toBe(
        palette.surface.app,
      ),
    );
  });
});
