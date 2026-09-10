/**
 * The `···` row-menu matrix for the Users & roles list (design Screen 10, W19).
 *
 * Gated by (session role × target role × target state), mirroring the backend
 * guards on `PATCH /users/{id}/active` and `POST /users/{id}/resend-invite`
 * (`auth_service.set_active` / `resend_invite`, both keyed on `_ASSIGNABLE_BY`):
 *
 *   caller \ target   editor           manager / admin
 *   manager           may act          — (403)      → no menu
 *   admin             may act          may act
 *
 * State then decides the verbs:
 *
 *   active     → Deactivate            (destructive; confirmation dialog)
 *   deactivated→ Reactivate            (constructive; no dialog)
 *   pending    → + Resend invite       (`activated_at == null`, any active state)
 *
 * A client gate for affordance only — the backend is the real guard and a
 * slipped-through 403 surfaces as the card-top alert. Two deliberate client
 * gates beyond the 403 mirror:
 *
 *  - the caller's OWN row gets no lifecycle actions (you don't switch your own
 *    account off from the directory — the break-glass path is the API /
 *    `create-admin`), mirroring the self-demotion block on role change;
 *  - the last active admin gets no Deactivate. `activeAdminCount` is counted
 *    from the loaded page, so on a multi-page directory this can be wrong — the
 *    backend's 409 (`last_admin`) is the real invariant and the screen renders
 *    it as an explanatory inline message.
 *
 * Pure and total; unit-tested.
 */

import type { UserPublic } from "@/lib/query/hooks/use-users";

export type UserRowAction = "deactivate" | "reactivate" | "resend-invite";

export interface UserRowMenuItem {
  action: UserRowAction;
  label: string;
  /** Rose text (Deactivate). */
  destructive?: boolean;
}

const CAN_ACT_ON: Record<string, readonly string[]> = {
  manager: ["editor"],
  admin: ["editor", "manager", "admin"],
};

export interface UserRowMenuArgs {
  actor: { id: string; role: string };
  target: Pick<UserPublic, "id" | "role" | "is_active" | "activated_at">;
  /** Active admins visible in the loaded list — the last-admin client gate. */
  activeAdminCount: number;
}

export function userRowMenuItems({
  actor,
  target,
  activeAdminCount,
}: UserRowMenuArgs): UserRowMenuItem[] {
  // No lifecycle actions on your own row.
  if (actor.id === target.id) return [];

  const mayAct = (CAN_ACT_ON[actor.role] ?? []).includes(target.role);
  if (!mayAct) return [];

  const items: UserRowMenuItem[] = [];

  if (target.is_active) {
    const isLastActiveAdmin =
      target.role === "admin" && activeAdminCount <= 1;
    if (!isLastActiveAdmin) {
      items.push({
        action: "deactivate",
        label: "Deactivate",
        destructive: true,
      });
    }
  } else {
    items.push({ action: "reactivate", label: "Reactivate" });
  }

  if (target.activated_at == null) {
    items.push({ action: "resend-invite", label: "Resend invite" });
  }

  return items;
}
