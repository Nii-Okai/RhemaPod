import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type ProgressPublic = components['schemas']['ProgressPublic'];

/**
 * `GET /api/v1/sermons/{sermon_id}/progress` — null when the sermon has never been
 * played. Conductor decision (W4.1, overriding the design spec §8.0/§8.8's originally
 * bound `/me/continue-watching` lookup): sermon-detail's Fresh-vs-Resume state calls this
 * endpoint directly, not the bounded continue-watching list (`limit=10`), because a
 * sermon resumed further back than the 10 most-recent plays would otherwise never show
 * a Resume CTA on its own detail screen even though a real position exists server-side.
 * Home's "Continue watching" shelf still uses `/me/continue-watching`
 * (`useContinueWatching.ts`) — that bounded list is exactly what a "recent activity"
 * shelf wants; only the single-sermon detail lookup needed the unbounded read.
 */
export function useSermonProgress(sermonId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.progress.detail(sermonId),
    queryFn: ({ signal }) =>
      api.get('/sermons/{sermon_id}/progress', { params: { path: { sermon_id: sermonId } }, init: { signal } }),
    enabled: options.enabled ?? true,
  });
}
