import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEvent, useEventListener } from 'expo';
import type { VideoView } from 'expo-video';
import { useNowPlaying, useSharedPlayer } from '../../lib/playback/NowPlaying';
import { AppText, FittedArt, PrimaryButton, SkeletonBlock } from '../../components';
import { darkColors as onArt } from '../../theme/colors';
import { createThemedStyles } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { useSermonDetail, type SermonDetail } from '../../lib/query/hooks/useSermons';
import { useSermonProgress } from '../../lib/query/hooks/useSermonProgress';
import { useStream, selectPlaybackVariant, type StreamVariant } from '../../lib/query/hooks/useStream';
import { usePlaybackPreferences } from '../../lib/settings/usePlaybackPreferences';
import type { CaptionPreference, PlaybackSpeed } from '../../lib/settings/playbackPreferences';
import { isPlayable } from '../sermon/_detail/isPlayable';
import { useDownloads } from '../../lib/downloads/useDownloads';
import { useLocalPlayback } from '../../lib/downloads/useLocalPlayback';
import { useCachedSource } from '../../lib/mediaCache/useCachedSource';
import { usePlaylist, useRemovePlaylistItem } from '../../lib/query/hooks/usePlaylists';
import { useSeriesEpisodes } from '../../lib/query/hooks/useSeries';
import {
  clearUpcoming,
  moveToNext,
  nextEpisodeAfter,
  nextIndex,
  queueItemFromSermon,
  queueStore,
  removeItem,
  removeSermon,
  shuffleUpcoming,
  skipTo,
  syncToSermon,
  toggleRepeat,
  usePlaybackQueue,
  type QueueItem,
} from '../../lib/playback/queue';
import { shareContent } from '../../lib/share/shareContent';
import { VideoSurface } from './_player/VideoSurface';
import { SleepTimerSheet } from './_player/SleepTimerSheet';
import { QueueList, type QueueListProps } from './_player/QueueList';
import { CommentsPanel } from './_comments/CommentsPanel';
import { useControlsOverlay } from './_player/useControlsOverlay';
import { useProgressFlush } from './_player/useProgressFlush';
import { useSleepTimer } from './_player/useSleepTimer';
import { nextPlaybackSpeed } from './_player/cyclePlaybackSpeed';
import {
  activeCaptionLanguage,
  availableCaptionLanguages,
  nextCaptionPreference,
  trackForPreference,
} from './_player/captions';
import { SignaturePlayerHeader } from './_signature/SignaturePlayerHeader';
import { NowPlayingDetails } from './_signature/NowPlayingDetails';
import { PaneSwitch, type PlayerPane } from './_signature/PaneSwitch';
import { ListenPanel, ModeSwitch, type PlayerMode } from './_signature/ListenPanel';
import { useKeyboardVisible } from './_signature/useKeyboardVisible';
import { LEAF } from '../(tabs)/_home/signature/leaf';

/**
 * Player screen (design spec §3 "Player (1d, iOS) / Now playing (2b, Android)", plan
 * W4.2). `expo-video` on the Stream signed URL (`GET /sermons/{sermon_id}/stream`, the
 * F4-fixed read — L18), transport controls, speed, sleep timer, background audio,
 * lock-screen/Control-Center remote controls (`showNowPlayingNotification` +
 * `staysActiveInBackground`, both platforms), buffering state, the comments panel
 * (plan sermon-comments S13), and progress flush per L16.
 *
 * **Offline playback** (Isaac's ask, session 2026-10-08 — the sole playback surface for a
 * downloaded sermon now, replacing the Downloads tab's old standalone mini-player): when
 * `useDownloads().find(sermonId)` is `ready`, this screen never calls `useStream` at all —
 * `useLocalPlayback` resolves a local `file://` path instead (audio's path-A decrypted
 * copy, or video's own persisted file directly) and that becomes the player's `variant`,
 * same `expo-video` instance either way. Everything else (scrub, speed, sleep timer,
 * comments) is unchanged; only where the bytes come from differs.
 *
 * **Scope boundary:** the design spec's Player composition also names a "download" and
 * "share-clip" action pinned alongside transport controls. Share-clip is cut whole (plan
 * L5). Download's own pill lived here too for a while (session 2026-10-08) but is gone
 * again (Isaac's ask, session 2026-10-09 — it duplicated sermon/series detail's own
 * pill directly above the comments panel with nothing distinguishing the two); starting
 * a download is sermon/series detail's job exclusively now, this screen only plays back
 * whatever's already downloaded (`useLocalPlayback`, above).
 *
 * Layout (design spec comments-and-player §1, revised 2026-10-09 — no controls outside the
 * player): header, video with every control (scrub, time, speed, sleep, fullscreen, plus
 * play/pause/skip) folded into its own tap-to-toggle overlay, then the comments panel in
 * the remaining space. The whole screen sits in a `KeyboardAvoidingView` so the pinned
 * composer rides above the keyboard.
 *
 * **Queue** (Nii's review, 2026-11-14 — it used to work only inside a playlist): the
 * queue is app-wide now (`lib/playback/queue.ts`), not this screen's route params. Opening
 * a sermon from anywhere makes it the current item; a playlist's Play/Shuffle starts the
 * whole playlist; "Play next"/"Add to queue" on any row add to it. `NowPlayingProvider`
 * moves the queue on when a sermon ends, and at the end of the queue plays the next
 * episode in the series when "Autoplay next in series" is on (You tab). While this screen
 * is open it moves on through `router.setParams({ id })` (registered as the provider's
 * navigator), so the next sermon plays on this same screen with no navigation transition
 * (Isaac's ask, 2026-10-11). `PlayerContent` is `key={sermonId}`-ed so IT still remounts
 * on the new id (`useSharedPlayer`'s source and `useProgressFlush`'s resume baseline are
 * mount-time-only state); once the screen is closed the provider loads the next sermon
 * into the shared player itself, so the queue keeps going from the mini player.
 *
 * **Queue / Comments**: the panel under the title shows the queue (`QueueList`) or the
 * comments, with a switch at the foot. A playlist opens on its queue (Isaac's ask,
 * 2026-10-11: "open another page with all playlist items"); a single sermon opens on its
 * comments, as before.
 */
export default function PlayerScreen() {
  const styles = useStyles();
  const { id: sermonId, startAt } = useLocalSearchParams<{
    id: string;
    /** Whole seconds to start from instead of the saved resume point — a devotional's
        "sermon moment" (plan-daily-devotional M5). Cleared when the queue moves on. */
    startAt?: string;
  }>();
  const router = useRouter();
  const nowPlaying = useNowPlaying();
  const queue = usePlaybackQueue();
  const source = queue.source;
  const playlistId = source?.kind === 'playlist' ? source.id : undefined;

  // The queue moves to another sermon by changing this screen's own `id` param, so the
  // next one plays right here (see the doc comment above).
  const moveTo = (targetId: string) => router.setParams({ id: targetId, startAt: '' });
  useEffect(() => nowPlaying?.registerNavigator(moveTo), [nowPlaying?.registerNavigator]);

  const selectQueueItem = (index: number) => {
    if (nowPlaying) {
      nowPlaying.skipToIndex(index);
      return;
    }
    queueStore.update((state) => skipTo(state, index));
    const item = queueStore.get().items[index];
    if (item) moveTo(item.sermonId);
  };

  const goBack = () => router.back();

  const playlistQuery = usePlaylist(playlistId);
  const removeFromPlaylist = useRemovePlaylistItem(playlistId ?? '');

  // A `ready` download plays from its own local file instead of streaming (Isaac's ask,
  // session 2026-10-08: "watch or listen offline later" means an actual playback path,
  // not just a file sitting on disk) — `useStream`'s signed-URL fetch is skipped
  // entirely when one exists, so this screen makes no network call at all for a sermon
  // the user already downloaded.
  const downloads = useDownloads();
  const downloadRecord = downloads.find(sermonId);
  const isDownloaded = downloadRecord?.state === 'ready';

  const downloadQueueItem = (item: QueueItem) => {
    void downloads.download(item.sermonId, item.title, item.mediaType ?? 'audio', item.artworkUrl, item.category);
  };
  const shareQueueItem = (item: QueueItem) => {
    void shareContent({ title: item.title, description: null, deepLinkPath: `sermon/${item.sermonId}` });
  };

  const detailQuery = useSermonDetail(sermonId);
  const detail = detailQuery.data;
  const playable = detail ? isPlayable(detail) : false;

  const progressQuery = useSermonProgress(sermonId, { enabled: Boolean(detail) && playable });
  const streamQuery = useStream(sermonId, { enabled: Boolean(detail) && playable && !isDownloaded });
  const localPlayback = useLocalPlayback(sermonId, Boolean(detail) && playable && isDownloaded);
  const preferences = usePlaybackPreferences();

  // This sermon is the queue's current item from here on: opened from anywhere else it
  // plays now (keeping what the listener queued); reached through the queue, nothing moves.
  useEffect(() => {
    if (detail && playable) queueStore.update((state) => syncToSermon(state, queueItemFromSermon(detail)));
  }, [detail?.id, playable]);

  // What autoplay will pick when the queue runs out, shown at the foot of the queue.
  const current = queue.items[queue.index];
  const hasNext = nextIndex(queue) !== null;
  const autoplayOn = preferences.preferences.autoplayNextInSeries;
  const autoplaySeriesId = !hasNext && autoplayOn && current?.sermonId === sermonId ? (current.seriesId ?? '') : '';
  const seriesEpisodes = useSeriesEpisodes(autoplaySeriesId);
  const autoplayNext = autoplaySeriesId && seriesEpisodes.data ? nextEpisodeAfter(seriesEpisodes.data, sermonId) : null;

  const queueContext: QueueListProps = {
    title: source?.name ?? 'Up next',
    ownerName: playlistQuery.data?.owner_name ?? null,
    isPublic: playlistQuery.data?.is_public ?? true,
    items: queue.items,
    currentIndex: queue.index,
    repeatEnabled: queue.repeat,
    onToggleRepeat: () => queueStore.update(toggleRepeat),
    onShuffleRemaining: () => queueStore.update((state) => shuffleUpcoming(state)),
    onClearUpcoming: () => queueStore.update(clearUpcoming),
    onSelectItem: selectQueueItem,
    onPlayNext: (key) => queueStore.update((state) => moveToNext(state, key)),
    onRemoveFromQueue: (key) => queueStore.update((state) => removeItem(state, key)),
    onRemoveFromPlaylist: playlistId
      ? (item) => {
          if (!item.playlistItemId) return;
          removeFromPlaylist.mutate(item.playlistItemId);
          queueStore.update((state) => removeSermon(state, item.sermonId));
        }
      : undefined,
    onDownload: downloadQueueItem,
    onShare: shareQueueItem,
    autoplayNextTitle: autoplayNext?.title ?? null,
  };

  // The variant `useStream` would otherwise hand straight to the player, before the media
  // cache (S4) ever gets a say — computed unconditionally alongside the other hooks above
  // so `useCachedSource` (itself a hook) can be called before any of this component's
  // early returns below, same ordering requirement as every other hook here.
  const streamedVariant = !isDownloaded && streamQuery.data ? selectPlaybackVariant(streamQuery.data.variants) : null;
  const streamExpiresAt =
    streamQuery.data && streamQuery.dataUpdatedAt ? streamQuery.dataUpdatedAt + streamQuery.data.expires_in * 1000 : null;
  // S8/S9 review (finding B1/D11/D2): a cache hit may only ever happen once THIS mount has
  // its own confirmed, successful `/stream` — not merely "some data exists" (which could be
  // stale-but-cached, restored from disk, or never refreshed because the device is
  // offline and the query sits paused). `useStream` sets `staleTime: 0` /
  // `refetchOnMount: 'always'` specifically so `isFetchedAfterMount` is meaningful here:
  // it stays false until a genuinely fresh fetch completes for this mount. Gating only the
  // cache's own `enabled` (not the screen's overall loading state) means an uncached or
  // already-fresh sermon still opens at its usual speed; a reopened one just streams
  // normally — same as it always has — for the brief window before freshness confirms,
  // rather than being newly held behind a round-trip it didn't need before.
  const isStreamFreshThisMount = streamQuery.isFetchedAfterMount && !streamQuery.isError;
  const cacheSource = useCachedSource({
    sermonId,
    mediaRefs: detail?.media_refs ?? [],
    variant: streamedVariant,
    enabled: !isDownloaded && Boolean(streamedVariant) && isStreamFreshThisMount,
    expiresAt: streamExpiresAt,
  });

  const isLoading =
    detailQuery.isLoading ||
    downloads.isLoading ||
    preferences.isLoading ||
    (playable && progressQuery.isLoading) ||
    (playable && (isDownloaded ? localPlayback.isPreparing : streamQuery.isLoading || cacheSource.isLoading));

  // A sermon that can't play here (locked, or its media isn't ready) belongs on its own
  // detail page — every list in the app now opens the player directly (one transition,
  // Nii's ask 2026-10-23), so this is the one place that sends those few elsewhere.
  const redirectToDetail = Boolean(detail) && !playable;
  useEffect(() => {
    if (redirectToDetail) router.replace({ pathname: '/sermon/[id]', params: { id: sermonId } });
    // `router` is stable for the screen's lifetime; only the decision matters.
  }, [redirectToDetail, sermonId]);

  if (isLoading || redirectToDetail) {
    return (
      <View style={styles.screen}>
        <ScreenHeader onBack={goBack} detail={detail} />
        <PlayerLoading detail={detail} />
      </View>
    );
  }

  if (detailQuery.isError || !detail) {
    return (
      <View style={styles.screen}>
        <ScreenHeader onBack={goBack} />
        <PlayerError message="Something went wrong loading this sermon." onRetry={() => detailQuery.refetch()} />
      </View>
    );
  }

  if (isDownloaded) {
    if (localPlayback.error) {
      return (
        <View style={styles.screen}>
          <ScreenHeader onBack={goBack} detail={detail} />
          <PlayerError message={localPlayback.error} />
        </View>
      );
    }
  } else if (streamQuery.isError || !streamQuery.data) {
    return (
      <View style={styles.screen}>
        <ScreenHeader onBack={goBack} detail={detail} />
        <PlayerError message="Couldn't load this sermon's playback link." onRetry={() => streamQuery.refetch()} />
      </View>
    );
  }

  const variant: StreamVariant | null =
    isDownloaded && downloadRecord && localPlayback.localUri
      ? { type: downloadRecord.mediaType, quality: null, url: localPlayback.localUri }
      : streamedVariant
        ? { ...streamedVariant, url: cacheSource.effectiveUrl ?? streamedVariant.url }
        : null;
  if (!variant) {
    return (
      <View style={styles.screen}>
        <ScreenHeader onBack={goBack} detail={detail} />
        <PlayerError
          message="No playable audio or video was found for this sermon."
          onRetry={isDownloaded ? undefined : () => streamQuery.refetch()}
        />
      </View>
    );
  }

  const momentStart = startAt && /^\d+$/.test(startAt) ? Number(startAt) : null;
  const initialPositionSeconds =
    momentStart ?? (progressQuery.data && !progressQuery.data.completed ? progressQuery.data.position_seconds : 0);

  return (
    // Android needs no `behavior` at all here — same convention `(auth)/_components/
    // auth-screen.tsx` already established: `android:windowSoftInputMode="adjustResize"`
    // (AndroidManifest.xml) already shrinks the whole window when the keyboard opens, so
    // the composer (flex:1 below the fixed-aspect-ratio video surface) naturally ends up
    // in the smaller space without any JS-driven resize. `behavior="height"` (fixed
    // 2026-10-16, Isaac's report: the keyboard covered the comment input on Android) had
    // this screen double-handling the resize — the OS's own `adjustResize` shrink *and*
    // `KeyboardAvoidingView`'s own height adjustment stacked on top of it, measured off
    // `Keyboard`'s event frame rather than the window the OS had already resized, which
    // is what actually left the composer covered rather than pushed clear.
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader onBack={goBack} detail={detail} />
      {/* Mounted only once detail/progress/stream/preferences have all resolved — see
          `PlayerContent`'s own docstring for why that ordering matters (it seeds
          `useProgressFlush`'s resume baseline exactly once, at first render). */}
      <PlayerContent
        // Forces a fresh mount (new `useVideoPlayer`/`useProgressFlush` seed) when the
        // queue moves to a different sermon, since `PlayerScreen` itself no longer
        // navigates to do that (see `selectQueueItem`/`advanceToNext`'s own comment).
        key={sermonId}
        sermonId={sermonId}
        detail={detail}
        variant={variant}
        initialPositionSeconds={initialPositionSeconds}
        defaultSpeed={preferences.preferences.defaultSpeed}
        onChangeDefaultSpeed={preferences.setDefaultSpeed}
        captionPreference={preferences.preferences.captionLanguage}
        onChangeCaptionPreference={preferences.setCaptionLanguage}
        hasNext={hasNext}
        queueContext={queueContext}
        opensOnQueue={source?.kind === 'playlist'}
        onExit={cacheSource.reportExit}
      />
    </KeyboardAvoidingView>
  );
}

function ScreenHeader({ onBack, detail }: { onBack: () => void; detail?: SermonDetail }) {
  return <SignaturePlayerHeader onBack={onBack} detail={detail} />;
}

/**
 * The loading state wears the playing screen's own shape — a 16:9 stage (the sermon's art
 * once it's known, so an audio sermon's stage doesn't change at all when playback mounts),
 * the title block, then the panel below — so the swap to the real player reads as the
 * controls arriving rather than as a second screen transition.
 */
function PlayerLoading({ detail }: { detail?: SermonDetail }) {
  const styles = useStyles();
  return (
    <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Loading sermon">
      <View style={styles.loadingStage}>
        {detail?.thumbnail_url ? (
          <FittedArt uri={detail.thumbnail_url} />
        ) : null}
        <ActivityIndicator color={onArt.text.primary} />
      </View>
      {detail ? (
        <NowPlayingDetails detail={detail} />
      ) : (
        <View style={styles.loadingTitles}>
          <SkeletonBlock width="70%" height={26} radiusToken="sm" />
          <SkeletonBlock width="45%" height={14} radiusToken="sm" />
        </View>
      )}
      <View style={styles.loadingPanel} />
    </View>
  );
}

interface PlayerErrorProps {
  message: string;
  onRetry?: () => void;
}

function PlayerError({ message, onRetry }: PlayerErrorProps) {
  const styles = useStyles();
  return (
    <View style={styles.centered}>
      <AppText variant="ui.body" tone="secondary" style={styles.errorText}>
        {message}
      </AppText>
      {onRetry ? <PrimaryButton label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}

interface PlayerContentProps {
  sermonId: string;
  detail: SermonDetail;
  variant: StreamVariant;
  initialPositionSeconds: number;
  defaultSpeed: PlaybackSpeed;
  onChangeDefaultSpeed: (speed: PlaybackSpeed) => Promise<void>;
  /** Remembered subtitle choice ('off', 'en' or 'fr'), seeded once at mount like `defaultSpeed`. */
  captionPreference: CaptionPreference;
  onChangeCaptionPreference: (language: CaptionPreference) => Promise<void>;
  /** Something plays after this sermon, so its end moves on (`NowPlayingProvider`) rather
   * than pinning the Replay control. */
  hasNext: boolean;
  queueContext: QueueListProps;
  /** Open on the queue rather than the comments (a playlist was started). */
  opensOnQueue: boolean;
  /** Media-cache exit hook (plan S4, P1): called once, on unmount, with the final
   * position/duration — this component remounts (`key={sermonId}`) on every sermon
   * change and unmounts on screen exit, so its own unmount is exactly P1's "leaving a
   * sermon" (never a mere app-background, which doesn't unmount anything). A no-op for
   * a downloaded sermon or a cache hit — `useCachedSource`'s own `reportExit` decides. */
  onExit: (positionSeconds: number, durationSeconds: number | null) => void;
}

/**
 * The actual playing surface — split out from `PlayerScreen` so it only ever mounts once
 * every upstream read (detail, progress, stream, preferences) has resolved. That ordering
 * is load-bearing, not cosmetic: `useProgressFlush`'s resume baseline and this component's
 * own "seek to the resumed position, then play" effect both only read their seed values
 * (`initialPositionSeconds`, `defaultSpeed`) on first mount — mounting this component
 * before those reads settle would seed both from a stale zero/default instead of the
 * caller's real resume state.
 */
function PlayerContent({
  sermonId,
  detail,
  variant,
  initialPositionSeconds,
  defaultSpeed,
  onChangeDefaultSpeed,
  captionPreference,
  onChangeCaptionPreference,
  hasNext,
  queueContext,
  opensOnQueue,
  onExit,
}: PlayerContentProps) {
  const nowPlaying = useNowPlaying();
  // The app-wide player (`lib/playback/NowPlaying.tsx`), so the sermon keeps playing in
  // the mini player once this screen closes. `continued` is true when it already was.
  const { player, continued } = useSharedPlayer(
    {
      sermonId,
      uri: variant.url,
      title: detail.title,
      artist: detail.speaker_name ?? null,
      artworkUrl: detail.thumbnail_url ?? null,
      mediaType: variant.type === 'video' ? 'video' : 'audio',
    },
    (p) => {
      // Background audio + lock-screen/Control-Center remote controls (both platforms) —
      // the plan's own required scope, not an incidental extra. expo-video 2.0.x exposes no
      // option for the remote skip interval: its iOS NowPlayingManager hard-codes 10s
      // (`skipTimeInterval`) and its Android playback service uses `SEEK_INTERVAL_MS` =
      // 10000, so the lock-screen skip already matches this screen's 10s buttons.
      p.staysActiveInBackground = true;
      p.showNowPlayingNotification = true;
      // 1/sec is frequent enough for a smooth scrub bar and a responsive progress-flush
      // feed without spamming re-renders — `TimeUpdateEventPayload`'s own doc default is
      // 0 (off) if left unset.
      p.timeUpdateEventInterval = 1;
      p.playbackRate = defaultSpeed;
    },
  );

  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { muted: isMuted } = useEvent(player, 'mutedChange', { muted: player.muted });
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: player.bufferedPosition,
  });

  const progressFlush = useProgressFlush(sermonId, continued ? player.currentTime : initialPositionSeconds);
  useEffect(() => {
    // Back from the mini player mid-sermon: no `playingChange` will arrive to start the
    // periodic flush, so start it here.
    if (continued && player.playing) progressFlush.reportPlaying(true);
  }, []);

  useEventListener(player, 'timeUpdate', ({ currentTime: t }) => progressFlush.reportPosition(t));
  useEventListener(player, 'playingChange', ({ isPlaying: playing }) => progressFlush.reportPlaying(playing));
  useEventListener(player, 'playToEnd', () => progressFlush.reportCompleted());

  // Media-cache exit report (plan S4, P1) — a ref, not state, since nothing here should
  // re-render on every tick; only read once, at unmount, by the cleanup effect below.
  const exitReportRef = useRef<{ position: number; duration: number | null }>({ position: initialPositionSeconds, duration: null });
  useEventListener(player, 'timeUpdate', ({ currentTime: t }) => {
    exitReportRef.current = { position: t, duration: player.duration > 0 ? player.duration : null };
  });
  useEffect(() => {
    return () => onExit(exitReportRef.current.position, exitReportRef.current.duration);
    // Deliberately empty deps: this must fire exactly once, on this component's own
    // unmount (a sermon change via its `key={sermonId}`, or the screen exiting) — never
    // on a mere re-render — reading whatever the ref holds at that moment. `onExit` is
    // this render's closure, which is fine: only the LAST render before unmount matters,
    // same reasoning as the `[status]`-only effect above (no `react-hooks/exhaustive-deps`
    // rule is installed in this project to suppress here).
  }, []);

  // Seek to the resume position and start playback exactly once, the first time the
  // player reports it has enough data to play — not on every later `readyToPlay` a
  // mid-session rebuffer might also report, which would otherwise jump playback back to
  // the original resume point.
  const hasStartedRef = useRef(continued);
  useEffect(() => {
    if (status === 'readyToPlay' && !hasStartedRef.current) {
      hasStartedRef.current = true;
      if (initialPositionSeconds > 0) player.currentTime = initialPositionSeconds;
      player.play();
    }
    // Deliberately `[status]` only — `player`/`initialPositionSeconds` are this
    // component's own mount-time seeds, not reactive inputs. (No `react-hooks/
    // exhaustive-deps` rule is installed in this project to suppress here.)
  }, [status]);

  const [speed, setSpeed] = useState<PlaybackSpeed>(continued ? (player.playbackRate as PlaybackSpeed) : defaultSpeed);
  useEffect(() => {
    player.playbackRate = speed;
    // Deliberately `[speed]` only — `player` is stable for this component's lifetime.
  }, [speed]);

  const chooseSpeed = (next: PlaybackSpeed) => {
    setSpeed(next);
    onChangeDefaultSpeed(next).catch(() => {});
  };

  const cycleSpeed = () => {
    const next = nextPlaybackSpeed(speed);
    setSpeed(next);
    // Speed is also the Profile & Settings "default speed" preference (§3/1n) — kept in
    // sync so the two never drift apart. Best-effort: a persistence failure here doesn't
    // interrupt playback, `usePlaybackPreferences` already reverts its own local state.
    onChangeDefaultSpeed(next).catch(() => {});
  };

  // Subtitles: the HLS manifest carries the English/French caption tracks; they show up
  // here once the source has loaded. The remembered preference picks the track, falling
  // back to English when the chosen language isn't on this video.
  const { availableSubtitleTracks } = useEvent(player, 'availableSubtitleTracksChange', {
    availableSubtitleTracks: player.availableSubtitleTracks ?? [],
  });
  const subtitleTracks = availableSubtitleTracks ?? [];
  const captionLanguages = availableCaptionLanguages(subtitleTracks);
  const [captions, setCaptions] = useState<CaptionPreference>(captionPreference);
  const shownTrack = trackForPreference(subtitleTracks, captions);
  const shownCaptionLanguage = activeCaptionLanguage(shownTrack);
  useEffect(() => {
    // Best-effort: a native refusal must never interrupt playback.
    try {
      player.subtitleTrack = shownTrack;
    } catch {
      // ignore
    }
    // Keyed on the resolved language, not the track object (a fresh array each event).
  }, [shownCaptionLanguage, subtitleTracks.length]);

  const cycleCaptions = () => {
    const next = nextCaptionPreference(shownCaptionLanguage ?? 'off', captionLanguages);
    setCaptions(next);
    onChangeCaptionPreference(next).catch(() => {});
  };

  // The shared timer when there is one, so it outlives this screen (see `NowPlaying`).
  const ownSleepTimer = useSleepTimer({ onExpire: () => player.pause() });
  const sleepTimer = nowPlaying?.sleepTimer ?? ownSleepTimer;
  const [sleepSheetOpen, setSleepSheetOpen] = useState(false);

  const videoRef = useRef<VideoView>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = () => {
    const view = videoRef.current;
    if (!view) return;
    // Best-effort: a platform that refuses fullscreen leaves playback untouched.
    (isFullscreen ? view.exitFullscreen() : view.enterFullscreen()).catch(() => {});
  };

  // The sermon ended: pin the overlay with a Replay control until playback resumes —
  // unless something is queued after it, in which case the queue moves on by itself
  // (`NowPlayingProvider`) instead of waiting on a Replay tap nobody asked for. When only
  // autoplay might follow, Replay shows until the next episode loads in its place.
  const [isEnded, setIsEnded] = useState(false);
  useEventListener(player, 'playToEnd', () => {
    if (!hasNext) setIsEnded(true);
  });
  useEventListener(player, 'playingChange', ({ isPlaying: playing }) => {
    if (playing) setIsEnded(false);
  });

  const [isScrubbing, setIsScrubbing] = useState(false);
  const overlay = useControlsOverlay({
    isPlaying,
    isBuffering: status === 'loading',
    isEnded,
    pinned: sleepSheetOpen || isScrubbing,
  });

  const duration = player.duration > 0 ? player.duration : null;

  const sleepSheet = (
    <SleepTimerSheet
      visible={sleepSheetOpen}
      hasActiveTimer={sleepTimer.remainingSeconds !== null}
      remainingSeconds={sleepTimer.remainingSeconds}
      onSelect={(minutes) => sleepTimer.setMinutes(minutes)}
      speed={speed}
      onSpeed={chooseSpeed}
      // Counts down the rest of the sermon at the current speed (less two seconds, so it
      // lands before the end), then pauses: in a playlist that stops it moving on.
      minutesToEnd={duration ? Math.max(0, duration - currentTime - 2) / speed / 60 : null}
      onClose={() => setSleepSheetOpen(false)}
    />
  );

  const video = (
    <VideoSurface
      player={player}
      videoRef={videoRef}
      isBuffering={status === 'loading'}
      isPlaying={isPlaying}
      isEnded={isEnded}
      isAudio={variant.type === 'audio'}
      artworkUrl={detail.thumbnail_url}
      overlay={overlay}
      isFullscreen={isFullscreen}
      onFullscreenChange={setIsFullscreen}
      onTogglePlay={() => (isPlaying ? player.pause() : player.play())}
      onReplay={() => {
        // `player.replay()` only seeks back to 0 — it does not resume playback (see its
        // own doc comment: "Seeks the playback to the beginning"). Without the explicit
        // `play()`, the sermon just sits paused at frame 0 and Replay looks like it does
        // nothing.
        player.replay();
        player.play();
      }}
      onSeekBy={(seconds) => player.seekBy(seconds)}
      currentTimeSeconds={currentTime}
      durationSeconds={duration}
      playbackSpeed={speed}
      sleepRemainingSeconds={sleepTimer.remainingSeconds}
      isMuted={isMuted}
      onToggleMute={() => {
        player.muted = !player.muted;
      }}
      onSeekTo={(seconds) => {
        player.currentTime = seconds;
      }}
      onScrubStart={() => setIsScrubbing(true)}
      onScrubEnd={() => setIsScrubbing(false)}
      onCycleSpeed={cycleSpeed}
      captionLanguages={captionLanguages}
      activeCaptionLanguage={shownCaptionLanguage}
      onCycleCaptions={cycleCaptions}
      onOpenSleepTimer={() => setSleepSheetOpen(true)}
      onToggleFullscreen={toggleFullscreen}
    />
  );

  // Watch / Listen (Daybreak canvas C3/C4): the same player either way.
  const [mode, setMode] = useState<PlayerMode>('watch');
  const listen = (
    <ListenPanel
      artworkUrl={detail.thumbnail_url ?? null}
      isPlaying={isPlaying}
      isBuffering={status === 'loading'}
      isEnded={isEnded}
      currentTimeSeconds={currentTime}
      durationSeconds={duration}
      playbackSpeed={speed}
      sleepRemainingSeconds={sleepTimer.remainingSeconds}
      onTogglePlay={() => (isPlaying ? player.pause() : player.play())}
      onReplay={() => {
        player.replay();
        player.play();
      }}
      onSeekBy={(seconds) => player.seekBy(seconds)}
      onSeekTo={(seconds) => {
        player.currentTime = seconds;
      }}
      onScrubStart={() => setIsScrubbing(true)}
      onScrubEnd={() => setIsScrubbing(false)}
      onCycleSpeed={cycleSpeed}
      onOpenSleepTimer={() => setSleepSheetOpen(true)}
    />
  );

  return (
    <SignatureLayout
      sermonId={sermonId}
      detail={detail}
      queueContext={queueContext}
      opensOnQueue={opensOnQueue}
      isPlaying={isPlaying}
      video={video}
      listen={listen}
      mode={mode}
      onModeChange={setMode}
      sleepSheet={sleepSheet}
    />
  );
}

interface SignatureLayoutProps {
  sermonId: string;
  detail: SermonDetail;
  queueContext: QueueListProps;
  opensOnQueue: boolean;
  isPlaying: boolean;
  video: React.ReactNode;
  listen: React.ReactNode;
  mode: PlayerMode;
  onModeChange: (mode: PlayerMode) => void;
  sleepSheet: React.ReactNode;
}

/**
 * Signature player layout: every playback control (scrub, speed, sleep timer, full screen)
 * still on its overlay (Nii, 2026-10-22: "all player controls must be kept on player"), then
 * the title block with Like / My List / Download / Share, then the queue or the comments
 * with a Queue / Comments switch at the bottom. A playlist opens on its queue, anything else
 * on its comments. The title block and that switch fold away while the keyboard is up so the
 * comment composer keeps its room. Playback itself is `PlayerContent`'s, unchanged.
 */
function SignatureLayout({
  sermonId,
  detail,
  queueContext,
  opensOnQueue,
  isPlaying,
  video,
  listen,
  mode,
  onModeChange,
  sleepSheet,
}: SignatureLayoutProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const [pane, setPane] = useState<PlayerPane>(opensOnQueue ? 'queue' : 'comments');
  const showQueue = pane === 'queue';

  return (
    <>
      {keyboardVisible ? null : <ModeSwitch mode={mode} onChange={onModeChange} />}
      {mode === 'listen' ? (keyboardVisible ? null : listen) : video}
      {keyboardVisible ? null : <NowPlayingDetails detail={detail} />}
      {showQueue ? (
        <View style={styles.queueCard}>
          <QueueList {...queueContext} isPlaying={isPlaying} />
        </View>
      ) : (
        <CommentsPanel sermonId={sermonId} variant="signature" />
      )}
      {keyboardVisible ? null : (
        <PaneSwitch pane={showQueue ? 'queue' : 'comments'} onSelectPane={setPane} bottomInset={insets.bottom} />
      )}
      {sleepSheet}
    </>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xxl,
  },
  errorText: {
    textAlign: 'center',
  },
  loading: {
    flex: 1,
  },
  loadingStage: {
    width: '100%',
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
    // The video stage is dark in both themes (`VideoSurface`).
    backgroundColor: onArt.surface.app,
  },
  loadingTitles: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  loadingPanel: {
    ...LEAF,
    flex: 1,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface.raised,
  },
  queueCard: {
    ...LEAF,
    flex: 1,
    marginHorizontal: spacing.lg,
    overflow: 'hidden',
  },
}));
