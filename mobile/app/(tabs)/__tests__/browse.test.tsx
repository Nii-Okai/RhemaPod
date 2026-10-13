import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import BrowseScreen from '../browse';
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

const categories = [
  { id: 'c1', name: 'Teaching', slug: 'teaching', sermon_count: 54 },
  { id: 'c2', name: 'Worship', slug: 'worship', sermon_count: 22 },
];
const speakers = [
  { id: 's1', name: 'Pastor Ada Nwosu', bio: 'Lead pastor at Grace Chapel since 2014', sermon_count: 61 },
  { id: 's2', name: 'Ruth Mensah', bio: null, sermon_count: 11 },
];

function renderBrowse() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <BrowseScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
});

describe('BrowseScreen — populated', () => {
  it('renders category cards and speaker rows, and navigates on tap', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/categories' ? Promise.resolve(categories) : Promise.resolve(speakers),
    );

    const { getByText, findByText, queryByText } = renderBrowse();

    await findByText('Teaching');
    // Visible counts dropped (Isaac's ask, session 2026-10-02) — still reach VoiceOver.
    expect(queryByText('54 sermons')).toBeNull();
    expect(getByText('Pastor Ada Nwosu')).toBeTruthy();
    expect(getByText('No bio yet')).toBeTruthy();

    fireEvent.press(getByText('Teaching'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/category/[id]', params: { id: 'c1', name: 'Teaching' } });

    fireEvent.press(getByText('Ruth Mensah'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/speaker/[id]',
      params: { id: 's2', name: 'Ruth Mensah', bio: '', sermonCount: '11' },
    });
  });
});

describe('BrowseScreen — loading', () => {
  it('shows a loading state for both sections before data resolves', () => {
    mockedGet.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText } = renderBrowse();

    expect(getByLabelText('Loading categories')).toBeTruthy();
    expect(getByLabelText('Loading speakers')).toBeTruthy();
  });
});

describe('BrowseScreen — empty', () => {
  it('shows the empty state when the catalogue has no categories or speakers', async () => {
    mockedGet.mockResolvedValue([]);
    const { findByText } = renderBrowse();

    await findByText('No categories yet');
    await findByText('No speakers yet');
  });
});

describe('BrowseScreen — error', () => {
  it('shows an error state with a working retry', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));
    const { findAllByText, getAllByText } = renderBrowse();

    await findAllByText('Something went wrong. Try again.');

    mockedGet.mockResolvedValue(categories);
    fireEvent.press(getAllByText('Retry')[0]);

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/categories', expect.anything()));
  });
});

describe('BrowseScreen — search entry', () => {
  it('shows the search entry point on every platform and pushes /search on press', async () => {
    mockedGet.mockResolvedValue([]);

    const { getByLabelText, findByText } = renderBrowse();
    await findByText('No categories yet');
    expect(getByLabelText('Search sermons, series, speakers')).toBeTruthy();

    fireEvent.press(getByLabelText('Search sermons, series, speakers'));
    expect(mockPush).toHaveBeenCalledWith('/search');
  });
});

describe('BrowseScreen — categories "See more"', () => {
  const manyCategories = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i + 1}`,
    name: `Category ${i + 1}`,
    slug: `category-${i + 1}`,
    sermon_count: i + 1,
  }));

  it('collapses to the first six categories with a "See more" toggle, expanding on press', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/categories' ? Promise.resolve(manyCategories) : Promise.resolve([]),
    );

    const { getByText, queryByText, findByText } = renderBrowse();
    await findByText('Category 1');

    expect(queryByText('Category 7')).toBeNull();
    expect(getByText('See more')).toBeTruthy();

    fireEvent.press(getByText('See more'));

    expect(getByText('Category 7')).toBeTruthy();
    expect(getByText('Category 8')).toBeTruthy();
    expect(getByText('See less')).toBeTruthy();
  });

  it('does not render the toggle when there are six or fewer categories', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/categories' ? Promise.resolve(categories) : Promise.resolve([]),
    );

    const { queryByText, findByText } = renderBrowse();
    await findByText('Teaching');

    expect(queryByText('See more')).toBeNull();
  });
});
