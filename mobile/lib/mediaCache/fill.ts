import * as FileSystem from 'expo-file-system';
import { realCanStartDownload } from '../downloads/network';
import * as manifest from './manifest';
import * as paths from './paths';
import { emitCacheEvent } from './events';
import { computeQuota, isTooLargeForQuota } from './quota';
import { evictToFit } from './evict';
import { FREE_SPACE_FLOOR_BYTES, STREAM_EXPIRY_MARGIN_MS } from './constants';
import type { CacheKey } from './key';

/**
 * The media-cache fill engine (plan S3, D15, D16, P2, P4, P6). The Wi-Fi gate
 * (`realCanStartDownload`) is the single source of truth Downloads also uses for "is this
 * device allowed to spend data right now" — it lives in `lib/downloads/network.ts`, not
 * `downloadManager.ts`, specifically so this file never has a module-graph edge back into
 * the Downloads manager (S8/S9 review: that edge was a real circular import,
 * `downloadManager -> mediaCache/dropSermon -> mediaCache/fill -> downloadManager`, fixed
 * by moving the function instead of living with the cycle). The transfer itself is NOT
 * the same JS function as Downloads' `realDownloadToFile`: that function's contract (no
 * returned headers, no cancel handle) can't give P4 its declared `Content-Length` or D16
 * its cancellation, and changing that contract would be a behaviour change to Downloads,
 * which the plan forbids. `realTransfer` below is a parallel, equally small implementation
 * of the same `createDownloadResumable` pattern, scoped to what the fill engine
 * specifically needs.
 *
 * S3 implements only the free-space *floor* (an absolute reserve). The per-item
 * "50% of the computed quota" skip described alongside it needs `quota.ts`'s dynamic
 * formula (free + cache bytes), which doesn't exist until S5 — deliberately deferred,
 * not an oversight.
 */

export type FillOutcome =
  | 'committed'
  | 'skipped-signed-out'
  | 'skipped-already-in-flight'
  | 'skipped-expired'
  | 'skipped-network'
  | 'skipped-disk-floor'
  | 'skipped-too-large-for-quota'
  | 'skipped-superseded'
  | 'discarded-missing-content-length'
  | 'discarded-size-mismatch'
  | 'discarded-error';

interface Transfer {
  promise: Promise<{ contentLength: number | null }>;
  cancel: () => void;
}

export interface FillDeps {
  transfer: (url: string, destPath: string) => Transfer;
  canStartDownload: () => Promise<boolean>;
  getFreeDiskStorage: () => Promise<number>;
  fs: {
    getSize: (uri: string) => Promise<number>;
    moveFile: (from: string, to: string) => Promise<void>;
    deleteFile: (uri: string) => Promise<void>;
    ensureDir: (dir: string) => Promise<void>;
  };
  manifestInsert: typeof manifest.insert;
  manifestDeleteByKey: typeof manifest.deleteByKey;
  manifestTotalBytes: typeof manifest.totalBytes;
  evictToFit: typeof evictToFit;
  now: () => number;
}

function realTransfer(url: string, destPath: string): Transfer {
  const resumable = FileSystem.createDownloadResumable(url, destPath, {});
  const promise = resumable.downloadAsync().then((result) => {
    if (!result) throw new Error('Fill transfer was cancelled');
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Fill transfer failed (HTTP ${result.status})`);
    }
    const raw = result.headers?.['content-length'] ?? result.headers?.['Content-Length'];
    const contentLength = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
    return { contentLength };
  });
  return {
    promise,
    cancel: () => {
      resumable.pauseAsync().catch(() => {});
    },
  };
}

async function realGetSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return info.exists && !info.isDirectory ? (info.size ?? 0) : 0;
}

async function realMoveFile(from: string, to: string): Promise<void> {
  await FileSystem.moveAsync({ from, to });
}

async function realDeleteFile(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

/**
 * S9 review (finding S3): nothing ever created `rpa-media-cache/` — confirmed nothing in
 * this module called `makeDirectoryAsync` at all, so every fill either silently failed,
 * or (worse, if the native download call happens to create parent dirs on some platform)
 * could succeed into a directory a wipe had just deleted. Same check-then-create shape as
 * Downloads' own `ensureDir` (`lib/downloads/paths.ts`), kept local rather than imported
 * from there to avoid yet another cross-module edge.
 */
async function realEnsureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

function defaultDeps(): FillDeps {
  return {
    transfer: realTransfer,
    canStartDownload: realCanStartDownload,
    getFreeDiskStorage: () => FileSystem.getFreeDiskStorageAsync(),
    fs: { getSize: realGetSize, moveFile: realMoveFile, deleteFile: realDeleteFile, ensureDir: realEnsureDir },
    manifestInsert: manifest.insert,
    manifestDeleteByKey: manifest.deleteByKey,
    manifestTotalBytes: manifest.totalBytes,
    evictToFit,
    now: () => Date.now(),
  };
}

export interface FillRequest {
  sermonId: string;
  key: CacheKey;
  url: string;
  /** Epoch ms when the presigned URL expires (P2). */
  expiresAt: number;
}

interface InFlight {
  sermonId: string;
  mediaRefId: string;
  cancel: () => void;
  cancelled: boolean;
  /** Gilfoyle re-check MUST-FIX: set only by an explicit `cancelFill()` call for THIS
   * sermon (e.g. `dropSermonFromCache`'s "Downloads wins" path) — distinct from
   * `cancelled`, which a different key's fill taking the global in-flight slot also sets.
   * The post-insert guard needs this distinction: an unrelated different-key supersede
   * must not undo an already-committed result, but an explicit cancel for THIS exact
   * sermon (Downloads just claimed it) must, even if it lands after the insert settles. */
  explicitlyCancelled: boolean;
}

let generation = 0;
let inFlight: InFlight | null = null;
let fillsBlocked = false;

/**
 * S7 calls this when wiping the cache (sign-out). Any fill already past the transfer
 * stage discards its result instead of committing a row the wipe didn't know about.
 *
 * S9 review (finding S1): the generation bump alone only protects a fill that was
 * *already in flight* at wipe time — it does nothing to stop a *new* `requestFill` from
 * starting afterward with a presigned URL that's still valid for hours, recreating the
 * previous user's cache entry after sign-out. `fillsBlocked` closes that: every fill is
 * refused outright from this point until `allowFillsAfterSignIn()` explicitly re-opens it.
 */
export function invalidateInFlightFills(): void {
  generation += 1;
  fillsBlocked = true;
  if (inFlight) {
    inFlight.cancelled = true;
    inFlight.cancel();
  }
}

/** Called once a fresh sign-in succeeds — the wipe already ran, so new fills are safe again. */
export function allowFillsAfterSignIn(): void {
  fillsBlocked = false;
}

/** Cancels the in-flight fill for `sermonId`, or any in-flight fill if omitted. */
export function cancelFill(sermonId?: string): void {
  if (inFlight && (sermonId === undefined || inFlight.sermonId === sermonId)) {
    inFlight.cancelled = true;
    inFlight.explicitlyCancelled = true;
    inFlight.cancel();
  }
}

/**
 * Requests a background fill for one sermon's selected media. Never throws — every
 * failure path resolves to a `FillOutcome` instead, since a cache miss on the next play is
 * always a safe fallback (plan: "no rethrow into the caller").
 */
export async function requestFill(request: FillRequest, deps: FillDeps = defaultDeps()): Promise<FillOutcome> {
  const { sermonId, key, url, expiresAt } = request;

  // S9 review (finding S1): refuse outright after a wipe until a fresh sign-in re-opens
  // this. Checked before anything else, including the supersede below.
  if (fillsBlocked) {
    emitCacheEvent('fill-skip:signed-out', { sermonId, mediaRefId: key.mediaRefId });
    return 'skipped-signed-out';
  }

  // Gilfoyle (S8 MUST-FIX 1): a request for the SAME key as the one already in flight is
  // a no-op, not a supersede — two fills for one key would share `partPath`, so the older
  // one's `discard()` could delete the newer one's `.part`, or the newer transfer could
  // overwrite the file the older one is about to move. Only a *different* key supersedes.
  if (inFlight && inFlight.mediaRefId === key.mediaRefId) {
    emitCacheEvent('fill-skip:already-in-flight', { sermonId, mediaRefId: key.mediaRefId });
    return 'skipped-already-in-flight';
  }

  // D16: a newer request for a different key supersedes whatever is already running.
  if (inFlight) {
    inFlight.cancelled = true;
    inFlight.cancel();
  }

  const myGeneration = generation;
  const partPath = paths.mediaCachePartPath(key.fileName);
  const finalPath = paths.mediaCacheFilePath(key.fileName);
  const self: InFlight = { sermonId, mediaRefId: key.mediaRefId, cancel: () => {}, cancelled: false, explicitlyCancelled: false };
  inFlight = self;

  const finish = (outcome: FillOutcome): FillOutcome => {
    if (inFlight === self) inFlight = null;
    return outcome;
  };
  const discard = async (outcome: FillOutcome, path: string = partPath): Promise<FillOutcome> => {
    await deps.fs.deleteFile(path).catch(() => {});
    return finish(outcome);
  };

  // P2: don't start a fill for a URL that's about to stop working anyway.
  if (expiresAt - deps.now() < STREAM_EXPIRY_MARGIN_MS) {
    emitCacheEvent('fill-skip:expired', { sermonId, mediaRefId: key.mediaRefId });
    return finish('skipped-expired');
  }

  // D4: the same Wi-Fi gate Downloads uses, never a second implementation of it.
  if (!(await deps.canStartDownload())) {
    emitCacheEvent('fill-skip:network', { sermonId, mediaRefId: key.mediaRefId });
    return finish('skipped-network');
  }

  // D15: absolute reserve floor. The dynamic "50% of quota" item skip lands in S5.
  const free = await deps.getFreeDiskStorage();
  if (free < FREE_SPACE_FLOOR_BYTES) {
    emitCacheEvent('fill-skip:disk-floor', { sermonId, mediaRefId: key.mediaRefId });
    return finish('skipped-disk-floor');
  }

  // S9 review (finding S3): nothing created this directory before — confirmed, not
  // assumed, via a repo-wide search. Idempotent (check-then-create), so a concurrent or
  // repeated call is harmless.
  await deps.fs.ensureDir(paths.mediaCacheDir());

  const { promise, cancel } = deps.transfer(url, partPath);
  self.cancel = cancel;
  // A cancellation can arrive in the window between `inFlight = self` above and here
  // (two awaits earlier), while `self.cancel` was still the no-op placeholder. Propagate
  // it now so the superseded transfer actually stops instead of running to completion
  // only to be discarded.
  if (self.cancelled) cancel();
  emitCacheEvent('fill-start', { sermonId, mediaRefId: key.mediaRefId });

  let contentLength: number | null;
  try {
    ({ contentLength } = await promise);
  } catch {
    return discard('discarded-error');
  }

  // Gilfoyle (S8 MUST-FIX 1): `cancelled` was previously checked only once, right here —
  // every await below (free-space, size-on-disk, rename, insert) was its own re-opened
  // window where a cancel or a wipe landing mid-fill got silently ignored and the fill
  // committed anyway. `isStale()` is re-checked before each one now.
  const isStale = (): boolean => self.cancelled || myGeneration !== generation;
  const staleOutcome = (): FillOutcome => (self.cancelled ? 'skipped-superseded' : 'discarded-error');

  if (isStale()) {
    return discard(staleOutcome());
  }

  // P4: fail closed. No declared size means no way to verify the file isn't truncated.
  if (contentLength === null) {
    return discard('discarded-missing-content-length');
  }

  // D15's per-item 50%-of-quota skip. This API exposes no size estimate ahead of a
  // download (no `MediaRef`/`StreamVariant` field carries one), so — despite the plan's
  // "no transfer started" framing for this check, which fits the free-space floor above,
  // not this one — the earliest it can actually fire is right here, immediately after
  // the transfer reports its declared size and before ever renaming the `.part` into
  // place. The bandwidth is already spent; this only avoids committing (and immediately
  // having to evict) something that was never going to fit.
  const quotaNow = computeQuota(await deps.getFreeDiskStorage(), await deps.manifestTotalBytes());
  if (isTooLargeForQuota(contentLength, quotaNow)) {
    return discard('skipped-too-large-for-quota');
  }

  if (isStale()) {
    return discard(staleOutcome());
  }

  const actualSize = await deps.fs.getSize(partPath);
  if (actualSize !== contentLength) {
    return discard('discarded-size-mismatch');
  }

  if (isStale()) {
    return discard(staleOutcome());
  }

  try {
    await deps.fs.moveFile(partPath, finalPath);
  } catch {
    return discard('discarded-error');
  }

  // P6: a wipe (or, now, a cancel) that landed while the transfer was in flight
  // invalidates this result. Past this point the file lives at `finalPath`, not
  // `partPath`, so any further discard must clean up there instead.
  if (isStale()) {
    return discard(staleOutcome(), finalPath);
  }

  const now = deps.now();
  try {
    await deps.manifestInsert({
      mediaRefId: key.mediaRefId,
      sermonId,
      fileName: key.fileName,
      sizeBytes: actualSize,
      lastAccessedAt: now,
      createdAt: now,
    });
  } catch {
    return discard('discarded-error', finalPath);
  }

  // Gilfoyle (S8 MUST-FIX 2, refined at re-check): re-checked once more, after the insert
  // itself — a wipe landing exactly inside that await must not leave a row (or file) that
  // survived it. Deliberately `myGeneration !== generation || self.explicitlyCancelled`,
  // not the full `isStale()`: a *different* key's fill superseding this one in the
  // meantime (which sets `self.cancelled` but NOT `explicitlyCancelled`) doesn't
  // retroactively invalidate a result that has already fully committed and is unrelated
  // to that other fill — but an explicit `cancelFill(sermonId)` for THIS exact sermon
  // (e.g. `dropSermonFromCache`'s "Downloads wins" path, S6) landing in this same window
  // must still undo the commit: Downloads just claimed this sermon, and a cache row/file
  // surviving that would contradict S6's whole point. The re-check's first pass caught
  // this correctly for cancellation-before-insert (`isStale()`, which does include
  // `self.cancelled`); this is specifically the gap for cancellation-during-insert.
  if (myGeneration !== generation || self.explicitlyCancelled) {
    await deps.manifestDeleteByKey(key.mediaRefId).catch(() => {});
    await deps.fs.deleteFile(finalPath).catch(() => {});
    return finish('discarded-error');
  }

  emitCacheEvent('fill-commit', { sermonId, mediaRefId: key.mediaRefId });

  // Evict down to quota immediately after committing — never undoes the commit even if
  // this fails (best-effort), and never evicts the entry that was just written, which
  // LRU recency alone wouldn't reliably protect (the pin only covers a *playing* entry,
  // and this fill may have landed after playback already stopped).
  const quotaAfter = computeQuota(await deps.getFreeDiskStorage(), await deps.manifestTotalBytes());
  await deps.evictToFit(quotaAfter, { protect: key.mediaRefId }).catch(() => {});

  return finish('committed');
}
