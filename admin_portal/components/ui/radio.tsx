import * as React from "react";
import { cn } from "cn";

/* Radio — native input, 17px, accent-color clay-600 (README §"Checkbox /
   Radio"; UI Kit §04). Caller owns the shared `name`. */
function Radio({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="radio"
      data-slot="radio"
      className={cn(
        "size-[17px] shrink-0 cursor-pointer accent-clay-600 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Radio };
