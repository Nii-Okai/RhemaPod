import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { AddToPlaylistSheet } from '../AddToPlaylistSheet';
import { api } from '../../../../lib/api/typedClient';
import { useDownloads } from '../../../../lib/downloads/useDownloads';
import { createTestQueryClient } from '../../../../lib/query/testUtils';

jest.mock('../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));

const mockedGet = api.get as jest.Mock;
const mockedUseDownloads = useDownloads as jest.Mock;

function renderSheet(existingItemIdBySermonId: Map<string, string> = new Map(), onRemove: jest.Mock = jest.fn()) {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AddToPlaylistSheet
        visible
        onClose={jest.fn()}
        playlistId="p1"
        existingItemIdBySermonId={existingItemIdBySermonId}
        onRemove={onRemove}
      />
    </QueryClientProvider>,
  );
}

function sermon(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    title: 'Anchored in the Storm',
    thumbnail_url: null,
    category_name: null,
    series_id: null,
    series_title: null,
    episode_number: null,
    ...overrides,
  };
}

function searchPage(results: unknown[]) {
  return { results, total: results.length, offset: 0, limit: 50, query: '' };
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedUseDownloads.mockReset();
  mockedUseDownloads.mockReturnValue({ downloads: [] });
});

describe('AddToPlaylistSheet — tabs', () => {
  it('shows standalone sermons on the Sermons tab by default, with no query typed', async () => {
    mockedGet.mockResolvedValue(
      searchPage([
        sermon({ id: 'standalone-1', title: 'Standalone Sermon' }),
        sermon({ id: 'ep-1', title: 'Episode One', series_id: 'series-1', series_title: 'Faith Series', episode_number: 1 }),
      ]),
    );
    const { findByText, queryByText } = renderSheet();

    expect(await findByText('Standalone Sermon')).toBeTruthy();
    expect(queryByText('Episode One')).toBeNull();
  });

  it('shows series episodes on the Episodes tab', async () => {
    mockedGet.mockResolvedValue(
      searchPage([
        sermon({ id: 'standalone-1', title: 'Standalone Sermon' }),
        sermon({ id: 'ep-1', title: 'Episode One', series_id: 'series-1', series_title: 'Faith Series', episode_number: 1 }),
      ]),
    );
    const { findByText, getByText, queryByText } = renderSheet();
    await findByText('Standalone Sermon');

    fireEvent.press(getByText('Episodes'));

    expect(await findByText('Episode One')).toBeTruthy();
    expect(queryByText('Standalone Sermon')).toBeNull();
  });

  it('shows downloaded sermons on the Downloaded tab, read straight from `useDownloads`', async () => {
    mockedUseDownloads.mockReturnValue({
      downloads: [{ sermonId: 'dl-1', title: 'Offline Sermon', thumbnailUrl: null, category: 'Teaching' }],
    });
    mockedGet.mockResolvedValue(searchPage([]));
    const { findByText, getByText } = renderSheet();

    fireEvent.press(getByText('Downloaded'));

    expect(await findByText('Offline Sermon')).toBeTruthy();
  });

  it('shows the downloaded checkmark on the Downloaded tab\'s own rows too', async () => {
    mockedUseDownloads.mockReturnValue({
      downloads: [{ sermonId: 'dl-1', title: 'Offline Sermon', thumbnailUrl: null, category: 'Teaching' }],
    });
    mockedGet.mockResolvedValue(searchPage([]));
    const { findByText, getByText } = renderSheet();

    fireEvent.press(getByText('Downloaded'));
    await findByText('Offline Sermon');

    expect(getByText('checkmark-circle')).toBeTruthy();
  });

  it('filters the Downloaded tab by the search query, client-side', async () => {
    jest.useFakeTimers();
    mockedGet.mockResolvedValue(searchPage([]));
    mockedUseDownloads.mockReturnValue({
      downloads: [
        { sermonId: 'dl-1', title: 'Offline Sermon', thumbnailUrl: null, category: 'Teaching' },
        { sermonId: 'dl-2', title: 'Another Talk', thumbnailUrl: null, category: null },
      ],
    });
    const { findByText, getByText, getByLabelText, queryByText } = renderSheet();

    fireEvent.press(getByText('Downloaded'));
    await findByText('Offline Sermon');

    fireEvent.changeText(getByLabelText('Search sermons'), 'Offline');
    act(() => jest.advanceTimersByTime(300));

    expect(queryByText('Another Talk')).toBeNull();
    expect(getByText('Offline Sermon')).toBeTruthy();
    jest.useRealTimers();
  });

  it('shows a checkmark instead of "+" for a sermon already in the playlist', async () => {
    mockedGet.mockResolvedValue(searchPage([sermon({ id: 'standalone-1', title: 'Standalone Sermon' })]));
    const { findByLabelText } = renderSheet(new Map([['standalone-1', 'item-1']]));

    expect(await findByLabelText('Remove Standalone Sermon from this playlist')).toBeTruthy();
  });

  it('tapping the checkmark removes the item, by its playlist-item id, not its sermon id', async () => {
    mockedGet.mockResolvedValue(searchPage([sermon({ id: 'standalone-1', title: 'Standalone Sermon' })]));
    const onRemove = jest.fn();
    const { findByLabelText } = renderSheet(new Map([['standalone-1', 'item-1']]), onRemove);

    fireEvent.press(await findByLabelText('Remove Standalone Sermon from this playlist'));

    expect(onRemove).toHaveBeenCalledWith('item-1');
  });

  it('shows a downloaded cue next to a Sermons-tab row that is already on-device', async () => {
    mockedUseDownloads.mockReturnValue({
      downloads: [{ sermonId: 'standalone-1', title: 'Standalone Sermon', thumbnailUrl: null, category: 'Teaching' }],
    });
    mockedGet.mockResolvedValue(searchPage([sermon({ id: 'standalone-1', title: 'Standalone Sermon', category_name: 'Teaching' })]));
    const { findByText } = renderSheet();

    await findByText('Standalone Sermon');
    expect(await findByText('checkmark-circle')).toBeTruthy();
  });
});
