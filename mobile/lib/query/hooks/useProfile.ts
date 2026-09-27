import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type UserPublic = components['schemas']['UserPublic'];

/**
 * `GET /api/v1/auth/me` — the signed-in caller's own profile (design spec 1n's
 * avatar/name/email block). Deliberately read through `lib/api/typedClient.ts`
 * like every other authenticated GET in this app, not `lib/api/authClient.ts`
 * (that module is reserved for the four unauthenticated auth endpoints plus
 * logout — see its own docstring — this call needs the bearer token and the
 * normal 401-refresh-retry behavior, which only `apiFetch`/`typedClient` give it).
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.me.profile(),
    queryFn: ({ signal }) => api.get('/auth/me', { init: { signal } }),
  });
}
