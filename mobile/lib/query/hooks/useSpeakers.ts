import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type Speaker = components['schemas']['SpeakerPublic'];

/**
 * `GET /api/v1/speakers` (plan W4.3). `bio` is nullable — the "No bio yet"
 * fallback (verbatim from the admin portal's speaker row copy) is a render
 * concern, not this hook's.
 */
export function useSpeakers() {
  return useQuery({
    queryKey: queryKeys.speakers.list(),
    queryFn: ({ signal }) => api.get('/speakers', { init: { signal } }),
  });
}
