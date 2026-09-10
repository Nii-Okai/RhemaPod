"use client";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  userRowMenuItems,
  type UserRowAction,
} from "@/components/users/row-menu-items";
import type { UserPublic } from "@/lib/query/hooks/use-users";

/* =============================================================================
   UserRowMenu — the `···` cell on a Users & roles row (W19).

   Same Radix dropdown pattern as the sermons / announcements row menus. Items
   are gated by `userRowMenuItems` (session role × target role × target state);
   when the caller can do nothing to this row the cell renders nothing at all
   rather than an empty trigger. Every item calls back to the screen, which
   owns the confirmation dialog (Deactivate), the mutations and the inline
   feedback. The trigger is a plain text glyph — design: no icon set.
   ========================================================================== */

export interface UserRowMenuProps {
  user: UserPublic;
  /** The signed-in user — drives which actions are offered. */
  actor: { id: string; role: string };
  /** Active admins visible in the loaded list — the last-admin client gate. */
  activeAdminCount: number;
  /** Fired for every enabled action. */
  onAction: (action: UserRowAction) => void;
  /** A lifecycle mutation for THIS row is in flight — disable the menu so a
      second action can't race the first. */
  busy?: boolean;
  /** Test seam — render the menu already open. Inert outside the test env. */
  defaultOpen?: boolean;
}

export function UserRowMenu({
  user,
  actor,
  activeAdminCount,
  onAction,
  busy = false,
  defaultOpen,
}: UserRowMenuProps) {
  const items = userRowMenuItems({ actor, target: user, activeAdminCount });
  if (items.length === 0) return null;

  const name = user.full_name?.trim() || user.email;

  return (
    <DropdownMenu
      defaultOpen={process.env.NODE_ENV === "test" ? defaultOpen : undefined}
    >
      <DropdownMenuTrigger
        aria-label={`Actions for ${name}`}
        className="flex h-[28px] w-[28px] items-center justify-center rounded-8 text-[16px] leading-none text-ink-faint outline-none transition-colors duration-[140ms] ease-out hover:bg-surface-sunken hover:text-ink focus-visible:focus-ring-button data-[state=open]:bg-surface-sunken data-[state=open]:text-ink"
      >
        <span aria-hidden>···</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.action}
            disabled={busy}
            title={
              busy
                ? "Please wait — the previous action is still running."
                : undefined
            }
            destructive={item.destructive}
            onSelect={(event) => {
              if (busy) {
                event.preventDefault();
                return;
              }
              onAction(item.action);
            }}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
