import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import CreatePlaylistScreen from '../create';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, push: jest.fn() }),
}));

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CreatePlaylistScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockReplace.mockClear();
  mockBack.mockClear();
});

describe('CreatePlaylistScreen', () => {
  it('suggests "My Playlist #1" for a caller with no existing playlists', async () => {
    mockedGet.mockResolvedValue([]);
    const { findByDisplayValue } = renderScreen();
    expect(await findByDisplayValue('My Playlist #1')).toBeTruthy();
  });

  it('suggests the next number when the caller already has playlists', async () => {
    mockedGet.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    const { findByDisplayValue } = renderScreen();
    expect(await findByDisplayValue('My Playlist #3')).toBeTruthy();
  });

  it('creates the playlist and replaces the route with its detail screen', async () => {
    mockedGet.mockResolvedValue([]);
    mockedPost.mockResolvedValue({ id: 'new-playlist', name: 'Road Trip' });
    const { findByDisplayValue, getByText } = renderScreen();

    const input = await findByDisplayValue('My Playlist #1');
    fireEvent.changeText(input, 'Road Trip');
    fireEvent.press(getByText('Create'));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/playlists', {
        body: { name: 'Road Trip', description: null, is_public: true },
      }),
    );
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/playlist/[id]', params: { id: 'new-playlist' } });
  });

  it('closing the modal navigates back without creating anything', async () => {
    mockedGet.mockResolvedValue([]);
    const { findByLabelText } = renderScreen();
    fireEvent.press(await findByLabelText('Close'));
    expect(mockBack).toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
