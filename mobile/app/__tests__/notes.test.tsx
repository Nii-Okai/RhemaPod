import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import NotesScreen from '../notes';
import { api } from '../../lib/api/typedClient';
import { createTestQueryClient } from '../../lib/query/testUtils';

jest.mock('../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), delete: jest.fn() },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: { Screen: () => null },
}));

jest.mock('@expo/vector-icons');

const mockedGet = api.get as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const notes = [
  { id: 'n1', sermon_id: 's1', body: 'First note', position_seconds: 62, created_at: '2026-01-02T00:00:00Z', updated_at: null },
  { id: 'n2', sermon_id: 's2', body: 'Second note', position_seconds: 130, created_at: '2026-01-01T00:00:00Z', updated_at: null },
];
const sermons = [
  { id: 's1', title: 'Anchored in the Storm' },
  { id: 's2', title: 'A Second Sermon' },
];

function mockRoutes(overrides: Partial<{ notes: unknown; sermons: unknown }> = {}) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/me/notes') return Promise.resolve(overrides.notes ?? notes);
    if (path === '/catalog/sermons') return Promise.resolve(overrides.sermons ?? sermons);
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderScreen(client = createTestQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <NotesScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedDelete.mockReset();
  mockPush.mockClear();
});

describe('NotesScreen', () => {
  it('renders every note with its resolved sermon title, and navigates to the sermon on tap', async () => {
    mockRoutes();
    const { findByText, getByText } = renderScreen();

    await findByText('First note');
    expect(getByText('Anchored in the Storm')).toBeTruthy();
    expect(getByText('Second note')).toBeTruthy();
    expect(getByText('A Second Sermon')).toBeTruthy();

    fireEvent.press(getByText('First note'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 's1' } });
  });

  it('shows a loading state', () => {
    mockedGet.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText } = renderScreen();
    expect(getByLabelText('Loading notes')).toBeTruthy();
  });

  it('shows the empty state when the caller has no notes', async () => {
    mockRoutes({ notes: [] });
    const { findByText } = renderScreen();
    await findByText('No notes yet');
  });

  it('shows an error state with a working retry', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network down'));
    mockedGet.mockImplementation((path: string) => {
      if (path === '/me/notes') return Promise.resolve(notes);
      if (path === '/catalog/sermons') return Promise.resolve(sermons);
      throw new Error(`unexpected path: ${path}`);
    });
    const { findByText, getByText } = renderScreen();
    await findByText('Something went wrong. Try again.');

    fireEvent.press(getByText('Retry'));
    await findByText('First note');
  });

  it('removes a note optimistically and reverts it if the delete fails', async () => {
    mockRoutes();
    mockedDelete.mockRejectedValue(new Error('gone'));
    const { findByText, getAllByLabelText } = renderScreen();

    await findByText('First note');
    fireEvent.press(getAllByLabelText('Delete note')[0]!);

    // Optimistic removal happens immediately...
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('/notes/{note_id}', { params: { path: { note_id: 'n1' } } }));

    // ...and is restored once the request fails.
    await findByText('First note');
  });
});
