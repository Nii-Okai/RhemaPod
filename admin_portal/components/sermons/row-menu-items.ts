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
 *   - "Withdraw" is `POST /sermons/{id}/withdraw` (→ draft). An editor may
 *     withdraw only from `pending_review`; once a manager has picked it up
 *     (`under_review`) the backend 409s them, so the item is disabled with
 *     the reason. A manager/admin may withdraw from either.
 *   - `approved` and `published` are content-locked server-side (PATCH 409),
 *     so their Edit reads "(locked)". `approved` also offers Publish to a
 *     manager — the step that's left. `unpublished` → Edit, plus Publish for
 *     a manager; editing it sends it back to draft for another review.
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

const WITHDRAW_IN_REVIEW =
  "A manager is reviewing this — ask them to send it back.";

/** Menu items for a row, given its status and the signed-in user's role. */
export function rowMenuItems(
  status: SermonStatus,
  role: string,
): RowMenuItem[] {
  const isManager = role === "manager" || role === "admin";
  const locked =
    status === "pending_review" ||
    status === "under_review" ||
    status === "approved" ||
    status === "published";
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
      return [edit, { action: "withdraw", label: "Withdraw" }];
    case "under_review":
      return [
        edit,
        isManager
          ? { action: "withdraw", label: "Withdraw" }
          : {
              action: "withdraw",
              label: "Withdraw",
              disabled: true,
              title: WITHDRAW_IN_REVIEW,
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
      return isManager
        ? [edit, { action: "publish", label: "Publish" }]
        : [edit];
    default:
      return [edit];
  }
}
