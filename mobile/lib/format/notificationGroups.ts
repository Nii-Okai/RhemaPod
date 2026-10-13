const DAY_MS = 24 * 60 * 60 * 1000;

export interface Datable {
  publish_at?: string | null;
}

export interface NotificationGroup<T> {
  title: string;
  items: T[];
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * "Today" / "This week" / "Earlier" buckets (the notifications screen's own reference,
 * Isaac's YouTube screenshot) over whatever's in `useNewReleases()` — a sermon with no
 * `publish_at` sorts into "Earlier" rather than being dropped, same "don't silently lose
 * an item" reasoning `useNotificationsBadge`'s own unread filter uses. Input is assumed
 * already newest-first (the server's own ordering); this only partitions, never re-sorts.
 * "Today" is a real calendar-day comparison, not "within the last 24h" — a sermon
 * published at 11pm and viewed at 1am the same night should still read as "Earlier,"
 * not "Today," once the calendar day has actually turned over.
 */
export function groupByRecency<T extends Datable>(items: T[], now: Date = new Date()): NotificationGroup<T>[] {
  const today: T[] = [];
  const thisWeek: T[] = [];
  const earlier: T[] = [];
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  for (const item of items) {
    const publishedAt = item.publish_at ? new Date(item.publish_at) : null;
    if (publishedAt && isSameCalendarDay(publishedAt, now)) {
      today.push(item);
    } else if (publishedAt && publishedAt > weekAgo) {
      thisWeek.push(item);
    } else {
      earlier.push(item);
    }
  }

  return [
    { title: 'Today', items: today },
    { title: 'This week', items: thisWeek },
    { title: 'Earlier', items: earlier },
  ].filter((group) => group.items.length > 0);
}
