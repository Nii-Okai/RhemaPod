import { cn } from "cn";

import {
  COMMENT_STATE_LABEL,
  type CommentState,
} from "@/components/comments/comment-state";

/* =============================================================================
   CommentStateChip — text badge for a comment's moderation state (S2 §3.6).
   Shared by the queue table and the detail dialog. The label is the non-colour
   cue; "Auto-hidden" and "Hidden" differ in label and fill.
   ========================================================================== */

const TONE: Record<CommentState, string> = {
  visible: "bg-neutral-badge text-ink-muted",
  reported: "bg-wheat-tint text-wheat-text",
  auto_hidden: "bg-wheat-tint text-wheat-text",
  hidden: "bg-rose-tint text-rose-text",
};

export function CommentStateChip({
  state,
  className,
}: {
  state: CommentState;
  className?: string;
}) {
  return (
    <span
      data-state={state}
      className={cn(
        "inline-flex h-[26px] items-center gap-6 rounded-full px-[11px] text-[12.5px] font-semibold",
        TONE[state],
        className,
      )}
    >
      <span aria-hidden className="size-[6px] rounded-full bg-current" />
      {COMMENT_STATE_LABEL[state]}
    </span>
  );
}
