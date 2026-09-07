import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "cn";

/* =============================================================================
   Button — RhemaPod UI Kit primitive (W2).

   Replaces shadcn's stock Button. Spec: README "Components to build → Button"
   cross-checked against RhemaPod UI Kit.dc.html §03.

   Sizes  : 30 / 38 / 46 px tall, radius 8 / 10 / 12, weight 600.
   Variants: primary · secondary · ghost · destructive · disabled.
   Focus  : 2px clay-400 ring at 2px offset (focus-ring-button utility).

   One primary per view — not enforced here, called out in review.
   ========================================================================== */

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap border font-semibold transition-[background-color,border-color,color,opacity] duration-150 ease-out outline-none focus-visible:focus-ring-button disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-canvas disabled:text-ink-disabled",
  {
    variants: {
      variant: {
        primary:
          "border-clay-600 bg-clay-600 text-on-clay hover:border-clay-700 hover:bg-clay-700",
        secondary:
          "border-border-strong bg-surface text-ink hover:border-ink-disabled hover:bg-surface-sunken",
        ghost:
          "border-transparent bg-transparent text-clay-600 hover:bg-clay-50",
        destructive:
          "border-rose-border bg-surface text-rose hover:border-rose hover:bg-rose-bg",
        // Rendered look of the native :disabled state, as an explicit variant so
        // the kit can show it without setting the attribute. Real disabled
        // buttons should still carry the `disabled` prop for semantics.
        disabled:
          "cursor-not-allowed border-border-subtle bg-canvas text-ink-disabled",
      },
      size: {
        sm: "h-[30px] rounded-8 px-12 text-[13px]",
        md: "h-[38px] rounded-10 px-18 text-[14px]",
        lg: "h-[46px] rounded-12 px-24 text-[15px]",
      },
    },
    compoundVariants: [
      // Ghost sits tighter to its label — UI Kit §03 "Preview" button.
      { variant: "ghost", size: "sm", class: "px-[10px]" },
      { variant: "ghost", size: "md", class: "px-14" },
      { variant: "ghost", size: "lg", class: "px-18" },
    ],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({
  className,
  variant = "primary",
  size = "md",
  asChild = false,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
