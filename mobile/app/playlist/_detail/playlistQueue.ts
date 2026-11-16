import type { PlaylistItemPublic } from '../../../lib/query/hooks/usePlaylists';
import { queueItemFromSermon, queueStore, shuffled, startQueue, type QueueItemInput } from '../../../lib/playback/queue';

export { shuffled };

/** A playlist row as a queue entry, keeping its row id for "Remove from playlist". */
export function playlistQueueItem(item: PlaylistItemPublic): QueueItemInput {
  return { ...queueItemFromSermon(item.sermon), playlistItemId: item.id };
}

/**
 * Starts the app-wide queue on a playlist (Isaac's ask, session 2026-10-10: Play/Shuffle at
 * the top of a playlist should play through it), from `startIndex` in `order` — the saved
 * order, a shuffle of it, or the saved order from a tapped row. Returns the sermon to open
 * the player on, or null for an empty playlist.
 */
export function startPlaylistQueue(
  playlist: { id: string; name: string },
  order: PlaylistItemPublic[],
  startIndex = 0,
): string | null {
  if (order.length === 0) return null;
  const start = Math.min(Math.max(0, startIndex), order.length - 1);
  queueStore.update((state) =>
    startQueue(state, order.map(playlistQueueItem), start, { kind: 'playlist', id: playlist.id, name: playlist.name }),
  );
  return order[start]!.sermon.id;
}
