import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SignatureSeriesScreen } from '../SignatureSeries';
import { api } from '../../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../../lib/query/testUtils';
import { useDownloads } from '../../../../lib/downloads/useDownloads';
import { loadThemePreference } from '../../../../lib/settings/themePreference';
import { ThemeProvider } from '../../../../theme/ThemeContext';

jest.mock('@expo/vector-icons');
jest.mock('react-native-share', () => ({ __esModule: true, default: { open: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));
jest.mock('../../../../lib/settings/themePreference', () => ({
  DEFAULT_THEME_PREFERENCE: 'system',
  loadThemePreference: jest.fn(() => Promise.resolve('dark')),
  saveThemePreference: jest.fn(() => Promise.resolve()),
}));
// The breathing flame loops forever; a still one keeps the tests' timers quiet.
jest.mock('../../../(tabs)/_home/signature/Flame', () => {
  const actual = jest.requireActual('../../../(tabs)/_home/signature/Flame');
  return { ...actual, GlowingFlame: actual.Flame };
});

// Casting: not connected unless a test says so.
const mockCastPlay = jest.fn();
let mockCastConnected = false;
jest.mock('../../../../lib/cast/useCastPlayback', () => ({
  useCastPlayback: () => ({ connected: mockCastConnected, play: mockCastPlay }),
}));

const mockPush = jest.fn();
const mockDismissAll = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), dismissAll: mockDismissAll }),
  useLocalSearchParams: () => ({ id: 's1' }),
}));

const mockedGet = api.get as jest.Mock;
const mockedUseDownloads = useDownloads as jest.Mock;
const mockedLoadTheme = loadThemePreference as jest.Mock;

const seriesDetail = {
  id: 's1',
  title: 'The Destiny of the Church',
  description: 'A study of the church to come.',
  thumbnail_url: 'https://cdn.example.com/destiny.jpg',
  category_id: 'c1',
  category_name: 'Prophetic',
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
    duration_seconds: 4920,
    speaker_id: null,
    speaker_name: 'Prophet Prince Manasseh Atsu',
    category_id: 'c1',
    category_name: 'Prophetic',
    series_id: 's1',
    series_title: 'The Destiny of the Church',
    episode_number: 1,
    tier: 'free',
    locked: false,
    media_type: 'video',
    ...overrides,
  };
}

const episodes = [
  episode({ id: 'e1', title: 'Part One', episode_number: 1 }),
  episode({ id: 'e2', title: 'Part Two', episode_number: 2, duration_seconds: 5400 }),
  episode({ id: 'e3', title: 'Part Three', episode_number: 3 }),
];

const history = [
  { sermon_id: 'e1', position_seconds: 4920, watched_seconds: 4920, completed: true, play_count: 1, last_played_at: '2026-10-01T00:00:00Z' },
  { sermon_id: 'e2', position_seconds: 2940, watched_seconds: 2940, completed: false, play_count: 1, last_played_at: '2026-10-02T00:00:00Z' },
];

const related = {
  query: null,
  total: 3,
  limit: 20,
  offset: 0,
  series: [],
  series_total: 0,
  speakers: [],
  speakers_total: 0,
  results: [
    episode({ id: 'e1', title: 'Part One' }),
    episode({ id: 'other-1', title: 'Divine Patterns · Part 1', series_id: 's2' }),
    episode({ id: 'other-2', title: 'Divine Patterns · Part 2', series_id: 's2' }),
  ],
};

function mockApi(overrides: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    '/series/{series_id}': seriesDetail,
    '/series/{series_id}/episodes': episodes,
    '/me/history': history,
    '/search': related,
    '/playlists': [],
    ...overrides,
  };
  mockedGet.mockImplementation((path: string) =>
    path in routes ? Promise.resolve(routes[path]) : Promise.reject(new Error(`Unexpected path: ${path}`)),
  );
}

function renderScreen() {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <SignatureSeriesScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const download = jest.fn();
let records: Record<string, { state: string }> = {};

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
  mockDismissAll.mockClear();
  download.mockClear();
  mockCastPlay.mockClear();
  mockCastConnected = false;
  records = {};
  mockedLoadTheme.mockResolvedValue('dark');
  mockedUseDownloads.mockReturnValue({
    downloads: [],
    download,
    retry: jest.fn(),
    remove: jest.fn(),
    find: jest.fn((id: string) => records[id]),
  });
});

describe('SignatureSeriesScreen', () => {
  it.each(['dark', 'light'])('draws the cover, meta, title and speaker in the %s theme', async (theme) => {
    mockedLoadTheme.mockResolvedValue(theme);
    mockApi();
    const { findByText, getByText, getByTestId } = renderScreen();

    await findByText('The Destiny of the Church');
    expect(getByTestId('series-hero')).toBeTruthy();
    expect(getByText('Free')).toBeTruthy();
    expect(getByText('SERIES · 3 EPISODES · PROPHETIC')).toBeTruthy();
    expect(getByText('Prophet Prince Manasseh Atsu')).toBeTruthy();
    expect(getByText('A study of the church to come.')).toBeTruthy();
  });

  it('names the part and time left on the Resume pill, and opens that episode', async () => {
    mockApi();
    const { findByText, getByLabelText } = renderScreen();

    await findByText('Resume Part 2');
    expect(await findByText('· 41:00 LEFT')).toBeTruthy();
    fireEvent.press(getByLabelText('Resume, 41:00 remaining'));
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ id: 'e2' }) }));
  });

  it('shows a flame per episode with the watched count, and each row its watch state', async () => {
    mockApi();
    const { findByText, getByLabelText, getByText, getByTestId, queryByTestId } = renderScreen();

    await findByText('1 OF 3 WATCHED');
    expect(getByLabelText('1 of 3 episodes watched')).toBeTruthy();
    expect(getByText('1:22:00 · WATCHED')).toBeTruthy();
    expect(getByText('1:30:00 · 41:00 LEFT')).toBeTruthy();
    expect(getByText('1:22:00')).toBeTruthy();
    expect(getByTestId('episode-progress-e2')).toBeTruthy();
    expect(queryByTestId('episode-progress-e3')).toBeNull();
  });

  it('leaves the flames out and offers Play before anything is watched', async () => {
    mockApi({ '/me/history': [] });
    const { findByText, queryByText } = renderScreen();

    await findByText('Play Part 1');
    expect(queryByText(/WATCHED$/)).toBeNull();
  });

  it('queues every episode from Download all, and shows Downloaded once they all are', async () => {
    mockApi();
    const first = renderScreen();
    fireEvent.press(await first.findByLabelText('Download all 3 episodes'));
    expect(download).toHaveBeenCalledTimes(3);
    first.unmount();

    records = { e1: { state: 'ready' }, e2: { state: 'ready' }, e3: { state: 'ready' } };
    const second = renderScreen();
    expect(await second.findByLabelText('All 3 episodes downloaded')).toBeTruthy();
  });

  it('switches to Related: other series, one episode each, none of this series', async () => {
    mockApi();
    const { findByText, findByLabelText, getByTestId, queryByLabelText } = renderScreen();

    await findByText('Part One');
    fireEvent.press(getByTestId('detail-tab-related'));
    fireEvent.press(await findByLabelText('Divine Patterns · Part 1'));
    expect(queryByLabelText('Divine Patterns · Part 2')).toBeNull();
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ id: 'other-1' }) }));
  });

  it('sends Resume and episode rows to the TV while one is connected, from where the viewer stopped', async () => {
    mockCastConnected = true;
    mockApi();
    const { findByLabelText, getByText } = renderScreen();

    fireEvent.press(await findByLabelText('Resume, 41:00 remaining'));
    expect(mockCastPlay).toHaveBeenCalledWith({
      sermonId: 'e2',
      title: 'Part Two',
      subtitle: 'The Destiny of the Church',
      imageUrl: 'https://cdn.example.com/destiny.jpg',
      startTime: 2940,
    });
    fireEvent.press(getByText('Part One'));
    expect(mockCastPlay).toHaveBeenLastCalledWith(expect.objectContaining({ sermonId: 'e1', startTime: 0 }));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('closes the whole stack from the close button', async () => {
    mockApi();
    const { findByText, getByLabelText } = renderScreen();
    await findByText('The Destiny of the Church');
    fireEvent.press(getByLabelText('Close'));
    expect(mockDismissAll).toHaveBeenCalled();
  });

  it('offers a retry when the series fails to load', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/series/{series_id}' ? Promise.reject(new Error('boom')) : Promise.resolve([]),
    );
    const { findByText } = renderScreen();
    await waitFor(async () => expect(await findByText('Something went wrong loading this series.')).toBeTruthy());
  });
});
