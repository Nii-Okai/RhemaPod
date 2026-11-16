/**
 * Daily Rhema date rules (ADR 0022 §1, plan-daily-devotional D4).
 *
 * A devotional belongs to the listener's own calendar date. Today's devotional appears at
 * the church's `publish_hour` (local time); before that, yesterday's is still "today's".
 * The server accepts dates in [UTC today − 1, UTC today + 8], so every request window is
 * clamped to that range here — a listener at UTC−12 before their publish hour would
 * otherwise ask for a date the server refuses.
 *
 * Every function takes `now` so tests can pin the clock and time zone edges.
 */

export const PREFETCH_DAYS = 7;
const SERVER_PAST_DAYS = 1;
const SERVER_FUTURE_DAYS = 8;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The device's local calendar date. */
export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The UTC calendar date (what the server calls "today"). */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The date whose devotional is "today's" right now: local today once the publish hour has passed, else yesterday. */
export function currentDevotionalDate(now: Date, publishHour: number): string {
  const today = localDate(now);
  return now.getHours() >= publishHour ? today : addDays(today, -1);
}

/** Whether a prefetched day may be shown yet (never ahead of the current devotional date). */
export function isUnlocked(date: string, now: Date, publishHour: number): boolean {
  return date <= currentDevotionalDate(now, publishHour);
}

/**
 * The `from`/`count` to ask the server for: the current devotional date plus the week
 * ahead, clamped to the server's window.
 */
export function prefetchWindow(now: Date, publishHour: number): { from: string; count: number } {
  const utc = utcDate(now);
  const earliest = addDays(utc, -SERVER_PAST_DAYS);
  const latest = addDays(utc, SERVER_FUTURE_DAYS);
  let from = currentDevotionalDate(now, publishHour);
  if (from < earliest) from = earliest;
  const last = addDays(from, PREFETCH_DAYS);
  const end = last > latest ? latest : last;
  return { from, count: Math.max(1, daysBetween(from, end) + 1) };
}

/** Monday-first week containing `iso`, for the week vine. */
export function weekOf(iso: string): string[] {
  const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const monday = addDays(iso, wd === 0 ? -6 : 1 - wd);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Monday 9 November" */
export function longDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

/** "M" for the vine. */
export function weekdayInitial(iso: string): string {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()][0];
}

/** "November 2026" */
export function monthLabel(iso: string): string {
  return `${MONTH[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}
