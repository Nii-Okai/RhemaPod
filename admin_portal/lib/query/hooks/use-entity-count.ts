/**
 * `useEntityCount` — the mono "N sermons" figure on a speaker row and a category
 * pill (W12, design Screen 7).
 *
 * Neither `SpeakerPublic` nor `CategoryPublic` carries a sermon count
 * (→ [GATE 3 Batch 5]: add `sermon_count` to both DTOs to kill this N+1). Until
 * then the count is a `limit=1` `total` probe against the admin sermon list —
 * the same pattern the W11 series grid uses (`useSeriesEpisodeCount`), and cheap
 * at a church's scale (~15 speakers, ~4 categories).
 *
 * Keyed under the **sermons** domain — `sermons.list({ speaker_id | category_id,
 * limit: 1 })` — not `speakers.*` / `categories.*`. The count is a sermons-domain
 * fact (how many sermons carry this ref), so a detach that fires
 * `sermons.lists()` invalidation (see `useDeleteSpeaker` / `useDeleteCategory`)
 * must reach it or the figure goes stale.
 *
 * Both `speaker_id` and `category_id` are real all-status filters on
 * `GET /api/v1/sermons` (the latter added at GATE 3 Batch 5 to unblock this),
 * so the two `kind`s count the same way — every status, not published-only.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import { queryKeys, type SermonListParams } from "@/lib/query/keys";
import type { SermonListPage } from "@/lib/query/hooks/use-sermons";
import { OPTIMISTIC_ID_PREFIX } from "@/lib/query/hooks/use-speakers";

export type EntityCountKind = "speaker" | "category";

/**
 * True when `id` is a real, persisted entity id worth probing for — i.e. not
 * the create-mode `""` (a category being drafted) and not an optimistic-create
 * sentinel (`optimistic:<uuid>`, minted by `useCreateSpeaker`). The backend
 * 422s a malformed `speaker_id` / `category_id`, and that 422 would then be
 * retried per the query-retry count, so the probe must not run for either.
 */
export function isPersistedId(id: string): boolean {
  return id !== "" && !id.startsWith(OPTIMISTIC_ID_PREFIX);
}

/** The list params (and therefore the query key) for one entity's count probe. */
export function entityCountParams(
  kind: EntityCountKind,
  id: string,
): SermonListParams {
  return kind === "speaker"
    ? { speaker_id: id, limit: 1 }
    : { category_id: id, limit: 1 };
}

export function useEntityCount(kind: EntityCountKind, id: string) {
  const params = entityCountParams(kind, id);
  return useQuery({
    queryKey: queryKeys.sermons.list(params),
    // Only probe for a persisted id — never the create-mode `""` nor an
    // optimistic-create sentinel; the backend 422s both (see `isPersistedId`).
    enabled: isPersistedId(id),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/sermons", { params: { query: params }, signal }),
      ),
    select: (page: SermonListPage) => page.total,
    staleTime: 60_000,
  });
}

/** `count.data` → what the cell renders: the number once resolved, an em dash
    while loading or on failure (a stale count must never read as `0`). */
export function entityCountLabel(count: number | undefined): string {
  return typeof count === "number" ? String(count) : "—";
}
