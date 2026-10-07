import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Dimensions, Platform } from 'react-native';
import SeriesScreen from '../series';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

function setWindowWidth(width: number) {
  act(() => {
    Dimensions.set({
      window: { width, height: 800, scale: 2, fontScale: 1 },
      screen: { width, height: 800, scale: 2, fontScale: 1 },
    });
  });
}

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
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
  mockBack.mockClear();
  Platform.OS = 'ios';
  setWindowWidth(375);
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

describe('SeriesScreen — back header (phone only, W4.1 Home "see all series" link)', () => {
  it('shows a back button on phone width and navigates back on press', async () => {
    setWindowWidth(375);
    mockedGet.mockResolvedValue(seriesList);
    const { findByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('omits the back button on tablet width — the persistent rail is the way back there', async () => {
    setWindowWidth(900);
    mockedGet.mockResolvedValue(seriesList);
    const { findByText, queryByLabelText } = renderScreen();

    await findByText('Anchored');
    expect(queryByLabelText('Back')).toBeNull();
  });
});
