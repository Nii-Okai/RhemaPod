/**
 * Formats an announcement's visible window (design spec 1k): "Sep 8 → Oct 4"
 * for a bounded window, "Sep 10 → —" for an ongoing one (no end date).
 *
 * Wired into `AnnouncementCard` (Decision 5) now that `AnnouncementListItem`
 * carries `expires_at` alongside `publish_at`.
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
