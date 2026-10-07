/**
 * `GET /verses/today` — Home's "verse of the day" (`VerseStrip`). Public read, no auth
 * gate on the endpoint, same as Announcements. The backend (`verse_service.
 * get_verse_of_the_day`) already picks the day's verse deterministically and 404s when
 * no active verse exists — this hook does no client-side date logic or fallback text of
 * its own; `VerseStrip` just renders nothing while loading, on error, or on a 404. A
 * 404 is never retried anyway — the shared retry policy (`lib/query/retryPolicy.ts`)
 * treats it like any other 4xx, so no override is needed here.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type VersePublic = components['schemas']['VersePublic'];

export function useVerseOfTheDay() {
  return useQuery({
    queryKey: queryKeys.verses.today(),
    queryFn: ({ signal }) => api.get('/verses/today', { init: { signal } }),
  });
}
