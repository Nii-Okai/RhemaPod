import * as React from "react";
import { cn } from "cn";

import {
  subscriptionStatusVisual,
  type SubscriptionStatusTone,
} from "./subscription-status";
import type { SubscriptionStatus } from "@/lib/query/hooks/use-subscriptions";

/* =============================================================================
   SubscriptionStatusBadge — the "Status" cell on Subscriptions (Screen 9, W21).

   A badge with a WORD in it — never colour-only. Shape follows `UserStateCell`
   (h-24, radius-6, 12/600, leading 6px dot); the label text is the status cue
   and the tone colour only reinforces it.

   A `past_due` row reads exactly "Past due" — no date of any kind is rendered
   here or anywhere adjacent (plan §A.3). The renewal date is a separate column.
   ========================================================================== */

const TONE: Record<SubscriptionStatusTone, { badge: string; dot: string }> = {
  sage: { badge: "bg-sage-tint text-sage-text", dot: "bg-sage" },
  wheat: { badge: "bg-wheat-tint text-wheat-text", dot: "bg-wheat" },
  slate: { badge: "bg-slate-tint text-slate-text", dot: "bg-slate" },
  neutral: { badge: "bg-neutral-badge text-ink-soft", dot: "bg-ink-faint" },
};

export interface SubscriptionStatusBadgeProps {
  status: SubscriptionStatus;
}

export function SubscriptionStatusBadge({
  status,
}: SubscriptionStatusBadgeProps) {
  const visual = subscriptionStatusVisual(status);
  const tone = TONE[visual.tone];
  return (
    <span
      data-slot="subscription-status"
      data-testid="subscription-status"
      data-status={status}
      className={cn(
        "inline-flex h-[24px] w-fit items-center gap-[7px] rounded-6 px-10 text-[12px] font-semibold tracking-[0.02em]",
        tone.badge,
      )}
    >
      <span
        aria-hidden
        className={cn("block size-[6px] shrink-0 rounded-full", tone.dot)}
      />
      {visual.label}
    </span>
  );
}
