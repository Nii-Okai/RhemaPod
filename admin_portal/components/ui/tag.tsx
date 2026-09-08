import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   Tag pill — RhemaPod UI Kit primitive (W2).

   Spec: README §"Tag pill" + UI Kit §04.
   height 28, radius 999, canvas fill, 1px border, 13px.
   default : removable — right padding tightens for the x (0 6px 0 11px), gap 7.
   add     : dashed border-strong, no fill, ink-faint — the "+ add tag" affordance.
   ========================================================================== */

type TagProps = React.ComponentProps<"span"> & {
  variant?: "default" | "add";
  /** default variant only: renders the x affordance and wires its click. */
  onRemove?: () => void;
  removeLabel?: string;
};

function Tag({
  className,
  variant = "default",
  onRemove,
  removeLabel = "Remove",
  children,
  ...props
}: TagProps) {
  if (variant === "add") {
    return (
      <span
        data-slot="tag"
        data-variant="add"
        className={cn(
          "inline-flex h-[28px] cursor-pointer items-center rounded-full border border-dashed border-border-strong px-11 text-[13px] text-ink-faint",
          className,
        )}
        {...props}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      data-slot="tag"
      data-variant="default"
      className={cn(
        "inline-flex h-[28px] items-center gap-[7px] rounded-full border border-border bg-canvas pr-6 pl-11 text-[13px] text-ink",
        !onRemove && "pr-11",
        className,
      )}
      {...props}
    >
      {children}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="-mr-[1px] flex size-[15px] cursor-pointer items-center justify-center text-[15px] leading-none text-ink-faint outline-none hover:text-ink focus-visible:focus-ring-button"
        >
          &times;
        </button>
      ) : null}
    </span>
  );
}

export { Tag };
export type { TagProps };
