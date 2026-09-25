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

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedGet = api.get as jest.Mock;

const sermons = [
  { id: 's1', title: 'Anchored in the Storm', duration_seconds: 1862, speaker_name: 'Ada Nwosu', thumbnail_url: null },
  { id: 's2', title: 'Older Sermon', duration_seconds: 900, speaker_name: 'Ada Nwosu', thumbnail_url: null },
];
const continueWatchingItems = [
  { id: 's3', title: 'Half-finished', duration_seconds: 1200, position_seconds: 400, thumbnail_url: null },
];
const seriesItems = [{ id: 'se1', title: 'Storms', episode_count: 4, thumbnail_url: null }];

function mockRoutes(overrides: Partial<{ sermons: unknown; continueWatching: unknown; series: unknown }> = {}) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/catalog/sermons') return Promise.resolve(overrides.sermons ?? sermons);
    if (path === '/me/continue-watching') return Promise.resolve(overrides.continueWatching ?? continueWatchingItems);
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

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
});

describe('HomeScreen — populated', () => {
  it('renders the hero (first sermon, P5), continue-watching shelf, series shelf, and the announcements entry', async () => {
    mockRoutes();
    const { getByText, findByText } = renderHome();

    await findByText('Anchored in the Storm');
    expect(getByText('New this week')).toBeTruthy();
    // P5: hero is the *first* item, not the whole list.
    expect(() => getByText('Older Sermon')).toThrow();

    expect(getByText('Half-finished')).toBeTruthy();
    expect(getByText('Storms')).toBeTruthy();
    expect(getByText('Announcements')).toBeTruthy();
  });

  it('navigates to the sermon detail route when the hero is pressed', async () => {
    mockRoutes();
    const { findByLabelText } = renderHome();

    const hero = await findByLabelText('Anchored in the Storm, 31:02 · Ada Nwosu');
    fireEvent.press(hero);

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 's1' } });
  });

  it('navigates to the announcements route (P2) when the entry point is pressed', async () => {
    mockRoutes();
    const { findByLabelText } = renderHome();

    fireEvent.press(await findByLabelText('Announcements'));

    expect(mockPush).toHaveBeenCalledWith('/announcements');
  });
});

describe('HomeScreen — continue watching omitted when empty', () => {
  it('does not render a "continue watching" section when the list is empty', async () => {
    mockRoutes({ continueWatching: [] });
    const { findByText, queryByText } = renderHome();

    await findByText('Anchored in the Storm');
    expect(queryByText('continue watching')).toBeNull();
    expect(queryByText('Half-finished')).toBeNull();
  });
});

describe('HomeScreen — empty', () => {
  it('shows a fallback when there are no sermons or series yet', async () => {
    mockRoutes({ sermons: [], continueWatching: [], series: [] });
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
      if (path === '/catalog/sermons') return Promise.reject(new Error('network down'));
      if (path === '/me/continue-watching') return Promise.resolve([]);
      if (path === '/series') return Promise.resolve(seriesItems);
      throw new Error(`unexpected path: ${path}`);
    });

    const { findAllByText, findByText, getAllByText } = renderHome();

    await findAllByText('Something went wrong. Try again.');
    await findByText('Storms');

    mockedGet.mockImplementation((path: string) => {
      if (path === '/catalog/sermons') return Promise.resolve(sermons);
      if (path === '/me/continue-watching') return Promise.resolve([]);
      if (path === '/series') return Promise.resolve(seriesItems);
      throw new Error(`unexpected path: ${path}`);
    });
    fireEvent.press(getAllByText('Retry')[0]);

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/catalog/sermons', expect.anything()));
    await findByText('Anchored in the Storm');
  });
});
