import * as FileSystem from 'expo-file-system';
import { api } from '../api/typedClient';
import { ApiError, networkError } from '../api/errors';
import * as RpaCrypto from '../../modules/rpa-crypto';
import { RpaCryptoError, type RpaEncryptResult } from '../../modules/rpa-crypto';
import * as db from './db';
import { getOrCreateInstallKey } from './installKey';
import { canStartDownload as networkCanStartDownload } from './network';
import { loadDownloadPreferences } from '../settings/downloadPreferences';
import * as paths from './paths';
import type { DownloadFailureReason, DownloadRecord } from './types';

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
  >;
  crypto: {
    encryptFile: typeof RpaCrypto.encryptFile;
    decryptFile: typeof RpaCrypto.decryptFile;
    readHeaderInfo: typeof RpaCrypto.readHeaderInfo;
    excludeFromBackup: typeof RpaCrypto.excludeFromBackup;
  };
  paths: {
    encryptedFilePath: typeof paths.encryptedFilePath;
    tmpDownloadFilePath: typeof paths.tmpDownloadFilePath;
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
  /** Fetches the signed audio URL for a sermon. Rejects with `ApiError` on any HTTP/network failure — this manager classifies that itself, callers don't need to. */
  fetchAudioUrl: (sermonId: string) => Promise<string>;
  /** Streams `url` to `destPath`, reporting 0–1 progress. Rejects on any network failure (dropped connection, timeout, non-2xx). */
  downloadToFile: (url: string, destPath: string, onProgress: (progress: number) => void) => Promise<void>;
  getInstallKey: () => Promise<string>;
  /** True iff a download may start/resume right now (Wi-Fi-only is off, or the device is on Wi-Fi). */
  canStartDownload: () => Promise<boolean>;
}

async function realDownloadToFile(url: string, destPath: string, onProgress: (progress: number) => void): Promise<void> {
  const resumable = FileSystem.createDownloadResumable(url, destPath, {}, (data) => {
    if (data.totalBytesExpectedToWrite > 0) {
      onProgress(data.totalBytesWritten / data.totalBytesExpectedToWrite);
    }
  });
  const result = await resumable.downloadAsync();
  if (!result) {
    throw new Error('Download was cancelled');
  }
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(result.status, `Download failed (HTTP ${result.status})`);
  }
}

async function realFetchAudioUrl(sermonId: string): Promise<string> {
  try {
    const response = await api.get('/sermons/{sermon_id}/download/audio', {
      params: { path: { sermon_id: sermonId } },
    });
    return response.url;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw networkError();
  }
}

async function realCanStartDownload(): Promise<boolean> {
  const prefs = await loadDownloadPreferences();
  return networkCanStartDownload(prefs.wifiOnly);
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
    fetchAudioUrl: realFetchAudioUrl,
    downloadToFile: realDownloadToFile,
    getInstallKey: getOrCreateInstallKey,
    canStartDownload: realCanStartDownload,
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

function classifyStartError(err: unknown): { reason: DownloadFailureReason; message: string } {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return { reason: 'no_audio', message: "This sermon doesn't have an audio version available to download." };
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

export function createDownloadManager(overrides: Partial<DownloadManagerDeps> = {}) {
  const deps: DownloadManagerDeps = { ...defaultDeps(), ...overrides };

  async function runDownload(sermonId: string): Promise<void> {
    const canStart = await deps.canStartDownload();
    if (!canStart) {
      // Stays `queued` — the UI reads this as "waiting for Wi-Fi", not a failure. See
      // `useDownloads.ts` for the resume-on-reconnect trigger.
      return;
    }

    const tmpPath = deps.paths.tmpDownloadFilePath(sermonId);
    const encryptedPath = deps.paths.encryptedFilePath(sermonId);

    try {
      await deps.ensureDir(deps.paths.downloadTmpDir());
      await deps.ensureDir(deps.paths.downloadsDir());
      await deps.db.markDownloading(sermonId);

      const url = await deps.fetchAudioUrl(sermonId);

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
      await deps.db.markReady(sermonId, { bytesTotal, keyIdHex: encryptResult.keyIdHex });
    } catch (err) {
      await deps.deleteFile(tmpPath);
      // A kill strictly mid-native-encrypt leaves `encryptedPath + '.part'` behind (the
      // native module's own atomic-write staging file) — never the final path itself
      // (that only exists after a successful rename), but the `.part` companion is real
      // and needs the same cleanup or it leaks forever.
      await deps.deleteFile(deps.paths.partFilePath(encryptedPath));
      const { reason, message } = classifyStartError(err);
      await deps.db.markFailed(sermonId, reason, message);
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
  async function enqueueDownload(sermonId: string, title: string): Promise<void> {
    const existing = await deps.db.getDownload(sermonId);
    if (!existing) {
      await deps.db.upsertQueued(sermonId, title);
      await runDownload(sermonId);
      return;
    }
    if (existing.state === 'failed') {
      await retryDownload(sermonId);
    }
  }

  /** Always restarts from a clean slate — deletes any stale tmp/encrypted file first, so a corrupt or partial artifact from the failed attempt is never reused. */
  async function retryDownload(sermonId: string): Promise<void> {
    const existing = await deps.db.getDownload(sermonId);
    if (!existing) return;

    await deps.deleteFile(deps.paths.tmpDownloadFilePath(sermonId));
    await deps.deleteFile(deps.paths.encryptedFilePath(sermonId));
    await deps.deleteFile(deps.paths.partFilePath(deps.paths.encryptedFilePath(sermonId)));
    await deps.db.upsertQueued(sermonId, existing.title);
    await runDownload(sermonId);
  }

  async function deleteDownload(sermonId: string): Promise<void> {
    await deps.deleteFile(deps.paths.encryptedFilePath(sermonId));
    await deps.deleteFile(deps.paths.partFilePath(deps.paths.encryptedFilePath(sermonId)));
    await deps.deleteFile(deps.paths.tmpDownloadFilePath(sermonId));
    await deps.db.deleteDownload(sermonId);
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
        await runDownload(record.sermonId);
      }
    }
  }

  /**
   * Reconciles rows left in `queued`/`downloading` by a process that never got to finish
   * them (killed, crashed, force-quit mid-transfer) — called once at app start, before
   * anything else touches the downloads table. Any partial plaintext, partial encrypted
   * file, or stray native `.part` staging file for these rows is deleted; the row is
   * marked `failed`/`interrupted` with a Retry-able reason, never left silently
   * "downloading" forever or, worse, treated as `ready`. Also unconditionally clears the
   * entire playback-temp directory — every file there is a single-session artifact by
   * construction (see `paths.playbackTempFilePath`), so a crash during a previous offline
   * playback session can otherwise leave a plaintext file behind indefinitely.
   */
  async function startupSweep(): Promise<void> {
    const stale = await deps.db.listActiveDownloads();
    for (const record of stale) {
      const encryptedPath = deps.paths.encryptedFilePath(record.sermonId);
      await deps.deleteFile(deps.paths.tmpDownloadFilePath(record.sermonId));
      await deps.deleteFile(encryptedPath);
      await deps.deleteFile(deps.paths.partFilePath(encryptedPath));
      await deps.db.markFailed(record.sermonId, 'interrupted', 'The download was interrupted. Tap Retry to try again.');
    }
    await deps.clearDirectory(deps.paths.playbackTmpDir());
  }

  /**
   * Decrypts a `ready` download to a fresh, randomly-named temp plaintext file for
   * playback (path A, per the architect's writeup) and returns its `file://` path. Every
   * failure mode — not ready yet, key loss, a corrupt/tampered file — rejects with a
   * typed `PlaybackUnavailableError` and leaves the download row pointing at "needs a
   * re-download", never returns a path to anything that isn't fully verified plaintext.
   */
  async function preparePlaybackFile(sermonId: string): Promise<string> {
    const record = await deps.db.getDownload(sermonId);
    if (!record || record.state !== 'ready') {
      throw new PlaybackUnavailableError('unknown', 'This download is not ready to play yet.');
    }

    const installKey = await deps.getInstallKey();
    const encryptedPath = deps.paths.encryptedFilePath(sermonId);
    const outPath = deps.paths.playbackTempFilePath(sermonId);

    try {
      await deps.ensureDir(deps.paths.playbackTmpDir());
      await deps.crypto.decryptFile(encryptedPath, outPath, installKey);
      return outPath;
    } catch (err) {
      return handlePlaybackDecryptError(deps, sermonId, encryptedPath, err);
    }
  }

  /** Deletes every file under the playback-temp directory — called once at app start (a crash during path A's playback can otherwise leave a plaintext file behind indefinitely) and whenever playback stops or the track changes. */
  async function cleanupPlaybackTempFile(path: string): Promise<void> {
    await deps.deleteFile(path);
  }

  return {
    enqueueDownload,
    retryDownload,
    deleteDownload,
    listDownloads,
    getDownload,
    resumeQueuedDownloads,
    startupSweep,
    preparePlaybackFile,
    cleanupPlaybackTempFile,
  };
}

export type DownloadManager = ReturnType<typeof createDownloadManager>;

/** The singleton the app actually uses — wired to every real dependency. Tests use `createDownloadManager(fakes)` instead. */
export const downloadManager = createDownloadManager();
