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
import { DownloadPillButton, type DownloadPillItem } from '../../components/DownloadPillButton';
import { useDownloads } from '../../lib/downloads/useDownloads';
import { useLocalPlayback } from '../../lib/downloads/useLocalPlayback';
import { PlayerHeader } from './_player/PlayerHeader';
import { VideoSurface } from './_player/VideoSurface';
import { SleepTimerSheet } from './_player/SleepTimerSheet';
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
 * L5). Download (spec §3: "duplicates the Downloads-screen action — needs the same
 * in-progress/queued/complete states threaded through both entry points") is wired here
 * via the same `DownloadPillButton` sermon detail uses (session 2026-10-08 — the older,
 * plain-text `_detail/DownloadButton` this screen used before is retired with no
 * consumers left) — screen-agnostic against `useDownloads`, so this is composition, not a
 * second implementation of the download state machine. Now that both W4.2 (this screen)
 * and W4.5 (offline downloads) are real, every download entry point shares one button
 * skin and one state source, per spec.
 *
 * Layout (design spec comments-and-player §1, revised 2026-10-08 — no controls outside the
 * player): header, video with every control (scrub, time, speed, sleep, fullscreen, plus
 * play/pause/skip) folded into its own tap-to-toggle overlay, the download row, then the
 * comments panel in the remaining space. The whole screen sits in a `KeyboardAvoidingView`
 * so the pinned composer rides above the keyboard.
 */
export default function PlayerScreen() {
  const { id: sermonId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = () => router.back();

  const detailQuery = useSermonDetail(sermonId);
  const detail = detailQuery.data;
  const playable = detail ? isPlayable(detail) : false;

  // A `ready` download plays from its own local file instead of streaming (Isaac's ask,
  // session 2026-10-08: "watch or listen offline later" means an actual playback path,
  // not just a file sitting on disk) — `useStream`'s signed-URL fetch is skipped
  // entirely when one exists, so this screen makes no network call at all for a sermon
  // the user already downloaded.
  const downloads = useDownloads();
  const downloadRecord = downloads.find(sermonId);
  const isDownloaded = downloadRecord?.state === 'ready';

  const progressQuery = useSermonProgress(sermonId, { enabled: Boolean(detail) && playable });
  const streamQuery = useStream(sermonId, { enabled: Boolean(detail) && playable && !isDownloaded });
  const localPlayback = useLocalPlayback(sermonId, Boolean(detail) && playable && isDownloaded);
  const preferences = usePlaybackPreferences();

  const isLoading =
    detailQuery.isLoading ||
    downloads.isLoading ||
    preferences.isLoading ||
    (playable && progressQuery.isLoading) ||
    (playable && (isDownloaded ? localPlayback.isPreparing : streamQuery.isLoading));

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
        sermonId={sermonId}
        detail={detail}
        variant={variant}
        initialPositionSeconds={initialPositionSeconds}
        defaultSpeed={preferences.preferences.defaultSpeed}
        onChangeDefaultSpeed={preferences.setDefaultSpeed}
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
}: PlayerContentProps) {
  // Same single-item-or-empty shape sermon detail's own pill uses — every sermon has at
  // most one rendition, so this is never more than one entry.
  const downloadItems: DownloadPillItem[] = detail.media_type
    ? [
        {
          sermonId: detail.id,
          title: detail.title,
          mediaType: detail.media_type,
          thumbnailUrl: detail.thumbnail_url,
          category: detail.category_name,
        },
      ]
    : [];

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

  // The sermon ended: pin the overlay with a Replay control until playback resumes.
  const [isEnded, setIsEnded] = useState(false);
  useEventListener(player, 'playToEnd', () => setIsEnded(true));
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
      <View style={styles.downloadRow}>
        <DownloadPillButton items={downloadItems} />
      </View>
      <CommentsPanel sermonId={sermonId} />
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
  downloadRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
});
