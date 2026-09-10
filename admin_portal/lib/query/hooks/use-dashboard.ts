/**
 * Dashboard read models (W23, plan §A.1).
 *
 * Two groups, and the split is load-bearing:
 *
 *   WIP cards — `useDraftsWip` / `useRejectedWip` / `useInFlightUploads`.
 *     Rendered for EVERY role. Author-scoped: the two sermon reads carry
 *     `created_by=me` (Batch 7 #3); `/uploads/in-flight` is already scoped to
 *     the caller's sermons server-side (Batch 7 #4).
 *
 *   Analytics — `useOverview` / `useTopSermons` / `useNewListeners`.
 *     `GET /admin/analytics/*`, each `require_role(MANAGER, ADMIN)`. These hooks
 *     are only ever called from `<DashboardAnalytics>`, which the Server
 *     Component renders solely in the manager/admin branch. An editor session
 *     never mounts that component, so these queries never run and an editor's
 *     token never hits those routes — no 403 in the network log because there
 *     is no call (§W23 acceptance).
 *
 * Every `load*` is exported and client-injectable so the wire shape is
 * exercised through MSW, not a mocked fetch (plan §A.11). Nothing here computes
 * a statistic — each value is a backend response field passed straight through.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";
import {
  useSermons,
  type SermonListItem,
  type SermonListPage,
} from "@/lib/query/hooks/use-sermons";

export type OverviewStats = components["schemas"]["OverviewStats"];
export type TopSermonStat = components["schemas"]["TopSermonStat"];
export type NewListenersBucket = components["schemas"]["NewListenersBucket"];
export type UploadJob = components["schemas"]["UploadJobPublic"];
export type { SermonListItem, SermonListPage };

/** Titles shown in the short list under each WIP card's count. */
export const WIP_LIST_LIMIT = 5;

/** Ranked rows requested for the "Top sermons" card (design shows 4). */
export const TOP_SERMONS_LIMIT = 5;

/** Poll cadence for the "Processing" card while any job is in flight. Every row
    the endpoint returns is non-terminal by definition, so the predicate is
    simply "the list is non-empty". */
const IN_FLIGHT_POLL_MS = 5000;

/* --- WIP: drafts / rejected (author-scoped sermon lists) ---------------- */

/**
 * `GET /sermons?status=<status>&created_by=me` — a page window capped at
 * `WIP_LIST_LIMIT` rows; `total` is the real count for the card. `created_by=me`
 * is on the wire for both statuses (a no-op for an editor, a real filter for a
 * manager/admin so their Dashboard shows *their* work, not everyone's).
 */
export function useDraftsWip() {
  return useSermons({
    status: "draft",
    created_by: "me",
    limit: WIP_LIST_LIMIT,
  });
}

export function useRejectedWip() {
  return useSermons({
    status: "rejected",
    created_by: "me",
    limit: WIP_LIST_LIMIT,
  });
}

/* --- WIP: processing (in-flight uploads across the caller's sermons) ---- */

export async function loadInFlightUploads(
  client: ApiClient = api,
): Promise<UploadJob[]> {
  return unwrap(client.GET("/api/v1/uploads/in-flight"));
}

export function useInFlightUploads() {
  return useQuery({
    queryKey: queryKeys.uploads.inFlight(),
    queryFn: () => loadInFlightUploads(),
    // A job leaving the pipeline just drops out of this list; poll while it is
    // non-empty so a freshly-finished transcode clears without a reload.
    refetchInterval: (query) =>
      (query.state.data?.length ?? 0) > 0 ? IN_FLIGHT_POLL_MS : false,
  });
}

/* --- analytics (manager/admin branch only) ----------------------------- */

export async function loadOverview(
  client: ApiClient = api,
): Promise<OverviewStats> {
  return unwrap(client.GET("/api/v1/admin/analytics/overview"));
}

export function useOverview() {
  return useQuery({
    queryKey: queryKeys.analytics.overview(),
    queryFn: () => loadOverview(),
    staleTime: 60_000,
  });
}

export async function loadTopSermons(
  limit: number = TOP_SERMONS_LIMIT,
  client: ApiClient = api,
): Promise<TopSermonStat[]> {
  return unwrap(
    client.GET("/api/v1/admin/analytics/top-sermons", {
      params: { query: { limit } },
    }),
  );
}

export function useTopSermons() {
  return useQuery({
    queryKey: queryKeys.analytics.topSermons(),
    queryFn: () => loadTopSermons(),
    staleTime: 60_000,
  });
}

export async function loadNewListeners(
  client: ApiClient = api,
): Promise<NewListenersBucket[]> {
  return unwrap(client.GET("/api/v1/admin/analytics/new-listeners"));
}

export function useNewListeners() {
  return useQuery({
    queryKey: queryKeys.analytics.newListeners(),
    queryFn: () => loadNewListeners(),
    staleTime: 60_000,
  });
}
