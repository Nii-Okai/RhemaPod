import { cn } from "cn";

import { STATUS_LABEL, STATUS_TONE } from "@/lib/devotionals/calendar";
import type { DisplayStatus } from "@/lib/query/hooks/use-devotionals";

/** A devotional's derived status (ADR 0022 §2). The label is always written out, so colour is never the only cue. */
export function StatusPill({ status, className }: { status: DisplayStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[24px] shrink-0 items-center rounded-full px-10 text-[12px] font-semibold",
        STATUS_TONE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
