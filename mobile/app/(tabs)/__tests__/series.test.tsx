import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Platform } from 'react-native';
import SeriesScreen from '../series';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedGet = api.get as jest.Mock;

const seriesList = [
  { id: 's1', title: 'Anchored', description: null, category_id: null, category_name: null, status: 'published', tier: 'FREE', episode_count: 3 },
  { id: 's2', title: 'Room at the Table', description: null, category_id: null, category_name: null, status: 'published', tier: 'FREE', episode_count: 1 },
];

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SeriesScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
  Platform.OS = 'ios';
});

describe('SeriesScreen (tablet rail, P3) — populated', () => {
  it('renders series cards and navigates to /series/[id] on tap', async () => {
    mockedGet.mockResolvedValue(seriesList);
    const { findByText, getByText } = renderScreen();

    await findByText('Anchored');
    expect(getByText('3 episodes')).toBeTruthy();
    expect(getByText('Room at the Table')).toBeTruthy();
    expect(getByText('1 episode')).toBeTruthy();

    fireEvent.press(getByText('Anchored'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/series/[id]', params: { id: 's1' } });
  });
});

describe('SeriesScreen — loading', () => {
  it('shows a loading state', () => {
    mockedGet.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText } = renderScreen();
    expect(getByLabelText('Loading series')).toBeTruthy();
  });
});

describe('SeriesScreen — empty', () => {
  it('shows the empty state when the catalogue has no series', async () => {
    mockedGet.mockResolvedValue([]);
    const { findByText } = renderScreen();
    await findByText('No series yet');
  });
});

describe('SeriesScreen — error', () => {
  it('shows an error state with a working retry', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network down'));
    mockedGet.mockResolvedValueOnce(seriesList);

    const { findByText, getByText } = renderScreen();
    await findByText('Something went wrong. Try again.');

    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
  });
});

describe('SeriesScreen — both chromes', () => {
  it.each(['ios', 'android'] as const)('renders correctly under Platform.OS=%s', async (os) => {
    Platform.OS = os;
    mockedGet.mockResolvedValue(seriesList);
    const { findByText } = renderScreen();
    await findByText('Anchored');
  });
});
