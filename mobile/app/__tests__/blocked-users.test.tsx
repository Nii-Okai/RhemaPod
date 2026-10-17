import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import BlockedUsersScreen from '../blocked-users';
import { api } from '../../lib/api/typedClient';
import { ApiError } from '../../lib/api/errors';
import { createTestQueryClient } from '../../lib/query/testUtils';

jest.mock('../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), delete: jest.fn() },
}));
jest.mock('@expo/vector-icons');

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockedGet = api.get as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

let blocks: { id: string; display_name: string; created_at: string }[];

function renderScreen() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <BlockedUsersScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedDelete.mockReset();
  mockBack.mockClear();
  blocks = [
    { id: 'b1', display_name: 'Pat Q.', created_at: '2026-10-01T00:00:00Z' },
    { id: 'b2', display_name: 'Lee R.', created_at: '2026-10-01T00:00:00Z' },
  ];
  mockedGet.mockImplementation(() => Promise.resolve(blocks));
});

describe('BlockedUsersScreen', () => {
  it('renders the established bare-chevron + centered-title header, and the chevron goes back', async () => {
    const { getByText, getByLabelText } = renderScreen();
    expect(getByText('Blocked users')).toBeTruthy();
    fireEvent.press(getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('lists the blocked authors with an Unblock control each', async () => {
    const { findByText, getByLabelText } = renderScreen();
    expect(await findByText('Pat Q.')).toBeTruthy();
    expect(await findByText('Lee R.')).toBeTruthy();
    expect(getByLabelText('Unblock Pat Q.')).toBeTruthy();
    expect(mockedGet).toHaveBeenCalledWith('/me/blocks', expect.anything());
  });

  it('shows the empty state', async () => {
    blocks = [];
    const { findByText } = renderScreen();
    expect(await findByText("You haven't blocked anyone.")).toBeTruthy();
  });

  it('unblocks without a confirm, removing the row and calling DELETE /me/blocks/{id}', async () => {
    mockedDelete.mockImplementation(async () => {
      blocks = blocks.filter((b) => b.id !== 'b1');
    });
    const { findByText, getByLabelText, queryByText } = renderScreen();
    await findByText('Pat Q.');

    await act(async () => {
      fireEvent.press(getByLabelText('Unblock Pat Q.'));
    });

    expect(mockedDelete).toHaveBeenCalledWith('/me/blocks/{block_id}', { params: { path: { block_id: 'b1' } } });
    await waitFor(() => expect(queryByText('Pat Q.')).toBeNull());
    expect(queryByText('Lee R.')).toBeTruthy();
  });

  it('returns the row and shows an error when the unblock fails', async () => {
    mockedDelete.mockRejectedValue(new ApiError(500, 'boom'));
    const { findByText, getByLabelText } = renderScreen();
    await findByText('Pat Q.');

    await act(async () => {
      fireEvent.press(getByLabelText('Unblock Pat Q.'));
    });

    expect(await findByText("Couldn't unblock. Try again.")).toBeTruthy();
    expect(await findByText('Pat Q.')).toBeTruthy();
  });

  it('shows a load error with a retry', async () => {
    mockedGet.mockRejectedValueOnce(new ApiError(500, 'Server exploded'));
    const { findByText } = renderScreen();
    expect(await findByText('Server exploded')).toBeTruthy();
    fireEvent.press(await findByText('Retry'));
    expect(await findByText('Pat Q.')).toBeTruthy();
  });
});
