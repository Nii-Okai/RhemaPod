import { queryClient, queryKeys } from '../query/queryClient';
import type { DownloadManager } from './downloadManager';
import type { DownloadRecord } from './types';

/**
 * Offline playback (session 2026-10-22). The player reads `sermons.detail(id)` before it
 * ever looks at the local file, so a downloaded sermon whose detail wasn't already in the
 * query cache (never opened, or opened more than 24h ago, or the cache was wiped at
 * sign-out) showed "Something went wrong" with no network. Every `ready` download now
 * carries the `SermonDetail` saved when it finished; this copies it into the query cache
 * wherever the cache has nothing for that sermon.
 *
 * Seeded with `updatedAt: 0`, so it is always stale: online, the detail query refetches
 * on mount exactly as before and the saved copy is only ever a fallback. The thumbnail is
 * pointed at the download's local copy when there is one, since the saved presigned URL
 * expires.
 */
export async function seedOfflineDetails(manager: DownloadManager, records: readonly DownloadRecord[]): Promise<void> {
  for (const record of records) {
    if (record.state !== 'ready') continue;
    const key = queryKeys.sermons.detail(record.sermonId);
    if (queryClient.getQueryData(key) !== undefined) continue;
    const detail = await manager.getDetailSnapshot(record.sermonId);
    if (!detail || typeof detail !== 'object') continue;
    // A live fetch may have landed while the snapshot was read; never overwrite it.
    if (queryClient.getQueryData(key) !== undefined) continue;
    const seeded = record.thumbnailPath ? { ...detail, thumbnail_url: record.thumbnailPath } : detail;
    queryClient.setQueryData(key, seeded, { updatedAt: 0 });
  }
}
