/**
 * Sermon workflow status — the backend enum, and its mapping onto the
 * `StatusBadge` a11y pipeline (W7).
 *
 * The API's `SermonStatus` (`app/models/models.py`) and the UI Kit's badge
 * vocabulary agree on every value except one: the API says `pending_review`,
 * the badge pipeline says `pending` (README §"StatusBadge"). `toBadgeStatus`
 * is the single seam that bridges them — everything else is identity.
 */

import type { components } from "@/lib/api/schema";
import type { SermonStatus as BadgeSermonStatus } from "@/components/portal/status-badge";

/** The status as the backend returns it. */
export type SermonStatus = components["schemas"]["SermonStatus"];

/** Map an API status onto a `StatusBadge` `status` prop. */
export function toBadgeStatus(status: SermonStatus): BadgeSermonStatus {
  return status === "pending_review" ? "pending" : status;
}
