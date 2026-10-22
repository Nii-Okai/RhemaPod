// No longer needs a `modules/rpa-crypto` mock: `fill.ts`'s Wi-Fi gate used to come from
// `../downloads/downloadManager`, which pulls in the native `rpa-crypto` module at scope —
// but the circular-import fix (S8/S9 re-check) moved that function to
// `../downloads/network`, which has no such dependency. Confirmed empirically (not
// assumed) by removing this mock and re-running the suite.
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

import { renderHook, waitFor } from '@testing-library/react-native';
import { useCachedSource, type CachedSourceDeps } from '../useCachedSource';
import { mediaCacheFilePath } from '../paths';
import { FILL_PROGRESS_MIN, FILL_PROGRESS_MAX } from '../constants';
import type { KeyMediaRef, KeyVariant } from '../key';

const SERMON_ID = 'sermon-1';
const MEDIA_REF: KeyMediaRef = { id: 'b1b1b1b1-1111-1111-1111-111111111111', type: 'audio' };
const AUDIO_VARIANT: KeyVariant = { type: 'audio', url: 'https://example.com/a.mp3' };
const HLS_VARIANT: KeyVariant = { type: 'video', url: 'https://example.com/a.m3u8' };
const FILE_NAME = `${MEDIA_REF.id}.mp3`;
const LOCAL_URL = mediaCacheFilePath(FILE_NAME);
const NOW = 1_700_000_000_000;
const EXPIRES_AT = NOW + 60 * 60 * 1000;

function makeDeps(overrides: Partial<CachedSourceDeps> = {}): jest.Mocked<CachedSourceDeps> {
  return {
    manifestGet: jest.fn().mockResolvedValue(null),
    manifestTouch: jest.fn().mockResolvedValue(undefined),
    manifestDeleteByKey: jest.fn().mockResolvedValue(undefined),
    getFileInfo: jest.fn().mockResolvedValue({ exists: false, size: 0 }),
    requestFill: jest.fn().mockResolvedValue('committed'),
    setNowPlaying: jest.fn(),
    ensureSwept: jest.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...overrides,
  } as jest.Mocked<CachedSourceDeps>;
}

describe('useCachedSource', () => {
  it('miss: resolves to the stream URL and emits a miss event', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useCachedSource({ sermonId: SERMON_ID, mediaRefs: [MEDIA_REF], variant: AUDIO_VARIANT, enabled: true, expiresAt: EXPIRES_AT }, deps),
    );

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.effectiveUrl).toBe(AUDIO_VARIANT.url);
    expect(deps.manifestGet).toHaveBeenCalledWith(MEDIA_REF.id);
  });

  it('valid hit: local file:// source, touched and pinned', async () => {
    const deps = makeDeps({
      manifestGet: jest.fn().mockResolvedValue({
        mediaRefId: MEDIA_REF.id,
        sermonId: SERMON_ID,
        fileName: FILE_NAME,
        sizeBytes: 42,
        lastAccessedAt: NOW - 1000,
        createdAt: NOW - 2000,
      }),
      getFileInfo: jest.fn().mockResolvedValue({ exists: true, size: 42 }),
    });
    const { result } = renderHook(() =>
      useCachedSource({ sermonId: SERMON_ID, mediaRefs: [MEDIA_REF], variant: AUDIO_VARIANT, enabled: true, expiresAt: EXPIRES_AT }, deps),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.effectiveUrl).toBe(LOCAL_URL);
    expect(deps.manifestTouch).toHaveBeenCalledWith(MEDIA_REF.id, NOW);
    expect(deps.setNowPlaying).toHaveBeenCalledWith(MEDIA_REF.id);
    expect(deps.manifestDeleteByKey).not.toHaveBeenCalled();
  });

  it('pins the entry (setNowPlaying) before the file-existence check, not after (Gilfoyle S8 finding 4)', async () => {
    const deps = makeDeps({
      manifestGet: jest.fn().mockResolvedValue({
        mediaRefId: MEDIA_REF.id,
        sermonId: SERMON_ID,
        fileName: FILE_NAME,
        sizeBytes: 42,
        lastAccessedAt: NOW - 1000,
        createdAt: NOW - 2000,
      }),
      getFileInfo: jest.fn().mockResolvedValue({ exists: true, size: 42 }),
    });
    const { result } = renderHook(() =>
      useCachedSource({ sermonId: SERMON_ID, mediaRefs: [MEDIA_REF], variant: AUDIO_VARIANT, enabled: true, expiresAt: EXPIRES_AT }, deps),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const pinOrder = (deps.setNowPlaying as jest.Mock).mock.invocationCallOrder[0];
    const checkOrder = (deps.getFileInfo as jest.Mock).mock.invocationCallOrder[0];
    expect(pinOrder).toBeLessThan(checkOrder);
  });

  it('hit where the file is missing: row dropped, falls back to streaming, no throw, and the pin is released', async () => {
    const deps = makeDeps({
      manifestGet: jest.fn().mockResolvedValue({
        mediaRefId: MEDIA_REF.id,
        sermonId: SERMON_ID,
        fileName: FILE_NAME,
        sizeBytes: 42,
        lastAccessedAt: NOW,
        createdAt: NOW,
      }),
      getFileInfo: jest.fn().mockResolvedValue({ exists: false, size: 0 }),
    });
    const { result } = renderHook(() =>
      useCachedSource({ sermonId: SERMON_ID, mediaRefs: [MEDIA_REF], variant: AUDIO_VARIANT, enabled: true, expiresAt: EXPIRES_AT }, deps),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.effectiveUrl).toBe(AUDIO_VARIANT.url);
    expect(deps.manifestDeleteByKey).toHaveBeenCalledWith(MEDIA_REF.id);
    // Pinned optimistically before the check (previous test), then released since this
    // turned out to be a miss — never left dangling on an entry that won't actually play.
    expect(deps.setNowPlaying).toHaveBeenCalledWith(MEDIA_REF.id);
    expect(deps.setNowPlaying).toHaveBeenLastCalledWith(null);
  });

  it('hit where the size is wrong: row dropped, falls back to streaming', async () => {
    const deps = makeDeps({
      manifestGet: jest.fn().mockResolvedValue({
        mediaRefId: MEDIA_REF.id,
        sermonId: SERMON_ID,
        fileName: FILE_NAME,
        sizeBytes: 42,
        lastAccessedAt: NOW,
        createdAt: NOW,
      }),
      getFileInfo: jest.fn().mockResolvedValue({ exists: true, size: 10 }),
    });
    const { result } = renderHook(() =>
      useCachedSource({ sermonId: SERMON_ID, mediaRefs: [MEDIA_REF], variant: AUDIO_VARIANT, enabled: true, expiresAt: EXPIRES_AT }, deps),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.effectiveUrl).toBe(AUDIO_VARIANT.url);
    expect(deps.manifestDeleteByKey).toHaveBeenCalledWith(MEDIA_REF.id);
    expect(deps.setNowPlaying).toHaveBeenLastCalledWith(null);
  });

  it('HLS variant: no manifest lookup, no fill, no loading gate', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useCachedSource({ sermonId: SERMON_ID, mediaRefs: [MEDIA_REF], variant: HLS_VARIANT, enabled: true, expiresAt: EXPIRES_AT }, deps),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.effectiveUrl).toBe(HLS_VARIANT.url);
    expect(deps.manifestGet).not.toHaveBeenCalled();

    result.current.reportExit(10, 100);
    expect(deps.requestFill).not.toHaveBeenCalled();
  });

  it('disabled (e.g. a downloaded sermon): inert, no lookup', () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useCachedSource({ sermonId: SERMON_ID, mediaRefs: [MEDIA_REF], variant: AUDIO_VARIANT, enabled: false, expiresAt: EXPIRES_AT }, deps),
    );

    expect(result.current.isLoading).toBe(false);
    expect(deps.manifestGet).not.toHaveBeenCalled();
  });

  it('a reopen that already started streaming keeps its URL once freshness confirms (no player remount)', async () => {
    // Reopening a sermon in the same session: the previous /stream response is still in
    // memory, so the player mounts on it before the fresh fetch lands and the cache is
    // allowed in. Flipping to a loading gate (or a new URL) at that point would unmount
    // and restart the player mid-play.
    const deps = makeDeps({
      manifestGet: jest.fn().mockResolvedValue({
        mediaRefId: MEDIA_REF.id,
        sermonId: SERMON_ID,
        fileName: FILE_NAME,
        sizeBytes: 500,
        lastAccessedAt: NOW,
        createdAt: NOW,
      }),
      getFileInfo: jest.fn().mockResolvedValue({ exists: true, size: 500 }),
    });
    const refreshed: KeyVariant = { type: 'audio', url: 'https://example.com/a.mp3?sig=new' };
    const seen: { isLoading: boolean; effectiveUrl: string | null }[] = [];
    const { result, rerender } = renderHook(
      ({ variant, enabled }: { variant: KeyVariant; enabled: boolean }) => {
        const r = useCachedSource({ sermonId: SERMON_ID, mediaRefs: [MEDIA_REF], variant, enabled, expiresAt: EXPIRES_AT }, deps);
        seen.push({ isLoading: r.isLoading, effectiveUrl: r.effectiveUrl });
        return r;
      },
      { initialProps: { variant: AUDIO_VARIANT, enabled: false } },
    );
    expect(result.current.effectiveUrl).toBe(AUDIO_VARIANT.url);

    rerender({ variant: refreshed, enabled: true });
    await waitFor(() => expect(deps.manifestGet).toHaveBeenCalled());
    await waitFor(() => expect(deps.manifestTouch).toHaveBeenCalled());

    expect(seen.every((r) => !r.isLoading && r.effectiveUrl === AUDIO_VARIANT.url)).toBe(true);
    // Already cached, so leaving never re-fills it.
    result.current.reportExit(50, 100);
    expect(deps.requestFill).not.toHaveBeenCalled();
  });

  describe('reportExit on a miss', () => {
    async function renderMiss(deps: jest.Mocked<CachedSourceDeps>) {
      const { result } = renderHook(() =>
        useCachedSource({ sermonId: SERMON_ID, mediaRefs: [MEDIA_REF], variant: AUDIO_VARIANT, enabled: true, expiresAt: EXPIRES_AT }, deps),
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      return result;
    }

    it('below the window (4.9%): no fill', async () => {
      const deps = makeDeps();
      const result = await renderMiss(deps);
      result.current.reportExit(FILL_PROGRESS_MIN * 100 - 0.1, 100);
      expect(deps.requestFill).not.toHaveBeenCalled();
    });

    it('at the window start (5.0%): fills', async () => {
      const deps = makeDeps();
      const result = await renderMiss(deps);
      result.current.reportExit(FILL_PROGRESS_MIN * 100, 100);
      expect(deps.requestFill).toHaveBeenCalledWith({ sermonId: SERMON_ID, key: { mediaRefId: MEDIA_REF.id, fileName: FILE_NAME }, url: AUDIO_VARIANT.url, expiresAt: EXPIRES_AT });
    });

    it('at the window end (90.0%): fills', async () => {
      const deps = makeDeps();
      const result = await renderMiss(deps);
      result.current.reportExit(FILL_PROGRESS_MAX * 100, 100);
      expect(deps.requestFill).toHaveBeenCalledTimes(1);
    });

    it('above the window (90.1%): no fill', async () => {
      const deps = makeDeps();
      const result = await renderMiss(deps);
      result.current.reportExit(FILL_PROGRESS_MAX * 100 + 0.1, 100);
      expect(deps.requestFill).not.toHaveBeenCalled();
    });

    it('at 50%: fills exactly once', async () => {
      const deps = makeDeps();
      const result = await renderMiss(deps);
      result.current.reportExit(50, 100);
      expect(deps.requestFill).toHaveBeenCalledTimes(1);
    });

    it('duration 0: no fill', async () => {
      const deps = makeDeps();
      const result = await renderMiss(deps);
      result.current.reportExit(10, 0);
      expect(deps.requestFill).not.toHaveBeenCalled();
    });

    it('duration NaN: no fill', async () => {
      const deps = makeDeps();
      const result = await renderMiss(deps);
      result.current.reportExit(10, NaN);
      expect(deps.requestFill).not.toHaveBeenCalled();
    });

    it('duration null: no fill', async () => {
      const deps = makeDeps();
      const result = await renderMiss(deps);
      result.current.reportExit(10, null);
      expect(deps.requestFill).not.toHaveBeenCalled();
    });
  });

  it('reportExit on a hit: never fills (P5)', async () => {
    const deps = makeDeps({
      manifestGet: jest.fn().mockResolvedValue({
        mediaRefId: MEDIA_REF.id,
        sermonId: SERMON_ID,
        fileName: FILE_NAME,
        sizeBytes: 42,
        lastAccessedAt: NOW,
        createdAt: NOW,
      }),
      getFileInfo: jest.fn().mockResolvedValue({ exists: true, size: 42 }),
    });
    const { result } = renderHook(() =>
      useCachedSource({ sermonId: SERMON_ID, mediaRefs: [MEDIA_REF], variant: AUDIO_VARIANT, enabled: true, expiresAt: EXPIRES_AT }, deps),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.reportExit(50, 100);
    expect(deps.requestFill).not.toHaveBeenCalled();
  });

  it('releases the pin on unmount', async () => {
    const deps = makeDeps({
      manifestGet: jest.fn().mockResolvedValue({
        mediaRefId: MEDIA_REF.id,
        sermonId: SERMON_ID,
        fileName: FILE_NAME,
        sizeBytes: 42,
        lastAccessedAt: NOW,
        createdAt: NOW,
      }),
      getFileInfo: jest.fn().mockResolvedValue({ exists: true, size: 42 }),
    });
    const { result, unmount } = renderHook(() =>
      useCachedSource({ sermonId: SERMON_ID, mediaRefs: [MEDIA_REF], variant: AUDIO_VARIANT, enabled: true, expiresAt: EXPIRES_AT }, deps),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(deps.setNowPlaying).toHaveBeenCalledWith(MEDIA_REF.id);

    unmount();
    expect(deps.setNowPlaying).toHaveBeenLastCalledWith(null);
  });
});
