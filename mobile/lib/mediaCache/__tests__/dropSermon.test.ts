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

import { dropSermonFromCache, type DropSermonDeps } from '../dropSermon';
import { mediaCacheFilePath } from '../paths';
import type { ManifestEntry } from '../manifest';

function entry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    mediaRefId: 'a',
    sermonId: 'sermon-1',
    fileName: 'a.mp3',
    sizeBytes: 10,
    lastAccessedAt: 0,
    createdAt: 0,
    ...overrides,
  };
}

function makeDeps(removed: ManifestEntry[], overrides: Partial<DropSermonDeps> = {}): jest.Mocked<DropSermonDeps> {
  return {
    deleteBySermon: jest.fn().mockResolvedValue(removed),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    cancelFill: jest.fn(),
    ...overrides,
  } as jest.Mocked<DropSermonDeps>;
}

describe('dropSermonFromCache', () => {
  it('cancels any in-flight fill and deletes every row + file for the sermon', async () => {
    const entries = [entry({ mediaRefId: 'a', fileName: 'a.mp3' }), entry({ mediaRefId: 'b', fileName: 'b.mp4' })];
    const deps = makeDeps(entries);

    await dropSermonFromCache('sermon-1', deps);

    expect(deps.cancelFill).toHaveBeenCalledWith('sermon-1');
    expect(deps.deleteBySermon).toHaveBeenCalledWith('sermon-1');
    expect(deps.deleteFile).toHaveBeenCalledWith(mediaCacheFilePath('a.mp3'));
    expect(deps.deleteFile).toHaveBeenCalledWith(mediaCacheFilePath('b.mp4'));
  });

  it('cancels the fill before reading the manifest, not after', async () => {
    const calls: string[] = [];
    const deps = makeDeps([], {
      cancelFill: jest.fn(() => {
        calls.push('cancel');
      }),
      deleteBySermon: jest.fn(async () => {
        calls.push('delete');
        return [];
      }),
    });

    await dropSermonFromCache('sermon-1', deps);

    expect(calls).toEqual(['cancel', 'delete']);
  });

  it('no entries for the sermon: no-op, no throw', async () => {
    const deps = makeDeps([]);
    await expect(dropSermonFromCache('sermon-1', deps)).resolves.toBeUndefined();
    expect(deps.deleteFile).not.toHaveBeenCalled();
  });

  it('a file-delete failure for one entry does not stop the others from being removed', async () => {
    const entries = [entry({ mediaRefId: 'a', fileName: 'a.mp3' }), entry({ mediaRefId: 'b', fileName: 'b.mp3' })];
    const deleteFile = jest.fn((uri: string) => (uri === mediaCacheFilePath('a.mp3') ? Promise.reject(new Error('gone')) : Promise.resolve(undefined)));
    const deps = makeDeps(entries, { deleteFile });

    await expect(dropSermonFromCache('sermon-1', deps)).resolves.toBeUndefined();
    expect(deleteFile).toHaveBeenCalledWith(mediaCacheFilePath('b.mp3'));
  });
});
