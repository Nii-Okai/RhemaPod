import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type UserPublic = components['schemas']['UserPublic'];
export type Gender = components['schemas']['Gender'];

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

export interface ProfileDetailsInput {
  firstName?: string;
  lastName?: string;
  gender?: Gender;
}

/**
 * `PATCH /auth/me/profile { first_name, last_name, gender }` — the Me page's own profile
 * editor (session 2026-10-09), independent of `useUpdateFullName` above (the comments
 * flow's single-field name prompt, untouched). A name change goes through the same
 * moderation/rate-limit `full_name` always has — the server recomputes and publicly
 * displays it as `full_name`, so this invalidates comment threads too, same reason
 * `useUpdateFullName` does. `firstName`/`lastName` must both be given together (the
 * server 422s otherwise); `gender` can be sent alone.
 */
export function useUpdateProfileDetails() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileDetailsInput) =>
      api.patch('/auth/me/profile', {
        body: {
          first_name: input.firstName ?? null,
          last_name: input.lastName ?? null,
          gender: input.gender ?? null,
        },
      }),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me.profile(), user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.profile() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments.all });
    },
  });
}

export interface AvatarAsset {
  /** A local `file://`/`content://`/`ph://` URI from `expo-image-picker` — never
   * uploaded as-is; fetched locally into a blob first (see `useUpdateAvatar`'s own
   * doc comment for why that's the only reliable cross-platform way to PUT it). */
  uri: string;
  contentType: string;
  filename: string;
}

/**
 * Picture upload-ticket → direct-to-storage PUT → confirm, the same three-step
 * sequence every image upload in this codebase uses (sermon/series thumbnails, on the
 * admin side) — just against `/auth/me/avatar/*` instead. The PUT itself bypasses
 * `api`/`apiFetch` entirely: `upload_url` is a presigned URL against the storage
 * bucket directly, not this backend, so it carries no bearer token and isn't in
 * `schema.d.ts`. RN's `fetch` can't stream a local file by URI directly into a raw
 * (non-multipart) PUT body — fetching the local URI first to get its `Blob` is the
 * standard, documented Expo pattern for this, not a workaround.
 */
export function useUpdateAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (asset: AvatarAsset) => {
      const ticket = await api.post('/auth/me/avatar/upload-ticket', {
        body: { filename: asset.filename, content_type: asset.contentType },
      });
      const blob = await (await fetch(asset.uri)).blob();
      const putResponse = await fetch(ticket.upload_url, { method: 'PUT', headers: ticket.headers, body: blob });
      if (!putResponse.ok) throw new Error(`Avatar upload failed (${putResponse.status})`);
      return api.post('/auth/me/avatar/confirm', { params: { query: { avatar_key: ticket.avatar_key } } });
    },
    onSuccess: ({ avatar_url }) => {
      writeProfile(queryClient, (user) => ({ ...user, avatar_url }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.profile() });
    },
  });
}
