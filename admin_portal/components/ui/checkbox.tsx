import * as React from "react";
import { cn } from "cn";

/* Checkbox — native input, 17px, accent-color clay-600 (README §"Checkbox /
   Radio"; UI Kit §04). Native on purpose: the design shows OS checkboxes. */
function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-[17px] shrink-0 cursor-pointer accent-clay-600 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox };
