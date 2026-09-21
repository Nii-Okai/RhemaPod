"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EditorField } from "@/components/sermons/editor/field";
import { Input } from "@/components/ui/input";
import { Radio } from "@/components/ui/radio";
import { formatLocalDateTime, parseLocalDateTime } from "@/lib/datetime";
import type { SermonTier } from "@/lib/query/hooks/use-autosave-sermon";

/* =============================================================================
   Access card (design Screen 4, right column).

   Three radios bound to `tier`:
     "Inherit from series" → null   (disabled + a note when standalone)
     "Free"                → "free"
     "Paid — subscribers only" → "paid"

   The Inherit sub-line names the resolved series tier. Any change flushes
   through the normal autosave patch.

   "Publish at" (round 2 — scheduled sermon publish) mirrors the Announcement
   editor's field exactly: a native `<input type="datetime-local">`, local ⇄
   ISO via the shared `lib/datetime.ts` helpers (`SermonFormValues.publish_at`
   already holds the wire ISO string, same as every other tracked field, so no
   local text state is needed here — the native picker only ever emits the
   exact shape or an empty string). A `published` sermon with a future
   `publish_at` stays hidden from every public read path until it passes;
   staff always see it (backend, mirrors `Announcement`). No "must be future"
   validation — the backend doesn't enforce one for `Announcement.publish_at`
   either, so this field doesn't invent one.
   ========================================================================== */

export interface AccessCardProps {
  tier: SermonTier;
  /** No series → Inherit resolves to free and can't be chosen. */
  standalone: boolean;
  /** The series' own tier, for the Inherit sub-line (when in a series). */
  seriesTier?: SermonTier;
  /** ISO 8601, or null. */
  publishAt: string | null;
  disabled?: boolean;
  onChange: (tier: SermonTier) => void;
  /** Debounced, mirrors `DetailsCard`'s text fields — queues the patch. */
  onPublishAtChange: (publishAt: string | null) => void;
  /** Flush on blur, same as every other text-like field in the editor. */
  onPublishAtCommit: () => void;
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
  publishAt,
  disabled = false,
  onChange,
  onPublishAtChange,
  onPublishAtCommit,
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

      <EditorField
        label="Publish at"
        htmlFor="sermon-publish-at"
        hint="Leave blank to publish immediately when approved."
      >
        <Input
          id="sermon-publish-at"
          type="datetime-local"
          value={formatLocalDateTime(publishAt)}
          disabled={disabled}
          onChange={(e) => {
            const parsed = parseLocalDateTime(e.target.value);
            // The native picker only ever yields the exact shape or an empty
            // string, so an unparseable value can't happen here — but stay
            // defensive and simply ignore it rather than clobber the field.
            if (parsed.ok) onPublishAtChange(parsed.iso);
          }}
          onBlur={onPublishAtCommit}
        />
      </EditorField>
    </Card>
  );
}
