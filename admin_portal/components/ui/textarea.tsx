import * as React from "react";
import { cn } from "cn";
import { fieldBase } from "@/components/ui/input";

/* =============================================================================
   Textarea — RhemaPod UI Kit primitive (W2).
   Shares the Input field treatment; vertical padding + resize-y, no fixed
   height (caller sets `rows`). UI Kit §04 "Description".
   ========================================================================== */

type TextareaProps = React.ComponentProps<"textarea"> & {
  error?: boolean;
};

function Textarea({ className, error, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      aria-invalid={error || props["aria-invalid"]}
      className={cn(fieldBase, "resize-y py-[10px] leading-[1.55]", className)}
      {...props}
    />
  );
}

export { Textarea };
export type { TextareaProps };
