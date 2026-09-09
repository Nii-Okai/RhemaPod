/**
 * `useReviewQueue` — the paged Review queue read model (W10, design Screen 5).
 *
 * `GET /api/v1/approvals/sermons/review-queue?limit&offset` →
 * `Page[ReviewQueueItem]` (GATE 3 Batch 3). The backend already orders it
 * longest-waiting-first, so this hook is a thin paged `useQuery` — the same
 * shape as `useSermons`, with `keepPreviousData` so paging never blanks the
 * list.
 *
 * `loadReviewQueue` is exported and client-injectable so the wire shape (the
 * `limit`/`offset` params, the envelope) is exercised through MSW rather than a
 * mocked fetch (plan §A.11).
 */

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type ReviewQueueItem = components["schemas"]["ReviewQueueItem"];
export type ReviewQueuePage = components["schemas"]["Page_ReviewQueueItem_"];

/** Cards per page. Matches the endpoint's `limit` default. */
export const REVIEW_PAGE_SIZE = 25;

export async function loadReviewQueue(
  page: number,
  client: ApiClient = api,
): Promise<ReviewQueuePage> {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  return unwrap(
    client.GET("/api/v1/approvals/sermons/review-queue", {
      params: {
        query: {
          limit: REVIEW_PAGE_SIZE,
          offset: (safePage - 1) * REVIEW_PAGE_SIZE,
        },
      },
    }),
  );
}

export interface UseReviewQueueResult {
  items: ReviewQueueItem[];
  total: number;
  /** 1-based, clamped to `[1, pageCount]`. */
  page: number;
  pageCount: number;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
}

export function useReviewQueue({
  page,
}: {
  page: number;
}): UseReviewQueueResult {
  const requestedPage =
    Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;

  const query = useQuery({
    queryKey: queryKeys.review.queue({ page: requestedPage }),
    queryFn: () => loadReviewQueue(requestedPage),
    placeholderData: keepPreviousData,
  });

  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));

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
