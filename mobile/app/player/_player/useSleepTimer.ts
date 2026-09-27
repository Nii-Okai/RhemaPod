import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseSleepTimerOptions {
  /** Called once, exactly when the countdown reaches zero. */
  onExpire: () => void;
}

export interface SleepTimer {
  /** Seconds left, or `null` when no timer is armed. */
  remainingSeconds: number | null;
  /** Arms a new countdown (minutes), or disarms with `null` — replaces whatever was
   * already running, it does not add to it. */
  setMinutes: (minutes: number | null) => void;
}

/**
 * Player screen's sleep timer (design spec §3 Player: "Sleep timer ... [is] client-only
 * state (no backend need)"). Ticks down once per second while armed; on reaching zero,
 * calls `onExpire` (the caller pauses playback) and disarms itself so a stale "0:00"
 * never lingers in the transport row.
 *
 * `onExpire` is taken through a ref so this hook never needs to re-arm its interval just
 * because the caller passed a new closure — the same stability trick `useProgressFlush`
 * uses for its own callback-through-ref pattern.
 */
export function useSleepTimer({ onExpire }: UseSleepTimerOptions): SleepTimer {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const setMinutes = useCallback((minutes: number | null) => {
    setRemainingSeconds(minutes === null ? null : Math.round(minutes * 60));
  }, []);

  useEffect(() => {
    if (remainingSeconds === null) return undefined;

    if (remainingSeconds <= 0) {
      onExpireRef.current();
      setRemainingSeconds(null);
      return undefined;
    }

    const id = setInterval(() => {
      setRemainingSeconds((current) => (current === null ? null : current - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [remainingSeconds]);

  return { remainingSeconds, setMinutes };
}
