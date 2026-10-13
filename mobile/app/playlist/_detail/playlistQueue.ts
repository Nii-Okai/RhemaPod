/** Route params the Player screen reads to auto-advance through a playlist (Isaac's
 * ask, session 2026-10-10: Play/Shuffle at the top of a playlist should actually play
 * through it, not just open one sermon). A comma-joined id list rather than a JSON blob
 * or a second fetch — sermon ids are UUIDs (no commas to escape) and this is the whole
 * queue's worth of state the player needs, small enough to carry as a plain route param.
 *
 * `playlistId` rides alongside so the Player screen can fetch the playlist's own
 * `items` (title/thumbnail/category, for display) and know which `useRemovePlaylistItem`
 * to call — the queue itself only carries sermon ids, not display data (Isaac's ask,
 * session 2026-10-11: the big Play button should open a real queue list, not the
 * comments panel — see Player screen's own doc comment on `QueueList`).
 */
export interface PlaylistQueueParams extends Record<string, string> {
  id: string;
  playlistId: string;
  queue: string;
  queueIndex: string;
}

/** Fisher–Yates — uniform, in-place on a copy. */
export function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function playlistQueueParams(playlistId: string, sermonIds: string[], startIndex = 0): PlaylistQueueParams | null {
  if (sermonIds.length === 0) return null;
  return { id: sermonIds[startIndex]!, playlistId, queue: sermonIds.join(','), queueIndex: String(startIndex) };
}
