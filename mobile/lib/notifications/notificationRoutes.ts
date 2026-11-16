import { localDate } from '../devotionals/dates';
import { resolveIncomingLink } from '../linking/allowList';

/** Where a tapped notification should open, or null to just open the app. */
export function routeForNotification(data: unknown, now: Date = new Date()): string | null {
  if (!data || typeof data !== 'object') return null;
  const { kind, url } = data as { kind?: unknown; url?: unknown };
  if (kind === 'daily_rhema') return `/devotional/${localDate(now)}`;
  if (typeof url === 'string') {
    // The same allow-list as shared links: a push can only open a sermon, series or
    // playlist, never an arbitrary screen.
    const resolved = resolveIncomingLink(url);
    return resolved.kind === 'content' ? resolved.route : null;
  }
  return null;
}
