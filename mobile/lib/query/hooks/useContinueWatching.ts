import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type ContinueWatchingItem = components['schemas']['ContinueWatchingItem'];

/**
 * `GET /api/v1/me/continue-watching` — started-but-unfinished sermons, most recent
 * first, capped at the endpoint's own default `limit` (10). Home's "Continue watching"
 * shelf (design spec §3 Home) is omitted entirely when this resolves empty — no
 * empty-state card, per the spec's own note that nothing in the source shows one.
 *
 * Not used for sermon-detail's Fresh-vs-Resume decision — that's a bounded, most-recent-10
 * list (see `useSermonProgress.ts`'s docstring for why the detail screen calls
 * `/sermons/{id}/progress` directly instead).
 */
export function useContinueWatching() {
  return useQuery({
    queryKey: queryKeys.me.continueWatching(),
    queryFn: ({ signal }) => api.get('/me/continue-watching', { init: { signal } }),
  });
}
