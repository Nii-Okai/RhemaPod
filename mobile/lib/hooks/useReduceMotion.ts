import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The system Reduce Motion setting (iOS) / Remove animations (Android), kept live: it
 * updates if the listener changes the setting while the app is open.
 *
 * Starts `false` until the first read resolves, a frame or two after mount. Components
 * that run a long or looping animation should check it before starting, and stop or skip
 * the animation when it turns on.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setReduce(on);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}
