import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useEventListener } from 'expo';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useProgressFlush } from '../../app/player/_player/useProgressFlush';
import { useSleepTimer } from '../../app/player/_player/useSleepTimer';
import { api } from '../api/typedClient';
import { queryKeys } from '../query/queryClient';
import { selectPlaybackVariant } from '../query/hooks/useStream';
import { loadPlaybackPreferences } from '../settings/playbackPreferences';
import { QueueMenuSheet } from '../../components/QueueMenuSheet';
import {
  NowPlayingContext,
  useNowPlaying,
  type AcquiredPlayer,
  type NowPlayingSession,
  type NowPlayingValue,
  type SharedPlayerInput,
} from './nowPlayingContext';
import {
  addToQueue,
  appendAutoplay,
  currentItem,
  nextEpisodeAfter,
  nextIndex,
  playNext,
  queueItemFromSermon,
  queueStore,
  skipTo,
  type QueueItem,
  type QueueItemInput,
} from './queue';

export { useNowPlaying };

/**
 * Downloads (and the native crypto behind them) load only when a queue item actually plays
 * without the player screen, so importing the mini player stays light.
 */
const downloads = () => import('../downloads/downloadManager').then((m) => m.downloadManager);
const cleanupTempFile = (path: string) => {
  void downloads()
    .then((manager) => manager.cleanupPlaybackTempFile(path))
    .catch(() => {});
};
export type { AcquiredPlayer, NowPlayingSession, NowPlayingValue, SharedPlayerInput };


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
  const queryClient = useQueryClient();
  const navigatorRef = useRef<((sermonId: string) => void) | null>(null);
  // Bumped on every load, so a slow fetch for a sermon the listener already skipped past
  // never takes over the player.
  const detachedLoadRef = useRef(0);
  // Seconds to seek to once a sermon this provider loaded is ready (its resume point).
  const pendingSeekRef = useRef<number | null>(null);
  // A decrypted copy of a downloaded audio sermon this provider is playing (see
  // `preparePlaybackFile`); deleted when playback moves on.
  const tempFileRef = useRef<string | null>(null);
  const [menuItem, setMenuItem] = useState<QueueItemInput | null>(null);

  const releaseTempFile = () => {
    const path = tempFileRef.current;
    tempFileRef.current = null;
    if (path) cleanupTempFile(path);
  };

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
    // The sleep timer carries on into the next sermon, as it does in other players: a
    // listener who set 30 minutes and lets a playlist run means 30 minutes, not "until
    // this one ends". Only closing the player clears it.
    detachedLoadRef.current += 1;
    releaseTempFile();
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
  }, []);

  const attach = useCallback((next: NowPlayingSession) => {
    sessionRef.current = next;
    setSession(next);
    setPlayer(playerRef.current);
    setAttached(true);
  }, []);

  const detach = useCallback(() => setAttached(false), []);

  const stop = useCallback(() => {
    setSleepMinutes(null);
    detachedLoadRef.current += 1;
    playerRef.current?.pause();
    sessionRef.current = null;
    setSession(null);
  }, [setSleepMinutes]);

  /**
   * Loads a queue item into the shared player with no player screen open: its download
   * when there is a finished one, else a fresh signed stream URL, then its resume point.
   * An item that can't play (locked, no media, a failed fetch) is skipped for the one
   * after it, so one bad item never stalls a long queue.
   */
  const playDetached = useCallback(
    async (item: QueueItem, skipsLeft = 5): Promise<void> => {
      const load = ++detachedLoadRef.current;
      const resolved = await resolveSource(queryClient, item.sermonId);
      if (load !== detachedLoadRef.current) {
        if (resolved?.tempFile) cleanupTempFile(resolved.tempFile);
        return;
      }
      if (!resolved) {
        const state = queueStore.get();
        const following = nextIndex(state);
        if (skipsLeft > 0 && following !== null && following !== state.index) {
          queueStore.set(skipTo(state, following));
          const nextItem = currentItem(queueStore.get());
          if (nextItem) await playDetached(nextItem, skipsLeft - 1);
        }
        return;
      }
      releaseTempFile();
      tempFileRef.current = resolved.tempFile;
      const input: SharedPlayerInput = {
        sermonId: item.sermonId,
        uri: resolved.uri,
        title: item.title,
        artist: item.artist,
        artworkUrl: item.artworkUrl,
        mediaType: resolved.mediaType,
      };
      let p = playerRef.current;
      if (p) {
        p.replace(sourceFor(input));
      } else {
        p = createVideoPlayer(sourceFor(input));
        playerRef.current = p;
        p.staysActiveInBackground = true;
        p.showNowPlayingNotification = true;
        p.timeUpdateEventInterval = 1;
      }
      pendingSeekRef.current = resolved.startAt > 0 ? resolved.startAt : null;
      const next: NowPlayingSession = {
        sermonId: item.sermonId,
        title: item.title,
        artist: item.artist,
        artworkUrl: item.artworkUrl,
        mediaType: resolved.mediaType,
      };
      sessionRef.current = next;
      setSession(next);
      setPlayer(p);
      p.play();
    },
    [queryClient],
  );

  /** Moves the queue to `index` and plays it, through the open screen when there is one. */
  const goTo = useCallback(
    (index: number) => {
      const before = queueStore.get();
      if (index === before.index) {
        // Repeat with a single item: start it over rather than reloading it.
        const p = playerRef.current;
        if (p) {
          p.currentTime = 0;
          p.play();
        }
        return;
      }
      queueStore.set(skipTo(before, index));
      const item = currentItem(queueStore.get());
      if (!item) return;
      if (navigatorRef.current) navigatorRef.current(item.sermonId);
      else void playDetached(item);
    },
    [playDetached],
  );

  /**
   * The sermon ended. Play what's next in the queue; at the end of it, the next episode in
   * the series when "Autoplay next in series" is on (You tab). The preference is read from
   * storage here rather than held in state, so a change in the You tab counts straight away.
   */
  const handleEnded = useCallback(async () => {
    const endedSession = sessionRef.current;
    const current = currentItem(queueStore.get());
    // The queue only drives what it is playing: anything else just stops, as before.
    if (!endedSession || !current || current.sermonId !== endedSession.sermonId) return;
    let index = nextIndex(queueStore.get());
    if (index === null && current.seriesId) {
      const episode = await findAutoplayEpisode(queryClient, current.seriesId, current.sermonId);
      if (episode && sessionRef.current?.sermonId === endedSession.sermonId) {
        queueStore.update((state) => appendAutoplay(state, queueItemFromSermon(episode, current.artworkUrl)));
        index = nextIndex(queueStore.get());
      }
    }
    if (index === null || sessionRef.current?.sermonId !== endedSession.sermonId) return;
    goTo(index);
  }, [goTo, queryClient]);

  const registerNavigator = useCallback((navigate: (sermonId: string) => void) => {
    navigatorRef.current = navigate;
    return () => {
      if (navigatorRef.current === navigate) navigatorRef.current = null;
    };
  }, []);

  const enqueue = useCallback(
    (input: QueueItemInput, where: 'next' | 'last') => {
      const nothingPlaying = !sessionRef.current;
      queueStore.update((state) => (nothingPlaying ? playNext({ ...state, items: [], index: -1 }, input) : where === 'next' ? playNext(state, input) : addToQueue(state, input)));
      AccessibilityInfo.announceForAccessibility?.(nothingPlaying ? `Playing ${input.title}` : where === 'next' ? 'Playing next' : 'Added to queue');
      if (nothingPlaying) {
        const item = currentItem(queueStore.get());
        if (item) void playDetached(item);
      }
    },
    [playDetached],
  );

  const openQueueMenu = useCallback((input: QueueItemInput) => setMenuItem(input), []);

  const value = useMemo<NowPlayingValue>(
    () => ({
      session,
      attached,
      player,
      acquire,
      attach,
      detach,
      stop,
      sleepTimer,
      registerNavigator,
      skipToIndex: goTo,
      enqueue,
      openQueueMenu,
    }),
    [session, attached, player, acquire, attach, detach, stop, sleepTimer, registerNavigator, goTo, enqueue, openQueueMenu],
  );

  return (
    <NowPlayingContext.Provider value={value}>
      {children}
      {player ? <QueueEvents player={player} pendingSeekRef={pendingSeekRef} onEnded={handleEnded} /> : null}
      {session && player && !attached ? (
        <DetachedProgress key={session.sermonId} sermonId={session.sermonId} player={player} sessionRef={sessionRef} />
      ) : null}
      <QueueMenuSheet
        item={menuItem}
        onClose={() => setMenuItem(null)}
        onPlayNext={(item) => enqueue(item, 'next')}
        onAddToQueue={(item) => enqueue(item, 'last')}
      />
    </NowPlayingContext.Provider>
  );
}

/** The shared player's end-of-sermon and ready events, for the queue. */
function QueueEvents({
  player,
  pendingSeekRef,
  onEnded,
}: {
  player: VideoPlayer;
  pendingSeekRef: React.MutableRefObject<number | null>;
  onEnded: () => Promise<void>;
}) {
  useEventListener(player, 'playToEnd', () => {
    void onEnded();
  });
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status !== 'readyToPlay' || pendingSeekRef.current === null) return;
    player.currentTime = pendingSeekRef.current;
    pendingSeekRef.current = null;
  });
  return null;
}

interface ResolvedSource {
  uri: string;
  mediaType: 'audio' | 'video';
  /** Seconds to resume from (0 for a fresh or finished sermon). */
  startAt: number;
  tempFile: string | null;
}

/** Where a sermon's bytes come from without the player screen: the same rules it uses. */
async function resolveSource(queryClient: QueryClient, sermonId: string): Promise<ResolvedSource | null> {
  try {
    const progress = queryClient
      .fetchQuery({
        queryKey: queryKeys.progress.detail(sermonId),
        queryFn: ({ signal }) =>
          api.get('/sermons/{sermon_id}/progress', { params: { path: { sermon_id: sermonId } }, init: { signal } }),
        staleTime: 0,
      })
      .catch(() => null);
    const manager = await downloads().catch(() => null);
    const record = manager ? await manager.getDownload(sermonId).catch(() => null) : null;
    let source: Omit<ResolvedSource, 'startAt'>;
    if (manager && record?.state === 'ready') {
      const path = await manager.preparePlaybackFile(sermonId);
      source = { uri: path, mediaType: record.mediaType, tempFile: path };
    } else {
      const stream = await queryClient.fetchQuery({
        queryKey: queryKeys.stream.detail(sermonId),
        queryFn: ({ signal }) =>
          api.get('/sermons/{sermon_id}/stream', { params: { path: { sermon_id: sermonId } }, init: { signal } }),
        staleTime: 0,
      });
      const variant = selectPlaybackVariant(stream.variants);
      if (!variant) return null;
      source = { uri: variant.url, mediaType: variant.type === 'video' ? 'video' : 'audio', tempFile: null };
    }
    const saved = await progress;
    return { ...source, startAt: saved && !saved.completed ? saved.position_seconds : 0 };
  } catch {
    return null;
  }
}

/** The series' next playable episode after `sermonId`, or null (also on a failed read). */
async function findAutoplayEpisode(queryClient: QueryClient, seriesId: string, sermonId: string) {
  try {
    const preferences = await loadPlaybackPreferences();
    if (!preferences.autoplayNextInSeries) return null;
    const episodes = await queryClient.fetchQuery({
      queryKey: queryKeys.series.episodes(seriesId),
      queryFn: ({ signal }) =>
        api.get('/series/{series_id}/episodes', { params: { path: { series_id: seriesId } }, init: { signal } }),
    });
    return nextEpisodeAfter(episodes, sermonId);
  } catch {
    return null;
  }
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
