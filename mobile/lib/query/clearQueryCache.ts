import { sqliteQueryPersister } from './persister';
import { queryClient } from './queryClient';

/**
 * The sign-out wipe for the query cache, the twin of `mediaCache/clearMediaCache.ts`.
 * `me.*` (profile, history, continue watching, recommendations), playlists and every
 * catalog row's per-viewer `locked` flag are keyed without a user id, so without this a
 * different account signing in on the same device is served the previous account's data
 * from memory and from the SQLite persister until each query goes stale. Clears memory
 * first, then the persisted copy. Best-effort: a failed disk delete never throws into the
 * auth path.
 */
export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  await Promise.resolve(sqliteQueryPersister.removeClient()).catch(() => {});
}
