"use client";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { AnnouncementStatus } from "@/components/announcements/announcement-status";
import {
  announcementRowMenuItems,
  type AnnouncementRowAction,
} from "@/components/announcements/row-menu-items";

/* =============================================================================
   AnnouncementRowMenu — the `···` cell on an Announcements-list row (W13).

   Items are status- and role-dependent (`announcementRowMenuItems`). Unlike the
   Sermons menu, "Edit" is NOT navigation — the editor is an inline panel, so
   every item (Edit included) calls back to the screen. The menu never triggers
   the row click (the DataTable's actions cell stops propagation) and the
   trigger is a plain text glyph (design: no icon set).
   ========================================================================== */

export interface AnnouncementRowMenuProps {
  title: string;
  status: AnnouncementStatus;
  role: string;
  /** Fired for every enabled action, including "edit". */
  onAction: (action: AnnouncementRowAction) => void;
  /** A workflow mutation for THIS row is in flight — disable the menu so a
      second action can't race the first. */
  busy?: boolean;
  /** Test seam — render the menu already open. Inert outside the test env. */
  defaultOpen?: boolean;
}

export function AnnouncementRowMenu({
  title,
  status,
  role,
  onAction,
  busy = false,
  defaultOpen,
}: AnnouncementRowMenuProps) {
  const items = announcementRowMenuItems(status, role);

  return (
    <DropdownMenu
      defaultOpen={process.env.NODE_ENV === "test" ? defaultOpen : undefined}
    >
      <DropdownMenuTrigger
        aria-label={`Actions for ${title}`}
        className="flex h-[28px] w-[28px] items-center justify-center rounded-8 text-[16px] leading-none text-ink-faint outline-none transition-colors duration-[140ms] ease-out hover:bg-surface-sunken hover:text-ink focus-visible:focus-ring-button data-[state=open]:bg-surface-sunken data-[state=open]:text-ink"
      >
        <span aria-hidden>···</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {items.map((item) => {
          const itemDisabled = item.disabled || busy;
          return (
            <DropdownMenuItem
              key={item.action + item.label}
              disabled={itemDisabled}
              title={
                busy && !item.disabled
                  ? "Please wait — the previous action is still running."
                  : item.title
              }
              destructive={item.destructive}
              onSelect={(event) => {
                if (itemDisabled) {
                  event.preventDefault();
                  return;
                }
                onAction(item.action);
              }}
            >
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
