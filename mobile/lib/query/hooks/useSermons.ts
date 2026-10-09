import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type SermonListItem = components['schemas']['SermonListItem'];
export type SermonDetail = components['schemas']['SermonDetail'];
type LikeState = components['schemas']['LikeState'];

/**
 * `GET /api/v1/catalog/sermons` — the public, published-only catalog read (plan
 * decision, W4.1: the task brief's unprefixed `GET /sermons` is staff-only and 403s a
 * signed-in member; `SermonDetail`'s own docstring confirms `/catalog/sermons/{id}` is
 * "the public read"). Server-ordered `published_at DESC NULLS LAST`
 * (`content_service.list_published_sermons`) — the Home hero (P5) is simply this list's
 * first item, no client-side sort or pin.
 */
export function useSermons() {
  return useQuery({
    queryKey: queryKeys.sermons.list(),
    queryFn: ({ signal }) => api.get('/catalog/sermons', { init: { signal } }),
  });
}

/** `GET /api/v1/catalog/sermons/{sermon_id}` — `SermonDetail`, bound per design spec §8.0. */
export function useSermonDetail(sermonId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.sermons.detail(sermonId),
    queryFn: ({ signal }) =>
      api.get('/catalog/sermons/{sermon_id}', { params: { path: { sermon_id: sermonId } }, init: { signal } }),
    enabled: options.enabled ?? true,
  });
}

/**
 * `PUT`/`DELETE /catalog/sermons/{sermon_id}/like` (Isaac's ask, session 2026-10-09: a
 * real counter and backend behind the Like button). Both are idempotent on the server —
 * this hook picks which one to call from the CURRENT `liked` state the caller already
 * has (the cached `SermonDetail`'s own `liked_by_me`), rather than guessing a toggle
 * direction itself. The response is the new authoritative `{liked, like_count}`, written
 * straight into the cached detail — no refetch, same pattern `useUpdateFullName` already
 * uses for its own `PATCH /auth/me`.
 */
export function useToggleSermonLike(sermonId: string) {
  const queryClient = useQueryClient();
  const applyState = (state: LikeState) => {
    queryClient.setQueryData<SermonDetail>(queryKeys.sermons.detail(sermonId), (detail) =>
      detail ? { ...detail, liked_by_me: state.liked, like_count: state.like_count } : detail,
    );
  };
  const like = useMutation({
    mutationFn: () => api.put('/catalog/sermons/{sermon_id}/like', { params: { path: { sermon_id: sermonId } } }),
    onSuccess: applyState,
  });
  const unlike = useMutation({
    mutationFn: () => api.delete('/catalog/sermons/{sermon_id}/like', { params: { path: { sermon_id: sermonId } } }),
    onSuccess: applyState,
  });
  return {
    toggle: (currentlyLiked: boolean) => void (currentlyLiked ? unlike.mutate() : like.mutate()),
    isPending: like.isPending || unlike.isPending,
  };
}
