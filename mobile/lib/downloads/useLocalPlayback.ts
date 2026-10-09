import { useEffect, useRef, useState } from 'react';
import { downloadManager, type DownloadManager } from './downloadManager';

export interface UseLocalPlaybackResult {
  /** `file://` path to play from — audio's path-A decrypted temp copy, or video's own
   * persisted file directly (see `preparePlaybackFile`'s own doc comment). `null` until
   * ready, or whenever `enabled` is false. */
  localUri: string | null;
  isPreparing: boolean;
  error: string | null;
}

/**
 * The Player screen's (W4.2) offline half: when `enabled` (a `ready` download exists for
 * `sermonId`), resolves a locally-playable file instead of the screen streaming over the
 * network — the one-shot, auto-prepare counterpart to `useOfflinePlayback`'s own
 * play/stop-driven lifecycle (that hook stays scoped to the Downloads tab's historical
 * mini-player; this one has no user-driven transport of its own, since the Player screen
 * already owns the player it feeds).
 *
 * Toggling `enabled` off (or changing `sermonId`) cleans up the previous prepare via
 * `cleanupPlaybackTempFile` — a safe no-op for video's own path (see that function's own
 * doc comment), so this never has to know which media type it just played.
 */
export function useLocalPlayback(
  sermonId: string,
  enabled: boolean,
  manager: DownloadManager = downloadManager,
): UseLocalPlaybackResult {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const preparedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLocalUri(null);
      setIsPreparing(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLocalUri(null);
    setError(null);
    setIsPreparing(true);

    void (async () => {
      try {
        const path = await manager.preparePlaybackFile(sermonId);
        if (cancelled) return;
        preparedPathRef.current = path;
        setLocalUri(path);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not play this download.');
      } finally {
        if (!cancelled) setIsPreparing(false);
      }
    })();

    return () => {
      cancelled = true;
      const path = preparedPathRef.current;
      preparedPathRef.current = null;
      if (path) void manager.cleanupPlaybackTempFile(path);
    };
  }, [sermonId, enabled, manager]);

  return { localUri, isPreparing, error };
}
