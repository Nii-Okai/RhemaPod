import * as FileSystem from 'expo-file-system';
import * as manifest from './manifest';
import * as paths from './paths';
import * as nowPlaying from './nowPlaying';
import { emitCacheEvent } from './events';

/**
 * LRU eviction down to a quota (plan S5, D16). Runs a single pass over a snapshot of
 * `listByLru()` (oldest first) — never a loop that could spin, so "only pinned entries
 * remain and the cache is still over quota" just ends the pass over quota, it doesn't
 * hang or throw. "Mid-write" protection needs no code here: `fill.ts` only inserts a
 * manifest row *after* a fill is fully verified and renamed, so there is no such thing as
 * a manifest row for a file still being written — eviction, which only ever reads
 * committed rows, can't reach one by construction.
 */

export interface EvictDeps {
  listByLru: typeof manifest.listByLru;
  deleteByKey: typeof manifest.deleteByKey;
  deleteFile: (uri: string) => Promise<void>;
  getNowPlaying: typeof nowPlaying.getNowPlaying;
}

async function realDeleteFile(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

function defaultDeps(): EvictDeps {
  return {
    listByLru: manifest.listByLru,
    deleteByKey: manifest.deleteByKey,
    deleteFile: realDeleteFile,
    getNowPlaying: nowPlaying.getNowPlaying,
  };
}

export interface EvictOptions {
  /** A `media_ref_id` to never evict in this pass, regardless of recency or the pin
   * (plan: "fill never evicts its own just-written entry" — distinct from the playing
   * pin, since a fill's own entry may already have nothing playing by the time it lands). */
  protect?: string;
}

/** Evicts oldest-first until the total is at or under `quotaBytes`. Returns the evicted ids. */
export async function evictToFit(quotaBytes: number, options: EvictOptions = {}, deps: EvictDeps = defaultDeps()): Promise<string[]> {
  const entries = await deps.listByLru();
  let total = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  const pinned = deps.getNowPlaying();
  const evicted: string[] = [];

  for (const entry of entries) {
    if (total <= quotaBytes) break;
    if (entry.mediaRefId === pinned || entry.mediaRefId === options.protect) continue;

    await deps.deleteByKey(entry.mediaRefId);
    await deps.deleteFile(paths.mediaCacheFilePath(entry.fileName)).catch(() => {});
    total -= entry.sizeBytes;
    evicted.push(entry.mediaRefId);
    emitCacheEvent('evict', { sermonId: entry.sermonId, mediaRefId: entry.mediaRefId });
  }

  return evicted;
}
