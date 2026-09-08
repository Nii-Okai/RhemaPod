"use client";

import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { SermonStatus } from "@/components/sermons/sermon-status";
import {
  rowMenuItems,
  type RowMenuAction,
} from "@/components/sermons/row-menu-items";

/* =============================================================================
   SermonRowMenu — the `···` cell on a Sermons-list row (W7).

   Items are status- and role-dependent (`rowMenuItems`, the design matrix).
   "Edit" is a real `next/link` to the editor route (`/sermons/[id]`,
   placeholder until W8); every other item calls back to the screen, which owns
   the optimistic mutation. The menu NEVER navigates on its own and never
   triggers the row click — the DataTable's actions cell stops propagation, and
   the trigger is a plain text glyph (design: no icon set).
   ========================================================================== */

export interface SermonRowMenuProps {
  sermonId: string;
  title: string;
  status: SermonStatus;
  role: string;
  /** Fired for every non-"edit" action. */
  onAction: (action: Exclude<RowMenuAction, "edit">) => void;
  /** Test seam — render the menu already open. */
  defaultOpen?: boolean;
}

export function SermonRowMenu({
  sermonId,
  title,
  status,
  role,
  onAction,
  defaultOpen,
}: SermonRowMenuProps) {
  const items = rowMenuItems(status, role);

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        aria-label={`Actions for ${title}`}
        className="flex h-[28px] w-[28px] items-center justify-center rounded-8 text-[16px] leading-none text-ink-faint outline-none transition-colors duration-[140ms] ease-out hover:bg-surface-sunken hover:text-ink focus-visible:focus-ring-button data-[state=open]:bg-surface-sunken data-[state=open]:text-ink"
      >
        <span aria-hidden>···</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {items.map((item) =>
          item.action === "edit" ? (
            <DropdownMenuItem key="edit" asChild>
              <Link href={`/sermons/${sermonId}`}>{item.label}</Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={item.action}
              disabled={item.disabled}
              title={item.title}
              destructive={item.destructive}
              onSelect={(event) => {
                if (item.disabled) {
                  event.preventDefault();
                  return;
                }
                onAction(item.action as Exclude<RowMenuAction, "edit">);
              }}
            >
              {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
