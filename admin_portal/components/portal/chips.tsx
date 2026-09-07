import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/* =============================================================================
   TierChip / RoleChip — RhemaPod UI Kit primitives (W2).
   Spec: README §"TierChip / RoleChip" + RhemaPod UI Kit.dc.html §05.
   height 24, radius 6, 12/600, letter-spacing .02em.
   ========================================================================== */

const chipBase =
  "inline-flex h-[24px] w-fit items-center rounded-6 px-10 text-[12px] font-semibold tracking-[0.02em]";

// ---- Tier -------------------------------------------------------------------
const tierVariants = cva(chipBase, {
  variants: {
    tier: {
      free: "bg-neutral-badge text-ink-soft",
      paid: "bg-clay-100 text-clay-700",
    },
  },
  defaultVariants: { tier: "free" },
});

type TierChipProps = React.ComponentProps<"span"> &
  VariantProps<typeof tierVariants> & { label?: string };

function TierChip({ tier = "free", label, className, ...props }: TierChipProps) {
  return (
    <span
      data-slot="tier-chip"
      className={cn(tierVariants({ tier }), className)}
      {...props}
    >
      {label ?? (tier === "paid" ? "PAID" : "FREE")}
    </span>
  );
}

// ---- Role -----------------------------------------------------------------
const roleVariants = cva(chipBase, {
  variants: {
    role: {
      viewer: "border border-border-strong text-ink-soft",
      // sage outline — the UI Kit's exact hexes are the alert-success tokens.
      editor: "border border-alert-success-border bg-alert-success-bg text-sage-text",
      // slate outline — UI Kit HTML uses #F1F5FA fill / #C7D6E5 border, which
      // have no token; slate-tint + slate-text is the token-faithful reading of
      // "Manager = slate outline chip".
      manager: "border border-slate-text bg-slate-tint text-slate-text",
      admin: "bg-dark text-canvas",
    },
  },
  defaultVariants: { role: "viewer" },
});

const ROLE_LABEL = {
  viewer: "Viewer",
  editor: "Editor",
  manager: "Manager",
  admin: "Admin",
} as const;

type RoleChipProps = React.ComponentProps<"span"> &
  VariantProps<typeof roleVariants> & { label?: string };

function RoleChip({ role = "viewer", label, className, ...props }: RoleChipProps) {
  return (
    <span
      data-slot="role-chip"
      className={cn(roleVariants({ role }), className)}
      {...props}
    >
      {label ?? ROLE_LABEL[role ?? "viewer"]}
    </span>
  );
}

export { TierChip, RoleChip, tierVariants, roleVariants };
export type { TierChipProps, RoleChipProps };
