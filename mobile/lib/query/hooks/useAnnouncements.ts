/**
 * `GET /announcements` (plan W4.4) — public read, "Live announcements,
 * pinned first then newest" (`app/api/announcements.py`'s own docstring).
 * No auth gate on the endpoint, but every screen in this app is already
 * behind sign-in (plan L2), so this uses the same default (`auth: true`)
 * every other read hook in this file uses — nothing special to opt out of.
 *
 * `announcement_service.list_visible` already orders pinned-first then
 * newest and already windows on `publish_at`/`expires_at` server-side — this
 * hook does no client-side date filtering or re-sorting; see
 * `lib/format/pinnedFirst.ts` for the *defensive* stable re-sort the
 * announcements screen applies on top (plan-sanctioned: "use the server's
 * order if it already does this; otherwise a stable client sort ... is
 * fine").
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type AnnouncementListItem = components['schemas']['AnnouncementListItem'];

export function useAnnouncements() {
  return useQuery({
    queryKey: queryKeys.announcements.list(),
    queryFn: ({ signal }) => api.get('/announcements', { init: { signal } }),
  });
}
