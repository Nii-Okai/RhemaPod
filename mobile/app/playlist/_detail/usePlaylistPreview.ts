import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer } from 'expo-video';
import { useStream, selectAudioVariant } from '../../../lib/query/hooks/useStream';

/**
 * One shared, lazily-created player behind every `PlaylistItemRow`'s inline
 * play/pause icon (Isaac's ask, session 2026-10-10: "play and pause video without
 * fully opening the player page" — scoped down, by Isaac's own choice when asked,
 * to a sound-only preview: no video surface is rendered anywhere in a 48px
 * thumbnail, and only one row previews at a time).
 *
 * One player for the whole screen, not one per row — `useVideoPlayer` creates a
 * real native player instance, and a playlist can hold far more rows than should
 * ever back a live decoder each. Switching rows calls `player.replace()` on this
 * one instance instead of mounting a second player.
 *
 * Deliberately NOT the full player screen's setup: no `staysActiveInBackground`,
 * no `showNowPlayingNotification` — a preview is foreground-only and stops the
 * moment this screen loses focus (`useFocusEffect`'s cleanup below), so it never
 * fights the real player's own now-playing session if the user opens one sermon
 * fully while another was just previewing.
 */
export function usePlaylistPreview() {
  const [activeSermonId, setActiveSermonId] = useState<string | null>(null);
  const stream = useStream(activeSermonId ?? '', { enabled: activeSermonId !== null });
  const player = useVideoPlayer(null);

  useEffect(() => {
    if (!activeSermonId) {
      player.pause();
      return;
    }
    const variant = stream.data ? selectAudioVariant(stream.data.variants) : null;
    if (variant) {
      player.replace({ uri: variant.url });
      player.play();
    } else if (stream.isError) {
      setActiveSermonId(null);
    }
    // `stream.data`/`stream.isError` are this effect's real inputs; `player` is one
    // stable instance for the hook's lifetime.
  }, [activeSermonId, stream.data, stream.isError]);

  // The real bug (Isaac's report, session 2026-10-11: "pressing play is not playing
  // audio") — an inline callback here is a NEW function identity on every render,
  // and `useFocusEffect` treats that as "the effect changed," re-running it (cleanup,
  // then re-run) on every render of this hook's owner, not just on an actual focus/
  // blur transition. Since `toggle()` itself causes a re-render, that re-run's own
  // cleanup fired right after `activeSermonId` was set, immediately pausing and
  // clearing it again before the sound ever had a chance to play. React Navigation's
  // own docs call this out: the callback must be `useCallback`-stable, or this exact
  // thing happens. `[player]` is a safe, never-changing dependency — one stable
  // instance for this hook's whole lifetime (see the file's own doc comment).
  useFocusEffect(
    useCallback(() => {
      return () => {
        // Back-navigation crash (Isaac's report, session 2026-10-11: "Render Error" —
        // FunctionCallException / NativeSharedObjectNotFoundException at this exact
        // line). On some unmounts, `useVideoPlayer`'s own native object has already
        // been released by the time THIS cleanup runs — the two aren't guaranteed
        // orderable against each other — so calling a method on it throws. There's
        // nothing meaningful left to pause once the native object is already gone;
        // best-effort, not a real error to surface.
        try {
          player.pause();
        } catch {
          // See above.
        }
        setActiveSermonId(null);
      };
    }, [player]),
  );

  const toggle = (sermonId: string) => {
    setActiveSermonId((current) => (current === sermonId ? null : sermonId));
  };

  const isLoading = (sermonId: string) => activeSermonId === sermonId && stream.isLoading;

  return { activeSermonId, isLoading, toggle };
}
