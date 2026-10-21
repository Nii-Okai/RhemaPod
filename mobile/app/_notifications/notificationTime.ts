const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** A release sits under "New" for its first week, the same window as Home's "New" chip. */
const NEW_FOR_MS = 7 * DAY_MS;

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * The mono "when" on a Signature notification row, as the mockup draws it: "JUST NOW",
 * "12M AGO", "5H AGO" on the release day, then "YESTERDAY", a weekday within the week,
 * and a short date after that ("13 OCT", with the year once it isn't this year's).
 * Returns null for a sermon with no publish time.
 */
export function formatWhen(iso: string | null | undefined, now: Date = new Date()): string | null {
  const then = parse(iso);
  if (!then) return null;
  const elapsed = Math.max(0, now.getTime() - then.getTime());
  const daysBack = Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS);

  if (daysBack <= 0) {
    if (elapsed < MINUTE_MS) return 'JUST NOW';
    if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}M AGO`;
    return `${Math.floor(elapsed / HOUR_MS)}H AGO`;
  }
  if (daysBack === 1) return 'YESTERDAY';
  if (daysBack < 7) return WEEKDAYS[then.getDay()];
  const date = `${then.getDate()} ${MONTHS[then.getMonth()]}`;
  return then.getFullYear() === now.getFullYear() ? date : `${date} ${then.getFullYear()}`;
}

/** True during a release's first week; a sermon with no publish time is never new. */
export function isFresh(iso: string | null | undefined, now: Date = new Date()): boolean {
  const then = parse(iso);
  if (!then) return false;
  const elapsed = now.getTime() - then.getTime();
  return elapsed >= 0 && elapsed < NEW_FOR_MS;
}

/**
 * Splits the new-releases list (already newest first from the server) into the screen's
 * three parts: the newest one, featured at the top, then "New" (the rest of this week)
 * and "Earlier". Order is kept; nothing is dropped.
 */
export function splitNotifications<T extends { publish_at?: string | null }>(
  items: T[],
  now: Date = new Date(),
): { latest: T | null; fresh: T[]; earlier: T[] } {
  const [latest = null, ...rest] = items;
  const fresh: T[] = [];
  const earlier: T[] = [];
  for (const item of rest) (isFresh(item.publish_at, now) ? fresh : earlier).push(item);
  return { latest, fresh, earlier };
}
