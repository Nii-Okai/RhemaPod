"use client";

import Link from "next/link";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { useCommentCounts } from "@/lib/query/hooks/use-admin-comments";

/* =============================================================================
   Comments card (design comments-queue.md §4; editor right column, under the
   approval log). Three counts, no comment text, and a deep link to the queue
   filtered by this sermon.

   The counts are the `total` of three `limit=1` list probes (no count endpoint,
   no new BFF route). Loading shows skeleton numerals; an error is a quiet
   inline line, matching the approval-log card. Not rendered for an unsaved
   sermon (the caller passes `sermonId` only once it exists).
   ========================================================================== */

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone?: "alert";
}) {
  return (
    <div className="flex flex-col gap-2">
      {value === null ? (
        <span aria-hidden className="h-[24px] w-[28px] rounded-4 bg-border-subtle" />
      ) : (
        <span
          className={
            tone === "alert"
              ? "font-mono text-[20px] text-wheat-text"
              : "font-mono text-[20px] text-ink"
          }
        >
          {value}
        </span>
      )}
      <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </span>
    </div>
  );
}

export function CommentsCard({ sermonId }: { sermonId: string }) {
  const { data, isPending, isError } = useCommentCounts(sermonId);
  const hasReported = (data?.reported ?? 0) > 0;

  return (
    <Card className="flex flex-col gap-14 p-20">
      <CardHeader>
        <CardTitle>Comments</CardTitle>
        <Link
          href={`/comments?sermon_id=${encodeURIComponent(sermonId)}`}
          className="text-[13px] font-semibold text-clay-600 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
        >
          {hasReported ? "Review reported" : "View all"}
        </Link>
      </CardHeader>

      {isError ? (
        <p className="text-[13px] text-ink-muted">Couldn’t load comments.</p>
      ) : !isPending && data?.total === 0 ? (
        <p className="text-[13px] text-ink-muted">No comments yet.</p>
      ) : (
        <div className="flex gap-24" aria-busy={isPending}>
          <Count label="Total" value={isPending ? null : (data?.total ?? 0)} />
          <Count
            label="Reported"
            value={isPending ? null : (data?.reported ?? 0)}
            tone={hasReported ? "alert" : undefined}
          />
          <Count label="Hidden" value={isPending ? null : (data?.hidden ?? 0)} />
        </div>
      )}
    </Card>
  );
}
