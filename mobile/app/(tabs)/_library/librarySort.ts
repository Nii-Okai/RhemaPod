import type { DownloadRecord } from '../../../lib/downloads/types';
import type { PlaylistPublic } from '../../../lib/query/hooks/usePlaylists';

/** A playlist and a download interleaved into one list (Isaac's ask, session
 * 2026-10-10: "remove section titles" + "playlist and download items should
 * look similar") — there's no section boundary between them any more, so
 * every list/grid in `library.tsx` works off this one discriminated union
 * instead of two separate arrays. `key` is the stable React key (prefixed by
 * kind, since a playlist id and a sermon id are different id spaces that
 * could theoretically collide). */
export type LibraryItem =
  | { kind: 'playlist'; key: string; playlist: PlaylistPublic }
  | { kind: 'download'; key: string; download: DownloadRecord };

export function libraryItemTitle(item: LibraryItem): string {
  return item.kind === 'playlist' ? item.playlist.name : item.download.title;
}

/**
 * The Library tab's "Sort by" sheet applies across two content types with
 * different fields, so each mode means something slightly different per
 * type:
 *
 * - `recents`: most-recently-interacted-with. For a playlist that's still
 *   just `created_at` — this app doesn't track a separate "last opened"
 *   timestamp for playlists, so `recents` and `recently_added` are the same
 *   ordering until that changes. For a download, `updatedAt` (bumped on
 *   every progress tick, retry, or completion) gives a real distinct
 *   "recently active" order.
 * - `recently_added`: when the row was first created — `created_at` for a
 *   playlist, `createdAt` (when the download was queued) for a download.
 * - `alphabetical`: by name/title, both types.
 * - `creator`: by owner — every playlist in this app is owned by the
 *   viewer themselves (no shared/collaborative playlists exist), so this
 *   never actually reorders anything today; a download has no creator
 *   concept at all, so both sort to the same empty key. Kept as a real,
 *   working option rather than removed, since it does nothing *wrong* —
 *   it's just a no-op pending a feature (shared playlists) this app
 *   doesn't have yet.
 */
export type LibrarySortMode = 'recents' | 'recently_added' | 'alphabetical' | 'creator';

export const SORT_MODE_LABEL: Record<LibrarySortMode, string> = {
  recents: 'Recents',
  recently_added: 'Recently added',
  alphabetical: 'Alphabetical',
  creator: 'Creator',
};

function recentsTime(item: LibraryItem): number {
  return item.kind === 'playlist' ? new Date(item.playlist.created_at).getTime() : item.download.updatedAt;
}

function addedTime(item: LibraryItem): number {
  return item.kind === 'playlist' ? new Date(item.playlist.created_at).getTime() : item.download.createdAt;
}

function creatorOf(item: LibraryItem): string {
  return item.kind === 'playlist' ? (item.playlist.owner_name ?? '') : '';
}

/** Sorts a combined playlist+download list in place of what used to be two
 * separately-sorted arrays — see this file's own top doc comment for why a
 * genuinely interleaved order (not "all playlists, then all downloads")
 * is the point. */
export function sortLibraryItems(items: LibraryItem[], mode: LibrarySortMode): LibraryItem[] {
  const sorted = [...items];
  switch (mode) {
    case 'alphabetical':
      sorted.sort((a, b) => libraryItemTitle(a).localeCompare(libraryItemTitle(b)));
      return sorted;
    case 'creator':
      sorted.sort((a, b) => creatorOf(a).localeCompare(creatorOf(b)));
      return sorted;
    case 'recently_added':
      sorted.sort((a, b) => addedTime(b) - addedTime(a));
      return sorted;
    case 'recents':
    default:
      sorted.sort((a, b) => recentsTime(b) - recentsTime(a));
      return sorted;
  }
}
