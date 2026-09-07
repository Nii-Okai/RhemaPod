import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "cn";

/* =============================================================================
   Switch — RhemaPod UI Kit primitive (W2).

   Exact spec (README "Settings → Toggle spec", UI Kit §04):
     track 40 x 23, radius 999, 2px padding
     knob  19px white circle
     on  = clay-600, knob at margin-left 17px
     off = border (#E4DDD1), knob at 0
   Radix Switch supplies the keyboard + role="switch" + aria-checked semantics.
   ========================================================================== */

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-[23px] w-[40px] shrink-0 items-center rounded-full p-[2px] transition-colors duration-150 ease-out outline-none",
        "bg-border data-[state=checked]:bg-clay-600",
        "focus-visible:focus-ring-button disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-[19px] rounded-full bg-white transition-[margin] duration-150 ease-out data-[state=checked]:ml-[17px]" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
