"use client";

import * as React from "react";
import { cn } from "cn";

import { RoleChip, roleVariants } from "@/components/portal/chips";
import { ROLE_LABEL, assignableRoles } from "@/lib/users/role-policy";
import type { UserPublic, UserRole } from "@/lib/query/hooks/use-users";

/* =============================================================================
   RoleCell — the Role column on Users & roles (design Screen 10).

   A **static chip** when the caller cannot change this row's role — their own
   account, or a manager looking at a manager/admin (plan §A.5 matrix, mirrored
   in `assignableRoles`). Otherwise an **inline `<select>`** styled to match the
   chip of the row's current role, so an admin changes a role in place. The
   change is optimistic; a rejected `_may_assign` 400 rolls it back and the
   screen shows the typed reason as a card-top alert (never a toast).

   The client gate here is for affordance only — FastAPI's `change_role` is the
   real guard, and a control shown in error still fails safely on the 400.

   The `<select>` stops `keydown` propagation (mirroring the DataTable's own
   `__actions` cell): the W6 row `<div>` attaches an unconditional handler that
   `preventDefault()`s Arrow/Home/End for row navigation, which would otherwise
   swallow every key the native option list needs — arrows to change the value,
   Home/End to jump, `Alt+ArrowDown` to open the listbox.
   ========================================================================== */

export interface RoleCellProps {
  row: UserPublic;
  /** The signed-in user — drives whether this row is editable. */
  actor: { id: string; role: string };
  /** A role change for THIS row is in flight. */
  pending: boolean;
  onChange: (role: UserRole) => void;
}

export function RoleCell({ row, actor, pending, onChange }: RoleCellProps) {
  const options = assignableRoles(actor, { id: row.id, role: row.role });

  if (options.length === 0) {
    return <RoleChip role={row.role} />;
  }

  return (
    <select
      aria-label={`Role for ${row.full_name?.trim() || row.email}`}
      value={row.role}
      disabled={pending}
      // Keep the DataTable row's Arrow/Home/End navigation handler from
      // intercepting (and `preventDefault()`-ing) keys meant for the native
      // option list. Same guard the `__actions` cell uses.
      onKeyDown={(event) => event.stopPropagation()}
      onChange={(event) => {
        const next = event.target.value as UserRole;
        if (next !== row.role) onChange(next);
      }}
      className={cn(
        roleVariants({ role: row.role }),
        "h-[26px] cursor-pointer appearance-none rounded-6 pr-[22px] outline-none focus-visible:focus-ring-button disabled:cursor-wait disabled:opacity-60",
        // A caret, drawn in CSS so the control needs no lucide import in a
        // row cell (README: lucide is banned outside primitives).
        "bg-[length:8px] bg-[position:right_8px_center] bg-no-repeat",
        "[background-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none' stroke='currentColor' stroke-width='1.5'><path d='M1 1l4 4 4-4'/></svg>\")]",
      )}
    >
      {options.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}
