import { describe, expect, it } from "vitest";

import {
  toTimeline,
  type ApprovalLogItem,
} from "@/lib/query/hooks/use-approval-log";

/* `toTimeline` is the pure seam between the backend's ascending
   `ApprovalLogItem[]` and the design's newest-first timeline (W8). */

const row = (
  to_status: string,
  created_at: string,
  note: string | null = null,
): ApprovalLogItem => ({
  from_status: "draft",
  to_status,
  actor_id: "00000000-0000-0000-0000-000000000001",
  note,
  created_at,
});

describe("toTimeline", () => {
  it("orders ascending history newest-first", () => {
    const entries = toTimeline([
      row("pending_review", "2026-09-01T10:00:00Z"),
      row("under_review", "2026-09-02T10:00:00Z"),
      row("rejected", "2026-09-03T10:00:00Z"),
    ]);
    expect(entries.map((e) => e.headline)).toEqual([
      "Rejected",
      "Review started",
      "Submitted for review",
    ]);
  });

  it("sorts by created_at descending, not by array order", () => {
    // Backend hands them back shuffled — the timeline must still be newest-first.
    const entries = toTimeline([
      row("under_review", "2026-09-02T10:00:00Z"),
      row("rejected", "2026-09-03T10:00:00Z"),
      row("pending_review", "2026-09-01T10:00:00Z"),
    ]);
    expect(entries.map((e) => e.timestamp)).toEqual([
      "2026-09-03T10:00:00Z",
      "2026-09-02T10:00:00Z",
      "2026-09-01T10:00:00Z",
    ]);
  });

  it("maps status → headline + dot tone and carries the note verbatim", () => {
    const [rejected] = toTimeline([
      row(
        "rejected",
        "2026-09-03T10:00:00Z",
        "Audio quality is poor. Please re-record the intro.",
      ),
    ]);
    expect(rejected.headline).toBe("Rejected");
    expect(rejected.tone).toBe("rose");
    expect(rejected.note).toBe(
      "Audio quality is poor. Please re-record the intro.",
    );
  });

  it("treats a blank note as no note", () => {
    const [entry] = toTimeline([
      row("approved", "2026-09-04T10:00:00Z", "   "),
    ]);
    expect(entry.note).toBeNull();
    expect(entry.tone).toBe("sage");
  });

  it("falls back gracefully for an unknown status", () => {
    const [entry] = toTimeline([row("archived", "2026-09-05T10:00:00Z")]);
    expect(entry.headline).toBe("Moved to archived");
    expect(entry.tone).toBe("neutral");
  });
});
