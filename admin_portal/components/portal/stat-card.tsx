import * as React from "react";
import { cn } from "cn";
import { Card } from "@/components/ui/card";

/* =============================================================================
   StatCard — RhemaPod UI Kit primitive (W2). Hand-built.
   UI Kit §07: rounded-14, p-18, gap-8. mono-eyebrow label, Newsreader ~40
   metric, then a delta line — sage 13/600 with a CSS triangle for positive
   movement, plain ink-muted for a neutral fact.
   ========================================================================== */

type Delta = {
  direction: "up" | "down" | "neutral";
  text: string;
};

type StatCardProps = React.ComponentProps<"div"> & {
  label: string;
  value: React.ReactNode;
  delta?: Delta;
};

function StatCard({ label, value, delta, className, ...props }: StatCardProps) {
  return (
    <Card
      data-slot="stat-card"
      className={cn("flex flex-col gap-8 rounded-14 p-18", className)}
      {...props}
    >
      <span className="text-mono-eyebrow text-ink-faint">{label}</span>
      <span className="text-metric text-ink">{value}</span>
      {delta ? (
        <span
          className={cn(
            "inline-flex items-center gap-6 text-[13px] font-semibold",
            delta.direction === "up" && "text-sage-text",
            delta.direction === "down" && "text-rose-text",
            delta.direction === "neutral" && "font-normal text-ink-muted",
          )}
        >
          {delta.direction === "up" ? (
            <span
              aria-hidden
              className="size-0 border-x-4 border-b-[6px] border-x-transparent border-b-sage"
            />
          ) : delta.direction === "down" ? (
            <span
              aria-hidden
              className="size-0 border-x-4 border-t-[6px] border-x-transparent border-t-rose"
            />
          ) : null}
          {delta.text}
        </span>
      ) : null}
    </Card>
  );
}

export { StatCard };
export type { StatCardProps };
