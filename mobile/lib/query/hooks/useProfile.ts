import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
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

function writeProfile(queryClient: QueryClient, update: (user: UserPublic) => UserPublic) {
  queryClient.setQueryData<UserPublic>(queryKeys.me.profile(), (user) => (user ? update(user) : user));
}

/**
 * `PATCH /auth/me { full_name }` — the only self-editable field. The server limits it to
 * 5 changes an hour (429 + Retry-After) and answers a rejected name (links, contact
 * details, blocklisted words, reserved titles) with one generic 422 — callers show that
 * message as-is. Success writes the returned profile into the cache and refetches comment
 * threads, because the public "First L." is computed from the name at read time.
 */
export function useUpdateFullName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fullName: string) => api.patch('/auth/me', { body: { full_name: fullName } }),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me.profile(), user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.profile() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments.all });
    },
  });
}

/**
 * `POST /me/comments-terms` — records acceptance of the comment guidelines (a timestamp,
 * no version). The cached profile is stamped immediately so the composer's gating
 * pre-check passes without waiting for a refetch.
 */
export function useAcceptCommentsTerms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/me/comments-terms'),
    onSuccess: () => {
      writeProfile(queryClient, (user) => ({ ...user, comments_terms_accepted_at: new Date().toISOString() }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.profile() });
    },
  });
}
