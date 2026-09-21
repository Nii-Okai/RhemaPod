"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isFuture, parseLocalDateTime } from "@/lib/datetime";

/* =============================================================================
   SchedulePublishPanel — the inline "pick a publish time" panel (round 2,
   scheduled sermon publish). Occupies the same action-row slot a review
   card's reject panel already uses: swap the button row for a labelled
   `datetime-local` input + [Confirm]/[Cancel], never a dialog.

   `variant` only changes the Confirm label — this component fires no request
   itself. The caller (`SubmissionCard` via `ReviewScreen`) decides which
   mutation(s) `onConfirm`'s ISO feeds: `approve` → `publish {publish_at}` for
   "approve", or `publish {publish_at}` alone for "publish" (an already-
   approved card).

   Validation is client-side only, and deliberately lenient the way
   `Announcement.publish_at` already is — the backend enforces no future-only
   rule, so nothing here posts one either. `onConfirm` fires only once `value`
   parses to a strictly-future ISO instant; until then Confirm stays disabled
   with an inline hint pointing at the immediate-publish alternative.
   ========================================================================== */

export interface SchedulePublishPanelProps {
  /** "approve" → the confirm label reads "Approve & schedule" (the caller
      runs approve then publish). "publish" → "Schedule" (publish alone, an
      already-approved card). */
  variant: "approve" | "publish";
  /** Local `datetime-local` text, owned by the parent — same pattern as the
      review card's existing `note` state for the reject panel. */
  value: string;
  onChange: (value: string) => void;
  /** Fires only once `value` parses to a strictly-future ISO instant. */
  onConfirm: (iso: string) => void;
  onCancel: () => void;
  busy: boolean;
  /** Injectable clock (tests); defaults to `Date.now()`. */
  now?: number;
}

const CONFIRM_LABEL: Record<SchedulePublishPanelProps["variant"], string> = {
  approve: "Approve & schedule",
  publish: "Schedule",
};

export function SchedulePublishPanel({
  variant,
  value,
  onChange,
  onConfirm,
  onCancel,
  busy,
  now,
}: SchedulePublishPanelProps) {
  const inputId = useId();
  // Lazy-init, not a bare `Date.now()` in the render body — same pattern as
  // `ReviewScreen`/`SermonsScreen`'s own `now` state, one clock read per
  // mount for the life of the panel.
  const [mountedAt] = useState(() => Date.now());
  const parsed = parseLocalDateTime(value);
  const validIso =
    parsed.ok && parsed.iso && isFuture(parsed.iso, now ?? mountedAt)
      ? parsed.iso
      : null;
  const canConfirm = !busy && validIso != null;

  return (
    <div className="mt-2 flex flex-col gap-8">
      <label
        htmlFor={inputId}
        className="text-[13px] font-medium text-ink-muted"
      >
        Publish at
      </label>
      <Input
        id={inputId}
        type="datetime-local"
        value={value}
        error={validIso == null}
        onChange={(e) => onChange(e.target.value)}
      />
      {validIso == null ? (
        <p className="text-[12.5px] text-rose-text">
          Pick a time in the future — for immediate publish, use the other
          option.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-8">
        <Button
          size="sm"
          variant="primary"
          disabled={!canConfirm}
          onClick={() => {
            if (validIso) onConfirm(validIso);
          }}
        >
          {CONFIRM_LABEL[variant]}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
