import * as FileSystem from 'expo-file-system';
import { mediaCacheDir, mediaCacheFilePath, mediaCachePartPath } from '../paths';
import { downloadTmpDir, playbackTmpDir } from '../../downloads/paths';

jest.mock('expo-file-system', () => ({
  __esModule: true,
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
}));

const mockedFs = FileSystem as unknown as { cacheDirectory: string | null };

afterEach(() => {
  mockedFs.cacheDirectory = 'file:///cache/';
});

describe('media cache paths', () => {
  it('uses cacheDirectory + rpa-media-cache/, distinct from the other cache dirs', () => {
    expect(mediaCacheDir()).toBe('file:///cache/rpa-media-cache/');
    expect(mediaCacheDir()).not.toBe(playbackTmpDir());
    expect(mediaCacheDir()).not.toBe(downloadTmpDir());
  });

  it('builds the file path inside the dir and the .part path as file path + .part', () => {
    expect(mediaCacheFilePath('abc.mp3')).toBe('file:///cache/rpa-media-cache/abc.mp3');
    expect(mediaCachePartPath('abc.mp3')).toBe(`${mediaCacheFilePath('abc.mp3')}.part`);
  });

  it('throws a clear error (not a "null/..." path) when cacheDirectory is null (web)', () => {
    mockedFs.cacheDirectory = null;
    expect(() => mediaCacheDir()).toThrow(/unavailable on this platform/);
    expect(() => mediaCachePartPath('abc.mp3')).toThrow(/unavailable on this platform/);
  });
});
