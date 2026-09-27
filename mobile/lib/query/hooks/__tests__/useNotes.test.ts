import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient } from '@tanstack/react-query';
import { api } from '../../../api/typedClient';
import { useMyNotes, useSermonNotes, useDeleteNote } from '../useNotes';
import { queryKeys } from '../../queryClient';
import { createTestQueryClient, wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn(), delete: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const notes = [
  { id: 'n1', sermon_id: 's1', body: 'First note', position_seconds: 62, created_at: '2026-01-01T00:00:00Z', updated_at: null },
  { id: 'n2', sermon_id: 's2', body: 'Second note', position_seconds: 130, created_at: '2026-01-02T00:00:00Z', updated_at: null },
];

beforeEach(() => {
  mockedGet.mockReset();
  mockedDelete.mockReset();
});

describe('useMyNotes', () => {
  it('calls GET /me/notes, one call not a fan-out', async () => {
    mockedGet.mockResolvedValue(notes);
    const { result } = renderHook(() => useMyNotes(), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith('/me/notes', expect.objectContaining({}));
    expect(result.current.data).toEqual(notes);
  });
});

describe('useSermonNotes', () => {
  it('calls GET /sermons/{sermon_id}/notes with the given sermon id', async () => {
    mockedGet.mockResolvedValue([notes[0]]);
    const { result } = renderHook(() => useSermonNotes('s1'), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith(
      '/sermons/{sermon_id}/notes',
      expect.objectContaining({ params: { path: { sermon_id: 's1' } } }),
    );
  });
});

describe('useDeleteNote', () => {
  // `useMyNotes()` is rendered alongside `useDeleteNote()` in every case below —
  // matching how `app/notes.tsx` actually uses both together — so the list query has
  // a live observer. A test client's `gcTime: 0` (`testUtils.ts`) would otherwise
  // garbage-collect the cache entry the moment nothing is observing it, making
  // `getQueryData` read back `undefined` regardless of what the mutation did.
  function renderNotesScreen(client: QueryClient) {
    return renderHook(
      () => ({
        notes: useMyNotes(),
        deleteNote: useDeleteNote(),
      }),
      { wrapper: wrapWithQueryClient(client) },
    );
  }

  it('removes the note from the cache immediately (optimistic), before the request resolves', async () => {
    const client = createTestQueryClient();
    mockedGet.mockResolvedValue(notes);
    let resolveDelete: () => void = () => {};
    mockedDelete.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );

    const { result } = renderNotesScreen(client);
    await waitFor(() => expect(result.current.notes.isSuccess).toBe(true));

    act(() => {
      result.current.deleteNote.mutate('n1');
    });

    await waitFor(() => {
      expect(client.getQueryData(queryKeys.notes.mine())).toEqual([notes[1]]);
    });

    resolveDelete();
    await waitFor(() => expect(result.current.deleteNote.isSuccess).toBe(true));
  });

  it('reverts the optimistic removal when the delete request fails', async () => {
    const client = createTestQueryClient();
    mockedGet.mockResolvedValue(notes);
    mockedDelete.mockRejectedValue(new Error('note not found'));

    const { result } = renderNotesScreen(client);
    await waitFor(() => expect(result.current.notes.isSuccess).toBe(true));

    act(() => {
      result.current.deleteNote.mutate('n1');
    });

    // A synchronously-rejecting mock settles the mutation too fast to reliably observe
    // the transient optimistic dip here (that's what the "before the request resolves"
    // case above already proves, with a controlled, manually-resolved promise) — what
    // matters for "revert on failure" is the end state: once the mutation has settled
    // as an error, nothing was permanently removed.
    await waitFor(() => expect(result.current.deleteNote.isError).toBe(true));
    expect(client.getQueryData(queryKeys.notes.mine())).toEqual(notes);
  });
});
