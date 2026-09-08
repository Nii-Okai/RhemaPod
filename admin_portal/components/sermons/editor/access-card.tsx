"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Radio } from "@/components/ui/radio";
import type { SermonTier } from "@/lib/query/hooks/use-autosave-sermon";

/* =============================================================================
   Access card (design Screen 4, right column).

   Three radios bound to `tier`:
     "Inherit from series" → null   (disabled + a note when standalone)
     "Free"                → "free"
     "Paid — subscribers only" → "paid"

   The Inherit sub-line names the resolved series tier. Any change flushes
   through the normal autosave patch.
   ========================================================================== */

export interface AccessCardProps {
  tier: SermonTier;
  /** No series → Inherit resolves to free and can't be chosen. */
  standalone: boolean;
  /** The series' own tier, for the Inherit sub-line (when in a series). */
  seriesTier?: SermonTier;
  disabled?: boolean;
  onChange: (tier: SermonTier) => void;
}

type Choice = "inherit" | "free" | "paid";

const TIER_LABEL: Record<"free" | "paid", string> = {
  free: "Free",
  paid: "Paid",
};

export function AccessCard({
  tier,
  standalone,
  seriesTier,
  disabled = false,
  onChange,
}: AccessCardProps) {
  const current: Choice = tier === null ? "inherit" : tier;

  const pick = (choice: Choice) => {
    onChange(choice === "inherit" ? null : choice);
  };

  const inheritHint = standalone
    ? "This sermon isn’t in a series — it will be free."
    : seriesTier
      ? `Follows the series tier — currently ${TIER_LABEL[seriesTier]}.`
      : "Follows the series tier.";

  const rows: Array<{
    value: Choice;
    label: string;
    hint?: string;
    disabled?: boolean;
  }> = [
    {
      value: "inherit",
      label: "Inherit from series",
      hint: inheritHint,
      disabled: standalone,
    },
    { value: "free", label: "Free" },
    { value: "paid", label: "Paid — subscribers only" },
  ];

  return (
    <Card className="flex flex-col gap-14 p-20">
      <CardHeader>
        <CardTitle>Access</CardTitle>
      </CardHeader>

      <fieldset
        className="flex flex-col gap-12"
        disabled={disabled}
        aria-label="Access tier"
      >
        {rows.map((row) => {
          const id = `tier-${row.value}`;
          return (
            <div key={row.value} className="flex gap-10">
              <Radio
                id={id}
                name="sermon-tier"
                className="mt-[2px]"
                value={row.value}
                checked={current === row.value}
                disabled={disabled || row.disabled}
                onChange={() => pick(row.value)}
              />
              <label htmlFor={id} className="flex flex-col gap-2">
                <span className="text-[13.5px] font-medium text-ink">
                  {row.label}
                </span>
                {row.hint ? (
                  <span className="text-[12.5px] text-ink-faint">
                    {row.hint}
                  </span>
                ) : null}
              </label>
            </div>
          );
        })}
      </fieldset>
    </Card>
  );
}
