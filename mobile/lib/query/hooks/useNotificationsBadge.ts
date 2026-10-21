import { useEffect, useState } from 'react';
import { useCurrentUser } from './useProfile';
import { useNewReleases } from './useNewReleases';
import { getReadNotificationIds, markNotificationRead, markNotificationsRead } from '../../settings/notificationsSeen';

/**
 * Backs `HomeTopBar`'s bell badge and the `/notifications` screen it opens (Isaac's
 * ask, session 2026-10-10: "Notification icon should open notifications page showing
 * new releases. Show counter"). Reuses `useNewReleases()` — Home's own "New Releases"
 * shelf data, `GET /catalog/sermons/new-releases` — rather than a separate feed; there
 * is no other "what's new" concept in this app to show here instead.
 *
 * Read/unread is tracked per sermon id (Isaac's follow-up, session 2026-10-11: "the
 * counter should respect read and unread items"), not a single "last seen" batch
 * timestamp — merely opening the Notifications screen no longer marks everything on it
 * as read; `markRead` is called per row, on tap (`notifications.tsx`'s own call site).
 */
export function useNotificationsBadge() {
  const { data: user } = useCurrentUser();
  const newReleases = useNewReleases();
  const userId = user?.id;

  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!userId) return;
    let active = true;
    getReadNotificationIds(userId).then((ids) => {
      if (active) setReadIds(ids);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const isRead = (sermonId: string) => readIds.has(sermonId);

  const markRead = (sermonId: string) => {
    setReadIds((current) => {
      if (current.has(sermonId)) return current;
      const next = new Set(current);
      next.add(sermonId);
      return next;
    });
    if (userId) void markNotificationRead(userId, sermonId);
  };

  // "Mark all read" on the Signature Notifications screen: everything currently listed.
  const markAllRead = () => {
    const ids = (newReleases.data ?? []).map((sermon) => sermon.id).filter((id) => !readIds.has(id));
    if (ids.length === 0) return;
    setReadIds((current) => new Set([...current, ...ids]));
    if (userId) void markNotificationsRead(userId, ids);
  };

  const unseenCount = (newReleases.data ?? []).filter((sermon) => !readIds.has(sermon.id)).length;

  return { unseenCount, isRead, markRead, markAllRead };
}
