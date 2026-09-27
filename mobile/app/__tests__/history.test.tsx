import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import HistoryScreen from '../history';
import { api } from '../../lib/api/typedClient';
import { createTestQueryClient } from '../../lib/query/testUtils';

jest.mock('../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: { Screen: () => null },
}));

const mockedGet = api.get as jest.Mock;

const history = [
  { sermon_id: 's1', position_seconds: 400, watched_seconds: 400, completed: false, play_count: 1, last_played_at: '2026-01-02T00:00:00Z' },
  { sermon_id: 's2', position_seconds: 900, watched_seconds: 900, completed: true, play_count: 1, last_played_at: '2026-01-01T00:00:00Z' },
];
const sermons = [
  { id: 's1', title: 'Anchored in the Storm', duration_seconds: 1800 },
  { id: 's2', title: 'A Finished Sermon', duration_seconds: 900 },
];

function mockRoutes(overrides: Partial<{ history: unknown; sermons: unknown }> = {}) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/me/history') return Promise.resolve(overrides.history ?? history);
    if (path === '/catalog/sermons') return Promise.resolve(overrides.sermons ?? sermons);
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <HistoryScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
});

describe('HistoryScreen', () => {
  it('renders each entry with its resolved sermon title and derived status, and navigates on tap', async () => {
    mockRoutes();
    const { findByText, getByText } = renderScreen();

    await findByText('Anchored in the Storm');
    // 1800s duration - 400s position = 1400s = 23:20 left.
    expect(getByText('23:20 left')).toBeTruthy();
    expect(getByText('A Finished Sermon')).toBeTruthy();
    expect(getByText('Watched')).toBeTruthy();

    fireEvent.press(getByText('Anchored in the Storm'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 's1' } });
  });

  it('falls back to "In progress" when the sermon’s own duration is unknown', async () => {
    mockRoutes({ history: [history[0]], sermons: [] });
    const { findByText, getByText } = renderScreen();
    await findByText('Sermon');
    expect(getByText('In progress')).toBeTruthy();
  });

  it('shows the empty state when there is no watch history yet', async () => {
    mockRoutes({ history: [] });
    const { findByText } = renderScreen();
    await findByText('No watch history yet');
  });

  it('shows an error state with a working retry', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network down'));
    mockedGet.mockImplementation((path: string) => {
      if (path === '/me/history') return Promise.resolve(history);
      if (path === '/catalog/sermons') return Promise.resolve(sermons);
      throw new Error(`unexpected path: ${path}`);
    });
    const { findByText, getByText } = renderScreen();
    await findByText('Something went wrong. Try again.');

    fireEvent.press(getByText('Retry'));
    await findByText('Anchored in the Storm');
  });
});
