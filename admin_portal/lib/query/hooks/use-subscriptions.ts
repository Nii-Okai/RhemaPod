/**
 * Subscriptions — read-only hooks (W21, design Screen 9).
 *
 *   useSubscriptions({ status, tier, page })
 *     GET /api/v1/admin/subscriptions?status=&tier=&limit=&offset=
 *       → Page[SubscriptionAdminItem]
 *   useSubscriptionCounts()
 *     GET /api/v1/admin/subscriptions/counts → { active_paid, monthly, annual }
 *
 * The screen makes **no mutating call of any kind** (plan §A.3 / §W21) — there
 * is no cancel, refund, plan-change, retry or sync. Everything mutating a
 * subscription happens with the payment provider; this portal only reads. So
 * there are no mutation hooks here and nothing invalidates these queries — the
 * list falls stale 30s after a fetch and the counts 60s (`staleTime` below),
 * each refetching on the next mount or window refocus past that window.
 *
 * `loadSubscriptions` / `loadSubscriptionCounts` are exported and
 * client-injectable so the wire shape is exercised through MSW rather than a
 * mocked fetch (plan §A.11).
 */

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { clampPage } from "@/lib/format";
import { queryKeys } from "@/lib/query/keys";

export type SubscriptionAdminItem =
  components["schemas"]["SubscriptionAdminItem"];
export type SubscriptionPage =
  components["schemas"]["Page_SubscriptionAdminItem_"];
export type SubscriptionCounts = components["schemas"]["SubscriptionCounts"];
export type SubscriptionStatus = components["schemas"]["SubscriptionStatus"];
export type SubscriptionTier = components["schemas"]["SubscriptionTier"];

/** Matches the endpoint's `limit` default (`Query(default=25, le=100)`). */
export const SUBSCRIPTIONS_PAGE_SIZE = 25;

/** The four `SubscriptionStatus` values, in the order the filter offers them. */
export const SUBSCRIPTION_STATUSES = [
  "active",
  "past_due",
  "cancelled",
  "expired",
] as const satisfies readonly SubscriptionStatus[];

/** The three `SubscriptionTier` values. */
export const SUBSCRIPTION_TIERS = [
  "free",
  "monthly",
  "annual",
] as const satisfies readonly SubscriptionTier[];

/** Normalise a raw `?status=` value to a real `SubscriptionStatus`, or
    `undefined` (no filter) for anything else. */
export function toStatusFilter(
  raw: string | null | undefined,
): SubscriptionStatus | undefined {
  return SUBSCRIPTION_STATUSES.includes(raw as SubscriptionStatus)
    ? (raw as SubscriptionStatus)
    : undefined;
}

/** Normalise a raw `?tier=` value to a real `SubscriptionTier`, or
    `undefined` (no filter) for anything else. */
export function toTierFilter(
  raw: string | null | undefined,
): SubscriptionTier | undefined {
  return SUBSCRIPTION_TIERS.includes(raw as SubscriptionTier)
    ? (raw as SubscriptionTier)
    : undefined;
}

export interface LoadSubscriptionsParams {
  status?: SubscriptionStatus;
  tier?: SubscriptionTier;
  page: number;
}

export async function loadSubscriptions(
  { status, tier, page }: LoadSubscriptionsParams,
  client: ApiClient = api,
): Promise<SubscriptionPage> {
  const safePage = clampPage(page);
  return unwrap(
    client.GET("/api/v1/admin/subscriptions", {
      params: {
        query: {
          ...(status ? { status } : {}),
          ...(tier ? { tier } : {}),
          limit: SUBSCRIPTIONS_PAGE_SIZE,
          offset: (safePage - 1) * SUBSCRIPTIONS_PAGE_SIZE,
        },
      },
    }),
  );
}

export interface UseSubscriptionsResult {
  items: SubscriptionAdminItem[];
  total: number;
  /** 1-based, clamped to `[1, pageCount]`. */
  page: number;
  pageCount: number;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
}

export function useSubscriptions({
  status,
  tier,
  page,
}: {
  status?: SubscriptionStatus;
  tier?: SubscriptionTier;
  page: number;
}): UseSubscriptionsResult {
  const requestedPage = clampPage(page);

  const query = useQuery({
    queryKey: queryKeys.subscriptions.list({
      ...(status ? { status } : {}),
      ...(tier ? { tier } : {}),
      limit: SUBSCRIPTIONS_PAGE_SIZE,
      offset: (requestedPage - 1) * SUBSCRIPTIONS_PAGE_SIZE,
    }),
    queryFn: () => loadSubscriptions({ status, tier, page: requestedPage }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / SUBSCRIPTIONS_PAGE_SIZE));

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

export async function loadSubscriptionCounts(
  client: ApiClient = api,
): Promise<SubscriptionCounts> {
  return unwrap(client.GET("/api/v1/admin/subscriptions/counts"));
}

export function useSubscriptionCounts() {
  return useQuery({
    queryKey: queryKeys.subscriptions.counts(),
    queryFn: () => loadSubscriptionCounts(),
    staleTime: 60_000,
  });
}
