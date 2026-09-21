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
import {
  pickPlaybackVariant,
  useSermonStream,
} from "@/lib/query/hooks/use-sermon-stream";

/* =============================================================================
   SubmissionCard — one Review queue card (design Screen 5, plan W10).

   White, radius 16, padding 20. A 180px 16:9 striped thumb (duration chip
   bottom-right) beside a gap-9 stack: title (Newsreader 22) + status badge ·
   a 13.5px ink-muted meta line · a 14/1.55 description capped at 62ch · a mono
   provenance line · the action row.

   The title links to `/sermons/{id}` (the staff detail/editor route); the
   action buttons sit beside it, not inside the link, so they never navigate.

   "Start review" (on a `pending_review` card only) claims the sermon for review
   (`onStartReview` → `POST …/{id}/start-review`): the card stays in the queue
   but flips to `under_review` with `review_claimed_by(_id)` set.

   "Watch"/"Listen" opens a media player for the sermon (`onPlay` → a
   <video>/<audio> dialog fed by `GET /sermons/{id}/stream`). It is disabled
   when the sermon has no processed renditions yet. `ReviewQueueItem` carries
   no media-type hint, so once `renditions_ready > 0` this card fetches the
   stream metadata proactively (not lazily on click) to learn `variant.type`
   and label the button "Listen" for audio-only media, "Watch" otherwise
   (also the default while that fetch is still in flight). The dialog re-uses
   the same query key, so it opens against warm cache and just revalidates
   the (short-lived) signed URL in the background.

   Claim state (Batch 6 #9). `mine` / `claimedElsewhere` / `claimLocked` are
   derived by the screen from `review_claimed_by_id` vs the session id:
     - `mine` — slate "Under review · you", no "Start review", no "Take over
       review". Approve (both "Approve & publish" and "Approve only") / reject /
       watch enabled.
     - `claimedElsewhere` (a manager) → `claimLocked` is set: "Under review ·
       <name>", the approve/reject actions are DISABLED with a "take over to act"
       tooltip, and "Take over review" (`onTakeOver` → `POST …/{id}/take-over-review`)
       is offered. Watch stays enabled.
     - `claimedElsewhere` (an admin) → NOT locked (admins bypass): the "<name>"
       label shows but the actions stay enabled; "Take over review" is still
       offered (optional for an admin).
   The `disabled` on a claim-locked action is UX only — a hint, not a gate. The
   backend re-checks the claim on every transition and answers 403
   (`review_claimed_by_another`) if it doesn't hold, so a stale/racing client
   can't approve past another reviewer's claim.

   Approved (Batch 6 #12). An `approved` sermon stays in the queue until it is
   published. Its card shows "Publish" (`onPublish` → `POST …/{id}/publish`,
   never claim-gated) + "Reject" (round 2 — `onStartReject`, same inline
   `mode === "rejecting"` flow as every other status; POSTs `/reject` on an
   `approved` sermon, available to any manager, no claim/self-author gate on
   the backend for this status) + "Watch" — no approve/start-review/take-over.
   Publishing OR rejecting removes it from the queue.

   Self-author lock (review-queue authorship). Segregation of duties: a
   manager may not review their own sermon (`content_service.transition`'s
   `_SELF_AUTHOR_REVIEW_BLOCKED_ACTIONS` — `start_review`/`approve`/`reject`,
   admin bypasses). `selfAuthorLocked` (screen-derived: `item.created_by ===
   session.id && !isAdmin`) disables "Start review" / "Approve & publish" /
   "Approve only" / "Reject with note" with the same tooltip mechanism as
   `claimLocked`, string identical to the backend's 403
   ("You submitted this sermon — another manager needs to review it") so the
   UI and the API agree. Carve-out: the `approved` card's "Reject" is NOT
   gated by this — self-correcting an already-approved sermon isn't the
   conflict of interest `approve` guards against (mirrors the backend, which
   only exempts `reject` from `approved`). A self-authored `under_review` card
   is also, in practice, always `claimedElsewhere` (the creator can never hold
   the claim — `take_over_review` blocks them too), so both locks can apply at
   once; the self-author reason takes the tooltip since it's the one that
   holds regardless of who has the claim.

   The reject flow is inline: "Reject with note" flips `mode` to `rejecting`,
   revealing the labelled textarea plus [Send rejection] (rose fill + border +
   text) and [Cancel] — no "Approve & publish" in this branch, since rejecting
   and approving are mutually exclusive intents. "Send rejection" is disabled
   until the note is non-empty. Cancel returns to `idle`. The screen owns
   `note`/`mode` and keeps them on a failed send, so a rollback re-shows the
   textarea with the note.

   Request failures render as an `<Alert>` at the top of THIS card, never a
   toast (design "Errors").
   ========================================================================== */

export interface SubmissionCardProps {
  item: ReviewQueueItem;
  /** `under_review` and claimed by the signed-in reviewer (id match). */
  mine: boolean;
  /** `under_review` and claimed by someone else — their display name, or null
      if the name didn't resolve. */
  claimedByOther: string | null;
  /** `under_review` and the claim is held by another user (id resolved, not
      me) — regardless of role or whether their name resolved. Drives the
      "Take over review" affordance. */
  claimedElsewhere: boolean;
  /** `claimedElsewhere` AND the signed-in user is not an admin: the approve /
      reject actions are disabled until the reviewer takes the claim over. */
  claimLocked: boolean;
  /** This sermon's `created_by` is the signed-in user, who is not an admin:
      start-review / approve / reject (except from `approved`) are disabled —
      segregation of duties, mirrors the backend's 403. */
  selfAuthorLocked: boolean;
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
  /** Claim this sermon for review (`POST …/{id}/start-review`). Only wired on a
      `pending_review` card. */
  onStartReview: () => void;
  /** Reassign the in-progress review to me (`POST …/{id}/take-over-review`).
      Only wired on an `under_review` card claimed by someone else. */
  onTakeOver: () => void;
  /** Open the media player for this sermon. */
  onPlay: () => void;
  onApproveOnly: () => void;
  onApproveAndPublish: () => void;
  /** Publish an already-`approved` sermon (`POST …/{id}/publish`). Only wired on
      an `approved` card. */
  onPublish: () => void;
  onSendRejection: () => void;
  /** Injectable clock for the provenance line (tests). */
  now?: number;
}

/* speaker · series/standalone · category — the tier is a chip, appended
   separately. `ReviewQueueItem` carries no `episode_number`, so a series shows
   its title only (no "· ep N"). */
// Verbatim match for `content_service.transition`'s self-author 403 (also
// `take_over_review`'s) — see the file-header comment.
const SELF_AUTHOR_LOCK_TITLE =
  "You submitted this sermon — another manager needs to review it";

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
  claimedElsewhere,
  claimLocked,
  selfAuthorLocked,
  busy,
  error,
  onDismissError,
  mode,
  note,
  onNoteChange,
  onStartReject,
  onCancelReject,
  onStartReview,
  onTakeOver,
  onPlay,
  onApproveOnly,
  onApproveAndPublish,
  onPublish,
  onSendRejection,
  now,
}: SubmissionCardProps) {
  const noteId = useId();
  const underReview = item.status === "under_review";
  const pendingReview = item.status === "pending_review";
  const approved = item.status === "approved";
  // "Watch"/"Listen" plays the processed media; nothing to play until a
  // rendition exists.
  const hasMedia = item.renditions_ready > 0;
  // Proactively (not lazily on click) learn the media type so the button can
  // read "Listen" for audio — `ReviewQueueItem` carries no such hint.
  const stream = useSermonStream(item.id, hasMedia);
  const playVariant = stream.data
    ? pickPlaybackVariant(stream.data.variants)
    : null;
  const playLabel = playVariant?.type === "audio" ? "Listen" : "Watch";
  // The other reviewer's name for the claim-lock tooltip — falls back to a
  // generic phrasing when the name didn't resolve but the id did.
  const lockTitle = claimLocked
    ? claimedByOther
      ? `${claimedByOther} is reviewing this — take over to act`
      : "Another reviewer holds this — take over to act"
    : undefined;
  // The review-entry actions (approve/reject/start-review) are locked by
  // EITHER reason; when both apply (see file header — a self-authored
  // `under_review` card is always claimed by someone else too) the
  // self-author reason wins the tooltip, since it holds regardless of who
  // has the claim.
  const actionsLocked = claimLocked || selfAuthorLocked;
  const actionLockTitle = selfAuthorLocked ? SELF_AUTHOR_LOCK_TITLE : lockTitle;
  // The manager who most recently claimed it (not necessarily the approver);
  // shown next to the "Approved" badge as informational context.
  const approvedClaimant = item.review_claimed_by?.trim() || null;
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
                  variant="destructive"
                  className="bg-rose-bg"
                  disabled={busy || claimLocked || note.trim() === ""}
                  title={lockTitle}
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
              {approved ? (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={onPublish}
                  >
                    Publish
                  </Button>
                  {/* Any manager may reject an already-approved sermon — the
                      backend doesn't claim- or self-author-gate this action
                      (round 2: reject-from-approved). Reuses the same
                      `mode === "rejecting"` textarea as every other status. */}
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={onStartReject}
                  >
                    Reject
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy || actionsLocked}
                    title={actionLockTitle}
                    onClick={onApproveAndPublish}
                  >
                    Approve &amp; publish
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || actionsLocked}
                    title={actionLockTitle}
                    onClick={onApproveOnly}
                  >
                    Approve only
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy || actionsLocked}
                    title={actionLockTitle}
                    onClick={onStartReject}
                  >
                    Reject with note
                  </Button>
                  {pendingReview ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || selfAuthorLocked}
                      title={selfAuthorLocked ? SELF_AUTHOR_LOCK_TITLE : undefined}
                      onClick={onStartReview}
                    >
                      Start review
                    </Button>
                  ) : null}
                  {claimedElsewhere ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={onTakeOver}
                    >
                      Take over review
                    </Button>
                  ) : null}
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !hasMedia}
                onClick={onPlay}
                title={hasMedia ? undefined : "No media uploaded yet"}
              >
                {playLabel}
              </Button>
              {underReview ? (
                <span className="text-[13px] font-medium text-slate">
                  {mine
                    ? "Under review · you"
                    : claimedByOther
                      ? `Under review · ${claimedByOther}`
                      : "Under review"}
                </span>
              ) : approved && approvedClaimant ? (
                <span className="text-[13px] font-medium text-slate">
                  {`Approved · ${approvedClaimant}`}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
