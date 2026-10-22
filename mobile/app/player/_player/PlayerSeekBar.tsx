import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { colors } from '../../../theme/colors';
import { formatDuration } from '../../../lib/format/duration';

const THUMB = 14;

export interface PlayerSeekBarProps {
  currentTimeSeconds: number;
  /** `null` before the player has resolved a duration — the bar is inert until then. */
  durationSeconds: number | null;
  /** Called once, on release (or tap), with the target position in seconds. */
  onSeek: (seconds: number) => void;
  /** VoiceOver/TalkBack increment/decrement: a relative jump in seconds. */
  onAdjust: (deltaSeconds: number) => void;
  adjustStepSeconds: number;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Drag-to-scrub seek bar (design spec §1.3). A local component in `_player/` rather than an
 * extension of `components/ProgressBar`: that primitive is a read-only progress indicator
 * shared with the Downloads rows, and this is its only scrubbing consumer. The visual bar is
 * thin; the hit region is the full 44pt-high row. Seeks fire on release, not per move, so a
 * drag never floods the player. Exposed as an `adjustable` control for screen readers.
 */
export function PlayerSeekBar({
  currentTimeSeconds,
  durationSeconds,
  onSeek,
  onAdjust,
  adjustStepSeconds,
  onScrubStart,
  onScrubEnd,
}: PlayerSeekBarProps) {
  const disabled = !durationSeconds || durationSeconds <= 0;
  const [width, setWidth] = useState(0);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const startRatio = useRef(0);

  // The responder is created once; everything it reads that changes lives in refs.
  const latest = useRef({ width, durationSeconds, disabled, currentTimeSeconds, onSeek, onScrubStart, onScrubEnd });
  latest.current = { width, durationSeconds, disabled, currentTimeSeconds, onSeek, onScrubStart, onScrubEnd };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !latest.current.disabled,
        onMoveShouldSetPanResponder: () => !latest.current.disabled,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          const { width: w } = latest.current;
          const ratio = w > 0 ? clamp01(evt.nativeEvent.locationX / w) : 0;
          startRatio.current = ratio;
          setDragRatio(ratio);
          latest.current.onScrubStart?.();
        },
        onPanResponderMove: (_evt, gesture) => {
          const { width: w } = latest.current;
          if (w > 0) setDragRatio(clamp01(startRatio.current + gesture.dx / w));
        },
        onPanResponderRelease: (_evt, gesture) => {
          const { width: w, durationSeconds: d } = latest.current;
          const ratio = w > 0 ? clamp01(startRatio.current + gesture.dx / w) : 0;
          setDragRatio(null);
          if (d && d > 0) latest.current.onSeek(ratio * d);
          latest.current.onScrubEnd?.();
        },
        onPanResponderTerminate: () => {
          setDragRatio(null);
          latest.current.onScrubEnd?.();
        },
      }),
    [],
  );

  const playedRatio = disabled ? 0 : clamp01(currentTimeSeconds / durationSeconds!);
  const ratio = dragRatio ?? playedRatio;
  const dragging = dragRatio !== null;
  const shownSeconds = dragging && durationSeconds ? ratio * durationSeconds : currentTimeSeconds;

  const handleAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') onAdjust(adjustStepSeconds);
    if (event.nativeEvent.actionName === 'decrement') onAdjust(-adjustStepSeconds);
  };

  return (
    <View
      {...responder.panHandlers}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Seek"
      accessibilityValue={{ text: `${formatDuration(shownSeconds)} of ${formatDuration(durationSeconds)}` }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={handleAction}
      style={[styles.hitArea, disabled && styles.disabled]}
    >
      <View pointerEvents="none" style={[styles.track, dragging && styles.trackActive]}>
        <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      </View>
      <View
        pointerEvents="none"
        style={[styles.thumb, { left: Math.max(0, ratio * width - THUMB / 2) }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: {
    minHeight: 44,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.track.default,
    overflow: 'hidden',
  },
  trackActive: {
    height: 6,
  },
  fill: {
    height: '100%',
    backgroundColor: colors.accent.gold,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.accent.goldText,
  },
});
