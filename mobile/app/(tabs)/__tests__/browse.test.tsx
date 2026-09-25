import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import BrowseScreen from '../browse';
import { api } from '../../../lib/api/typedClient';
import { usePlatformOS } from '../../../components/navigation/platform';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

jest.mock('../../../components/navigation/platform', () => ({
  usePlatformOS: jest.fn(() => 'ios'),
}));

jest.mock('@expo/vector-icons');

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedGet = api.get as jest.Mock;
const mockedUsePlatformOS = usePlatformOS as jest.Mock;

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
  mockedUsePlatformOS.mockReturnValue('ios');
});

describe('BrowseScreen — populated', () => {
  it('renders category cards and speaker rows, and navigates on tap', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/categories' ? Promise.resolve(categories) : Promise.resolve(speakers),
    );

    const { getByText, findByText } = renderBrowse();

    await findByText('Teaching');
    expect(getByText('54 sermons')).toBeTruthy();
    expect(getByText('Pastor Ada Nwosu')).toBeTruthy();
    expect(getByText('No bio yet')).toBeTruthy();

    fireEvent.press(getByText('Teaching'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/category/[id]', params: { id: 'c1', name: 'Teaching' } });

    fireEvent.press(getByText('Ruth Mensah'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/speaker/[id]',
      params: { id: 's2', name: 'Ruth Mensah', bio: '' },
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

describe('BrowseScreen — Android chrome', () => {
  it('shows the M3 search-bar entry point on Android and hides it on iOS', async () => {
    mockedUsePlatformOS.mockReturnValue('android');
    mockedGet.mockResolvedValue([]);

    const { getByLabelText, findByText } = renderBrowse();
    await findByText('No categories yet');
    expect(getByLabelText('Search sermons, series, speakers')).toBeTruthy();

    fireEvent.press(getByLabelText('Search sermons, series, speakers'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/search');
  });

  it('does not render the Android search bar on iOS', async () => {
    mockedGet.mockResolvedValue([]);
    const { queryByLabelText, findByText } = renderBrowse();
    await findByText('No categories yet');
    expect(queryByLabelText('Search sermons, series, speakers')).toBeNull();
  });
});
