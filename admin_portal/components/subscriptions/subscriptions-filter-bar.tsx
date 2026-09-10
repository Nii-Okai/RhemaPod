"use client";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/portal/segmented-control";
import {
  SUBSCRIPTION_TIERS,
  type SubscriptionStatus,
  type SubscriptionTier,
} from "@/lib/query/hooks/use-subscriptions";
import { SUBSCRIPTION_STATUS_LABEL } from "./subscription-status";

/* =============================================================================
   SubscriptionsFilterBar — the filter row on Subscriptions (design Screen 9).

   status SegmentedControl (All / Active / Past due / Cancelled / Expired) · a
   tier <select> (Any tier / Free / Monthly / Annual) · a spacer · the
   "Download CSV" button. Matches the Sermons filter bar's structure
   (SegmentedControl for the primary filter, native Select for the secondary).
   Any change is pushed straight to `?status=` / `?tier=` by the parent and
   resets the page to 1.

   The CSV is built client-side from the rows already loaded (plan §W21) — the
   button just calls back. It is disabled only when there is genuinely nothing
   to export (zero rows), which is a statement of fact, not a "temporarily
   unavailable" promise.
   ========================================================================== */

type StatusFilter = SubscriptionStatus | "all";

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: SUBSCRIPTION_STATUS_LABEL.active },
  { value: "past_due", label: SUBSCRIPTION_STATUS_LABEL.past_due },
  { value: "cancelled", label: SUBSCRIPTION_STATUS_LABEL.cancelled },
  { value: "expired", label: SUBSCRIPTION_STATUS_LABEL.expired },
];

const TIER_LABEL: Record<SubscriptionTier, string> = {
  free: "Free",
  monthly: "Monthly",
  annual: "Annual",
};

const SELECT_CLASS =
  "h-[32px] rounded-9 border-border-strong pr-[30px] text-[13px]";

export interface SubscriptionsFilterBarProps {
  status?: SubscriptionStatus;
  tier?: SubscriptionTier;
  onStatusChange: (status: SubscriptionStatus | undefined) => void;
  onTierChange: (tier: SubscriptionTier | undefined) => void;
  onDownloadCsv: () => void;
  csvRowCount: number;
}

export function SubscriptionsFilterBar({
  status,
  tier,
  onStatusChange,
  onTierChange,
  onDownloadCsv,
  csvRowCount,
}: SubscriptionsFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-10">
      <SegmentedControl<StatusFilter>
        aria-label="Filter subscriptions by status"
        options={STATUS_OPTIONS}
        value={status ?? "all"}
        onValueChange={(next) =>
          onStatusChange(next === "all" ? undefined : next)
        }
      />

      <div className="w-[136px]">
        <Select
          aria-label="Filter by tier"
          className={SELECT_CLASS}
          value={tier ?? ""}
          onChange={(event) =>
            onTierChange(
              (event.target.value || undefined) as
                | SubscriptionTier
                | undefined,
            )
          }
        >
          <option value="">Any tier</option>
          {SUBSCRIPTION_TIERS.map((value) => (
            <option key={value} value={value}>
              {TIER_LABEL[value]}
            </option>
          ))}
        </Select>
      </div>

      <span className="flex-1" />

      <Button
        type="button"
        size="md"
        variant="secondary"
        onClick={onDownloadCsv}
        disabled={csvRowCount === 0}
      >
        Download CSV
      </Button>
    </div>
  );
}
