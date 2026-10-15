import * as FileSystem from 'expo-file-system';
import * as manifest from './manifest';
import * as paths from './paths';
import { cancelFill } from './fill';
import { emitCacheEvent } from './events';

/**
 * "Downloads wins" (plan S6). Called once a real Download reaches `ready`, so a stale
 * cache entry for the same sermon never coexists with — or gets played ahead of — the
 * real download: cancels any fill in progress for the sermon, then removes every cache
 * row/file for it. No dedicated event name exists for this in `events.ts`'s vocabulary
 * (a one-call-site addition didn't seem worth a new `CacheEventName` variant); `evict` is
 * reused since this genuinely is the cache entry being removed, matching what the plan's
 * own on-device check (D9) describes observing: "log shows the cache entry removed".
 */

export interface DropSermonDeps {
  deleteBySermon: typeof manifest.deleteBySermon;
  deleteFile: (uri: string) => Promise<void>;
  cancelFill: typeof cancelFill;
}

async function realDeleteFile(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

function defaultDeps(): DropSermonDeps {
  return { deleteBySermon: manifest.deleteBySermon, deleteFile: realDeleteFile, cancelFill };
}

export async function dropSermonFromCache(sermonId: string, deps: DropSermonDeps = defaultDeps()): Promise<void> {
  deps.cancelFill(sermonId);
  const removed = await deps.deleteBySermon(sermonId);
  for (const removedEntry of removed) {
    await deps.deleteFile(paths.mediaCacheFilePath(removedEntry.fileName)).catch(() => {});
    emitCacheEvent('evict', { sermonId, mediaRefId: removedEntry.mediaRefId });
  }
}
