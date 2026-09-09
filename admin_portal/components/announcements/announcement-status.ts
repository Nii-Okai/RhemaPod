/**
 * Announcement workflow status — the backend enum, and its mapping onto the
 * `StatusBadge` a11y pipeline (W13).
 *
 * The API's `AnnouncementStatus` (`app/models/models.py`) reuses the sermon
 * badge vocabulary on every value except one: the API says `pending_review`,
 * the badge pipeline says `pending`. `toBadgeStatus` is the single seam that
 * bridges them — everything else is identity. (Announcements have no
 * `under_review` step; a submitted announcement sits at `pending_review` until
 * a manager approves or rejects it.)
 *
 * `announcementBadgeLabel` returns the design's short row labels ("Pending",
 * not the badge default "Pending review") so the list matches the `.dc.html`.
 */

import type { components } from "@/lib/api/schema";
import type { SermonStatus as BadgeSermonStatus } from "@/components/portal/status-badge";

export type AnnouncementStatus = components["schemas"]["AnnouncementStatus"];

/** Map an API announcement status onto a `StatusBadge` `status` prop. */
export function toBadgeStatus(status: AnnouncementStatus): BadgeSermonStatus {
  return status === "pending_review" ? "pending" : status;
}

const LABEL: Record<AnnouncementStatus, string> = {
  draft: "Draft",
  pending_review: "Pending",
  approved: "Approved",
  published: "Published",
  rejected: "Rejected",
  archived: "Archived",
};

/** The short label shown on the list row badge (design Screen 8). */
export function announcementBadgeLabel(status: AnnouncementStatus): string {
  return LABEL[status];
}
