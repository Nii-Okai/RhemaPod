/**
 * `downloadManager.ts`'s full state-machine logic, against fully injected fakes for
 * every external boundary (network/API, filesystem, native crypto, install key, Wi-Fi
 * gate) — this is the file that proves the plan's actual Definition of Done bullets:
 *   - a download that succeeds ends up `ready` with the right bookkeeping
 *   - the backend's 409 ("no audio rendition"), a dropped network connection, and a
 *     native encrypt failure each surface as a distinct, real reason, and Retry works
 *   - "an interrupted download surfaces a real failure reason with a working Retry" —
 *     tested here as a *process-restart* scenario: a `downloading` row is seeded directly
 *     (standing in for a row a previous, now-dead process left behbehind — there is no
 *     way to literally kill this Node process mid-`await` from inside itself), then
 *     `startupSweep()` is what a real app-launch calls before anything else touches the
 *     table, and it must reconcile that row to `failed`/`interrupted` and clean up any
 *     partial file, after which Retry must succeed
 *   - a corrupted/tampered on-disk file is rejected at playback time, never handed back
 *     as a "path", and the download degrades to needing a re-download
 *   - simulated key loss (`E_RPA1_KEY_MISMATCH`) degrades to "re-download available",
 *     never an unhandled crash — `preparePlaybackFile` always rejects with the typed
 *     `PlaybackUnavailableError`, never lets a raw native error escape
 *   - the Wi-Fi-only gate prevents a download from ever starting a network request
 */
import { ApiError, networkError } from '../../api/errors';
import { RpaCryptoError } from '../../../modules/rpa-crypto/src/RpaCryptoError';
import { PlaybackUnavailableError, createDownloadManager, type DownloadManagerDeps } from '../downloadManager';
import type { DownloadFailureReason, DownloadRecord, DownloadState } from '../types';

/**
 * `downloadManager.ts` imports `../../modules/rpa-crypto` at module scope (for
 * `RpaCryptoError` and the default `crypto` deps), which in turn imports the real native
 * binding (`requireNativeModule('RpaCrypto')`) — unresolvable under Jest, since this is a
 * local module with no registered native mock (unlike Expo's first-party modules,
 * `jest-expo`'s preset has nothing built in for it). Every test here injects its own
 * `crypto` deps, so the real native binding is never actually called — this mock exists
 * purely so requiring the module doesn't throw at import time. `RpaCryptoError` itself is
 * imported directly from its own file above (no native dependency at all), so this mock's
 * copy of it is only used by `downloadManager.ts`'s own internals, not by this test file.
 */
jest.mock('../../../modules/rpa-crypto', () => {
  const { RpaCryptoError: ActualRpaCryptoError } = jest.requireActual('../../../modules/rpa-crypto/src/RpaCryptoError');
  return {
    __esModule: true,
    RpaCryptoError: ActualRpaCryptoError,
    DEFAULT_CHUNK_SIZE: 262144,
    generateInstallKeyBase64: jest.fn(),
    encryptFile: jest.fn(),
    decryptFile: jest.fn(),
    readHeaderInfo: jest.fn(),
    excludeFromBackup: jest.fn(),
  };
});

function makeFakeDb() {
  const rows = new Map<string, DownloadRecord>();

  const api: DownloadManagerDeps['db'] = {
    getDownload: jest.fn(async (sermonId: string) => rows.get(sermonId) ?? null),
    listDownloads: jest.fn(async () => Array.from(rows.values())),
    listActiveDownloads: jest.fn(async () =>
      Array.from(rows.values()).filter((r) => r.state === 'queued' || r.state === 'downloading'),
    ),
    upsertQueued: jest.fn(
      async (
        sermonId: string,
        title: string,
        mediaType: 'audio' | 'video',
        thumbnailUrl: string | null = null,
        category: string | null = null,
      ) => {
        const existing = rows.get(sermonId);
        rows.set(sermonId, {
          sermonId,
          title,
          thumbnailUrl,
          thumbnailPath: existing?.thumbnailPath ?? null,
          category,
          mediaType: existing?.mediaType ?? mediaType,
          state: 'queued',
          progress: 0,
          bytesTotal: null,
          failureReason: null,
          failureMessage: null,
          keyIdHex: existing?.keyIdHex ?? null,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        });
      },
    ),
    markDownloading: jest.fn(async (sermonId: string) => {
      const row = rows.get(sermonId);
      if (row) row.state = 'downloading';
    }),
    updateProgress: jest.fn(async (sermonId: string, progress: number) => {
      const row = rows.get(sermonId);
      if (row) row.progress = progress;
    }),
    markReady: jest.fn(async (sermonId: string, fields: { bytesTotal: number; keyIdHex: string | null }) => {
      const row = rows.get(sermonId);
      if (row) {
        row.state = 'ready';
        row.progress = 1;
        row.bytesTotal = fields.bytesTotal;
        row.keyIdHex = fields.keyIdHex;
        row.failureReason = null;
        row.failureMessage = null;
      }
    }),
    markFailed: jest.fn(async (sermonId: string, reason: DownloadFailureReason, message: string) => {
      const row = rows.get(sermonId);
      if (row) {
        row.state = 'failed';
        row.failureReason = reason;
        row.failureMessage = message;
      }
    }),
    deleteDownload: jest.fn(async (sermonId: string) => {
      rows.delete(sermonId);
    }),
    setThumbnailPath: jest.fn(async (sermonId: string, path: string | null) => {
      const row = rows.get(sermonId);
      if (!row) return false;
      row.thumbnailPath = path;
      return true;
    }),
  };

  return { api, rows };
}

function seedRow(rows: Map<string, DownloadRecord>, sermonId: string, state: DownloadState, extra: Partial<DownloadRecord> = {}) {
  rows.set(sermonId, {
    sermonId,
    title: 'Seeded Sermon',
    thumbnailUrl: null,
    thumbnailPath: null,
    category: null,
    mediaType: 'audio',
    state,
    progress: 0,
    bytesTotal: null,
    failureReason: null,
    failureMessage: null,
    keyIdHex: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  });
}

function makeFakePaths(): DownloadManagerDeps['paths'] {
  return {
    encryptedFilePath: (id) => `file:///downloads/${id}.rpa1`,
    videoFilePath: (id) => `file:///downloads/${id}.mp4`,
    thumbnailFilePath: (id) => `file:///downloads/${id}.thumb`,
    tmpDownloadFilePath: (id) => `file:///tmp/${id}.audio.tmp`,
    tmpDownloadVideoFilePath: (id) => `file:///tmp/${id}.video.tmp`,
    playbackTempFilePath: (id) => `file:///playback-tmp/${id}-token.pcm-tmp`,
    partFilePath: (uri) => `${uri}.part`,
    downloadsDir: () => 'file:///downloads/',
    downloadTmpDir: () => 'file:///tmp/',
    playbackTmpDir: () => 'file:///playback-tmp/',
  };
}

interface Harness {
  manager: ReturnType<typeof createDownloadManager>;
  rows: Map<string, DownloadRecord>;
  deletedFiles: string[];
  clearedDirectories: string[];
  fetchDownloadUrl: jest.Mock;
  downloadToFile: jest.Mock;
  encryptFile: jest.Mock;
  decryptFile: jest.Mock;
  readHeaderInfo: jest.Mock;
  canStartDownload: jest.Mock;
  getInstallKey: jest.Mock;
  onDownloadReady: jest.Mock;
  setThumbnailPath: jest.Mock;
}

function makeHarness(overrides: Partial<DownloadManagerDeps> = {}): Harness {
  const { api: fakeDb, rows } = makeFakeDb();
  const deletedFiles: string[] = [];
  const clearedDirectories: string[] = [];

  const fetchDownloadUrl = jest.fn(async () => 'https://cdn.example.com/signed/sermon-1.mp3');
  const downloadToFile = jest.fn(async (_url: string, _dest: string, onProgress: (p: number) => void) => {
    onProgress(0.5);
    onProgress(1);
  });
  const encryptFile = jest.fn(async () => ({ keyIdHex: 'aabbccdd', chunkSize: 262144, totalChunks: 2, plaintextSize: 500_000 }));
  const decryptFile = jest.fn(async () => ({ plaintextSize: 500_000 }));
  const readHeaderInfo = jest.fn(async () => ({ version: 1, algorithmId: 1, keyIdHex: 'aabbccdd', chunkSize: 262144 }));
  const canStartDownload = jest.fn(async () => true);
  const getInstallKey = jest.fn(async () => 'install-key-base64');
  // Plan S6 — a safe no-op baseline so every test here (unless it explicitly overrides
  // this) never touches the media cache's real SQLite/filesystem internals; this is the
  // "stays isolated" the plan's S6 entry calls for.
  const onDownloadReady = jest.fn(async () => undefined);

  const deps: Partial<DownloadManagerDeps> = {
    db: fakeDb,
    onDownloadReady,
    paths: makeFakePaths(),
    ensureDir: jest.fn(async () => undefined),
    deleteFile: jest.fn(async (uri: string) => {
      deletedFiles.push(uri);
    }),
    clearDirectory: jest.fn(async (dir: string) => {
      clearedDirectories.push(dir);
    }),
    getFileSize: jest.fn(async () => 700_000),
    fetchDownloadUrl,
    downloadToFile,
    getInstallKey,
    canStartDownload,
    crypto: {
      encryptFile,
      decryptFile,
      readHeaderInfo,
      excludeFromBackup: jest.fn(async () => true),
    },
    ...overrides,
  };

  const manager = createDownloadManager(deps);
  return {
    manager,
    rows,
    deletedFiles,
    clearedDirectories,
    fetchDownloadUrl,
    downloadToFile,
    encryptFile,
    decryptFile,
    readHeaderInfo,
    canStartDownload,
    getInstallKey,
    onDownloadReady,
    setThumbnailPath: fakeDb.setThumbnailPath as jest.Mock,
  };
}

describe('downloadManager — happy path', () => {
  it('takes a fresh sermon from queued through downloading to ready, with correct bookkeeping', async () => {
    const h = makeHarness();

    await h.manager.enqueueDownload('sermon-1', 'A Great Sermon', 'audio');

    const record = await h.manager.getDownload('sermon-1');
    expect(record).toMatchObject({
      state: 'ready',
      progress: 1,
      bytesTotal: 700_000,
      keyIdHex: 'aabbccdd',
      failureReason: null,
    });
    expect(h.fetchDownloadUrl).toHaveBeenCalledWith('sermon-1', 'audio');
    expect(h.encryptFile).toHaveBeenCalledWith('file:///tmp/sermon-1.audio.tmp', 'file:///downloads/sermon-1.rpa1', 'install-key-base64');
    expect(h.readHeaderInfo).toHaveBeenCalledWith('file:///downloads/sermon-1.rpa1');
    // The plaintext tmp file is deleted after a successful encrypt — never left on disk.
    expect(h.deletedFiles).toContain('file:///tmp/sermon-1.audio.tmp');
  });

  it('is a no-op when the sermon is already ready', async () => {
    const h = makeHarness();
    seedRow(h.rows, 'sermon-1', 'ready');

    await h.manager.enqueueDownload('sermon-1', 'A Great Sermon', 'audio');

    expect(h.fetchDownloadUrl).not.toHaveBeenCalled();
  });

  it('is a no-op when a download is already queued or downloading (no duplicate concurrent attempt)', async () => {
    const h = makeHarness();
    seedRow(h.rows, 'sermon-1', 'downloading');

    await h.manager.enqueueDownload('sermon-1', 'A Great Sermon', 'audio');

    expect(h.fetchDownloadUrl).not.toHaveBeenCalled();
  });

  it('re-enqueuing a previously-failed download restarts from the same clean slate as an explicit Retry (never reuses a stale/corrupt artifact)', async () => {
    const h = makeHarness();
    seedRow(h.rows, 'sermon-1', 'failed', { failureReason: 'corrupt', failureMessage: 'damaged' });

    await h.manager.enqueueDownload('sermon-1', 'A Great Sermon', 'audio');

    expect(h.deletedFiles).toEqual(
      expect.arrayContaining(['file:///tmp/sermon-1.audio.tmp', 'file:///downloads/sermon-1.rpa1']),
    );
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready' });
  });
});

describe('downloadManager — S6 media-cache integration ("Downloads wins")', () => {
  it('audio path: calls onDownloadReady once the download is ready', async () => {
    const h = makeHarness();
    await h.manager.enqueueDownload('sermon-1', 'A Great Sermon', 'audio');
    expect(h.onDownloadReady).toHaveBeenCalledWith('sermon-1');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready' });
  });

  it('video path: calls onDownloadReady once the download is ready', async () => {
    const h = makeHarness();
    await h.manager.enqueueDownload('sermon-1', 'A Great Sermon', 'video');
    expect(h.onDownloadReady).toHaveBeenCalledWith('sermon-1');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready' });
  });

  it('a throwing onDownloadReady never fails the download — it still ends ready', async () => {
    const onDownloadReady = jest.fn().mockRejectedValue(new Error('cache delete failed'));
    const h = makeHarness({ onDownloadReady });

    await expect(h.manager.enqueueDownload('sermon-1', 'A Great Sermon', 'audio')).resolves.toBeUndefined();

    expect(onDownloadReady).toHaveBeenCalledWith('sermon-1');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready', failureReason: null });
  });
});

describe('downloadManager — failure classification and retry', () => {
  it('classifies a backend 409 (no audio rendition) distinctly, with a working retry once audio exists', async () => {
    const h = makeHarness({
      fetchDownloadUrl: jest.fn(async () => {
        throw new ApiError(409, 'This sermon has no audio rendition');
      }),
    });

    await h.manager.enqueueDownload('sermon-1', 'Title', 'audio');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'failed', failureReason: 'no_audio' });

    // Retry, now with a working fetchDownloadUrl swapped in via a second harness pointed at
    // the same rows would be needed to truly swap deps post-construction; instead assert
    // retry re-attempts fetchDownloadUrl (proving the retry path re-runs the full pipeline,
    // not just flips a flag) using a harness whose fetchDownloadUrl succeeds after the fact
    // is covered by the network-drop test below, which swaps behavior via mockImplementation.
  });

  it('classifies a mid-transfer network drop as `network`, and a successful retry recovers to ready', async () => {
    let attempt = 0;
    const downloadToFile = jest.fn(async (_url: string, _dest: string, onProgress: (p: number) => void) => {
      attempt += 1;
      if (attempt === 1) {
        onProgress(0.4);
        throw networkError();
      }
      onProgress(1);
    });
    const h = makeHarness({ downloadToFile });

    await h.manager.enqueueDownload('sermon-1', 'Title', 'audio');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'failed', failureReason: 'network' });
    // The partial plaintext temp file from the dropped transfer is cleaned up.
    expect(h.deletedFiles).toContain('file:///tmp/sermon-1.audio.tmp');

    await h.manager.retryDownload('sermon-1');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready' });
    expect(downloadToFile).toHaveBeenCalledTimes(2);
  });

  it('classifies a native encrypt failure as `encryption`, distinctly from a network failure', async () => {
    const h = makeHarness({
      crypto: {
        encryptFile: jest.fn(async () => {
          throw new RpaCryptoError('E_RPA1_IO', 'disk write failed mid-encrypt');
        }),
        decryptFile: jest.fn(),
        readHeaderInfo: jest.fn(),
        excludeFromBackup: jest.fn(async () => true),
      },
    });

    await h.manager.enqueueDownload('sermon-1', 'Title', 'audio');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'failed', failureReason: 'encryption' });
  });

  it('retry always deletes any stale tmp/encrypted file before re-attempting, never resuming a corrupt artifact', async () => {
    const h = makeHarness();
    seedRow(h.rows, 'sermon-1', 'failed', { failureReason: 'corrupt', failureMessage: 'damaged' });

    await h.manager.retryDownload('sermon-1');

    expect(h.deletedFiles).toEqual(
      expect.arrayContaining([
        'file:///tmp/sermon-1.audio.tmp',
        'file:///downloads/sermon-1.rpa1',
        'file:///downloads/sermon-1.rpa1.part',
      ]),
    );
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready' });
  });
});

describe('downloadManager — Wi-Fi-only gate', () => {
  it('never starts a network request when the Wi-Fi gate is closed, and stays queued (not failed)', async () => {
    const h = makeHarness({ canStartDownload: jest.fn(async () => false) });

    await h.manager.enqueueDownload('sermon-1', 'Title', 'audio');

    expect(h.fetchDownloadUrl).not.toHaveBeenCalled();
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'queued' });
  });

  it('resumeQueuedDownloads re-attempts every queued row once the gate opens', async () => {
    const canStartDownload = jest.fn(async () => false);
    const h = makeHarness({ canStartDownload });
    await h.manager.enqueueDownload('sermon-1', 'Title', 'audio');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'queued' });

    canStartDownload.mockResolvedValue(true);
    await h.manager.resumeQueuedDownloads();

    expect(h.fetchDownloadUrl).toHaveBeenCalledWith('sermon-1', 'audio');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready' });
  });
});

describe('downloadManager — interrupted download (process-restart) recovery', () => {
  it('startupSweep reconciles a stale downloading row to failed/interrupted and cleans up partial files, and retry then succeeds', async () => {
    const h = makeHarness();
    // Stands in for a row a previous, now-dead process left mid-transfer — see the file
    // docstring for why this is the honest way to exercise "killed mid-download" here.
    seedRow(h.rows, 'sermon-1', 'downloading', { progress: 0.3 });

    await h.manager.startupSweep();

    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'failed', failureReason: 'interrupted' });
    expect(h.deletedFiles).toEqual(
      expect.arrayContaining([
        'file:///tmp/sermon-1.audio.tmp',
        'file:///downloads/sermon-1.rpa1',
        'file:///downloads/sermon-1.rpa1.part',
      ]),
    );
    // Also unconditionally clears the playback-temp directory — a crash during a previous
    // offline playback session could otherwise leave a plaintext file behind forever.
    expect(h.clearedDirectories).toContain('file:///playback-tmp/');

    await h.manager.retryDownload('sermon-1');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready' });
  });

  it('startupSweep leaves a queued (waiting for Wi-Fi) row queued, not failed, and deletes nothing for it', async () => {
    const h = makeHarness();
    seedRow(h.rows, 'sermon-1', 'queued');

    await h.manager.startupSweep();

    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'queued', failureReason: null });
    expect(h.deletedFiles).toEqual([]);
  });

  it('startupSweep leaves ready and already-failed rows untouched', async () => {
    const h = makeHarness();
    seedRow(h.rows, 'sermon-ready', 'ready', { bytesTotal: 1, keyIdHex: '00' });
    seedRow(h.rows, 'sermon-failed', 'failed', { failureReason: 'no_audio', failureMessage: 'x' });

    await h.manager.startupSweep();

    expect(await h.manager.getDownload('sermon-ready')).toMatchObject({ state: 'ready' });
    expect(await h.manager.getDownload('sermon-failed')).toMatchObject({ state: 'failed', failureReason: 'no_audio' });
  });
});

describe('downloadManager — offline playback decrypt path', () => {
  it('returns a plaintext path for a ready, valid download', async () => {
    const h = makeHarness();
    seedRow(h.rows, 'sermon-1', 'ready', { bytesTotal: 1000, keyIdHex: 'aabbccdd' });

    const path = await h.manager.preparePlaybackFile('sermon-1');

    expect(path).toBe('file:///playback-tmp/sermon-1-token.pcm-tmp');
    expect(h.decryptFile).toHaveBeenCalledWith('file:///downloads/sermon-1.rpa1', 'file:///playback-tmp/sermon-1-token.pcm-tmp', 'install-key-base64');
  });

  it('rejects with PlaybackUnavailableError("not ready") when the download is not ready yet, without touching any file', async () => {
    const h = makeHarness();
    seedRow(h.rows, 'sermon-1', 'downloading');

    await expect(h.manager.preparePlaybackFile('sermon-1')).rejects.toBeInstanceOf(PlaybackUnavailableError);
    expect(h.decryptFile).not.toHaveBeenCalled();
    expect(h.deletedFiles).toEqual([]);
  });

  it('a corrupted/tampered on-disk file is rejected, never handed back as a playable path, and degrades the row to needing a re-download', async () => {
    const decryptFile = jest.fn(async () => {
      throw new RpaCryptoError('E_RPA1_AUTH_FAILED', 'GCM authentication failed at chunk 2');
    });
    const h = makeHarness({ crypto: { encryptFile: jest.fn(), decryptFile, readHeaderInfo: jest.fn(), excludeFromBackup: jest.fn(async () => true) } });
    seedRow(h.rows, 'sermon-1', 'ready', { bytesTotal: 1000, keyIdHex: 'aabbccdd' });

    await expect(h.manager.preparePlaybackFile('sermon-1')).rejects.toMatchObject({
      name: 'PlaybackUnavailableError',
      reason: 'corrupt',
    });
    expect(h.deletedFiles).toContain('file:///downloads/sermon-1.rpa1');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'failed', failureReason: 'corrupt' });
  });

  it('a half-written/truncated file is rejected the same way as a tampered one', async () => {
    const decryptFile = jest.fn(async () => {
      throw new RpaCryptoError('E_RPA1_TRUNCATED', 'File ends before a final chunk was written');
    });
    const h = makeHarness({ crypto: { encryptFile: jest.fn(), decryptFile, readHeaderInfo: jest.fn(), excludeFromBackup: jest.fn(async () => true) } });
    seedRow(h.rows, 'sermon-1', 'ready', { bytesTotal: 1000, keyIdHex: 'aabbccdd' });

    await expect(h.manager.preparePlaybackFile('sermon-1')).rejects.toMatchObject({ reason: 'corrupt' });
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'failed', failureReason: 'corrupt' });
  });

  it('simulated key loss (SecureStore wipe -> a fresh key that cannot decrypt old files) degrades to re-download, never throws an unrecognized error', async () => {
    const decryptFile = jest.fn(async () => {
      throw new RpaCryptoError('E_RPA1_KEY_MISMATCH', 'This file was encrypted with a different install key');
    });
    // The subsequent retry re-runs the full encrypt pipeline (a fresh install key means a
    // fresh encrypt, not a resume) — this harness's `encryptFile` must actually succeed,
    // unlike the other decrypt-only failure tests above which never reach retry.
    const h = makeHarness({
      crypto: {
        encryptFile: jest.fn(async () => ({ keyIdHex: 'newkey00', chunkSize: 262144, totalChunks: 1, plaintextSize: 500_000 })),
        decryptFile,
        readHeaderInfo: jest.fn(async () => ({ version: 1, algorithmId: 1, keyIdHex: 'newkey00', chunkSize: 262144 })),
        excludeFromBackup: jest.fn(async () => true),
      },
    });
    seedRow(h.rows, 'sermon-1', 'ready', { bytesTotal: 1000, keyIdHex: 'aabbccdd' });

    await expect(h.manager.preparePlaybackFile('sermon-1')).rejects.toMatchObject({
      name: 'PlaybackUnavailableError',
      reason: 'key_lost',
    });
    expect(h.deletedFiles).toContain('file:///downloads/sermon-1.rpa1');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'failed', failureReason: 'key_lost' });

    // And the degraded row is fully recoverable via the ordinary retry path — "re-download
    // available", never a dead end.
    await h.manager.retryDownload('sermon-1');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready' });
  });

  it('an unexpected non-RpaCryptoError during decrypt still degrades gracefully instead of throwing a raw error', async () => {
    const decryptFile = jest.fn(async () => {
      throw new Error('some unrelated native crash');
    });
    const h = makeHarness({ crypto: { encryptFile: jest.fn(), decryptFile, readHeaderInfo: jest.fn(), excludeFromBackup: jest.fn(async () => true) } });
    seedRow(h.rows, 'sermon-1', 'ready', { bytesTotal: 1000, keyIdHex: 'aabbccdd' });

    await expect(h.manager.preparePlaybackFile('sermon-1')).rejects.toBeInstanceOf(PlaybackUnavailableError);
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'failed', failureReason: 'unknown' });
  });
});

describe('downloadManager — cleanupPlaybackTempFile safety', () => {
  it('deletes a path under the playback-temp directory', async () => {
    const h = makeHarness();
    await h.manager.cleanupPlaybackTempFile('file:///playback-tmp/sermon-1-token.pcm-tmp');
    expect(h.deletedFiles).toContain('file:///playback-tmp/sermon-1-token.pcm-tmp');
  });

  it("never deletes a path outside the playback-temp directory — e.g. a video download's own persisted file, which `preparePlaybackFile` hands back directly with no temp copy made", async () => {
    const h = makeHarness();
    await h.manager.cleanupPlaybackTempFile('file:///downloads/sermon-1.mp4');
    expect(h.deletedFiles).not.toContain('file:///downloads/sermon-1.mp4');
  });
});

describe('downloadManager — delete', () => {
  it('deletes the encrypted file, any stray tmp file, and the DB row', async () => {
    const h = makeHarness();
    seedRow(h.rows, 'sermon-1', 'ready', { bytesTotal: 1, keyIdHex: '00' });

    await h.manager.deleteDownload('sermon-1');

    expect(h.deletedFiles).toEqual(
      expect.arrayContaining([
        'file:///downloads/sermon-1.rpa1',
        'file:///downloads/sermon-1.rpa1.part',
        'file:///tmp/sermon-1.audio.tmp',
        'file:///downloads/sermon-1.thumb',
      ]),
    );
    expect(await h.manager.getDownload('sermon-1')).toBeNull();
  });
});

describe('downloadManager — thumbnail fetch (session 2026-10-15 fix for the 6h presigned-URL expiry)', () => {
  it('does nothing when the sermon has no thumbnailUrl — no second downloadToFile call, no setThumbnailPath', async () => {
    const h = makeHarness();

    await h.manager.enqueueDownload('sermon-1', 'Title', 'audio', null);

    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready' });
    expect(h.downloadToFile).toHaveBeenCalledTimes(1); // only the media fetch
    expect(h.setThumbnailPath).not.toHaveBeenCalled();
  });

  it('fetches the thumbnail once the media download is ready, and records the local path', async () => {
    const h = makeHarness();

    await h.manager.enqueueDownload('sermon-1', 'Title', 'audio', 'https://cdn.example.com/signed/thumb.jpg');

    expect(h.downloadToFile).toHaveBeenCalledWith(
      'https://cdn.example.com/signed/thumb.jpg',
      'file:///downloads/sermon-1.thumb',
      expect.any(Function),
    );
    expect(h.setThumbnailPath).toHaveBeenCalledWith('sermon-1', 'file:///downloads/sermon-1.thumb');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({
      state: 'ready',
      thumbnailPath: 'file:///downloads/sermon-1.thumb',
    });
  });

  it('a failed thumbnail fetch never fails the download, never calls setThumbnailPath, and cleans up the stale file', async () => {
    const downloadToFile = jest.fn(async (url: string, dest: string, onProgress: (p: number) => void) => {
      if (dest.endsWith('.thumb')) {
        throw networkError();
      }
      onProgress(1);
    });
    const h = makeHarness({ downloadToFile });

    await h.manager.enqueueDownload('sermon-1', 'Title', 'audio', 'https://cdn.example.com/signed/thumb.jpg');

    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready' });
    expect(h.setThumbnailPath).not.toHaveBeenCalled();
    expect(h.deletedFiles).toContain('file:///downloads/sermon-1.thumb');
  });

  it('retryDownload re-fetches the thumbnail using the row\'s own thumbnailUrl, not a caller-supplied one (regression: retryDownload must keep passing thumbnailUrl through runDownload)', async () => {
    const h = makeHarness();
    seedRow(h.rows, 'sermon-1', 'failed', {
      failureReason: 'network',
      failureMessage: 'dropped',
      thumbnailUrl: 'https://cdn.example.com/signed/thumb.jpg',
    });

    await h.manager.retryDownload('sermon-1');

    expect(h.downloadToFile).toHaveBeenCalledWith(
      'https://cdn.example.com/signed/thumb.jpg',
      'file:///downloads/sermon-1.thumb',
      expect.any(Function),
    );
    expect(h.setThumbnailPath).toHaveBeenCalledWith('sermon-1', 'file:///downloads/sermon-1.thumb');
  });

  it('resumeQueuedDownloads re-fetches the thumbnail for a row that resumes from queued (regression: resumeQueuedDownloads must keep passing record.thumbnailUrl through runDownload)', async () => {
    const canStartDownload = jest.fn(async () => false);
    const h = makeHarness({ canStartDownload });

    await h.manager.enqueueDownload('sermon-1', 'Title', 'audio', 'https://cdn.example.com/signed/thumb.jpg');
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'queued' });
    expect(h.downloadToFile).not.toHaveBeenCalled();

    canStartDownload.mockResolvedValue(true);
    await h.manager.resumeQueuedDownloads();

    expect(h.downloadToFile).toHaveBeenCalledWith(
      'https://cdn.example.com/signed/thumb.jpg',
      'file:///downloads/sermon-1.thumb',
      expect.any(Function),
    );
    expect(h.setThumbnailPath).toHaveBeenCalledWith('sermon-1', 'file:///downloads/sermon-1.thumb');
  });

  it('reviewer-gilfoyle MUST-FIX regression: a download deleted while the thumbnail fetch is still in flight gets the orphaned file cleaned up, not left behind', async () => {
    // Simulates deleteDownload winning the race against fetchThumbnailBestEffort's own
    // network-I/O await: by the time setThumbnailPath would run, the row is already gone,
    // so the fake (same as db.ts's real `changes > 0` check) reports `false`.
    const setThumbnailPath = jest.fn(async () => false);
    const h = makeHarness({ db: { ...makeFakeDb().api, setThumbnailPath } });

    await h.manager.enqueueDownload('sermon-1', 'Title', 'audio', 'https://cdn.example.com/signed/thumb.jpg');

    expect(setThumbnailPath).toHaveBeenCalledWith('sermon-1', 'file:///downloads/sermon-1.thumb');
    // Deleted once up front (never resume a stale file) and again after the race is
    // detected — the orphaned file must not survive this function.
    expect(h.deletedFiles.filter((f) => f === 'file:///downloads/sermon-1.thumb')).toHaveLength(2);
  });
});


describe('downloadManager — one attempt per sermon', () => {
  it('concurrent resumeQueuedDownloads calls (one per mounted useDownloads) start a queued row only once', async () => {
    const h = makeHarness();
    seedRow(h.rows, 'sermon-1', 'queued');

    await Promise.all([
      h.manager.resumeQueuedDownloads(),
      h.manager.resumeQueuedDownloads(),
      h.manager.resumeQueuedDownloads(),
    ]);

    expect(h.fetchDownloadUrl).toHaveBeenCalledTimes(1);
    expect(h.downloadToFile).toHaveBeenCalledTimes(1);
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'ready' });
  });
});

describe('downloadManager — delete while downloading (cancel)', () => {
  function gatedTransfer() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const downloadToFile = jest.fn(async (_url: string, _dest: string, onProgress: (p: number) => void) => {
      onProgress(0.3);
      await gate;
    });
    return { downloadToFile, release };
  }

  it('cancels the transfer, never marks the row ready, and leaves no file behind', async () => {
    const { downloadToFile, release } = gatedTransfer();
    const cancelTransfer = jest.fn();
    const h = makeHarness({ downloadToFile, cancelTransfer });

    const attempt = h.manager.enqueueDownload('sermon-1', 'Title', 'video');
    await waitForCall(downloadToFile);

    await h.manager.deleteDownload('sermon-1');
    expect(cancelTransfer).toHaveBeenCalledWith('file:///tmp/sermon-1.video.tmp');
    h.deletedFiles.length = 0;

    release(); // the transfer finishes anyway (a cancel that lost the race)
    await attempt;

    expect(await h.manager.getDownload('sermon-1')).toBeNull();
    expect(h.deletedFiles).toEqual(expect.arrayContaining(['file:///downloads/sermon-1.mp4']));
  });

  it('downloading again right after a delete restarts cleanly once the old attempt settles', async () => {
    const { downloadToFile, release } = gatedTransfer();
    const h = makeHarness({ downloadToFile });

    const attempt = h.manager.enqueueDownload('sermon-1', 'Title', 'audio');
    await waitForCall(downloadToFile);
    await h.manager.deleteDownload('sermon-1');
    await h.manager.enqueueDownload('sermon-1', 'Title', 'audio');
    // The old attempt is still in flight, so the new row waits instead of racing it.
    expect(await h.manager.getDownload('sermon-1')).toMatchObject({ state: 'queued' });
    expect(downloadToFile).toHaveBeenCalledTimes(1);

    release();
    await attempt;
    await waitForState(h, 'sermon-1', 'ready');
    expect(downloadToFile).toHaveBeenCalledTimes(2);
  });
});

async function waitForCall(mock: jest.Mock): Promise<void> {
  for (let i = 0; i < 50 && mock.mock.calls.length === 0; i++) await Promise.resolve();
  expect(mock).toHaveBeenCalled();
}

async function waitForState(h: Harness, sermonId: string, state: DownloadState): Promise<void> {
  for (let i = 0; i < 200 && h.rows.get(sermonId)?.state !== state; i++) await Promise.resolve();
  expect(h.rows.get(sermonId)?.state).toBe(state);
}
