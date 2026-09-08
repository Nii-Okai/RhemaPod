import { describe, expect, it } from "vitest";

import { rowMenuItems } from "@/components/sermons/row-menu-items";
import type { SermonStatus } from "@/components/sermons/sermon-status";

/* W7 — the `···` row-menu matrix (design "Row menu actions by status"). Pure
   status/role → items. The rendered menu is covered in the dom project; this
   locks the matrix itself, including the two backend-shaped rules:
   "never offer Publish/Unpublish to an Editor" and "Withdraw is disabled
   (no backend transition — GATE 3 Batch 2)". */

const labels = (status: SermonStatus, role: string) =>
  rowMenuItems(status, role).map((item) => item.label);

describe("rowMenuItems", () => {
  it("draft → Edit · Submit for review · Delete (any role)", () => {
    for (const role of ["editor", "manager", "admin"]) {
      expect(labels("draft", role)).toEqual([
        "Edit",
        "Submit for review",
        "Delete",
      ]);
    }
  });

  it("pending_review / under_review → Edit (locked) · Withdraw, disabled", () => {
    for (const status of ["pending_review", "under_review"] as SermonStatus[]) {
      const items = rowMenuItems(status, "editor");
      expect(items.map((i) => i.label)).toEqual(["Edit (locked)", "Withdraw"]);
      const withdraw = items.find((i) => i.action === "withdraw")!;
      expect(withdraw.disabled).toBe(true);
      expect(withdraw.title).toMatch(/GATE 3 Batch 2/);
    }
  });

  it("rejected → Edit · Resubmit", () => {
    expect(labels("rejected", "editor")).toEqual(["Edit", "Resubmit"]);
  });

  it("published → Unpublish for a manager, never for an editor", () => {
    expect(labels("published", "editor")).toEqual(["Edit"]);
    expect(labels("published", "manager")).toEqual(["Edit", "Unpublish"]);
    expect(labels("published", "admin")).toEqual(["Edit", "Unpublish"]);
  });

  it("unpublished → Publish for a manager, never for an editor", () => {
    expect(labels("unpublished", "editor")).toEqual(["Edit"]);
    expect(labels("unpublished", "manager")).toEqual(["Edit", "Publish"]);
  });

  it("approved → Edit only (design matrix is silent on it)", () => {
    expect(labels("approved", "manager")).toEqual(["Edit"]);
  });

  it("marks Delete and Unpublish destructive", () => {
    expect(
      rowMenuItems("draft", "editor").find((i) => i.action === "delete")
        ?.destructive,
    ).toBe(true);
    expect(
      rowMenuItems("published", "manager").find((i) => i.action === "unpublish")
        ?.destructive,
    ).toBe(true);
  });
});
