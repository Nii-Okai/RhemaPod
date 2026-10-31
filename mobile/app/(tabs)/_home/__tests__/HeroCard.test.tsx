import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { HeroCard } from '../HeroCard';
import { api } from '../../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../../lib/query/testUtils';
import type { SermonListItem } from '../../../../lib/query/hooks/useSermons';

jest.mock('@expo/vector-icons');

jest.mock('../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const sermon: SermonListItem = {
  id: 's1',
  title: 'Anchored in the Storm',
  description: null,
  duration_seconds: 1862,
  episode_number: null,
  category_id: null,
  category_name: null,
  series_id: null,
  series_title: null,
  speaker_id: 'sp1',
  speaker_name: 'Ada Nwosu',
  thumbnail_url: 'https://cdn.example.com/hero.jpg',
  locked: false,
  tier: 'free',
} as SermonListItem;

const myListSummary = {
  id: 'p1',
  name: 'My List',
  description: null,
  is_public: true,
  cover_url: null,
  owner_name: 'Isaac',
  item_count: 1,
  total_duration_seconds: 100,
  created_at: '2026-10-10T00:00:00Z',
  updated_at: null,
};

function renderHero() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <HeroCard sermon={sermon} onPress={jest.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedDelete.mockReset();
});

describe('HeroCard', () => {
  it('renders the eyebrow (no separate title or meta line — the art carries the title, and duration already shows in the Watch label), and fires onPress from the Watch CTA', () => {
    mockedGet.mockResolvedValue([]);
    const onPress = jest.fn();
    const client = createTestQueryClient();
    const { getByText, queryByText, getByLabelText } = render(
      <QueryClientProvider client={client}>
        <HeroCard sermon={sermon} onPress={onPress} />
      </QueryClientProvider>,
    );

    expect(queryByText('Anchored in the Storm')).toBeNull();
    expect(queryByText('31:02 · Ada Nwosu')).toBeNull();
    expect(getByText('New this week')).toBeTruthy();

    fireEvent.press(getByLabelText('Watch, 31:02'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows a checkmark once the sermon is already in "My List", and removes it on a second tap', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/playlists') return Promise.resolve([myListSummary]);
      if (path === '/playlists/{playlist_id}')
        return Promise.resolve({
          ...myListSummary,
          items: [{ id: 'item-1', position: 0, added_at: '2026-10-10T00:00:00Z', sermon }],
        });
      throw new Error(`unexpected path: ${path}`);
    });
    mockedDelete.mockResolvedValue({ ...myListSummary, item_count: 0, items: [] });
    const { findByLabelText } = renderHero();

    const button = await findByLabelText('Remove from My List');
    expect(button.props.accessibilityState).toEqual({ selected: true });

    fireEvent.press(button);

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith('/playlists/{playlist_id}/items/{item_id}', {
        params: { path: { playlist_id: 'p1', item_id: 'item-1' } },
      }),
    );
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('creates "My List" on the very first add, then adds the sermon to it', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/playlists') return Promise.resolve([]);
      throw new Error(`unexpected path: ${path}`);
    });
    mockedPost.mockImplementation((path: string) => {
      if (path === '/playlists') return Promise.resolve({ ...myListSummary, item_count: 0 });
      if (path === '/playlists/{playlist_id}/items')
        return Promise.resolve({
          ...myListSummary,
          items: [{ id: 'item-1', position: 0, added_at: '2026-10-11T00:00:00Z', sermon }],
        });
      throw new Error(`unexpected path: ${path}`);
    });
    const { findByLabelText } = renderHero();

    fireEvent.press(await findByLabelText('Add to My List'));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/playlists', { body: { name: 'My List', description: null, is_public: false } }),
    );
    expect(mockedPost).toHaveBeenCalledWith('/playlists/{playlist_id}/items', {
      params: { path: { playlist_id: 'p1' } },
      body: { sermon_id: 's1' },
    });
  });
});
