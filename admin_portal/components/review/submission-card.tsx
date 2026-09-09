"use client";

import { useId } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MediaPlaceholder } from "@/components/portal/media-placeholder";
import { StatusBadge } from "@/components/portal/status-badge";
import { TierChip } from "@/components/portal/chips";
import { toBadgeStatus } from "@/components/sermons/sermon-status";
import { formatDuration } from "@/lib/format";
import { provenanceLine } from "@/lib/review/summary";
import type { ReviewQueueItem } from "@/lib/query/hooks/use-review-queue";

/* =============================================================================
   SubmissionCard — one Review queue card (design Screen 5, plan W10).

   White, radius 16, padding 20. A 180px 16:9 striped thumb (duration chip
   bottom-right) beside a gap-9 stack: title (Newsreader 22) + status badge ·
   a 13.5px ink-muted meta line · a 14/1.55 description capped at 62ch · a mono
   provenance line · the action row.

   The title links to `/sermons/{id}` (the staff detail/editor route); the
   action buttons sit beside it, not inside the link, so they never navigate.

   "Watch" opens a media player for the sermon (`onPlay` → a <video>/<audio>
   dialog fed by `GET /sermons/{id}/stream`). It is disabled when the sermon
   has no processed renditions yet. (The review take-over / claim action is a
   separate, later concern — `review_claimed_by` still drives the read-only
   "Under review · <name>" label below.)

   Claim state. Structural decisions key off `item.status` directly (interim —
   TODO(batch): compare `review_claimed_by_id` once the backend returns it):
     - status `under_review`   → treated as claimed regardless of whether the
                                 claimer's name resolved. `mine` (name match,
                                 best effort) → slate "Under review · you" and
                                 NO "Approve only"; otherwise "Under review ·
                                 <name>" if a name exists, else just "Under
                                 review". Actions stay (a manager can override).

   The reject flow is inline: "Reject with note" flips `mode` to `rejecting`,
   revealing the labelled textarea plus [Approve & publish] and [Send rejection]
   (rose fill + border + text). "Send rejection" is disabled until the note is
   non-empty. Cancel returns to `idle`. The screen owns `note`/`mode` and keeps
   them on a failed send, so a rollback re-shows the textarea with the note.

   Request failures render as an `<Alert>` at the top of THIS card, never a
   toast (design "Errors").
   ========================================================================== */

export interface SubmissionCardProps {
  item: ReviewQueueItem;
  /** `under_review` and claimed by the signed-in reviewer. */
  mine: boolean;
  /** `under_review` and claimed by someone else — their display name, else null. */
  claimedByOther: string | null;
  /** A mutation for this card is in flight. */
  busy: boolean;
  /** Card-top error from a failed/rolled-back action. */
  error: string | null;
  onDismissError: () => void;
  mode: "idle" | "rejecting";
  note: string;
  onNoteChange: (value: string) => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  /** Open the media player for this sermon. */
  onPlay: () => void;
  onApproveOnly: () => void;
  onApproveAndPublish: () => void;
  onSendRejection: () => void;
  /** Injectable clock for the provenance line (tests). */
  now?: number;
}

/* speaker · series/standalone · category — the tier is a chip, appended
   separately. `ReviewQueueItem` carries no `episode_number`, so a series shows
   its title only (no "· ep N"). */
function metaText(item: ReviewQueueItem): string {
  return [
    item.speaker_name ?? "Speaker not set",
    item.series_title ?? "Standalone",
    item.category_name ?? "Uncategorised",
  ].join(" · ");
}

export function SubmissionCard({
  item,
  mine,
  claimedByOther,
  busy,
  error,
  onDismissError,
  mode,
  note,
  onNoteChange,
  onStartReject,
  onCancelReject,
  onPlay,
  onApproveOnly,
  onApproveAndPublish,
  onSendRejection,
  now,
}: SubmissionCardProps) {
  const noteId = useId();
  const underReview = item.status === "under_review";
  // "Watch" plays the processed media; nothing to play until a rendition exists.
  const hasMedia = item.renditions_ready > 0;
  const duration =
    item.duration_seconds != null
      ? formatDuration(item.duration_seconds)
      : undefined;

  return (
    <article className="flex flex-col gap-14 rounded-16 border border-border bg-surface p-20">
      {error ? (
        <Alert variant="error" title="That action didn’t go through">
          <span className="flex flex-wrap items-center gap-10">
            <span>{error}</span>
            <button
              type="button"
              onClick={onDismissError}
              className="shrink-0 font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
            >
              Dismiss
            </button>
          </span>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-18">
        <MediaPlaceholder
          scale="card"
          duration={duration}
          label={`Thumbnail for ${item.title}`}
          className="aspect-video w-[180px] shrink-0 rounded-5"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-9">
          <div className="flex flex-wrap items-center gap-10">
            <h3 className="font-serif text-[22px] leading-[1.2] tracking-[-0.01em]">
              <Link
                href={`/sermons/${item.id}`}
                className="text-ink outline-none hover:text-clay-700 hover:underline focus-visible:focus-ring-button"
              >
                {item.title}
              </Link>
            </h3>
            <StatusBadge
              status={toBadgeStatus(item.status)}
              className="whitespace-nowrap"
            />
          </div>

          <p className="flex flex-wrap items-center gap-x-6 gap-y-4 text-[13.5px] text-ink-muted">
            <span>{metaText(item)}</span>
            <span aria-hidden>·</span>
            <TierChip tier={item.tier === "paid" ? "paid" : "free"} />
          </p>

          {item.description ? (
            <p className="max-w-[62ch] text-pretty text-[14px] leading-[1.55] text-ink-soft">
              {item.description}
            </p>
          ) : null}

          <p className="text-mono-meta text-ink-faint">
            {provenanceLine(item.submitted_at, item.renditions_ready, now)}
          </p>

          {mode === "rejecting" ? (
            <div className="mt-2 flex flex-col gap-8">
              <label
                htmlFor={noteId}
                className="text-[13px] font-medium text-ink-muted"
              >
                Rejection note (sent to the editor and kept in the log)
              </label>
              <Textarea
                id={noteId}
                rows={3}
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="Be specific — the editor reads this after the fact."
              />
              <div className="flex flex-wrap gap-8">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={onApproveAndPublish}
                >
                  Approve &amp; publish
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="bg-rose-bg"
                  disabled={busy || note.trim() === ""}
                  onClick={onSendRejection}
                >
                  Send rejection
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={onCancelReject}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-8">
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={onApproveAndPublish}
              >
                Approve &amp; publish
              </Button>
              {!mine ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={onApproveOnly}
                >
                  Approve only
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={onStartReject}
              >
                Reject with note
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !hasMedia}
                onClick={onPlay}
                title={hasMedia ? undefined : "No media uploaded yet"}
              >
                Watch
              </Button>
              {underReview ? (
                <span className="text-[13px] font-medium text-slate">
                  {mine
                    ? "Under review · you"
                    : claimedByOther
                      ? `Under review · ${claimedByOther}`
                      : "Under review"}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
