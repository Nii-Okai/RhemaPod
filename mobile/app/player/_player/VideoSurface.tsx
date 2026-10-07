import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';
import { VideoView } from 'expo-video';
import type { VideoPlayer } from 'expo-video';
import { colors } from '../../../theme/colors';
import { PlaybackOverlayControls } from './TransportControls';
import type { ControlsOverlay } from './useControlsOverlay';

const FADE_IN_MS = 150;
const FADE_OUT_MS = 200;

export interface VideoSurfaceProps {
  player: VideoPlayer;
  /** Ref to the underlying `VideoView`, so the bottom bar can request native fullscreen. */
  videoRef: React.RefObject<VideoView>;
  /** Derived from the player's own `status` (`'loading'`). */
  isBuffering: boolean;
  isPlaying: boolean;
  isEnded: boolean;
  overlay: ControlsOverlay;
  isFullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
  onTogglePlay: () => void;
  onReplay: () => void;
  onSeekBy: (seconds: number) => void;
}

/**
 * The video area (design spec comments-and-player §1.2): a 16:9 surface with a tap-to-toggle
 * overlay — a dimmer plus rewind / play-pause / forward — that fades in and out (instantly
 * under Reduce Motion) and auto-hides per `useControlsOverlay`. Inline, native controls are
 * off: this app draws its own. In native fullscreen they switch on and the OS controls take
 * over (so the overlay is not drawn there); exiting returns to the inline layout with the
 * playback position intact, since it is the same player.
 */
export function VideoSurface({
  player,
  videoRef,
  isBuffering,
  isPlaying,
  isEnded,
  overlay,
  isFullscreen,
  onFullscreenChange,
  onTogglePlay,
  onReplay,
  onSeekBy,
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface.app,
    opacity: 0.45,
  },
});
