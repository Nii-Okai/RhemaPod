jest.mock('expo-file-system', () => ({
  __esModule: true,
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn(),
}));

import { evictToFit, type EvictDeps } from '../evict';
import { mediaCacheFilePath } from '../paths';
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

function makeDeps(entries: ManifestEntry[], overrides: Partial<EvictDeps> = {}): jest.Mocked<EvictDeps> {
  return {
    listByLru: jest.fn().mockResolvedValue(entries),
    deleteByKey: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    getNowPlaying: jest.fn(() => null),
    ...overrides,
  } as jest.Mocked<EvictDeps>;
}

describe('evictToFit', () => {
  it('evicts oldest-first until under quota', async () => {
    const entries = [
      entry({ mediaRefId: 'oldest', sermonId: 's1', fileName: 'oldest.mp3', sizeBytes: 10, lastAccessedAt: 1 }),
      entry({ mediaRefId: 'middle', sermonId: 's2', fileName: 'middle.mp3', sizeBytes: 10, lastAccessedAt: 2 }),
      entry({ mediaRefId: 'newest', sermonId: 's3', fileName: 'newest.mp3', sizeBytes: 10, lastAccessedAt: 3 }),
    ];
    const deps = makeDeps(entries);

    const evicted = await evictToFit(20, {}, deps); // total is 30; evicting the oldest 10 brings it to exactly 20

    expect(evicted).toEqual(['oldest']);
    expect(deps.deleteByKey).toHaveBeenCalledWith('oldest');
    expect(deps.deleteFile).toHaveBeenCalledWith(mediaCacheFilePath('oldest.mp3'));
    expect(deps.deleteByKey).not.toHaveBeenCalledWith('middle');
    expect(deps.deleteByKey).not.toHaveBeenCalledWith('newest');
  });

  it('skips the pinned (currently playing) entry even if it is the oldest', async () => {
    const entries = [
      entry({ mediaRefId: 'playing', sermonId: 's1', fileName: 'playing.mp3', sizeBytes: 10, lastAccessedAt: 1 }),
      entry({ mediaRefId: 'other', sermonId: 's2', fileName: 'other.mp3', sizeBytes: 10, lastAccessedAt: 2 }),
    ];
    const deps = makeDeps(entries, { getNowPlaying: jest.fn(() => 'playing') });

    const evicted = await evictToFit(5, {}, deps);

    expect(evicted).toEqual(['other']);
    expect(deps.deleteByKey).not.toHaveBeenCalledWith('playing');
  });

  it('skips a protected entry (the fill that just committed), even unpinned', async () => {
    const entries = [
      entry({ mediaRefId: 'just-filled', sermonId: 's1', fileName: 'a.mp3', sizeBytes: 10, lastAccessedAt: 1 }),
      entry({ mediaRefId: 'older-looking', sermonId: 's2', fileName: 'b.mp3', sizeBytes: 10, lastAccessedAt: 0 }),
    ];
    const deps = makeDeps(entries);

    const evicted = await evictToFit(5, { protect: 'just-filled' }, deps);

    expect(evicted).not.toContain('just-filled');
  });

  it('when only pinned/protected entries remain over quota, stops without looping or throwing', async () => {
    const entries = [entry({ mediaRefId: 'playing', sizeBytes: 100, lastAccessedAt: 1 })];
    const deps = makeDeps(entries, { getNowPlaying: jest.fn(() => 'playing') });

    await expect(evictToFit(0, {}, deps)).resolves.toEqual([]);
    expect(deps.deleteByKey).not.toHaveBeenCalled();
  });

  it('tolerates a missing file on delete (row still removed)', async () => {
    const entries = [entry({ mediaRefId: 'gone', sizeBytes: 100, lastAccessedAt: 1 })];
    const deps = makeDeps(entries, { deleteFile: jest.fn().mockRejectedValue(new Error('ENOENT')) });

    await expect(evictToFit(0, {}, deps)).resolves.toEqual(['gone']);
    expect(deps.deleteByKey).toHaveBeenCalledWith('gone');
  });

  it('nothing evicted when already under quota', async () => {
    const entries = [entry({ mediaRefId: 'a', sizeBytes: 10, lastAccessedAt: 1 })];
    const deps = makeDeps(entries);

    await expect(evictToFit(100, {}, deps)).resolves.toEqual([]);
    expect(deps.deleteByKey).not.toHaveBeenCalled();
  });
});
