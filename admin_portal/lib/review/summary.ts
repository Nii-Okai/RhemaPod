/**
 * Pure derivations for the Review queue screen (W10, design Screen 5).
 *
 * The header count line, the ">48h" warning alert and the per-card "waiting N
 * days" all fall out of two inputs: the page `total` and each item's
 * `submitted_at`. Kept here, pure and `now`-injectable, so they are unit-tested
 * without a render (plan §A.11).
 */

import { daysSince, hoursSince } from "@/lib/format";

/** The threshold behind the warning alert: "waiting more than 2 days". */
export const OVERDUE_HOURS = 48;

interface Waitable {
  submitted_at: string | null;
}

/** Items whose wait exceeds {@link OVERDUE_HOURS}. Null `submitted_at` never
    counts as overdue. */
export function overdueItems<T extends Waitable>(
  items: readonly T[],
  now: number = Date.now(),
): T[] {
  return items.filter(
    (item) =>
      item.submitted_at != null && hoursSince(item.submitted_at, now) > OVERDUE_HOURS,
  );
}

/** The longest wait across the visible page, in whole days (0 if the page is
    empty or nothing carries a `submitted_at`). */
export function oldestWaitDays<T extends Waitable>(
  items: readonly T[],
  now: number = Date.now(),
): number {
  let max = 0;
  for (const item of items) {
    if (item.submitted_at == null) continue;
    const days = daysSince(item.submitted_at, now);
    if (days > max) max = days;
  }
  return max;
}

/**
 * The header subhead: `"3 submissions · oldest waiting 3 days"`.
 * `total` is the server's page total (not `items.length`); `oldestWait` is
 * {@link oldestWaitDays} over the *visible* page. A zero wait reads "oldest
 * submitted today"; a zero total drops the wait clause entirely.
 */
export function reviewCountLine(total: number, oldestWait: number): string {
  const submissions = `${total} submission${total === 1 ? "" : "s"}`;
  if (total === 0) return submissions;
  const wait =
    oldestWait <= 0
      ? "oldest submitted today"
      : `oldest waiting ${oldestWait} day${oldestWait === 1 ? "" : "s"}`;
  return `${submissions} · ${wait}`;
}

/** The warning-alert body when `count` items have waited past the threshold. */
export function overdueAlertText(count: number): string {
  return count === 1
    ? "1 submission has been waiting more than 2 days."
    : `${count} submissions have been waiting more than 2 days.`;
}

/**
 * The mono provenance line under a card:
 *   `submitted Sep 3 · waiting 6 days · 2 renditions ready`
 * A null `submitted_at` degrades the first two clauses rather than rendering
 * "Invalid Date".
 */
export function provenanceLine(
  submittedAt: string | null,
  renditionsReady: number,
  now: number = Date.now(),
): string {
  const renditions = `${renditionsReady} rendition${
    renditionsReady === 1 ? "" : "s"
  } ready`;
  if (submittedAt == null) return `submission date unknown · ${renditions}`;
  const when = new Date(submittedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const days = daysSince(submittedAt, now);
  const waiting =
    days <= 0 ? "waiting under a day" : `waiting ${days} day${days === 1 ? "" : "s"}`;
  return `submitted ${when} · ${waiting} · ${renditions}`;
}
