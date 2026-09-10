import { describe, expect, it } from "vitest";

import {
  latestRejectionNote,
  type ApprovalLogItem,
} from "@/lib/dashboard/rejection-note";

/* W23 — pull the newest rejection note out of a sermon's approval log for the
   WIP "Rejected" tile (plan §A.1, the accepted N+1). */

const entry = (over: Partial<ApprovalLogItem>): ApprovalLogItem => ({
  actor_id: "a-1",
  actor_name: null,
  from_status: "under_review",
  to_status: "rejected",
  note: null,
  created_at: "2026-09-01T10:00:00Z",
  ...over,
});

describe("latestRejectionNote", () => {
  it("returns the note from the most recent rejection", () => {
    const log = [
      entry({ note: "Fix the intro levels", created_at: "2026-09-01T10:00:00Z" }),
      entry({ note: "Audio still clips at 12:40", created_at: "2026-09-08T09:00:00Z" }),
    ];
    expect(latestRejectionNote(log)).toBe("Audio still clips at 12:40");
  });

  it("ignores non-rejection transitions and blank notes", () => {
    const log = [
      entry({ to_status: "under_review", note: "picked up for review" }),
      entry({ to_status: "rejected", note: "   " }),
      entry({ to_status: "rejected", note: "Needs a scripture reference", created_at: "2026-09-05T09:00:00Z" }),
    ];
    expect(latestRejectionNote(log)).toBe("Needs a scripture reference");
  });

  it("is null for an empty, undefined, or note-less log", () => {
    expect(latestRejectionNote(undefined)).toBeNull();
    expect(latestRejectionNote([])).toBeNull();
    expect(latestRejectionNote([entry({ note: null })])).toBeNull();
  });
});
