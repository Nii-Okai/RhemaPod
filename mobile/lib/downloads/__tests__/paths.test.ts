import * as FileSystem from 'expo-file-system';
import {
  clearDirectoryContents,
  deleteIfExists,
  encryptedFilePath,
  ensureDir,
  partFilePath,
  playbackTempFilePath,
} from '../paths';

jest.mock('expo-file-system', () => ({
  __esModule: true,
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  readDirectoryAsync: jest.fn(),
}));

const mockedFs = FileSystem as unknown as {
  getInfoAsync: jest.Mock;
  makeDirectoryAsync: jest.Mock;
  deleteAsync: jest.Mock;
  readDirectoryAsync: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('partFilePath', () => {
  it('appends .part to any uri, matching the native module\'s own atomic-write staging path', () => {
    expect(partFilePath('file:///downloads/sermon-1.rpa1')).toBe('file:///downloads/sermon-1.rpa1.part');
  });
});

describe('playbackTempFilePath', () => {
  it('never produces the same path twice for the same sermon', () => {
    const a = playbackTempFilePath('sermon-1');
    const b = playbackTempFilePath('sermon-1');
    expect(a).not.toBe(b);
    expect(a).toContain('sermon-1');
  });
});

describe('encryptedFilePath', () => {
  it('is deterministic per sermonId, under the documents directory', () => {
    expect(encryptedFilePath('sermon-1')).toBe('file:///documents/rpa-downloads/sermon-1.rpa1');
  });
});

describe('ensureDir', () => {
  it('creates the directory only if it does not already exist', async () => {
    mockedFs.getInfoAsync.mockResolvedValueOnce({ exists: false });
    await ensureDir('file:///documents/rpa-downloads/');
    expect(mockedFs.makeDirectoryAsync).toHaveBeenCalledWith('file:///documents/rpa-downloads/', { intermediates: true });

    mockedFs.getInfoAsync.mockResolvedValueOnce({ exists: true });
    await ensureDir('file:///documents/rpa-downloads/');
    expect(mockedFs.makeDirectoryAsync).toHaveBeenCalledTimes(1);
  });
});

describe('deleteIfExists', () => {
  it('deletes idempotently — never throws for a missing file', async () => {
    await deleteIfExists('file:///downloads/sermon-1.rpa1');
    expect(mockedFs.deleteAsync).toHaveBeenCalledWith('file:///downloads/sermon-1.rpa1', { idempotent: true });
  });
});

describe('clearDirectoryContents', () => {
  it('deletes every entry found in the directory', async () => {
    mockedFs.getInfoAsync.mockResolvedValueOnce({ exists: true });
    mockedFs.readDirectoryAsync.mockResolvedValueOnce(['a.pcm-tmp', 'b.pcm-tmp.part']);

    await clearDirectoryContents('file:///cache/rpa-playback-tmp/');

    expect(mockedFs.deleteAsync).toHaveBeenCalledWith('file:///cache/rpa-playback-tmp/a.pcm-tmp', { idempotent: true });
    expect(mockedFs.deleteAsync).toHaveBeenCalledWith('file:///cache/rpa-playback-tmp/b.pcm-tmp.part', { idempotent: true });
  });

  it('is a no-op when the directory does not exist yet (first launch)', async () => {
    mockedFs.getInfoAsync.mockResolvedValueOnce({ exists: false });
    await clearDirectoryContents('file:///cache/rpa-playback-tmp/');
    expect(mockedFs.readDirectoryAsync).not.toHaveBeenCalled();
    expect(mockedFs.deleteAsync).not.toHaveBeenCalled();
  });
});
