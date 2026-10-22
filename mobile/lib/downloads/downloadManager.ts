import * as FileSystem from 'expo-file-system';
import { api } from '../api/typedClient';
import { ApiError, networkError } from '../api/errors';
import * as RpaCrypto from '../../modules/rpa-crypto';
import { RpaCryptoError, type RpaEncryptResult } from '../../modules/rpa-crypto';
import * as db from './db';
import { getOrCreateInstallKey } from './installKey';
import { realCanStartDownload } from './network';
import * as paths from './paths';
import { dropSermonFromCache } from '../mediaCache/dropSermon';
import { AUDIO_HEADER_BYTES, audioExtensionFor, base64ToBytes } from './audioFormat';
import type { DownloadFailureReason, DownloadMediaType, DownloadRecord } from './types';

/**
 * The W4.5 download orchestrator — queue, fetch, encrypt, verify, and the offline
 * playback decrypt path. Every external effect (network, filesystem, native crypto, the
 * SQLite-backed state store, the SecureStore-backed key, and the Wi-Fi-only gate) is
 * injected via `DownloadManagerDeps`, defaulted to the real implementations in
 * `createDownloadManager()`'s signature — so this file's actual state-machine logic
 * (what happens on success, on each distinct failure, on retry, on a stale row found at
 * startup, on a corrupt/key-mismatched file at playback time) is unit-testable without a
 * device, per `__tests__/downloadManager.test.ts`.
 */

export interface DownloadManagerDeps {
  db: Pick<
    typeof db,
    | 'getDownload'
    | 'listDownloads'
    | 'listActiveDownloads'
    | 'upsertQueued'
    | 'markDownloading'
    | 'updateProgress'
    | 'markReady'
    | 'markFailed'
    | 'deleteDownload'
    | 'setThumbnailPath'
    | 'setDetailSnapshot'
    | 'getDetailSnapshot'
    | 'listReadyMissingDetail'
  >;
  crypto: {
    encryptFile: typeof RpaCrypto.encryptFile;
    decryptFile: typeof RpaCrypto.decryptFile;
    readHeaderInfo: typeof RpaCrypto.readHeaderInfo;
    excludeFromBackup: typeof RpaCrypto.excludeFromBackup;
  };
  paths: {
    encryptedFilePath: typeof paths.encryptedFilePath;
    videoFilePath: typeof paths.videoFilePath;
    thumbnailFilePath: typeof paths.thumbnailFilePath;
    tmpDownloadFilePath: typeof paths.tmpDownloadFilePath;
    tmpDownloadVideoFilePath: typeof paths.tmpDownloadVideoFilePath;
    playbackTempFilePath: typeof paths.playbackTempFilePath;
    partFilePath: typeof paths.partFilePath;
    downloadsDir: typeof paths.downloadsDir;
    downloadTmpDir: typeof paths.downloadTmpDir;
    playbackTmpDir: typeof paths.playbackTmpDir;
  };
  ensureDir: (dir: string) => Promise<void>;
  deleteFile: (uri: string) => Promise<void>;
  /** Deletes every file directly inside `dir` — see `paths.clearDirectoryContents`. */
  clearDirectory: (dir: string) => Promise<void>;
  getFileSize: (uri: string) => Promise<number>;
  /** Fetches the signed download URL for a sermon's audio or video rendition (whichever `mediaType` asks for). Rejects with `ApiError` on any HTTP/network failure, or a 409 if that sermon has no rendition of that type — this manager classifies that itself, callers don't need to. */
  fetchDownloadUrl: (sermonId: string, mediaType: DownloadMediaType) => Promise<string>;
  /** Streams `url` to `destPath`, reporting 0–1 progress. Rejects on any network failure (dropped connection, timeout, non-2xx). */
  downloadToFile: (url: string, destPath: string, onProgress: (progress: number) => void) => Promise<void>;
  getInstallKey: () => Promise<string>;
  /** True iff a download may start/resume right now (Wi-Fi-only is off, or the device is on Wi-Fi). */
  canStartDownload: () => Promise<boolean>;
  /** Plan S6, "Downloads wins": called once a download reaches `ready`, so a stale media-
   * cache entry for the same sermon never coexists with (or gets played ahead of) the real
   * download. Injected so this manager's own test suite stays isolated from the cache's
   * real SQLite/filesystem internals — a failure here must never fail the download. */
  onDownloadReady: (sermonId: string) => Promise<void>;
  /** Stops a `downloadToFile` transfer still writing to `destPath`, if there is one —
   * that transfer then rejects. A no-op for any path nothing is writing to. */
  cancelTransfer: (destPath: string) => void;
  /** `GET /catalog/sermons/{id}` — the `SermonDetail` saved with a download so the player
   * can open it offline. Rejects on any failure; callers treat it as best-effort. */
  fetchSermonDetail: (sermonId: string) => Promise<unknown>;
  /** The first `length` bytes of a local file. */
  readFileHead: (uri: string, length: number) => Promise<Uint8Array>;
  moveFile: (from: string, to: string) => Promise<void>;
}

/** How many downloads transfer at once. "Download all" on a long series otherwise opened
 * one connection per episode, which is slower overall and fails more on weak networks;
 * the rest wait `queued` and start as slots free up. */
export const MAX_CONCURRENT_DOWNLOADS = 2;

/** Transfers `realDownloadToFile` has in flight, by destination — what `cancelTransfer`
 * reaches into, so `downloadToFile`'s own contract can stay a plain promise. */
const activeTransfers = new Map<string, FileSystem.DownloadResumable>();

async function realDownloadToFile(url: string, destPath: string, onProgress: (progress: number) => void): Promise<void> {
  const resumable = FileSystem.createDownloadResumable(url, destPath, {}, (data) => {
    if (data.totalBytesExpectedToWrite > 0) {
      onProgress(data.totalBytesWritten / data.totalBytesExpectedToWrite);
    }
  });
  activeTransfers.set(destPath, resumable);
  let result: FileSystem.FileSystemDownloadResult | undefined;
  try {
    result = await resumable.downloadAsync();
  } finally {
    if (activeTransfers.get(destPath) === resumable) activeTransfers.delete(destPath);
  }
  if (!result) {
    throw new Error('Download was cancelled');
  }
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(result.status, `Download failed (HTTP ${result.status})`);
  }
}

async function realReadFileHead(uri: string, length: number): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length,
  });
  return base64ToBytes(base64);
}

async function realMoveFile(from: string, to: string): Promise<void> {
  await FileSystem.moveAsync({ from, to });
}

async function realFetchSermonDetail(sermonId: string): Promise<unknown> {
  return api.get('/catalog/sermons/{sermon_id}', { params: { path: { sermon_id: sermonId } } });
}

function realCancelTransfer(destPath: string): void {
  activeTransfers.get(destPath)?.cancelAsync().catch(() => {});
}

async function realFetchDownloadUrl(sermonId: string, mediaType: DownloadMediaType): Promise<string> {
  try {
    const response =
      mediaType === 'video'
        ? await api.get('/sermons/{sermon_id}/download/video', { params: { path: { sermon_id: sermonId } } })
        : await api.get('/sermons/{sermon_id}/download/audio', { params: { path: { sermon_id: sermonId } } });
    return response.url;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw networkError();
  }
}

function defaultDeps(): DownloadManagerDeps {
  return {
    db,
    crypto: {
      encryptFile: RpaCrypto.encryptFile,
      decryptFile: RpaCrypto.decryptFile,
      readHeaderInfo: RpaCrypto.readHeaderInfo,
      excludeFromBackup: RpaCrypto.excludeFromBackup,
    },
    paths,
    ensureDir: paths.ensureDir,
    deleteFile: paths.deleteIfExists,
    clearDirectory: paths.clearDirectoryContents,
    getFileSize: async (uri: string) => {
      const info = await FileSystem.getInfoAsync(uri, { size: true });
      return info.exists && !info.isDirectory ? (info.size ?? 0) : 0;
    },
    fetchDownloadUrl: realFetchDownloadUrl,
    downloadToFile: realDownloadToFile,
    getInstallKey: getOrCreateInstallKey,
    canStartDownload: realCanStartDownload,
    onDownloadReady: dropSermonFromCache,
    cancelTransfer: realCancelTransfer,
    fetchSermonDetail: realFetchSermonDetail,
    readFileHead: realReadFileHead,
    moveFile: realMoveFile,
  };
}

/** Thrown by `preparePlaybackFile` — always catchable, never an unhandled crash (plan W4.5: "key loss degrades to re-download, never a crash"). */
export class PlaybackUnavailableError extends Error {
  readonly reason: DownloadFailureReason;

  constructor(reason: DownloadFailureReason, message: string) {
    super(message);
    this.name = 'PlaybackUnavailableError';
    this.reason = reason;
  }
}

function classifyStartError(
  err: unknown,
  mediaType: DownloadMediaType,
): { reason: DownloadFailureReason; message: string } {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return mediaType === 'video'
        ? { reason: 'no_video', message: "This sermon doesn't have a video version available to download." }
        : { reason: 'no_audio', message: "This sermon doesn't have an audio version available to download." };
    }
    if (err.network) {
      return { reason: 'network', message: 'Could not reach the server. Check your connection and retry.' };
    }
    return { reason: 'network', message: err.message };
  }
  if (err instanceof RpaCryptoError) {
    return { reason: 'encryption', message: 'Something went wrong encrypting this download. Retry.' };
  }
  const message = err instanceof Error ? err.message : 'Something went wrong. Retry.';
  return { reason: 'unknown', message };
}

/**
 * Maps a `decryptFile` rejection at playback time to the exact `PlaybackUnavailableError`
 * the UI needs — every branch below also flips the DB row so the next list render
 * already reflects "this needs a re-download", not just this one playback attempt.
 */
async function handlePlaybackDecryptError(
  deps: DownloadManagerDeps,
  sermonId: string,
  encryptedPath: string,
  err: unknown,
): Promise<never> {
  if (err instanceof RpaCryptoError) {
    if (err.code === 'E_RPA1_KEY_MISMATCH') {
      await deps.deleteFile(encryptedPath);
      await deps.db.markFailed(
        sermonId,
        'key_lost',
        'Your download key changed (reinstall or app data cleared). Re-download to listen offline again.',
      );
      throw new PlaybackUnavailableError('key_lost', 'Your download key changed. Re-download to listen offline again.');
    }
    // Every other RPA1 code (bad magic, unsupported version/algorithm, truncated, auth
    // failure) means the file on disk is not a valid, intact RPA1 file — "half-written
    // (or otherwise damaged) file never plays as garbage": always reject, never hand back
    // a path, and always degrade to "needs a re-download".
    await deps.deleteFile(encryptedPath);
    await deps.db.markFailed(sermonId, 'corrupt', 'The downloaded file was damaged. Re-download to listen offline again.');
    throw new PlaybackUnavailableError('corrupt', 'The downloaded file was damaged. Re-download to listen offline again.');
  }
  await deps.db.markFailed(sermonId, 'unknown', 'Could not prepare this download for playback. Retry.');
  throw new PlaybackUnavailableError('unknown', 'Could not prepare this download for playback. Retry.');
}

/** One `runDownload` attempt in progress. `removed` is set when the user deletes the
 * download mid-attempt, so the attempt cleans up whatever it writes after that point
 * instead of leaving an untracked file behind (or marking a re-queued row ready). */
interface ActiveRun {
  removed: boolean;
  /** Set when the Wi-Fi-only gate closes mid-transfer (Wi-Fi dropped to mobile data): the
   * cancelled attempt goes back to `queued` instead of `failed`, and resumes on Wi-Fi. */
  requeue: boolean;
}

export function createDownloadManager(overrides: Partial<DownloadManagerDeps> = {}) {
  const deps: DownloadManagerDeps = { ...defaultDeps(), ...overrides };

  /** At most one attempt per sermon. Several `useDownloads()` instances (every episode row
   * on a series page has one) each call `resumeQueuedDownloads` on the same Wi-Fi event,
   * and without this they would all start the same queued row, writing one tmp file at
   * once. */
  const activeRuns = new Map<string, ActiveRun>();
  /** Sermons deleted and then downloaded again while their old attempt was still winding
   * down — restarted from a clean slate once that attempt settles. */
  const restartAfterRun = new Set<string>();

  let runningTransfers = 0;
  const slotWaiters: (() => void)[] = [];
  function acquireSlot(): Promise<void> {
    if (runningTransfers < MAX_CONCURRENT_DOWNLOADS) {
      runningTransfers += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => slotWaiters.push(resolve));
  }
  function releaseSlot(): void {
    const next = slotWaiters.shift();
    if (next) next();
    else runningTransfers -= 1;
  }

  /** A failed attempt normally lands on `failed`; one cancelled because the Wi-Fi gate
   * closed goes back to `queued` with its metadata intact, to resume on Wi-Fi. */
  async function failOrRequeue(sermonId: string, run: ActiveRun, reason: DownloadFailureReason, message: string): Promise<void> {
    if (run.requeue) {
      const existing = await deps.db.getDownload(sermonId);
      if (existing) {
        await deps.db.upsertQueued(sermonId, existing.title, existing.mediaType, existing.thumbnailUrl, existing.category);
        return;
      }
    }
    await deps.db.markFailed(sermonId, reason, message);
  }

  /** Best-effort, like the thumbnail: saves the sermon's `SermonDetail` on its row so the
   * player can open it with no network (see `offlineDetails.ts`). A failure only means
   * the backfill tries again next launch. */
  async function saveDetailBestEffort(sermonId: string): Promise<void> {
    try {
      const detail = await deps.fetchSermonDetail(sermonId);
      await deps.db.setDetailSnapshot(sermonId, JSON.stringify(detail));
    } catch {
      // swallowed — see above
    }
  }

  /** Every file a download of `sermonId` can leave on disk, whatever its media type. */
  async function deleteArtifacts(sermonId: string): Promise<void> {
    await deps.deleteFile(deps.paths.encryptedFilePath(sermonId));
    await deps.deleteFile(deps.paths.partFilePath(deps.paths.encryptedFilePath(sermonId)));
    await deps.deleteFile(deps.paths.tmpDownloadFilePath(sermonId));
    await deps.deleteFile(deps.paths.videoFilePath(sermonId));
    await deps.deleteFile(deps.paths.tmpDownloadVideoFilePath(sermonId));
    await deps.deleteFile(deps.paths.thumbnailFilePath(sermonId));
  }

  /** Session 2026-10-15 fix for the 6h-expiring presigned `thumbnail_url` going blank/403
   * on a sermon that's sat `ready` for a while — fetches a local, permanent copy once the
   * media download itself has already settled. Best-effort only (same convention as
   * `excludeFromBackup`/`onDownloadReady` above) — a failure here just means the UI keeps
   * showing the original, eventually-expiring `thumbnailUrl` instead of a local copy. Must
   * never fail the download itself. Deletes any stale file at the destination first (never
   * resumes/appends onto a prior attempt, same reasoning as the tmp-file deletes above).
   *
   * Reviewer-gilfoyle-found race (session 2026-10-15 fix): nothing gates `deleteDownload`
   * on download state, so it can run concurrently with this function's own network-I/O
   * await. If the row is deleted while the thumbnail fetch is still in flight,
   * `deleteDownload`'s own `deleteFile(thumbnailFilePath)` no-ops (the file doesn't exist
   * yet) and then removes the row — then this function's `downloadToFile` finishes and
   * writes the file anyway. `setThumbnailPath`'s boolean return (`changes > 0`) is how this
   * detects that: `false` means the row is already gone, so the just-written file is
   * untracked by anything and must be deleted here rather than orphaned forever. */
  async function fetchThumbnailBestEffort(sermonId: string, thumbnailUrl: string | null): Promise<void> {
    if (!thumbnailUrl) return;
    const path = deps.paths.thumbnailFilePath(sermonId);
    try {
      await deps.deleteFile(path);
      await deps.downloadToFile(thumbnailUrl, path, () => {});
      const rowStillExists = await deps.db.setThumbnailPath(sermonId, path);
      if (!rowStillExists) {
        await deps.deleteFile(path);
      }
    } catch {
      await deps.deleteFile(path).catch(() => {});
    }
  }

  async function runAudioDownload(sermonId: string, thumbnailUrl: string | null, run: ActiveRun): Promise<void> {
    const tmpPath = deps.paths.tmpDownloadFilePath(sermonId);
    const encryptedPath = deps.paths.encryptedFilePath(sermonId);

    try {
      await deps.ensureDir(deps.paths.downloadTmpDir());
      await deps.ensureDir(deps.paths.downloadsDir());
      await deps.db.markDownloading(sermonId);

      const url = await deps.fetchDownloadUrl(sermonId, 'audio');

      await deps.deleteFile(tmpPath); // never resume a stale partial plaintext file — always a clean fetch
      await deps.downloadToFile(url, tmpPath, (progress) => {
        // Reserve the last 10% of the visible bar for the encrypt pass, which reports no
        // incremental progress of its own (the native module streams file-to-file in one
        // call) — this keeps the bar from appearing to "finish" before encryption starts.
        void deps.db.updateProgress(sermonId, progress * 0.9);
      });

      const installKey = await deps.getInstallKey();
      const encryptResult: RpaEncryptResult = await deps.crypto.encryptFile(tmpPath, encryptedPath, installKey);
      await deps.deleteFile(tmpPath);

      // Cheap post-write sanity check — the native module's own atomic `.part`-then-
      // rename already guarantees `encryptedPath` is never half-written, but this proves
      // the bytes that landed there actually parse as a valid RPA1 header before the row
      // is ever marked `ready`, rather than trusting the encrypt call's return value alone.
      await deps.crypto.readHeaderInfo(encryptedPath);
      await deps.crypto.excludeFromBackup(encryptedPath).catch(() => false); // advisory only, never gates success

      const bytesTotal = await deps.getFileSize(encryptedPath);
      if (run.removed) {
        await deleteArtifacts(sermonId);
        return;
      }
      await deps.db.markReady(sermonId, { bytesTotal, keyIdHex: encryptResult.keyIdHex });
      await deps.onDownloadReady(sermonId).catch(() => {});
      await fetchThumbnailBestEffort(sermonId, thumbnailUrl);
      await saveDetailBestEffort(sermonId);
      if (run.removed) await deleteArtifacts(sermonId);
    } catch (err) {
      if (run.removed) {
        await deleteArtifacts(sermonId);
        return;
      }
      await deps.deleteFile(tmpPath);
      // A kill strictly mid-native-encrypt leaves `encryptedPath + '.part'` behind (the
      // native module's own atomic-write staging file) — never the final path itself
      // (that only exists after a successful rename), but the `.part` companion is real
      // and needs the same cleanup or it leaks forever.
      await deps.deleteFile(deps.paths.partFilePath(encryptedPath));
      const { reason, message } = classifyStartError(err, 'audio');
      await failOrRequeue(sermonId, run, reason, message);
    }
  }

  /**
   * Video's own, simpler path (Isaac's ask, session 2026-10-08): no encrypt pass, no RPA1
   * header, no install key — a plain fetch straight into a tmp file, then an atomic rename
   * into its final `videoFilePath` once the transfer completes in full. The file that lands
   * there has only the OS's own file protection, by design (see `types.ts`'s own doc
   * comment on `DownloadMediaType`) — `expo-video` reads it directly off disk, so there is
   * no decrypt-to-temp step at playback time either (`preparePlaybackFile` below just
   * hands back this same path).
   */
  async function runVideoDownload(sermonId: string, thumbnailUrl: string | null, run: ActiveRun): Promise<void> {
    const tmpPath = deps.paths.tmpDownloadVideoFilePath(sermonId);
    const finalPath = deps.paths.videoFilePath(sermonId);

    try {
      await deps.ensureDir(deps.paths.downloadTmpDir());
      await deps.ensureDir(deps.paths.downloadsDir());
      await deps.db.markDownloading(sermonId);

      const url = await deps.fetchDownloadUrl(sermonId, 'video');

      await deps.deleteFile(tmpPath); // never resume a stale partial file — always a clean fetch
      await deps.downloadToFile(url, tmpPath, (progress) => {
        void deps.db.updateProgress(sermonId, progress);
      });

      // `expo-file-system`'s own move is the atomic rename — the same "never a half-written
      // file at the final path" guarantee audio gets from the native module's `.part`-then-
      // rename, just via the platform's own primitive instead of a custom one, since there's
      // no encrypt step here to stage behind a companion file.
      await FileSystem.moveAsync({ from: tmpPath, to: finalPath });

      const bytesTotal = await deps.getFileSize(finalPath);
      if (run.removed) {
        await deleteArtifacts(sermonId);
        return;
      }
      await deps.db.markReady(sermonId, { bytesTotal, keyIdHex: null });
      await deps.onDownloadReady(sermonId).catch(() => {});
      await fetchThumbnailBestEffort(sermonId, thumbnailUrl);
      await saveDetailBestEffort(sermonId);
      if (run.removed) await deleteArtifacts(sermonId);
    } catch (err) {
      if (run.removed) {
        await deleteArtifacts(sermonId);
        return;
      }
      await deps.deleteFile(tmpPath);
      await deps.deleteFile(finalPath); // a failed moveAsync can still leave a partial file at the destination
      const { reason, message } = classifyStartError(err, 'video');
      await failOrRequeue(sermonId, run, reason, message);
    }
  }

  async function runDownload(sermonId: string, mediaType: DownloadMediaType, thumbnailUrl: string | null): Promise<void> {
    // Checked and claimed in one synchronous step, so two callers can't both start.
    if (activeRuns.has(sermonId)) return;
    const run: ActiveRun = { removed: false, requeue: false };
    activeRuns.set(sermonId, run);
    try {
      // Waits `queued` for a free slot (MAX_CONCURRENT_DOWNLOADS).
      await acquireSlot();
      try {
        if (run.removed) return;
        // Checked once the slot is ours, not before: the network can change while a row
        // waits its turn.
        if (!(await deps.canStartDownload())) {
          // Stays `queued` — the UI reads this as "waiting for Wi-Fi", not a failure. See
          // `useDownloads.ts` for the resume-on-reconnect trigger.
          return;
        }
        if (mediaType === 'video') await runVideoDownload(sermonId, thumbnailUrl, run);
        else await runAudioDownload(sermonId, thumbnailUrl, run);
      } finally {
        releaseSlot();
      }
    } finally {
      activeRuns.delete(sermonId);
      if (restartAfterRun.delete(sermonId)) void retryDownload(sermonId).catch(() => {});
    }
  }

  /**
   * No-op if a download for this sermon already exists in any non-terminal-failure state
   * (`ready`/`queued`/`downloading`) — only a fresh or previously-`failed` row actually
   * starts a new attempt. A previously-`failed` row goes through the exact same
   * clean-slate restart as `retryDownload` (stale tmp/encrypted/`.part` files deleted
   * first) — this function is the only other path (besides the Retry button) that can
   * restart a failed download, and it must not skip that cleanup just because it took a
   * different name.
   */
  async function enqueueDownload(
    sermonId: string,
    title: string,
    mediaType: DownloadMediaType,
    thumbnailUrl: string | null = null,
    category: string | null = null,
  ): Promise<void> {
    const existing = await deps.db.getDownload(sermonId);
    if (!existing) {
      await deps.db.upsertQueued(sermonId, title, mediaType, thumbnailUrl, category);
      if (activeRuns.has(sermonId)) {
        // Deleted moments ago and its old attempt hasn't settled — start once it has.
        restartAfterRun.add(sermonId);
        return;
      }
      await runDownload(sermonId, mediaType, thumbnailUrl);
      return;
    }
    if (existing.state === 'failed') {
      await retryDownload(sermonId);
    }
  }

  /** Always restarts from a clean slate — deletes any stale tmp/encrypted/video file first, so a corrupt or partial artifact from the failed attempt is never reused. `mediaType`, `thumbnailUrl` and `category` all come from the existing row, not a caller argument — a sermon's rendition is fixed at first enqueue (see `db.upsertQueued`'s own doc comment), and reusing the row's own last-known thumbnail/category here (rather than defaulting to `upsertQueued`'s own `null` default) is what stops a retry from blanking out art/category a successful first attempt already recorded. */
  async function retryDownload(sermonId: string): Promise<void> {
    const existing = await deps.db.getDownload(sermonId);
    if (!existing) return;
    // Never delete files out from under an attempt that is still writing them.
    if (activeRuns.has(sermonId)) {
      restartAfterRun.add(sermonId);
      return;
    }

    if (existing.mediaType === 'video') {
      await deps.deleteFile(deps.paths.tmpDownloadVideoFilePath(sermonId));
      await deps.deleteFile(deps.paths.videoFilePath(sermonId));
    } else {
      await deps.deleteFile(deps.paths.tmpDownloadFilePath(sermonId));
      await deps.deleteFile(deps.paths.encryptedFilePath(sermonId));
      await deps.deleteFile(deps.paths.partFilePath(deps.paths.encryptedFilePath(sermonId)));
    }
    await deps.db.upsertQueued(sermonId, existing.title, existing.mediaType, existing.thumbnailUrl, existing.category);
    await runDownload(sermonId, existing.mediaType, existing.thumbnailUrl);
  }

  /** Also the cancel path: deleting a `queued`/`downloading` row stops its transfer and
   * makes the attempt clean up anything it still writes. */
  async function deleteDownload(sermonId: string): Promise<void> {
    const run = activeRuns.get(sermonId);
    if (run) {
      run.removed = true;
      restartAfterRun.delete(sermonId);
      deps.cancelTransfer(deps.paths.tmpDownloadFilePath(sermonId));
      deps.cancelTransfer(deps.paths.tmpDownloadVideoFilePath(sermonId));
      deps.cancelTransfer(deps.paths.thumbnailFilePath(sermonId));
    }
    // Both file sets, unconditionally, rather than looking the record up first to branch on
    // `mediaType` — `deleteFile` is already a tolerant no-op on a path that doesn't exist
    // (see `paths.deleteIfExists`), so deleting the shape this sermon's rendition isn't is
    // free, and this stays correct even if a row's own `media_type` is ever missing/stale.
    await deleteArtifacts(sermonId);
    await deps.db.deleteDownload(sermonId);
  }

  /** Called on every network change: if Wi-Fi-only is on and the device just left Wi-Fi,
   * stops the transfers in flight and puts them back to `queued`, so they don't carry on
   * over mobile data. They resume on the next Wi-Fi connection like any queued row. */
  async function pauseIfGateClosed(): Promise<void> {
    if (activeRuns.size === 0) return;
    if (await deps.canStartDownload()) return;
    for (const [sermonId, run] of activeRuns) {
      run.requeue = true;
      deps.cancelTransfer(deps.paths.tmpDownloadFilePath(sermonId));
      deps.cancelTransfer(deps.paths.tmpDownloadVideoFilePath(sermonId));
    }
  }

  /** The saved `SermonDetail` for a downloaded sermon, or `null` if none was saved (or it
   * no longer parses). */
  async function getDetailSnapshot(sermonId: string): Promise<unknown> {
    const json = await deps.db.getDetailSnapshot(sermonId);
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  /** Saves a `SermonDetail` for every `ready` download that predates them. Best-effort and
   * one at a time; offline it simply finds nothing to save and tries again next launch. */
  async function backfillDetailSnapshots(): Promise<void> {
    const missing = await deps.db.listReadyMissingDetail();
    for (const sermonId of missing) {
      await saveDetailBestEffort(sermonId);
    }
  }

  async function listDownloads(): Promise<DownloadRecord[]> {
    return deps.db.listDownloads();
  }

  async function getDownload(sermonId: string): Promise<DownloadRecord | null> {
    return deps.db.getDownload(sermonId);
  }

  /**
   * Re-attempts every `queued` row — called on app start, whenever the Wi-Fi-only
   * preference is turned off, and whenever the device reconnects to Wi-Fi (see
   * `useDownloads.ts`). A row that's `queued` purely because it's still waiting its turn
   * (there is no separate concurrency cap in this v1 — see the status entry's notes) is
   * safe to re-attempt too: `runDownload` re-checks the Wi-Fi gate itself and is a no-op
   * if it's still not satisfied.
   */
  async function resumeQueuedDownloads(): Promise<void> {
    const all = await deps.db.listDownloads();
    for (const record of all) {
      if (record.state === 'queued') {
        await runDownload(record.sermonId, record.mediaType, record.thumbnailUrl);
      }
    }
  }

  /**
   * Reconciles rows left `downloading` by a process that never got to finish them
   * (killed, crashed, force-quit mid-transfer) — called once at app start, before
   * anything else touches the downloads table. Any partial plaintext, partial encrypted
   * file, or stray native `.part` staging file for these rows is deleted; the row is
   * marked `failed`/`interrupted` with a Retry-able reason, never left silently
   * "downloading" forever or, worse, treated as `ready`. A `queued` row never started a
   * transfer (it is waiting for Wi-Fi, or for its turn), so it is left queued for
   * `resumeQueuedDownloads` rather than failed — failing it turned every "waiting for
   * Wi-Fi" download into an "interrupted" error on the next launch. Also unconditionally clears the
   * entire playback-temp directory — every file there is a single-session artifact by
   * construction (see `paths.playbackTempFilePath`), so a crash during a previous offline
   * playback session can otherwise leave a plaintext file behind indefinitely.
   */
  async function startupSweep(): Promise<void> {
    const stale = (await deps.db.listActiveDownloads()).filter((record) => record.state === 'downloading');
    for (const record of stale) {
      if (record.mediaType === 'video') {
        await deps.deleteFile(deps.paths.tmpDownloadVideoFilePath(record.sermonId));
        await deps.deleteFile(deps.paths.videoFilePath(record.sermonId));
      } else {
        const encryptedPath = deps.paths.encryptedFilePath(record.sermonId);
        await deps.deleteFile(deps.paths.tmpDownloadFilePath(record.sermonId));
        await deps.deleteFile(encryptedPath);
        await deps.deleteFile(deps.paths.partFilePath(encryptedPath));
      }
      await deps.db.markFailed(record.sermonId, 'interrupted', 'The download was interrupted. Tap Retry to try again.');
    }
    await deps.clearDirectory(deps.paths.playbackTmpDir());
  }

  /**
   * For audio: decrypts a `ready` download to a fresh, randomly-named temp plaintext file
   * for playback (path A, per the architect's writeup) and returns its `file://` path.
   * Every failure mode — not ready yet, key loss, a corrupt/tampered file — rejects with a
   * typed `PlaybackUnavailableError` and leaves the download row pointing at "needs a
   * re-download", never returns a path to anything that isn't fully verified plaintext.
   *
   * For video: there's nothing to decrypt (see `types.ts`'s own doc comment on
   * `DownloadMediaType`) — this just hands back `videoFilePath` directly, after confirming
   * the file is actually there and non-empty. Callers still don't need to know which kind
   * of record they played before calling `cleanupPlaybackTempFile` afterward: that function
   * only ever deletes a path under the playback-temp directory, so handing it this video
   * path back is a safe no-op rather than deleting the user's actual download.
   */
  async function preparePlaybackFile(sermonId: string): Promise<string> {
    const record = await deps.db.getDownload(sermonId);
    if (!record || record.state !== 'ready') {
      throw new PlaybackUnavailableError('unknown', 'This download is not ready to play yet.');
    }

    if (record.mediaType === 'video') {
      const videoPath = deps.paths.videoFilePath(sermonId);
      const size = await deps.getFileSize(videoPath);
      if (size <= 0) {
        await deps.db.markFailed(sermonId, 'corrupt', 'The downloaded file was damaged. Re-download to watch offline again.');
        throw new PlaybackUnavailableError('corrupt', 'The downloaded file was damaged. Re-download to watch offline again.');
      }
      return videoPath;
    }

    const installKey = await deps.getInstallKey();
    const encryptedPath = deps.paths.encryptedFilePath(sermonId);
    const outPath = deps.paths.playbackTempFilePath(sermonId);

    try {
      await deps.ensureDir(deps.paths.playbackTmpDir());
      await deps.crypto.decryptFile(encryptedPath, outPath, installKey);
    } catch (err) {
      return handlePlaybackDecryptError(deps, sermonId, encryptedPath, err);
    }

    // iOS only plays a local file whose extension names its format, and `outPath` ends in
    // `.pcm-tmp` — every downloaded audio sermon failed to play on iPhone. Give the
    // decrypted copy the extension its own header says (see `audioFormat.ts`).
    try {
      const ext = audioExtensionFor(await deps.readFileHead(outPath, AUDIO_HEADER_BYTES));
      const playablePath = `${outPath}.${ext}`;
      await deps.moveFile(outPath, playablePath);
      return playablePath;
    } catch {
      await deps.deleteFile(outPath).catch(() => {});
      throw new PlaybackUnavailableError('unknown', 'Could not prepare this download for playback. Retry.');
    }
  }

  /** Deletes `path` only if it's actually under the playback-temp directory — i.e. only
   * audio's path-A decrypted copy, never a real persisted file like video's own
   * `videoFilePath` (which `preparePlaybackFile` hands back directly, with no temp copy
   * made). Called once at app start (a crash during path A's playback can otherwise leave
   * a plaintext file behind indefinitely) and whenever playback stops or the track
   * changes. */
  async function cleanupPlaybackTempFile(path: string): Promise<void> {
    if (!path.startsWith(deps.paths.playbackTmpDir())) return;
    await deps.deleteFile(path);
  }

  return {
    enqueueDownload,
    retryDownload,
    deleteDownload,
    listDownloads,
    getDownload,
    resumeQueuedDownloads,
    pauseIfGateClosed,
    getDetailSnapshot,
    backfillDetailSnapshots,
    startupSweep,
    preparePlaybackFile,
    cleanupPlaybackTempFile,
  };
}

export type DownloadManager = ReturnType<typeof createDownloadManager>;

/** The singleton the app actually uses — wired to every real dependency. Tests use `createDownloadManager(fakes)` instead. */
export const downloadManager = createDownloadManager();
