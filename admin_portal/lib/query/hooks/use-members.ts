/**
 * Mobile users (viewer accounts) — admin only.
 *
 *   useMembers({ q, status, page })  GET /api/v1/users/members → Page[UserPublic]
 *
 * Deactivate, reactivate and remove reuse the staff hooks in `use-users.ts`
 * (`PATCH /users/{id}/active`, `DELETE /users/{id}`): the server allows an
 * admin to switch a viewer off and on, and to remove one once it is
 * deactivated. Both mutations invalidate `users.all()`, which this list sits
 * under, so it refetches after either.
 */

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import { clampPage } from "@/lib/format";
import { queryKeys, type MemberListParams } from "@/lib/query/keys";
import type { UserPage } from "@/lib/query/hooks/use-users";

export const MEMBERS_PAGE_SIZE = 25;

export type MemberStatusFilter = "all" | "active" | "deactivated";

export function toMemberStatus(raw: string | null | undefined): MemberStatusFilter {
  return raw === "active" || raw === "deactivated" ? raw : "all";
}

export interface MembersFilters {
  q: string;
  status: MemberStatusFilter;
  page: number;
}

export function membersQuery({ q, status, page }: MembersFilters): MemberListParams {
  const trimmed = q.trim();
  return {
    ...(trimmed ? { q: trimmed.slice(0, 200) } : {}),
    ...(status === "all" ? {} : { status }),
    limit: MEMBERS_PAGE_SIZE,
    offset: (clampPage(page) - 1) * MEMBERS_PAGE_SIZE,
  };
}

export async function loadMembers(
  query: MemberListParams,
  client: ApiClient = api,
): Promise<UserPage> {
  return unwrap(client.GET("/api/v1/users/members", { params: { query } }));
}

export function useMembers(filters: MembersFilters) {
  const query = membersQuery(filters);
  const result = useQuery({
    queryKey: queryKeys.users.members(query),
    queryFn: () => loadMembers(query),
    placeholderData: keepPreviousData,
  });
  const total = result.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / MEMBERS_PAGE_SIZE));
  return {
    items: result.data?.items ?? [],
    total,
    page: Math.min(clampPage(filters.page), pageCount),
    pageCount,
    isPending: result.isPending,
    isError: result.isError,
    error: result.error,
  };
}
