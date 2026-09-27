import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type NotePublic = components['schemas']['NotePublic'];

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
 * `DELETE /notes/{note_id}` — optimistic remove from the "my notes" list, reverted if
 * the request fails (plan W4.6 verification: "optimistic toggles revert on failure";
 * this is the same pattern applied to a real network mutation rather than a local
 * toggle, per TanStack Query's own documented optimistic-update recipe:
 * https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates).
 * Ownership is enforced server-side (§A.5: "a note that doesn't belong to the caller
 * 404s, the same as one that doesn't exist") — this hook does nothing extra for that,
 * a 404 here surfaces through `onError` like any other failure.
 */
export function useDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) => api.delete('/notes/{note_id}', { params: { path: { note_id: noteId } } }),
    onMutate: async (noteId: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notes.mine() });
      const previous = queryClient.getQueryData<NotePublic[]>(queryKeys.notes.mine());
      queryClient.setQueryData<NotePublic[]>(queryKeys.notes.mine(), (current) =>
        (current ?? []).filter((note) => note.id !== noteId),
      );
      return { previous };
    },
    onError: (_err, _noteId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.notes.mine(), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.mine() });
    },
  });
}
