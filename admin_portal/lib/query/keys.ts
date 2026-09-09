/**
 * Query-key factory (plan §A.4).
 *
 * Rules, so invalidation stays a graph and not a guessing game:
 *
 *  - Every key is built here. Screens and hooks never write inline arrays —
 *    `queryKeys.sermons.list(params)`, never `["sermons", "list", params]`.
 *  - Each domain roots on a single string segment (`"sermons"`, `"review"`,
 *    `"session"`). `<domain>.all()` is the coarsest handle: invalidating it
 *    drops every query in the domain.
 *  - Lists and details are separate sub-trees under `all()`. `lists()` covers
 *    every filter/pagination combination; `list(params)` is one of them, with
 *    the params object as the final key element (React Query hashes it stably).
 *  - Per-sermon sub-resources (media, uploads, approval log) nest *under*
 *    `detail(id)`, so invalidating one sermon's detail also matches them.
 *
 * Invalidation targets called out in §A.4:
 *   approve / publish / unpublish / submit  →  sermons.lists(),
 *     sermons.detail(id), sermons.approvalLog(id), review.queue()
 *   upload confirm / poll tick              →  sermons.uploads(id),
 *     sermons.media(id)
 */

import type { operations } from "@/lib/api/schema";

/** Query params accepted by `GET /api/v1/sermons`, straight from the schema. */
export type SermonListParams = NonNullable<
  operations["list_my_sermons_api_v1_sermons_get"]["parameters"]["query"]
>;

export const queryKeys = {
  sermons: {
    all: () => ["sermons"] as const,
    lists: () => [...queryKeys.sermons.all(), "list"] as const,
    list: (params: SermonListParams = {}) =>
      [...queryKeys.sermons.lists(), params] as const,
    details: () => [...queryKeys.sermons.all(), "detail"] as const,
    detail: (sermonId: string) =>
      [...queryKeys.sermons.details(), sermonId] as const,
    media: (sermonId: string) =>
      [...queryKeys.sermons.detail(sermonId), "media"] as const,
    uploads: (sermonId: string) =>
      [...queryKeys.sermons.detail(sermonId), "uploads"] as const,
    approvalLog: (sermonId: string) =>
      [...queryKeys.sermons.detail(sermonId), "approval-log"] as const,
    /** The Sermons-list header count line (`N total · N published · …`, W7).
        Its own sub-tree, not a `list()` variant — it is four `limit=1`
        `total` probes, not a page of rows (§A.9 "Sermons list counts"). */
    counts: () => [...queryKeys.sermons.all(), "counts"] as const,
  },
  review: {
    all: () => ["review"] as const,
    /** `queue()` is the coarse handle every workflow mutation invalidates
        (§A.4); `queue({page})` is one rendered page of it. A prefix-match on
        `["review","queue"]` still covers the paged keys. */
    queue: (params?: { page: number }) =>
      params === undefined
        ? ([...queryKeys.review.all(), "queue"] as const)
        : ([...queryKeys.review.all(), "queue", params] as const),
  },
  /** Filter-bar option sources on the Sermons list (W7). Small, rarely-changing
      reference lists — cached long, invalidated by the (Phase 2) screens that
      edit them. */
  speakers: {
    all: () => ["speakers"] as const,
    list: () => [...queryKeys.speakers.all(), "list"] as const,
  },
  series: {
    all: () => ["series"] as const,
    list: () => [...queryKeys.series.all(), "list"] as const,
    /** One series by id — the Series manager edit screen (W11). Nested under
        `all()` so a create/delete that invalidates the domain also drops it. */
    detail: (seriesId: string) =>
      [...queryKeys.series.all(), "detail", seriesId] as const,
  },
  /** Category options for the editor's Details card select (W8). Same
      long-cached reference-list treatment as speakers/series. */
  categories: {
    all: () => ["categories"] as const,
    list: () => [...queryKeys.categories.all(), "list"] as const,
  },
  nav: {
    all: () => ["nav"] as const,
    /** Trailing counts on the sidebar (sermons total, series count, review queue). */
    counts: () => [...queryKeys.nav.all(), "counts"] as const,
  },
  session: {
    all: () => ["session"] as const,
    me: () => [...queryKeys.session.all(), "me"] as const,
  },
} as const;

export type QueryKeys = typeof queryKeys;
