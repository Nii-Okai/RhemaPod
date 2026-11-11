import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useEventListener } from 'expo';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { useProgressFlush } from '../../app/player/_player/useProgressFlush';
import { useSleepTimer, type SleepTimer } from '../../app/player/_player/useSleepTimer';

/** What the mini player shows about the sermon in the shared player. */
export interface NowPlayingSession {
  sermonId: string;
  title: string;
  artist: string | null;
  artworkUrl: string | null;
  mediaType: 'audio' | 'video';
}

export interface SharedPlayerInput extends NowPlayingSession {
  uri: string;
}

export interface AcquiredPlayer {
  player: VideoPlayer;
  /**
   * True when the shared player was already playing this sermon before the player screen
   * opened (it came back from the mini player). The screen then leaves position and play
   * state alone instead of seeking to the saved resume point and starting over.
   */
  continued: boolean;
}

interface NowPlayingValue {
  /** The sermon in the shared player, or null when nothing has played (or it was closed). */
  session: NowPlayingSession | null;
  /** True while the full player screen is showing it; the mini player hides then. */
  attached: boolean;
  player: VideoPlayer | null;
  acquire: (input: SharedPlayerInput, setup: (player: VideoPlayer) => void) => AcquiredPlayer;
  attach: (session: NowPlayingSession) => void;
  detach: () => void;
  /** Pauses and forgets the session: the mini player's close button. */
  stop: () => void;
  /** The sleep timer lives here, not on the screen, so it still pauses a sermon that
   * carries on in the mini player after the screen closes. */
  sleepTimer: SleepTimer;
}

const NowPlayingContext = createContext<NowPlayingValue | null>(null);

function sourceFor(input: SharedPlayerInput) {
  return {
    uri: input.uri,
    metadata: {
      title: input.title,
      artist: input.artist ?? undefined,
      artwork: input.artworkUrl ?? undefined,
    },
  };
}

/**
 * One app-wide player (Daybreak stage 3, Nii's choice 2026-11-11: "Real mini player").
 *
 * Before this, every player screen made its own `useVideoPlayer`, so leaving the screen
 * stopped the sermon. Now the screen borrows this provider's single `VideoPlayer`
 * (`useSharedPlayer`), and when the screen closes the sermon keeps playing, with the mini
 * player above the dock to pause it, reopen it or close it. Background audio and the
 * lock-screen controls come from the same player flags as before.
 *
 * Progress is still saved the same way (`useProgressFlush`, plan L16): by the player
 * screen while it is open, and by `DetachedProgress` below while only the mini player is.
 */
export function NowPlayingProvider({ children }: { children: React.ReactNode }) {
  const playerRef = useRef<VideoPlayer | null>(null);
  const sessionRef = useRef<NowPlayingSession | null>(null);
  const [session, setSession] = useState<NowPlayingSession | null>(null);
  const [attached, setAttached] = useState(false);
  const [player, setPlayer] = useState<VideoPlayer | null>(null);
  const sleepTimer = useSleepTimer({ onExpire: () => playerRef.current?.pause() });
  const setSleepMinutes = sleepTimer.setMinutes;

  useEffect(
    () => () => {
      playerRef.current?.release();
      playerRef.current = null;
    },
    [],
  );

  const acquire = useCallback((input: SharedPlayerInput, setup: (p: VideoPlayer) => void): AcquiredPlayer => {
    const current = sessionRef.current;
    const existing = playerRef.current;
    // Same sermon, same kind of media: keep playing where it is. (The signed stream URL
    // changes on every fetch, so the URL itself is not compared.)
    if (existing && current && current.sermonId === input.sermonId && current.mediaType === input.mediaType) {
      return { player: existing, continued: true };
    }
    setSleepMinutes(null);
    let next = existing;
    if (next) {
      // `replace` stops the old sermon itself; no pause here, since this runs during the
      // screen's first render and must not emit events into other components mid-render.
      next.replace(sourceFor(input));
    } else {
      next = createVideoPlayer(sourceFor(input));
      playerRef.current = next;
    }
    setup(next);
    // The new sermon owns the player from here; the session state follows on attach.
    sessionRef.current = {
      sermonId: input.sermonId,
      title: input.title,
      artist: input.artist,
      artworkUrl: input.artworkUrl,
      mediaType: input.mediaType,
    };
    return { player: next, continued: false };
  }, [setSleepMinutes]);

  const attach = useCallback((next: NowPlayingSession) => {
    sessionRef.current = next;
    setSession(next);
    setPlayer(playerRef.current);
    setAttached(true);
  }, []);

  const detach = useCallback(() => setAttached(false), []);

  const stop = useCallback(() => {
    setSleepMinutes(null);
    playerRef.current?.pause();
    sessionRef.current = null;
    setSession(null);
  }, [setSleepMinutes]);

  const value = useMemo<NowPlayingValue>(
    () => ({ session, attached, player, acquire, attach, detach, stop, sleepTimer }),
    [session, attached, player, acquire, attach, detach, stop, sleepTimer],
  );

  return (
    <NowPlayingContext.Provider value={value}>
      {children}
      {session && player && !attached ? (
        <DetachedProgress key={session.sermonId} sermonId={session.sermonId} player={player} sessionRef={sessionRef} />
      ) : null}
    </NowPlayingContext.Provider>
  );
}

/**
 * Saves progress while the sermon plays on with no player screen open: the same
 * `useProgressFlush` the screen uses, seeded from where the player is now. Events are
 * ignored once the shared player has moved on to another sermon.
 */
function DetachedProgress({
  sermonId,
  player,
  sessionRef,
}: {
  sermonId: string;
  player: VideoPlayer;
  sessionRef: React.MutableRefObject<NowPlayingSession | null>;
}) {
  const progress = useProgressFlush(sermonId, player.currentTime);
  const mine = () => sessionRef.current?.sermonId === sermonId;
  useEffect(() => {
    if (player.playing) progress.reportPlaying(true);
    // Mount-time only: whatever the player is doing as the screen closes.
  }, []);
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (mine()) progress.reportPosition(currentTime);
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (mine()) progress.reportPlaying(isPlaying);
  });
  useEventListener(player, 'playToEnd', () => {
    if (mine()) progress.reportCompleted();
  });
  return null;
}

export function useNowPlaying(): NowPlayingValue | null {
  return useContext(NowPlayingContext);
}

/**
 * The player screen's player. Inside `NowPlayingProvider` it borrows the shared one and
 * tells the provider while it is on screen; outside (unit tests, the dev gallery) it makes
 * its own and releases it on unmount, exactly like `useVideoPlayer`.
 *
 * Mount-time only, like `useVideoPlayer`: the caller is keyed on the sermon id.
 */
export function useSharedPlayer(input: SharedPlayerInput, setup: (player: VideoPlayer) => void): AcquiredPlayer {
  const ctx = useContext(NowPlayingContext);
  const [acquired] = useState<AcquiredPlayer>(() => {
    if (ctx) return ctx.acquire(input, setup);
    const own = createVideoPlayer(sourceFor(input));
    setup(own);
    return { player: own, continued: false };
  });
  useEffect(() => {
    if (!ctx) return () => acquired.player.release();
    ctx.attach({
      sermonId: input.sermonId,
      title: input.title,
      artist: input.artist,
      artworkUrl: input.artworkUrl,
      mediaType: input.mediaType,
    });
    return () => ctx.detach();
    // Mount-time only; see the doc comment.
  }, []);
  return acquired;
}
