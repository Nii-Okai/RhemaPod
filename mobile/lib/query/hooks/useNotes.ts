import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type NotePublic = components['schemas']['NotePublic'];
export type NoteCreate = components['schemas']['NoteCreate'];
export type NoteUpdate = components['schemas']['NoteUpdate'];

/**
 * `GET /me/notes` (plan §A.5) — every note the caller has ever taken, across every
 * sermon, most-recent-first (the endpoint's own docstring). Unbounded/unpaginated per
 * the generated schema (no query params on this operation) — same acceptance as
 * `useSermons`' unbounded `/catalog/sermons` read; not something this hook papers over.
 * Backs the Profile & Settings Library "Notes" row (P8: no count, a plain navigating
 * row) and the tablet two-pane "Your notes" panel.
 */
export function useMyNotes() {
  return useQuery({
    queryKey: queryKeys.notes.mine(),
    queryFn: ({ signal }) => api.get('/me/notes', { init: { signal } }),
  });
}

/** `GET /sermons/{sermon_id}/notes` — one sermon's own notes (the eventual W4.2 Player drawer's read). */
export function useSermonNotes(sermonId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.notes.forSermon(sermonId),
    queryFn: ({ signal }) =>
      api.get('/sermons/{sermon_id}/notes', { params: { path: { sermon_id: sermonId } }, init: { signal } }),
    enabled: options.enabled ?? true,
  });
}

/**
 * `POST /sermons/{sermon_id}/notes` (W4.2, Player drawer's "+ Note" / extended FAB
 * action) — takes a timestamped note without pausing playback. Not optimistic: unlike
 * `useDeleteNote`/`useUpdateNote` below (which patch an entry the cache already has),
 * an optimistic insert here would need to invent a client-side id/`created_at` ahead of
 * the server's own, and the drawer list order (`ORDER BY position_seconds`,
 * `notes_service`) depends on values only the server assigns — invalidate-on-success is
 * the honest choice, not a shortcut. Invalidates both this sermon's note list (the
 * drawer) and `/me/notes` (Profile & Settings' Library row / tablet panel), since a new
 * note appears in both reads.
 */
export function useCreateNote(sermonId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: NoteCreate) =>
      api.post('/sermons/{sermon_id}/notes', { params: { path: { sermon_id: sermonId } }, body: data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.forSermon(sermonId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.mine() });
    },
  });
}

/**
 * `PATCH /notes/{note_id}` (W4.2, editing a note's body from the Player drawer) —
 * optimistic patch of whichever note lists currently hold this note (the sermon-scoped
 * drawer list and/or the unbounded `/me/notes` list), reverted on failure — same
 * recipe as `useDeleteNote` above, applied to an edit instead of a removal.
 */
export function useUpdateNote(sermonId: string) {
  const queryClient = useQueryClient();

  function patchCachedNote(noteId: string, patch: NoteUpdate) {
    // `NoteUpdate`'s fields are optional-and-nullable (a PATCH contract: absent/`null`
    // both mean "leave unchanged") — `note.id === noteId ? { ...note, ...patch } : note`
    // doesn't typecheck against `NotePublic`'s required non-null fields for exactly that
    // reason (a `null` patch value would otherwise null out a field `NotePublic` promises
    // is always a real value). Falling back to the existing field on `null`/`undefined`
    // keeps the merged object honestly `NotePublic`-shaped and matches this hook's only
    // real call site anyway (the Player drawer's edit sheet only ever sends `{ body }`).
    const apply = (notes: NotePublic[] | undefined) =>
      notes?.map((note) =>
        note.id === noteId
          ? {
              ...note,
              body: patch.body ?? note.body,
              position_seconds: patch.position_seconds ?? note.position_seconds,
            }
          : note,
      );
    return {
      sermon: queryClient.getQueryData<NotePublic[]>(queryKeys.notes.forSermon(sermonId)),
      mine: queryClient.getQueryData<NotePublic[]>(queryKeys.notes.mine()),
      applySermon: () =>
        queryClient.setQueryData<NotePublic[]>(queryKeys.notes.forSermon(sermonId), apply),
      applyMine: () => queryClient.setQueryData<NotePublic[]>(queryKeys.notes.mine(), apply),
    };
  }

  return useMutation({
    mutationFn: ({ noteId, data }: { noteId: string; data: NoteUpdate }) =>
      api.patch('/notes/{note_id}', { params: { path: { note_id: noteId } }, body: data }),
    onMutate: async ({ noteId, data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notes.forSermon(sermonId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.notes.mine() });
      const snapshot = patchCachedNote(noteId, data);
      snapshot.applySermon();
      snapshot.applyMine();
      return snapshot;
    },
    onError: (_err, _vars, context) => {
      if (context?.sermon) queryClient.setQueryData(queryKeys.notes.forSermon(sermonId), context.sermon);
      if (context?.mine) queryClient.setQueryData(queryKeys.notes.mine(), context.mine);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.forSermon(sermonId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.mine() });
    },
  });
}

/**
 * `DELETE /notes/{note_id}` — optimistic remove from the "my notes" list, reverted if
 * the request fails (plan W4.6 verification: "optimistic toggles revert on failure";
 * this is the same pattern applied to a real network mutation rather than a local
 * toggle, per TanStack Query's own documented optimistic-update recipe:
 * https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates).
 * Ownership is enforced server-side (§A.5: "a note that doesn't belong to the caller
 * 404s, the same as one that doesn't exist") — this hook does nothing extra for that,
 * a 404 here surfaces through `onError` like any other failure.
 *
 * `sermonId` is optional (W4.2 addition): when the caller is the Player drawer, passing
 * the sermon id also optimistically removes the note from that sermon's own list
 * (`notes.forSermon`), not just `/me/notes` — the drawer never reads the unbounded
 * "mine" list, so without this a delete from inside the Player would revert visually the
 * instant the drawer's own query next refetched. Omitted (as the original W4.6 Library
 * screen call site still does), behavior is unchanged from before this addition.
 */
export function useDeleteNote(sermonId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) => api.delete('/notes/{note_id}', { params: { path: { note_id: noteId } } }),
    onMutate: async (noteId: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notes.mine() });
      const previous = queryClient.getQueryData<NotePublic[]>(queryKeys.notes.mine());
      queryClient.setQueryData<NotePublic[]>(queryKeys.notes.mine(), (current) =>
        (current ?? []).filter((note) => note.id !== noteId),
      );

      let previousForSermon: NotePublic[] | undefined;
      if (sermonId) {
        await queryClient.cancelQueries({ queryKey: queryKeys.notes.forSermon(sermonId) });
        previousForSermon = queryClient.getQueryData<NotePublic[]>(queryKeys.notes.forSermon(sermonId));
        queryClient.setQueryData<NotePublic[]>(queryKeys.notes.forSermon(sermonId), (current) =>
          (current ?? []).filter((note) => note.id !== noteId),
        );
      }

      return { previous, previousForSermon };
    },
    onError: (_err, _noteId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.notes.mine(), context.previous);
      }
      if (sermonId && context?.previousForSermon) {
        queryClient.setQueryData(queryKeys.notes.forSermon(sermonId), context.previousForSermon);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.mine() });
      if (sermonId) void queryClient.invalidateQueries({ queryKey: queryKeys.notes.forSermon(sermonId) });
    },
  });
}
