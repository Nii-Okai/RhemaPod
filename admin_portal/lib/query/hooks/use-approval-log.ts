/**
 * `useApprovalLog` — the editor screen's Approval log card (W8, plan §A.7 /
 * GATE 3 Batch 2).
 *
 * `GET /api/v1/approvals/sermons/{id}/approval-log` → `ApprovalLogItem[]`. The
 * route is `EditorPlus` and scoped: an editor reads the log **for their own
 * sermon** — that is where a rejection note is read after the fact (the W8
 * acceptance criterion). Someone else's sermon is 404; the card renders a quiet
 * inline line for that rather than crashing.
 *
 * The backend orders ascending (oldest first); the design timeline is
 * newest-first, so `toTimeline` reverses and shapes each row. It is pure and
 * exported for its unit test.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type ApprovalLogItem = components["schemas"]["ApprovalLogItem"];

/** Dot tone per resulting status — mirrors the StatusBadge palette so the
    timeline reads consistently with every badge on the screen. */
export type TimelineTone =
  | "neutral"
  | "wheat"
  | "slate"
  | "sage"
  | "rose";

export interface TimelineEntry {
  /** Stable key: status transition + timestamp is unique per row. */
  key: string;
  headline: string;
  tone: TimelineTone;
  note: string | null;
  timestamp: string;
}

const HEADLINE: Record<string, string> = {
  pending_review: "Submitted for review",
  under_review: "Review started",
  approved: "Approved",
  published: "Published",
  rejected: "Rejected",
  unpublished: "Unpublished",
  draft: "Withdrawn to draft",
};

const TONE: Record<string, TimelineTone> = {
  pending_review: "wheat",
  under_review: "slate",
  approved: "sage",
  published: "sage",
  rejected: "rose",
  unpublished: "neutral",
  draft: "neutral",
};

/**
 * `ApprovalLogItem[]` (oldest-first) → timeline rows (newest-first).
 *
 * The backend gives `actor_id` but no actor name on this contract, so the
 * headline is the transition ("Rejected", "Approved", …) without a "by <name>"
 * — noted as a contract gap in W8's report. The note (the load-bearing part
 * for an editor) is carried verbatim.
 */
export function toTimeline(items: ApprovalLogItem[]): TimelineEntry[] {
  return items
    .map((item, index) => ({
      key: `${item.to_status}-${item.created_at}-${index}`,
      headline: HEADLINE[item.to_status] ?? `Moved to ${item.to_status}`,
      tone: TONE[item.to_status] ?? "neutral",
      note: item.note && item.note.trim().length > 0 ? item.note : null,
      timestamp: item.created_at,
    }))
    .reverse();
}

export function useApprovalLog(sermonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sermons.approvalLog(sermonId ?? ""),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/approvals/sermons/{sermon_id}/approval-log", {
          params: { path: { sermon_id: sermonId as string } },
          signal,
        }),
      ),
    enabled: Boolean(sermonId),
    retry: (failureCount, error) => !isApiError(error) && failureCount < 2,
  });
}
