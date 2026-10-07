import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** The overlay hides this long after the last interaction while the video is playing. */
export const OVERLAY_AUTOHIDE_MS = 3000;

export interface UseControlsOverlayOptions {
  isPlaying: boolean;
  isBuffering: boolean;
  /** The sermon reached its end — the overlay stays up with a Replay control. */
  isEnded: boolean;
  /** A sheet (sleep timer) or a seek drag is open — never hide under the user's hands. */
  pinned: boolean;
}

export interface ControlsOverlay {
  visible: boolean;
  reduceMotion: boolean;
  /** Tap on the video itself: show if hidden, hide if shown. */
  toggle: () => void;
  /** Any interaction with a control: shows the overlay and restarts the 3s timer. */
  touch: () => void;
}

/**
 * Tap-to-toggle overlay state (design spec §1.2). Auto-hide runs only while the video is
 * playing and nothing pins the overlay: it does not hide when paused, buffering, ended,
 * pinned (sheet open / seek drag), or while a screen reader is active — hiding controls
 * out from under assistive tech makes the player unusable. Each `touch()` restarts the timer.
 */
export function useControlsOverlay({ isPlaying, isBuffering, isEnded, pinned }: UseControlsOverlayOptions): ControlsOverlay {
  const [shown, setShown] = useState(true);
  const [interactions, setInteractions] = useState(0);
  const [screenReader, setScreenReader] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => active && setScreenReader(on))
      .catch(() => {});
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => active && setReduceMotion(on))
      .catch(() => {});
    const readerSub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    const motionSub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      readerSub.remove();
      motionSub.remove();
    };
  }, []);

  const mustStayVisible = !isPlaying || isBuffering || isEnded || pinned || screenReader;

  useEffect(() => {
    if (!shown || mustStayVisible) return;
    const timer = setTimeout(() => setShown(false), OVERLAY_AUTOHIDE_MS);
    return () => clearTimeout(timer);
  }, [shown, mustStayVisible, interactions]);

  const toggle = useCallback(() => {
    setShown((current) => !current);
    setInteractions((n) => n + 1);
  }, []);

  const touch = useCallback(() => {
    setShown(true);
    setInteractions((n) => n + 1);
  }, []);

  return { visible: shown || isEnded || screenReader, reduceMotion, toggle, touch };
}
