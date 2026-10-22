import { describe, expect, it } from "vitest";

import { rowMenuItems } from "@/components/sermons/row-menu-items";
import type { SermonStatus } from "@/components/sermons/sermon-status";

/* W7 — the `···` row-menu matrix (design "Row menu actions by status"). Pure
   status/role → items. The rendered menu is covered in the dom project; this
   locks the matrix itself, including the two backend-shaped rules:
   "never offer Publish/Unpublish to an Editor" and "an Editor can't
   withdraw once a manager has started the review". */

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

  it("pending_review → Edit (locked) · Withdraw, enabled for every role", () => {
    for (const role of ["editor", "manager", "admin"]) {
      const items = rowMenuItems("pending_review", role);
      expect(items.map((i) => i.label)).toEqual(["Edit (locked)", "Withdraw"]);
      expect(items.find((i) => i.action === "withdraw")!.disabled).toBeFalsy();
    }
  });

  it("under_review → Withdraw disabled for an editor, enabled for a manager", () => {
    const editor = rowMenuItems("under_review", "editor");
    expect(editor.map((i) => i.label)).toEqual(["Edit (locked)", "Withdraw"]);
    const withdraw = editor.find((i) => i.action === "withdraw")!;
    expect(withdraw.disabled).toBe(true);
    expect(withdraw.title).toMatch(/manager is reviewing/);

    const manager = rowMenuItems("under_review", "manager");
    expect(manager.find((i) => i.action === "withdraw")!.disabled).toBeFalsy();
  });

  it("rejected → Edit · Resubmit", () => {
    expect(labels("rejected", "editor")).toEqual(["Edit", "Resubmit"]);
  });

  it("published → Unpublish for a manager, never for an editor", () => {
    expect(labels("published", "editor")).toEqual(["Edit (locked)"]);
    expect(labels("published", "manager")).toEqual(["Edit (locked)", "Unpublish"]);
    expect(labels("published", "admin")).toEqual(["Edit (locked)", "Unpublish"]);
  });

  it("unpublished → Publish for a manager, never for an editor", () => {
    expect(labels("unpublished", "editor")).toEqual(["Edit"]);
    expect(labels("unpublished", "manager")).toEqual(["Edit", "Publish"]);
  });

  it("approved → locked Edit, plus Publish for a manager", () => {
    expect(labels("approved", "editor")).toEqual(["Edit (locked)"]);
    expect(labels("approved", "manager")).toEqual(["Edit (locked)", "Publish"]);
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
