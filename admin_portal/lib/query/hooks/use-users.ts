/**
 * Users & roles — read + write hooks (W17, design Screen 10).
 *
 *   useUsers({ role, page })  GET   /api/v1/users?role=&limit=&offset=  → Page[UserPublic]
 *   useRoleCounts()           GET   /api/v1/users/role-counts           → RoleCounts
 *   useChangeUserRole()       PATCH /api/v1/users/{id}/role             → UserPublic
 *   useInviteStaff()          POST  /api/v1/users                       → StaffCreateResponse (201)
 *
 * `GET /users` is hard-scoped to staff roles for every actor (Batch 7 #1,
 * plan §A.6 decision 5) — a viewer is never a row, with or without the filter,
 * and `role=viewer` is a 400. The filter therefore only ever offers
 * All / Editors / Managers / Admins. The viewer headcount comes from the
 * full-table `role-counts` aggregate, which *does* carry a real `viewer`
 * bucket (a count identifies no one).
 *
 * The inline role change is optimistic with rollback (the people screen's
 * speaker-edit precedent). On `onMutate` every cached list page is patched:
 * a page with no `role` filter (or one whose filter still matches the new
 * role) keeps the row with its role updated in place; a page whose `role`
 * filter no longer matches drops the row entirely and decrements its `total`,
 * so a promotion never flashes a mismatched chip inside a filtered list. A
 * `_may_assign` 400 restores the verbatim snapshot and the screen shows the
 * typed message as a card-top alert. Invite is not optimistic — it invalidates
 * the `users` domain so the new row and the shifted tiles both refetch.
 *
 * `loadUsers` / `loadRoleCounts` are exported and client-injectable so the wire
 * shape is exercised through MSW rather than a mocked fetch (plan §A.11).
 */

"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { clampPage } from "@/lib/format";
import { queryKeys, type UserListParams } from "@/lib/query/keys";

export type UserPublic = components["schemas"]["UserPublic"];
export type UserPage = components["schemas"]["Page_UserPublic_"];
export type RoleCounts = components["schemas"]["RoleCounts"];
export type StaffCreateRequest = components["schemas"]["StaffCreateRequest"];
export type StaffCreateResponse = components["schemas"]["StaffCreateResponse"];
export type UserActiveResponse = components["schemas"]["UserActiveResponse"];
export type UserRole = components["schemas"]["UserRole"];

/** Matches the endpoint's `limit` default (`Query(default=25, le=100)`). The
    staff table is tiny, so pagination is a safety net, not a routine control. */
export const USERS_PAGE_SIZE = 25;

/** The role filter's value — the three staff roles plus "all". Never "viewer":
    the staff directory has no viewers and the endpoint 400s on `role=viewer`. */
export type StaffRoleFilter = "all" | "editor" | "manager" | "admin";

export const STAFF_ROLE_FILTERS = ["editor", "manager", "admin"] as const;

/** Normalise a raw `?role=` value to a filter the list understands. Anything
    else — including `viewer` and garbage — falls back to "all". */
export function toRoleFilter(raw: string | null | undefined): StaffRoleFilter {
  return raw === "editor" || raw === "manager" || raw === "admin" ? raw : "all";
}

export interface LoadUsersParams {
  role: StaffRoleFilter;
  page: number;
}

export async function loadUsers(
  { role, page }: LoadUsersParams,
  client: ApiClient = api,
): Promise<UserPage> {
  const safePage = clampPage(page);
  return unwrap(
    client.GET("/api/v1/users", {
      params: {
        query: {
          ...(role === "all" ? {} : { role }),
          limit: USERS_PAGE_SIZE,
          offset: (safePage - 1) * USERS_PAGE_SIZE,
        },
      },
    }),
  );
}

export interface UseUsersResult {
  items: UserPublic[];
  total: number;
  /** 1-based, clamped to `[1, pageCount]`. */
  page: number;
  pageCount: number;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
}

export function useUsers({
  role,
  page,
}: {
  role: StaffRoleFilter;
  page: number;
}): UseUsersResult {
  const requestedPage = clampPage(page);

  const query = useQuery({
    queryKey: queryKeys.users.list({
      ...(role === "all" ? {} : { role }),
      limit: USERS_PAGE_SIZE,
      offset: (requestedPage - 1) * USERS_PAGE_SIZE,
    }),
    queryFn: () => loadUsers({ role, page: requestedPage }),
    placeholderData: keepPreviousData,
  });

  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));

  return {
    items: query.data?.items ?? [],
    total,
    page: Math.min(requestedPage, pageCount),
    pageCount,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}

export async function loadRoleCounts(
  client: ApiClient = api,
): Promise<RoleCounts> {
  return unwrap(client.GET("/api/v1/users/role-counts"));
}

export function useRoleCounts() {
  return useQuery({
    queryKey: queryKeys.users.roleCounts(),
    queryFn: () => loadRoleCounts(),
    staleTime: 60_000,
  });
}

/* --- inline role change (optimistic, rollback on any error) -------------- */

export interface ChangeRoleVars {
  id: string;
  role: UserRole;
}

type ListSnapshot = Array<[readonly unknown[], UserPage | undefined]>;

export function useChangeUserRole() {
  const qc = useQueryClient();
  return useMutation<UserPublic, Error, ChangeRoleVars, { snapshots: ListSnapshot }>(
    {
      mutationFn: ({ id, role }) =>
        unwrap(
          api.PATCH("/api/v1/users/{user_id}/role", {
            params: { path: { user_id: id } },
            body: { role },
          }),
        ),
      onMutate: async ({ id, role }) => {
        await qc.cancelQueries({ queryKey: queryKeys.users.lists() });
        const snapshots = qc.getQueriesData<UserPage>({
          queryKey: queryKeys.users.lists(),
        }) as ListSnapshot;
        for (const [key, pageData] of snapshots) {
          if (!pageData) continue;

          // The list key is `[...lists(), params]`; the params object carries
          // the `role` filter (absent for the "all" list).
          const params = key[key.length - 1] as UserListParams | undefined;
          const filterRole =
            params && typeof params === "object" ? params.role : undefined;

          if (filterRole && filterRole !== role) {
            // This page is filtered to a role the row no longer has — drop it
            // rather than render a mismatched chip until `onSettled` refetches.
            if (!pageData.items.some((u) => u.id === id)) continue;
            const items = pageData.items.filter((u) => u.id !== id);
            qc.setQueryData<UserPage>(key, {
              ...pageData,
              items,
              ...(typeof pageData.total === "number"
                ? { total: Math.max(0, pageData.total - 1) }
                : {}),
            });
            continue;
          }

          // No filter, or the new role still matches — keep the row, updated.
          qc.setQueryData<UserPage>(key, {
            ...pageData,
            items: pageData.items.map((u) =>
              u.id === id ? { ...u, role } : u,
            ),
          });
        }
        return { snapshots };
      },
      onError: (_err, _vars, context) => {
        for (const [key, pageData] of context?.snapshots ?? []) {
          qc.setQueryData(key, pageData);
        }
      },
      onSettled: () => {
        // Prefix-matches both `users/list/*` and `users/role-counts` — the row
        // moved buckets, so the tiles are stale too.
        void qc.invalidateQueries({ queryKey: queryKeys.users.all() });
      },
    },
  );
}

/* --- invite staff (not optimistic — invalidate + refetch) --------------- */

export function useInviteStaff() {
  const qc = useQueryClient();
  return useMutation<StaffCreateResponse, Error, StaffCreateRequest>({
    mutationFn: (body) => unwrap(api.POST("/api/v1/users", { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users.all() });
    },
  });
}

/* --- deactivate / reactivate (optimistic state flip, rollback on error) -- */

export interface SetUserActiveVars {
  id: string;
  isActive: boolean;
}

/**
 * `PATCH /users/{id}/active` — flip a staff account on or off. Optimistic on
 * the row's `is_active` (the `useChangeUserRole` precedent): every cached list
 * page has the row patched in place so the State badge flips immediately, and
 * any error — the 403 authz mirror, or the 409 last-admin invariant the screen
 * renders as an explanatory inline message — restores the verbatim snapshot.
 * State is not a list filter, so unlike a role change no page ever drops the
 * row. `onSettled` invalidates `users.all()` (list + `role-counts` tiles — a
 * deactivate leaves the by-role counts unchanged, but the coarse handle is one
 * call and the list must refetch regardless).
 *
 * The 200 body carries `revocation_deferred`: `true` when the state change
 * committed but the Redis-backed refresh-token revoke could not be recorded
 * (plan §W18, GATE 6 = commit-first). The screen surfaces it as a
 * non-blocking note.
 */
export function useSetUserActive() {
  const qc = useQueryClient();
  return useMutation<
    UserActiveResponse,
    Error,
    SetUserActiveVars,
    { snapshots: ListSnapshot }
  >({
    mutationFn: ({ id, isActive }) =>
      unwrap(
        api.PATCH("/api/v1/users/{user_id}/active", {
          params: { path: { user_id: id } },
          body: { is_active: isActive },
        }),
      ),
    onMutate: async ({ id, isActive }) => {
      await qc.cancelQueries({ queryKey: queryKeys.users.lists() });
      const snapshots = qc.getQueriesData<UserPage>({
        queryKey: queryKeys.users.lists(),
      }) as ListSnapshot;
      for (const [key, pageData] of snapshots) {
        if (!pageData) continue;
        qc.setQueryData<UserPage>(key, {
          ...pageData,
          items: pageData.items.map((u) =>
            u.id === id ? { ...u, is_active: isActive } : u,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      for (const [key, pageData] of context?.snapshots ?? []) {
        qc.setQueryData(key, pageData);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users.all() });
    },
  });
}

/* --- resend invite (not optimistic — nothing on the row changes) -------- */

/**
 * `POST /users/{id}/resend-invite` — re-issue the set-password link for a staff
 * account still on `activated_at == null`. Nothing on the row changes, so there
 * is no optimistic write and no cache invalidation; the screen gives explicit
 * success feedback (decision 8 — this is the only invite affordance left) and
 * renders the typed 409 / 429 / 503 rejections as distinct inline messages.
 */
export function useResendInvite() {
  return useMutation<StaffCreateResponse, Error, { id: string }>({
    mutationFn: ({ id }) =>
      unwrap(
        api.POST("/api/v1/users/{user_id}/resend-invite", {
          params: { path: { user_id: id } },
        }),
      ),
  });
}
