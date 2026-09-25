/**
 * Formats an announcement's visible window (design spec 1k): "Sep 8 → Oct 4"
 * for a bounded window, "Sep 10 → —" for an ongoing one (no end date).
 *
 * NOT WIRED to the live Announcements screen yet — see this slice's
 * `status.md` entry (W4.4). The public `GET /announcements` list contract
 * (`AnnouncementListItem` in `app/models/content_schemas.py`) does not
 * return an end date; only the single-item detail read
 * (`GET /announcements/{id}` → `AnnouncementDetail`) and the staff routes
 * carry `expires_at`. Fanning out a detail call per list row to backfill it
 * is exactly the pattern this plan tells `mobile-developer` not to invent
 * (W4.4's per-episode-status guidance generalizes here); widening
 * `AnnouncementListItem` to include `expires_at` is a one-field, additive,
 * `senior-dev-backend` change outside this slice's ownership. This function
 * is built and tested now so wiring it up is a one-line change once that
 * field lands — deliberately not deleted or left as a TODO comment.
 */
export function formatAnnouncementDateRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string {
  return `${formatMonthDay(startIso)} → ${formatMonthDay(endIso)}`;
}

function formatMonthDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
