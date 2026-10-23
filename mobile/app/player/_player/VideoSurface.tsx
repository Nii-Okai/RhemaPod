import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Pressable, StyleSheet, View } from 'react-native';
import { VideoView } from 'expo-video';
import type { VideoPlayer } from 'expo-video';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { PlaybackOverlayControls, PlayerBottomBar } from './TransportControls';
import type { ControlsOverlay } from './useControlsOverlay';
import type { PlaybackSpeed } from '../../../lib/settings/playbackPreferences';

const FADE_IN_MS = 150;
const FADE_OUT_MS = 200;

export interface VideoSurfaceProps {
  player: VideoPlayer;
  /** Ref to the underlying `VideoView`, so the controls can request native fullscreen. */
  videoRef: React.RefObject<VideoView>;
  /** Derived from the player's own `status` (`'loading'`). */
  isBuffering: boolean;
  isPlaying: boolean;
  isEnded: boolean;
  /** True for an audio-only sermon — renders the sermon's artwork behind the controls
   * instead of (visually, atop) the `VideoView`, so the surface isn't just a flat dark
   * rectangle while audio plays. `VideoView` itself still mounts either way: the player
   * needs it for playback regardless of media type, it just never shows visible frames
   * for an audio-only source. */
  isAudio: boolean;
  /** The sermon's thumbnail — same URL the lock-screen/Control-Center metadata already
   * uses (`detail.thumbnail_url`, `PlayerContent`'s own `artwork` metadata field).
   * `null`/`undefined` falls back to the plain dark surface, same as before this prop
   * existed. */
  artworkUrl?: string | null;
  overlay: ControlsOverlay;
  isFullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
  onTogglePlay: () => void;
  onReplay: () => void;
  onSeekBy: (seconds: number) => void;
  /** The rest of what used to be the separate below-player bar (design spec revision,
   * Isaac's ask session 2026-10-08: no buttons outside the player — scrub, time, speed,
   * sleep timer and fullscreen all move onto the video surface itself, in the same
   * tap-to-toggle, auto-hiding overlay as play/pause/skip). */
  currentTimeSeconds: number;
  durationSeconds: number | null;
  playbackSpeed: PlaybackSpeed;
  sleepRemainingSeconds: number | null;
  isMuted: boolean;
  onToggleMute: () => void;
  onSeekTo: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onCycleSpeed: () => void;
  onOpenSleepTimer: () => void;
  onToggleFullscreen: () => void;
}

/**
 * The video area (design spec comments-and-player §1.2, revised 2026-10-08): a 16:9 surface
 * with a single tap-to-toggle overlay holding every control — a dimmer, rewind / play-pause /
 * forward centred over the video, and the scrub bar / time / speed / sleep timer / fullscreen
 * row anchored to its bottom edge. Nothing plays-related renders outside this surface. The
 * overlay fades in and out (instantly under Reduce Motion) and auto-hides per
 * `useControlsOverlay`. Inline, native controls are off: this app draws its own. In native
 * fullscreen they switch on and the OS controls take over (so the overlay is not drawn
 * there); exiting returns to the inline layout with the playback position intact, since it is
 * the same player.
 */
export function VideoSurface({
  player,
  videoRef,
  isBuffering,
  isPlaying,
  isEnded,
  isAudio,
  artworkUrl,
  overlay,
  isFullscreen,
  onFullscreenChange,
  onTogglePlay,
  onReplay,
  onSeekBy,
  currentTimeSeconds,
  durationSeconds,
  playbackSpeed,
  sleepRemainingSeconds,
  isMuted,
  onToggleMute,
  onSeekTo,
  onScrubStart,
  onScrubEnd,
  onCycleSpeed,
  onOpenSleepTimer,
  onToggleFullscreen,
}: VideoSurfaceProps) {
  const { visible, reduceMotion } = overlay;
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [rendered, setRendered] = useState(visible);

  useEffect(() => {
    if (visible) setRendered(true);
    if (reduceMotion) {
      opacity.setValue(visible ? 1 : 0);
      if (!visible) setRendered(false);
      return;
    }
    const duration = visible ? FADE_IN_MS : FADE_OUT_MS;
    Animated.timing(opacity, { toValue: visible ? 1 : 0, duration, useNativeDriver: true }).start();
    if (visible) return;
    // Unmount the controls once the fade-out has run. A timer rather than the animation's
    // completion callback, which a natively-driven animation may never deliver.
    const unmount = setTimeout(() => setRendered(false), FADE_OUT_MS);
    return () => clearTimeout(unmount);
  }, [visible, reduceMotion, opacity]);

  const act = (action: () => void) => () => {
    overlay.touch();
    action();
  };

  return (
    <View style={styles.wrap}>
      <VideoView
        ref={videoRef}
        player={player}
        style={styles.video}
        nativeControls={isFullscreen}
        allowsFullscreen
        onFullscreenEnter={() => onFullscreenChange(true)}
        onFullscreenExit={() => onFullscreenChange(false)}
        contentFit="contain"
      />
      {isAudio && artworkUrl ? (
        // Audio has no visible video frames — without this the surface is just the flat
        // dark `colors.surface.app` rectangle the whole time audio plays, with nothing to
        // show playback is active (Isaac's report). Rendered *over* `VideoView` (which
        // still mounts regardless — the player needs it to actually play the audio, and
        // the fullscreen control still targets it) rather than behind it: a native video
        // surface's own paint behavior for a track-less audio source isn't guaranteed
        // transparent on every platform, so stacking the artwork on top is the only
        // layering that reliably shows it either way. `pointerEvents="none"` (on the
        // wrapping `View` — `Image` itself has no such prop) so it never intercepts the
        // tap-to-toggle `Pressable` below, which still needs the touch.
        <View style={styles.artwork} pointerEvents="none">
          <Image testID="player-artwork" source={{ uri: artworkUrl }} style={styles.artworkImage} resizeMode="cover" accessible={false} />
        </View>
      ) : null}
      <Pressable
        style={StyleSheet.absoluteFillObject}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide playback controls' : 'Show playback controls'}
        onPress={overlay.toggle}
      />
      {isBuffering && !rendered ? (
        <View
          style={styles.overlay}
          pointerEvents="none"
          accessibilityRole="progressbar"
          accessibilityLabel="Buffering"
        >
          <ActivityIndicator color={colors.accent.gold} size="large" />
        </View>
      ) : null}
      {rendered ? (
        <Animated.View style={[styles.overlay, { opacity }]} pointerEvents={visible ? 'box-none' : 'none'}>
          {/* The dimmer is its own layer (`surface.app` + `opacity`, no rgba literal) so the
              controls above it render at full opacity and hold contrast over bright frames. */}
          <View style={styles.dimmer} pointerEvents="none" />
          <View style={styles.centerRow}>
            <PlaybackOverlayControls
              isPlaying={isPlaying}
              isBuffering={isBuffering}
              isEnded={isEnded}
              onTogglePlay={act(onTogglePlay)}
              onReplay={act(onReplay)}
              onSeekBy={(seconds) => {
                overlay.touch();
                onSeekBy(seconds);
              }}
            />
          </View>
          <View style={styles.bottomRow}>
            <PlayerBottomBar
              currentTimeSeconds={currentTimeSeconds}
              durationSeconds={durationSeconds}
              playbackSpeed={playbackSpeed}
              sleepRemainingSeconds={sleepRemainingSeconds}
              isFullscreen={isFullscreen}
              isMuted={isMuted}
              onToggleMute={act(onToggleMute)}
              onSeekTo={(seconds) => {
                overlay.touch();
                onSeekTo(seconds);
              }}
              onSeekBy={(seconds) => {
                overlay.touch();
                onSeekBy(seconds);
              }}
              onScrubStart={onScrubStart}
              onScrubEnd={onScrubEnd}
              onCycleSpeed={act(onCycleSpeed)}
              onOpenSleepTimer={act(onOpenSleepTimer)}
              onToggleFullscreen={act(onToggleFullscreen)}
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface.app,
  },
  video: {
    width: '100%',
    height: '100%',
  },
  artwork: {
    ...StyleSheet.absoluteFillObject,
  },
  artworkImage: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  dimmer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface.app,
    opacity: 0.45,
  },
  centerRow: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
