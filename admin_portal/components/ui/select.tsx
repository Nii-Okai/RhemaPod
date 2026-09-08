import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { fieldBase } from "@/components/ui/input";

/* =============================================================================
   Select — RhemaPod UI Kit primitive (W2).

   Native <select> (the design uses native selects — UI Kit §04). Same field
   treatment as Input. lucide ChevronDown is kept as a primitive internal only
   (README: lucide is allowed inside primitives, banned from nav/row-menus/
   buttons). Sizes mirror Input: 40 / 38 / 44.
   ========================================================================== */

const selectVariants = cva(cn(fieldBase, "appearance-none pr-[34px]"), {
  variants: {
    inputSize: {
      default: "h-[40px]",
      dense: "h-[38px]",
      login: "h-[44px]",
    },
  },
  defaultVariants: { inputSize: "default" },
});

type SelectProps = Omit<React.ComponentProps<"select">, "size"> &
  VariantProps<typeof selectVariants> & {
    error?: boolean;
  };

function Select({ className, inputSize, error, children, ...props }: SelectProps) {
  return (
    <div className="relative inline-grid w-full">
      <select
        data-slot="select"
        aria-invalid={error || props["aria-invalid"]}
        className={cn(selectVariants({ inputSize }), className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-12 size-4 -translate-y-1/2 text-ink-faint"
      />
    </div>
  );
}

export { Select, selectVariants };
export type { SelectProps };
