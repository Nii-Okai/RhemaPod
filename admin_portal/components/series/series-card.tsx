"use client";

import Link from "next/link";

import { MediaPlaceholder } from "@/components/portal/media-placeholder";
import { StatusBadge } from "@/components/portal/status-badge";
import { TierChip } from "@/components/portal/chips";
import { toBadgeStatus } from "@/components/sermons/sermon-status";
import { useSeriesEpisodeCount } from "@/lib/query/hooks/use-series-episodes";
import type { Series } from "@/lib/query/hooks/use-series-manager";
import { seriesFooterLine } from "@/lib/series/episodes";

/* =============================================================================
   SeriesCard — one tile in the Series manager grid (design Screen 6).

   16:9 striped art with a status badge top-left and a tier chip top-right;
   body (padding 16, gap 7) with a Newsreader 20 title, a 13px description, a
   `border-subtle` top rule, then a footer row of mono "N episodes · <category>"
   and a clay "Manage" link.

   `SeriesPublic` carries neither an episode count nor a category name
   (→ [GATE 3 Batch 5]), so both are resolved here: the count from a `limit=1`
   `total` probe, the name from the category map the grid passes down.
   ========================================================================== */

export interface SeriesCardProps {
  series: Series;
  /** category_id → display name, from `useCategories()` in the grid. */
  categoryName: string | null;
}

export function SeriesCard({ series, categoryName }: SeriesCardProps) {
  const count = useSeriesEpisodeCount(series.id);
  const footer = seriesFooterLine(count.data ?? 0, categoryName);

  return (
    <div className="flex flex-col overflow-hidden rounded-14 border border-border bg-surface">
      <div className="relative aspect-video">
        {series.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={series.thumbnail_url}
            alt={`Art for ${series.title}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <MediaPlaceholder
            scale="card"
            className="h-full w-full"
            label={`${series.title} — no art yet`}
          />
        )}
        <StatusBadge
          status={toBadgeStatus(series.status)}
          className="absolute left-10 top-10"
        />
        <TierChip
          tier={series.tier === "paid" ? "paid" : "free"}
          className="absolute right-10 top-10"
        />
      </div>

      <div className="flex flex-col gap-7 p-16">
        <h3 className="font-serif text-[20px] leading-[1.2] tracking-[-0.01em] text-ink">
          {series.title}
        </h3>
        <p className="line-clamp-2 min-h-[18px] text-[13px] text-ink-muted">
          {series.description ?? "No description yet."}
        </p>
        <div className="mt-2 flex items-center justify-between border-t border-border-subtle pt-10">
          <span className="text-mono-meta text-ink-faint">{footer}</span>
          <Link
            href={`/series/${series.id}`}
            className="text-[13px] font-semibold text-clay-600 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
          >
            Manage
          </Link>
        </div>
      </div>
    </div>
  );
}
