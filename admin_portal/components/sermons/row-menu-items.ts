/**
 * The `···` row-menu matrix for the Sermons list (W7).
 *
 * Design "Row menu actions by status":
 *   Draft              → Edit · Submit for review · Delete
 *   Pending / Under review → Edit (locked) · Withdraw
 *   Published          → Edit · Unpublish
 *   Rejected           → Edit · Resubmit
 *   …never offer Publish/Unpublish to an Editor.
 *
 * Backend reality (`app/services/approval.py`, `app/api/*`):
 *   - "Submit" and "Resubmit" are the SAME endpoint — `POST /sermons/{id}/
 *     submit` — whose transition accepts both `draft` and `rejected`.
 *   - "Unpublish" / "Publish" exist only as ManagerPlus approval routes.
 *   - "Withdraw" HAS NO ENDPOINT and no transition in the state machine.
 *     → rendered disabled, with a title, and logged as [GATE 3 Batch 2].
 *   - `approved` / `unpublished` are real API statuses the design's matrix
 *     doesn't name. `approved` → Edit only. `unpublished` → Edit, plus
 *     Publish for a manager (the only legal transition out of it).
 *
 * Pure and total over `SermonStatus`; unit-tested.
 */

import type { SermonStatus } from "@/components/sermons/sermon-status";

export type RowMenuAction =
  | "edit"
  | "submit"
  | "resubmit"
  | "withdraw"
  | "unpublish"
  | "publish"
  | "delete";

export interface RowMenuItem {
  action: RowMenuAction;
  label: string;
  /** Non-actionable — no backend support yet. Renders greyed, with `title`. */
  disabled?: boolean;
  /** Hover hint, set on disabled items to explain why. */
  title?: string;
  /** Rose text (Delete, Unpublish). */
  destructive?: boolean;
}

const WITHDRAW_UNAVAILABLE =
  "Withdraw isn’t available yet — the approval state machine has no such transition (GATE 3 Batch 2).";

/** Menu items for a row, given its status and the signed-in user's role. */
export function rowMenuItems(
  status: SermonStatus,
  role: string,
): RowMenuItem[] {
  const isManager = role === "manager" || role === "admin";
  const locked = status === "pending_review" || status === "under_review";
  const edit: RowMenuItem = {
    action: "edit",
    label: locked ? "Edit (locked)" : "Edit",
  };

  switch (status) {
    case "draft":
      return [
        edit,
        { action: "submit", label: "Submit for review" },
        { action: "delete", label: "Delete", destructive: true },
      ];
    case "pending_review":
    case "under_review":
      return [
        edit,
        {
          action: "withdraw",
          label: "Withdraw",
          disabled: true,
          title: WITHDRAW_UNAVAILABLE,
        },
      ];
    case "rejected":
      return [edit, { action: "resubmit", label: "Resubmit" }];
    case "published":
      return isManager
        ? [
            edit,
            { action: "unpublish", label: "Unpublish", destructive: true },
          ]
        : [edit];
    case "unpublished":
      return isManager
        ? [edit, { action: "publish", label: "Publish" }]
        : [edit];
    case "approved":
      return [edit];
    default:
      return [edit];
  }
}
