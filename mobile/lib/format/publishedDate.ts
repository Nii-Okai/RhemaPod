/**
 * `published_at` (ISO datetime) → a short date, e.g. "Sep 4" — matches the admin portal's
 * own scheduled-chip date convention (`sermons-screen.tsx`'s `scheduledChipLabel`,
 * `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })`) so the two apps read
 * the same date shape for the same underlying field.
 */
export function formatPublishedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** `published_at` (ISO datetime) → just the year, e.g. "2026" (Isaac's ask, session
    2026-10-01: sermon detail's meta line drops month/day down to year only). */
export function formatPublishedYear(iso: string): string {
  return String(new Date(iso).getFullYear());
}
