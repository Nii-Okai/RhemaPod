jest.mock('expo-file-system', () => ({
  __esModule: true,
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  createDownloadResumable: jest.fn(),
  getInfoAsync: jest.fn(),
  moveAsync: jest.fn(),
  deleteAsync: jest.fn(),
  getFreeDiskStorageAsync: jest.fn(),
}));

// No longer needs a `modules/rpa-crypto` mock: `fill.ts` used to import
// `realCanStartDownload` from `../../downloads/downloadManager`, which pulls in the native
// `rpa-crypto` module at scope — but the circular-import fix (S8/S9 re-check) moved that
// function to `../../downloads/network`, which has no such dependency. Confirmed
// empirically (not assumed) by removing this mock and re-running the suite.
import { requestFill, cancelFill, invalidateInFlightFills, allowFillsAfterSignIn, type FillDeps } from '../fill';
import * as paths from '../paths';
import { computeQuota, isTooLargeForQuota } from '../quota';
import { FREE_SPACE_FLOOR_BYTES, STREAM_EXPIRY_MARGIN_MS } from '../constants';
import { expectNoSecrets, SECRET_URL } from './helpers';
import type { CacheKey } from '../key';

const KEY: CacheKey = { mediaRefId: 'b1b1b1b1-1111-1111-1111-111111111111', fileName: 'b1b1b1b1-1111-1111-1111-111111111111.mp3' };
const SERMON_ID = 'sermon-1';
const NOW = 1_700_000_000_000;
const FAR_FUTURE = NOW + 60 * 60 * 1000;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A rejection can fire before `requestFill` has reached its `await promise` — a second,
  // independent `.catch` here only silences Node's unhandled-rejection warning; the real
  // awaiter below still observes the same rejection normally.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

interface Harness {
  deps: FillDeps;
  manifestInsert: jest.Mock;
  deleteFile: jest.Mock;
  moveFile: jest.Mock;
  cancel: jest.Mock;
  resolveTransfer: (v: { contentLength: number | null }) => void;
  rejectTransfer: (e: unknown) => void;
  transferCall: { url: string; destPath: string } | null;
}

function makeHarness(overrides: Partial<FillDeps> = {}): Harness {
  const d = deferred<{ contentLength: number | null }>();
  const cancel = jest.fn();
  const manifestInsert = jest.fn().mockResolvedValue(undefined);
  const deleteFile = jest.fn().mockResolvedValue(undefined);
  const moveFile = jest.fn().mockResolvedValue(undefined);
  const transferCall: { url: string; destPath: string } | null = null;
  const h: Harness = {
    manifestInsert,
    deleteFile,
    moveFile,
    cancel,
    resolveTransfer: d.resolve,
    rejectTransfer: d.reject,
    transferCall,
    deps: {
      transfer: jest.fn((url: string, destPath: string) => {
        h.transferCall = { url, destPath };
        return { promise: d.promise, cancel };
      }),
      canStartDownload: jest.fn(async () => true),
      getFreeDiskStorage: jest.fn(async () => FREE_SPACE_FLOOR_BYTES + 1_000_000_000),
      fs: {
        getSize: jest.fn(async () => 123),
        moveFile,
        deleteFile,
        ensureDir: jest.fn().mockResolvedValue(undefined),
      },
      manifestInsert,
      manifestDeleteByKey: jest.fn().mockResolvedValue(undefined),
      manifestTotalBytes: jest.fn(async () => 0),
      evictToFit: jest.fn().mockResolvedValue([]),
      now: () => NOW,
      ...overrides,
    },
  };
  return h;
}

beforeEach(() => {
  invalidateInFlightFills(); // resets module-level single-flight state between tests
  allowFillsAfterSignIn(); // invalidateInFlightFills also blocks fills (S9 finding S1) — undo that for tests that aren't exercising the blocked state specifically
  jest.clearAllMocks();
});

describe('requestFill', () => {
  it('happy path: transfers to .part, verifies size, renames, inserts, commits', async () => {
    const h = makeHarness({ fs: { getSize: jest.fn(async () => 42), moveFile: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) } });
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: 42 });
    const outcome = await outcomePromise;

    expect(outcome).toBe('committed');
    expect(h.deps.fs.moveFile).toHaveBeenCalledWith(paths.mediaCachePartPath(KEY.fileName), paths.mediaCacheFilePath(KEY.fileName));
    expect(h.manifestInsert).toHaveBeenCalledWith(
      expect.objectContaining({ mediaRefId: KEY.mediaRefId, sermonId: SERMON_ID, fileName: KEY.fileName, sizeBytes: 42 }),
    );
    expect(h.deps.fs.deleteFile).not.toHaveBeenCalled();
  });

  it('missing Content-Length: discards the .part, no manifest row (P4 fail-closed)', async () => {
    const h = makeHarness();
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: null });
    const outcome = await outcomePromise;

    expect(outcome).toBe('discarded-missing-content-length');
    expect(h.deps.fs.deleteFile).toHaveBeenCalledWith(paths.mediaCachePartPath(KEY.fileName));
    expect(h.manifestInsert).not.toHaveBeenCalled();
  });

  it('size mismatch: discards the .part, no manifest row', async () => {
    const h = makeHarness({ fs: { getSize: jest.fn(async () => 10), moveFile: jest.fn(), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) } });
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: 999 });
    const outcome = await outcomePromise;

    expect(outcome).toBe('discarded-size-mismatch');
    expect(h.deps.fs.deleteFile).toHaveBeenCalledWith(paths.mediaCachePartPath(KEY.fileName));
    expect(h.manifestInsert).not.toHaveBeenCalled();
  });

  it('transfer throws: discards the .part, no rethrow into the caller', async () => {
    const h = makeHarness();
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.rejectTransfer(new Error('network dropped'));
    await expect(outcomePromise).resolves.toBe('discarded-error');
    expect(h.deps.fs.deleteFile).toHaveBeenCalledWith(paths.mediaCachePartPath(KEY.fileName));
  });

  it('rename throws: discards the .part, no manifest row', async () => {
    const h = makeHarness({ fs: { getSize: jest.fn(async () => 42), moveFile: jest.fn().mockRejectedValue(new Error('fs error')), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) } });
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: 42 });
    await expect(outcomePromise).resolves.toBe('discarded-error');
    expect(h.manifestInsert).not.toHaveBeenCalled();
  });

  it('manifest insert throws: the renamed file is deleted', async () => {
    const h = makeHarness({
      fs: { getSize: jest.fn(async () => 42), moveFile: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) },
      manifestInsert: jest.fn().mockRejectedValue(new Error('db error')),
    });
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: 42 });
    await expect(outcomePromise).resolves.toBe('discarded-error');
    expect(h.deps.fs.deleteFile).toHaveBeenCalledWith(paths.mediaCacheFilePath(KEY.fileName));
  });

  it('item too large for the computed quota (D15): discarded before committing, no manifest row', async () => {
    // Free space stays just above the floor (so the floor check doesn't fire first) —
    // the resulting quota is still small enough that a large declared size trips the
    // separate 50%-of-quota check.
    const free = FREE_SPACE_FLOOR_BYTES + 1;
    const quota = computeQuota(free, 0);
    const tooLarge = Math.ceil(quota * 0.5) + 1;
    expect(isTooLargeForQuota(tooLarge, quota)).toBe(true);
    const h = makeHarness({ getFreeDiskStorage: jest.fn(async () => free), manifestTotalBytes: jest.fn(async () => 0) });
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: tooLarge });
    await expect(outcomePromise).resolves.toBe('skipped-too-large-for-quota');
    expect(h.deps.fs.deleteFile).toHaveBeenCalledWith(paths.mediaCachePartPath(KEY.fileName));
    expect(h.manifestInsert).not.toHaveBeenCalled();
  });

  it('well under the quota: commits normally', async () => {
    const free = FREE_SPACE_FLOOR_BYTES + 1;
    const h = makeHarness({
      fs: { getSize: jest.fn(async () => 42), moveFile: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) },
      getFreeDiskStorage: jest.fn(async () => free),
      manifestTotalBytes: jest.fn(async () => 0),
    });
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: 42 }); // trivially under 50% of a 160MB-scale quota
    await expect(outcomePromise).resolves.toBe('committed');
  });

  it('after a successful commit, evicts down to the post-commit quota with this entry protected', async () => {
    const evictToFit = jest.fn().mockResolvedValue([]);
    const free = FREE_SPACE_FLOOR_BYTES + 1;
    const cacheBytes = 1000;
    const h = makeHarness({
      fs: { getSize: jest.fn(async () => 42), moveFile: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) },
      getFreeDiskStorage: jest.fn(async () => free),
      manifestTotalBytes: jest.fn(async () => cacheBytes),
      evictToFit,
    });
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: 42 });
    await expect(outcomePromise).resolves.toBe('committed');
    expect(evictToFit).toHaveBeenCalledWith(computeQuota(free, cacheBytes), { protect: KEY.mediaRefId });
  });

  it('a failing eviction after commit does not undo the commit', async () => {
    const h = makeHarness({
      fs: { getSize: jest.fn(async () => 42), moveFile: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) },
      evictToFit: jest.fn().mockRejectedValue(new Error('evict failed')),
    });
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: 42 });
    await expect(outcomePromise).resolves.toBe('committed');
    expect(h.manifestInsert).toHaveBeenCalled();
  });

  it('expired URL: skips before any network call (P2)', async () => {
    const h = makeHarness();
    const outcome = await requestFill(
      { sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: NOW + STREAM_EXPIRY_MARGIN_MS - 1 },
      h.deps,
    );
    expect(outcome).toBe('skipped-expired');
    expect(h.deps.transfer).not.toHaveBeenCalled();
  });

  it('boundary: exactly at the expiry margin still fills', async () => {
    const h = makeHarness();
    const outcomePromise = requestFill(
      { sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: NOW + STREAM_EXPIRY_MARGIN_MS },
      h.deps,
    );
    h.resolveTransfer({ contentLength: 123 });
    const outcome = await outcomePromise;
    expect(outcome).toBe('committed');
  });

  it('Wi-Fi-only on + cellular: skips, no network call', async () => {
    const h = makeHarness({ canStartDownload: jest.fn(async () => false) });
    const outcome = await requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    expect(outcome).toBe('skipped-network');
    expect(h.deps.transfer).not.toHaveBeenCalled();
  });

  it('Wi-Fi-only off + cellular (gate returns true): fills', async () => {
    const h = makeHarness({ canStartDownload: jest.fn(async () => true) });
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: 123 });
    await expect(outcomePromise).resolves.toBe('committed');
  });

  it('free space below the floor: skips, no network call', async () => {
    const h = makeHarness({ getFreeDiskStorage: jest.fn(async () => FREE_SPACE_FLOOR_BYTES - 1) });
    const outcome = await requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    expect(outcome).toBe('skipped-disk-floor');
    expect(h.deps.transfer).not.toHaveBeenCalled();
  });

  it('single-flight: a second request cancels the first, which never commits', async () => {
    const h1 = makeHarness();
    const outcome1Promise = requestFill({ sermonId: 'sermon-1', key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h1.deps);

    const key2: CacheKey = { mediaRefId: 'c2c2c2c2-2222-2222-2222-222222222222', fileName: 'c2c2c2c2-2222-2222-2222-222222222222.mp3' };
    const h2 = makeHarness();
    const outcome2Promise = requestFill({ sermonId: 'sermon-2', key: key2, url: 'https://example.com/b.mp3', expiresAt: FAR_FUTURE }, h2.deps);

    // The supersede happens synchronously, but it can land before the first request has
    // finished its own async setup (Wi-Fi/free-space checks) and wired up a real `cancel`
    // — `self.cancelled` is set immediately either way, and `fill.ts` propagates a deferred
    // cancellation as soon as the real handle exists, so `h1.cancel` is only guaranteed to
    // have fired by the time the first request actually settles.
    h1.resolveTransfer({ contentLength: 123 }); // resolves late, after being cancelled
    const outcome1 = await outcome1Promise;
    expect(outcome1).toBe('skipped-superseded');
    expect(h1.cancel).toHaveBeenCalled();
    expect(h1.manifestInsert).not.toHaveBeenCalled();

    h2.resolveTransfer({ contentLength: 123 });
    const outcome2 = await outcome2Promise;
    expect(outcome2).toBe('committed');
  });

  it('cancelFill(sermonId) for a non-matching sermon leaves the fill running', async () => {
    const h = makeHarness({ fs: { getSize: jest.fn(async () => 7), moveFile: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) } });
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    cancelFill('a-different-sermon');
    h.resolveTransfer({ contentLength: 7 });
    await expect(outcomePromise).resolves.toBe('committed');
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it('cancelFill(sermonId) for the matching sermon cancels the fill', async () => {
    const h = makeHarness();
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    cancelFill(SERMON_ID);
    h.resolveTransfer({ contentLength: 123 });
    await expect(outcomePromise).resolves.toBe('skipped-superseded');
    // `h.cancel` is only guaranteed called once the request's own async setup has wired
    // up the real cancel handle (see the single-flight test above) — checked post-hoc here.
    expect(h.cancel).toHaveBeenCalled();
  });

  it('invalidateInFlightFills: a fill resolving after a wipe discards its result and never inserts', async () => {
    const h = makeHarness();
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    invalidateInFlightFills();
    h.resolveTransfer({ contentLength: 123 });
    const outcome = await outcomePromise;
    expect(outcome).toBe('skipped-superseded');
    expect(h.manifestInsert).not.toHaveBeenCalled();
  });

  it('never leaks a URL or token into the manifest row, file paths, or logs across success and failure', async () => {
    const consoleSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const h = makeHarness({ fs: { getSize: jest.fn(async () => 50), moveFile: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) } });
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: SECRET_URL, expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: 50 });
    await outcomePromise;

    expectNoSecrets(
      h.manifestInsert.mock.calls,
      [paths.mediaCacheFilePath(KEY.fileName), paths.mediaCachePartPath(KEY.fileName)],
      [consoleSpy],
    );
    consoleSpy.mockRestore();
  });

  it('creates the cache directory before starting the transfer (S9 finding S3)', async () => {
    const h = makeHarness();
    const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
    h.resolveTransfer({ contentLength: 123 });
    await outcomePromise;
    expect(h.deps.fs.ensureDir).toHaveBeenCalledWith(paths.mediaCacheDir());
    // Called before the transfer, not after — ensures a crashed/never-created directory
    // never silently swallows every fill.
    const ensureDirOrder = (h.deps.fs.ensureDir as jest.Mock).mock.invocationCallOrder[0];
    const transferOrder = (h.deps.transfer as jest.Mock).mock.invocationCallOrder[0];
    expect(ensureDirOrder).toBeLessThan(transferOrder);
  });

  describe('same-key requests while one is already in flight (Gilfoyle S8 MUST-FIX 1)', () => {
    it('a second request for the SAME key is a no-op — does not cancel or restart the first', async () => {
      const h = makeHarness();
      const outcome1Promise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
      const outcome2Promise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);

      h.resolveTransfer({ contentLength: 123 });
      const [outcome1, outcome2] = await Promise.all([outcome1Promise, outcome2Promise]);

      expect(outcome2).toBe('skipped-already-in-flight');
      expect(outcome1).toBe('committed');
      expect(h.cancel).not.toHaveBeenCalled();
      expect(h.deps.transfer).toHaveBeenCalledTimes(1);
    });

    it('a request for a DIFFERENT key still supersedes the first, as before', async () => {
      const h1 = makeHarness();
      const outcome1Promise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h1.deps);
      const key2: CacheKey = { mediaRefId: 'c2c2c2c2-2222-2222-2222-222222222222', fileName: 'c2c2c2c2-2222-2222-2222-222222222222.mp3' };
      const h2 = makeHarness();
      requestFill({ sermonId: 'sermon-2', key: key2, url: 'https://example.com/b.mp3', expiresAt: FAR_FUTURE }, h2.deps);

      h1.resolveTransfer({ contentLength: 123 });
      await expect(outcome1Promise).resolves.toBe('skipped-superseded');
    });
  });

  describe('races re-checked after the transfer resolves (Gilfoyle S8 MUST-FIX 1 and 2)', () => {
    it('a cancel landing during the quota check (after Content-Length, before rename) discards instead of committing', async () => {
      const h = makeHarness({
        getFreeDiskStorage: jest.fn(async () => {
          // Simulates a cancel arriving exactly inside this await, between the
          // content-length check and the quota check.
          cancelFill(SERMON_ID);
          return FREE_SPACE_FLOOR_BYTES + 1_000_000_000;
        }),
      });
      const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
      h.resolveTransfer({ contentLength: 123 });
      await expect(outcomePromise).resolves.toBe('skipped-superseded');
      expect(h.manifestInsert).not.toHaveBeenCalled();
    });

    it('a wipe (generation bump) landing after rename but before the insert discards instead of committing', async () => {
      const h = makeHarness({
        fs: {
          getSize: jest.fn(async () => 42),
          moveFile: jest.fn(async () => {
            // `invalidateInFlightFills()` also cancels whatever is *currently* in flight
            // (this exact fill, at this point), so the outcome is reported via the
            // `cancelled` path ('skipped-superseded') rather than the generation path
            // ('discarded-error') — both route through the same `discard()` cleanup, and
            // the actual invariant under test is "no row survives", not the label.
            invalidateInFlightFills();
          }),
          deleteFile: jest.fn().mockResolvedValue(undefined),
          ensureDir: jest.fn().mockResolvedValue(undefined),
        },
      });
      const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
      h.resolveTransfer({ contentLength: 42 });
      await expect(outcomePromise).resolves.toBe('skipped-superseded');
      expect(h.manifestInsert).not.toHaveBeenCalled();
      expect(h.deps.fs.deleteFile).toHaveBeenCalledWith(paths.mediaCacheFilePath(KEY.fileName));
    });

    it('a wipe (generation bump) landing during the manifest insert itself undoes the row and file (Gilfoyle MUST-FIX 2)', async () => {
      const manifestDeleteByKey = jest.fn().mockResolvedValue(undefined);
      const h = makeHarness({
        fs: { getSize: jest.fn(async () => 42), moveFile: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) },
        manifestInsert: jest.fn(async () => {
          invalidateInFlightFills();
        }),
        manifestDeleteByKey,
      });
      const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
      h.resolveTransfer({ contentLength: 42 });
      await expect(outcomePromise).resolves.toBe('discarded-error');
      expect(manifestDeleteByKey).toHaveBeenCalledWith(KEY.mediaRefId);
      expect(h.deps.fs.deleteFile).toHaveBeenCalledWith(paths.mediaCacheFilePath(KEY.fileName));
    });

    it('a DIFFERENT key superseding this one (incidental slot reuse) during the insert does NOT undo an already-committed result', async () => {
      const key2: CacheKey = { mediaRefId: 'c2c2c2c2-2222-2222-2222-222222222222', fileName: 'c2c2c2c2-2222-2222-2222-222222222222.mp3' };
      const h2 = makeHarness();
      const manifestInsert = jest.fn(async () => {
        // A different sermon's fill starts while THIS insert is still in flight — hits
        // the real "newer request for a different key supersedes" path on the shared
        // in-flight slot, setting `cancelled` but NOT `explicitlyCancelled` on this fill's
        // `self`. Unrelated incidental slot reuse must not undo an already-committed,
        // unrelated result.
        void requestFill({ sermonId: 'sermon-2', key: key2, url: 'https://example.com/b.mp3', expiresAt: FAR_FUTURE }, h2.deps);
      });
      const h = makeHarness({
        fs: { getSize: jest.fn(async () => 42), moveFile: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) },
        manifestInsert,
      });
      const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
      h.resolveTransfer({ contentLength: 42 });
      await expect(outcomePromise).resolves.toBe('committed');
      expect(manifestInsert).toHaveBeenCalled();
    });

    it('an explicit cancelFill(sermonId) for THIS sermon (e.g. Downloads wins) landing during the insert DOES undo the commit (Gilfoyle re-check MUST-FIX)', async () => {
      const manifestInsert = jest.fn(async () => {
        // The real `dropSermonFromCache` shape: `cancelFill(sermonId)` for the exact
        // sermon this fill is for — Downloads just claimed it, so a cache row/file
        // surviving this would contradict S6 ("Downloads wins") entirely.
        cancelFill(SERMON_ID);
      });
      const h = makeHarness({
        fs: { getSize: jest.fn(async () => 42), moveFile: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), ensureDir: jest.fn().mockResolvedValue(undefined) },
        manifestInsert,
      });
      const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
      h.resolveTransfer({ contentLength: 42 });
      await expect(outcomePromise).resolves.toBe('discarded-error');
      expect(manifestInsert).toHaveBeenCalled();
      expect(h.deps.manifestDeleteByKey).toHaveBeenCalledWith(KEY.mediaRefId);
      expect(h.deps.fs.deleteFile).toHaveBeenCalledWith(paths.mediaCacheFilePath(KEY.fileName));
    });
  });

  describe('fillsBlocked (S9 finding S1: no fill may start after a wipe until sign-in re-opens it)', () => {
    it('invalidateInFlightFills blocks a subsequent requestFill outright, with no network call', async () => {
      const h = makeHarness();
      invalidateInFlightFills();
      const outcome = await requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
      expect(outcome).toBe('skipped-signed-out');
      expect(h.deps.transfer).not.toHaveBeenCalled();
      expect(h.deps.canStartDownload).not.toHaveBeenCalled();
    });

    it('allowFillsAfterSignIn re-opens fills after a wipe', async () => {
      const h = makeHarness();
      invalidateInFlightFills();
      allowFillsAfterSignIn();
      const outcomePromise = requestFill({ sermonId: SERMON_ID, key: KEY, url: 'https://example.com/a.mp3', expiresAt: FAR_FUTURE }, h.deps);
      h.resolveTransfer({ contentLength: 123 });
      await expect(outcomePromise).resolves.toBe('committed');
    });
  });
});
