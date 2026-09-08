/**
 * `useSermonsQuery` — the Sermons-list read model (W7).
 *
 * ── URL is the state (plan W7 acceptance, design "Navigation: URL is source
 *    of truth") ────────────────────────────────────────────────────────────
 * Every filter / page choice lives in the query string:
 *
 *     ?status=&speaker=&series=&tier=&q=&page=
 *
 * so a reload and the back button both restore the exact view. This hook only
 * *reads* it (`useSearchParams`); the screen writes it with `router.replace`
 * (not `push` — a filter tweak should not stack history) via the pure
 * `buildSermonsSearch` helper below.
 *
 * ── status → API (`GET /sermons` takes ONE `status` enum, plan §A.9) ───────
 *     all       → no status filter
 *     drafts    → status=draft
 *     published → status=published
 *     in-review → status=pending_review  AND  status=under_review
 *
 * The backend `status` param is a single `SermonStatus` — no list, no `in`
 * (verified in `app/api/sermons.py`). So "In review" is the one tab that can't
 * be one request: this hook mounts two `useSermons` calls, each capped at
 * `MERGE_CAP` rows, merges them in the backend's own order (updated_at desc,
 * then created_at desc) and paginates the union on the client.
 *
 *   ⚠ Backend gap → [GATE 3 Batch 2]: `GET /sermons` should accept multiple
 *   `status` values (or expose an `in_review` shorthand) so "In review" is a
 *   single, properly-paginated query. Until then the union is correct only up
 *   to `MERGE_CAP` sermons per sub-state; `mergeCapExceeded` flags when that
 *   ceiling is hit so the screen can warn instead of silently truncating.
 */

"use client";

import { useEffect, useMemo } from "react";
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation";

import type { SermonStatus } from "@/components/sermons/sermon-status";
import type { SermonListParams } from "@/lib/query/keys";
import {
  useSermons,
  type SermonListItem,
  type SermonListPage,
} from "@/lib/query/hooks/use-sermons";

/** The four segmented-control values — also the `?status=` slugs. */
export type StatusFilter = "all" | "drafts" | "in-review" | "published";

const STATUS_FILTERS: readonly StatusFilter[] = [
  "all",
  "drafts",
  "in-review",
  "published",
];

export type TierFilter = "free" | "paid";

/** The parsed, validated URL state. */
export interface SermonsUrlState {
  status: StatusFilter;
  speakerId?: string;
  seriesId?: string;
  tier?: TierFilter;
  q?: string;
  /** 1-based, always ≥ 1. */
  page: number;
}

/** Rows per page. Matches the backend default (`limit=25`). */
export const PAGE_SIZE = 25;

/** Per-sub-state ceiling for the "In review" union (see the module note). */
export const MERGE_CAP = 100;

type ParamSource =
  | URLSearchParams
  | ReadonlyURLSearchParams
  | { get(key: string): string | null };

/**
 * Parse `?status=&speaker=&series=&tier=&q=&page=` into validated state.
 * Unknown / malformed values fall back to a safe default — an unknown status
 * is "all", `page=0` / `page=-3` / `page=abc` are all page 1, a junk tier is
 * dropped. Pure; unit-tested.
 */
export function parseSermonsParams(params: ParamSource): SermonsUrlState {
  const rawStatus = params.get("status");
  const status = STATUS_FILTERS.includes(rawStatus as StatusFilter)
    ? (rawStatus as StatusFilter)
    : "all";

  const rawTier = params.get("tier");
  const tier: TierFilter | undefined =
    rawTier === "free" || rawTier === "paid" ? rawTier : undefined;

  const rawPage = Number(params.get("page"));
  const page =
    Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const trimmed = (key: string): string | undefined => {
    const value = params.get(key)?.trim();
    return value ? value : undefined;
  };

  return {
    status,
    speakerId: trimmed("speaker"),
    seriesId: trimmed("series"),
    tier,
    q: trimmed("q"),
    page,
  };
}

/** The backend `status` values a tab maps to (empty = no filter). */
export function apiStatusesFor(status: StatusFilter): SermonStatus[] {
  switch (status) {
    case "drafts":
      return ["draft"];
    case "published":
      return ["published"];
    case "in-review":
      return ["pending_review", "under_review"];
    case "all":
      return [];
  }
}

/** Non-status filters, as `GET /sermons` query params. */
function nonStatusParams(state: SermonsUrlState): SermonListParams {
  const params: SermonListParams = {};
  if (state.speakerId) params.speaker_id = state.speakerId;
  if (state.seriesId) params.series_id = state.seriesId;
  if (state.tier) params.tier = state.tier;
  if (state.q) params.q = state.q;
  return params;
}

/** The keys `buildSermonsSearch` understands. `undefined` clears the param. */
export interface SermonsFilterPatch {
  status?: StatusFilter;
  speaker?: string;
  series?: string;
  tier?: TierFilter;
  q?: string;
  page?: number;
}

const FILTER_KEYS = ["status", "speaker", "series", "tier", "q"] as const;

/**
 * Apply a patch to the current query string and return the next one (no `?`).
 * Any change to a *filter* (status / speaker / series / tier / q) resets
 * `page` — a page-3 view of one filter is meaningless under another. A patch
 * that only sets `page` keeps every filter. Empty / default values are dropped
 * so the URL stays clean (`status=all`, `page=1` never appear). Pure;
 * unit-tested.
 */
export function buildSermonsSearch(
  current: ParamSource & { toString(): string },
  patch: SermonsFilterPatch,
): string {
  const next = new URLSearchParams(current.toString());

  const touchesFilter = FILTER_KEYS.some((key) => key in patch);

  const setOrDelete = (key: string, value: string | undefined) => {
    if (value == null || value === "") next.delete(key);
    else next.set(key, value);
  };

  if ("status" in patch) {
    setOrDelete("status", patch.status === "all" ? undefined : patch.status);
  }
  if ("speaker" in patch) setOrDelete("speaker", patch.speaker);
  if ("series" in patch) setOrDelete("series", patch.series);
  if ("tier" in patch) setOrDelete("tier", patch.tier);
  if ("q" in patch) setOrDelete("q", patch.q?.trim());

  if (touchesFilter && !("page" in patch)) {
    next.delete("page");
  } else if ("page" in patch) {
    setOrDelete(
      "page",
      patch.page != null && patch.page > 1 ? String(patch.page) : undefined,
    );
  }

  // Stable key order for predictable URLs / test assertions.
  next.sort();
  return next.toString();
}

/** Backend list order: updated_at desc (nulls last), then created_at desc.
    Compares parsed epoch millis, not raw strings, so it does not depend on the
    backend emitting fixed-precision ISO-8601 UTC. A missing/unparseable
    `updated_at` sorts last within its `updated_at` group. */
function ts(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function byRecency(a: SermonListItem, b: SermonListItem): number {
  const au = ts(a.updated_at);
  const bu = ts(b.updated_at);
  if (au !== bu) return bu - au;
  return ts(b.created_at) - ts(a.created_at);
}

export interface SermonsQueryResult {
  state: SermonsUrlState;
  rows: SermonListItem[];
  total: number;
  /** 1-based, clamped to `[1, pageCount]`. If the URL asked for a higher page
      (its rows were deleted) this is already the real last page and the hook
      has queued a `router.replace` to bring the URL in line. */
  page: number;
  pageCount: number;
  pageSize: number;
  /** "1–25 of 128", or "0 of 0". */
  rangeLabel: string;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  /** "In review" union hit `MERGE_CAP` — the page may be incomplete. */
  mergeCapExceeded: boolean;
}

function rangeLabel(offset: number, shown: number, total: number): string {
  if (total === 0) return "0 of 0";
  return `${offset + 1}–${offset + shown} of ${total}`;
}

/**
 * Read the URL, run the query (or the two-call union for "In review"), and
 * return a normalised page of rows plus pagination facts.
 */
export function useSermonsQuery(): SermonsQueryResult {
  const searchParams = useSearchParams();
  const state = useMemo(
    () => parseSermonsParams(searchParams),
    [searchParams],
  );

  const apiStatuses = apiStatusesFor(state.status);
  const isUnion = apiStatuses.length > 1;
  const offset = (state.page - 1) * PAGE_SIZE;
  const base = nonStatusParams(state);

  // Single-request path: "all" / "drafts" / "published".
  const single = useSermons(
    {
      ...base,
      ...(apiStatuses.length === 1 ? { status: apiStatuses[0] } : {}),
      limit: PAGE_SIZE,
      offset,
    },
    { enabled: !isUnion },
  );

  // Union path: "In review" = pending_review ∪ under_review. Both hooks are
  // always mounted (hooks can't be conditional) but only run for that tab.
  const pending = useSermons(
    { ...base, status: "pending_review", limit: MERGE_CAP, offset: 0 },
    { enabled: isUnion },
  );
  const under = useSermons(
    { ...base, status: "under_review", limit: MERGE_CAP, offset: 0 },
    { enabled: isUnion },
  );

  const result = useMemo<SermonsQueryResult>(() => {
    if (isUnion) {
      const merged = [
        ...(pending.data?.items ?? []),
        ...(under.data?.items ?? []),
      ].sort(byRecency);
      const total =
        (pending.data?.total ?? 0) + (under.data?.total ?? 0);
      const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
      // Clamp a stale/too-high page (e.g. the last page was just deleted) so
      // the table never renders an empty page or a "101–100 of 50" range. The
      // effect below `router.replace`s the URL down to match.
      const clampedPage = Math.min(state.page, pageCount);
      const clampedOffset = (clampedPage - 1) * PAGE_SIZE;
      const rows = merged.slice(clampedOffset, clampedOffset + PAGE_SIZE);
      return {
        state,
        rows,
        total,
        page: clampedPage,
        pageCount,
        pageSize: PAGE_SIZE,
        rangeLabel: rangeLabel(clampedOffset, rows.length, total),
        isPending: pending.isPending || under.isPending,
        isFetching: pending.isFetching || under.isFetching,
        isError: pending.isError || under.isError,
        error: pending.error ?? under.error,
        mergeCapExceeded:
          (pending.data?.total ?? 0) > MERGE_CAP ||
          (under.data?.total ?? 0) > MERGE_CAP,
      };
    }

    const page: SermonListPage | undefined = single.data;
    const rows = page?.items ?? [];
    const total = page?.total ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const clampedPage = Math.min(state.page, pageCount);
    const displayOffset = (clampedPage - 1) * PAGE_SIZE;
    return {
      state,
      rows,
      total,
      page: clampedPage,
      pageCount,
      pageSize: PAGE_SIZE,
      rangeLabel: rangeLabel(displayOffset, rows.length, total),
      isPending: single.isPending,
      isFetching: single.isFetching,
      isError: single.isError,
      error: single.error,
      mergeCapExceeded: false,
    };
  }, [
    isUnion,
    state,
    single.data,
    single.isPending,
    single.isFetching,
    single.isError,
    single.error,
    pending.data,
    pending.isPending,
    pending.isFetching,
    pending.isError,
    pending.error,
    under.data,
    under.isPending,
    under.isFetching,
    under.isError,
    under.error,
  ]);

  // Once data has resolved, if the URL still points past the last page (the
  // rows on it were just deleted), replace `page` down to the real last page —
  // once, never in a loop (the replace updates `searchParams`, which re-parses
  // `state.page` inside the bound and stops this firing again).
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (result.isPending || result.isFetching) return;
    if (state.page <= result.pageCount) return;
    const search = buildSermonsSearch(searchParams, { page: result.pageCount });
    router.replace(search ? `${pathname}?${search}` : pathname, {
      scroll: false,
    });
  }, [
    result.isPending,
    result.isFetching,
    result.pageCount,
    state.page,
    searchParams,
    router,
    pathname,
  ]);

  return result;
}
