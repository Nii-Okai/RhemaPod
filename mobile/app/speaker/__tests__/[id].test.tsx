import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import SpeakerDrillDownScreen from '../[id]';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockPush = jest.fn();
let mockParams: Record<string, string | undefined> = { id: 's1', name: 'Ada Nwosu', bio: 'Lead pastor' };
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
      <SpeakerDrillDownScreen />
    </QueryClientProvider>,
  );
}

const sermon = {
  id: 'sermon-1',
  title: 'Anchored in the Storm',
  description: null,
  thumbnail_url: null,
  duration_seconds: 2538,
  speaker_id: 's1',
  speaker_name: 'Ada Nwosu',
  category_id: null,
  category_name: null,
  series_id: null,
  series_title: null,
  episode_number: null,
  tier: 'FREE',
  locked: false,
};

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
  mockParams = { id: 's1', name: 'Ada Nwosu', bio: 'Lead pastor' };
});

describe('SpeakerDrillDownScreen', () => {
  it('shows the bio from nav params and filters /search by speaker_id', async () => {
    mockedGet.mockResolvedValue({ query: '', total: 1, limit: 20, offset: 0, results: [sermon] });

    const { findByText, getByText } = renderScreen();
    await findByText('Anchored in the Storm');

    expect(getByText('Lead pastor')).toBeTruthy();
    expect(mockedGet).toHaveBeenCalledWith(
      '/search',
      expect.objectContaining({ params: { query: { speaker_id: 's1' } } }),
    );

    fireEvent.press(getByText('Anchored in the Storm'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 'sermon-1' } });
  });

  it('shows the verbatim "No bio yet" fallback when bio is empty', async () => {
    mockParams = { id: 's2', name: 'Ruth Mensah', bio: '' };
    mockedGet.mockResolvedValue({ query: '', total: 0, limit: 20, offset: 0, results: [] });

    const { findByText } = renderScreen();
    await findByText('No bio yet');
  });

  it('shows a loading state', () => {
    mockedGet.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText } = renderScreen();
    expect(getByLabelText('Loading sermons')).toBeTruthy();
  });

  it('shows the empty state naming the speaker', async () => {
    mockedGet.mockResolvedValue({ query: '', total: 0, limit: 20, offset: 0, results: [] });
    const { findByText } = renderScreen();
    await findByText('No sermons yet');
    await findByText('Nothing published by Ada Nwosu yet.');
  });

  it('shows an error state', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));
    const { findByText } = renderScreen();
    await findByText('Something went wrong. Try again.');
  });
});
