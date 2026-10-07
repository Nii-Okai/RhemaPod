/**
 * `useNavCounts` — the sidebar's trailing counts (W5).
 *
 * Four independent numbers, each from an endpoint that already exists:
 *   - `sermons`     ← `GET /api/bff/sermons` → `total`   (a `limit=1` probe)
 *   - `series`      ← `GET /api/bff/series`  → array length
 *   - `reviewQueue` ← `GET /api/bff/approvals/sermons/review-queue` → array length
 *   - `comments`    ← `GET /api/bff/admin/comments?needs_review=true&limit=1` → `total`
 *
 * Role tolerance (plan §5 of the W5 brief): if an endpoint 403s for the
 * signed-in role, that count is `null` and the sidebar simply omits it — a
 * missing count must never blank the nav or surface an error. Any other
 * failure (network, 5xx) rejects so React Query can retry/show nothing.
 *
 * One query, not four: `Promise.all` over individually-caught calls
 * keeps a single cache entry and a single loading state, and lets one 403 fall
 * to `null` without disturbing the others.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, type ApiClient } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";

export interface NavCounts {
  /** Total sermons the caller can see, or `null` if the endpoint is forbidden. */
  sermons: number | null;
  /** Series count, or `null` if forbidden. */
  series: number | null;
  /** Sermons awaiting review, or `null` if forbidden (Editors get 403 here). */
  reviewQueue: number | null;
  /** Comments needing moderation (`needs_review=true&limit=1` → `total`;
      an Editor's count covers only their own sermons), or `null` if forbidden. */
  comments: number | null;
}

/** Run one count call; a 403 becomes `null`, anything else rethrows. */
async function count(load: () => Promise<number>): Promise<number | null> {
  try {
    return await load();
  } catch (err) {
    if (isApiError(err) && err.status === 403) return null;
    throw err;
  }
}

/**
 * Fetch all four counts. Exported (and client-injectable) so the wire
 * behaviour — success and the 403→null path — is unit-tested through MSW
 * rather than a mocked fetch (plan §A.11).
 */
export async function loadNavCounts(
  client: ApiClient = api,
): Promise<NavCounts> {
  const [sermons, series, reviewQueue, comments] = await Promise.all([
    count(async () => {
      const { data } = await client.GET("/api/v1/sermons", {
        params: { query: { limit: 1 } },
      });
      return data?.total ?? 0;
    }),
    count(async () => {
      const { data } = await client.GET("/api/v1/series");
      return data?.length ?? 0;
    }),
    count(async () => {
      const { data } = await client.GET(
        "/api/v1/approvals/sermons/review-queue",
        { params: { query: { limit: 1 } } },
      );
      // GATE 3 Batch 3: the queue is now a Page[ReviewQueueItem] envelope.
      return data?.total ?? 0;
    }),
    count(async () => {
      const { data } = await client.GET("/api/v1/admin/comments", {
        params: { query: { needs_review: true, limit: 1 } },
      });
      return data?.total ?? 0;
    }),
  ]);

  return { sermons, series, reviewQueue, comments };
}

const EMPTY_COUNTS: NavCounts = {
  sermons: null,
  series: null,
  reviewQueue: null,
  comments: null,
};

export function useNavCounts(): NavCounts {
  const { data } = useQuery({
    queryKey: queryKeys.nav.counts(),
    queryFn: () => loadNavCounts(),
    staleTime: 60_000,
    // The sidebar mounts fresh right after a sign-in. The browser `QueryClient`
    // is a singleton that outlives the sign-out → sign-in round trip, so within
    // `staleTime` it would otherwise hand the new session the previous user's
    // cached counts and never refetch. Always revalidate on mount — three
    // cheap `limit=1` probes — so the new session's counts are correct without
    // an F5. (The login form also invalidates `nav` keys; this covers a mount
    // that races ahead of that.)
    refetchOnMount: "always",
  });
  return data ?? EMPTY_COUNTS;
}
