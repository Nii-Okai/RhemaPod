/**
 * `useAnnouncements` — the paged/filtered admin list read model (W13,
 * design Screen 8).
 *
 * `GET /api/v1/announcements/admin/all?status=&limit=&offset=` →
 * `Page[AnnouncementAdminItem]`. Editors see only their own; managers/admins
 * see all — enforced server-side, so this hook does no role branching.
 *
 * `is_visible` on each row is the SERVER's computed truth (status == published
 * AND publish_at past-or-null AND expires_at future-or-null, at fetch time).
 * The list never re-derives visibility on a timer — instead the query carries a
 * modest `refetchInterval` so a row scheduled for the near future flips to Live
 * on the next *refetch* (fresh `is_visible` from the server), not by client
 * clockwork. This is the W13 acceptance criterion made concrete.
 *
 * `loadAnnouncements` is exported and client-injectable so the wire shape (the
 * `status`/`limit`/`offset` params, the `Page` envelope) is exercised through
 * MSW rather than a mocked fetch (plan §A.11).
 */

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { clampPage } from "@/lib/format";
import { queryKeys } from "@/lib/query/keys";

export type AnnouncementAdminItem =
  components["schemas"]["AnnouncementAdminItem"];
export type AnnouncementAdminPage =
  components["schemas"]["Page_AnnouncementAdminItem_"];
export type AnnouncementStatus = components["schemas"]["AnnouncementStatus"];

/** The filter select's value: every workflow status, plus "all". */
export type AnnouncementStatusFilter = AnnouncementStatus | "all";

export const ANNOUNCEMENT_STATUSES: readonly AnnouncementStatus[] = [
  "draft",
  "pending_review",
  "approved",
  "published",
  "rejected",
  "archived",
];

/** Rows per page. Matches the endpoint's `limit` default. */
export const ANNOUNCEMENTS_PAGE_SIZE = 25;

/** List refetch cadence. Long enough not to be chatty for a ~20-user admin
    tool, short enough that a near-future scheduled announcement turns Live
    without a manual reload. A refetch, never a client-side row timer. */
export const ANNOUNCEMENTS_POLL_MS = 60_000;

export function isAnnouncementStatus(
  value: string,
): value is AnnouncementStatus {
  return (ANNOUNCEMENT_STATUSES as readonly string[]).includes(value);
}

/** Normalise a raw `?status=` value to a filter the list understands. */
export function toStatusFilter(raw: string | null | undefined): AnnouncementStatusFilter {
  return raw && isAnnouncementStatus(raw) ? raw : "all";
}

export interface LoadAnnouncementsParams {
  status: AnnouncementStatusFilter;
  page: number;
}

export async function loadAnnouncements(
  { status, page }: LoadAnnouncementsParams,
  client: ApiClient = api,
): Promise<AnnouncementAdminPage> {
  const safePage = clampPage(page);
  return unwrap(
    client.GET("/api/v1/announcements/admin/all", {
      params: {
        query: {
          ...(status === "all" ? {} : { status }),
          limit: ANNOUNCEMENTS_PAGE_SIZE,
          offset: (safePage - 1) * ANNOUNCEMENTS_PAGE_SIZE,
        },
      },
    }),
  );
}

export interface UseAnnouncementsResult {
  items: AnnouncementAdminItem[];
  total: number;
  /** 1-based, clamped to `[1, pageCount]`. */
  page: number;
  pageCount: number;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
}

export function useAnnouncements({
  status,
  page,
}: {
  status: AnnouncementStatusFilter;
  page: number;
}): UseAnnouncementsResult {
  const requestedPage = clampPage(page);

  const query = useQuery({
    queryKey: queryKeys.announcements.list({
      ...(status === "all" ? {} : { status }),
      limit: ANNOUNCEMENTS_PAGE_SIZE,
      offset: (requestedPage - 1) * ANNOUNCEMENTS_PAGE_SIZE,
    }),
    queryFn: () => loadAnnouncements({ status, page: requestedPage }),
    placeholderData: keepPreviousData,
    refetchInterval: ANNOUNCEMENTS_POLL_MS,
  });

  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ANNOUNCEMENTS_PAGE_SIZE));

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
