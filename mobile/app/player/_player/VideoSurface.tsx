import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { VideoView } from 'expo-video';
import type { VideoPlayer } from 'expo-video';
import { colors } from '../../../theme/colors';

export interface VideoSurfaceProps {
  player: VideoPlayer;
  /** Derived from the player's own `status` (`'loading'`) — design spec §3 Player:
   * "buffering (spinner over player surface, not source-specified but required — flag to
   * `mobile-developer` as a needed addition)". Built here per that flag. */
  isBuffering: boolean;
}

/**
 * The pinned-to-top video surface (design spec §3 Player: "Player pinned to top (video
 * surface, ...)"). Native controls are off (`nativeControls={false}`) — this app builds
 * its own transport row (`TransportControls`) below the surface rather than the OS
 * default overlay, so speed/sleep-timer/notes affordances live in one consistent place
 * instead of split between a native overlay and custom chrome.
 */
export function VideoSurface({ player, isBuffering }: VideoSurfaceProps) {
  return (
    <View style={styles.wrap}>
      <VideoView player={player} style={styles.video} nativeControls={false} contentFit="contain" />
      {isBuffering ? (
        <View style={styles.overlay} accessibilityRole="progressbar" accessibilityLabel="Buffering">
          {/* A separate scrim layer (not the indicator's own parent's opacity) so the
              spinner itself renders at full opacity instead of fading with the backdrop —
              `colors.surface.app` + `opacity` keeps this token-only, no raw rgba literal. */}
          <View style={styles.overlayScrim} />
          <ActivityIndicator color={colors.accent.gold} size="large" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface.sunken,
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
  overlayScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface.app,
    opacity: 0.6,
  },
});
