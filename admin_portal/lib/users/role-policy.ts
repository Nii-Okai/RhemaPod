/**
 * Client-side mirror of the backend role-assignment matrix (W17).
 *
 * `app/services/auth_service.py` owns the real rules — `_ASSIGNABLE_BY`, the
 * self-demotion block, and "a manager may not modify an existing manager/admin".
 * `change_role` / `create_staff` enforce them and answer a violation with a
 * typed 400. This module reproduces the same logic so the UI can *hide* a
 * control the caller could never use (a manager on an admin row, your own row):
 * a client gate for affordance only, never the guard. If the two ever drift,
 * the backend 400 still wins and surfaces as a card-top alert.
 */

import type { components } from "@/lib/api/schema";

export type UserRole = components["schemas"]["UserRole"];

/** The three staff roles, in ascending privilege order. Never includes
    `viewer` — viewers are not staff and never appear on this screen. */
export const STAFF_ROLES = ["editor", "manager", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Human label for each staff role. Single source shared by the inline
    `RoleCell` `<select>` and the invite dialog (W19's row menu is the third
    consumer) — keep it here so the three never drift. */
export const ROLE_LABEL: Record<StaffRole, string> = {
  editor: "Editor",
  manager: "Manager",
  admin: "Admin",
};

/** Mirror of `auth_service._ASSIGNABLE_BY`: which roles an actor may hand out,
    whether by invite (`create_staff`) or by an inline change (`change_role`). */
const ASSIGNABLE_BY: Record<string, readonly StaffRole[]> = {
  manager: ["editor"],
  admin: ["editor", "manager", "admin"],
};

/** Roles the actor may invite a *new* account into — the invite dialog's role
    options. A manager can only create editors; an editor/viewer can create
    nobody (and never reaches this screen anyway). */
export function creatableRoles(actorRole: string): StaffRole[] {
  return [...(ASSIGNABLE_BY[actorRole] ?? [])];
}

/**
 * The role `<select>` options for one row's inline change, or `[]` when the
 * caller cannot change that row's role at all (render a static chip instead).
 *
 * `[]` when, mirroring `change_role`:
 *  - the row is the caller's own account (self-demotion is blocked);
 *  - the caller is a manager and the row is a manager or an admin;
 *  - the only role the caller could assign is the one the row already has
 *    (a manager on an editor row — the assignable set is just `editor`).
 *
 * Otherwise: the staff roles the caller may assign, always including the row's
 * current role so the `<select>` can show it as the selected value.
 */
export function assignableRoles(
  actor: { id: string; role: string },
  target: { id: string; role: string },
): StaffRole[] {
  if (actor.id === target.id) return [];
  if (
    actor.role === "manager" &&
    (target.role === "manager" || target.role === "admin")
  ) {
    return [];
  }
  const can = creatableRoles(actor.role);
  const options = STAFF_ROLES.filter(
    (r) => can.includes(r) || r === target.role,
  );
  const hasAlternative = options.some((r) => r !== target.role);
  return hasAlternative ? options : [];
}
