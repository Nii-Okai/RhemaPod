import type { AnnouncementListItem } from '../../../lib/query/hooks/useAnnouncements';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayMonth(date: Date, now: Date): string {
  const text = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? text : `${text} ${date.getFullYear()}`;
}

/**
 * The mono date line on a Signature announcement card, from the announcement's visible
 * window: "25 OCT – 3 NOV", "25 – 31 OCT" inside one month, "FROM 25 OCT" with no end,
 * "UNTIL 3 NOV" with no start. Many announcements carry neither date (the classic card
 * showed "— → —" for those), so it falls back to when the item was posted, and returns
 * null only when even that is missing.
 */
export function formatAnnouncementWhen(
  announcement: Pick<AnnouncementListItem, 'publish_at' | 'expires_at' | 'created_at'>,
  now: Date = new Date(),
): string | null {
  const start = parse(announcement.publish_at);
  const end = parse(announcement.expires_at);
  if (start && end) {
    const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
    if (sameMonth && start.getDate() === end.getDate()) return dayMonth(start, now);
    if (sameMonth) return `${start.getDate()} – ${dayMonth(end, now)}`;
    return `${dayMonth(start, now)} – ${dayMonth(end, now)}`;
  }
  if (start) return `FROM ${dayMonth(start, now)}`;
  if (end) return `UNTIL ${dayMonth(end, now)}`;
  const posted = parse(announcement.created_at);
  return posted ? `POSTED ${dayMonth(posted, now)}` : null;
}
