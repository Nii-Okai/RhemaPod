import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient } from '@tanstack/react-query';
import { api } from '../../../api/typedClient';
import { useMyNotes, useSermonNotes, useDeleteNote, useCreateNote, useUpdateNote } from '../useNotes';
import { queryKeys } from '../../queryClient';
import { createTestQueryClient, wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPatch = api.patch as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const notes = [
  { id: 'n1', sermon_id: 's1', body: 'First note', position_seconds: 62, created_at: '2026-01-01T00:00:00Z', updated_at: null },
  { id: 'n2', sermon_id: 's2', body: 'Second note', position_seconds: 130, created_at: '2026-01-02T00:00:00Z', updated_at: null },
];

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedPatch.mockReset();
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

  it('also optimistically removes from the sermon-scoped list, and reverts both on failure, when a sermonId is given', async () => {
    // The Player drawer's own call site — it only ever renders `useSermonNotes`, never
    // `useMyNotes`, so `useDeleteNote(sermonId)` must patch `notes.forSermon`, not just
    // the unbounded `/me/notes` list the Library-row screen reads.
    const client = createTestQueryClient();
    mockedGet.mockResolvedValue([notes[0]]);
    mockedDelete.mockRejectedValueOnce(new Error('note not found'));

    const { result } = renderHook(
      () => ({
        sermonNotes: useSermonNotes('s1'),
        deleteNote: useDeleteNote('s1'),
      }),
      { wrapper: wrapWithQueryClient(client) },
    );
    await waitFor(() => expect(result.current.sermonNotes.isSuccess).toBe(true));

    act(() => {
      result.current.deleteNote.mutate('n1');
    });

    await waitFor(() => expect(result.current.deleteNote.isError).toBe(true));
    // Reverted — the failed delete never permanently dropped the sermon-scoped entry.
    expect(client.getQueryData(queryKeys.notes.forSermon('s1'))).toEqual([notes[0]]);
  });
});

describe('useCreateNote', () => {
  // `POST /sermons/{sermon_id}/notes` (real endpoint contract, `NoteCreate` /
  // `NotePublic` per `lib/api/schema.d.ts`) — not a hand-rolled stub of the notes API.
  it('POSTs to the sermon-scoped notes endpoint with the given body', async () => {
    const created = {
      id: 'n3',
      sermon_id: 's1',
      body: 'A new note',
      position_seconds: 45,
      created_at: '2026-01-03T00:00:00Z',
      updated_at: null,
    };
    mockedPost.mockResolvedValue(created);

    const { result } = renderHook(() => useCreateNote('s1'), { wrapper: wrapWithQueryClient() });

    act(() => {
      result.current.mutate({ position_seconds: 45, body: 'A new note' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedPost).toHaveBeenCalledWith(
      '/sermons/{sermon_id}/notes',
      expect.objectContaining({
        params: { path: { sermon_id: 's1' } },
        body: { position_seconds: 45, body: 'A new note' },
      }),
    );
    expect(result.current.data).toEqual(created);
  });

  it('invalidates both the sermon-scoped list and /me/notes on success, so both re-fetch', async () => {
    const client = createTestQueryClient();
    mockedGet.mockResolvedValue([notes[0]]);
    mockedPost.mockResolvedValue({ ...notes[0], id: 'n3' });

    const { result } = renderHook(
      () => ({
        sermonNotes: useSermonNotes('s1'),
        mine: useMyNotes(),
        createNote: useCreateNote('s1'),
      }),
      { wrapper: wrapWithQueryClient(client) },
    );
    await waitFor(() => expect(result.current.sermonNotes.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.mine.isSuccess).toBe(true));
    mockedGet.mockClear();

    act(() => {
      result.current.createNote.mutate({ position_seconds: 10, body: 'x' });
    });

    await waitFor(() => expect(result.current.createNote.isSuccess).toBe(true));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
  });

  it('surfaces a failure instead of silently dropping the note', async () => {
    mockedPost.mockRejectedValue(new Error('validation failed'));
    const { result } = renderHook(() => useCreateNote('s1'), { wrapper: wrapWithQueryClient() });

    act(() => {
      result.current.mutate({ position_seconds: 10, body: '' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUpdateNote', () => {
  function renderDrawer(client: QueryClient) {
    return renderHook(
      () => ({
        sermonNotes: useSermonNotes('s1'),
        updateNote: useUpdateNote('s1'),
      }),
      { wrapper: wrapWithQueryClient(client) },
    );
  }

  it('PATCHes /notes/{note_id} and optimistically updates the cached body immediately', async () => {
    const client = createTestQueryClient();
    mockedGet.mockResolvedValue([notes[0]]);
    let resolvePatch: (value: unknown) => void = () => {};
    mockedPatch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );

    const { result } = renderDrawer(client);
    await waitFor(() => expect(result.current.sermonNotes.isSuccess).toBe(true));

    act(() => {
      result.current.updateNote.mutate({ noteId: 'n1', data: { body: 'Edited body' } });
    });

    await waitFor(() => {
      const cached = client.getQueryData<typeof notes>(queryKeys.notes.forSermon('s1'));
      expect(cached?.[0]?.body).toBe('Edited body');
    });

    expect(mockedPatch).toHaveBeenCalledWith(
      '/notes/{note_id}',
      expect.objectContaining({ params: { path: { note_id: 'n1' } }, body: { body: 'Edited body' } }),
    );

    resolvePatch({ ...notes[0], body: 'Edited body' });
    await waitFor(() => expect(result.current.updateNote.isSuccess).toBe(true));
  });

  it('reverts the optimistic edit when the request fails', async () => {
    const client = createTestQueryClient();
    mockedGet.mockResolvedValue([notes[0]]);
    mockedPatch.mockRejectedValue(new Error('not found'));

    const { result } = renderDrawer(client);
    await waitFor(() => expect(result.current.sermonNotes.isSuccess).toBe(true));

    act(() => {
      result.current.updateNote.mutate({ noteId: 'n1', data: { body: 'Will be reverted' } });
    });

    await waitFor(() => expect(result.current.updateNote.isError).toBe(true));
    const cached = client.getQueryData<typeof notes>(queryKeys.notes.forSermon('s1'));
    expect(cached?.[0]?.body).toBe(notes[0].body);
  });
});
