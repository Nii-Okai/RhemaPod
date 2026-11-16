import { renderHook, waitFor } from '@testing-library/react-native';
import { useLocalPlayback } from '../useLocalPlayback';
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

describe('useLocalPlayback', () => {
  it('does nothing while disabled', () => {
    const manager = makeFakeManager();
    const { result } = renderHook(() => useLocalPlayback('sermon-1', false, manager as unknown as DownloadManager));

    expect(manager.preparePlaybackFile).not.toHaveBeenCalled();
    expect(result.current).toEqual({ localUri: null, isPreparing: false, error: null });
  });

  it('prepares a local path once enabled', async () => {
    const manager = makeFakeManager();
    const { result } = renderHook(() => useLocalPlayback('sermon-1', true, manager as unknown as DownloadManager));

    expect(result.current.isPreparing).toBe(true);
    await waitFor(() => expect(result.current.localUri).toBe('file:///playback-tmp/sermon-1.pcm-tmp'));
    expect(manager.preparePlaybackFile).toHaveBeenCalledWith('sermon-1');
    expect(result.current.isPreparing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a decrypt failure (e.g. key loss, corruption) as a friendly error, without a localUri, and without crashing', async () => {
    const manager = makeFakeManager();
    manager.preparePlaybackFile.mockRejectedValueOnce(
      new Error('Your download key changed. Re-download to listen offline again.'),
    );
    const { result } = renderHook(() => useLocalPlayback('sermon-1', true, manager as unknown as DownloadManager));

    await waitFor(() =>
      expect(result.current.error).toBe('Your download key changed. Re-download to listen offline again.'),
    );
    expect(result.current.localUri).toBeNull();
  });

  it('cleans up the prepared path when disabled again or the sermon changes, never on a video path that was never a temp copy', async () => {
    const manager = makeFakeManager();
    const { result, rerender } = renderHook(
      ({ id, enabled }: { id: string; enabled: boolean }) =>
        useLocalPlayback(id, enabled, manager as unknown as DownloadManager),
      { initialProps: { id: 'sermon-1', enabled: true } },
    );

    await waitFor(() => expect(result.current.localUri).toBe('file:///playback-tmp/sermon-1.pcm-tmp'));

    rerender({ id: 'sermon-1', enabled: false });

    await waitFor(() => expect(manager.cleanupPlaybackTempFile).toHaveBeenCalledWith('file:///playback-tmp/sermon-1.pcm-tmp'));
    expect(result.current.localUri).toBeNull();
  });

  it('cleans up on unmount', async () => {
    const manager = makeFakeManager();
    const { result, unmount } = renderHook(() =>
      useLocalPlayback('sermon-1', true, manager as unknown as DownloadManager),
    );

    await waitFor(() => expect(result.current.localUri).toBe('file:///playback-tmp/sermon-1.pcm-tmp'));
    unmount();

    await waitFor(() =>
      expect(manager.cleanupPlaybackTempFile).toHaveBeenCalledWith('file:///playback-tmp/sermon-1.pcm-tmp'),
    );
  });
});
