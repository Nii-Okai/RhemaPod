import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   Progress — RhemaPod UI Kit primitive (W2). Hand-built (plain divs, no lib).
   README §"Progress" + UI Kit §08:
     6px track, border-subtle fill, radius 999.
     upload    -> clay-600 fill
     transcode -> linear-gradient(90deg, slate, #7FA0C4)  (gradient stop, no token)
     complete  -> sage fill
   Fill width animates 300ms ease-out (README "Interactions & behavior").
   ========================================================================== */

type ProgressProps = React.ComponentProps<"div"> & {
  /** 0-100. Values outside are clamped. */
  value: number;
  variant?: "upload" | "transcode" | "complete";
  label?: string;
};

const FILL: Record<NonNullable<ProgressProps["variant"]>, string> = {
  upload: "bg-clay-600",
  transcode: "bg-[linear-gradient(90deg,var(--color-slate),#7fa0c4)]",
  complete: "bg-sage",
};

function Progress({
  value,
  variant = "upload",
  label,
  className,
  ...props
}: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        "h-[6px] w-full overflow-hidden rounded-full bg-border-subtle",
        className,
      )}
      {...props}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300 ease-out", FILL[variant])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export { Progress };
export type { ProgressProps };
