/**
 * The "State" column value for a staff row (design Screen 10, plan W19).
 *
 * Three states, derived from two `UserPublic` fields the backend already
 * carries — no `invited_at` / `last_login_at` column (resolved decision 8):
 *
 *   deactivated  `is_active === false`         — the account is switched off
 *   pending      `activated_at == null`        — invite sent, password not set
 *   active       otherwise                     — a working account
 *
 * `deactivated` wins over `pending`: an invited-then-deactivated account is
 * primarily *off*, and its row menu offers Reactivate, so the badge that
 * matches the actionable state is "Deactivated". Pure and total — unit-tested.
 */

import type { UserPublic } from "@/lib/query/hooks/use-users";

export type UserState = "active" | "deactivated" | "pending";

export const USER_STATE_LABEL: Record<UserState, string> = {
  active: "Active",
  deactivated: "Deactivated",
  pending: "Invite pending",
};

export function userState(
  row: Pick<UserPublic, "is_active" | "activated_at">,
): UserState {
  if (!row.is_active) return "deactivated";
  if (row.activated_at == null) return "pending";
  return "active";
}
