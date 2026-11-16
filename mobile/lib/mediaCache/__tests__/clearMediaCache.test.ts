// No longer needs a `modules/rpa-crypto` mock: `fill.ts`'s Wi-Fi gate used to come from
// `../downloads/downloadManager`, which pulls in the native `rpa-crypto` module at scope —
// but the circular-import fix (S8/S9 re-check) moved that function to
// `../downloads/network`, which has no such dependency. Confirmed empirically (not
// assumed) by removing this mock and re-running the suite.
jest.mock('expo-file-system', () => ({
  __esModule: true,
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn(),
}));

import { clearMediaCache, type ClearMediaCacheDeps } from '../clearMediaCache';
import { mediaCacheDir } from '../paths';
import { downloadTmpDir, playbackTmpDir, downloadsDir } from '../../downloads/paths';

function makeDeps(overrides: Partial<ClearMediaCacheDeps> = {}): jest.Mocked<ClearMediaCacheDeps> {
  return {
    invalidateInFlightFills: jest.fn(),
    deleteDatabaseFile: jest.fn().mockResolvedValue(undefined),
    deleteDir: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<ClearMediaCacheDeps>;
}

describe('clearMediaCache', () => {
  it('invalidates in-flight fills, deletes the DB file, then the cache directory, in that order', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      invalidateInFlightFills: jest.fn(() => {
        calls.push('invalidate');
      }),
      deleteDatabaseFile: jest.fn(async () => {
        calls.push('deleteDb');
      }),
      deleteDir: jest.fn(async () => {
        calls.push('deleteDir');
      }),
    });

    await clearMediaCache(deps);

    expect(calls).toEqual(['invalidate', 'deleteDb', 'deleteDir']);
    expect(deps.deleteDir).toHaveBeenCalledWith(mediaCacheDir());
  });

  it('never touches a Downloads directory', async () => {
    const deps = makeDeps();
    await clearMediaCache(deps);
    expect(deps.deleteDir).not.toHaveBeenCalledWith(downloadTmpDir());
    expect(deps.deleteDir).not.toHaveBeenCalledWith(playbackTmpDir());
    expect(deps.deleteDir).not.toHaveBeenCalledWith(downloadsDir());
  });

  it('a failing deleteDatabaseFile is swallowed, and deleteDir still runs', async () => {
    const deps = makeDeps({ deleteDatabaseFile: jest.fn().mockRejectedValue(new Error('db error')) });
    await expect(clearMediaCache(deps)).resolves.toBeUndefined();
    expect(deps.deleteDir).toHaveBeenCalled();
  });

  it('a failing deleteDir is swallowed — the wipe still completes without throwing', async () => {
    const deps = makeDeps({ deleteDir: jest.fn().mockRejectedValue(new Error('fs error')) });
    await expect(clearMediaCache(deps)).resolves.toBeUndefined();
  });

  it('called twice in a row is idempotent — no throw, both run to completion', async () => {
    const deps = makeDeps();
    await clearMediaCache(deps);
    await expect(clearMediaCache(deps)).resolves.toBeUndefined();
    expect(deps.invalidateInFlightFills).toHaveBeenCalledTimes(2);
  });
});
