"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  moderationErrorMessage,
  REASON_MAX,
  type AdminCommentRow,
} from "@/lib/query/hooks/use-admin-comments";

/* =============================================================================
   CommentReasonDialog — hide / dismiss reports / hard delete (S2 §3.7).

   All three need a REQUIRED reason (trimmed, 1-300 chars; the server enforces
   the same and writes it to the moderation log). Delete adds a warning and an
   "I understand this is permanent" checkbox. The comment preview is plain text
   in a text node — never HTML, never linkified.

   Validation runs on submit so the error is announced and the field focused;
   the buttons are not pre-disabled. A failed call (403 stale role gate, 404
   gone, 409 wrong state) renders inside the dialog, which stays open with the
   input kept.
   ========================================================================== */

export type ReasonMode = "hide" | "dismiss" | "delete";

const COPY: Record<
  ReasonMode,
  { title: string; body: string; submit: string }
> = {
  hide: {
    title: "Hide this comment?",
    body: "It is removed from every viewer’s list. The author sees “Removed by a moderator”. You can restore it any time.",
    submit: "Hide comment",
  },
  dismiss: {
    title: "Dismiss the reports on this comment?",
    body: "The comment stays visible and its reports are cleared. If it is reported again it returns to the queue.",
    submit: "Dismiss reports",
  },
  delete: {
    title: "Delete this comment permanently?",
    body: "",
    submit: "Delete permanently",
  },
};

/** Pure validation, exported for unit tests. */
export function validateReason(raw: string): string | null {
  const reason = raw.trim();
  if (reason.length === 0) return "Add a reason to continue.";
  if (reason.length > REASON_MAX)
    return `Keep the reason to ${REASON_MAX} characters or fewer.`;
  return null;
}

export interface CommentReasonDialogProps {
  mode: ReasonMode;
  /** The comment being acted on; the dialog is closed when `null`. */
  comment: AdminCommentRow | null;
  /** Resolves on success; rejects with the `ApiError` on failure. */
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}

export function CommentReasonDialog({
  mode,
  comment,
  onConfirm,
  onClose,
}: CommentReasonDialogProps) {
  return (
    <Dialog open={comment !== null} onOpenChange={(o) => !o && onClose()}>
      {comment ? (
        <ReasonForm
          // Fresh state per comment/mode.
          key={`${mode}:${comment.id}`}
          mode={mode}
          comment={comment}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function ReasonForm({
  mode,
  comment,
  onConfirm,
  onClose,
}: CommentReasonDialogProps & { comment: AdminCommentRow }) {
  const copy = COPY[mode];
  const [reason, setReason] = React.useState("");
  const [understood, setUnderstood] = React.useState(false);
  const [reasonError, setReasonError] = React.useState<string | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const reasonRef = React.useRef<HTMLTextAreaElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  const reasonErrId = React.useId();
  const confirmErrId = React.useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const problem = validateReason(reason);
    const needsConfirm = mode === "delete" && !understood;
    setReasonError(problem);
    setConfirmError(needsConfirm ? "Tick the box to confirm." : null);
    if (problem) {
      reasonRef.current?.focus();
      return;
    }
    if (needsConfirm) return;

    setPending(true);
    setFailure(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setFailure(moderationErrorMessage(err, mode));
      setPending(false);
    }
  }

  return (
    <DialogContent
      className="w-[min(520px,calc(100vw-32px))]"
      onOpenAutoFocus={(event) => {
        // Spec: Hide/Dismiss focus the reason field. Delete explicitly
        // focuses Cancel instead — Radix's un-steered default is the first
        // tabbable node in DOM order, which here is the reason textarea (or
        // the Close "x"), not Cancel, so a destructive dialog must not rely
        // on that default; it has to say so.
        event.preventDefault();
        if (mode === "delete") {
          cancelRef.current?.focus();
        } else {
          reasonRef.current?.focus();
        }
      }}
    >
      <DialogTitle>{copy.title}</DialogTitle>
      {mode === "delete" ? (
        <>
          <DialogDescription className="sr-only">
            This cannot be undone.
          </DialogDescription>
          <Alert variant="error" title="This cannot be undone">
            The text is kept in the moderation log for 90 days for appeals and
            then erased.
          </Alert>
        </>
      ) : (
        <DialogDescription>{copy.body}</DialogDescription>
      )}

      <blockquote
        data-testid="comment-preview"
        className="line-clamp-3 whitespace-pre-wrap rounded-11 bg-surface-sunken p-12 text-[13.5px] text-ink"
      >
        {comment.body}
      </blockquote>

      <form onSubmit={submit} noValidate className="flex flex-col gap-14">
        <div className="flex flex-col gap-6">
          <label
            htmlFor={`${reasonErrId}-field`}
            className="text-[13px] font-semibold text-ink"
          >
            Reason (kept in the audit log)
          </label>
          <Textarea
            id={`${reasonErrId}-field`}
            ref={reasonRef}
            rows={3}
            required
            aria-required="true"
            error={reasonError !== null}
            aria-describedby={reasonError ? reasonErrId : undefined}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (reasonError) setReasonError(null);
            }}
          />
          <div className="flex items-start justify-between gap-12">
            <span
              id={reasonErrId}
              role={reasonError ? "alert" : undefined}
              className="text-[12.5px] text-rose-text"
            >
              {reasonError}
            </span>
            <span
              className={
                reason.trim().length > REASON_MAX
                  ? "font-mono text-[11.5px] text-rose-text"
                  : "font-mono text-[11.5px] text-ink-muted"
              }
            >
              {reason.trim().length}/{REASON_MAX}
            </span>
          </div>
        </div>

        {mode === "delete" ? (
          <div className="flex flex-col gap-4">
            <label className="flex items-center gap-8 text-[13.5px] text-ink">
              <Checkbox
                checked={understood}
                aria-describedby={confirmError ? confirmErrId : undefined}
                aria-invalid={confirmError ? true : undefined}
                onChange={(e) => {
                  setUnderstood(e.target.checked);
                  if (confirmError) setConfirmError(null);
                }}
              />
              I understand this is permanent
            </label>
            {confirmError ? (
              <span
                id={confirmErrId}
                role="alert"
                className="text-[12.5px] text-rose-text"
              >
                {confirmError}
              </span>
            ) : null}
          </div>
        ) : null}

        {failure ? (
          <Alert variant="error" title={failure}>
            Your input was kept.
          </Alert>
        ) : null}

        <div className="flex justify-end gap-8">
          <Button
            ref={cancelRef}
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant={mode === "delete" ? "destructive" : "primary"}
            disabled={pending}
          >
            {pending ? "Working…" : copy.submit}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
