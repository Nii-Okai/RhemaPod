import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import CategoryDrillDownScreen from '../[id]';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockPush = jest.fn();
let mockParams: Record<string, string | undefined> = { id: 'c1', name: 'Teaching' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));

const mockedGet = api.get as jest.Mock;

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CategoryDrillDownScreen />
    </QueryClientProvider>,
  );
}

const sermon = {
  id: 'sermon-1',
  title: 'Anchored in the Storm',
  description: null,
  thumbnail_url: null,
  duration_seconds: 2538,
  speaker_id: 'speaker-1',
  speaker_name: 'Ada Nwosu',
  category_id: 'c1',
  category_name: 'Teaching',
  series_id: null,
  series_title: null,
  episode_number: null,
  tier: 'FREE',
  locked: false,
};

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
  mockParams = { id: 'c1', name: 'Teaching' };
});

describe('CategoryDrillDownScreen', () => {
  it('filters /search by category_id with no q, and navigates to /sermon/[id] on tap', async () => {
    mockedGet.mockResolvedValue({ query: '', total: 1, limit: 20, offset: 0, results: [sermon] });

    const { findByText, getByText } = renderScreen();
    await findByText('Anchored in the Storm');

    expect(mockedGet).toHaveBeenCalledWith(
      '/search',
      expect.objectContaining({ params: { query: { category_id: 'c1' } } }),
    );

    fireEvent.press(getByText('Anchored in the Storm'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 'sermon-1' } });
  });

  it('shows a loading state', () => {
    mockedGet.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText } = renderScreen();
    expect(getByLabelText('Loading sermons')).toBeTruthy();
  });

  it('shows the empty state naming the category', async () => {
    mockedGet.mockResolvedValue({ query: '', total: 0, limit: 20, offset: 0, results: [] });
    const { findByText } = renderScreen();
    await findByText('No sermons yet');
    await findByText('Nothing published under “Teaching” yet.');
  });

  it('shows an error state with a working retry', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network down'));
    mockedGet.mockResolvedValueOnce({ query: '', total: 1, limit: 20, offset: 0, results: [sermon] });

    const { findByText, getByText } = renderScreen();
    await findByText('Something went wrong. Try again.');

    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
  });
});
