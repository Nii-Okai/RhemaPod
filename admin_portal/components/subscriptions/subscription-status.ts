/**
 * How a `SubscriptionStatus` reads on the Subscriptions screen (design Screen 9,
 * plan §A.3 / §W21).
 *
 * The label is the status cue — a badge with a WORD in it, never colour-only
 * (the design's accessibility bar, same as the Users "State" column). Tone is
 * reinforcement.
 *
 * `past_due` reads exactly **"Past due"** and NOTHING ELSE. No retry date, no
 * "since" date — dunning state is not stored, and `updated_at` is
 * last-any-change, not went-past-due, so any date here would state a fact the
 * system does not hold (plan §A.3, decision 4). `current_period_end` is the
 * renewal date and lives in its own column; it is not a dunning timestamp.
 *
 * Total over every `SubscriptionStatus` at compile time — a new status is a
 * compile error until it is given an entry — with a runtime fallback for a
 * value the generated union does not yet cover (an out-of-union status from the
 * API): a neutral tone and the raw string as the label, so the badge renders
 * and the CSV serialises the real value rather than `"undefined"`.
 */

import type { SubscriptionStatus } from "@/lib/query/hooks/use-subscriptions";

export type SubscriptionStatusTone = "sage" | "wheat" | "slate" | "neutral";

interface SubscriptionStatusVisual {
  label: string;
  tone: SubscriptionStatusTone;
}

const REGISTRY: Record<SubscriptionStatus, SubscriptionStatusVisual> = {
  // active, cancelled and past_due all still grant entitlement (design
  // "Backend contract"); expired does not.
  active: { label: "Active", tone: "sage" },
  past_due: { label: "Past due", tone: "wheat" },
  cancelled: { label: "Cancelled", tone: "slate" },
  expired: { label: "Expired", tone: "neutral" },
};

export function subscriptionStatusVisual(
  status: SubscriptionStatus,
): SubscriptionStatusVisual {
  return (
    REGISTRY[status] ?? {
      label: String(status).trim() || "Unknown",
      tone: "neutral",
    }
  );
}

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: REGISTRY.active.label,
  past_due: REGISTRY.past_due.label,
  cancelled: REGISTRY.cancelled.label,
  expired: REGISTRY.expired.label,
};
