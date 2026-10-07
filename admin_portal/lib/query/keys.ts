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

/** Query params accepted by `GET /api/v1/announcements/admin/all` (W13). */
export type AnnouncementListParams = NonNullable<
  operations["list_all_announcements_api_v1_announcements_admin_all_get"]["parameters"]["query"]
>;

/** Query params accepted by `GET /api/v1/users` — staff-scoped list + `role`
    filter (W17 / Batch 7 #1). `role=viewer` is a 400; the filter never offers
    it. */
export type UserListParams = NonNullable<
  operations["list_users_api_v1_users_get"]["parameters"]["query"]
>;

/** Query params accepted by `GET /api/v1/admin/subscriptions` — the staff
    subscriptions read (W20 / W21): `{limit, offset, status?, tier?}`. */
export type SubscriptionListParams = NonNullable<
  operations["list_subscriptions_api_v1_admin_subscriptions_get"]["parameters"]["query"]
>;

/** Query params accepted by `GET /api/v1/admin/comments` (S12). */
export type AdminCommentListParams = NonNullable<
  operations["list_admin_comments_api_v1_admin_comments_get"]["parameters"]["query"]
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
    /** Signed playback URLs (`GET /sermons/{id}/stream`). Nested under
        `detail(id)` so a sermon-scoped invalidation also drops it; short-lived
        (the URLs carry an `expires_in`), fetched only while a player is open. */
    stream: (sermonId: string) =>
      [...queryKeys.sermons.detail(sermonId), "stream"] as const,
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
  /** Announcements admin list + editor (W13). Same shape as `speakers` /
      `categories` — a domain root plus a `list()` sub-tree — but `list()` takes
      the `{status, limit, offset}` params object (React Query hashes it stably),
      so `lists()` is the coarse handle every announcement mutation invalidates.
      There is no per-id `detail()`: the list carries `body`, and the by-id
      admin read is manager-only, so the editor panel is fed straight from the
      list cache. */
  announcements: {
    all: () => ["announcements"] as const,
    lists: () => [...queryKeys.announcements.all(), "list"] as const,
    list: (params: AnnouncementListParams = {}) =>
      [...queryKeys.announcements.lists(), params] as const,
  },
  nav: {
    all: () => ["nav"] as const,
    /** Trailing counts on the sidebar (sermons total, series count, review queue). */
    counts: () => [...queryKeys.nav.all(), "counts"] as const,
  },
  /** Upload jobs not nested under a single sermon. `inFlight()` is the
      Dashboard "Processing" WIP card's feed (`GET /uploads/in-flight`) — every
      still-moving job across the sermons the caller may see. Per-sermon job
      lists stay under `sermons.uploads(id)`. */
  uploads: {
    all: () => ["uploads"] as const,
    inFlight: () => [...queryKeys.uploads.all(), "in-flight"] as const,
  },
  /** Admin analytics reads behind the manager/admin Dashboard variant (W23).
      Each is its own leaf — they share nothing and invalidate independently.
      An editor session never mounts the component that runs these, so an
      editor's cache never holds an `analytics` key. */
  analytics: {
    all: () => ["analytics"] as const,
    overview: () => [...queryKeys.analytics.all(), "overview"] as const,
    topSermons: () => [...queryKeys.analytics.all(), "top-sermons"] as const,
    newListeners: () =>
      [...queryKeys.analytics.all(), "new-listeners"] as const,
  },
  /** Users & roles screen (W17). Same shape as `announcements` — a domain root,
      a `list()` sub-tree keyed on `{role?, limit, offset}` (React Query hashes
      it stably), plus a sibling `roleCounts()` aggregate that feeds the tiles.
      `all()` is the coarse handle every user mutation invalidates: it
      prefix-matches both `list` and `role-counts`, so an invite or a role
      change refreshes the list and the tiles in one call. */
  users: {
    all: () => ["users"] as const,
    lists: () => [...queryKeys.users.all(), "list"] as const,
    list: (params: UserListParams = {}) =>
      [...queryKeys.users.lists(), params] as const,
    roleCounts: () => [...queryKeys.users.all(), "role-counts"] as const,
  },
  /** Subscriptions screen (W21). Same shape as `users` — a domain root, a
      `list()` sub-tree keyed on `{status?, tier?, limit, offset}` (React Query
      hashes it stably), plus a sibling `counts()` aggregate that feeds the
      three tiles. The screen is read-only (plan §A.3): nothing invalidates
      these, they just go stale on their own timer. */
  subscriptions: {
    all: () => ["subscriptions"] as const,
    lists: () => [...queryKeys.subscriptions.all(), "list"] as const,
    list: (params: SubscriptionListParams = {}) =>
      [...queryKeys.subscriptions.lists(), params] as const,
    counts: () => [...queryKeys.subscriptions.all(), "counts"] as const,
  },
  /** Comments moderation queue (S12). `all()` is the coarse handle every
      moderation mutation invalidates: it prefix-matches the paged lists and
      the per-sermon editor-card counts. */
  comments: {
    all: () => ["comments"] as const,
    lists: () => [...queryKeys.comments.all(), "list"] as const,
    list: (params: AdminCommentListParams = {}) =>
      [...queryKeys.comments.lists(), params] as const,
    sermonCounts: (sermonId: string) =>
      [...queryKeys.comments.all(), "sermon-counts", sermonId] as const,
  },
  session: {
    all: () => ["session"] as const,
    me: () => [...queryKeys.session.all(), "me"] as const,
  },
} as const;

export type QueryKeys = typeof queryKeys;
