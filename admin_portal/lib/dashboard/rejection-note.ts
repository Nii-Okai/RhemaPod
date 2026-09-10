/**
 * Pull the most recent rejection note out of a sermon's approval log (W23, the
 * WIP "Rejected" card).
 *
 * The note lives in `ApprovalLog`, one row per status transition, readable by
 * an editor for their own sermon (Phase 1 GATE 3 #5). The Dashboard fetches the
 * log for AT MOST 5 rejected sermons (plan §A.1 — the accepted N+1) and shows
 * the note so the editor sees *why* without opening each one. There is
 * deliberately no `latest_rejection_note` field on any list DTO (§A.1); this is
 * the price of reading it here.
 *
 * Pure — unit-tested directly. Picks the newest entry whose `to_status` is
 * `rejected` and carries a non-blank note; returns `null` when the log has no
 * such entry (log still loading, sermon re-submitted since, or note omitted).
 */

import type { components } from "@/lib/api/schema";

export type ApprovalLogItem = components["schemas"]["ApprovalLogItem"];

export function latestRejectionNote(
  items: ApprovalLogItem[] | undefined,
): string | null {
  if (!items || items.length === 0) return null;
  const rejections = items
    .filter((item) => item.to_status === "rejected")
    .filter((item) => (item.note ?? "").trim().length > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rejections[0]?.note?.trim() ?? null;
}
