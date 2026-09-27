import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api/typedClient';
import { queryKeys } from '../../../lib/query/queryClient';
import type { components } from '../../../lib/api/schema';

export type ProgressUpdate = components['schemas']['ProgressUpdate'];

/** `ProgressUpdate.watched_delta`'s own server-side ceiling (`app/models/content_schemas.py`)
 * — mirrored here so a long-paused/backgrounded session never sends a delta the backend
 * would 422 on. */
const MAX_WATCHED_DELTA_SECONDS = 3600;

/** Plan L16's own band ("every ~15–30s") — the middle of it. */
const DEFAULT_FLUSH_INTERVAL_MS = 20_000;

export interface UseProgressFlushOptions {
  /** Overridable for tests; production call sites take the default. */
  intervalMs?: number;
}

export interface ProgressFlush {
  /** Call on every player `timeUpdate` tick. Pure local bookkeeping — never itself
   * triggers a network call, which is the whole point of L16 (scrub position lives
   * outside TanStack Query, not fired on every tick). */
  reportPosition: (positionSeconds: number) => void;
  /** Call whenever the player's `playing` state changes. Starts/stops the periodic
   * flush timer and, on a transition to *not playing* (a real pause, not the initial
   * mount), flushes once immediately per L16 ("... and on pause/background/complete"). */
  reportPlaying: (isPlaying: boolean) => void;
  /** Call once, on `playToEnd`. Flushes immediately with `completed: true`. */
  reportCompleted: () => void;
  /** Unconditional immediate flush — used for the background/unmount cases below, and
   * exposed for a call site that wants to force a write (e.g. leaving the drawer). */
  flushNow: (extra?: { completed?: boolean }) => void;
}

/**
 * Plan L16 (locked, plan.md line 84): playback position is local state, outside
 * TanStack Query, throttle-flushed to `POST /sermons/{sermon_id}/progress` every
 * ~15–30s during active playback **and** on pause/background/complete — never per
 * playback tick (a player's `timeUpdate` event fires multiple times a second).
 *
 * `initialPositionSeconds` seeds the "last flushed position" baseline (the resumed
 * position from `GET .../progress`) so the very first flush after resuming reports a
 * true delta from where the caller actually started, not a false jump from zero.
 */
export function useProgressFlush(
  sermonId: string,
  initialPositionSeconds: number,
  options: UseProgressFlushOptions = {},
): ProgressFlush {
  const intervalMs = options.intervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const queryClient = useQueryClient();

  const positionRef = useRef(initialPositionSeconds);
  const lastFlushedPositionRef = useRef(initialPositionSeconds);
  // Real state (not just a ref) because the periodic-flush effect below needs to
  // actually re-run — start on play, stop on pause — not just read a ref's latest value.
  const [isPlaying, setIsPlaying] = useState(false);
  // Mirrors `isPlaying` for the unmount-only effect below, which needs the *latest*
  // value at actual unmount time without taking `isPlaying` as a dependency (that would
  // tear down and reinstall the unmount effect on every play/pause instead of running
  // its cleanup exactly once, at real unmount).
  const isPlayingRef = useRef(false);

  const mutation = useMutation({
    mutationFn: (body: ProgressUpdate) =>
      api.post('/sermons/{sermon_id}/progress', { params: { path: { sermon_id: sermonId } }, body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.progress.detail(sermonId) });
    },
  });
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  const reportPosition = useCallback((positionSeconds: number) => {
    positionRef.current = positionSeconds;
  }, []);

  const flushNow = useCallback((extra: { completed?: boolean } = {}) => {
    const position = positionRef.current;
    const delta = Math.min(
      MAX_WATCHED_DELTA_SECONDS,
      Math.max(0, Math.round(position - lastFlushedPositionRef.current)),
    );
    lastFlushedPositionRef.current = position;
    mutateRef.current({
      position_seconds: Math.max(0, Math.round(position)),
      watched_delta: delta,
      completed: extra.completed,
    });
    // Stable identity across renders — every dependency it touches is a ref, so this
    // callback never needs to change and the periodic-flush effect below never has to
    // re-arm its interval just because the mutation object's own identity changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reportCompleted = useCallback(() => {
    flushNow({ completed: true });
  }, [flushNow]);

  const reportPlaying = useCallback(
    (playing: boolean) => {
      // `isPlayingRef` (not a `setState` functional updater) is the source of truth for
      // "was playing" here on purpose: React may call a functional updater speculatively
      // without committing it (concurrent rendering), which would make a side effect
      // (flushing, or writing another ref) inside one unreliable. A plain, synchronous
      // ref read-then-write has no such hazard.
      const wasPlaying = isPlayingRef.current;
      isPlayingRef.current = playing;
      // A transition from playing -> not playing is a pause (or the player stalling at
      // the end without an explicit playToEnd) — flush once immediately. The initial
      // `false` a freshly-created player reports before its first `play()` isn't a
      // pause and must not fire a spurious zero-delta flush at mount.
      if (wasPlaying && !playing) flushNow();
      setIsPlaying(playing);
    },
    [flushNow],
  );

  // Periodic flush — armed only while actually playing, per L16's "every ~15-30s"
  // being about active playback, not a timer that re-flushes a static paused position.
  // `reportPlaying` above already covers the pause-transition flush itself.
  useEffect(() => {
    if (!isPlaying) return undefined;
    const id = setInterval(() => flushNow(), intervalMs);
    return () => clearInterval(id);
  }, [isPlaying, intervalMs, flushNow]);

  // Background/foreground transitions (plan L16's third trigger, alongside pause and
  // complete). Any state other than 'active' (backgrounded, inactive — e.g. the iOS
  // app-switcher card, a phone call overlay) flushes once, but only if playback was
  // actually in progress — a flush already happened at the moment of a real pause, and
  // there is nothing new to report for a screen that's just sitting idle/loading when
  // the app backgrounds. Returning to 'active' isn't itself a flush trigger; playback
  // resumes and the periodic/pause triggers take over again from there.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active' && isPlayingRef.current) flushNow();
    });
    return () => subscription.remove();
  }, [flushNow]);

  // Safety-net flush on unmount (navigating away from the player) — covers the case
  // where the user backs out of the screen mid-playback without an intervening
  // pause/background event (e.g. a hardware back press while still playing). Gated on
  // "was playing" for the same reason as the background handler above: a screen that
  // unmounts having never played anything (e.g. it errored before playback started)
  // has nothing new to report.
  useEffect(() => {
    return () => {
      if (isPlayingRef.current) flushNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately only on unmount, not on every `flushNow` identity change (it's stable anyway, see above).
  }, []);

  return { reportPosition, reportPlaying, reportCompleted, flushNow };
}
