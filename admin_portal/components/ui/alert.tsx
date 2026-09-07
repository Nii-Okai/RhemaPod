import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   Alert — RhemaPod UI Kit primitive (W2). Hand-built.
   README §"Alert" + UI Kit §10: radius 12, padding 14x16, an 8px status dot at
   margin-top 6px, a 14.5/600 title and a 13.5px body. Surfaces from the token
   table's alert rows. Used at the top of the affected card for request
   failures (README "Errors") — it must survive, so it is not a toast.
   ========================================================================== */

type AlertVariant = "success" | "warning" | "error";

const SURFACE: Record<AlertVariant, { box: string; dot: string; title: string }> =
  {
    success: {
      box: "border-alert-success-border bg-alert-success-bg",
      dot: "bg-sage",
      title: "text-sage-text",
    },
    warning: {
      box: "border-alert-warning-border bg-alert-warning-bg",
      dot: "bg-wheat",
      title: "text-wheat-text",
    },
    error: {
      box: "border-alert-error-border bg-alert-error-bg",
      dot: "bg-rose",
      title: "text-rose-text",
    },
  };

type AlertProps = React.ComponentProps<"div"> & {
  variant?: AlertVariant;
  title: React.ReactNode;
};

function Alert({
  variant = "success",
  title,
  children,
  className,
  ...props
}: AlertProps) {
  const s = SURFACE[variant];
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(
        "flex gap-12 rounded-12 border p-[14px_16px]",
        s.box,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn("mt-[6px] size-[8px] shrink-0 rounded-full", s.dot)}
      />
      <div className="flex flex-col gap-2">
        <span className={cn("text-[14.5px] font-semibold", s.title)}>
          {title}
        </span>
        {/* UI-Kit HTML body text is a tinted dark (#4A6B54 / #6E5A2E / #7A3B3B),
            no token — using ink-muted. */}
        {children ? (
          <span className="text-[13.5px] text-ink-muted">{children}</span>
        ) : null}
      </div>
    </div>
  );
}

export { Alert };
export type { AlertProps, AlertVariant };
