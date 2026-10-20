import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import NotificationsScreen from '../notifications';
import { api } from '../../lib/api/typedClient';
import { createTestQueryClient } from '../../lib/query/testUtils';

jest.mock('../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

const mockedGetItem = jest.fn<Promise<string | null>, [string]>(async () => null);
const mockedSetItem = jest.fn<Promise<undefined>, [string, string]>(async () => undefined);
jest.mock('expo-sqlite/kv-store', () => ({
  AsyncStorage: {
    getItem: (key: string) => mockedGetItem(key),
    setItem: (key: string, value: string) => mockedSetItem(key, value),
  },
}));

const mockedGet = api.get as jest.Mock;

const profile = {
  id: 'user-1',
  email: 'ada@example.com',
  full_name: 'Ada Nwosu',
  role: 'member',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  activated_at: '2024-01-02T00:00:00Z',
};

function makeSermon(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sermon-1',
    title: 'Anchored in the Storm',
    description: null,
    thumbnail_url: null,
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
    publish_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockReads(newReleases: unknown[] = [makeSermon()]) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/catalog/sermons/new-releases') return Promise.resolve(newReleases);
    if (path === '/auth/me') return Promise.resolve(profile);
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NotificationsScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedGetItem.mockReset();
  mockedGetItem.mockResolvedValue(null);
  mockedSetItem.mockClear();
  mockBack.mockClear();
  mockPush.mockClear();
});

describe('NotificationsScreen', () => {
  it('groups by recency and shows category/relative-time as the meta line', async () => {
    mockReads();
    const { findByText } = renderScreen();

    expect(await findByText('Today')).toBeTruthy();
    expect(await findByText('Anchored in the Storm')).toBeTruthy();
    expect(await findByText(/Teaching/)).toBeTruthy();
  });

  it('shows an unread row as unread, then marks it read (and opens it) on tap', async () => {
    mockReads();
    const { findByLabelText, findByText } = renderScreen();

    expect(await findByLabelText('Anchored in the Storm, unread')).toBeTruthy();

    fireEvent.press(await findByText('Anchored in the Storm'));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 'sermon-1' } });
    await waitFor(() => expect(mockedSetItem).toHaveBeenCalledWith('rhemapod-notifications-read:user-1', JSON.stringify(['sermon-1'])));
  });

  it('shows an already-read row with no "unread" accessibility suffix', async () => {
    mockedGetItem.mockImplementation(async (key: string) =>
      key === 'rhemapod-notifications-read:user-1' ? JSON.stringify(['sermon-1']) : null,
    );
    mockReads();
    const { findByLabelText, queryByLabelText } = renderScreen();

    expect(await findByLabelText('Anchored in the Storm')).toBeTruthy();
    expect(queryByLabelText('Anchored in the Storm, unread')).toBeNull();
  });

  it('navigates back from the header chevron', async () => {
    mockReads();
    const { findByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when there are no new releases', async () => {
    mockReads([]);
    const { findByText } = renderScreen();

    expect(await findByText('Nothing new yet')).toBeTruthy();
  });
});
