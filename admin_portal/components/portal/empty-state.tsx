import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   EmptyState — RhemaPod UI Kit primitive (W2). Hand-built.
   UI Kit §07: a 34px dashed circle, a 14.5/600 title, and a ~26ch explainer in
   ink-muted with text-wrap:pretty. Optional action slot (README: "every list
   has one", often with a New... button).
   ========================================================================== */

type EmptyStateProps = React.ComponentProps<"div"> & {
  title: React.ReactNode;
  description: React.ReactNode;
  action?: React.ReactNode;
};

function EmptyState({
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-10 px-14 py-14 text-center",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="block size-[34px] rounded-full border-2 border-dashed border-border-strong"
      />
      <span className="text-[14.5px] font-semibold text-ink">{title}</span>
      <span className="max-w-[26ch] text-pretty text-[13px] text-ink-muted">
        {description}
      </span>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
