import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Platform } from 'react-native';
import SeriesDetailScreen from '../[id]';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockPush = jest.fn();
let mockParams: Record<string, string | undefined> = { id: 's1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));

const mockedGet = api.get as jest.Mock;

const seriesDetail = {
  id: 's1',
  title: 'Anchored',
  description: 'A study of trust in the storm.',
  thumbnail_url: 'https://cdn.example.com/anchored.jpg',
  category_id: null,
  category_name: null,
  status: 'published',
  tier: 'FREE',
  episode_count: 3,
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
    tier: 'FREE',
    locked: false,
    ...overrides,
  };
}

// Server has already renumbered contiguous 1..N (plan L11/W2.3) — e1/e2 stand
// in for what could have been a gapped 1/2/5 in the DB, plus one unnumbered
// episode (e3) that must render with no number at all.
const episodes = [
  episode({ id: 'e1', title: 'Part One', episode_number: 1, duration_seconds: 2538 }),
  episode({ id: 'e2', title: 'Part Two', episode_number: 2, duration_seconds: 1800 }),
  episode({ id: 'e3', title: 'Bonus Q&A', episode_number: null, duration_seconds: 900 }),
];

const history = [
  {
    sermon_id: 'e1',
    position_seconds: 2538,
    watched_seconds: 2538,
    completed: true,
    play_count: 1,
    last_played_at: '2026-09-01T00:00:00Z',
  },
  {
    sermon_id: 'e2',
    position_seconds: 600,
    watched_seconds: 600,
    completed: false,
    play_count: 1,
    last_played_at: '2026-09-02T00:00:00Z',
  },
];

function mockHappyPath() {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/series/{series_id}') return Promise.resolve(seriesDetail);
    if (path === '/series/{series_id}/episodes') return Promise.resolve(episodes);
    if (path === '/me/history') return Promise.resolve(history);
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
  mockPush.mockClear();
  mockParams = { id: 's1' };
  Platform.OS = 'ios';
});

describe('SeriesDetailScreen — populated', () => {
  it('renders series art/title/synopsis and episodes with contiguous numbers, no gap rows', async () => {
    mockHappyPath();
    const { findByText, getByText, queryByText } = renderScreen();

    await findByText('Anchored');
    expect(getByText('A study of trust in the storm.')).toBeTruthy();

    expect(getByText('01')).toBeTruthy();
    expect(getByText('02')).toBeTruthy();
    expect(getByText('Part One')).toBeTruthy();
    expect(getByText('Part Two')).toBeTruthy();
    expect(getByText('Bonus Q&A')).toBeTruthy();

    // The null-numbered episode renders with no number at all — never "00" or a
    // fabricated digit — and no "not yet published" gap row is rendered anywhere.
    expect(queryByText('00')).toBeNull();
    expect(queryByText(/not yet published/i)).toBeNull();
  });

  it('derives per-episode status from one /me/history call — watched, remaining time, and new', async () => {
    mockHappyPath();
    const { findByText, getByText } = renderScreen();

    await findByText('Part One');
    expect(getByText('watched')).toBeTruthy();
    expect(getByText('20:00 left')).toBeTruthy();
    expect(getByText('new')).toBeTruthy();

    expect(mockedGet).toHaveBeenCalledWith(
      '/me/history',
      expect.objectContaining({ params: { query: { limit: 100 } } }),
    );
    expect(mockedGet.mock.calls.filter(([path]) => path === '/me/history')).toHaveLength(1);
  });

  it('navigates to /sermon/[id] on episode tap', async () => {
    mockHappyPath();
    const { findByText, getByText } = renderScreen();
    await findByText('Part One');

    fireEvent.press(getByText('Part One'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 'e1' } });
  });

  it('gives every episode row a non-empty accessibility label, numbered and unnumbered alike', async () => {
    mockHappyPath();
    const { findByLabelText } = renderScreen();
    expect(await findByLabelText('Episode 01, Part One, watched')).toBeTruthy();
    expect(await findByLabelText('Bonus Q&A, new')).toBeTruthy();
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
    await findByText('No episodes yet');
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
    await findByText('Something went wrong. Try again.');

    detailShouldFail = false;
    fireEvent.press(getByText('Retry'));
    await findByText('Anchored');
  });
});

describe('SeriesDetailScreen — history failure', () => {
  it('renders episodes with no status label when /me/history fails, never "new"', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/series/{series_id}') return Promise.resolve(seriesDetail);
      if (path === '/series/{series_id}/episodes') return Promise.resolve(episodes);
      if (path === '/me/history') return Promise.reject(new Error('history down'));
      throw new Error(`Unexpected path: ${path}`);
    });

    const { findByText, queryByText, findByLabelText } = renderScreen();

    await findByText('Part One');
    await findByText('Part Two');
    await findByText('Bonus Q&A');

    // No fabricated status of any kind — not "new" for the never-played episode,
    // not "watched"/"...left" for ones the fixture data would otherwise support.
    expect(queryByText('new')).toBeNull();
    expect(queryByText('watched')).toBeNull();
    expect(queryByText(/left$/)).toBeNull();

    // Accessibility label drops the status segment entirely rather than
    // fabricating one — the row is still announced by number/title.
    expect(await findByLabelText('Episode 01, Part One')).toBeTruthy();
    expect(await findByLabelText('Bonus Q&A')).toBeTruthy();
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
