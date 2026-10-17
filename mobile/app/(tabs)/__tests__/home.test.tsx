import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import HomeScreen from '../home';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedGet = api.get as jest.Mock;

const heroItems = [
  { id: 's1', title: 'Anchored in the Storm', duration_seconds: 1862, speaker_name: 'Ada Nwosu', thumbnail_url: null },
  { id: 's2', title: 'Older Sermon', duration_seconds: 900, speaker_name: 'Ada Nwosu', thumbnail_url: null },
];
const continueWatchingItems = [
  { id: 's3', title: 'Half-finished', duration_seconds: 1200, position_seconds: 400, thumbnail_url: null },
];
const recommendedItems = [{ id: 's4', title: 'Recommended Sermon', thumbnail_url: null }];
const trendingItems = [{ id: 's5', title: 'Trending Sermon', thumbnail_url: null }];
const seriesItems = [{ id: 'se1', title: 'Storms', episode_count: 4, thumbnail_url: null }];
const newReleaseItems = [
  { id: 's6', title: 'New Release Sermon', speaker_name: 'Ada Nwosu', thumbnail_url: null },
];
const prophetsCatalogItems = [
  { id: 's7', title: "Prophet's Catalog Sermon", speaker_name: 'Ada Nwosu', thumbnail_url: null },
];

function mockRoutes(
  overrides: Partial<{
    hero: unknown;
    continueWatching: unknown;
    recommended: unknown;
    trending: unknown;
    series: unknown;
    newReleases: unknown;
    prophetsCatalog: unknown;
  }> = {},
) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/catalog/sermons/hero') return Promise.resolve(overrides.hero ?? heroItems);
    if (path === '/me/continue-watching') return Promise.resolve(overrides.continueWatching ?? continueWatchingItems);
    if (path === '/me/recommended') return Promise.resolve(overrides.recommended ?? recommendedItems);
    if (path === '/catalog/sermons/trending') return Promise.resolve(overrides.trending ?? trendingItems);
    if (path === '/catalog/sermons/new-releases') return Promise.resolve(overrides.newReleases ?? newReleaseItems);
    if (path === '/catalog/sermons/prophets-catalog') return Promise.resolve(overrides.prophetsCatalog ?? prophetsCatalogItems);
    if (path === '/series') return Promise.resolve(overrides.series ?? seriesItems);
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderHome() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <HomeScreen />
    </QueryClientProvider>,
  );
}

/**
 * `HeroCarousel` (fixed 2026-10-16 — Isaac's "hero grows in height, then snaps back"
 * report) renders no pages until its wrapping View's own `onLayout` reports a real pixel
 * width — true on a real device almost immediately after mount, but RNTL never fires
 * native layout events on its own. The wrapping `testID="hero-carousel"` View itself
 * renders unconditionally the moment `useHeroSermons` resolves with 2+ items (only its
 * *children* wait on `onLayout`), so `findByTestId` resolves as soon as hero data lands
 * — simulate the layout event right there, synchronously, before anything awaits the
 * carousel's own content (`Watch, ...` / `Featured sermons, ...`). Call this again after
 * any later remount of the carousel in the same test (e.g. the error screen's own Retry
 * below) — each mount gets its own fresh `onLayout`.
 */
async function settleHeroLayout(result: ReturnType<typeof render>) {
  fireEvent(await result.findByTestId('hero-carousel'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } },
  });
}

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
});

describe('HomeScreen — populated', () => {
  it('renders the hero carousel (all items the endpoint returns, already capped/ordered server-side), continue-watching shelf, and series shelf', async () => {
    mockRoutes();
    const screen = renderHome();
    const { getAllByText, getByText, findByLabelText } = screen;
    await settleHeroLayout(screen);

    // No separate hero title or meta line renders (the art carries the title; duration is
    // already in the Watch label) — the Watch button is each hero card's own unique,
    // reliable "rendered" signal. Both fixture items render — `useHeroSermons` trusts
    // the backend (`content_service.list_hero_sermons`) to have already capped/ordered
    // the set; the screen itself doesn't re-slice it.
    await findByLabelText('Watch, 31:02');
    await findByLabelText('Watch, 15:00');
    expect(getAllByText('New this week')).toHaveLength(2);
    expect(await findByLabelText('Featured sermons, 1 of 2')).toBeTruthy();

    expect(getByText('Half-finished')).toBeTruthy();
    expect(getByText('Storms')).toBeTruthy();
  });

  it('navigates to the sermon detail route when the hero Watch CTA is pressed', async () => {
    mockRoutes();
    const screen = renderHome();
    const { findByLabelText } = screen;
    await settleHeroLayout(screen);

    const watchButton = await findByLabelText('Watch, 31:02');
    fireEvent.press(watchButton);

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 's1' } });
  });

  it('navigates to /notifications when the top bar bell is pressed', async () => {
    mockRoutes();
    const { findByLabelText } = renderHome();

    fireEvent.press(await findByLabelText('Notifications'));

    expect(mockPush).toHaveBeenCalledWith('/notifications');
  });

  it('navigates to the full series list when the Series section\'s arrow is pressed', async () => {
    mockRoutes();
    const { findByLabelText } = renderHome();

    fireEvent.press(await findByLabelText('See all series'));

    expect(mockPush).toHaveBeenCalledWith('/series');
  });

  it('renders the recommended and trending shelves as image-only cards and navigates on press', async () => {
    mockRoutes();
    const { findByLabelText } = renderHome();

    fireEvent.press(await findByLabelText('Recommended Sermon'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 's4' } });

    fireEvent.press(await findByLabelText('Trending Sermon'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 's5' } });
  });

  it('renders the new releases and prophet\'s catalog shelves as titled cards and navigates on press', async () => {
    mockRoutes();
    const { findByText, findByLabelText } = renderHome();

    fireEvent.press(await findByText('New Release Sermon'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 's6' } });

    // Prophet's Catalog's top pick also renders as a full-bleed spotlight (see below), so
    // the shelf's own card — not the spotlight — needs its distinct accessibility label to
    // disambiguate: both show the same title text on screen.
    fireEvent.press(await findByLabelText("Prophet's Catalog Sermon, Ada Nwosu"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 's7' } });
  });

  it('features Prophet\'s Catalog\'s top pick as a spotlight card and navigates on press', async () => {
    mockRoutes();
    const { findByLabelText } = renderHome();

    fireEvent.press(await findByLabelText("Prophet's Catalog Sermon, Prophet's Pick"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 's7' } });
  });
});

describe('HomeScreen — recommended/trending omitted when empty', () => {
  it('does not render either shelf when both resolve empty', async () => {
    mockRoutes({ recommended: [], trending: [] });
    const screen = renderHome();
    const { findByLabelText, queryByText, queryByLabelText } = screen;
    await settleHeroLayout(screen);

    await findByLabelText('Watch, 31:02');
    expect(queryByText('recommended for you')).toBeNull();
    expect(queryByText('trending')).toBeNull();
    expect(queryByLabelText('Recommended Sermon')).toBeNull();
    expect(queryByLabelText('Trending Sermon')).toBeNull();
  });
});

describe('HomeScreen — new releases/prophet\'s catalog omitted when empty', () => {
  it('does not render either shelf when both resolve empty', async () => {
    mockRoutes({ newReleases: [], prophetsCatalog: [] });
    const screen = renderHome();
    const { findByLabelText, queryByText } = screen;
    await settleHeroLayout(screen);

    await findByLabelText('Watch, 31:02');
    expect(queryByText('new releases')).toBeNull();
    expect(queryByText("prophet’s catalog")).toBeNull();
    expect(queryByText('New Release Sermon')).toBeNull();
    expect(queryByText("Prophet's Catalog Sermon")).toBeNull();
  });
});

describe('HomeScreen — continue watching omitted when empty', () => {
  it('does not render a "continue watching" section when the list is empty', async () => {
    mockRoutes({ continueWatching: [] });
    const screen = renderHome();
    const { findByLabelText, queryByText } = screen;
    await settleHeroLayout(screen);

    await findByLabelText('Watch, 31:02');
    expect(queryByText('continue watching')).toBeNull();
    expect(queryByText('Half-finished')).toBeNull();
  });
});

describe('HomeScreen — empty', () => {
  it('shows a fallback when there are no sermons or series yet', async () => {
    mockRoutes({
      hero: [],
      continueWatching: [],
      recommended: [],
      trending: [],
      newReleases: [],
      prophetsCatalog: [],
      series: [],
    });
    const { findByText } = renderHome();

    await findByText('No sermons yet');
    await findByText('No series yet — check back once the catalogue has one.');
  });
});

describe('HomeScreen — loading', () => {
  it('shows skeleton loading placeholders before data resolves', () => {
    mockedGet.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText } = renderHome();

    expect(getByLabelText('Loading home')).toBeTruthy();
    expect(getByLabelText('Loading series')).toBeTruthy();
  });
});

describe('HomeScreen — error', () => {
  it('shows an error state with a working retry for a failed section', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/catalog/sermons/hero') return Promise.reject(new Error('network down'));
      if (path === '/me/continue-watching') return Promise.resolve([]);
      if (path === '/me/recommended') return Promise.resolve([]);
      if (path === '/catalog/sermons/trending') return Promise.resolve([]);
      if (path === '/catalog/sermons/new-releases') return Promise.resolve([]);
      if (path === '/catalog/sermons/prophets-catalog') return Promise.resolve([]);
      if (path === '/series') return Promise.resolve(seriesItems);
      throw new Error(`unexpected path: ${path}`);
    });

    const screen = renderHome();
    const { findAllByText, findByText, findByLabelText, getAllByText } = screen;

    await findAllByText('Something went wrong. Try again.');
    await findByText('Storms');

    mockedGet.mockImplementation((path: string) => {
      if (path === '/catalog/sermons/hero') return Promise.resolve(heroItems);
      if (path === '/me/continue-watching') return Promise.resolve([]);
      if (path === '/me/recommended') return Promise.resolve([]);
      if (path === '/catalog/sermons/trending') return Promise.resolve([]);
      if (path === '/catalog/sermons/new-releases') return Promise.resolve([]);
      if (path === '/catalog/sermons/prophets-catalog') return Promise.resolve([]);
      if (path === '/series') return Promise.resolve(seriesItems);
      throw new Error(`unexpected path: ${path}`);
    });
    fireEvent.press(getAllByText('Retry')[0]);

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/catalog/sermons/hero', expect.anything()));
    await settleHeroLayout(screen);
    await findByLabelText('Watch, 31:02');
  });
});
