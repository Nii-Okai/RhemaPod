"use client";

import * as React from "react";
import { DropdownMenu as RDM } from "radix-ui";
import { cn } from "cn";

/* =============================================================================
   DropdownMenu — RhemaPod UI Kit primitive (W7). Restyled Radix.

   The `···` row menu (design Screen 3) and, later, the speakers / users menus.
   Radix owns the hard parts the design's Accessibility section demands —
   keyboard reachability, focus trap + return, type-ahead, `role="menu"` /
   `menuitem` semantics; this file is only the skin.

   Visual: white surface, radius 11, `border`, `shadow-toast`; items 34px tall,
   radius 8, 13.5px, `data-[highlighted]` → `surface-sunken`, `data-[disabled]`
   → `ink-faint` + `not-allowed`. A `destructive` item is rose text. Motion is
   a single 120ms ease-out fade/scale (`rp-menu-in` keyframe in globals.css) —
   the design's "120–160ms ease-out on opacity", nothing more. No icons: the
   trigger glyph is text (`···`), per the design's no-icon-set rule.
   ========================================================================== */

const DropdownMenu = RDM.Root;
const DropdownMenuTrigger = RDM.Trigger;
const DropdownMenuGroup = RDM.Group;

function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: React.ComponentProps<typeof RDM.Content>) {
  return (
    <RDM.Portal>
      <RDM.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 min-w-[180px] rounded-11 border border-border bg-surface p-6 shadow-toast",
          "origin-[var(--radix-dropdown-menu-content-transform-origin)]",
          "data-[state=open]:animate-[rp-menu-in_120ms_ease-out]",
          className,
        )}
        {...props}
      />
    </RDM.Portal>
  );
}

type DropdownMenuItemProps = React.ComponentProps<typeof RDM.Item> & {
  destructive?: boolean;
};

function DropdownMenuItem({
  className,
  destructive,
  ...props
}: DropdownMenuItemProps) {
  return (
    <RDM.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex h-[34px] cursor-pointer select-none items-center rounded-8 px-10 text-[13.5px] outline-none",
        "transition-colors duration-[140ms] ease-out",
        "data-[highlighted]:bg-surface-sunken",
        "data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-faint data-[disabled]:data-[highlighted]:bg-transparent",
        destructive
          ? "text-rose data-[highlighted]:bg-rose-bg"
          : "text-ink",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof RDM.Separator>) {
  return (
    <RDM.Separator
      className={cn("my-6 h-px bg-border-subtle", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
};
