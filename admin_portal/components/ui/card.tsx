import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   Card — RhemaPod UI Kit primitive (W2).
   radius 16 (panels) / 14 (stat + media cards, via className), 1px border,
   surface fill, padding 18-22. README §"Card / StatCard / MediaCard".
   ========================================================================== */

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-16 border border-border bg-surface p-20 text-ink",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex items-baseline justify-between gap-12", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-section-title text-ink", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle };
