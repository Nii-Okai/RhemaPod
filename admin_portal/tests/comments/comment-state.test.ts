import { describe, expect, it } from "vitest";

import {
  availableActions,
  commentStateOf,
  formatRelative,
} from "@/components/comments/comment-state";
import { validateReason } from "@/components/comments/comment-reason-dialog";
import {
  authorEmailOf,
  moderationErrorMessage,
  toCommentSort,
  toCommentView,
} from "@/lib/query/hooks/use-admin-comments";
import { ApiError } from "@/lib/api/errors";

const visible = { status: "VISIBLE", report_count: 0 } as const;
const reported = { status: "VISIBLE", report_count: 2 } as const;
const hidden = { status: "HIDDEN", report_count: 2 } as const;

describe("commentStateOf", () => {
  it("maps status, hidden_auto and report_count to the four chips", () => {
    expect(commentStateOf({ ...visible, hidden_auto: false })).toBe("visible");
    expect(commentStateOf({ ...reported, hidden_auto: false })).toBe("reported");
    expect(commentStateOf({ ...hidden, hidden_auto: true })).toBe("auto_hidden");
    expect(commentStateOf({ ...hidden, hidden_auto: false })).toBe("hidden");
  });
});

describe("availableActions — cosmetic role gating", () => {
  it("gives an EDITOR nothing", () => {
    expect(availableActions(reported, "editor")).toEqual([]);
    expect(availableActions(hidden, "editor")).toEqual([]);
    expect(availableActions(reported, "viewer")).toEqual([]);
  });

  it("gives a MANAGER hide + dismiss on a reported visible comment, never delete", () => {
    expect(availableActions(reported, "manager")).toEqual(["hide", "dismiss"]);
    expect(availableActions(visible, "manager")).toEqual(["hide"]);
    expect(availableActions(hidden, "manager")).toEqual(["restore"]);
  });

  it("adds delete for an ADMIN only", () => {
    expect(availableActions(reported, "admin")).toEqual([
      "hide",
      "dismiss",
      "delete",
    ]);
    expect(availableActions(hidden, "admin")).toEqual(["restore", "delete"]);
  });
});

describe("validateReason", () => {
  it("requires a non-blank reason", () => {
    expect(validateReason("")).toBe("Add a reason to continue.");
    expect(validateReason("   \n ")).toBe("Add a reason to continue.");
    expect(validateReason(" spam ")).toBeNull();
  });

  it("caps at 300 characters after trimming", () => {
    expect(validateReason("a".repeat(300))).toBeNull();
    expect(validateReason(`  ${"a".repeat(300)}  `)).toBeNull();
    expect(validateReason("a".repeat(301))).toMatch(/300 characters/);
  });
});

describe("url param parsing", () => {
  it("defaults the view to reported and the sort to most_reported", () => {
    expect(toCommentView(null)).toBe("reported");
    expect(toCommentView("junk")).toBe("reported");
    expect(toCommentView("hidden")).toBe("hidden");
    expect(toCommentView("all")).toBe("all");
    expect(toCommentSort(null)).toBe("most_reported");
    expect(toCommentSort("recent")).toBe("recent");
  });
});

describe("authorEmailOf", () => {
  it("is null for the EDITOR shape, present for MANAGER/ADMIN", () => {
    const base = {
      author_display_name: "Nii O.",
      body: "x",
      created_at: "2026-10-01T00:00:00Z",
      hidden_auto: false,
      id: "c",
      is_mine: false,
      report_count: 0,
      sermon_id: "s",
      sermon_title: "t",
      status: "VISIBLE" as const,
    };
    expect(authorEmailOf(base)).toBeNull();
    expect(
      authorEmailOf({ ...base, author_email: "a@b.co", author_id: "u" }),
    ).toBe("a@b.co");
  });
});

describe("moderationErrorMessage", () => {
  const err = (status: number) =>
    new ApiError(status, { detail: "x", correlation_id: null });

  it("explains 403, 404 and 409 and falls back for anything else", () => {
    expect(moderationErrorMessage(err(403), "hide")).toMatch(/permission/);
    expect(moderationErrorMessage(err(404), "hide")).toMatch(/no longer exists/);
    expect(moderationErrorMessage(err(409), "dismiss")).toMatch(/is hidden/);
    expect(moderationErrorMessage(err(409), "hide")).toMatch(/changed/);
    expect(moderationErrorMessage(err(500), "hide")).toMatch(/Try again/);
    expect(moderationErrorMessage(new Error("net"), "hide")).toMatch(
      /Try again/,
    );
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  it("buckets by magnitude", () => {
    expect(formatRelative("2026-10-02T11:59:50Z", now)).toBe("just now");
    expect(formatRelative("2026-10-02T11:30:00Z", now)).toBe("30m ago");
    expect(formatRelative("2026-10-02T07:00:00Z", now)).toBe("5h ago");
    expect(formatRelative("2026-09-29T12:00:00Z", now)).toBe("3d ago");
    expect(formatRelative("garbage", now)).toBe("garbage");
  });
});
