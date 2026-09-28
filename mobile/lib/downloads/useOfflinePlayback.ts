import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadManager, type DownloadManager } from './downloadManager';

export interface UseOfflinePlaybackResult {
  playingSermonId: string | null;
  localUri: string | null;
  isPreparing: boolean;
  error: string | null;
  play: (sermonId: string) => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Manages the decrypt-to-temp-file lifecycle (path A, plan W4.5) for offline playback of
 * a downloaded sermon — never the encrypted file itself, and never more than one
 * plaintext temp file alive at a time (`play()` always cleans up the previous one first,
 * same as stopping and changing tracks; unmount does too). The actual audio engine
 * (`expo-audio`'s `useAudioPlayer`) lives in the UI component that reads `localUri` —
 * this hook only owns the decrypt/cleanup lifecycle and the distinguishable error a
 * failed decrypt (key loss, corruption) surfaces.
 *
 * Deliberately foreground-only for this slice: no `expo-audio` audio-mode configuration
 * for background/lock-screen playback here — that's W4.2's full player, not this one. See
 * the status entry for why that's a disclosed scope boundary, not an oversight.
 */
export function useOfflinePlayback(manager: DownloadManager = downloadManager): UseOfflinePlaybackResult {
  const [playingSermonId, setPlayingSermonId] = useState<string | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPathRef = useRef<string | null>(null);

  const cleanup = useCallback(async () => {
    if (currentPathRef.current) {
      const path = currentPathRef.current;
      currentPathRef.current = null;
      await manager.cleanupPlaybackTempFile(path);
    }
  }, [manager]);

  const stop = useCallback(async () => {
    setPlayingSermonId(null);
    setLocalUri(null);
    await cleanup();
  }, [cleanup]);

  const play = useCallback(
    async (sermonId: string) => {
      await cleanup(); // never two plaintext temp files alive at once
      setError(null);
      setIsPreparing(true);
      setPlayingSermonId(sermonId);
      try {
        const path = await manager.preparePlaybackFile(sermonId);
        currentPathRef.current = path;
        setLocalUri(path);
      } catch (err) {
        setPlayingSermonId(null);
        setLocalUri(null);
        setError(err instanceof Error ? err.message : 'Could not play this download.');
      } finally {
        setIsPreparing(false);
      }
    },
    [cleanup, manager],
  );

  // A crash during playback can leave a plaintext temp file behind until the next launch
  // (the architect's writeup's own named risk) — an ordinary unmount here (navigating
  // away, backgrounding, stopping) is the common case this cleans up eagerly instead.
  useEffect(() => {
    return () => {
      void cleanup();
    };
    // Intentionally unmount-only (no deps) — this project has no react-hooks lint rule to
    // satisfy, and re-running per `cleanup`'s identity would fire this on every `play()`
    // too, not just on unmount.
  }, []);

  return { playingSermonId, localUri, isPreparing, error, play, stop };
}
