jest.mock('expo-file-system', () => ({
  __esModule: true,
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  readDirectoryAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

import { ensureSwept, resetSweptForTests, type SweepDeps } from '../sweep';
import { mediaCacheFilePath, mediaCachePartPath, mediaCacheDir } from '../paths';
import type { ManifestEntry } from '../manifest';

function entry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    mediaRefId: 'a',
    sermonId: 'sermon-a',
    fileName: 'a.mp3',
    sizeBytes: 10,
    lastAccessedAt: 0,
    createdAt: 0,
    ...overrides,
  };
}

function makeDeps(entries: ManifestEntry[], fileNames: string[], overrides: Partial<SweepDeps> = {}): jest.Mocked<SweepDeps> {
  const sizeByFile = new Map(entries.map((e) => [e.fileName, e.sizeBytes]));
  return {
    listByLru: jest.fn().mockResolvedValue(entries),
    deleteByKey: jest.fn().mockResolvedValue(undefined),
    listDir: jest.fn().mockResolvedValue(fileNames),
    getSize: jest.fn(async (uri: string) => {
      for (const [name, size] of sizeByFile) {
        if (uri === mediaCacheFilePath(name)) return size;
      }
      return 0;
    }),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<SweepDeps>;
}

beforeEach(() => {
  resetSweptForTests();
});

describe('ensureSwept', () => {
  it('row whose file is missing: row dropped, no file-delete attempted', async () => {
    const deps = makeDeps([entry({ mediaRefId: 'a', fileName: 'a.mp3' })], []);
    await ensureSwept(deps);
    expect(deps.deleteByKey).toHaveBeenCalledWith('a');
    expect(deps.deleteFile).not.toHaveBeenCalled();
  });

  it('row whose file size differs: row dropped and file deleted', async () => {
    const deps = makeDeps(
      [entry({ mediaRefId: 'a', fileName: 'a.mp3', sizeBytes: 100 })],
      ['a.mp3'],
      { getSize: jest.fn(async () => 10) }, // on-disk size doesn't match the row's 100
    );
    await ensureSwept(deps);
    expect(deps.deleteByKey).toHaveBeenCalledWith('a');
    expect(deps.deleteFile).toHaveBeenCalledWith(mediaCacheFilePath('a.mp3'));
  });

  it('orphan .part file: deleted', async () => {
    const deps = makeDeps([], ['b.mp3.part']);
    await ensureSwept(deps);
    expect(deps.deleteFile).toHaveBeenCalledWith(mediaCacheFilePath('b.mp3.part'));
  });

  it('row-less final file: deleted', async () => {
    const deps = makeDeps([], ['orphan.mp3']);
    await ensureSwept(deps);
    expect(deps.deleteFile).toHaveBeenCalledWith(mediaCacheFilePath('orphan.mp3'));
  });

  it('consistent row and file: untouched', async () => {
    const deps = makeDeps([entry({ mediaRefId: 'a', fileName: 'a.mp3', sizeBytes: 10 })], ['a.mp3']);
    await ensureSwept(deps);
    expect(deps.deleteByKey).not.toHaveBeenCalled();
    expect(deps.deleteFile).not.toHaveBeenCalled();
  });

  it('empty dir and a listDir failure both read as nothing to sweep, no throw', async () => {
    const deps = makeDeps([], [], { listDir: jest.fn().mockRejectedValue(new Error('ENOENT')) });
    await expect(ensureSwept(deps)).resolves.toBeUndefined();
    expect(deps.deleteByKey).not.toHaveBeenCalled();
  });

  it('runs once per launch: concurrent first-access calls share one sweep', async () => {
    const deps = makeDeps([], []);
    const [a, b] = await Promise.all([ensureSwept(deps), ensureSwept(deps)]);
    expect(a).toBe(b);
    expect(deps.listDir).toHaveBeenCalledTimes(1);
  });

  it('does not run again within the same launch', async () => {
    const deps = makeDeps([], []);
    await ensureSwept(deps);
    await ensureSwept(deps);
    expect(deps.listDir).toHaveBeenCalledTimes(1);
  });

  it('a sweep failure never throws into the caller (best effort)', async () => {
    const deps = makeDeps([entry()], ['a.mp3'], { deleteByKey: jest.fn().mockRejectedValue(new Error('db error')) });
    await expect(ensureSwept(deps)).resolves.toBeUndefined();
  });

  it('always reads mediaCacheDir(), never a Downloads directory', async () => {
    const deps = makeDeps([], []);
    await ensureSwept(deps);
    expect(deps.listDir).toHaveBeenCalledWith(mediaCacheDir());
  });

  it('a .part path differs from its file path only by the suffix (sanity on the fixture)', () => {
    expect(mediaCachePartPath('x.mp3')).toBe(`${mediaCacheFilePath('x.mp3')}.part`);
  });
});
