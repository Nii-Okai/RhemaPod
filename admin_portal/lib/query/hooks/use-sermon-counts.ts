/**
 * `useSermonCounts` — the Sermons-list header count line (W7).
 *
 *   "128 total · 96 published · 12 awaiting review"
 *
 * The contract has no status-breakdown endpoint (plan §A.9 "Sermons list
 * counts"). `GET /sermons` only ever returns `total` for the *current* filter,
 * so this derives the line from four cheap `limit=1` probes and reads `total`
 * off each. "Awaiting review" is `pending_review + under_review` — the two
 * states a submitted sermon sits in before a manager acts.
 *
 * Wire behaviour (success + the shape of the four probes) is exercised through
 * MSW in `tests/portal/sermons-counts.test.ts`, per §A.11 — never a mocked
 * fetch. This remains the documented gap: a `GET /sermons/stats` (or a
 * `group_by=status` on the list) would replace four requests with one.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, type ApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";

export interface SermonCounts {
  total: number;
  published: number;
  awaitingReview: number;
}

/** Four `limit=1` `total` probes. Exported (client-injectable) so the wire
    shape is unit-tested through MSW rather than a mocked fetch (§A.11). */
export async function loadSermonCounts(
  client: ApiClient = api,
): Promise<SermonCounts> {
  const probe = async (
    query: Record<string, string>,
  ): Promise<number> => {
    const { data } = await client.GET("/api/v1/sermons", {
      params: { query: { ...query, limit: 1 } },
    });
    return data?.total ?? 0;
  };

  const [total, published, pendingReview, underReview] = await Promise.all([
    probe({}),
    probe({ status: "published" }),
    probe({ status: "pending_review" }),
    probe({ status: "under_review" }),
  ]);

  return { total, published, awaitingReview: pendingReview + underReview };
}

/**
 * The subtitle string. Pure — unit-tested. `undefined` (counts not loaded yet)
 * yields a neutral descriptive line so the header never renders a half-empty
 * "· ·" skeleton.
 */
export function sermonCountLine(counts: SermonCounts | undefined): string {
  if (!counts) return "Draft, review and publish the spoken word.";
  const n = (value: number) => value.toLocaleString("en-US");
  return `${n(counts.total)} total · ${n(counts.published)} published · ${n(
    counts.awaitingReview,
  )} awaiting review`;
}

export function useSermonCounts() {
  return useQuery({
    queryKey: queryKeys.sermons.counts(),
    queryFn: () => loadSermonCounts(),
    staleTime: 60_000,
  });
}
