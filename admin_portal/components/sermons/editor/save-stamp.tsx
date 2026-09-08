"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";

import type { AutosaveStatus } from "@/lib/query/hooks/use-autosave-sermon";
import { formatRelativeTime } from "@/lib/format";

/* =============================================================================
   SaveStamp — the mono "saved N min ago" line in the editor's save row
   (design Screen 4; plan §A.4).

   Driven by the autosave `status` + the last-successful `savedAt`, never a
   dirty flag. Re-renders on a 30s interval so the relative time stays honest
   without a save happening.
   ========================================================================== */

export interface SaveStampProps {
  status: AutosaveStatus;
  savedAt: number | null;
  /** No id yet (the /sermons/new case before the first successful POST). */
  unsaved: boolean;
  className?: string;
}

export function SaveStamp({ status, savedAt, unsaved, className }: SaveStampProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (status !== "saved" && status !== "idle") return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [status]);

  let text: string;
  let tone = "text-ink-faint";

  if (status === "saving") {
    text = "Saving…";
  } else if (status === "error") {
    text = "Not saved";
    tone = "text-rose-text";
  } else if (savedAt != null) {
    text = `saved ${formatRelativeTime(savedAt)}`;
  } else if (unsaved) {
    text = "Not saved yet";
  } else {
    text = "";
  }

  if (!text) return null;

  return (
    <span
      data-slot="save-stamp"
      data-status={status}
      aria-live="polite"
      className={cn("text-mono-meta", tone, className)}
    >
      {text}
    </span>
  );
}
