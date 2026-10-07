"use client";

import Link from "next/link";

import { CommentStateChip } from "@/components/comments/comment-state-chip";
import {
  ACTION_LABEL,
  availableActions,
  commentStateOf,
  formatAbsolute,
  type CommentAction,
} from "@/components/comments/comment-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  authorEmailOf,
  type AdminCommentRow,
} from "@/lib/query/hooks/use-admin-comments";

/* =============================================================================
   CommentDetailDialog — the full comment, its meta and the role-gated actions
   (S2 §3.5). Plain text only: the body is a text node in a `pre-wrap` box.
   An EDITOR gets no action footer. Role gating is cosmetic; the server decides.
   ========================================================================== */

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </dt>
      <dd className="text-[13px] text-ink">{children}</dd>
    </div>
  );
}

export interface CommentDetailDialogProps {
  comment: AdminCommentRow | null;
  role: string;
  /** A moderation mutation is in flight — disables the action buttons so a
   *  double click can't fire two writes (S15b, named for Restore). */
  busy: boolean;
  onAction: (action: CommentAction, comment: AdminCommentRow) => void;
  onClose: () => void;
}

export function CommentDetailDialog({
  comment,
  role,
  busy,
  onAction,
  onClose,
}: CommentDetailDialogProps) {
  return (
    <Dialog open={comment !== null} onOpenChange={(o) => !o && onClose()}>
      {comment ? (
        <DetailBody comment={comment} role={role} busy={busy} onAction={onAction} />
      ) : null}
    </Dialog>
  );
}

function DetailBody({
  comment,
  role,
  busy,
  onAction,
}: {
  comment: AdminCommentRow;
  role: string;
  busy: boolean;
  onAction: CommentDetailDialogProps["onAction"];
}) {
  const state = commentStateOf(comment);
  const email = authorEmailOf(comment);
  const actions = availableActions(comment, role);
  const hidden = comment.status === "HIDDEN";

  return (
    <DialogContent className="w-[min(520px,calc(100vw-32px))]">
      <div className="flex flex-wrap items-center gap-10 pr-32">
        <CommentStateChip state={state} />
        <DialogTitle className="text-[15px]">
          {`Posted ${formatAbsolute(comment.created_at)}`}
        </DialogTitle>
      </div>
      <DialogDescription className="sr-only">
        Comment by {comment.author_display_name} on {comment.sermon_title}
      </DialogDescription>

      <div
        data-testid="comment-full-body"
        tabIndex={0}
        className="max-h-[240px] overflow-y-auto whitespace-pre-wrap break-words rounded-11 bg-surface-sunken p-14 text-[14px] text-ink focus-visible:focus-ring-button"
      >
        {comment.body}
      </div>

      <dl className="grid grid-cols-2 gap-x-16 gap-y-12">
        <Meta label="Author">
          <span>{comment.author_display_name}</span>
          {email ? (
            <span className="block break-all font-mono text-[12px] text-ink-muted">
              {email}
            </span>
          ) : null}
        </Meta>
        <Meta label="Sermon">
          <Link
            href={`/sermons/${comment.sermon_id}`}
            className="font-semibold text-clay-600 underline underline-offset-2 hover:text-clay-700"
          >
            {comment.sermon_title}
          </Link>
        </Meta>
        <Meta label="Reports">{`${comment.report_count} ${
          comment.report_count === 1 ? "report" : "reports"
        }`}</Meta>
        {hidden ? (
          <Meta label="Hidden">
            {comment.hidden_at ? formatAbsolute(comment.hidden_at) : "—"}
            {comment.hidden_auto ? (
              <span className="block text-ink-muted">
                Auto-hidden at threshold
              </span>
            ) : null}
          </Meta>
        ) : null}
        {hidden && comment.hidden_reason ? (
          <Meta label="Reason">{comment.hidden_reason}</Meta>
        ) : null}
      </dl>

      {actions.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-8">
          {actions.map((action) => (
            <Button
              key={action}
              type="button"
              variant={
                action === "delete"
                  ? "destructive"
                  : action === "hide" || action === "restore"
                    ? "primary"
                    : "secondary"
              }
              disabled={busy}
              onClick={() => onAction(action, comment)}
            >
              {ACTION_LABEL[action]}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-[12.5px] text-ink-muted">
          Moderators handle hide and restore.
        </p>
      )}
    </DialogContent>
  );
}
