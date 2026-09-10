import * as React from "react";
import { cn } from "cn";

import { USER_STATE_LABEL, userState, type UserState } from "./user-state";
import type { UserPublic } from "@/lib/query/hooks/use-users";

/* =============================================================================
   UserStateCell — the "State" column on Users & roles (design Screen 10, W19).

   A badge with a WORD in it — never colour-only. The design's accessibility
   bar (plan §A.6 / W19: "status is never color-only") means a monochrome or
   low-vision render must still say what the row is, so the label text
   ("Active" / "Deactivated" / "Invite pending") is the status cue and the tone
   colour is only reinforcement. Shape follows `RoleChip` (h-24, radius-6,
   12/600) with a leading dot, matching the design's dot-plus-text State cell.
   ========================================================================== */

const TONE: Record<UserState, { badge: string; dot: string }> = {
  active: { badge: "bg-sage-tint text-sage-text", dot: "bg-sage" },
  deactivated: { badge: "bg-rose-tint text-rose-text", dot: "bg-rose" },
  pending: { badge: "bg-wheat-tint text-wheat-text", dot: "bg-wheat" },
};

export interface UserStateCellProps {
  row: Pick<UserPublic, "is_active" | "activated_at">;
}

export function UserStateCell({ row }: UserStateCellProps) {
  const state = userState(row);
  const tone = TONE[state];
  return (
    <span
      data-slot="user-state"
      data-testid="user-state"
      data-state={state}
      className={cn(
        "inline-flex h-[24px] w-fit items-center gap-[7px] rounded-6 px-10 text-[12px] font-semibold tracking-[0.02em]",
        tone.badge,
      )}
    >
      <span
        aria-hidden
        className={cn("block size-[6px] shrink-0 rounded-full", tone.dot)}
      />
      {USER_STATE_LABEL[state]}
    </span>
  );
}
