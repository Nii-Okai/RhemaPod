import { describe, expect, it } from "vitest";

import { announcementRowMenuItems } from "@/components/announcements/row-menu-items";
import type { AnnouncementStatus } from "@/components/announcements/announcement-status";

/* W13 — the `···` row-menu matrix. Pure status/role → items. The list's row
   menu is the single manager surface for announcement approvals, so this locks
   every transition it must offer, and that an editor never sees a manager
   action (or an Edit on a locked row). */

const labels = (
  status: AnnouncementStatus,
  role: string,
  isOwnContent = false,
) => announcementRowMenuItems(status, role, isOwnContent).map((i) => i.label);

describe("announcementRowMenuItems", () => {
  it("draft → Edit · Submit for review · Delete (any role)", () => {
    for (const role of ["editor", "manager", "admin"]) {
      expect(labels("draft", role)).toEqual([
        "Edit",
        "Submit for review",
        "Delete",
      ]);
    }
  });

  it("rejected → Edit · Delete (resubmit lives on the panel)", () => {
    expect(labels("rejected", "editor")).toEqual(["Edit", "Delete"]);
    expect(labels("rejected", "manager")).toEqual(["Edit", "Delete"]);
  });

  it("pending_review → Approve · Reject · Edit · Delete for a manager", () => {
    expect(labels("pending_review", "manager")).toEqual([
      "Approve",
      "Reject",
      "Edit",
      "Delete",
    ]);
    expect(labels("pending_review", "admin")).toEqual([
      "Approve",
      "Reject",
      "Edit",
      "Delete",
    ]);
  });

  it("approved → Publish · Edit · Delete for a manager", () => {
    expect(labels("approved", "manager")).toEqual([
      "Publish",
      "Edit",
      "Delete",
    ]);
  });

  it("published → Unpublish · Edit · Archive for a manager", () => {
    expect(labels("published", "manager")).toEqual([
      "Unpublish",
      "Edit",
      "Archive",
    ]);
  });

  it("archived → Publish · Edit · Delete for a manager", () => {
    expect(labels("archived", "manager")).toEqual(["Publish", "Edit", "Delete"]);
  });

  it("an editor gets only a disabled Edit on any non-draft/rejected row", () => {
    for (const status of [
      "pending_review",
      "approved",
      "published",
      "archived",
    ] as AnnouncementStatus[]) {
      const items = announcementRowMenuItems(status, "editor");
      expect(items).toHaveLength(1);
      expect(items[0].action).toBe("edit");
      expect(items[0].disabled).toBe(true);
      expect(items[0].label).toBe("Edit (locked)");
    }
  });

  it("pending_review, own content, manager (not admin) → Approve is locked; Reject/Edit/Delete stay live", () => {
    const items = announcementRowMenuItems("pending_review", "manager", true);
    expect(items.map((i) => i.action)).toEqual([
      "approve",
      "reject",
      "edit",
      "delete",
    ]);
    const approve = items[0];
    expect(approve.label).toBe("Approve");
    expect(approve.disabled).toBe(true);
    expect(approve.title).toBe(
      "You submitted this — another manager needs to review it.",
    );
    expect(items[1].disabled).toBeFalsy();
  });

  it("pending_review, own content, admin → unaffected, Approve stays live", () => {
    const items = announcementRowMenuItems("pending_review", "admin", true);
    expect(items.find((i) => i.action === "approve")?.disabled).toBeFalsy();
  });

  it("pending_review, NOT own content, manager → Approve stays live", () => {
    const items = announcementRowMenuItems("pending_review", "manager", false);
    expect(items.find((i) => i.action === "approve")?.disabled).toBeFalsy();
  });

  it("marks Delete and Unpublish destructive", () => {
    expect(
      announcementRowMenuItems("draft", "editor").find(
        (i) => i.action === "delete",
      )?.destructive,
    ).toBe(true);
    expect(
      announcementRowMenuItems("published", "manager").find(
        (i) => i.action === "unpublish",
      )?.destructive,
    ).toBe(true);
    expect(
      announcementRowMenuItems("pending_review", "manager").find(
        (i) => i.action === "delete",
      )?.destructive,
    ).toBe(true);
    expect(
      announcementRowMenuItems("approved", "manager").find(
        (i) => i.action === "delete",
      )?.destructive,
    ).toBe(true);
  });
});
