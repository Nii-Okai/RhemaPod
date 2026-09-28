import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useOfflinePlayback } from '../useOfflinePlayback';
import type { DownloadManager } from '../downloadManager';

/** Same reason as `useDownloads.test.ts` — see that file's docstring. */
jest.mock('../../../modules/rpa-crypto', () => ({
  __esModule: true,
  RpaCryptoError: class RpaCryptoError extends Error {},
  DEFAULT_CHUNK_SIZE: 262144,
  generateInstallKeyBase64: jest.fn(),
  encryptFile: jest.fn(),
  decryptFile: jest.fn(),
  readHeaderInfo: jest.fn(),
  excludeFromBackup: jest.fn(),
}));

function makeFakeManager(): jest.Mocked<Pick<DownloadManager, 'preparePlaybackFile' | 'cleanupPlaybackTempFile'>> {
  return {
    preparePlaybackFile: jest.fn(async (sermonId: string) => `file:///playback-tmp/${sermonId}.pcm-tmp`),
    cleanupPlaybackTempFile: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<Pick<DownloadManager, 'preparePlaybackFile' | 'cleanupPlaybackTempFile'>>;
}

describe('useOfflinePlayback', () => {
  it('prepares a plaintext path for the requested sermon', async () => {
    const manager = makeFakeManager();
    const { result } = renderHook(() => useOfflinePlayback(manager as unknown as DownloadManager));

    await act(async () => {
      await result.current.play('sermon-1');
    });

    expect(manager.preparePlaybackFile).toHaveBeenCalledWith('sermon-1');
    expect(result.current.playingSermonId).toBe('sermon-1');
    expect(result.current.localUri).toBe('file:///playback-tmp/sermon-1.pcm-tmp');
    expect(result.current.error).toBeNull();
  });

  it('cleans up the previous track before preparing a new one — never two temp files alive at once', async () => {
    const manager = makeFakeManager();
    const { result } = renderHook(() => useOfflinePlayback(manager as unknown as DownloadManager));

    await act(async () => {
      await result.current.play('sermon-1');
    });
    await act(async () => {
      await result.current.play('sermon-2');
    });

    expect(manager.cleanupPlaybackTempFile).toHaveBeenCalledWith('file:///playback-tmp/sermon-1.pcm-tmp');
    expect(result.current.playingSermonId).toBe('sermon-2');
  });

  it('stop() cleans up and clears playback state', async () => {
    const manager = makeFakeManager();
    const { result } = renderHook(() => useOfflinePlayback(manager as unknown as DownloadManager));

    await act(async () => {
      await result.current.play('sermon-1');
    });
    await act(async () => {
      await result.current.stop();
    });

    expect(manager.cleanupPlaybackTempFile).toHaveBeenCalledWith('file:///playback-tmp/sermon-1.pcm-tmp');
    expect(result.current.playingSermonId).toBeNull();
    expect(result.current.localUri).toBeNull();
  });

  it('surfaces a decrypt failure (e.g. key loss, corruption) as a friendly error, without a localUri, and without crashing', async () => {
    const manager = makeFakeManager();
    manager.preparePlaybackFile.mockRejectedValueOnce(
      new Error('Your download key changed. Re-download to listen offline again.'),
    );
    const { result } = renderHook(() => useOfflinePlayback(manager as unknown as DownloadManager));

    await act(async () => {
      await result.current.play('sermon-1');
    });

    expect(result.current.playingSermonId).toBeNull();
    expect(result.current.localUri).toBeNull();
    expect(result.current.error).toBe('Your download key changed. Re-download to listen offline again.');
  });

  it('cleans up on unmount', async () => {
    const manager = makeFakeManager();
    const { result, unmount } = renderHook(() => useOfflinePlayback(manager as unknown as DownloadManager));

    await act(async () => {
      await result.current.play('sermon-1');
    });
    unmount();

    await waitFor(() => expect(manager.cleanupPlaybackTempFile).toHaveBeenCalledWith('file:///playback-tmp/sermon-1.pcm-tmp'));
  });
});
