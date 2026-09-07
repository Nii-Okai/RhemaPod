import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/* =============================================================================
   Input — RhemaPod UI Kit primitive (W2).

   Spec: README "Components to build → Input / Textarea / Select" + UI Kit §04.
   height 40 (default) / 38 (dense panels) / 44 (login); radius 10; border-strong;
   15px text. Focus: clay border + 0 0 0 3px clay-100 glow. Error: rose border,
   rose-bg fill, and (caller-rendered) rose label + 12px rose message.
   ========================================================================== */

export const fieldBase =
  "w-full rounded-10 border bg-surface px-12 text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-ink-faint focus-visible:focus-ring-input disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-faint aria-invalid:border-rose aria-invalid:bg-rose-bg aria-invalid:text-ink";

const inputVariants = cva(fieldBase, {
  variants: {
    inputSize: {
      default: "h-[40px]",
      dense: "h-[38px]",
      login: "h-[44px]",
    },
  },
  defaultVariants: { inputSize: "default" },
});

type InputProps = Omit<React.ComponentProps<"input">, "size"> &
  VariantProps<typeof inputVariants> & {
    /** Renders the rose error treatment and sets aria-invalid. */
    error?: boolean;
  };

function Input({ className, inputSize, error, ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      aria-invalid={error || props["aria-invalid"]}
      className={cn(inputVariants({ inputSize }), className)}
      {...props}
    />
  );
}

export { Input, inputVariants };
export type { InputProps };
