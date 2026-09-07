import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   Toast — RhemaPod UI Kit primitive (W2). Presentational only.

   UI Kit §10: dark (#2E2723), radius 12, padding 13x16, shadow
   0 8px 24px rgba(46,39,35,.16) (the `shadow-toast` token), a sage dot,
   14px canvas text, a mono 11.5px timestamp, and a dismiss x.

   Wiring this to Sonner / a toast queue is a later work item; W2 ships the
   surface so the fidelity pass has it. UI-Kit HTML dot is #7FBF95 (no token) —
   using `sage` per the README component spec ("sage dot").
   ========================================================================== */

type ToastProps = React.ComponentProps<"div"> & {
  message: React.ReactNode;
  timestamp?: string;
  onDismiss?: () => void;
};

function Toast({
  message,
  timestamp,
  onDismiss,
  className,
  ...props
}: ToastProps) {
  return (
    <div
      data-slot="toast"
      role="status"
      className={cn(
        "shadow-toast inline-flex w-fit items-center gap-12 rounded-12 bg-dark p-[13px_16px]",
        className,
      )}
      {...props}
    >
      <span aria-hidden className="size-[8px] shrink-0 rounded-full bg-sage" />
      <span className="text-[14px] text-canvas">{message}</span>
      {timestamp ? (
        <span className="font-mono text-[11.5px] tracking-[0.06em] text-ink-faint">
          {timestamp}
        </span>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="cursor-pointer pl-6 text-[15px] leading-none text-ink-faint outline-none hover:text-canvas focus-visible:focus-ring-button"
        >
          &times;
        </button>
      ) : null}
    </div>
  );
}

export { Toast };
export type { ToastProps };
