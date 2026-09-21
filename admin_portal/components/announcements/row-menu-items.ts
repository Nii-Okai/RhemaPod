/**
 * The `···` row-menu matrix for the Announcements list (W13).
 *
 * Status- and role-appropriate, mapped to the backend transitions
 * (`app/services/approval.py::ANNOUNCEMENT_TRANSITIONS`,
 * `app/api/announcements.py`, `app/api/announcement_approval.py`):
 *
 *   draft            → Edit · Submit for review · Delete
 *   rejected         → Edit · Delete            (resubmit lives on the editor
 *                                                panel's primary button)
 *   pending_review   → (manager) Approve · Reject · Edit · Delete
 *                      (editor)  Edit (locked)
 *   approved         → (manager) Publish · Edit · Delete
 *                      (editor)  Edit (locked)
 *   published        → (manager) Unpublish · Edit · Archive
 *                      (editor)  Edit (locked)
 *   archived         → (manager) Publish · Edit · Delete
 *                      (editor)  Edit (locked)
 *
 * "Edit" selects the row into the editor panel — the same as a row click; it is
 * kept in the menu as an explicit affordance. Editors only ever see their OWN
 * announcements (server-enforced) and cannot edit one past `draft` / `rejected`
 * (`_load_editable` 409s), so their menu on a locked row is a single disabled
 * "Edit (locked)".
 *
 * Pure and total over `AnnouncementStatus`; unit-tested.
 */

import type { AnnouncementStatus } from "@/components/announcements/announcement-status";

export type AnnouncementRowAction =
  | "edit"
  | "submit"
  | "approve"
  | "reject"
  | "publish"
  | "unpublish"
  | "archive"
  | "delete";

export interface AnnouncementRowMenuItem {
  action: AnnouncementRowAction;
  label: string;
  /** Non-actionable — greyed, with a `title`. */
  disabled?: boolean;
  title?: string;
  /** Rose text (Delete, Unpublish). */
  destructive?: boolean;
}

const LOCKED_EDIT: AnnouncementRowMenuItem = {
  action: "edit",
  label: "Edit (locked)",
  disabled: true,
  title: "This announcement is past draft — a manager can still edit it.",
};
const EDIT: AnnouncementRowMenuItem = { action: "edit", label: "Edit" };

export function announcementRowMenuItems(
  status: AnnouncementStatus,
  role: string,
): AnnouncementRowMenuItem[] {
  const isManager = role === "manager" || role === "admin";

  switch (status) {
    case "draft":
      return [
        EDIT,
        { action: "submit", label: "Submit for review" },
        { action: "delete", label: "Delete", destructive: true },
      ];
    case "rejected":
      return [EDIT, { action: "delete", label: "Delete", destructive: true }];
    case "pending_review":
      return isManager
        ? [
            { action: "approve", label: "Approve" },
            { action: "reject", label: "Reject" },
            EDIT,
            { action: "delete", label: "Delete", destructive: true },
          ]
        : [LOCKED_EDIT];
    case "approved":
      return isManager
        ? [
            { action: "publish", label: "Publish" },
            EDIT,
            { action: "delete", label: "Delete", destructive: true },
          ]
        : [LOCKED_EDIT];
    case "published":
      return isManager
        ? [
            { action: "unpublish", label: "Unpublish", destructive: true },
            EDIT,
            { action: "archive", label: "Archive" },
          ]
        : [LOCKED_EDIT];
    case "archived":
      return isManager
        ? [
            { action: "publish", label: "Publish" },
            EDIT,
            { action: "delete", label: "Delete", destructive: true },
          ]
        : [LOCKED_EDIT];
    default:
      return [EDIT];
  }
}
