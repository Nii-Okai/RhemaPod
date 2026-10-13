import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, type VideoView } from 'expo-video';
import { AppText, PrimaryButton } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useSermonDetail, type SermonDetail } from '../../lib/query/hooks/useSermons';
import { useSermonProgress } from '../../lib/query/hooks/useSermonProgress';
import { useStream, selectPlaybackVariant, type StreamVariant } from '../../lib/query/hooks/useStream';
import { usePlaybackPreferences } from '../../lib/settings/usePlaybackPreferences';
import type { PlaybackSpeed } from '../../lib/settings/playbackPreferences';
import { isPlayable } from '../sermon/_detail/isPlayable';
import { useDownloads } from '../../lib/downloads/useDownloads';
import { useLocalPlayback } from '../../lib/downloads/useLocalPlayback';
import { usePlaylist, useRemovePlaylistItem, type PlaylistItemPublic } from '../../lib/query/hooks/usePlaylists';
import { shuffled } from '../playlist/_detail/playlistQueue';
import { shareContent } from '../../lib/share/shareContent';
import { PlayerHeader } from './_player/PlayerHeader';
import { VideoSurface } from './_player/VideoSurface';
import { SleepTimerSheet } from './_player/SleepTimerSheet';
import { QueueList, type QueueListProps } from './_player/QueueList';
import { CommentsPanel } from './_comments/CommentsPanel';
import { useControlsOverlay } from './_player/useControlsOverlay';
import { useProgressFlush } from './_player/useProgressFlush';
import { useSleepTimer } from './_player/useSleepTimer';
import { nextPlaybackSpeed } from './_player/cyclePlaybackSpeed';

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
 * **Playlist queue** (Isaac's ask, session 2026-10-10 — "play items in their playlist"):
 * opened with `queue`/`queueIndex`/`playlistId` route params (`[id].tsx`'s own Play/
 * Shuffle), this screen auto-advances to the next sermon on `playToEnd` instead of
 * sitting on a Replay control — `router.replace`, not `push`, so playing through a long
 * playlist doesn't stack a screen per item. Opened any other way (a detail page's play
 * button, a notification), those params are absent and playback behaves exactly as
 * before: it just stops at the end.
 *
 * **Queue list, not comments** (Isaac's ask, session 2026-10-11: "Do not open player
 * page with comments, rather open another page with all playlist items"): when opened
 * with a `playlistId`, `QueueList` takes the comments panel's exact spot below the
 * video/transport controls — those are unchanged, only what's underneath them differs.
 * `repeat` is a fourth route param (`'1'`/absent), toggled via `router.setParams`.
 *
 * Tapping a queue row, and auto-advancing on `playToEnd`, both move to a different
 * sermon via `router.setParams` too, not `router.replace` (Isaac's own follow-up, same
 * session: "do not open a new screen, stay on the same screen to play next item") — `id`
 * is just another param on this one mounted route, same as `queue`/`queueIndex`, so
 * updating it in place re-renders `PlayerScreen` with the new sermon id and no
 * navigation transition at all. `PlayerContent` below is `key={sermonId}`-ed
 * specifically so IT still remounts when the id changes (`useVideoPlayer`'s source and
 * `useProgressFlush`'s resume baseline are both genuinely mount-time-only state — see
 * `PlayerContent`'s own doc comment), without that inner remount reading as the user
 * having left the screen.
 */
export default function PlayerScreen() {
  const { id: sermonId, queue, queueIndex, playlistId, repeat } = useLocalSearchParams<{
    id: string;
    queue?: string;
    queueIndex?: string;
    playlistId?: string;
    repeat?: string;
  }>();
  const router = useRouter();
  // Playing through a playlist (`[id].tsx`'s own Play/Shuffle, Isaac's ask, session
  // 2026-10-10) — `queue` is the whole ordered sermon-id list, `queueIndex` this
  // sermon's own position in it. `null` for every other way into this screen (a
  // sermon/series detail page's own play button, a notification deep link, ...), which
  // all still just play the one sermon and stop, same as always.
  const queueIds = queue ? queue.split(',') : null;
  const currentQueueIndex = queueIndex ? Number(queueIndex) : 0;
  const repeatEnabled = repeat === '1';

  const buildQueueParams = (targetId: string, index: number) => {
    const params: Record<string, string> = { id: targetId, queue: queue!, queueIndex: String(index) };
    if (playlistId) params.playlistId = playlistId;
    if (repeat) params.repeat = repeat;
    return params;
  };

  // Repeat wraps to the queue's own first item once the last one ends, instead of
  // just stopping (Isaac's ask, same session as the queue list itself — "make them
  // real" when asked whether repeat/shuffle should actually do anything).
  const nextInQueue = queueIds
    ? currentQueueIndex + 1 < queueIds.length
      ? { id: queueIds[currentQueueIndex + 1]!, index: currentQueueIndex + 1 }
      : repeatEnabled && queueIds.length > 0
        ? { id: queueIds[0]!, index: 0 }
        : null
    : null;
  // `setParams`, not `replace` — a jump within the same queue should stay on this
  // screen, no navigation transition (Isaac's ask, session 2026-10-11: "do not open a
  // new screen, stay on the same screen to play next item"). `id` is just another
  // param on this same mounted route (same as `queue`/`queueIndex`/`repeat`), so
  // updating it in place re-renders `PlayerScreen` with the new sermon id — no push,
  // no replace, no back-stack entry. `PlayerContent` below is keyed on `sermonId`
  // specifically so it still remounts *internally* when that id changes (a fresh
  // `useVideoPlayer` source and freshly seeded `useProgressFlush` baseline — both are
  // genuinely mount-time-only state, see `PlayerContent`'s own doc comment), without
  // that remount being a *navigation* the user perceives as leaving the screen.
  const advanceToNext = nextInQueue ? () => router.setParams(buildQueueParams(nextInQueue.id, nextInQueue.index)) : null;

  const selectQueueItem = (targetId: string, index: number) => router.setParams(buildQueueParams(targetId, index));

  // No remount — the currently-playing sermon doesn't change, only what happens later.
  const toggleRepeat = () => router.setParams({ repeat: repeatEnabled ? '0' : '1' });

  const shuffleRemaining = () => {
    if (!queueIds) return;
    const played = queueIds.slice(0, currentQueueIndex + 1);
    const remaining = shuffled(queueIds.slice(currentQueueIndex + 1));
    router.setParams({ queue: [...played, ...remaining].join(',') });
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

  const queueDisplayItems: PlaylistItemPublic[] = queueIds
    ? (queueIds
        .map((sid) => playlistQuery.data?.items.find((item) => item.sermon.id === sid))
        .filter(Boolean) as PlaylistItemPublic[])
    : [];

  const downloadQueueItem = (item: PlaylistItemPublic) => {
    void downloads.download(item.sermon.id, item.sermon.title, item.sermon.media_type ?? 'audio', item.sermon.thumbnail_url, item.sermon.category_name);
  };
  const shareQueueItem = (item: PlaylistItemPublic) => {
    void shareContent({
      title: item.sermon.title,
      description: item.sermon.description,
      thumbnailUrl: item.sermon.thumbnail_url,
      deepLinkPath: `sermon/${item.sermon.id}`,
    });
  };

  const queueContext: QueueListProps | null =
    playlistId && playlistQuery.data
      ? {
          playlistName: playlistQuery.data.name,
          ownerName: playlistQuery.data.owner_name,
          isPublic: playlistQuery.data.is_public,
          items: queueDisplayItems,
          currentIndex: currentQueueIndex,
          repeatEnabled,
          onToggleRepeat: toggleRepeat,
          onShuffleRemaining: shuffleRemaining,
          onSelectItem: selectQueueItem,
          onRemove: (itemId) => removeFromPlaylist.mutate(itemId),
          onDownload: downloadQueueItem,
          onShare: shareQueueItem,
        }
      : null;

  const detailQuery = useSermonDetail(sermonId);
  const detail = detailQuery.data;
  const playable = detail ? isPlayable(detail) : false;

  const progressQuery = useSermonProgress(sermonId, { enabled: Boolean(detail) && playable });
  const streamQuery = useStream(sermonId, { enabled: Boolean(detail) && playable && !isDownloaded });
  const localPlayback = useLocalPlayback(sermonId, Boolean(detail) && playable && isDownloaded);
  const preferences = usePlaybackPreferences();

  const isLoading =
    detailQuery.isLoading ||
    downloads.isLoading ||
    preferences.isLoading ||
    (playable && progressQuery.isLoading) ||
    (playable && (isDownloaded ? localPlayback.isPreparing : streamQuery.isLoading)) ||
    // Blocks on the playlist read too, when there is one — `PlayerContent` renders
    // `QueueList` only once `queueContext` is non-null (`playlistQuery.data` present),
    // otherwise it falls back to the comments panel; without this, that fallback would
    // flash on screen for the instant before the (usually cache-warm, since the user
    // just came from the playlist page) playlist read resolves.
    (Boolean(playlistId) && playlistQuery.isLoading);

  if (isLoading) {
    return (
      <View style={styles.screen}>
        <PlayerHeader onBack={goBack} title={detail?.title} />
        <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel="Loading sermon">
          <AppText variant="ui.body" tone="secondary">
            Loading…
          </AppText>
        </View>
      </View>
    );
  }

  if (detailQuery.isError || !detail) {
    return (
      <View style={styles.screen}>
        <PlayerHeader onBack={goBack} />
        <PlayerError message="Something went wrong loading this sermon." onRetry={() => detailQuery.refetch()} />
      </View>
    );
  }

  if (!playable) {
    // Reachable only via a direct/stale deep link — the sermon-detail CTA that pushes here
    // is itself disabled for a non-playable sermon (`isPlayable`), so this is a landing
    // guard, not a state the app's own navigation ever produces.
    return (
      <View style={styles.screen}>
        <PlayerHeader onBack={goBack} title={detail.title} />
        <PlayerError message="This sermon isn't available yet." />
      </View>
    );
  }

  if (isDownloaded) {
    if (localPlayback.error) {
      return (
        <View style={styles.screen}>
          <PlayerHeader onBack={goBack} title={detail.title} />
          <PlayerError message={localPlayback.error} />
        </View>
      );
    }
  } else if (streamQuery.isError || !streamQuery.data) {
    return (
      <View style={styles.screen}>
        <PlayerHeader onBack={goBack} title={detail.title} />
        <PlayerError message="Couldn't load this sermon's playback link." onRetry={() => streamQuery.refetch()} />
      </View>
    );
  }

  const variant: StreamVariant | null =
    isDownloaded && downloadRecord && localPlayback.localUri
      ? { type: downloadRecord.mediaType, quality: null, url: localPlayback.localUri }
      : !isDownloaded && streamQuery.data
        ? selectPlaybackVariant(streamQuery.data.variants)
        : null;
  if (!variant) {
    return (
      <View style={styles.screen}>
        <PlayerHeader onBack={goBack} title={detail.title} />
        <PlayerError
          message="No playable audio or video was found for this sermon."
          onRetry={isDownloaded ? undefined : () => streamQuery.refetch()}
        />
      </View>
    );
  }

  const initialPositionSeconds =
    progressQuery.data && !progressQuery.data.completed ? progressQuery.data.position_seconds : 0;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <PlayerHeader onBack={goBack} title={detail.title} />
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
        onPlayToEnd={advanceToNext}
        queueContext={queueContext}
      />
    </KeyboardAvoidingView>
  );
}

interface PlayerErrorProps {
  message: string;
  onRetry?: () => void;
}

function PlayerError({ message, onRetry }: PlayerErrorProps) {
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
  /** Advances to the next sermon in a playlist queue — `null` when this sermon wasn't
   * opened as part of one, or is the queue's last item and repeat is off (see
   * `PlayerScreen`'s own doc comment on `queue`/`queueIndex`/`repeat`). */
  onPlayToEnd: (() => void) | null;
  /** Renders `QueueList` in place of `CommentsPanel` when present — see `PlayerScreen`'s
   * own doc comment on "Queue list, not comments". */
  queueContext: QueueListProps | null;
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
  onPlayToEnd,
  queueContext,
}: PlayerContentProps) {
  const player = useVideoPlayer(
    {
      uri: variant.url,
      metadata: {
        title: detail.title,
        artist: detail.speaker_name ?? undefined,
        artwork: detail.thumbnail_url ?? undefined,
      },
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
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: player.bufferedPosition,
  });

  const progressFlush = useProgressFlush(sermonId, initialPositionSeconds);

  useEventListener(player, 'timeUpdate', ({ currentTime: t }) => progressFlush.reportPosition(t));
  useEventListener(player, 'playingChange', ({ isPlaying: playing }) => progressFlush.reportPlaying(playing));
  useEventListener(player, 'playToEnd', () => progressFlush.reportCompleted());

  // Seek to the resume position and start playback exactly once, the first time the
  // player reports it has enough data to play — not on every later `readyToPlay` a
  // mid-session rebuffer might also report, which would otherwise jump playback back to
  // the original resume point.
  const hasStartedRef = useRef(false);
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

  const [speed, setSpeed] = useState<PlaybackSpeed>(defaultSpeed);
  useEffect(() => {
    player.playbackRate = speed;
    // Deliberately `[speed]` only — `player` is stable for this component's lifetime.
  }, [speed]);

  const cycleSpeed = () => {
    const next = nextPlaybackSpeed(speed);
    setSpeed(next);
    // Speed is also the Profile & Settings "default speed" preference (§3/1n) — kept in
    // sync so the two never drift apart. Best-effort: a persistence failure here doesn't
    // interrupt playback, `usePlaybackPreferences` already reverts its own local state.
    onChangeDefaultSpeed(next).catch(() => {});
  };

  const sleepTimer = useSleepTimer({ onExpire: () => player.pause() });
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
  // unless there's a next item queued up (a playlist's Play/Shuffle), in which case
  // this screen moves on by itself instead of waiting on a Replay tap nobody asked for.
  const [isEnded, setIsEnded] = useState(false);
  useEventListener(player, 'playToEnd', () => {
    if (onPlayToEnd) onPlayToEnd();
    else setIsEnded(true);
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

  return (
    <>
      <VideoSurface
        player={player}
        videoRef={videoRef}
        isBuffering={status === 'loading'}
        isPlaying={isPlaying}
        isEnded={isEnded}
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
        onSeekTo={(seconds) => {
          player.currentTime = seconds;
        }}
        onScrubStart={() => setIsScrubbing(true)}
        onScrubEnd={() => setIsScrubbing(false)}
        onCycleSpeed={cycleSpeed}
        onOpenSleepTimer={() => setSleepSheetOpen(true)}
        onToggleFullscreen={toggleFullscreen}
      />
      {queueContext ? <QueueList {...queueContext} /> : <CommentsPanel sermonId={sermonId} />}
      <SleepTimerSheet
        visible={sleepSheetOpen}
        hasActiveTimer={sleepTimer.remainingSeconds !== null}
        onSelect={(minutes) => sleepTimer.setMinutes(minutes)}
        onClose={() => setSleepSheetOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
});
