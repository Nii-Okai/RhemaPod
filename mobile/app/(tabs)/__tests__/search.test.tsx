import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import SearchScreen from '../search';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@expo/vector-icons');

const mockedGet = api.get as jest.Mock;

function renderSearch() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SearchScreen />
    </QueryClientProvider>,
  );
}

const sermonResults = {
  query: 'storm',
  total: 2,
  limit: 20,
  offset: 0,
  results: [
    {
      id: 'sermon-1',
      title: 'Anchored in the Storm',
      description: null,
      thumbnail_url: null,
      duration_seconds: 2538,
      speaker_id: 'speaker-1',
      speaker_name: 'Ada Nwosu',
      category_id: null,
      category_name: null,
      series_id: null,
      series_title: null,
      episode_number: null,
      tier: 'FREE',
      locked: false,
    },
    {
      id: 'sermon-2',
      title: 'Peace, Be Still',
      description: null,
      thumbnail_url: null,
      duration_seconds: 1784,
      speaker_id: 'speaker-2',
      speaker_name: 'Daniel Okoye',
      category_id: null,
      category_name: null,
      series_id: null,
      series_title: null,
      episode_number: null,
      tier: 'FREE',
      locked: false,
    },
  ],
  series: [],
  series_total: 0,
  speakers: [],
  speakers_total: 0,
};

// Decision 4: grouped response with all three sections populated.
const groupedResults = {
  ...sermonResults,
  results: [sermonResults.results[0]],
  series: [
    {
      id: 'series-1',
      title: 'Storm Stories',
      description: null,
      thumbnail_url: null,
      episode_count: 6,
      category_id: null,
      category_name: null,
      status: 'PUBLISHED',
      tier: 'FREE',
    },
  ],
  series_total: 1,
  speakers: [
    {
      id: 'speaker-1',
      name: 'Ada Nwosu',
      bio: 'Teaching pastor.',
      sermon_count: 12,
    },
  ],
  speakers_total: 1,
};

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('SearchScreen — empty query', () => {
  it('shows the search prompt and never calls the fetch boundary', () => {
    const { getByText } = renderSearch();

    expect(getByText('Search the library')).toBeTruthy();
    expect(mockedGet).not.toHaveBeenCalled();
  });
});

describe('SearchScreen — debounce', () => {
  it('waits for the debounce window before calling /search or /search/suggest', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/search/suggest' ? Promise.resolve([]) : Promise.resolve(sermonResults),
    );
    const { getByLabelText } = renderSearch();

    fireEvent.changeText(getByLabelText('Search'), 'storm');
    expect(mockedGet).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(mockedGet).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
  });
});

describe('SearchScreen — populated (suggestions + grouped results)', () => {
  it('renders suggestions and the sermons group, and navigates to /sermon/[id] on tap', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/search/suggest'
        ? Promise.resolve(['storm', 'storms of life'])
        : Promise.resolve(sermonResults),
    );

    const { getByLabelText, findByText, getByText } = renderSearch();
    fireEvent.changeText(getByLabelText('Search'), 'storm');
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await findByText('sermons · 2');
    expect(getByText('Anchored in the Storm')).toBeTruthy();
    expect(getByText('42:18 · Ada Nwosu')).toBeTruthy();
    // The query itself is filtered out of its own suggestion list.
    expect(getByText(/storms of life/)).toBeTruthy();

    fireEvent.press(getByText('Anchored in the Storm'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 'sermon-1' } });
  });

  it('filling the box from a suggestion re-triggers the debounced search', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/search/suggest'
        ? Promise.resolve(['storms of life'])
        : Promise.resolve({ ...sermonResults, results: [sermonResults.results[0]] }),
    );

    const { getByLabelText, findByText, getByText } = renderSearch();
    fireEvent.changeText(getByLabelText('Search'), 'storm');
    act(() => {
      jest.advanceTimersByTime(300);
    });
    await findByText(/storms of life/);

    fireEvent.press(getByText(/storms of life/));
    expect(getByLabelText('Search').props.value).toBe('storms of life');

    act(() => {
      jest.advanceTimersByTime(300);
    });
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith('/search', expect.objectContaining({
        params: { query: { q: 'storms of life' } },
      })),
    );
  });
});

describe('SearchScreen — no results', () => {
  it('shows the no-results copy when every group (sermons/series/speakers) comes back empty', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/search/suggest'
        ? Promise.resolve([])
        : Promise.resolve({
            query: 'xyzzy',
            total: 0,
            limit: 20,
            offset: 0,
            results: [],
            series: [],
            series_total: 0,
            speakers: [],
            speakers_total: 0,
          }),
    );

    const { getByLabelText, findByText } = renderSearch();
    fireEvent.changeText(getByLabelText('Search'), 'xyzzy');
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await findByText('No results match your search.');
  });
});

describe('SearchScreen — grouped results (Decision 4)', () => {
  it('renders sermons, series, and speakers as three grouped sections and navigates from each', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/search/suggest' ? Promise.resolve([]) : Promise.resolve(groupedResults),
    );

    const { getByLabelText, findByText, getByText } = renderSearch();
    fireEvent.changeText(getByLabelText('Search'), 'storm');
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await findByText('sermons · 1');
    expect(getByText('series · 1')).toBeTruthy();
    expect(getByText('speakers · 1')).toBeTruthy();

    expect(getByText('Anchored in the Storm')).toBeTruthy();
    expect(getByText('Storm Stories')).toBeTruthy();
    expect(getByText('Ada Nwosu')).toBeTruthy();

    fireEvent.press(getByText('Storm Stories'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/series/[id]', params: { id: 'series-1' } });

    fireEvent.press(getByText('Ada Nwosu'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/speaker/[id]',
      params: { id: 'speaker-1', name: 'Ada Nwosu', bio: 'Teaching pastor.' },
    });
  });

  it('omits a group section entirely when that group has no matches', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/search/suggest' ? Promise.resolve([]) : Promise.resolve(sermonResults),
    );

    const { getByLabelText, findByText, queryByText } = renderSearch();
    fireEvent.changeText(getByLabelText('Search'), 'storm');
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await findByText('sermons · 2');
    expect(queryByText(/^series ·/)).toBeNull();
    expect(queryByText(/^speakers ·/)).toBeNull();
  });
});

describe('SearchScreen — error', () => {
  it('shows an error state for a failed search', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));

    const { getByLabelText, findByText } = renderSearch();
    fireEvent.changeText(getByLabelText('Search'), 'storm');
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await findByText('Something went wrong. Try again.');
  });
});
